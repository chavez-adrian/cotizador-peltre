import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hechosDeOperam, reconciliarOportunidad, reconciliarPorIdentificador, esActivaPostVentaCandidata } from '../lib/sync-operam-io.js';

// Motor de reconciliacion del sync post-venta (issue #62, AC2). Lee Operam
// (read-only), normaliza a hechos con el mapeo real (peltre-operam.md 12) y mueve
// la tarjeta via el nucleo puro. Tests con dependencias inyectadas (mock de las
// lecturas de Operam y del store) -- NO se llama a Operam real.

function depsMock({ transacciones = [], pedidos = [], onCambiarEtapa } = {}) {
  const movimientos = [];
  return {
    movimientos,
    listarTransacciones: async () => transacciones,
    listarPedidos: async () => pedidos,
    cambiarEtapa: async (id, etapa, evento) => {
      movimientos.push({ id, etapa, evento });
      if (onCambiarEtapa) onCambiarEtapa(id, etapa, evento);
      return true;
    },
  };
}

// --- hechosDeOperam: lee y normaliza ---

test('hechosDeOperam: factura (10) liquidada + remision (13) + pedido (30) -> producto_entregado', async () => {
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7077', total_amount: '16954', allocated: '16954', outstanding: '0', debtor_no: '345' },
      { type: '13', order_: '7077', total_amount: '16954', allocated: '0', outstanding: '0', debtor_no: '345' },
    ],
    pedidos: [{ order_no: '7077', trans_type: '30', debtor_no: '345', total: '16954' }],
  });
  const op = { id: 1, etapa: 'seguimiento', data: { cliente: { rfc: 'CPE921211N76' } } };
  const hechos = await hechosDeOperam(op, deps);
  assert.equal(hechos.pago.allocated, 16954);
  assert.equal(hechos.pago.outstanding, 0);
  assert.equal(hechos.tieneRemision, true);
  assert.equal(hechos.tienePedido, true);
});

test('hechosDeOperam: tienePedido viene de listar_pedidos (Sales Order 30), no de las transacciones', async () => {
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7400', total_amount: '1000', allocated: '500', outstanding: '500', debtor_no: '345' },
    ],
    pedidos: [{ order_no: '7400', trans_type: '30', debtor_no: '345' }],
  });
  const op = { id: 1, etapa: 'seguimiento', data: { cliente: { rfc: 'ABC010101AAA' } } };
  const hechos = await hechosDeOperam(op, deps);
  assert.equal(hechos.tienePedido, true);
});

test('hechosDeOperam: sin RFC en la oportunidad devuelve null (no se puede ligar)', async () => {
  const deps = depsMock({});
  const op = { id: 1, etapa: 'seguimiento', data: { cliente: {} } };
  assert.equal(await hechosDeOperam(op, deps), null);
});

test('hechosDeOperam: con order_ resuelto (folioOperam) filtra la cadena a ese order_', async () => {
  // Dos cadenas del mismo cliente: order_ 7077 (entregada) y order_ 7230 (solo
  // factura con saldo). El folio liga a 7077 -> debe ver solo esa cadena.
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7077', total_amount: '16954', allocated: '16954', outstanding: '0', debtor_no: '345' },
      { type: '13', order_: '7077', total_amount: '16954', allocated: '0', outstanding: '0', debtor_no: '345' },
      { type: '10', order_: '7230', total_amount: '6153', allocated: '3000', outstanding: '3153', debtor_no: '345' },
    ],
    pedidos: [
      { order_no: '7077', trans_type: '30', debtor_no: '345' },
      { order_no: '7230', trans_type: '30', debtor_no: '345' },
    ],
  });
  const op = { id: 1, etapa: 'seguimiento', folioOperam: '7077', data: { cliente: { rfc: 'CPE921211N76' } } };
  const hechos = await hechosDeOperam(op, deps);
  // Solo la cadena 7077: liquidada (no el saldo de 7230).
  assert.equal(hechos.pago.allocated, 16954);
  assert.equal(hechos.pago.outstanding, 0);
  assert.equal(hechos.tieneRemision, true);
});

test('hechosDeOperam: order_ explicito en data.orderOperam tiene prioridad sobre el folio', async () => {
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7230', total_amount: '6153', allocated: '3000', outstanding: '3153', debtor_no: '345' },
    ],
    pedidos: [{ order_no: '7230', trans_type: '30', debtor_no: '345' }],
  });
  const op = { id: 1, etapa: 'seguimiento', folioOperam: '999', data: { cliente: { rfc: 'CPE921211N76' }, orderOperam: '7230' } };
  const hechos = await hechosDeOperam(op, deps);
  assert.equal(hechos.pago.outstanding, 3153);
});

// --- reconciliarOportunidad: mueve la tarjeta ---

test('reconciliarOportunidad: mueve a producto_entregado cuando hay factura liquidada + remision', async () => {
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7077', total_amount: '16954', allocated: '16954', outstanding: '0', debtor_no: '345' },
      { type: '13', order_: '7077', total_amount: '16954', allocated: '0', outstanding: '0', debtor_no: '345' },
    ],
    pedidos: [{ order_no: '7077', trans_type: '30', debtor_no: '345' }],
  });
  const op = { id: 7, etapa: 'seguimiento', data: { cliente: { rfc: 'CPE921211N76' } } };
  const res = await reconciliarOportunidad(op, deps);
  assert.equal(res.movida, true);
  assert.equal(res.etapa, 'producto_entregado');
  assert.equal(deps.movimientos.length, 1);
  assert.equal(deps.movimientos[0].id, 7);
  assert.equal(deps.movimientos[0].etapa, 'producto_entregado');
  assert.equal(deps.movimientos[0].evento.tipo, 'sync_operam');
});

test('reconciliarOportunidad: anticipo parcial mueve a anticipo_pagado', async () => {
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7400', total_amount: '2000', allocated: '500', outstanding: '1500', debtor_no: '345' },
    ],
    pedidos: [],
  });
  const op = { id: 8, etapa: 'seguimiento', data: { cliente: { rfc: 'ABC010101AAA' } } };
  const res = await reconciliarOportunidad(op, deps);
  assert.equal(res.etapa, 'anticipo_pagado');
});

test('reconciliarOportunidad: sin hecho post-venta no mueve la tarjeta', async () => {
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7400', total_amount: '2000', allocated: '0', outstanding: '2000', debtor_no: '345' },
    ],
    pedidos: [],
  });
  const op = { id: 9, etapa: 'seguimiento', data: { cliente: { rfc: 'ABC010101AAA' } } };
  const res = await reconciliarOportunidad(op, deps);
  assert.equal(res.movida, false);
  assert.equal(res.etapa, null);
  assert.equal(deps.movimientos.length, 0);
});

test('reconciliarOportunidad: idempotente -- si la etapa ya es la calculada, no mueve', async () => {
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7400', total_amount: '2000', allocated: '500', outstanding: '1500', debtor_no: '345' },
    ],
    pedidos: [],
  });
  const op = { id: 10, etapa: 'anticipo_pagado', data: { cliente: { rfc: 'ABC010101AAA' } } };
  const res = await reconciliarOportunidad(op, deps);
  assert.equal(res.movida, false);
  assert.equal(deps.movimientos.length, 0);
});

test('reconciliarOportunidad: respeta el gate de decorados (#61) -- no libera con checklist incompleto', async () => {
  // Operam dice pedido + anticipo parcial; pero la oportunidad es decorada con
  // checklist vacio: el gate la topa en anticipo_pagado (no pedido_liberado).
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7400', total_amount: '2000', allocated: '500', outstanding: '1500', debtor_no: '345' },
    ],
    pedidos: [{ order_no: '7400', trans_type: '30', debtor_no: '345' }],
  });
  const op = { id: 11, etapa: 'seguimiento', decorado: true, data: { cliente: { rfc: 'ABC010101AAA' }, calcaChecklist: [] } };
  const res = await reconciliarOportunidad(op, deps);
  assert.equal(res.etapa, 'anticipo_pagado');
});

test('reconciliarOportunidad: sin RFC no mueve ni truena', async () => {
  const deps = depsMock({});
  const op = { id: 12, etapa: 'seguimiento', data: { cliente: {} } };
  const res = await reconciliarOportunidad(op, deps);
  assert.equal(res.movida, false);
  assert.equal(deps.movimientos.length, 0);
});

// --- esActivaPostVentaCandidata ---

test('esActivaPostVentaCandidata: activas no terminadas si, terminadas y salidas no', () => {
  assert.equal(esActivaPostVentaCandidata({ etapa: 'seguimiento' }), true);
  assert.equal(esActivaPostVentaCandidata({ etapa: 'anticipo_pagado' }), true);
  assert.equal(esActivaPostVentaCandidata({ etapa: 'producto_entregado' }), false);
  assert.equal(esActivaPostVentaCandidata({ etapa: 'perdida' }), false);
  assert.equal(esActivaPostVentaCandidata({ etapa: 'no_util' }), false);
});

// --- reconciliarPorIdentificador (webhook -> oportunidades) ---

test('reconciliarPorIdentificador: reconcilia la oportunidad del RFC del webhook', async () => {
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7077', total_amount: '16954', allocated: '16954', outstanding: '0', debtor_no: '345' },
      { type: '13', order_: '7077', total_amount: '16954', allocated: '0', outstanding: '0', debtor_no: '345' },
    ],
    pedidos: [{ order_no: '7077', trans_type: '30', debtor_no: '345' }],
  });
  const oportunidades = [
    { id: 1, etapa: 'seguimiento', data: { cliente: { rfc: 'CPE921211N76' } } },
    { id: 2, etapa: 'seguimiento', data: { cliente: { rfc: 'OTRO010101AAA' } } }, // no matchea
  ];
  const res = await reconciliarPorIdentificador({ rfc: 'CPE921211N76', order: '7077' }, oportunidades, deps);
  assert.equal(res.length, 1);
  assert.equal(res[0].id, 1);
  assert.equal(res[0].etapa, 'producto_entregado');
  assert.equal(deps.movimientos.length, 1);
});

test('reconciliarPorIdentificador: prioriza la oportunidad con order_ exacto cuando varias comparten RFC', async () => {
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7230', total_amount: '6153', allocated: '6153', outstanding: '0', debtor_no: '345' },
    ],
    pedidos: [{ order_no: '7230', trans_type: '30', debtor_no: '345' }],
  });
  const oportunidades = [
    { id: 1, etapa: 'seguimiento', folioOperam: '7077', data: { cliente: { rfc: 'CPE921211N76' } } },
    { id: 2, etapa: 'seguimiento', folioOperam: '7230', data: { cliente: { rfc: 'CPE921211N76' } } },
  ];
  const res = await reconciliarPorIdentificador({ rfc: 'CPE921211N76', order: '7230' }, oportunidades, deps);
  assert.equal(res.length, 1);
  assert.equal(res[0].id, 2);
});

test('reconciliarPorIdentificador: sin candidata (RFC desconocido) devuelve vacio, no truena', async () => {
  const deps = depsMock({});
  const oportunidades = [{ id: 1, etapa: 'seguimiento', data: { cliente: { rfc: 'AAA010101AAA' } } }];
  const res = await reconciliarPorIdentificador({ rfc: 'ZZZ999999ZZZ' }, oportunidades, deps);
  assert.deepEqual(res, []);
  assert.equal(deps.movimientos.length, 0);
});

test('reconciliarPorIdentificador: ignora oportunidades terminadas/salidas', async () => {
  const deps = depsMock({
    transacciones: [{ type: '10', order_: '1', total_amount: '100', allocated: '100', outstanding: '0', debtor_no: '9' }],
    pedidos: [{ order_no: '1', trans_type: '30', debtor_no: '9' }],
  });
  const oportunidades = [
    { id: 1, etapa: 'producto_entregado', data: { cliente: { rfc: 'AAA010101AAA' } } },
    { id: 2, etapa: 'perdida', data: { cliente: { rfc: 'AAA010101AAA' } } },
  ];
  const res = await reconciliarPorIdentificador({ rfc: 'AAA010101AAA' }, oportunidades, deps);
  assert.deepEqual(res, []);
});
