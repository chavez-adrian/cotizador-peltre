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

// Folios de QUOTES de prueba a EXCLUIR en el id-walk de la parte B (#76): las
// cotizaciones nativas creadas durante los HITL #67/#68 sobre PUBLICO EN GENERAL
// (peltre-operam.md 12.6: quotes 1157-1163). No son cotizaciones reales de cliente.
const FOLIOS_PRUEBA = new Set(['1157', '1159', '1160', '1161', '1162', '1163']);

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
//   deps.etapaDe(op)             -> etapa post-venta (hechosDeOperam+etapaPostVenta)
//   deps.listarCotizaciones()    -> cotizaciones existentes (para idempotencia)
//   deps.vendedores              -> data/vendedores.json
//   deps.desde / deps.hasta      -> rango de fechas del listado
// Devuelve un PLAN sin escribir nada: { importar:[entradas], skips:{...},
// totalPedidos, candidatos }. El script lo imprime en dry-run y, con --apply,
// crea cada entrada del plan. Idempotente: salta los folios ya en el store y los
// que ya planeo en esta misma corrida; salta los entregados; salta no-candidatos
// (sin leer su quote, lectura barata).
export async function planearBackfill(deps = {}) {
  const {
    listarPedidosPagina, obtenerDebtor, obtenerQuote, etapaDe,
    listarCotizaciones, vendedores, desde, hasta,
  } = deps;

  const pedidos = await enumerarPedidos(listarPedidosPagina, desde, hasta);
  const cotizaciones = (await listarCotizaciones()) || [];

  const plan = {
    totalPedidos: pedidos.length,
    candidatos: 0,
    importar: [],
    // Folios que SI se volvieron pedido (TODOS los candidatos, importados o no). La
    // parte B (id-walk) los salta: ya nacieron de una cotizacion ordenada. Incluye
    // los entregados (no importados) y los duplicados, no solo los importables.
    foliosConPedido: new Set(),
    skips: { noCandidato: 0, otraSucursal: 0, entregado: 0, duplicado: 0 },
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
    if (folioYaExiste(cotizaciones, folio) || folin.has(folio)) { plan.skips.duplicado++; continue; }

    const debtor = await obtenerDebtor(pedido.debtor_no);
    const rfc = upper(debtor && debtor.tax_id);

    // Etapa post-venta con binding PRECISO: data.orderOperam = order_no del pedido.
    const opParaEtapa = {
      folioOperam: folio,
      etapa: 'seguimiento',
      data: { cliente: { rfc }, orderOperam: strOrNull(pedido.order_no) },
    };
    const etapa = await etapaDe(opParaEtapa);
    if (!esActivoParaImportar(etapa)) { plan.skips.entregado++; continue; }

    const quote = await obtenerQuote(folio);
    const entrada = construirEntradaCotizacion({ pedido, quote, debtor, etapa, vendedores });
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
    vendedores, folioMax, fechaCorte, folioMin = 1, maxRachaVacia = 50,
  } = deps;

  const conPedido = foliosConPedido instanceof Set ? foliosConPedido : new Set(foliosConPedido || []);
  const cotizaciones = (await listarCotizaciones()) || [];

  const plan = {
    folioMax: folioMax != null ? Number(folioMax) : null,
    importar: [],
    skips: { conPedido: 0, otraSucursal: 0, prueba: 0, duplicado: 0, sinDebtor: 0 },
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
    // CRITERIO 1: el quote tambien lleva los marcadores de canal (user/reference/
    // from_stk_loc). Solo Tlapacoya (01); Shopify/Amazon/Bazaar fuera, contador propio.
    if (!esSucursalTlapacoya(quote)) { plan.skips.otraSucursal++; continue; }
    if (folioYaExiste(cotizaciones, f) || folin.has(f)) { plan.skips.duplicado++; continue; }
    if (FOLIOS_PRUEBA.has(f)) { plan.skips.prueba++; continue; }     // quotes de prueba HITL

    const debtorNo = strOrNull(quote.debtor_no);
    if (debtorNo != null && DEBTORS_PRUEBA.has(debtorNo)) { plan.skips.prueba++; continue; }

    const debtor = debtorNo != null ? await obtenerDebtor(debtorNo) : null;
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
  // El quote real de Operam trae el vendedor anidado en branch.salesman, NO a
  // nivel top (visto en #68); sin este fallback el vendedor da null para todos.
  // Defensivo: soporta ambas formas y prioriza el top-level si viene.
  const salesman = q.salesman ?? q.branch?.salesman;
  return {
    fecha: q.ord_date || null,
    vendedor: mapearSalesman(salesman, vendedores),
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
