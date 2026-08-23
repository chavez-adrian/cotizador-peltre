// Carga historica UNICA de los pedidos de la tienda en linea (spec #254,
// ticket #258; ADR-0014). La API de Shopify solo entrega 60 dias a esta app:
// este script llena `pedidos_shopify` UNA vez con la historia completa desde
// dos fuentes posibles:
//
//   1. `--pedidos <csv>` (CAMINO PRINCIPAL: exportacion de PEDIDOS del admin de
//      Shopify, cuando el dueno la entrega): trae las dos direcciones completas
//      por pedido, el cruce con Operam sobra. MANDA sobre --clientes si se
//      pasan los dos flags.
//   2. `--clientes <csv>` (respaldo: exportacion de CLIENTES de Shopify) + los
//      pedidos `S` de Operam (cliente de canal 184, leidos en vivo, read-only):
//      se cruzan por correo/telefono para dar pais a cada pedido.
//
// Las dos pasan por la MISMA costura que el sondeo horario (ingerirPedido, via
// lib/pedidos-shopify-historico.js): NO hay una segunda regla de telefono.
//
// READ-ONLY contra Operam y contra Shopify (los CSV ya estan en disco). Con
// --aplicar solo escribe en la tabla pedidos_shopify (lib/pedidos-shopify-store.js),
// via upsert por (pedido, celular10) -- re-correr no duplica. NUNCA toca el
// cursor del sondeo horario (pedidos_shopify_estado): son fuentes independientes.
//
// Uso:
//   node scripts/cargar-pedidos-shopify-historico.mjs --pedidos ruta.csv         # DRY-RUN, camino principal
//   node scripts/cargar-pedidos-shopify-historico.mjs --pedidos ruta.csv --aplicar
//   node scripts/cargar-pedidos-shopify-historico.mjs --clientes ruta.csv        # respaldo, cruza con Operam
//
// --aplicar exige DATABASE_URL (mismo candado que scripts/rescatar-genericos.mjs):
// sin ella el store cae al fallback JSON local y escribiria datos de dev.
//
// Credenciales de Operam: como el resto de los scripts, lee OPERAM_* de un
// `.env` en la raiz del repo si la variable no esta ya en el entorno -- por
// eso `node --env-file=<otro .env> scripts/cargar-pedidos-shopify-historico.mjs`
// funciona igual (el flag nativo de Node puebla el entorno ANTES de que este
// script cargue el suyo, y aqui solo se llenan las variables que falten).
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

const argv = process.argv.slice(2);
const APLICAR = argv.includes('--aplicar');

function flagValor(nombre) {
  const i = argv.indexOf(nombre);
  return i === -1 ? null : argv[i + 1] || null;
}

const rutaClientes = flagValor('--clientes');
const rutaPedidos = flagValor('--pedidos');

if (!rutaClientes && !rutaPedidos) {
  console.error('ABORTA: pasa --clientes <csv> (exportacion de clientes de Shopify) o\n' +
    '--pedidos <csv> (exportacion de pedidos del admin, si existe).');
  process.exit(1);
}

if (APLICAR && !process.env.DATABASE_URL) {
  console.error('ABORTA: --aplicar requiere DATABASE_URL (la Neon del cotizador). Sin ella el\n' +
    'store usa el fallback JSON local y escribiria datos de dev. Configura DATABASE_URL y reintenta.');
  process.exit(1);
}

const { parsearCsv, planearCargaDesdeOperam, planearCargaDesdePedidosCsv } =
  await import('../lib/pedidos-shopify-historico.js');
const pedidosStore = await import('../lib/pedidos-shopify-store.js');

// Throttle PROACTIVO anti-429 (misma leccion que #76/#124): el rate-limit de
// Operam se dispara por RAFAGA y dura minutos. Solo aplica al modo --clientes,
// que lee Operam; el modo --pedidos no toca la red.
const THROTTLE_MS = Number(process.env.CARGA_THROTTLE_MS) || 1100;

function descartesPorMotivo(descartes) {
  const conteo = new Map();
  for (const d of descartes) {
    const motivo = d.motivo || 'sin motivo';
    conteo.set(motivo, (conteo.get(motivo) || 0) + 1);
  }
  return [...conteo.entries()].map(([motivo, cantidad]) => `${cantidad} ${motivo}`).join(', ') || 'ninguno';
}

let plan;
let modo;

if (rutaPedidos) {
  modo = 'pedidos-csv (el cruce con Operam sobra)';
  if (!existsSync(rutaPedidos)) {
    console.error(`ABORTA: no existe el archivo ${rutaPedidos}`);
    process.exit(1);
  }
  const filasPedidos = parsearCsv(readFileSync(rutaPedidos, 'utf8'));
  console.log(`Leyendo ${rutaPedidos} (${filasPedidos.length} renglones de producto)...`);
  plan = planearCargaDesdePedidosCsv({ filasPedidos });
} else {
  modo = 'clientes + pedidos S de Operam (cliente de canal 184)';
  if (!existsSync(rutaClientes)) {
    console.error(`ABORTA: no existe el archivo ${rutaClientes}`);
    process.exit(1);
  }
  const filasClientes = parsearCsv(readFileSync(rutaClientes, 'utf8'));
  console.log(`Leyendo ${rutaClientes} (${filasClientes.length} clientes)...`);

  const { listarPedidos, _setMinInterval } = await import('../lib/operam-client.js');
  _setMinInterval(THROTTLE_MS);
  console.log(`Throttle: ${THROTTLE_MS}ms entre lecturas de Operam (anti-429; ajustable con CARGA_THROTTLE_MS).`);
  console.log('Leyendo pedidos S de Operam (cliente de canal 184, read-only)...');

  const pedidosOperam = [];
  for (let skip = 0; ; skip += 100) {
    const pagina = await listarPedidos({ debtorNo: 184, skip, limit: 100 });
    const lista = Array.isArray(pagina) ? pagina : [];
    pedidosOperam.push(...lista);
    if (lista.length < 100) break;
  }
  console.log(`  ${pedidosOperam.length} pedidos leidos de Operam.`);

  plan = planearCargaDesdeOperam({ pedidosOperam, filasClientes });
}

console.log(`\nCarga historica de pedidos de Shopify (${APLICAR ? 'APLICAR' : 'DRY-RUN'}) -- modo: ${modo}\n`);
console.log('RESUMEN');
console.log(`  Pedidos leidos: ${plan.leidos}`);
if (plan.cruce) {
  console.log(`  Cruzados por correo: ${plan.cruce.correo}`);
  console.log(`  Cruzados por telefono: ${plan.cruce.telefono}`);
  console.log(`  Pais inferido de la direccion: ${plan.cruce.direccion}`);
  console.log(`  Sin pais (ningun cruce ni direccion reconocible): ${plan.cruce.sinPais}`);
}
console.log(`  Filas resueltas (telefonos que entrarian a la libreta): ${plan.filas.length}`);
if (plan.conCodigo != null) {
  console.log(`    con codigo de pais explicito: ${plan.conCodigo}`);
  console.log(`    completadas con el pais de la direccion: ${plan.porPais}`);
}
if (plan.telefonosDistintos != null) {
  console.log(`  Telefonos distintos resueltos: ${plan.telefonosDistintos}`);
}
console.log(`  Descartes: ${plan.descartes.length} (${descartesPorMotivo(plan.descartes)})`);
if (plan.compradoresSinPedido != null) {
  console.log(`  Compradores del CSV con pedidos (Total Orders > 0) sin ningun pedido S encontrado: ${plan.compradoresSinPedido}`);
}

if (!APLICAR) {
  console.log(`\nDRY-RUN: se escribirian ${plan.filas.length} filas en pedidos_shopify. No se escribio nada (sin --aplicar).`);
  process.exit(0);
}

console.log(`\nAPLICAR: escribiendo ${plan.filas.length} filas en pedidos_shopify (upsert por pedido+celular10)...`);
await pedidosStore.guardar(plan.filas);
console.log('Listo. El cursor del sondeo horario NO se toco.');
process.exit(0);
