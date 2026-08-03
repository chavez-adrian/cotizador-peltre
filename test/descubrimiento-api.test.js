import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync, borrarArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

// POST /api/admin/bandeja/buscar-nuevas (issue #126): descubrimiento RECURRENTE
// de quotes nuevos en Operam hacia la bandeja de revision. A diferencia de
// bandeja-api.test.js (que siembra la bandeja directo con el store y bloquea
// fetch), esta ruta SI habla con Operam -- read-only, siempre mockeado.

// Throttle a 0 antes de importar server.js: el modulo lee la env var UNA vez al
// definir la constante del endpoint, y sin esto la suite pacearia de verdad
// (1100ms por lectura simulada).
process.env.DESCUBRIMIENTO_THROTTLE_MS = '0';

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
if (!process.env.OPERAM_URL) process.env.OPERAM_URL = 'https://operam.test';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');
const { listar: listarBandeja, proponer } = await import('../lib/bandeja-store.js');
const cotStore = await import('../lib/cotizaciones-store.js');
const { resetSession } = await import('../lib/operam-client.js');

const ADMIN_TOKEN = jwt.sign({ id: 99, name: 'Tester', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
const MEMO_TOKEN = jwt.sign({ id: 7, name: 'Memo', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });

function leerArchivoJson(path) {
  if (!existsSync(path)) return [];
  return JSON.parse(leerArchivoSync(path));
}
function escribirArchivoJson(path, data) {
  escribirArchivoSync(path, JSON.stringify(data, null, 2));
}

let savedBandeja, savedProspectos, savedCotizaciones, existiaBandeja, existiaProspectos, existiaCotizaciones;
before(() => {
  existiaBandeja = existsSync(BANDEJA_PATH);
  existiaProspectos = existsSync(PROSPECTOS_PATH);
  existiaCotizaciones = existsSync(COTIZACIONES_PATH);
  savedBandeja = leerArchivoJson(BANDEJA_PATH);
  savedProspectos = leerArchivoJson(PROSPECTOS_PATH);
  savedCotizaciones = leerArchivoJson(COTIZACIONES_PATH);
});
after(() => {
  if (existiaBandeja) escribirArchivoJson(BANDEJA_PATH, savedBandeja);
  else if (existsSync(BANDEJA_PATH)) borrarArchivoSync(BANDEJA_PATH);
  if (existiaProspectos) escribirArchivoJson(PROSPECTOS_PATH, savedProspectos);
  else if (existsSync(PROSPECTOS_PATH)) borrarArchivoSync(PROSPECTOS_PATH);
  if (existiaCotizaciones) escribirArchivoJson(COTIZACIONES_PATH, savedCotizaciones);
  else if (existsSync(COTIZACIONES_PATH)) borrarArchivoSync(COTIZACIONES_PATH);
});
beforeEach(() => {
  escribirArchivoJson(BANDEJA_PATH, []);
  escribirArchivoJson(PROSPECTOS_PATH, []);
  escribirArchivoJson(COTIZACIONES_PATH, []);
  resetSession();
});

function jsonResponse(body, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

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

// Handlers base compartidos: login, catalogo de clientes VACIO (el caso generico
// necesita un cliente en el catalogo para cruzar identidad, se agrega por test) y
// pedidos VACIOS (sin cierres que aplicar). `quotes` mapea folio (string) ->
// cabecera de quote o null (ausente = 404). `clientes` mapea debtor_no (string)
// -> objeto cliente (para GET /sales/customers/{id}, el camino de cliente real).
function handlersBase({ quotes = {}, clientesPorId = {}, clientesCatalogo = [], onCustomersList } = {}) {
  return {
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/quote/': (u) => {
      const folio = u.split('/quote/')[1];
      const q = quotes[folio];
      return q ? jsonResponse({ data: [q] }) : jsonResponse({ error: 'not found' }, 404);
    },
    '/api/v3/sales/sales_orders': () => jsonResponse({ data: [] }),
    '/api/v3/sales/customers': async (u, opts) => {
      if (onCustomersList) await onCustomersList(u, opts);
      const m = u.match(/\/customers\/(\d+)/);
      if (m) {
        const c = clientesPorId[m[1]];
        return c ? jsonResponse({ data: [c] }) : jsonResponse({ error: 'not found' }, 404);
      }
      // Listado paginado (listarTodosClientes): una sola pagina basta en los tests.
      return jsonResponse({ total: clientesCatalogo.length, data: clientesCatalogo });
    },
  };
}

const VENDEDORES = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'vendedores.json'), 'utf8'));

function quoteGenerico(campos) {
  return {
    ord_date: '2026-08-01', debtor_no: '184', total: '1000.00',
    deliver_to: 'Cliente Nuevo Digital', contact_phone: '5551234567',
    user: { real_name: 'Alejandro Chavez' }, ...campos,
  };
}

function quoteReal(campos) {
  return {
    ord_date: '2026-08-01', delivery_date: '2026-08-31', total: '48250.00',
    cust_ref: 'Remodelacion Hotel Valle', deliver_to: 'Mariana Gutierrez Solis',
    contact_phone: '+52 55 2314 8890', debtor_no: '512',
    salesman: '2', user: { real_name: 'Adrian Chavez' },
    detalles: [{ stock_id: '250101001', stock_id_text: 'Taza 8 cm', quantity: 10, unit_price: 85 }],
    ...campos,
  };
}

const DEBTOR_512 = { debtor_no: 512, CustName: 'HOTELES DEL VALLE SA DE CV', tax_id: 'HVA160305MX8', curr_code: 'MXN' };

// === gate admin ===

test('sin token responde 401', async () => {
  const res = await supertest(app).post('/api/admin/bandeja/buscar-nuevas');
  assert.equal(res.status, 401);
});

test('un vendedor no admin no puede correr el descubrimiento', async () => {
  const res = await supertest(app).post('/api/admin/bandeja/buscar-nuevas')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(res.status, 403);
});

// === corrida feliz: deposita ambos tipos con payload correcto ===

test('deposita un generico como prospecto y un cliente real como cotizacion, con vendedor y marcas', async () => {
  const restore = mockOperamFetch(handlersBase({
    quotes: {
      1: quoteGenerico({ contact_phone: '5559998888' }),
      2: quoteReal({}),
    },
    clientesPorId: { 512: DEBTOR_512 },
    clientesCatalogo: [{ customer_id: 184, CustName: 'GENERICO TIENDAS DIGITALES', contacts: [], branches: [] }],
  }));
  try {
    const res = await supertest(app).post('/api/admin/bandeja/buscar-nuevas')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.nuevos, 2);
    assert.equal(res.body.folioDesde, 1);
    assert.equal(res.body.folioHasta, 2);
    assert.ok(res.body.saltados);

    const bandeja = await listarBandeja();
    assert.equal(bandeja.length, 2);
    const prospecto = bandeja.find(b => b.folio === '1');
    assert.equal(prospecto.tipo, 'prospecto');
    assert.equal(prospecto.debtorId, 184);
    assert.equal(prospecto.vendedor, 'Alejandro Chávez');

    const cotizacion = bandeja.find(b => b.folio === '2');
    assert.equal(cotizacion.tipo, 'cotizacion');
    assert.equal(cotizacion.debtorId, 512);
    assert.equal(cotizacion.vendedor, 'Alejandro Chávez'); // salesman '2' del quote real
    assert.equal(cotizacion.quote.debtor.CustName, 'HOTELES DEL VALLE SA DE CV');
    assert.equal(cotizacion.quote.detalles.length, 1);
  } finally {
    restore();
  }
});

// === skips por cada motivo (con folioDesde ya avanzado via cotStore/bandeja) ===

async function correrDescubrimiento(handlers) {
  const restore = mockOperamFetch(handlers);
  try {
    return await supertest(app).post('/api/admin/bandeja/buscar-nuevas')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
  } finally {
    restore();
  }
}

// yaExiste/yaEnBandeja: el endpoint computa folioDesde = folioMaximoConocido()+1
// (server.js), asi que en una corrida real el walk NUNCA vuelve a pisar un folio
// ya conocido -- ya quedo POR DEBAJO de folioDesde por construccion. Esos dos
// motivos de salto viven en el nucleo puro (planearDescubrimiento acepta
// cualquier folioDesde) y ya estan cubiertos ahi con control directo del
// parametro (test/descubrimiento-operam.test.js); forzarlos aqui por la puerta
// negra del endpoint no es posible sin inventar un estado que el codigo real
// nunca produce. Lo que SI prueba el endpoint es la CONSECUENCIA -- que un folio
// ya conocido nunca vuelve a aparecer -- via los tests de idempotencia de abajo.

test('un quote cancelado en Operam (data/cancelados.json) no se propone', async () => {
  // 1077 esta en data/cancelados.json (quotes). folioDesde=1 -> hay que llenar
  // los folios 1..1076 con "no existe todavia" para llegar ahi NO es realista en
  // un test: en vez de eso, sembramos el store con folioOperam=1076 para que el
  // walk arranque justo en 1077.
  const idPrevio = await cotStore.crear({ fecha: '2026-08-01T00:00:00.000Z', vendedor: 'x', cliente: 'x', total: 1, data: {} });
  await cotStore.setFolioOperam(idPrevio, '1076');
  const res = await correrDescubrimiento(handlersBase({ quotes: { 1077: quoteReal({}) } }));
  assert.equal(res.status, 200);
  assert.equal(res.body.nuevos, 0);
  assert.equal(res.body.saltados.cancelado, 1);
});

test('debtor de prueba (mostrador/publico general, "venta directa") no se propone', async () => {
  const res = await correrDescubrimiento(handlersBase({ quotes: { 1: quoteReal({ debtor_no: '14' }) } }));
  assert.equal(res.status, 200);
  assert.equal(res.body.nuevos, 0);
  assert.equal(res.body.saltados.prueba, 1);
});

test('debtor socio no se propone', async () => {
  const res = await correrDescubrimiento(handlersBase({ quotes: { 1: quoteReal({ debtor_no: '15' }) } }));
  assert.equal(res.status, 200);
  assert.equal(res.body.saltados.socio, 1);
});

test('sucursal no-Tlapacoya (Shopify) no se propone', async () => {
  const res = await correrDescubrimiento(handlersBase({
    quotes: { 1: quoteReal({ user: { real_name: 'Shopify' } }) },
  }));
  assert.equal(res.status, 200);
  assert.equal(res.body.saltados.otraSucursal, 1);
});

test('un generico de $0 no se propone (total-cero, via evaluarQuote reusado)', async () => {
  const res = await correrDescubrimiento(handlersBase({ quotes: { 1: quoteGenerico({ total: '0' }) } }));
  assert.equal(res.status, 200);
  assert.equal(res.body.saltados.totalCero, 1);
});

test('un generico que ya CERRO (identidad + monto en banda, via el pedido real de Operam) no se propone', async () => {
  const handlers = handlersBase({
    quotes: {
      1: quoteGenerico({
        debtor_no: '143', total: '952.08', deliver_to: 'Jean Corriveau',
        contact_phone: '+1 613-656-1374', cust_ref: 'Obasan',
      }),
    },
    clientesCatalogo: [{ customer_id: 500, CustName: 'OBASAN LIMITED', contacts: [], branches: [] }],
  });
  handlers['/api/v3/sales/sales_orders'] = (u) => {
    // Solo la primera pagina trae el pedido; el resto vacio (fin de paginacion).
    if (u.includes('skip=0')) {
      return jsonResponse({ data: [{ order_no: 5236, debtor_no: 500, ord_date: '2026-08-02', total: '952.08' }] });
    }
    return jsonResponse({ data: [] });
  };
  const res = await correrDescubrimiento(handlers);
  assert.equal(res.status, 200);
  assert.equal(res.body.nuevos, 0);
  assert.equal(res.body.saltados.cerro, 1);
  assert.equal((await listarBandeja()).length, 0);
});

// === idempotencia: correr dos veces no duplica ni re-propone aceptados/descartados ===

test('correr el descubrimiento dos veces no duplica los mismos folios', async () => {
  const handlers = handlersBase({ quotes: { 1: quoteReal({}) } });
  handlers['/api/v3/sales/customers'] = async (u) => {
    const m = u.match(/\/customers\/(\d+)/);
    if (m) return jsonResponse({ data: [DEBTOR_512] });
    return jsonResponse({ total: 0, data: [] });
  };
  const primera = await correrDescubrimiento(handlers);
  assert.equal(primera.body.nuevos, 1);

  // El folio 1 ya quedo en el store de cotizaciones (via yaExiste) o en la
  // bandeja (via yaEnBandeja) -- de cualquier forma el segundo run lo salta:
  // folioDesde ahora arranca DESPUES de el (folioMaximoConocido lo incluye).
  const segunda = await correrDescubrimiento(handlers);
  assert.equal(segunda.status, 200);
  assert.equal(segunda.body.nuevos, 0);
  assert.equal((await listarBandeja()).length, 1, 'no se duplico el candidato');
});

test('un candidato ACEPTADO no se vuelve a proponer en una corrida posterior', async () => {
  const { aceptar } = await import('../lib/bandeja-store.js');
  await proponer({ folio: '1', tipo: 'cotizacion', vendedor: 'Alejandro Chávez', marcas: {} });
  await aceptar('1', { vendedor: 'Alejandro Chávez' });
  const res = await correrDescubrimiento(handlersBase({ quotes: { 1: quoteReal({}) } }));
  assert.equal(res.body.nuevos, 0);
  const entrada = (await listarBandeja()).find(b => b.folio === '1');
  assert.equal(entrada.estado, 'aceptado');
});

test('un candidato DESCARTADO no se vuelve a proponer en una corrida posterior', async () => {
  const { descartar } = await import('../lib/bandeja-store.js');
  await proponer({ folio: '1', tipo: 'prospecto', vendedor: 'Alejandro Chávez', marcas: {} });
  await descartar('1');
  const res = await correrDescubrimiento(handlersBase({ quotes: { 1: quoteGenerico({}) } }));
  assert.equal(res.body.nuevos, 0);
  const entrada = (await listarBandeja()).find(b => b.folio === '1');
  assert.equal(entrada.estado, 'descartado');
});

// === lock 425: dos corridas concurrentes ===

test('dos corridas concurrentes: la segunda recibe 425 mientras la primera esta en curso', async () => {
  const handlers = handlersBase({ quotes: { 1: quoteReal({}) } });
  handlers['/api/v3/sales/customers'] = async (u) => {
    const m = u.match(/\/customers\/(\d+)/);
    if (m) return jsonResponse({ data: [DEBTOR_512] });
    // Mantiene la primera corrida EN VUELO para que la segunda la alcance.
    await new Promise(r => setTimeout(r, 80));
    return jsonResponse({ total: 0, data: [] });
  };
  const restore = mockOperamFetch(handlers);
  try {
    const [r1, r2] = await Promise.all([
      supertest(app).post('/api/admin/bandeja/buscar-nuevas').set('Authorization', `Bearer ${ADMIN_TOKEN}`),
      supertest(app).post('/api/admin/bandeja/buscar-nuevas').set('Authorization', `Bearer ${ADMIN_TOKEN}`),
    ]);
    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [200, 425]);
    const rechazado = r1.status === 425 ? r1 : r2;
    assert.match(rechazado.body.error, /en curso/i);
  } finally {
    restore();
  }
});

test('el lock se libera tras terminar: una corrida posterior no recibe 425', async () => {
  const primera = await correrDescubrimiento(handlersBase({ quotes: { 1: quoteReal({}) } }));
  assert.equal(primera.status, 200);
  const segunda = await correrDescubrimiento(handlersBase({ quotes: {} }));
  assert.equal(segunda.status, 200);
});
