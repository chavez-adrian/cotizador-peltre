import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { reconciliarAviso, encolarAviso, _esperarAvisos, _setRitmo, _reiniciarRitmo } from '../lib/sync-operam-io.js';
import { interpretarAviso } from '../lib/sync-operam-webhook.js';
import { avisoPedido, avisoPago, avisoRemision } from './helpers/avisos-operam.js';

// #510: que cotizaciones reconcilia cada aviso de Operam, con las formas reales
// del log de produccion. Nada se elige por RFC: el Pedido por su documento de
// origen, el Pago por su Cliente Operam y la Remision, las que ya tienen pedido.
// La ruta HTTP (respuesta inmediata, repetidos, log) va en
// test/webhook-operam-api.test.js.

before(() => _setRitmo({ intervaloMs: 0 }));
after(() => _reiniciarRitmo());

// Los casos reales de #506: la 1309 (Cliente Operam 537, pedido 7762) y la 1282
// (Cliente Operam 520, pedido 7760), las dos con el RFC generico de mostrador; la
// 1300 nunca se volvio pedido.
const PEDIDOS = [
  { order_no: '7762', trans_type: '30', debtor_no: '537', trans_no_from: '1309', total: '3675.46', ord_date: '2026-09-30' },
  { order_no: '7760', trans_type: '30', debtor_no: '520', trans_no_from: '1282', total: '1200', ord_date: '2026-09-18' },
];
const COT_1309 = { id: 132, etapa: 'seguimiento', folioOperam: '1309', fecha: '2026-09-30T17:20:28.903Z', data: { cliente: { customerId: '537' } } };
const COT_1282 = { id: 90, etapa: 'seguimiento', folioOperam: '1282', fecha: '2026-09-17T00:00:00.000Z', data: { cliente: { rfc: 'XAXX010101000' } } };
const COT_1300 = { id: 120, etapa: 'seguimiento', folioOperam: '1300', fecha: '2026-09-26T00:00:00.000Z', data: { cliente: { rfc: 'XAXX010101000' } } };

function depsGrabando({ pedidos = PEDIDOS, transacciones = [], filtraCliente = true } = {}) {
  const deps = { movimientos: [], espejos: [], datos: [], consultasPed: [], consultasTx: [] };
  deps.listarPedidos = async (q) => {
    deps.consultasPed.push(q);
    return filtraCliente && q.debtorNo != null ? pedidos.filter(p => p.debtor_no === String(q.debtorNo)) : pedidos;
  };
  deps.listarTransacciones = async (q) => { deps.consultasTx.push(q); return transacciones; };
  deps.obtenerPedido = async () => ({ detalles: [{ quantity: '1', qty_sent: '1' }] });
  deps.abrirSesionWeb = async () => { throw new Error('no deberia consultar la web: todos los pedidos tienen total'); };
  deps.cambiarEtapa = async (id, etapa, evento) => { deps.movimientos.push({ id, etapa, evento }); return true; };
  deps.setEspejoOperam = async (id, espejo) => { deps.espejos.push({ id, espejo }); return true; };
  deps.actualizarDatos = async (id, campos) => { deps.datos.push({ id, campos }); return true; };
  return deps;
}

const escritas = (deps) => [...new Set([...deps.movimientos, ...deps.espejos, ...deps.datos].map(e => e.id))].sort();

test('AC2: el aviso de Pedido reconcilia la cotizacion de su documento y la deja en Pedido liberado, sin RFC', async () => {
  const deps = depsGrabando();
  const aviso = interpretarAviso(avisoPedido({ reference: '2609812', transNoFrom: '1309', customerId: '537' }));
  const res = await reconciliarAviso(aviso, [COT_1309, COT_1282, COT_1300], deps);
  assert.deepEqual(res, [{ id: 132, movida: true, etapa: 'pedido_liberado' }]);
  assert.deepEqual(escritas(deps), [132]);
});

test('AC3: un aviso de Pedido de venta directa no reconcilia ninguna cotizacion (ni lee Operam)', async () => {
  const deps = depsGrabando();
  const res = await reconciliarAviso(interpretarAviso(avisoPedido({ transNoFrom: '' })), [COT_1309, COT_1282], deps);
  assert.deepEqual(res, []);
  assert.deepEqual(deps.consultasPed, []);
  assert.deepEqual(escritas(deps), []);
});

test('AC4/AC5: el aviso de Pago reconcilia solo las cotizaciones con pedido de SU cliente, no las del mismo RFC generico', async () => {
  const deps = depsGrabando();
  const aviso = interpretarAviso(avisoPago({ transNo: '7695', debtorNo: '537', taxId: 'XAXX010101000' }));
  const res = await reconciliarAviso(aviso, [COT_1309, COT_1282, COT_1300], deps);
  assert.deepEqual(res.map(r => r.id), [132]);
  assert.deepEqual(escritas(deps), [132]);
  assert.equal(deps.consultasPed[0].debtorNo, '537');
});

test('AC5: si Operam ignorara el filtro de cliente, el aviso de Pago elige igual por el cliente del pedido', async () => {
  const deps = depsGrabando({ filtraCliente: false });
  const aviso = interpretarAviso(avisoPago({ debtorNo: '520' }));
  const res = await reconciliarAviso(aviso, [COT_1309, COT_1282, COT_1300], deps);
  assert.deepEqual(res.map(r => r.id), [90]);
  assert.deepEqual(escritas(deps), [90]);
});

test('un aviso de Pago sin cliente no reconcilia nada (no cae al RFC)', async () => {
  const deps = depsGrabando();
  const aviso = interpretarAviso(avisoPago({ debtorNo: '0', taxId: 'XAXX010101000' }));
  assert.deepEqual(await reconciliarAviso(aviso, [COT_1309, COT_1282], deps), []);
  assert.deepEqual(deps.consultasPed, []);
});

test('AC4: el aviso de Remision reconcilia las cotizaciones activas que ya tienen pedido y no toca las demas', async () => {
  const deps = depsGrabando({
    transacciones: [{ type: '13', order_: '7762', trans_no: '7700', reference: '2400', debtor_no: '537' }],
  });
  const ligada = { ...COT_1309, etapa: 'pedido_liberado', data: { ...COT_1309.data, espejoOperam: { cotizacion: '1309', pedido: '7762', remisiones: [] } } };
  const explicita = { ...COT_1282, etapa: 'pedido_liberado', data: { ...COT_1282.data, orderOperam: '7760' } };
  const res = await reconciliarAviso(interpretarAviso(avisoRemision(2400)), [ligada, explicita, COT_1300], deps);
  assert.deepEqual(res.map(r => r.id).sort(), [132, 90].sort());
  assert.equal(res.find(r => r.id === 132).etapa, 'producto_entregado');
  assert.ok(!escritas(deps).includes(120), 'la 1300, sin pedido, no se toca');
});

test('ningun aviso toca una cotizacion que ya salio del embudo', async () => {
  const deps = depsGrabando();
  const perdida = { ...COT_1309, etapa: 'perdida' };
  assert.deepEqual(await reconciliarAviso(interpretarAviso(avisoPedido({ transNoFrom: '1309' })), [perdida], deps), []);
  assert.deepEqual(escritas(deps), []);
});

test('AC6: si no se pueden leer los pedidos, el aviso queda en error (no como procesado con cero)', async () => {
  const deps = depsGrabando();
  deps.listarPedidos = async () => { throw new Error('Operam 429'); };
  const marcas = [];
  deps.listarCotizaciones = async () => [COT_1309];
  deps.marcarAviso = async (clave, r) => { marcas.push({ clave, ...r }); };
  const aviso = interpretarAviso(avisoPago({ transNo: '7695', debtorNo: '537' }));
  const r = await encolarAviso(aviso, deps);
  assert.equal(r.ok, false);
  assert.deepEqual(marcas, [{ clave: 'Payment:ADD:7695', ok: false, resultado: 'error: Operam 429' }]);
});

test('AC6: si una cotizacion del aviso falla, el aviso queda en error aunque otra se haya reconciliado', async () => {
  const deps = depsGrabando();
  deps.listarTransacciones = async () => { throw new Error('Operam caido'); };
  const marcas = [];
  deps.listarCotizaciones = async () => [COT_1309];
  deps.marcarAviso = async (clave, r) => { marcas.push(r); };
  await encolarAviso(interpretarAviso(avisoPedido({ transNoFrom: '1309' })), deps);
  assert.equal(marcas[0].ok, false);
  assert.match(marcas[0].resultado, /^error: 132: Operam caido/);
});

test('AC8: los avisos se atienden en fila, uno detras de otro', async () => {
  const eventos = [];
  const deps = depsGrabando();
  const lento = deps.listarPedidos;
  deps.listarPedidos = async (q) => {
    eventos.push('lee');
    await new Promise(r => setTimeout(r, 20));
    return lento(q);
  };
  deps.listarCotizaciones = async () => [COT_1309, COT_1282];
  deps.marcarAviso = async (clave) => { eventos.push(`marca ${clave}`); };
  encolarAviso(interpretarAviso(avisoPedido({ reference: '2609812', transNoFrom: '1309' })), deps);
  encolarAviso(interpretarAviso(avisoPedido({ reference: '2609700', transNoFrom: '1282' })), deps);
  await _esperarAvisos();
  assert.deepEqual(eventos, ['lee', 'marca Order:ADD:2609812', 'lee', 'marca Order:ADD:2609700']);
  assert.deepEqual(deps.movimientos.map(m => m.id), [132, 90]);
});
