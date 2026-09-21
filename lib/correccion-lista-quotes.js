// La lista de precios registrada en los quotes HISTORICOS (#406, derivado de #403).
//
// Hasta #403 el cotizador nunca mando la lista del encabezado del quote: la API v3 la
// ignora por cualquier nombre y Operam le ponia al `order_type` la lista del CLIENTE.
// Cuando el cliente ya existia con una lista distinta a la cotizada, el quote quedo
// REGISTRADO con la lista equivocada -- los precios por partida siempre fueron
// correctos, porque cada linea viaja con su precio explicito -- y el pedido que se
// derive hereda ese encabezado. Importa porque cuando un cliente recompra meses
// despues se consulta con que lista se le cotizo la primera vez.
//
// Este es el NUCLEO PURO de la correccion: decide que quotes tienen desfase y cuales
// se excluyen, cada uno CON SU MOTIVO. No lee Operam ni escribe nada: el IO vive en
// scripts/corregir-lista-quotes.mjs (inventario) y en lib/operam-web.js
// (corregirListaQuote, el ProcessOrder que #403 dejo montado).
//
// La lista esperada sale de `listaIdDeTier` -- el mismo `listaId` del catalogo por el
// que ya cruzan el permiso (#296) y la subida (#403) --, nunca de una tabla en codigo.

import { listaIdDeTier } from '../public/js/tier-logica.js';

export const GRUPOS = {
  CORREGIBLE: 'corregible',
  CON_PEDIDO: 'con-pedido',
  CANCELADO: 'cancelado',
  TIER_DESCONOCIDO: 'tier-desconocido',
  VIGENCIA_INVALIDA: 'vigencia-invalida',
  SIN_DESFASE: 'sin-desfase',
  SIN_FOLIO: 'sin-folio',
  FUERA_DE_ALCANCE: 'fuera-de-alcance',
};

// El orden en que se imprimen y se cuentan: primero lo accionable.
export const GRUPOS_ORDEN = [
  GRUPOS.CORREGIBLE, GRUPOS.CON_PEDIDO, GRUPOS.CANCELADO,
  GRUPOS.TIER_DESCONOCIDO, GRUPOS.VIGENCIA_INVALIDA, GRUPOS.FUERA_DE_ALCANCE,
  GRUPOS.SIN_DESFASE, GRUPOS.SIN_FOLIO,
];

// Grupos que el reporte cuenta pero no enumera salvo que se pidan: son los dos
// esperables -- la mayoria de las cotizaciones nunca llego a Operam o ya esta bien --
// y listarlos ahogaria lo que si hay que mirar.
const GRUPOS_SOLO_CONTEO = [GRUPOS.SIN_DESFASE, GRUPOS.SIN_FOLIO];

const TITULOS = {
  [GRUPOS.CORREGIBLE]: 'CORREGIBLE (lo unico que toca --apply)',
  [GRUPOS.CON_PEDIDO]: 'CON PEDIDO (no se toca: decision de Adrian)',
  [GRUPOS.CANCELADO]: 'CANCELADO (excluido)',
  [GRUPOS.TIER_DESCONOCIDO]: 'TIER DESCONOCIDO (no se adivina)',
  [GRUPOS.VIGENCIA_INVALIDA]: 'VIGENCIA INVALIDA (FA no deja repostear el documento)',
  [GRUPOS.SIN_FOLIO]: 'SIN FOLIO (nunca se registro en Operam)',
  [GRUPOS.FUERA_DE_ALCANCE]: 'FUERA DE ALCANCE',
  [GRUPOS.SIN_DESFASE]: 'SIN DESFASE (ya registrado con la lista cotizada)',
};

// Texto o null: el vacio NUNCA es dato (mismo criterio que el resto del repo).
function texto(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

export function folioDeCotizacion(cot) {
  return texto(cot?.folioOperam);
}

// El pedido derivado del quote, de las DOS fuentes que lo pueden saber, en orden:
//   1. el barrido de pedidos de Operam (`trans_no_from` = el folio del quote), que es
//      la verdad del ERP y alcanza tambien a los pedidos que el cotizador nunca vio;
//   2. lo que el registro ya trae -- `data.orderOperam` explicito (#56/#67) o el
//      espejo de la cadena que persistio el sync (#62) --, que ademas es lo unico que
//      sabe si ese pedido ya se facturo, se remisiono o se pago.
// Devuelve null cuando ninguna de las dos lo conoce: un pedido no se inventa.
export function pedidoDeQuote(cot, pedidosPorQuote = new Map()) {
  const folio = folioDeCotizacion(cot);
  const espejo = cot?.data?.espejoOperam || {};
  const delBarrido = folio === null ? null : texto(pedidosPorQuote?.get?.(folio));
  const delRegistro = texto(cot?.data?.orderOperam) ?? texto(espejo.pedido);
  const orden = delBarrido ?? delRegistro;
  if (orden === null) return null;
  return {
    orden,
    fuente: delBarrido !== null ? 'operam' : 'registro',
    factura: texto(espejo.factura?.ref) ?? texto(espejo.factura?.numero),
    remisiones: Array.isArray(espejo.remisiones) ? espejo.remisiones : [],
    pago: texto(espejo.pago),
  };
}

// Como le dice el cotizador a una lista de Operam: el `id` del tier del catalogo que
// la precia. Sirve para que el reporte no obligue a traducir ids del ERP a mano
// ("registrada 15" no le dice nada a nadie). Sale del catalogo, nunca de una tabla en
// codigo, y es null cuando el cotizador no precia esa lista -- entonces el reporte deja
// el id crudo, que es lo unico que se sabe.
export function nombreDeLista(tiers, listaId) {
  const id = texto(listaId);
  if (id === null) return null;
  const tier = (tiers || []).find(t => texto(t?.listaId) === id);
  return tier ? tier.id : null;
}

function aConjunto(valores) {
  if (valores instanceof Set) return new Set([...valores].map(v => String(v)));
  return new Set((Array.isArray(valores) ? valores : []).map(v => String(v)));
}

// Los folios que aparecen en MAS DE UNA cotizacion del cotizador. Dos registros con el
// mismo folio no pueden decidir con que lista se cotizo ese quote -- el script
// escribiria una lista y luego la otra sobre el MISMO documento --, asi que los dos
// quedan fuera de alcance en vez de competir.
function foliosRepetidosDe(cotizaciones) {
  const vistos = new Map();
  for (const c of cotizaciones || []) {
    const folio = folioDeCotizacion(c);
    if (folio === null) continue;
    vistos.set(folio, (vistos.get(folio) || 0) + 1);
  }
  return new Set([...vistos].filter(([, n]) => n > 1).map(([f]) => f));
}

function filaBase(cot, folio) {
  return {
    id: cot?.id ?? null,
    folio,
    cliente: texto(cot?.cliente) ?? '(sin nombre)',
    fecha: texto(cot?.fecha),
    tier: texto(cot?.tier),
    esperado: null,
    actual: null,
    pedido: null,
    grupo: null,
    motivo: null,
  };
}

// Lo que se puede decidir SIN leer Operam. `grupo: null` significa "hay que leer el
// quote para decidir", y es lo que `foliosPorLeer` usa para no gastar lecturas (ni
// throttle) en los que ya estan resueltos.
export function preclasificar(cot, { tiers = [], quotesCancelados = [], foliosRepetidos = new Set() } = {}) {
  const folio = folioDeCotizacion(cot);
  const fila = filaBase(cot, folio);
  const cancelados = quotesCancelados instanceof Set ? quotesCancelados : aConjunto(quotesCancelados);

  if (folio === null) {
    return { ...fila, grupo: GRUPOS.SIN_FOLIO, motivo: 'la cotizacion no tiene folio de Operam: nunca se registro como quote' };
  }
  if (foliosRepetidos.has(folio)) {
    return { ...fila, grupo: GRUPOS.FUERA_DE_ALCANCE, motivo: `el folio ${folio} aparece en mas de una cotizacion del cotizador: no se puede decidir con que lista se cotizo` };
  }
  if (cancelados.has(folio)) {
    return { ...fila, grupo: GRUPOS.CANCELADO, motivo: `el quote ${folio} esta cancelado en Operam` };
  }
  const esperado = listaIdDeTier(tiers, cot?.tier);
  if (esperado === null) {
    return { ...fila, grupo: GRUPOS.TIER_DESCONOCIDO, motivo: `el tier "${fila.tier ?? '(vacio)'}" no existe en el catalogo vigente o no trae lista de precios: no se adivina` };
  }
  return { ...fila, esperado };
}

// El quote que FA NO deja repostear, medido en vivo sobre el 1194 (2026-09-21): con
// `delivery_date` anterior a `ord_date`, el ProcessOrder se rechaza entero con "La
// fecha de validez solicitada es anterior a la fecha de la cotizacion" y no guarda
// nada. Es la firma del bug que arreglo #106 -- la vigencia quedaba en `ord_date - 1`
// (el 1194: cotizado el 2026-07-27, valido hasta el 2026-07-26) --, asi que solo la
// arrastran los quotes anteriores a ese arreglo o aquellos cuyo post-fix nunca corrio.
//
// Lo que FA compara es contra la fecha del DOCUMENTO, no contra hoy: una vigencia ya
// expirada pero posterior a su ord_date se repostea sin problema. Sin las dos fechas
// no se afirma nada y el quote sigue siendo corregible: la relectura obligatoria es la
// que atrapa el rechazo, y detiene el lote.
function vigenciaInvalida(quote) {
  const desde = texto(quote?.ord_date);
  const hasta = texto(quote?.delivery_date);
  if (desde === null || hasta === null) return null;
  return hasta < desde ? { desde, hasta } : null;
}

// El veredicto con el quote ya leido. `quote === undefined` es "no se leyo" (distinto
// de "Operam no lo tiene"): callarlo como "sin desfase" seria afirmar algo que nadie
// midio.
export function clasificar(pre, { quote, pedido = null } = {}) {
  if (pre.grupo) return pre;
  if (quote === undefined) {
    return { ...pre, grupo: GRUPOS.FUERA_DE_ALCANCE, motivo: `el quote ${pre.folio} no se leyo de Operam` };
  }
  if (!quote) {
    return { ...pre, grupo: GRUPOS.FUERA_DE_ALCANCE, motivo: `Operam no tiene ningun quote con el folio ${pre.folio}` };
  }
  const actual = texto(quote.order_type);
  if (actual === null) {
    return { ...pre, grupo: GRUPOS.FUERA_DE_ALCANCE, motivo: `el quote ${pre.folio} no trae order_type: no hay contra que comparar` };
  }
  if (actual === pre.esperado) return { ...pre, actual, pedido, grupo: GRUPOS.SIN_DESFASE };
  // La vigencia gana sobre el pedido: un documento que FA no deja repostear no es una
  // decision pendiente sino un imposible sin mover otra cosa, y presentarlo como
  // "decision de Adrian" prometeria una salida que no existe. El pedido igual viaja en
  // la fila, asi que el reporte lo sigue diciendo. Hoy ningun quote cae en los dos
  // (medido 2026-09-21 sobre los 5 con pedido).
  const vigencia = vigenciaInvalida(quote);
  if (vigencia) {
    return {
      ...pre, actual, pedido, grupo: GRUPOS.VIGENCIA_INVALIDA,
      motivo: `la vigencia (${vigencia.hasta}) es anterior a la fecha de la cotizacion (${vigencia.desde}): FA rechaza el ` +
        'ProcessOrder entero con "La fecha de validez solicitada es anterior a la fecha de la cotizacion" y no guarda nada. ' +
        'Corregir la lista exigiria mover la vigencia, que es otro cambio',
    };
  }
  if (pedido) {
    const cadena = [
      pedido.factura ? `factura ${pedido.factura}` : null,
      pedido.remisiones.length ? `${pedido.remisiones.length} remision(es)` : null,
      pedido.pago,
    ].filter(Boolean).join(', ');
    return {
      ...pre, actual, pedido, grupo: GRUPOS.CON_PEDIDO,
      motivo: `el quote ya se convirtio en el pedido ${pedido.orden}${cadena ? ` (${cadena})` : ''}: corregirlo se decide aparte`,
    };
  }
  return { ...pre, actual, pedido: null, grupo: GRUPOS.CORREGIBLE };
}

// Los folios que el script tiene que leer de Operam: los que no quedaron resueltos sin
// mirar el ERP. Unicos y en el orden de las cotizaciones.
export function foliosPorLeer({ cotizaciones = [], tiers = [], quotesCancelados = [] } = {}) {
  const foliosRepetidos = foliosRepetidosDe(cotizaciones);
  const cancelados = aConjunto(quotesCancelados);
  const folios = [];
  for (const c of cotizaciones) {
    const pre = preclasificar(c, { tiers, quotesCancelados: cancelados, foliosRepetidos });
    if (pre.grupo === null && !folios.includes(pre.folio)) folios.push(pre.folio);
  }
  return folios;
}

// El inventario completo: una fila por cotizacion, agrupadas y contadas.
// `quotes` es un Map folio -> cabecera del quote (null = Operam no lo tiene, ausente =
// no se leyo); `pedidosPorQuote` es folio -> order_no del barrido de pedidos.
export function planearCorreccionListas({
  cotizaciones = [], tiers = [], quotesCancelados = [], quotes = new Map(), pedidosPorQuote = new Map(),
} = {}) {
  const foliosRepetidos = foliosRepetidosDe(cotizaciones);
  const cancelados = aConjunto(quotesCancelados);
  const filas = (cotizaciones || []).map((c) => {
    const pre = preclasificar(c, { tiers, quotesCancelados: cancelados, foliosRepetidos });
    // El pedido se anota SIEMPRE, tambien en las filas que se resolvieron sin mirar el
    // quote: el reporte dice "si tiene pedido asociado" de todas (spec #406), y un tier
    // fuera del catalogo con pedido no se lee igual que uno sin el.
    const pedido = pedidoDeQuote(c, pedidosPorQuote);
    const fila = pre.grupo
      ? pre
      : clasificar(pre, { quote: quotes?.has?.(pre.folio) ? quotes.get(pre.folio) : undefined, pedido });
    // Y la lista registrada viaja con el nombre que el cotizador le da: el reporte lo
    // lee un humano, y el id del ERP por si solo no dice con que quedo el quote.
    return { ...fila, pedido, actualNombre: nombreDeLista(tiers, fila.actual) };
  });

  const grupos = Object.fromEntries(GRUPOS_ORDEN.map(g => [g, []]));
  for (const f of filas) grupos[f.grupo].push(f);
  const resumen = Object.fromEntries(GRUPOS_ORDEN.map(g => [g, grupos[g].length]));
  return { filas, grupos, resumen };
}

// --- El reporte del dry-run --------------------------------------------------
// Puro: el script solo imprime lo que sale de aqui.

// Lo que el dry-run NO puede medir por si solo, dicho donde se lee (spec #406, "Lo que
// no se sabe"): si FA deja repostear un quote ya convertido en pedido solo se sabe
// intentandolo, y eso ya seria una escritura. El script NUNCA los toca.
export const NOTA_CON_PEDIDO =
  'SIN MEDIR: si FA deja repostear estos quotes, y si el pedido heredaria el cambio o habria que ' +
  'corregirlo aparte (ModifyOrderNumber), solo se sabe intentandolo -- que ya seria una escritura. ' +
  'El script no los toca: son decision de Adrian.';

function lineaDeFila(f) {
  const partes = [
    `  #${f.id} folio ${f.folio ?? '(sin folio)'}`,
    `tier ${f.tier ?? '(vacio)'}`,
    f.esperado !== null ? `cotizada ${f.esperado}` : null,
    f.actual !== null ? `registrada ${f.actual}${f.actualNombre ? ` (${f.actualNombre})` : ''}` : null,
    f.pedido ? `pedido ${f.pedido.orden}` : null,
    `| ${f.cliente}`,
  ].filter(Boolean);
  return partes.join(' ') + (f.motivo ? `\n      ${f.motivo}` : '');
}

export function formatearReporte(plan, { detalleCompleto = false } = {}) {
  const lineas = [];
  lineas.push('=== Lista de precios del encabezado del quote vs la lista cotizada (#406) ===');
  lineas.push(GRUPOS_ORDEN.map(g => `${g}: ${plan.resumen[g]}`).join(' | '));
  for (const grupo of GRUPOS_ORDEN) {
    const filas = plan.grupos[grupo];
    if (!filas.length) continue;
    if (GRUPOS_SOLO_CONTEO.includes(grupo) && !detalleCompleto) continue;
    lineas.push('');
    lineas.push(`--- ${TITULOS[grupo]} -- ${filas.length} ---`);
    if (grupo === GRUPOS.CON_PEDIDO) lineas.push(`      ${NOTA_CON_PEDIDO}`);
    for (const f of filas) lineas.push(lineaDeFila(f));
  }
  return lineas.join('\n');
}
