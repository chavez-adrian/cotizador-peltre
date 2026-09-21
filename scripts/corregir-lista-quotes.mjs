// Corrige la lista de precios REGISTRADA en los quotes historicos de Operam (#406,
// derivado de #403).
//
// Hasta #403 el cotizador nunca mando la lista del encabezado: la API v3 la ignora por
// cualquier nombre y Operam le ponia al `order_type` la lista del CLIENTE. Cuando el
// cliente ya existia con una lista distinta a la cotizada, el quote quedo registrado
// con la lista equivocada -- los precios por partida siempre fueron correctos, cada
// linea viaja con su precio explicito -- y el pedido que se deriva hereda ese
// encabezado. Importa porque cuando un cliente recompra meses despues se consulta con
// que lista se le cotizo la primera vez.
//
// Mismo patron operativo que scripts/migrar-oportunidades.mjs y sync-catalogo.mjs:
// DRY-RUN por defecto, --apply para escribir, idempotente y con throttle anti-429.
// La escritura es SECUENCIAL (la sesion de captura de FA vive en $_SESSION: dos
// correcciones simultaneas se pisarian el carrito) y se detiene al primer quote cuya
// relectura muestre una partida alterada.
//
// El QUE lo decide el nucleo puro (lib/correccion-lista-quotes.js); el COMO escribir,
// lib/operam-web.js (corregirListaQuote, el mismo ProcessOrder que dejo #403). Aqui
// solo vive el IO.
//
// Uso:
//   node scripts/corregir-lista-quotes.mjs                 # DRY-RUN: inventario (NO escribe)
//   node scripts/corregir-lista-quotes.mjs --detalle       # ademas enumera los que ya estan bien
//   node scripts/corregir-lista-quotes.mjs --folio 1269    # acota a un folio (dry-run o apply)
//   node scripts/corregir-lista-quotes.mjs --apply         # corrige (EXIGE DATABASE_URL)
//
// HITL (#406): Adrian revisa el dry-run antes de cualquier --apply, y el --apply se
// corre en modo manual, nunca desde la cola nocturna.
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
// TODO acceso a data/*.json pasa por aqui (#117): OneDrive toma locks EBUSY
// intermitentes y un lote largo no se puede caer por eso. El .env no es data/.
import { leerArchivoSync } from '../lib/fs-reintento.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// OPERAM_* desde .env del cotizador (la API v3 y la web legacy usan las mismas);
// DATABASE_URL del entorno.
const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^(OPERAM_[A-Z]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const DETALLE = argv.includes('--detalle');
const FOLIO = (() => {
  const i = argv.indexOf('--folio');
  if (i === -1) return null;
  const v = String(argv[i + 1] ?? '').trim();
  if (!v || v.startsWith('--')) {
    console.error('ABORTA: --folio necesita el folio de Operam de la cotizacion.');
    process.exit(1);
  }
  return v;
})();

if (APPLY && !process.env.DATABASE_URL) {
  console.error('ABORTA: --apply requiere DATABASE_URL (la Neon del cotizador). Sin ella el\n' +
    'store cae al fallback JSON local y se corregirian quotes de Operam contra datos de dev.');
  process.exit(1);
}
if (!APPLY && !process.env.DATABASE_URL) {
  console.warn('AVISO: sin DATABASE_URL las cotizaciones salen de data/cotizaciones.json (dev),\n' +
    'no de la Neon de produccion. El inventario no es el real.\n');
}

const { obtenerQuote, listarPedidos, _setMinInterval } = await import('../lib/operam-client.js');
const { corregirListaQuote } = await import('../lib/operam-web.js');
const {
  GRUPOS, foliosPorLeer, planearCorreccionListas, formatearReporte,
} = await import('../lib/correccion-lista-quotes.js');
const cotStore = await import('../lib/cotizaciones-store.js');

// Throttle PROACTIVO anti-429 (leccion de #76: el rate-limit de Operam se dispara por
// RAFAGA y una vez disparado dura >62s). Mismo default que los otros lotes.
_setMinInterval(Number(process.env.CORRECCION_THROTTLE_MS) || 1100);

const tiers = JSON.parse(leerArchivoSync(join(ROOT, 'data', 'precios.json'))).tiers || [];

// Cotizaciones ANULADAS en Operam: la API NO expone la cancelacion; la lista la genera
// scripts/detectar-cancelados.mjs (scraping de la web legacy). Sin el archivo no se
// filtra nada y se avisa -- corregir un quote cancelado seria ruido en el ERP.
const canceladosPath = join(ROOT, 'data', 'cancelados.json');
let quotesCancelados = [];
if (existsSync(canceladosPath)) {
  const archivo = JSON.parse(leerArchivoSync(canceladosPath));
  quotesCancelados = archivo.quotes || [];
  // La FECHA de esa lista importa tanto como su contenido: es una foto, y un quote
  // cancelado despues de ella se veria aqui como corregible. Se imprime siempre para
  // que el HITL decida sobre un dato y no sobre la suposicion de que alguien corrio el
  // detector hace poco.
  console.log(`Cancelados: ${quotesCancelados.length} quotes, foto generada ${archivo.generado || '(sin fecha)'}.`);
  if (APPLY) console.log('  Si esa foto es vieja, corta aqui y corre: node scripts/detectar-cancelados.mjs');
} else if (APPLY) {
  // Sin la lista no se puede cumplir "excluir cancelados" (#406) y --apply escribe:
  // degradar en silencio a "no se excluye ninguno" es justo lo que no se vale.
  console.error('ABORTA: --apply exige data/cancelados.json para excluir los quotes cancelados.\n' +
    'Corre primero: node scripts/detectar-cancelados.mjs');
  process.exit(1);
} else {
  console.warn('AVISO: data/cancelados.json no existe -> NO se excluyen quotes cancelados.\n' +
    'Corre primero: node scripts/detectar-cancelados.mjs');
}

const todas = await cotStore.listar();
const cotizaciones = FOLIO === null ? todas : todas.filter(c => String(c.folioOperam ?? '') === FOLIO);
if (FOLIO !== null && !cotizaciones.length) {
  console.error(`ABORTA: ninguna cotizacion del cotizador tiene el folio ${FOLIO}.`);
  process.exit(1);
}

// 1) Los quotes que hay que mirar en Operam. Los que ya se resolvieron sin el ERP (sin
// folio, cancelados, tier fuera del catalogo) no gastan lectura ni throttle.
const folios = foliosPorLeer({ cotizaciones, tiers, quotesCancelados });
console.log(`Cotizaciones: ${cotizaciones.length} | quotes por leer en Operam: ${folios.length}`);

const quotes = new Map();
for (let i = 0; i < folios.length; i++) {
  const folio = folios[i];
  try {
    quotes.set(folio, await obtenerQuote(folio));
  } catch (err) {
    // La lectura que falla NO se anota: el nucleo la reporta como "no se leyo", que es
    // distinto de "Operam no lo tiene" (null) y de "esta bien".
    console.warn(`  aviso: no se pudo leer el quote ${folio}: ${err.message}`);
  }
  if ((i + 1) % 25 === 0) console.log(`  ... ${i + 1}/${folios.length} quotes leidos`);
}

// 2) Que quotes ya se convirtieron en pedido, segun el ERP: el pedido trae
// `trans_no_from` = el folio del quote del que nacio. Es la verdad de Operam y alcanza
// tambien a los pedidos que el cotizador nunca registro en su espejo (#62).
// El techo de paginas es el mismo freno que lib/actividad-operam.js: si Operam
// ignorara `skip`, el bucle no terminaria nunca. Tocarlo significa que el barrido quedo
// INCOMPLETO, y con un mapa incompleto un quote ya convertido en pedido pasaria por
// corregible -- exactamente lo que la spec excluye. Por eso ahi --apply aborta.
const PAGINA = 100;
const MAX_PAGINAS = 500;
const pedidosPorQuote = new Map();
let barridoCompleto = false;
{
  const hasta = new Date().toISOString().slice(0, 10);
  let leidos = 0;
  for (let vuelta = 0; vuelta < MAX_PAGINAS; vuelta++) {
    const pagina = await listarPedidos({ desde: '2010-01-01', hasta, skip: leidos, limit: PAGINA });
    if (!Array.isArray(pagina) || pagina.length === 0) { barridoCompleto = true; break; }
    for (const p of pagina) {
      const desde = p?.trans_no_from == null ? '' : String(p.trans_no_from).trim();
      if (desde && desde !== '0' && !pedidosPorQuote.has(desde)) pedidosPorQuote.set(desde, String(p.order_no));
    }
    leidos += pagina.length;
    if (pagina.length < PAGINA) { barridoCompleto = true; break; }
  }
  console.log(`Pedidos barridos: ${leidos} | quotes ya convertidos en pedido: ${pedidosPorQuote.size}` +
    (barridoCompleto ? '' : ` | BARRIDO INCOMPLETO (tope de ${MAX_PAGINAS} paginas)`));
}

// 3) El inventario.
const plan = planearCorreccionListas({ cotizaciones, tiers, quotesCancelados, quotes, pedidosPorQuote });
console.log('');
console.log(formatearReporte(plan, { detalleCompleto: DETALLE }));
console.log('');

const corregibles = plan.grupos[GRUPOS.CORREGIBLE];
if (!APPLY) {
  console.log('--- DRY-RUN (no se escribio nada) ---');
  console.log(`Corregiria ${corregibles.length} quote(s). Revisa el reporte y vuelve con --apply.`);
  process.exit(0);
}

// Un barrido truncado deja de ser la red que separa corregible de con-pedido: los
// unicos pedidos conocidos serian los que el cotizador ya tenia anotados.
if (!barridoCompleto) {
  console.error('ABORTA: el barrido de pedidos quedo incompleto, asi que no se sabe que quotes ya\n' +
    'se convirtieron en pedido. Corregir con ese mapa tocaria documentos que la spec excluye.');
  process.exit(1);
}

// 4) La correccion. SECUENCIAL y verificada una por una: el ProcessOrder repostea el
// documento entero, asi que una partida alterada detiene el lote en seco -- seguir
// seria repetir el dano en los que faltan.
console.log(`--- APLICANDO sobre ${corregibles.length} quote(s) ---`);
let corregidos = 0;
let detenido = null;
for (const fila of corregibles) {
  const r = await corregirListaQuote(fila.folio, fila.esperado);
  const encabezado = `folio ${fila.folio} (#${fila.id}, ${fila.cliente}) ${fila.actual} -> ${fila.esperado}`;
  if (r.ok) {
    corregidos++;
    console.log(`  OK  ${encabezado} | encabezado releido y partidas intactas`);
    continue;
  }
  console.error(`  FALLA ${encabezado}`);
  console.error(`        escrito=${r.escrito} lista=${JSON.stringify(r.lista)}`);
  if (r.motivo) console.error(`        motivo: ${r.motivo}`);
  if (r.partidas.discrepancias.length) {
    console.error(`        PARTIDAS ALTERADAS: ${JSON.stringify(r.partidas.discrepancias)}`);
  }
  // Una abstencion (no se escribio nada) es informacion y el lote sigue. Lo que
  // detiene el lote es haber escrito y no poder afirmar que el documento quedo bien.
  if (r.escrito) {
    detenido = fila.folio;
    break;
  }
}

console.log('');
console.log(`Corregidos: ${corregidos} de ${corregibles.length}.`);
if (detenido) {
  console.error(`DETENIDO en el folio ${detenido}: se escribio y la relectura no confirmo el documento.\n` +
    'Revisa ESE quote en Operam antes de volver a correr el script.');
  process.exit(1);
}
console.log('Vuelve a correr el dry-run: deberia reportar 0 corregibles.');
process.exit(0);
