// Backfill de cotizaciones reales de Operam al pipeline (issue #76).
// La BD del cotizador quedo vacia tras #75; este script RE-CREA las oportunidades
// (cotizaciones) reales descubriendolas VIA PEDIDOS (los quotes tipo 32 no son
// enumerables por la API). Cada pedido (Sales Order, tipo 30) con trans_no_from no
// vacio nacio de convertir una cotizacion -> esa cotizacion se recupera con
// folioOperam = trans_no_from (decision #76, peltre-operam.md 12.2).
//
// READ-ONLY contra Operam (cero escrituras a Operam). Solo escribe en la BD del
// cotizador (tabla cotizaciones) y SOLO con --apply.
//
// Uso:
//   node scripts/backfill-operam.mjs            # DRY-RUN: lista lo que importaria (NO escribe)
//   node scripts/backfill-operam.mjs --apply    # crea las cotizaciones (EXIGE DATABASE_URL)
//
// --apply exige DATABASE_URL: sin ella el store cae al fallback JSON local y
// escribiria datos de dev. Read-only contra Operam siempre.
//
// Alcance (decision #76): solo SUCURSAL 01 Tlapacoya (CRITERIO 1: descarta
// Shopify/Amazon/Bazaar por marcadores de canal del pedido/quote) y solo NO-CERRADOS
// (CRITERIO 2: cerrado = entregado Y pagado al 100%; el entregado-impago SI entra,
// con etapa de avance de pago); cabecera completa SIN partidas; idempotente por
// folioOperam; excluye venta directa, el pedido de prueba 7270 y los debtors 14
// (PUBLICO EN GENERAL) y 1.
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// OPERAM_* desde .env del cotizador (lectura); DATABASE_URL del entorno.
const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^(OPERAM_[A-Z]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const APPLY = process.argv.includes('--apply');

if (APPLY && !process.env.DATABASE_URL) {
  console.error('ABORTA: --apply requiere DATABASE_URL (la Neon del cotizador). Sin ella el\n' +
    'store usa el fallback JSON local y escribiria datos de dev. Configura DATABASE_URL y reintenta.');
  process.exit(1);
}

const { listarPedidos, listarTransacciones, obtenerQuote, obtenerCliente, obtenerPedido, _setMinInterval } = await import('../lib/operam-client.js');
const { planearBackfill, planearBackfillSinPedido, descubrirFolioMax, memoizarPorClave, VENTANA_VARIANTE_DIAS, GRACIA_VARIANTE_DIAS, BANDA_VARIANTE, MONTO_MINIMO_B } = await import('../lib/backfill-operam.mjs');
const { hechosDeOperam } = await import('../lib/sync-operam-io.js');
const cotStore = await import('../lib/cotizaciones-store.js');

// Throttle PROACTIVO (issue #76): el backfill hace ~800-1000 lecturas y el rate-limit
// de Operam se dispara por RAFAGA (el dry-run del 2026-06-19 trono: ~28 lecturas
// seguidas bastaron, y una vez disparado dura >62s -> el backoff reactivo no convergio).
// Paceamos TODAS las lecturas con un intervalo minimo para no disparar el limite. La
// corrida es lenta (~1000 lecturas x intervalo) pero estable y de una sola vez.
// Ajustable por env si el limite real difiere (BACKFILL_THROTTLE_MS).
const THROTTLE_MS = Number(process.env.BACKFILL_THROTTLE_MS) || 1500;
_setMinInterval(THROTTLE_MS);

const vendedores = JSON.parse(readFileSync(join(ROOT, 'data', 'vendedores.json'), 'utf8'));

// Pedidos/cotizaciones ANULADOS en Operam (#76/#77). La API NO expone la cancelacion; la
// lista la genera scripts/detectar-cancelados.mjs (scraping de la web legacy) en
// data/cancelados.json: { orders: [order_no de pedidos], quotes: [folios de cotizacion] }.
// Sin el archivo no se filtran cancelados (se avisa). El backfill no scrapea en runtime.
let cancelados = { orders: [], quotes: [] };
const canceladosPath = join(ROOT, 'data', 'cancelados.json');
if (existsSync(canceladosPath)) {
  cancelados = JSON.parse(readFileSync(canceladosPath, 'utf8'));
} else {
  console.warn('AVISO: data/cancelados.json no existe -> NO se filtran pedidos cancelados.\n' +
    'Corre primero: node scripts/detectar-cancelados.mjs');
}

// Rango amplio (la API exige fechas): los pedidos con cotizacion de origen del
// historial caben en ~2 anios hacia atras (decision #76: 2024-06..hoy = 238/2777).
const hasta = new Date().toISOString().slice(0, 10);
const desde = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 2); return d.toISOString().slice(0, 10); })();

// Cache del debtor: varios pedidos comparten cliente -> una sola lectura por id.
const debtorCache = new Map();
async function obtenerDebtor(debtorNo) {
  const key = String(debtorNo);
  if (debtorCache.has(key)) return debtorCache.get(key);
  const c = await obtenerCliente(debtorNo);
  debtorCache.set(key, c);
  return c;
}

// Control de VOLUMEN (issue #76, blocker 429): hechosDeOperam re-lee
// transacciones (por customer_id/RFC) y pedidos (por debtor_no) POR candidato, y
// muchos candidatos comparten el mismo cliente. Memoizamos ambas lecturas por su
// clave para que un mismo cliente se lea UNA sola vez en toda la corrida (igual que
// ya se cachea obtenerCliente con debtorCache). Esto recorta las ~840 lecturas en
// rafaga que disparaban el 429. La clave incluye el `skip` de pagina: hechosDeOperam
// ahora pagina la cuenta COMPLETA del cliente (clientes con >100 tx, p.ej. el
// generico), asi cada pagina se cachea por separado y un segundo candidato del mismo
// cliente reusa TODAS sus paginas sin re-leer (sin el skip en la clave las paginas
// colisionarian y la paginacion entraria en loop).
const listarTransaccionesMemo = memoizarPorClave(listarTransacciones, ({ customerId, rfc, skip = 0 }) => `tx:${customerId ?? rfc}:${skip}`);
const listarPedidosMemo = memoizarPorClave(listarPedidos, ({ debtorNo, skip = 0 }) => `ped:${debtorNo}:${skip}`);
// El quote tambien se memoiza: la parte A lo lee por trans_no_from y la parte B
// camina ids; un mismo folio no se lee dos veces entre ambas partes.
const obtenerQuoteMemo = memoizarPorClave(obtenerQuote, (id) => `q:${id}`);
// Detalle del pedido (qty_sent vs quantity, #76 caso 6988): solo se lee para candidatos
// con remision, para distinguir entrega TOTAL de PARCIAL. Memoizado por order_no.
const obtenerPedidoMemo = memoizarPorClave(obtenerPedido, (orderNo) => `det:${orderNo}`);

// Pedidos del cliente para la heuristica de VARIANTE CERRADA de la parte B (#76): una
// cotizacion sin pedido propio queda cerrada si el cliente ordeno algo cercano en fecha y
// de monto comparable (el pedido de la variante autorizada, que no quedo ligado por
// trans_no_from). Reusa el MISMO memo `ped:` que hechosDeOperam y el mismo rango de 2
// anios, asi que la primera lectura por debtor es la unica que toca la red. Pagina la
// cuenta completa: un cliente con >100 pedidos no cabe en una pagina.
async function listarPedidosDeCliente(debtorNo) {
  const todos = [];
  for (let skip = 0; ; skip += 100) {
    const pagina = await listarPedidosMemo({ debtorNo: Number(debtorNo), desde, hasta, skip, limit: 100 });
    const lista = Array.isArray(pagina) ? pagina : [];
    todos.push(...lista);
    if (lista.length < 100) break;
  }
  return todos;
}

// Los HECHOS post-venta crudos de la oportunidad (CRITERIO 2): lee Operam
// (read-only) con binding PRECISO (op.data.orderOperam = order_no del pedido) y
// devuelve { pago, tienePedido, tieneRemision }. planearBackfill deriva el gate de
// cerrado (esCerrado) y la etapa (etapaBackfill) a partir de estos hechos; el script
// ya NO calcula la etapa. Si hechosDeOperam devuelve null (sin RFC), se trata como
// hechos vacios (sin remision ni pago) -> no cerrado, etapa seguimiento.
const HECHOS_VACIO ={ pago: { allocated: 0, outstanding: 0, total: 0 }, tienePedido: false, tieneRemision: false };
async function obtenerHechos(op) {
  const hechos = await hechosDeOperam(op, {
    listarTransacciones: listarTransaccionesMemo,
    listarPedidos: listarPedidosMemo,
  });
  return hechos || HECHOS_VACIO;
}

const deps = {
  listarPedidosPagina: ({ skip }) => listarPedidos({ skip, limit: 100, desde, hasta }),
  obtenerDebtor,
  obtenerQuote: obtenerQuoteMemo,
  obtenerHechos,
  obtenerDetalle: obtenerPedidoMemo,
  listarCotizaciones: () => cotStore.listar(),
  vendedores,
  cancelados: cancelados.orders || [],
  desde, hasta,
};

console.log(`\nBackfill #76 (${APPLY ? 'APPLY' : 'DRY-RUN'}) -- rango ${desde}..${hasta}`);
console.log(`Throttle: ${THROTTLE_MS}ms entre lecturas de Operam (anti-429; ajustable con BACKFILL_THROTTLE_MS).`);
console.log('PARTE A: leyendo pedidos de Operam (read-only, paginado)...\n');

const plan = await planearBackfill(deps);

console.log(`Pedidos enumerados:   ${plan.totalPedidos}`);
console.log(`Candidatos (cotizacion de origen, sucursal 01): ${plan.candidatos}`);
console.log(`  Importables A (no cerrados): ${plan.importar.length}`);
console.log(`  SKIP no-candidato (venta directa / prueba): ${plan.skips.noCandidato}`);
console.log(`  SKIP otra-sucursal (Shopify/Amazon/Bazaar): ${plan.skips.otraSucursal}`);
console.log(`  SKIP generico (clientes genericos, diferidos a #118): ${plan.skips.generico}`);
console.log(`  SKIP socio (cliente = vendedor, pruebas del cotizador): ${plan.skips.socio}`);
console.log(`  SKIP excluido manual (quotes de prueba/uso interno, revision Adrian 2026-07-30): ${plan.skips.excluidoManual}`);
console.log(`  SKIP cerrado (entregado Y pagado al 100%): ${plan.skips.cerrado}`);
console.log(`  SKIP cancelado (anulado en Operam): ${plan.skips.cancelado}`);
console.log(`  SKIP duplicado (folio ya en el store): ${plan.skips.duplicado}\n`);

for (const e of plan.importar) {
  console.log(`  [A] folio ${e.folioOperam} | order ${e.data.orderOperam} | ${e.etapa} | ${e.cliente} | $${e.total} | vendedor: ${e.vendedor ?? '(sin mapear)'}`);
}

// PARTE B (scope revisado #76): cotizaciones que NUNCA se volvieron pedido, ventana
// ultimos 6 meses, en etapa seguimiento. Los quotes no son enumerables -> id-walk.
// fechaCorte = hoy - 6 meses (corta por ord_date del quote).
const fechaCorte = (() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString().slice(0, 10); })();

// folioMax: el techo del rango de folios a caminar. Se DESCUBRE probando hacia
// arriba (los quotes no se enumeran) desde el folio candidato mas alto de la parte A
// (el ultimo quote que SI se volvio pedido); por encima de el solo pueden quedar
// quotes recientes sin pedido. Si la parte A no hallo candidatos, no hay semilla
// segura -> se omite la parte B (el orquestador define el techo a mano).
const folioSeed = [...plan.foliosConPedido].map(Number).filter(Number.isFinite).reduce((a, b) => Math.max(a, b), 0);

console.log(`\nPARTE B: id-walk de cotizaciones sin pedido (ventana desde ${fechaCorte})...`);
let planB = { importar: [], skips: {}, variantesCerradas: [], folioMax: null };
if (folioSeed > 0) {
  const folioMax = await descubrirFolioMax({ obtenerQuote: obtenerQuoteMemo, inicio: folioSeed, maxRacha: 10, limite: 300 });
  console.log(`  folioMax descubierto (probe desde ${folioSeed}): ${folioMax ?? '(ninguno)'}`);
  planB = await planearBackfillSinPedido({
    obtenerQuote: obtenerQuoteMemo,
    obtenerDebtor,
    foliosConPedido: plan.foliosConPedido,
    listarCotizaciones: () => cotStore.listar(),
    vendedores,
    cancelados: cancelados.quotes || [],
    listarPedidosDeCliente,
    folioMax,
    fechaCorte,
  });
} else {
  console.log('  SKIP: la parte A no hallo candidatos -> sin semilla de folioMax (define el techo a mano).');
}

console.log(`  Importables B (seguimiento): ${planB.importar.length}`);
console.log(`  SKIP con-pedido (ya entro por A): ${planB.skips.conPedido ?? 0}`);
console.log(`  SKIP otra-sucursal (Shopify/Amazon/Bazaar): ${planB.skips.otraSucursal ?? 0}`);
console.log(`  SKIP prueba (folio/debtor de prueba): ${planB.skips.prueba ?? 0}`);
console.log(`  SKIP generico (clientes genericos, diferidos a #118): ${planB.skips.generico ?? 0}`);
console.log(`  SKIP socio (cliente = vendedor, pruebas del cotizador): ${planB.skips.socio ?? 0}`);
console.log(`  SKIP excluido manual (quotes de prueba/uso interno, revision Adrian 2026-07-30): ${planB.skips.excluidoManual ?? 0}`);
console.log(`  SKIP cancelado (anulado en Operam): ${planB.skips.cancelado ?? 0}`);
console.log(`  SKIP duplicado (folio ya en el store): ${planB.skips.duplicado ?? 0}`);
console.log(`  SKIP monto minimo (total < $${MONTO_MINIMO_B}, error/prueba/muestra): ${planB.skips.montoMinimo ?? 0}`);
console.log(`  SKIP variante-cerrada (el cliente ya compro: pedido de -${GRACIA_VARIANTE_DIAS} a +${VENTANA_VARIANTE_DIAS} dias y dentro del ${Math.round(BANDA_VARIANTE * 100)}% del monto mayor): ${planB.skips.varianteCerrada ?? 0}\n`);

// Evidencia de CADA exclusion por variante cerrada (revision de Adrian, folio por folio):
// que cotizacion se excluyo y QUE pedido la cerro. Sin esto la exclusion es una caja
// negra y no se puede validar si la heuristica se comio una oportunidad real.
if ((planB.variantesCerradas || []).length > 0) {
  console.log('  Exclusiones por variante cerrada (cotizacion -> pedido que la cerro):');
  for (const v of planB.variantesCerradas) {
    const dif = v.total > 0 ? Math.round((Math.abs(v.pedido.total - v.total) / v.total) * 100) : 0;
    console.log(`    [X] folio ${v.folio} | ${v.cliente} | cotizacion $${v.total}` +
      ` -> pedido ${v.pedido.order_no} $${v.pedido.total} (${v.pedido.fecha}, dif ${dif}%)`);
  }
  console.log('');
}

for (const e of planB.importar) {
  console.log(`  [B] folio ${e.folioOperam} | seguimiento | ${e.cliente} | $${e.total} | vendedor: ${e.vendedor ?? '(sin mapear)'}`);
}

// Fusion de ambas partes (A activos + B seguimiento). folioOperam es disjunto por
// construccion (B salta los folios de A via foliosConPedido), pero defensivo: dedup
// por folioOperam por si acaso.
const porFolio = new Map();
for (const e of [...plan.importar, ...planB.importar]) {
  if (!porFolio.has(e.folioOperam)) porFolio.set(e.folioOperam, e);
}
const importar = [...porFolio.values()];

console.log(`TOTAL a importar: ${importar.length} (A activos ${plan.importar.length} + B seguimiento ${planB.importar.length}).`);

// Control de las PARTIDAS (#76, decision 2026-07-29): los nombres de campo del detalle
// del quote se leen por alias (mapearPartidasQuote), asi que este conteo es la senal de
// que el alias correcto acerto contra la API real. Si "sin partidas" fuera casi el total,
// el mapeo no esta leyendo el detalle y hay que corregir los nombres ANTES del --apply
// (una cotizacion sin items regenera un documento sin renglones).
const sinPartidas = importar.filter(e => (e.data.items || []).length === 0).length;
const piezas = importar.reduce((s, e) => s + (e.data.items || []).reduce((n, i) => n + (i.cantidad || 0), 0), 0);
console.log(`  Partidas: ${importar.length - sinPartidas} con items, ${sinPartidas} sin partidas, ${piezas} piezas en total.`);

if (!APPLY) {
  console.log(`\nDRY-RUN: se crearian ${importar.length} cotizaciones. No se escribio nada (sin --apply).`);
  process.exit(0);
}

// APPLY: crea cada entrada en el store (crear -> setFolioOperam -> cambiarEtapa).
console.log(`\nAPPLY: creando ${importar.length} cotizaciones...`);
let creadas = 0;
for (const e of importar) {
  const id = await cotStore.crear(e);
  await cotStore.setFolioOperam(id, e.folioOperam);
  await cotStore.cambiarEtapa(id, e.etapa, {
    tipo: 'backfill',
    etapa: e.etapa,
    orderOperam: e.data.orderOperam,
    fecha: new Date().toISOString(),
  });
  creadas++;
}
console.log(`Listo. Creadas ${creadas} cotizaciones (idempotente: re-correr no duplica).`);
