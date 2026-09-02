// Censo EN VIVO de los clientes de Operam sin lista de precios (issue #285).
//
// Un cliente con sales_type 0 no puede valuar ningun documento: la subida de
// CUALQUIER cotizacion suya falla con "Operam 406: Debe haber al menos un rate de
// moneda" y el documento sale como PRE-COTIZACION. Desde #285 el cotizador lo
// detecta y lo dice, pero solo cuando alguien intenta cotizarle: este script
// recorre el padron completo para corregirlos de una vez en Operam, antes de que
// el vendedor se tope con ellos.
//
// Por que no es un test: la lista vive en Operam, no en el codigo. Ningun mock
// puede contestar quien la perdio (misma razon que scripts/verificar-dedup-rfc.mjs).
// La regla de clasificacion si esta cubierta: lib/lista-precios-cliente.js.
//
// READ-ONLY: solo GETs a /api/v3/sales/customers. Cero escrituras -- asignar la
// lista es una decision comercial y se hace en Operam.
//
// Uso:
//   node scripts/clientes-sin-lista.mjs     # exit 0 = nadie sin lista, 1 = hay
//
// El listado de clientes NO trae sales_type: hay que leer cliente por cliente, en
// SECUENCIA y con el throttle proactivo anti-429 (leccion de #76: el rate-limit de
// Operam se dispara por rafaga y una vez disparado dura mas que los reintentos).
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

const { listarTodosClientes, obtenerClientePorId, _setMinInterval } = await import('../lib/operam-client.js');
const { clienteSinListaPrecios, LISTAS_PRECIOS_VIGENTES } = await import('../lib/lista-precios-cliente.js');

const THROTTLE_MS = Number(process.env.OPERAM_THROTTLE_MS) || 1100;
_setMinInterval(THROTTLE_MS);

// listarTodosClientes no pide show_inactive: el padron ACTIVO es justo el que
// interesa (a un cliente desactivado nadie le va a cotizar).
const padron = await listarTodosClientes();
console.log(`Padron activo: ${padron.length} clientes. Leyendo uno por uno (el listado no trae sales_type)...`);

const sinLista = [];
const errores = [];
let leidos = 0;
for (const c of padron) {
  const id = c.customer_id;
  let ficha;
  try {
    ficha = await obtenerClientePorId(id);
  } catch (err) {
    // Un cliente ilegible no puede declararse "con lista" ni "sin lista": se
    // reporta aparte para revisarlo a mano, sin contaminar el censo.
    errores.push(`${id} (${c.CustName || 'sin nombre'}): ${err.message}`);
    continue;
  }
  leidos++;
  if (clienteSinListaPrecios(ficha)) {
    sinLista.push({
      id,
      nombre: ficha?.CustName || c.CustName || '',
      cust_ref: ficha?.cust_ref || c.cust_ref || '',
      sales_type: ficha?.sales_type ?? '(ausente)',
    });
  }
  if (leidos % 50 === 0) console.log(`  ...${leidos}/${padron.length}`);
}

console.log('');
if (sinLista.length) {
  console.log(`CLIENTES SIN LISTA DE PRECIOS: ${sinLista.length}`);
  console.log('id       | sales_type | cust_ref                       | nombre');
  for (const c of sinLista) {
    console.log(
      `${String(c.id).padEnd(8)} | ${String(c.sales_type).padEnd(10)} | ${String(c.cust_ref).slice(0, 30).padEnd(30)} | ${c.nombre}`
    );
  }
  console.log('');
  console.log(`Asignales una lista en Operam (${LISTAS_PRECIOS_VIGENTES}). Este script NO escribe.`);
} else {
  console.log(`OK: los ${leidos} clientes leidos tienen lista de precios.`);
}

if (errores.length) {
  console.log('');
  console.log(`No se pudieron leer ${errores.length} cliente(s):`);
  for (const e of errores) console.log(`  - ${e}`);
}

process.exit(sinLista.length === 0 ? 0 : 1);
