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
//   - Binding por order_ (issue #67): (1) data.orderOperam explicito, o (2) el
//     pedido cuyo trans_no_from === folioOperam (el numero de COTIZACION es el
//     documento de origen del pedido; cotizacion != pedido pero quedan ligados por
//     ese campo, peltre-operam.md 12.2). El folio NUNCA se compara contra order_
//     directamente; solo contra trans_no_from. Una venta directa (trans_no_from
//     vacio) jamas se liga por documento. VER NOTA al final del archivo.
//   - Sin pedido propio NO se escribe nada (#507): ni etapa, ni "Pago sin
//     registrar", ni la marca de anticipo, ni el espejo. El agregado por cliente
//     que antes suplia la liga movio a Producto entregado cotizaciones que nunca
//     vendieron (14 desde el 2026-07-29 y 17 el 2026-10-01).

import { etapaPostVenta, hechosDesdeOperam, estadoPago, pagoSinRegistrar, huboAnticipo } from './sync-operam.js';
import { esSalida } from './pipeline.js';
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

// El customer_id (debtor_no) de la oportunidad, si se conoce. Es un binding MAS
// PRECISO que el RFC: el RFC generico (XAXX010101000) lo comparten muchos clientes, y
// la consulta por customer_rfc trae transacciones de OTROS debtors -> contamina la
// etapa (visto en vivo #76: folios 669/1152 -> saldo_pagado falso). customer_id SI
// filtra server-side (verificado). El backfill lo puebla con pedido.debtor_no; las
// oportunidades de #62 sin customerId siguen ligando por RFC (comportamiento previo).
function customerIdDeOportunidad(op) {
  const id = op?.data?.cliente?.customerId;
  return id != null && id !== '' ? String(id) : null;
}

// El folioOperam (numero de COTIZACION, #63) de la oportunidad, normalizado a
// String (se persiste como texto). Es la llave para resolver el pedido por su
// documento de origen (trans_no_from).
function folioDeOportunidad(op) {
  const folio = op?.folioOperam;
  return folio != null && folio !== '' ? String(folio) : null;
}

// El order_ (numero de pedido) explicito de la oportunidad, si se conoce. Hoy
// solo lo escribe el backfill historico (#76), con el pedido del que importo la
// tarjeta.
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
//   3. Sin ninguna liga: { order: null, fuente: null } (#507: no hay respaldo).
// Una VENTA DIRECTA (trans_no_from vacio/null) NUNCA matchea por documento (no nace
// de cotizacion), asi que jamas se liga por error a una oportunidad con folioOperam.
// Recibe las lecturas ya inyectables (pedidos viene del caller que ya los listo, o
// se listan aqui si no se pasan) para ser testeable de forma aislada.
export async function resolverOrderDeOportunidad(op, _listarTransacciones, _listarPedidos) {
  const explicito = orderExplicito(op);
  if (explicito != null) return { order: explicito, fuente: 'explicito' };

  const folio = folioDeOportunidad(op);
  if (folio == null) return { order: null, fuente: null };

  const rfc = rfcDeOportunidad(op);
  if (!rfc) return { order: null, fuente: null };

  const { desde, hasta } = rangoFechas();
  const transacciones = await leerTodo(_listarTransacciones, { rfc, desde, hasta });
  const debtorNo = (transacciones.find(t => t && t.debtor_no != null) || {}).debtor_no;
  const pedidos = debtorNo != null
    ? await leerTodo(_listarPedidos, { debtorNo: Number(debtorNo), desde, hasta })
    : [];

  const order = orderPorDocumento(pedidos, folio);
  if (order != null) return { order, fuente: 'documento' };
  return { order: null, fuente: null };
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

// Construye el espejo de la cadena Operam (issue #67, AC3) a partir de las
// transacciones y pedidos YA FILTRADOS a un order_ resuelto (binding preciso). Es
// el reflejo de la cadena post-venta para trazabilidad en la tarjeta:
//   { cotizacion, pedido, factura:{numero,ref}, remisiones[], pago }
// Eslabones ATRIBUIBLES por order_ (peltre-operam.md 12, verificado en vivo): la
// factura (10) y la remision (13) traen el order_ del pedido. Los pagos (12) y notas
// de credito (11) traen order_=0 en el listado (NO atribuibles a un pedido por la
// API), asi que ya quedaron fuera de transFiltradas y NO se listan como folios: el
// estado de PAGO se deriva del allocated de la factura (decision Adrian #67). El
// folio visible de cada eslabon es `reference` (A1907, 2142), no `ref` (inexistente
// en la API). Solo incluye lo que EXISTE (sin factura no pone factura ni pago).
export function construirEspejoOperam(transFiltradas, pedidosFiltrados, folio) {
  const lista = Array.isArray(transFiltradas) ? transFiltradas : [];
  const pedidos = Array.isArray(pedidosFiltrados) ? pedidosFiltrados : [];
  const tipo = (t) => num(t.type != null ? t.type : t.trans_type);

  const espejo = { remisiones: [] };
  if (folio != null && folio !== '') espejo.cotizacion = String(folio);

  const pedido = pedidos.find(p => p && p.order_no != null);
  if (pedido) espejo.pedido = String(pedido.order_no);

  const pago = { allocated: 0, total: 0 };
  for (const t of lista) {
    if (!t) continue;
    const ty = tipo(t);
    if (ty === 10) {
      if (!espejo.factura) {
        espejo.factura = { numero: String(t.trans_no ?? ''), ref: String(t.reference ?? '') };
      }
      pago.allocated += num(t.allocated);
      pago.total += num(t.total_amount);
    } else if (ty === 13) {
      espejo.remisiones.push(String(t.reference ?? t.trans_no ?? ''));
    }
  }
  const estado = estadoPago(pago);
  if (estado) espejo.pago = estado;
  return espejo;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Pagina una lectura de Operam (transacciones/pedidos) hasta agotar la cuenta del
// cliente. La API devuelve 100 por pagina; el binding por order_ necesita la cuenta
// COMPLETA: para un cliente con mas de 100 transacciones (el generico, 728 reales) la
// cadena del pedido objetivo puede caer en una pagina posterior, y leer solo la
// primera la pierde -> el binding falla y los hechos se contaminan con el agregado de
// OTROS pedidos del mismo cliente (issue #76; medido en vivo: 7 pedidos del generico
// 184 mostrados como activos cuando estaban cerrados). El corte natural (pagina < 100)
// deja a un cliente normal en 1 sola lectura. Pasa { ...args, skip, limit } al lector
// para que el memo del backfill pueda cachear por (cliente, pagina).
const LIMIT_PAGINA = 100;
async function leerTodo(lector, args) {
  let todo = [];
  for (let skip = 0; ; skip += LIMIT_PAGINA) {
    const pagina = await lector({ ...args, skip, limit: LIMIT_PAGINA });
    const lista = Array.isArray(pagina) ? pagina : [];
    todo = todo.concat(lista);
    if (lista.length < LIMIT_PAGINA) break;
  }
  return todo;
}

// Por que una reconciliacion no hizo nada (#507). "Sin pedido propio" (la
// cotizacion no tiene en Operam un pedido que sea SUYO) no es lo mismo que "sin
// cambios" (lo tiene y la tarjeta ya refleja sus hechos).
export const MOTIVO_SIN_PEDIDO_PROPIO = 'sin-pedido-propio';
export const MOTIVO_SIN_IDENTIFICADOR = 'sin-identificador-operam';
export const MOTIVO_SIN_CAMBIOS = 'sin-cambios';

// Lee Operam y devuelve los hechos de la cadena PROPIA de la oportunidad, o el
// motivo por el que no la hay: { hechos } o { motivo }. Combina transacciones
// (factura 10 -> pago; remision 13 -> tieneRemision) con los pedidos (Sales Order
// 30 -> tienePedido), filtrados al order_ de la oportunidad (explicito o por
// documento), y adjunta el espejo de la cadena (_order, _espejo) para que
// reconciliarOportunidad lo persista (#67, AC3). Sin pedido propio no hay hechos
// (#507): las ventas de OTRAS cotizaciones del cliente no dicen nada de esta.
export async function leerCadenaPropia(op, deps = {}) {
  const _listarTransacciones = deps.listarTransacciones || listarTransacciones;
  const _listarPedidos = deps.listarPedidos || listarPedidos;

  // Sin pedido explicito ni folio ningun pedido puede ser suyo: ni se lee Operam.
  if (orderExplicito(op) == null && folioDeOportunidad(op) == null) {
    return { motivo: MOTIVO_SIN_PEDIDO_PROPIO };
  }

  const customerId = customerIdDeOportunidad(op);
  const rfc = rfcDeOportunidad(op);
  if (customerId == null && !rfc) return { motivo: MOTIVO_SIN_IDENTIFICADOR };

  const { desde, hasta } = rangoFechas();
  // Binding por customer_id si se conoce (preciso, sin contaminacion del RFC generico);
  // si no, por RFC (oportunidades de #62). NO se mandan ambos a la vez.
  const transacciones = await leerTodo(_listarTransacciones,
    customerId != null ? { customerId, desde, hasta } : { rfc, desde, hasta }
  );

  // debtor_no del cliente: viene en las transacciones (mismo cliente, mismo
  // debtor_no). listar_pedidos filtra por debtor_no.
  const debtorNo = (transacciones.find(t => t && t.debtor_no != null) || {}).debtor_no;
  const pedidos = debtorNo != null
    ? await leerTodo(_listarPedidos, { debtorNo: Number(debtorNo), desde, hasta })
    : [];

  // Resuelve el order_ con la prioridad de #67: data.orderOperam explicito ->
  // pedido cuyo trans_no_from === folioOperam (documento de origen). Se computa aqui
  // con los pedidos ya listados (no re-lee Operam). Un explicito que las lecturas no
  // encuentran tampoco es liga.
  const order = orderExplicito(op) ?? orderPorDocumento(pedidos, folioDeOportunidad(op));
  const ligaAlOrder = order != null && (
    transacciones.some(t => t && String(t.order_) === order) ||
    pedidos.some(p => p && String(p.order_no) === order)
  );
  if (!ligaAlOrder) return { motivo: MOTIVO_SIN_PEDIDO_PROPIO };

  const transFiltradas = transacciones.filter(t => t && String(t.order_) === order);
  const pedidosFiltrados = pedidos.filter(p => p && String(p.order_no) === order);

  const hechos = hechosDesdeOperam(transFiltradas);
  // El pedido (Sales Order, tipo 30) lo manda listar_pedidos, fuente autoritativa.
  if (pedidosFiltrados.length > 0) hechos.tienePedido = true;

  hechos._order = order;
  hechos._espejo = construirEspejoOperam(transFiltradas, pedidosFiltrados, folioDeOportunidad(op));
  return { hechos };
}

// Los hechos de la cadena propia, o null si la oportunidad no tiene pedido propio
// o no hay con que leer Operam. Lo consume el backfill historico (#76).
export async function hechosDeOperam(op, deps = {}) {
  const { hechos } = await leerCadenaPropia(op, deps);
  return hechos || null;
}

// Reconcilia una oportunidad: lee Operam, normaliza a hechos, aplica el nucleo y,
// si devuelve una etapa post-venta, mueve la tarjeta en el store y registra el
// evento. Devuelve { movida, etapa } y, cuando no movio, el `motivo` (#507). El
// nucleo ya respeta el gate de #61 y la monotonia, asi que el motor no decide
// reglas. Sin pedido propio sale ANTES de cualquier escritura.
export async function reconciliarOportunidad(op, deps = {}) {
  const _cambiarEtapa = deps.cambiarEtapa || cotStore.cambiarEtapa;
  const _setEspejoOperam = deps.setEspejoOperam || cotStore.setEspejoOperam;
  const _actualizarDatos = deps.actualizarDatos || cotStore.actualizarDatos;

  const { hechos, motivo } = await leerCadenaPropia(op, deps);
  if (!hechos) return { movida: false, etapa: null, motivo };

  // Persiste el espejo de la cadena (#67, AC3) aunque la etapa no cambie: la
  // trazabilidad de folios vale por si misma.
  if (op && op.id != null) {
    await _setEspejoOperam(op.id, hechos._espejo);
  }

  // Pago sin registrar (#77): la tarjeta entregada-impaga muestra un badge hasta que
  // el pago aparezca. El flag deriva de los mismos hechos que la etapa y se persiste
  // SIEMPRE (aunque la etapa no se mueva), para que un pago posterior lo apague. Es
  // lo que mantiene viva a la entregada-impaga como candidata (esActivaPostVentaCandidata).
  // #486: la marca "hubo anticipo" se anota la primera vez que se ve el pago
  // parcial y NUNCA se escribe en false: actualizarDatos es un merge y el pago que
  // liquida la borraria (el espejo ya sobrescribe `anticipo` con `pagado`).
  if (op && op.id != null) {
    await _actualizarDatos(op.id, {
      pagoSinRegistrar: pagoSinRegistrar(hechos),
      ...(huboAnticipo(hechos) ? { huboAnticipo: true } : {}),
    });
  }

  const destino = etapaPostVenta(hechos, op);
  if (!destino) return { movida: false, etapa: null, motivo: MOTIVO_SIN_CAMBIOS };

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

  // Si el webhook trae order_ y alguna candidata lo lleva explicito, prioriza esa;
  // si ninguna lo lleva, se reconcilian todas las del cliente y cada una solo se
  // mueve por SU pedido (la que no tiene sale con su motivo, #507).
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
// salida: esSalida de pipeline.js) y aun no llego a la ultima etapa (producto_entregado):
// reconciliar las terminadas no aporta y la monotonia ya las dejaria quietas.
// producto_entregado es la ultima etapa, PERO una entregada-impaga (issue #77) sigue
// siendo candidata: su pago se registra con dias de desfase y ese sync posterior debe
// poder apagar el flag pagoSinRegistrar (limpiar el badge). Ya pagada (flag false o
// ausente) si es terminal. #484: la Cancelada tiene pedido y Operam puede seguir
// registrando pagos o remisiones, pero como toda salida el sync no la mueve.
export function esActivaPostVentaCandidata(op) {
  if (op == null) return false;
  if (esSalida(op.etapa)) return false;
  if (op.etapa === 'producto_entregado') return op.data?.pagoSinRegistrar === true;
  return true;
}

// NOTA (binding por order_, refinado en #67 y #507): el numero de cotizacion
// (folioOperam, #63) NUNCA es igual al numero de pedido en Operam (cotizacion !=
// pedido), por eso el folio NO se compara contra order_ directamente. PERO el
// pedido guarda el folio de su cotizacion de origen en trans_no_from
// (peltre-operam.md 12.2), asi que el order_ se resuelve con precision buscando el
// pedido cuyo trans_no_from === folioOperam. Prioridad: data.orderOperam explicito
// > documento (trans_no_from). Una venta directa (trans_no_from vacio) no nace de
// cotizacion y por eso nunca matchea por documento. Sin ninguna de las dos no hay
// respaldo: el agregado por cliente se quito en #507 porque, con varias ventas del
// mismo cliente, movia la etapa con los hechos de otra.
