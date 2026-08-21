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
// 14 (PUBLICO EN GENERAL, #201, semantica confirmada por Adrian 2026-08-19): esta
// ficha esta reservada desde hace ~2-3 anos para clientes de BAZAR -- es el
// destino de la factura global para el SAT, que engloba a todos los clientes
// que no pidieron factura en el periodo elegido. Agrupa compradores sin
// relacion entre si igual que los 5 cajones de arriba, pero el sistema no la
// trataba como cajon: la auditoria de #201 la encontro activa (segmento
// e-commerce, contacto "Mercado Libre", 5 sucursales), no como resto historico.
// FUENTE UNICA desde #127: aqui y en ningun otro lado. Si se agrega un
// debtor-cajon en Operam, este renglon es el UNICO que hay que tocar.
export const DEBTORS_GENERICOS = new Set([14, 143, 183, 184, 256, 449]);

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

function normalizarEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

// Correos de la ficha del candidato (#210): mismo criterio que telefonosDeCliente
// -- top-level + contactos + sucursales -- porque el listado por tax_id trae esos
// tres niveles inline (verificado en vivo contra produccion, 2026-08-20).
function correosDeCliente(c) {
  const correos = [c.email, c.invoice_email];
  for (const ct of c.contacts || []) correos.push(ct.email);
  for (const b of c.branches || []) correos.push(b.email);
  return correos.map(normalizarEmail).filter(Boolean);
}

// Letrero de coincidencia (#210): TRES estados, nunca dos. "sin_dato" cuando la
// ficha del candidato no trae el dato O el propio input no lo capturo -- NUNCA
// "no_coincide", que seria una senal falsa de que son clientes distintos (41% de
// las fichas historicas de Operam no tienen telefono capturado). El humano ve la
// diferencia entre "sin dato" y "no coincide"; el picker no la esconde.
function estadoMatch(valoresFicha, valorInput) {
  if (!valorInput) return 'sin_dato';
  if (!valoresFicha.length) return 'sin_dato';
  return valoresFicha.includes(valorInput) ? 'coincide' : 'no_coincide';
}

// Palabras en que difieren dos nombres normalizados, en AMBAS DIRECCIONES y
// CRUDAS (#210): nada de gazetteer ni lista curada que adivine si una palabra es
// una ciudad o un tipo de entidad -- eso lo decide el humano que lee el letrero.
// soloInput = tokens que capturo el vendedor y el candidato no tiene; soloCandidato
// = tokens que tiene el candidato en Operam y el input no tiene.
export function diferenciaNombre(tokensInput, tokensCandidato) {
  const setInput = new Set(tokensInput);
  const setCandidato = new Set(tokensCandidato);
  return {
    soloInput: tokensInput.filter(t => !setCandidato.has(t)),
    soloCandidato: tokensCandidato.filter(t => !setInput.has(t)),
  };
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

  // Los dos RFC genericos son UN SOLO conjunto (#244). ADR-0001: el RFC generico
  // NO es llave de identidad, asi que partir el universo de clientes sin RFC real
  // segun cual de los dos comodines le toco es darle valor de llave a un no-dato:
  // el MISMO cliente queda archivado bajo XAXX o bajo XEXX segun el pais que
  // hubiera capturado quien lo dio de alta. Comparar por igualdad exacta dejaba
  // ciega la mitad del universo en cada consulta (caso real: CUMBIARCA SA vivia
  // en XEXX, la cotizacion pregunto por XAXX, veredicto "libre", y el duplicado
  // solo lo freno el cust_ref unico de Operam con un 406).
  // Sigue siendo SOLO entre genericos: un cliente con RFC real jamas entra aqui.
  const candidatosRfc = clientesOperam.filter(c => RFC_GENERICOS.has(rfcDe(c)));
  const candidatos = candidatosPorNombreOTelefono(candidatosRfc, tokensInput, telInput);
  if (candidatos.length === 0) return { tipo: 'libre' };
  return { tipo: 'candidatos', candidatos };
}

// El `cust_ref` (nombre corto) es UNICO GLOBAL en Operam (#242, medido en vivo
// 2026-08-21: crear un cliente con uno ya usado responde 406 "Already exists
// customer with same cust_ref"). Comparacion con trim y sin distinguir
// mayusculas: no se pudo medir si la unicidad de Operam es case-sensitive, y el
// supuesto conservador es el que pregunta de mas -- un falso candidato lo
// descarta el vendedor con "ninguno es el mismo cliente"; un falso "libre"
// termina en el 406 sin salida. Sin nombre corto capturado no hay nada que
// buscar: jamas coincide (ni siquiera con un cust_ref vacio).
export function coincideCustRef(custRef, nombreCorto) {
  const norm = v => String(v ?? '').trim().toLowerCase();
  const buscado = norm(nombreCorto);
  return buscado !== '' && norm(custRef) === buscado;
}

// Descubrimiento por cust_ref (#242): a la lista de candidatos que ya produjo
// detectarDuplicados se le suma el DUENO del nombre corto en TODO Operam, sin
// filtrar por RFC. Es el unico camino que puede descubrir que el cliente ya
// existe bajo un RFC real: la dedup de genericos (ADR-0001) nunca propone a un
// cliente identificado, asi que un choque de cust_ref con uno de ellos daba
// veredicto 'libre' -> POST -> 406 sin salida.
//
// El veredicto puede SUBIR de 'libre' a 'candidatos' (el hallazgo es un
// candidato de pleno derecho, elegible con las mismas acciones), nunca al reves.
// Los candidatos que ya estaban tambien se marcan si su cust_ref choca: el
// vendedor tiene que ver el choque aunque el candidato hubiera entrado por
// nombre o telefono. Sin hallazgos el veredicto se devuelve INTACTO -- un padron
// vacio (cache fria o Operam caido) no puede cambiar ninguna decision.
export function agregarCandidatosPorCustRef(dedup, clientes, nombreCorto) {
  const previos = dedup?.tipo === 'candidatos' ? (dedup.candidatos || []) : [];
  const marcados = previos.map(c => (coincideCustRef(c?.cust_ref, nombreCorto) ? { ...c, _custRefIgual: true } : c));
  const vistos = new Set(marcados.filter(c => c?.customer_id != null).map(c => String(c.customer_id)));
  const nuevos = [];
  for (const c of clientes || []) {
    if (!coincideCustRef(c?.cust_ref, nombreCorto)) continue;
    if (c?.customer_id == null || vistos.has(String(c.customer_id))) continue;
    vistos.add(String(c.customer_id));
    nuevos.push({ ...c, _custRefIgual: true });
  }
  if (!nuevos.length && !marcados.some(c => c._custRefIgual)) return dedup;
  return { tipo: 'candidatos', candidatos: [...marcados, ...nuevos] };
}

// Hechos del picker de candidatos (#210): evidencia para el 409, calculada
// APARTE de la seleccion de arriba -- nunca la toca. _similitud/_telefonoMatch
// siguen siendo lo UNICO que decide si un candidato entra a la lista; esta
// funcion solo describe al candidato que YA entro. La base de la diferencia de
// nombre es la que gano la seleccion (CustName o cust_ref, el que mas solapo con
// el input, mismo criterio que _similitud arriba) -- si el candidato entro por
// cust_ref, comparar contra CustName mostraria una diferencia que no fue la que
// lo marco.
export function hechosCandidato(candidato, tokensInput, telefonoInput, correoInput) {
  const c = candidato || {};
  const tokensNombre = normalizarNombre(c.CustName || '');
  const tokensRef = normalizarNombre(c.cust_ref || '');
  const base = solapamiento(tokensInput, tokensRef) > solapamiento(tokensInput, tokensNombre) ? tokensRef : tokensNombre;
  const telInput = ultimos10Digitos(telefonoInput);
  const correoNorm = normalizarEmail(correoInput);
  return {
    diferenciaNombre: diferenciaNombre(tokensInput, base),
    celularMatch: estadoMatch(telefonosDeCliente(c), telInput),
    correoMatch: estadoMatch(correosDeCliente(c), correoNorm),
  };
}
