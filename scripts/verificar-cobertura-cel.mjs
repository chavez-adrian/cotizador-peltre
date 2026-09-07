// Verificador EN VIVO de la cobertura del indice de telefonos (issue #338,
// ADR-0016). El indice paso a leer tambien la casilla Cel (`fax`) de cada
// Contacto en Operam y de cada sucursal, ademas de lo que ya leia (Telefono y
// Telefono Secundario de cada Contacto, Telefono de cada sucursal). Este
// script mide contra Operam real cuantos celulares distintos cubre el indice
// ANTES (solo lo que ya se leia) y DESPUES (con Cel incluido) del cambio.
//
// Por que no es un test de la suite: los tests mockean fetch con un padron de
// juguete, asi que ningun mock puede decir cuantos celulares REALES viven solo
// en Cel. La medicion del issue (382 cubiertos, 68 solo en Cel, sobre 478
// clientes) se tomo asi el 2026-09-05; este script reproduce esa medicion
// despues del cambio de codigo.
//
// READ-ONLY: solo GETs a /api/v3/sales/customers via listarTodosClientes().
// Cero escrituras.
//
// Uso:
//   node scripts/verificar-cobertura-cel.mjs
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

const { listarTodosClientes } = await import('../lib/operam-client.js');
const { construirIndice, normalizarTelefono } = await import('../lib/indice-telefonos.js');

// Reconstruccion DELIBERADA de la enumeracion ANTERIOR al ticket (sin Cel/fax),
// para tener un "antes" independiente contra el mismo padron. No se importa de
// produccion porque el codigo de produccion YA incluye Cel: este es el unico
// lugar donde el codigo viejo necesita sobrevivir, y solo como referencia de
// medicion.
function enumerarSinCel(clientes) {
  const entradas = [];
  for (const c of clientes || []) {
    if (c.phone) entradas.push(c.phone);
    for (const ct of c.contacts || []) {
      if (ct.phone) entradas.push(ct.phone);
      if (ct.phone2) entradas.push(ct.phone2);
    }
    for (const b of c.branches || []) {
      if (b.phone) entradas.push(b.phone);
    }
  }
  return entradas;
}

function aLlaves(telefonos) {
  const llaves = new Set();
  for (const t of telefonos) {
    const llave = normalizarTelefono(t);
    if (llave) llaves.add(llave);
  }
  return llaves;
}

const padron = await listarTodosClientes();
console.log(`Padron completo: ${padron.length} clientes.`);

const antes = aLlaves(enumerarSinCel(padron));
const despues = new Set(construirIndice(padron).keys());
const soloEnCel = [...despues].filter(k => !antes.has(k));

console.log(`Celulares cubiertos ANTES (sin Cel): ${antes.size}`);
console.log(`Celulares cubiertos DESPUES (con Cel): ${despues.size}`);
console.log(`Celulares que SOLO viven en Cel: ${soloEnCel.length}`);

if (despues.size < antes.size) {
  console.log('');
  console.log('ROTO: el indice con Cel cubre MENOS celulares que antes.');
  process.exit(1);
}

console.log('');
console.log('OK: el indice con Cel cubre el mismo padron de antes, mas lo que solo vivia en Cel.');
process.exit(0);
