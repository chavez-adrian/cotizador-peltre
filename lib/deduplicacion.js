const ARTICULOS = new Set(['el', 'la', 'los', 'las', 'un', 'una']);
const PREPOSICIONES = new Set(['de', 'del', 'en', 'y', 'e']);
const SUFIJOS = new Set(['sa', 'srl', 'sapi', 'sc', 'ac', 'llc', 'inc', 'corp', 'ltd', 'cv']);
export const RFC_GENERICOS = new Set(['XAXX010101000', 'XEXX010101000']);

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

// Ultimos 10 digitos de un telefono, recortando extension ("ext.123", ",116").
// Duplica DELIBERADAMENTE el algoritmo de lib/prospectos-store.js (ultimos10):
// importar ese modulo aqui traeria lib/db.js (Postgres) a un modulo puro sin
// IO. Si el algoritmo cambia, debe cambiar en ambos lugares (mismo comentario
// en indice-telefonos.js que ya afronta el mismo trade-off).
function ultimos10Digitos(raw) {
  if (!raw) return null;
  const sinExt = String(raw).split(/ext/i)[0].split(',')[0];
  const digitos = sinExt.replace(/\D/g, '').slice(-10);
  return digitos.length === 10 ? digitos : null;
}

function telefonosDeCliente(c) {
  const tels = [c.phone];
  for (const ct of c.contacts || []) tels.push(ct.phone, ct.phone2);
  for (const b of c.branches || []) tels.push(b.phone);
  return tels.map(ultimos10Digitos).filter(Boolean);
}

function candidatosPorNombreOTelefono(pool, tokensInput, telInput) {
  return pool
    .map(c => {
      const tokensNombre = normalizarNombre(c.CustName || '');
      const tokensRef = normalizarNombre(c.cust_ref || '');
      const sim = Math.max(solapamiento(tokensInput, tokensNombre), solapamiento(tokensInput, tokensRef));
      const telefonoMatch = telInput != null && telefonosDeCliente(c).includes(telInput);
      return { ...c, _similitud: sim, _telefonoMatch: telefonoMatch };
    })
    .filter(c => c._similitud >= 1 || c._telefonoMatch)
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
