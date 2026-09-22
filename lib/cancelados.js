// Nucleo PURO de la lista de documentos ANULADOS en Operam (#408, derivado de #406).
// La escritura de data/cancelados.json es ACUMULATIVA: el resultado de una corrida es
// la union de lo que el archivo ya traia con lo recien verificado. El IO (login web,
// scraping, leer y escribir el archivo) vive en scripts/detectar-cancelados.mjs.

// La `nota` viaja DENTRO del archivo porque es lo primero que lee quien lo abre: que
// esta lista no es un censo de cancelados de Operam, sino la foto de un universo
// acotado. Leerla como censo fue lo que costo #406.
export const NOTA_CANCELADOS = [
  'Pedidos (orders, trans_type 30) y cotizaciones (quotes, trans_type 32) ANULADOS en Operam.',
  'La API no expone la cancelacion; detectado por scraping de la web legacy (view_sales_order.php).',
  'Generado por scripts/detectar-cancelados.mjs.',
  'NO es un censo de los cancelados de Operam: el universo que se recorre son los candidatos del BACKFILL (#76),',
  'asi que un documento que deja de serlo ya no se vuelve a mirar.',
  'Por eso la escritura es ACUMULATIVA (#408): cada corrida UNE lo recien verificado con lo que el archivo ya traia',
  'y nunca quita folios -- una cancelacion en FrontAccounting no se revierte.',
].join(' ');

function unirFolios(previos, nuevos) {
  const listas = [previos, nuevos].map(l => (Array.isArray(l) ? l : []));
  return [...new Set(listas.flat().map(String))].sort((a, b) => Number(a) - Number(b));
}

// Sin archivo previo (primera corrida) o con uno ilegible (escritura a medias) no hay
// de que acumular, pero tampoco hay por que perder la corrida: se sigue como antes de
// #408, escribiendo solo lo recien verificado.
function foliosPrevios(previo) {
  try {
    const anterior = JSON.parse(previo);
    return anterior && typeof anterior === 'object' ? anterior : {};
  } catch {
    return {};
  }
}

export function unirCancelados({ previo = null, orders = [], quotes = [], generado } = {}) {
  const anterior = foliosPrevios(previo);
  return {
    generado,
    nota: NOTA_CANCELADOS,
    orders: unirFolios(anterior.orders, orders),
    quotes: unirFolios(anterior.quotes, quotes),
  };
}
