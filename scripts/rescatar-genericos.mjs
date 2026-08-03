// Lote historico de quotes de los debtors GENERICOS a la bandeja de revision
// (issue #124). Los quotes levantados sobre un cliente-cajon (GENERICO TIENDAS
// DIGITALES y sus 4 hermanos) no tienen contraparte nombrada en Operam: el backfill
// #76 los dejo fuera del pipeline y aqui se rescatan como CANDIDATOS a prospecto
// para que un humano decida uno por uno en la bandeja (#122).
//
// READ-ONLY contra Operam (cero escrituras a Operam). Con --apply solo escribe en
// la bandeja del cotizador (tabla bandeja_operam): NI UNA tarjeta del tablero, NI UN
// prospecto -- eso lo crea el humano al aceptar (#125).
//
// Uso:
//   node scripts/rescatar-genericos.mjs                    # DRY-RUN: imprime el plan (NO escribe)
//   node scripts/rescatar-genericos.mjs --apply            # deposita en la bandeja (EXIGE DATABASE_URL)
//   node scripts/rescatar-genericos.mjs --meses 18         # amplia la ventana (default 6)
//   node scripts/rescatar-genericos.mjs --folio-inicio 1150  # semilla del probe de folioMax
//   node scripts/rescatar-genericos.mjs --folio-max 1195     # techo fijo (se salta el probe)
//
// --apply exige DATABASE_URL: sin ella el store cae al fallback JSON local y
// escribiria datos de dev. Read-only contra Operam siempre.
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

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');

function flagNumerica(nombre) {
  const i = argv.indexOf(nombre);
  if (i === -1) return null;
  const n = Number(argv[i + 1]);
  if (!Number.isFinite(n)) {
    console.error(`ABORTA: ${nombre} necesita un numero (recibido: ${argv[i + 1]}).`);
    process.exit(1);
  }
  return n;
}

if (APPLY && !process.env.DATABASE_URL) {
  console.error('ABORTA: --apply requiere DATABASE_URL (la Neon del cotizador). Sin ella el\n' +
    'store usa el fallback JSON local y escribiria datos de dev. Configura DATABASE_URL y reintenta.');
  process.exit(1);
}

const { listarTodosClientes, listarPedidos, obtenerQuote, _setMinInterval } = await import('../lib/operam-client.js');
const { descubrirFolioMax, memoizarPorClave } = await import('../lib/backfill-operam.mjs');
const { GRACIA_DIAS } = await import('../lib/cruce-identidad.js');
const {
  MESES_VENTANA, fechaCorteMeses, planearRecoleccion, depositarCandidatos, MOTIVOS,
} = await import('../lib/recolector-genericos.mjs');
const bandejaStore = await import('../lib/bandeja-store.js');
const prospectosStore = await import('../lib/prospectos-store.js');
const cotStore = await import('../lib/cotizaciones-store.js');

// Throttle PROACTIVO anti-429 (misma leccion que #76: el rate-limit de Operam se
// dispara por RAFAGA y una vez disparado dura >62s). La medicion del 2026-08-01
// corrio estable a ~1.1s por lectura, que es el default de aqui. Ajustable por env.
const THROTTLE_MS = Number(process.env.RESCATE_THROTTLE_MS) || 1100;
_setMinInterval(THROTTLE_MS);

const MESES = flagNumerica('--meses') ?? MESES_VENTANA;
const hoy = new Date().toISOString().slice(0, 10);
const fechaCorte = fechaCorteMeses(MESES, hoy);

const vendedores = JSON.parse(readFileSync(join(ROOT, 'data', 'vendedores.json'), 'utf8'));

// Cotizaciones ANULADAS en Operam (#76): la API NO expone la cancelacion; la lista
// la genera scripts/detectar-cancelados.mjs (scraping de la web legacy). Aqui solo
// interesa el campo `quotes` (folios de cotizacion). Sin el archivo no se filtran.
let cancelados = { orders: [], quotes: [] };
const canceladosPath = join(ROOT, 'data', 'cancelados.json');
if (existsSync(canceladosPath)) {
  cancelados = JSON.parse(readFileSync(canceladosPath, 'utf8'));
} else {
  console.warn('AVISO: data/cancelados.json no existe -> NO se filtran cotizaciones anuladas.\n' +
    'Corre primero: node scripts/detectar-cancelados.mjs');
}

console.log(`\nRescate de genericos #124 (${APPLY ? 'APPLY' : 'DRY-RUN'}) -- ventana ${MESES} meses (quotes desde ${fechaCorte})`);
console.log(`Throttle: ${THROTTLE_MS}ms entre lecturas de Operam (anti-429; ajustable con RESCATE_THROTTLE_MS).`);
console.log('Leyendo catalogos (read-only)...');

// El quote se memoiza: el probe de folioMax y el walk pisan los mismos folios en el
// techo del rango, y cada lectura cuesta un intervalo de throttle.
const obtenerQuoteMemo = memoizarPorClave(obtenerQuote, (id) => `q:${id}`);

// Clientes COMPLETOS (el listado trae contacts[] y branches[] inline): son la unica
// fuente de identidad del cruce (#123) y de paso dan el nombre del cajon generico.
const clientes = await listarTodosClientes();

// Pedidos de TODOS los clientes en el rango. Un pedido solo puede cerrar un quote
// ANTERIOR a el (con la gracia de captura de #123), asi que basta desde la fecha de
// corte menos esa gracia.
const desdePedidos = new Date(Date.parse(`${fechaCorte}T00:00:00Z`) - GRACIA_DIAS * 86400000)
  .toISOString().slice(0, 10);
const pedidos = [];
for (let skip = 0; ; skip += 100) {
  const pagina = await listarPedidos({ desde: desdePedidos, hasta: hoy, skip, limit: 100 });
  const lista = Array.isArray(pagina) ? pagina : [];
  pedidos.push(...lista);
  if (lista.length < 100) break;
}

const prospectos = await prospectosStore.listar();
const bandeja = await bandejaStore.listar();
const bandejaFolios = bandeja.map(b => b.folio);

console.log(`  ${clientes.length} clientes | ${pedidos.length} pedidos (desde ${desdePedidos}) | ` +
  `${prospectos.length} prospectos | ${bandejaFolios.length} folios ya en la bandeja`);

// Techo del id-walk. Los quotes (tipo 32) NO son enumerables (filterType=32 devuelve
// 0 y el campo del listado es `type`, no `trans_type`, medicion 2026-08-01), asi que
// el techo se DESCUBRE probando hacia arriba desde una semilla. La semilla por
// default es el folio mas alto que el cotizador ya subio a Operam (columna
// folio_operam del store): siempre esta cerca del techo real.
let folioMax = flagNumerica('--folio-max');
if (folioMax == null) {
  let semilla = flagNumerica('--folio-inicio');
  if (semilla == null) {
    const cotizaciones = (await cotStore.listar()) || [];
    semilla = cotizaciones
      .map(c => Number(c.folioOperam))
      .filter(Number.isFinite)
      .reduce((a, b) => Math.max(a, b), 0);
  }
  if (!semilla) {
    console.error('ABORTA: no hay semilla para descubrir el folio maximo (el store de cotizaciones\n' +
      'no tiene folios de Operam). Pasa --folio-inicio N (un folio de quote reciente) o --folio-max N.');
    process.exit(1);
  }
  console.log(`Descubriendo folio maximo de quotes (probe desde ${semilla})...`);
  folioMax = await descubrirFolioMax({ obtenerQuote: obtenerQuoteMemo, inicio: semilla, maxRacha: 10, limite: 300 });
  if (folioMax == null) {
    console.error(`ABORTA: ningun quote existe desde el folio ${semilla} hacia arriba. Revisa la\n` +
      'semilla (--folio-inicio) o fija el techo con --folio-max.');
    process.exit(1);
  }
}
console.log(`folioMax: ${folioMax}`);
console.log('Caminando folios de quote hacia abajo (read-only)...\n');

const plan = await planearRecoleccion({
  obtenerQuote: obtenerQuoteMemo,
  folioMax,
  fechaCorte,
  clientes,
  pedidos,
  prospectos,
  vendedores,
  cancelados: cancelados.quotes || [],
  bandejaFolios,
});

function pesos(n) {
  return `$${Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function etiquetaMarcas(candidato, cruce) {
  const m = [];
  if (candidato.marcas.comproOtraCosa) {
    const c = cruce && cruce.cliente;
    m.push(`compro-otra-cosa${c ? ` (${c.cust_name})` : ''}`);
  }
  if (candidato.marcas.posibleDuplicado) {
    const d = cruce && cruce.duplicadoProspecto;
    m.push(`posible-duplicado${d ? ` (prospecto ${d.id} ${d.nombre})` : ''}`);
  }
  return m.length ? m.join(' + ') : '-';
}

console.log(`CANDIDATOS (${plan.candidatos.length}):`);
for (const { candidato: c, cruce } of plan.candidatos) {
  console.log(`  [+] folio ${c.folio} | ${c.fecha} | ${c.contacto || '(sin contacto)'} | ` +
    `${c.celular || '(sin celular)'} | ${c.proyecto || '(sin proyecto)'} | ${pesos(c.monto)} | ` +
    `vendedor: ${c.vendedor ?? '(sin mapear)'} | marcas: ${etiquetaMarcas(c, cruce)}`);
  console.log(`      email: ${c.email || '-'} | domicilio: ${c.domicilio || '-'} | cajon: ${c.debtorNombre || c.debtorId}`);
}

// EVIDENCIA de cada exclusion del lote (revision folio por folio, misma exigencia
// que el dry-run de #76): sin ella "ya cerro" es una caja negra y no se puede
// validar si la regla se comio una oportunidad viva.
console.log(`\nEXCLUIDOS del lote (${plan.excluidos.length}):`);
for (const e of plan.excluidos) {
  let detalle = '';
  if (e.motivo === MOTIVOS.CERRO && e.cruce) {
    const p = e.cruce.pedido;
    detalle = ` -> ${e.cruce.cliente.cust_name}` +
      (p ? ` | pedido ${p.order_no} ${pesos(p.total)} (${p.ord_date}, dif ${e.cruce.difMontoPct}%)` : '');
  }
  console.log(`  [X] folio ${e.folio} | ${e.motivo} | ${e.fecha} | ${e.contacto || '(sin contacto)'} | ${pesos(e.monto)}${detalle}`);
}

console.log('\nRESUMEN');
console.log(`  Quotes leidos (id-walk): ${plan.leidos}`);
console.log(`  Candidatos a la bandeja: ${plan.candidatos.length}`);
console.log(`    con marca compro-otra-cosa: ${plan.candidatos.filter(c => c.candidato.marcas.comproOtraCosa).length}`);
console.log(`    con marca posible-duplicado: ${plan.candidatos.filter(c => c.candidato.marcas.posibleDuplicado).length}`);
console.log(`    sin celular: ${plan.candidatos.filter(c => c.candidato.celular === '').length}`);
console.log(`    sin vendedor mapeado: ${plan.candidatos.filter(c => c.candidato.vendedor == null).length}`);
console.log(`  SKIP no-generico (quote de un cliente nombrado): ${plan.skips.noGenerico}`);
console.log(`  SKIP cancelado (anulado en Operam): ${plan.skips.cancelado}`);
console.log(`  SKIP ya-en-bandeja (propuesto en una corrida previa): ${plan.skips.yaEnBandeja}`);
console.log(`  SKIP total-cero (quote de $0): ${plan.skips.totalCero}`);
console.log(`  SKIP cerro (identidad + monto dentro de la banda): ${plan.skips.cerro}`);

if (!APPLY) {
  console.log(`\nDRY-RUN: se propondrian ${plan.candidatos.length} candidatos a la bandeja. No se escribio nada (sin --apply).`);
  process.exit(0);
}

console.log(`\nAPPLY: proponiendo ${plan.candidatos.length} candidatos a la bandeja...`);
const { agregados, yaEstaban } = await depositarCandidatos(plan, bandejaStore.proponer);
console.log(`Listo. Agregados ${agregados}, ya estaban ${yaEstaban} (idempotente: re-correr no duplica\n` +
  'ni regresa a pendiente lo que ya se acepto o descarto).');
process.exit(0);
