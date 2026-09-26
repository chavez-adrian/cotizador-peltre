// Los Clientes Operam de UN Contacto, para su panel "Cotizaciones previas"
// (#393): los que el cotizador persistio MAS el que deriva del indice de
// telefonos (ADR-0016, #345), calculado en lectura solo para el Contacto
// elegido. GET /api/prospectos no lo trae por fila a proposito.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { leerArchivoSync, escribirArchivoSync, borrarArchivoSync } from '../lib/fs-reintento.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROSPECTOS_PATH = join(__dirname, '..', 'data', 'prospectos.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}
delete process.env.DATABASE_URL;

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');
const { resetIndice } = await import('../lib/indice-telefonos.js');
const { resetSession } = await import('../lib/operam-client.js');
const ADMIN = jwt.sign({ id: 99, name: 'Tester', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
const OTRO = jwt.sign({ id: 98, name: 'Otro', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });

function readJson(p) { return existsSync(p) ? JSON.parse(leerArchivoSync(p)) : []; }
function writeJson(p, data) { escribirArchivoSync(p, JSON.stringify(data, null, 2)); }

// ROYAL TABLE: la razon social de Luis Emilio Zarabozo desde el upgrade
// fiscal. Su celular vive en la casilla Cel (`fax` en la API).
const ROYAL_TABLE = {
  customer_id: '517', CustName: 'ROYAL TABLE', cust_ref: 'Royal Table',
  tax_id: 'RTA200101AB1', country: 'Mexico',
  contacts: [{ name: 'Luis Emilio', phone: '', phone2: '', fax: '+52 55 4444 3333', email: '' }],
  branches: [{ branch_code: '518', br_name: 'MATRIZ', phone: '' }],
};

const ZARABOZO = {
  id: 7, fecha: '2026-06-01T00:00:00Z', vendedor: 'Tester', celular: '+52 55 4444 3333',
  nombre: 'Luis Emilio Zarabozo', ciudad: 'CDMX', canal: 'WhatsApp', etapa: 'seguimiento',
  eventos: [], data: {},
};

const originalFetch = globalThis.fetch;
const fetchBloqueado = async (url) => { throw new Error('fetch sin mock en tests: ' + url); };

function mockOperam(padron) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/api/v3/login')) return { ok: true, json: async () => ({ token: 'tok', result: true }) };
    if (u.includes('/api/v3/sales/customers') && u.includes('limit=100')) {
      return { ok: true, json: async () => ({ total: padron.length, data: padron }) };
    }
    throw new Error('Unmocked fetch: ' + u);
  };
}

const ligados = (celular, token = ADMIN) => supertest(app)
  .get('/api/contactos/clientes-operam?celular=' + encodeURIComponent(celular))
  .set('Authorization', `Bearer ${token}`);

let savedProspectos, existiaProspectos;
before(() => {
  existiaProspectos = existsSync(PROSPECTOS_PATH);
  savedProspectos = readJson(PROSPECTOS_PATH);
});
after(() => {
  if (existiaProspectos) writeJson(PROSPECTOS_PATH, savedProspectos);
  else if (existsSync(PROSPECTOS_PATH)) borrarArchivoSync(PROSPECTOS_PATH);
  globalThis.fetch = originalFetch;
});
beforeEach(() => {
  writeJson(PROSPECTOS_PATH, [ZARABOZO]);
  globalThis.fetch = fetchBloqueado;
  resetIndice();
  resetSession();
});

test('#393: un Contacto sin ligas persistidas trae su liga derivada de Operam', async () => {
  mockOperam([ROYAL_TABLE]);
  const res = await ligados('5544443333');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.clientesOperam, ['517']);
});

test('#393: las ligas persistidas y la derivada salen juntas y sin repetidos', async () => {
  writeJson(PROSPECTOS_PATH, [{ ...ZARABOZO, data: { cliente_id: 780, clientes_operam: [{ cliente_id: 780, fuente: 'cotizador' }, { cliente_id: '517', fuente: 'cotizador' }] } }]);
  mockOperam([ROYAL_TABLE]);
  const res = await ligados('+52 55 4444 3333');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.clientesOperam, ['780', '517']);
});

test('#393: con el indice de Operam caido responde solo las ligas persistidas', async () => {
  writeJson(PROSPECTOS_PATH, [{ ...ZARABOZO, data: { cliente_id: 780 } }]);
  const res = await ligados('5544443333');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.clientesOperam, ['780']);
});

test('#393: el Contacto de otro vendedor no se lee', async () => {
  mockOperam([ROYAL_TABLE]);
  const res = await ligados('5544443333', OTRO);
  assert.equal(res.status, 404);
});
