import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROSPECTOS_PATH = join(__dirname, '..', 'data', 'prospectos.json');
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
const { resetIndice } = await import('../lib/indice-telefonos.js');
const { resetSession } = await import('../lib/operam-client.js');
const MEMO_TOKEN = jwt.sign({ id: 7, name: 'Memo', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });
const ANA_TOKEN = jwt.sign({ id: 8, name: 'Ana', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });

function readProspectos() {
  if (!existsSync(PROSPECTOS_PATH)) return [];
  return JSON.parse(readFileSync(PROSPECTOS_PATH, 'utf8'));
}
function writeProspectos(data) {
  writeFileSync(PROSPECTOS_PATH, JSON.stringify(data, null, 2));
}
function readCots() {
  if (!existsSync(COTS_PATH)) return [];
  return JSON.parse(readFileSync(COTS_PATH, 'utf8'));
}

// Ningun test pega a Operam real: fetch bloqueado por defecto (la clasificacion
// best effort cae a libre) y cada test que necesita Operam instala sus handlers.
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
  return { ok: status < 400, status, json: async () => data };
}

function mockListadoClientes(clientes) {
  mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': () => jsonResponse({ total: clientes.length, data: clientes }),
  });
}

const CLIENTE_OPERAM = {
  customer_id: '77', CustName: 'HOTELERA DEL SUR SA DE CV',
  contacts: [{ phone: '+52 55 1234 5678', phone2: '' }],
  branches: [],
};

function prospectoDe(vendedor, etapa = 'nuevo', extra = {}) {
  return {
    id: 1, fecha: '2026-06-01T00:00:00Z', vendedor, celular: '+52 5512345678',
    celular10: '5512345678', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp',
    etapa, eventos: [], data: {}, ...extra,
  };
}

let savedProspectos, savedCots;
let existiaProspectos;
before(() => {
  existiaProspectos = existsSync(PROSPECTOS_PATH);
  savedProspectos = readProspectos();
  savedCots = readCots();
  globalThis.fetch = fetchBloqueado;
});
after(() => {
  if (existiaProspectos) writeProspectos(savedProspectos);
  else if (existsSync(PROSPECTOS_PATH)) unlinkSync(PROSPECTOS_PATH);
  writeFileSync(COTS_PATH, JSON.stringify(savedCots, null, 2));
  globalThis.fetch = originalFetch;
});
beforeEach(() => {
  globalThis.fetch = fetchBloqueado;
  resetIndice();
  resetSession();
});

// === GET /api/prospectos/clasificar (pre-clasificacion para el frontend) ===

test('E1: GET /api/prospectos/clasificar sin token responde 401', async () => {
  const res = await supertest(app).get('/api/prospectos/clasificar?celular=%2B52%205512345678');
  assert.equal(res.status, 401);
});

test('E2: GET /api/prospectos/clasificar sin celular responde 400', async () => {
  const res = await supertest(app).get('/api/prospectos/clasificar')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(res.status, 400);
});

test('E3: celular de prospecto clasifica como prospecto sin exponer sus datos, sea de quien sea', async () => {
  writeProspectos([prospectoDe('Memo')]);
  const propio = await supertest(app).get('/api/prospectos/clasificar')
    .query({ celular: '+52 55 1234 5678' })
    .set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(propio.status, 200);
  assert.deepEqual(propio.body, { tipo: 'prospecto' });
  const ajeno = await supertest(app).get('/api/prospectos/clasificar')
    .query({ celular: '+52 5512345678' })
    .set('Authorization', `Bearer ${ANA_TOKEN}`);
  assert.deepEqual(ajeno.body, { tipo: 'prospecto' });
});

test('E4: celular de cliente Operam clasifica como cliente con su nombre', async () => {
  writeProspectos([]);
  mockListadoClientes([CLIENTE_OPERAM]);
  const res = await supertest(app).get('/api/prospectos/clasificar')
    .query({ celular: '+52 5512345678' })
    .set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { tipo: 'cliente', cust_name: 'HOTELERA DEL SUR SA DE CV' });
});

test('E5: celular desconocido clasifica libre, tambien cuando Operam falla (best effort)', async () => {
  writeProspectos([]);
  mockListadoClientes([CLIENTE_OPERAM]);
  const libre = await supertest(app).get('/api/prospectos/clasificar')
    .query({ celular: '+52 5599999999' })
    .set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.deepEqual(libre.body, { tipo: 'libre' });
  resetIndice();
  resetSession();
  globalThis.fetch = fetchBloqueado;
  const caido = await supertest(app).get('/api/prospectos/clasificar')
    .query({ celular: '+52 5512345678' })
    .set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.deepEqual(caido.body, { tipo: 'libre' });
});
