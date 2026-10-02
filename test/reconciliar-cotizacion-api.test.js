// #508: un admin reconcilia UNA cotizacion con Operam por su documento. La regla
// (pedido por trans_no_from, cadena con el cliente del pedido) se prueba en
// test/sync-operam-documento.test.js; aqui la costura HTTP: permisos, 404, el
// modo en seco que no escribe, la respuesta y el error de Operam.
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
const COTS_PATH = join(__dirname, '..', 'data', 'cotizaciones.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}
// La ruta escribe via el store de cotizaciones: con pool real le pegaria a Neon.
delete process.env.DATABASE_URL;

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const syncIo = await import('../lib/sync-operam-io.js');
const { resetSession } = await import('../lib/operam-client.js');
const { app } = await import('../server.js');

const ADMIN = `Bearer ${jwt.sign({ id: 1, name: 'Jefa Test', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' })}`;
const VENDEDOR = `Bearer ${jwt.sign({ id: 7, name: 'Memo', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' })}`;
const RUTA = (id) => `/api/admin/cotizaciones/${id}/reconciliar-operam`;

const originalFetch = globalThis.fetch;
function jsonResponse(data, status = 200) {
  return { ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) };
}

// La 1309 del ticket: registro sin RFC, Cliente Operam 537, pedido 7762 en Operam
// que el cotizador no conoce. Aqui con factura sin pagar y remision.
const COT_1309 = {
  id: 132, fecha: '2026-09-30T17:20:28.903Z', vendedor: 'Memo', cliente: 'CLIENTE 1309',
  totalPiezas: 10, total: 3675.46, etapa: 'seguimiento', folioOperam: '1309',
  data: { cliente: { customerId: '537' } },
};
const PEDIDOS = [
  { order_no: '7762', trans_type: '30', debtor_no: '537', trans_no_from: '1309', total: '3675.46', ord_date: '2026-09-30' },
  { order_no: '7100', trans_type: '30', debtor_no: '345', trans_no_from: '1050', total: '5000', ord_date: '2026-09-29' },
];
const TRANSACCIONES_537 = [
  { type: '10', order_: '7762', trans_no: '6990', reference: 'A2100', total_amount: '3675.46', allocated: '0', outstanding: '3675.46', debtor_no: '537' },
  { type: '13', order_: '7762', trans_no: '7700', reference: '2400', debtor_no: '537' },
];

// #512: la 1239 y su unico pedido 7616, anulado en Operam (total 0 en la API).
const COT_1239 = {
  id: 140, fecha: '2026-08-28T18:00:00.000Z', vendedor: 'Memo', cliente: 'CLIENTE 1239',
  totalPiezas: 10, total: 1200, etapa: 'seguimiento', folioOperam: '1239',
  data: { cliente: { customerId: '499', rfc: 'XAXX010101000' } },
};
const PEDIDO_7616 = { order_no: '7616', trans_type: '30', debtor_no: '256', trans_no_from: '1239', total: '0', ord_date: '2026-08-31' };

// La web legacy (FA): login y la vista del pedido, la unica que dice si esta anulado.
// La sonda 5960 es un pedido anulado conocido.
function htmlResponse(html) {
  return { ok: true, status: 200, headers: new Headers(), text: async () => html, json: async () => ({}) };
}

function operam({ fallaTransacciones = false, pedidos = PEDIDOS, anulados = [], webCaida = false } = {}) {
  const lecturas = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    lecturas.push(u);
    if (u.includes('/sales/view/view_sales_order.php')) {
      if (webCaida) throw new Error('ECONNRESET');
      const n = new URL(u).searchParams.get('trans_no');
      return htmlResponse(n === '5960' || anulados.includes(n) ? '<div>Este pedido ha sido cancelado</div>' : '<table><tr><td>Pedido</td></tr></table>');
    }
    if (u.includes('/api/v3/login')) return jsonResponse({ token: 'tok', result: true });
    if (u.includes('/api/v3/sales/sales_orders')) return jsonResponse({ data: pedidos });
    if (u.includes('/api/v3/sales/transactions')) {
      if (fallaTransacciones) return jsonResponse({ message: 'error interno' }, 500);
      return jsonResponse({ data: u.includes('customer_id=537') ? TRANSACCIONES_537 : [] });
    }
    throw new Error('Unmocked fetch: ' + u);
  };
  return lecturas;
}

function cotizaciones() {
  return JSON.parse(leerArchivoSync(COTS_PATH));
}

let restaurarDatos;
before(() => {
  restaurarDatos = fotoDatos([COTS_PATH]);
  syncIo._setRitmo({ intervaloMs: 0 });
});
after(() => {
  restaurarDatos();
  syncIo._reiniciarRitmo();
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  fijarDatos(COTS_PATH, [COT_1309]);
  resetSession();
  globalThis.fetch = originalFetch;
});

test('solo admin: vendedor 403, sin token 401', async () => {
  operam();
  const vendedor = await supertest(app).post(RUTA(132)).set('Authorization', VENDEDOR).send({ seco: true });
  assert.equal(vendedor.status, 403);
  const sinToken = await supertest(app).post(RUTA(132)).send({ seco: true });
  assert.equal(sinToken.status, 401);
});

test('una cotizacion inexistente responde 404 sin leer Operam', async () => {
  const lecturas = operam();
  const res = await supertest(app).post(RUTA(999)).set('Authorization', ADMIN).send({ seco: true });
  assert.equal(res.status, 404);
  assert.equal(lecturas.length, 0);
});

test('en seco sobre la 1309: nombra el pedido 7762, dice lo que haria y no cambia el registro', async () => {
  operam();
  const antes = cotizaciones();
  const res = await supertest(app).post(RUTA(132)).set('Authorization', ADMIN).send({ seco: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.seco, true);
  assert.equal(res.body.escrito, false);
  assert.equal(res.body.folio, '1309');
  assert.equal(res.body.pedido, '7762');
  assert.deepEqual(res.body.pedidos, ['7762']);
  assert.equal(res.body.cliente, '537');
  assert.equal(res.body.etapaAntes, 'seguimiento');
  assert.equal(res.body.etapaDespues, 'producto_entregado');
  assert.deepEqual(res.body.banderas, [{ campo: 'pagoSinRegistrar', antes: false, despues: true }]);
  assert.equal(res.body.motivo, undefined);
  assert.equal(res.body.espejo.pedido, '7762');
  assert.equal(res.body.espejoAntes, null);
  assert.deepEqual(cotizaciones(), antes);
});

test('sin seco escribe exactamente lo que el seco anuncio', async () => {
  operam();
  const seco = await supertest(app).post(RUTA(132)).set('Authorization', ADMIN).send({ seco: true });
  const res = await supertest(app).post(RUTA(132)).set('Authorization', ADMIN).send({});
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.escrito, true);
  for (const campo of ['pedido', 'pedidos', 'cliente', 'etapaAntes', 'etapaDespues', 'banderas']) {
    assert.deepEqual(res.body[campo], seco.body[campo], campo);
  }
  const cot = cotizaciones().find(c => c.id === 132);
  assert.equal(cot.etapa, 'producto_entregado');
  assert.equal(cot.data.pagoSinRegistrar, true);
  assert.equal(cot.data.espejoOperam.pedido, '7762');
  assert.deepEqual(cot.data.espejoOperam.remisiones, ['2400']);
  assert.equal(cot.eventos.at(-1).tipo, 'sync_operam');
});

test('sin pedido propio responde el motivo y no escribe', async () => {
  fijarDatos(COTS_PATH, [{ ...COT_1309, folioOperam: '1197' }]);
  operam();
  const antes = cotizaciones();
  const res = await supertest(app).post(RUTA(132)).set('Authorization', ADMIN).send({});
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.pedido, null);
  assert.equal(res.body.motivo, 'sin-pedido-propio');
  assert.equal(res.body.etapaDespues, 'seguimiento');
  assert.equal(res.body.escrito, false);
  assert.deepEqual(cotizaciones(), antes);
});

test('una salida (Perdida, Cancelada) no se mueve ni lee Operam', async () => {
  for (const etapa of ['perdida', 'cancelada']) {
    fijarDatos(COTS_PATH, [{ ...COT_1309, etapa }]);
    const lecturas = operam();
    const antes = cotizaciones();
    const res = await supertest(app).post(RUTA(132)).set('Authorization', ADMIN).send({});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.motivo, 'salida');
    assert.equal(res.body.etapaDespues, etapa);
    assert.equal(lecturas.length, 0);
    assert.deepEqual(cotizaciones(), antes);
  }
});

test('un error de Operam sale como error en la respuesta y no deja escrituras', async () => {
  operam({ fallaTransacciones: true });
  const antes = cotizaciones();
  const res = await supertest(app).post(RUTA(132)).set('Authorization', ADMIN).send({});
  assert.equal(res.status, 502, JSON.stringify(res.body));
  assert.match(res.body.error, /Operam/);
  assert.deepEqual(cotizaciones(), antes);
});

test('#512 en seco sobre la 1239: dice que su pedido 7616 esta anulado, destino Seguimiento y nada cambia', async () => {
  fijarDatos(COTS_PATH, [COT_1239]);
  operam({ pedidos: [PEDIDO_7616], anulados: ['7616'] });
  const antes = cotizaciones();
  const res = await supertest(app).post(RUTA(140)).set('Authorization', ADMIN).send({ seco: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.anulados, ['7616']);
  assert.equal(res.body.motivo, 'pedido-anulado');
  assert.equal(res.body.pedido, null);
  assert.equal(res.body.etapaAntes, 'seguimiento');
  assert.equal(res.body.etapaDespues, 'seguimiento');
  assert.equal(res.body.escrito, false);
  assert.deepEqual(cotizaciones(), antes);
});

test('#512 sin seco, la 1239 con su pedido anulado tampoco recibe escrituras', async () => {
  fijarDatos(COTS_PATH, [COT_1239]);
  operam({ pedidos: [PEDIDO_7616], anulados: ['7616'] });
  const antes = cotizaciones();
  const res = await supertest(app).post(RUTA(140)).set('Authorization', ADMIN).send({});
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.escrito, false);
  assert.equal(res.body.motivo, 'pedido-anulado');
  assert.deepEqual(cotizaciones(), antes);
});

test('#512 si la consulta de anulacion falla, la ruta responde error y no escribe', async () => {
  fijarDatos(COTS_PATH, [COT_1239]);
  operam({ pedidos: [PEDIDO_7616], webCaida: true });
  const antes = cotizaciones();
  const res = await supertest(app).post(RUTA(140)).set('Authorization', ADMIN).send({});
  assert.equal(res.status, 502, JSON.stringify(res.body));
  assert.match(res.body.error, /ECONNRESET/);
  assert.deepEqual(cotizaciones(), antes);
});

test('#512 un pedido con total no abre la web de Operam', async () => {
  const lecturas = operam();
  const res = await supertest(app).post(RUTA(132)).set('Authorization', ADMIN).send({ seco: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.anulados, []);
  assert.equal(lecturas.filter(u => u.includes('view_sales_order')).length, 0);
});

test('#512 en seco sobre la 1145 (Pedido liberado por el 7267 anulado): no retrocede y lo reporta', async () => {
  const cot1145 = { ...COT_1239, id: 141, folioOperam: '1145', fecha: '2026-06-15T00:00:00.000Z', etapa: 'pedido_liberado', data: { espejoOperam: { pedido: '7267' } } };
  fijarDatos(COTS_PATH, [cot1145]);
  operam({ pedidos: [{ order_no: '7267', trans_type: '30', debtor_no: '300', trans_no_from: '1145', total: '0', ord_date: '2026-06-20' }], anulados: ['7267'] });
  const antes = cotizaciones();
  const res = await supertest(app).post(RUTA(141)).set('Authorization', ADMIN).send({ seco: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.anulados, ['7267']);
  assert.equal(res.body.motivo, 'pedido-anulado');
  assert.equal(res.body.etapaAntes, 'pedido_liberado');
  assert.equal(res.body.etapaDespues, 'pedido_liberado');
  assert.deepEqual(cotizaciones(), antes);
});
