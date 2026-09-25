// #105: el paso Envio muestra a donde llega la factura. Los Contactos en Operam con la
// marca Invoices del Cliente Operam ya viajaban en `contacts[]`; los del DOMICILIO de
// entrega solo salen de contact_list (#397), y aqui se prueba la costura: la ruta de
// domicilios pega a cada domicilio sus contactos desde la cache, sin esperar a Operam
// cuando la cache esta fria y sin fallar si contact_list falla. Solo LECTURA: fuera
// del login, ninguna peticion que no sea GET sale hacia Operam.
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

// Cliente Operam 15 con dos domicilios (Pestalozzi 15 y Bosques de Europa 564, los de
// #397). A nivel cliente: el General (gustavo_barcia@yahoo.com, el prellenado del bug)
// y las dos de Facturacion del caso real del ticket.
const CLIENTE = {
  customer_id: '15',
  branches: [{ branch_code: '15', br_name: 'Pestalozzi' }, { branch_code: '564', br_name: 'Bosques de Europa' }],
  contacts: [
    { action: 'general', name: 'Gustavo Barcia', phone: '55 4860 9144', email: 'gustavo_barcia@yahoo.com' },
    { action: 'invoice', name: 'Elisa Betancourt', phone: '', email: 'elisa.betancourt@cliente.mx' },
    { action: 'invoice', name: 'Flor Sosa', phone: '', email: 'flor.sosa@cliente.mx' },
  ],
};
const CONTACT_LIST = [
  { id: '3460', type: 'cust_branch', action: 'delivery', entity_id: '15', name: 'Adrian Pestalozzi Nombre', ref: 'Adrian Pestalozzi Referencia', phone: '', email: '' },
  { id: '3462', type: 'cust_branch', action: 'delivery', entity_id: '564', name: 'Adrian Bosques Nombre', ref: 'Adrian Bosques Referencia', phone: '', email: '' },
  { id: '3463', type: 'cust_branch', action: 'invoice', entity_id: '564', name: 'Cuentas Bosques', ref: 'Facturacion', phone: '', email: 'cxp.bosques@cliente.mx' },
  { id: '3425', type: 'cust_branch', action: 'delivery', entity_id: '15', name: '', ref: '', phone: '', email: '' },
  { id: '100', type: 'customer', action: 'invoice', entity_id: '15', name: 'Elisa Betancourt', phone: '', email: 'elisa.betancourt@cliente.mx' },
];

function mockOperam({ contactListFalla = false } = {}) {
  const peticiones = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const metodo = (opts.method || 'GET').toUpperCase();
    peticiones.push({ metodo, url: u });
    if (u.includes('/api/v3/login')) return jsonResponse({ token: 'tok', result: true });
    if (u.includes('/api/v3/admin/contact_list')) {
      if (contactListFalla) return jsonResponse({ message: 'error interno' }, 500);
      return jsonResponse({ total: CONTACT_LIST.length, data: CONTACT_LIST });
    }
    if (u.includes('/api/v3/sales/customers/15')) return jsonResponse({ data: [CLIENTE] });
    if (u.includes('/api/v3/sales/branches/')) {
      const codigo = u.split('/api/v3/sales/branches/')[1];
      const b = CLIENTE.branches.find(x => x.branch_code === codigo);
      return jsonResponse({ data: [{ branch_code: codigo, br_name: b.br_name, default_location: '40' }] });
    }
    if (u.includes('/api/v3/inventory/locations')) return jsonResponse({ data: [{ loc_code: '40', location_name: 'Almacen PT' }] });
    throw new Error('Unmocked fetch: ' + u);
  };
  return peticiones;
}

function domicilios() {
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

test('con la cache fria los domicilios salen igual (contactos null: no se sabe) y el padron de contact_list se carga en segundo plano', async () => {
  const peticiones = mockOperam();
  const res = await domicilios();
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.domicilios.map(d => d.contactos), [null, null]);

  await contactosIo._esperarRefresco();
  assert.equal(peticiones.filter(p => p.url.includes('/api/v3/admin/contact_list')).length, 1);
  const escrituras = peticiones.filter(p => p.metodo !== 'GET' && !p.url.includes('/api/v3/login'));
  assert.deepEqual(escrituras, [], 'solo lectura (el login es la unica peticion que no es GET)');
});

test('con la cache caliente cada domicilio trae sus contactos (el de Facturacion de Bosques incluido) y contacts[] del cliente no cambia', async () => {
  mockOperam();
  await domicilios();
  await contactosIo._esperarRefresco();

  const res = await domicilios();
  assert.equal(res.status, 200);
  const [pestalozzi, bosques] = res.body.domicilios;
  assert.equal(pestalozzi.branch_code, '15');
  assert.deepEqual(pestalozzi.contactos, [{ tag: 'delivery', nombre: 'Adrian Pestalozzi Nombre', telefono: '', email: '' }]);
  assert.equal(bosques.branch_code, '564');
  assert.deepEqual(bosques.contactos, [
    { tag: 'delivery', nombre: 'Adrian Bosques Nombre', telefono: '', email: '' },
    { tag: 'invoice', nombre: 'Cuentas Bosques', telefono: '', email: 'cxp.bosques@cliente.mx' },
  ]);
  assert.deepEqual(res.body.contacts.map(c => [c.tag, c.email]), [
    ['general', 'gustavo_barcia@yahoo.com'],
    ['invoice', 'elisa.betancourt@cliente.mx'],
    ['invoice', 'flor.sosa@cliente.mx'],
  ]);
});

test('si contact_list falla, los domicilios salen igual y con contactos null: degrada en silencio', async () => {
  mockOperam({ contactListFalla: true });
  const warn = console.warn;
  console.warn = () => {};
  try {
    await domicilios();
    await contactosIo._esperarRefresco();
    const res = await domicilios();
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.domicilios.map(d => d.contactos), [null, null]);
  } finally {
    console.warn = warn;
  }
});
