// #509: el barrido del sync post-venta a pedido de un admin. La regla (una barrida de
// pedidos, liga por documento, cadena solo con pedido) se prueba en
// test/sync-operam-barrido.test.js; aqui la costura HTTP: permisos, el seco que
// responde el plan sin escribir, el aplicado en segundo plano con su resultado
// consultable, el 409 con otro en curso y la ruta global retirada.
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
// El barrido escribe via el store de cotizaciones: con pool real le pegaria a Neon.
delete process.env.DATABASE_URL;

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const syncIo = await import('../lib/sync-operam-io.js');
const { enTurno, TURNO_SYNC_OPERAM } = await import('../lib/turno-barridos.js');
const { resetSession } = await import('../lib/operam-client.js');
const { app } = await import('../server.js');

const ADMIN = `Bearer ${jwt.sign({ id: 1, name: 'Jefa Test', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' })}`;
const VENDEDOR = `Bearer ${jwt.sign({ id: 7, name: 'Memo', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' })}`;
const RUTA = '/api/admin/sync-operam/barrido';

const originalFetch = globalThis.fetch;
function jsonResponse(data, status = 200) {
  return { ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) };
}
function htmlResponse(html) {
  return { ok: true, status: 200, headers: new Headers(), text: async () => html, json: async () => ({}) };
}

// La 1309 sin RFC (la ruta global vieja la saltaba) con su pedido 7762 entregado y
// liquidado; la 1197 sin pedido propio aunque su cliente tenga otra venta entregada
// (#507); la 1239 con su unico pedido anulado (#512).
const COT_1309 = { id: 132, fecha: '2026-09-30T17:20:28.903Z', vendedor: 'Memo', cliente: 'CLIENTE 1309',
  etapa: 'seguimiento', folioOperam: '1309', data: { cliente: { customerId: '537' } } };
const COT_1197 = { id: 101, fecha: '2026-07-20T18:00:00.000Z', vendedor: 'Memo', cliente: 'EL PENDULO',
  etapa: 'seguimiento', folioOperam: '1197', data: { cliente: { rfc: 'CPE921211N76' } } };
const COT_1239 = { id: 73, fecha: '2026-08-28T18:00:00.000Z', vendedor: 'Memo', cliente: 'CLIENTE 1239',
  etapa: 'seguimiento', folioOperam: '1239', data: { cliente: { customerId: '499', rfc: 'XAXX010101000' } } };

const PEDIDOS = [
  { order_no: '7762', trans_type: '30', debtor_no: '537', trans_no_from: '1309', total: '3675.46', ord_date: '2026-09-30' },
  { order_no: '7616', trans_type: '30', debtor_no: '256', trans_no_from: '1239', total: '0', ord_date: '2026-08-31' },
  { order_no: '7100', trans_type: '30', debtor_no: '345', trans_no_from: '1050', total: '5000', ord_date: '2026-06-02' },
];
const TRANSACCIONES = {
  537: [
    { type: '10', order_: '7762', trans_no: '6990', reference: 'A2100', total_amount: '3675.46', allocated: '3675.46', outstanding: '0', debtor_no: '537' },
    { type: '13', order_: '7762', trans_no: '7700', reference: '2400', debtor_no: '537' },
  ],
  345: [
    { type: '10', order_: '7100', total_amount: '5000', allocated: '5000', outstanding: '0', debtor_no: '345' },
    { type: '13', order_: '7100', debtor_no: '345' },
  ],
};

function operam({ webCaida = false } = {}) {
  const lecturas = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    lecturas.push(u);
    if (u.includes('/sales/view/view_sales_order.php')) {
      if (webCaida) throw new Error('web legacy caida');
      const n = new URL(u).searchParams.get('trans_no');
      return htmlResponse(n === '5960' || n === '7616' ? '<div>Este pedido ha sido cancelado</div>' : '<table><tr><td>Pedido</td></tr></table>');
    }
    if (u.includes('/api/v3/login')) return jsonResponse({ token: 'tok', result: true });
    if (u.includes('/api/v3/sales/sales_orders')) return jsonResponse({ data: PEDIDOS });
    if (u.includes('/api/v3/sales/transactions')) {
      const cliente = new URL(u).searchParams.get('customer_id');
      return jsonResponse({ data: TRANSACCIONES[cliente] || [] });
    }
    throw new Error('Unmocked fetch: ' + u);
  };
  return lecturas;
}

const cotizaciones = () => JSON.parse(leerArchivoSync(COTS_PATH));
const porId = (id) => cotizaciones().find(c => c.id === id);

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
  fijarDatos(COTS_PATH, [COT_1309, COT_1197, COT_1239]);
  resetSession();
  globalThis.fetch = originalFetch;
});

test('solo admin: vendedor 403 y sin token 401, en el POST y en el GET', async () => {
  operam();
  assert.equal((await supertest(app).post(RUTA).set('Authorization', VENDEDOR).send({ seco: true })).status, 403);
  assert.equal((await supertest(app).post(RUTA).send({ seco: true })).status, 401);
  assert.equal((await supertest(app).get(RUTA).set('Authorization', VENDEDOR)).status, 403);
  assert.equal((await supertest(app).get(RUTA)).status, 401);
  assert.deepEqual(cotizaciones(), [COT_1309, COT_1197, COT_1239]);
});

test('AC10: la reconciliacion global POST /api/sync-operam ya no existe', async () => {
  operam();
  const res = await supertest(app).post('/api/sync-operam').set('Authorization', ADMIN);
  assert.equal(res.status, 404);
  assert.deepEqual(cotizaciones(), [COT_1309, COT_1197, COT_1239]);
});

test('AC6: en seco responde el plan completo y no escribe nada', async () => {
  operam();
  const antes = cotizaciones();
  const res = await supertest(app).post(RUTA).set('Authorization', ADMIN).send({ seco: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.seco, true);
  assert.deepEqual(cotizaciones(), antes);
  const f1309 = res.body.plan.find(f => f.folio === '1309');
  assert.equal(f1309.id, 132);
  assert.equal(f1309.pedido, '7762');
  assert.equal(f1309.etapaDespues, 'producto_entregado');
  const f1239 = res.body.plan.find(f => f.folio === '1239');
  assert.deepEqual(f1239.anulados, ['7616']);
  assert.equal(f1239.motivo, 'pedido-anulado');
  assert.equal(res.body.plan.find(f => f.folio === '1197'), undefined);
  assert.equal(res.body.revisadas, 3);
  assert.equal(res.body.ligadas, 1);
  assert.equal(res.body.sinPedido, 1);
  assert.equal(res.body.movidas, 1);
});

test('AC7/AC9: aplicado responde 202 al instante y el GET da el resultado; la etapa lleva su evento sync_operam', async () => {
  operam();
  const res = await supertest(app).post(RUTA).set('Authorization', ADMIN).send({});
  assert.equal(res.status, 202);
  assert.equal(res.body.enCurso, true);
  await syncIo._esperarBarridoSync();

  const consulta = await supertest(app).get(RUTA).set('Authorization', ADMIN);
  assert.equal(consulta.status, 200);
  assert.equal(consulta.body.enCurso, false);
  const ultima = consulta.body.ultima;
  assert.equal(ultima.seco, false);
  assert.ok(ultima.inicio && ultima.fin);
  assert.equal(ultima.revisadas, 3);
  assert.equal(ultima.ligadas, 1);
  assert.equal(ultima.movidas, 1);
  assert.deepEqual(ultima.errores, []);

  const movida = porId(132);
  assert.equal(movida.etapa, 'producto_entregado');
  assert.equal(movida.data.espejoOperam.pedido, '7762');
  const evento = movida.eventos.at(-1);
  assert.equal(evento.tipo, 'sync_operam');
  assert.equal(evento.etapa, 'producto_entregado');
  assert.ok(!Number.isNaN(Date.parse(evento.fecha)));
  // #507: la venta de otra cotizacion del cliente no mueve ni marca a la 1197.
  assert.deepEqual(porId(101), COT_1197);
  // #512: el pedido anulado no liga.
  assert.deepEqual(porId(73), COT_1239);
});

test('un seco despues de un aplicado no borra la ultima corrida aplicada', async () => {
  operam();
  await supertest(app).post(RUTA).set('Authorization', ADMIN).send({});
  await syncIo._esperarBarridoSync();
  fijarDatos(COTS_PATH, [COT_1309, COT_1197, COT_1239]);
  const seco = await supertest(app).post(RUTA).set('Authorization', ADMIN).send({ seco: true });
  assert.equal(seco.status, 200);
  const { ultima, ultimaAplicada } = (await supertest(app).get(RUTA).set('Authorization', ADMIN)).body;
  assert.equal(ultima.seco, true);
  assert.equal(ultimaAplicada.seco, false);
  assert.equal(ultimaAplicada.movidas, 1);
});

test('en seco, si no se pueden leer los pedidos de Operam responde 502 con el error, no un exito', async () => {
  operam();
  const base = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/v3/sales/sales_orders')) return jsonResponse({ message: 'Too Many Requests' }, 400);
    return base(url);
  };
  const antes = cotizaciones();
  const res = await supertest(app).post(RUTA).set('Authorization', ADMIN).send({ seco: true });
  assert.equal(res.status, 502);
  assert.match(res.body.error, /pedidos|Operam/);
  assert.equal(res.body.revisadas, 0);
  assert.deepEqual(cotizaciones(), antes);
});

test('AC5: la cotizacion cuya consulta de anulacion fallo queda en errores y las demas siguen', async () => {
  operam({ webCaida: true });
  await supertest(app).post(RUTA).set('Authorization', ADMIN).send({});
  await syncIo._esperarBarridoSync();
  const { ultima } = (await supertest(app).get(RUTA).set('Authorization', ADMIN)).body;
  assert.equal(ultima.errores.length, 1);
  assert.equal(ultima.errores[0].id, 73);
  assert.match(ultima.errores[0].error, /web legacy caida/);
  assert.equal(ultima.revisadas, 2);
  assert.equal(porId(132).etapa, 'producto_entregado');
  assert.deepEqual(porId(73), COT_1239);
});

test('AC3: con un barrido del sync en curso, otro responde 409 sin leer Operam', async () => {
  const lecturas = operam();
  let soltar;
  const enCurso = enTurno(TURNO_SYNC_OPERAM, () => new Promise(res => { soltar = res; }));
  try {
    const aplicado = await supertest(app).post(RUTA).set('Authorization', ADMIN).send({});
    assert.equal(aplicado.status, 409);
    const seco = await supertest(app).post(RUTA).set('Authorization', ADMIN).send({ seco: true });
    assert.equal(seco.status, 409);
    assert.equal((await supertest(app).get(RUTA).set('Authorization', ADMIN)).body.enCurso, true);
    assert.deepEqual(lecturas, []);
  } finally {
    soltar();
    await enCurso;
  }
});
