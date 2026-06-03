import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const COTS_PATH = join(DATA_DIR, 'cotizaciones.json');

// Load .env before importing app so JWT_SECRET matches
const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

// Import app after env is loaded
const { app } = await import('../server.js');

const TEST_TOKEN = jwt.sign({ id: 99, name: 'Tester', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

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

test('B1: POST /api/cotizacion/pdf persiste cliente.pais', async () => {
  const snap = readCots();

  const body = {
    fecha: '2026-01-01',
    vigencia: '2026-02-01',
    tier: 'Mayoreo',
    cliente: { razonSocial: 'Test SA', nombreCorto: 'Test', pais: 'US' },
    items: [{ codigo: 'TEST', descripcion: 'Test', cantidad: 1, unidad: 'pza', precio: 100, descuento: 0 }],
    subtotal: 100, iva: 16, total: 116, notas: [],
  };

  await supertest(app).post('/api/cotizacion/pdf').set('Authorization', `Bearer ${TEST_TOKEN}`).send(body);

  const cots = readCots();
  assert.ok(cots.length > snap.length, 'debe agregar una entrada al log');
  const last = cots[cots.length - 1];
  assert.strictEqual(last.data.cliente.pais, 'US', 'cliente.pais debe ser "US"');
});

test('B2: GET /api/cotizaciones/:id sin campo pais no falla', async () => {
  const snap = readCots();
  const id = snap.length + 1;
  const entry = {
    id, fecha: new Date().toISOString(), vendedor: 'Tester',
    cliente: 'Sin nombre', totalPiezas: 0, total: 0, tier: '',
    data: { cliente: { razonSocial: 'Sin pais' }, items: [] },
  };
  writeCots([...snap, entry]);

  const res = await supertest(app).get(`/api/cotizaciones/${id}`).set('Authorization', `Bearer ${TEST_TOKEN}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.cliente);
});

test('B4: POST /api/cotizacion/envio usa paisDestino en destination.country', async () => {
  let capturedPayload = null;
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.ENVIA_API_KEY;

  process.env.ENVIA_API_KEY = 'test-key';
  globalThis.fetch = async (url, opts) => {
    capturedPayload = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ data: [] }) };
  };

  try {
    await supertest(app)
      .post('/api/cotizacion/envio')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ cpDestino: '90210', paisDestino: 'US', items: [{ codigo: 'PV08', cantidad: 1 }], totalConIVA: 100 });

    assert.ok(capturedPayload !== null);
    assert.strictEqual(capturedPayload.destination.country, 'US');
  } finally {
    globalThis.fetch = originalFetch;
    process.env.ENVIA_API_KEY = originalApiKey;
  }
});

// === GET /api/buscar-cliente ===

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

test('GET /api/buscar-cliente sin rfc retorna 400', async () => {
  const res = await supertest(app).get('/api/buscar-cliente');
  assert.strictEqual(res.status, 400);
  assert.ok(res.body.error);
});

test('GET /api/buscar-cliente?rfc=... retorna 200 con datos cuando existe en Operam', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': () => ({
      ok: true,
      json: async () => ({
        total: 1,
        data: [{
          customer_id: 55, CustName: 'Aceros SA de CV', tax_id: 'ACE010101ABC',
          street: 'Reforma', street_number: '1', suite_number: '',
          district: 'Juarez', postal_code: '06600', city: 'CDMX', state: 'CDMX',
          cfdi_regimen_fiscal: '601',
          branches: [{ br_name: 'Aceros', addr_street: 'Reforma', addr_colony: 'Juarez', addr_zip: '06600', addr_city: 'CDMX', addr_state: 'CDMX', phone: '', email: '' }],
        }],
      }),
    }),
  });
  try {
    const res = await supertest(app).get('/api/buscar-cliente?rfc=ACE010101ABC');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.encontrado, true);
    assert.strictEqual(res.body.cliente_id, 55);
    assert.strictEqual(res.body.CustName, 'Aceros SA de CV');
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
    const res = await supertest(app).get('/api/buscar-cliente?rfc=RFC000000000');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.encontrado, false);
  } finally {
    restore();
  }
});

test('GET /api/buscar-cliente retorna 503 si Operam lanza error', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => { throw new Error('timeout'); },
  });
  try {
    const res = await supertest(app).get('/api/buscar-cliente?rfc=ACE010101ABC');
    assert.strictEqual(res.status, 503);
  } finally {
    restore();
  }
});
