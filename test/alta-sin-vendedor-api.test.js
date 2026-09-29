// #466: sin vendedor con ID de Operam el alta se bloquea ANTES de escribir nada en
// Operam, y los dos caminos que piden el alta lo traducen como el cliente sin lista
// de precios (#285): un dato que falta fuera de la cotizacion y que corrige un
// administrador. La subida responde 422 con codigo propio y el documento sale como
// PRE con su motivo; el alta completa responde el mismo 422. Ninguno cae al 503 de
// "fallo Operam".
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync } from '../lib/fs-reintento.js';
import { fotoDatos, fijarDatos } from './helpers/datos-aislados.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const COTS_PATH = join(DATA_DIR, 'cotizaciones.json');
const COLA_POSTFIX_PATH = join(DATA_DIR, 'postfix-pendientes.json');
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

// El registro fijado: Jaime sin operam_id, como la cuenta que hoy no lo tiene.
const REGISTRO = [
  { id: 1, name: 'Jaime Abaroa', pin: '9995', role: 'admin', operam_id: null },
  { id: 2, name: 'Alejandro Chavez', pin: '9992', role: 'vendedor', operam_id: 2 },
];
const TOKEN_SIN_ID = jwt.sign({ id: 1, name: 'Jaime Abaroa', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

const originalFetch = globalThis.fetch;
let escrituras = [];

// Operam sin ningun cliente parecido: la dedup sale limpia y el alta llegaria a
// crear. Cada escritura queda registrada para afirmar que NO hubo ninguna.
function mockOperamVacio() {
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    const metodo = opts?.method || 'GET';
    if (u.includes('/api/v3/login')) return jsonResponse({ token: 'tok', result: true });
    if (metodo !== 'GET') escrituras.push(`${metodo} ${u}`);
    if (u.includes('/api/v3/sales/sales_types')) return jsonResponse({ data: [{ id: '15', sales_type: 'M100', inactive: '0' }] });
    if (u.includes('/api/v3/sales/customers')) return jsonResponse({ total: 0, data: [] });
    throw new Error('Unmocked fetch: ' + metodo + ' ' + u);
  };
}

function jsonResponse(data, status = 200) {
  return { ok: status < 400, status, json: async () => data };
}

function readCots() {
  return existsSync(COTS_PATH) ? JSON.parse(leerArchivoSync(COTS_PATH)) : [];
}

let restaurarDatos;
before(() => {
  restaurarDatos = fotoDatos([COTS_PATH, PROSPECTOS_PATH, COLA_POSTFIX_PATH, VENDEDORES_PATH]);
  fijarDatos(VENDEDORES_PATH, REGISTRO);
  fijarDatos(PROSPECTOS_PATH, []);
});
after(() => {
  restaurarDatos();
  globalThis.fetch = originalFetch;
});
beforeEach(() => {
  escrituras = [];
  resetSession();
  resetIndice();
  mockOperamVacio();
});

function nuevaCotizacion(vendedor) {
  const cots = readCots();
  const id = cots.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  cots.push({
    id, fecha: '2026-09-25T00:00:00Z', vendedor, cliente: 'Hotel Azul',
    totalPiezas: 100, total: 11600, tier: 'M100',
    data: {
      fecha: '2026-09-25', vigencia: '2026-10-25',
      cliente: { razonSocial: 'Hotel Azul Centro', nombreCorto: 'Hotel Azul', telefono: '+52 5588776655', pais: 'MX' },
      items: [{ codigo: 'PV08', descripcion: 'Plato', cantidad: 100, precio: 100, descuento: 0 }],
    },
  });
  fijarDatos(COTS_PATH, cots);
  return id;
}

test('la subida de un cliente nuevo cuyo vendedor no tiene ID de Operam no crea nada y sale como PRE con el motivo', async () => {
  const id = nuevaCotizacion('Jaime Abaroa');
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN_SIN_ID}`).send({});

  assert.equal(res.status, 422);
  assert.equal(res.body.codigo, 'VENDEDOR_SIN_ID_OPERAM');
  assert.equal(res.body.error,
    'No se puede dar de alta el cliente: Jaime Abaroa no tiene ID de Operam. P\u00eddele al administrador que se lo asigne en /admin.');
  assert.match(res.body.detalle, /vendedor "Jaime Abaroa"/);
  assert.ok(!('customer_id' in res.body), 'no se creo ningun Cliente Operam');
  assert.deepEqual(escrituras, []);

  const cot = readCots().find(c => c.id === id);
  assert.equal(cot.data.motivoPre, 'sin-vendedor');
  assert.equal(cot.folioOperam ?? null, null);
  assert.equal(cot.data.cliente.customerId, undefined, 'la cotizacion no queda ligada a ningun cliente');
  const html = await supertest(app).get(`/api/cotizacion/html/${id}`);
  assert.equal(html.status, 200, 'el documento sale como PRE-COTIZACION');
});

test('el alta completa sin vendedor elegido de quien no tiene ID de Operam responde el bloqueo en dos capas sin escribir', async () => {
  const res = await supertest(app).post('/api/crear-cliente')
    .set('Authorization', `Bearer ${TOKEN_SIN_ID}`)
    .send({
      tax_id: 'HAZ010203AB1', CustName: 'HOTELES AZULES SA DE CV', cust_ref: 'Hoteles Azules',
      cfdi_regimen_fiscal: '601', postal_code: '06000', sales_type: '15',
      entrega: { br_name: 'Recepcion', addr_street: 'Av. Reforma 100', addr_zip: '06600' },
    });

  assert.equal(res.status, 422);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.codigo, 'VENDEDOR_SIN_ID_OPERAM');
  assert.equal(res.body.error,
    'No se puede dar de alta el cliente: Jaime Abaroa no tiene ID de Operam. P\u00eddele al administrador que se lo asigne en /admin.');
  assert.match(res.body.detalle, /salesmanId \(ninguno\)/);
  assert.equal(res.body.customer_id, null);
  assert.ok(res.body.steps.some(s => s.status === 'error' && s.mensaje === res.body.error));
  assert.deepEqual(escrituras, []);
});
