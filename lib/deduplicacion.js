import { ultimos10 } from './telefono-llave.js';

const ARTICULOS = new Set(['el', 'la', 'los', 'las', 'un', 'una']);
const PREPOSICIONES = new Set(['de', 'del', 'en', 'y', 'e']);
const SUFIJOS = new Set(['sa', 'srl', 'sapi', 'sc', 'ac', 'llc', 'inc', 'corp', 'ltd', 'cv']);
export const RFC_GENERICOS = new Set(['XAXX010101000', 'XEXX010101000']);

// Normalizacion canonica del RFC para comparar identidad (issue #207): mayusculas y
// sin espacios. Un RFC capturado con espacios (copiar/pegar desde un PDF) o en
// minusculas no debe contar como un RFC distinto del mismo cliente -- ni al
// compararlo contra si mismo, ni al buscarlo en el pool de Operam.
export function normalizarRfc(rfc) {
  return String(rfc || '').toUpperCase().replace(/\s+/g, '');
}

// Debtors GENERICOS de Operam (medicion #118, 2026-08-01): clientes-cajon que
// agrupan contactos sin alta propia. Sus quotes se rescatan como PROSPECTOS via
// la bandeja (#122/#124); JAMAS como cotizacion del pipeline -- el binding por
// cliente del sync (#67 prioridad 3) mezclaria las transacciones de todos los
// contactos que comparten el debtor (#125 valida este rechazo en el server). El
// backfill historico (#76) los excluye por la misma razon.
// Verificados en vivo contra la API el 2026-07-30: 143 (GENERICO TIENDAS FISICAS
// USD), 183 (GENERICO TIENDAS FISICAS), 184 (GENERICO TIENDAS DIGITALES), 256
// (GENERICO DIGITAL USD), 449 (GENERICO EXPORTACION).
// FUENTE UNICA desde #127: aqui y en ningun otro lado. Si se agrega un
// debtor-cajon en Operam, este renglon es el UNICO que hay que tocar.
export const DEBTORS_GENERICOS = new Set([143, 183, 184, 256, 449]);

// Predicado unico sobre esa lista (#125): lo consultan el gate del servidor al
// aceptar un candidato de la bandeja y el store para marcar al candidato. El id
// llega como numero (store) o como texto (payload de Operam); sin id no es
// generico (no se asume lo peor: un candidato sin debtor no agrupa a nadie).
export function esDebtorGenerico(debtorId) {
  if (debtorId == null || debtorId === '') return false;
  return DEBTORS_GENERICOS.has(Number(debtorId));
}

export function normalizarNombre(nombre) {
  if (!nombre) return [];
  const sinAcentos = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  const tokens = sinAcentos
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 0)
    .filter(t => !ARTICULOS.has(t))
    .filter(t => !PREPOSICIONES.has(t))
    .filter(t => !SUFIJOS.has(t));
  return tokens;
}

function solapamiento(tokensA, tokensB) {
  const setB = new Set(tokensB);
  return tokensA.filter(t => setB.has(t)).length;
}

function rfcDe(c) {
  return ((c.RFC || c.rfc) || '').toUpperCase().trim();
}

// Ultimos 10 digitos de un telefono, o null si no llega a 10. El algoritmo vive
// en lib/telefono-llave.js (modulo puro, sin IO) desde #123: antes se duplicaba
// aqui porque la unica copia estaba en lib/prospectos-store.js, que hubiera
// traido lib/db.js (Postgres) a un modulo puro.
function ultimos10Digitos(raw) {
  if (!raw) return null;
  const digitos = ultimos10(raw);
  return digitos.length === 10 ? digitos : null;
}

function telefonosDeCliente(c) {
  const tels = [c.phone];
  for (const ct of c.contacts || []) tels.push(ct.phone, ct.phone2);
  for (const b of c.branches || []) tels.push(b.phone);
  return tels.map(ultimos10Digitos).filter(Boolean);
}

// Tokens en comun que exige la senal de NOMBRE para marcar candidato (#204).
// Hasta #194 el pool de genericos llegaba vacio y este umbral nunca se ejercio
// contra datos reales; con el pool completo, 1 token (un nombre de pila, un
// apellido comun) dio 0/23 aciertos en la auditoria de las fichas de genericos
// -- todos falsos positivos, y cada uno detiene la subida de una cotizacion. Se
// pide 2. Con un nombre capturado de UN solo token util exigir 2 dejaria la
// dedup ciega ("Pergola", "Siscani"), asi que ahi basta el unico token que hay.
// El telefono NO pasa por aqui: es senal fuerte propia (fue lo unico que detecto
// el duplicado real "Siscani", #78) y sigue marcando candidato por si solo.
function umbralNombre(tokensInput) {
  return Math.min(2, tokensInput.length);
}

function candidatosPorNombreOTelefono(pool, tokensInput, telInput) {
  const minimo = umbralNombre(tokensInput);
  return pool
    .map(c => {
      const tokensNombre = normalizarNombre(c.CustName || '');
      const tokensRef = normalizarNombre(c.cust_ref || '');
      const sim = Math.max(solapamiento(tokensInput, tokensNombre), solapamiento(tokensInput, tokensRef));
      const telefonoMatch = telInput != null && telefonosDeCliente(c).includes(telInput);
      return { ...c, _similitud: sim, _telefonoMatch: telefonoMatch };
    })
    .filter(c => (minimo > 0 && c._similitud >= minimo) || c._telefonoMatch)
    .sort((a, b) => (Number(b._telefonoMatch) - Number(a._telefonoMatch)) || (b._similitud - a._similitud));
}

export function detectarDuplicados(rfcInput, nombreInput, clientesOperam, telefonoInput) {
  const rfcNorm = (rfcInput || '').toUpperCase().trim();
  const esGenerico = RFC_GENERICOS.has(rfcNorm);
  const tokensInput = normalizarNombre(nombreInput);
  const telInput = ultimos10Digitos(telefonoInput);

  if (!esGenerico) {
    const match = clientesOperam.find(c => rfcDe(c) === rfcNorm);
    if (match) return { tipo: 'exacto', cliente: match };

    // Issue #78: RFC real sin match exacto -- puede ser el upgrade fiscal de un
    // cliente ya existente en Operam con RFC generico (dado de alta sin CSF).
    // Fallback SOLO entre clientes con RFC generico, con dos senales: nombre
    // (mismo criterio de solapamiento que la rama generica de abajo, no se
    // inventa un umbral nuevo) y telefono (ultimos 10 digitos) como senal
    // fuerte -- marca candidato aunque el nombre no solape (caso real: el
    // aviso de telefono fue lo unico que detecto el duplicado "Siscani").
    const genericos = clientesOperam.filter(c => RFC_GENERICOS.has(rfcDe(c)));
    const candidatos = candidatosPorNombreOTelefono(genericos, tokensInput, telInput);
    if (candidatos.length === 0) return { tipo: 'libre' };
    return { tipo: 'candidatos', candidatos };
  }

  const candidatosRfc = clientesOperam.filter(c => rfcDe(c) === rfcNorm);
  const candidatos = candidatosPorNombreOTelefono(candidatosRfc, tokensInput, telInput);
  if (candidatos.length === 0) return { tipo: 'libre' };
  return { tipo: 'candidatos', candidatos };
}
