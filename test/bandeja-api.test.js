import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync, borrarArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

// Rutas de la bandeja de revision "Rescatados de Operam" (issue #122). Los
// candidatos se SIEMBRAN via el store (este ticket no habla con Operam: ninguna
// ruta de aqui sale a la red).

const __dirname = dirname(fileURLToPath(import.meta.url));
const BANDEJA_PATH = join(__dirname, '..', 'data', 'bandeja.json');
const PROSPECTOS_PATH = join(__dirname, '..', 'data', 'prospectos.json');
const COTIZACIONES_PATH = join(__dirname, '..', 'data', 'cotizaciones.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');
const { proponer, obtener } = await import('../lib/bandeja-store.js');
const { listar: listarProspectos, crear: crearProspecto } = await import('../lib/prospectos-store.js');
const cotStore = await import('../lib/cotizaciones-store.js');
const { reconciliarOportunidad } = await import('../lib/sync-operam-io.js');
const ADMIN_TOKEN = jwt.sign({ id: 99, name: 'Tester', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
const MEMO_TOKEN = jwt.sign({ id: 7, name: 'Memo', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });

function leerArchivoJson(path) {
  if (!existsSync(path)) return [];
  return JSON.parse(leerArchivoSync(path));
}
function escribirArchivoJson(path, data) {
  escribirArchivoSync(path, JSON.stringify(data, null, 2));
}

// Ninguna ruta de la bandeja sale a la red: si alguna lo intentara, el test lo
// delata (mismo guardrail que prospectos-api.test.js).
const originalFetch = globalThis.fetch;
const fetchBloqueado = async (url) => { throw new Error('fetch sin mock en tests: ' + url); };

let savedBandeja, savedProspectos, savedCotizaciones, existiaBandeja, existiaProspectos, existiaCotizaciones;
before(() => {
  existiaBandeja = existsSync(BANDEJA_PATH);
  existiaProspectos = existsSync(PROSPECTOS_PATH);
  existiaCotizaciones = existsSync(COTIZACIONES_PATH);
  savedBandeja = leerArchivoJson(BANDEJA_PATH);
  savedProspectos = leerArchivoJson(PROSPECTOS_PATH);
  savedCotizaciones = leerArchivoJson(COTIZACIONES_PATH);
  globalThis.fetch = fetchBloqueado;
});
after(() => {
  if (existiaBandeja) escribirArchivoJson(BANDEJA_PATH, savedBandeja);
  else if (existsSync(BANDEJA_PATH)) borrarArchivoSync(BANDEJA_PATH);
  if (existiaProspectos) escribirArchivoJson(PROSPECTOS_PATH, savedProspectos);
  else if (existsSync(PROSPECTOS_PATH)) borrarArchivoSync(PROSPECTOS_PATH);
  if (existiaCotizaciones) escribirArchivoJson(COTIZACIONES_PATH, savedCotizaciones);
  else if (existsSync(COTIZACIONES_PATH)) borrarArchivoSync(COTIZACIONES_PATH);
  globalThis.fetch = originalFetch;
});
beforeEach(() => {
  escribirArchivoJson(BANDEJA_PATH, []);
  escribirArchivoJson(PROSPECTOS_PATH, []);
  escribirArchivoJson(COTIZACIONES_PATH, []);
  globalThis.fetch = fetchBloqueado;
});

const CANDIDATO = {
  folio: 934,
  tipo: 'prospecto',
  fecha: '2026-07-21T00:00:00.000Z',
  contacto: 'Mariana Gutierrez Solis',
  celular: '+52 55 2314 8890',
  email: 'mariana.gs@hotmail.com',
  proyecto: 'Hotel Boutique Valle',
  domicilio: 'Av. de los Insurgentes 1420, Col. Del Valle, CDMX',
  monto: 48250,
  debtorId: 184,
  debtorNombre: 'GENERICO TIENDAS DIGITALES',
  vendedor: 'Alejandro Chávez',
  marcas: { comproOtraCosa: true, posibleDuplicado: false },
};

test('el admin ve los candidatos sembrados con todos sus campos y marcas', async () => {
  await proponer(CANDIDATO);
  const res = await supertest(app).get('/api/admin/bandeja')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  const c = res.body[0];
  assert.equal(c.folio, '934');
  assert.equal(c.tipo, 'prospecto');
  assert.equal(c.estado, 'pendiente');
  assert.equal(c.contacto, 'Mariana Gutierrez Solis');
  assert.equal(c.celular, '+52 55 2314 8890');
  assert.equal(c.email, 'mariana.gs@hotmail.com');
  assert.equal(c.proyecto, 'Hotel Boutique Valle');
  assert.equal(c.domicilio, 'Av. de los Insurgentes 1420, Col. Del Valle, CDMX');
  assert.equal(c.monto, 48250);
  assert.equal(c.debtorNombre, 'GENERICO TIENDAS DIGITALES');
  assert.equal(c.vendedor, 'Alejandro Chávez');
  assert.deepEqual(c.marcas, { comproOtraCosa: true, posibleDuplicado: false });
});

test('un vendedor no admin no ve la bandeja', async () => {
  await proponer(CANDIDATO);
  const lista = await supertest(app).get('/api/admin/bandeja')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(lista.status, 403);
});

test('sin token la bandeja responde 401', async () => {
  const res = await supertest(app).get('/api/admin/bandeja');
  assert.equal(res.status, 401);
});

// === Aceptar ===

test('aceptar crea el prospecto con el vendedor elegido y liga el candidato al id creado', async () => {
  await proponer(CANDIDATO);
  const res = await supertest(app).post('/api/admin/bandeja/934/aceptar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: 'Oswaldo Chávez' });
  assert.equal(res.status, 201);
  assert.ok(res.body.prospectoId);

  const prospectos = await listarProspectos();
  assert.equal(prospectos.length, 1);
  const p = prospectos[0];
  assert.equal(p.id, res.body.prospectoId);
  assert.equal(p.nombre, 'Mariana Gutierrez Solis');
  assert.equal(p.celular, '+52 55 2314 8890');
  // el vendedor del body gana sobre el propuesto por el candidato (editable)
  assert.equal(p.vendedor, 'Oswaldo Chávez');
  // trazabilidad del rescate: de que quote de Operam salio la tarjeta
  assert.equal(p.data.folioOperam, '934');

  const c = await obtener('934');
  assert.equal(c.estado, 'aceptado');
  assert.equal(c.prospectoId, res.body.prospectoId);
  assert.equal(c.vendedor, 'Oswaldo Chávez');
});

test('aceptar sin vendedor en el body usa el vendedor propuesto del candidato', async () => {
  await proponer(CANDIDATO);
  const res = await supertest(app).post('/api/admin/bandeja/934/aceptar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({});
  assert.equal(res.status, 201);
  const prospectos = await listarProspectos();
  assert.equal(prospectos[0].vendedor, 'Alejandro Chávez');
});

test('aceptar con un vendedor fuera del catalogo no crea nada', async () => {
  await proponer(CANDIDATO);
  const res = await supertest(app).post('/api/admin/bandeja/934/aceptar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: 'Quien Sea' });
  assert.equal(res.status, 400);
  assert.equal((await listarProspectos()).length, 0);
  assert.equal((await obtener('934')).estado, 'pendiente');
});

test('aceptar dos veces el mismo folio no crea un segundo prospecto', async () => {
  await proponer(CANDIDATO);
  const primero = await supertest(app).post('/api/admin/bandeja/934/aceptar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: 'Oswaldo Chávez' });
  assert.equal(primero.status, 201);
  const segundo = await supertest(app).post('/api/admin/bandeja/934/aceptar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: 'Alejandro Chávez' });
  assert.equal(segundo.status, 409);
  assert.equal((await listarProspectos()).length, 1);
  const c = await obtener('934');
  assert.equal(c.prospectoId, primero.body.prospectoId);
  assert.equal(c.vendedor, 'Oswaldo Chávez');
});

// === Aceptar como cotizacion (issue #125) ===
// El segundo camino de aceptacion: el candidato tipo cotizacion (quote de un cliente
// REAL) entra al pipeline como oportunidad, construida desde el payload del quote que
// el propio candidato carga -- la aceptacion NO habla con Operam.

const QUOTE = {
  ord_date: '2026-07-21',
  delivery_date: '2026-08-20',
  total: 48250,
  cust_ref: 'Remodelacion Hotel Valle',
  deliver_to: 'Mariana Gutierrez Solis',
  debtor_no: 512,
  detalles: [
    { stock_id: '250101001', stock_id_text: 'Taza 8 cm blanca', quantity: 120, units: 'pza', unit_price: 85, discount_percent: 0 },
    { stock_id: '250102003', stock_id_text: 'Plato 20 cm azul', quantity: 60, units: 'pza', unit_price: 130, discount_percent: 5 },
  ],
  debtor: { debtor_no: 512, CustName: 'HOTELES DEL VALLE SA DE CV', tax_id: 'HVA160305MX8', curr_code: 'MXN' },
};

const CANDIDATO_COTIZACION = {
  ...CANDIDATO,
  folio: 951,
  tipo: 'cotizacion',
  debtorId: 512,
  debtorNombre: 'HOTELES DEL VALLE SA DE CV',
  quote: QUOTE,
};

test('aceptar como cotizacion crea la oportunidad con partidas y folio ligado', async () => {
  await proponer(CANDIDATO_COTIZACION);
  const res = await supertest(app).post('/api/admin/bandeja/951/aceptar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: 'Oswaldo Chávez' });
  assert.equal(res.status, 201);
  assert.ok(res.body.cotizacionId);
  assert.equal(res.body.existente, false);

  const cot = await cotStore.obtener(res.body.cotizacionId);
  // El folio de Operam es columna de primer nivel (no vive en data): es lo que ata
  // la tarjeta a su quote y lo que el sync usa para resolver el pedido.
  assert.equal(cot.folioOperam, '951');
  assert.equal(cot.cliente, 'HOTELES DEL VALLE SA DE CV');
  assert.equal(cot.vendedor, 'Oswaldo Chávez');
  assert.equal(cot.total, 48250);
  assert.equal(cot.etapa, 'seguimiento');
  assert.equal(cot.data.cliente.rfc, 'HVA160305MX8');
  assert.equal(cot.data.cliente.customer_ref, 'Remodelacion Hotel Valle');
  assert.equal(cot.data.cliente.contactoEntrega, 'Mariana Gutierrez Solis');
  // PARTIDAS: sin ellas el documento regenerado sale sin renglones (#76).
  assert.equal(cot.data.items.length, 2);
  assert.deepEqual(cot.data.items[0], {
    codigo: '250101001', descripcion: 'Taza 8 cm blanca', cantidad: 120,
    unidad: 'pza', precio: 85, descuento: 0,
  });
  assert.equal(cot.data.items[1].descuento, 5);
  assert.equal(cot.data.validoHasta, '2026-08-20');
  // Origen HONESTO: la tarjeta salio de la bandeja, no del backfill historico
  // (mismo marcador `fuente` que el camino prospecto).
  assert.equal(cot.data.fuente, 'bandeja-operam');
  assert.equal(cot.data.backfill, false);

  // el candidato queda aceptado y ligado a la entrada creada, sin prospecto
  const c = await obtener('951');
  assert.equal(c.estado, 'aceptado');
  assert.equal(c.cotizacionId, res.body.cotizacionId);
  assert.equal(c.prospectoId, null);
  assert.equal((await listarProspectos()).length, 0);
});

test('un candidato de debtor generico NO se acepta como cotizacion, aunque su tipo lo diga', async () => {
  // 184 = GENERICO TIENDAS DIGITALES. Si entrara al pipeline, el fallback por
  // cliente del sync mezclaria los pedidos de todos los contactos del cajon.
  await proponer({ ...CANDIDATO_COTIZACION, folio: 952, debtorId: 184, debtorNombre: 'GENERICO TIENDAS DIGITALES' });
  const res = await supertest(app).post('/api/admin/bandeja/952/aceptar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: 'Oswaldo Chávez' });
  assert.equal(res.status, 422);
  assert.match(res.body.error, /genérico/i);
  assert.match(res.body.error, /prospecto/i);
  assert.equal((await cotStore.listar()).length, 0);
  assert.equal((await obtener('952')).estado, 'pendiente');
});

test('un candidato tipo cotizacion sin el detalle del quote no crea una oportunidad vacia', async () => {
  await proponer({ ...CANDIDATO_COTIZACION, folio: 953, quote: undefined });
  const res = await supertest(app).post('/api/admin/bandeja/953/aceptar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: 'Oswaldo Chávez' });
  assert.equal(res.status, 422);
  assert.equal((await cotStore.listar()).length, 0);
  assert.equal((await obtener('953')).estado, 'pendiente');
});

// El payload sembrado tiene que alcanzar para una oportunidad de verdad: sin
// partidas el documento regenerado sale sin renglones (#76) y sin fecha del quote
// la entrada ni siquiera entra al store (columna NOT NULL en Neon).
test('un quote sembrado sin partidas o sin fecha no crea una oportunidad a medias', async () => {
  await proponer({ ...CANDIDATO_COTIZACION, folio: 954, quote: { ...QUOTE, detalles: [] } });
  await proponer({ ...CANDIDATO_COTIZACION, folio: 955, quote: { ...QUOTE, ord_date: null } });
  for (const folio of ['954', '955']) {
    const res = await supertest(app).post(`/api/admin/bandeja/${folio}/aceptar`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: 'Oswaldo Chávez' });
    assert.equal(res.status, 422, `folio ${folio}`);
    assert.equal((await obtener(folio)).estado, 'pendiente');
  }
  assert.equal((await cotStore.listar()).length, 0);
});

test('aceptar dos veces como cotizacion no crea una segunda oportunidad', async () => {
  await proponer(CANDIDATO_COTIZACION);
  const primero = await supertest(app).post('/api/admin/bandeja/951/aceptar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: 'Oswaldo Chávez' });
  assert.equal(primero.status, 201);
  const segundo = await supertest(app).post('/api/admin/bandeja/951/aceptar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: 'Alejandro Chávez' });
  assert.equal(segundo.status, 409);
  assert.equal((await cotStore.listar()).length, 1);
  const c = await obtener('951');
  assert.equal(c.cotizacionId, primero.body.cotizacionId);
  assert.equal(c.vendedor, 'Oswaldo Chávez');
});

// El folio pudo entrar al store por otro lado: nacio en el cotizador (#63) o lo
// importo el backfill (#76). Aceptarlo NO duplica la oportunidad.
test('si el folio ya es una cotizacion del pipeline, no se duplica: se liga a la existente', async () => {
  const idPrevio = await cotStore.crear({
    fecha: '2026-07-21T00:00:00.000Z', vendedor: 'Alejandro Chávez',
    cliente: 'HOTELES DEL VALLE SA DE CV', total: 48250, data: { backfill: true },
  });
  await cotStore.setFolioOperam(idPrevio, '951');
  await proponer(CANDIDATO_COTIZACION);

  const res = await supertest(app).post('/api/admin/bandeja/951/aceptar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: 'Oswaldo Chávez' });
  assert.equal(res.status, 200);
  assert.equal(res.body.existente, true);
  assert.equal(res.body.cotizacionId, idPrevio);
  assert.equal((await cotStore.listar()).length, 1, 'no se creo una segunda tarjeta para el mismo folio');
  const c = await obtener('951');
  assert.equal(c.estado, 'aceptado');
  assert.equal(c.cotizacionId, idPrevio);
});

// AC clave de #125: la entrada creada es INDISTINGUIBLE para el sync de una
// importada por #76. Se prueba con el motor real (lib/sync-operam-io.js) y las
// lecturas de Operam mockeadas: el sync debe ligarla a su pedido por el folio
// (trans_no_from === folioOperam, prioridad 2 de #67) y moverla de etapa.
test('la cotizacion aceptada la liga el sync por su folio y avanza de etapa', async () => {
  await proponer(CANDIDATO_COTIZACION);
  const res = await supertest(app).post('/api/admin/bandeja/951/aceptar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: 'Oswaldo Chávez' });
  const op = await cotStore.obtener(res.body.cotizacionId);

  // El cliente tiene DOS cadenas: la del quote 951 (pedido 7300, entregada y
  // liquidada) y otra ajena (7999, sin pagar). Solo la primera nacio de este folio.
  let consulta = null;
  const deps = {
    listarTransacciones: async (q) => {
      consulta = q;
      return q.skip > 0 ? [] : [
        { type: '10', order_: '7300', total_amount: '48250', allocated: '48250', outstanding: '0', debtor_no: '512', trans_no: '2201', reference: 'A2201' },
        { type: '13', order_: '7300', total_amount: '48250', allocated: '0', outstanding: '0', debtor_no: '512', reference: 'R881' },
        { type: '10', order_: '7999', total_amount: '10000', allocated: '0', outstanding: '10000', debtor_no: '512', trans_no: '2255', reference: 'A2255' },
      ];
    },
    listarPedidos: async (q) => q.skip > 0 ? [] : [
      { order_no: '7300', trans_type: '30', debtor_no: '512', trans_no_from: '951', total: '48250' },
      { order_no: '7999', trans_type: '30', debtor_no: '512', trans_no_from: '888', total: '10000' },
    ],
  };
  const resultado = await reconciliarOportunidad(op, deps);

  // liga por el RFC del debtor que viajaba en el payload del quote
  assert.equal(consulta.rfc, 'HVA160305MX8');
  assert.equal(resultado.movida, true);
  assert.equal(resultado.etapa, 'producto_entregado');

  const movida = await cotStore.obtener(op.id);
  assert.equal(movida.etapa, 'producto_entregado');
  // El espejo prueba el binding PRECISO: se resolvio el pedido 7300 por el folio
  // 951, no el agregado por cliente (que habria mezclado la cadena 7999).
  assert.equal(movida.data.espejoOperam.cotizacion, '951');
  assert.equal(movida.data.espejoOperam.pedido, '7300');
  assert.equal(movida.data.espejoOperam.pago, 'pagado');
  assert.equal(movida.data.pagoSinRegistrar, false);
});

test('aceptar un folio que no esta en la bandeja responde 404', async () => {
  const res = await supertest(app).post('/api/admin/bandeja/999/aceptar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: 'Oswaldo Chávez' });
  assert.equal(res.status, 404);
  assert.equal((await listarProspectos()).length, 0);
});

test('un vendedor no admin no puede aceptar', async () => {
  await proponer(CANDIDATO);
  const res = await supertest(app).post('/api/admin/bandeja/934/aceptar')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ vendedor: 'Oswaldo Chávez' });
  assert.equal(res.status, 403);
  assert.equal((await listarProspectos()).length, 0);
  assert.equal((await obtener('934')).estado, 'pendiente');
});

// === Descartar ===

test('descartar marca sin borrar: el candidato sigue en la bandeja y no vuelve a proponerse', async () => {
  await proponer(CANDIDATO);
  const res = await supertest(app).post('/api/admin/bandeja/934/descartar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({});
  assert.equal(res.status, 200);

  const lista = await supertest(app).get('/api/admin/bandeja')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
  assert.equal(lista.body.length, 1);
  assert.equal(lista.body[0].estado, 'descartado');
  // un run futuro que lo vuelva a encontrar en Operam no lo re-propone
  assert.equal(await proponer(CANDIDATO), false);
  assert.equal((await obtener('934')).estado, 'descartado');
  assert.equal((await listarProspectos()).length, 0);
});

test('descartar un candidato ya aceptado responde 409 y no lo cambia', async () => {
  await proponer(CANDIDATO);
  await supertest(app).post('/api/admin/bandeja/934/aceptar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: 'Oswaldo Chávez' });
  const res = await supertest(app).post('/api/admin/bandeja/934/descartar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({});
  assert.equal(res.status, 409);
  assert.equal((await obtener('934')).estado, 'aceptado');
});

test('descartar un folio que no esta en la bandeja responde 404', async () => {
  const res = await supertest(app).post('/api/admin/bandeja/999/descartar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({});
  assert.equal(res.status, 404);
});

test('un vendedor no admin no puede descartar', async () => {
  await proponer(CANDIDATO);
  const res = await supertest(app).post('/api/admin/bandeja/934/descartar')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({});
  assert.equal(res.status, 403);
  assert.equal((await obtener('934')).estado, 'pendiente');
});

test('si el celular ya es un prospecto, aceptar liga al existente sin duplicarlo', async () => {
  const idExistente = await crearProspecto({
    fecha: '2026-06-01T00:00:00.000Z', vendedor: 'Alejandro Chávez',
    celular: '5523148890', nombre: 'Mariana G.', ciudad: 'CDMX', canal: 'WhatsApp',
  });
  await proponer(CANDIDATO);
  const res = await supertest(app).post('/api/admin/bandeja/934/aceptar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: 'Oswaldo Chávez' });
  assert.equal(res.status, 200);
  assert.equal(res.body.prospectoId, idExistente);
  assert.equal(res.body.existente, true);
  assert.equal((await listarProspectos()).length, 1);
  const c = await obtener('934');
  assert.equal(c.estado, 'aceptado');
  assert.equal(c.prospectoId, idExistente);
});
