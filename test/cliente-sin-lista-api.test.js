// #285: un cliente de Operam sin lista de precios (sales_type 0) hacia fallar la
// subida con "Operam 406: Debe haber al menos un rate de moneda" -- un mensaje que
// no menciona ni al cliente ni a la lista. La cotizacion quedaba PRE por 'operam'
// y el reintento del historial fallaba igual, para siempre.
//
// Aqui se prueba el camino completo: se detecta ANTES del POST del quote, sale
// como 422 con codigo estructurado, y el registro guarda el motivo para que el
// historial lo explique. Prior art del montaje: test/precio-calca-api.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COTS_PATH = join(__dirname, '..', 'data', 'cotizaciones.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');
const { CODIGO_CLIENTE_SIN_LISTA } = await import('../lib/lista-precios-cliente.js');

const token = jwt.sign({ id: 1, name: 'Admin Test', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

function readCots() {
  if (!existsSync(COTS_PATH)) return [];
  return JSON.parse(leerArchivoSync(COTS_PATH));
}
function writeCots(data) {
  escribirArchivoSync(COTS_PATH, JSON.stringify(data, null, 2));
}
function registro(id) {
  return readCots().find(c => c.id === id);
}

const originalFetch = globalThis.fetch;
function mockFetchByUrl(handlers) {
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    for (const [pat, fn] of Object.entries(handlers)) {
      if (u.includes(pat)) return fn(u, opts);
    }
    throw new Error('Unmocked fetch: ' + u);
  };
  return () => { globalThis.fetch = originalFetch; };
}
function jsonResponse(data, status = 200) {
  return { ok: status < 400, status, json: async () => data };
}

// Cliente con RFC real: la subida entra por el camino normal
// (subirCotizacionOperam), no por el alta generica.
const RFC = 'CSL010101AAA';
function cotizacion() {
  return {
    fecha: '2026-01-01', vigencia: '2026-02-01', tier: 'Menudeo', _compress: false,
    cliente: { razonSocial: 'HOTEL SIN LISTA SA DE CV', nombreCorto: 'Hotel Sin Lista', telefono: '+52 55 1234 5678', rfc: RFC },
    items: [{ codigo: 'AB12', descripcion: 'Olla', cantidad: 10, unidad: 'pza', precio: 100, descuento: 0 }],
    subtotal: 1000, iva: 160, total: 1160, notas: [],
  };
}

// El cliente tal como lo devuelve Operam: el listado por ?tax_id= y el GET de
// detalle salen del mismo endpoint, asi que un solo handler sirve para los dos.
function clienteOperam(salesType) {
  return {
    total: 1,
    data: [{ customer_id: '77', tax_id: RFC, CustName: 'HOTEL SIN LISTA SA DE CV', sales_type: salesType, curr_code: 'MXN', branches: [{ branch_code: '1' }] }],
  };
}

async function crearCotizacion() {
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${token}`).send(cotizacion());
  assert.strictEqual(res.status, 200);
  return res.body.id;
}

let cotsOriginal;
before(() => { cotsOriginal = readCots(); });
after(() => { writeCots(cotsOriginal); globalThis.fetch = originalFetch; });

test('SL1: cliente con sales_type "0" -> 422 accionable, sin POST del quote, y el registro guarda el motivo', async () => {
  const id = await crearCotizacion();
  let postsQuote = 0;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': () => jsonResponse(clienteOperam('0')),
    '/api/v3/sales/quote': () => { postsQuote++; return jsonResponse({ result: true, quote_id: 1 }); },
  });
  try {
    const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
      .set('Authorization', `Bearer ${token}`).send({});
    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.codigo, CODIGO_CLIENTE_SIN_LISTA);
    assert.match(res.body.error, /lista de precios en Operam/);
    assert.match(res.body.error, /HOTEL SIN LISTA SA DE CV/);
    assert.strictEqual(postsQuote, 0, 'el quote NO debe intentarse contra un cliente sin lista');
  } finally {
    restore();
  }
  const guardada = registro(id);
  assert.strictEqual(guardada.data.motivoPre, 'sin-lista');
  assert.ok(guardada.data.motivoPreDesde, 'el motivo se guarda con su marca de tiempo');
  assert.ok(guardada.folioOperam == null || guardada.folioOperam === '', 'sigue siendo PRE');
});

test('SL2: cliente con lista asignada sube como siempre', async () => {
  const id = await crearCotizacion();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': () => jsonResponse(clienteOperam('12')),
    '/api/v3/sales/quote': () => jsonResponse({ result: true, added_trans_no: 1259 }),
  });
  try {
    const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
      .set('Authorization', `Bearer ${token}`).send({});
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.folio, 1259);
  } finally {
    restore();
  }
  assert.strictEqual(String(registro(id).folioOperam), '1259');
});

// El fallback: el cliente traia lista al leerlo (o el camino no alcanzo a
// checarla) y el 406 llega igual. Se traduce al MISMO texto y codigo, nunca al
// 503 generico que dejaba al vendedor sin saber que arreglar.
test('SL3: el 406 de "rate de moneda" que igual llega sale con el mismo codigo accionable', async () => {
  const id = await crearCotizacion();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': () => jsonResponse(clienteOperam('12')),
    '/api/v3/sales/quote': () => ({
      ok: false, status: 406,
      json: async () => ({ result: false, messages: ['Debe haber al menos un rate de moneda'] }),
      text: async () => JSON.stringify({ result: false, messages: ['Debe haber al menos un rate de moneda'] }),
    }),
  });
  try {
    const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
      .set('Authorization', `Bearer ${token}`).send({});
    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.codigo, CODIGO_CLIENTE_SIN_LISTA);
    assert.match(res.body.error, /lista de precios en Operam/);
  } finally {
    restore();
  }
  assert.strictEqual(registro(id).data.motivoPre, 'sin-lista');
});

// Auditoria de escrituras, camino 1: el PUT directo de cliente, que manda el body
// tal cual lo recibe. Es el que perdio la configuracion del cliente 15.
test('SL4a: actualizar cliente con sales_type vacio no manda la llave al PUT de Operam', async () => {
  let putBody = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers/77': (u, opts) => {
      putBody = JSON.parse(opts.body);
      return jsonResponse({ result: true, ...putBody });
    },
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente/77')
      .set('Authorization', `Bearer ${token}`)
      .send({ sales_type: '', segmento_id: '', cust_name: 'HOTEL SIN LISTA SA DE CV' });
    assert.strictEqual(res.status, 200);
  } finally {
    restore();
  }
  assert.ok(putBody, 'el PUT debe haberse hecho');
  assert.strictEqual('sales_type' in putBody, false, 'sales_type vacio NUNCA viaja: Operam lo coerciona a 0');
  assert.strictEqual('segmento_id' in putBody, false);
  assert.strictEqual(putBody.cust_name, 'HOTEL SIN LISTA SA DE CV', 'el resto del body si viaja');
});

// Camino 2: el PATCH por diff (las llaves del diff son de lectura y se traducen
// antes de escribir, #169). Mismo desenlace: la llave vacia no viaja.
test('SL4b: el PATCH de cliente con sales_type vacio no manda la llave al PUT de Operam', async () => {
  let putBody = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers/77': (u, opts) => {
      putBody = JSON.parse(opts.body);
      return jsonResponse({ result: true, ...putBody });
    },
  });
  try {
    const res = await supertest(app).patch('/api/operam/clientes/77')
      .set('Authorization', `Bearer ${token}`)
      .send({ diff: {
        sales_type: { anterior: '12', nuevo: '', label: 'Lista de precios' },
        segmento_id: { anterior: '3', nuevo: '', label: 'Segmento' },
        cust_ref: { anterior: 'Hotel', nuevo: 'Hotel Azul', label: 'Nombre corto' },
      } });
    assert.strictEqual(res.status, 200);
  } finally {
    restore();
  }
  assert.ok(putBody, 'el PUT debe haberse hecho');
  assert.strictEqual('sales_type' in putBody, false, 'sales_type vacio NUNCA viaja: Operam lo coerciona a 0');
  assert.strictEqual('segmento_id' in putBody, false);
  assert.strictEqual(putBody.cust_ref, 'Hotel Azul', 'el resto del diff si viaja');
});
