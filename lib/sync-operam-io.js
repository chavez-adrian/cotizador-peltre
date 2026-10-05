// Motor de reconciliacion del sync post-venta con Operam (issue #62, AC2).
// La capa de IO: lee el estado REAL de Operam (read-only, formato conocido),
// lo normaliza a `hechos` y aplica el nucleo puro (etapaPostVenta) para mover la
// tarjeta. Un aviso de Operam (webhook) es solo una SENAL de que cotizaciones
// mirar (#510, cotizacionesDelAviso); la reconciliacion lee la verdad de la API.
// La misma funcion la usan los avisos, el barrido (#509) y la de UNA cotizacion
// que pide el admin (#508).
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
//   - Un pedido ANULADO en Operam no es pedido propio (#512). La API lo lista igual
//     que uno vivo, con total 0; solo la vista de la web legacy lo dice, y solo se
//     consulta para los candidatos sin total positivo. Si la consulta no se puede
//     hacer, la reconciliacion falla antes de escribir.

import { etapaPostVenta, hechosDesdeOperam, estadoPago, pagoSinRegistrar, huboAnticipo, pedidosDeLaCotizacion, pedidosPorVerificarAnulacion, fechaEntregaDePedido, fechaDespachoDeRemisiones, entregaCompletaDePedido, esRemisionDe, planFechaEntrega } from './sync-operam.js';
import { esSalida } from './pipeline.js';
import { listarTransacciones, listarPedidos, obtenerPedido } from './operam-client.js';
import { abrirSesionWeb, esLoginHtml, estaCanceladoHtml } from './operam-web.js';
import * as cotStore from './cotizaciones-store.js';
import { enTurno, turnoOcupado, TURNO_SYNC_OPERAM, TURNO_FECHAS_ENTREGA } from './turno-barridos.js';
import { AVISO_PEDIDO, AVISO_PAGO, AVISO_REMISION, resultadoDelAviso } from './sync-operam-webhook.js';
import { marcarAviso } from './operam-webhooks-store.js';
import { pedidoEnEspejo } from '../public/js/perdida-logica.js';

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
//   { cotizacion, pedido, fechaEntrega, fechaDespacho, entregaCompleta,
//     factura:{numero,ref}, remisiones[], pago }
// Eslabones ATRIBUIBLES por order_ (peltre-operam.md 12, verificado en vivo): la
// factura (10) y la remision (13) traen el order_ del pedido. Los pagos (12) y notas
// de credito (11) traen order_=0 en el listado (NO atribuibles a un pedido por la
// API), asi que ya quedaron fuera de transFiltradas y NO se listan como folios: el
// estado de PAGO se deriva del allocated de la factura (decision Adrian #67). El
// folio visible de cada eslabon es `reference` (A1907, 2142), no `ref` (inexistente
// en la API). Solo incluye lo que EXISTE (sin factura no pone factura ni pago).
// #534: `detallePrincipal` es el detalle del pedido principal (obtenerPedido); con
// remision del principal da la Fecha de despacho (la de la ultima) y, si el detalle
// es legible, si la entrega esta completa. Sin remision del principal, ninguna.
export function construirEspejoOperam(transFiltradas, pedidosFiltrados, folio, detallePrincipal = null) {
  const lista = Array.isArray(transFiltradas) ? transFiltradas : [];
  const pedidos = Array.isArray(pedidosFiltrados) ? pedidosFiltrados : [];
  const tipo = (t) => num(t.type != null ? t.type : t.trans_type);

  const espejo = { remisiones: [] };
  if (folio != null && folio !== '') espejo.cotizacion = String(folio);

  const pedido = pedidos.find(p => p && p.order_no != null);
  if (pedido) espejo.pedido = String(pedido.order_no);
  // #531: la fecha de entrega es la del MISMO pedido (el principal llega primero).
  const fechaEntrega = pedido ? fechaEntregaDePedido(pedido) : null;
  if (fechaEntrega) espejo.fechaEntrega = fechaEntrega;
  if (pedido && tieneRemisionDe(lista, pedido.order_no)) {
    const fechaDespacho = fechaDespachoDeRemisiones(lista, pedido.order_no);
    if (fechaDespacho) espejo.fechaDespacho = fechaDespacho;
    const completa = entregaCompletaDePedido(detallePrincipal);
    if (completa !== null) espejo.entregaCompleta = completa;
  }

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

function tieneRemisionDe(transacciones, orderNo) {
  return transacciones.some(t => esRemisionDe(t, orderNo));
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
// La anulacion de un pedido (#512) tambien se pregunta una sola vez por lote, con
// una sola sesion web; la respuesta que fallo no se guarda, asi otra cotizacion del
// lote que tenga el mismo pedido vuelve a preguntar en vez de heredar el error.
export function crearLecturas(deps = {}) {
  const _listarTransacciones = deps.listarTransacciones || listarTransacciones;
  const _listarPedidos = deps.listarPedidos || listarPedidos;
  const _abrirSesionWeb = deps.abrirSesionWeb || abrirSesionWeb;
  const _obtenerPedido = deps.obtenerPedido || obtenerPedido;
  let barrida = null;
  let consultarWeb = null;
  const anulacion = new Map();

  // La sesion se abre (login) y la sonda se verifica en fila con las demas lecturas.
  function sesionWeb() {
    if (!consultarWeb) {
      consultarWeb = (async () => {
        const consultar = await aSuRitmo(() => _abrirSesionWeb());
        const sonda = await aSuRitmo(() => consultar(SONDA_ANULADO, TIPO_PEDIDO));
        if (!estaCanceladoHtml(sonda)) {
          throw new Error(`La sonda de anulacion (pedido ${SONDA_ANULADO}, anulado en Operam) no salio anulada: no se puede saber si un pedido esta anulado`);
        }
        return consultar;
      })();
      consultarWeb.catch(() => { consultarWeb = null; });
    }
    return consultarWeb;
  }

  function anulado(orderNo) {
    const clave = String(orderNo);
    if (!anulacion.has(clave)) {
      const pregunta = (async () => {
        const consultar = await sesionWeb();
        const html = await aSuRitmo(() => consultar(clave, TIPO_PEDIDO));
        if (!html || esLoginHtml(html)) {
          throw new Error(`No se pudo leer en la web de Operam si el pedido ${clave} esta anulado`);
        }
        return estaCanceladoHtml(html);
      })();
      anulacion.set(clave, pregunta);
      pregunta.catch(() => anulacion.delete(clave));
    }
    return anulacion.get(clave);
  }

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

  // Los pedidos de UN Cliente Operam (#510, el aviso de Pago). El filtro de Operam
  // no esta medido: se vuelve a filtrar aqui, asi que si lo ignorara el resultado
  // seria el mismo, solo mas caro.
  async function pedidosDelCliente(debtorNo, { desde, hasta }) {
    const leidos = await leerTodo(_listarPedidos, { debtorNo, desde, hasta });
    return leidos.filter(p => p && texto(p.debtor_no) === String(debtorNo));
  }

  // El detalle de UN pedido (#534: sus partidas con quantity y qty_sent).
  function detallePedido(orderNo) {
    return aSuRitmo(() => _obtenerPedido(orderNo));
  }

  // El backfill no scrapea en runtime (#76): trae la lista de data/cancelados.json.
  if (deps.anuladosConocidos) {
    const conocidos = new Set([...deps.anuladosConocidos].map(String));
    return { pedidos, pedidosDelCliente, transacciones, detallePedido, anulado: async (orderNo) => conocidos.has(String(orderNo)) };
  }
  return { pedidos, pedidosDelCliente, transacciones, detallePedido, anulado };
}

// La vista de FA que dice si un pedido esta anulado es la del tipo 30 (pedido). La
// sonda es un pedido anulado conocido, la misma de scripts/detectar-cancelados.mjs:
// si deja de salir anulada, cambio el texto de la web o la sesion no sirve, y sin
// ella todo pedido saldria "vivo" en silencio.
const TIPO_PEDIDO = 30;
const SONDA_ANULADO = '5960';

// Por que una reconciliacion no hizo nada (#507). "Sin pedido propio" (la
// cotizacion no tiene en Operam un pedido que sea SUYO) no es lo mismo que "sin
// cambios" (lo tiene y la tarjeta ya refleja sus hechos). Una salida (#508) no se
// mueve: ni se lee Operam.
export const MOTIVO_SIN_PEDIDO_PROPIO = 'sin-pedido-propio';
export const MOTIVO_SIN_CAMBIOS = 'sin-cambios';
export const MOTIVO_SALIDA = 'salida';
// #512: tenia pedido por documento (o explicito), pero todos estan anulados.
export const MOTIVO_PEDIDO_ANULADO = 'pedido-anulado';

// Los pedidos PROPIOS de la cotizacion: la liga por documento (ADR-0021) sin los
// anulados (#512). La comparten la reconciliacion y la carga de la fecha de
// entrega (#531), para que las dos liguen con la misma regla.
async function pedidosPropios(op, lecturas) {
  const folio = folioDeOportunidad(op);
  const explicito = orderExplicito(op);
  const listado = await lecturas.pedidos(ventanaDeCotizacion(op));
  const anulados = [];
  for (const orderNo of pedidosPorVerificarAnulacion(listado, { folio, explicito })) {
    if (await lecturas.anulado(orderNo)) anulados.push(orderNo);
  }
  return { listado, anulados, cadena: pedidosDeLaCotizacion(listado, { folio, explicito, anulados }) };
}

// Lee Operam y devuelve la cadena PROPIA de la oportunidad, o el motivo por el que
// no la hay: { hechos, espejo, pedido, pedidos, cliente, anulados } o { motivo,
// anulados }. Busca los pedidos por documento (pedidosDeLaCotizacion), deja fuera
// los anulados (#512) y lee las transacciones con el cliente de ESOS pedidos
// (factura 10 -> pago; remision 13 -> tieneRemision), filtradas a sus order_. Sin
// pedido propio no hay hechos (#507): las ventas de OTRAS cotizaciones del cliente
// no dicen nada de esta. Un explicito anulado (la 861 guarda el 7321) no se
// reescribe aqui -- es reparacion de datos (#511) --, asi que cada lote lo vuelve a
// preguntar. #534: si el pedido principal ya tiene remision, lee tambien su detalle
// (una lectura mas) para saber si la entrega esta completa, ANTES de escribir nada.
export async function leerCadenaPropia(op, deps = {}) {
  return leerCadena(op, deps, true);
}

async function leerCadena(op, deps, conDetalle) {
  const folio = folioDeOportunidad(op);
  const explicito = orderExplicito(op);
  // Sin pedido explicito ni folio ningun pedido puede ser suyo: ni se lee Operam.
  if (explicito == null && folio == null) return { motivo: MOTIVO_SIN_PEDIDO_PROPIO, anulados: [] };

  const lecturas = deps.lecturas || crearLecturas(deps);
  const ventana = ventanaDeCotizacion(op);
  const { listado, anulados, cadena } = await pedidosPropios(op, lecturas);
  if (!cadena) {
    // "Anulado" solo si habia liga y la quitaron los anulados; si no, no se encontro.
    const habiaLiga = anulados.length > 0 && pedidosDeLaCotizacion(listado, { folio, explicito }) != null;
    return { motivo: habiaLiga ? MOTIVO_PEDIDO_ANULADO : MOTIVO_SIN_PEDIDO_PROPIO, anulados };
  }

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
  const detalle = conDetalle && tieneRemisionDe(transFiltradas, cadena.principal.order_no)
    ? await lecturas.detallePedido(cadena.principal.order_no)
    : null;
  return {
    hechos,
    espejo: construirEspejoOperam(transFiltradas, cadena.pedidos, folio, detalle),
    pedido: texto(cadena.principal.order_no),
    pedidos: [...orders],
    cliente: texto(cadena.principal.debtor_no) || null,
    anulados,
  };
}

// Los hechos de la cadena propia, o null si la oportunidad no tiene pedido propio.
// Lo consume el backfill historico (#76), que no usa el espejo: no lee el detalle.
export async function hechosDeOperam(op, deps = {}) {
  const { hechos } = await leerCadena(op, deps, false);
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
    return { etapaAntes, etapaDespues: etapaAntes, banderas: [], anulados: cadena.anulados, motivo: cadena.motivo };
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
    anulados: cadena.anulados,
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

// Reconcilia un lote de cotizaciones con UNA barrida de pedidos para todo el lote
// (#508). La que falla (Operam o la web caidas, #512) sale con su error y sin
// escrituras; las demas siguen.
export async function reconciliarLote(oportunidades, deps = {}) {
  const lote = { ...deps, lecturas: deps.lecturas || crearLecturas(deps) };
  const resultados = [];
  for (const op of oportunidades || []) {
    try {
      resultados.push({ id: op.id, ...(await reconciliarOportunidad(op, lote)) });
    } catch (err) {
      resultados.push({ id: op.id, movida: false, etapa: null, error: err.message });
    }
  }
  return resultados;
}

// La ventana de lectura que cubre a todas: la de la cotizacion mas antigua.
function ventanaMasAmplia(oportunidades) {
  return oportunidades.map(ventanaDeCotizacion).sort((a, b) => (a.desde < b.desde ? -1 : a.desde > b.desde ? 1 : 0))[0];
}

// El pedido que el cotizador YA conoce de una cotizacion: el explicito o el que el
// sync anoto en el espejo (la regla de tienePedidoAsociado, #502).
function conPedidoConocido(op) {
  return orderExplicito(op) != null || pedidoEnEspejo(op);
}

// Las cotizaciones que reconcilia un aviso de Operam (#510). Nada se elige por RFC:
//   - Pedido: la cotizacion activa cuyo folio es el documento de origen del pedido
//     (`trans_no_from`). Una venta directa no trae documento: ninguna.
//   - Pago: las activas con un pedido DE ESE CLIENTE en Operam (un pago no dice a
//     que pedido pertenece). Por el Cliente Operam, no por el RFC: con el RFC
//     generico de mostrador elegiria las de otros clientes. Sin cliente, ninguna.
//   - Remision: el aviso es solo un numero; las activas que ya tienen pedido.
// Cada una se reconcilia por su documento como siempre: la que no tiene pedido
// propio no se escribe (#507).
export async function cotizacionesDelAviso(aviso, oportunidades, deps = {}) {
  const activas = candidatasDelBarrido(oportunidades);
  if (aviso?.tipo === AVISO_PEDIDO) {
    if (!aviso.documento) return [];
    return activas.filter(op => folioDeOportunidad(op) === aviso.documento);
  }
  if (aviso?.tipo === AVISO_REMISION) return activas.filter(conPedidoConocido);
  if (aviso?.tipo === AVISO_PAGO) {
    if (!aviso.cliente || activas.length === 0) return [];
    const lecturas = deps.lecturas || crearLecturas(deps);
    const delCliente = await lecturas.pedidosDelCliente(aviso.cliente, ventanaMasAmplia(activas));
    return activas.filter(op => pedidosDeLaCotizacion(delCliente, { folio: folioDeOportunidad(op), explicito: orderExplicito(op) }) != null);
  }
  return [];
}

// Elige y reconcilia las cotizaciones de un aviso, con una barrida para todo el
// aviso. Lanza si no pudo elegir (los pedidos del cliente del pago no se leyeron).
export async function reconciliarAviso(aviso, oportunidades, deps = {}) {
  const lote = { ...deps, lecturas: deps.lecturas || crearLecturas(deps) };
  return reconciliarLote(await cotizacionesDelAviso(aviso, oportunidades, lote), lote);
}

// La fila de los avisos (#510): la ruta responde a Operam al instante y la
// atencion sigue aqui, un aviso detras de otro (las lecturas van ademas al ritmo
// de siempre, aSuRitmo). Al terminar anota en el log como quedo: un fallo deja la
// fila en `error` para que el reenvio se vuelva a atender. ASUME UNA SOLA
// INSTANCIA (la fila vive en memoria; un deploy a media fila pierde lo pendiente y
// lo recoge el barrido, #509).
let filaAvisos = Promise.resolve();

export function encolarAviso(aviso, deps = {}) {
  const _listarCotizaciones = deps.listarCotizaciones || cotStore.listar;
  const _marcarAviso = deps.marcarAviso || marcarAviso;
  const atencion = filaAvisos.then(async () => {
    let resultados = [];
    let error = null;
    try {
      resultados = await reconciliarAviso(aviso, await _listarCotizaciones(), deps);
    } catch (err) {
      error = err.message;
    }
    const final = resultadoDelAviso(resultados, error);
    if (!final.ok) console.error(`[webhook][operam] ${aviso.clave}: ${final.resultado}`);
    try {
      await _marcarAviso(aviso.clave, final);
    } catch (err) {
      console.error(`[webhook][operam] no se pudo anotar ${aviso.clave}:`, err.message);
    }
    return { ...final, resultados };
  });
  filaAvisos = atencion.catch(() => {});
  return atencion;
}

// Seam de prueba: espera a que la fila de avisos se vacie.
export function _esperarAvisos() {
  return filaAvisos;
}

// Una oportunidad es candidata a reconciliacion post-venta si esta activa (no es
// salida: esSalida de pipeline.js) y aun no llego a la ultima etapa (producto_entregado):
// reconciliar las terminadas no aporta y la monotonia ya las dejaria quietas.
// producto_entregado es la ultima etapa, PERO una entregada-impaga (issue #77) sigue
// siendo candidata: su pago se registra con dias de desfase y ese sync posterior debe
// poder apagar el flag pagoSinRegistrar (limpiar el badge). Ya pagada (flag false o
// ausente) si es terminal. #484: la Cancelada tiene pedido y Operam puede seguir
// registrando pagos o remisiones, pero como toda salida el sync no la mueve.
// #534: tampoco es terminal la Entregada parcialmente (`entregaCompleta` false):
// la remision que falta tiene que poder completarla; ni la que tiene fecha de
// despacho sin completitud (el detalle no se pudo medir). Sin ninguna de las dos
// llaves (espejo anterior a #534) sigue terminal; la carga de fechas las pone.
export function esActivaPostVentaCandidata(op) {
  if (op == null) return false;
  if (esSalida(op.etapa)) return false;
  if (op.etapa === 'producto_entregado') return op.data?.pagoSinRegistrar === true || entregaSinCompletar(op.data?.espejoOperam);
  return true;
}

function entregaSinCompletar(espejo) {
  if (!espejo) return false;
  return espejo.entregaCompleta === false || (espejo.fechaDespacho != null && typeof espejo.entregaCompleta !== 'boolean');
}

// --- El barrido (#509): la red de seguridad que no depende de los avisos ---
//
// Lee los pedidos de Operam UNA vez por corrida -- desde la ventana de la candidata
// mas antigua -- y con esa barrida liga por documento todas las candidatas; solo las
// que tienen pedido leen su cadena. Sin filtro de RFC: la mitad de los registros ya
// no lo guarda (#506). La candidata sin folio ni pedido explicito no puede ligar y se
// queda fuera (una PRE vieja estiraria la barrida). El error de una cotizacion queda
// en `errores` y no cuenta como revisada; las demas siguen. En seco devuelve el plan
// sin escribir. Comparte turno con el barrido de post-fixes del quote
// (lib/turno-barridos.js) y lee al ritmo de siempre (aSuRitmo). La ultima corrida y
// la ultima APLICADA (un seco no la borra) viven en memoria: se pierden con cada
// deploy. ASUME UNA SOLA INSTANCIA.

let ultimaCorrida = null;
let ultimaAplicada = null;
let corridaEnMarcha = Promise.resolve();

export function candidatasDelBarrido(cotizaciones) {
  return (Array.isArray(cotizaciones) ? cotizaciones : [])
    .filter(op => esActivaPostVentaCandidata(op) && (folioDeOportunidad(op) != null || orderExplicito(op) != null));
}

export function ultimoBarridoSync() {
  return { ultima: ultimaCorrida, ultimaAplicada };
}

export function barridoSyncEnCurso() {
  return turnoOcupado(TURNO_SYNC_OPERAM);
}

// Seam de prueba: la corrida que arranco la ruta en segundo plano.
export function _esperarBarridoSync() {
  return corridaEnMarcha;
}

export function barrerSyncOperam({ seco = false } = {}, deps = {}) {
  if (barridoSyncEnCurso()) return Promise.resolve({ omitido: true });
  const corrida = enTurno(TURNO_SYNC_OPERAM, async () => {
    const resultado = await correrBarrido(seco === true, deps);
    ultimaCorrida = resultado;
    if (!resultado.seco) ultimaAplicada = resultado;
    return resultado;
  });
  corridaEnMarcha = corrida.catch(() => {});
  return corrida;
}

async function correrBarrido(seco, deps) {
  const _listarCotizaciones = deps.listarCotizaciones || cotStore.listar;
  const resultado = {
    seco, inicio: new Date().toISOString(), fin: null,
    revisadas: 0, ligadas: 0, movidas: 0, sinPedido: 0, plan: [], errores: [],
  };
  const terminar = () => {
    resultado.fin = new Date().toISOString();
    const { plan, errores, ...resumen } = resultado;
    console.log(`[sync-operam] barrido terminado: ${JSON.stringify({ ...resumen, errores: errores.length })}`);
    return resultado;
  };

  const lote = { ...deps, lecturas: deps.lecturas || crearLecturas(deps) };
  let candidatas;
  try {
    candidatas = candidatasDelBarrido(await _listarCotizaciones());
    console.log(`[sync-operam] barrido${seco ? ' en seco' : ''} iniciado: ${candidatas.length} cotizacion(es) candidata(s)`);
    if (candidatas.length) await lote.lecturas.pedidos(ventanaMasAmplia(candidatas));
  } catch (err) {
    resultado.error = err.message;
    console.error('[sync-operam] barrido: no se pudieron leer las cotizaciones o los pedidos de Operam:', err.message);
    return terminar();
  }

  for (const op of candidatas) {
    const folio = folioDeOportunidad(op);
    let plan;
    try {
      plan = await planearReconciliacion(op, lote);
    } catch (err) {
      resultado.errores.push({ id: op.id, folio, error: err.message });
      continue;
    }
    resultado.revisadas++;
    if (plan.pedido) resultado.ligadas++;
    else if (plan.motivo === MOTIVO_SIN_PEDIDO_PROPIO) resultado.sinPedido++;

    const anulados = plan.anulados || [];
    const fila = (plan.pedido || anulados.length) ? {
      id: op.id, folio, pedido: plan.pedido ?? null, pedidos: plan.pedidos ?? [], cliente: plan.cliente ?? null,
      anulados, etapaAntes: plan.etapaAntes, etapaDespues: plan.etapaDespues, motivo: plan.motivo ?? null,
      banderas: plan.banderas,
    } : null;
    if (fila) resultado.plan.push(fila);

    if (seco) {
      if (plan.destino) resultado.movidas++;
      continue;
    }
    if (!plan.espejo) continue;
    try {
      await aplicarReconciliacion(op, plan, lote);
      if (fila) fila.escrito = true;
      if (plan.destino) resultado.movidas++;
    } catch (err) {
      if (fila) fila.escrito = false;
      resultado.errores.push({ id: op.id, folio, error: 'No se pudo guardar la reconciliacion: ' + err.message });
    }
  }
  return terminar();
}

// --- La carga de la fecha de entrega (#531, #534) ---
//
// Desde #531 el sync guarda la fecha de entrega del pedido principal en el espejo,
// pero solo al reconciliar, y el barrido salta Producto entregado ya pagado: las
// cotizaciones que YA tenian pedido se quedarian sin fecha. La carga las llena una
// vez. Lee la cadena con la misma regla del sync (leerCadenaPropia: liga por
// documento sin los anulados de #512, transacciones y, con remision, el detalle del
// pedido) y escribe SOLO las llaves de la entrega en `data.espejoOperam` -- la
// Fecha compromiso de despacho (`fechaEntrega`) y, desde #534, la Fecha de despacho
// y si la entrega esta completa -- (setEntregaPedido): ni etapa, ni el resto del
// espejo, ni banderas. Candidatas: toda cotizacion que no sea salida y tenga folio o
// pedido explicito, Producto entregado incluido. En seco (el default) devuelve el
// plan sin escribir. Comparte el turno de los barridos largos para no juntarse
// con ellos (el 429 de #509) y la ultima corrida vive en memoria.

let ultimaCarga = null;
let cargaEnMarcha = Promise.resolve();

export function candidatasFechaEntrega(cotizaciones) {
  return (Array.isArray(cotizaciones) ? cotizaciones : [])
    .filter(op => op && !esSalida(op.etapa) && (folioDeOportunidad(op) != null || orderExplicito(op) != null));
}

export function ultimaCargaFechasEntrega() {
  return ultimaCarga;
}

export function cargaFechasEntregaEnCurso() {
  return turnoOcupado(TURNO_FECHAS_ENTREGA);
}

export function cargarFechasEntrega({ seco = true } = {}, deps = {}) {
  if (cargaFechasEntregaEnCurso()) return Promise.resolve({ omitido: true });
  const carga = enTurno(TURNO_FECHAS_ENTREGA, async () => {
    const resultado = await correrCargaFechasEntrega(seco !== false, deps);
    ultimaCarga = resultado;
    return resultado;
  });
  cargaEnMarcha = carga.catch(() => {});
  return carga;
}

// Seam de prueba: la carga que arranco la ruta en segundo plano.
export function _esperarCargaFechasEntrega() {
  return cargaEnMarcha;
}

async function correrCargaFechasEntrega(seco, deps) {
  const _listarCotizaciones = deps.listarCotizaciones || cotStore.listar;
  const _setEntregaPedido = deps.setEntregaPedido || cotStore.setEntregaPedido;
  const lecturas = deps.lecturas || crearLecturas(deps);
  const resultado = {
    seco, inicio: new Date().toISOString(), fin: null, escritas: 0,
    resumen: { revisadas: 0, escribir: 0, igual: 0, sinFecha: 0, sinPedido: 0 },
    plan: [], errores: [],
  };
  const terminar = () => {
    resultado.fin = new Date().toISOString();
    console.log(`[fechas-entrega] carga${seco ? ' en seco' : ''} terminada: ${JSON.stringify({ ...resultado.resumen, escritas: resultado.escritas, errores: resultado.errores.length })}`);
    return resultado;
  };

  let candidatas;
  try {
    candidatas = candidatasFechaEntrega(await _listarCotizaciones());
    if (candidatas.length) await lecturas.pedidos(ventanaMasAmplia(candidatas));
  } catch (err) {
    resultado.error = err.message;
    console.error('[fechas-entrega] no se pudieron leer las cotizaciones o los pedidos de Operam:', err.message);
    return terminar();
  }

  const conteo = { escribir: 'escribir', igual: 'igual', 'sin-fecha': 'sinFecha', 'sin-pedido': 'sinPedido' };
  for (const op of candidatas) {
    const folio = folioDeOportunidad(op);
    let plan;
    try {
      const cadena = await leerCadenaPropia(op, { lecturas });
      plan = planFechaEntrega(op, cadena.pedido, cadena.espejo ?? null);
    } catch (err) {
      resultado.errores.push({ id: op.id, folio, error: err.message });
      continue;
    }
    resultado.resumen.revisadas++;
    resultado.resumen[conteo[plan.accion]]++;
    if (plan.accion === 'sin-pedido') continue;

    const fila = { id: op.id, folio, etapa: op.etapa ?? null, ...plan };
    resultado.plan.push(fila);
    if (seco || plan.accion !== 'escribir') continue;
    try {
      await _setEntregaPedido(op.id, plan.campos);
      fila.escrito = true;
      resultado.escritas++;
    } catch (err) {
      fila.escrito = false;
      resultado.errores.push({ id: op.id, folio, error: 'No se pudo guardar la fecha de entrega: ' + err.message });
    }
  }
  return terminar();
}

// La programacion (#509): nace APAGADO. Con la variable encendida corre una vez al
// dia a una hora FIJA -- 03:00 de la Ciudad de Mexico, 09:00 UTC (sin horario de
// verano desde 2022) --, no al arrancar: Render redespliega main varias veces al dia
// y un timer contado desde el arranque correria en cada deploy.
export const VARIABLE_BARRIDO_DIARIO = 'SYNC_OPERAM_BARRIDO_DIARIO';
const HORA_UTC_BARRIDO = 9;
const DIA_MS = 24 * 3600 * 1000;

export function barridoDiarioEncendido(env) {
  return /^(1|true|si|on)$/i.test(String(env?.[VARIABLE_BARRIDO_DIARIO] ?? '').trim());
}

export function msHastaProximoBarrido(ahora) {
  const proxima = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate(), HORA_UTC_BARRIDO));
  if (proxima.getTime() <= ahora.getTime()) proxima.setUTCDate(proxima.getUTCDate() + 1);
  return proxima.getTime() - ahora.getTime();
}

export function programarBarridoSync({ env = process.env, ahora = () => new Date(), setTimeout: _setTimeout = setTimeout, setInterval: _setInterval = setInterval, barrer } = {}) {
  if (!barridoDiarioEncendido(env)) return false;
  _setTimeout(() => {
    barrer();
    _setInterval(barrer, DIA_MS).unref?.();
  }, msHastaProximoBarrido(ahora())).unref?.();
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
