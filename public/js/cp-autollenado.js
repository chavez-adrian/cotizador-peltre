// Autollenado de ciudad/municipio y estado por codigo postal en pantallas donde
// esos campos son CAPTURA REAL, no un respaldo (issue #291): el paso Envio del
// cotizador y el alta completa de cliente. La consulta al indice sigue siendo la
// de `cp-ciudad.js` (`ciudadPorCP`); lo que vive aqui es la REGLA DE NO PISAR,
// pura y sin DOM, compartida por esas dos pantallas.
//
// La regla en una linea: el indice escribe sobre un campo VACIO o sobre el valor
// que el mismo puso antes; lo tecleado a mano -- o prellenado desde Operam, del
// prospecto o del borrador -- no se toca nunca. Por eso hace falta recordar que
// dejo el indice la vez pasada: sin esa memoria no hay forma de distinguir
// "Puebla" que puso el CP de "Puebla" que escribio el vendedor.
//
// Por que NO lo consumen la captura de expo ni el formulario publico de mayoreo,
// aunque compartan `ciudadPorCP`: ahi el campo Ciudad es un RESPALDO que se
// oculta cuando el CP resuelve, y el chip promete que lo guardado es lo que dijo
// el indice. Aplicarles esta regla haria que una ciudad tecleada mientras el CP
// no resolvia sobreviviera escondida detras de un chip que dice otra cosa. Son
// dos semanticas distintas del mismo dato, no una copia.

// Los tres paises del indice (`data/cp-*.json`, GET /api/cp/:pais/:cp). El
// selector del alta ofrece ademas "OT" (Otro): preguntar por el solo gasta un
// 400 por tecla.
export const PAISES_CON_INDICE_CP = ['MX', 'US', 'CA'];

export function paisTieneIndiceCP(pais) {
  return PAISES_CON_INDICE_CP.includes(String(pais == null ? '' : pais).toUpperCase());
}

function texto(v) {
  return String(v == null ? '' : v).trim();
}

// El nucleo: que queda en el campo y que recuerda el indice, para UN campo.
// `valorResuelto` vacio es "el CP ya no resuelve" -- entonces se borra lo que
// puso el indice y nada mas.
export function decidirCampoAsistido(valorActual, valorDelIndice, valorResuelto) {
  const actual = texto(valorActual);
  const puesto = texto(valorDelIndice);
  const nuevo = texto(valorResuelto);
  // Escrito por alguien mas: se respeta y el indice suelta el campo, para que un
  // CP posterior tampoco lo reclame.
  if (actual !== '' && actual !== puesto) return { valor: actual, delIndice: '' };
  return { valor: nuevo, delIndice: nuevo };
}

// Los dos campos de una pantalla en una sola decision, mas el aviso visible.
// `resuelto` es lo que devolvio `ciudadPorCP` ({ ciudad, estado }) o null.
//
// El aviso enumera lo que el indice PUSO, no lo que resolvio: anunciar "Puebla"
// cuando el municipio en pantalla dice "San Pedro Cholula" -- porque el vendedor
// lo escribio y no se pisa -- seria un chip contradiciendo al campo de al lado.
// Con los dos campos escritos a mano no hay aviso: el indice no aporto nada.
export function planAutollenadoCP(actuales, delIndice, resuelto) {
  const a = actuales || {};
  const m = delIndice || {};
  const r = resuelto || {};
  const ciudad = decidirCampoAsistido(a.ciudad, m.ciudad, r.ciudad);
  const estado = decidirCampoAsistido(a.estado, m.estado, r.estado);
  const puesto = [ciudad.delIndice, estado.delIndice].filter(Boolean);
  return {
    valores: { ciudad: ciudad.valor, estado: estado.valor },
    delIndice: { ciudad: ciudad.delIndice, estado: estado.delIndice },
    aviso: puesto.length ? `✓ ${puesto.join(', ')}` : '',
  };
}
