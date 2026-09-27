// Destino que POST /api/cotizacion/envio manda a envia.com (#453). Nucleo puro
// sin IO: arma `destination` con el domicilio de entrega capturado en el paso
// Envio y decide que carriers se consultan segun el pais.
//
// Antes viajaba un destino fijo { city: 'Destino', state: 'DF' } sin calle: FedEx
// lo toleraba, pero DHL respondia "The first address line (street and number) is
// required" y Estafeta "Address street is required" (HITL de #447, CP 11700).
// Sin calle capturada NO se inventa una: el destino sale sin `street` y cada
// carrier responde lo que responde (decision de alcance del orquestador, #453).
//
// Codigo de estado: el catalogo de envia.com (GET queries.envia.com/state?
// country_code=XX, consultado 2026-09-27) trae `code_2_digits` y `code_3_digits`
// para MX y solo 2 letras para US y CA. En MX se usa el de 3 letras, el mismo
// que el origen (`MEX`), que ya pasa la validacion de los tres carriers; `DF` era
// el code_shopify de CDMX, no un codigo de envia.com. El estado capturado manda
// si se reconoce; si no, el del indice de CP del servidor (resolverCP), nunca el
// texto crudo.

export const CARRIERS_SOLO_MX = Object.freeze(['estafeta']);

// Estafeta no hace envios internacionales: con pais distinto de MX no se consulta
// y sale un aviso claro en vez del error crudo de envia.com. `carriers` es la
// salida de carriersEnvia ({ codigo, nombre }).
export function carriersParaPais(carriers, pais) {
  const p = texto(pais).toUpperCase() || 'MX';
  if (p === 'MX') return { carriers: [...(carriers || [])], avisos: [] };
  const soloMx = c => CARRIERS_SOLO_MX.includes(texto(c.codigo).toLowerCase());
  return {
    carriers: (carriers || []).filter(c => !soloMx(c)),
    avisos: (carriers || []).filter(soloMx).map(c => `${c.nombre} no hace env\u00edos internacionales`),
  };
}

const ESTADOS = {
  MX: {
    'aguascalientes': 'AGS', 'baja california': 'BCN', 'baja california sur': 'BCS',
    'campeche': 'CAM', 'chiapas': 'CHP', 'chihuahua': 'CHH',
    'ciudad de mexico': 'CMX', 'cdmx': 'CMX', 'distrito federal': 'CMX', 'df': 'CMX',
    'coahuila': 'COA', 'coahuila de zaragoza': 'COA', 'colima': 'COL', 'durango': 'DGO',
    'guanajuato': 'GTO', 'guerrero': 'GRO', 'hidalgo': 'HGO', 'jalisco': 'JAL',
    'estado de mexico': 'MEX', 'edo de mexico': 'MEX', 'edo mex': 'MEX', 'edomex': 'MEX',
    'michoacan': 'MIC', 'michoacan de ocampo': 'MIC', 'morelos': 'MOR', 'nayarit': 'NAY',
    'nuevo leon': 'NLE', 'oaxaca': 'OAX', 'puebla': 'PUE', 'queretaro': 'QRO',
    'quintana roo': 'ROO', 'san luis potosi': 'SLP', 'sinaloa': 'SIN', 'sonora': 'SON',
    'tabasco': 'TAB', 'tamaulipas': 'TAM', 'tlaxcala': 'TLA', 'veracruz': 'VER',
    'veracruz de ignacio de la llave': 'VER', 'yucatan': 'YUC', 'zacatecas': 'ZAC',
  },
  CA: {
    'alberta': 'AB', 'british columbia': 'BC', 'manitoba': 'MB', 'new brunswick': 'NB',
    'newfoundland and labrador': 'NL', 'northwest territories': 'NT', 'northwest territory': 'NT',
    'nova scotia': 'NS', 'nunavut': 'NU', 'nunavut territory': 'NU', 'ontario': 'ON',
    'prince edward island': 'PE', 'quebec': 'QC', 'saskatchewan': 'SK', 'yukon': 'YK',
  },
};

function texto(v) {
  return v == null ? '' : String(v).trim();
}

function clave(v) {
  return texto(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
}

// Nombre de estado (capturado o del indice) -> codigo de envia.com, o null.
export function codigoEstado(pais, estado) {
  const tabla = ESTADOS[pais] || {};
  const k = clave(estado);
  if (tabla[k]) return tabla[k];
  const codigos = Object.values(tabla);
  const directo = k.toUpperCase();
  if (codigos.includes(directo)) return directo;
  if (pais !== 'MX' && /^[A-Z]{2}$/.test(directo)) return directo;
  return null;
}

// `cl-calle` es UN campo "calle y numero" y envia.com los pide separados. Corte
// conservador: el ultimo token con digito es el numero; sin el, todo es calle.
// La linea que arma el carrier (calle + numero) queda igual con cualquier corte.
export function separarCalle(calle) {
  const t = texto(calle).replace(/\s+/g, ' ');
  const m = t.match(/^(.*\S)\s+(\S*\d\S*)$/);
  if (!m) return { street: t, number: '' };
  const street = m[1].replace(/[\s,#]+$/, '');
  if (!street) return { street: t, number: '' };
  return { street, number: m[2].replace(/^#/, '') };
}

// `capturado` = lo que manda el paso Envio; `resuelto` = { ciudad, estado } del
// indice de CP para ese mismo CP (ya validado por resolverCP), o null.
export function destinoEnvia(capturado, resuelto) {
  const pais = texto(capturado?.pais).toUpperCase() || 'MX';
  const destino = { name: 'Destinatario', country: pais, postalCode: texto(capturado?.cp) };
  const calle = separarCalle(capturado?.calle);
  if (calle.street) {
    destino.street = calle.street;
    destino.number = calle.number;
  }
  const colonia = texto(capturado?.colonia);
  if (colonia) destino.district = colonia;
  const ciudad = texto(capturado?.municipio) || texto(resuelto?.ciudad);
  if (ciudad) destino.city = ciudad;
  const estado = codigoEstado(pais, capturado?.estado) || codigoEstado(pais, resuelto?.estado);
  if (estado) destino.state = estado;
  return destino;
}

// Sin calle no se inventa una, pero si alguna paqueteria no cotizo se sugiere
// capturarla (sin bloquear: FedEx cotiza sin ella). null = no hay que decir nada.
export function sugerenciaSinCalle(destino, huboAvisosDeCarrier) {
  if (destino?.street || !huboAvisosDeCarrier) return null;
  return 'Sin calle y n\u00famero en el domicilio de entrega algunas paqueter\u00edas no cotizan: capt\u00faralos en el paso Env\u00edo y vuelve a cotizar';
}
