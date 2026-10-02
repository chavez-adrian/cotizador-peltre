// #492: el regimen fiscal es el del receptor en las facturas. Con un RFC real y sin
// regimen, POST /api/crear-cliente ya no lo rellena con 612: responde 400 con codigo
// propio y mensaje en dos capas ANTES de escribir nada en Operam. El RFC generico
// (XAXX/XEXX) no cambia: nace con 616 (#121).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { fotoDatos, fijarDatos } from './helpers/datos-aislados.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

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

// El vendedor SI tiene ID de Operam y la lista es valida: lo unico que falta en el
// alta es el regimen, asi que el bloqueo no puede confundirse con el de #466.
const REGISTRO = [{ id: 1, name: 'Jaime Abaroa', pin: '9995', role: 'admin', operam_id: 7 }];
const TOKEN = jwt.sign({ id: 1, name: 'Jaime Abaroa', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

const originalFetch = globalThis.fetch;
let escrituras = [];
let cuerpoPost = null;

function jsonResponse(data, status = 200) {
  return { ok: status < 400, status, json: async () => data };
}

// Operam sin ningun cliente parecido: la dedup sale limpia y el alta llegaria a
// crear. Cada escritura queda registrada; el POST del cliente responde como Operam
// y su cuerpo se guarda para leer el regimen con el que nacio.
function mockOperam() {
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    const metodo = opts?.method || 'GET';
    if (u.includes('/api/v3/login')) return jsonResponse({ token: 'tok', result: true });
    if (metodo !== 'GET') escrituras.push(`${metodo} ${u}`);
    if (u.includes('/api/v3/sales/sales_types')) return jsonResponse({ data: [{ id: '15', sales_type: 'M100', inactive: '0' }] });
    if (u.includes('/api/v3/sales/customers')) {
      if (metodo === 'POST') {
        cuerpoPost = JSON.parse(opts.body);
        return jsonResponse({ result: true, customer_id: 501 });
      }
      if (u.includes('/501')) return jsonResponse({ data: [{ sales_type: '15', branches: [{ branch_code: 601 }] }] });
      return jsonResponse({ total: 0, data: [] });
    }
    if (u.includes('/api/v3/sales/branches/601')) return jsonResponse({ result: true, data: [{}] });
    throw new Error('Unmocked fetch: ' + metodo + ' ' + u);
  };
}

const ENTREGA = { br_name: 'Recepcion', br_ref: 'RECEP', addr_street: 'Av. Reforma 100', addr_colony: 'Juarez', addr_city: 'CDMX', addr_state: 'CDMX', addr_zip: '06600' };

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
  escrituras = [];
  cuerpoPost = null;
  resetSession();
  resetIndice();
  mockOperam();
});

test('el alta con RFC real y sin regimen fiscal responde 400 REGIMEN_FISCAL_REQUERIDO en dos capas sin escribir en Operam', async () => {
  const res = await supertest(app).post('/api/crear-cliente')
    .set('Authorization', `Bearer ${TOKEN}`)
    .send({
      tax_id: 'HAZ010203AB1', CustName: 'HOTELES AZULES SA DE CV', cust_ref: 'Hoteles Azules',
      postal_code: '06000', sales_type: '15', entrega: ENTREGA,
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.codigo, 'REGIMEN_FISCAL_REQUERIDO');
  assert.equal(res.body.error,
    'No se puede dar de alta el cliente: falta el r\u00e9gimen fiscal. Elige el de su constancia de situaci\u00f3n fiscal y vuelve a intentarlo. No se escribi\u00f3 nada en Operam.');
  assert.match(res.body.detalle, /RFC HAZ010203AB1 sin cfdi_regimen_fiscal/);
  assert.match(res.body.detalle, /no se escribio nada en Operam/);
  assert.equal(res.body.customer_id, null);
  assert.ok(res.body.steps.some(s => s.status === 'error' && s.mensaje === res.body.error));
  assert.deepEqual(escrituras, []);
  assert.equal(cuerpoPost, null);
});

test('el regimen en blanco cuenta como ausente: tambien 400 sin escribir', async () => {
  const res = await supertest(app).post('/api/crear-cliente')
    .set('Authorization', `Bearer ${TOKEN}`)
    .send({
      tax_id: 'HAZ010203AB1', CustName: 'HOTELES AZULES SA DE CV', cust_ref: 'Hoteles Azules',
      cfdi_regimen_fiscal: '  ', postal_code: '06000', sales_type: '15', entrega: ENTREGA,
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.codigo, 'REGIMEN_FISCAL_REQUERIDO');
  assert.deepEqual(escrituras, []);
});

test('la eleccion de un Cliente Operam existente no salta el bloqueo: sin regimen no se escribe nada', async () => {
  const res = await supertest(app).post('/api/crear-cliente')
    .set('Authorization', `Bearer ${TOKEN}`)
    .send({
      tax_id: 'HAZ010203AB1', CustName: 'HOTELES AZULES SA DE CV', cust_ref: 'Hoteles Azules',
      postal_code: '06000', sales_type: '15', entrega: ENTREGA,
      decision: { tipo: 'usar', clienteId: 61 },
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.codigo, 'REGIMEN_FISCAL_REQUERIDO');
  assert.deepEqual(escrituras, []);
});

test('el alta con RFC generico y sin regimen sigue creando el Cliente Operam con 616', async () => {
  const res = await supertest(app).post('/api/crear-cliente')
    .set('Authorization', `Bearer ${TOKEN}`)
    .send({
      tax_id: 'XAXX010101000', CustName: 'Hotel Azul Centro', cust_ref: 'Hotel Azul',
      sales_type: '15', entrega: ENTREGA,
    });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.customer_id, 501);
  assert.equal(cuerpoPost.tax_id, 'XAXX010101000');
  assert.equal(cuerpoPost.cfdi_regimen_fiscal, '616');
});
