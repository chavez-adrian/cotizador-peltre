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
// La cancelacion de los candidatos se verifica EN VIVO por la web legacy (la foto de
// data/cancelados.json no cubre este universo: ver mas abajo), y sin esa verificacion
// --apply no escribe.
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
const { corregirListaQuote, abrirSesionWeb, transaccionCancelada } = await import('../lib/operam-web.js');
const {
  GRUPOS, foliosPorLeer, planearCorreccionListas, formatearReporte,
} = await import('../lib/correccion-lista-quotes.js');
const cotStore = await import('../lib/cotizaciones-store.js');

// Throttle PROACTIVO anti-429 (leccion de #76: el rate-limit de Operam se dispara por
// RAFAGA y una vez disparado dura >62s). Mismo default que los otros lotes.
_setMinInterval(Number(process.env.CORRECCION_THROTTLE_MS) || 1100);

const tiers = JSON.parse(leerArchivoSync(join(ROOT, 'data', 'precios.json'))).tiers || [];

// Cotizaciones ANULADAS en Operam: la API NO expone la cancelacion; solo la web legacy
// la marca. `data/cancelados.json` (scripts/detectar-cancelados.mjs) es el punto de
// partida, pero NO es un censo de quotes cancelados: su Parte B solo verifica los
// candidatos del BACKFILL (#76) -- medido el 2026-09-21, 11 folios, y el refresco dejo
// `quotes: []` borrando los 4 que traia de junio. Para el universo de aqui (toda
// cotizacion del cotizador con folio) esa foto es incompleta por construccion, asi que
// los corregibles se verifican EN VIVO mas abajo, que es la otra via que contempla
// #406 ("data/cancelados.json / deteccion web").
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

// 3) El inventario, en dos pasadas. La primera dice QUIENES son candidatos a
// corregirse; sobre ESOS -- y solo esos, que son pocos -- se verifica la cancelacion
// EN VIVO por la web legacy, porque es lo unico que la marca y la foto del detector no
// cubre este universo. La segunda pasada re-planea con lo verificado: un quote anulado
// sale del grupo corregible por el mismo camino que si hubiera estado en la foto.
const planPrevio = planearCorreccionListas({ cotizaciones, tiers, quotesCancelados, quotes, pedidosPorQuote });
const candidatos = planPrevio.grupos[GRUPOS.CORREGIBLE];

const SCRAPE_MS = Number(process.env.SCRAPE_THROTTLE_MS) || 350;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const canceladosEnVivo = [];
let verificacionEnVivo = candidatos.length === 0;
if (candidatos.length) {
  try {
    // Sesion PROPIA (abrirSesionWeb), no la compartida del post-fix: esto es lectura y
    // no debe competir por el carrito de edicion de $_SESSION.
    const consultar = await abrirSesionWeb();
    for (const fila of candidatos) {
      if (await transaccionCancelada(consultar, fila.folio, 32)) canceladosEnVivo.push(fila.folio);
      await sleep(SCRAPE_MS);
    }
    verificacionEnVivo = true;
    console.log(`Cancelacion verificada en vivo sobre ${candidatos.length} candidato(s): ` +
      `${canceladosEnVivo.length} anulado(s)${canceladosEnVivo.length ? ` (${canceladosEnVivo.join(', ')})` : ''}.`);
  } catch (err) {
    console.warn(`AVISO: no se pudo verificar la cancelacion en vivo: ${err.message}`);
  }
}

const plan = planearCorreccionListas({
  cotizaciones, tiers, quotes, pedidosPorQuote,
  quotesCancelados: [...quotesCancelados, ...canceladosEnVivo],
});
console.log('');
console.log(formatearReporte(plan, { detalleCompleto: DETALLE }));
console.log('');

const corregibles = plan.grupos[GRUPOS.CORREGIBLE];
if (!APPLY) {
  console.log('--- DRY-RUN (no se escribio nada) ---');
  console.log(`Corregiria ${corregibles.length} quote(s). Revisa el reporte y vuelve con --apply.`);
  process.exit(0);
}

// Escribir sobre un quote que nadie comprobo que siga vivo es justo lo que #406 excluye,
// y la foto del detector no cubre este universo: sin la verificacion en vivo no se aplica.
if (!verificacionEnVivo) {
  console.error('ABORTA: no se pudo verificar en vivo si los candidatos estan cancelados en Operam.\n' +
    'Sin eso no se cumple "excluir cancelados" (#406). Revisa el acceso a la web legacy y reintenta.');
  process.exit(1);
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
