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

// Save and restore cotizaciones.json around each test that writes to it
let savedCots;

before(() => {
  savedCots = readCots();
});

after(() => {
  writeCots(savedCots);
});

// === B1: POST /api/cotizacion/pdf con cliente.pais persiste el campo ===
test('B1: POST /api/cotizacion/pdf persiste cliente.pais', async () => {
  const snap = readCots();

  const body = {
    fecha: '2026-01-01',
    vigencia: '2026-02-01',
    tier: 'Mayoreo',
    cliente: {
      razonSocial: 'Test SA',
      nombreCorto: 'Test',
      pais: 'US',
    },
    items: [{ codigo: 'TEST', descripcion: 'Test', cantidad: 1, unidad: 'pza', precio: 100, descuento: 0 }],
    subtotal: 100,
    iva: 16,
    total: 116,
    notas: [],
  };

  const res = await supertest(app)
    .post('/api/cotizacion/pdf')
    .set('Authorization', `Bearer ${TEST_TOKEN}`)
    .send(body);

  // Accept 200 or 500 (PDF generation may fail without full data, but the log should be written before the PDF)
  // Actually we need it to succeed or at least write the log. Check the log.
  const cots = readCots();
  assert.ok(cots.length > snap.length, 'debe agregar una entrada al log');
  const last = cots[cots.length - 1];
  assert.strictEqual(last.data.cliente.pais, 'US', 'cliente.pais debe ser "US"');
});

// === B2: GET /api/cotizaciones/:id sin campo pais responde 200 (backward compat) ===
test('B2: GET /api/cotizaciones/:id sin campo pais no falla', async () => {
  const snap = readCots();
  // Insertar entrada sin pais
  const id = snap.length + 1;
  const entry = {
    id,
    fecha: new Date().toISOString(),
    vendedor: 'Tester',
    cliente: 'Sin nombre',
    totalPiezas: 0,
    total: 0,
    tier: '',
    data: {
      cliente: { razonSocial: 'Sin pais' },
      items: [],
    },
  };
  writeCots([...snap, entry]);

  const res = await supertest(app)
    .get(`/api/cotizaciones/${id}`)
    .set('Authorization', `Bearer ${TEST_TOKEN}`);

  assert.strictEqual(res.status, 200, 'debe responder 200');
  assert.ok(res.body.cliente, 'debe tener datos de cliente');
  // pais puede ser undefined — no debe fallar
});

// === B4: POST /api/cotizacion/envio pasa country correcto a fetch ===
test('B4: POST /api/cotizacion/envio usa paisDestino en destination.country', async () => {
  let capturedPayload = null;
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.ENVIA_API_KEY;

  process.env.ENVIA_API_KEY = 'test-key';

  globalThis.fetch = async (url, opts) => {
    capturedPayload = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({ data: [] }),
    };
  };

  try {
    // PV08 es un modelo valido en boxMap con caja EMPVA056P
    const res = await supertest(app)
      .post('/api/cotizacion/envio')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({
        cpDestino: '90210',
        paisDestino: 'US',
        items: [{ codigo: 'PV08', cantidad: 1 }],
        totalConIVA: 100,
      });

    assert.ok(capturedPayload !== null, 'fetch debe haber sido llamado');
    assert.strictEqual(capturedPayload.destination.country, 'US', 'destination.country debe ser "US"');
  } finally {
    globalThis.fetch = originalFetch;
    process.env.ENVIA_API_KEY = originalApiKey;
  }
});
