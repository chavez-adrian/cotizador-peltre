const ARTICULOS = new Set(['el', 'la', 'los', 'las', 'un', 'una']);
const PREPOSICIONES = new Set(['de', 'del', 'en', 'y', 'e']);
const SUFIJOS = new Set(['sa', 'srl', 'sapi', 'sc', 'ac', 'llc', 'inc', 'corp', 'ltd', 'cv']);
const RFC_GENERICOS = new Set(['XAXX010101000', 'XEXX010101000']);

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

export function detectarDuplicados(rfcInput, nombreInput, clientesOperam) {
  const rfcNorm = (rfcInput || '').toUpperCase().trim();
  const esGenerico = RFC_GENERICOS.has(rfcNorm);

  if (!esGenerico) {
    const match = clientesOperam.find(c =>
      ((c.RFC || c.rfc) || '').toUpperCase().trim() === rfcNorm
    );
    if (match) return { tipo: 'exacto', cliente: match };
    return { tipo: 'libre' };
  }

  const candidatosRfc = clientesOperam.filter(c =>
    ((c.RFC || c.rfc) || '').toUpperCase().trim() === rfcNorm
  );

  const tokensInput = normalizarNombre(nombreInput);

  const conSimilitud = candidatosRfc
    .map(c => {
      const tokensNombre = normalizarNombre(c.CustName || '');
      const tokensRef = normalizarNombre(c.cust_ref || '');
      const sim = Math.max(solapamiento(tokensInput, tokensNombre), solapamiento(tokensInput, tokensRef));
      return { ...c, _similitud: sim };
    })
    .filter(c => c._similitud >= 1)
    .sort((a, b) => b._similitud - a._similitud);

  if (conSimilitud.length === 0) return { tipo: 'libre' };
  return { tipo: 'candidatos', candidatos: conSimilitud };
}
