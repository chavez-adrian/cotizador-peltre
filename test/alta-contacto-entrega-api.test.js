// #566 (ADR-0024 regla 8): el alta completa de la vista Clientes (POST /api/crear-cliente)
// deja a la persona que crea POST /customers como el Contacto de entrega. Prueba de
// punta a punta de la traduccion del formulario: Operam por su API (mock) y la pagina
// de domicilios de la web legacy de mentiras (paginas medidas del Cliente Operam 15,
// domicilio 564, con la 1289 de General). El formulario no captura quien recibe -- su
// "Nombre del domicilio" es un lugar --, asi que la persona conserva su nombre y recibe
// el Telefono y el correo del domicilio de entrega, y los roles General y Entrega.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { fotoDatos, fijarDatos } from './helpers/datos-aislados.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { webDeMentiras, CONTACTOS_GENERAL_564 } from './helpers/domicilios-web-mentira.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const PROSPECTOS_PATH = join(DATA_DIR, 'prospectos.json');
const VENDEDORES_PATH = join(DATA_DIR, 'vendedores.json');

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
const { resetIndice } = await import('../lib/indice-telefonos.js');

const REGISTRO = [{ id: 1, name: 'Jaime Abaroa', pin: '9995', role: 'admin', operam_id: 7 }];
const TOKEN = jwt.sign({ id: 1, name: 'Jaime Abaroa', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

const originalFetch = globalThis.fetch;
let fa;

function jsonResponse(data, status = 200) {
  return { ok: status < 400, status, json: async () => data };
}

// Operam sin ningun cliente parecido: el alta crea al Cliente Operam 15 con su
// domicilio 564 y la persona 1289, General del cliente (como POST /customers). Lo que
// no es la API v3 es la web legacy de mentiras.
function mockOperam() {
  fa = webDeMentiras({ tabla: CONTACTOS_GENERAL_564 });
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    const metodo = opts?.method || 'GET';
    if (!u.includes('/api/v3/')) return fa.fetch(url, opts);
    if (u.includes('/api/v3/login')) return jsonResponse({ token: 'tok', result: true });
    if (u.includes('/api/v3/sales/sales_types')) return jsonResponse({ data: [{ id: '15', sales_type: 'M100', inactive: '0' }] });
    if (u.includes('/api/v3/sales/customers')) {
      if (metodo === 'POST') return jsonResponse({ result: true, customer_id: 15 });
      if (metodo === 'PUT') return jsonResponse({ result: true });
      if (u.includes('/customers/15')) {
        return jsonResponse({ data: [{ customer_id: '15', sales_type: '15', contacts: [{ id: '1289', action: 'general', name: 'Hoteles Azules', fax: '5511112222' }], branches: [{ branch_code: 564 }] }] });
      }
      return jsonResponse({ total: 0, data: [] });
    }
    if (u.includes('/api/v3/sales/branches/564')) return jsonResponse({ result: true, data: [{ branch_ref: 'AUTO' }] });
    throw new Error('Unmocked fetch: ' + metodo + ' ' + u);
  };
}

let restaurarDatos;
before(() => {
  restaurarDatos = fotoDatos([PROSPECTOS_PATH, VENDEDORES_PATH]);
  fijarDatos(VENDEDORES_PATH, REGISTRO);
  fijarDatos(PROSPECTOS_PATH, []);
});
after(() => {
  restaurarDatos();
  globalThis.fetch = originalFetch;
});
beforeEach(() => {
  resetSession();
  resetIndice();
  mockOperam();
});

test('el alta completa deja a la persona que creo Operam con el Telefono y el correo del domicilio de entrega y con General y Entrega, sin cambiarle el nombre', async () => {
  const res = await supertest(app).post('/api/crear-cliente')
    .set('Authorization', `Bearer ${TOKEN}`)
    .send({
      tax_id: 'HAZ010203AB1', CustName: 'HOTELES AZULES SA DE CV', cust_ref: 'Hoteles Azules',
      cfdi_regimen_fiscal: '601', postal_code: '06000', sales_type: '15', salesman: 7, celular_nota: '5511112222',
      entrega: {
        br_name: 'Almacen Central', br_ref: 'ALMCEN', addr_street: 'Av. Reforma 100', addr_colony: 'Juarez',
        addr_city: 'CDMX', addr_state: 'CDMX', addr_zip: '06600', phone: '5544332211', email: 'lucia@example.com',
      },
    });

  assert.equal(res.status, 200);
  const paso = res.body.steps.find(s => s.name === 'contacto de entrega');
  assert.equal(paso.status, 'ok', paso.detalle);
  const update = fa.pedidos.find(p => p.params.has('contactsUPDATE[1289]'));
  assert.ok(update, 'se edito a la persona que creo Operam');
  assert.deepEqual(
    ['name', 'fax', 'phone', 'email'].map(k => update.params.get(k)),
    ['MEDICION556b General', '5544332211', '5544332211', 'lucia@example.com'],
  );
  assert.deepEqual(update.params.getAll('assgn[]'), ['1', '4']);
  assert.equal(fa.pedidos.some(p => p.params.has('contactsADD')), false, 'no nace otra persona');
});
