import { listarTodosClientes } from './operam-client.js';
import { ultimos10 } from './prospectos-store.js';
import { normalizarBusqueda } from '../public/js/alta-logica.js';

// Indice celular (ultimos 10 digitos) -> { customer_id, cust_name } de los
// clientes de Operam (issue #42, guardrail de CONTEXT.md "Prospecto"). Los
// telefonos NO viven en el cliente: el listado paginado de /sales/customers
// trae inline contacts[].phone/phone2 y branches[].phone (verificado contra
// produccion 2026-06-10: 440 clientes, 549 telefonos en contacts y 263 en
// branches, customer.phone siempre ausente). Formatos inconsistentes, con
// extensiones (",116", "ext.123") que se recortan antes de tomar los ultimos
// 10 digitos; numeros de menos de 10 digitos no producen llave (limite
// documentado del best effort). Cache en memoria con TTL de 1 h y refresh
// bajo demanda; un fallo de Operam nunca lanza desde matchCliente.

const TTL_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 5000;

let cache = { mapa: null, clientes: null, ts: 0 };
let refreshEnCurso = null;

export function normalizarTelefono(raw) {
  if (!raw) return null;
  const llave = ultimos10(raw);
  return llave.length === 10 ? llave : null;
}

// Un telefono del cliente CON SU PROCEDENCIA: quien contesta, con que rol y con
// que correo (#228). El indice de #42 solo necesita el numero y tira el resto;
// el Contacto de Google necesita justo lo que se tiraba, y recorrer los clientes
// una segunda vez para recuperarlo seria repetir la unica parte cara (el listado
// paginado). De ahi que la enumeracion sea una sola y el indice se construya
// sobre ella.
//
// Las llaves son las de Operam (`action`/`ref`, `br_name`, `contact_name`,
// `CustName`, `cust_ref`) y se traducen AQUI: el nucleo puro que arma la ficha
// (lib/contactos-logica.js) no debe conocerlas. Esta funcion no decide nada --
// no compone nombres ni elige respaldos.
export function enumerarTelefonosClientes(clientes) {
  const entradas = [];
  for (const c of clientes || []) {
    const cliente = {
      customerId: c.customer_id,
      nombreCorto: c.cust_ref || '',
      razonSocial: c.CustName || '',
    };
    const agregar = (telefono, extra) => {
      if (!telefono) return;
      entradas.push({ ...cliente, telefono, persona: '', rol: '', correo: '', domicilio: '', ...extra });
    };
    // El telefono a nivel cliente esta SIEMPRE ausente en produccion (verificado
    // 2026-06-10), pero se enumera igual por si algun dia aparece: sin persona ni
    // rol que atribuirle.
    agregar(c.phone, { fuente: 'contacto' });
    for (const ct of c.contacts || []) {
      const contacto = {
        persona: ct.name || ct.name2 || '',
        rol: ct.action || ct.ref || '',
        correo: ct.email || '',
        fuente: 'contacto',
      };
      // phone y phone2 son dos numeros de LA MISMA persona.
      agregar(ct.phone, contacto);
      agregar(ct.phone2, contacto);
    }
    for (const b of c.branches || []) {
      agregar(b.phone, {
        persona: b.contact_name || '',
        domicilio: b.br_name || b.branch_ref || '',
        correo: b.email || '',
        fuente: 'domicilio',
      });
    }
  }
  return entradas;
}

export function construirIndice(clientes) {
  const mapa = new Map();
  for (const e of enumerarTelefonosClientes(clientes)) {
    const llave = normalizarTelefono(e.telefono);
    if (!llave || mapa.has(llave)) continue;
    mapa.set(llave, { customer_id: e.customerId, cust_name: e.razonSocial });
  }
  return mapa;
}

export function refrescarIndice() {
  if (!refreshEnCurso) {
    refreshEnCurso = listarTodosClientes()
      .then(clientes => {
        cache = { mapa: construirIndice(clientes), clientes, ts: Date.now() };
        return cache;
      })
      .finally(() => { refreshEnCurso = null; });
  }
  return refreshEnCurso;
}

// Refresco PUNTUAL del cache tras escribir un cliente en Operam (#327). El upgrade
// fiscal ya relee al cliente para verificar lo que Operam acepto, asi que la entrada
// fresca esta en la mano y no cuesta una llamada mas -- un refrescarIndice() completo
// ahi seria releer el padron paginado entero (con su freno anti-429) por un cliente.
// Sin esto el buscador seguia devolviendo al cliente con su nombre y su RFC generico
// viejos hasta 1 h despues de actualizarlo, y el banner del upgrade se ofrecia a
// sustituir un RFC generico que ya no existia.
//
// Cache frio: no-op a proposito -- la proxima lectura carga el padron entero y fresco.
// La POSICION en el arreglo se conserva: construirIndice resuelve un telefono
// compartido con "primer cliente gana", asi que mover la entrada al final cambiaria
// quien gana ese telefono. `ts` no se toca: una escritura puntual no debe extender el
// TTL del resto del padron.
// Un refrescarIndice() que ya estuviera en vuelo y aterrice DESPUES pisa esta
// actualizacion y el cliente vuelve a verse viejo; con un solo proceso y ~7 s de
// ventana por hora, se acepta.
export function actualizarClienteEnCache(cliente) {
  // `?.length` y no solo `!cache.clientes`: un listado que volvio VACIO deja
  // `cache.clientes = []`, que es un cache "caliente" para el resto del modulo. Insertar
  // ahi dejaria un padron de UN cliente, y el freno "sin evidencia" del barrido de
  // contactos (#231) solo detecta la fuente vacia -- con un cliente ya no se dispara y
  // solo quedaria el tope del 20%. Un padron de uno no es evidencia de nada.
  if (!cache.clientes?.length || !cliente || cliente.customer_id == null) return;
  const id = String(cliente.customer_id);
  const i = cache.clientes.findIndex(c => String(c.customer_id) === id);
  const clientes = i === -1
    ? [...cache.clientes, cliente]
    : cache.clientes.map((c, n) => (n === i ? cliente : c));
  cache = { ...cache, clientes, mapa: construirIndice(clientes) };
}

async function obtenerCache({ timeoutMs = TIMEOUT_MS, ttlMs = TTL_MS } = {}) {
  if (cache.mapa && Date.now() - cache.ts <= ttlMs) return cache;
  const refresh = refrescarIndice();
  refresh.catch(err => console.warn('[indice-telefonos] refresh fallo:', err.message));
  if (cache.mapa) return cache; // stale de sobra mientras llega el refresh
  const nuevo = await Promise.race([
    refresh,
    new Promise(resolve => { setTimeout(resolve, timeoutMs, null).unref?.(); }),
  ]);
  return nuevo || cache;
}

// Los clientes tal como los tiene el cache, para la sincronizacion de Contactos
// de Google (#228). Sale por aqui y no por listarTodosClientes a proposito: el
// listado es paginado y con freno anti-429, y este cache es el UNICO punto donde
// se decide cada cuanto se relee. Un barrido con su propia llamada duplicaria la
// presion sobre Operam; leyendo de aqui hereda el ritmo horario que ya existe.
//
// El timeout por omision es mas largo que el de matchCliente: alli hay un
// vendedor esperando la respuesta y vale mas un best effort que una espera; aqui
// no hay nadie esperando y una pasada sin clientes seria una pasada perdida.
// Nunca lanza: un fallo de Operam deja la pasada sin la segunda fuente, no la
// tumba.
const TIMEOUT_BARRIDO_MS = 120000;

export async function clientesCacheados(opts = {}) {
  try {
    const { clientes } = await obtenerCache({ timeoutMs: TIMEOUT_BARRIDO_MS, ...opts });
    return clientes || [];
  } catch {
    return [];
  }
}

export async function matchCliente(celular, opts = {}) {
  const llave = normalizarTelefono(celular);
  if (!llave) return null;
  try {
    const { mapa } = await obtenerCache(opts);
    if (!mapa) return null;
    return mapa.get(llave) || null;
  } catch {
    return null;
  }
}

// Busqueda de UI (issue #97): cablea el mismo indice de #42 a texto libre --
// nombre corto (cust_ref) y razon social por substring sobre la lista cacheada,
// telefono de 10 digitos (o +52...) por lookup O(1) en el mismo mapa que usa
// matchCliente. El formato "sin lada" (8-9 digitos, ej. celular de Mexico sin
// el 55) no arma una llave de 10 digitos -- fallback O(n) sobre la misma lista
// cacheada, reutilizando normalizarTelefono (sufijo), sin normalizacion nueva.
// El substring de nombre/nombre corto pliega acentos y mayusculas con
// normalizarBusqueda (issue #292, cross-import de public/js/alta-logica.js:
// los modulos de public/js no importan de lib/, pero lib/ SI de public/js).
export async function buscarClientesPorTexto(query, opts = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  try {
    const { mapa, clientes } = await obtenerCache(opts);
    if (!clientes) return [];
    const qNormalizado = normalizarBusqueda(q);
    const resultados = clientes.filter(c =>
      normalizarBusqueda(c.CustName).includes(qNormalizado) ||
      normalizarBusqueda(c.cust_ref).includes(qNormalizado)
    );
    const agregar = (customerId) => {
      if (resultados.some(c => c.customer_id === customerId)) return;
      const full = clientes.find(c => c.customer_id === customerId);
      if (full) resultados.push(full);
    };

    const llave = normalizarTelefono(q);
    const entrada = llave ? mapa?.get(llave) : null;
    if (entrada) agregar(entrada.customer_id);

    const qDigitos = q.replace(/\D/g, '');
    if (!entrada && qDigitos.length >= 8 && qDigitos.length < 10) {
      // Una sola pasada sobre todos los telefonos (en orden de cliente, asi que
      // el primer match sigue siendo el primer cliente que lo tiene).
      const suelta = enumerarTelefonosClientes(clientes)
        .find(e => (normalizarTelefono(e.telefono) || '').endsWith(qDigitos));
      if (suelta) agregar(suelta.customerId);
    }

    return resultados;
  } catch {
    return [];
  }
}

export function resetIndice() {
  cache = { mapa: null, clientes: null, ts: 0 };
  refreshEnCurso = null;
}
