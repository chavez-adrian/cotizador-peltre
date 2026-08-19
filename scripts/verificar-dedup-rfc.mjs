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
//   node scripts/verificar-dedup-rfc.mjs     # exit 0 = la dedup recibe su pool, 1 = roto
//
// Que verifica, por cada RFC generico:
//   1. El pool NO llega vacio ni colapsado a un solo cliente (es un cajon
//      compartido por diseno, #81): es la fuente de la dedup por nombre (ADR-0001)
//      y del rescate de genericos (#78).
//   2. El pool esta COMPLETO. La referencia NO es el `total` que declara la misma
//      respuesta (si la paginacion se rompe, ese numero miente igual): se cuenta
//      contra `listarTodosClientes()`, que recorre el padron entero por otro
//      camino. Dos lecturas independientes que deben coincidir -- asi se detecta
//      una truncacion silenciosa, que es la otra mitad del bug de #194.
//   3. Documenta que devuelve hoy ?search=<RFC> (a la fecha: nada). Informativo:
//      si Operam algun dia lo indexara, aqui se veria -- pero la dedup NO depende
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

const { buscarClientes, buscarClientesPorRfc, listarTodosClientes } = await import('../lib/operam-client.js');
const { RFC_GENERICOS } = await import('../lib/deduplicacion.js');

const fallas = [];

// Referencia independiente: el padron completo, leido por el otro camino (sin
// filtro de RFC). listarTodosClientes tampoco pide show_inactive, asi que las dos
// lecturas cuentan lo mismo.
const padron = await listarTodosClientes();
console.log(`Padron completo (referencia independiente): ${padron.length} clientes activos.`);

for (const rfc of RFC_GENERICOS) {
  const pool = await buscarClientesPorRfc(rfc);
  const esperado = padron.filter(c => String(c.tax_id || '').toUpperCase().trim() === rfc).length;
  const porNombre = await buscarClientes(rfc, 100);
  console.log(`RFC ${rfc}: ?tax_id= -> ${pool.length} | padron -> ${esperado} | ?search= -> ${porNombre.length}`);

  // Uno o cero significa que ?tax_id= dejo de devolver el pool y la dedup por
  // nombre volvio a quedarse sin candidatos: el bug de #194.
  if (pool.length < 2) {
    fallas.push(`?tax_id=${rfc} devolvio ${pool.length} cliente(s): el pool de la dedup esta vacio o colapsado.`);
  }
  // Truncacion silenciosa: la dedup se vuelve un sorteo entre los primeros N y
  // crea genericos duplicados sin una sola senal.
  if (pool.length !== esperado) {
    fallas.push(`?tax_id=${rfc} devolvio ${pool.length} de ${esperado} clientes del padron: el pool llega truncado.`);
  }
  const ids = new Set(pool.map(c => c.customer_id));
  if (ids.size !== pool.length) {
    fallas.push(`?tax_id=${rfc} devolvio clientes repetidos (${pool.length} filas, ${ids.size} ids): la paginacion relee la misma pagina.`);
  }
}

console.log('');
if (fallas.length === 0) {
  console.log('OK: la dedup por RFC sigue recibiendo el pool completo desde ?tax_id=.');
} else {
  console.log('ROTO: la deduplicacion por RFC no esta recibiendo su pool.');
  for (const f of fallas) console.log(`  - ${f}`);
}

process.exit(fallas.length === 0 ? 0 : 1);
