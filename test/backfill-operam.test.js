import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { esCandidatoBackfill, esSucursalTlapacoya, esCerrado, etapaBackfill, mapearSalesman, mapearVendedorPorUsuario, construirEntradaCotizacion, subtotalDesdeTotal, folioYaExiste, planearBackfill, memoizarPorClave, descubrirFolioMax, planearBackfillSinPedido, entregaCompleta } from '../lib/backfill-operam.mjs';

// Mapa de vendedores como el de data/vendedores.json (operam_id -> vendedor).
const VENDEDORES = [
  { id: 1, name: 'Adrián Chávez', operam_id: 1 },
  { id: 2, name: 'Alejandro Chávez', operam_id: 2 },
  { id: 3, name: 'Oswaldo Chávez', operam_id: 8 },
  { id: 4, name: 'Alejandro Castañón', operam_id: 9 },
  { id: 5, name: 'Jaime Abaroa', operam_id: null },
];

// Backfill de cotizaciones reales via pedidos (issue #76). Funciones PURAS;
// el script scripts/backfill-operam.mjs las orquesta con IO inyectada. Sin
// llamadas a Operam real aqui (mocks / datos crudos).

// --- esCandidatoBackfill: filtro de pedidos que representan una cotizacion ---

test('esCandidatoBackfill: pedido con trans_no_from no vacio es candidato', () => {
  assert.equal(esCandidatoBackfill({ order_no: '7269', trans_no_from: '1141', debtor_no: '394' }), true);
});

test('esCandidatoBackfill: venta directa (trans_no_from vacio) NO es candidato', () => {
  assert.equal(esCandidatoBackfill({ order_no: '8000', trans_no_from: '', debtor_no: '500' }), false);
  assert.equal(esCandidatoBackfill({ order_no: '8001', trans_no_from: null, debtor_no: '500' }), false);
  assert.equal(esCandidatoBackfill({ order_no: '8002', debtor_no: '500' }), false);
});

test('esCandidatoBackfill: excluye el pedido de prueba 7270 (sonda de #67)', () => {
  assert.equal(esCandidatoBackfill({ order_no: '7270', trans_no_from: '1163', debtor_no: '394' }), false);
  // tolera order_no numerico ademas de string
  assert.equal(esCandidatoBackfill({ order_no: 7270, trans_no_from: '1163', debtor_no: 394 }), false);
});

test('esCandidatoBackfill: excluye debtors de prueba PUBLICO EN GENERAL (14) y 1', () => {
  assert.equal(esCandidatoBackfill({ order_no: '8100', trans_no_from: '1200', debtor_no: '14' }), false);
  assert.equal(esCandidatoBackfill({ order_no: '8101', trans_no_from: '1201', debtor_no: 14 }), false);
  assert.equal(esCandidatoBackfill({ order_no: '8102', trans_no_from: '1202', debtor_no: '1' }), false);
  assert.equal(esCandidatoBackfill({ order_no: '8103', trans_no_from: '1203', debtor_no: 1 }), false);
});

test('esCandidatoBackfill: pedido nulo o sin order_no no es candidato', () => {
  assert.equal(esCandidatoBackfill(null), false);
  assert.equal(esCandidatoBackfill(undefined), false);
  assert.equal(esCandidatoBackfill({ trans_no_from: '1300' }), false);
});

// --- esCerrado / etapaBackfill: CRITERIO 2 #76, cerrado = entregado Y pagado 100% ---
// Decision Adrian: un pedido esta CERRADO solo si entregado totalmente Y pagado en
// su totalidad. Los entregados-impagos (remision sin pago al 100%) tienen cobranza
// pendiente -> se INCLUYEN como activos, con etapa que refleje el avance de pago (NO
// producto_entregado, que se veria cerrada). Reusa estadoPago de sync-operam.js.

test('esCerrado: entregado (remision) Y pagado al 100% -> true (oportunidad cerrada)', () => {
  assert.equal(esCerrado({ tieneRemision: true, pago: { allocated: 100, total: 100 } }, 16954), true);
});

test('esCerrado: entregado pero impago (pago parcial / sin pago) -> false (cobranza pendiente)', () => {
  assert.equal(esCerrado({ tieneRemision: true, pago: { allocated: 50, total: 100 } }, 16954), false);
  assert.equal(esCerrado({ tieneRemision: true, pago: { allocated: 0, total: 100 } }, 16954), false);
});

test('esCerrado: pagado al 100% pero NO entregado (sin remision) -> false', () => {
  assert.equal(esCerrado({ tieneRemision: false, pago: { allocated: 100, total: 100 } }, 16954), false);
});

test('esCerrado: hechos nulo o vacio -> false (no cerrado)', () => {
  assert.equal(esCerrado(null, 16954), false);
  assert.equal(esCerrado(undefined, 16954), false);
  assert.equal(esCerrado({}, 16954), false);
});

test('esCerrado: total ausente conserva el comportamiento previo (exige pago al 100%)', () => {
  // Compatibilidad: sin `total` (o total>0) la regla es la de antes -> entregado Y pagado.
  assert.equal(esCerrado({ tieneRemision: true, pago: { allocated: 100, total: 100 } }), true);
  assert.equal(esCerrado({ tieneRemision: true, pago: { allocated: 50, total: 100 } }), false);
  assert.equal(esCerrado({ tieneRemision: false, pago: { allocated: 100, total: 100 } }), false);
});

// CRITERIO 2 #76 (decision Adrian): un pedido con total 0 (muestra/cortesia) NO se
// factura; por lo tanto basta la ENTREGA (remision) para considerarlo cerrado, sin
// exigir pago. Un $0 NO entregado sigue activo (muestra pendiente de envio).

test('esCerrado: $0 entregado (remision) -> true (muestra/cortesia, no se factura)', () => {
  assert.equal(esCerrado({ tieneRemision: true, pago: { allocated: 0, total: 0 } }, 0), true);
  assert.equal(esCerrado({ tieneRemision: true, pago: { allocated: 0, total: 0 } }, '0'), true);
});

test('esCerrado: $0 SIN remision -> false (muestra pendiente de envio, sigue activa)', () => {
  assert.equal(esCerrado({ tieneRemision: false, pago: { allocated: 0, total: 0 } }, 0), false);
});

test('esCerrado: >0 con remision impago -> false (cobranza, sigue activo, no aplica regla $0)', () => {
  assert.equal(esCerrado({ tieneRemision: true, pago: { allocated: 50, total: 100 } }, 100), false);
});

test('esCerrado: >0 con remision pagado al 100% -> true (cerrado normal)', () => {
  assert.equal(esCerrado({ tieneRemision: true, pago: { allocated: 100, total: 100 } }, 100), true);
});

test('etapaBackfill: entregado-impago -> producto_entregado (cumplimiento manda, #77)', () => {
  // #77 (decision Adrian): el eje que manda en el pipeline es el CUMPLIMIENTO, no la
  // cobranza. Un pedido con remision se ve como producto_entregado AUNQUE el pago no
  // este liquidado: por politica no se entrega sin pago completo, asi que el faltante
  // en el sistema es casi siempre el desfase de registro de la contadora. La cobranza
  // pendiente se marca aparte (data.cobranza -> badge "Pago sin registrar"), sin
  // retroceder la etapa. Antes esta funcion ignoraba la remision y daba pedido_liberado.
  const hechos = { tieneRemision: true, tienePedido: true, pago: { allocated: 30, total: 100 } };
  assert.equal(etapaBackfill(hechos, { etapa: 'seguimiento' }), 'producto_entregado');
});

test('etapaBackfill: entregado-impago SIN pedido -> producto_entregado (la remision manda, #77)', () => {
  // Aun sin pedido y con pago parcial, la remision es la senal mas avanzada: el
  // producto salio. La cobranza (anticipo) se persiste aparte en data.cobranza.
  const hechos = { tieneRemision: true, tienePedido: false, pago: { allocated: 30, total: 100 } };
  assert.equal(etapaBackfill(hechos, { etapa: 'seguimiento' }), 'producto_entregado');
});

test('etapaBackfill: entregado sin anticipo -> producto_entregado (#77)', () => {
  const hechos = { tieneRemision: true, tienePedido: true, pago: { allocated: 0, total: 100 } };
  assert.equal(etapaBackfill(hechos, { etapa: 'seguimiento' }), 'producto_entregado');
});

test('etapaBackfill: entregado sin pedido ni pago -> producto_entregado (#77)', () => {
  const hechos = { tieneRemision: true, tienePedido: false, pago: { allocated: 0, total: 0 } };
  assert.equal(etapaBackfill(hechos, { etapa: 'seguimiento' }), 'producto_entregado');
});

test('etapaBackfill: no-entregado pagado al 100% -> saldo_pagado (etapa normal, sin tocar)', () => {
  const hechos = { tieneRemision: false, tienePedido: true, pago: { allocated: 100, total: 100 } };
  assert.equal(etapaBackfill(hechos, { etapa: 'seguimiento' }), 'saldo_pagado');
});

test('etapaBackfill: sin hecho post-venta cae a seguimiento (null de etapaPostVenta)', () => {
  const hechos = { tieneRemision: false, tienePedido: false, pago: { allocated: 0, total: 0 } };
  assert.equal(etapaBackfill(hechos, { etapa: 'seguimiento' }), 'seguimiento');
});

// $0 (muestra/cortesia, decision Adrian): el pedido no se factura, asi que el pago NO
// aplica; ademas el agregado del RFC generico lo contamina con pagos de otros clientes
// (binding falso -> saldo_pagado erroneo, visto en vivo folio 669). Para total<=0 la
// etapa se deriva SOLO de la existencia del pedido (pedido_liberado), ignorando pago y
// remision. Los $0 entregados ya los cierra esCerrado antes de llegar aqui.
test('etapaBackfill: $0 con pago contaminado (saldo_pagado) -> pedido_liberado, ignora el pago', () => {
  const hechos = { tieneRemision: false, tienePedido: true, pago: { allocated: 99999, total: 99999 } };
  assert.equal(etapaBackfill(hechos, { etapa: 'seguimiento' }, 0), 'pedido_liberado');
});

test('etapaBackfill: $0 sin pedido -> seguimiento (no inventa etapa de pago)', () => {
  const hechos = { tieneRemision: false, tienePedido: false, pago: { allocated: 5000, total: 5000 } };
  assert.equal(etapaBackfill(hechos, { etapa: 'seguimiento' }, 0), 'seguimiento');
});

test('etapaBackfill: total>0 conserva el comportamiento (saldo_pagado real, no se ignora)', () => {
  const hechos = { tieneRemision: false, tienePedido: true, pago: { allocated: 100, total: 100 } };
  assert.equal(etapaBackfill(hechos, { etapa: 'seguimiento' }, 100), 'saldo_pagado');
});

// --- entregaCompleta: una remision PARCIAL no es "entregado" (#76, caso 6988) ---
// El detalle del pedido trae qty_sent vs quantity por renglon. La entrega es completa
// solo si TODOS los renglones tienen qty_sent >= quantity. Un pedido con remision parcial
// (6988: 33 de 51 piezas) + pagado 100% NO debe cerrarse (sigue abierto).
test('entregaCompleta: true solo si todos los renglones tienen qty_sent >= quantity', () => {
  assert.equal(entregaCompleta([{ quantity: '2', qty_sent: '2' }, { quantity: '1', qty_sent: '1' }]), true);
  assert.equal(entregaCompleta([{ quantity: '2', qty_sent: '1' }, { quantity: '1', qty_sent: '1' }]), false); // parcial
  assert.equal(entregaCompleta([{ quantity: '1', qty_sent: '0' }]), false);
  assert.equal(entregaCompleta([]), false);   // sin renglones: no se afirma completa
  assert.equal(entregaCompleta(null), false);
});

// --- esSucursalTlapacoya: CRITERIO 1 #76, solo se importa la sucursal 01 ---
// Decision Adrian: importar SOLO sucursal 01 Tlapacoya; descartar Shopify (30),
// Amazon (31/32) y Bazaar (02). La sucursal NO esta en el payload (verificado en
// vivo): el canal SOLO es inferible por marcadores de la transaccion (pedido o
// quote): user.real_name === 'Shopify'; reference que empieza con S (Shopify) o A
// (Amazon); from_stk_loc que empieza con B (Bazaar) o AZ (Amazon). Lo demas =
// Tlapacoya (01) = se importa. Campos ausentes NO excluyen (defensivo).

test('esSucursalTlapacoya: Shopify por user.real_name -> excluido', () => {
  assert.equal(esSucursalTlapacoya({ user: { real_name: 'Shopify' }, from_stk_loc: '30' }), false);
});

test('esSucursalTlapacoya: Shopify por reference que empieza con S -> excluido', () => {
  assert.equal(esSucursalTlapacoya({ reference: 'S1777' }), false);
  assert.equal(esSucursalTlapacoya({ reference: 'S1781-R' }), false);
  assert.equal(esSucursalTlapacoya({ reference: 's1781' }), false); // case-insensitive
});

test('esSucursalTlapacoya: Amazon por reference que empieza con A -> excluido', () => {
  assert.equal(esSucursalTlapacoya({ reference: 'A4076261' }), false);
});

test('esSucursalTlapacoya: Amazon por from_stk_loc AZ (AZMX/AZUSA) -> excluido', () => {
  assert.equal(esSucursalTlapacoya({ from_stk_loc: 'AZMX' }), false);
  assert.equal(esSucursalTlapacoya({ from_stk_loc: 'AZUSA' }), false);
});

test('esSucursalTlapacoya: Bazaar por from_stk_loc que empieza con B -> excluido', () => {
  assert.equal(esSucursalTlapacoya({ from_stk_loc: 'B1' }), false);
  assert.equal(esSucursalTlapacoya({ from_stk_loc: 'B4' }), false);
});

test('esSucursalTlapacoya: Tlapacoya (loc 40, ref numerica, user real) -> incluido', () => {
  assert.equal(esSucursalTlapacoya({ from_stk_loc: '40', reference: '2604696', user: { real_name: 'Adrian Chavez' } }), true);
  assert.equal(esSucursalTlapacoya({ from_stk_loc: '40', reference: 'C2604151', user: { real_name: 'Alejandro Chavez' } }), true);
});

test('esSucursalTlapacoya: quote GENERICO TIENDAS DIGITALES por vendedor real (loc 40, ref C..) -> INCLUIDO', () => {
  // Es justo lo que se rescata: un mismo debtor generico tiene tx en 01 y en 30; las
  // de 01 (loc 40, ref C.., vendedor real) SI se importan. El filtro NO es por cliente.
  assert.equal(esSucursalTlapacoya({ from_stk_loc: '40', reference: 'C2604999', user: { real_name: 'Oswaldo Chavez' } }), true);
});

test('esSucursalTlapacoya: campos ausentes NO excluyen (defensivo) -> incluido', () => {
  assert.equal(esSucursalTlapacoya({}), true);
  assert.equal(esSucursalTlapacoya(null), true);
  assert.equal(esSucursalTlapacoya({ reference: '', from_stk_loc: '', user: {} }), true);
});

// --- mapearSalesman: salesman de Operam (operam_id) -> nombre de vendedor ---

test('mapearSalesman: el salesman es el operam_id; devuelve el nombre del vendedor', () => {
  assert.equal(mapearSalesman(8, VENDEDORES), 'Oswaldo Chávez');
  assert.equal(mapearSalesman('9', VENDEDORES), 'Alejandro Castañón');
  assert.equal(mapearSalesman(1, VENDEDORES), 'Adrián Chávez');
});

test('mapearSalesman: salesman sin match en vendedores -> null (sin inventar)', () => {
  assert.equal(mapearSalesman(99, VENDEDORES), null);
  assert.equal(mapearSalesman(null, VENDEDORES), null);
  assert.equal(mapearSalesman('', VENDEDORES), null);
  assert.equal(mapearSalesman(undefined, VENDEDORES), null);
});

test('mapearSalesman: no matchea contra operam_id null (Jaime Abaroa) por un salesman vacio', () => {
  // El vendedor sin operam_id no debe capturar salesman ausentes/nulos.
  assert.equal(mapearSalesman(null, VENDEDORES), null);
});

// --- mapearVendedorPorUsuario: CRITERIO 1 #76, fallback por el usuario creador ---
// Decision Adrian: para las transacciones a cliente generico el `salesman` no mapea
// ((sin mapear)), pero el vendedor se puede obtener del USUARIO CREADOR de la tx
// (tx.user.real_name, casi siempre "Alejandro Chavez" o "Adrian Chavez", SIN acentos).
// Normaliza (minusculas, sin diacriticos, trim) y compara contra vendedores[].name
// (que SI llevan acentos); devuelve el name con acentos, o null sin match (no inventa).

test('mapearVendedorPorUsuario: real_name sin acentos matchea el vendedor con acentos', () => {
  assert.equal(mapearVendedorPorUsuario('Alejandro Chavez', VENDEDORES), 'Alejandro Chávez');
  assert.equal(mapearVendedorPorUsuario('Adrian Chavez', VENDEDORES), 'Adrián Chávez');
  assert.equal(mapearVendedorPorUsuario('Oswaldo Chavez', VENDEDORES), 'Oswaldo Chávez');
});

test('mapearVendedorPorUsuario: normaliza mayusculas/espacios extra (case/trim-insensitive)', () => {
  assert.equal(mapearVendedorPorUsuario('  alejandro chavez  ', VENDEDORES), 'Alejandro Chávez');
  assert.equal(mapearVendedorPorUsuario('ALEJANDRO CASTANON', VENDEDORES), 'Alejandro Castañón');
});

test('mapearVendedorPorUsuario: sin match -> null (no inventa)', () => {
  assert.equal(mapearVendedorPorUsuario('Shopify', VENDEDORES), null);
  assert.equal(mapearVendedorPorUsuario('Juan Perez', VENDEDORES), null);
  assert.equal(mapearVendedorPorUsuario(null, VENDEDORES), null);
  assert.equal(mapearVendedorPorUsuario('', VENDEDORES), null);
  assert.equal(mapearVendedorPorUsuario(undefined, VENDEDORES), null);
});

// --- subtotalDesdeTotal: el total de Operam incluye IVA 16% (peltre-operam.md 12.6) ---

test('subtotalDesdeTotal: deriva el subtotal de total/1.16 cuando no hay subtotal nativo', () => {
  // 16954 con IVA -> 14615.52 sin IVA
  assert.equal(subtotalDesdeTotal(16954), Number((16954 / 1.16).toFixed(2)));
});

test('subtotalDesdeTotal: tolera string y total ausente', () => {
  assert.equal(subtotalDesdeTotal('1160'), 1000);
  assert.equal(subtotalDesdeTotal(0), 0);
  assert.equal(subtotalDesdeTotal(null), 0);
  assert.equal(subtotalDesdeTotal(undefined), 0);
});

// --- construirEntradaCotizacion: pedido + quote + debtor + etapa -> entrada del store ---

// Caso de referencia tomado de la cadena verificada en vivo (peltre-operam.md 12.2):
// cotizacion 1141 -> pedido order_no 7269 (Juana Hernandez, debtor 394).
const PEDIDO = { order_no: '7269', trans_no_from: '1141', debtor_no: '394', total: '16954' };
const QUOTE = {
  trans_no: '1141',
  ord_date: '2026-05-20',
  delivery_date: '2026-06-19',
  cust_ref: 'Tienda Juana',
  total: '16954',
  salesman: 8,
};
const DEBTOR = { debtor_no: '394', CustName: 'JUANA HERNANDEZ GARCIA', tax_id: 'HEGJ800101AB1', curr_code: 'MXN' };

// --- folioYaExiste: idempotencia del backfill por folioOperam ---

test('folioYaExiste: detecta un folioOperam ya presente en la lista (sin recrear)', () => {
  const cots = [
    { id: 1, folioOperam: '1140', data: {} },
    { id: 2, folioOperam: '1141', data: {} },
  ];
  assert.equal(folioYaExiste(cots, '1141'), true);
  assert.equal(folioYaExiste(cots, 1141), true);   // tolera numero
  assert.equal(folioYaExiste(cots, '9999'), false);
});

test('folioYaExiste: lista vacia o folio nulo -> false', () => {
  assert.equal(folioYaExiste([], '1141'), false);
  assert.equal(folioYaExiste(null, '1141'), false);
  assert.equal(folioYaExiste([{ id: 1, folioOperam: '1141' }], null), false);
  assert.equal(folioYaExiste([{ id: 1, folioOperam: '1141' }], ''), false);
});

test('construirEntradaCotizacion: arma los campos de cabecera que pidio Adrian', () => {
  const entrada = construirEntradaCotizacion({
    pedido: PEDIDO, quote: QUOTE, debtor: DEBTOR, etapa: 'saldo_pagado', vendedores: VENDEDORES,
  });
  // Columnas fijas de la tabla cotizaciones
  assert.equal(entrada.fecha, '2026-05-20');
  assert.equal(entrada.vendedor, 'Oswaldo Chávez');     // salesman 8 -> operam_id 8
  assert.equal(entrada.cliente, 'JUANA HERNANDEZ GARCIA');
  assert.equal(entrada.total, 16954);
  assert.equal(entrada.tier, null);                      // los quotes no traen el tier del cotizador
  // folioOperam = numero de cotizacion = trans_no_from del pedido
  assert.equal(entrada.folioOperam, '1141');
  assert.equal(entrada.etapa, 'saldo_pagado');
  // Campos extra en data (las columnas de la tabla son fijas)
  assert.equal(entrada.data.cliente.rfc, 'HEGJ800101AB1');
  assert.equal(entrada.data.cliente.customer_ref, 'Tienda Juana');
  assert.equal(entrada.data.subtotal, Number((16954 / 1.16).toFixed(2)));
  assert.equal(entrada.data.moneda, 'MXN');
  assert.equal(entrada.data.validoHasta, '2026-06-19'); // delivery_date del quote
  assert.equal(entrada.data.orderOperam, '7269');       // order_no del pedido (binding preciso)
  assert.equal(entrada.data.backfill, true);
});

test('construirEntradaCotizacion: usa subtotal nativo del quote si viene', () => {
  const quoteConSub = { ...QUOTE, subtotal: '14615.52' };
  const entrada = construirEntradaCotizacion({
    pedido: PEDIDO, quote: quoteConSub, debtor: DEBTOR, etapa: 'seguimiento', vendedores: VENDEDORES,
  });
  assert.equal(entrada.data.subtotal, 14615.52);
});

// El total de la tarjeta de parte A es el del PEDIDO (lo que Operam muestra para la
// orden), NO el del quote: pueden diferir (quote 1935 -> pedido 0 = muestra, folio
// 7251 visto en vivo). Antes mostraba el del quote -> total enganoso ($1935 con el
// pedido en $0). Parte B (pedido sintetico sin total) cae al total del quote.
test('construirEntradaCotizacion: el total es el del PEDIDO cuando difiere del quote (folio 7251)', () => {
  const pedido0 = { ...PEDIDO, total: '0' };
  const quote1935 = { ...QUOTE, total: '1935' };
  const entrada = construirEntradaCotizacion({ pedido: pedido0, quote: quote1935, debtor: DEBTOR, etapa: 'pedido_liberado', vendedores: VENDEDORES });
  assert.equal(entrada.total, 0);
});

test('construirEntradaCotizacion: parte B (pedido sintetico sin total) usa el total del quote', () => {
  const pedidoSintetico = { trans_no_from: '1150', order_no: null }; // como en planearBackfillSinPedido
  const entrada = construirEntradaCotizacion({ pedido: pedidoSintetico, quote: { ...QUOTE, total: '5800' }, debtor: DEBTOR, etapa: 'seguimiento', vendedores: VENDEDORES });
  assert.equal(entrada.total, 5800);
});

test('construirEntradaCotizacion: customer_ref tolera nombre customer_ref ademas de cust_ref', () => {
  const quoteAlt = { ...QUOTE, cust_ref: undefined, customer_ref: 'Ref Alterna' };
  const entrada = construirEntradaCotizacion({
    pedido: PEDIDO, quote: quoteAlt, debtor: DEBTOR, etapa: 'seguimiento', vendedores: VENDEDORES,
  });
  assert.equal(entrada.data.cliente.customer_ref, 'Ref Alterna');
});

test('construirEntradaCotizacion: customer_ref/contacto VIGENTES son los del PEDIDO, no del quote (#76, caso 5960)', () => {
  // El pedido se edita tras convertir el quote: el quote puede quedar con el cliente
  // ORIGINAL. Visto en 5960: quote = Cristian Ortiz / Hoteles Rodavento; pedido = Olga
  // Pinales / Asesoria Creativa. El dato vigente es el del pedido (parte A tiene pedido real).
  const pedidoEditado = { ...PEDIDO, customer_ref: 'Asesoria Creativa en Vent', deliver_to: 'Olga Pinales' };
  const quoteOriginal = { ...QUOTE, cust_ref: 'Hoteles Rodavento', deliver_to: 'Cristian Ortiz' };
  const entrada = construirEntradaCotizacion({ pedido: pedidoEditado, quote: quoteOriginal, debtor: DEBTOR, etapa: 'pedido_liberado', vendedores: VENDEDORES });
  assert.equal(entrada.data.cliente.customer_ref, 'Asesoria Creativa en Vent');
  assert.equal(entrada.data.cliente.contactoEntrega, 'Olga Pinales');
});

test('construirEntradaCotizacion: parte B (pedido sintetico sin customer_ref/deliver_to) cae al quote', () => {
  const pedidoSintetico = { trans_no_from: '1150', order_no: null };
  const quote = { ...QUOTE, cust_ref: 'Proyecto Quote', deliver_to: 'Contacto Quote' };
  const entrada = construirEntradaCotizacion({ pedido: pedidoSintetico, quote, debtor: DEBTOR, etapa: 'seguimiento', vendedores: VENDEDORES });
  assert.equal(entrada.data.cliente.customer_ref, 'Proyecto Quote');
  assert.equal(entrada.data.cliente.contactoEntrega, 'Contacto Quote');
});

test('construirEntradaCotizacion: salesman sin match deja vendedor null (no inventa)', () => {
  const quoteSinVend = { ...QUOTE, salesman: 77 };
  const entrada = construirEntradaCotizacion({
    pedido: PEDIDO, quote: quoteSinVend, debtor: DEBTOR, etapa: 'seguimiento', vendedores: VENDEDORES,
  });
  assert.equal(entrada.vendedor, null);
});

test('construirEntradaCotizacion: lee el salesman de branch.salesman cuando no viene top-level (#68)', () => {
  // El quote real de Operam trae el vendedor anidado en branch.salesman, NO a
  // nivel top (visto en #68). Sin este fallback el vendedor da null para todos.
  const quoteBranch = { ...QUOTE, salesman: undefined, branch: { salesman: 8 } };
  const entrada = construirEntradaCotizacion({
    pedido: PEDIDO, quote: quoteBranch, debtor: DEBTOR, etapa: 'seguimiento', vendedores: VENDEDORES,
  });
  assert.equal(entrada.vendedor, 'Oswaldo Chávez');
});

test('construirEntradaCotizacion: el salesman top-level tiene prioridad sobre branch.salesman', () => {
  const quoteAmbos = { ...QUOTE, salesman: 9, branch: { salesman: 8 } };
  const entrada = construirEntradaCotizacion({
    pedido: PEDIDO, quote: quoteAmbos, debtor: DEBTOR, etapa: 'seguimiento', vendedores: VENDEDORES,
  });
  assert.equal(entrada.vendedor, 'Alejandro Castañón');
});

// CRITERIO 1 #76: si el salesman NO mapea, cae al USUARIO CREADOR (user.real_name)
// del quote (o del pedido). El salesman mapeado SIGUE teniendo prioridad.

test('construirEntradaCotizacion: salesman sin match cae al usuario creador del quote (CRITERIO 1)', () => {
  // salesman 77 (no mapea) pero el quote lo creo "Alejandro Chavez" -> Alejandro Chávez.
  const quoteGen = { ...QUOTE, salesman: 77, user: { real_name: 'Alejandro Chavez' } };
  const entrada = construirEntradaCotizacion({
    pedido: PEDIDO, quote: quoteGen, debtor: DEBTOR, etapa: 'seguimiento', vendedores: VENDEDORES,
  });
  assert.equal(entrada.vendedor, 'Alejandro Chávez');
});

test('construirEntradaCotizacion: el salesman mapeado GANA sobre el usuario creador', () => {
  // salesman 8 (Oswaldo) mapea; aunque el quote lo creo Adrian, gana el salesman.
  const quoteAmbos = { ...QUOTE, salesman: 8, user: { real_name: 'Adrian Chavez' } };
  const entrada = construirEntradaCotizacion({
    pedido: PEDIDO, quote: quoteAmbos, debtor: DEBTOR, etapa: 'seguimiento', vendedores: VENDEDORES,
  });
  assert.equal(entrada.vendedor, 'Oswaldo Chávez');
});

test('construirEntradaCotizacion: salesman sin match cae al usuario del PEDIDO si el quote no lo trae', () => {
  // El quote no trae user; el pedido si (lo creo Adrian). Prioriza el creador del QUOTE,
  // pero al faltar cae al del pedido.
  const quoteGen = { ...QUOTE, salesman: 77, user: undefined };
  const pedidoConUser = { ...PEDIDO, user: { real_name: 'Adrian Chavez' } };
  const entrada = construirEntradaCotizacion({
    pedido: pedidoConUser, quote: quoteGen, debtor: DEBTOR, etapa: 'seguimiento', vendedores: VENDEDORES,
  });
  assert.equal(entrada.vendedor, 'Adrián Chávez');
});

test('construirEntradaCotizacion: ni salesman ni usuario mapean -> vendedor null (no inventa)', () => {
  const quoteGen = { ...QUOTE, salesman: 77, user: { real_name: 'Shopify' } };
  const entrada = construirEntradaCotizacion({
    pedido: PEDIDO, quote: quoteGen, debtor: DEBTOR, etapa: 'seguimiento', vendedores: VENDEDORES,
  });
  assert.equal(entrada.vendedor, null);
});

test('construirEntradaCotizacion: el RFC en data.cliente.rfc va en mayusculas (clave de sync #62)', () => {
  const debtorLower = { ...DEBTOR, tax_id: 'hegj800101ab1' };
  const entrada = construirEntradaCotizacion({
    pedido: PEDIDO, quote: QUOTE, debtor: debtorLower, etapa: 'seguimiento', vendedores: VENDEDORES,
  });
  assert.equal(entrada.data.cliente.rfc, 'HEGJ800101AB1');
});

// --- memoizarPorClave: cachea lecturas por clave para reducir el volumen (429) ---
// El backfill re-lee transacciones/pedidos POR candidato y muchos candidatos
// comparten el mismo debtor/RFC; sin cache se disparan ~840 lecturas en rafaga y
// Operam responde 429. memoizarPorClave envuelve un lector async y lo invoca UNA
// sola vez por clave (claveDe(args)).

test('memoizarPorClave: el lector subyacente se llama 1 vez por clave aunque se pida N veces', async () => {
  let llamadas = 0;
  const lector = async ({ rfc }) => { llamadas++; return `data-${rfc}`; };
  const memo = memoizarPorClave(lector, ({ rfc }) => rfc);
  // Dos candidatos del mismo debtor (mismo RFC) -> el lector se llama 1 vez.
  assert.equal(await memo({ rfc: 'AAA010101AB1' }), 'data-AAA010101AB1');
  assert.equal(await memo({ rfc: 'AAA010101AB1' }), 'data-AAA010101AB1');
  assert.equal(await memo({ rfc: 'AAA010101AB1' }), 'data-AAA010101AB1');
  assert.equal(llamadas, 1);
});

test('memoizarPorClave: claves distintas se leen por separado (una vez cada una)', async () => {
  let llamadas = 0;
  const lector = async ({ debtorNo }) => { llamadas++; return debtorNo; };
  const memo = memoizarPorClave(lector, ({ debtorNo }) => String(debtorNo));
  await memo({ debtorNo: 1 });
  await memo({ debtorNo: 2 });
  await memo({ debtorNo: 1 });
  await memo({ debtorNo: 2 });
  assert.equal(llamadas, 2);
});

test('memoizarPorClave: peticiones concurrentes de la misma clave comparten una sola lectura', async () => {
  // Sin esperar a que resuelva la primera, dos llamadas a la misma clave deben
  // compartir la MISMA promesa (no disparar dos lecturas en rafaga).
  let llamadas = 0;
  const lector = async (k) => { llamadas++; await Promise.resolve(); return k; };
  const memo = memoizarPorClave(lector, (k) => k);
  const [a, b] = await Promise.all([memo('x'), memo('x')]);
  assert.equal(a, 'x');
  assert.equal(b, 'x');
  assert.equal(llamadas, 1);
});

// --- planearBackfill: orquestacion pura del run con IO inyectada ---
// Enumera pedidos (paginado), filtra candidatos, deriva etapa, lee cabecera del
// quote + debtor y produce un PLAN: { importar: [entradas], skips: {...}, ... }.
// Sin Operam real (todas las lecturas son mocks inyectados).

// Helper: arma deps de planearBackfill con datos en memoria.
// CRITERIO 2 #76: el dep `etapaDe(op)` (devolvia un string de etapa) cambio a
// `obtenerHechos(op)` (devuelve los hechos crudos { pago, tienePedido,
// tieneRemision }). La etapa la deriva planearBackfill via etapaBackfill, y el gate
// de activo es !esCerrado(hechos). El helper acepta `hechos` (mapa por order_no);
// el default es un hecho vacio (sin remision ni pago) -> seguimiento, no cerrado.
function planDeps({ pedidos = [], debtors = {}, quotes = {}, hechos = {}, cotizaciones = [] } = {}) {
  const llamadas = { quotes: [], debtors: [] };
  // Pagina de 100: la primera pagina trae todo, las siguientes vacio.
  const listarPedidosPagina = async ({ skip }) => (skip === 0 ? pedidos : []);
  const obtenerDebtor = async (debtorNo) => { llamadas.debtors.push(String(debtorNo)); return debtors[String(debtorNo)] || null; };
  const obtenerQuote = async (folio) => { llamadas.quotes.push(String(folio)); return quotes[String(folio)] || null; };
  const HECHOS_VACIO = { pago: { allocated: 0, outstanding: 0, total: 0 }, tienePedido: false, tieneRemision: false };
  // obtenerHechos(op) simula hechosDeOperam: devuelve los hechos crudos por order_no.
  const obtenerHechos = async (op) => hechos[String(op?.data?.orderOperam)] ?? HECHOS_VACIO;
  return {
    llamadas,
    deps: {
      listarPedidosPagina,
      obtenerDebtor,
      obtenerQuote,
      obtenerHechos,
      listarCotizaciones: async () => cotizaciones,
      vendedores: VENDEDORES,
      desde: '2024-06-01', hasta: '2026-06-30',
    },
  };
}

// Atajos de hechos para los tests de planearBackfill (CRITERIO 2): la etapa ya no
// se inyecta como string; se inyectan los hechos crudos y planearBackfill deriva la
// etapa. Estos cubren los casos antes expresados como etapas literales.
const HECHOS_SALDO_PAGADO = { pago: { allocated: 100, outstanding: 0, total: 100 }, tienePedido: true, tieneRemision: false };
const HECHOS_SEGUIMIENTO = { pago: { allocated: 0, outstanding: 0, total: 0 }, tienePedido: false, tieneRemision: false };
const HECHOS_CERRADO = { pago: { allocated: 100, outstanding: 0, total: 100 }, tienePedido: true, tieneRemision: true };
const HECHOS_ENTREGADO_IMPAGO = { pago: { allocated: 30, outstanding: 70, total: 100 }, tienePedido: true, tieneRemision: true };
// CRITERIO 2 #76: muestra/cortesia $0 entregada (remision, sin pago). Con total<=0 del
// pedido basta la remision -> cerrada. Sin remision sigue activa (pendiente de envio).
const HECHOS_MUESTRA_ENTREGADA = { pago: { allocated: 0, outstanding: 0, total: 0 }, tienePedido: true, tieneRemision: true };

test('planearBackfill: importa un candidato activo con cabecera completa', async () => {
  const { deps } = planDeps({
    pedidos: [PEDIDO],
    debtors: { '394': DEBTOR },
    quotes: { '1141': QUOTE },
    hechos: { '7269': HECHOS_SALDO_PAGADO },
    cotizaciones: [],
  });
  const plan = await planearBackfill(deps);
  assert.equal(plan.importar.length, 1);
  const e = plan.importar[0];
  assert.equal(e.folioOperam, '1141');
  assert.equal(e.etapa, 'saldo_pagado');
  assert.equal(e.cliente, 'JUANA HERNANDEZ GARCIA');
  assert.equal(e.data.orderOperam, '7269');
  assert.equal(e.total, 16954);
  assert.equal(plan.skips.cerrado, 0);
  assert.equal(plan.skips.duplicado, 0);
  assert.equal(plan.skips.noCandidato, 0);
});

test('planearBackfill: SKIP cerrado (entregado Y pagado al 100% no se importa)', async () => {
  // CRITERIO 2: cerrado = tieneRemision Y pagado al 100%. Esos no se importan. Con
  // obtenerDetalle de entrega TOTAL (qty_sent>=quantity) la remision cierra normalmente.
  const { deps } = planDeps({
    pedidos: [PEDIDO],
    debtors: { '394': DEBTOR },
    quotes: { '1141': QUOTE },
    hechos: { '7269': HECHOS_CERRADO },
  });
  deps.obtenerDetalle = async () => ({ detalles: [{ quantity: '5', qty_sent: '5' }] }); // entrega total
  const plan = await planearBackfill(deps);
  assert.equal(plan.importar.length, 0);
  assert.equal(plan.skips.cerrado, 1);
});

test('planearBackfill: entrega PARCIAL + pagado NO se cierra (lee el detalle, #76 caso 6988)', async () => {
  // 6988: remision parcial (33 de 51 piezas) + pagado 100% se cerraba mal. Ahora
  // planearBackfill lee el detalle (obtenerDetalle); si la entrega no esta completa, la
  // remision no cuenta -> NO cerrado, sigue abierto. Pagado 100% + no entregado completo
  // -> saldo_pagado (no producto_entregado).
  const { deps } = planDeps({
    pedidos: [PEDIDO],
    debtors: { '394': DEBTOR },
    quotes: { '1141': QUOTE },
    hechos: { '7269': HECHOS_CERRADO }, // tieneRemision + pagado 100% -> seria cerrado
  });
  deps.obtenerDetalle = async (orderNo) => { assert.equal(String(orderNo), '7269'); return { detalles: [{ quantity: '10', qty_sent: '3' }] }; };
  const plan = await planearBackfill(deps);
  assert.equal(plan.skips.cerrado, 0);
  assert.equal(plan.importar.length, 1);
  assert.equal(plan.importar[0].etapa, 'saldo_pagado');
});

test('planearBackfill: SKIP pedido cancelado (order_no en cancelados, no se importa)', async () => {
  // La cancelacion no la expone la API; el set viene de data/cancelados.json (scraping
  // de la web legacy). Un pedido anulado en Operam no se importa, aunque sea candidato.
  const { deps } = planDeps({
    pedidos: [PEDIDO],
    debtors: { '394': DEBTOR },
    quotes: { '1141': QUOTE },
    hechos: { '7269': HECHOS_SALDO_PAGADO },
  });
  deps.cancelados = ['7269']; // PEDIDO.order_no
  const plan = await planearBackfill(deps);
  assert.equal(plan.importar.length, 0);
  assert.equal(plan.skips.cancelado, 1);
  // el folio queda en foliosConPedido para que la parte B tampoco lo re-evalue
  assert.equal(plan.foliosConPedido.has('1141'), true);
});

test('planearBackfill: entregado-IMPAGO se importa como producto_entregado + cobranza (#77)', async () => {
  // #77: entregado pero pagado parcial -> SE importa (no es cerrado). La etapa refleja
  // el CUMPLIMIENTO (producto_entregado, la remision manda); la cobranza pendiente NO
  // retrocede la etapa, se persiste en data.cobranza ('anticipo') para el badge.
  const { deps } = planDeps({
    pedidos: [PEDIDO],
    debtors: { '394': DEBTOR },
    quotes: { '1141': QUOTE },
    hechos: { '7269': HECHOS_ENTREGADO_IMPAGO },
  });
  const plan = await planearBackfill(deps);
  assert.equal(plan.importar.length, 1);
  assert.equal(plan.skips.cerrado, 0);
  assert.equal(plan.importar[0].etapa, 'producto_entregado');
  assert.equal(plan.importar[0].data.cobranza, 'anticipo');
});

test('planearBackfill: SKIP cerrado para muestra $0 entregada (CRITERIO 2: total<=0 + remision)', async () => {
  // Muestra/cortesia: el PEDIDO tiene total 0 y fue entregado (remision) -> cerrado,
  // no se importa. El gate usa el `total` del pedido del listado (num(pedido.total)).
  const muestra = { order_no: '7269', trans_no_from: '1141', debtor_no: '394', total: '0' };
  const { deps } = planDeps({
    pedidos: [muestra],
    debtors: { '394': DEBTOR },
    quotes: { '1141': { ...QUOTE, total: '0' } },
    hechos: { '7269': HECHOS_MUESTRA_ENTREGADA },
  });
  const plan = await planearBackfill(deps);
  assert.equal(plan.importar.length, 0);
  assert.equal(plan.skips.cerrado, 1);
});

test('planearBackfill: muestra $0 SIN entregar se importa (pendiente de envio, sigue activa)', async () => {
  // $0 sin remision: NO es cerrado -> se importa (muestra pendiente de envio).
  const muestra = { order_no: '7269', trans_no_from: '1141', debtor_no: '394', total: '0' };
  const HECHOS_MUESTRA_PENDIENTE = { pago: { allocated: 0, outstanding: 0, total: 0 }, tienePedido: true, tieneRemision: false };
  const { deps } = planDeps({
    pedidos: [muestra],
    debtors: { '394': DEBTOR },
    quotes: { '1141': { ...QUOTE, total: '0' } },
    hechos: { '7269': HECHOS_MUESTRA_PENDIENTE },
  });
  const plan = await planearBackfill(deps);
  assert.equal(plan.importar.length, 1);
  assert.equal(plan.skips.cerrado, 0);
  // $0 (muestra): la cobranza no aplica (no se factura) -> null, sin badge.
  assert.equal(plan.importar[0].data.cobranza, null);
});

test('planearBackfill: entregado SIN pago registrado -> producto_entregado + cobranza pendiente (#77, caso desfase)', async () => {
  // El caso tipico de #77: factura emitida (total>0) y producto entregado (remision),
  // pero el pago aun NO esta registrado (allocated 0 = desfase de la contadora). La
  // etapa refleja el cumplimiento (producto_entregado) y la cobranza queda 'pendiente'
  // -> el frontend pinta el badge "Pago sin registrar".
  const HECHOS_ENTREGADO_SINPAGO = { pago: { allocated: 0, outstanding: 100, total: 100 }, tienePedido: true, tieneRemision: true };
  const { deps } = planDeps({
    pedidos: [PEDIDO],
    debtors: { '394': DEBTOR },
    quotes: { '1141': QUOTE },
    hechos: { '7269': HECHOS_ENTREGADO_SINPAGO },
  });
  const plan = await planearBackfill(deps);
  assert.equal(plan.importar.length, 1);
  assert.equal(plan.importar[0].etapa, 'producto_entregado');
  assert.equal(plan.importar[0].data.cobranza, 'pendiente');
});

test('planearBackfill: SKIP duplicado (folioOperam ya existe en el store)', async () => {
  const { deps } = planDeps({
    pedidos: [PEDIDO],
    debtors: { '394': DEBTOR },
    quotes: { '1141': QUOTE },
    hechos: { '7269': HECHOS_SALDO_PAGADO },
    cotizaciones: [{ id: 5, folioOperam: '1141', data: {} }],
  });
  const plan = await planearBackfill(deps);
  assert.equal(plan.importar.length, 0);
  assert.equal(plan.skips.duplicado, 1);
});

test('planearBackfill: SKIP no-candidato (venta directa y pedido de prueba) sin leer quote', async () => {
  const ventaDirecta = { order_no: '8000', trans_no_from: '', debtor_no: '500' };
  const prueba = { order_no: '7270', trans_no_from: '1163', debtor_no: '394' };
  const { deps, llamadas } = planDeps({
    pedidos: [ventaDirecta, prueba, PEDIDO],
    debtors: { '394': DEBTOR },
    quotes: { '1141': QUOTE },
    hechos: { '7269': HECHOS_SEGUIMIENTO },
  });
  const plan = await planearBackfill(deps);
  assert.equal(plan.importar.length, 1);
  assert.equal(plan.skips.noCandidato, 2);
  // No debe leer el quote de los no-candidatos (read-only barato).
  assert.deepEqual(llamadas.quotes, ['1141']);
});

test('planearBackfill: SKIP otraSucursal (Shopify/Amazon/Bazaar no se importan, CRITERIO 1)', async () => {
  // Un pedido de Shopify (reference S..) es candidato pero NO es Tlapacoya -> skip.
  // Un pedido Tlapacoya (loc 40) si entra. Filtro por marcadores de canal, no cliente.
  const shopify = { order_no: '7300', trans_no_from: '1200', debtor_no: '394', reference: 'S1777', from_stk_loc: '30' };
  const tlapacoya = { order_no: '7269', trans_no_from: '1141', debtor_no: '394', from_stk_loc: '40', reference: '2604696' };
  const { deps } = planDeps({
    pedidos: [shopify, tlapacoya],
    debtors: { '394': DEBTOR },
    quotes: { '1141': QUOTE, '1200': { ...QUOTE, trans_no: '1200' } },
    hechos: { '7269': HECHOS_SEGUIMIENTO, '7300': HECHOS_SEGUIMIENTO },
  });
  const plan = await planearBackfill(deps);
  assert.equal(plan.importar.length, 1);
  assert.equal(plan.importar[0].folioOperam, '1141');
  assert.equal(plan.skips.otraSucursal, 1);
});

test('planearBackfill: pagina (varias paginas de pedidos)', async () => {
  // 100 candidatos en la primera pagina + 1 en la segunda: listarPedidosPagina
  // debe llamarse hasta agotar.
  const pagina1 = Array.from({ length: 100 }, (_, i) => ({
    order_no: String(9000 + i), trans_no_from: String(2000 + i), debtor_no: '394',
  }));
  const pagina2 = [{ order_no: '9100', trans_no_from: '2100', debtor_no: '394' }];
  const debtors = { '394': DEBTOR };
  const quotes = {};
  const HECHOS_VACIO = { pago: { allocated: 0, outstanding: 0, total: 0 }, tienePedido: false, tieneRemision: false };
  for (const p of [...pagina1, ...pagina2]) {
    quotes[p.trans_no_from] = { ...QUOTE, trans_no: p.trans_no_from };
  }
  const deps = {
    listarPedidosPagina: async ({ skip }) => (skip === 0 ? pagina1 : skip === 100 ? pagina2 : []),
    obtenerDebtor: async () => DEBTOR,
    obtenerQuote: async (folio) => quotes[String(folio)],
    obtenerHechos: async () => HECHOS_VACIO,
    listarCotizaciones: async () => [],
    vendedores: VENDEDORES,
    desde: '2024-06-01', hasta: '2026-06-30',
  };
  const plan = await planearBackfill(deps);
  assert.equal(plan.totalPedidos, 101);
  assert.equal(plan.importar.length, 101);
});

test('planearBackfill: expone foliosConPedido$ con TODOS los folios candidatos (incluso cerrados/duplicados)', async () => {
  // La parte B necesita el set de folios que SI se volvieron pedido para saltarlos.
  // Debe incluir candidatos cerrados (no importados) y duplicados, no solo los
  // importables; si no, la parte B re-importaria como seguimiento un folio ya
  // ordenado y cerrado.
  const activo = { order_no: '7269', trans_no_from: '1141', debtor_no: '394' };
  const cerrado = { order_no: '7280', trans_no_from: '1145', debtor_no: '394' };
  const ventaDirecta = { order_no: '8000', trans_no_from: '', debtor_no: '500' };
  const { deps } = planDeps({
    pedidos: [activo, cerrado, ventaDirecta],
    debtors: { '394': DEBTOR },
    quotes: { '1141': QUOTE, '1145': { ...QUOTE, trans_no: '1145' } },
    hechos: { '7269': HECHOS_SEGUIMIENTO, '7280': HECHOS_CERRADO },
  });
  const plan = await planearBackfill(deps);
  assert.ok(plan.foliosConPedido instanceof Set);
  assert.equal(plan.foliosConPedido.has('1141'), true);  // activo, importado
  assert.equal(plan.foliosConPedido.has('1145'), true);  // cerrado, NO importado pero SI fue pedido
  assert.equal(plan.foliosConPedido.has(''), false);     // venta directa no aporta folio
});

test('planearBackfill: dos candidatos con el MISMO folio en la corrida no se duplican entre si', async () => {
  // Idempotencia intra-corrida: aunque dos pedidos compartan trans_no_from (no
  // deberia pasar, pero defensivo), solo se importa uno.
  const p1 = { order_no: '7269', trans_no_from: '1141', debtor_no: '394' };
  const p2 = { order_no: '7269', trans_no_from: '1141', debtor_no: '394' };
  const { deps } = planDeps({
    pedidos: [p1, p2],
    debtors: { '394': DEBTOR },
    quotes: { '1141': QUOTE },
    hechos: { '7269': HECHOS_SEGUIMIENTO },
  });
  const plan = await planearBackfill(deps);
  assert.equal(plan.importar.length, 1);
  assert.equal(plan.skips.duplicado, 1);
});

// --- PARTE B: descubrirFolioMax (probe acotado hacia arriba) ---
// Descubre el folio mas alto de quotes probando GET /quote/{id} hacia arriba desde
// un inicio, hasta acumular una racha de N 404 consecutivos (techo). Acotado: nunca
// excede `limite` probes. Inyectable con un obtenerQuote mock (cero red).

test('descubrirFolioMax: encuentra el ultimo folio existente antes de la racha de 404', async () => {
  // Existen 1141..1145; de 1146 en adelante 404.
  const existentes = new Set(['1141', '1142', '1143', '1144', '1145']);
  const obtenerQuote = async (id) => (existentes.has(String(id)) ? { trans_no: String(id) } : null);
  const max = await descubrirFolioMax({ obtenerQuote, inicio: 1141, maxRacha: 3, limite: 100 });
  assert.equal(max, 1145);
});

test('descubrirFolioMax: salta huecos de 404 cortos (folios no contiguos)', async () => {
  // 1141, (1142 hueco), 1143, 1144; corta tras 3 404 seguidos (1145,1146,1147).
  const existentes = new Set(['1141', '1143', '1144']);
  const obtenerQuote = async (id) => (existentes.has(String(id)) ? { trans_no: String(id) } : null);
  const max = await descubrirFolioMax({ obtenerQuote, inicio: 1141, maxRacha: 3, limite: 100 });
  assert.equal(max, 1144);
});

test('descubrirFolioMax: respeta el limite de probes (acotado, no corre sin fin)', async () => {
  // Todos existen: sin limite caminaria sin fin. Con limite=5 desde 1000 -> 1004.
  const obtenerQuote = async (id) => ({ trans_no: String(id) });
  const max = await descubrirFolioMax({ obtenerQuote, inicio: 1000, maxRacha: 3, limite: 5 });
  assert.equal(max, 1004);
});

test('descubrirFolioMax: el inicio no existe y nada mas tampoco -> devuelve null', async () => {
  const obtenerQuote = async () => null;
  const max = await descubrirFolioMax({ obtenerQuote, inicio: 5000, maxRacha: 3, limite: 100 });
  assert.equal(max, null);
});

// --- PARTE B: planearBackfillSinPedido (id-walk de cotizaciones sin pedido) ---
// Camina folios de quotes de folioMax hacia abajo: importa las cotizaciones que
// NUNCA se volvieron pedido (no estan en foliosConPedido), en la ventana de los
// ultimos 6 meses (ord_date >= fechaCorte), en etapa `seguimiento`.

const QUOTE_B = {
  trans_no: '1150', debtor_no: '394', ord_date: '2026-05-01', delivery_date: '2026-05-31',
  cust_ref: 'Sin Pedido', total: '5800', salesman: 8,
};

function planBDeps({ quotes = {}, debtors = {}, foliosConPedido = [], cotizaciones = [], folioMax = 1155, fechaCorte = '2025-12-18' } = {}) {
  const llamadas = { quotes: [], debtors: [] };
  const obtenerQuote = async (id) => { llamadas.quotes.push(String(id)); return quotes[String(id)] || null; };
  const obtenerDebtor = async (no) => { llamadas.debtors.push(String(no)); return debtors[String(no)] || null; };
  return {
    llamadas,
    deps: {
      obtenerQuote,
      obtenerDebtor,
      foliosConPedido: new Set(foliosConPedido.map(String)),
      listarCotizaciones: async () => cotizaciones,
      vendedores: VENDEDORES,
      folioMax,
      fechaCorte,
    },
  };
}

test('planearBackfillSinPedido: importa un quote sin pedido en la ventana, etapa seguimiento', async () => {
  const { deps } = planBDeps({
    quotes: { '1150': QUOTE_B },
    debtors: { '394': DEBTOR },
    folioMax: 1150,
  });
  const plan = await planearBackfillSinPedido(deps);
  assert.equal(plan.importar.length, 1);
  const e = plan.importar[0];
  assert.equal(e.folioOperam, '1150');
  assert.equal(e.etapa, 'seguimiento');
  assert.equal(e.cliente, 'JUANA HERNANDEZ GARCIA');
  assert.equal(e.data.cliente.rfc, 'HEGJ800101AB1');
  assert.equal(e.data.orderOperam, null);   // nunca fue pedido
  assert.equal(e.data.backfill, true);
});

test('planearBackfillSinPedido: SALTA el folio que SI se volvio pedido (entro por parte A)', async () => {
  const { deps } = planBDeps({
    quotes: { '1150': QUOTE_B },
    debtors: { '394': DEBTOR },
    foliosConPedido: ['1150'],
    folioMax: 1150,
  });
  const plan = await planearBackfillSinPedido(deps);
  assert.equal(plan.importar.length, 0);
  assert.equal(plan.skips.conPedido, 1);
});

test('planearBackfillSinPedido: SALTA un quote cancelado (folio en cancelados)', async () => {
  const { deps } = planBDeps({
    quotes: { '1150': QUOTE_B },
    debtors: { '394': DEBTOR },
    folioMax: 1150,
  });
  deps.cancelados = ['1150']; // quote anulado en Operam
  const plan = await planearBackfillSinPedido(deps);
  assert.equal(plan.importar.length, 0);
  assert.equal(plan.skips.cancelado, 1);
});

test('planearBackfillSinPedido: SALTA un folio 404 (inexistente/anulado) y sigue', async () => {
  const { deps, llamadas } = planBDeps({
    quotes: { '1150': QUOTE_B },   // 1151..1153 no existen
    debtors: { '394': DEBTOR },
    folioMax: 1153,
  });
  // maxRachaVacia=5 corta a los 5 404 seguidos: tras 1150 baja 1149..1145 y detiene.
  deps.maxRachaVacia = 5;
  const plan = await planearBackfillSinPedido(deps);
  assert.equal(plan.importar.length, 1);
  assert.equal(plan.importar[0].folioOperam, '1150');
  // Lee 1153,1152,1151 (404), 1150 (existe), luego 1149..1145 (5 404) -> detiene.
  assert.deepEqual(llamadas.quotes, ['1153', '1152', '1151', '1150', '1149', '1148', '1147', '1146', '1145']);
});

test('planearBackfillSinPedido: una racha larga de 404 hacia abajo DETIENE el walk (acota volumen)', async () => {
  // folioMax muy alto sobre un hueco de 404: sin el techo de racha el walk bajaria
  // hasta folioMin probando cientos de 404 (volumen -> 429). maxRachaVacia lo corta
  // a los 10 404 seguidos -> 10 GET y para (no llega al 1150 que esta mas abajo).
  const { deps, llamadas } = planBDeps({
    quotes: { '1150': QUOTE_B },
    debtors: { '394': DEBTOR },
    folioMax: 1200,
  });
  deps.maxRachaVacia = 10;
  const plan = await planearBackfillSinPedido(deps);
  assert.equal(llamadas.quotes.length, 10, 'corta a los 10 404 seguidos, no baja hasta folioMin');
  assert.equal(plan.importar.length, 0, 'el 1150 queda por debajo de la racha -> no se alcanza');
});

test('planearBackfillSinPedido: DETIENE el walk cuando ord_date < fechaCorte (fuera de ventana)', async () => {
  const viejo = { ...QUOTE_B, trans_no: '1149', ord_date: '2025-01-10' }; // anterior al corte
  const { deps, llamadas } = planBDeps({
    quotes: { '1150': QUOTE_B, '1149': viejo },
    debtors: { '394': DEBTOR },
    folioMax: 1150,
    fechaCorte: '2025-12-18',
  });
  const plan = await planearBackfillSinPedido(deps);
  // 1150 entra; 1149 es viejo -> DETIENE (no lee 1148 hacia abajo).
  assert.equal(plan.importar.length, 1);
  assert.deepEqual(llamadas.quotes, ['1150', '1149']);
});

test('planearBackfillSinPedido: SALTA folios de prueba (1157, 1159-1163) y debtors 14/1', async () => {
  const prueba1 = { ...QUOTE_B, trans_no: '1157' };
  const prueba2 = { ...QUOTE_B, trans_no: '1160', debtor_no: '14' };
  const { deps } = planBDeps({
    quotes: { '1157': prueba1, '1160': prueba2, '1150': QUOTE_B },
    debtors: { '394': DEBTOR, '14': { debtor_no: '14', CustName: 'PUBLICO EN GENERAL', tax_id: 'XAXX010101000', curr_code: 'MXN' } },
    folioMax: 1160,
  });
  const plan = await planearBackfillSinPedido(deps);
  // Solo 1150 importa; 1157 (folio prueba) y 1160 (debtor 14) se saltan.
  assert.equal(plan.importar.length, 1);
  assert.equal(plan.importar[0].folioOperam, '1150');
});

test('planearBackfillSinPedido: SALTA folio ya existente en el store (idempotente)', async () => {
  const { deps } = planBDeps({
    quotes: { '1150': QUOTE_B },
    debtors: { '394': DEBTOR },
    cotizaciones: [{ id: 9, folioOperam: '1150', data: {} }],
    folioMax: 1150,
  });
  const plan = await planearBackfillSinPedido(deps);
  assert.equal(plan.importar.length, 0);
  assert.equal(plan.skips.duplicado, 1);
});

test('planearBackfillSinPedido: SALTA un quote de otra sucursal (Shopify/Amazon/Bazaar, CRITERIO 1)', async () => {
  // El quote tambien lleva los marcadores de canal (reference/from_stk_loc/user). Un
  // quote sin pedido de Shopify (reference S..) no es Tlapacoya -> skip otraSucursal.
  const shopify = { ...QUOTE_B, trans_no: '1151', reference: 'S1781' };
  const { deps } = planBDeps({
    quotes: { '1151': shopify, '1150': QUOTE_B },
    debtors: { '394': DEBTOR },
    folioMax: 1151,
  });
  const plan = await planearBackfillSinPedido(deps);
  // Solo 1150 (Tlapacoya) importa; 1151 (Shopify) se salta.
  assert.equal(plan.importar.length, 1);
  assert.equal(plan.importar[0].folioOperam, '1150');
  assert.equal(plan.skips.otraSucursal, 1);
});

// --- Idempotencia end-to-end contra el store JSON real (sin DATABASE_URL) ---
// Crear con `crear` + `setFolioOperam`, releer con `listar` y comprobar que
// folioYaExiste lo reconoce: re-correr el backfill no duplicaria.

const __dirname = dirname(fileURLToPath(import.meta.url));
const COTS_PATH = join(__dirname, '..', 'data', 'cotizaciones.json');
function readCots() {
  if (!existsSync(COTS_PATH)) return [];
  return JSON.parse(readFileSync(COTS_PATH, 'utf8'));
}
function writeCots(data) { writeFileSync(COTS_PATH, JSON.stringify(data, null, 2)); }

let savedCots;
before(() => { savedCots = readCots(); });
after(() => { writeCots(savedCots); });

test('idempotencia: tras crear+setFolioOperam, folioYaExiste lo reconoce en listar()', async () => {
  writeCots([]);
  const store = await import('../lib/cotizaciones-store.js');
  const entrada = construirEntradaCotizacion({
    pedido: PEDIDO, quote: QUOTE, debtor: DEBTOR, etapa: 'saldo_pagado', vendedores: VENDEDORES,
  });
  const id = await store.crear(entrada);
  await store.setFolioOperam(id, entrada.folioOperam);

  const cots = await store.listar();
  // Segunda pasada del backfill ve el folio ya presente -> SKIP (no recrea).
  assert.equal(folioYaExiste(cots, '1141'), true);
  // El folio que aun no existe si pasaria.
  assert.equal(folioYaExiste(cots, '1142'), false);
});

// Aplicacion del PLAN al store, end-to-end (mismo loop que el script con --apply):
// crear -> setFolioOperam -> cambiarEtapa. Re-correr no duplica (idempotencia por
// folioOperam via planearBackfill, que relee el store).
async function aplicarPlan(store, plan) {
  let creadas = 0;
  for (const e of plan.importar) {
    const id = await store.crear(e);
    await store.setFolioOperam(id, e.folioOperam);
    await store.cambiarEtapa(id, e.etapa, { tipo: 'backfill', etapa: e.etapa, fecha: '2026-06-18T00:00:00Z' });
    creadas++;
  }
  return creadas;
}

test('apply end-to-end: crea la cotizacion con folio+etapa y re-correr NO duplica', async () => {
  writeCots([]);
  const store = await import('../lib/cotizaciones-store.js');
  const buildDeps = () => planDeps({
    pedidos: [PEDIDO],
    debtors: { '394': DEBTOR },
    quotes: { '1141': QUOTE },
    hechos: { '7269': HECHOS_SALDO_PAGADO },
  }).deps;
  // Deps reales para idempotencia: listarCotizaciones lee el store real.
  function depsConStore() {
    const d = buildDeps();
    d.listarCotizaciones = () => store.listar();
    return d;
  }

  // Primera corrida: plan importa 1, aplicar crea 1.
  const plan1 = await planearBackfill(depsConStore());
  assert.equal(plan1.importar.length, 1);
  assert.equal(await aplicarPlan(store, plan1), 1);

  const guardadas = await store.listar();
  const c = guardadas.find(x => String(x.folioOperam) === '1141');
  assert.ok(c, 'la cotizacion quedo persistida con su folio');
  assert.equal(c.cliente, 'JUANA HERNANDEZ GARCIA');
  assert.equal(c.etapa, 'saldo_pagado');
  assert.equal(c.data.orderOperam, '7269');
  assert.equal(c.data.backfill, true);

  // Segunda corrida: el folio ya existe -> plan vacio (SKIP duplicado), nada nuevo.
  const plan2 = await planearBackfill(depsConStore());
  assert.equal(plan2.importar.length, 0);
  assert.equal(plan2.skips.duplicado, 1);
  assert.equal(await aplicarPlan(store, plan2), 0);
  assert.equal((await store.listar()).filter(x => String(x.folioOperam) === '1141').length, 1);
});
