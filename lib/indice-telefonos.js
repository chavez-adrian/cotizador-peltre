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

let cache = { mapa: null, ts: 0 };
let refreshEnCurso = null;

export function normalizarTelefono(raw) {
  if (!raw) return null;
  const llave = ultimos10(raw);
  return llave.length === 10 ? llave : null;
}

export function construirIndice(clientes) {
  const mapa = new Map();
  for (const c of clientes || []) {
    const entrada = { customer_id: c.customer_id, cust_name: c.CustName };
    const telefonos = [c.phone];
    for (const ct of c.contacts || []) telefonos.push(ct.phone, ct.phone2);
    for (const b of c.branches || []) telefonos.push(b.phone);
    for (const t of telefonos) {
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
        cache = { mapa: construirIndice(clientes), ts: Date.now() };
        return cache.mapa;
      })
      .finally(() => { refreshEnCurso = null; });
  }
  return refreshEnCurso;
}

export async function matchCliente(celular, { timeoutMs = TIMEOUT_MS, ttlMs = TTL_MS } = {}) {
  const llave = normalizarTelefono(celular);
  if (!llave) return null;
  try {
    let mapa = cache.mapa;
    if (!mapa || Date.now() - cache.ts > ttlMs) {
      const refresh = refrescarIndice();
      refresh.catch(err => console.warn('[indice-telefonos] refresh fallo:', err.message));
      if (!mapa) {
        mapa = await Promise.race([
          refresh,
          new Promise(resolve => { setTimeout(resolve, timeoutMs, null).unref?.(); }),
        ]);
      }
    }
    if (!mapa) return null;
    return mapa.get(llave) || null;
  } catch {
    return null;
  }
}

export function resetIndice() {
  cache = { mapa: null, ts: 0 };
  refreshEnCurso = null;
}
