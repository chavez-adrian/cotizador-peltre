// Nucleo puro del mapeo pais <-> Operam (issue #245). Un cliente elegido del
// buscador de Operam llegaba SIEMPRE marcado MX (pcLimpiarCamposCliente fija
// cl-pais = 'MX' antes de cada seleccion y seleccionarClienteOperam nunca lo
// tocaba): la sucursal de un cliente extranjero salia gravada al 16% en vez de
// exportacion (#189, AREA_POR_PAIS/derivarSalesAccount).
//
// D1 se ajusto en vivo (medicion 2026-08-21 sobre el padron completo, 473
// clientes via GET /api/v3/sales/customers paginado): el listado NO trae
// `area` ni `tax_group_id` (473/473 undefined) -- decidir por area seria
// codigo muerto. La unica senal que SI trae el listado es el texto libre
// `country`: 238/473 vacio, el resto en variantes sin normalizar de Mexico,
// Estados Unidos, Canada y otros paises.

export const AREA_POR_PAIS = { MX: 1, US: 5, CA: 7 };

// Inversa textual de AREA_POR_PAIS para el lado de escritura (D3): el valor que
// buildClienteBody manda a Operam cuando el cotizador es quien crea al
// cliente y no llego un country explicito (p.ej. de una CSF).
export const PAIS_A_COUNTRY = { MX: 'Mexico', US: 'Estados Unidos', CA: 'Canada' };

// RFC generico de EXTRANJERO (ver RFC_GENERICOS en lib/deduplicacion.js: el Set
// tiene XAXX010101000 = nacional y XEXX010101000 = extranjero). Medido en vivo:
// de 34 clientes con este RFC, 13 tienen country vacio y 3 dicen "Mexico" --
// estos 3 los creo el propio cotizador con el country hardcodeado que D3 vino a
// arreglar. Devolver MX en ese caso seria confiar en un dato que el cotizador
// mismo escribio mal; null ("no se") es mas honesto que adivinar.
const RFC_GENERICO_EXTRANJERO = 'XEXX010101000';

const SINONIMOS_MX = new Set(['mexico', 'mx']);
const SINONIMOS_US = new Set([
  'estados unidos', 'usa', 'united states', 'us', 'eeuu', 'e.u.a.',
  'estados unidos de america', 'united states of america',
]);
const SINONIMOS_CA = new Set(['canada', 'ca']);

// Quita acentos (NFD + rango de diacriticos combinados U+0300-U+036F) para que
// "Mexico", "MEXICO" y el texto acentuado equivalente comparen igual. El rango
// se arma con codigos numericos (String.fromCharCode) para no meter texto no
// ASCII en el codigo fuente.
const MARCAS_COMBINADAS = new RegExp(
  '[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g'
);

function normalizarTexto(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(MARCAS_COMBINADAS, '');
}

function paisDeTexto(country) {
  const t = normalizarTexto(country);
  if (!t) return null;
  if (SINONIMOS_MX.has(t)) return 'MX';
  if (SINONIMOS_US.has(t)) return 'US';
  if (SINONIMOS_CA.has(t)) return 'CA';
  return null;
}

// Pais ISO (MX/US/CA) de un cliente crudo de Operam, o null si no se puede
// determinar. Unica fuente: el texto c.country, con el ajuste de #245-D1-bis
// para el RFC generico de extranjero (ver comentario de RFC_GENERICO_EXTRANJERO).
export function paisDeClienteOperam(c) {
  const rfc = String(c?.tax_id || '').toUpperCase().trim();
  const pais = paisDeTexto(c?.country);
  if (rfc === RFC_GENERICO_EXTRANJERO && (pais === 'MX' || pais === null)) return null;
  return pais;
}
