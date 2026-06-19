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
// Alcance (decision #76): solo ACTIVOS (etapa post-venta != producto_entregado);
// cabecera completa SIN partidas; idempotente por folioOperam; excluye venta
// directa, el pedido de prueba 7270 y los debtors 14 (PUBLICO EN GENERAL) y 1.
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

const { listarPedidos, listarTransacciones, obtenerQuote, obtenerCliente, _setMinInterval } = await import('../lib/operam-client.js');
const { planearBackfill, planearBackfillSinPedido, descubrirFolioMax, memoizarPorClave } = await import('../lib/backfill-operam.mjs');
const { hechosDeOperam } = await import('../lib/sync-operam-io.js');
const { etapaPostVenta } = await import('../lib/sync-operam.js');
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
// transacciones (por RFC) y pedidos (por debtor_no) POR candidato, y muchos
// candidatos comparten el mismo cliente. Memoizamos ambas lecturas por su clave
// (rfc / debtor_no) para que un mismo cliente se lea UNA sola vez en toda la
// corrida (igual que ya se cachea obtenerCliente con debtorCache). Esto recorta
// las ~840 lecturas en rafaga que disparaban el 429.
const listarTransaccionesMemo = memoizarPorClave(listarTransacciones, ({ rfc }) => `tx:${rfc}`);
const listarPedidosMemo = memoizarPorClave(listarPedidos, ({ debtorNo }) => `ped:${debtorNo}`);
// El quote tambien se memoiza: la parte A lo lee por trans_no_from y la parte B
// camina ids; un mismo folio no se lee dos veces entre ambas partes.
const obtenerQuoteMemo = memoizarPorClave(obtenerQuote, (id) => `q:${id}`);

// La etapa post-venta de la oportunidad: lee Operam (read-only) con binding
// PRECISO (op.data.orderOperam = order_no del pedido) y aplica el nucleo puro.
// etapaPostVenta devuelve null cuando ningun hecho post-venta aplica -> la
// oportunidad queda en 'seguimiento' (existe la cotizacion/pedido pero sin senal
// de pago/entrega todavia).
async function etapaDe(op) {
  const hechos = await hechosDeOperam(op, {
    listarTransacciones: listarTransaccionesMemo,
    listarPedidos: listarPedidosMemo,
  });
  if (!hechos) return 'seguimiento';
  return etapaPostVenta(hechos, op) || 'seguimiento';
}

const deps = {
  listarPedidosPagina: ({ skip }) => listarPedidos({ skip, limit: 100, desde, hasta }),
  obtenerDebtor,
  obtenerQuote: obtenerQuoteMemo,
  etapaDe,
  listarCotizaciones: () => cotStore.listar(),
  vendedores,
  desde, hasta,
};

console.log(`\nBackfill #76 (${APPLY ? 'APPLY' : 'DRY-RUN'}) -- rango ${desde}..${hasta}`);
console.log(`Throttle: ${THROTTLE_MS}ms entre lecturas de Operam (anti-429; ajustable con BACKFILL_THROTTLE_MS).`);
console.log('PARTE A: leyendo pedidos de Operam (read-only, paginado)...\n');

const plan = await planearBackfill(deps);

console.log(`Pedidos enumerados:   ${plan.totalPedidos}`);
console.log(`Candidatos (cotizacion de origen, sucursal 01): ${plan.candidatos}`);
console.log(`  Importables A (activos): ${plan.importar.length}`);
console.log(`  SKIP no-candidato (venta directa / prueba): ${plan.skips.noCandidato}`);
console.log(`  SKIP otra-sucursal (Shopify/Amazon/Bazaar): ${plan.skips.otraSucursal}`);
console.log(`  SKIP entregado (producto_entregado): ${plan.skips.entregado}`);
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
let planB = { importar: [], skips: {}, folioMax: null };
if (folioSeed > 0) {
  const folioMax = await descubrirFolioMax({ obtenerQuote: obtenerQuoteMemo, inicio: folioSeed, maxRacha: 10, limite: 300 });
  console.log(`  folioMax descubierto (probe desde ${folioSeed}): ${folioMax ?? '(ninguno)'}`);
  planB = await planearBackfillSinPedido({
    obtenerQuote: obtenerQuoteMemo,
    obtenerDebtor,
    foliosConPedido: plan.foliosConPedido,
    listarCotizaciones: () => cotStore.listar(),
    vendedores,
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
console.log(`  SKIP duplicado (folio ya en el store): ${planB.skips.duplicado ?? 0}\n`);

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
