import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hechosDeOperam, reconciliarOportunidad, reconciliarPorIdentificador, esActivaPostVentaCandidata, resolverOrderDeOportunidad, construirEspejoOperam } from '../lib/sync-operam-io.js';

// Motor de reconciliacion del sync post-venta (issue #62, AC2). Lee Operam
// (read-only), normaliza a hechos con el mapeo real (peltre-operam.md 12) y mueve
// la tarjeta via el nucleo puro. Tests con dependencias inyectadas (mock de las
// lecturas de Operam y del store) -- NO se llama a Operam real.

function depsMock({ transacciones = [], pedidos = [], onCambiarEtapa } = {}) {
  const movimientos = [];
  const espejos = [];
  return {
    movimientos,
    espejos,
    listarTransacciones: async () => transacciones,
    listarPedidos: async () => pedidos,
    cambiarEtapa: async (id, etapa, evento) => {
      movimientos.push({ id, etapa, evento });
      if (onCambiarEtapa) onCambiarEtapa(id, etapa, evento);
      return true;
    },
    setEspejoOperam: async (id, espejo) => {
      espejos.push({ id, espejo });
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
      { order_no: '7077', trans_type: '30', debtor_no: '345' },
      { order_no: '7230', trans_type: '30', debtor_no: '345' },
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
  // el numero de cotizacion nunca es el de pedido, el folio NO debe filtrar a 8888;
  // sin data.orderOperam se agrega por cliente (ambas cadenas).
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7077', total_amount: '16954', allocated: '16954', outstanding: '0', debtor_no: '345' },
      { type: '13', order_: '7077', total_amount: '16954', allocated: '0', outstanding: '0', debtor_no: '345' },
      { type: '10', order_: '8888', total_amount: '500', allocated: '100', outstanding: '400', debtor_no: '345' },
    ],
    pedidos: [
      { order_no: '7077', trans_type: '30', debtor_no: '345' },
      { order_no: '8888', trans_type: '30', debtor_no: '345' },
    ],
  });
  const op = { id: 1, etapa: 'seguimiento', folioOperam: '8888', data: { cliente: { rfc: 'CPE921211N76' } } };
  const hechos = await hechosDeOperam(op, deps);
  // Agregado por cliente: ve la remision de 7077 (si filtrara por el folio 8888 no la veria).
  assert.equal(hechos.tieneRemision, true);
  assert.equal(hechos.pago.allocated, 16954 + 100);
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
      { order_no: '7269', trans_type: '30', debtor_no: '394', trans_no_from: '1141' },
      { order_no: '7300', trans_type: '30', debtor_no: '394', trans_no_from: '1150' },
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
      { order_no: '7269', trans_type: '30', debtor_no: '394', trans_no_from: '1141' },
      { order_no: '7300', trans_type: '30', debtor_no: '394', trans_no_from: '1150' },
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
      { order_no: '7269', trans_type: '30', debtor_no: '394', trans_no_from: '1141' },
      { order_no: '7300', trans_type: '30', debtor_no: '394', trans_no_from: '1150' },
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
  // NO debe ligarse por error a la venta directa. Sin liga por documento, el
  // fallback por cliente igual ve la cadena (caso comun: una sola cadena), pero la
  // liga por documento (precisa) NO debe inventar el match.
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '9001', total_amount: '300', allocated: '0', outstanding: '300', debtor_no: '500' },
    ],
    pedidos: [
      { order_no: '9001', trans_type: '30', debtor_no: '500', trans_no_from: '' },
    ],
  });
  const op = { id: 1, etapa: 'seguimiento', folioOperam: '1141', data: { cliente: { rfc: 'VDX010101AAA' } } };
  const res = await resolverOrderDeOportunidad(op, deps.listarTransacciones, deps.listarPedidos);
  // La resolucion precisa por documento NO encuentra match (trans_no_from vacio).
  assert.equal(res.order, null);
  assert.equal(res.fuente, 'cliente');
});

test('AC2: resolverOrderDeOportunidad reporta la fuente del binding', async () => {
  const pedidos = [
    { order_no: '7269', trans_type: '30', debtor_no: '394', trans_no_from: '1141' },
  ];
  // Por documento.
  const porDoc = await resolverOrderDeOportunidad(
    { id: 1, folioOperam: '1141', data: { cliente: { rfc: 'X' } } },
    async () => [{ order_: '7269', debtor_no: '394' }],
    async () => pedidos,
  );
  assert.equal(porDoc.order, '7269');
  assert.equal(porDoc.fuente, 'documento');
  // Explicito.
  const porExplicito = await resolverOrderDeOportunidad(
    { id: 1, folioOperam: '1141', data: { cliente: { rfc: 'X' }, orderOperam: '7000' } },
    async () => [{ order_: '7000', debtor_no: '394' }],
    async () => pedidos,
  );
  assert.equal(porExplicito.order, '7000');
  assert.equal(porExplicito.fuente, 'explicito');
});

// --- AC3 (#67): espejo de la cadena (construir + persistir) ---

test('AC3: construirEspejoOperam arma la cadena de folios desde trans + pedidos filtrados', () => {
  const trans = [
    { type: '10', order_: '7269', trans_no: '6735', ref: 'A1907', total_amount: '16954', allocated: '16954', outstanding: '0' },
    { type: '13', order_: '7269', trans_no: '7329', ref: 'D55' },
    { type: '12', order_: '7269', trans_no: '8001', ref: 'S1886.1' },
    { type: '11', order_: '7269', trans_no: '9001', ref: 'NC88' },
  ];
  const pedidos = [{ order_no: '7269', trans_type: '30', trans_no_from: '1141' }];
  const espejo = construirEspejoOperam(trans, pedidos, '1141');
  assert.equal(espejo.cotizacion, '1141');
  assert.equal(espejo.pedido, '7269');
  assert.deepEqual(espejo.factura, { numero: '6735', ref: 'A1907' });
  assert.deepEqual(espejo.remisiones, ['7329']);
  assert.deepEqual(espejo.pagos, ['S1886.1']);
  assert.deepEqual(espejo.notasCredito, ['NC88']);
});

test('AC3: construirEspejoOperam solo incluye lo que existe (sin factura/remision/etc no inventa campos)', () => {
  const trans = []; // solo pedido, sin documentos colgando aun
  const pedidos = [{ order_no: '7269', trans_type: '30', trans_no_from: '1141' }];
  const espejo = construirEspejoOperam(trans, pedidos, '1141');
  assert.equal(espejo.cotizacion, '1141');
  assert.equal(espejo.pedido, '7269');
  assert.equal('factura' in espejo, false);
  assert.deepEqual(espejo.remisiones, []);
  assert.deepEqual(espejo.pagos, []);
  assert.deepEqual(espejo.notasCredito, []);
});

test('AC3: reconciliarOportunidad persiste el espejo con la cadena resuelta por documento', async () => {
  const deps = depsMock({
    transacciones: [
      { type: '10', order_: '7269', trans_no: '6735', ref: 'A1907', total_amount: '16954', allocated: '16954', outstanding: '0', debtor_no: '394' },
      { type: '13', order_: '7269', trans_no: '7329', ref: 'D55', debtor_no: '394' },
    ],
    pedidos: [{ order_no: '7269', trans_type: '30', debtor_no: '394', trans_no_from: '1141' }],
  });
  const op = { id: 5, etapa: 'seguimiento', folioOperam: '1141', data: { cliente: { rfc: 'CPE921211N76' } } };
  await reconciliarOportunidad(op, deps);
  assert.equal(deps.espejos.length, 1);
  assert.equal(deps.espejos[0].id, 5);
  assert.equal(deps.espejos[0].espejo.cotizacion, '1141');
  assert.equal(deps.espejos[0].espejo.pedido, '7269');
  assert.deepEqual(deps.espejos[0].espejo.factura, { numero: '6735', ref: 'A1907' });
  assert.deepEqual(deps.espejos[0].espejo.remisiones, ['7329']);
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
    pedidos: [{ order_no: '9001', trans_type: '30', debtor_no: '500', trans_no_from: '' }],
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
    { id: 1, etapa: 'seguimiento', data: { cliente: { rfc: 'CPE921211N76' }, orderOperam: '7077' } },
    { id: 2, etapa: 'seguimiento', data: { cliente: { rfc: 'CPE921211N76' }, orderOperam: '7230' } },
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
