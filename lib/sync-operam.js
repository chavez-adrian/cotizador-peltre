// Nucleo puro del sync post-venta con Operam (issue #62, AC3; PRD #52; CONTEXT.md
// "Sincronizacion post-venta con Operam"; ADR-0005). Dado un conjunto de HECHOS
// normalizados sobre el estado en Operam de una oportunidad, devuelve la etapa
// post-venta destino. SIN red, SIN IO, SIN escritura: la capa que lee Operam
// (webhooks/polling) y mapea el JSON crudo a `hechos`, y el movimiento real de la
// tarjeta, son la sesion HITL posterior. Aqui solo la regla pura.
//
// Forma de `hechos` (ya normalizado; lo produce el IO layer):
//   {
//     pago: { allocated, outstanding, total },  // montos agregados de la factura (10)
//     tienePedido: boolean,                     // existe un Sales Order en Operam (trans_type 30)
//     tieneRemision: boolean,                   // existe una remision (trans_type 13 / CustDelivery)
//   }
//
// Decisiones de Adrian (PROGRESS #62; ajuste de regla de pago, sesion HITL 2026-06-17):
//   - anticipo_pagado: pago parcial (0 < allocated < total).
//   - pedido_liberado: existe un pedido en Operam (tienePedido).
//   - saldo_pagado: liquidado (allocated >= total * 0.99, total > 0; tolera 1% por
//     error humano de pago de mas/menos). El `outstanding` del listado de Operam NO
//     es fiable (sale != 0 en facturas ya pagadas), por eso la senal de pago se
//     deriva de allocated vs total, no de outstanding.
//   - producto_entregado: existe una remision (tieneRemision).
// Post-venta no retrocede: si varios hechos aplican, gana la etapa MAS avanzada.

import { ETAPAS } from './pipeline.js';
import { puedeLiberar } from '../public/js/decorados-logica.js';

// Orden post-venta tomado del pipeline canonico (las 4 etapas finales en orden):
// anticipo_pagado < pedido_liberado < saldo_pagado < producto_entregado.
const ETAPAS_POST_VENTA = ETAPAS.slice(ETAPAS.indexOf('anticipo_pagado'));
const RANGO = new Map(ETAPAS_POST_VENTA.map((e, i) => [e, i]));

const PAGO_VACIO = { allocated: 0, outstanding: 0, total: 0 };

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Umbral de liquidacion: el saldo se considera pagado si lo asignado cubre al menos
// el 99% del total (tolera errores humanos de pago de mas/menos hasta 1% del valor
// de la factura -- decision de Adrian, sesion HITL #62). La senal de pago se deriva
// de allocated vs total porque el `outstanding` del listado de Operam NO es fiable
// (sale != 0 en facturas ya pagadas al 100%).
const UMBRAL_LIQUIDACION = 0.99;

// Estado de pago derivado de los montos de la factura (allocated vs total), con la
// MISMA regla que las etapas (issue #67, AC3): 'pagado' si lo asignado cubre >=99%
// del total (tolera 1%), 'anticipo' si hay pago parcial, null si no hay pago o no
// hay factura. El espejo de la cadena lo usa para mostrar el estado de pago sin
// listar folios de pago (los pagos tipo 12 traen order_=0 y no son atribuibles a un
// pedido por la API; decision de Adrian #67).
export function estadoPago(pago) {
  const allocated = num((pago && pago.allocated) || 0);
  const total = num((pago && pago.total) || 0);
  if (total > 0 && allocated >= total * UMBRAL_LIQUIDACION) return 'pagado';
  if (allocated > 0) return 'anticipo';
  return null;
}

// Hubo anticipo (#486): los hechos muestran un pago parcial. Decide si la venta
// lleva comprobante del saldo (CONTEXT.md "Comprobante de pago"). Sale de los
// hechos y no de la etapa: el gate de decorados o la monotonia pueden dejar la
// tarjeta en otra etapa con el pago parcial a la vista.
export function huboAnticipo(hechos) {
  return estadoPago(hechos && hechos.pago) === 'anticipo';
}

// Pago sin registrar (issue #77): la oportunidad ya ENTREGADA (existe remision) pero
// el pago aun NO aparece liquidado en Operam. En el pipeline manda el CUMPLIMIENTO
// (entrega), no la cobranza: producto_entregado se alcanza con la remision aunque el
// pago no este registrado (la contadora lo captura a mano con dias de desfase). El
// flag deriva de los MISMOS hechos que la etapa (remision + estadoPago de la factura)
// para que la tarjeta muestre el badge "Pago sin registrar" hasta que el pago aparezca
// (allocated ~ total, tolerancia 1%); al liquidarse se apaga. Sin remision no aplica.
export function pagoSinRegistrar(hechos) {
  if (!hechos || !hechos.tieneRemision) return false;
  return estadoPago(hechos.pago) !== 'pagado';
}

// Las etapas post-venta que los hechos implican, sin gate ni monotonia. Cada
// regla es independiente; el caller toma la mas avanzada.
function etapasImplicadas(hechos) {
  const pago = (hechos && hechos.pago) || PAGO_VACIO;
  const allocated = num(pago.allocated);
  const total = num(pago.total);
  const implicadas = new Set();
  const liquidado = total > 0 && allocated >= total * UMBRAL_LIQUIDACION;
  if (allocated > 0 && !liquidado) implicadas.add('anticipo_pagado');
  if (liquidado) implicadas.add('saldo_pagado');
  if (hechos && hechos.tienePedido) implicadas.add('pedido_liberado');
  if (hechos && hechos.tieneRemision) implicadas.add('producto_entregado');
  return implicadas;
}

// Etapa post-venta destino dada la informacion de Operam ya normalizada y la
// oportunidad (opcional). Devuelve la etapa MAS avanzada alcanzada o null si
// ningun hecho post-venta aplica (la oportunidad sigue en Seguimiento).
//
// Gate de decorados (#61): una oportunidad decorada con checklist incompleto NO
// avanza a pedido_liberado ni mas alla; se topa en la mayor etapa NO bloqueada
// por el gate (anticipo_pagado, o null si ni eso aplica). El sync NO la libera
// aunque Operam diga que hay pedido.
//
// Monotonia / idempotencia: post-venta no retrocede. Si la etapa actual de la
// oportunidad ya es igual o mas avanzada que la calculada, devuelve null.
export function etapaPostVenta(hechos, oportunidad) {
  const implicadas = etapasImplicadas(hechos);
  if (implicadas.size === 0) return null;

  const bloqueaGate = oportunidad != null && !puedeLiberar(oportunidad);

  let destino = null;
  let mejorRango = -1;
  for (const etapa of implicadas) {
    if (bloqueaGate && RANGO.get(etapa) >= RANGO.get('pedido_liberado')) continue;
    const r = RANGO.get(etapa);
    if (r > mejorRango) {
      mejorRango = r;
      destino = etapa;
    }
  }
  if (destino == null) return null;

  const actual = oportunidad && oportunidad.etapa;
  if (RANGO.has(actual) && RANGO.get(actual) >= mejorRango) return null;

  return destino;
}

const texto = (v) => (v == null ? '' : String(v).trim());

// Los pedidos de una cotizacion por documento (#508, ADR-0021). Prioridad:
//   1. data.orderOperam explicito: ESE pedido ancla la liga. Un explicito que el
//      listado no trae no es liga.
//   2. Sin explicito, los pedidos cuyo trans_no_from === folio (documento).
// Entran ademas los HERMANOS del folio: uno puede tener dos pedidos (836: 5706 y
// 5707; 861: 7282 y 7321) y los hechos son de todos. Con explicito solo si el
// explicito nacio de ESE folio: uno que nacio de otra cotizacion no arrastra los
// pedidos de aquella. El principal es el ancla (o el primero), salvo que sea de
// total cero habiendo otro con total: la 861 quedo ligada al 7321 de total 0
// teniendo el 7282. Una VENTA DIRECTA (trans_no_from vacio) nunca se liga.
// #512: un pedido ANULADO en Operam (`anulados`, order_no) no existe para la liga:
// sale de la lista antes de todo, y un explicito anulado no ancla -- la liga cae
// al documento del folio, como si no hubiera explicito.
// Devuelve { principal, pedidos } (principal primero) o null sin liga.
export function pedidosDeLaCotizacion(pedidos, { folio, explicito, anulados } = {}) {
  const fuera = new Set([...(anulados || [])].map(texto));
  const lista = (Array.isArray(pedidos) ? pedidos : []).filter(p => p && texto(p.order_no) !== '' && !fuera.has(texto(p.order_no)));
  let ancla = null;
  if (explicito != null && explicito !== '' && !fuera.has(texto(explicito))) {
    ancla = lista.find(p => texto(p.order_no) === String(explicito)) || null;
    if (!ancla) return null;
  }
  const documento = !ancla || texto(ancla.trans_no_from) === texto(folio) ? texto(folio) : '';
  const vistos = new Set();
  const conjunto = [];
  for (const p of [...(ancla ? [ancla] : []), ...lista]) {
    const order = texto(p.order_no);
    if (vistos.has(order)) continue;
    if (p !== ancla && (documento === '' || texto(p.trans_no_from) !== documento)) continue;
    vistos.add(order);
    conjunto.push(p);
  }
  if (conjunto.length === 0) return null;
  const principal = conTotal(conjunto[0]) ? conjunto[0] : (conjunto.find(conTotal) || conjunto[0]);
  return { principal, pedidos: [principal, ...conjunto.filter(p => p !== principal)] };
}

const conTotal = (p) => num(p.total) > 0;

// La fecha de entrega de un pedido (#531): el `delivery_date` del listado de pedidos
// de Operam, un dia sin hora (medido el 2026-10-05: AAAA-MM-DD en los 100 pedidos de
// septiembre). Devuelve ese dia como texto o null si no hay uno legible (vacio,
// 0000-00-00 o un dia que no existe): un pedido sin fecha no guarda nada.
export function fechaEntregaDePedido(pedido) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto(pedido?.delivery_date));
  if (!m) return null;
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// La carga de las cotizaciones que ya tenian pedido (#531): que hacer con la fecha
// de entrega de UNA, dada su cadena (pedidosDeLaCotizacion, o null sin pedido
// propio). `escribir` solo cuando el pedido principal trae fecha y es distinta de
// la que ya guarda el espejo.
export function planFechaEntrega(op, cadena) {
  const fechaAntes = op?.data?.espejoOperam?.fechaEntrega ?? null;
  if (!cadena) return { pedido: null, fechaAntes, fechaDespues: null, accion: 'sin-pedido' };
  const fechaDespues = fechaEntregaDePedido(cadena.principal);
  const accion = !fechaDespues ? 'sin-fecha' : fechaDespues === fechaAntes ? 'igual' : 'escribir';
  return { pedido: texto(cadena.principal.order_no), fechaAntes, fechaDespues, accion };
}

// Los pedidos cuya anulacion hay que preguntarle a la web de Operam antes de ligar
// (#512): los que PUEDEN entrar a la cadena (el explicito y los del documento del
// folio) y no tienen total positivo. La API lista el anulado con total 0 y no dice
// que lo esta; medido el 2026-10-02, los 30 anulados conocidos tienen total 0 y 15 de
// 15 controles con total estan vivos, pero de 38 pedidos de total 0 con documento
// solo 16 estan anulados: el total cero obliga a preguntar, no decide. Un total
// ilegible no se puede clasificar y tambien se pregunta. Devuelve order_no.
export function pedidosPorVerificarAnulacion(pedidos, { folio, explicito } = {}) {
  const f = texto(folio);
  const e = texto(explicito);
  const candidatos = (Array.isArray(pedidos) ? pedidos : []).filter(p => {
    if (!p || texto(p.order_no) === '') return false;
    return (e !== '' && texto(p.order_no) === e) || (f !== '' && texto(p.trans_no_from) === f);
  });
  return [...new Set(candidatos.filter(p => !conTotal(p)).map(p => texto(p.order_no)))];
}

// Normalizacion de un conjunto de transacciones crudas de Operam a `hechos`.
// Mapeo REAL de Operam (peltre-operam.md seccion 12; FrontAccounting), NO las
// etiquetas del MCP que estan mal:
//   10 = FACTURA (Sales Invoice, con CFDI): de aqui salen los montos de pago
//        (allocated/outstanding/total_amount); el pago de cliente (12) se aplica
//        contra la factura via `allocated`.
//   13 = REMISION (Customer Delivery, sin CFDI): tieneRemision -> producto_entregado.
//   30 = PEDIDO (Sales Order): tienePedido -> pedido_liberado.
//   11 = nota de credito, 12 = pago suelto, 32 = cotizacion nativa: se ignoran
//        (no son senal de etapa por si mismos; el saldo vive en la factura 10).
// El tipo viene como `type` (string, de listar_transacciones) o `trans_type`
// (numero); se aceptan ambos. Las transacciones deben ser de la misma oportunidad
// (mismo order_ / mismo cliente); el caller del IO layer las filtra.
export function hechosDesdeOperam(transacciones) {
  const lista = Array.isArray(transacciones) ? transacciones : [];
  const hechos = {
    pago: { allocated: 0, outstanding: 0, total: 0 },
    tienePedido: false,
    tieneRemision: false,
  };
  for (const t of lista) {
    if (!t) continue;
    const tipo = num(t.type != null ? t.type : t.trans_type);
    if (tipo === 30) hechos.tienePedido = true;
    if (tipo === 13) hechos.tieneRemision = true;
    if (tipo === 10) {
      hechos.pago.total += num(t.total_amount);
      hechos.pago.allocated += num(t.allocated);
      hechos.pago.outstanding += num(t.outstanding);
    }
  }
  return hechos;
}

// El modo de las dos rutas de admin que reconcilian (#510): el barrido y la de una
// cotizacion. Escribir se pide de forma EXPRESA: `{ aplicar: true }` escribe y
// `{ seco: true }` responde el plan sin escribir. Cualquier otra peticion -- sin
// cuerpo, con los dos a la vez o con un valor que no sea exactamente `true` (el
// texto "true" no cuenta) -- es un error: hasta #510 todo lo que no fuera `seco:
// true` APLICABA, y en el barrido eso escribe sobre todas las cotizaciones con
// pedido. Devuelve { seco } o { error }.
export const MENSAJE_MODO_RECONCILIACION = 'Indica el modo de forma expresa: { "seco": true } para ver el plan sin escribir o { "aplicar": true } para escribir.';

export function modoDeReconciliacion(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const tieneSeco = Object.hasOwn(b, 'seco');
  const tieneAplicar = Object.hasOwn(b, 'aplicar');
  if (tieneSeco && !tieneAplicar && b.seco === true) return { seco: true };
  if (tieneAplicar && !tieneSeco && b.aplicar === true) return { seco: false };
  return { error: MENSAJE_MODO_RECONCILIACION };
}
