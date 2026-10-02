import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  reconciliarOportunidad, reconciliarPorIdentificador, planearReconciliacion, aplicarReconciliacion,
  _setRitmo, _reiniciarRitmo,
} from '../lib/sync-operam-io.js';
import { pedidosDeLaCotizacion } from '../lib/sync-operam.js';

// #508 (ADR-0021): la liga cotizacion-pedido es por DOCUMENTO. El pedido se busca
// en el listado de pedidos de Operam por su documento de origen (`trans_no_from`
// = folio), sin filtrar por el RFC ni por el Cliente Operam del registro, y la
// cadena (factura, remision) se lee con el cliente DEL PEDIDO. Los casos son los
// reales del comentario "Evaluacion verificada" de #506.

before(() => _setRitmo({ intervaloMs: 0 }));
after(() => _reiniciarRitmo());

function depsGrabando({ transacciones = [], pedidos = [] } = {}) {
  const deps = {
    movimientos: [],
    espejos: [],
    datos: [],
    consultasTx: [],
    consultasPed: [],
  };
  deps.listarTransacciones = async (q) => { deps.consultasTx.push(q); return transacciones; };
  deps.listarPedidos = async (q) => { deps.consultasPed.push(q); return pedidos; };
  deps.cambiarEtapa = async (id, etapa, evento) => { deps.movimientos.push({ id, etapa, evento }); return true; };
  deps.setEspejoOperam = async (id, espejo) => { deps.espejos.push({ id, espejo }); return true; };
  deps.actualizarDatos = async (id, campos) => { deps.datos.push({ id, campos }); return true; };
  return deps;
}

function sinEscrituras(deps) {
  assert.deepEqual(deps.movimientos, []);
  assert.deepEqual(deps.espejos, []);
  assert.deepEqual(deps.datos, []);
}

test('AC1: la 1237 sin RFC y con Cliente Operam queda ligada a su pedido 7626', async () => {
  const deps = depsGrabando({
    pedidos: [{ order_no: '7626', trans_type: '30', debtor_no: '504', trans_no_from: '1237', total: '41390.02', ord_date: '2026-09-03' }],
  });
  const op = { id: 40, etapa: 'seguimiento', folioOperam: '1237', fecha: '2026-08-28T18:00:00.000Z', data: { cliente: { customerId: '504' } } };
  const res = await reconciliarOportunidad(op, deps);
  assert.equal(res.movida, true);
  assert.equal(res.etapa, 'pedido_liberado');
  assert.equal(deps.espejos[0].espejo.pedido, '7626');
});

test('AC2: la 1186 (registro 485) se liga al pedido 7414 del cliente 290 y la cadena se lee con el 290', async () => {
  const deps = depsGrabando({
    transacciones: [
      { type: '10', order_: '7414', trans_no: '6900', reference: 'A2010', total_amount: '24790.36', allocated: '24790.36', outstanding: '0', debtor_no: '290' },
    ],
    pedidos: [{ order_no: '7414', trans_type: '30', debtor_no: '290', trans_no_from: '1186', total: '24790.36', ord_date: '2026-07-27' }],
  });
  const op = { id: 41, etapa: 'seguimiento', folioOperam: '1186', fecha: '2026-06-22T20:43:18.626Z', data: { cliente: { customerId: '485' } } };
  const res = await reconciliarOportunidad(op, deps);
  assert.equal(res.etapa, 'saldo_pagado');
  assert.ok(deps.consultasTx.length > 0);
  assert.ok(deps.consultasTx.every(q => q.customerId === '290' && q.rfc === undefined), 'la cadena se lee con el cliente del pedido');
  assert.ok(deps.consultasPed.every(q => q.debtorNo === undefined), 'el pedido no se busca por el cliente del registro');
});

test('AC3: un RFC mal capturado (1169) o distinto del de Operam (1294) no impide la liga', async () => {
  const deps1169 = depsGrabando({
    pedidos: [{ order_no: '7758', trans_type: '30', debtor_no: '611', trans_no_from: '1169', total: '9800', ord_date: '2026-09-04' }],
  });
  const r1169 = await reconciliarOportunidad({ id: 42, etapa: 'seguimiento', folioOperam: '1169', fecha: '2026-07-01T00:00:00.000Z', data: { cliente: { rfc: 'PCO150514AU8D' } } }, deps1169);
  assert.equal(r1169.etapa, 'pedido_liberado');
  assert.ok(deps1169.consultasTx.every(q => q.customerId === '611' && q.rfc === undefined));

  const deps1294 = depsGrabando({
    pedidos: [{ order_no: '7770', trans_type: '30', debtor_no: '640', trans_no_from: '1294', total: '5000', ord_date: '2026-09-29' }],
  });
  const r1294 = await reconciliarOportunidad({ id: 43, etapa: 'seguimiento', folioOperam: '1294', fecha: '2026-09-26T00:00:00.000Z', data: { cliente: { rfc: 'AAA010101AAA', customerId: '9' } } }, deps1294);
  assert.equal(r1294.etapa, 'pedido_liberado');
});

test('AC4: un cliente con pedido y sin ninguna transaccion lleva la cotizacion a Pedido liberado', async () => {
  const deps = depsGrabando({
    transacciones: [],
    pedidos: [{ order_no: '7762', trans_type: '30', debtor_no: '537', trans_no_from: '1309', total: '3675.46', ord_date: '2026-09-30' }],
  });
  const op = { id: 44, etapa: 'seguimiento', folioOperam: '1309', fecha: '2026-09-30T17:20:28.903Z', data: { cliente: { customerId: '537' } } };
  const res = await reconciliarOportunidad(op, deps);
  assert.equal(res.etapa, 'pedido_liberado');
});

test('AC5: el pedido explicito del registro conserva la prioridad sobre el documento del folio', async () => {
  const deps = depsGrabando({
    transacciones: [
      { type: '10', order_: '7269', total_amount: '16954', allocated: '16954', outstanding: '0', debtor_no: '394' },
      { type: '10', order_: '7300', total_amount: '500', allocated: '100', outstanding: '400', debtor_no: '394' },
    ],
    pedidos: [
      { order_no: '7269', trans_type: '30', debtor_no: '394', trans_no_from: '1141', total: '16954' },
      { order_no: '7300', trans_type: '30', debtor_no: '394', trans_no_from: '1150', total: '500' },
    ],
  });
  const op = { id: 57, etapa: 'seguimiento', folioOperam: '1141', fecha: '2026-06-01T00:00:00.000Z', data: { orderOperam: '7300' } };
  const plan = await planearReconciliacion(op, deps);
  assert.equal(plan.pedido, '7300');
  assert.deepEqual(plan.pedidos, ['7300']);
  assert.equal(plan.etapaDespues, 'pedido_liberado');
});

test('AC6: una venta directa nunca se liga, aunque sea del mismo Cliente Operam', async () => {
  const deps = depsGrabando({
    transacciones: [{ type: '13', order_: '9001', debtor_no: '537' }],
    pedidos: [
      { order_no: '9001', trans_type: '30', debtor_no: '537', trans_no_from: '', total: '300' },
      { order_no: '9002', trans_type: '30', debtor_no: '537', trans_no_from: null, total: '300' },
    ],
  });
  const op = { id: 45, etapa: 'seguimiento', folioOperam: '1309', fecha: '2026-09-30T17:20:28.903Z', data: { cliente: { customerId: '537' } } };
  const res = await reconciliarOportunidad(op, deps);
  assert.equal(res.motivo, 'sin-pedido-propio');
  sinEscrituras(deps);
});

test('AC7: la 861 no queda ligada al pedido 7321 de total cero habiendo el 7282 con total', async () => {
  // El registro trae el explicito 7321 (lo puso el backfill) y el folio tiene otro pedido.
  const deps = depsGrabando({
    transacciones: [
      { type: '10', order_: '7282', trans_no: '6100', reference: 'A1700', total_amount: '251.77', allocated: '251.77', outstanding: '0', debtor_no: '158' },
      { type: '13', order_: '7321', trans_no: '7400', reference: '2300', debtor_no: '158' },
    ],
    pedidos: [
      { order_no: '7321', trans_type: '30', debtor_no: '158', trans_no_from: '861', total: '0', ord_date: '2026-06-29' },
      { order_no: '7282', trans_type: '30', debtor_no: '158', trans_no_from: '861', total: '251.77', ord_date: '2026-06-24' },
    ],
  });
  const op = { id: 46, etapa: 'seguimiento', folioOperam: '861', fecha: '2025-06-18T00:00:00.000Z', data: { orderOperam: '7321' } };
  const plan = await planearReconciliacion(op, deps);
  assert.equal(plan.pedido, '7282');
  assert.deepEqual([...plan.pedidos].sort(), ['7282', '7321']);
  // Los hechos de los dos pedidos: la factura liquidada del 7282 y la remision del 7321.
  assert.equal(plan.etapaDespues, 'producto_entregado');
  assert.equal(plan.espejo.pedido, '7282');
});

test('AC7: la 836 con 5706 y 5707 considera las facturas de los dos pedidos', async () => {
  const deps = depsGrabando({
    transacciones: [
      { type: '10', order_: '5706', trans_no: '1', reference: 'A1', total_amount: '7952.66', allocated: '7952.66', outstanding: '0', debtor_no: '180' },
      { type: '10', order_: '5707', trans_no: '2', reference: 'A2', total_amount: '35912.96', allocated: '0', outstanding: '35912.96', debtor_no: '180' },
    ],
    pedidos: [
      { order_no: '5706', trans_type: '30', debtor_no: '180', trans_no_from: '836', total: '7952.66', ord_date: '2025-05-12' },
      { order_no: '5707', trans_type: '30', debtor_no: '180', trans_no_from: '836', total: '35912.96', ord_date: '2025-05-12' },
    ],
  });
  const op = { id: 47, etapa: 'seguimiento', folioOperam: '836', fecha: '2025-05-10T00:00:00.000Z', data: {} };
  const plan = await planearReconciliacion(op, deps);
  assert.deepEqual([...plan.pedidos].sort(), ['5706', '5707']);
  // Pagado uno de dos: es pago parcial del folio, no "saldo pagado" por la primera factura.
  assert.equal(plan.etapaDespues, 'pedido_liberado');
  assert.equal(plan.espejo.pago, 'anticipo');
});

test('pedidosDeLaCotizacion: explicito ancla, documento por folio, venta directa fuera', () => {
  const pedidos = [
    { order_no: '7269', debtor_no: '394', trans_no_from: '1141', total: '100' },
    { order_no: '7300', debtor_no: '394', trans_no_from: '1150', total: '50' },
    { order_no: '9001', debtor_no: '394', trans_no_from: '', total: '10' },
  ];
  assert.equal(pedidosDeLaCotizacion(pedidos, { folio: '1141' }).principal.order_no, '7269');
  const explicito = pedidosDeLaCotizacion(pedidos, { folio: '1141', explicito: '7300' });
  assert.equal(explicito.principal.order_no, '7300');
  assert.deepEqual(explicito.pedidos.map(p => p.order_no), ['7300']);
  // Un explicito que el listado no trae no es liga.
  assert.equal(pedidosDeLaCotizacion(pedidos, { folio: '1141', explicito: '9999' }), null);
  // Un explicito que nacio de OTRA cotizacion no arrastra los pedidos de aquella
  // (la 1114 apuntando al 6282, que nacio de la 965).
  const otraCotizacion = [
    { order_no: '6282', debtor_no: '77', trans_no_from: '965', total: '11233.90' },
    { order_no: '6290', debtor_no: '77', trans_no_from: '965', total: '900' },
  ];
  assert.deepEqual(pedidosDeLaCotizacion(otraCotizacion, { folio: '1114', explicito: '6282' }).pedidos.map(p => p.order_no), ['6282']);
  // El folio de una cotizacion que nunca fue pedido no se liga a la venta directa.
  assert.equal(pedidosDeLaCotizacion(pedidos, { folio: '1309' }), null);
  assert.equal(pedidosDeLaCotizacion(pedidos, {}), null);
});

test('el pedido se busca en una ventana que arranca 60 dias antes de la cotizacion, sin filtrar cliente', async () => {
  const deps = depsGrabando({
    pedidos: [{ order_no: '7762', trans_type: '30', debtor_no: '537', trans_no_from: '1309', total: '3675.46' }],
  });
  const op = { id: 48, etapa: 'seguimiento', folioOperam: '1309', fecha: '2026-09-30T17:20:28.903Z', data: { cliente: { customerId: '537', rfc: 'XAXX010101000' } } };
  await planearReconciliacion(op, deps);
  assert.equal(deps.consultasPed[0].desde, '2026-08-01');
  assert.equal(deps.consultasPed[0].debtorNo, undefined);
});

test('un lote comparte la lectura de pedidos (una barrida para varias cotizaciones)', async () => {
  const deps = depsGrabando({
    pedidos: [
      { order_no: '7762', trans_type: '30', debtor_no: '537', trans_no_from: '1309', total: '1' },
      { order_no: '7760', trans_type: '30', debtor_no: '520', trans_no_from: '1282', total: '1' },
    ],
  });
  const oportunidades = [
    { id: 49, etapa: 'seguimiento', folioOperam: '1309', fecha: '2026-09-30T00:00:00.000Z', data: { cliente: { rfc: 'XAXX010101000' } } },
    { id: 50, etapa: 'seguimiento', folioOperam: '1282', fecha: '2026-09-30T00:00:00.000Z', data: { cliente: { rfc: 'XAXX010101000' } } },
  ];
  const res = await reconciliarPorIdentificador({ rfc: 'XAXX010101000' }, oportunidades, deps);
  assert.deepEqual(res.map(r => r.etapa), ['pedido_liberado', 'pedido_liberado']);
  assert.equal(deps.consultasPed.length, 1);
});

test('en un lote, una cotizacion con ventana anterior solo lee el tramo que falta', async () => {
  const deps = depsGrabando({
    pedidos: [
      { order_no: '7762', trans_type: '30', debtor_no: '537', trans_no_from: '1309', total: '1' },
      { order_no: '7414', trans_type: '30', debtor_no: '290', trans_no_from: '1186', total: '1' },
    ],
  });
  const oportunidades = [
    { id: 58, etapa: 'seguimiento', folioOperam: '1309', fecha: '2026-09-30T00:00:00.000Z', data: { cliente: { rfc: 'XAXX010101000' } } },
    { id: 59, etapa: 'seguimiento', folioOperam: '1186', fecha: '2026-06-22T00:00:00.000Z', data: { cliente: { rfc: 'XAXX010101000' } } },
  ];
  const res = await reconciliarPorIdentificador({ rfc: 'XAXX010101000' }, oportunidades, deps);
  assert.deepEqual(res.map(r => r.etapa), ['pedido_liberado', 'pedido_liberado']);
  assert.equal(deps.consultasPed.length, 2);
  assert.equal(deps.consultasPed[0].desde, '2026-08-01');
  assert.deepEqual([deps.consultasPed[1].desde, deps.consultasPed[1].hasta], ['2026-04-23', '2026-08-01']);
});

test('AC8: planearReconciliacion no escribe nada y dice exactamente lo que haria', async () => {
  const deps = depsGrabando({
    transacciones: [
      { type: '10', order_: '7762', trans_no: '6990', reference: 'A2100', total_amount: '3675.46', allocated: '0', outstanding: '3675.46', debtor_no: '537' },
      { type: '13', order_: '7762', trans_no: '7700', reference: '2400', debtor_no: '537' },
    ],
    pedidos: [{ order_no: '7762', trans_type: '30', debtor_no: '537', trans_no_from: '1309', total: '3675.46' }],
  });
  const op = { id: 51, etapa: 'seguimiento', folioOperam: '1309', fecha: '2026-09-30T17:20:28.903Z', data: { cliente: { customerId: '537' } } };
  const plan = await planearReconciliacion(op, deps);
  sinEscrituras(deps);
  assert.equal(plan.pedido, '7762');
  assert.equal(plan.cliente, '537');
  assert.equal(plan.etapaAntes, 'seguimiento');
  assert.equal(plan.etapaDespues, 'producto_entregado');
  assert.deepEqual(plan.banderas, [{ campo: 'pagoSinRegistrar', antes: false, despues: true }]);
  assert.equal(plan.motivo, undefined);

  // Aplicar ese mismo plan escribe exactamente eso.
  await aplicarReconciliacion(op, plan, deps);
  assert.deepEqual(deps.movimientos.map(m => m.etapa), ['producto_entregado']);
  assert.equal(deps.espejos[0].espejo.pedido, '7762');
  assert.equal(deps.datos[0].campos.pagoSinRegistrar, true);
});

test('AC9: con pedido y la etapa al dia el plan dice "sin cambios" y la etapa no se mueve', async () => {
  const deps = depsGrabando({
    pedidos: [{ order_no: '7762', trans_type: '30', debtor_no: '537', trans_no_from: '1309', total: '1' }],
  });
  const op = { id: 52, etapa: 'pedido_liberado', folioOperam: '1309', fecha: '2026-09-30T00:00:00.000Z', data: {} };
  const plan = await planearReconciliacion(op, deps);
  assert.equal(plan.etapaAntes, 'pedido_liberado');
  assert.equal(plan.etapaDespues, 'pedido_liberado');
  assert.equal(plan.motivo, 'sin-cambios');
  assert.deepEqual(plan.banderas, []);
});

test('AC10: una salida (Perdida, Cancelada) no se mueve ni se lee Operam', async () => {
  for (const etapa of ['perdida', 'cancelada']) {
    const deps = depsGrabando({
      transacciones: [{ type: '13', order_: '7762', debtor_no: '537' }],
      pedidos: [{ order_no: '7762', trans_type: '30', debtor_no: '537', trans_no_from: '1309', total: '1' }],
    });
    const op = { id: 53, etapa, folioOperam: '1309', fecha: '2026-09-30T00:00:00.000Z', data: {} };
    const res = await reconciliarOportunidad(op, deps);
    assert.equal(res.movida, false);
    assert.equal(res.motivo, 'salida');
    assert.equal(deps.consultasPed.length + deps.consultasTx.length, 0);
    sinEscrituras(deps);
  }
});

test('AC9: un error de Operam al leer la cadena no deja escrituras', async () => {
  const deps = depsGrabando({
    pedidos: [{ order_no: '7762', trans_type: '30', debtor_no: '537', trans_no_from: '1309', total: '1' }],
  });
  deps.listarTransacciones = async () => { throw new Error('Operam 500: caido'); };
  const op = { id: 54, etapa: 'seguimiento', folioOperam: '1309', fecha: '2026-09-30T00:00:00.000Z', data: {} };
  await assert.rejects(() => reconciliarOportunidad(op, deps), /Operam 500/);
  sinEscrituras(deps);
});

test('AC11: las lecturas van a su propio ritmo (una cada 1100 ms), tambien entre reconciliaciones simultaneas', async () => {
  let reloj = 0;
  const esperas = [];
  _reiniciarRitmo();
  _setRitmo({ intervaloMs: 1100, ahora: () => reloj, esperar: async (ms) => { esperas.push(ms); reloj += ms; } });
  try {
    const deps = depsGrabando({
      pedidos: [{ order_no: '7762', trans_type: '30', debtor_no: '537', trans_no_from: '1309', total: '1' }],
    });
    const op = { id: 55, etapa: 'seguimiento', folioOperam: '1309', fecha: '2026-09-30T00:00:00.000Z', data: {} };
    // El webhook y el admin a la vez tampoco se enciman.
    await Promise.all([planearReconciliacion(op, deps), planearReconciliacion({ ...op, id: 56 }, deps)]);
    assert.equal(deps.consultasPed.length + deps.consultasTx.length, 4);
    assert.deepEqual(esperas, [1100, 1100, 1100]);
  } finally {
    _reiniciarRitmo();
    _setRitmo({ intervaloMs: 0 });
  }
});
