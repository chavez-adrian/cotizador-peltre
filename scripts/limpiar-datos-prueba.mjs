// Limpieza de datos de prueba del cotizador (issue #75).
// DESTRUCTIVO en la BD del cotizador (tablas `cotizaciones` y `prospectos`).
// NUNCA toca Operam (solo lectura para clasificar) ni otras tablas de la Neon
// compartida. Respaldo OBLIGATORIO antes de borrar; idempotente.
//
// Uso:
//   node scripts/limpiar-datos-prueba.mjs                      # dry-run (no borra)
//   node scripts/limpiar-datos-prueba.mjs --apply              # borra PRUEBA (conserva real-en-Operam) + respaldo
//   node scripts/limpiar-datos-prueba.mjs --apply --incluir-real  # borra tambien las real-en-Operam
//
// Requiere DATABASE_URL (Neon del cotizador) y OPERAM_* en el entorno. Sin
// DATABASE_URL ABORTA (no corre contra el fallback JSON local).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// OPERAM_* desde .env del cotizador (cruce read-only); DATABASE_URL del entorno.
const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^(OPERAM_[A-Z]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const APPLY = process.argv.includes('--apply');
const INCLUIR_REAL = process.argv.includes('--incluir-real');

if (!process.env.DATABASE_URL) {
  console.error('ABORTA: requiere DATABASE_URL (la Neon del cotizador). Sin ella los stores\n' +
    'usan el fallback JSON local y borrarian datos de dev. Configura DATABASE_URL y reintenta.');
  process.exit(1);
}

const { buscarClientePorRFC } = await import('../lib/operam-client.js');
const cotStore = await import('../lib/cotizaciones-store.js');
const prospectosStore = await import('../lib/prospectos-store.js');

const rfcDe = (e) => (e?.data?.cliente?.rfc || '').trim().toUpperCase();

const cots = await cotStore.listar();
const prosp = await prospectosStore.listar();

// Clasificar cotizaciones: real = el cliente (RFC) existe en Operam (read-only).
const rfcs = [...new Set(cots.map(rfcDe).filter(Boolean))];
const enOperam = new Map();
for (const rfc of rfcs) {
  try { const r = await buscarClientePorRFC(rfc); enOperam.set(rfc, !!r.encontrado); }
  catch { enOperam.set(rfc, false); }
}
const esReal = (e) => { const rfc = rfcDe(e); return rfc ? enOperam.get(rfc) === true : false; };
const cotsReal = cots.filter(esReal);
const cotsPrueba = cots.filter(e => !esReal(e));

console.log(`\nCotizaciones: ${cots.length}  (prueba: ${cotsPrueba.length}, real-en-Operam: ${cotsReal.length})`);
for (const e of cotsReal) console.log(`  REAL  #${e.id} ${e.cliente} (${rfcDe(e)})`);
console.log(`Prospectos: ${prosp.length}  (todos prueba, decision Adrian)`);

const cotsABorrar = INCLUIR_REAL ? cots : cotsPrueba;
const prospABorrar = prosp;

if (!APPLY) {
  console.log(`\nDRY-RUN: se borrarian ${cotsABorrar.length} cotizaciones + ${prospABorrar.length} prospectos.`);
  if (cotsReal.length && !INCLUIR_REAL) console.log(`  (se CONSERVAN ${cotsReal.length} real-en-Operam; usa --incluir-real para borrarlas)`);
  console.log('No se borro nada (sin --apply).');
  process.exit(0);
}

// APPLY: respaldo EXACTO (SELECT *) de ambas tablas antes de borrar.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const rawCots = (await pool.query('SELECT * FROM cotizaciones ORDER BY id')).rows;
const rawProsp = (await pool.query('SELECT * FROM prospectos ORDER BY id')).rows;
await pool.end();

const backupsDir = join(ROOT, 'backups');
if (!existsSync(backupsDir)) mkdirSync(backupsDir);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = join(backupsDir, `limpieza-${stamp}.json`);
writeFileSync(backupPath, JSON.stringify({
  fecha: new Date().toISOString(),
  borrados: { cotizaciones: cotsABorrar.map(e => e.id), prospectos: prospABorrar.map(e => e.id) },
  respaldo: { cotizaciones: rawCots, prospectos: rawProsp },
}, null, 2));
console.log(`\nRespaldo escrito: ${backupPath}  (${rawCots.length} cot + ${rawProsp.length} prosp exactos)`);

let nc = 0; for (const e of cotsABorrar) if (await cotStore.borrar(e.id)) nc++;
let np = 0; for (const e of prospABorrar) if (await prospectosStore.borrar(e.id)) np++;
console.log(`Borradas: ${nc} cotizaciones, ${np} prospectos.`);
console.log('Listo. (Reversible desde el respaldo si hiciera falta.)');
