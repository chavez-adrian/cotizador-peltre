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

const { listarPedidos, listarTransacciones, obtenerQuote, obtenerCliente } = await import('../lib/operam-client.js');
const { planearBackfill, memoizarPorClave } = await import('../lib/backfill-operam.mjs');
const { hechosDeOperam } = await import('../lib/sync-operam-io.js');
const { etapaPostVenta } = await import('../lib/sync-operam.js');
const cotStore = await import('../lib/cotizaciones-store.js');

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
  obtenerQuote,
  etapaDe,
  listarCotizaciones: () => cotStore.listar(),
  vendedores,
  desde, hasta,
};

console.log(`\nBackfill #76 (${APPLY ? 'APPLY' : 'DRY-RUN'}) -- rango ${desde}..${hasta}`);
console.log('Leyendo pedidos de Operam (read-only, paginado)...\n');

const plan = await planearBackfill(deps);

console.log(`Pedidos enumerados:   ${plan.totalPedidos}`);
console.log(`Candidatos (cotizacion de origen): ${plan.candidatos}`);
console.log(`  Importables (activos): ${plan.importar.length}`);
console.log(`  SKIP no-candidato (venta directa / prueba): ${plan.skips.noCandidato}`);
console.log(`  SKIP entregado (producto_entregado): ${plan.skips.entregado}`);
console.log(`  SKIP duplicado (folio ya en el store): ${plan.skips.duplicado}\n`);

for (const e of plan.importar) {
  console.log(`  IMPORTAR folio ${e.folioOperam} | order ${e.data.orderOperam} | ${e.etapa} | ${e.cliente} | $${e.total} | vendedor: ${e.vendedor ?? '(sin mapear)'}`);
}

if (!APPLY) {
  console.log(`\nDRY-RUN: se crearian ${plan.importar.length} cotizaciones. No se escribio nada (sin --apply).`);
  process.exit(0);
}

// APPLY: crea cada entrada en el store (crear -> setFolioOperam -> cambiarEtapa).
console.log(`\nAPPLY: creando ${plan.importar.length} cotizaciones...`);
let creadas = 0;
for (const e of plan.importar) {
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
