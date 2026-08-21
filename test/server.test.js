import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, unlinkSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { handlersWebFichaCliente } from './helpers/ficha-cliente-web.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const COTS_PATH = join(DATA_DIR, 'cotizaciones.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

// PDFKit codifica el contenido en hex dentro de operadores TJ (con kern-split);
// _compress:false vuelve el content stream legible pero solo buscable en hex
// (mismo patron que test/pdf-generator.test.js).
function toHex(s) {
  return Buffer.from(s, 'latin1').toString('hex');
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app, cargarListasPrecios, obtenerListasPrecios, _resetListasPrecios, _setEnfriamientoListasMs } = await import('../server.js');
const { _resetSesionWeb } = await import('../lib/operam-web.js');
const TEST_TOKEN = jwt.sign({ id: 99, name: 'Tester', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

function readCots() {
  if (!existsSync(COTS_PATH)) return [];
  return JSON.parse(leerArchivoSync(COTS_PATH));
}

function writeCots(data) {
  escribirArchivoSync(COTS_PATH, JSON.stringify(data, null, 2));
}

let savedCots;
before(() => { savedCots = readCots(); });
after(() => { writeCots(savedCots); });

test('B1: POST /api/cotizacion persiste cliente.pais', async () => {
  const snap = readCots();
  const body = {
    fecha: '2026-01-01', vigencia: '2026-02-01', tier: 'Mayoreo',
    cliente: { razonSocial: 'Test SA', nombreCorto: 'Test', pais: 'US', telefono: '+1 5551234567' },
    items: [{ codigo: 'TEST', descripcion: 'Test', cantidad: 1, unidad: 'pza', precio: 100, descuento: 0 }],
    subtotal: 100, iva: 16, total: 116, notas: [],
  };
  await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TEST_TOKEN}`).send(body);
  const cots = readCots();
  assert.ok(cots.length > snap.length);
  assert.strictEqual(cots[cots.length - 1].data.cliente.pais, 'US');
  assert.strictEqual(cots[cots.length - 1].vendedor, 'Tester');
});

test('#87: POST /api/login emite un JWT con vigencia de 24 horas', async () => {
  const res = await supertest(app).post('/api/login').send({ vendedorId: 2, pin: '9992' });
  assert.strictEqual(res.status, 200);
  const decoded = jwt.decode(res.body.token);
  assert.strictEqual(decoded.exp - decoded.iat, 24 * 3600);
});

test('B1b: POST /api/cotizacion sin telefono retorna 400 (bloqueo duro)', async () => {
  const snap = readCots();
  const body = {
    fecha: '2026-01-01', tier: 'Mayoreo',
    cliente: { razonSocial: 'Test SA' },
    items: [{ codigo: 'TEST', descripcion: 'Test', cantidad: 1, unidad: 'pza', precio: 100, descuento: 0 }],
    subtotal: 100, iva: 16, total: 116, notas: [],
  };
  const res = await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TEST_TOKEN}`).send(body);
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /tel.fono/i);
  assert.strictEqual(readCots().length, snap.length);
});

test('B1c: POST /api/cotizacion con telefono sin codigo de pais retorna 400', async () => {
  const body = {
    fecha: '2026-01-01', tier: 'Mayoreo',
    cliente: { razonSocial: 'Test SA', telefono: '5512345678' },
    items: [{ codigo: 'TEST', descripcion: 'Test', cantidad: 1, unidad: 'pza', precio: 100, descuento: 0 }],
    subtotal: 100, iva: 16, total: 116, notas: [],
  };
  const res = await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TEST_TOKEN}`).send(body);
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /c.digo de pa.s/i);
});

// La reja del servidor y la del navegador son espejo a proposito: si el vendedor
// logra capturar el numero en el formulario, guardar no puede tronar despues.
test('#175: POST /api/cotizacion acepta un telefono internacional de 10 digitos', async () => {
  const snap = readCots();
  const body = {
    fecha: '2026-01-01', tier: 'Mayoreo',
    cliente: { razonSocial: 'Francys Falcon', telefono: '+297 563 3917' },
    items: [{ codigo: 'TEST', descripcion: 'Test', cantidad: 1, unidad: 'pza', precio: 100, descuento: 0 }],
    subtotal: 100, iva: 16, total: 116, notas: [],
  };
  const res = await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TEST_TOKEN}`).send(body);
  assert.strictEqual(res.status, 200);
  assert.ok(readCots().length > snap.length);
  // Se restaura el archivo: otros tests de esta suite derivan el id de la
  // LONGITUD de cotizaciones.json (ej. #111-1), asi que dejar un registro de
  // mas les cambia el id bajo los pies y los vuelve flaky.
  writeCots(snap);
});

test('B1d: POST /api/cotizacion sin telefono valido retorna 400', async () => {
  const body = {
    fecha: '2026-01-01', tier: 'Mayoreo',
    cliente: { razonSocial: 'Test SA', telefono: '123' },
    items: [{ codigo: 'TEST', descripcion: 'Test', cantidad: 1, unidad: 'pza', precio: 100, descuento: 0 }],
    subtotal: 100, iva: 16, total: 116, notas: [],
  };
  const res = await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TEST_TOKEN}`).send(body);
  assert.strictEqual(res.status, 400);
});

test('B2: GET /api/cotizaciones/:id sin campo pais no falla', async () => {
  const snap = readCots();
  const id = snap.length + 1;
  writeCots([...snap, { id, fecha: new Date().toISOString(), vendedor: 'Tester', cliente: 'Sin nombre', totalPiezas: 0, total: 0, tier: '', data: { cliente: { razonSocial: 'Sin pais' }, items: [] } }]);
  const res = await supertest(app).get(`/api/cotizaciones/${id}`).set('Authorization', `Bearer ${TEST_TOKEN}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.cliente);
});

// === #102: envio estructurado {carrier, servicio, precio} persiste en data
// y se lee de vuelta tal cual (Cargar desde historial lo restaura sin re-cotizar).
test('#102-1: POST /api/cotizacion persiste data.envio estructurado', async () => {
  const body = {
    fecha: '2026-01-01', vigencia: '2026-02-01', tier: 'Mayoreo',
    cliente: { razonSocial: 'Test SA', nombreCorto: 'Test', telefono: '+52 5551234567' },
    items: [{ codigo: 'TEST', descripcion: 'Test', cantidad: 1, unidad: 'pza', precio: 100, descuento: 0 }],
    subtotal: 100, iva: 16, total: 116, notas: [],
    envio: { opcion: 'envia', carrier: 'fedex', servicio: 'ground', precio: 259, descripcion: 'FedEx Ground' },
  };
  const res = await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TEST_TOKEN}`).send(body);
  const id = res.body.id;
  const get = await supertest(app).get(`/api/cotizaciones/${id}`).set('Authorization', `Bearer ${TEST_TOKEN}`);
  assert.deepStrictEqual(get.body.envio, { opcion: 'envia', carrier: 'fedex', servicio: 'ground', precio: 259, descripcion: 'FedEx Ground' });
});

// === #109: el aviso de modo actualizacion necesita el folio REAL de Operam
// (no el id interno) sin que la vista de cotizacion lo adivine ni haga una
// peticion extra. El listado ya lo exponia; el detalle (que es lo que
// cargarCotizacion consume) no. Se agrega folioOperam al detalle, tomandolo
// de la columna de primer nivel del registro (no de data, que no lo contiene).
test('#109-1: GET /api/cotizaciones/:id incluye folioOperam (columna de primer nivel, no vive en data)', async () => {
  const snap = readCots();
  const id = snap.length + 1;
  writeCots([...snap, {
    id, fecha: new Date().toISOString(), vendedor: 'Tester', cliente: 'Con folio',
    totalPiezas: 0, total: 0, tier: '', folioOperam: '1200',
    data: { cliente: { razonSocial: 'Con folio' }, items: [] },
  }]);
  const res = await supertest(app).get(`/api/cotizaciones/${id}`).set('Authorization', `Bearer ${TEST_TOKEN}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.folioOperam, '1200');
});

test('#109-2: GET /api/cotizaciones/:id sin folioOperam (PRE) lo expone como null, no undefined', async () => {
  const snap = readCots();
  const id = snap.length + 1;
  writeCots([...snap, {
    id, fecha: new Date().toISOString(), vendedor: 'Tester', cliente: 'Sin folio',
    totalPiezas: 0, total: 0, tier: '',
    data: { cliente: { razonSocial: 'Sin folio' }, items: [] },
  }]);
  const res = await supertest(app).get(`/api/cotizaciones/${id}`).set('Authorization', `Bearer ${TEST_TOKEN}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.folioOperam, null);
});

test('#102-2: GET /api/cotizaciones/:id de un registro viejo sin data.envio no rompe (degrada con gracia)', async () => {
  const snap = readCots();
  const id = snap.length + 1;
  writeCots([...snap, { id, fecha: new Date().toISOString(), vendedor: 'Tester', cliente: 'Sin envio', totalPiezas: 0, total: 0, tier: '', data: { cliente: { razonSocial: 'Sin envio' }, items: [{ codigo: 'ENVIO', descripcion: 'FedEx Ground', cantidad: 1, unidad: 'ACT', precio: 259, descuento: 0 }] } }]);
  const res = await supertest(app).get(`/api/cotizaciones/${id}`).set('Authorization', `Bearer ${TEST_TOKEN}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.envio, undefined);
});

// === #103: los GET de pdf/html regeneran desde data (columna jsonb), nunca
// desde disco (el disco de Render es efimero: muere en cada deploy). Sin
// authMiddleware a proposito (se comparten por WhatsApp).
test('#103-1: GET /api/cotizacion/pdf/:id regenera el PDF desde data del registro guardado', async () => {
  const snap = readCots();
  const id = snap.length + 1;
  writeCots([...snap, {
    id, fecha: new Date().toISOString(), vendedor: 'Tester', cliente: 'Cliente Regenerado',
    totalPiezas: 1, total: 116, tier: 'Mayoreo',
    data: {
      _compress: false,
      cliente: { razonSocial: 'Cliente Regenerado SA de CV', nombreCorto: 'Cliente Regenerado' },
      items: [{ codigo: 'TEST103', descripcion: 'Producto de prueba 103', cantidad: 1, unidad: 'pza', precio: 100, descuento: 0 }],
      subtotal: 100, iva: 16, total: 116, notas: [],
    },
  }]);
  const res = await supertest(app).get(`/api/cotizacion/pdf/${id}`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers['content-type'], /application\/pdf/);
  const texto = Buffer.from(res.body).toString('latin1');
  assert.ok(texto.includes(toHex('Regen')));
  assert.ok(texto.includes(toHex('TEST103')));
});

test('#103-2: GET /api/cotizacion/pdf/:id de un id inexistente da 404', async () => {
  const res = await supertest(app).get('/api/cotizacion/pdf/999999');
  assert.strictEqual(res.status, 404);
});

test('#103-3: GET /api/cotizacion/pdf/:id regenera igual aunque el archivo de disco ya no exista (disco efimero de Render)', async () => {
  const snap = readCots();
  const id = snap.length + 1;
  writeCots([...snap, {
    id, fecha: new Date().toISOString(), vendedor: 'Tester', cliente: 'Sin Disco',
    totalPiezas: 1, total: 116, tier: 'Mayoreo',
    data: {
      _compress: false,
      cliente: { razonSocial: 'Sin Disco SA', nombreCorto: 'Sin Disco' },
      items: [{ codigo: 'NODISK', descripcion: 'No depende de disco', cantidad: 1, unidad: 'pza', precio: 100, descuento: 0 }],
      subtotal: 100, iva: 16, total: 116, notas: [],
    },
  }]);
  const pdfPath = join(DATA_DIR, 'pdfs', `cot_${id}.pdf`);
  if (existsSync(pdfPath)) unlinkSync(pdfPath);
  const res = await supertest(app).get(`/api/cotizacion/pdf/${id}`);
  assert.strictEqual(res.status, 200);
  assert.ok(Buffer.from(res.body).toString('latin1').includes(toHex('NODISK')));
});

test('#103-4: GET /api/cotizacion/html/:id regenera el HTML desde data del registro guardado', async () => {
  const snap = readCots();
  const id = snap.length + 1;
  writeCots([...snap, {
    id, fecha: new Date().toISOString(), vendedor: 'Tester', cliente: 'Cliente HTML',
    totalPiezas: 1, total: 116, tier: 'Mayoreo',
    data: {
      cliente: { razonSocial: 'Cliente HTML SA de CV', nombreCorto: 'Cliente HTML' },
      items: [{ codigo: 'HTML103', descripcion: 'Producto HTML 103', cantidad: 1, unidad: 'pza', precio: 100, descuento: 0 }],
      subtotal: 100, iva: 16, total: 116, notas: [],
    },
  }]);
  const res = await supertest(app).get(`/api/cotizacion/html/${id}`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.ok(res.text.includes('Cliente HTML SA de CV'));
  // El numero ya no es el id interno (ADR-0009): este registro no tiene folio de
  // Operam, asi que el documento sale sin numero. La asercion vieja (`#id`) fijaba
  // justo la doble numeracion que #110/#111 cierran.
  assert.ok(!res.text.includes('qm-val quote-num'));
});

test('#103-5: GET /api/cotizacion/html/:id de un id inexistente da 404', async () => {
  const res = await supertest(app).get('/api/cotizacion/html/999999');
  assert.strictEqual(res.status, 404);
});

// === #110 / #111 (ADR-0009): el numero de la cotizacion ES el folio de Operam.
// Los dos GET son el UNICO lugar que genera documento, y un solo punto decide el
// numero: el mismo registro tiene que salir con el MISMO numero en PDF y en HTML.
// Antes cada camino decidia por su cuenta (el PDF no imprimia ninguno; el HTML
// imprimia el id interno), que es la doble numeracion que el ADR viene a cerrar.
function registroConFolio(id, folioOperam) {
  return {
    id, fecha: new Date().toISOString(), vendedor: 'Tester', cliente: 'Cliente Folio',
    totalPiezas: 1, total: 116, tier: 'Mayoreo', folioOperam,
    data: {
      _compress: false,
      cliente: { razonSocial: 'Cliente Folio SA de CV', nombreCorto: 'Cliente Folio' },
      items: [{ codigo: 'FOLIO110', descripcion: 'Producto folio', cantidad: 1, unidad: 'pza', precio: 100, descuento: 0 }],
      subtotal: 100, iva: 16, total: 116, notas: [],
    },
  };
}

test('#110-1: el PDF y el HTML del mismo registro muestran el MISMO numero, y es el folio de Operam', async () => {
  const snap = readCots();
  const id = snap.length + 1;
  writeCots([...snap, registroConFolio(id, '57310')]);

  const pdf = await supertest(app).get(`/api/cotizacion/pdf/${id}`);
  const html = await supertest(app).get(`/api/cotizacion/html/${id}`);
  assert.strictEqual(pdf.status, 200);
  assert.strictEqual(html.status, 200);

  const textoPdf = Buffer.from(pdf.body).toString('latin1');
  assert.ok(textoPdf.includes(toHex('57310')), 'el PDF imprime el folio de Operam');
  assert.ok(html.text.includes('57310'), 'el HTML imprime el folio de Operam');
  // Y ninguno de los dos presenta el id interno como numero de cotizacion.
  assert.ok(!textoPdf.includes(toHex(`No. Cotizacion: ${id}`)), 'el PDF no numera con el id interno');
  assert.ok(!html.text.includes(`Cotizacion #${id}`), 'el HTML no numera con el id interno');
});

// Una PRE no tiene folio por definicion (#63) y no inventa numero (ADR-0009):
// el documento sale sin numero y se identifica como pre-cotizacion, para que
// nadie lo confunda con una cotizacion registrada en el ERP.
test('#111-1: sin folio de Operam el documento no lleva numero y se identifica como pre-cotizacion', async () => {
  const snap = readCots();
  const id = snap.length + 1;
  writeCots([...snap, registroConFolio(id, null)]);

  const pdf = await supertest(app).get(`/api/cotizacion/pdf/${id}`);
  const html = await supertest(app).get(`/api/cotizacion/html/${id}`);
  const textoPdf = Buffer.from(pdf.body).toString('latin1');
  // PDFKit kern-splita el titulo tras "PRE-CO" y el meta tras "Cotizacion:";
  // esos son los prefijos contiguos fiables (mismo criterio que B6/B14).
  assert.ok(textoPdf.includes(toHex('PRE-CO')), 'el PDF se identifica como pre-cotizacion');
  assert.ok(!textoPdf.includes(toHex('Cotizacion:')), 'el PDF no imprime la linea del numero');
  assert.ok(html.text.includes('PRE-COTIZACION'), 'el HTML se identifica como pre-cotizacion');
  assert.ok(!html.text.includes('qm-val quote-num'), 'el HTML no pinta la fila del numero');
  assert.ok(!html.text.includes('Cotizacion Peltre Nacional #'), 'el HTML no titula con ningun numero');
});

// El nombre del archivo se arma en UN solo lugar (el Content-Disposition del GET,
// ADR-0009) y por folio; app.js ya no lo arma por su cuenta. La descarga del
// vendedor pide ?descargar=1 (attachment); compartir por WhatsApp abre el mismo
// documento inline.
test('#111-2: el Content-Disposition nombra el archivo por folio y respeta ?descargar=1', async () => {
  const snap = readCots();
  const conFolio = snap.length + 1;
  const sinFolio = snap.length + 2;
  writeCots([...snap, registroConFolio(conFolio, '57310'), registroConFolio(sinFolio, null)]);

  const descarga = await supertest(app).get(`/api/cotizacion/pdf/${conFolio}?descargar=1`);
  assert.strictEqual(descarga.headers['content-disposition'], 'attachment; filename="Cotizacion_PeltreNacional_57310.pdf"');

  const compartir = await supertest(app).get(`/api/cotizacion/pdf/${conFolio}`);
  assert.strictEqual(compartir.headers['content-disposition'], 'inline; filename="Cotizacion_PeltreNacional_57310.pdf"');

  const pre = await supertest(app).get(`/api/cotizacion/pdf/${sinFolio}?descargar=1`);
  assert.strictEqual(pre.headers['content-disposition'], 'attachment; filename="PreCotizacion_PeltreNacional.pdf"');
});

// Guardar y generar dejan de ser la misma operacion (ADR-0009): el POST solo
// guarda el registro (y dice si ya hay folio), y los GET son el unico generador.
// Los dos POST por formato (/pdf y /html) desaparecen: eran dos de los cuatro
// caminos que decidian por separado que numero llevaba el documento.
test('#111-3: POST /api/cotizacion guarda el registro y devuelve id y folioOperam, sin generar documento', async () => {
  const snap = readCots();
  const body = {
    fecha: '2026-01-01', vigencia: '2026-02-01', tier: 'Mayoreo',
    cliente: { razonSocial: 'Guardar SA', nombreCorto: 'Guardar', telefono: '+52 5551234567' },
    items: [{ codigo: 'GUARDA', descripcion: 'Guardar', cantidad: 1, unidad: 'pza', precio: 100, descuento: 0 }],
    subtotal: 100, iva: 16, total: 116, notas: [],
  };
  const res = await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TEST_TOKEN}`).send(body);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers['content-type'], /application\/json/);
  const cots = readCots();
  assert.strictEqual(cots.length, snap.length + 1);
  const guardada = cots[cots.length - 1];
  assert.strictEqual(res.body.id, guardada.id);
  assert.strictEqual(res.body.folioOperam, null, 'una cotizacion recien guardada todavia no tiene folio');
  assert.strictEqual(guardada.data.cliente.nombreCorto, 'Guardar');
  assert.strictEqual(guardada.vendedor, 'Tester');
});

test('#111-4: POST /api/cotizacion hereda el bloqueo por telefono invalido (400, sin guardar)', async () => {
  const snap = readCots();
  const res = await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TEST_TOKEN}`).send({
    fecha: '2026-01-01', tier: 'Mayoreo', cliente: { razonSocial: 'Sin tel SA' },
    items: [], subtotal: 0, iva: 0, total: 0, notas: [],
  });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /tel.fono/i);
  assert.strictEqual(readCots().length, snap.length);
});

test('#111-5: POST /api/cotizacion sobre un registro con folio lo devuelve (modo actualizacion no re-numera)', async () => {
  const snap = readCots();
  const id = snap.length + 1;
  writeCots([...snap, registroConFolio(id, '57310')]);
  const res = await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TEST_TOKEN}`).send({
    cotizacionId: id, fecha: '2026-01-01', vigencia: '2026-02-01', tier: 'Mayoreo',
    cliente: { razonSocial: 'Cliente Folio SA de CV', telefono: '+52 5551234567' },
    items: [], subtotal: 0, iva: 0, total: 0, notas: [],
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.id, id, 'reusa el mismo registro');
  assert.strictEqual(res.body.folioOperam, '57310', 'devuelve el folio ya existente');
});

test('#111-6: los POST por formato ya no existen: generar documento es solo de los GET', async () => {
  const body = { fecha: '2026-01-01', tier: 'Mayoreo', cliente: { razonSocial: 'X', telefono: '+52 5551234567' }, items: [], subtotal: 0, iva: 0, total: 0, notas: [] };
  const pdf = await supertest(app).post('/api/cotizacion/pdf').set('Authorization', `Bearer ${TEST_TOKEN}`).send(body);
  const html = await supertest(app).post('/api/cotizacion/html').set('Authorization', `Bearer ${TEST_TOKEN}`).send(body);
  assert.strictEqual(pdf.status, 404);
  assert.strictEqual(html.status, 404);
});

test('#103-6: GET /api/cotizaciones expone hasData (no hasPdf) para decidir si hay algo que regenerar', async () => {
  const snap = readCots();
  const id = snap.length + 1;
  writeCots([...snap, {
    id, fecha: new Date().toISOString(), vendedor: 'Tester', cliente: 'Con Data',
    totalPiezas: 1, total: 116, tier: 'Mayoreo',
    data: { cliente: { razonSocial: 'Con Data SA' }, items: [] },
  }]);
  const res = await supertest(app).get('/api/cotizaciones').set('Authorization', `Bearer ${TEST_TOKEN}`);
  const entry = res.body.find(c => c.id === id);
  assert.ok(entry);
  assert.strictEqual(entry.hasData, true);
  assert.strictEqual(entry.hasPdf, undefined);
});

// #147: el listado expone nombre corto y contacto de entrega desde el detalle
// persistido, para que filtrarCotizaciones (public/js/cotizaciones-logica.js)
// amplie el matching del buscador del Historial mas alla de razon social/folio.
test('#147-1: GET /api/cotizaciones expone nombreCorto y contactoEntrega desde data.cliente', async () => {
  const snap = readCots();
  const id = snap.length + 1;
  writeCots([...snap, {
    id, fecha: new Date().toISOString(), vendedor: 'Tester', cliente: 'Hotel Azul Centro SA de CV',
    totalPiezas: 1, total: 116, tier: 'Mayoreo',
    data: { cliente: { razonSocial: 'Hotel Azul Centro SA de CV', nombreCorto: 'Hotel Azul', contactoEntrega: 'Mariana Gutierrez' }, items: [] },
  }]);
  const res = await supertest(app).get('/api/cotizaciones').set('Authorization', `Bearer ${TEST_TOKEN}`);
  const entry = res.body.find(c => c.id === id);
  assert.ok(entry);
  assert.strictEqual(entry.nombreCorto, 'Hotel Azul');
  assert.strictEqual(entry.contactoEntrega, 'Mariana Gutierrez');
});

test('#147-2: GET /api/cotizaciones sin data expone nombreCorto y contactoEntrega como null (no rompe)', async () => {
  const snap = readCots();
  const id = snap.length + 1;
  writeCots([...snap, {
    id, fecha: new Date().toISOString(), vendedor: 'Tester', cliente: 'Historica',
    totalPiezas: 1, total: 50, tier: 'Menudeo',
  }]);
  const res = await supertest(app).get('/api/cotizaciones').set('Authorization', `Bearer ${TEST_TOKEN}`);
  const entry = res.body.find(c => c.id === id);
  assert.ok(entry);
  assert.strictEqual(entry.nombreCorto, null);
  assert.strictEqual(entry.contactoEntrega, null);
});

test('B4: POST /api/cotizacion/envio usa paisDestino en destination.country', async () => {
  let capturedPayload = null;
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.ENVIA_API_KEY;
  process.env.ENVIA_API_KEY = 'test-key';
  globalThis.fetch = async (url, opts) => { capturedPayload = JSON.parse(opts.body); return { ok: true, json: async () => ({ data: [] }) }; };
  try {
    await supertest(app).post('/api/cotizacion/envio').set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ cpDestino: '90210', paisDestino: 'US', items: [{ codigo: 'PV08', cantidad: 1 }], totalConIVA: 100 });
    assert.ok(capturedPayload !== null);
    assert.strictEqual(capturedPayload.destination.country, 'US');
  } finally {
    globalThis.fetch = originalFetch;
    process.env.ENVIA_API_KEY = originalApiKey;
  }
});

// #88: el tiempo estimado de entrega debe propagarse desde el shape REAL de
// api.envia.com/ship/rate/ (documentado en vivo 2026-07-13, FedEx ground,
// destino CP 78000 San Luis Potosi) hasta lo que consume el render en app.js:
// los campos reales son deliveryEstimate y deliveryDate (rate.days no existe
// en la respuesta real). El backend reenvia las tarifas sin filtrar campos --
// este test fija ese contrato para que un futuro "saneo" de campos no los tire.
test('B5 (#88): POST /api/cotizacion/envio propaga deliveryEstimate y deliveryDate del shape real de envia.com', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.ENVIA_API_KEY;
  process.env.ENVIA_API_KEY = 'test-key';
  // Shape real capturado de api.envia.com/ship/rate/ (campos relevantes)
  const rateRealFedex = {
    carrier: 'fedex', carrierDescription: 'FedEx',
    service: 'ground', serviceDescription: 'FedEx Nacional Económico',
    deliveryEstimate: '1-2 días',
    deliveryDate: { date: '2026-07-15', dateDifference: 2, timeUnit: 'days', time: '21:00' },
    totalPrice: 259, currency: 'MXN',
  };
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('api.envia.com/ship/rate')) {
      const carrier = JSON.parse(opts.body).shipment.carrier;
      return {
        ok: true,
        json: async () => ({ meta: 'rate', data: carrier === 'fedex' ? [rateRealFedex] : [] }),
      };
    }
    throw new Error('Unmocked fetch: ' + u);
  };
  try {
    const res = await supertest(app).post('/api/cotizacion/envio').set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ cpDestino: '78000', paisDestino: 'MX', items: [{ codigo: 'PV08', cantidad: 1 }], totalConIVA: 100 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.rates.length, 1);
    const rate = res.body.rates[0];
    assert.strictEqual(rate.deliveryEstimate, '1-2 días');
    assert.strictEqual(rate.deliveryDate.dateDifference, 2);
    assert.strictEqual(rate.totalPrice, 259);
    assert.strictEqual(rate.days, undefined);
    // #136: serviceDescription tambien debe pasar sin filtrar -- es el campo
    // que arma la descripcion literal de la partida ENVIO en el cliente.
    assert.strictEqual(rate.serviceDescription, 'FedEx Nacional Económico');
  } finally {
    globalThis.fetch = originalFetch;
    process.env.ENVIA_API_KEY = originalApiKey;
  }
});

function mockOperamFetch(handlers) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    for (const [pat, fn] of Object.entries(handlers)) {
      if (u.includes(pat)) return fn(u, opts);
    }
    throw new Error('Unmocked fetch: ' + u);
  };
  return () => { globalThis.fetch = original; };
}

// === POST /api/crear-cliente + Dropbox (#24) ===

test('POST /api/crear-cliente con pdf_base64: fallo Dropbox no rompe respuesta 200', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return { ok: true, json: async () => ({ result: true, customer_id: 88 }) };
      if (u.includes('/88')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 188 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/188': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ tax_id: 'DRB010101ABC', CustName: 'Dropbox Test SA', pdf_base64: 'AAAA',
              entrega: { br_name: 'DRB', br_ref: 'DRB', addr_street: 'Calle', addr_exterior: '1', addr_interior: '', addr_colony: 'Col', addr_city: 'CDMX', addr_state: 'CDMX', addr_zip: '06600', addr_reference: '', phone: '', email: '', pais: 'MX' },
              salesman: 47 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.customer_id, 88);
  } finally {
    restore();
  }
});

// === PUT /api/actualizar-cliente-fiscal/:id (upgrade de CSF, issue #85) ===

const CSF_UPGRADE = {
  rfc: 'REA010101AB1', razonSocial: 'Real SA de CV', idcif: 'IDCIF77',
  calle: 'Reforma', numExt: '100', numInt: '', colonia: 'Juarez',
  cp: '06600', municipio: 'CDMX', estado: 'CDMX', regimenFiscal: '601',
};

// Forma REAL del GET de detalle de Operam (sondeo del cliente 491, #169): el nombre
// vuelve como CustName y el regimen como `regimen`; idcif NO se expone en la lectura.
function clienteRereleido(over = {}) {
  return {
    customer_id: 500, CustName: 'Real SA de CV', tax_id: 'REA010101AB1',
    street: 'Reforma', street_number: '100', suite_number: '', district: 'Juarez',
    postal_code: '06600', city: 'CDMX', state: 'CDMX', regimen: '601', ...over,
  };
}

// El PUT de Operam responde con el ECO de los campos que acepto (#169). `ignora` lista
// las llaves que el mock debe dejar fuera del eco, como hace Operam con lo que rechaza.
function ecoPut(body, ignora = []) {
  const eco = { version: '3.26.32' };
  for (const [k, v] of Object.entries(body)) if (!ignora.includes(k)) eco[k] = v;
  return eco;
}

test('UF1: upgrade feliz -> PUT al mismo customer_id con datos fiscales, sin crear cliente nuevo', async () => {
  let putBody = null, postCalled = false, putId = null;
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { postCalled = true; return { ok: true, json: async () => ({ result: true, customer_id: 999 }) }; }
      if (opts?.method === 'PUT') { putId = u.split('/customers/')[1]; putBody = JSON.parse(opts.body); return { ok: true, json: async () => ecoPut(putBody) }; }
      if (u.includes('tax_id=')) return { ok: true, json: async () => ({ total: 0, data: [] }) };
      return { ok: true, json: async () => ({ data: [clienteRereleido()] }) };
    },
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ csfDatos: CSF_UPGRADE });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.customer_id, 500);
    assert.deepEqual(res.body.camposNoActualizados, []);
    assert.strictEqual(putId, '500', 'PUT sobre el mismo customer_id');
    assert.strictEqual(putBody.tax_id, 'REA010101AB1');
    assert.strictEqual(putBody.cust_name, 'Real SA de CV', 'la razon social se escribe con cust_name (#169)');
    assert.ok(!('CustName' in putBody), 'CustName en el PUT lo ignora Operam en silencio (#169)');
    assert.ok(!('rfc' in putBody), 'el body usa nombres de campo de Operam, no llaves csf');
    assert.strictEqual(postCalled, false, 'NUNCA crea un cliente nuevo');
  } finally {
    restore();
  }
});

test('UF2: RFC real ya existe con OTRO cliente -> 409 freno de fusion, sin PUT', async () => {
  let putCalled = false;
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') { putCalled = true; return { ok: true, json: async () => ({ result: true }) }; }
      if (opts?.method === 'POST') return { ok: true, json: async () => ({ result: true, customer_id: 1 }) };
      if (u.includes('tax_id=')) return { ok: true, json: async () => ({ total: 1, data: [{ customer_id: 800, branches: [{ branch_code: 1 }], CustName: 'Cliente Formal SA', tax_id: 'REA010101AB1' }] }) };
      return { ok: true, json: async () => ({ data: [clienteRereleido()] }) };
    },
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ csfDatos: CSF_UPGRADE });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.fusion, true);
    assert.strictEqual(res.body.cliente.cliente_id, 800);
    assert.strictEqual(res.body.cliente.CustName, 'Cliente Formal SA');
    assert.strictEqual(putCalled, false, 'no toca Operam en escritura cuando frena por fusion');
  } finally {
    restore();
  }
});

test('UF3: PUT que ignora un campo (quirk) -> la relectura lo reporta en camposNoActualizados con el motivo', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      // Operam acepta el resto pero deja cust_name fuera del eco: eso es el rechazo
      if (opts?.method === 'PUT') { const body = JSON.parse(opts.body); return { ok: true, json: async () => ecoPut(body, ['cust_name']) }; }
      if (u.includes('tax_id=')) return { ok: true, json: async () => ({ total: 0, data: [] }) };
      // La relectura muestra el CustName VIEJO (Operam ignoro ese campo en silencio)
      return { ok: true, json: async () => ({ data: [clienteRereleido({ CustName: 'PROSPECTO SIN RAZON SOCIAL' })] }) };
    },
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ csfDatos: CSF_UPGRADE });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.camposNoActualizados.length, 1);
    assert.strictEqual(res.body.camposNoActualizados[0].campo, 'CustName');
    assert.strictEqual(res.body.camposNoActualizados[0].nuevo, 'Real SA de CV');
    assert.match(res.body.camposNoActualizados[0].motivo, /Operam/, 'el vendedor debe recibir el motivo real (#169)');
  } finally {
    restore();
  }
});

test('UF3d: campo que el GET no expone pero el PUT SI confirmo en el eco -> no se reporta como no aplicado (#169)', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') { const body = JSON.parse(opts.body); return { ok: true, json: async () => ecoPut(body) }; }
      if (u.includes('tax_id=')) return { ok: true, json: async () => ({ total: 0, data: [] }) };
      // El GET de detalle de Operam nunca devuelve idcif: la relectura sola lo marcaria
      // como no aplicado aunque el PUT lo haya escrito.
      return { ok: true, json: async () => ({ data: [clienteRereleido()] }) };
    },
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ csfDatos: CSF_UPGRADE });
    assert.strictEqual(res.status, 200);
    assert.deepEqual(res.body.camposNoActualizados, []);
  } finally {
    restore();
  }
});

test('UF3e: el regimen se verifica contra `regimen` (llave real del GET), sin falso rechazo (#169)', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      // El eco NO incluye el regimen: si la verificacion dependiera solo del eco, un
      // regimen ya escrito se reportaria como rechazado.
      if (opts?.method === 'PUT') { const body = JSON.parse(opts.body); return { ok: true, json: async () => ecoPut(body, ['cfdi_regimen_fiscal']) }; }
      if (u.includes('tax_id=')) return { ok: true, json: async () => ({ total: 0, data: [] }) };
      return { ok: true, json: async () => ({ data: [clienteRereleido({ regimen: '601' })] }) };
    },
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ csfDatos: CSF_UPGRADE });
    assert.strictEqual(res.status, 200);
    assert.deepEqual(res.body.camposNoActualizados, []);
  } finally {
    restore();
  }
});

test('UF3b: RFC de la CSF en minusculas SI frena la fusion (gate normaliza a mayusculas)', async () => {
  let putCalled = false;
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') { putCalled = true; return { ok: true, json: async () => ({ result: true }) }; }
      if (u.includes('tax_id=')) {
        assert.ok(u.includes('REA010101AB1'), 'el query a Operam debe ir en mayusculas: ' + u);
        return { ok: true, json: async () => ({ total: 1, data: [{ customer_id: 800, branches: [{ branch_code: 1 }], CustName: 'Cliente Formal SA', tax_id: 'REA010101AB1' }] }) };
      }
      return { ok: true, json: async () => ({ data: [clienteRereleido()] }) };
    },
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ csfDatos: { ...CSF_UPGRADE, rfc: 'rea010101ab1' } });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.fusion, true);
    assert.strictEqual(putCalled, false);
  } finally {
    restore();
  }
});

test('UF3c: PUT exitoso pero la relectura de verificacion falla -> ok:true, NO 503 (el dato SI se escribio)', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') return { ok: true, json: async () => ({ result: true }) };
      if (u.includes('tax_id=')) return { ok: true, json: async () => ({ total: 0, data: [] }) };
      // La relectura post-PUT viene vacia (Operam no devolvio el cliente)
      return { ok: true, json: async () => ({ data: [] }) };
    },
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ csfDatos: CSF_UPGRADE });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.verificacionFallida, true);
  } finally {
    restore();
  }
});

test('UF4: RFC ya existe con el MISMO customer_id (reintento idempotente) -> procede al PUT, no frena', async () => {
  let putCalled = false;
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') { putCalled = true; return { ok: true, json: async () => ({ result: true }) }; }
      if (opts?.method === 'POST') return { ok: true, json: async () => ({ result: true, customer_id: 1 }) };
      if (u.includes('tax_id=')) return { ok: true, json: async () => ({ total: 1, data: [{ customer_id: 500, branches: [{ branch_code: 1 }], CustName: 'Real SA de CV', tax_id: 'REA010101AB1' }] }) };
      return { ok: true, json: async () => ({ data: [clienteRereleido()] }) };
    },
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ csfDatos: CSF_UPGRADE });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(putCalled, true);
  } finally {
    restore();
  }
});

test('UF5: csfDatos sin RFC -> 400, sin tocar Operam', async () => {
  const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500')
    .set('Authorization', `Bearer ${TEST_TOKEN}`)
    .send({ csfDatos: { razonSocial: 'Sin RFC SA' } });
  assert.strictEqual(res.status, 400);
});

test('UF6: Operam no disponible en el gate -> 503 (distinto del 409 y del 400)', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (u.includes('tax_id=')) return { ok: false, status: 500, json: async () => ({ error: 'boom' }) };
      return { ok: true, json: async () => ({ data: [clienteRereleido()] }) };
    },
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ csfDatos: CSF_UPGRADE });
    assert.strictEqual(res.status, 503);
  } finally {
    restore();
  }
});

// === Regla 5 (issue #95): Tax ID extranjero -> notas, sin borrar notas existentes ===

test('UF8: taxIdExtranjero capturado -> el PUT manda notes con el Tax ID antepuesto a las notas existentes', async () => {
  let putBody = null;
  let getsACustomers = 0;
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') { putBody = JSON.parse(opts.body); return { ok: true, json: async () => ({ result: true }) }; }
      if (u.includes('tax_id=')) return { ok: true, json: async () => ({ total: 0, data: [] }) };
      getsACustomers++;
      return { ok: true, json: async () => ({ data: [clienteRereleido({ notes: 'Notas previas del cliente' })] }) };
    },
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ csfDatos: { ...CSF_UPGRADE, taxIdExtranjero: 'US123456789' } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(putBody.notes, 'Tax ID: US123456789\nNotas previas del cliente');
    assert.strictEqual(getsACustomers, 2, 'una relectura previa al PUT (notas actuales) y otra de verificacion post-PUT');
  } finally {
    restore();
  }
});

test('UF9: sin taxIdExtranjero -> el PUT no manda notes y no hace la relectura previa (solo la de verificacion post-PUT)', async () => {
  let putBody = null;
  let getsACustomers = 0;
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') { putBody = JSON.parse(opts.body); return { ok: true, json: async () => ({ result: true }) }; }
      if (u.includes('tax_id=')) return { ok: true, json: async () => ({ total: 0, data: [] }) };
      getsACustomers++;
      return { ok: true, json: async () => ({ data: [clienteRereleido()] }) };
    },
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ csfDatos: CSF_UPGRADE });
    assert.strictEqual(res.status, 200);
    assert.ok(!('notes' in putBody), 'sin taxIdExtranjero no debe tocar notes');
    assert.strictEqual(getsACustomers, 1, 'solo la relectura de verificacion post-PUT, sin GET extra');
  } finally {
    restore();
  }
});

test('UF10: PUT ignora notes (quirk) -> la relectura lo reporta en camposNoActualizados', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') return { ok: true, json: async () => ({ result: true }) };
      if (u.includes('tax_id=')) return { ok: true, json: async () => ({ total: 0, data: [] }) };
      // Tanto la relectura previa como la de verificacion devuelven notas SIN el Tax ID.
      return { ok: true, json: async () => ({ data: [clienteRereleido({ notes: 'Notas previas del cliente' })] }) };
    },
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ csfDatos: { ...CSF_UPGRADE, taxIdExtranjero: 'US123456789' } });
    assert.strictEqual(res.status, 200);
    const notasNoActualizadas = res.body.camposNoActualizados.find(x => x.campo === 'notes');
    assert.ok(notasNoActualizadas, 'debe reportar que el Tax ID no quedo en notas');
  } finally {
    restore();
  }
});

// === Issue #171: actividades economicas de la CSF -> notas del cliente ===

test('UF13: actividades capturadas -> el PUT manda notes con la seccion de actividades, sin borrar notas existentes', async () => {
  let putBody = null;
  let getsACustomers = 0;
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') { putBody = JSON.parse(opts.body); return { ok: true, json: async () => ({ result: true }) }; }
      if (u.includes('tax_id=')) return { ok: true, json: async () => ({ total: 0, data: [] }) };
      getsACustomers++;
      return { ok: true, json: async () => ({ data: [clienteRereleido({ notes: 'Notas previas del cliente' })] }) };
    },
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ csfDatos: { ...CSF_UPGRADE, actividades: ['Comercio al por menor'], csf_fecha: '8 DE MAYO DE 2026' } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(putBody.notes, 'Notas previas del cliente\nActividades economicas (CSF 8 DE MAYO DE 2026):\n- Comercio al por menor');
    assert.strictEqual(getsACustomers, 2, 'una relectura previa al PUT (notas actuales) y otra de verificacion post-PUT');
  } finally {
    restore();
  }
});

test('UF13b: actividades sin csf_fecha (CSF sin "Fecha de emision") -> notes NUNCA lleva "(CSF ):" vacio', async () => {
  let putBody = null;
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') { putBody = JSON.parse(opts.body); return { ok: true, json: async () => ({ result: true }) }; }
      if (u.includes('tax_id=')) return { ok: true, json: async () => ({ total: 0, data: [] }) };
      return { ok: true, json: async () => ({ data: [clienteRereleido()] }) };
    },
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ csfDatos: { ...CSF_UPGRADE, actividades: ['Otros intermediarios del comercio al por menor'], csf_fecha: '' } });
    assert.strictEqual(res.status, 200);
    assert.ok(!putBody.notes.includes('(CSF )'), 'nunca debe imprimir el parentesis vacio');
    assert.equal(putBody.notes, 'Actividades economicas:\n- Otros intermediarios del comercio al por menor');
  } finally {
    restore();
  }
});

test('UF14: sin actividades -> el PUT no manda notes y no hace la relectura previa (solo la de verificacion post-PUT)', async () => {
  let putBody = null;
  let getsACustomers = 0;
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') { putBody = JSON.parse(opts.body); return { ok: true, json: async () => ({ result: true }) }; }
      if (u.includes('tax_id=')) return { ok: true, json: async () => ({ total: 0, data: [] }) };
      getsACustomers++;
      return { ok: true, json: async () => ({ data: [clienteRereleido()] }) };
    },
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ csfDatos: CSF_UPGRADE });
    assert.strictEqual(res.status, 200);
    assert.ok(!('notes' in putBody), 'sin actividades no debe tocar notes');
    assert.strictEqual(getsACustomers, 1, 'solo la relectura de verificacion post-PUT, sin GET extra');
  } finally {
    restore();
  }
});

test('UF15: PUT ignora notes (quirk) -> la relectura reporta que las actividades no quedaron aplicadas', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') return { ok: true, json: async () => ({ result: true }) };
      if (u.includes('tax_id=')) return { ok: true, json: async () => ({ total: 0, data: [] }) };
      // Tanto la relectura previa como la de verificacion devuelven notas SIN la seccion.
      return { ok: true, json: async () => ({ data: [clienteRereleido({ notes: 'Notas previas del cliente' })] }) };
    },
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ csfDatos: { ...CSF_UPGRADE, actividades: ['Comercio al por menor'], csf_fecha: '8 DE MAYO DE 2026' } });
    assert.strictEqual(res.status, 200);
    const notasNoActualizadas = res.body.camposNoActualizados.find(x => x.campo === 'notes');
    assert.ok(notasNoActualizadas, 'debe reportar que las actividades no quedaron en notas');
  } finally {
    restore();
  }
});

// === Regla 6 (issue #95): segmento_id viaja en el upgrade con verificacion post-escritura ===
//
// La API v3 NO puede escribir segmento_id por ningun camino (#172, sondeo en vivo); el
// segmento lo persiste un post-fix por la web legacy DESPUES del PUT y ANTES de la
// relectura de verificacion. La ficha de cliente de FA la monta
// handlersWebFichaCliente (test/helpers/ficha-cliente-web.js): reproduce la trampa del
// <form> anidado y trae el boton destructivo `delete`. Vive en un helper porque desde
// #186 tambien la usan el alta completa (mas abajo) y el alta generica (otra suite).

test('UF11: segmentoId capturado -> el PUT manda segmento_id y el post-fix web lo persiste (#172)', async () => {
  const { _resetSesionWeb } = await import('../lib/operam-web.js');
  _resetSesionWeb();
  const web = handlersWebFichaCliente();
  let putBody = null;
  const restore = mockOperamFetch({
    ...web.handlers,
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      // El PUT sigue mandando segmento_id (Operam lo ignora; si algun dia lo arregla,
      // empieza a funcionar solo) pero quien lo escribe de verdad es la web legacy.
      if (opts?.method === 'PUT') { putBody = JSON.parse(opts.body); return { ok: true, json: async () => ecoPut(putBody, ['segmento_id']) }; }
      if (u.includes('tax_id=')) return { ok: true, json: async () => ({ total: 0, data: [] }) };
      // Forma REAL del GET: el segmento viene anidado, nunca como segmento_id plano.
      return { ok: true, json: async () => ({ data: [clienteRereleido({ segmento: { id: web.estado.segmento } })] }) };
    },
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ csfDatos: { ...CSF_UPGRADE, segmentoId: '3' } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(putBody.segmento_id, '3');
    assert.strictEqual(web.posts.length, 1, 'un solo POST a la ficha de cliente');
    assert.strictEqual(web.posts[0].get('segmento_id'), '3');
    assert.strictEqual(web.posts[0].get('process'), 'Actualizar Cliente', 'el submit real de la ficha');
    assert.strictEqual(web.posts[0].get('_token'), 'TOK', 'el token vive DESPUES del form anidado');
    assert.strictEqual(web.posts[0].get('CustName'), 'Real SA de CV', 'el resto del formulario viaja intacto');
    assert.strictEqual(web.estado.segmento, '3', 'el segmento quedo escrito en Operam');
    // el post-fix corre ANTES de la relectura: el campo ya no se reporta como pendiente
    assert.deepEqual(res.body.camposNoActualizados, []);
  } finally {
    restore();
  }
});

test('UF11b: sin segmento capturado el upgrade NO toca la web legacy', async () => {
  const { _resetSesionWeb } = await import('../lib/operam-web.js');
  _resetSesionWeb();
  const web = handlersWebFichaCliente();
  const restore = mockOperamFetch({
    ...web.handlers,
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') { const body = JSON.parse(opts.body); return { ok: true, json: async () => ecoPut(body) }; }
      if (u.includes('tax_id=')) return { ok: true, json: async () => ({ total: 0, data: [] }) };
      return { ok: true, json: async () => ({ data: [clienteRereleido()] }) };
    },
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ csfDatos: CSF_UPGRADE });
    assert.strictEqual(res.status, 200);
    assert.deepEqual(web.posts, [], 'sin segmento capturado no hay nada que corregir');
  } finally {
    restore();
  }
});

test('UF12: quirk #74 -- ni el PUT ni la web aplican el segmento -> la relectura lo reporta en camposNoActualizados', async () => {
  const { _resetSesionWeb } = await import('../lib/operam-web.js');
  _resetSesionWeb();
  const web = handlersWebFichaCliente({ noAplica: true });
  const restore = mockOperamFetch({
    ...web.handlers,
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') { const body = JSON.parse(opts.body); return { ok: true, json: async () => ecoPut(body, ['segmento_id']) }; }
      if (u.includes('tax_id=')) return { ok: true, json: async () => ({ total: 0, data: [] }) };
      // La relectura muestra el segmento VIEJO (nadie lo escribio).
      return { ok: true, json: async () => ({ data: [clienteRereleido({ segmento: { id: '1' } })] }) };
    },
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ csfDatos: { ...CSF_UPGRADE, segmentoId: '3' } });
    assert.strictEqual(res.status, 200);
    const segNoActualizado = res.body.camposNoActualizados.find(x => x.campo === 'segmento_id');
    assert.ok(segNoActualizado, 'debe reportar que segmento_id no pego');
    assert.strictEqual(segNoActualizado.anterior, '1');
    assert.strictEqual(segNoActualizado.nuevo, '3');
  } finally {
    restore();
  }
});

// Trampa 2 de #172: FA responde 200 con la pagina re-renderizada y NO aplica ningun
// campo; el unico rastro es el err_msg. El upgrade en si NO debe fallar por eso: el PUT
// de la API ya se aplico.
test('UF12b: la web rechaza el guardado (err_msg) -> el upgrade sigue ok y el segmento se reporta con el motivo real', async () => {
  const { _resetSesionWeb } = await import('../lib/operam-web.js');
  _resetSesionWeb();
  const web = handlersWebFichaCliente({ err: 'El codigo postal no puede ser vacio' });
  const restore = mockOperamFetch({
    ...web.handlers,
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') { const body = JSON.parse(opts.body); return { ok: true, json: async () => ecoPut(body, ['segmento_id']) }; }
      if (u.includes('tax_id=')) return { ok: true, json: async () => ({ total: 0, data: [] }) };
      return { ok: true, json: async () => ({ data: [clienteRereleido({ segmento: { id: '1' } })] }) };
    },
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ csfDatos: { ...CSF_UPGRADE, segmentoId: '3' } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true, 'el PUT ya se aplico: un fallo del post-fix no tumba el upgrade');
    const seg = res.body.camposNoActualizados.find(x => x.campo === 'segmento_id');
    assert.ok(seg, 'el segmento sigue sin aplicarse y hay que reportarlo');
    assert.match(seg.motivo, /codigo postal/i, 'el vendedor debe ver el motivo REAL de la web, no el generico');
  } finally {
    restore();
  }
});

// Una escritura NUNCA se reintenta a ciegas: el formulario murio con la sesion (regla de
// pedir() en lib/operam-web.js).
test('UF12c: sesion caducada en la escritura -> error controlado, sin reintento, upgrade ok', async () => {
  const { _resetSesionWeb } = await import('../lib/operam-web.js');
  _resetSesionWeb();
  const web = handlersWebFichaCliente({ sesionCaducada: true });
  const restore = mockOperamFetch({
    ...web.handlers,
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') { const body = JSON.parse(opts.body); return { ok: true, json: async () => ecoPut(body, ['segmento_id']) }; }
      if (u.includes('tax_id=')) return { ok: true, json: async () => ({ total: 0, data: [] }) };
      return { ok: true, json: async () => ({ data: [clienteRereleido({ segmento: { id: '1' } })] }) };
    },
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ csfDatos: { ...CSF_UPGRADE, segmentoId: '3' } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(web.posts.length, 1, 'una escritura fallida NO se repite');
    const seg = res.body.camposNoActualizados.find(x => x.campo === 'segmento_id');
    assert.ok(seg);
    assert.match(seg.motivo, /sesion/i);
  } finally {
    restore();
  }
});

test('UF7: sin token -> 401', async () => {
  const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500').send({ csfDatos: CSF_UPGRADE });
  assert.strictEqual(res.status, 401);
});

// === GET /api/operam/clientes/:id/comercial (precarga de la Seccion 2, issue #197) ===
//
// Decision 1 de #197: el upgrade abre la Seccion 2 con los valores ACTUALES del cliente.
// Sin esa lectura, confirmar el upgrade mandaria los defaults del panel encima de datos
// reales. Las llaves son las del GET de detalle verificado en vivo (cliente 491): la
// lista de precios llega como `sales_type` (id plano), el segmento anidado en
// `segmento.id`, el vendedor colgando de branches[0] -- e `invoice_email` NO llega.

test('UC1: la precarga comercial devuelve lista, segmento y vendedor con las llaves reales del GET', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': () => ({
      ok: true,
      json: async () => ({ data: [clienteRereleido({
        sales_type: '15',
        segmento: { id: '3', clave: '003', description: 'Restaurantes, hoteles' },
        branches: [{ branch_code: '535', salesman_name: 'Adrian Chavez' }],
      })] }),
    }),
  });
  try {
    const res = await supertest(app).get('/api/operam/clientes/500/comercial')
      .set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.salesType, '15');
    assert.strictEqual(res.body.segmentoId, '3');
    assert.strictEqual(res.body.vendedorNombre, 'Adrian Chavez');
    assert.strictEqual(res.body.invoiceEmail, '', 'el GET de Operam no expone invoice_email: se precarga vacio');
  } finally {
    restore();
  }
});

test('UC2: Operam caido -> 503 (el panel no debe precargar valores inventados)', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }),
  });
  try {
    const res = await supertest(app).get('/api/operam/clientes/500/comercial')
      .set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 503);
  } finally {
    restore();
  }
});

test('UC3: la precarga comercial sin token -> 401', async () => {
  const res = await supertest(app).get('/api/operam/clientes/500/comercial');
  assert.strictEqual(res.status, 401);
});

// La lista de precios cambiada llega al endpoint como un campo mas de csfDatos
// (salesType): el frontend ya podo lo que no cambio contra la precarga
// (datosUpgradeConComercial). Aqui se verifica el contrato del lado servidor --
// que se escriba con la llave real y que el eco decida si pego.

test('UC4: lista de precios cambiada -> el PUT manda sales_type y la relectura la confirma', async () => {
  let putBody = null;
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') { putBody = JSON.parse(opts.body); return { ok: true, json: async () => ecoPut(putBody) }; }
      if (u.includes('tax_id=')) return { ok: true, json: async () => ({ total: 0, data: [] }) };
      return { ok: true, json: async () => ({ data: [clienteRereleido({ sales_type: '16' })] }) };
    },
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ csfDatos: { ...CSF_UPGRADE, salesType: '16' } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(putBody.sales_type, '16', 'la lista de precios se lee y se escribe con la misma llave (verificado en vivo)');
    assert.deepEqual(res.body.camposNoActualizados, []);
  } finally {
    restore();
  }
});

test('UC5: Operam ignora sales_type en el PUT -> se reporta en camposNoActualizados con su etiqueta', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') { const body = JSON.parse(opts.body); return { ok: true, json: async () => ecoPut(body, ['sales_type']) }; }
      if (u.includes('tax_id=')) return { ok: true, json: async () => ({ total: 0, data: [] }) };
      // La relectura muestra la lista VIEJA: nadie la escribio.
      return { ok: true, json: async () => ({ data: [clienteRereleido({ sales_type: '15' })] }) };
    },
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ csfDatos: { ...CSF_UPGRADE, salesType: '16' } });
    assert.strictEqual(res.status, 200);
    const lista = res.body.camposNoActualizados.find(x => x.campo === 'sales_type');
    assert.ok(lista, 'debe reportar que la lista de precios no pego');
    assert.strictEqual(lista.label, 'Lista de precios');
    assert.strictEqual(lista.anterior, '15');
    assert.strictEqual(lista.nuevo, '16');
  } finally {
    restore();
  }
});

test('UC6: sin campos comerciales en csfDatos, el PUT no lleva ninguno (AC3: no cambiar nada = no viaja nada)', async () => {
  const { _resetSesionWeb: reset } = await import('../lib/operam-web.js');
  reset();
  const web = handlersWebFichaCliente();
  let putBody = null;
  const restore = mockOperamFetch({
    ...web.handlers,
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') { putBody = JSON.parse(opts.body); return { ok: true, json: async () => ecoPut(putBody) }; }
      if (u.includes('tax_id=')) return { ok: true, json: async () => ({ total: 0, data: [] }) };
      return { ok: true, json: async () => ({ data: [clienteRereleido()] }) };
    },
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ csfDatos: CSF_UPGRADE });
    assert.strictEqual(res.status, 200);
    assert.ok(!('sales_type' in putBody));
    assert.ok(!('segmento_id' in putBody));
    assert.ok(!('invoice_email' in putBody));
    assert.deepEqual(web.posts, [], 'sin cambio de segmento no corre el post-fix web');
  } finally {
    restore();
  }
});

// AC5 de #197: PUT /branches es un REPLACE destructivo sobre sucursales ya configuradas
// (#189, danos reales en #195). El vendedor que se ve en la Seccion 2 vive ahi, y por eso
// se muestra deshabilitado: ninguna rama de este flujo puede escribir sucursales.
test('UC7: el upgrade fiscal NUNCA escribe branches, ni con toda la configuracion comercial cambiada', async () => {
  const { _resetSesionWeb: reset } = await import('../lib/operam-web.js');
  reset();
  const web = handlersWebFichaCliente();
  const escriturasBranches = [];
  const restore = mockOperamFetch({
    ...web.handlers,
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/branches': (u, opts) => {
      if (opts?.method && opts.method !== 'GET') escriturasBranches.push(`${opts.method} ${u}`);
      return { ok: true, json: async () => ({ result: true, data: [] }) };
    },
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') { const body = JSON.parse(opts.body); return { ok: true, json: async () => ecoPut(body, ['segmento_id']) }; }
      if (u.includes('tax_id=')) return { ok: true, json: async () => ({ total: 0, data: [] }) };
      return { ok: true, json: async () => ({ data: [clienteRereleido({ sales_type: '16', segmento: { id: web.estado.segmento } })] }) };
    },
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente-fiscal/500')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ csfDatos: { ...CSF_UPGRADE, salesType: '16', segmentoId: '3', invoiceEmail: 'facturacion@peltre.mx' } });
    assert.strictEqual(res.status, 200);
    assert.deepEqual(escriturasBranches, [], 'ninguna escritura a /branches en todo el flujo del upgrade');
  } finally {
    restore();
  }
});

// === GET /api/log ===

test('GET /api/log retorna 503 cuando no hay DATABASE_URL', async () => {
  const res = await supertest(app).get('/api/log').set('Authorization', `Bearer ${TEST_TOKEN}`);
  assert.strictEqual(res.status, 503);
});

test('GET /api/log sin token retorna 401', async () => {
  const res = await supertest(app).get('/api/log');
  assert.strictEqual(res.status, 401);
});

// === GET /api/admin/higiene-clientes-genericos (issue #86) ===

test('GET /api/admin/higiene-clientes-genericos sin DATABASE_URL responde filas vacias y sinDb:true', async () => {
  const res = await supertest(app).get('/api/admin/higiene-clientes-genericos')
    .set('Authorization', `Bearer ${TEST_TOKEN}`);
  assert.strictEqual(res.status, 200);
  assert.deepEqual(res.body, { filas: [], sinDb: true });
});

test('GET /api/admin/higiene-clientes-genericos exige admin: vendedor 403, sin token 401', async () => {
  const vendedorToken = jwt.sign({ id: 7, name: 'Memo', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });
  const vendedor = await supertest(app).get('/api/admin/higiene-clientes-genericos')
    .set('Authorization', `Bearer ${vendedorToken}`);
  assert.strictEqual(vendedor.status, 403);
  const sinToken = await supertest(app).get('/api/admin/higiene-clientes-genericos');
  assert.strictEqual(sinToken.status, 401);
});

// === GET /api/admin/sync-contactos-google (issue #230) ===

test('GET /api/admin/sync-contactos-google sin DATABASE_URL responde barridos vacios y sinDb:true', async () => {
  const res = await supertest(app).get('/api/admin/sync-contactos-google')
    .set('Authorization', `Bearer ${TEST_TOKEN}`);
  assert.strictEqual(res.status, 200);
  assert.deepEqual(res.body, { barridos: [], sinDb: true });
});

test('GET /api/admin/sync-contactos-google exige admin: vendedor 403, sin token 401', async () => {
  const vendedorToken = jwt.sign({ id: 7, name: 'Memo', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });
  const vendedor = await supertest(app).get('/api/admin/sync-contactos-google')
    .set('Authorization', `Bearer ${vendedorToken}`);
  assert.strictEqual(vendedor.status, 403);
  const sinToken = await supertest(app).get('/api/admin/sync-contactos-google');
  assert.strictEqual(sinToken.status, 401);
});

// === PUT /api/actualizar-cliente/:id ===

test('PUT /api/actualizar-cliente/:id actualiza cliente y retorna { ok:true }', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente/42')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ street: 'Reforma', postal_code: '06600' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
  } finally {
    restore();
  }
});

test('PUT /api/actualizar-cliente/:id sin campos retorna 400', async () => {
  const res = await supertest(app).put('/api/actualizar-cliente/42')
    .set('Authorization', `Bearer ${TEST_TOKEN}`)
    .send({});
  assert.strictEqual(res.status, 400);
  assert.ok(res.body.error);
});

test('PUT /api/actualizar-cliente/:id sin token retorna 401', async () => {
  const res = await supertest(app).put('/api/actualizar-cliente/42').send({ street: 'X' });
  assert.strictEqual(res.status, 401);
});

test('PUT /api/actualizar-cliente/:id Operam error retorna 503', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': () => ({ ok: true, json: async () => ({ result: false, messages: ['RFC invalido'] }) }),
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente/42')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ street: 'X' });
    assert.strictEqual(res.status, 503);
  } finally {
    restore();
  }
});

// === POST /api/crear-cliente ===

test('POST /api/crear-cliente sin tax_id retorna 400', async () => {
  const res = await supertest(app).post('/api/crear-cliente')
    .set('Authorization', `Bearer ${TEST_TOKEN}`)
    .send({ CustName: 'Sin RFC' });
  assert.strictEqual(res.status, 400);
  assert.ok(res.body.error);
});

test('POST /api/crear-cliente sin token retorna 401', async () => {
  const res = await supertest(app).post('/api/crear-cliente').send({ tax_id: 'NVO010101ABC' });
  assert.strictEqual(res.status, 401);
});

test('POST /api/crear-cliente crea cliente nuevo y retorna { ok:true, customer_id }', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return { ok: true, json: async () => ({ result: true, customer_id: 77 }) };
      if (u.includes('/77')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 177 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/177': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({
        tax_id: 'NVO010101ABC', CustName: 'Nuevo SA de CV',
        entrega: { br_name: 'Almacen', br_ref: 'ALM', addr_street: 'Calle', addr_exterior: '1', addr_interior: '', addr_colony: 'Col', addr_city: 'CDMX', addr_state: 'CDMX', addr_zip: '06600', addr_reference: '', phone: '', email: '', pais: 'MX' },
        salesman: 47,
      });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.customer_id, 77);
    assert.strictEqual(res.body.duplicado, false);
  } finally {
    restore();
  }
});

test('POST /api/crear-cliente con RFC duplicado retorna duplicado:true con datos', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': () => ({ ok: true, json: async () => ({ total: 1, data: [{ customer_id: 55, CustName: 'Duplicado SA', tax_id: 'DUP010101ABC', street: '', street_number: '', suite_number: '', district: '', postal_code: '', city: '', state: '', cfdi_regimen_fiscal: '601', branches: [] }] }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ tax_id: 'DUP010101ABC', CustName: 'Duplicado SA' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.duplicado, true);
    assert.strictEqual(res.body.customer_id, 55);
  } finally {
    restore();
  }
});

// Concurrencia (issue #209): dos altas EN VUELO con el mismo RFC nuevo (doble
// click, dos pestanas) no deben crear dos clientes en Operam. El lock por RFC
// normalizado (crearClienteConLock, server.js) serializa las dos llamadas a
// crearCliente -- la que gana la carrera crea el cliente; la que pierde solo
// corre su dedup DESPUES, cuando el mock ya "sabe" del recien creado, y recibe
// duplicado:true. Cual de las dos gana no es determinista (llegan por sockets
// HTTP reales via supertest) asi que el assert no fija cual es cual -- solo que
// hubo UN solo POST y que las dos respuestas, juntas, son [false, true].
test('POST /api/crear-cliente: dos altas concurrentes con el mismo RFC nuevo crean UN solo cliente (#209)', async () => {
  let postCount = 0;
  let creado = false;
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') {
        postCount++;
        creado = true;
        return { ok: true, json: async () => ({ result: true, customer_id: 501 }) };
      }
      if (u.includes('/501')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 601 }] }] }) };
      if (creado) {
        return {
          ok: true,
          json: async () => ({
            total: 1,
            data: [{ customer_id: 501, CustName: 'Concurrente SA', tax_id: 'CON010101ABC', street: '', street_number: '', suite_number: '', district: '', postal_code: '', city: '', state: '', cfdi_regimen_fiscal: '601', branches: [] }],
          }),
        };
      }
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/601': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  try {
    const payload = { tax_id: 'CON010101ABC', CustName: 'Concurrente SA' };
    const [r1, r2] = await Promise.all([
      supertest(app).post('/api/crear-cliente').set('Authorization', `Bearer ${TEST_TOKEN}`).send(payload),
      supertest(app).post('/api/crear-cliente').set('Authorization', `Bearer ${TEST_TOKEN}`).send(payload),
    ]);
    assert.strictEqual(postCount, 1, 'exactamente UN POST de cliente debe llegar a Operam');
    assert.deepStrictEqual([r1.body.duplicado, r2.body.duplicado].sort(), [false, true]);
    assert.strictEqual(r1.body.customer_id, 501);
    assert.strictEqual(r2.body.customer_id, 501);
  } finally {
    restore();
  }
});

// Backstop del telefono (issue #176): la capa estricta del navegador AVISA pero
// deja guardar, asi que un numero imposible puede llegar al alta. El servidor lo
// deja registrado para revision y responde EXACTAMENTE igual que siempre --
// rechazar por esta causa dejaria al vendedor con el cliente enfrente y sin salida.
test('POST /api/crear-cliente registra el telefono sospechoso sin rechazar el alta (#176)', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return { ok: true, json: async () => ({ result: true, customer_id: 78 }) };
      if (u.includes('/78')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 178 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/178': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  const warnOriginal = console.warn;
  const avisos = [];
  console.warn = (...args) => avisos.push(args.join(' '));
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({
        tax_id: 'SOS010101ABC', CustName: 'Sospechoso SA', phone: '+52 0000000000',
        entrega: { br_name: 'Almacen', br_ref: 'ALM', addr_street: 'Calle', addr_zip: '06600', addr_city: 'CDMX', addr_state: 'CDMX', phone: '+52 5512345678', email: '', pais: 'MX' },
      });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.customer_id, 78);
    const sospechosos = avisos.filter(a => a.includes('telefono-sospechoso'));
    assert.strictEqual(sospechosos.length, 1);
    assert.ok(sospechosos[0].includes('+52 0000000000'));
    assert.ok(sospechosos[0].includes('SOS010101ABC'));
  } finally {
    console.warn = warnOriginal;
    restore();
  }
});

// === GET /api/buscar-cliente ===

test('GET /api/buscar-cliente sin rfc retorna 400', async () => {
  const res = await supertest(app).get('/api/buscar-cliente').set('Authorization', `Bearer ${TEST_TOKEN}`);
  assert.strictEqual(res.status, 400);
  assert.ok(res.body.error);
});

test('GET /api/buscar-cliente sin token retorna 401', async () => {
  const res = await supertest(app).get('/api/buscar-cliente?rfc=ACE010101ABC');
  assert.strictEqual(res.status, 401);
});

test('GET /api/buscar-cliente?rfc=... retorna 200 con datos cuando existe en Operam', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': () => ({ ok: true, json: async () => ({ total: 1, data: [{ customer_id: 55, CustName: 'Aceros SA de CV', tax_id: 'ACE010101ABC', street: 'Reforma', street_number: '1', suite_number: '', district: 'Juarez', postal_code: '06600', city: 'CDMX', state: 'CDMX', cfdi_regimen_fiscal: '601', branches: [{ br_name: 'Aceros', addr_street: 'Reforma', addr_colony: 'Juarez', addr_zip: '06600', addr_city: 'CDMX', addr_state: 'CDMX', phone: '', email: '' }] }] }) }),
  });
  try {
    const res = await supertest(app).get('/api/buscar-cliente?rfc=ACE010101ABC').set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.encontrado, true);
    assert.strictEqual(res.body.cliente_id, 55);
  } finally {
    restore();
  }
});

test('GET /api/buscar-cliente?rfc=... retorna 200 {encontrado:false} cuando no existe', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': () => ({ ok: true, json: async () => ({ total: 0, data: [] }) }),
  });
  try {
    const res = await supertest(app).get('/api/buscar-cliente?rfc=RFC000000000').set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.encontrado, false);
  } finally {
    restore();
  }
});

test('GET /api/buscar-cliente retorna 503 si Operam lanza error', async () => {
  const restore = mockOperamFetch({ '/api/v3/login': () => { throw new Error('timeout'); } });
  try {
    const res = await supertest(app).get('/api/buscar-cliente?rfc=ACE010101ABC').set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 503);
  } finally {
    restore();
  }
});

// === POST /api/csf-from-url (issue #33: reusa parsearCSF) ===

test('POST /api/csf-from-url responde texto crudo y datos parseados de la CSF', async () => {
  const html = '<html><body>R.F.C. : UEGA850312KL5<br>Nombre (s) : ADRIANA<br>Primer Apellido : URENA</body></html>';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes('sat.gob.mx'));
    return { ok: true, text: async () => html };
  };
  try {
    const res = await supertest(app).post('/api/csf-from-url')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ url: 'https://siat.sat.gob.mx/qr?id=123' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.ok(res.body.texto.includes('UEGA850312KL5'));
    assert.strictEqual(res.body.datos.rfc, 'UEGA850312KL5');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('POST /api/csf-from-url sin token retorna 401', async () => {
  const res = await supertest(app).post('/api/csf-from-url').send({ url: 'https://siat.sat.gob.mx/qr?id=123' });
  assert.strictEqual(res.status, 401);
});

// === POST /api/parsear-csf (issue #33) ===

const CSF_PERSONA_FISICA_TXT = `
CONSTANCIA DE SITUACION FISCAL
Nombre (s) : ADRIANA
Primer Apellido : URENA
Segundo Apellido : GARCIA
R.F.C. : UEGA850312KL5
idCIF : 98765432101
Nombre de la Vialidad : INSURGENTES SUR
Número Exterior : 123
Nombre de la Colonia : DEL VALLE
Código Postal : 03100
Nombre del Municipio o Demarcación Territorial : BENITO JUAREZ
Nombre de la Entidad Federativa : CIUDAD DE MEXICO
Régimen Fiscal : 612 Personas Físicas con Actividades Empresariales
`;

test('POST /api/parsear-csf con texto de persona fisica retorna { ok:true, datos }', async () => {
  const res = await supertest(app).post('/api/parsear-csf').send({ texto: CSF_PERSONA_FISICA_TXT });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.datos.rfc, 'UEGA850312KL5');
  assert.ok(res.body.datos.razonSocial.includes('ADRIANA'));
});

const CSF_PERSONA_MORAL_TXT = `
CONSTANCIA DE SITUACION FISCAL
Denominación/Razón Social : BANCO DE MEXICO FIDEICOMISO PARA LOS MUSEOS DIEGO RIVERA Y FRIDA KAHLO
R.F.C. : BMF821130AR3
idCIF : 12345678901
Nombre de la Vialidad : AV 5 DE MAYO
Número Exterior : 2
Nombre de la Colonia : CENTRO DE LA CIUDAD DE MEXICO AREA 1
Código Postal : 06000
Nombre del Municipio o Demarcación Territorial : CUAUHTEMOC
Nombre de la Entidad Federativa : CIUDAD DE MEXICO
Régimen Fiscal : 601 General de Ley Personas Morales
`;

test('POST /api/parsear-csf con texto de persona moral retorna estructura completa con domicilio', async () => {
  const res = await supertest(app).post('/api/parsear-csf').send({ texto: CSF_PERSONA_MORAL_TXT });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.datos.rfc, 'BMF821130AR3');
  assert.ok(res.body.datos.razonSocial.includes('BANCO DE MEXICO'));
  assert.strictEqual(res.body.datos.calle, 'AV 5 DE MAYO');
  assert.strictEqual(res.body.datos.numExt, '2');
  assert.strictEqual(res.body.datos.numInt, '');
  assert.strictEqual(res.body.datos.colonia, 'CENTRO DE LA CIUDAD DE MEXICO AREA 1');
  assert.strictEqual(res.body.datos.regimenFiscal, '601');
});

const CSF_RFC_SUFIJO_ESPURIO_TXT = `
CONSTANCIA DE SITUACION FISCAL
Denominación/Razón Social : SAGO MEDICAL SERVICE
RFC: SMS200716NZ4 Denominación/Razón Social : SAGO MEDICAL SERVICE
idCIF : 20090146505
Nombre de la Vialidad : NAYARIT
Número Exterior : 56
Nombre de la Colonia : ROMA SUR
Código Postal : 06760
Nombre del Municipio o Demarcación Territorial : CUAUHTEMOC
Nombre de la Entidad Federativa : CIUDAD DE MEXICO
Régimen Fiscal : 601 General de Ley Personas Morales
`;

test('POST /api/parsear-csf con RFC seguido de texto en la misma linea no captura sufijo espurio', async () => {
  const res = await supertest(app).post('/api/parsear-csf').send({ texto: CSF_RFC_SUFIJO_ESPURIO_TXT });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.datos.rfc, 'SMS200716NZ4');
});

test('POST /api/parsear-csf con texto sin RFC detectable retorna error claro, no datos vacios', async () => {
  const res = await supertest(app).post('/api/parsear-csf').send({ texto: 'Este documento no es una CSF, es una factura cualquiera.' });
  assert.strictEqual(res.status, 422);
  assert.strictEqual(res.body.ok, false);
  assert.ok(res.body.error);
  assert.strictEqual(res.body.datos, undefined);
});

test('POST /api/parsear-csf sin campo texto retorna 400', async () => {
  const res = await supertest(app).post('/api/parsear-csf').send({});
  assert.strictEqual(res.status, 400);
  assert.ok(res.body.error);
});

test('POST /api/parsear-csf no requiere JWT (mismo patron que /api/csf-from-url y /api/buscar-cliente)', async () => {
  const res = await supertest(app).post('/api/parsear-csf').send({ texto: CSF_PERSONA_FISICA_TXT });
  assert.notStrictEqual(res.status, 401);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.ok, true);
});

test('POST /api/parsear-csf con texto solo de espacios en blanco retorna 422, no datos vacios', async () => {
  const res = await supertest(app).post('/api/parsear-csf').send({ texto: '   \n\n   ' });
  assert.strictEqual(res.status, 422);
  assert.strictEqual(res.body.ok, false);
  assert.ok(res.body.error);
  assert.strictEqual(res.body.datos, undefined);
});

// === GET /api/catalogos (issue #27) ===

// Formato REAL de Operam v3 (verificado en vivo 2026-06-17): la etiqueta viene en
// `sales_type` (NO `sales_type_id`), el id numerico en `id` (lo que el cliente
// guarda), NO trae `description`, y `sales_type` es texto libre (M100, "Precio de
// lista", "Segundas", "Amazon"...). El catalogo expone todas las activas.
const SALES_TYPES_MOCK = [
  { id: '15', sales_type: 'M100',            inactive: '0' },
  { id: '16', sales_type: 'M350',            inactive: '0' },
  { id: '1',  sales_type: 'M550',            inactive: '0' },
  { id: '12', sales_type: 'Precio de lista', inactive: '0' },
  { id: '9',  sales_type: 'Segundas',        inactive: '0' },
  { id: '19', sales_type: 'Amazon',          inactive: '0' },
  { id: '98', sales_type: 'Vieja Inactiva',  inactive: '1' },
];

function mockCatalogos() {
  return mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok' }) }),
    '/api/v3/sales/sales_types': () => ({ ok: true, json: async () => ({ data: SALES_TYPES_MOCK }) }),
  });
}

test('C1: GET /api/catalogos retorna 200 con estructura { segmentos, vendedores, listas_precios }', async () => {
  const restore = mockCatalogos();
  try {
    await cargarListasPrecios();
    const res = await supertest(app).get('/api/catalogos').set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.segmentos), 'segmentos debe ser array');
    assert.ok(Array.isArray(res.body.vendedores), 'vendedores debe ser array');
    assert.ok(Array.isArray(res.body.listas_precios), 'listas_precios debe ser array');
  } finally {
    restore();
  }
});

test('C2: GET /api/catalogos segmentos son los 11 reales de Operam con sus ids internos', async () => {
  const restore = mockCatalogos();
  try {
    await cargarListasPrecios();
    const res = await supertest(app).get('/api/catalogos').set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.body.segmentos.length, 11);
    const porNombre = Object.fromEntries(res.body.segmentos.map(s => [s.nombre, s.id]));
    assert.strictEqual(porNombre['Sin segmento'], 1);
    assert.strictEqual(porNombre['Distribuidores'], 14);
    assert.strictEqual(porNombre['Menudistas'], 8);
    assert.strictEqual(porNombre['Restaurantes, hoteles'], 10);
    assert.strictEqual(porNombre['Agencias | Marcas'], 12);
    assert.strictEqual(porNombre['e-commerce'], 11);
    assert.strictEqual(porNombre['Eventos'], 15);
    assert.strictEqual(porNombre['Consumidor final'], 16);
    assert.strictEqual(porNombre['Empleados'], 13);
    assert.strictEqual(porNombre['Familia y Amigos'], 9);
    assert.strictEqual(porNombre['Maquila'], 17);
  } finally {
    restore();
  }
});

test('C3: GET /api/catalogos vendedores excluye entradas con operam_id null', async () => {
  const restore = mockCatalogos();
  try {
    await cargarListasPrecios();
    const res = await supertest(app).get('/api/catalogos').set('Authorization', `Bearer ${TEST_TOKEN}`);
    const conNull = res.body.vendedores.filter(v => v.operam_id === null);
    assert.strictEqual(conNull.length, 0, 'ningun vendedor debe tener operam_id null');
    assert.ok(res.body.vendedores.every(v => v.operam_id != null));
  } finally {
    restore();
  }
});

test('C4: GET /api/catalogos listas_precios = todas las activas (id numerico + etiqueta), excluye inactivas', async () => {
  const restore = mockCatalogos();
  try {
    await cargarListasPrecios();
    const res = await supertest(app).get('/api/catalogos').set('Authorization', `Bearer ${TEST_TOKEN}`);
    // El id es el numerico de Operam (lo que el cliente guarda); el nombre es la
    // etiqueta (sales_type). Se muestran todas las activas, incluida "Precio de lista".
    const porId = Object.fromEntries(res.body.listas_precios.map(l => [l.id, l.nombre]));
    assert.strictEqual(porId['15'], 'M100');
    assert.strictEqual(porId['12'], 'Precio de lista');
    assert.strictEqual(porId['9'], 'Segundas');
    assert.ok(!('98' in porId), 'no debe incluir listas inactivas');
    assert.strictEqual(res.body.listas_precios.length, 6);
  } finally {
    restore();
  }
});

test('C5: GET /api/catalogos sin token retorna 401', async () => {
  const res = await supertest(app).get('/api/catalogos');
  assert.strictEqual(res.status, 401);
});

test('C6: GET /api/catalogos listas_precios cada entrada tiene { id, nombre }', async () => {
  const restore = mockCatalogos();
  try {
    await cargarListasPrecios();
    const res = await supertest(app).get('/api/catalogos').set('Authorization', `Bearer ${TEST_TOKEN}`);
    for (const lista of res.body.listas_precios) {
      assert.ok(lista.id, 'cada lista debe tener id');
      assert.ok(lista.nombre !== undefined, 'cada lista debe tener nombre');
    }
  } finally {
    restore();
  }
});

test('C7: GET /api/catalogos vendedores cada entrada tiene { id, name, operam_id }', async () => {
  const restore = mockCatalogos();
  try {
    await cargarListasPrecios();
    const res = await supertest(app).get('/api/catalogos').set('Authorization', `Bearer ${TEST_TOKEN}`);
    for (const v of res.body.vendedores) {
      assert.ok(v.id, 'cada vendedor debe tener id');
      assert.ok(v.name, 'cada vendedor debe tener name');
      assert.ok(v.operam_id != null, 'operam_id no debe ser null');
    }
  } finally {
    restore();
  }
});

// === Recarga perezosa de listasPrecios (issue #246) ===
//
// #246: cargarListasPrecios corria UNA sola vez dentro del guard isMain con su
// propio login+fetch crudo, sin mirar el status. Operam rate-limitea /api/v3/*
// con 429 y una pagina HTML (medido en vivo, dura mas de 10 minutos); un arranque
// de Render en esa ventana dejaba listasPrecios = [] de por vida y el r.json()
// crudo reventaba parseando HTML con un mensaje que no mencionaba el 429. Ahora
// cargarListasPrecios usa listarSalesTypes() de lib/operam-client.js (mismo auth
// con refresh, mismo backoff/reintento anti-429, error con status+cuerpo) y
// obtenerListasPrecios() reintenta perezosamente cuando la lista esta vacia.

test('#246-1: cargarListasPrecios ante 429 con cuerpo HTML no lanza, deja listasPrecios vacia y el log lleva el status (no "Unexpected token")', async () => {
  const { resetSession, _setBackoff429Base, _setMinInterval } = await import('../lib/operam-client.js');
  _resetListasPrecios();
  resetSession();
  _setBackoff429Base(0);
  _setMinInterval(0);
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok' }) }),
    '/api/v3/sales/sales_types': () => ({ ok: false, status: 429, text: async () => '<html>Too Many Requests</html>' }),
  });
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args.join(' '));
  try {
    await cargarListasPrecios();
    const listas = await obtenerListasPrecios();
    assert.deepStrictEqual(listas, []);
    assert.ok(logs.some(l => l.includes('429')), 'el log debe llevar el status 429: ' + logs.join(' | '));
    assert.ok(!logs.some(l => l.includes('Unexpected token')), 'no debe ser un SyntaxError opaco de r.json() sobre HTML');
  } finally {
    console.error = originalError;
    restore();
    _setBackoff429Base(2000);
  }
});

test('#246-2: GET /api/catalogos con la lista vacia dispara la recarga perezosa y responde con las listas llenas', async () => {
  _resetListasPrecios();
  const restore = mockCatalogos();
  try {
    const res = await supertest(app).get('/api/catalogos').set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 200);
    const porId = Object.fromEntries(res.body.listas_precios.map(l => [l.id, l.nombre]));
    assert.strictEqual(porId['15'], 'M100');
    assert.ok(res.body.listas_precios.length > 0, 'la recarga perezosa debio traer las listas');
  } finally {
    restore();
  }
});

test('#246-3: dos consumidores concurrentes con la lista vacia hacen UNA sola llamada a sales_types', async () => {
  _resetListasPrecios();
  let llamadas = 0;
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok' }) }),
    '/api/v3/sales/sales_types': () => { llamadas++; return { ok: true, json: async () => ({ data: SALES_TYPES_MOCK }) }; },
  });
  try {
    const [a, b] = await Promise.all([obtenerListasPrecios(), obtenerListasPrecios()]);
    assert.strictEqual(llamadas, 1, 'debe reusar la carga en vuelo: una sola llamada a Operam');
    assert.ok(a.length > 0 && b.length > 0, 'ambos consumidores deben recibir las listas');
  } finally {
    restore();
  }
});

test('#246-4: fallo reciente + nueva peticion dentro del enfriamiento NO vuelve a llamar a Operam', async () => {
  const { resetSession, _setBackoff429Base } = await import('../lib/operam-client.js');
  _resetListasPrecios();
  _setEnfriamientoListasMs(60000);
  resetSession();
  _setBackoff429Base(0);
  let llamadas = 0;
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok' }) }),
    '/api/v3/sales/sales_types': () => { llamadas++; return { ok: false, status: 429, text: async () => '<html>rate limit</html>' }; },
  });
  try {
    const primero = await obtenerListasPrecios();
    assert.deepStrictEqual(primero, []);
    const llamadasTrasPrimero = llamadas;
    assert.ok(llamadasTrasPrimero > 0, 'el primer intento SI debe llamar a Operam');
    const segundo = await obtenerListasPrecios();
    assert.deepStrictEqual(segundo, []);
    assert.strictEqual(llamadas, llamadasTrasPrimero, 'dentro del enfriamiento no debe reintentar contra Operam');
  } finally {
    restore();
    _setBackoff429Base(2000);
    _setEnfriamientoListasMs(60000);
    _resetListasPrecios();
  }
});

test('#246-5: lista ya cargada + fallo en un cargarListasPrecios forzado NO la pisa con []', async () => {
  const { resetSession, _setBackoff429Base } = await import('../lib/operam-client.js');
  _resetListasPrecios();
  const restoreOk = mockCatalogos();
  await cargarListasPrecios();
  const cargadaAntes = await obtenerListasPrecios();
  assert.ok(cargadaAntes.length > 0, 'debio quedar cargada antes del fallo forzado');
  restoreOk();

  resetSession();
  _setBackoff429Base(0);
  const restoreFail = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok' }) }),
    '/api/v3/sales/sales_types': () => ({ ok: false, status: 429, text: async () => '<html>rate limit</html>' }),
  });
  try {
    await cargarListasPrecios(); // forzado: no pasa por obtenerListasPrecios ni por su guarda de "solo si esta vacia"
    const tras = await obtenerListasPrecios();
    assert.strictEqual(tras.length, cargadaAntes.length, 'un fallo NO debe pisar la lista ya cargada con []');
  } finally {
    restoreFail();
    _setBackoff429Base(2000);
    _resetListasPrecios();
  }
});

// === POST /api/crear-cliente flujo atomico POST+GET+PUT (issue #29) ===

const BASE_CLIENTE = {
  tax_id: 'NUE010101ABC', CustName: 'Nueva SA de CV',
  pais: 'MX', sales_type: 'M350', segmento_id: '3', salesman: 47,
  timbrado_uso_cfdi: 'G03',
  entrega: {
    br_name: 'Almacen Central', br_ref: 'ALMCEN',
    addr_street: 'Reforma', addr_exterior: '1', addr_interior: '',
    addr_colony: 'Juarez', addr_city: 'CDMX', addr_state: 'CDMX',
    addr_zip: '06600', addr_reference: '',
    phone: '5512345678', email: 'entrega@nueva.com', pais: 'MX',
  },
};

// BASE_CLIENTE trae segmento capturado, asi que desde #186 el alta completa toca la ficha
// web en TODOS estos tests. Sin montarla, cada uno pagaria los 15s del reintento con
// backoff de pedir() antes de reportar el fallo del post-fix.
//
// Es UNA instancia compartida por los tests del flujo POST+GET+PUT, que no assertan sobre
// ella: `posts`/`gets`/`estado` acumulan entre tests y dependerian del orden. Un test que
// necesite mirar lo que viajo a la web monta la suya (asi lo hacen D7-D10).
const FICHA_ALTA = handlersWebFichaCliente();

test('D1: POST /api/crear-cliente flujo completo retorna customer_id, branch_id y steps', async () => {
  _resetSesionWeb();
  const restore = mockOperamFetch({
    ...FICHA_ALTA.handlers,
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return { ok: true, json: async () => ({ result: true, customer_id: 500 }) };
      if (u.includes('/500')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 600 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/600': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send(BASE_CLIENTE);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.customer_id, 500, 'debe retornar customer_id');
    assert.strictEqual(res.body.branch_id, 600, 'debe retornar branch_id');
    assert.ok(Array.isArray(res.body.steps), 'debe retornar array steps');
    assert.strictEqual(res.body.steps.length, 5, 'debe tener 5 steps (POST, PUT dimensiones, post-fix segmento, GET branch_id, PUT branch)');
    assert.ok(res.body.steps.find(s => s.name === 'PUT customer (dimensiones)'), 'el alta nueva debe incluir el step de dimensiones');
    assert.ok(res.body.steps.every(s => s.name && s.status), 'cada step debe tener name y status');
    assert.ok(res.body.steps.every(s => s.status === 'ok'), 'todos los steps deben ser ok');
  } finally {
    restore();
  }
});

test('D1b: POST /api/crear-cliente envia invoice_email/celular_nota en notes y phone/email a nivel cliente (issues #16/#17/#18)', async () => {
  let postBody = null;
  _resetSesionWeb();
  const restore = mockOperamFetch({
    ...FICHA_ALTA.handlers,
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { postBody = JSON.parse(opts.body); return { ok: true, json: async () => ({ result: true, customer_id: 510 }) }; }
      if (u.includes('/510')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 610 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/610': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({
        ...BASE_CLIENTE,
        invoice_email: 'facturacion@nueva.com',
        celular_nota: '5599998888',
        phone: '+52 5512345678',
        email: 'entrega@nueva.com',
      });
    assert.strictEqual(res.status, 200);
    assert.ok(postBody, 'debe haber hecho POST /customers');
    assert.ok(postBody.notes.includes('facturacion@nueva.com'), 'notes debe incluir el email de facturacion');
    assert.ok(postBody.notes.includes('5599998888'), 'notes debe incluir el celular');
    assert.strictEqual(postBody.phone, '+52 5512345678', 'phone a nivel cliente debe ir en el POST a Operam');
    assert.strictEqual(postBody.email, 'entrega@nueva.com', 'email a nivel cliente debe ir en el POST a Operam');
  } finally {
    restore();
  }
});

test('D1c: POST /api/crear-cliente configura el domicilio con vendedor, area, almacen y tax_group (issue #74)', async () => {
  let branchBody = null;
  _resetSesionWeb();
  const restore = mockOperamFetch({
    ...FICHA_ALTA.handlers,
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return { ok: true, json: async () => ({ result: true, customer_id: 520 }) };
      if (u.includes('/520')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 620 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/620': (u, opts) => {
      branchBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ result: true }) };
    },
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send(BASE_CLIENTE);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.ok(branchBody, 'el alta debe configurar el domicilio (PUT /branches)');
    assert.strictEqual(branchBody.salesman, 47, 'el domicilio debe llevar el vendedor del alta');
    assert.strictEqual(branchBody.area, 1, 'el domicilio MX debe llevar area 1 (10 Mexico)');
    assert.strictEqual(branchBody.location, 40, 'el domicilio debe llevar almacen 40 (PT)');
    assert.strictEqual(branchBody.tax_group_id, 1, 'domicilio MX debe llevar tax_group_id 1 (gravado)');
    assert.strictEqual(branchBody.sales_account, '401-01-001', 'domicilio MX debe llevar la cuenta de ventas gravada (issue #189)');
  } finally {
    restore();
  }
});

test('D1d: POST /api/crear-cliente con domicilio extranjero usa tax_group exento (issue #74)', async () => {
  let branchBody = null;
  _resetSesionWeb();
  const restore = mockOperamFetch({
    ...FICHA_ALTA.handlers,
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return { ok: true, json: async () => ({ result: true, customer_id: 530 }) };
      if (u.includes('/530')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 630 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/630': (u, opts) => {
      branchBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ result: true }) };
    },
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ ...BASE_CLIENTE, entrega: { ...BASE_CLIENTE.entrega, pais: 'US' } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.ok(branchBody, 'el alta debe configurar el domicilio (PUT /branches)');
    assert.strictEqual(branchBody.tax_group_id, 2, 'domicilio extranjero debe llevar tax_group_id 2 (exento)');
    assert.strictEqual(branchBody.area, 5, 'domicilio US debe llevar area 5 (20 USA)');
    assert.strictEqual(branchBody.sales_account, '401-07-000', 'domicilio extranjero debe llevar la cuenta de ventas de exportacion (issue #189)');
  } finally {
    restore();
  }
});

test('D1e: POST /api/crear-cliente en alta NUEVA persiste dimension_id=1 y dimension2_id=5 via PUT /customers/:id (issue #74)', async () => {
  // El POST /customers de Operam IGNORA dimension_id/dimension2_id (los guarda en 0).
  // Solo un PUT /customers/:id los persiste. En un alta NUEVA debe correr ese PUT.
  let dimPutBody = null;
  _resetSesionWeb();
  const restore = mockOperamFetch({
    ...FICHA_ALTA.handlers,
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return { ok: true, json: async () => ({ result: true, customer_id: 540 }) };
      if (opts?.method === 'PUT' && u.includes('/540')) { dimPutBody = JSON.parse(opts.body); return { ok: true, json: async () => ({ result: true }) }; }
      if (u.includes('/540')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 640 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/640': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send(BASE_CLIENTE);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.ok(dimPutBody, 'el alta nueva debe hacer PUT /customers/:id para persistir dimensiones');
    assert.strictEqual(dimPutBody.dimension_id, 1, 'el PUT debe persistir dimension_id=1 (D1 Taller Casino de la Selva)');
    assert.strictEqual(dimPutBody.dimension2_id, 5, 'el PUT debe persistir dimension2_id=5 (D2 Corporativo)');
  } finally {
    restore();
  }
});

test('D2: POST /api/crear-cliente fallo en PUT branch retorna steps con error y customer_id/branch_id', async () => {
  _resetSesionWeb();
  const restore = mockOperamFetch({
    ...FICHA_ALTA.handlers,
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return { ok: true, json: async () => ({ result: true, customer_id: 501 }) };
      if (u.includes('/501')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 601 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/601': () => ({ ok: true, json: async () => ({ result: false, messages: ['Error en branch'] }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send(BASE_CLIENTE);
    assert.strictEqual(res.status, 200, 'respuesta debe ser 200 incluso con fallo en PUT');
    assert.strictEqual(res.body.ok, false, 'ok debe ser false cuando falla un paso');
    assert.strictEqual(res.body.customer_id, 501, 'debe retornar customer_id aunque falle el PUT');
    assert.strictEqual(res.body.branch_id, 601, 'debe retornar branch_id aunque falle el PUT');
    const putStep = res.body.steps.find(s => s.name === 'PUT branch');
    assert.ok(putStep, 'debe existir step PUT branch');
    assert.strictEqual(putStep.status, 'error', 'el step de PUT branch debe tener status error');
    assert.ok(putStep.error, 'el step de PUT branch debe incluir mensaje de error');
  } finally {
    restore();
  }
});

test('D3: POST /api/crear-cliente con customer_id existente salta POST y no duplica cliente', async () => {
  let postCustomerCalled = false;
  _resetSesionWeb();
  const restore = mockOperamFetch({
    ...FICHA_ALTA.handlers,
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { postCustomerCalled = true; return { ok: true, json: async () => ({ result: true, customer_id: 999 }) }; }
      if (u.includes('/502')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 602 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/602': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ ...BASE_CLIENTE, customer_id: 502 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.customer_id, 502, 'debe usar el customer_id existente');
    assert.ok(!postCustomerCalled, 'NO debe hacer POST /customers cuando ya se conoce el customer_id');
  } finally {
    restore();
  }
});

test('D4: POST /api/crear-cliente con customer_id existente actualiza sales_type/segmento_id/timbrado_uso_cfdi via PUT customers/:id (issue #11)', async () => {
  let putCustomerBody = null;
  let putCustomerCalled = false;
  _resetSesionWeb();
  const restore = mockOperamFetch({
    ...FICHA_ALTA.handlers,
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') { putCustomerCalled = true; putCustomerBody = JSON.parse(opts.body); return { ok: true, json: async () => ({ result: true }) }; }
      if (opts?.method === 'POST') return { ok: true, json: async () => ({ result: true, customer_id: 999 }) };
      if (u.includes('/503')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 603 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/603': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ ...BASE_CLIENTE, customer_id: 503 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.ok(putCustomerCalled, 'debe hacer PUT /customers/:id para cliente existente');
    assert.strictEqual(putCustomerBody.sales_type, BASE_CLIENTE.sales_type, 'debe enviar sales_type seleccionado');
    assert.strictEqual(putCustomerBody.segmento_id, BASE_CLIENTE.segmento_id, 'debe enviar segmento_id seleccionado');
    assert.strictEqual(putCustomerBody.timbrado_uso_cfdi, BASE_CLIENTE.timbrado_uso_cfdi, 'debe enviar timbrado_uso_cfdi seleccionado');
    // issue #187: salesman es campo de la sucursal, no del cliente -- el PUT de
    // customers/:id no debe mandarlo (el vendedor SI se escribe, pero via PUT /branches,
    // cubierto por el assert de branchBody.salesman en D1c).
    assert.ok(!('salesman' in putCustomerBody), 'salesman NO debe viajar en el PUT de customers (es campo de la sucursal)');
    const putCustomerStep = res.body.steps.find(s => s.name === 'PUT customer (config comercial)');
    assert.ok(putCustomerStep, 'debe existir step PUT customer (config comercial)');
    assert.strictEqual(putCustomerStep.status, 'ok');
  } finally {
    restore();
  }
});

test('D5: POST /api/crear-cliente cliente nuevo NO hace PUT customers/:id de config comercial (ya viaja en el POST)', async () => {
  // El alta nueva SI hace un PUT /customers/:id para persistir dimensiones (#74, el
  // POST las ignora). Lo que NO debe hacer es un PUT de CONFIG COMERCIAL
  // (sales_type/segmento_id/salesman/timbrado), que ya viajo en el POST. Se captura
  // el body de cualquier PUT para verificar que solo lleva dimensiones.
  let putCustomerBody = null;
  _resetSesionWeb();
  const restore = mockOperamFetch({
    ...FICHA_ALTA.handlers,
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') { putCustomerBody = JSON.parse(opts.body); return { ok: true, json: async () => ({ result: true }) }; }
      if (opts?.method === 'POST') return { ok: true, json: async () => ({ result: true, customer_id: 504 }) };
      if (u.includes('/504')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 604 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/604': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send(BASE_CLIENTE);
    assert.strictEqual(res.status, 200);
    assert.ok(!res.body.steps.find(s => s.name === 'PUT customer (config comercial)'), 'no debe existir el step de config comercial para cliente nuevo');
    assert.ok(putCustomerBody, 'el alta nueva hace un PUT (de dimensiones)');
    assert.ok(!('sales_type' in putCustomerBody), 'el PUT del alta nueva NO debe llevar config comercial (sales_type ya fue en el POST)');
    assert.ok(!('segmento_id' in putCustomerBody), 'el PUT del alta nueva NO debe llevar config comercial (segmento_id ya fue en el POST)');
  } finally {
    restore();
  }
});

test('D6: POST /api/crear-cliente fallo en PUT customer (config comercial) retorna step con error sin bloquear PUT branch posterior', async () => {
  _resetSesionWeb();
  const restore = mockOperamFetch({
    ...FICHA_ALTA.handlers,
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') return { ok: true, json: async () => ({ result: false, messages: ['No se pudo actualizar'] }) };
      if (u.includes('/505')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 605 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/605': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ ...BASE_CLIENTE, customer_id: 505 });
    assert.strictEqual(res.status, 200);
    const putCustomerStep = res.body.steps.find(s => s.name === 'PUT customer (config comercial)');
    assert.ok(putCustomerStep, 'debe existir el step aunque falle');
    assert.strictEqual(putCustomerStep.status, 'error');
    assert.ok(putCustomerStep.error, 'debe incluir mensaje de error');
    const putBranchStep = res.body.steps.find(s => s.name === 'PUT branch');
    assert.ok(putBranchStep, 'PUT branch debe seguir ejecutandose pese al fallo de config comercial');
    assert.strictEqual(putBranchStep.status, 'ok');
  } finally {
    restore();
  }
});

// === Post-fix del segmento en el alta completa (issue #186) ===
//
// segmento_id no pega por la API v3 en NINGUNA de las dos ramas: ni el POST /customers
// del alta nueva ni el PUT bundleado del Step 1b lo persisten (#172, sondeo en vivo). El
// segmento que el vendedor eligio se perdia en silencio; lo escribe el mismo post-fix web
// que ya usaba el upgrade fiscal.

test('D7: alta NUEVA con segmento capturado -> el post-fix web lo escribe en la ficha del cliente creado', async () => {
  _resetSesionWeb();
  const web = handlersWebFichaCliente();
  const restore = mockOperamFetch({
    ...web.handlers,
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') return { ok: true, json: async () => ({ result: true }) };
      if (opts?.method === 'POST') return { ok: true, json: async () => ({ result: true, customer_id: 540 }) };
      if (u.includes('/540')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 640 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/640': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send(BASE_CLIENTE);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.deepEqual(web.gets, ['540'], 'pide la ficha del cliente que acaba de crear');
    assert.strictEqual(web.posts.length, 1, 'un solo POST a la ficha');
    assert.strictEqual(web.posts[0].get('segmento_id'), BASE_CLIENTE.segmento_id);
    assert.strictEqual(web.posts[0].get('process'), 'Actualizar Cliente', 'el submit real de la ficha');
    assert.strictEqual(web.estado.segmento, BASE_CLIENTE.segmento_id, 'el segmento quedo escrito');
    const paso = res.body.steps.find(s => s.name === 'post-fix segmento (web)');
    assert.ok(paso, 'el vendedor tiene que ver el paso en el panel de alta');
    assert.strictEqual(paso.status, 'ok');
  } finally {
    restore();
  }
});

test('D8: cliente EXISTENTE (Step 1b) -> el post-fix web tambien corre (el PUT bundleado no persiste el segmento)', async () => {
  _resetSesionWeb();
  const web = handlersWebFichaCliente();
  const restore = mockOperamFetch({
    ...web.handlers,
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') return { ok: true, json: async () => ({ result: true }) };
      if (u.includes('/541')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 641 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/641': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ ...BASE_CLIENTE, customer_id: 541 });
    assert.strictEqual(res.status, 200);
    assert.deepEqual(web.gets, ['541'], 'la ficha es la del cliente elegido por dedup, no la de uno nuevo');
    assert.strictEqual(web.estado.segmento, BASE_CLIENTE.segmento_id);
    assert.strictEqual(res.body.steps.find(s => s.name === 'post-fix segmento (web)').status, 'ok');
  } finally {
    restore();
  }
});

test('D9: sin segmento capturado el alta NO toca la web legacy', async () => {
  _resetSesionWeb();
  const web = handlersWebFichaCliente();
  const restore = mockOperamFetch({
    ...web.handlers,
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') return { ok: true, json: async () => ({ result: true }) };
      if (opts?.method === 'POST') return { ok: true, json: async () => ({ result: true, customer_id: 542 }) };
      if (u.includes('/542')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 642 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/642': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ ...BASE_CLIENTE, segmento_id: '' });
    assert.strictEqual(res.status, 200);
    assert.deepEqual(web.gets, [], 'sin segmento capturado no hay nada que corregir');
    assert.deepEqual(web.posts, []);
    assert.ok(!res.body.steps.find(s => s.name === 'post-fix segmento (web)'), 'ni step: el paso no corrio');
  } finally {
    restore();
  }
});

// Trampa 1 de #172: con el CP vacio FA rechaza el guardado ENTERO y la unica senal es el
// err_msg. Un cliente existente elegido por dedup puede estar asi en Operam. El alta NO
// puede caerse por eso -- el domicilio (PUT branch) es lo critico para terminar -- y el
// motivo REAL de la web es lo unico que le dice al vendedor que hacer.
test('D10: la web rechaza el guardado -> el alta termina igual y el step lleva el motivo real', async () => {
  _resetSesionWeb();
  const web = handlersWebFichaCliente({ err: 'El codigo postal no puede ser vacio' });
  const restore = mockOperamFetch({
    ...web.handlers,
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') return { ok: true, json: async () => ({ result: true }) };
      if (u.includes('/543')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 643 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/643': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ ...BASE_CLIENTE, customer_id: 543 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true, 'un fallo del post-fix no puede impedir terminar el alta');
    assert.strictEqual(res.body.steps.find(s => s.name === 'PUT branch').status, 'ok', 'el domicilio sigue siendo lo critico y se configuro');
    const paso = res.body.steps.find(s => s.name === 'post-fix segmento (web)');
    assert.strictEqual(paso.status, 'error');
    assert.match(paso.error, /codigo postal/i, 'el motivo REAL de la web, no uno generico');
  } finally {
    restore();
  }
});

// Regla de #186 (decision de Adrian): a un cliente que YA existe solo se le escribe el
// segmento si estaba en "Sin segmento". Un cliente clasificado antes -- en Operam o por
// otro vendedor -- no pierde su clasificacion porque en esta alta se eligiera otra cosa.
// El upgrade fiscal NO sigue esta regla: ahi el vendedor edita la ficha a proposito.
test('D11: cliente existente YA clasificado -> se conserva su segmento, no se repostea la ficha', async () => {
  _resetSesionWeb();
  const web = handlersWebFichaCliente({ segmentoInicial: '10' });
  const restore = mockOperamFetch({
    ...web.handlers,
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') return { ok: true, json: async () => ({ result: true }) };
      if (u.includes('/544')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 644 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/644': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ ...BASE_CLIENTE, customer_id: 544, segmento_id: '14' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.deepEqual(web.gets, ['544'], 'lee la ficha: es la unica forma de saber como esta hoy');
    assert.deepEqual(web.posts, [], 'pero NO escribe: el cliente ya estaba clasificado');
    assert.strictEqual(web.estado.segmento, '10', 'conserva el segmento que tenia en Operam');
    const paso = res.body.steps.find(s => s.name === 'post-fix segmento (web)');
    assert.strictEqual(paso.status, 'ok');
    assert.strictEqual(paso.info, 'conservado', 'el vendedor debe ver que su seleccion no se aplico y por que');
  } finally {
    restore();
  }
});

test('D12: cliente existente en "Sin segmento" -> se le escribe el capturado', async () => {
  _resetSesionWeb();
  const web = handlersWebFichaCliente({ segmentoInicial: '1' });
  const restore = mockOperamFetch({
    ...web.handlers,
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') return { ok: true, json: async () => ({ result: true }) };
      if (u.includes('/545')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 645 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/645': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ ...BASE_CLIENTE, customer_id: 545, segmento_id: '14' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(web.posts.length, 1, 'sin clasificar previa: aqui si se escribe');
    assert.strictEqual(web.posts[0].get('segmento_id'), '14');
    assert.strictEqual(web.estado.segmento, '14');
    assert.strictEqual(res.body.steps.find(s => s.name === 'post-fix segmento (web)').status, 'ok');
  } finally {
    restore();
  }
});

// === GET /api/buscar-cliente-duplicado (issue #31) ===

test('E1: GET /api/buscar-cliente-duplicado retorna exacto cuando RFC real ya existe en Operam', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    // Solo responde a tax_id: el ?search= no indexa el RFC (#194).
    '/api/v3/sales/customers': (u) => ({ ok: true, json: async () => (
      u.includes('tax_id=PNA010203ABC')
        ? { total: 1, data: [{ customer_id: 77, CustName: 'Peltre Nacional SA de CV', cust_ref: 'PELTRE', tax_id: 'PNA010203ABC' }] }
        : { total: 0, data: [] }
    ) }),
  });
  try {
    const res = await supertest(app)
      .get('/api/buscar-cliente-duplicado?rfc=PNA010203ABC&nombre=Peltre+Nacional')
      .set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.tipo, 'exacto');
    assert.ok(res.body.cliente, 'debe incluir cliente');
    assert.strictEqual(res.body.cliente.id, 77);
  } finally {
    restore();
  }
});

test('E2: GET /api/buscar-cliente-duplicado retorna candidatos para RFC generico con nombre similar', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    // Solo responde a tax_id: el ?search= no indexa el RFC (#194).
    '/api/v3/sales/customers': (u) => ({ ok: true, json: async () => (
      u.includes('tax_id=XAXX010101000')
        ? { total: 2, data: [
            { customer_id: 10, CustName: 'Comercio General SA de CV', cust_ref: 'COGEN', tax_id: 'XAXX010101000' },
            { customer_id: 11, CustName: 'Comercializadora Norte SA de CV', cust_ref: 'COGNOR', tax_id: 'XAXX010101000' },
          ] }
        : { total: 0, data: [] }
    ) }),
  });
  try {
    const res = await supertest(app)
      .get('/api/buscar-cliente-duplicado?rfc=XAXX010101000&nombre=Comercio+General+Mayorista')
      .set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.tipo, 'candidatos');
    assert.ok(Array.isArray(res.body.candidatos), 'debe incluir array candidatos');
    assert.ok(res.body.candidatos.length >= 1);
  } finally {
    restore();
  }
});

test('E3: GET /api/buscar-cliente-duplicado sin token retorna 401', async () => {
  const res = await supertest(app).get('/api/buscar-cliente-duplicado?rfc=PNA010203ABC&nombre=Peltre');
  assert.strictEqual(res.status, 401);
});

test('E4: GET /api/buscar-cliente-duplicado retorna libre cuando no hay match', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': () => ({ ok: true, json: async () => ({ total: 0, data: [] }) }),
  });
  try {
    const res = await supertest(app)
      .get('/api/buscar-cliente-duplicado?rfc=NUE990101ZZZ&nombre=Nueva+Empresa')
      .set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.tipo, 'libre');
  } finally {
    restore();
  }
});

// E5-E7: issue #78 -- RFC real sin match exacto tambien busca entre clientes
// con RFC generico (el cliente pudo darse de alta sin CSF).
test('E5: GET /api/buscar-cliente-duplicado con RFC real sin match exacto busca tambien candidatos con RFC generico por nombre', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u) => {
      if (u.includes('tax_id=ISI1801183Z4')) return { ok: true, json: async () => ({ total: 0, data: [] }) };
      if (u.includes('tax_id=XAXX010101000')) return { ok: true, json: async () => ({
        total: 1,
        data: [{ customer_id: 30, CustName: 'Siscani Group SA de CV', cust_ref: 'SISCANI', tax_id: 'XAXX010101000' }],
      }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
  });
  try {
    const res = await supertest(app)
      // Dos tokens en comun con "Siscani Group SA de CV" (#204): el umbral de la
      // senal de nombre subio a 2 y el nombre corto del caso real se detecta hoy
      // por telefono, que es la ruta de E6.
      .get('/api/buscar-cliente-duplicado?rfc=ISI1801183Z4&nombre=Importaciones+Siscani+Group')
      .set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.tipo, 'candidatos');
    assert.ok(res.body.candidatos.some(c => c.id === 30), 'debe incluir el candidato Siscani Group con RFC generico');
  } finally {
    restore();
  }
});

test('E6: GET /api/buscar-cliente-duplicado con RFC real, sin match de nombre pero con telefono coincidente marca candidato', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u) => {
      if (u.includes('tax_id=NUE990101ZZZ')) return { ok: true, json: async () => ({ total: 0, data: [] }) };
      if (u.includes('tax_id=XAXX010101000')) return { ok: true, json: async () => ({
        total: 1,
        data: [{ customer_id: 40, CustName: 'Grupo ABC', cust_ref: 'ABC', tax_id: 'XAXX010101000', contacts: [{ phone: '55 1234 5678' }] }],
      }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
  });
  try {
    const res = await supertest(app)
      .get('/api/buscar-cliente-duplicado?rfc=NUE990101ZZZ&nombre=Nombre+Distinto&telefono=5512345678')
      .set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.tipo, 'candidatos');
    assert.ok(res.body.candidatos.some(c => c.id === 40), 'debe marcar candidato por telefono');
  } finally {
    restore();
  }
});

test('E7: GET /api/buscar-cliente-duplicado con RFC real que si tiene match exacto NO busca genericos (no degrada el caso ya cubierto)', async () => {
  let searchoGenericos = false;
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u) => {
      if (u.includes('tax_id=PNA010203ABC')) return { ok: true, json: async () => ({
        total: 1,
        data: [{ customer_id: 77, CustName: 'Peltre Nacional SA de CV', cust_ref: 'PELTRE', tax_id: 'PNA010203ABC' }],
      }) };
      if (u.includes('tax_id=XAXX010101000') || u.includes('tax_id=XEXX010101000')) {
        searchoGenericos = true;
        return { ok: true, json: async () => ({ total: 0, data: [] }) };
      }
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
  });
  try {
    const res = await supertest(app)
      .get('/api/buscar-cliente-duplicado?rfc=PNA010203ABC&nombre=Peltre+Nacional')
      .set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.tipo, 'exacto');
    assert.strictEqual(searchoGenericos, false, 'con match exacto no debe gastar llamadas extra buscando genericos');
  } finally {
    restore();
  }
});

// E8-E9: issue #194 -- el ?search= de Operam busca por NOMBRE y NO indexa el RFC.
// Estos dos mocks responden SOLO a tax_id: si el endpoint volviera a buscar por
// search, el pool llegaria vacio y la respuesta seria 'libre' (el bug original).
test('E8: GET /api/buscar-cliente-duplicado encuentra al cliente aunque el buscador por nombre no devuelva nada (#194)', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u) => {
      if (u.includes('tax_id=PSE860101AB1')) return { ok: true, json: async () => ({
        total: 1,
        data: [{ customer_id: 496, CustName: 'PRUEBA 186 ALTA COMPLETA', cust_ref: 'PRUEBA186', tax_id: 'PSE860101AB1' }],
      }) };
      // El buscador por nombre no indexa el RFC: responde vacio, como en vivo.
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
  });
  try {
    const res = await supertest(app)
      .get('/api/buscar-cliente-duplicado?rfc=PSE860101AB1&nombre=Prueba+186')
      .set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.tipo, 'exacto');
    assert.strictEqual(res.body.cliente.id, 496);
  } finally {
    restore();
  }
});

test('E9: el pool de genericos del rescate #78 tambien se pide por tax_id (#194)', async () => {
  const urls = [];
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u) => {
      urls.push(u);
      if (u.includes('tax_id=XAXX010101000')) return { ok: true, json: async () => ({
        total: 1,
        data: [{ customer_id: 495, CustName: 'PRUEBA 186 GENERICO', cust_ref: 'PRUEBA186', tax_id: 'XAXX010101000' }],
      }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
  });
  try {
    const res = await supertest(app)
      .get('/api/buscar-cliente-duplicado?rfc=NUE990101ZZZ&nombre=PRUEBA+186+GENERICO')
      .set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.tipo, 'candidatos');
    assert.ok(res.body.candidatos.some(c => c.id === 495), 'el generico entra al pool');
    assert.ok(urls.every(u => !u.includes('search=')), 'ninguna consulta usa el buscador por nombre');
  } finally {
    restore();
  }
});

// === Webhook de Operam (sync post-venta, #62) ===
// Auth por header secreto (NO el JWT del cotizador: Operam no lo tiene). El webhook
// es solo una señal; la reconciliacion lee la verdad por API. Sin DATABASE_URL el
// log es graceful (no rompe). Responde 200 aunque no se ligue a una oportunidad.

const WEBHOOK_SECRET = 'test-webhook-secret';

test('W1: POST /api/webhooks/operam sin header secreto retorna 401', async () => {
  process.env.OPERAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  const res = await supertest(app).post('/api/webhooks/operam').send({ order_: '7077' });
  assert.strictEqual(res.status, 401);
});

test('W2: POST /api/webhooks/operam con header secreto incorrecto retorna 401', async () => {
  process.env.OPERAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  const res = await supertest(app)
    .post('/api/webhooks/operam')
    .set('X-Operam-Webhook-Secret', 'mal')
    .send({ order_: '7077' });
  assert.strictEqual(res.status, 401);
});

test('W3: POST /api/webhooks/operam con secreto correcto pero RFC desconocido responde 200 sin mover nada', async () => {
  process.env.OPERAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  const snap = readCots();
  const res = await supertest(app)
    .post('/api/webhooks/operam')
    .set('X-Operam-Webhook-Secret', WEBHOOK_SECRET)
    .send({ model: 'Payment', event: 'ADD', tax_id: 'ZZZ999999ZZZ', order_: '0' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.ok, true);
  // No se ligo a ninguna oportunidad.
  assert.ok(Array.isArray(res.body.reconciliadas));
  assert.strictEqual(res.body.reconciliadas.length, 0);
  // No toco el store.
  assert.deepEqual(readCots(), snap);
});

test('W4: POST /api/webhooks/operam liga por RFC y mueve la oportunidad leyendo Operam', async () => {
  process.env.OPERAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  // Oportunidad en seguimiento del RFC del webhook.
  writeCots([{ id: 5001, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', cliente: 'EL PENDULO',
    etapa: 'seguimiento', data: { cliente: { rfc: 'CPE921211N76' } } }]);
  // Operam: factura (10) liquidada + remision (13) + pedido (30) -> producto_entregado.
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/transactions': () => ({ ok: true, json: async () => ({ data: [
      { type: '10', order_: '7077', total_amount: '16954', allocated: '16954', outstanding: '0', debtor_no: '345' },
      { type: '13', order_: '7077', total_amount: '16954', allocated: '0', outstanding: '0', debtor_no: '345' },
    ] }) }),
    '/api/v3/sales/sales_orders': () => ({ ok: true, json: async () => ({ data: [
      { order_no: '7077', trans_type: '30', debtor_no: '345' },
    ] }) }),
  });
  try {
    const res = await supertest(app)
      .post('/api/webhooks/operam')
      .set('X-Operam-Webhook-Secret', WEBHOOK_SECRET)
      .send({ model: 'CustDelivery', event: 'ADD', tax_id: 'CPE921211N76', order_: '7077' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.reconciliadas.length, 1);
    assert.strictEqual(res.body.reconciliadas[0].etapa, 'producto_entregado');
    const movida = readCots().find(c => c.id === 5001);
    assert.strictEqual(movida.etapa, 'producto_entregado');
  } finally {
    restore();
  }
});

test('W5: POST /api/webhooks/operam con Operam caido responde 200 (no truena el webhook)', async () => {
  process.env.OPERAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  writeCots([{ id: 5002, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', cliente: 'X',
    etapa: 'seguimiento', data: { cliente: { rfc: 'CPE921211N76' } } }]);
  const restore = mockOperamFetch({ '/api/v3/login': () => { throw new Error('timeout'); } });
  try {
    const res = await supertest(app)
      .post('/api/webhooks/operam')
      .set('X-Operam-Webhook-Secret', WEBHOOK_SECRET)
      .send({ model: 'Payment', event: 'ADD', tax_id: 'CPE921211N76', order_: '7077' });
    assert.strictEqual(res.status, 200);
  } finally {
    restore();
  }
});

// === Reconciliacion on-demand (#62 F4, red de seguridad) ===
// Ruta autenticada con el JWT del cotizador que reconcilia las oportunidades
// activas no terminadas leyendo Operam. No recorre el historico, solo candidatas.

test('S1: POST /api/sync-operam sin token retorna 401', async () => {
  const res = await supertest(app).post('/api/sync-operam');
  assert.strictEqual(res.status, 401);
});

test('S2: POST /api/sync-operam reconcilia las oportunidades activas y mueve las que avanzan', async () => {
  writeCots([
    { id: 6001, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', cliente: 'EL PENDULO',
      etapa: 'seguimiento', data: { cliente: { rfc: 'CPE921211N76' } } },
    // Sin RFC: no es candidata a Operam, se ignora sin tronar.
    { id: 6002, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', cliente: 'SIN RFC',
      etapa: 'seguimiento', data: { cliente: {} } },
    // Terminada: no se reconcilia.
    { id: 6003, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', cliente: 'ENTREGADA',
      etapa: 'producto_entregado', data: { cliente: { rfc: 'OTRO010101AAA' } } },
  ]);
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/transactions': () => ({ ok: true, json: async () => ({ data: [
      { type: '10', order_: '7400', total_amount: '2000', allocated: '500', outstanding: '1500', debtor_no: '345' },
    ] }) }),
    '/api/v3/sales/sales_orders': () => ({ ok: true, json: async () => ({ data: [] }) }),
  });
  try {
    const res = await supertest(app).post('/api/sync-operam').set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    const movida = readCots().find(c => c.id === 6001);
    assert.strictEqual(movida.etapa, 'anticipo_pagado');
    // No movio la terminada.
    assert.strictEqual(readCots().find(c => c.id === 6003).etapa, 'producto_entregado');
  } finally {
    restore();
  }
});

// === POST /api/cotizacion/operam/:id — issue #68 ===
// Un cliente no identificado NO es un fallo de disponibilidad de Operam (503): es un
// problema de datos de la cotizacion. Debe responder 422 con mensaje claro, no subir,
// y no persistir folio. Un exito sube y persiste el folio.

test('O68: subir a Operam con RFC que matchea sube al cliente correcto y persiste folio', async () => {
  const snap = readCots();
  const id = (snap.reduce((m, c) => Math.max(m, c.id), 0)) + 1;
  writeCots([...snap, {
    id, fecha: '2026-06-17T00:00:00Z', vendedor: 'Tester', cliente: 'EL PENDULO',
    totalPiezas: 10, total: 1000, tier: 'Mayoreo',
    data: {
      fecha: '2026-06-17', vigencia: '2026-07-17',
      cliente: { rfc: 'CPE921211N76', razonSocial: 'El Pendulo', referencia: 'OC-9', nombreEntrega: 'Almacen' },
      items: [{ codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 10, precio: 100, descuento: 0 }],
    },
  }]);
  let quoteBody = null;
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': () => ({ ok: true, json: async () => ({ total: 1, data: [{ customer_id: 314, tax_id: 'CPE921211N76', CustName: 'El Pendulo', branches: [{ branch_code: 88 }] }] }) }),
    '/api/v3/sales/quote': (u, opts) => { quoteBody = JSON.parse(opts.body); return { ok: true, json: async () => ({ result: true, quote_id: 1600 }) }; },
    // Sin esto, si ya existe sesionCompartida viva de un test anterior (#172/#186), el
    // post-fix de vigencia (server.js postFixVigencia) manda un GET real a la web legacy
    // que cae en el retry con backoff de pedir() (1+2+4+8 = 15s) antes de rendirse (#188).
    // Mismo patron minimo que #114-6.
    'trans_type=30': () => ({ headers: {}, text: async () => '<html>login ok</html>' }),
    'trans_type=32': () => ({ headers: {}, text: async () => '<html></html>' }),
    'sales_order_entry.php': () => ({ headers: {}, text: async () => '<html></html>' }),
  });
  try {
    const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.folio, 1600);
    assert.strictEqual(quoteBody.customer_id, 314, 'el quote debe ir al cliente correcto');
    const guardada = readCots().find(c => c.id === id);
    assert.ok(String(guardada.data.folioOperam || guardada.folioOperam || '').includes('1600'), 'debe persistir el folio');
  } finally {
    restore();
  }
});

// === POST /api/cotizacion/operam/:id/actualizar — issue #104 (ADR-0008) ===
// Doble de la web legacy de FrontAccounting. El PARSEO real esta cubierto contra el
// HTML de produccion en test/operam-web.test.js (fixtures capturados de los quotes de
// prueba 1199/1200); lo que se prueba aqui es la ORQUESTACION del endpoint, asi que
// basta un formulario con la misma FORMA (cart_id, delivery_date, Comments, cust_ref y
// un boton Delete{n} por partida) sobre un carrito en memoria que reacciona igual que
// FA: Delete0 y AddItem mutan la "sesion", y solo ProcessOrder escribe el documento.
function mockOperamWebLegacy({ lineasIniciales = ['SKU-VIEJO'], romperAddItem = false } = {}) {
  const sesion = { carrito: lineasIniciales.map(s => ({ stockId: s, qty: 1, price: 1, disc: 0 })) };
  const doc = { lineas: lineasIniciales.map(s => ({ stockId: s, qty: 1, price: 1, disc: 0 })), comments: 'viejo', custRef: '', vigencia: '2026-01-01' };
  const bitacora = [];
  const formHtml = () => `<form method='post' action='/sales/sales_order_entry.php'>
<input type="hidden" name="cart_id" value='CART1'>
<input type="hidden" name="customer_id" value='376'>
<input type="hidden" name="_token" value='TOK'>
${sesion.carrito.map((l, i) => `<a href='../inventory/inquiry/stock_status.php?stock_id=${l.stockId}'>x</a><button type='submit' name='Delete${i}' value='1'></button>`).join('\n')}
<input type="text" name="stock_id" value=''>
<input type="text" name="qty" value="1">
<input type="text" name="price" value="0.00">
<input type="text" name="Disc" value="0.0">
<input type="text" name="delivery_date" value="${doc.vigencia}">
<input type="text" name="cust_ref" value="${doc.custRef}">
<textarea name="Comments">${doc.comments}</textarea>
<button type='submit' name='ProcessOrder' value='Confirmar Cambios'></button>
<button type='submit' name='CancelOrder' value='Cancelar Cotización'></button>
</form>`;
  const vistaHtml = () => `<table>
<tr><td class='tableheader2'>Valido hasta</td><td id=''>${doc.vigencia}</td></tr>
<tr><td class='tableheader2'>Comentarios</td>
<td colspan=3 id=''>${doc.comments.split('\n').join('<br />\n')}</td>
</tr></table>
<table>${doc.lineas.map(l => `<tr class='evenrow'>
<td><a href='../../inventory/inquiry/stock_status.php?stock_id=${l.stockId}'>${l.stockId}</a></td><td >Desc catalogo</td>
<td align=right nowrap>${l.qty}</td>
<td >pza</td>
<td nowrap align=right >${l.price.toFixed(2)}</td>
<td nowrap align=right >${l.disc.toFixed(2)}</td>
<td nowrap align=right >0.00</td>
<td nowrap align=right>0</td>
</tr>`).join('')}</table>`;
  const restore = mockOperamFetch({
    'trans_type=30': () => ({ headers: {}, text: async () => '<html>login ok</html>' }),
    'ModifyQuotationNumber': () => ({ headers: {}, text: async () => formHtml() }),
    'trans_type=32': () => ({ headers: {}, text: async () => vistaHtml() }),
    'sales_order_entry.php': (u, opts) => {
      const p = new URLSearchParams(opts.body || '');
      if (p.has('CancelOrder')) throw new Error('JAMAS debe mandarse CancelOrder');
      bitacora.push([...p.keys()].find(k => /^(Delete0|AddItem|ProcessOrder)$/.test(k)) || 'desconocido');
      if (p.has('Delete0')) sesion.carrito.shift();
      else if (p.has('AddItem')) {
        if (!romperAddItem) sesion.carrito.push({ stockId: p.get('stock_id'), qty: Number(p.get('qty')), price: Number(p.get('price')), disc: Number(p.get('Disc')) });
      } else if (p.has('ProcessOrder')) {
        doc.lineas = sesion.carrito.map(l => ({ ...l }));
        doc.comments = p.get('Comments');
        doc.custRef = p.get('cust_ref');
        doc.vigencia = p.get('delivery_date');
      }
      return { headers: {}, text: async () => formHtml() };
    },
  });
  return { restore, doc, bitacora };
}

function cotizacionActualizable(extra = {}) {
  const snap = readCots();
  const id = (snap.reduce((m, c) => Math.max(m, c.id), 0)) + 1;
  writeCots([...snap, {
    id, fecha: '2026-07-28T00:00:00Z', vendedor: 'Tester', cliente: 'EL PENDULO',
    totalPiezas: 3, total: 300, tier: 'Mayoreo', folioOperam: '1200',
    data: {
      fecha: '2026-07-28', vigencia: '2026-08-27',
      cliente: { rfc: 'CPE921211N76', razonSocial: 'El Pendulo', nombreCorto: 'Pendulo', cpEntrega: '56530' },
      notas: ['Nota nueva.'],
      items: [{ codigo: 'SKU-NUEVO', descripcion: 'Plato', cantidad: 3, precio: 99.5, descuento: 0 }],
      ...extra,
    },
  }]);
  return id;
}

test('A104: actualizar reescribe el quote (borra las viejas, agrega las nuevas) y confirma UNA sola vez', async () => {
  const { _resetSesionWeb } = await import('../lib/operam-web.js');
  _resetSesionWeb();
  const id = cotizacionActualizable();
  const { restore, doc, bitacora } = mockOperamWebLegacy({ lineasIniciales: ['SKU-VIEJO', 'SKU-VIEJO-2'] });
  try {
    const res = await supertest(app).post(`/api/cotizacion/operam/${id}/actualizar`).set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true, JSON.stringify(res.body));
    assert.strictEqual(res.body.folio, '1200', 'el folio se conserva');
    assert.deepStrictEqual(bitacora, ['Delete0', 'Delete0', 'AddItem', 'ProcessOrder']);
    assert.deepStrictEqual(doc.lineas.map(l => l.stockId), ['SKU-NUEVO']);
    assert.strictEqual(doc.lineas[0].qty, 3);
    assert.strictEqual(doc.lineas[0].price, 99.5);
    // el header nuevo viaja en el MISMO ProcessOrder: en este camino no hace falta
    // el post-fix separado de la vigencia (#106)
    assert.strictEqual(doc.vigencia, '2026-08-27');
    assert.match(doc.comments, /Nota nueva/);
    assert.match(doc.comments, /Valido hasta: 2026-08-27/);
    assert.strictEqual(doc.custRef, 'Pendulo');
  } finally {
    restore();
  }
});

test('A104: si FA no agrega una partida se ABORTA sin ProcessOrder y el quote queda intacto', async () => {
  const { _resetSesionWeb } = await import('../lib/operam-web.js');
  _resetSesionWeb();
  const id = cotizacionActualizable();
  const { restore, doc, bitacora } = mockOperamWebLegacy({ lineasIniciales: ['SKU-VIEJO'], romperAddItem: true });
  try {
    const res = await supertest(app).post(`/api/cotizacion/operam/${id}/actualizar`).set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.escrito, false, 'no se llego a confirmar: el documento sigue intacto');
    assert.ok(!bitacora.includes('ProcessOrder'), 'NUNCA debe confirmarse una reescritura a medias');
    assert.deepStrictEqual(doc.lineas.map(l => l.stockId), ['SKU-VIEJO']);
    // la cotizacion queda marcada para reintento (analogo al estado PRE de la subida)
    const guardada = readCots().find(c => c.id === id);
    assert.ok(guardada.data.quoteDesactualizado, 'debe quedar marcada como desactualizada');
    assert.strictEqual(guardada.data.quoteDesactualizado.escrito, false);
  } finally {
    restore();
  }
});

test('A104: si la cotizacion apunta a OTRO cliente se aborta sin escribir (no se cambia el cliente del quote)', async () => {
  const { _resetSesionWeb } = await import('../lib/operam-web.js');
  _resetSesionWeb();
  const id = cotizacionActualizable({
    cliente: { rfc: 'CPE921211N76', razonSocial: 'Otro SA', nombreCorto: 'Otro', customerId: 999, cpEntrega: '56530' },
  });
  const { restore, doc, bitacora } = mockOperamWebLegacy();
  try {
    const res = await supertest(app).post(`/api/cotizacion/operam/${id}/actualizar`).set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.body.ok, false);
    assert.strictEqual(res.body.escrito, false);
    assert.match(res.body.error, /cliente/i);
    assert.deepStrictEqual(bitacora, [], 'no debe mandar ningun POST de escritura');
    assert.deepStrictEqual(doc.lineas.map(l => l.stockId), ['SKU-VIEJO']);
  } finally {
    restore();
  }
});

test('A104: con el MISMO cliente que el quote la actualizacion procede', async () => {
  const { _resetSesionWeb } = await import('../lib/operam-web.js');
  _resetSesionWeb();
  const id = cotizacionActualizable({
    cliente: { rfc: 'CPE921211N76', razonSocial: 'El Pendulo', nombreCorto: 'Pendulo', customerId: 376, cpEntrega: '56530' },
  });
  const { restore, doc } = mockOperamWebLegacy();
  try {
    const res = await supertest(app).post(`/api/cotizacion/operam/${id}/actualizar`).set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.body.ok, true, JSON.stringify(res.body));
    assert.deepStrictEqual(doc.lineas.map(l => l.stockId), ['SKU-NUEVO']);
  } finally {
    restore();
  }
});

test('A104: una cotizacion con pedido asociado NO se puede actualizar (409, sin tocar Operam)', async () => {
  const { _resetSesionWeb } = await import('../lib/operam-web.js');
  _resetSesionWeb();
  const id = cotizacionActualizable({ orderOperam: '7077' });
  const { restore, bitacora } = mockOperamWebLegacy();
  try {
    const res = await supertest(app).post(`/api/cotizacion/operam/${id}/actualizar`).set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 409);
    assert.match(res.body.error, /pedido/i);
    assert.deepStrictEqual(bitacora, [], 'no debe tocar la web legacy');
  } finally {
    restore();
  }
});

test('A104: una cotizacion PRE (sin folio) no se actualiza: primero hay que subirla', async () => {
  const snap = readCots();
  const id = (snap.reduce((m, c) => Math.max(m, c.id), 0)) + 1;
  writeCots([...snap, {
    id, fecha: '2026-07-28T00:00:00Z', vendedor: 'Tester', cliente: 'PRE', totalPiezas: 1, total: 1, tier: 'Mayoreo',
    data: { cliente: { rfc: 'CPE921211N76' }, items: [{ codigo: 'X', descripcion: 'X', cantidad: 1, precio: 1, descuento: 0 }] },
  }]);
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}/actualizar`).set('Authorization', `Bearer ${TEST_TOKEN}`);
  assert.strictEqual(res.status, 409);
  assert.match(res.body.error, /Operam/i);
});

test('A104: actualizar una cotizacion inexistente responde 404', async () => {
  const res = await supertest(app).post('/api/cotizacion/operam/999999/actualizar').set('Authorization', `Bearer ${TEST_TOKEN}`);
  assert.strictEqual(res.status, 404);
});

test('A104: una actualizacion exitosa limpia la marca de quote desactualizado', async () => {
  const { _resetSesionWeb } = await import('../lib/operam-web.js');
  _resetSesionWeb();
  const id = cotizacionActualizable({ quoteDesactualizado: { fecha: '2026-07-01T00:00:00Z', escrito: false, error: 'previo', discrepancias: [] } });
  const { restore } = mockOperamWebLegacy();
  try {
    const res = await supertest(app).post(`/api/cotizacion/operam/${id}/actualizar`).set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.body.ok, true, JSON.stringify(res.body));
    const guardada = readCots().find(c => c.id === id);
    assert.strictEqual(guardada.data.quoteDesactualizado, null);
  } finally {
    restore();
  }
});

test('A104: /api/cotizaciones expone orderOperam y quoteDesactualizado para el gate del historial', async () => {
  const id = cotizacionActualizable({ orderOperam: '7077' });
  const res = await supertest(app).get('/api/cotizaciones').set('Authorization', `Bearer ${TEST_TOKEN}`);
  assert.strictEqual(res.status, 200);
  const c = res.body.find(x => x.id === id);
  assert.strictEqual(c.orderOperam, '7077');
  assert.strictEqual(c.quoteDesactualizado, null);
  assert.strictEqual(c.folioOperam, '1200');
});

test('O68: subir a Operam sin match de cliente responde 422 y NO sube ni persiste folio', async () => {
  const snap = readCots();
  const id = (snap.reduce((m, c) => Math.max(m, c.id), 0)) + 1;
  writeCots([...snap, {
    id, fecha: '2026-06-17T00:00:00Z', vendedor: 'Tester', cliente: 'FANTASMA',
    totalPiezas: 1, total: 100, tier: 'Mayoreo',
    data: {
      fecha: '2026-06-17',
      cliente: { rfc: 'NOEXISTE010101AAA', razonSocial: 'Fantasma SA' },
      items: [{ codigo: 'X', descripcion: 'X', cantidad: 1, precio: 100, descuento: 0 }],
    },
  }]);
  let quoteLlamado = false;
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': () => ({ ok: true, json: async () => ({ total: 0, data: [] }) }),
    '/api/v3/sales/quote': () => { quoteLlamado = true; return { ok: true, json: async () => ({ result: true, quote_id: 1 }) }; },
  });
  try {
    const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 422);
    assert.match(res.body.error, /cliente/i);
    assert.strictEqual(quoteLlamado, false, 'NO debe subir el quote');
    const guardada = readCots().find(c => c.id === id);
    assert.ok(!guardada.folioOperam && !(guardada.data && guardada.data.folioOperam), 'no debe persistir folio');
  } finally {
    restore();
  }
});

// === #114: regenerar una cotizacion ya subida y su quote en Operam ===
// El bug: crearOActualizarCotizacion sobrescribe `data` aunque el registro ya tenga
// folio, y la subida corta con yaSubida sin tocar Operam -- el documento sale numerado
// con el folio y el contenido NUEVO mientras el quote conserva el VIEJO. La decision
// (Adrian, 2026-07-29) es que regenerar actualice el quote, sin preguntar, SOLO si el
// contenido cambio. Para saberlo hace falta una huella persistida de lo que se subio.
const { huellaContenidoQuote: huella114 } = await import('../lib/operam-client.js');

function contenido114(extra = {}) {
  return {
    fecha: '2026-07-29', vigencia: '2026-08-28', tier: 'Mayoreo',
    cliente: { razonSocial: 'El Pendulo', nombreCorto: 'Pendulo', telefono: '+52 5551234567', cpEntrega: '56530', customerId: 376 },
    items: [{ codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 10, unidad: 'pza', precio: 100, descuento: 0 }],
    subtotal: 1000, iva: 160, total: 1160, notas: [],
    ...extra,
  };
}

function cotizacionSubida114(extra = {}, { conHuella = true } = {}) {
  const snap = readCots();
  const id = (snap.reduce((m, c) => Math.max(m, c.id), 0)) + 1;
  const data = contenido114();
  writeCots([...snap, {
    id, fecha: '2026-07-29T00:00:00Z', vendedor: 'Tester', cliente: 'Pendulo',
    totalPiezas: 10, total: 1160, tier: 'Mayoreo', folioOperam: '1200',
    data: { ...data, ...(conHuella ? { huellaQuote: huella114(data) } : {}), ...extra },
  }]);
  return id;
}

test('#114-1: regenerar sin cambios no pide actualizar el quote (PDF y luego HTML del mismo carrito)', async () => {
  const id = cotizacionSubida114();
  const res = await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TEST_TOKEN}`)
    .send({ ...contenido114(), cotizacionId: String(id) });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.id, id);
  assert.strictEqual(res.body.requiereActualizacionOperam, false);
  // la huella tiene que sobrevivir al guardado: si el merge del store la borrara, la
  // siguiente regeneracion creeria que todo cambio
  assert.ok(readCots().find(c => c.id === id).data.huellaQuote, 'la huella debe sobrevivir a la regeneracion');
});

test('#114-2: regenerar con cambios pide actualizar el quote conservando el folio', async () => {
  const id = cotizacionSubida114();
  const res = await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TEST_TOKEN}`).send({
    ...contenido114({
      items: [{ codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 12, unidad: 'pza', precio: 100, descuento: 0 }],
      subtotal: 1200, iva: 192, total: 1392,
    }),
    cotizacionId: String(id),
  });
  assert.strictEqual(res.body.requiereActualizacionOperam, true);
  assert.strictEqual(res.body.folioOperam, '1200', 'el documento se numera con el folio que ya existe');
});

// #115 (segunda parte) corrige el otro punto de #114: las notas tampoco eran
// "presentacion" -- viajan a comments del quote, asi que editarlas hay que llevarlo a
// Operam. Lo que de verdad no viaja es el formato del documento.
test('#114-3: cambiar solo el formato del documento no pide actualizar el quote', async () => {
  const id = cotizacionSubida114();
  const res = await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TEST_TOKEN}`)
    .send({ ...contenido114({ incluirFotos: true }), cotizacionId: String(id) });
  assert.strictEqual(res.body.requiereActualizacionOperam, false);
});

test('#115-3: editar las notas SI pide actualizar el quote (van en comments)', async () => {
  const id = cotizacionSubida114();
  const res = await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TEST_TOKEN}`)
    .send({ ...contenido114({ notas: ['Otra nota'] }), cotizacionId: String(id) });
  assert.strictEqual(res.body.requiereActualizacionOperam, true);
});

// #115 corrige la regla de #114 en un punto: la vigencia quedaba fuera junto a las
// notas, pero SI viaja al quote (comments y "Valido hasta"), asi que cambiar el plazo
// tiene que reescribirlo. Lo que sigue sin contar es la fecha absoluta.
test('#115-1: cambiar el plazo de vigencia SI pide actualizar el quote', async () => {
  const id = cotizacionSubida114();
  const res = await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TEST_TOKEN}`)
    .send({ ...contenido114({ vigencia: '2026-12-31' }), cotizacionId: String(id) });
  assert.strictEqual(res.body.requiereActualizacionOperam, true);
});

test('#115-2: regenerar el mismo plazo en otra fecha NO pide actualizar el quote', async () => {
  const id = cotizacionSubida114();
  const base = contenido114();
  // el frontend manda la fecha del dia y recalcula la vigencia: ambas se corren juntas
  const dia = (iso, dias) => new Date(new Date(iso).getTime() + dias * 86400000).toISOString().split('T')[0];
  const res = await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TEST_TOKEN}`)
    .send({ ...contenido114({ fecha: dia(base.fecha, 3), vigencia: dia(base.vigencia, 3) }), cotizacionId: String(id) });
  assert.strictEqual(res.body.requiereActualizacionOperam, false);
});

test('#114-4: una cotizacion sin folio (PRE) nunca pide actualizar: lo suyo es completar la subida', async () => {
  const snap = readCots();
  const id = (snap.reduce((m, c) => Math.max(m, c.id), 0)) + 1;
  writeCots([...snap, {
    id, fecha: '2026-07-29T00:00:00Z', vendedor: 'Tester', cliente: 'Pendulo',
    totalPiezas: 10, total: 1160, tier: 'Mayoreo', data: contenido114(),
  }]);
  const res = await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TEST_TOKEN}`)
    .send({ ...contenido114({ total: 9999 }), cotizacionId: String(id) });
  assert.strictEqual(res.body.requiereActualizacionOperam, false);
});

test('#114-5: una cotizacion subida antes de esta issue (sin huella) pide actualizar', async () => {
  const id = cotizacionSubida114({}, { conHuella: false });
  const res = await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TEST_TOKEN}`)
    .send({ ...contenido114(), cotizacionId: String(id) });
  assert.strictEqual(res.body.requiereActualizacionOperam, true);
});

test('#114-6: subir a Operam persiste la huella de lo que quedo en el quote', async () => {
  const snap = readCots();
  const id = (snap.reduce((m, c) => Math.max(m, c.id), 0)) + 1;
  const data = {
    fecha: '2026-07-29', vigencia: '2026-08-28',
    cliente: { rfc: 'CPE921211N76', razonSocial: 'El Pendulo', nombreCorto: 'Pendulo', cpEntrega: '56530' },
    items: [{ codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 10, precio: 100, descuento: 0 }],
    subtotal: 1000, iva: 160, total: 1160,
  };
  writeCots([...snap, { id, fecha: '2026-07-29T00:00:00Z', vendedor: 'Tester', cliente: 'Pendulo', totalPiezas: 10, total: 1160, tier: 'Mayoreo', data }]);
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': () => ({ ok: true, json: async () => ({ total: 1, data: [{ customer_id: 314, tax_id: 'CPE921211N76', CustName: 'El Pendulo', branches: [{ branch_code: 88 }] }] }) }),
    '/api/v3/sales/quote': () => ({ ok: true, json: async () => ({ result: true, added_trans_no: 1601 }) }),
    'trans_type=30': () => ({ headers: {}, text: async () => '<html>login</html>' }),
    'trans_type=32': () => ({ headers: {}, text: async () => '<html></html>' }),
    'sales_order_entry.php': () => ({ headers: {}, text: async () => '<html></html>' }),
  });
  try {
    const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.body.ok, true);
    const guardada = readCots().find(c => c.id === id);
    assert.strictEqual(guardada.data.huellaQuote, huella114(data), 'la huella debe describir lo que se subio');
  } finally {
    restore();
  }
});

test('#114-7: actualizar el quote con exito reescribe la huella con lo que quedo en Operam', async () => {
  const { _resetSesionWeb } = await import('../lib/operam-web.js');
  _resetSesionWeb();
  const id = cotizacionActualizable({
    cliente: { rfc: 'CPE921211N76', razonSocial: 'El Pendulo', nombreCorto: 'Pendulo', customerId: 376, cpEntrega: '56530', telefono: '+52 5551234567' },
    huellaQuote: 'huella-vieja',
  });
  const { restore } = mockOperamWebLegacy();
  try {
    const res = await supertest(app).post(`/api/cotizacion/operam/${id}/actualizar`).set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.body.ok, true, JSON.stringify(res.body));
    const guardada = readCots().find(c => c.id === id);
    assert.notStrictEqual(guardada.data.huellaQuote, 'huella-vieja');
    // regenerar ese mismo contenido ya no debe pedir otra reescritura
    const post = await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ ...guardada.data, cotizacionId: String(id) });
    assert.strictEqual(post.body.requiereActualizacionOperam, false);
  } finally {
    restore();
  }
});

// === GET /api/admin/paridad-catalogo (issue #130) ===

test('GET /api/admin/paridad-catalogo exige admin: vendedor 403, sin token 401', async () => {
  const vendedorToken = jwt.sign({ id: 7, name: 'Memo', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });
  const vendedor = await supertest(app).get('/api/admin/paridad-catalogo')
    .set('Authorization', `Bearer ${vendedorToken}`);
  assert.strictEqual(vendedor.status, 403);
  const sinToken = await supertest(app).get('/api/admin/paridad-catalogo');
  assert.strictEqual(sinToken.status, 401);
});

test('GET /api/admin/paridad-catalogo lee Operam y devuelve el reporte de paridad', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/sales_types': () => ({ ok: true, json: async () => ({
      total: 1, data: [{ id: '1', sales_type: 'Precio de lista', factor: '1', inactive: '0' }],
    }) }),
    '/api/v3/sales/prices_list': () => ({ ok: true, json: async () => ({ total: 0, data: [] }) }),
    '/api/v3/inventory/items': () => ({ ok: true, json: async () => ({ total: 0, data: [] }) }),
  });
  try {
    const res = await supertest(app).get('/api/admin/paridad-catalogo')
      .set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const referencia = JSON.parse(leerArchivoSync(join(DATA_DIR, 'precios.json')));
    // Sin articulos en Operam, todos los productos de referencia salen SIN_SKU.
    assert.strictEqual(res.body.resumen.MATCH, 0);
    assert.strictEqual(res.body.resumen.SIN_SKU, referencia.products.length);
    assert.strictEqual(res.body.resumen.NUEVO, 0);
    assert.ok(Array.isArray(res.body.productos));
    assert.ok(Array.isArray(res.body.sinCaja));
  } finally {
    restore();
  }
});

test('GET /api/admin/paridad-catalogo: Operam no disponible responde 503', async () => {
  const { resetSession } = await import('../lib/operam-client.js');
  resetSession();
  const restore = mockOperamFetch({
    '/api/v3/login': () => { throw new Error('timeout'); },
  });
  try {
    const res = await supertest(app).get('/api/admin/paridad-catalogo')
      .set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 503);
  } finally {
    restore();
  }
});
