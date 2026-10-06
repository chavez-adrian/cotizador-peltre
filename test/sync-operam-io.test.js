import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { hechosDeOperam, reconciliarOportunidad, reconciliarAviso, esActivaPostVentaCandidata, construirEspejoOperam, _setRitmo, _reiniciarRitmo } from '../lib/sync-operam-io.js';
import { pedidosDeLaCotizacion } from '../lib/sync-operam.js';

// Motor de reconciliacion del sync post-venta (issue #62, AC2). Lee Operam
// (read-only), normaliza a hechos con el mapeo real (peltre-operam.md 12) y mueve
// la tarjeta via el nucleo puro. Tests con dependencias inyectadas (mock de las
// lecturas de Operam y del store) -- NO se llama a Operam real.

before(() => _setRitmo({ intervaloMs: 0 }));
after(() => _reiniciarRitmo());

function depsMock({ transacciones = [], pedidos = [], onCambiarEtapa } = {}) {
  const movimientos = [];
  const espejos = [];
  const datos = [];
  return {
    movimientos,
    espejos,
    datos,
    listarTransacciones: async () => transacciones,
    listarPedidos: async () => pedidos,
    // #534: con remision se lee el detalle del pedido; aqui, entregado completo.
    obtenerPedido: async () => ({ detalles: [{ quantity: '1', qty_sent: '1' }] }),
    cambiarEtapa: async (id, etapa, evento) => {
      movimientos.push({ id, etapa, evento });
      if (onCambiarEtapa) onCambiarEtapa(id, etapa, evento);
      return true;
    },
    setEspejoOperam: async (id, espejo) => {
      espejos.push({ id, espejo });
      return true;
    },
    actualizarDatos: async (id, campos) => {
      datos.push({ id, campos });
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
  const op = { id: 1, etapa: 'seguimiento', data: { cliente: { rfc: 'CPE921211N76' }, orderOperam: '7077' } };
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
    pedidos: [{ order_no: '7400', trans_type: '30', debtor_no: '345', total: '100' }],
  });
  const op = { id: 1, etapa: 'seguimiento', data: { cliente: { rfc: 'ABC010101AAA' }, orderOperam: '7400' } };
  const hechos = await hechosDeOperam(op, deps);
  assert.equal(hechos.tienePedido, true);
});

test('hechosDeOperam: un explicito que el listado de pedidos no trae devuelve null (no hay liga)', async () => {
  const deps = depsMock({});
  const op = { id: 1, etapa: 'seguimiento', data: { cliente: {}, orderOperam: '7077' } };
  assert.equal(await hechosDeOperam(op, deps), null);
});

// Binding por customer_id (#76): el RFC generico (XAXX010101000) lo comparten muchos
// clientes y la consulta por customer_rfc contamina los hechos con tx de otros debtors
// (folios 669/1152 -> saldo_pagado falso). Cuando la oportunidad trae customerId, se
// liga por customer_id (aislado) y NO se manda el customer_rfc generico.
test('hechosDeOperam: con customerId liga por customer_id, no por el RFC generico', async () => {
  let q = null;
  const deps = {
    listarTransacciones: async (query) => { q = query; return [{ type: '10', order_: '7251', total_amount: '1935', allocated: '1935', debtor_no: '461' }]; },
    listarPedidos: async () => [{ order_no: '7251', trans_type: '30', debtor_no: '461', total: '100' }],
  };
  const op = { id: 1, etapa: 'seguimiento', data: { cliente: { rfc: 'XAXX010101000', customerId: '461' }, orderOperam: '7251' } };
  const hechos = await hechosDeOperam(op, deps);
  assert.equal(q.customerId, '461');
  assert.equal(q.rfc, undefined, 'no manda el customer_rfc generico cuando hay customer_id');
  assert.equal(hechos.tienePedido, true);
});

test('hechosDeOperam: la cadena se lee con el cliente del PEDIDO, no con el RFC del registro (#508)', async () => {
  let q = null;
  const deps = {
    listarTransacciones: async (query) => { q = query; return []; },
    listarPedidos: async () => [{ order_no: '7077', trans_type: '30', debtor_no: '345', total: '100' }],
  };
  const op = { id: 1, etapa: 'seguimiento', data: { cliente: { rfc: 'CPE921211N76' }, orderOperam: '7077' } };
  await hechosDeOperam(op, deps);
  assert.equal(q.customerId, '345');
  assert.equal(q.rfc, undefined);
});

test('hechosDeOperam: con data.orderOperam filtra la cadena a ese order_', async () => {
  // Dos cadenas del mismo cliente: order_ 7077 (entregada) y order_ 7230 (solo
  // factura con saldo). data.orderOperam liga a 7077 -> debe ver solo esa cadena.
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7077', total_amount: '16954', allocated: '16954', outstanding: '0', debtor_no: '345' },
      { type: '13', order_: '7077', total_amount: '16954', allocated: '0', outstanding: '0', debtor_no: '345' },
      { type: '10', order_: '7230', total_amount: '6153', allocated: '3000', outstanding: '3153', debtor_no: '345' },
    ],
    pedidos: [
      { order_no: '7077', trans_type: '30', debtor_no: '345', total: '100' },
      { order_no: '7230', trans_type: '30', debtor_no: '345', total: '100' },
    ],
  });
  const op = { id: 1, etapa: 'seguimiento', data: { cliente: { rfc: 'CPE921211N76' }, orderOperam: '7077' } };
  const hechos = await hechosDeOperam(op, deps);
  // Solo la cadena 7077: liquidada (no el saldo de 7230).
  assert.equal(hechos.pago.allocated, 16954);
  assert.equal(hechos.pago.outstanding, 0);
  assert.equal(hechos.tieneRemision, true);
});

test('hechosDeOperam: el folio de cotizacion NO se usa como order_ (cotizacion != pedido)', async () => {
  // El cliente tiene dos cadenas: order_ 7077 (entregada, liquidada) y order_ 8888
  // (otra, con saldo). La oportunidad tiene folioOperam '8888' -- su numero de
  // COTIZACION -- que coincide numericamente con el order_ de la OTRA cadena. Como
  // el numero de cotizacion nunca es el de pedido, el folio NO debe filtrar a 8888.
  // Ningun pedido nacio del folio 8888, asi que la oportunidad no tiene pedido
  // propio y no hay hechos (#507: ya no se agrega por cliente).
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7077', total_amount: '16954', allocated: '16954', outstanding: '0', debtor_no: '345' },
      { type: '13', order_: '7077', total_amount: '16954', allocated: '0', outstanding: '0', debtor_no: '345' },
      { type: '10', order_: '8888', total_amount: '500', allocated: '100', outstanding: '400', debtor_no: '345' },
    ],
    pedidos: [
      { order_no: '7077', trans_type: '30', debtor_no: '345', total: '100' },
      { order_no: '8888', trans_type: '30', debtor_no: '345', total: '100' },
    ],
  });
  const op = { id: 1, etapa: 'seguimiento', folioOperam: '8888', data: { cliente: { rfc: 'CPE921211N76' } } };
  assert.equal(await hechosDeOperam(op, deps), null);
});

// Paginacion (#76): un cliente con >100 transacciones (el generico, 728 reales) tiene
// la cadena del pedido objetivo fuera de la primera pagina. Leer solo la pagina 1
// pierde la cadena, el binding por order_ falla y los hechos se contaminan con el
// agregado de OTROS pedidos del mismo cliente (medido en vivo: 7 pedidos del generico
// 184 mostrados como activos cuando estaban cerrados). El motor debe paginar la cuenta
// completa (corte natural en pagina < 100, asi un cliente normal sigue costando 1 sola
// lectura). Tambien afecta al sync #62 en produccion, no solo al backfill.
test('hechosDeOperam: pagina la cuenta del cliente para hallar la cadena fuera de la pagina 1 (>100 tx)', async () => {
  const ORDER = '5864';
  // Pagina 1: 100 facturas RUIDO de otros pedidos (saldadas, sin remision).
  const ruido = Array.from({ length: 100 }, (_, i) => ({
    type: '10', order_: String(900000 + i), total_amount: '1000', allocated: '1000', outstanding: '0', debtor_no: '184',
  }));
  // Pagina 2: la cadena REAL del order objetivo (factura liquidada + remision).
  const cadena = [
    { type: '10', order_: ORDER, total_amount: '7800', allocated: '7800', outstanding: '0', debtor_no: '184' },
    { type: '13', order_: ORDER, total_amount: '7800', allocated: '0', outstanding: '0', debtor_no: '184' },
  ];
  const todasTx = [...ruido, ...cadena];
  const todosPed = [
    ...Array.from({ length: 100 }, (_, i) => ({ order_no: String(900000 + i), trans_type: '30', debtor_no: '184', total: '100' })),
    { order_no: ORDER, trans_type: '30', debtor_no: '184', total: '100' },
  ];
  const paginado = (arr) => async ({ skip = 0, limit = 100 } = {}) => arr.slice(skip, skip + limit);
  const deps = { listarTransacciones: paginado(todasTx), listarPedidos: paginado(todosPed) };
  const op = { id: 1, etapa: 'seguimiento', data: { cliente: { rfc: 'XAXX010101000', customerId: '184' }, orderOperam: ORDER } };
  const hechos = await hechosDeOperam(op, deps);
  // Debe ver SOLO la cadena del order 5864 (no el ruido): liquidada + entregada.
  assert.equal(hechos.pago.allocated, 7800);
  assert.equal(hechos.pago.outstanding, 0);
  assert.equal(hechos.tieneRemision, true);
  assert.equal(hechos.tienePedido, true);
});

// --- AC2 (#67): binding por documento de origen (trans_no_from === folioOperam) ---

test('AC2: resuelve el order_ por trans_no_from === folioOperam (filtra a esa cadena, varios pedidos del cliente)', async () => {
  // El cliente tiene dos cadenas vivas: pedido 7269 (nacio de la cotizacion 1141,
  // entregado y liquidado) y pedido 7300 (otra cotizacion, solo con saldo). La
  // oportunidad guarda folioOperam '1141' (numero de COTIZACION, #63). El pedido
  // cuyo trans_no_from == '1141' es 7269 -> la cadena se filtra a order_ 7269.
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7269', total_amount: '16954', allocated: '16954', outstanding: '0', debtor_no: '394' },
      { type: '13', order_: '7269', total_amount: '16954', allocated: '0', outstanding: '0', debtor_no: '394' },
      { type: '10', order_: '7300', total_amount: '500', allocated: '100', outstanding: '400', debtor_no: '394' },
    ],
    pedidos: [
      { order_no: '7269', trans_type: '30', debtor_no: '394', trans_no_from: '1141', total: '100' },
      { order_no: '7300', trans_type: '30', debtor_no: '394', trans_no_from: '1150', total: '100' },
    ],
  });
  const op = { id: 1, etapa: 'seguimiento', folioOperam: '1141', data: { cliente: { rfc: 'CPE921211N76' } } };
  const hechos = await hechosDeOperam(op, deps);
  // Solo la cadena 7269: liquidada + remision (no el saldo de 7300).
  assert.equal(hechos.pago.allocated, 16954);
  assert.equal(hechos.pago.outstanding, 0);
  assert.equal(hechos.tieneRemision, true);
  assert.equal(hechos.tienePedido, true);
});

test('AC2: folioOperam numerico (no-string) tambien resuelve contra trans_no_from string', async () => {
  // folioOperam se guarda como String, pero normalizamos ambos lados por si llega numero.
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7269', total_amount: '1000', allocated: '1000', outstanding: '0', debtor_no: '394' },
      { type: '10', order_: '7300', total_amount: '500', allocated: '0', outstanding: '500', debtor_no: '394' },
    ],
    pedidos: [
      { order_no: '7269', trans_type: '30', debtor_no: '394', trans_no_from: '1141', total: '100' },
      { order_no: '7300', trans_type: '30', debtor_no: '394', trans_no_from: '1150', total: '100' },
    ],
  });
  const op = { id: 1, etapa: 'seguimiento', folioOperam: 1141, data: { cliente: { rfc: 'CPE921211N76' } } };
  const hechos = await hechosDeOperam(op, deps);
  assert.equal(hechos.pago.allocated, 1000);
  assert.equal(hechos.pago.outstanding, 0);
});

test('AC2: data.orderOperam explicito tiene prioridad sobre trans_no_from', async () => {
  // orderOperam '7300' liga explicitamente; aunque folioOperam '1141' resolveria a
  // 7269, la liga explicita manda (prioridad 1).
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7269', total_amount: '16954', allocated: '16954', outstanding: '0', debtor_no: '394' },
      { type: '10', order_: '7300', total_amount: '500', allocated: '100', outstanding: '400', debtor_no: '394' },
    ],
    pedidos: [
      { order_no: '7269', trans_type: '30', debtor_no: '394', trans_no_from: '1141', total: '100' },
      { order_no: '7300', trans_type: '30', debtor_no: '394', trans_no_from: '1150', total: '100' },
    ],
  });
  const op = { id: 1, etapa: 'seguimiento', folioOperam: '1141', data: { cliente: { rfc: 'CPE921211N76' }, orderOperam: '7300' } };
  const hechos = await hechosDeOperam(op, deps);
  // Filtra a 7300 (la liga explicita), no a 7269.
  assert.equal(hechos.pago.allocated, 100);
  assert.equal(hechos.pago.outstanding, 400);
});

test('AC2: venta directa (trans_no_from vacio) NO se liga a una oportunidad con folioOperam', async () => {
  // El cliente tiene UNA cadena: pedido 9001 que NO nacio de cotizacion (venta
  // directa, trans_no_from vacio). La oportunidad tiene folioOperam '1141' (su
  // cotizacion, que NUNCA se convirtio en pedido). No hay match por documento ->
  // NO debe ligarse por error a la venta directa.
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '9001', total_amount: '300', allocated: '0', outstanding: '300', debtor_no: '500' },
    ],
    pedidos: [
      { order_no: '9001', trans_type: '30', debtor_no: '500', trans_no_from: '', total: '100' },
    ],
  });
  // La resolucion precisa por documento NO encuentra match (trans_no_from vacio).
  assert.equal(pedidosDeLaCotizacion(await deps.listarPedidos(), { folio: '1141' }), null);
  const op = { id: 1, etapa: 'seguimiento', folioOperam: '1141', data: { cliente: { rfc: 'VDX010101AAA' } } };
  assert.equal(await hechosDeOperam(op, deps), null);
});

// --- AC3 (#67): espejo de la cadena (construir + persistir) ---

test('AC3: construirEspejoOperam arma la cadena de folios desde trans + pedidos filtrados', () => {
  // transFiltradas ya viene filtrada al order_ 7269: factura (10) y remision (13)
  // traen ese order_. Los pagos (12) y notas de credito (11) NO entran: en el
  // listado de Operam traen order_=0 (no atribuibles a un pedido), por eso el filtro
  // por order_ los deja fuera. El folio visible de cada eslabon es `reference`
  // (A1907, 2142...), no `ref` (que no existe en la API). El estado de pago se deriva
  // del allocated de la factura (decision Adrian #67), no de folios de pago.
  const trans = [
    { type: '10', order_: '7269', trans_no: '6735', reference: 'A1907', total_amount: '16954', allocated: '16954', outstanding: '0' },
    { type: '13', order_: '7269', trans_no: '7329', reference: '2142' },
  ];
  const pedidos = [{ order_no: '7269', trans_type: '30', trans_no_from: '1141', total: '100' }];
  const espejo = construirEspejoOperam(trans, pedidos, '1141');
  assert.equal(espejo.cotizacion, '1141');
  assert.equal(espejo.pedido, '7269');
  assert.deepEqual(espejo.factura, { numero: '6735', ref: 'A1907' });
  assert.deepEqual(espejo.remisiones, ['2142']);
  assert.equal(espejo.pago, 'pagado'); // 16954/16954 liquidado
  // pagos/notasCredito NO son folios del espejo (no atribuibles por order_).
  assert.equal('pagos' in espejo, false);
  assert.equal('notasCredito' in espejo, false);
});

test('AC3: construirEspejoOperam deriva pago "anticipo" con pago parcial de la factura', () => {
  const trans = [
    { type: '10', order_: '7269', trans_no: '6735', reference: 'A1907', total_amount: '1000', allocated: '300', outstanding: '700' },
  ];
  const pedidos = [{ order_no: '7269', trans_type: '30', trans_no_from: '1141', total: '100' }];
  const espejo = construirEspejoOperam(trans, pedidos, '1141');
  assert.equal(espejo.pago, 'anticipo');
});

test('AC3: construirEspejoOperam solo incluye lo que existe (sin factura/remision/etc no inventa campos)', () => {
  const trans = []; // solo pedido, sin documentos colgando aun
  const pedidos = [{ order_no: '7269', trans_type: '30', trans_no_from: '1141', total: '100' }];
  const espejo = construirEspejoOperam(trans, pedidos, '1141');
  assert.equal(espejo.cotizacion, '1141');
  assert.equal(espejo.pedido, '7269');
  assert.equal('factura' in espejo, false);
  assert.equal('pago' in espejo, false); // sin factura no hay estado de pago
  assert.deepEqual(espejo.remisiones, []);
});

test('AC3: reconciliarOportunidad persiste el espejo con la cadena resuelta por documento', async () => {
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7269', trans_no: '6735', reference: 'A1907', total_amount: '16954', allocated: '16954', outstanding: '0', debtor_no: '394' },
      { type: '13', order_: '7269', trans_no: '7329', reference: '2142', debtor_no: '394' },
    ],
    pedidos: [{ order_no: '7269', trans_type: '30', debtor_no: '394', trans_no_from: '1141', total: '100' }],
  });
  const op = { id: 5, etapa: 'seguimiento', folioOperam: '1141', data: { cliente: { rfc: 'CPE921211N76' } } };
  await reconciliarOportunidad(op, deps);
  assert.equal(deps.espejos.length, 1);
  assert.equal(deps.espejos[0].id, 5);
  assert.equal(deps.espejos[0].espejo.cotizacion, '1141');
  assert.equal(deps.espejos[0].espejo.pedido, '7269');
  assert.deepEqual(deps.espejos[0].espejo.factura, { numero: '6735', ref: 'A1907' });
  assert.deepEqual(deps.espejos[0].espejo.remisiones, ['2142']);
  assert.equal(deps.espejos[0].espejo.pago, 'pagado');
});

test('AC3: venta directa (trans_no_from vacio) NO persiste un espejo ligado por error a la cotizacion', async () => {
  // La oportunidad tiene folioOperam pero su cotizacion nunca se convirtio en
  // pedido; lo que hay en Operam es una venta directa (trans_no_from vacio). No hay
  // liga por documento -> el espejo NO debe llevar el folio de cotizacion como
  // pedido. Como no se resolvio order_ por documento, no se persiste espejo
  // (no inventar una liga que no existe).
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '9001', trans_no: '5000', ref: 'A2000', total_amount: '300', allocated: '300', outstanding: '0', debtor_no: '500' },
    ],
    pedidos: [{ order_no: '9001', trans_type: '30', debtor_no: '500', trans_no_from: '', total: '100' }],
  });
  const op = { id: 6, etapa: 'seguimiento', folioOperam: '1141', data: { cliente: { rfc: 'VDX010101AAA' } } };
  await reconciliarOportunidad(op, deps);
  assert.equal(deps.espejos.length, 0);
});

test('AC3: sin RFC ni order resuelto no persiste espejo', async () => {
  const deps = depsMock({});
  const op = { id: 7, etapa: 'seguimiento', data: { cliente: {} } };
  await reconciliarOportunidad(op, deps);
  assert.equal(deps.espejos.length, 0);
});

// --- reconciliarOportunidad: mueve la tarjeta ---

test('reconciliarOportunidad: mueve a producto_entregado cuando hay factura liquidada + remision', async () => {
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7077', total_amount: '16954', allocated: '16954', outstanding: '0', debtor_no: '345' },
      { type: '13', order_: '7077', total_amount: '16954', allocated: '0', outstanding: '0', debtor_no: '345' },
    ],
    pedidos: [{ order_no: '7077', trans_type: '30', debtor_no: '345', total: '100' }],
  });
  const op = { id: 7, etapa: 'seguimiento', data: { cliente: { rfc: 'CPE921211N76' }, orderOperam: '7077' } };
  const res = await reconciliarOportunidad(op, deps);
  assert.equal(res.movida, true);
  assert.equal(res.etapa, 'producto_entregado');
  assert.equal(deps.movimientos.length, 1);
  assert.equal(deps.movimientos[0].id, 7);
  assert.equal(deps.movimientos[0].etapa, 'producto_entregado');
  assert.equal(deps.movimientos[0].evento.tipo, 'sync_operam');
});

test('reconciliarOportunidad: anticipo parcial con su pedido lleva a pedido_liberado (el pedido es la etapa mas avanzada)', async () => {
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7400', total_amount: '2000', allocated: '500', outstanding: '1500', debtor_no: '345' },
    ],
    pedidos: [{ order_no: '7400', trans_type: '30', debtor_no: '345', total: '100' }],
  });
  const op = { id: 8, etapa: 'seguimiento', data: { cliente: { rfc: 'ABC010101AAA' }, orderOperam: '7400' } };
  const res = await reconciliarOportunidad(op, deps);
  assert.equal(res.etapa, 'pedido_liberado');
});

test('reconciliarOportunidad: sin hecho post-venta no mueve la tarjeta', async () => {
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7400', total_amount: '2000', allocated: '0', outstanding: '2000', debtor_no: '345' },
    ],
    pedidos: [],
  });
  const op = { id: 9, etapa: 'seguimiento', data: { cliente: { rfc: 'ABC010101AAA' }, orderOperam: '7400' } };
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
    pedidos: [{ order_no: '7400', trans_type: '30', debtor_no: '345', total: '100' }],
  });
  const op = { id: 10, etapa: 'pedido_liberado', data: { cliente: { rfc: 'ABC010101AAA' }, orderOperam: '7400' } };
  const res = await reconciliarOportunidad(op, deps);
  assert.equal(res.movida, false);
  assert.equal(deps.movimientos.length, 0);
});

// #485: el Comprobante de pago es aviso, no candado. Sin el comprobante del
// primer pago el sync mueve la tarjeta con lo que registra Operam, igual que con
// el; lo que falte lo dice el badge "Falta comprobante", no la etapa.
test('reconciliarOportunidad: sin comprobante de pago el sync avanza igual (#485, aviso y no candado)', async () => {
  const transacciones = [
    { type: '10', order_: '7400', total_amount: '2000', allocated: '500', outstanding: '1500', debtor_no: '345' },
  ];
  const pedidos = [{ order_no: '7400', trans_type: '30', debtor_no: '345', total: '100' }];
  const sinComprobante = depsMock({ transacciones, pedidos });
  const res = await reconciliarOportunidad({ id: 13, etapa: 'seguimiento', data: { cliente: { rfc: 'ABC010101AAA' }, orderOperam: '7400' } }, sinComprobante);
  assert.equal(res.etapa, 'pedido_liberado');
  assert.deepEqual(sinComprobante.movimientos.map(m => m.etapa), ['pedido_liberado']);

  const conComprobante = depsMock({ transacciones, pedidos });
  const comprobantesPago = { primer: { fecha: '2026-09-30T12:00:00.000Z', archivos: [{ nombre: 'a.pdf', ruta: '/a.pdf', fecha: '2026-09-30T12:00:00.000Z' }] } };
  const res2 = await reconciliarOportunidad({ id: 14, etapa: 'seguimiento', data: { cliente: { rfc: 'ABC010101AAA' }, orderOperam: '7400', comprobantesPago } }, conComprobante);
  assert.equal(res2.etapa, 'pedido_liberado');
});

// #486: "hubo anticipo" decide si la venta lleva comprobante del saldo. El espejo
// sobrescribe `anticipo` con `pagado`, asi que la marca se anota aparte la primera
// vez que el sync ve el pago parcial y un pago posterior que liquida no la borra
// (actualizarDatos es un merge: escribir false la apagaria).
test('reconciliarOportunidad: anota huboAnticipo al ver un pago parcial y el pago que liquida no la borra (#486)', async () => {
  const parcial = depsMock({ transacciones: [
    { type: '10', order_: '7400', total_amount: '2000', allocated: '500', outstanding: '1500', debtor_no: '345' },
  ], pedidos: [{ order_no: '7400', trans_type: '30', debtor_no: '345', total: '100' }] });
  await reconciliarOportunidad({ id: 15, etapa: 'seguimiento', data: { cliente: { rfc: 'ABC010101AAA' }, orderOperam: '7400' } }, parcial);
  assert.equal(parcial.datos.find(d => d.id === 15).campos.huboAnticipo, true);

  const liquida = depsMock({ transacciones: [
    { type: '10', order_: '7400', total_amount: '2000', allocated: '2000', outstanding: '0', debtor_no: '345' },
  ], pedidos: [{ order_no: '7400', trans_type: '30', debtor_no: '345', total: '100' }] });
  await reconciliarOportunidad({ id: 15, etapa: 'anticipo_pagado', data: { cliente: { rfc: 'ABC010101AAA' }, orderOperam: '7400', huboAnticipo: true } }, liquida);
  for (const d of liquida.datos) assert.ok(!('huboAnticipo' in d.campos), JSON.stringify(d.campos));
});

test('reconciliarOportunidad: pago unico (directo a liquidado) no anota huboAnticipo (#486)', async () => {
  const deps = depsMock({ transacciones: [
    { type: '10', order_: '7400', total_amount: '2000', allocated: '2000', outstanding: '0', debtor_no: '345' },
  ], pedidos: [{ order_no: '7400', trans_type: '30', debtor_no: '345', total: '100' }] });
  await reconciliarOportunidad({ id: 16, etapa: 'seguimiento', data: { cliente: { rfc: 'ABC010101AAA' }, orderOperam: '7400' } }, deps);
  for (const d of deps.datos) assert.ok(!('huboAnticipo' in d.campos), JSON.stringify(d.campos));
});

// --- #507: solo los hechos de SU pedido mueven una cotizacion ---
// Antes, sin pedido propio, el motor calculaba la etapa con las ventas de TODO el
// cliente (el "agregado por cliente"): asi llegaron a Producto entregado 31
// cotizaciones que nunca vendieron. Sin pedido propio no se escribe nada.

// El cliente tiene OTRA venta (pedido 7100, nacido de la cotizacion 1050) con
// remision y factura liquidada; la cotizacion 1197 nunca se volvio pedido.
const OTRA_VENTA_ENTREGADA = {
  transacciones: [
    { type: '10', order_: '7100', trans_no: '6001', reference: 'A1800', total_amount: '5000', allocated: '5000', outstanding: '0', debtor_no: '345' },
    { type: '13', order_: '7100', trans_no: '7001', reference: '2100', debtor_no: '345' },
  ],
  pedidos: [{ order_no: '7100', trans_type: '30', debtor_no: '345', trans_no_from: '1050', total: '100' }],
};

test('#507: la venta de OTRA cotizacion del cliente no mueve ni marca a la que no tiene pedido propio', async () => {
  const deps = depsMock(OTRA_VENTA_ENTREGADA);
  const op = { id: 30, etapa: 'seguimiento', folioOperam: '1197', data: { cliente: { rfc: 'CPE921211N76', customerId: '345' } } };
  const res = await reconciliarOportunidad(op, deps);
  assert.equal(res.movida, false);
  assert.equal(res.etapa, null);
  assert.equal(res.motivo, 'sin-pedido-propio');
  assert.deepEqual(deps.movimientos, []);
  assert.deepEqual(deps.espejos, []);
  assert.deepEqual(deps.datos, []);
});

test('#507: una decorada con checklist incompleto y sin pedido propio no recibe "Pago sin registrar"', async () => {
  // La otra venta del cliente esta entregada SIN pagar: con el agregado, el gate
  // frenaba la etapa pero la bandera se escribia igual.
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7100', total_amount: '5000', allocated: '0', outstanding: '5000', debtor_no: '345' },
      { type: '13', order_: '7100', debtor_no: '345' },
    ],
    pedidos: [{ order_no: '7100', trans_type: '30', debtor_no: '345', trans_no_from: '1050', total: '100' }],
  });
  const op = { id: 31, etapa: 'seguimiento', folioOperam: '1288', decorado: true, data: { cliente: { rfc: 'CPE921211N76' }, calcaChecklist: [] } };
  const res = await reconciliarOportunidad(op, deps);
  assert.equal(res.motivo, 'sin-pedido-propio');
  assert.equal(deps.datos.some(d => 'pagoSinRegistrar' in d.campos), false);
  assert.deepEqual(deps.movimientos, []);
});

test('#507: sin folio y sin pedido explicito no se mueve, no se marca y ni siquiera lee Operam', async () => {
  let lecturas = 0;
  const deps = depsMock(OTRA_VENTA_ENTREGADA);
  const leerTx = deps.listarTransacciones;
  const leerPed = deps.listarPedidos;
  deps.listarTransacciones = async (q) => { lecturas++; return leerTx(q); };
  deps.listarPedidos = async (q) => { lecturas++; return leerPed(q); };
  const op = { id: 32, etapa: 'seguimiento', data: { cliente: { rfc: 'CPE921211N76', customerId: '345' } } };
  const res = await reconciliarOportunidad(op, deps);
  assert.equal(res.movida, false);
  assert.equal(res.motivo, 'sin-pedido-propio');
  assert.equal(lecturas, 0);
  assert.deepEqual(deps.movimientos, []);
  assert.deepEqual(deps.espejos, []);
  assert.deepEqual(deps.datos, []);
});

test('#507: un pedido explicito que no aparece en las lecturas de Operam no dispara el agregado', async () => {
  const deps = depsMock(OTRA_VENTA_ENTREGADA);
  const op = { id: 33, etapa: 'seguimiento', folioOperam: '1197', data: { cliente: { rfc: 'CPE921211N76' }, orderOperam: '9999' } };
  const res = await reconciliarOportunidad(op, deps);
  assert.equal(res.movida, false);
  assert.equal(res.motivo, 'sin-pedido-propio');
  assert.deepEqual(deps.movimientos, []);
  assert.deepEqual(deps.espejos, []);
  assert.deepEqual(deps.datos, []);
});

test('#507: con pedido propio por documento de origen todo sigue: etapa, espejo y "Pago sin registrar"', async () => {
  // La cotizacion 1050 SI es el origen del pedido 7100: entregado y liquidado.
  const deps = depsMock(OTRA_VENTA_ENTREGADA);
  const op = { id: 34, etapa: 'seguimiento', folioOperam: '1050', data: { cliente: { rfc: 'CPE921211N76' } } };
  const res = await reconciliarOportunidad(op, deps);
  assert.equal(res.movida, true);
  assert.equal(res.etapa, 'producto_entregado');
  assert.equal(res.motivo, undefined);
  assert.equal(deps.espejos[0].espejo.pedido, '7100');
  assert.equal(deps.datos.find(d => d.id === 34).campos.pagoSinRegistrar, false);
});

test('#507: una entregada sin pago con pedido propio por documento apaga "Pago sin registrar" cuando el pago aparece', async () => {
  const deps = depsMock(OTRA_VENTA_ENTREGADA);
  const op = { id: 35, etapa: 'producto_entregado', folioOperam: '1050', data: { cliente: { rfc: 'CPE921211N76' }, pagoSinRegistrar: true } };
  const res = await reconciliarOportunidad(op, deps);
  assert.equal(res.movida, false);
  assert.equal(deps.datos.find(d => d.id === 35).campos.pagoSinRegistrar, false);
});

test('#507: con pedido propio y la etapa ya al dia el motivo es "sin cambios", no "sin pedido propio"', async () => {
  const conPedido = depsMock(OTRA_VENTA_ENTREGADA);
  const alDia = await reconciliarOportunidad({ id: 36, etapa: 'producto_entregado', folioOperam: '1050', data: { cliente: { rfc: 'CPE921211N76' }, pagoSinRegistrar: true } }, conPedido);
  assert.equal(alDia.motivo, 'sin-cambios');

  const sinPedido = depsMock(OTRA_VENTA_ENTREGADA);
  const ajena = await reconciliarOportunidad({ id: 37, etapa: 'seguimiento', folioOperam: '1197', data: { cliente: { rfc: 'CPE921211N76' } } }, sinPedido);
  assert.equal(ajena.motivo, 'sin-pedido-propio');
});

test('#535: reconciliarOportunidad mueve a la decorada con checklist incompleto como a cualquier otra', async () => {
  // Operam dice pedido + anticipo parcial: el checklist vacio ya no la topa.
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7400', total_amount: '2000', allocated: '500', outstanding: '1500', debtor_no: '345' },
    ],
    pedidos: [{ order_no: '7400', trans_type: '30', debtor_no: '345', total: '100' }],
  });
  const op = { id: 11, etapa: 'seguimiento', decorado: true, data: { cliente: { rfc: 'ABC010101AAA' }, orderOperam: '7400', calcaChecklist: [] } };
  const res = await reconciliarOportunidad(op, deps);
  assert.equal(res.etapa, 'pedido_liberado');
});

test('reconciliarOportunidad: sin RFC ni Cliente Operam y sin el pedido en el listado no mueve ni truena', async () => {
  const deps = depsMock({});
  const op = { id: 12, etapa: 'seguimiento', data: { cliente: {}, orderOperam: '7077' } };
  const res = await reconciliarOportunidad(op, deps);
  assert.equal(res.movida, false);
  assert.equal(res.motivo, 'sin-pedido-propio');
  assert.equal(deps.movimientos.length, 0);
  assert.deepEqual(deps.datos, []);
});

// --- Pago sin registrar (issue #77): persistencia del flag + candidatura ---

test('#77: reconciliarOportunidad persiste pagoSinRegistrar=true cuando entrego pero no ha pagado', async () => {
  // Factura con saldo (allocated < total) + remision: entregado impago.
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7077', total_amount: '16954', allocated: '0', outstanding: '16954', debtor_no: '345' },
      { type: '13', order_: '7077', total_amount: '16954', allocated: '0', outstanding: '0', debtor_no: '345' },
    ],
    pedidos: [{ order_no: '7077', trans_type: '30', debtor_no: '345', total: '100' }],
  });
  const op = { id: 20, etapa: 'seguimiento', data: { cliente: { rfc: 'CPE921211N76' }, orderOperam: '7077' } };
  const res = await reconciliarOportunidad(op, deps);
  assert.equal(res.etapa, 'producto_entregado');
  const marca = deps.datos.find(d => d.id === 20 && 'pagoSinRegistrar' in d.campos);
  assert.ok(marca, 'debe persistir el flag');
  assert.equal(marca.campos.pagoSinRegistrar, true);
});

test('#77: reconciliarOportunidad persiste pagoSinRegistrar=false cuando ya se liquido el pago', async () => {
  // Al registrarse el pago (allocated == total) el flag se apaga aunque siga entregada.
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7077', total_amount: '16954', allocated: '16954', outstanding: '0', debtor_no: '345' },
      { type: '13', order_: '7077', total_amount: '16954', allocated: '0', outstanding: '0', debtor_no: '345' },
    ],
    pedidos: [{ order_no: '7077', trans_type: '30', debtor_no: '345', total: '100' }],
  });
  const op = { id: 21, etapa: 'producto_entregado', data: { cliente: { rfc: 'CPE921211N76' }, orderOperam: '7077', pagoSinRegistrar: true } };
  await reconciliarOportunidad(op, deps);
  const marca = deps.datos.find(d => d.id === 21 && 'pagoSinRegistrar' in d.campos);
  assert.ok(marca, 'debe persistir el flag');
  assert.equal(marca.campos.pagoSinRegistrar, false);
});

// --- esActivaPostVentaCandidata ---

test('esActivaPostVentaCandidata: activas no terminadas si, terminadas y salidas no', () => {
  assert.equal(esActivaPostVentaCandidata({ etapa: 'seguimiento' }), true);
  assert.equal(esActivaPostVentaCandidata({ etapa: 'anticipo_pagado' }), true);
  assert.equal(esActivaPostVentaCandidata({ etapa: 'producto_entregado' }), false);
  assert.equal(esActivaPostVentaCandidata({ etapa: 'perdida' }), false);
  assert.equal(esActivaPostVentaCandidata({ etapa: 'no_util' }), false);
});

test('#77: producto_entregado con pago sin registrar SIGUE siendo candidata (para limpiar el flag)', () => {
  // Un pago posterior debe poder apagar el badge; por eso la entregada-impaga no es
  // terminal para el sync hasta que el pago se registre.
  assert.equal(esActivaPostVentaCandidata({ etapa: 'producto_entregado', data: { pagoSinRegistrar: true } }), true);
});

test('#77: producto_entregado ya pagada (sin flag) es terminal para el sync', () => {
  assert.equal(esActivaPostVentaCandidata({ etapa: 'producto_entregado', data: { pagoSinRegistrar: false } }), false);
  assert.equal(esActivaPostVentaCandidata({ etapa: 'producto_entregado', data: {} }), false);
});

// La seleccion de cotizaciones por aviso de Operam (#510) se prueba en
// test/sync-operam-avisos.test.js.

// #484 (CONTEXT.md "Cancelada"): la Oportunidad con pedido que el admin cerro
// como Cancelada es una salida; el sync post-venta no la mueve ni la revive
// aunque Operam registre pagos o remisiones despues.
test('#484: una Cancelada no es candidata del sync post-venta', () => {
  assert.equal(esActivaPostVentaCandidata({ etapa: 'cancelada' }), false);
  assert.equal(esActivaPostVentaCandidata({ etapa: 'cancelada', data: { pagoSinRegistrar: true } }), false);
});

test('#484: el webhook no mueve una Cancelada aunque Operam traiga pago liquidado y remision', async () => {
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7077', total_amount: '16954', allocated: '16954', outstanding: '0', debtor_no: '345' },
      { type: '13', order_: '7077', total_amount: '16954', allocated: '0', outstanding: '0', debtor_no: '345' },
    ],
    pedidos: [{ order_no: '7077', trans_type: '30', debtor_no: '345', total: '100' }],
  });
  const oportunidades = [{ id: 7, etapa: 'cancelada', data: { cliente: { rfc: 'CPE921211N76' }, orderOperam: '7077' } }];
  const res = await reconciliarAviso({ tipo: 'remision' }, oportunidades, deps);
  assert.deepEqual(res, []);
  assert.equal(deps.movimientos.length, 0);
  assert.equal(deps.espejos.length, 0);
  assert.equal(deps.datos.length, 0);
});
