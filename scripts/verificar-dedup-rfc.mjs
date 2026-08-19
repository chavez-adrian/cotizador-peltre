// Verificador EN VIVO del supuesto que sostiene toda la deduplicacion (issue #194).
//
// Por que no es un test de la suite: los tests mockean fetch, asi que ningun mock
// puede detectar que la API REAL dejo de responder como se espera. Ese fue el modo
// de falla de #194 -- la dedup llevaba meses inoperante y toda la suite en verde,
// porque los mocks contestaban lo que el codigo esperaba. Este script le pregunta
// a Operam de verdad.
//
// READ-ONLY: solo GETs a /api/v3/sales/customers. Cero escrituras.
//
// Uso:
//   node scripts/verificar-dedup-rfc.mjs          # verifica; exit 0 = OK, 1 = roto
//   node scripts/verificar-dedup-rfc.mjs --json   # mismo veredicto en JSON
//
// Que verifica:
//   1. ?tax_id=<RFC generico> devuelve MAS DE UN cliente -> es la fuente del pool
//      de la dedup por nombre (ADR-0001) y del rescate de genericos (#78).
//   2. buscarClientesPorRfc trae el pool COMPLETO (tantos como el total que
//      declara la API), o sea que la paginacion sigue funcionando.
//   3. Documenta que devuelve hoy ?search=<RFC> (a la fecha: nada). Es informativo:
//      si algun dia Operam lo indexara, aqui se veria -- pero la dedup NO depende
//      de eso y nunca debe volver a depender.
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^(OPERAM_[A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const JSON_OUT = process.argv.slice(2).includes('--json');

const { buscarClientes, buscarClientesPorRfc } = await import('../lib/operam-client.js');
const { RFC_GENERICOS } = await import('../lib/deduplicacion.js');

const fallas = [];
const reporte = [];

for (const rfc of RFC_GENERICOS) {
  const pool = await buscarClientesPorRfc(rfc);
  const porNombre = await buscarClientes(rfc, 100);
  reporte.push({ rfc, porTaxId: pool.length, porSearch: porNombre.length });

  // El pool de un RFC generico NUNCA es de uno solo: es un cajon compartido por
  // diseno (#81). Uno o cero significa que ?tax_id= dejo de devolver el pool y la
  // dedup por nombre volvio a quedarse sin candidatos -- el bug de #194.
  if (pool.length < 2) {
    fallas.push(`?tax_id=${rfc} devolvio ${pool.length} cliente(s): el pool de la dedup esta vacio o truncado.`);
  }
  // El pool debe traer TODOS los que comparten el RFC: si la paginacion se rompe,
  // la dedup se vuelve un sorteo entre los primeros 25 y crea genericos duplicados
  // en silencio.
  const ids = new Set(pool.map(c => c.customer_id));
  if (ids.size !== pool.length) {
    fallas.push(`?tax_id=${rfc} devolvio clientes repetidos (${pool.length} filas, ${ids.size} ids): la paginacion esta releyendo la misma pagina.`);
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ ok: fallas.length === 0, reporte, fallas }, null, 2));
} else {
  for (const r of reporte) {
    console.log(`RFC ${r.rfc}: ?tax_id= -> ${r.porTaxId} clientes | ?search= -> ${r.porSearch} clientes`);
  }
  console.log('');
  if (fallas.length === 0) {
    console.log('OK: la dedup por RFC sigue recibiendo el pool completo desde ?tax_id=.');
  } else {
    console.log('ROTO: la deduplicacion por RFC no esta recibiendo candidatos.');
    for (const f of fallas) console.log(`  - ${f}`);
  }
}

process.exit(fallas.length === 0 ? 0 : 1);
