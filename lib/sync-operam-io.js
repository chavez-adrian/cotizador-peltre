// Motor de reconciliacion del sync post-venta con Operam (issue #62, AC2).
// La capa de IO: lee el estado REAL de Operam (read-only, formato conocido),
// lo normaliza a `hechos` y aplica el nucleo puro (etapaPostVenta) para mover la
// tarjeta. El webhook es solo una SENAL ("algo cambio para este cliente/order_");
// la reconciliacion no confia en su payload, lee la verdad de la API. La misma
// funcion la usa el webhook (F3), la reconciliacion on-demand (F4) y la de UNA
// cotizacion que pide el admin (#508).
//
// Diseno (peltre-operam.md seccion 12, sesion HITL #62):
//   - La cadena post-venta se une por `order_`/`order_no`. Una oportunidad =
//     un pedido (CONTEXT.md "Oportunidad").
//   - Pagos: de la factura (tipo 10) via allocated/outstanding/total_amount.
//   - tienePedido: existe un Sales Order (tipo 30) -> listar_pedidos.
//   - tieneRemision: existe una transaccion tipo 13.
//   - La liga cotizacion-pedido es por DOCUMENTO (#508, ADR-0021): el pedido se
//     busca en el listado de pedidos de Operam por su documento de origen
//     (`trans_no_from` = folio de la cotizacion), SIN filtrar por el RFC ni por el
//     Cliente Operam del registro, y la cadena se lee con el cliente DEL PEDIDO.
//     Por RFC se perdian 12 pedidos: la mayoria de los registros ya no guarda RFC,
//     y en dos el pedido esta bajo otro Cliente Operam. `data.orderOperam`
//     explicito conserva la prioridad. Una venta directa (trans_no_from vacio)
//     jamas se liga por documento. VER NOTA al final del archivo.
//   - Sin pedido propio NO se escribe nada (#507): ni etapa, ni "Pago sin
//     registrar", ni la marca de anticipo, ni el espejo. El agregado por cliente
//     que antes suplia la liga movio a Producto entregado cotizaciones que nunca
//     vendieron (14 desde el 2026-07-29 y 17 el 2026-10-01).
//   - Primero se lee TODO y despues se escribe (#508): un error de Operam sale
//     antes de la primera escritura, y el modo en seco es el mismo plan sin aplicar.

import { etapaPostVenta, hechosDesdeOperam, estadoPago, pagoSinRegistrar, huboAnticipo, pedidosDeLaCotizacion } from './sync-operam.js';
import { esSalida } from './pipeline.js';
import { listarTransacciones, listarPedidos } from './operam-client.js';
import * as cotStore from './cotizaciones-store.js';

// Ritmo PROPIO de las lecturas del sync (#508): en fila para TODO el proceso --
// una lectura no arranca hasta que termino la anterior, y nunca antes de
// INTERVALO_LECTURAS_MS desde que arranco la anterior (el webhook y el admin a la
// vez tampoco se enciman).
// Es el ritmo de #438; NO usa el throttle global de operam-client
// (_setMinInterval), que frenaria a todo el cotizador mientras el sync lee.
const INTERVALO_LECTURAS_MS = 1100;
const sleep = (ms) => new Promise(res => setTimeout(res, ms));
const RITMO_DE_FABRICA = Object.freeze({ intervaloMs: INTERVALO_LECTURAS_MS, esperar: sleep, ahora: () => Date.now() });
let ritmo = { ...RITMO_DE_FABRICA };
let turno = Promise.resolve();
let ultimaLectura = null;

function aSuRitmo(leer) {
  const mio = turno.then(async () => {
    if (ultimaLectura !== null) {
      const falta = ultimaLectura + ritmo.intervaloMs - ritmo.ahora();
      if (falta > 0) await ritmo.esperar(falta);
    }
    ultimaLectura = ritmo.ahora();
    return leer();
  });
  turno = mio.catch(() => {});
  return mio;
}

// Seam de prueba: sin ritmo (intervaloMs 0) o con reloj falso.
export function _setRitmo(parcial) {
  ritmo = { ...ritmo, ...parcial };
}

export function _reiniciarRitmo() {
  ritmo = { ...RITMO_DE_FABRICA };
  turno = Promise.resolve();
  ultimaLectura = null;
}

const fmt = (d) => d.toISOString().slice(0, 10);

// Rango amplio para las lecturas (la API exige since_date/until_date): el
// respaldo cuando la cotizacion no trae una fecha legible.
function rangoFechas() {
  const hasta = new Date();
  const desde = new Date(hasta);
  desde.setFullYear(desde.getFullYear() - 2);
  return { desde: fmt(desde), hasta: fmt(hasta) };
}

// Ventana de lectura de una cotizacion (#508): el pedido nace de la cotizacion,
// asi que no puede ser muy anterior a ella. El margen cubre lo medido el
// 2026-10-02 sobre las 43 ligas reales (la peor, la 1275, con el pedido 3 dias
// ANTES de la fecha del registro) y deja a una cotizacion reciente en una o dos
// paginas del listado en vez de las ~29 de dos anios.
const MARGEN_VENTANA_DIAS = 60;
function ventanaDeCotizacion(op) {
  const fecha = new Date(op?.fecha);
  if (Number.isNaN(fecha.getTime())) return rangoFechas();
  const hasta = new Date();
  const desde = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate() - MARGEN_VENTANA_DIAS));
  return { desde: fmt(desde < hasta ? desde : hasta), hasta: fmt(hasta) };
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

const texto = (v) => (v == null ? '' : String(v).trim());

// Construye el espejo de la cadena Operam (issue #67, AC3) a partir de las
// transacciones y pedidos YA FILTRADOS a los pedidos de la cotizacion (binding
// preciso). Es el reflejo de la cadena post-venta para trazabilidad en la tarjeta:
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

// Pagina una lectura de Operam (transacciones/pedidos) hasta agotarla. La API
// devuelve 100 por pagina: un cliente con mas de 100 transacciones (el generico,
// 728 reales) tiene la cadena del pedido objetivo en una pagina posterior, y leer
// solo la primera la pierde (issue #76). El corte natural (pagina < 100) deja a
// un cliente normal en 1 sola lectura. Pasa { ...args, skip, limit } al lector
// para que el memo del backfill pueda cachear por pagina.
const LIMIT_PAGINA = 100;
async function leerTodo(lector, args) {
  let todo = [];
  for (let skip = 0; ; skip += LIMIT_PAGINA) {
    const pagina = await aSuRitmo(() => lector({ ...args, skip, limit: LIMIT_PAGINA }));
    const lista = Array.isArray(pagina) ? pagina : [];
    todo = todo.concat(lista);
    if (lista.length < LIMIT_PAGINA) break;
  }
  return todo;
}

// Las lecturas de un LOTE (#508): el listado de pedidos se barre una vez por
// ventana y se comparte entre las cotizaciones del lote; si una cotizacion pide
// una ventana que empieza antes, solo se lee el tramo que falta. Cada
// reconciliacion suelta crea las suyas; el webhook y la ruta masiva, una por
// corrida.
export function crearLecturas(deps = {}) {
  const _listarTransacciones = deps.listarTransacciones || listarTransacciones;
  const _listarPedidos = deps.listarPedidos || listarPedidos;
  let barrida = null;

  async function pedidos({ desde, hasta }) {
    if (barrida && barrida.desde <= desde) return [...barrida.porOrder.values()];
    const leidos = await leerTodo(_listarPedidos, { desde, hasta: barrida ? barrida.desde : hasta });
    const porOrder = barrida ? barrida.porOrder : new Map();
    for (const p of leidos) {
      if (p && p.order_no != null && !porOrder.has(String(p.order_no))) porOrder.set(String(p.order_no), p);
    }
    barrida = { desde, porOrder };
    return [...porOrder.values()];
  }

  function transacciones(customerId, { desde, hasta }) {
    return leerTodo(_listarTransacciones, { customerId, desde, hasta });
  }

  return { pedidos, transacciones };
}

// Por que una reconciliacion no hizo nada (#507). "Sin pedido propio" (la
// cotizacion no tiene en Operam un pedido que sea SUYO) no es lo mismo que "sin
// cambios" (lo tiene y la tarjeta ya refleja sus hechos). Una salida (#508) no se
// mueve: ni se lee Operam.
export const MOTIVO_SIN_PEDIDO_PROPIO = 'sin-pedido-propio';
export const MOTIVO_SIN_CAMBIOS = 'sin-cambios';
export const MOTIVO_SALIDA = 'salida';

// Lee Operam y devuelve la cadena PROPIA de la oportunidad, o el motivo por el que
// no la hay: { hechos, espejo, pedido, pedidos, cliente } o { motivo }. Busca los
// pedidos por documento (pedidosDeLaCotizacion) y lee las transacciones con el
// cliente de ESOS pedidos (factura 10 -> pago; remision 13 -> tieneRemision),
// filtradas a sus order_. Sin pedido propio no hay hechos (#507): las ventas de
// OTRAS cotizaciones del cliente no dicen nada de esta.
export async function leerCadenaPropia(op, deps = {}) {
  const folio = folioDeOportunidad(op);
  const explicito = orderExplicito(op);
  // Sin pedido explicito ni folio ningun pedido puede ser suyo: ni se lee Operam.
  if (explicito == null && folio == null) return { motivo: MOTIVO_SIN_PEDIDO_PROPIO };

  const lecturas = deps.lecturas || crearLecturas(deps);
  const ventana = ventanaDeCotizacion(op);
  const cadena = pedidosDeLaCotizacion(await lecturas.pedidos(ventana), { folio, explicito });
  if (!cadena) return { motivo: MOTIVO_SIN_PEDIDO_PROPIO };

  const orders = new Set(cadena.pedidos.map(p => texto(p.order_no)));
  const clientes = [...new Set(cadena.pedidos.map(p => texto(p.debtor_no)).filter(Boolean))];
  // En un lote la barrida puede traer un pedido anterior a la ventana propia (lo
  // leyo otra cotizacion mas vieja): su cadena se lee desde la fecha del pedido.
  const fechas = cadena.pedidos.map(p => texto(p.ord_date).slice(0, 10)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const desdeCadena = [ventana.desde, ...fechas].sort()[0];
  let transacciones = [];
  for (const cliente of clientes) {
    transacciones = transacciones.concat(await lecturas.transacciones(cliente, { ...ventana, desde: desdeCadena }));
  }
  const transFiltradas = transacciones.filter(t => t && orders.has(texto(t.order_)));

  const hechos = hechosDesdeOperam(transFiltradas);
  // El pedido (Sales Order, tipo 30) lo manda listar_pedidos, fuente autoritativa.
  hechos.tienePedido = true;
  return {
    hechos,
    espejo: construirEspejoOperam(transFiltradas, cadena.pedidos, folio),
    pedido: texto(cadena.principal.order_no),
    pedidos: [...orders],
    cliente: texto(cadena.principal.debtor_no) || null,
  };
}

// Los hechos de la cadena propia, o null si la oportunidad no tiene pedido propio.
// Lo consume el backfill historico (#76).
export async function hechosDeOperam(op, deps = {}) {
  const { hechos } = await leerCadenaPropia(op, deps);
  return hechos || null;
}

const ETAPA_SIN_CAPTURA = 'seguimiento';

// El plan de reconciliacion de una oportunidad (#508): SOLO lecturas. Dice el
// pedido que encontro, la etapa antes y despues, las banderas que cambiarian y,
// cuando la etapa no cambia, el motivo. El modo en seco lo devuelve tal cual y
// aplicarReconciliacion escribe exactamente eso. Una salida no lee Operam.
export async function planearReconciliacion(op, deps = {}) {
  const etapaAntes = op?.etapa || ETAPA_SIN_CAPTURA;
  if (esSalida(op?.etapa)) {
    return { etapaAntes, etapaDespues: etapaAntes, banderas: [], motivo: MOTIVO_SALIDA };
  }
  const cadena = await leerCadenaPropia(op, deps);
  if (!cadena.hechos) {
    return { etapaAntes, etapaDespues: etapaAntes, banderas: [], motivo: cadena.motivo };
  }

  // Pago sin registrar (#77): se persiste SIEMPRE con la cadena propia, para que un
  // pago posterior lo apague. #486: la marca "hubo anticipo" solo se escribe en
  // true: actualizarDatos es un merge y el pago que liquida la borraria (el espejo
  // ya sobrescribe `anticipo` con `pagado`).
  const datos = {
    pagoSinRegistrar: pagoSinRegistrar(cadena.hechos),
    ...(huboAnticipo(cadena.hechos) ? { huboAnticipo: true } : {}),
  };
  const banderas = Object.entries(datos)
    .map(([campo, despues]) => ({ campo, antes: op?.data?.[campo] === true, despues }))
    .filter(b => b.antes !== b.despues);

  const destino = etapaPostVenta(cadena.hechos, op);
  return {
    pedido: cadena.pedido,
    pedidos: cadena.pedidos,
    cliente: cadena.cliente,
    etapaAntes,
    etapaDespues: destino || etapaAntes,
    banderas,
    espejo: cadena.espejo,
    espejoAntes: op?.data?.espejoOperam ?? null,
    datos,
    destino,
    ...(destino ? {} : { motivo: MOTIVO_SIN_CAMBIOS }),
  };
}

// Escribe un plan de planearReconciliacion: el espejo (#67, AC3, aunque la etapa
// no cambie: la trazabilidad de folios vale por si misma), las banderas y, si hay
// destino, la etapa con su evento. Sin cadena propia no escribe nada (#507). El
// nucleo ya respeto el gate de #61 y la monotonia al planear. Devuelve si escribio.
export async function aplicarReconciliacion(op, plan, deps = {}) {
  if (!plan || !plan.espejo || op?.id == null) return false;
  const _cambiarEtapa = deps.cambiarEtapa || cotStore.cambiarEtapa;
  const _setEspejoOperam = deps.setEspejoOperam || cotStore.setEspejoOperam;
  const _actualizarDatos = deps.actualizarDatos || cotStore.actualizarDatos;

  await _setEspejoOperam(op.id, plan.espejo);
  await _actualizarDatos(op.id, plan.datos);
  if (plan.destino) {
    await _cambiarEtapa(op.id, plan.destino, {
      tipo: 'sync_operam',
      etapa: plan.destino,
      fecha: new Date().toISOString(),
    });
  }
  return true;
}

// Reconcilia una oportunidad: planea (lee) y aplica (escribe). Devuelve
// { movida, etapa } y, cuando no movio, el `motivo` (#507).
export async function reconciliarOportunidad(op, deps = {}) {
  const plan = await planearReconciliacion(op, deps);
  await aplicarReconciliacion(op, plan, deps);
  if (!plan.destino) return { movida: false, etapa: null, motivo: plan.motivo };
  return { movida: true, etapa: plan.destino };
}

// Reconcilia las oportunidades candidatas que matchean un identificador de webhook
// (issue #62, F3). Identificador = { order, rfc, customerId } (defensivo). Filtra
// las oportunidades activas no terminadas por RFC (la liga robusta) y, si el webhook
// trae order_, prioriza la oportunidad cuyo order_/folio coincide. Reconcilia cada
// candidata con UNA barrida de pedidos para todo el lote (#508). Devuelve los
// resultados. No truena si no hay candidata (responde vacio).
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

  const lote = { ...deps, lecturas: deps.lecturas || crearLecturas(deps) };
  const resultados = [];
  for (const op of candidatas) {
    resultados.push({ id: op.id, ...(await reconciliarOportunidad(op, lote)) });
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

// NOTA (binding por order_, refinado en #67, #507 y #508): el numero de cotizacion
// (folioOperam, #63) NUNCA es igual al numero de pedido en Operam (cotizacion !=
// pedido), por eso el folio NO se compara contra order_ directamente. PERO el
// pedido guarda el folio de su cotizacion de origen en trans_no_from
// (peltre-operam.md 12.2), asi que los pedidos se resuelven con precision buscando
// los que traen trans_no_from === folioOperam en el listado de pedidos, sin filtrar
// por cliente (#508: el cliente del registro no decide). Prioridad:
// data.orderOperam explicito > documento (trans_no_from). Una venta directa
// (trans_no_from vacio) no nace de cotizacion y por eso nunca matchea por
// documento. Sin ninguna de las dos no hay respaldo: el agregado por cliente se
// quito en #507 porque, con varias ventas del mismo cliente, movia la etapa con
// los hechos de otra.
