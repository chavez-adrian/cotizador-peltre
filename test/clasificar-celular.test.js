import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROSPECTOS_PATH = join(__dirname, '..', 'data', 'prospectos.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const { clasificarCelular } = await import('../lib/clasificar-celular.js');
const { resetIndice } = await import('../lib/indice-telefonos.js');
const { resetSession } = await import('../lib/operam-client.js');

function readProspectos() {
  if (!existsSync(PROSPECTOS_PATH)) return [];
  return JSON.parse(readFileSync(PROSPECTOS_PATH, 'utf8'));
}
function writeProspectos(data) {
  writeFileSync(PROSPECTOS_PATH, JSON.stringify(data, null, 2));
}

// Ningun test pega a Operam real: fetch bloqueado por defecto, cada test que
// necesita Operam instala sus handlers (mismo patron que prospectos-api.test.js).
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

const PROSPECTO = {
  id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', celular: '+52 5512345678',
  celular10: '5512345678', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp',
  etapa: 'nuevo', eventos: [], data: {},
};

const CLIENTE_OPERAM = {
  customer_id: '77', CustName: 'HOTELERA DEL SUR SA DE CV',
  contacts: [{ phone: '+52 1 55 1234 5678 ext.4', phone2: '' }],
  branches: [],
};

let savedProspectos;
let existia;
before(() => {
  existia = existsSync(PROSPECTOS_PATH);
  savedProspectos = readProspectos();
  globalThis.fetch = fetchBloqueado;
});
after(() => {
  if (existia) writeProspectos(savedProspectos);
  else if (existsSync(PROSPECTOS_PATH)) unlinkSync(PROSPECTOS_PATH);
  globalThis.fetch = originalFetch;
});
beforeEach(() => {
  globalThis.fetch = fetchBloqueado;
  resetIndice();
  resetSession();
});

test('CC1: celular de un prospecto existente clasifica como prospecto, en cualquier formato', async () => {
  writeProspectos([PROSPECTO]);
  const r = await clasificarCelular('+52 55 1234 5678');
  assert.equal(r.tipo, 'prospecto');
  assert.equal(r.prospecto.id, 1);
  assert.equal(r.prospecto.nombre, 'Laura');
});

test('CC2: el prospecto gana sobre el cliente Operam (no consulta el indice si ya es prospecto)', async () => {
  writeProspectos([PROSPECTO]);
  mockListadoClientes([CLIENTE_OPERAM]);
  const r = await clasificarCelular('+52 5512345678');
  assert.equal(r.tipo, 'prospecto');
});

test('CC3: celular de un cliente Operam clasifica como cliente con sus datos minimos', async () => {
  writeProspectos([]);
  mockListadoClientes([CLIENTE_OPERAM]);
  const r = await clasificarCelular('+52 5512345678');
  assert.equal(r.tipo, 'cliente');
  assert.equal(r.cliente.cust_name, 'HOTELERA DEL SUR SA DE CV');
  assert.equal(r.cliente.customer_id, '77');
});

test('CC4: celular que no es de nadie clasifica como libre', async () => {
  writeProspectos([]);
  mockListadoClientes([CLIENTE_OPERAM]);
  const r = await clasificarCelular('+52 5599999999');
  assert.deepEqual(r, { tipo: 'libre' });
});

test('CC5: si el indice de Operam falla, clasifica libre (best effort, trade-off del glosario)', async () => {
  writeProspectos([]);
  const r = await clasificarCelular('+52 5512345678');
  assert.deepEqual(r, { tipo: 'libre' });
});
