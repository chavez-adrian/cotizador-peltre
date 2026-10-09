// #559: la ruta que alimenta el selector "Contacto de entrega" del paso Envio
// (GET /api/operam/clientes/:id/domicilios) lee las personas con el modulo Contactos
// en Operam y le manda a cada una sus casillas, el Cel incluido, con el telefono que
// le corresponde (Cel > Telefono > Secundario, ADR-0016). Antes la persona que en
// Operam solo tiene Cel llegaba sin telefono. Aqui se prueba la traduccion de la
// ruta; las reglas de la lectura viven en test/contactos-operam.test.js.
import { test, before, beforeEach, after } from 'node:test';
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

// Cliente Operam 15 como lo midio ADR-0024: la 61 (General del cliente) con Telefono,
// la 1287 (Entrega del cliente) con solo Cel. En Bosques de Europa (564) el General
// 1290 tiene solo Cel y viene tambien aplanado en el branch; la 1249 no tiene numeros.
const CLIENTE = {
  customer_id: '15',
  branches: [{ branch_code: '564', br_name: 'Bosques de Europa', contact_name: 'Rosa Almacen', phone: '', fax: '5500000031', email: '' }],
  contacts: [
    { id: '61', action: 'general', ref: 'Adrian Cliente Referencia', name: 'Adrian Cliente Nombre', name2: '', phone: '+52 55 3466 7682', phone2: '', fax: '', email: '', notes: '' },
    { id: '1287', action: 'delivery', ref: 'MEDICION556', name: 'MEDICION556 Entrega', name2: 'Prueba', phone: '', phone2: '', fax: '5500000021', email: 'entrega556@example.com', notes: '' },
    { id: '1301', action: 'order', ref: 'Pedidos', name: '', name2: '', phone: '', phone2: '', fax: '', email: '', notes: '' },
  ],
};
const CONTACT_LIST = [
  { id: '3524', person_id: '0', type: 'cust_branch', action: 'general', entity_id: '564', name: '', last_name: '', ref: '', phone: '', phone2: '', fax: '', email: '' },
  { id: '3590', person_id: '1290', type: 'cust_branch', action: 'general', entity_id: '564', name: 'Rosa Almacen', last_name: '', ref: 'Rosa', phone: '', phone2: '', fax: '5500000031', email: '' },
  { id: '3462', person_id: '1249', type: 'cust_branch', action: 'delivery', entity_id: '564', name: 'Adrian Bosques Nombre', last_name: '', ref: 'Adrian Bosques Referencia', phone: '', phone2: '', fax: '', email: '' },
];

function mockOperam() {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/api/v3/login')) return jsonResponse({ token: 'tok', result: true });
    if (u.includes('/api/v3/admin/contact_list')) return jsonResponse({ total: CONTACT_LIST.length, data: CONTACT_LIST });
    if (u.includes('/api/v3/sales/customers/15')) return jsonResponse({ data: [CLIENTE] });
    if (u.includes('/api/v3/sales/branches/564')) return jsonResponse({ data: [{ branch_code: '564', br_name: 'Bosques de Europa', default_location: '40' }] });
    if (u.includes('/api/v3/inventory/locations')) return jsonResponse({ data: [{ loc_code: '40', location_name: 'Almacen PT' }] });
    throw new Error('Unmocked fetch: ' + u);
  };
}

async function domiciliosConPadron() {
  mockOperam();
  await supertest(app).get('/api/operam/clientes/15/domicilios').set('Authorization', VENDEDOR);
  await contactosIo._esperarRefresco();
  return supertest(app).get('/api/operam/clientes/15/domicilios').set('Authorization', VENDEDOR);
}

before(() => { resetSession(); });
beforeEach(() => {
  contactosIo._reiniciar();
  contactosIo._setIo({ intervaloMs: 0 });
});
after(() => {
  globalThis.fetch = originalFetch;
  contactosIo._reiniciar();
});

test('las personas del domicilio llegan con su person_id, sus casillas y el Cel como telefono', async () => {
  const res = await domiciliosConPadron();
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.domicilios[0].contactos, [
    { personId: '1290', tag: 'general', nombre: 'Rosa Almacen', telefono: '5500000031', email: '', casillas: { cel: '5500000031', telefono: '', secundario: '', correo: '' } },
    { personId: '1249', tag: 'delivery', nombre: 'Adrian Bosques Nombre', telefono: '', email: '', casillas: { cel: '', telefono: '', secundario: '', correo: '' } },
  ]);
});

test('las personas del Cliente Operam llegan con sus casillas: la de solo Cel trae ese numero', async () => {
  const res = await domiciliosConPadron();
  assert.deepEqual(res.body.contacts, [
    { personId: '61', tag: 'general', nombre: 'Adrian Cliente Nombre', telefono: '+52 55 3466 7682', email: '', casillas: { cel: '', telefono: '+52 55 3466 7682', secundario: '', correo: '' } },
    { personId: '1287', tag: 'delivery', nombre: 'MEDICION556 Entrega', telefono: '5500000021', email: 'entrega556@example.com', casillas: { cel: '5500000021', telefono: '', secundario: '', correo: 'entrega556@example.com' } },
  ]);
});

test('el General aplanado del domicilio trae su Cel', async () => {
  const res = await domiciliosConPadron();
  const d = res.body.domicilios[0];
  assert.equal(d.contacto, 'Rosa Almacen');
  assert.equal(d.cel, '5500000031');
});

// Operam guarda personas sin nombre, numero ni correo (la 1301 de Pedidos): no hay
// nada que ofrecerle al vendedor y no salen, como antes de #559.
test('una persona sin nombre, numero ni correo no se ofrece', async () => {
  const res = await domiciliosConPadron();
  assert.ok(!res.body.contacts.some(c => c.personId === '1301'));
});
