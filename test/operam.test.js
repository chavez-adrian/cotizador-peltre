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

function mockFetch(impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => { globalThis.fetch = original; };
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

// === B1: GET /api/operam/clientes?q=banco retorna array ===
test('B1: GET /api/operam/clientes?q=banco retorna array con elementos', async () => {
  resetSession();
  let loginDone = false;
  const restore = mockFetch(async (url, opts) => {
    if (!loginDone && opts?.method === 'POST') {
      loginDone = true;
      return { headers: { get: () => 'PHPSESSID=abc123' }, status: 302, ok: false };
    }
    if (!loginDone) {
      return { headers: { get: () => 'PHPSESSID=abc123' }, ok: true, redirected: false };
    }
    if (url.includes('customers.ajax.php')) {
      return { ok: true, status: 200, redirected: false, json: async () => [{ id: '1', name: 'Banco X', rfc: 'XAXX010101000' }] };
    }
    return { ok: true, status: 200, redirected: false, json: async () => [] };
  });

  try {
    const res = await req
      .get('/api/operam/clientes?q=banco')
      .set('Authorization', `Bearer ${TOKEN}`);

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body), 'debe ser array');
    assert.ok(res.body.length >= 1, 'debe tener al menos un elemento');
    assert.ok(res.body[0].name, 'elemento debe tener campo name');
  } finally {
    restore();
  }
});

// === B2: Sin token retorna 401 ===
test('B2: GET /api/operam/clientes sin token retorna 401', async () => {
  const res = await req.get('/api/operam/clientes?q=test');
  assert.strictEqual(res.status, 401);
});

// === B3: GET /api/operam/clientes/:id/domicilios retorna array ===
test('B3: GET /api/operam/clientes/:id/domicilios retorna array', async () => {
  // Session may already be valid from B1 — just ensure fetch returns OK
  const restore = mockFetch(async (url, opts) => {
    if (url.includes('customers.ajax.php')) {
      return { ok: true, status: 200, redirected: false, json: async () => [] };
    }
    if (url.includes('customers.php')) {
      return { ok: true, status: 200, text: async () => '<html><body>Sin domicilios</body></html>' };
    }
    // login or other
    if (opts?.method === 'POST' && !url.includes('customers')) {
      return { headers: { get: () => 'PHPSESSID=dom123' }, status: 302, ok: false };
    }
    return { headers: { get: () => 'PHPSESSID=dom123' }, ok: true, redirected: false };
  });

  try {
    const res = await req
      .get('/api/operam/clientes/123/domicilios')
      .set('Authorization', `Bearer ${TOKEN}`);

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body), 'debe ser array');
  } finally {
    restore();
  }
});

// === B4: Operam no responde => 503 ===
test('B4: Operam no responde => 503', async () => {
  resetSession();
  const restore = mockFetch(async () => {
    throw new Error('Operam 500');
  });

  try {
    const res = await req
      .get('/api/operam/clientes?q=test')
      .set('Authorization', `Bearer ${TOKEN}`);

    assert.strictEqual(res.status, 503);
  } finally {
    restore();
  }
});

// === B5: POST /api/cotizacion/operam/:id llama a Operam ===
test('B5: POST /api/cotizacion/operam/:id llama a Operam con cotizacion existente', async () => {
  // Crear entrada de prueba en cotizaciones.json
  const snap = readCots();
  const id = snap.length + 1;
  const entry = {
    id,
    fecha: new Date().toISOString(),
    vendedor: 'Test',
    cliente: 'Test SA',
    totalPiezas: 2,
    total: 1000,
    tier: 'Mayoreo',
    data: {
      cliente: { razonSocial: 'Test SA', rfc: 'XAXX010101000' },
      items: [{ codigo: 'PV08', descripcion: 'Plato', cantidad: 2, precio: 500 }],
    },
  };
  writeCots([...snap, entry]);

  const calledUrls = [];
  let callCount = 0;
  const restore = mockFetch(async (url, opts) => {
    calledUrls.push(url);
    callCount++;
    // login init
    if (callCount === 1) return { headers: { get: () => 'PHPSESSID=b5test' }, ok: true, redirected: false, json: async () => [] };
    // login POST
    if (callCount === 2) return { headers: { get: () => 'PHPSESSID=b5test' }, status: 302, ok: false };
    // ensureSession
    if (callCount === 3) return { status: 200, ok: true, redirected: false, json: async () => [] };
    // buscarClientes
    if (url.includes('customers.ajax.php')) return { ok: true, status: 200, json: async () => [{ id: '42', name: 'Test SA', rfc: 'XAXX010101000' }] };
    // saleshdr.php
    return { ok: true, status: 200, text: async () => 'Cotizacion 999 creada' };
  });

  try {
    const res = await req
      .post(`/api/cotizacion/operam/${id}`)
      .set('Authorization', `Bearer ${TOKEN}`);

    assert.ok([200, 503].includes(res.status), `status debe ser 200 o 503, fue ${res.status}`);
    assert.ok(
      calledUrls.some(u => u.includes('operam.pro')),
      'debe haber llamado a operam.pro'
    );
  } finally {
    restore();
    writeCots(snap);
  }
});

// === B6: POST /api/cotizacion/operam/:id con id inexistente retorna 404 ===
test('B6: POST /api/cotizacion/operam/:id con id inexistente retorna 404', async () => {
  const res = await req
    .post('/api/cotizacion/operam/99999')
    .set('Authorization', `Bearer ${TOKEN}`);

  assert.strictEqual(res.status, 404);
});
