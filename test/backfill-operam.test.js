import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { leerArchivoSync, escribirArchivoSync } from '../lib/fs-reintento.js';

import { esCandidatoBackfill, esSucursalTlapacoya, esCerrado, etapaBackfill, mapearSalesman, mapearVendedorPorUsuario, construirEntradaCotizacion, subtotalDesdeTotal, folioYaExiste, planearBackfill, memoizarPorClave, descubrirFolioMax, planearBackfillSinPedido, entregaCompleta, DEBTORS_SOCIOS, FOLIOS_EXCLUIDOS_MANUAL, mapearPartidasQuote, esVarianteCerrada, pedidoQueCierra, VENTANA_VARIANTE_DIAS, BANDA_VARIANTE, GRACIA_VARIANTE_DIAS, MONTO_MINIMO_B } from '../lib/backfill-operam.mjs';
import * as backfillOperam from '../lib/backfill-operam.mjs';
// #127: la lista de debtors genericos vive en UN solo lugar (lib/deduplicacion.js);
// el backfill la consume por esDebtorGenerico en vez de tener su propia copia.
import { DEBTORS_GENERICOS } from '../lib/deduplicacion.js';

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

test('esCandidatoBackfill: excluye el debtor de prueba 1 (mostrador)', () => {
  assert.equal(esCandidatoBackfill({ order_no: '8102', trans_no_from: '1202', debtor_no: '1' }), false);
  assert.equal(esCandidatoBackfill({ order_no: '8103', trans_no_from: '1203', debtor_no: 1 }), false);
});

// El 14 (PUBLICO EN GENERAL) salio de DEBTORS_PRUEBA en #201: es cajon (factura
// global de bazar). El predicado ya no lo veta como prueba; el plan lo sigue
// excluyendo del backfill, pero por la rama esDebtorGenerico (skips.generico).
test('esCandidatoBackfill: el debtor 14 ya NO se veta como prueba (#201: es cajon)', () => {
  assert.equal(esCandidatoBackfill({ order_no: '8100', trans_no_from: '1200', debtor_no: '14' }), true);
  assert.equal(esCandidatoBackfill({ order_no: '8101', trans_no_from: '1201', debtor_no: 14 }), true);
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

test('planearBackfill: entregado-IMPAGO se importa como producto_entregado + pagoSinRegistrar (#77)', async () => {
  // #77: entregado pero pagado parcial -> SE importa (no es cerrado). La etapa refleja
  // el CUMPLIMIENTO (producto_entregado, la remision manda); la cobranza pendiente NO
  // retrocede la etapa: se marca en data.pagoSinRegistrar (la forma de #77 que quedo en
  // main) para que la tarjeta pinte el badge "Pago sin registrar".
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
  assert.equal(plan.importar[0].data.pagoSinRegistrar, true);
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
  // $0 sin entregar: sin remision no hay entrega que cobrar -> sin badge.
  assert.equal(plan.importar[0].data.pagoSinRegistrar, false);
});

test('planearBackfill: entregado SIN pago registrado -> producto_entregado + pagoSinRegistrar (#77, caso desfase)', async () => {
  // El caso tipico de #77: factura emitida (total>0) y producto entregado (remision),
  // pero el pago aun NO esta registrado (allocated 0 = desfase de la contadora). La
  // etapa refleja el cumplimiento (producto_entregado) y el pago queda marcado como no
  // registrado
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
  assert.equal(plan.importar[0].data.pagoSinRegistrar, true);
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

// El 14 dejo de ser debtor de prueba en #201: aqui se sigue saltando, pero por la
// rama de cajon generico (skips.generico), no como prueba.
test('planearBackfillSinPedido: SALTA folios de prueba (1157) y el debtor 14 como cajon', async () => {
  const prueba1 = { ...QUOTE_B, trans_no: '1157' };
  // 1156 NO esta en FOLIOS_PRUEBA: aqui lo que lo excluye es el debtor 14 (cajon).
  const cajon14 = { ...QUOTE_B, trans_no: '1156', debtor_no: '14' };
  const { deps } = planBDeps({
    quotes: { '1157': prueba1, '1156': cajon14, '1150': QUOTE_B },
    debtors: { '394': DEBTOR, '14': { debtor_no: '14', CustName: 'PUBLICO EN GENERAL', tax_id: 'XAXX010101000', curr_code: 'MXN' } },
    folioMax: 1160,
  });
  const plan = await planearBackfillSinPedido(deps);
  // Solo 1150 importa; 1157 (folio prueba) y 1156 (debtor 14, cajon) se saltan.
  assert.equal(plan.importar.length, 1);
  assert.equal(plan.importar[0].folioOperam, '1150');
  assert.equal(plan.skips.generico, 1);
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
  return JSON.parse(leerArchivoSync(COTS_PATH));
}
// OneDrive toma locks EBUSY sobre data/*.json mientras sincroniza (#117): todo acceso
// del test pasa por lib/fs-reintento.js, nunca por fs directo.
function writeCots(data) { escribirArchivoSync(COTS_PATH, JSON.stringify(data, null, 2)); }

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

// === Decision 2026-07-29 (#76): el GENERICO TIENDAS DIGITALES NO se importa ===
// El debtor 184 es el cliente generico de las tiendas digitales: sus cotizaciones no
// son oportunidades de mayoreo con contraparte nombrada, son ventas digitales sueltas
// agrupadas bajo un RFC generico. Adrian decidio DIFERIRLAS al issue #118, que las
// rescatara como PROSPECTOS (con contactoEntrega + customer_ref del quote), no como
// cotizaciones del pipeline. Contador propio (skips.generico) para no confundirlas en
// el dry-run con las de prueba ni con las de otra sucursal.

test('#118: planearBackfill SKIP generico -- el debtor 184 no se importa (parte A)', async () => {
  const pedidoGenerico = { ...PEDIDO, debtor_no: '184' };
  const { deps } = planDeps({
    pedidos: [pedidoGenerico],
    debtors: { '184': { debtor_no: '184', CustName: 'GENERICO TIENDAS DIGITALES', tax_id: 'XAXX010101000', curr_code: 'MXN' } },
    quotes: { '1141': QUOTE },
    hechos: { '7269': HECHOS_SALDO_PAGADO },
  });
  const plan = await planearBackfill(deps);
  assert.equal(plan.importar.length, 0);
  assert.equal(plan.skips.generico, 1);
  // No se confunde con los otros skips: el pedido es candidato valido en todo lo demas.
  assert.equal(plan.skips.noCandidato, 0);
  assert.equal(plan.skips.otraSucursal, 0);
  assert.equal(plan.skips.cerrado, 0);
  // El folio SI queda en foliosConPedido: nacio de una cotizacion ya ordenada, asi que
  // la parte B tampoco debe re-evaluarlo como seguimiento vivo.
  assert.equal(plan.foliosConPedido.has('1141'), true);
});

test('#118: planearBackfill SKIP generico -- otro debtor generico (256) tambien se excluye (parte A)', async () => {
  // DEBTORS_GENERICOS es un SET de 5 ids (revision Adrian 2026-07-30), no solo el 184.
  const pedidoGenerico = { ...PEDIDO, debtor_no: '256' };
  const { deps } = planDeps({
    pedidos: [pedidoGenerico],
    debtors: { '256': { debtor_no: '256', CustName: 'GENERICO DIGITAL USD', tax_id: 'XAXX010101000', curr_code: 'USD' } },
    quotes: { '1141': QUOTE },
    hechos: { '7269': HECHOS_SALDO_PAGADO },
  });
  const plan = await planearBackfill(deps);
  assert.equal(plan.importar.length, 0);
  assert.equal(plan.skips.generico, 1);
});

test('#118: planearBackfillSinPedido SKIP generico -- el debtor 184 no se importa (parte B)', async () => {
  const { deps } = planBDeps({
    quotes: { '1150': { ...QUOTE_B, debtor_no: '184' } },
    debtors: { '184': { debtor_no: '184', CustName: 'GENERICO TIENDAS DIGITALES', tax_id: 'XAXX010101000', curr_code: 'MXN' } },
    folioMax: 1150,
  });
  const plan = await planearBackfillSinPedido(deps);
  assert.equal(plan.importar.length, 0);
  assert.equal(plan.skips.generico, 1);
  assert.equal(plan.skips.prueba, 0);
  assert.equal(plan.skips.otraSucursal, 0);
});

test('#118: planearBackfillSinPedido SKIP generico -- otro debtor generico (256) tambien se excluye (parte B)', async () => {
  const { deps } = planBDeps({
    quotes: { '1150': { ...QUOTE_B, debtor_no: '256' } },
    debtors: { '256': { debtor_no: '256', CustName: 'GENERICO DIGITAL USD', tax_id: 'XAXX010101000', curr_code: 'USD' } },
    folioMax: 1150,
  });
  const plan = await planearBackfillSinPedido(deps);
  assert.equal(plan.importar.length, 0);
  assert.equal(plan.skips.generico, 1);
});

test('#118: un debtor nombrado sigue importandose (la exclusion es SOLO de DEBTORS_GENERICOS)', async () => {
  const { deps } = planBDeps({
    quotes: { '1150': QUOTE_B },
    debtors: { '394': DEBTOR },
    folioMax: 1150,
  });
  const plan = await planearBackfillSinPedido(deps);
  assert.equal(plan.importar.length, 1);
  assert.equal(plan.skips.generico, 0);
});

// === Decision 2026-07-30 (#76): socios como CLIENTE se excluyen (son vendedores) ===
// Adrian, Alejandro y Oswaldo (via debtor 9/15/132, revision en vivo) figuran tambien
// como cliente en Operam; sus cotizaciones "personales" son pruebas del cotizador, no
// oportunidades reales. Se excluyen igual que los genericos, con contador propio.

test('socio: planearBackfill SKIP socio -- debtor 15 (Adrian Chavez Rosete) no se importa (parte A)', async () => {
  const pedidoSocio = { ...PEDIDO, debtor_no: '15' };
  const { deps } = planDeps({
    pedidos: [pedidoSocio],
    debtors: { '15': { debtor_no: '15', CustName: 'ADRIAN CHAVEZ ROSETE', tax_id: 'XAXX010101000', curr_code: 'MXN' } },
    quotes: { '1141': QUOTE },
    hechos: { '7269': HECHOS_SALDO_PAGADO },
  });
  const plan = await planearBackfill(deps);
  assert.equal(plan.importar.length, 0);
  assert.equal(plan.skips.socio, 1);
  assert.equal(plan.skips.generico, 0);
  // El folio SI queda en foliosConPedido, mismo patron que generico/cancelado.
  assert.equal(plan.foliosConPedido.has('1141'), true);
});

test('socio: planearBackfill SKIP socio -- debtor 9 y 132 tambien excluidos (parte A)', async () => {
  const pedidoRaul = { order_no: '7300', trans_no_from: '1200', debtor_no: '9' };
  const pedidoOswaldo = { order_no: '7301', trans_no_from: '1201', debtor_no: '132' };
  const { deps } = planDeps({
    pedidos: [pedidoRaul, pedidoOswaldo],
    debtors: {
      '9': { debtor_no: '9', CustName: 'RAUL ALEJANDRO CHAVEZ ROSETE', tax_id: 'XAXX010101000', curr_code: 'MXN' },
      '132': { debtor_no: '132', CustName: 'OSWALDO CHAVEZ ROSETE', tax_id: 'XAXX010101000', curr_code: 'MXN' },
    },
    quotes: { '1200': { ...QUOTE, trans_no: '1200' }, '1201': { ...QUOTE, trans_no: '1201' } },
    hechos: { '7300': HECHOS_SEGUIMIENTO, '7301': HECHOS_SEGUIMIENTO },
  });
  const plan = await planearBackfill(deps);
  assert.equal(plan.importar.length, 0);
  assert.equal(plan.skips.socio, 2);
});

test('socio: planearBackfillSinPedido SKIP socio -- debtor 15 no se importa (parte B)', async () => {
  const { deps } = planBDeps({
    quotes: { '1150': { ...QUOTE_B, debtor_no: '15' } },
    debtors: { '15': { debtor_no: '15', CustName: 'ADRIAN CHAVEZ ROSETE', tax_id: 'XAXX010101000', curr_code: 'MXN' } },
    folioMax: 1150,
  });
  const plan = await planearBackfillSinPedido(deps);
  assert.equal(plan.importar.length, 0);
  assert.equal(plan.skips.socio, 1);
  assert.equal(plan.skips.generico, 0);
  assert.equal(plan.skips.prueba, 0);
});

// === Decision 2026-07-30 (#76): folios excluidos manualmente por Adrian ===
// FOLIOS_EXCLUIDOS_MANUAL cubre quotes de prueba/uso interno sin patron programatico
// (1195 "PRUEBA POST-FIX VIGENCIA 106 - BORRAR"; 1189/1196 cotizaciones $0 sin
// contexto). Aplica en ambas partes.

test('excluidoManual: planearBackfill SKIP excluido manual -- folio 1195 no se importa (parte A)', async () => {
  const pedidoExcluido = { ...PEDIDO, trans_no_from: '1195' };
  const { deps } = planDeps({
    pedidos: [pedidoExcluido],
    debtors: { '394': DEBTOR },
    quotes: { '1195': { ...QUOTE, trans_no: '1195' } },
    hechos: { '7269': HECHOS_SALDO_PAGADO },
  });
  const plan = await planearBackfill(deps);
  assert.equal(plan.importar.length, 0);
  assert.equal(plan.skips.excluidoManual, 1);
  // El folio SI queda en foliosConPedido (mismo patron que generico/socio/cancelado).
  assert.equal(plan.foliosConPedido.has('1195'), true);
});

test('excluidoManual: planearBackfillSinPedido SKIP excluido manual -- folio 1196 no se importa (parte B)', async () => {
  const { deps } = planBDeps({
    quotes: { '1196': { ...QUOTE_B, trans_no: '1196' } },
    debtors: { '394': DEBTOR },
    folioMax: 1196,
  });
  const plan = await planearBackfillSinPedido(deps);
  assert.equal(plan.importar.length, 0);
  assert.equal(plan.skips.excluidoManual, 1);
});

test('excluidoManual: planearBackfill SKIP excluido manual -- folio 1129 no se importa (re-emision de FORTMCK19-16 PERLA)', async () => {
  // Adrian confirmo que el cliente ya cerro con la 1084 (excluida por heuristica); la
  // 1129 es una re-emision del mismo monto -- el pedido quedo fuera de la ventana
  // respecto a ESTA re-emision, asi que se excluye manualmente.
  const pedidoExcluido = { ...PEDIDO, trans_no_from: '1129' };
  const { deps } = planDeps({
    pedidos: [pedidoExcluido],
    debtors: { '394': DEBTOR },
    quotes: { '1129': { ...QUOTE, trans_no: '1129' } },
    hechos: { '7269': HECHOS_SALDO_PAGADO },
  });
  const plan = await planearBackfill(deps);
  assert.equal(plan.importar.length, 0);
  assert.equal(plan.skips.excluidoManual, 1);
});

test('constantes decididas: DEBTORS_GENERICOS (fuente unica en deduplicacion.js) mas DEBTORS_SOCIOS y FOLIOS_EXCLUIDOS_MANUAL (propias del backfill)', () => {
  // #127: los genericos se afirman contra la FUENTE UNICA (lib/deduplicacion.js, numeros).
  // #201: se agrego 14 (PUBLICO EN GENERAL, factura global de bazar).
  assert.deepEqual([...DEBTORS_GENERICOS].sort(), [14, 143, 183, 184, 256, 449]);
  assert.deepEqual([...DEBTORS_SOCIOS].sort(), ['132', '15', '9']);
  assert.deepEqual([...FOLIOS_EXCLUIDOS_MANUAL].sort(), ['1129', '1189', '1195', '1196']);
});

test('#127: el backfill NO define su propia copia de DEBTORS_GENERICOS', () => {
  // Dos listas de los mismos ids es la bomba que cerro #127: agregar un debtor-cajon en
  // Operam y actualizar solo una silenciaria el filtro del otro lado.
  assert.equal(backfillOperam.DEBTORS_GENERICOS, undefined);
});

// === Decision 2026-07-29 (#76): las cotizaciones importadas llevan PARTIDAS ===
// Antes el backfill traia solo la cabecera del quote: la tarjeta se veia bien pero
// GET /api/cotizacion/pdf/:id regeneraba un documento SIN renglones (los generadores
// leen data.items). Como el quote ya se lee entero con obtenerQuote (detalles[] viene
// en la misma respuesta, sin llamadas extra a Operam), se mapean a la MISMA forma que
// produce el cotizador normal: { codigo, descripcion, cantidad, unidad, precio, descuento }.
// Los nombres de campo del detalle se leen con ALIAS (la API v3 no los tiene
// documentados en el repo); el dry-run en vivo confirma cual llega.

test('#76 mapearPartidasQuote: mapea el detalle del quote a la forma de data.items', () => {
  const items = mapearPartidasQuote([
    { stock_id: 'SA08A3001112', stock_id_text: 'Cacerola 8 cm blanca', quantity: '12', unit_price: '85.5', discount_percent: '10' },
  ]);
  assert.deepEqual(items, [
    { codigo: 'SA08A3001112', descripcion: 'Cacerola 8 cm blanca', cantidad: 12, unidad: 'pza', precio: 85.5, descuento: 10 },
  ]);
});

// El lineTotal que imprimen pdf-generator y html-generator es
// cantidad * precio * (1 - descuento/100): si cantidad o precio llegaran como STRING,
// la multiplicacion funcionaria por coercion pero la suma de piezas
// (items.reduce((s,i) => s + i.cantidad)) concatenaria texto. Por eso se numerizan.
test('#76 mapearPartidasQuote: cantidad, precio y descuento salen como numeros', () => {
  const [i] = mapearPartidasQuote([{ stock_id: 'X', quantity: '3', unit_price: '10', discount_percent: '0' }]);
  assert.strictEqual(i.cantidad, 3);
  assert.strictEqual(i.precio, 10);
  assert.strictEqual(i.descuento, 0);
});

test('#76 mapearPartidasQuote: tolera los alias de nombre de campo de la API', () => {
  const [i] = mapearPartidasQuote([{ stock_id: 'X', description: 'Desc alterna', qty: 2, price: 50, Disc: 5 }]);
  assert.equal(i.descripcion, 'Desc alterna');
  assert.equal(i.cantidad, 2);
  assert.equal(i.precio, 50);
  assert.equal(i.descuento, 5);
});

// Defensivo: un quote sin detalle (o con basura) NO debe tumbar el backfill de las
// otras cotizaciones. Se importa con items vacio -- el documento sale sin renglones,
// que es exactamente lo que pasaba antes de esta decision.
test('#76 mapearPartidasQuote: detalle ausente, vacio o invalido -> []', () => {
  assert.deepEqual(mapearPartidasQuote(undefined), []);
  assert.deepEqual(mapearPartidasQuote(null), []);
  assert.deepEqual(mapearPartidasQuote([]), []);
  assert.deepEqual(mapearPartidasQuote('no es lista'), []);
  assert.deepEqual(mapearPartidasQuote([null]), []);
});

test('#76 mapearPartidasQuote: campos ausentes caen a valores neutros, sin NaN', () => {
  const [i] = mapearPartidasQuote([{ stock_id: 'SOLO-SKU' }]);
  assert.deepEqual(i, { codigo: 'SOLO-SKU', descripcion: '', cantidad: 0, unidad: 'pza', precio: 0, descuento: 0 });
});

// Las partidas de ENVIO (SKU de flete 251021001 local / 251021002 foraneo, #68) son
// partidas NORMALES del quote. Se mapean tal cual, CONSERVANDO su stock_id real: no se
// traducen al codigo 'ENVIO' del carrito ni se rellena data.envio. Razon: el camino de
// vuelta (armarContenidoQuote) re-deriva el SKU de flete por el CP de entrega, y una
// entrada del backfill NO tiene cpEntrega -- traducir a 'ENVIO' haria que un re-envio a
// Operam cayera al SKU foraneo por default aunque el original fuera local. Conservar el
// SKU real es fiel al documento y no inventa estructura.
test('#76 mapearPartidasQuote: la partida de flete se conserva como item normal con su SKU real', () => {
  const items = mapearPartidasQuote([
    { stock_id: '251021001', stock_id_text: 'Envio Economico FedEx Ground', quantity: 1, unit_price: 350 },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].codigo, '251021001');
  assert.equal(items[0].descripcion, 'Envio Economico FedEx Ground');
  assert.equal(items[0].precio, 350);
});

test('#76 construirEntradaCotizacion: persiste las partidas del quote en data.items', () => {
  const quoteConDetalle = {
    ...QUOTE,
    detalles: [{ stock_id: 'SA08A3001112', stock_id_text: 'Cacerola', quantity: '2', unit_price: '100', discount_percent: '0' }],
  };
  const e = construirEntradaCotizacion({
    pedido: PEDIDO, quote: quoteConDetalle, debtor: DEBTOR, etapa: 'saldo_pagado', vendedores: VENDEDORES,
  });
  assert.equal(e.data.items.length, 1);
  assert.equal(e.data.items[0].codigo, 'SA08A3001112');
  assert.equal(e.data.items[0].cantidad, 2);
});

test('#76 construirEntradaCotizacion: sin detalle en el quote, data.items es [] (no undefined)', () => {
  const e = construirEntradaCotizacion({
    pedido: PEDIDO, quote: QUOTE, debtor: DEBTOR, etapa: 'saldo_pagado', vendedores: VENDEDORES,
  });
  assert.deepEqual(e.data.items, []);
});

// --- Variante cerrada (#76, decision Adrian 2026-07-30) --------------------------
// Los clientes piden 2-3 cotizaciones y autorizan UNA, a veces generando el pedido
// DIRECTO (sin trans_no_from, o con otras piezas). Las cotizaciones hermanas quedan
// "vivas" en la parte B aunque la compra ya cerro. La heuristica: un pedido del MISMO
// cliente, cercano en fecha y de monto COMPARABLE, cierra a la cotizacion. El caso
// MOTOBLOCK marca el limite inferior: un pedido de muestras de $598 NO puede matar una
// cotizacion real de $182,093.

test('esVarianteCerrada: variante exacta (monto ~igual, +-5%) se excluye', () => {
  const quote = { trans_no: '1300', ord_date: '2026-05-10', total: '100000' };
  const pedidos = [{ order_no: '7300', ord_date: '2026-05-12', total: '105000' }];
  assert.equal(esVarianteCerrada(quote, pedidos), true);
});

test('esVarianteCerrada: pedido al 40% del monto (250 -> 100 piezas) se excluye', () => {
  // Autorizaron menos piezas de las cotizadas: la compra cerro igual.
  const quote = { trans_no: '1301', ord_date: '2026-05-10', total: '100000' };
  const pedidos = [{ order_no: '7301', ord_date: '2026-05-20', total: '40000' }];
  assert.equal(esVarianteCerrada(quote, pedidos), true);
});

test('esVarianteCerrada: MOTOBLOCK -- pedido de muestras al 0.3% NO excluye la cotizacion grande', () => {
  // El denominador es el monto MAYOR entre cotizacion y pedido (revision 2026-07-31);
  // aqui la cotizacion YA es el monto mayor, asi que el resultado no cambia con el
  // ajuste: dif 99.7% relativa al monto mayor (182093) sigue fuera de la banda.
  const quote = { trans_no: '1302', ord_date: '2026-05-10', total: '182093' };
  const pedidos = [{ order_no: '7302', ord_date: '2026-05-15', total: '598' }];
  assert.equal(esVarianteCerrada(quote, pedidos), false);
});

test('esVarianteCerrada: pedido MAYOR que la cotizacion cierra si esta dentro del 75% del monto MAYOR (folio 1194)', () => {
  // Revision en vivo de Adrian 2026-07-31: cotizacion $6,769.76 vs pedido $13,300.56
  // (dif 96% relativa al monto de la cotizacion -- NO cerraba con el denominador viejo;
  // dif 49% relativa al monto MAYOR -- SI cierra). Para el negocio esa cotizacion es
  // variante muerta: el denominador de la banda pasa a ser el monto MAYOR entre ambos.
  const quote = { trans_no: '1194', ord_date: '2026-05-10', total: '6769.76' };
  const pedidos = [{ order_no: '7500', ord_date: '2026-05-15', total: '13300.56' }];
  assert.equal(esVarianteCerrada(quote, pedidos), true);
});

test('esVarianteCerrada: pedido fuera de la ventana de 31 dias NO excluye', () => {
  const quote = { trans_no: '1303', ord_date: '2026-05-10', total: '100000' };
  const pedidos = [{ order_no: '7303', ord_date: '2026-07-01', total: '100000' }];
  assert.equal(esVarianteCerrada(quote, pedidos), false);
  // ...y tampoco un pedido MUY anterior (la ventana es de valor absoluto).
  assert.equal(esVarianteCerrada(quote, [{ order_no: '7304', ord_date: '2026-01-01', total: '100000' }]), false);
});

test('esVarianteCerrada: la ventana es ASIMETRICA -- un pedido ANTERIOR lejano NO cierra (causalidad)', () => {
  // Primero se cotiza y luego se autoriza: un pedido de 20 dias ANTES no puede haber
  // nacido de esta cotizacion. Protege el REORDEN (el cliente que vuelve a cotizar
  // despues de una compra previa sigue siendo una oportunidad viva).
  const quote = { trans_no: '1304', ord_date: '2026-05-10', total: '100000' };
  assert.equal(esVarianteCerrada(quote, [{ order_no: '7305', ord_date: '2026-04-20', total: '90000' }]), false);
});

test('esVarianteCerrada: gracia de 3 dias hacia atras (desfase de captura) SI cierra', () => {
  const quote = { trans_no: '1304b', ord_date: '2026-05-10', total: '100000' };
  // 2 dias antes: cabe en la gracia -> cierra.
  assert.equal(esVarianteCerrada(quote, [{ order_no: '7305', ord_date: '2026-05-08', total: '90000' }]), true);
  // 4 dias antes: fuera de la gracia -> no cierra.
  assert.equal(esVarianteCerrada(quote, [{ order_no: '7306', ord_date: '2026-05-06', total: '90000' }]), false);
});

test('constantes exportadas: la gracia hacia atras es de 3 dias', () => {
  assert.equal(GRACIA_VARIANTE_DIAS, 3);
});

test('esVarianteCerrada: cotizacion con total <= 0 -- la heuristica NO aplica', () => {
  const pedidos = [{ order_no: '7306', ord_date: '2026-05-10', total: '5000' }];
  assert.equal(esVarianteCerrada({ trans_no: '1305', ord_date: '2026-05-10', total: '0' }, pedidos), false);
  assert.equal(esVarianteCerrada({ trans_no: '1306', ord_date: '2026-05-10', total: null }, pedidos), false);
});

test('esVarianteCerrada: un pedido de $0 NO matchea nunca (no cierra nada)', () => {
  const quote = { trans_no: '1307', ord_date: '2026-05-10', total: '100' };
  assert.equal(esVarianteCerrada(quote, [{ order_no: '7307', ord_date: '2026-05-10', total: '0' }]), false);
});

test('esVarianteCerrada: cliente sin pedidos -> false', () => {
  const quote = { trans_no: '1308', ord_date: '2026-05-10', total: '100000' };
  assert.equal(esVarianteCerrada(quote, []), false);
  assert.equal(esVarianteCerrada(quote, null), false);
  assert.equal(esVarianteCerrada(quote, undefined), false);
});

test('esVarianteCerrada: pedidos con fecha o total ausentes/no numericos se IGNORAN (no truenan)', () => {
  const quote = { trans_no: '1309', ord_date: '2026-05-10', total: '100000' };
  const basura = [
    null,
    { order_no: '7308', total: '100000' },                              // sin fecha
    { order_no: '7309', ord_date: '2026-05-11' },                       // sin total
    { order_no: '7310', ord_date: 'no-es-fecha', total: '100000' },     // fecha basura
    { order_no: '7311', ord_date: '2026-05-11', total: 'abc' },         // total basura
  ];
  assert.equal(esVarianteCerrada(quote, basura), false);
});

test('esVarianteCerrada: el pedido cierra aunque ya este ligado a OTRA cotizacion (trans_no_from)', () => {
  // Escenario variantes: el cliente autorizo la hermana; ese pedido cierra a las demas.
  const quote = { trans_no: '1310', ord_date: '2026-05-10', total: '100000' };
  const pedidos = [{ order_no: '7312', ord_date: '2026-05-11', total: '98000', trans_no_from: '1309' }];
  assert.equal(esVarianteCerrada(quote, pedidos), true);
});

test('esVarianteCerrada: los umbrales son configurables (ventanaDias / banda)', () => {
  const quote = { trans_no: '1311', ord_date: '2026-05-10', total: '100000' };
  const pedido = [{ order_no: '7313', ord_date: '2026-06-20', total: '100000' }]; // 41 dias
  assert.equal(esVarianteCerrada(quote, pedido), false);
  assert.equal(esVarianteCerrada(quote, pedido, { ventanaDias: 60 }), true);
  // Banda mas estricta: el 40% deja de cerrar.
  const mitad = [{ order_no: '7314', ord_date: '2026-05-11', total: '40000' }];
  assert.equal(esVarianteCerrada(quote, mitad), true);
  assert.equal(esVarianteCerrada(quote, mitad, { banda: 0.25 }), false);
});

test('constantes exportadas: la ventana es 31 dias y la banda 0.75', () => {
  assert.equal(VENTANA_VARIANTE_DIAS, 31);
  assert.equal(BANDA_VARIANTE, 0.75);
});

test('pedidoQueCierra: devuelve el pedido con la EVIDENCIA (order_no, total, fecha) o null', () => {
  const quote = { trans_no: '1312', ord_date: '2026-05-10', total: '100000' };
  const p = pedidoQueCierra(quote, [
    { order_no: '7315', ord_date: '2026-01-01', total: '100000' },  // fuera de ventana
    { order_no: '7316', ord_date: '2026-05-12', total: '95000' },   // este cierra
  ]);
  assert.equal(p.order_no, '7316');
  assert.equal(p.total, '95000');
  assert.equal(p.ord_date, '2026-05-12');
  assert.equal(pedidoQueCierra(quote, []), null);
});

// --- Integracion en planearBackfillSinPedido ---

test('planearBackfillSinPedido: SKIP varianteCerrada -- no importa el folio y lo cuenta', async () => {
  const { deps } = planBDeps({
    quotes: { '1150': QUOTE_B },   // total 5800, ord_date 2026-05-01
    debtors: { '394': DEBTOR },
    folioMax: 1150,
  });
  // El cliente 394 ordeno $5,500 cuatro dias despues: la compra cerro.
  deps.listarPedidosDeCliente = async () => [{ order_no: '7400', ord_date: '2026-05-05', total: '5500' }];
  const plan = await planearBackfillSinPedido(deps);
  assert.equal(plan.importar.length, 0);
  assert.equal(plan.skips.varianteCerrada, 1);
});

test('planearBackfillSinPedido: la exclusion por variante deja EVIDENCIA trazable (folio, cliente, pedido)', async () => {
  const { deps } = planBDeps({
    quotes: { '1150': QUOTE_B },
    debtors: { '394': DEBTOR },
    folioMax: 1150,
  });
  deps.listarPedidosDeCliente = async () => [{ order_no: '7400', ord_date: '2026-05-05', total: '5500' }];
  const plan = await planearBackfillSinPedido(deps);
  assert.equal(plan.variantesCerradas.length, 1);
  const ev = plan.variantesCerradas[0];
  assert.equal(ev.folio, '1150');
  assert.equal(ev.cliente, 'JUANA HERNANDEZ GARCIA');
  assert.equal(ev.total, 5800);
  assert.equal(ev.pedido.order_no, '7400');
  assert.equal(ev.pedido.total, 5500);
  assert.equal(ev.pedido.fecha, '2026-05-05');
});

test('planearBackfillSinPedido: MOTOBLOCK -- el pedido de muestras NO mata la cotizacion grande', async () => {
  const grande = { ...QUOTE_B, trans_no: '1150', total: '182093' };
  const { deps } = planBDeps({
    quotes: { '1150': grande },
    debtors: { '394': DEBTOR },
    folioMax: 1150,
  });
  deps.listarPedidosDeCliente = async () => [{ order_no: '7401', ord_date: '2026-05-03', total: '598' }];
  const plan = await planearBackfillSinPedido(deps);
  assert.equal(plan.importar.length, 1);
  assert.equal(plan.importar[0].folioOperam, '1150');
  assert.equal(plan.skips.varianteCerrada, 0);
});

test('planearBackfillSinPedido: sin la dep listarPedidosDeCliente la heuristica NO aplica (compat)', async () => {
  const { deps } = planBDeps({
    quotes: { '1150': QUOTE_B },
    debtors: { '394': DEBTOR },
    folioMax: 1150,
  });
  const plan = await planearBackfillSinPedido(deps);   // sin la dep
  assert.equal(plan.importar.length, 1);
  assert.equal(plan.skips.varianteCerrada, 0);
  assert.deepEqual(plan.variantesCerradas, []);
});

test('planearBackfillSinPedido: pide los pedidos por debtor del quote evaluado', async () => {
  // Dos quotes del mismo cliente. La dep real del script esta memoizada por debtor,
  // asi que el nucleo puede pedirla por folio sin costo de red extra.
  const otro = { ...QUOTE_B, trans_no: '1151', total: '182093' };
  const { deps } = planBDeps({
    quotes: { '1150': QUOTE_B, '1151': otro },
    debtors: { '394': DEBTOR },
    folioMax: 1151,
  });
  const pedidos = [];
  deps.listarPedidosDeCliente = async (debtorNo) => {
    pedidos.push(String(debtorNo));
    return [{ order_no: '7402', ord_date: '2026-05-05', total: '5500' }];
  };
  const plan = await planearBackfillSinPedido(deps);
  assert.deepEqual(pedidos, ['394', '394'], 'una lectura por folio evaluado (la memoizacion vive en el script)');
  assert.equal(plan.skips.varianteCerrada, 1);   // 1150 cierra; 1151 (grande) no
  assert.equal(plan.importar.length, 1);
});

// --- Piso de monto en la parte B (#76, decision Adrian 2026-07-30) ---------------
// Una cotizacion de menos de $500 no es una oportunidad de mayoreo: en mayoreo $500 son
// ~5 piezas. Son errores de captura, pruebas o muestras. SOLO aplica a la parte B; la
// parte A conserva la regla previa (las muestras $0 con pedido activo SI se siguen).

test('planearBackfillSinPedido: SKIP montoMinimo -- excluye una cotizacion de $499.99', async () => {
  const chica = { ...QUOTE_B, trans_no: '1150', total: '499.99' };
  const { deps } = planBDeps({
    quotes: { '1150': chica },
    debtors: { '394': DEBTOR },
    folioMax: 1150,
  });
  const plan = await planearBackfillSinPedido(deps);
  assert.equal(plan.importar.length, 0);
  assert.equal(plan.skips.montoMinimo, 1);
});

test('planearBackfillSinPedido: el piso es INCLUSIVO -- $500 exacto SI se importa', async () => {
  const justa = { ...QUOTE_B, trans_no: '1150', total: '500' };
  const { deps } = planBDeps({
    quotes: { '1150': justa },
    debtors: { '394': DEBTOR },
    folioMax: 1150,
  });
  const plan = await planearBackfillSinPedido(deps);
  assert.equal(plan.importar.length, 1);
  assert.equal(plan.skips.montoMinimo, 0);
});

test('planearBackfillSinPedido: una cotizacion de $0 cae en montoMinimo', async () => {
  const cero = { ...QUOTE_B, trans_no: '1150', total: '0' };
  const { deps } = planBDeps({
    quotes: { '1150': cero },
    debtors: { '394': DEBTOR },
    folioMax: 1150,
  });
  const plan = await planearBackfillSinPedido(deps);
  assert.equal(plan.importar.length, 0);
  assert.equal(plan.skips.montoMinimo, 1);
});

test('planearBackfillSinPedido: el piso se evalua ANTES que la variante (una $200 sale como montoMinimo)', async () => {
  const chica = { ...QUOTE_B, trans_no: '1150', total: '200' };
  const { deps } = planBDeps({
    quotes: { '1150': chica },
    debtors: { '394': DEBTOR },
    folioMax: 1150,
  });
  // Este pedido cerraria la cotizacion por variante si el piso no corriera primero.
  deps.listarPedidosDeCliente = async () => [{ order_no: '7500', ord_date: '2026-05-03', total: '210' }];
  const plan = await planearBackfillSinPedido(deps);
  assert.equal(plan.skips.montoMinimo, 1);
  assert.equal(plan.skips.varianteCerrada, 0);
  assert.deepEqual(plan.variantesCerradas, []);
});

test('constantes exportadas: el piso de monto de la parte B es $500', () => {
  assert.equal(MONTO_MINIMO_B, 500);
});
