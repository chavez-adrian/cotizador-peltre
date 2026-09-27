// #459: la ruta de domicilios del paso Envio marca con `sinEntrega` el branch que
// cumple el predicado "domicilio sin entrega registrada" (sin calle y con el CP
// fiscal generico 56577, en un cliente que NO es generico). El navegador solo pinta
// esa senal: no prellena Envio desde el y no lo propone como default. Casos de la
// medicion de #330: branch 563 del cliente 517 (danado por #386) y branch 452 del
// 417 (BAZAAR SABADO, cubeta generica). Solo LECTURA contra Operam.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}
delete process.env.DATABASE_URL;

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const contactosIo = await import('../lib/contactos-domicilio-io.js');
const { resetSession } = await import('../lib/operam-client.js');
const { app } = await import('../server.js');

const VENDEDOR = `Bearer ${jwt.sign({ id: 7, name: 'Memo', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' })}`;
const originalFetch = globalThis.fetch;

function jsonResponse(data, status = 200) {
  return { ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) };
}

const BRANCHES = {
  563: { branch_code: '563', br_name: 'ROYAL TABLE', addr_street: '', addr_exterior: '', addr_zip: '56577', default_location: '40' },
  600: { branch_code: '600', br_name: 'Bosques', addr_street: 'Bosques de las Lomas', addr_exterior: '12', addr_zip: '11700', default_location: '40' },
  452: { branch_code: '452', br_name: 'BAZAAR SABADO', addr_street: '', addr_exterior: '', addr_zip: '56577', default_location: '40' },
};
const CLIENTES = {
  517: { customer_id: '517', branches: [{ branch_code: '563' }, { branch_code: '600' }], contacts: [] },
  417: { customer_id: '417', branches: [{ branch_code: '452' }], contacts: [] },
};

function mockOperam() {
  const peticiones = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    peticiones.push({ metodo: (opts.method || 'GET').toUpperCase(), url: u });
    if (u.includes('/api/v3/login')) return jsonResponse({ token: 'tok', result: true });
    if (u.includes('/api/v3/admin/contact_list')) return jsonResponse({ total: 0, data: [] });
    const cliente = u.match(/\/api\/v3\/sales\/customers\/(\d+)/);
    if (cliente) return jsonResponse({ data: [CLIENTES[cliente[1]]] });
    const branch = u.match(/\/api\/v3\/sales\/branches\/(\d+)/);
    if (branch) return jsonResponse({ data: [BRANCHES[branch[1]]] });
    if (u.includes('/api/v3/inventory/locations')) return jsonResponse({ data: [{ loc_code: '40', location_name: 'Almacen PT' }] });
    throw new Error('Unmocked fetch: ' + u);
  };
  return peticiones;
}

function domicilios(clienteId) {
  return supertest(app).get(`/api/operam/clientes/${clienteId}/domicilios`).set('Authorization', VENDEDOR);
}

before(() => {
  resetSession();
  contactosIo._reiniciar();
  contactosIo._setIo({ intervaloMs: 0 });
});
after(async () => {
  await contactosIo._esperarRefresco();
  globalThis.fetch = originalFetch;
  contactosIo._reiniciar();
});

test('el branch sin calle y con CP 56577 de un cliente no generico sale marcado sinEntrega; el real de al lado no', async () => {
  const peticiones = mockOperam();
  const res = await domicilios(517);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.domicilios.map(d => [String(d.branch_code), d.sinEntrega]), [['563', true], ['600', false]]);
  const escrituras = peticiones.filter(p => p.metodo !== 'GET' && !p.url.includes('/api/v3/login'));
  assert.deepEqual(escrituras, [], 'solo lectura');
});

test('el mismo patron en el 417 (cliente generico) NO sale marcado: la cubeta se excluye antes de mirar el branch', async () => {
  mockOperam();
  const res = await domicilios(417);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.domicilios.map(d => [String(d.branch_code), d.sinEntrega]), [['452', false]]);
});
