// Nucleo PURO del backfill de cotizaciones reales (issue #76). El backfill
// descubre cotizaciones (oportunidades) reales VIA PEDIDOS: los quotes (tipo 32)
// no son enumerables por la API (GET /sales/quote da 501), pero los pedidos
// (Sales Order, tipo 30) si (listarPedidos paginado). Cada pedido con
// trans_no_from no vacio nacio de convertir una cotizacion -> esa cotizacion
// es una oportunidad recuperable con folioOperam = trans_no_from
// (peltre-operam.md 12.2, decision issue #76 "Diseno resuelto").
//
// SIN IO: el script scripts/backfill-operam.mjs orquesta estas funciones con las
// lecturas de Operam (read-only) y el store inyectados. Cero escrituras a Operam.

// Pedidos de prueba/sistema a EXCLUIR siempre (decision #76):
//  - order_no 7270: pedido de la sonda de #67 (no es venta real).
//  - debtor_no 14 (PUBLICO EN GENERAL) y 1: clientes de prueba/mostrador.
const ORDERS_PRUEBA = new Set(['7270']);
const DEBTORS_PRUEBA = new Set(['14', '1']);

function strOrNull(v) {
  return v != null && v !== '' ? String(v) : null;
}

// Un pedido es candidato a backfill si representa una cotizacion real: tiene
// trans_no_from no vacio (nacio de una cotizacion, no es venta directa) y no es
// un pedido/cliente de prueba. Tolera order_no/debtor_no numerico o string.
export function esCandidatoBackfill(pedido) {
  if (!pedido) return false;
  const orderNo = strOrNull(pedido.order_no);
  if (orderNo == null) return false;
  const transNoFrom = strOrNull(pedido.trans_no_from);
  if (transNoFrom == null) return false; // venta directa: fuera
  if (ORDERS_PRUEBA.has(orderNo)) return false;
  const debtorNo = strOrNull(pedido.debtor_no);
  if (debtorNo != null && DEBTORS_PRUEBA.has(debtorNo)) return false;
  return true;
}
