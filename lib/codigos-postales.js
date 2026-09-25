// Nucleo PURO de la resolucion CP -> ciudad/estado (issue #160, ADR-0012 pto. 3).
// Sin IO: normaliza/busca en el indice YA CARGADO en memoria (normalizarCp +
// buscarCP, los usa el GET publico de server.js) y parsea las filas crudas de
// GeoNames al indice compacto que se commitea (construirIndiceCP, lo usa
// scripts/sync-codigos-postales.mjs). Un modulo, dos consumidores, cero copias
// espejo -- mismo patron que catalogo-operam.js / sync-catalogo.mjs.
//
// Trampas del dataset MX verificadas contra MX.txt de GeoNames 2026-08-16 (issue
// #160): la "ciudad" es el MUNICIPIO (admin name2, columna 6), NUNCA la colonia
// (place name, columna 3 -- hay hasta 9 colonias por CP). El DF se renombro en
// 2016 y GeoNames sigue diciendo "Distrito Federal"; y el nombre CRUDO del
// Estado de Mexico es solo "Mexico" (admin name1 del estado 15), que sin
// normalizar es indistinguible de "Ciudad de Mexico" en la UI -- por eso se
// desambigua a "Estado de Mexico" explicitamente, no solo se deja pasar.
// Coahuila/Michoacan/Veracruz llevan sufijo historico que se recorta a la forma
// corta.

// Los strings llevan escapes \uXXXX (no el caracter literal) para que el
// ARCHIVO se mantenga ASCII estricto (regla de la casa); el valor en tiempo de
// ejecucion si lleva el acento correcto.
const NORMALIZA_ESTADO_MX = {
  'Distrito Federal': 'Ciudad de M\u00e9xico',
  'M\u00e9xico': 'Estado de M\u00e9xico',
  'Coahuila de Zaragoza': 'Coahuila',
  'Michoac\u00e1n de Ocampo': 'Michoac\u00e1n',
  'Veracruz de Ignacio de la Llave': 'Veracruz',
};

export function normalizarEstadoMx(estado) {
  const v = String(estado == null ? '' : estado).trim();
  return NORMALIZA_ESTADO_MX[v] || v;
}

// CP crudo (lo que teclea el prospecto) -> llave del indice, por pais. CA usa
// SOLO el FSA (primeros 3 caracteres): es la unica parte que GeoNames publica
// sin restriccion de copyright (readme.txt de GeoNames, verificado #160).
export function normalizarCp(pais, cpCrudo) {
  const v = String(cpCrudo == null ? '' : cpCrudo).trim();
  if (pais === 'CA') return v.replace(/\s+/g, '').toUpperCase().slice(0, 3);
  if (pais === 'US') return v.replace(/\D/g, '').slice(0, 5);
  return v.replace(/\D/g, '').padStart(5, '0').slice(-5);
}

export function buscarCP(indice, pais, cpCrudo) {
  const mapa = indice && indice[pais];
  if (!mapa) return null;
  const fila = mapa[normalizarCp(pais, cpCrudo)];
  return fila ? { ciudad: fila[0], estado: fila[1] } : null;
}

// --- Construccion del indice desde las filas crudas TSV de GeoNames. Solo la
// usa scripts/sync-codigos-postales.mjs -- el GET publico de server.js trabaja
// contra el indice YA construido y commiteado (buscarCP arriba). ---

// Columnas de GeoNames (readme.txt, verificado #160): country code, postal
// code, place name, admin name1 (estado), admin code1, admin name2
// (municipio/condado), admin code2, admin name3, admin code3, lat, lng,
// accuracy.
function filaMX(cols) {
  return { cp: cols[1], ciudad: cols[5], estado: normalizarEstadoMx(cols[3]) };
}
// US: "ciudad + abreviatura de estado" (investigacion #160 S3.3) = place name +
// admin code1, NUNCA el nombre completo del estado (admin name1).
function filaUS(cols) {
  return { cp: cols[1], ciudad: cols[2], estado: cols[4] };
}
// Territorios de EE.UU. (#451): GeoNames los publica como paises aparte (PR, VI,
// GU, AS, MP) y ahi admin code1 NO es la abreviatura postal (PR trae el codigo
// del municipio, VI "78", AS vacio). La abreviatura USPS del territorio es su
// codigo de pais ISO (columna 0), asi que el estado sale de ahi. Si un ZIP se
// repitiera, gana la fila de US.txt (se esparce al final en construirIndiceCP).
function filaTerritorioUS(cols) {
  return { cp: cols[1], ciudad: cols[2], estado: cols[0] };
}
// CA: la llave es SIEMPRE el FSA de 3 caracteres aunque el .zip de GeoNames ya
// venga asi -- normalizarCp('CA', ...) es la MISMA regla que usa la busqueda, no
// una copia (una fila con 4+ caracteres nunca deberia colisionar en silencio).
function filaCA(cols) {
  return { cp: normalizarCp('CA', cols[1]), ciudad: cols[2], estado: cols[3] };
}

function indexarLineas(texto, leerFila) {
  const mapa = {};
  for (const linea of String(texto || '').split('\n')) {
    if (!linea.trim()) continue;
    const fila = leerFila(linea.split('\t'));
    // Primera fila del CP gana (varias colonias comparten CP en MX; el
    // municipio/estado es el mismo en todas -- no hay nada que reconciliar).
    if (fila && fila.cp && !mapa[fila.cp]) mapa[fila.cp] = [fila.ciudad, fila.estado];
  }
  return mapa;
}

export function construirIndiceCP({ mx, us, ca, territoriosUS = [] }) {
  return {
    MX: indexarLineas(mx, filaMX),
    US: { ...indexarLineas(territoriosUS.join('\n'), filaTerritorioUS), ...indexarLineas(us, filaUS) },
    CA: indexarLineas(ca, filaCA),
  };
}

// Centroide por CP de MX para la tarifa Lalamove (#72), que exige coordenadas
// del destino: promedio de las lat/lng de las colonias que comparten el CP
// (columnas 10 y 11 de GeoNames). Es un indice APARTE de cp-mx.json porque ese
// lo consume el GET publico con otra forma.
export function construirCoordenadasMX(texto) {
  const suma = {};
  for (const linea of String(texto || '').split('\n')) {
    const cols = linea.split('\t');
    const cp = cols[1];
    const lat = parseFloat(cols[9]);
    const lng = parseFloat(cols[10]);
    if (!cp || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const s = suma[cp] || (suma[cp] = { lat: 0, lng: 0, n: 0 });
    s.lat += lat; s.lng += lng; s.n += 1;
  }
  const redondear = (v) => Math.round(v * 1e4) / 1e4;
  return Object.fromEntries(Object.entries(suma).map(([cp, s]) => [cp, [redondear(s.lat / s.n), redondear(s.lng / s.n)]]));
}

export function coordenadasDeCP(indiceCoords, cpCrudo) {
  const fila = indiceCoords && indiceCoords[normalizarCp('MX', cpCrudo)];
  return fila ? { lat: fila[0], lng: fila[1] } : null;
}
