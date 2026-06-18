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

// Solo se importan oportunidades ACTIVAS (decision #76): la cotizacion entra al
// pipeline si su etapa post-venta derivada NO es producto_entregado (entregada =
// cerrada, no aporta seguirla). Cualquier otra etapa (seguimiento, anticipo,
// pedido_liberado, saldo_pagado) o ausencia de etapa (null = etapaPostVenta no
// aplico, queda en seguimiento) cuenta como activa.
export function esActivoParaImportar(etapa) {
  return etapa !== 'producto_entregado';
}

// El salesman del pedido/quote de Operam es el operam_id del vendedor
// (data/vendedores.json: el campo `salesman` que va al body de Operam usa
// operam_id). Devuelve el `name` del vendedor con ese operam_id, o null si no
// mapea (sin inventar: una cotizacion sin vendedor reconocido queda sin vendedor
// y el orquestador la revisa). No matchea contra operam_id null por un salesman
// ausente.
export function mapearSalesman(salesman, vendedores) {
  const sid = strOrNull(salesman);
  if (sid == null) return null;
  for (const v of vendedores || []) {
    if (v && v.operam_id != null && String(v.operam_id) === sid) return v.name;
  }
  return null;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// El IVA mexicano: el total del GET de un quote incluye IVA 16% (peltre-operam.md
// 12.6). Cuando el quote no expone un subtotal nativo, se deriva total/1.16
// redondeado a 2 decimales (el subtotal es informativo en la cabecera; las
// partidas no se procesan en el backfill).
const FACTOR_IVA = 1.16;
export function subtotalDesdeTotal(total) {
  const t = num(total);
  if (t === 0) return 0;
  return Number((t / FACTOR_IVA).toFixed(2));
}

function upper(v) {
  return v != null ? String(v).trim().toUpperCase() : '';
}

// Construye la entrada de cotizacion para cotizaciones-store a partir del pedido
// (Sales Order), la cabecera del quote, el debtor (cliente) y la etapa post-venta
// ya derivada (decision #76, "cabecera completa sin partidas"). Las columnas de la
// tabla son fijas (fecha, vendedor, cliente, total, tier, folioOperam, etapa); el
// resto de campos de cabecera viven en `data`:
//   data.cliente.rfc          RFC del debtor (mayusculas; clave del sync #62)
//   data.cliente.customer_ref referencia del cliente (cust_ref del quote)
//   data.subtotal             total/1.16 (o el subtotal nativo del quote si viene)
//   data.moneda               curr_code del debtor
//   data.validoHasta          delivery_date del quote (el "Valido hasta" nativo)
//   data.orderOperam          order_no del pedido (binding PRECISO para el sync)
//   data.backfill             true (marca de origen)
// tier queda en null: los quotes de Operam NO traen el tier del cotizador (no se
// inventa). folioOperam = trans_no_from del pedido = numero de la cotizacion.
export function construirEntradaCotizacion({ pedido, quote, debtor, etapa, vendedores } = {}) {
  const p = pedido || {};
  const q = quote || {};
  const d = debtor || {};
  const total = num(q.total != null ? q.total : p.total);
  const subtotal = q.subtotal != null && q.subtotal !== ''
    ? num(q.subtotal)
    : subtotalDesdeTotal(total);
  const customerRef = q.cust_ref != null && q.cust_ref !== '' ? q.cust_ref : (q.customer_ref || '');
  return {
    fecha: q.ord_date || null,
    vendedor: mapearSalesman(q.salesman, vendedores),
    cliente: d.CustName || '',
    total,
    tier: null,
    folioOperam: strOrNull(p.trans_no_from),
    etapa: etapa || 'seguimiento',
    data: {
      cliente: {
        rfc: upper(d.tax_id),
        customer_ref: customerRef,
      },
      subtotal,
      moneda: d.curr_code || 'MXN',
      validoHasta: q.delivery_date || null,
      orderOperam: strOrNull(p.order_no),
      backfill: true,
    },
  };
}
