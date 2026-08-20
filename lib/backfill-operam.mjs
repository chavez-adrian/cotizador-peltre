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

// Reusa la regla de pago/etapas del nucleo del sync (#62) en vez de reimplementarla:
// estadoPago('pagado'|'anticipo'|null) por allocated>=total*0.99, y etapaPostVenta
// para derivar la etapa de la tarjeta a partir de los hechos normalizados.
import { estadoPago, etapaPostVenta, pagoSinRegistrar } from './sync-operam.js';

// FUENTE UNICA de los debtors genericos (#127): la lista vive en lib/deduplicacion.js
// (puro, sin IO) y aqui se consulta por el predicado, que normaliza numero/texto -- el
// debtor_no de Operam llega como texto. Antes habia una segunda copia local en strings,
// asi que agregar un debtor-cajon en Operam obligaba a tocar dos archivos.
import { esDebtorGenerico } from './deduplicacion.js';

// Pedidos de prueba/sistema a EXCLUIR siempre (decision #76):
//  - order_no 7270: pedido de la sonda de #67 (no es venta real).
//  - debtor_no 1: cliente de prueba/mostrador -- venta directa de mostrador, sin
//    contraparte nombrada que perseguir.
// El debtor 14 (PUBLICO EN GENERAL) SALIO de esta lista en #201: la auditoria del
// 2026-08-19 lo encontro activo como cajon (factura global de bazar para el SAT,
// segmento e-commerce, contacto "Mercado Libre"), no como mostrador muerto; ahora
// vive en DEBTORS_GENERICOS (lib/deduplicacion.js) y sus quotes siguen el camino
// de cajon (candidato de bandeja), no el descarte de prueba. No re-agregarlo aqui.
// DEBTORS_PRUEBA se exporta para que el descubrimiento recurrente (#126) reuse el
// MISMO set en vez de redefinirlo (mismo trato que DEBTORS_SOCIOS).
const ORDERS_PRUEBA = new Set(['7270']);
export const DEBTORS_PRUEBA = new Set(['1']);

// Socios que aparecen como CLIENTE en Operam (decision Adrian 2026-07-30, #76): son
// vendedores, y sus cotizaciones "personales" son pruebas del cotizador, no
// oportunidades reales. Verificados en vivo contra la API: 9 (Raul Alejandro Chavez
// Rosete), 15 (Adrian Chavez Rosete), 132 (Oswaldo Chavez Rosete) -- los tres en
// segmento "Familia y Amigos".
export const DEBTORS_SOCIOS = new Set(['9', '15', '132']);

// Folios de QUOTES de prueba a EXCLUIR en el id-walk de la parte B (#76): las
// cotizaciones nativas creadas durante los HITL #67/#68 sobre PUBLICO EN GENERAL
// (peltre-operam.md 12.6: quotes 1157-1163). No son cotizaciones reales de cliente.
const FOLIOS_PRUEBA = new Set(['1157', '1159', '1160', '1161', '1162', '1163']);

// Folios excluidos MANUALMENTE por Adrian (revision del dry-run en vivo, 2026-07-30):
// quotes de prueba/uso interno identificados fila por fila, sin patron programatico
// (no son de un debtor generico/socio ni del set FOLIOS_PRUEBA de los HITL #67/#68).
// 1195 = "PRUEBA POST-FIX VIGENCIA 106 - BORRAR"; 1196 y 1189 = cotizaciones $0 sin
// contexto. (1198/1199/1200/1204 eran de los socios como cliente -- ahora los cubre
// DEBTORS_SOCIOS, no se duplican aqui.) 1129 (revision en vivo 2026-07-31) = cotizacion
// re-emitida de FORTMCK19-16 PERLA (mismo monto que la 1084, excluida por la heuristica
// de variante cerrada); Adrian confirmo que el cliente ya cerro -- el pedido quedo fuera
// de la ventana respecto a ESTA re-emision, asi que no la cierra la heuristica y hay que
// excluirla a mano. Aplica en AMBAS partes: la B (id-walk, donde se detectaron) y la A
// (por si alguno se convirtio en pedido despues).
export const FOLIOS_EXCLUIDOS_MANUAL = new Set(['1189', '1195', '1196', '1129']);

function strOrNull(v) {
  return v != null && v !== '' ? String(v) : null;
}

// Primer valor no vacio (ni null/undefined ni cadena vacia), o '' si todos lo estan.
// Para customer_ref/contacto: el del PEDIDO (vigente) tiene prioridad sobre el del quote
// (que puede quedar con el cliente ORIGINAL tras editar el pedido, visto en 5960).
function primeroNoVacio(...vals) {
  for (const v of vals) if (v != null && v !== '') return v;
  return '';
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

// Una entrega es COMPLETA solo si TODOS los renglones del pedido tienen qty_sent >=
// quantity (#76, caso 6988: 33 de 51 piezas entregadas + pagado 100% se cerraba mal,
// faltando 18 por entregar). El dato vive en el DETALLE del pedido (sales_order/{id});
// ni el listado ni las transacciones lo traen, por eso `tieneRemision` (booleano "hay
// >=1 remision") no basta. Sin renglones devuelve false: no hay evidencia de entrega
// total. planearBackfill usa esto para poner hechos.tieneRemision=false en las entregas
// parciales, de modo que esCerrado no las cierre y etapaBackfill no las marque entregadas.
export function entregaCompleta(detalles) {
  const lista = Array.isArray(detalles) ? detalles : [];
  if (lista.length === 0) return false;
  return lista.every(r => num(r && r.qty_sent) >= num(r && r.quantity));
}

// Partidas del quote -> data.items (decision Adrian 2026-07-29, #76). Sin esto la
// cotizacion importada regeneraba un documento SIN renglones: pdf-generator y
// html-generator leen data.items y GET /api/cotizacion/pdf/:id regenera desde `data`
// (#103). El detalle NO cuesta lecturas extra: viene en la misma respuesta de
// obtenerQuote que ya se pedia por la cabecera.
//
// La forma de salida es la MISMA que arma el cotizador normal (app.js ->
// POST /api/cotizacion): { codigo, descripcion, cantidad, unidad, precio, descuento }.
// Cantidad/precio/descuento se numerizan: los generadores calculan el importe del
// renglon multiplicando (que toleraria strings) pero tambien SUMAN las piezas con
// reduce, y ahi un string concatenaria en vez de sumar.
//
// Los nombres de campo del detalle se leen por ALIAS: la API v3 de Operam no los tiene
// documentados en el repo (peltre-operam.md 12.6 solo confirma que el GET del quote trae
// `detalles[]`), asi que se aceptan las variantes plausibles y el dry-run en vivo
// confirma cual llega de verdad. Defensivo por diseno: un detalle ausente, vacio o con
// basura devuelve [] en vez de tumbar la corrida completa por una cotizacion rara.
//
// Las partidas de ENVIO (SKU de flete 251021001 local / 251021002 foraneo, #68) son
// partidas normales del quote y se conservan TAL CUAL, con su stock_id real: NO se
// traducen al codigo 'ENVIO' del carrito ni se rellena data.envio. El camino de vuelta
// (armarContenidoQuote) re-deriva el SKU de flete a partir del CP de entrega, dato que
// una entrada del backfill no tiene -> traducir a 'ENVIO' haria que un re-envio a Operam
// cayera al SKU foraneo por default aunque el original fuera local.
export function mapearPartidasQuote(detalles) {
  const lista = Array.isArray(detalles) ? detalles : [];
  return lista.filter(Boolean).map(d => ({
    codigo: d.stock_id != null ? String(d.stock_id) : '',
    descripcion: primeroNoVacio(d.stock_id_text, d.description, d.descripcion),
    cantidad: num(d.quantity ?? d.qty),
    unidad: primeroNoVacio(d.units, d.unidad) || 'pza',
    precio: num(d.unit_price ?? d.price),
    descuento: num(d.discount_percent ?? d.Disc ?? d.discount),
  }));
}

// CRITERIO 2 #76 (decision Adrian): un pedido esta CERRADO solo si fue entregado
// TOTALMENTE (hechos.tieneRemision, que planearBackfill pone en false si la entrega es
// PARCIAL via entregaCompleta) Y pagado en su TOTALIDAD (allocated>=total*0.99 via
// estadoPago). Los CERRADOS no se importan (ya no aportan seguirlos). Antes el gate
// excluia cualquier producto_entregado aunque NO estuviera pagado, lo que dejaba
// fuera la cobranza pendiente; ahora el entregado-impago NO es cerrado y SI entra.
// EXCEPCION muestra/cortesia (decision Adrian): un pedido con total<=0 (muestra,
// cortesia) NO se factura, asi que basta la ENTREGA para cerrarlo, SIN exigir pago.
// Un $0 NO entregado sigue activo (muestra pendiente de envio). Para total>0 la regla
// es la de siempre (entregado Y pagado). El `total` viene del pedido del listado;
// ausente o >0 conserva el comportamiento previo (exige pago). Reusa estadoPago.
export function esCerrado(hechos, total) {
  if (!hechos || !hechos.tieneRemision) return false; // sin remision -> nunca cerrado
  if (Number(total) <= 0) return true;                // muestra/cortesia: basta la entrega
  return estadoPago(hechos.pago) === 'pagado';        // venta real: exige pago al 100%
}

// CRITERIO 2 #76 + #77: la etapa de la tarjeta para el backfill. El eje que manda es
// el CUMPLIMIENTO, no la cobranza (decision Adrian #77): un pedido con remision se
// deriva como producto_entregado AUNQUE el pago no este liquidado. Por politica no se
// entrega sin pago completo, asi que un entregado-impago es casi siempre el desfase de
// registro de la contadora, no cobranza real; retroceder la etapa por ese desfase
// mentiria sobre la operacion (oculta que el producto ya salio). La cobranza pendiente
// se marca aparte en data.pagoSinRegistrar (-> badge "Pago sin registrar"), sin tocar la
// etapa. Por eso aqui se usa la etapa post-venta normal (etapaPostVenta, donde la
// senal mas avanzada gana). null de etapaPostVenta (sin hecho post-venta) cae a
// 'seguimiento'. [Antes de #77 el entregado-impago se retrocedia ignorando la remision.]
//
// EXCEPCION $0 (muestra/cortesia, decision Adrian): un pedido con total<=0 NO se
// factura, asi que el PAGO no aplica; ademas, si el cliente usa RFC generico, el
// agregado contamina hechos.pago con pagos de OTROS clientes (binding falso ->
// saldo_pagado erroneo, visto en vivo folio 669). Para $0 la etapa se deriva SOLO de
// la existencia del pedido -> pedido_liberado (o seguimiento si ni eso), ignorando
// pago y remision. Los $0 entregados ya los excluyo esCerrado antes de llegar aqui.
export function etapaBackfill(hechos, op, total) {
  if (Number(total) <= 0) {
    const soloPedido = { tienePedido: !!(hechos && hechos.tienePedido), tieneRemision: false, pago: { allocated: 0, outstanding: 0, total: 0 } };
    return etapaPostVenta(soloPedido, op) || 'seguimiento';
  }
  return etapaPostVenta(hechos, op) || 'seguimiento';
}

// CRITERIO 1 #76 (decision Adrian): importar SOLO la sucursal 01 Tlapacoya;
// descartar Shopify (30), Amazon (31/32) y Bazaar (02). La sucursal NO viaja en el
// payload de la transaccion (verificado en vivo: no hay campo sucursal ni filtro
// server-side), asi que el canal SOLO se infiere por estos marcadores de la tx
// (pedido de listarPedidos o quote de obtenerQuote; ambos traen user/reference/
// from_stk_loc). Devuelve FALSE (excluir) si CUALQUIERA aplica:
//   - user.real_name === 'Shopify'                 -> canal Shopify (30)
//   - reference empieza con S o A (case-insensitive) -> Shopify (S..) o Amazon (A..)
//   - from_stk_loc empieza con B o AZ              -> Bazaar (B1..B4) o Amazon (AZMX/AZUSA)
// Si ninguno aplica -> TRUE (Tlapacoya 01: loc 40, ref numerica/C.., user real). El
// filtro NO es por cliente: un mismo debtor generico (GENERICO TIENDAS DIGITALES)
// tiene tx en 01 y en 30; las de 01 (loc 40, ref C.., vendedor real) SI se importan.
// Campos ausentes NO excluyen (defensivo): sin marcador, se asume Tlapacoya.
export function esSucursalTlapacoya(tx) {
  if (!tx) return true;
  if (tx.user && tx.user.real_name === 'Shopify') return false;
  if (/^[SA]/i.test(String(tx.reference || ''))) return false;
  if (/^(B|AZ)/i.test(String(tx.from_stk_loc || ''))) return false;
  return true;
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

// Normaliza un nombre para comparar sin importar acentos ni mayusculas: minusculas,
// sin diacriticos (NFD descompone la letra de su acento; \p{Diacritic} los quita) y
// trim. El usuario creador de Operam viene SIN acentos ("Adrian Chavez") mientras que
// data/vendedores.json los lleva ("Adrián Chávez"): normalizar ambos lados los iguala.
function normalizarNombre(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().trim();
}

// CRITERIO 1 #76 (decision Adrian): fallback de vendedor por el USUARIO CREADOR de la
// transaccion. Para las tx a cliente generico el `salesman` no mapea ((sin mapear)),
// pero el vendedor real es quien la creo (tx.user.real_name, casi siempre "Alejandro
// Chavez" o "Adrian Chavez", SIN acentos). Compara el real_name normalizado contra
// vendedores[].name normalizado y devuelve el name TAL CUAL del vendedor (con acentos),
// o null si no coincide (no inventa: una tx sin usuario reconocido queda sin vendedor).
export function mapearVendedorPorUsuario(userRealName, vendedores) {
  const objetivo = normalizarNombre(userRealName);
  if (objetivo === '') return null;
  for (const v of vendedores || []) {
    if (v && v.name != null && normalizarNombre(v.name) === objetivo) return v.name;
  }
  return null;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Idempotencia del backfill (decision #76): antes de crear una cotizacion, si ya
// existe una con ese folioOperam en el store (lista de listar()), se SKIP -- no se
// duplica. Re-correr el backfill no genera duplicados. Compara como String
// (folioOperam se persiste como texto). Folio nulo/vacio nunca matchea.
export function folioYaExiste(cotizaciones, folio) {
  const f = strOrNull(folio);
  if (f == null) return false;
  for (const c of cotizaciones || []) {
    if (c && strOrNull(c.folioOperam) === f) return true;
  }
  return false;
}

// Memoiza un lector async por clave para reducir el VOLUMEN de llamadas a Operam
// (issue #76, blocker 429). El backfill re-lee transacciones/pedidos POR candidato
// y muchos candidatos comparten el mismo debtor/RFC -> sin cache se disparan ~840
// lecturas en rafaga y Operam responde 429. Envuelve `lector` y lo invoca UNA sola
// vez por `claveDe(args)`: la PROMESA se cachea (no solo el valor) para que dos
// peticiones concurrentes de la misma clave compartan una unica lectura. Si la
// lectura rechaza, se purga la clave para permitir un reintento posterior.
export function memoizarPorClave(lector, claveDe) {
  const cache = new Map();
  return (...args) => {
    const clave = claveDe(...args);
    if (cache.has(clave)) return cache.get(clave);
    const p = Promise.resolve().then(() => lector(...args));
    cache.set(clave, p);
    p.catch(() => cache.delete(clave));
    return p;
  };
}

// Enumera TODOS los pedidos paginando (limit 100) contra la lectura inyectada
// listarPedidosPagina({ skip, desde, hasta }). Para evitar un loop infinito si la
// API devolviera siempre una pagina llena, corta cuando una pagina trae menos de
// 100 o cuando viene vacia.
async function enumerarPedidos(listarPedidosPagina, desde, hasta) {
  const PAGINA = 100;
  const todos = [];
  for (let skip = 0; ; skip += PAGINA) {
    const pagina = await listarPedidosPagina({ skip, desde, hasta });
    const lista = Array.isArray(pagina) ? pagina : [];
    todos.push(...lista);
    if (lista.length < PAGINA) break;
  }
  return todos;
}

// Orquestacion PURA del backfill (decision #76). Recibe las lecturas de Operam
// (read-only) y el store INYECTADOS para ser testeable sin red:
//   deps.listarPedidosPagina({ skip, desde, hasta }) -> pedidos crudos (tipo 30)
//   deps.obtenerDebtor(debtorNo) -> { debtor_no, CustName, tax_id, curr_code }
//   deps.obtenerQuote(folio)     -> cabecera del quote (GET /sales/quote/{folio})
//   deps.obtenerHechos(op)       -> hechos crudos { pago, tienePedido, tieneRemision }
//                                   (en el script: hechosDeOperam(op,...); CRITERIO 2:
//                                   antes era etapaDe(op) que devolvia la etapa string,
//                                   ahora se devuelven los hechos y la etapa/gate se
//                                   derivan aqui con esCerrado/etapaBackfill).
//   deps.listarCotizaciones()    -> cotizaciones existentes (para idempotencia)
//   deps.vendedores              -> data/vendedores.json
//   deps.desde / deps.hasta      -> rango de fechas del listado
// Devuelve un PLAN sin escribir nada: { importar:[entradas], skips:{...},
// totalPedidos, candidatos }. El script lo imprime en dry-run y, con --apply,
// crea cada entrada del plan. Idempotente: salta los folios ya en el store y los
// que ya planeo en esta misma corrida; salta los CERRADOS (entregado Y pagado al
// 100%, CRITERIO 2); salta las otras sucursales (CRITERIO 1); salta no-candidatos
// (sin leer su quote, lectura barata).
export async function planearBackfill(deps = {}) {
  const {
    listarPedidosPagina, obtenerDebtor, obtenerQuote, obtenerHechos, obtenerDetalle,
    listarCotizaciones, vendedores, desde, hasta, cancelados = [],
  } = deps;

  const pedidos = await enumerarPedidos(listarPedidosPagina, desde, hasta);
  const cotizaciones = (await listarCotizaciones()) || [];
  // Pedidos anulados en Operam (decision Adrian): la API NO expone el estado de
  // cancelacion (ni en el listado ni en el detalle); el set de order_no cancelados viene
  // de data/cancelados.json, generado por scraping de la web legacy
  // (scripts/detectar-cancelados.mjs). Un pedido cancelado no se importa.
  const canceladosSet = new Set([...cancelados].map(String));

  const plan = {
    totalPedidos: pedidos.length,
    candidatos: 0,
    importar: [],
    // Folios que SI se volvieron pedido (TODOS los candidatos, importados o no). La
    // parte B (id-walk) los salta: ya nacieron de una cotizacion ordenada. Incluye
    // los cerrados (no importados) y los duplicados, no solo los importables.
    foliosConPedido: new Set(),
    skips: { noCandidato: 0, otraSucursal: 0, generico: 0, socio: 0, excluidoManual: 0, cerrado: 0, cancelado: 0, duplicado: 0 },
  };
  const folin = new Set(); // folios ya planeados en esta corrida (idempotencia intra-run)

  for (const pedido of pedidos) {
    if (!esCandidatoBackfill(pedido)) { plan.skips.noCandidato++; continue; }
    // CRITERIO 1: el canal se infiere del propio pedido (user/reference/from_stk_loc).
    // Solo Tlapacoya (01) se importa; Shopify/Amazon/Bazaar fuera, con contador propio.
    if (!esSucursalTlapacoya(pedido)) { plan.skips.otraSucursal++; continue; }
    plan.candidatos++;

    const folio = strOrNull(pedido.trans_no_from);
    if (folio != null) plan.foliosConPedido.add(folio);
    // El folio queda en foliosConPedido (arriba) ANTES del filtro de cancelado para que
    // la parte B tampoco lo re-evalue como quote sin pedido: un pedido cancelado nacio de
    // una cotizacion que ya se ordeno, no es un seguimiento vivo.
    // Clientes GENERICOS: fuera del backfill, diferidos a #118 (prospectos). Va DESPUES
    // de registrar el folio en foliosConPedido, por lo mismo que el cancelado.
    const debtorNo = strOrNull(pedido.debtor_no);
    if (esDebtorGenerico(debtorNo)) { plan.skips.generico++; continue; }
    // Socios como cliente (revision Adrian 2026-07-30): son vendedores; sus
    // cotizaciones "personales" son pruebas del cotizador, no oportunidades reales.
    if (debtorNo != null && DEBTORS_SOCIOS.has(debtorNo)) { plan.skips.socio++; continue; }
    // Excluidos manualmente (revision Adrian 2026-07-30): por si un folio marcado en la
    // parte B se convirtio en pedido despues. Mismo patron: folio ya esta en
    // foliosConPedido antes de este skip.
    if (folio != null && FOLIOS_EXCLUIDOS_MANUAL.has(folio)) { plan.skips.excluidoManual++; continue; }
    if (canceladosSet.has(strOrNull(pedido.order_no))) { plan.skips.cancelado++; continue; }
    if (folioYaExiste(cotizaciones, folio) || folin.has(folio)) { plan.skips.duplicado++; continue; }

    const debtor = await obtenerDebtor(pedido.debtor_no);
    const rfc = upper(debtor && debtor.tax_id);

    // Hechos post-venta con binding PRECISO: data.orderOperam = order_no del pedido.
    const opParaEtapa = {
      folioOperam: folio,
      etapa: 'seguimiento',
      data: { cliente: { rfc, customerId: strOrNull(pedido.debtor_no) }, orderOperam: strOrNull(pedido.order_no) },
    };
    let hechos = await obtenerHechos(opParaEtapa);
    // Entrega PARCIAL (#76, caso 6988): una remision NO garantiza entrega TOTAL. Si hay
    // remision se lee el DETALLE del pedido (qty_sent vs quantity, via obtenerDetalle); si
    // la entrega no esta completa, la remision no cuenta para cerrar ni para
    // producto_entregado (tieneRemision=false, en una copia para no mutar el objeto). Sin
    // obtenerDetalle (tests puros) se conserva el comportamiento por tieneRemision.
    if (hechos.tieneRemision && obtenerDetalle) {
      const detalle = await obtenerDetalle(pedido.order_no);
      if (!entregaCompleta(detalle && detalle.detalles)) hechos = { ...hechos, tieneRemision: false };
    }
    // CRITERIO 2: cerrado = entregado (COMPLETO) Y pagado al 100% -> no se importa. El
    // entregado-IMPAGO NO es cerrado: SE importa (cobranza pendiente). La etapa la deriva
    // etapaBackfill. Muestra/cortesia (total<=0): basta la remision para cerrar (no se
    // factura). El total viene del pedido del listado (disponible antes de leer el quote).
    if (esCerrado(hechos, num(pedido.total))) { plan.skips.cerrado++; continue; }
    const etapa = etapaBackfill(hechos, opParaEtapa, num(pedido.total));

    const quote = await obtenerQuote(folio);
    // Eje secundario #77: la cobranza pendiente se marca aparte de la etapa. Se reusa
    // el MISMO predicado que el sync (pagoSinRegistrar de lib/sync-operam.js) sobre los
    // mismos hechos, para que una tarjeta importada y una sincronizada no discrepen.
    // Sin remision es false (no hay entrega que cobrar), asi que la muestra $0 pendiente
    // y la parte B sin pedido quedan sin badge.
    const entrada = construirEntradaCotizacion({
      pedido, quote, debtor, etapa, vendedores, pagoSinRegistrar: pagoSinRegistrar(hechos),
    });
    plan.importar.push(entrada);
    folin.add(folio);
  }
  return plan;
}

// PARTE B (#76, scope revisado): descubre el folio mas alto de quotes probando
// GET /quote/{id} hacia ARRIBA desde `inicio`. Los quotes (tipo 32) no son
// enumerables (no hay lista), asi que el techo del rango se halla caminando. Sube
// de uno en uno: cada folio existente reinicia la racha y mueve el techo; tras
// `maxRacha` 404 consecutivos asume que ya no hay folios mas altos y devuelve el
// ultimo existente. ACOTADO por `limite` probes (nunca corre sin fin, aunque la API
// devolviera siempre 200). Devuelve null si nada existe desde `inicio`. Inyectable
// (obtenerQuote) para test sin red. El techo REAL lo valida el orquestador en vivo.
export async function descubrirFolioMax({ obtenerQuote, inicio, maxRacha = 5, limite = 500 } = {}) {
  let ultimo = null;
  let racha = 0;
  let folio = Number(inicio);
  for (let i = 0; i < limite; i++, folio++) {
    const q = await obtenerQuote(folio);
    if (q) { ultimo = folio; racha = 0; }
    else { racha++; if (racha >= maxRacha) break; }
  }
  return ultimo;
}

// VARIANTE CERRADA (#76, decision Adrian 2026-07-30). Los clientes de mayoreo piden 2-3
// cotizaciones del mismo proyecto y autorizan UNA. El pedido resultante muchas veces NO
// queda ligado por `trans_no_from` (se captura DIRECTO, o con otras piezas/otra
// presentacion), asi que las cotizaciones hermanas sobreviven a todos los filtros de la
// parte B y entran al pipeline como "seguimiento vivo" cuando la compra ya cerro. Nadie
// las va a perseguir: son ruido que le quita credibilidad al tablero.
//
// La senal: un pedido del MISMO cliente, CERCANO en fecha y de monto COMPARABLE. La
// banda es ANCHA a proposito (75% relativo al monto MAYOR entre cotizacion y pedido):
// autorizar 100 de las 250 piezas cotizadas sigue siendo la misma compra. El limite
// inferior lo fija el caso MOTOBLOCK (revision en vivo 2026-07-30): un pedido de
// muestras de $598 contra una cotizacion de $182,093 (0.3% del monto mayor) NO es la
// misma compra -- esa cotizacion DEBE importarse. El caso 1194 (revision en vivo
// 2026-07-31) fijo el limite CONTRARIO: una cotizacion de $6,769.76 con un pedido MAYOR
// de $13,300.56 (dif 96% relativa a la cotizacion, pero 49% relativa al monto mayor) SI
// es la misma compra para el negocio. De ahi que el denominador sea el monto MAYOR entre
// ambos (antes era siempre el de la cotizacion, que sobrestimaba la diferencia -- y por
// lo tanto perdia el cierre -- cuando el pedido crecia por encima de lo cotizado).
//
// La ventana de fecha es ASIMETRICA por CAUSALIDAD (decision Adrian 2026-07-30): primero
// se cotiza y luego se autoriza, asi que un pedido solo cierra cotizaciones ANTERIORES a
// el. Con ventana simetrica, un cliente que RE-cotiza despues de haber comprado perdia su
// oportunidad nueva: ese reorden es justo el seguimiento que mas importa. Hacia atras
// queda una GRACIA corta (3 dias) por desfases de captura (el pedido se registra con
// fecha del dia que se autorizo por telefono, antes de que la cotizacion se documentara).
//
// Da lo mismo si el pedido YA esta ligado a otra cotizacion por trans_no_from: ese es
// justamente el escenario de variantes (se autorizo la hermana), y el pedido cierra a
// todas las de monto comparable. La parte A no se ve afectada: ahi la liga es explicita.
//
// Defensivo: un pedido sin fecha/total o con basura se IGNORA (no truena ni matchea), y
// un pedido de $0 NO cierra nada (una muestra o cortesia no es una compra). Si la
// COTIZACION tiene total <= 0 la heuristica no aplica (sin monto no hay proporcion que
// comparar): esos quotes los filtra la exclusion manual, no esta regla.
export const VENTANA_VARIANTE_DIAS = 31;  // hacia ADELANTE del quote (el pedido lo sigue)
export const GRACIA_VARIANTE_DIAS = 3;    // hacia ATRAS (desfase de captura, no reorden)
export const BANDA_VARIANTE = 0.75;

const MS_POR_DIA = 86400000;

// Fecha (YYYY-MM-DD) -> ms, o null si falta o no parsea. Se corta a 10 chars porque los
// campos de Operam llegan como fecha pura ('2026-05-01') o con hora ('2026-05-01 12:30').
function fechaMs(v) {
  if (v == null || v === '') return null;
  const t = Date.parse(String(v).slice(0, 10));
  return Number.isFinite(t) ? t : null;
}

// Total -> numero, o null si falta o no es numerico. A diferencia de num(), distingue
// "ausente/basura" (null -> se ignora el pedido) de un 0 legitimo.
function totalNum(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// El pedido del cliente que CIERRA esta cotizacion, o null. Devuelve el pedido (no un
// booleano) porque el dry-run debe imprimir la EVIDENCIA de cada exclusion -- order_no,
// total y fecha del pedido que la cerro -- para que Adrian valide las exclusiones una
// por una. Los pedidos vienen del MISMO debtor (la lectura memoizada del script).
export function pedidoQueCierra(quote, pedidosDelCliente, opts = {}) {
  const { ventanaDias = VENTANA_VARIANTE_DIAS, graciaDias = GRACIA_VARIANTE_DIAS, banda = BANDA_VARIANTE } = opts;
  const q = quote || {};
  const totalQuote = totalNum(q.total);
  if (totalQuote == null || totalQuote <= 0) return null;  // sin monto: la regla no aplica
  const fechaQuote = fechaMs(q.ord_date);
  if (fechaQuote == null) return null;
  const ventanaMs = ventanaDias * MS_POR_DIA;
  const graciaMs = graciaDias * MS_POR_DIA;

  for (const p of pedidosDelCliente || []) {
    if (!p) continue;
    const totalPedido = totalNum(p.total);
    if (totalPedido == null || totalPedido <= 0) continue;  // $0/basura: no cierra nada
    const fechaPedido = fechaMs(p.ord_date);
    if (fechaPedido == null) continue;
    // Ventana ASIMETRICA: [quote - gracia, quote + ventana]. Negativo = el pedido es
    // ANTERIOR al quote; mas alla de la gracia es un reorden, no esta compra.
    const delta = fechaPedido - fechaQuote;
    if (delta < -graciaMs || delta > ventanaMs) continue;
    if (Math.abs(totalPedido - totalQuote) / Math.max(totalQuote, totalPedido) > banda) continue;
    return p;
  }
  return null;
}

export function esVarianteCerrada(quote, pedidosDelCliente, opts) {
  return pedidoQueCierra(quote, pedidosDelCliente, opts) != null;
}

// PISO DE MONTO de la parte B (decision Adrian 2026-07-30): una cotizacion de menos de
// $500 no es una oportunidad de mayoreo -- en mayoreo $500 son ~5 piezas. Son errores de
// captura, pruebas o muestras, y ensucian el tablero de seguimiento. INCLUSIVO: $500
// exacto se queda. Aplica SOLO a la parte B; la parte A conserva su regla previa (una
// muestra $0 con pedido ACTIVO si se sigue: ahi hay un compromiso real que cumplir).
// Deja cubiertos de paso los folios $0 de FOLIOS_EXCLUIDOS_MANUAL (1189, 1195, 1196),
// que NO se retiran: documentan la revision fila por fila y protegen si el piso cambiara.
export const MONTO_MINIMO_B = 500;

function antesDe(ordDate, fechaCorte) {
  if (!ordDate || !fechaCorte) return false;
  return String(ordDate).slice(0, 10) < String(fechaCorte).slice(0, 10);
}

// PARTE B (#76, scope revisado): id-walk de las cotizaciones que NUNCA se volvieron
// pedido, ventana ultimos 6 meses, en etapa `seguimiento`. Camina folios de quotes
// de `folioMax` hacia ABAJO leyendo GET /quote/{id}:
//   - 404 (null): el folio no existe/se anulo -> SALTA (sigue bajando).
//   - ord_date < fechaCorte: el quote es anterior a la ventana -> DETIENE el walk
//     (todo lo de abajo es mas viejo; los folios son crecientes en el tiempo).
//   - folio en foliosConPedido: ya se ordeno (entro por la parte A) -> SALTA.
//   - folio ya en el store (o ya planeado en esta corrida): idempotencia -> SALTA.
//   - folio/debtor de prueba (HITL #67/#68): -> SALTA.
//   - resto: NUNCA se ordeno -> entrada en etapa `seguimiento` (cabecera completa,
//     sin partidas; reusa construirEntradaCotizacion con un pedido sintetico que
//     solo aporta el folio, order_no null = nunca fue pedido).
// Lecturas inyectadas (cero red en test): obtenerQuote, obtenerDebtor (el quote
// trae debtor_no; reusa el cache del script). Devuelve un PLAN sin escribir nada.
export async function planearBackfillSinPedido(deps = {}) {
  const {
    obtenerQuote, obtenerDebtor, foliosConPedido, listarCotizaciones,
    vendedores, folioMax, fechaCorte, folioMin = 1, maxRachaVacia = 50, cancelados = [],
    // Pedidos del MISMO debtor, para la heuristica de variante cerrada (ver
    // pedidoQueCierra). En el script es la lectura MEMOIZADA por debtor, asi que pedirla
    // por folio no cuesta red extra. Ausente (tests puros) -> la heuristica no aplica.
    listarPedidosDeCliente,
  } = deps;

  const conPedido = foliosConPedido instanceof Set ? foliosConPedido : new Set(foliosConPedido || []);
  const cotizaciones = (await listarCotizaciones()) || [];
  // Cotizaciones anuladas en Operam (decision Adrian): el set de folios de quote
  // cancelados viene de data/cancelados.json (web legacy). Un quote anulado no se importa.
  const canceladosSet = new Set([...cancelados].map(String));

  const plan = {
    folioMax: folioMax != null ? Number(folioMax) : null,
    importar: [],
    // EVIDENCIA de cada exclusion por variante cerrada (folio, cliente, total y el pedido
    // que la cerro). El dry-run la imprime linea por linea: Adrian valida estas
    // exclusiones una por una, la trazabilidad es requisito.
    variantesCerradas: [],
    skips: { conPedido: 0, otraSucursal: 0, generico: 0, socio: 0, excluidoManual: 0, prueba: 0, cancelado: 0, duplicado: 0, sinDebtor: 0, montoMinimo: 0, varianteCerrada: 0 },
  };
  if (folioMax == null) return plan;
  const folin = new Set();
  let rachaVacia = 0; // 404 consecutivos: techo de seguridad para no caminar hasta folioMin

  for (let folio = Number(folioMax); folio >= folioMin; folio--) {
    const f = String(folio);
    const quote = await obtenerQuote(folio);
    if (!quote) {
      // 404: folio inexistente/anulado. Una racha larga de 404 hacia abajo significa
      // que se paso por debajo del rango contiguo de folios -> DETIENE (acota el
      // volumen de GET; sin esto el walk bajaria hasta folioMin probando huecos).
      if (++rachaVacia >= maxRachaVacia) break;
      continue;
    }
    rachaVacia = 0;

    if (antesDe(quote.ord_date, fechaCorte)) break; // fuera de la ventana de 6 meses

    if (conPedido.has(f)) { plan.skips.conPedido++; continue; }      // ya entro por parte A
    if (canceladosSet.has(f)) { plan.skips.cancelado++; continue; }  // cotizacion anulada en Operam
    // CRITERIO 1: el quote tambien lleva los marcadores de canal (user/reference/
    // from_stk_loc). Solo Tlapacoya (01); Shopify/Amazon/Bazaar fuera, contador propio.
    if (!esSucursalTlapacoya(quote)) { plan.skips.otraSucursal++; continue; }
    if (folioYaExiste(cotizaciones, f) || folin.has(f)) { plan.skips.duplicado++; continue; }
    if (FOLIOS_PRUEBA.has(f)) { plan.skips.prueba++; continue; }     // quotes de prueba HITL
    // Excluidos manualmente (revision Adrian 2026-07-30): quotes de prueba/uso interno
    // detectados fila por fila en el dry-run (contador propio, distinto de FOLIOS_PRUEBA).
    if (FOLIOS_EXCLUIDOS_MANUAL.has(f)) { plan.skips.excluidoManual++; continue; }

    const debtorNo = strOrNull(quote.debtor_no);
    if (debtorNo != null && DEBTORS_PRUEBA.has(debtorNo)) { plan.skips.prueba++; continue; }
    // Clientes GENERICOS: fuera del backfill, diferidos a #118 (prospectos). Es el
    // grueso de la parte B, de ahi el contador propio.
    if (esDebtorGenerico(debtorNo)) { plan.skips.generico++; continue; }
    // Socios como cliente (revision Adrian 2026-07-30): son vendedores; sus
    // cotizaciones "personales" son pruebas del cotizador, no oportunidades reales.
    if (debtorNo != null && DEBTORS_SOCIOS.has(debtorNo)) { plan.skips.socio++; continue; }
    // PISO DE MONTO: va ANTES de la heuristica de variante (y de leer el debtor) para
    // que una cotizacion de $200 salga contada como montoMinimo, no como varianteCerrada:
    // son dos motivos distintos y la revision los mira por separado. Ademas es un filtro
    // local, sin costo de lectura.
    if (num(quote.total) < MONTO_MINIMO_B) { plan.skips.montoMinimo++; continue; }

    const debtor = debtorNo != null ? await obtenerDebtor(debtorNo) : null;

    // VARIANTE CERRADA: el cliente ya compro con un pedido cercano y de monto
    // comparable, aunque ese pedido no quedara ligado a ESTE folio. Va al FINAL de la
    // cadena de filtros (es el unico que cuesta una lectura de pedidos) y despues del
    // debtor, porque la evidencia lleva el nombre del cliente.
    if (listarPedidosDeCliente && debtorNo != null) {
      const pedidosCliente = await listarPedidosDeCliente(debtorNo);
      const cierra = pedidoQueCierra(quote, pedidosCliente);
      if (cierra) {
        plan.skips.varianteCerrada++;
        plan.variantesCerradas.push({
          folio: f,
          cliente: (debtor && debtor.CustName) || '',
          total: num(quote.total),
          pedido: {
            order_no: strOrNull(cierra.order_no),
            total: num(cierra.total),
            fecha: cierra.ord_date || null,
          },
        });
        continue;
      }
    }

    // Pedido sintetico: solo aporta el folio (order_no null = nunca fue pedido).
    const pedido = { trans_no_from: f, order_no: null };
    const entrada = construirEntradaCotizacion({ pedido, quote, debtor, etapa: 'seguimiento', vendedores });
    plan.importar.push(entrada);
    folin.add(f);
  }
  return plan;
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
//   data.cliente.customer_ref referencia/proyecto del cliente; del PEDIDO si existe
//                             (vigente), si no del quote (#76, caso 5960)
//   data.cliente.contactoEntrega deliver_to del pedido (o quote): contacto real de
//                             entrega; insumo del "Prospecto" en la revision del generico
//   data.items                partidas del quote (mapearPartidasQuote); [] si no trae
//                             detalle. Las leen pdf-generator/html-generator para
//                             regenerar el documento desde `data` (#103)
//   data.subtotal             total/1.16 (o el subtotal nativo del quote si viene)
//   data.moneda               curr_code del debtor
//   data.validoHasta          delivery_date del quote (el "Valido hasta" nativo)
//   data.orderOperam          order_no del pedido (binding PRECISO para el sync)
//   data.pagoSinRegistrar     true si el pedido se entrego y el pago aun NO figura
//                             liquidado. Es el EJE SECUNDARIO de #77 (la forma que quedo
//                             en main): el frontend pinta el badge "Pago sin registrar"
//                             en producto_entregado y el sync lo apaga al liquidarse. Lo
//                             deriva el caller (planearBackfill) con el predicado
//                             compartido del sync; construirEntrada solo lo persiste.
//   data.backfill             true (marca de origen)
// tier queda en null: los quotes de Operam NO traen el tier del cotizador (no se
// inventa). folioOperam = trans_no_from del pedido = numero de la cotizacion.
export function construirEntradaCotizacion({ pedido, quote, debtor, etapa, vendedores, pagoSinRegistrar = false } = {}) {
  const p = pedido || {};
  const q = quote || {};
  const d = debtor || {};
  // El total de parte A es el del PEDIDO (lo que Operam muestra para la orden): el del
  // quote puede diferir (quote 1935 -> pedido 0 = muestra, folio 7251 en vivo) y seria
  // enganoso. Parte B no tiene pedido real (sintetico sin `total`) -> cae al del quote.
  const total = num(p.total != null && p.total !== '' ? p.total : q.total);
  const subtotal = q.subtotal != null && q.subtotal !== ''
    ? num(q.subtotal)
    : subtotalDesdeTotal(total);
  // customer_ref y contacto VIGENTES = los del PEDIDO (editado tras convertir el quote);
  // el quote puede quedar con el cliente ORIGINAL (5960: quote=Hoteles Rodavento/Cristian
  // Ortiz, pedido=Asesoria Creativa/Olga Pinales). Parte B (pedido sintetico sin estos
  // campos) cae al quote.
  const customerRef = primeroNoVacio(p.customer_ref, p.cust_ref, q.cust_ref, q.customer_ref);
  const contactoEntrega = primeroNoVacio(p.deliver_to, q.deliver_to);
  // El quote real de Operam trae el vendedor anidado en branch.salesman, NO a
  // nivel top (visto en #68); sin este fallback el vendedor da null para todos.
  // Defensivo: soporta ambas formas y prioriza el top-level si viene.
  const salesman = q.salesman ?? q.branch?.salesman;
  // CRITERIO 1 #76: el salesman mapeado tiene PRIORIDAD; si no mapea (tx a cliente
  // generico), cae al USUARIO CREADOR de la transaccion (q.user.real_name, y a falta
  // del quote, el del pedido). null si ninguno mapea (no inventa vendedor).
  const userRealName = q.user?.real_name ?? p.user?.real_name;
  return {
    fecha: q.ord_date || null,
    vendedor: mapearSalesman(salesman, vendedores) ?? mapearVendedorPorUsuario(userRealName, vendedores),
    cliente: d.CustName || '',
    total,
    tier: null,
    folioOperam: strOrNull(p.trans_no_from),
    etapa: etapa || 'seguimiento',
    data: {
      cliente: {
        rfc: upper(d.tax_id),
        customer_ref: customerRef,
        contactoEntrega,
      },
      // Partidas del quote (#76, decision 2026-07-29): sin ellas el documento se
      // regenera vacio. [] cuando el quote no trae detalle, nunca undefined.
      items: mapearPartidasQuote(q.detalles),
      subtotal,
      moneda: d.curr_code || 'MXN',
      validoHasta: q.delivery_date || null,
      orderOperam: strOrNull(p.order_no),
      pagoSinRegistrar: pagoSinRegistrar === true,
      backfill: true,
    },
  };
}
