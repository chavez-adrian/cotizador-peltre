// Motor de reconciliacion del sync post-venta con Operam (issue #62, AC2).
// La capa de IO: lee el estado REAL de Operam (read-only, formato conocido),
// lo normaliza a `hechos` y aplica el nucleo puro (etapaPostVenta) para mover la
// tarjeta. El webhook es solo una SENAL ("algo cambio para este cliente/order_");
// la reconciliacion no confia en su payload, lee la verdad de la API. La misma
// funcion la usa el webhook (F3) y la reconciliacion on-demand (F4).
//
// Diseno (peltre-operam.md seccion 12, sesion HITL #62):
//   - La cadena post-venta se une por `order_`/`order_no`. Una oportunidad =
//     un pedido (CONTEXT.md "Oportunidad").
//   - Pagos: de la factura (tipo 10) via allocated/outstanding/total_amount.
//   - tienePedido: existe un Sales Order (tipo 30) -> listar_pedidos.
//   - tieneRemision: existe una transaccion tipo 13.
//   - Binding por order_ (issue #67): prioridad (1) data.orderOperam explicito,
//     (2) pedido cuyo trans_no_from === folioOperam (el numero de COTIZACION es el
//     documento de origen del pedido; cotizacion != pedido pero quedan ligados por
//     ese campo, peltre-operam.md 12.2), (3) agregado por cliente (fallback). El
//     folio NUNCA se compara contra order_ directamente; solo contra trans_no_from.
//     Una venta directa (trans_no_from vacio) jamas se liga por documento. VER NOTA
//     al final del archivo.

import { etapaPostVenta, hechosDesdeOperam } from './sync-operam.js';
import { listarTransacciones, listarPedidos } from './operam-client.js';
import * as cotStore from './cotizaciones-store.js';

// Rango amplio para las lecturas (la API exige since_date/until_date). La cadena
// post-venta de una oportunidad viva cabe sobrado en ~2 anios hacia atras.
function rangoFechas() {
  const hasta = new Date();
  const desde = new Date(hasta);
  desde.setFullYear(desde.getFullYear() - 2);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { desde: fmt(desde), hasta: fmt(hasta) };
}

// Extrae el RFC de la oportunidad (la cotizacion lleva data.cliente.rfc). Es el
// identificador mas robusto para leer Operam: siempre presente en una cotizacion
// con cliente, y la API filtra transacciones por customer_rfc.
function rfcDeOportunidad(op) {
  const rfc = op?.data?.cliente?.rfc;
  return rfc ? String(rfc).trim().toUpperCase() : null;
}

// El folioOperam (numero de COTIZACION, #63) de la oportunidad, normalizado a
// String (se persiste como texto). Es la llave para resolver el pedido por su
// documento de origen (trans_no_from).
function folioDeOportunidad(op) {
  const folio = op?.folioOperam;
  return folio != null && folio !== '' ? String(folio) : null;
}

// El order_ (numero de pedido) explicito de la oportunidad, si se conoce (la liga
// manual de #56 / webhook de Pedido la pobla en data.orderOperam).
function orderExplicito(op) {
  const explicito = op?.data?.orderOperam;
  return explicito != null && explicito !== '' ? String(explicito) : null;
}

// Resuelve el order_ (numero de pedido) al que esta ligada la oportunidad, con
// precision por DOCUMENTO DE ORIGEN (issue #67). Prioridad:
//   1. data.orderOperam explicito (fuente 'explicito').
//   2. El pedido cuyo trans_no_from === folioOperam, es decir el pedido que nacio de
//      convertir nuestra cotizacion (fuente 'documento'). Es la liga PRECISA: el
//      Sales Order guarda el numero de la cotizacion de origen en trans_no_from
//      (peltre-operam.md 12.2; verificado en vivo cot 1141 -> pedido 7269).
//   3. Sin ninguna liga: agregado por cliente (fuente 'cliente', order=null).
// Una VENTA DIRECTA (trans_no_from vacio/null) NUNCA matchea por documento (no nace
// de cotizacion), asi que jamas se liga por error a una oportunidad con folioOperam.
// Recibe las lecturas ya inyectables (pedidos viene del caller que ya los listo, o
// se listan aqui si no se pasan) para ser testeable de forma aislada.
export async function resolverOrderDeOportunidad(op, _listarTransacciones, _listarPedidos) {
  const explicito = orderExplicito(op);
  if (explicito != null) return { order: explicito, fuente: 'explicito' };

  const folio = folioDeOportunidad(op);
  if (folio == null) return { order: null, fuente: 'cliente' };

  const rfc = rfcDeOportunidad(op);
  if (!rfc) return { order: null, fuente: 'cliente' };

  const { desde, hasta } = rangoFechas();
  const transacciones = await _listarTransacciones({ rfc, desde, hasta });
  const debtorNo = (transacciones.find(t => t && t.debtor_no != null) || {}).debtor_no;
  const pedidos = debtorNo != null
    ? await _listarPedidos({ debtorNo: Number(debtorNo), desde, hasta })
    : [];

  const order = orderPorDocumento(pedidos, folio);
  if (order != null) return { order, fuente: 'documento' };
  return { order: null, fuente: 'cliente' };
}

// El order_no del pedido cuyo trans_no_from coincide con el folio de la cotizacion.
// Normaliza ambos a String y descarta trans_no_from vacio (venta directa). null si
// no hay match.
function orderPorDocumento(pedidos, folio) {
  if (folio == null) return null;
  const f = String(folio);
  for (const p of pedidos || []) {
    if (!p) continue;
    const origen = p.trans_no_from;
    if (origen == null || origen === '') continue; // venta directa: no liga
    if (String(origen) === f) return String(p.order_no);
  }
  return null;
}

// Construye los `hechos` de la oportunidad leyendo Operam. Combina transacciones
// (factura 10 -> pago; remision 13 -> tieneRemision) con los pedidos (Sales Order
// 30 -> tienePedido). Si la oportunidad resuelve a un order_ concreto, la cadena se
// filtra a ese order_; si no, se usa el agregado por cliente.
export async function hechosDeOperam(op, deps = {}) {
  const _listarTransacciones = deps.listarTransacciones || listarTransacciones;
  const _listarPedidos = deps.listarPedidos || listarPedidos;

  const rfc = rfcDeOportunidad(op);
  if (!rfc) return null; // sin RFC no se puede ligar a Operam

  const { desde, hasta } = rangoFechas();
  const transacciones = await _listarTransacciones({ rfc, desde, hasta });

  // debtor_no del cliente: viene en las transacciones (mismo cliente, mismo
  // debtor_no). listar_pedidos filtra por debtor_no.
  const debtorNo = (transacciones.find(t => t && t.debtor_no != null) || {}).debtor_no;
  const pedidos = debtorNo != null
    ? await _listarPedidos({ debtorNo: Number(debtorNo), desde, hasta })
    : [];

  // Resuelve el order_ con la prioridad de #67: data.orderOperam explicito ->
  // pedido cuyo trans_no_from === folioOperam (documento de origen) -> agregado por
  // cliente. Se computa aqui con los pedidos ya listados (no re-lee Operam).
  const order = orderExplicito(op) ?? orderPorDocumento(pedidos, folioDeOportunidad(op));
  const ligaAlOrder = order != null && (
    transacciones.some(t => t && String(t.order_) === order) ||
    pedidos.some(p => p && String(p.order_no) === order)
  );

  const transFiltradas = ligaAlOrder
    ? transacciones.filter(t => t && String(t.order_) === order)
    : transacciones;
  const pedidosFiltrados = ligaAlOrder
    ? pedidos.filter(p => p && String(p.order_no) === order)
    : pedidos;

  const hechos = hechosDesdeOperam(transFiltradas);
  // El pedido (Sales Order, tipo 30) lo manda listar_pedidos, fuente autoritativa.
  if (pedidosFiltrados.length > 0) hechos.tienePedido = true;
  return hechos;
}

// Reconcilia una oportunidad: lee Operam, normaliza a hechos, aplica el nucleo y,
// si devuelve una etapa post-venta, mueve la tarjeta en el store y registra el
// evento. Devuelve { movida, etapa } (etapa = null si nada que mover). El nucleo
// ya respeta el gate de #61 y la monotonia, asi que el motor no decide reglas.
export async function reconciliarOportunidad(op, deps = {}) {
  const _cambiarEtapa = deps.cambiarEtapa || cotStore.cambiarEtapa;

  const hechos = await hechosDeOperam(op, deps);
  if (!hechos) return { movida: false, etapa: null };

  const destino = etapaPostVenta(hechos, op);
  if (!destino) return { movida: false, etapa: null };

  await _cambiarEtapa(op.id, destino, {
    tipo: 'sync_operam',
    etapa: destino,
    fecha: new Date().toISOString(),
  });
  return { movida: true, etapa: destino };
}

// Reconcilia las oportunidades candidatas que matchean un identificador de webhook
// (issue #62, F3). Identificador = { order, rfc, customerId } (defensivo). Filtra
// las oportunidades activas no terminadas por RFC (la liga robusta) y, si el webhook
// trae order_, prioriza la oportunidad cuyo order_/folio coincide. Reconcilia cada
// candidata. Devuelve los resultados. No truena si no hay candidata (responde vacio).
export async function reconciliarPorIdentificador(identificador, oportunidades, deps = {}) {
  const ident = identificador || {};
  const rfc = ident.rfc ? String(ident.rfc).trim().toUpperCase() : null;
  const order = ident.order != null && ident.order !== '' ? String(ident.order) : null;

  let candidatas = (oportunidades || []).filter(esActivaPostVentaCandidata);

  // Si hay RFC, restringe a esa razon social (la cotizacion lleva data.cliente.rfc).
  if (rfc) {
    candidatas = candidatas.filter(o => {
      const r = o?.data?.cliente?.rfc;
      return r && String(r).trim().toUpperCase() === rfc;
    });
  }

  // Si el webhook trae order_ y alguna candidata lo lleva explicito, prioriza esa
  // (binding preciso); si ninguna lo lleva, se reconcilian todas las del cliente
  // (el agregado por cliente del motor resuelve el caso comun).
  if (order) {
    const exactas = candidatas.filter(o =>
      String(o?.data?.orderOperam ?? '') === order
    );
    if (exactas.length > 0) candidatas = exactas;
  }

  const resultados = [];
  for (const op of candidatas) {
    resultados.push({ id: op.id, ...(await reconciliarOportunidad(op, deps)) });
  }
  return resultados;
}

// Una oportunidad es candidata a reconciliacion post-venta si esta activa (no es
// salida no_util/perdida) y aun no llego a la ultima etapa (producto_entregado):
// reconciliar las terminadas no aporta y la monotonia ya las dejaria quietas.
const TERMINALES = new Set(['no_util', 'perdida', 'producto_entregado']);
export function esActivaPostVentaCandidata(op) {
  return op != null && !TERMINALES.has(op.etapa);
}

// NOTA (binding por order_, refinado en #67): el numero de cotizacion (folioOperam,
// #63) NUNCA es igual al numero de pedido en Operam (cotizacion != pedido), por eso
// el folio NO se compara contra order_ directamente. PERO el pedido guarda el folio
// de su cotizacion de origen en trans_no_from (peltre-operam.md 12.2), asi que el
// order_ se resuelve con precision buscando el pedido cuyo trans_no_from ===
// folioOperam. Prioridad: data.orderOperam explicito > documento (trans_no_from) >
// agregado por cliente. Una venta directa (trans_no_from vacio) no nace de
// cotizacion y por eso nunca matchea por documento. El agregado por cliente sigue
// como fallback (correcto cuando el cliente tiene UNA cadena activa); si tiene
// varias sin liga por documento ni explicita, el agregado podria mover la etapa
// equivocada -- ese caso ya queda cubierto cuando la venta pasa por
// cotizacion->pedido (la liga por documento existe).
