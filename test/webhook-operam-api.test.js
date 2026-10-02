// #510: la ruta de los avisos de Operam. Aqui la costura HTTP con las formas
// reales del log de produccion (test/helpers/avisos-operam.js): cada aviso con su
// clave, el repetido que no se atiende pero deja rastro, el que fallo y se vuelve a
// atender, y la respuesta inmediata con la atencion despues. La seleccion de
// cotizaciones por aviso va en test/sync-operam-avisos.test.js. Sin DATABASE_URL
// el log vive en data/operam-webhooks-log.json.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync } from '../lib/fs-reintento.js';
import { fotoDatos, fijarDatos } from './helpers/datos-aislados.js';
import { avisoPedido, avisoPago, avisoRemision } from './helpers/avisos-operam.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COTS_PATH = join(__dirname, '..', 'data', 'cotizaciones.json');
const LOG_PATH = join(__dirname, '..', 'data', 'operam-webhooks-log.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}
// La atencion escribe via el store de cotizaciones y el log: con pool real le
// pegaria a Neon.
delete process.env.DATABASE_URL;

const syncIo = await import('../lib/sync-operam-io.js');
const { resetSession } = await import('../lib/operam-client.js');
const { app } = await import('../server.js');

const RUTA = '/api/webhooks/operam';
const SECRETO = 'secreto-510';

const originalFetch = globalThis.fetch;
function jsonResponse(data, status = 200) {
  return { ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) };
}

// La 1309 y la 1282 de #506: registros sin RFC util, con su pedido en Operam.
const COT_1309 = { id: 132, fecha: '2026-09-30T17:20:28.903Z', vendedor: 'Memo', cliente: 'CLIENTE 1309',
  etapa: 'seguimiento', folioOperam: '1309', data: { cliente: { customerId: '537' } } };
const COT_1282 = { id: 90, fecha: '2026-09-17T00:00:00.000Z', vendedor: 'Memo', cliente: 'CLIENTE 1282',
  etapa: 'seguimiento', folioOperam: '1282', data: { cliente: { rfc: 'XAXX010101000' } } };
const PEDIDOS = [
  { order_no: '7762', trans_type: '30', debtor_no: '537', trans_no_from: '1309', total: '3675.46', ord_date: '2026-09-30' },
  { order_no: '7760', trans_type: '30', debtor_no: '520', trans_no_from: '1282', total: '1200', ord_date: '2026-09-18' },
];

// Operam: `caido` tumba el listado de pedidos; `pausa` lo detiene hasta liberarlo.
function operam({ caido = false, pausa = null } = {}) {
  const lecturas = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/api/v3/login')) return jsonResponse({ token: 'tok', result: true });
    if (u.includes('/api/v3/sales/sales_orders')) {
      lecturas.push(u);
      if (pausa) await pausa;
      if (caido) throw new Error('Operam caido');
      return jsonResponse({ data: PEDIDOS });
    }
    if (u.includes('/api/v3/sales/transactions')) {
      lecturas.push(u);
      return jsonResponse({ data: [] });
    }
    throw new Error('Unmocked fetch: ' + u);
  };
  return lecturas;
}

const enviar = (payload) => supertest(app).post(RUTA).set('X-Operam-Webhook-Secret', SECRETO).send(payload);
const leer = (path) => JSON.parse(leerArchivoSync(path));
const porId = (id) => leer(COTS_PATH).find(c => c.id === id);
const fila = (clave) => leer(LOG_PATH).find(f => f.event_key === clave);

let restaurarDatos;
let secretoPrevio;
before(() => {
  restaurarDatos = fotoDatos([COTS_PATH, LOG_PATH]);
  syncIo._setRitmo({ intervaloMs: 0 });
  secretoPrevio = process.env.OPERAM_WEBHOOK_SECRET;
  process.env.OPERAM_WEBHOOK_SECRET = SECRETO;
});
after(() => {
  restaurarDatos();
  syncIo._reiniciarRitmo();
  globalThis.fetch = originalFetch;
  if (secretoPrevio === undefined) delete process.env.OPERAM_WEBHOOK_SECRET;
  else process.env.OPERAM_WEBHOOK_SECRET = secretoPrevio;
});

beforeEach(() => {
  fijarDatos(COTS_PATH, [COT_1309, COT_1282]);
  fijarDatos(LOG_PATH, []);
  resetSession();
  globalThis.fetch = originalFetch;
});

test('AC1/AC2: dos avisos de Pedido distintos se atienden los dos y cada cotizacion queda en Pedido liberado', async () => {
  operam();
  const a = await enviar(avisoPedido({ reference: '2609812', transNoFrom: '1309', customerId: '537' }));
  const b = await enviar(avisoPedido({ reference: '2609700', transNoFrom: '1282', customerId: '520' }));
  assert.equal(a.status, 200);
  assert.equal(a.body.encolado, true);
  assert.equal(b.body.encolado, true);
  await syncIo._esperarAvisos();

  assert.equal(porId(132).etapa, 'pedido_liberado');
  assert.equal(porId(90).etapa, 'pedido_liberado');
  assert.equal(fila('Order:ADD:2609812').resultado, 'reconciliadas:1');
  assert.equal(fila('Order:ADD:2609700').resultado, 'reconciliadas:1');
  assert.ok(fila('Order:ADD:2609812').procesado_en);
});

test('AC1/AC7: el mismo aviso reenviado no se vuelve a atender, pero deja rastro', async () => {
  const lecturas = operam();
  await enviar(avisoPedido({ reference: '2609812', transNoFrom: '1309' }));
  await syncIo._esperarAvisos();
  const leidas = lecturas.length;

  const otra = await enviar(avisoPedido({ reference: '2609812', transNoFrom: '1309' }));
  await syncIo._esperarAvisos();
  assert.equal(otra.status, 200);
  assert.equal(otra.body.duplicado, true);
  assert.equal(lecturas.length, leidas, 'el repetido no lee Operam');
  const f = fila('Order:ADD:2609812');
  assert.equal(f.repeticiones, 1);
  assert.ok(f.ultima_repeticion);
  assert.equal(f.resultado, 'reconciliadas:1');
});

test('AC1: dos avisos de Remision distintos se atienden los dos; el mismo reenviado no', async () => {
  operam();
  assert.equal((await enviar(avisoRemision(2400))).body.encolado, true);
  assert.equal((await enviar(avisoRemision(2401))).body.encolado, true);
  assert.equal((await enviar(avisoRemision(2400))).body.duplicado, true);
  await syncIo._esperarAvisos();
  assert.equal(fila('CustDelivery:ADD:2400').resultado, 'reconciliadas:0');
  assert.equal(fila('CustDelivery:ADD:2401').resultado, 'reconciliadas:0');
  assert.equal(fila('CustDelivery:ADD:2400').repeticiones, 1);
});

test('AC6: con Operam caido la fila guarda el error y el reenvio se vuelve a atender', async () => {
  operam({ caido: true });
  await enviar(avisoPago({ transNo: '7695', debtorNo: '537' }));
  await syncIo._esperarAvisos();
  const fallida = fila('Payment:ADD:7695');
  assert.match(fallida.resultado, /^error: /);
  assert.equal(fallida.procesado_en, null);
  assert.equal(porId(132).etapa, 'seguimiento');

  operam();
  const otra = await enviar(avisoPago({ transNo: '7695', debtorNo: '537' }));
  assert.equal(otra.body.encolado, true);
  assert.equal(otra.body.reintento, true);
  await syncIo._esperarAvisos();
  assert.equal(fila('Payment:ADD:7695').resultado, 'reconciliadas:1');
  assert.ok(fila('Payment:ADD:7695').procesado_en);
  assert.equal(porId(132).etapa, 'pedido_liberado');
});

test('AC8: la ruta responde a Operam de inmediato y la reconciliacion sigue despues', async () => {
  let soltar;
  const pausa = new Promise(r => { soltar = r; });
  const lecturas = operam({ pausa });
  const res = await enviar(avisoPedido({ reference: '2609812', transNoFrom: '1309' }));
  assert.equal(res.status, 200);
  assert.equal(res.body.encolado, true);
  assert.equal(fila('Order:ADD:2609812').resultado, null, 'respondio antes de terminar');
  assert.equal(porId(132).etapa, 'seguimiento');

  soltar();
  await syncIo._esperarAvisos();
  assert.ok(lecturas.length > 0);
  assert.equal(porId(132).etapa, 'pedido_liberado');
});

test('#507/AC4: el aviso de Pago no toca una cotizacion sin pedido propio aunque su cliente tenga otra venta', async () => {
  const cot1197 = { id: 101, fecha: '2026-07-20T18:00:00.000Z', vendedor: 'Memo', cliente: 'EL PENDULO',
    etapa: 'seguimiento', folioOperam: '1197', data: { cliente: { customerId: '345', rfc: 'CPE921211N76' } } };
  fijarDatos(COTS_PATH, [cot1197]);
  const antes = leer(COTS_PATH);
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/api/v3/login')) return jsonResponse({ token: 'tok', result: true });
    if (u.includes('/api/v3/sales/sales_orders')) {
      return jsonResponse({ data: [{ order_no: '7100', trans_type: '30', debtor_no: '345', trans_no_from: '1050', total: '5000', ord_date: '2026-06-02' }] });
    }
    if (u.includes('/api/v3/sales/transactions')) return jsonResponse({ data: [{ type: '13', order_: '7100', debtor_no: '345' }] });
    throw new Error('Unmocked fetch: ' + u);
  };
  await enviar(avisoPago({ transNo: '6735', debtorNo: '345', taxId: 'CPE921211N76' }));
  await syncIo._esperarAvisos();
  assert.deepEqual(leer(COTS_PATH), antes);
  assert.equal(fila('Payment:ADD:6735').resultado, 'reconciliadas:0');
});

test('el reenvio de un aviso que quedo en cola (un deploy a media fila) se vuelve a atender', async () => {
  operam();
  fijarDatos(LOG_PATH, [{ id: 1, created_at: '2026-10-02T10:00:00.000Z', event_key: 'Order:ADD:2609812', modelo: 'Order',
    identificador: '1309', payload: null, procesado_en: null, resultado: null, repeticiones: 0, ultima_repeticion: null }]);
  const res = await enviar(avisoPedido({ reference: '2609812', transNoFrom: '1309' }));
  assert.equal(res.body.encolado, true);
  await syncIo._esperarAvisos();
  assert.equal(fila('Order:ADD:2609812').resultado, 'reconciliadas:1');
  assert.equal(fila('Order:ADD:2609812').repeticiones, 1);
  assert.equal(porId(132).etapa, 'pedido_liberado');
});
