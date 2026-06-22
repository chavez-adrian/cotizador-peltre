// Detecta pedidos/cotizaciones ANULADOS en Operam y genera data/cancelados.json
// (issue #76/#77). La API v3 NO expone el estado de cancelacion: un pedido anulado luce
// igual que uno activo en el listado y en el detalle. Solo la web legacy
// (view_sales_order.php, que lee 0_voided de FA) lo marca con "Este pedido ha sido
// cancelado". Este script reusa el plan del backfill (mismos criterios) para saber QUE
// importaria, scrapea cada uno con login web (lib/operam-web.js) y escribe la lista de
// cancelados. El backfill lee ese json y los excluye (NO scrapea en runtime: la
// fragilidad de la web legacy queda aislada aqui).
//
// Uso:
//   node scripts/detectar-cancelados.mjs        # genera data/cancelados.json
//   BACKFILL_THROTTLE_MS=1500 node scripts/detectar-cancelados.mjs
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^(OPERAM_[A-Z]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { listarPedidos, listarTransacciones, obtenerQuote, obtenerCliente, _setMinInterval } = await import('../lib/operam-client.js');
const { planearBackfill, planearBackfillSinPedido, descubrirFolioMax, memoizarPorClave } = await import('../lib/backfill-operam.mjs');
const { hechosDeOperam } = await import('../lib/sync-operam-io.js');
const { abrirSesionWeb, estaCanceladoHtml } = await import('../lib/operam-web.js');
const cotStore = await import('../lib/cotizaciones-store.js');

const THROTTLE_MS = Number(process.env.BACKFILL_THROTTLE_MS) || 1500;
_setMinInterval(THROTTLE_MS);
const SCRAPE_MS = Number(process.env.SCRAPE_THROTTLE_MS) || 350;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const vendedores = JSON.parse(readFileSync(join(ROOT, 'data', 'vendedores.json'), 'utf8'));
const hasta = new Date().toISOString().slice(0, 10);
const desde = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 2); return d.toISOString().slice(0, 10); })();

const debtorCache = new Map();
async function obtenerDebtor(debtorNo) { const k = String(debtorNo); if (debtorCache.has(k)) return debtorCache.get(k); const c = await obtenerCliente(debtorNo); debtorCache.set(k, c); return c; }
const listarTransaccionesMemo = memoizarPorClave(listarTransacciones, ({ customerId, rfc, skip = 0 }) => `tx:${customerId ?? rfc}:${skip}`);
const listarPedidosMemo = memoizarPorClave(listarPedidos, ({ debtorNo, skip = 0 }) => `ped:${debtorNo}:${skip}`);
const obtenerQuoteMemo = memoizarPorClave(obtenerQuote, (id) => `q:${id}`);
const HECHOS_VACIO = { pago: { allocated: 0, outstanding: 0, total: 0 }, tienePedido: false, tieneRemision: false };
async function obtenerHechos(op) { const h = await hechosDeOperam(op, { listarTransacciones: listarTransaccionesMemo, listarPedidos: listarPedidosMemo }); return h || HECHOS_VACIO; }

const deps = {
  listarPedidosPagina: ({ skip }) => listarPedidos({ skip, limit: 100, desde, hasta }),
  obtenerDebtor, obtenerQuote: obtenerQuoteMemo, obtenerHechos,
  listarCotizaciones: () => cotStore.listar(), vendedores, desde, hasta,
};

console.log(`detectar-cancelados (#76/#77) -- rango ${desde}..${hasta}`);
console.log('PARTE A: plan de pedidos (read-only)...');
const plan = await planearBackfill(deps); // sin `cancelados`: aun no existe la lista
const fechaCorte = (() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString().slice(0, 10); })();
const folioSeed = [...plan.foliosConPedido].map(Number).filter(Number.isFinite).reduce((a, b) => Math.max(a, b), 0);
console.log('PARTE B: id-walk de cotizaciones...');
let planB = { importar: [] };
if (folioSeed > 0) {
  const folioMax = await descubrirFolioMax({ obtenerQuote: obtenerQuoteMemo, inicio: folioSeed, maxRacha: 10, limite: 300 });
  planB = await planearBackfillSinPedido({
    obtenerQuote: obtenerQuoteMemo, obtenerDebtor, foliosConPedido: plan.foliosConPedido,
    listarCotizaciones: () => cotStore.listar(), vendedores, folioMax, fechaCorte,
  });
}

// Importables A (pedidos, trans_type 30) y B (cotizaciones, trans_type 32) a verificar.
const pedidosA = plan.importar.map(e => ({ folio: e.folioOperam, trans: e.data.orderOperam, tt: 30 })).filter(x => x.trans);
const quotesB = planB.importar.map(e => ({ folio: e.folioOperam, trans: e.folioOperam, tt: 32 }));
console.log(`A: ${pedidosA.length} pedidos | B: ${quotesB.length} cotizaciones a verificar en la web legacy.`);

console.log('Login web (FrontAccounting)...');
const consultar = await abrirSesionWeb();
// sonda: confirma que la sesion sirve (5960 esta cancelado; si NO lo detecta, el login fallo)
const sonda = estaCanceladoHtml(await consultar(5960, 30));
if (!sonda) {
  console.error('ABORTA: la sesion web no detecto el caso conocido 5960 como cancelado. Login fallido o HTML cambiado. No se escribe cancelados.json.');
  process.exit(1);
}

async function scrapear(items) {
  const cancelados = [];
  let i = 0;
  for (const it of items) {
    const canc = estaCanceladoHtml(await consultar(it.trans, it.tt));
    if (canc) cancelados.push(String(it.folio));
    if (++i % 20 === 0) console.log(`  ...${i}/${items.length}`);
    await sleep(SCRAPE_MS);
  }
  return cancelados;
}

console.log('Verificando Parte A...');
const ordersCancelados = await scrapear(pedidosA.map(x => ({ ...x })));
// para Parte A guardamos el ORDER_NO (lo que el backfill compara contra pedido.order_no)
const ordersByFolio = new Map(pedidosA.map(x => [String(x.folio), String(x.trans)]));
const orders = [...new Set(ordersCancelados.map(f => ordersByFolio.get(String(f))).filter(Boolean))];
console.log('Verificando Parte B...');
const quotes = await scrapear(quotesB);

const out = {
  generado: new Date().toISOString(),
  nota: 'Pedidos (orders, trans_type 30) y cotizaciones (quotes, trans_type 32) ANULADOS en Operam. La API no expone la cancelacion; detectado por scraping de la web legacy (view_sales_order.php). Generado por scripts/detectar-cancelados.mjs.',
  orders: orders.sort((a, b) => Number(a) - Number(b)),
  quotes: quotes.sort((a, b) => Number(a) - Number(b)),
};
writeFileSync(join(ROOT, 'data', 'cancelados.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`\nListo. orders cancelados: ${out.orders.length} | quotes cancelados: ${out.quotes.length}`);
console.log(`orders: ${out.orders.join(', ')}`);
console.log(`quotes: ${out.quotes.join(', ')}`);
console.log('Escrito data/cancelados.json');
