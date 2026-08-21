import { listarTodosClientes } from './operam-client.js';
import { ultimos10 } from './prospectos-store.js';

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

function telefonosDe(c) {
  const telefonos = [c.phone];
  for (const ct of c.contacts || []) telefonos.push(ct.phone, ct.phone2);
  for (const b of c.branches || []) telefonos.push(b.phone);
  return telefonos;
}

export function construirIndice(clientes) {
  const mapa = new Map();
  for (const c of clientes || []) {
    const entrada = { customer_id: c.customer_id, cust_name: c.CustName };
    for (const t of telefonosDe(c)) {
      const llave = normalizarTelefono(t);
      if (llave && !mapa.has(llave)) mapa.set(llave, entrada);
    }
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
export async function buscarClientesPorTexto(query, opts = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  try {
    const { mapa, clientes } = await obtenerCache(opts);
    if (!clientes) return [];
    const qLower = q.toLowerCase();
    const resultados = clientes.filter(c =>
      (c.CustName || '').toLowerCase().includes(qLower) ||
      (c.cust_ref || '').toLowerCase().includes(qLower)
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
      const c = clientes.find(c => telefonosDe(c).some(t => (normalizarTelefono(t) || '').endsWith(qDigitos)));
      if (c) agregar(c.customer_id);
    }

    return resultados;
  } catch {
    return [];
  }
}

// Padron COMPLETO de Operam tal cual lo devuelve el listado paginado (#242): la
// dedup por cust_ref necesita mirar a TODOS los clientes, no solo a los del pool
// de un RFC, y el ?search= de Operam no indexa ni el cust_ref ni el RFC (#194).
// Es la misma cache de #42 (TTL 1 h, refresh bajo demanda), asi que mirar todo
// Operam no cuesta una lectura nueva en el caso comun. Best effort como
// buscarClientesPorTexto: un fallo o una cache fria devuelven [] y JAMAS lanzan
// -- quien lo consume decide sin este dato, nunca se queda sin responder.
export async function clientesCacheados(opts = {}) {
  try {
    const { clientes } = await obtenerCache(opts);
    return clientes || [];
  } catch {
    return [];
  }
}

export function resetIndice() {
  cache = { mapa: null, clientes: null, ts: 0 };
  refreshEnCurso = null;
}
