// Detecta pedidos/cotizaciones ANULADOS en Operam y genera data/cancelados.json
// (issue #76/#77). La API v3 NO expone el estado de cancelacion: un pedido anulado luce
// igual que uno activo en el listado y en el detalle. Solo la web legacy
// (view_sales_order.php, que lee 0_voided de FA) lo marca con "Este pedido ha sido
// cancelado". Este script enumera TODOS los candidatos del backfill (no solo los que se
// importarian: la clasificacion importable/cerrado varia con los datos en vivo y con el
// fix de entrega parcial), scrapea cada uno con login web (lib/operam-web.js, con
// re-login si la sesion expira) y escribe la lista de cancelados. El backfill lee ese
// json y los excluye (NO scrapea en runtime: la fragilidad de la web queda aislada aqui).
//
// Uso:  node scripts/detectar-cancelados.mjs
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

const { listarPedidos, obtenerQuote, obtenerCliente, _setMinInterval } = await import('../lib/operam-client.js');
const { planearBackfillSinPedido, descubrirFolioMax, memoizarPorClave, esCandidatoBackfill, esSucursalTlapacoya } = await import('../lib/backfill-operam.mjs');
const { abrirSesionWeb, estaCanceladoHtml } = await import('../lib/operam-web.js');
const cotStore = await import('../lib/cotizaciones-store.js');

_setMinInterval(Number(process.env.BACKFILL_THROTTLE_MS) || 1500);
const SCRAPE_MS = Number(process.env.SCRAPE_THROTTLE_MS) || 350;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const vendedores = JSON.parse(readFileSync(join(ROOT, 'data', 'vendedores.json'), 'utf8'));
const hasta = new Date().toISOString().slice(0, 10);
const desde = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 2); return d.toISOString().slice(0, 10); })();

const debtorCache = new Map();
async function obtenerDebtor(debtorNo) { const k = String(debtorNo); if (debtorCache.has(k)) return debtorCache.get(k); const c = await obtenerCliente(debtorNo); debtorCache.set(k, c); return c; }
const obtenerQuoteMemo = memoizarPorClave(obtenerQuote, (id) => `q:${id}`);

console.log(`detectar-cancelados (#76/#77) -- rango ${desde}..${hasta}`);
console.log('PARTE A: enumerando pedidos candidatos (listado, sin hechos)...');
const pedidos = [];
for (let skip = 0; ; skip += 100) {
  const p = await listarPedidos({ skip, limit: 100, desde, hasta });
  const lista = Array.isArray(p) ? p : [];
  pedidos.push(...lista);
  if (lista.length < 100) break;
}
const candA = pedidos.filter(p => esCandidatoBackfill(p) && esSucursalTlapacoya(p));
const ordersA = [...new Set(candA.map(p => String(p.order_no)).filter(o => o && o !== 'null'))];
const foliosConPedido = new Set(candA.map(p => p.trans_no_from != null ? String(p.trans_no_from) : null).filter(Boolean));
console.log(`  ${pedidos.length} pedidos -> ${candA.length} candidatos (sucursal 01) -> ${ordersA.length} order_no a verificar.`);

console.log('PARTE B: id-walk de cotizaciones candidatas...');
const fechaCorte = (() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString().slice(0, 10); })();
const folioSeed = [...foliosConPedido].map(Number).filter(Number.isFinite).reduce((a, b) => Math.max(a, b), 0);
let quotesB = [];
if (folioSeed > 0) {
  const folioMax = await descubrirFolioMax({ obtenerQuote: obtenerQuoteMemo, inicio: folioSeed, maxRacha: 10, limite: 300 });
  const planB = await planearBackfillSinPedido({
    obtenerQuote: obtenerQuoteMemo, obtenerDebtor, foliosConPedido,
    listarCotizaciones: () => cotStore.listar(), vendedores, folioMax, fechaCorte,
  });
  quotesB = [...new Set(planB.importar.map(e => String(e.folioOperam)))];
}
console.log(`  ${quotesB.length} cotizaciones (folios) a verificar.`);

console.log('Login web (FrontAccounting)...');
const consultar = await abrirSesionWeb();
// Sonda: 5960 es un cancelado conocido. Si NO sale cancelado, el login fallo o el HTML
// cambio: aborta para no escribir una lista vacia que desactivaria el filtro.
if (!estaCanceladoHtml(await consultar(5960, 30))) {
  console.error('ABORTA: la sonda 5960 no salio cancelada. Login fallido o HTML cambiado. No se escribe cancelados.json.');
  process.exit(1);
}

async function scrapear(items, tt, etiqueta) {
  const cancelados = [];
  let i = 0;
  for (const trans of items) {
    if (estaCanceladoHtml(await consultar(trans, tt))) cancelados.push(String(trans));
    if (++i % 25 === 0) console.log(`  ${etiqueta} ${i}/${items.length} (cancelados hasta ahora: ${cancelados.length})`);
    await sleep(SCRAPE_MS);
  }
  return cancelados;
}

console.log('Verificando Parte A (pedidos, trans_type 30)...');
const orders = await scrapear(ordersA, 30, 'A');
console.log('Verificando Parte B (cotizaciones, trans_type 32)...');
const quotes = await scrapear(quotesB, 32, 'B');

const out = {
  generado: new Date().toISOString(),
  nota: 'Pedidos (orders, trans_type 30) y cotizaciones (quotes, trans_type 32) ANULADOS en Operam. La API no expone la cancelacion; detectado por scraping de la web legacy (view_sales_order.php) sobre TODOS los candidatos. Generado por scripts/detectar-cancelados.mjs.',
  orders: orders.sort((a, b) => Number(a) - Number(b)),
  quotes: quotes.sort((a, b) => Number(a) - Number(b)),
};
writeFileSync(join(ROOT, 'data', 'cancelados.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`\nListo. orders cancelados: ${out.orders.length} | quotes cancelados: ${out.quotes.length}`);
console.log(`orders: ${out.orders.join(', ')}`);
console.log(`quotes: ${out.quotes.join(', ')}`);
console.log('Escrito data/cancelados.json');
