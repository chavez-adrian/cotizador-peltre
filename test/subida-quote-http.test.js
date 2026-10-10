// La traduccion a HTTP de la Subida del quote (#527, ADR-0022): las reglas de la
// subida se prueban en el modulo (test/subida-quote.test.js y
// test/subida-quote-alta.test.js) y las rutas solo traducen su valor. Aqui viven
// las filas de la tabla valor -> respuesta de los dos handlers que ninguna otra
// prueba HTTP afirmaba: el 401, el 425 de cada ruta con su texto, el cuerpo
// completo de "no actualizada", el 503 del camino normal, el `reintentar` del 428
// del camino del alta y los bloqueos del alta y del quote con `customer_id` y
// `steps`. Cada prueba provoca su valor con el MINIMO de Operam que lo produce.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from '../lib/fs-reintento.js';
import { fotoDatos, fijarDatos } from './helpers/datos-aislados.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { webDeMentiras, CONTACTOS_GENERAL_564 } from './helpers/domicilios-web-mentira.js';
import { fijarInterruptorContactos } from './helpers/interruptor-contactos.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COTS_PATH = join(__dirname, '..', 'data', 'cotizaciones.json');
const COLA_POSTFIX_PATH = join(dirname(COTS_PATH), 'postfix-pendientes.json');
const PROSPECTOS_PATH = join(__dirname, '..', 'data', 'prospectos.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');
const { resetSession } = await import('../lib/operam-client.js');
const { resetIndice } = await import('../lib/indice-telefonos.js');
const { _resetSesionWeb } = await import('../lib/operam-web.js');
const { CODIGO_CLIENTE_SIN_LISTA } = await import('../lib/lista-precios-cliente.js');
const TOKEN = 'Bearer ' + jwt.sign({ id: 99, name: 'Tester', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

const TEXTO_425_CREAR = 'Ya hay una subida a Operam en curso para esta cotizacion; espera a que termine y revisa el estado';
const TEXTO_425_ACTUALIZAR = 'Ya hay una operacion de Operam en curso para esta cotizacion; espera a que termine y revisa el estado';

const originalFetch = globalThis.fetch;
const fetchBloqueado = async (url) => { throw new Error('fetch sin mock en tests: ' + url); };
function mockFetchByUrl(handlers) {
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    for (const [pat, fn] of Object.entries(handlers)) {
      if (u.includes(pat)) return fn(u, opts);
    }
    throw new Error('Unmocked fetch: ' + u);
  };
}
function jsonResponse(data, status = 200) {
  return { ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) };
}
const respuestaRateMoneda = () => jsonResponse({ result: false, messages: ['Debe haber al menos un rate de moneda'] }, 406);

function readCots() { return existsSync(COTS_PATH) ? JSON.parse(leerArchivoSync(COTS_PATH)) : []; }

// D6: la escritura de Contactos en Operam encendida para la suite (ausente = apagado).
let restaurarDatos;
let restaurarInterruptor;
before(() => {
  restaurarInterruptor = fijarInterruptorContactos('todos');
  restaurarDatos = fotoDatos([COTS_PATH, PROSPECTOS_PATH, COLA_POSTFIX_PATH]);
});
after(() => { restaurarDatos(); restaurarInterruptor(); globalThis.fetch = originalFetch; });
beforeEach(() => {
  globalThis.fetch = fetchBloqueado;
  fijarDatos(PROSPECTOS_PATH, []);
  resetSession();
  _resetSesionWeb();
  resetIndice();
});

function agregarCotizacion({ folioOperam = null, tier = 'M100', cliente = {}, items } = {}) {
  const cots = readCots();
  const id = cots.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  cots.push({
    id, fecha: '2026-07-06T00:00:00Z', vendedor: 'Alejandro Ch\u00e1vez', cliente: 'Hotel Azul',
    totalPiezas: 100, total: 11600, tier, folioOperam,
    data: {
      fecha: '2026-07-06', vigencia: '2026-08-05',
      cliente: { razonSocial: 'Hotel Azul Centro', nombreCorto: 'Hotel Azul', telefono: '+52 5588776655', celEntrega: '+52 5588776655', calle: 'Av. Juarez 45', cpEntrega: '56530', nombreEntrega: 'Lucia Recibe', pais: 'MX', ...cliente },
      items: items ?? [{ codigo: 'PV08', descripcion: 'Plato', cantidad: 100, precio: 100, descuento: 0 }],
    },
  });
  escribirArchivoSync(COTS_PATH, JSON.stringify(cots, null, 2));
  return id;
}

// El pool por RFC generico trae al candidato 10; su detalle (GET /customers/10) es
// el que decide lo que pasa en el quote. Un solo handler sirve las dos lecturas.
function clientesConCandidato10(detalle = {}) {
  return (u, opts) => {
    if (opts?.method === 'PUT') return jsonResponse({ result: true });
    if (u.includes('/customers/10')) {
      return jsonResponse({ data: [{ customer_id: '10', CustName: 'HOTEL AZUL SA DE CV', sales_type: '12', curr_code: 'MXN', branches: [{ branch_code: 20 }], ...detalle }] });
    }
    if (u.includes('tax_id=')) {
      return jsonResponse({ total: 1, data: [{ customer_id: 10, CustName: 'HOTEL AZUL SA DE CV', cust_ref: 'Hotel Azul', tax_id: 'XAXX010101000' }] });
    }
    return jsonResponse({ total: 0, data: [] });
  };
}

// --- 401 ---------------------------------------------------------------------

test('crear sin token responde 401', async () => {
  const id = agregarCotizacion();
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).send({});
  assert.equal(res.status, 401);
});

test('actualizar sin token responde 401', async () => {
  const id = agregarCotizacion({ folioOperam: '1200' });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}/actualizar`);
  assert.equal(res.status, 401);
});

// --- 425 ---------------------------------------------------------------------
// Operam retiene a la primera peticion hasta que la prueba la suelta: la segunda
// llega con el candado tomado. Si el candado se rompiera, la segunda tambien
// quedaria retenida: la carrera con el tope la reporta en un segundo en vez de
// colgar la suite, y `soltar` corre siempre para que ninguna peticion quede viva.
function operamRetenido() {
  let avisarLlamada;
  const llamado = new Promise(r => { avisarLlamada = r; });
  let soltar;
  const suelto = new Promise(r => { soltar = r; });
  globalThis.fetch = async () => {
    avisarLlamada();
    await suelto;
    throw new Error('Operam caido');
  };
  return { llamado, soltar };
}

const SIN_RESPUESTA = 'la segunda peticion no respondio en 1 s';

async function segundaPeticionConTope(peticion) {
  let tope;
  const limite = new Promise(r => { tope = setTimeout(() => r(SIN_RESPUESTA), 1000); });
  try {
    return await Promise.race([peticion, limite]);
  } finally {
    clearTimeout(tope);
  }
}

// supertest no manda la peticion hasta que alguien llama a `then`: el `.then(r => r)`
// la arranca sin esperarla.
async function dosPeticionesEnVuelo(enviar) {
  const { llamado, soltar } = operamRetenido();
  const primera = enviar().then(r => r);
  let segunda;
  try {
    await llamado;
    segunda = enviar().then(r => r);
    return await segundaPeticionConTope(segunda);
  } finally {
    soltar();
    await primera;
    await segunda;
  }
}

test('crear con otra operacion en vuelo responde 425 con su texto', async () => {
  const id = agregarCotizacion();
  const res = await dosPeticionesEnVuelo(() => supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN).send({}));
  assert.notEqual(res, SIN_RESPUESTA, SIN_RESPUESTA);
  assert.equal(res.status, 425);
  assert.deepEqual(res.body, { error: TEXTO_425_CREAR });
});

test('actualizar con otra operacion en vuelo responde 425 con su texto', async () => {
  const id = agregarCotizacion({ folioOperam: '1200' });
  const res = await dosPeticionesEnVuelo(() => supertest(app).post(`/api/cotizacion/operam/${id}/actualizar`).set('Authorization', TOKEN));
  assert.notEqual(res, SIN_RESPUESTA, SIN_RESPUESTA);
  assert.equal(res.status, 425);
  assert.deepEqual(res.body, { error: TEXTO_425_ACTUALIZAR });
});

// --- /actualizar: no actualizada ----------------------------------------------
// Una cotizacion sin partidas se rechaza antes de abrir la sesion de edicion
// (operam-web), sin tocar Operam: el valor no-actualizada mas barato.

test('actualizar no logrado responde 200 con ok false y el cuerpo completo', async () => {
  const id = agregarCotizacion({ folioOperam: '1200', items: [] });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}/actualizar`).set('Authorization', TOKEN);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.folio, '1200');
  assert.equal(res.body.actualizada, false);
  assert.equal(res.body.escrito, false);
  assert.equal(res.body.verificado, false);
  assert.match(res.body.error, /no tiene partidas/);
  assert.deepEqual(res.body.discrepancias, []);
  assert.equal(res.body.steps[0].name, 'actualizar quote');
  assert.equal(res.body.steps[0].status, 'error');
});

// --- Camino normal: 503 -------------------------------------------------------

test('crear por el camino normal con Operam caido en el quote responde 503 sin customer_id ni steps', async () => {
  const id = agregarCotizacion({ cliente: { customerId: 10, branchId: 20, rfc: 'HAZ010101AB1' } });
  mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': clientesConCandidato10(),
    '/api/v3/sales/quote': () => jsonResponse({ error: 'boom' }, 500),
  });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN).send({});
  assert.equal(res.status, 503);
  assert.match(res.body.error, /^No se pudo subir a Operam: /);
  assert.deepEqual(Object.keys(res.body), ['error']);
});

// --- Camino del alta: el reintentar del 428 -----------------------------------
// El Contacto ya esta ligado al 555 y el vendedor eligio al 10: el alta pregunta
// antes de escribir nada. El cuerpo del reintento lo dicta el servidor.

function contactoLigadoA555() {
  fijarDatos(PROSPECTOS_PATH, [{
    id: 1, fecha: '2026-07-01T00:00:00Z', vendedor: 'Alejandro Ch\u00e1vez',
    celular: '+52 5588776655', celular10: '5588776655', nombre: 'Hotel Azul', etapa: 'seguimiento', eventos: [], data: { cliente_id: 555 },
  }]);
}
const operamSoloLectura = () => ({
  '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
  '/api/v3/sales/customers': () => jsonResponse({ total: 0, data: [] }),
});

test('428 del camino del alta con sucursalDe: el reintento vuelve con sucursalDe', async () => {
  contactoLigadoA555();
  const id = agregarCotizacion();
  mockFetchByUrl(operamSoloLectura());
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN).send({ sucursalDe: 10 });
  assert.equal(res.status, 428);
  assert.equal(res.body.codigo, 'CONFIRMAR_OTRA_RAZON_SOCIAL');
  assert.deepEqual(res.body.reintentar, { sucursalDe: 10, otraRazonSocial: true });
});

test('428 del camino del alta con crearNuevo junto al elegido: el reintento conserva crearNuevo', async () => {
  contactoLigadoA555();
  const id = agregarCotizacion();
  mockFetchByUrl(operamSoloLectura());
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN).send({ customerId: 10, crearNuevo: true });
  assert.equal(res.status, 428);
  assert.deepEqual(res.body.reintentar, { customerId: 10, crearNuevo: true, otraRazonSocial: true });
});

// --- Camino del alta: bloqueos del alta ---------------------------------------

test('bloqueo del alta sin-lista-precios sin cliente creado: 422 con su codigo y steps, sin customer_id', async () => {
  const id = agregarCotizacion();
  mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/sales_types': () => jsonResponse({ data: [{ id: '15', sales_type: 'M100', inactive: '0' }] }),
    '/api/v3/sales/customers': (u, opts) => (opts?.method === 'POST' ? respuestaRateMoneda() : jsonResponse({ total: 0, data: [] })),
  });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN).send({});
  assert.equal(res.status, 422);
  assert.equal(res.body.codigo, CODIGO_CLIENTE_SIN_LISTA);
  assert.match(res.body.error, /lista de precios/);
  assert.equal('customer_id' in res.body, false);
  assert.ok(Array.isArray(res.body.steps) && res.body.steps.length > 0);
});

test('bloqueo del alta sin-lista-precios con el cliente ya creado: 422 con customer_id y steps', async () => {
  const id = agregarCotizacion();
  mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/sales_types': () => jsonResponse({ data: [{ id: '15', sales_type: 'M100', inactive: '0' }] }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return jsonResponse({ result: true, customer_id: 940 });
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      if (u.includes('/customers/940')) return respuestaRateMoneda();
      return jsonResponse({ total: 0, data: [] });
    },
  });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN).send({});
  assert.equal(res.status, 422);
  assert.equal(res.body.codigo, CODIGO_CLIENTE_SIN_LISTA);
  assert.equal(res.body.customer_id, 940);
  assert.ok(Array.isArray(res.body.steps) && res.body.steps.length > 0);
});

test('bloqueo del alta por Operam con el cliente ya creado: 503 con customer_id y steps', async () => {
  const id = agregarCotizacion();
  mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/sales_types': () => jsonResponse({ data: [{ id: '15', sales_type: 'M100', inactive: '0' }] }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return jsonResponse({ result: true, customer_id: 940 });
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      if (u.includes('/customers/940')) return jsonResponse({ error: 'boom' }, 500);
      return jsonResponse({ total: 0, data: [] });
    },
  });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN).send({});
  assert.equal(res.status, 503);
  assert.equal(res.body.customer_id, 940);
  assert.equal('codigo' in res.body, false);
  assert.ok(Array.isArray(res.body.steps) && res.body.steps.length > 0);
});

// --- Camino del alta: bloqueos del quote --------------------------------------
// El vendedor eligio al 10 (decision usar): el alta lo reutiliza y el quote se
// sube sobre el, verificando su lista y su moneda antes del POST.

test('quote del camino del alta con el cliente sin lista: 422 con su codigo, customer_id y steps', async () => {
  const id = agregarCotizacion();
  mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': clientesConCandidato10({ sales_type: '0' }),
  });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN).send({ customerId: 10 });
  assert.equal(res.status, 422);
  assert.equal(res.body.codigo, CODIGO_CLIENTE_SIN_LISTA);
  assert.equal(res.body.customer_id, 10);
  assert.equal(res.body.steps.at(-1).name, 'POST quote');
  assert.equal(res.body.steps.at(-1).status, 'error');
});

test('quote del camino del alta con el cliente en otra moneda: 422 con su codigo, la moneda, customer_id y steps', async () => {
  const id = agregarCotizacion();
  mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': clientesConCandidato10({ curr_code: 'USD' }),
  });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN).send({ customerId: 10 });
  assert.equal(res.status, 422);
  assert.equal(res.body.codigo, 'CLIENTE_MONEDA_EXTRANJERA');
  assert.equal(res.body.moneda, 'USD');
  assert.equal(res.body.customer_id, 10);
  assert.equal(res.body.steps.at(-1).name, 'POST quote');
});

test('quote del camino del alta con Operam caido: 503 con customer_id y steps', async () => {
  const id = agregarCotizacion();
  mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': clientesConCandidato10(),
    '/api/v3/sales/quote': () => jsonResponse({ error: 'boom' }, 500),
  });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN).send({ customerId: 10 });
  assert.equal(res.status, 503);
  assert.match(res.body.error, /^No se pudo subir a Operam: /);
  assert.equal(res.body.customer_id, 10);
  assert.equal(res.body.steps.at(-1).name, 'POST quote');
  assert.equal(res.body.steps.at(-1).status, 'error');
});

// --- Entrada unica (#528): la rama actualizar por la ruta de crear -------------
// Con folio y marca, POST /api/cotizacion/operam/:id actualiza y responde
// EXACTAMENTE lo que responde /actualizar, mas `operacion: 'actualizar'`. Se
// compara contra la otra ruta sobre una cotizacion gemela. Los casos que piden la
// web legacy (lograda y escrita sin verificar) viven junto a su doble, en
// test/server.test.js.

const MARCA_528 = { fecha: '2026-10-04T10:00:00.000Z', pendiente: true };

function marcar(id, extra) {
  const cots = readCots();
  const c = cots.find(x => x.id === id);
  c.data = { ...c.data, ...extra };
  escribirArchivoSync(COTS_PATH, JSON.stringify(cots, null, 2));
}

async function porLasDosRutas(opciones, extra = {}) {
  const viaActualizar = agregarCotizacion(opciones);
  marcar(viaActualizar, extra);
  const viaCrear = agregarCotizacion(opciones);
  marcar(viaCrear, { quoteDesactualizado: MARCA_528, ...extra });
  const actualizar = await supertest(app).post(`/api/cotizacion/operam/${viaActualizar}/actualizar`).set('Authorization', TOKEN);
  const crear = await supertest(app).post(`/api/cotizacion/operam/${viaCrear}`).set('Authorization', TOKEN).send({});
  return { actualizar, crear, viaCrear };
}

test('#528 por la ruta de crear, la no actualizada sin escribir responde lo de /actualizar mas operacion', async () => {
  const { actualizar, crear } = await porLasDosRutas({ folioOperam: '1200', items: [] });
  assert.equal(actualizar.status, 200);
  assert.equal(crear.status, 200);
  assert.equal(crear.body.escrito, false);
  assert.deepEqual(crear.body, { ...actualizar.body, operacion: 'actualizar' });
});

test('#528 por la ruta de crear, el bloqueo con pedido responde el 409 de /actualizar mas operacion y la marca se queda', async () => {
  const { actualizar, crear, viaCrear } = await porLasDosRutas({ folioOperam: '1200' }, { orderOperam: '7077' });
  assert.equal(actualizar.status, 409);
  assert.equal(crear.status, 409);
  assert.deepEqual(crear.body, { ...actualizar.body, operacion: 'actualizar' });
  assert.deepEqual(readCots().find(c => c.id === viaCrear).data.quoteDesactualizado, MARCA_528);
});

test('#528 con folio y sin marca la ruta de crear responde yaSubida como hoy, sin tocar Operam', async () => {
  const id = agregarCotizacion({ folioOperam: '1200', cliente: { customerId: 10 } });
  marcar(id, { quoteDesactualizado: null });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN).send({});
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, folio: '1200', yaSubida: true, customer_id: 10 });
});

// --- Contacto de entrega incompleto (#558) -------------------------------------
// El bloqueo del modulo se traduce a 422 con su codigo, el campo al que va el
// vendedor y el mensaje en dos capas; nunca al 503 de "Operam fallo" (que entrega el
// documento como si reintentar sirviera) ni al 409 de "con pedido" (que ofrece
// Copiar). fetchBloqueado demuestra que no se toco Operam.

test('#558 crear sin telefono del Contacto de entrega responde 422 con codigo, campo y detalle sin tocar Operam', async () => {
  const id = agregarCotizacion({ cliente: { celEntrega: '' } });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN).send({});
  assert.equal(res.status, 422);
  assert.equal(res.body.codigo, 'CONTACTO_ENTREGA_INCOMPLETO');
  assert.equal(res.body.campo, 'cl-cel-entrega');
  assert.match(res.body.error, /tel\u00e9fono del Contacto de entrega/);
  assert.match(res.body.detalle, /celEntrega/);
  assert.equal(readCots().find(c => c.id === id).folioOperam, null);
});

test('#558 Editar sin domicilio de entrega (sin CP): la entrada unica responde 422 con operacion actualizar', async () => {
  const id = agregarCotizacion({ folioOperam: '1200', cliente: { cpEntrega: '' } });
  const cots = readCots();
  cots.find(c => c.id === id).data.quoteDesactualizado = { fecha: '2026-10-04T10:00:00.000Z', pendiente: true };
  escribirArchivoSync(COTS_PATH, JSON.stringify(cots, null, 2));
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN).send({});
  assert.equal(res.status, 422);
  assert.equal(res.body.operacion, 'actualizar');
  assert.equal(res.body.codigo, 'CONTACTO_ENTREGA_INCOMPLETO');
  assert.equal(res.body.campo, 'cl-cp-entrega');
  assert.match(res.body.error, /domicilio de entrega/);
});

test('#557 D3 crear sin el nombre del Contacto de entrega responde 422 con el campo "Entregar a"', async () => {
  const id = agregarCotizacion({ cliente: { nombreEntrega: '' } });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN).send({});
  assert.equal(res.status, 422);
  assert.equal(res.body.codigo, 'CONTACTO_ENTREGA_INCOMPLETO');
  assert.equal(res.body.campo, 'cl-nombre-entrega');
  assert.deepEqual(res.body.faltan, ['sin-nombre-entrega']);
});

test('#558 /actualizar sin telefono del Contacto de entrega responde 422 con codigo', async () => {
  const id = agregarCotizacion({ folioOperam: '1200', cliente: { celEntrega: '' } });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}/actualizar`).set('Authorization', TOKEN);
  assert.equal(res.status, 422);
  assert.equal(res.body.codigo, 'CONTACTO_ENTREGA_INCOMPLETO');
  assert.equal(res.body.campo, 'cl-cel-entrega');
});

test('#558 la Pre-cotizacion no se bloquea: guardar sin telefono ni domicilio de entrega responde 200 y el documento se genera', async () => {
  const guardar = await supertest(app).post('/api/cotizacion').set('Authorization', TOKEN).send({
    fecha: '2026-10-09', vigencia: '2026-11-08', tier: 'M100',
    cliente: { razonSocial: 'Hotel Azul Centro', nombreCorto: 'Hotel Azul', telefono: '+52 5588776655', calle: '', celEntrega: '' },
    items: [{ codigo: 'PV08', descripcion: 'Plato', cantidad: 100, unidad: 'pza', precio: 100, descuento: 0 }],
    subtotal: 10000, iva: 1600, total: 11600, notas: [],
  });
  assert.equal(guardar.status, 200, JSON.stringify(guardar.body));
  const html = await supertest(app).get(`/api/cotizacion/html/${guardar.body.id}`);
  assert.equal(html.status, 200);
  assert.ok(html.text.includes('Hotel Azul Centro'));
});

// --- Contacto de entrega pendiente (#562) --------------------------------------
// La pregunta del General del domicilio viaja en una respuesta 200 (el quote YA esta
// subido) junto al folio, y el cuerpo con el que se reintenta lo dicta el SERVIDOR,
// como en CONFIRMAR_OTRA_RAZON_SOCIAL. D1 (decisiones de Adrian 2026-10-09): una sola
// salida, confirmar; "conservar" se quito.

const MARCA_562 = {
  fecha: '2026-10-09T18:00:00.000Z', clienteId: 15, domicilioId: 564, motivo: 'general-existente',
  contacto: { nombre: 'Lucia Recibe' },
  desplazados: [{ personId: '1289', nombre: 'MEDICION556b General Prueba', roles: ['general'] }],
  mensaje: 'Lucia Recibe queda como contacto General y de Entrega del domicilio de entrega en Operam. MEDICION556b General Prueba deja de ser el contacto General de este domicilio y queda como contacto de Entrega.',
  detalle: 'domicilio 564 del cliente 15: General actual persona 1289; un segundo General no se escribe',
};

function conContactoPendiente() {
  const id = agregarCotizacion({ folioOperam: '1330', cliente: { customerId: 15, nombreEntrega: 'Lucia Recibe' } });
  marcar(id, { contactoEntregaPendiente: MARCA_562 });
  return id;
}

test('#562 con el Contacto de entrega pendiente, la ruta de crear responde yaSubida con la pregunta y el cuerpo de confirmar, sin tocar Operam', async () => {
  const id = conContactoPendiente();
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN).send({});
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    ok: true, folio: '1330', yaSubida: true, customer_id: 15,
    preguntaContacto: {
      codigo: 'CONFIRMAR_DESPLAZAR_GENERAL', mensaje: MARCA_562.mensaje, detalle: MARCA_562.detalle,
      nuevo: 'Lucia Recibe', desplazados: [{ nombre: 'MEDICION556b General Prueba', roles: ['general'] }],
      reintentar: {
        confirmar: { contactoEntrega: { desplazar: ['1289'] } },
      },
    },
  });
});

test('#557 D1 un cuerpo con conservar (pestana con el app.js anterior) no es decision: yaSubida con la pregunta y la marca sigue, sin tocar Operam', async () => {
  const id = conContactoPendiente();
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN).send({ contactoEntrega: { conservar: true } });
  assert.equal(res.status, 200);
  assert.equal(res.body.yaSubida, true);
  assert.equal(res.body.contactoEntrega, undefined);
  assert.equal(res.body.preguntaContacto.codigo, 'CONFIRMAR_DESPLAZAR_GENERAL');
  assert.deepEqual(readCots().find(c => c.id === id).data.contactoEntregaPendiente, MARCA_562);
});

// De punta a punta con el adaptador REAL de la web legacy (paginas medidas del
// domicilio 564): la decision llega al modulo, que crea a la persona, desplaza a la
// 1289 y relee. Una sola sesion web, que se cierra (la relectura de contact_list que
// pide el modulo despues va por la API v3, no por la web legacy).
test('#562 confirmar: el reintento escribe el Contacto de entrega como unico General y desplaza a la 1289 por la web legacy', async () => {
  const id = conContactoPendiente();
  const fa = webDeMentiras({ tabla: CONTACTOS_GENERAL_564 });
  globalThis.fetch = fa.fetch;
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN).send({ contactoEntrega: { desplazar: ['1289'] } });
  assert.equal(res.status, 200);
  assert.equal(res.body.contactoEntrega, true);
  assert.deepEqual(res.body.steps.map(s => [s.name, s.status]), [['contacto de entrega', 'ok']]);
  assert.match(res.body.steps[0].mensaje, /MEDICION556b General Prueba dejo de ser General y quedo como contacto de Entrega/);
  const update = fa.pedidos.find(p => p.params.has('contactsUPDATE[1289]'));
  assert.deepEqual(update.params.getAll('assgn[]'), ['4']);
  assert.match(update.params.get('notes'), /^medicion 556b, borrar\n\d{4}-\d{2}-\d{2}: deja de ser el contacto General de este domicilio; lo reemplaza Lucia Recibe desde la Cotizaci\u00f3n 1330\.$/);
  assert.match(fa.pedidos.filter(p => !p.url.includes('/api/v3/')).at(-1).url, /\/access\/logout\.php$/);
  assert.equal(readCots().find(c => c.id === id).data.contactoEntregaPendiente, null);
});

// D6 (decisiones de Adrian 2026-10-09): con el interruptor CONTACTOS_OPERAM_ESCRITURA
// ausente (= apagado) o sin el Cliente Operam de la marca (el 15) en su lista, la
// pregunta pendiente no se sirve ni se atiende: yaSubida a secas, sin tocar la web
// legacy, y la marca se queda para cuando se encienda.
for (const [caso, valor] of [['ausente', undefined], ['con otra lista (376)', '376']]) {
  test(`#557 D6 interruptor ${caso}: yaSubida sin la pregunta, la confirmacion se ignora y la marca se queda`, async () => {
    const restaurar = fijarInterruptorContactos(valor);
    try {
      const id = conContactoPendiente();
      const fa = webDeMentiras({ tabla: CONTACTOS_GENERAL_564 });
      globalThis.fetch = fa.fetch;
      const sinDecision = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN).send({});
      assert.deepEqual(sinDecision.body, { ok: true, folio: '1330', yaSubida: true, customer_id: 15 });
      const confirmada = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN).send({ contactoEntrega: { desplazar: ['1289'] } });
      assert.deepEqual(confirmada.body, { ok: true, folio: '1330', yaSubida: true, customer_id: 15 });
      assert.deepEqual(fa.pedidos, [], 'no se abrio la web legacy');
      assert.deepEqual(readCots().find(c => c.id === id).data.contactoEntregaPendiente, MARCA_562);
    } finally {
      restaurar();
    }
  });
}

// --- #563: la pregunta por los datos de la persona elegida ---------------------
// Mismo canal que #562: la marca, la pregunta junto al folio y los cuerpos de
// reintento que dicta el servidor. Con casillas que se pisarian, cada una viaja con su
// valor viejo y el nuevo, y `confirmar` lleva lo que se pregunto (el modulo lo revalida).
const MARCA_563 = {
  fecha: '2026-10-09T18:00:00.000Z', clienteId: '15', domicilioId: '564', motivo: 'pisa-datos',
  contacto: { nombre: 'Lucia Recibe' }, persona: { personId: '1249', nombre: 'Adrian Bosques Nombre' },
  desplazados: [{ personId: '1289', nombre: 'MEDICION556b General Prueba', roles: ['general'] }],
  pisa: [
    { personId: '1249', campo: 'telefono', viejo: '55 8888 0000', nuevo: '5512345678' },
    { personId: '1249', campo: 'secundario', viejo: '55 7777 0000', nuevo: '55 8888 0000', pierde: true },
  ],
  mensaje: 'Se cambian datos que Adrian Bosques Nombre ya tenia en Operam.', detalle: 'persona 1249',
};

test('#563 con casillas que se pisarian, yaSubida trae cada una con su valor viejo y el nuevo y confirmar lleva lo que se pregunto', async () => {
  const id = agregarCotizacion({ folioOperam: '1330', cliente: { customerId: 15, nombreEntrega: 'Lucia Recibe' } });
  marcar(id, { contactoEntregaPendiente: MARCA_563 });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN).send({});
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.preguntaContacto, {
    codigo: 'CONFIRMAR_PISAR_CONTACTO', mensaje: MARCA_563.mensaje, detalle: MARCA_563.detalle,
    nuevo: 'Adrian Bosques Nombre', desplazados: [{ nombre: 'MEDICION556b General Prueba', roles: ['general'] }],
    pisa: [
      { campo: 'telefono', viejo: '55 8888 0000', nuevo: '5512345678' },
      { campo: 'secundario', viejo: '55 7777 0000', nuevo: '55 8888 0000', pierde: true },
    ],
    reintentar: {
      confirmar: { contactoEntrega: { desplazar: ['1289'], pisar: [{ personId: '1249', campo: 'telefono', viejo: '55 8888 0000' }, { personId: '1249', campo: 'secundario', viejo: '55 7777 0000' }] } },
    },
  });
});

// D4 (decisiones de Adrian 2026-10-09): la pregunta del cambio de celular lleva `numero`
// (lo que se moveria en el cotizador) y el servidor dicta la confirmacion con el numero
// viejo; con telefono compartido dicta ademas la otra salida, que confirma Operam sin
// mover nada en el cotizador (`mover: false`).
const NUMERO_565 = {
  viejo: '55 8888 0000', nuevo: '5512345678', contactoViejo: true, oportunidades: 3, cotizaciones: 2,
  otrasPersonas: ['Pedro Lopez'], cotizacionesDeOtras: 1, compartido: true, mover: true,
};
const MARCA_NUMERO = {
  ...MARCA_563, desplazados: [], numero: NUMERO_565,
  pisa: [{ personId: '1249', campo: 'cel', viejo: '55 8888 0000', nuevo: '5512345678' }],
};

test('#557 D4 telefono compartido: la pregunta trae el numero y el servidor dicta las dos confirmaciones, una sin mover nada en el cotizador', async () => {
  const id = agregarCotizacion({ folioOperam: '1330', cliente: { customerId: 15, nombreEntrega: 'Lucia Recibe' } });
  marcar(id, { contactoEntregaPendiente: MARCA_NUMERO });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN).send({});
  assert.equal(res.status, 200);
  const p = res.body.preguntaContacto;
  assert.deepEqual(p.numero, NUMERO_565);
  const pisar = [{ personId: '1249', campo: 'cel', viejo: '55 8888 0000' }];
  assert.deepEqual(p.reintentar, {
    confirmar: { contactoEntrega: { desplazar: [], pisar, numero: { viejo: '55 8888 0000', mover: true } } },
    soloOperam: { contactoEntrega: { desplazar: [], pisar, numero: { viejo: '55 8888 0000', mover: false } } },
  });
});

test('#557 D4 caso simple: una sola confirmacion, con el numero viejo y lo que dice la Subida que hace (mover)', async () => {
  const id = agregarCotizacion({ folioOperam: '1330', cliente: { customerId: 15, nombreEntrega: 'Lucia Recibe' } });
  marcar(id, { contactoEntregaPendiente: { ...MARCA_NUMERO, numero: { ...NUMERO_565, otrasPersonas: [], compartido: false, mover: false } } });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN).send({});
  assert.deepEqual(Object.keys(res.body.preguntaContacto.reintentar), ['confirmar']);
  assert.deepEqual(res.body.preguntaContacto.reintentar.confirmar.contactoEntrega.numero, { viejo: '55 8888 0000', mover: false });
});

// La persona elegida en el selector viaja con la cotizacion: el guardado la conserva y
// Editar (GET /api/cotizaciones/:id) la devuelve, para que el navegador la reponga y la
// actualizacion edite a ESA persona.
test('#563 el person_id de la persona elegida se guarda con la cotizacion y Editar lo devuelve', async () => {
  const guardar = await supertest(app).post('/api/cotizacion').set('Authorization', TOKEN).send({
    fecha: '2026-10-09', vigencia: '2026-11-08', tier: 'M100',
    cliente: { razonSocial: 'Hotel Azul Centro', nombreCorto: 'Hotel Azul', telefono: '+52 5588776655', calle: 'Av. Juarez 45', cpEntrega: '56530', nombreEntrega: 'Lucia Recibe', celEntrega: '5512345678', contactoEntregaPersonId: '1249' },
    items: [{ codigo: 'PV08', descripcion: 'Plato', cantidad: 100, unidad: 'pza', precio: 100, descuento: 0 }],
    subtotal: 10000, iva: 1600, total: 11600, notas: [],
  });
  assert.equal(guardar.status, 200, JSON.stringify(guardar.body));
  const editar = await supertest(app).get(`/api/cotizaciones/${guardar.body.id}`).set('Authorization', TOKEN);
  assert.equal(editar.status, 200);
  assert.equal(editar.body.cliente.contactoEntregaPersonId, '1249');
});
