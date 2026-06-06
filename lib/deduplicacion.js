const ARTICULOS = new Set(['el', 'la', 'los', 'las', 'un', 'una']);
const PREPOSICIONES = new Set(['de', 'del', 'en', 'y', 'e']);
const SUFIJOS = new Set(['sa', 'srl', 'sapi', 'sc', 'ac', 'llc', 'inc', 'corp', 'ltd', 'cv']);

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
