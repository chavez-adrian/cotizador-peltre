import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const COTS_PATH = join(DATA_DIR, 'cotizaciones.json');

// Load .env before importing app
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

const TOKEN = jwt.sign({ id: 1, name: 'Test', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
const req = supertest(app);

// Respuesta de login real
const LOGIN_RESPONSE = { token: 'fake-bearer-token', result: true };

// Respuesta real de busqueda de clientes
const CLIENTES_RESPONSE = {
  total: 1,
  data: [{
    customer_id: '42',
    CustName: 'BANCO DE MEXICO FIDEICOMISO',
    cust_ref: 'Banco de Mexico',
    tax_id: 'BMF821130AR3',
    postal_code: '06000',
    branches: [{
      branch_code: '1',
      branch_ref: 'PRINCIPAL',
      br_name: 'Museo Frida Kahlo',
      contact_name: 'Adriana Urena',
      phone: '55 1072 7542',
      email: 'a.urena@museofridakahlo.org.mx',
    }]
  }]
};

// Respuesta real de detalle de cliente
const CLIENTE_DETALLE_RESPONSE = { data: [CLIENTES_RESPONSE.data[0]] };

// Respuesta real de crear cotizacion
const QUOTE_RESPONSE = {
  result: true,
  quote_id: 1128,
  factura_no: 1128,
  ref: 'RC1128',
  messages: ['Cotizacion insertada exitosamente'],
};

// Mock de fetch por URL
function mockFetchByUrl(urlHandlers) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    for (const [pattern, handler] of Object.entries(urlHandlers)) {
      if (urlStr.includes(pattern)) return handler(url, opts);
    }
    throw new Error(`Unmocked fetch: ${urlStr}`);
  };
  return () => { globalThis.fetch = original; };
}

function jsonResponse(data, status = 200) {
  return { ok: status < 400, status, json: async () => data };
}

function readCots() {
  if (!existsSync(COTS_PATH)) return [];
  return JSON.parse(readFileSync(COTS_PATH, 'utf8'));
}

function writeCots(data) {
  writeFileSync(COTS_PATH, JSON.stringify(data, null, 2));
}

let savedCots;

before(() => {
  savedCots = readCots();
});

after(() => {
  writeCots(savedCots);
});

// B1: GET /api/operam/clientes?q=banco retorna objetos con customer_id, CustName, tax_id

test('B1: buscarClientes retorna array con campos de API v3', async () => {
  resetSession();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers': () => jsonResponse(CLIENTES_RESPONSE),
  });
  try {
    const res = await req.get('/api/operam/clientes?q=banco').set('Authorization', `Bearer ${TOKEN}`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length > 0);
    assert.ok(res.body[0].customer_id);
    assert.ok(res.body[0].CustName);
    assert.ok(res.body[0].tax_id);
  } finally { restore(); }
});

// B2: Sin token retorna 401

test('B2: sin auth token retorna 401', async () => {
  const res = await req.get('/api/operam/clientes?q=banco');
  assert.equal(res.status, 401);
});

// B3: GET /api/operam/clientes/:id/domicilios retorna array con campos de branches

test('B3: domicilios retorna branches mapeados con campos reales', async () => {
  resetSession();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers/42': () => jsonResponse(CLIENTE_DETALLE_RESPONSE),
  });
  try {
    const res = await req.get('/api/operam/clientes/42/domicilios').set('Authorization', `Bearer ${TOKEN}`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length > 0);
    const d = res.body[0];
    assert.ok('descripcion' in d);
    assert.ok('cp' in d);
    assert.ok('email' in d);
  } finally { restore(); }
});

// B4: Operam no responde => 503

test('B4: Operam no responde => 503', async () => {
  resetSession();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => { throw new Error('ECONNREFUSED'); },
  });
  try {
    const res = await req.get('/api/operam/clientes?q=test').set('Authorization', `Bearer ${TOKEN}`);
    assert.equal(res.status, 503);
  } finally { restore(); }
});

// B5: POST /api/cotizacion/operam/:id llama a /api/v3/sales/quote con payload correcto

test('B5: subirCotizacionOperam llama POST /api/v3/sales/quote', async () => {
  resetSession();
  let quotePayload = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers': () => jsonResponse(CLIENTES_RESPONSE),
    '/api/v3/sales/quote': (url, opts) => {
      quotePayload = JSON.parse(opts.body);
      return jsonResponse(QUOTE_RESPONSE);
    },
  });

  const snap = readCots();
  const testEntry = {
    id: 9999,
    fecha: new Date().toISOString(),
    vendedor: 'Test',
    cliente: 'BANCO DE MEXICO',
    totalPiezas: 2,
    total: 100,
    tier: 'Menudeo',
    data: {
      fecha: '2026-05-12',
      cliente: { razonSocial: 'BANCO DE MEXICO', rfc: 'BMF821130AR3', calle: 'Av. 5 de Mayo' },
      items: [{ codigo: 'VA08G1N1M0', descripcion: 'Vaso 8', cantidad: 2, precio: 50 }],
      notas: ['Tiempo de entrega: 4 semanas'],
    },
  };
  writeCots([...snap, testEntry]);

  try {
    const res = await req.post('/api/cotizacion/operam/9999').set('Authorization', `Bearer ${TOKEN}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.ok);
    assert.ok(quotePayload !== null, 'fetch a /api/v3/sales/quote no fue llamado');
    assert.equal(quotePayload.customer_id, 42);
    assert.ok(Array.isArray(quotePayload.items));
    assert.equal(quotePayload.items[0].stock_id, 'VA08G1N1M0');
  } finally {
    restore();
    const cleanLog = JSON.parse(readFileSync(COTS_PATH, 'utf8')).filter(e => e.id !== 9999);
    writeFileSync(COTS_PATH, JSON.stringify(cleanLog, null, 2));
  }
});

// B6: ID inexistente retorna 404

test('B6: cotizacion inexistente retorna 404', async () => {
  const res = await req.post('/api/cotizacion/operam/99998').set('Authorization', `Bearer ${TOKEN}`);
  assert.equal(res.status, 404);
});
