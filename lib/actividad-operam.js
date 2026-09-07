// El estado comercial de cada Cliente Operam, cacheado (#344, spec #337,
// ADR-0016). Envoltura con IO del nucleo puro lib/estado-cliente-operam.js:
// aqui se LEE (pedidos de Operam, espejo local, lista de cancelados) y alla se
// decide.
//
// Por que un cache propio y no una consulta por cliente: la pregunta "este
// Cliente Operam tiene pedido?" la hace toda pantalla que muestre un Cliente
// Operam -- el tablero entero, cada busqueda -- y responderla cliente por
// cliente serian decenas de lecturas por pantalla contra el mismo endpoint. El
// listado de pedidos es UNA barrida paginada que las contesta todas, es la
// misma lectura que ya hace el backfill (#76), y se refresca al ritmo del
// indice de clientes (TTL 1 h, warm al arrancar).
//
// Nunca lanza y nunca bloquea de mas: un fallo de Operam deja el cache como
// estaba (o vacio), y un cache vacio se lee como "sin actividad, fuente
// incompleta" -- que es exactamente lo que es, y por eso la respuesta lo
// declara en vez de adivinar.

import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { listarPedidos } from './operam-client.js';
import { clientesCacheados } from './indice-telefonos.js';
import * as cotStore from './cotizaciones-store.js';
import * as pedidosShopifyStore from './pedidos-shopify-store.js';
import { ultimos10 } from './telefono-llave.js';
import { leerArchivoSync } from './fs-reintento.js';
import { construirActividad, estadosDeClienteOperam } from './estado-cliente-operam.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CANCELADOS_PATH = join(__dirname, '..', 'data', 'cancelados.json');

const TTL_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 5000;
const PAGINA = 100;
// Techo duro: si Operam ignorara `skip` y devolviera siempre la misma pagina, el
// ciclo giraria para siempre (mismo criterio que el resto de los paginados).
const MAX_PAGINAS = 200;
// La ventana arranca antes que el ERP: el estado comercial se deriva de TODO lo
// que Operam registra, tambien lo anterior al cotizador (ADR-0016), y un pedido
// viejo es justo el que hace que un Cliente Operam del historico no parezca no
// haber comprado nunca.
const DESDE = '2010-01-01';

let cache = { mapa: null, ts: 0 };
let refreshEnCurso = null;

// La cancelacion NO esta en la API v3 (solo en la web legacy): la lista la
// genera scripts/detectar-cancelados.mjs por scraping. Sin el archivo no se
// filtra nada -- el mismo trato que le da el backfill.
function leerCancelados() {
  try {
    if (!existsSync(CANCELADOS_PATH)) return {};
    return JSON.parse(leerArchivoSync(CANCELADOS_PATH));
  } catch {
    return {};
  }
}

async function listarTodosLosPedidos() {
  const pedidos = [];
  const hasta = new Date().toISOString().slice(0, 10);
  for (let vuelta = 0; vuelta < MAX_PAGINAS; vuelta++) {
    const pagina = await listarPedidos({ desde: DESDE, hasta, skip: pedidos.length, limit: PAGINA });
    if (!Array.isArray(pagina) || pagina.length === 0) break;
    pedidos.push(...pagina);
    if (pagina.length < PAGINA) break;
  }
  return pedidos;
}

export function refrescarActividad() {
  if (!refreshEnCurso) {
    refreshEnCurso = (async () => {
      const [pedidos, cotizaciones] = await Promise.all([
        listarTodosLosPedidos(),
        cotStore.listar(),
      ]);
      cache = {
        mapa: construirActividad({ pedidos, cotizaciones, cancelados: leerCancelados() }),
        ts: Date.now(),
      };
      return cache;
    })().finally(() => { refreshEnCurso = null; });
  }
  return refreshEnCurso;
}

async function obtenerCache({ timeoutMs = TIMEOUT_MS, ttlMs = TTL_MS } = {}) {
  if (cache.mapa && Date.now() - cache.ts <= ttlMs) return cache;
  const refresh = refrescarActividad();
  refresh.catch(err => console.warn('[actividad-operam] refresh fallo:', err.message));
  if (cache.mapa) return cache; // stale de sobra mientras llega el refresh
  const nuevo = await Promise.race([
    refresh,
    new Promise(resolve => { setTimeout(resolve, timeoutMs, null).unref?.(); }),
  ]);
  return nuevo || cache;
}

// customer_id -> { fiscal, comercial, fuenteIncompleta } para los Clientes
// Operam que se pidan. `clientes` son fichas de Operam ({ customer_id, tax_id })
// o pares { id, rfc }: el estado fiscal sale del RFC de la ficha, no del cache.
export async function estadosDeClientes(clientes) {
  const { mapa } = await obtenerCache().catch(() => ({ mapa: null }));
  const estados = new Map();
  for (const c of clientes || []) {
    const id = c && (c.customer_id ?? c.id);
    if (id == null || id === '') continue;
    const llave = String(id);
    if (estados.has(llave)) continue;
    estados.set(llave, estadosDeClienteOperam(c, mapa ? mapa.get(llave) : null));
  }
  return estados;
}

// Los estados de los Clientes Operam nombrados solo por su id (las tarjetas del
// tablero traen el `customer_id` al que se cotizo, no la ficha). El estado
// fiscal sale del RFC que Operam tiene HOY -- el padron cacheado del indice de
// telefonos, no el RFC congelado en la cotizacion, que un upgrade fiscal
// posterior deja viejo.
//
// Un id que el padron no conoce (cache frio, Operam caido, cliente inactivo) NO
// produce entrada: sin RFC no se puede decir si tiene datos fiscales, y una
// tarjeta sin etiqueta es mejor que una tarjeta con la etiqueta equivocada.
export async function estadosPorId(ids) {
  // 5 s y no el timeout largo por omision de clientesCacheados (2 min, pensado
  // para el barrido nocturno de contactos): aqui hay un vendedor esperando su
  // tablero, y vale mas una tarjeta sin etiqueta que una pantalla colgada.
  const clientes = await clientesCacheados({ timeoutMs: TIMEOUT_MS });
  const porId = new Map((clientes || []).map(c => [String(c.customer_id), c]));
  const fichas = [...new Set((ids || []).filter(id => id != null && id !== '').map(String))]
    .map(id => porId.get(id))
    .filter(Boolean);
  return estadosDeClientes(fichas);
}

// Los celulares que compraron en la tienda (#255, ADR-0014), para la etiqueta
// Cliente en linea del Contacto. Cache propio con el mismo TTL: la tabla es de
// ~1000 filas y la pregunta se hace una vez por pantalla, no una por tarjeta.
// Un fallo devuelve un conjunto vacio -- la etiqueta se pierde, nada mas.
let enLineaCache = { celulares: null, ts: 0 };

export async function celularesEnLinea({ ttlMs = TTL_MS } = {}) {
  if (enLineaCache.celulares && Date.now() - enLineaCache.ts <= ttlMs) return enLineaCache.celulares;
  try {
    const filas = await pedidosShopifyStore.listar();
    const celulares = new Set();
    for (const f of filas || []) {
      const llave = ultimos10(f && f.telefono);
      if (llave.length === 10) celulares.add(llave);
    }
    enLineaCache = { celulares, ts: Date.now() };
    return celulares;
  } catch {
    return enLineaCache.celulares || new Set();
  }
}

export function resetActividad() {
  cache = { mapa: null, ts: 0 };
  refreshEnCurso = null;
  enLineaCache = { celulares: null, ts: 0 };
}
