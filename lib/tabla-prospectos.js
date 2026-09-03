// Nucleo puro de la Tabla de prospectos (spec #306, CONTEXT.md "Tabla de
// prospectos" y "Estado del prospecto"): prospecto -> la fila que la pantalla
// pinta. Sin IO: la ruta lee los stores y llama aqui, y los tickets que siguen
// extienden estas mismas firmas sin cambiarlas.
//
// El Toque es la unica verdad de "ya lo contacte" (CONTEXT.md "Toque"): de el
// salen el Estado, el Ultimo contacto y el conteo de la cadencia. No hay
// ninguna otra marca de contactado.

function toquesDe(p) {
  return ((p && p.eventos) || []).filter(e => e.tipo === 'toque');
}

// La escalera del glosario tiene cinco escalones con precedencia de arriba
// hacia abajo; #313 entrega los dos ultimos y los tickets siguientes agregan
// los de arriba. `cotizaciones` y `ahora` ya viajan porque esos escalones los
// necesitan.
export function estadoProspecto(p, cotizaciones = [], ahora = new Date()) {
  return toquesDe(p).length > 0 ? 'contactado' : 'sin_contactar';
}

// El ultimo contacto es el toque MAS RECIENTE por fecha, no el ultimo del
// arreglo: los eventos se agregan en el orden en que se registran y una
// importacion puede dejarlos desordenados.
function ultimoContactoDe(toques) {
  let ultimo = null;
  for (const t of toques) {
    if (!ultimo || new Date(t.fecha) > new Date(ultimo)) ultimo = t.fecha;
  }
  return ultimo;
}

export function filaTabla(p, cotizaciones = [], ahora = new Date()) {
  const toques = toquesDe(p);
  return {
    ...p,
    estado: estadoProspecto(p, cotizaciones, ahora),
    ultimoContacto: ultimoContactoDe(toques),
    toques: toques.length,
  };
}
