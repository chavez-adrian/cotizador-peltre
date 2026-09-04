// Modulo de dominio puro del pipeline unificado de 7 etapas (issue #53, PRD #52,
// ADR-0005). Vocabulario canonico del embudo comercial: una sola secuencia de
// etapas con dos salidas, reemplazando las etapas de prospecto
// (nuevo/contactado/calificado/cotizado) y las columnas de cadencia de
// cotizaciones del modelo previo. Sin efectos de borde: lo consumen los stores,
// el servidor, la migracion y la logica de tablero del frontend.
//
// El glosario manda (CONTEXT.md "Etapas del pipeline"): este modulo es la unica
// fuente del vocabulario. Las transiciones especiales (reglas de avance, gate de
// decorados) llegan en issues posteriores; aqui solo el vocabulario, el orden y
// los labels.

// Las 7 etapas en orden del embudo: del primer interes al producto entregado.
export const ETAPAS = [
  'no_asignado',
  'por_cotizar',
  'seguimiento',
  'anticipo_pagado',
  'pedido_liberado',
  'saldo_pagado',
  'producto_entregado',
];

// Salidas desde cualquier etapa activa: viven en filtro/historial, fuera del
// tablero activo (No util con motivo de catalogo, Perdida con confirmacion).
export const SALIDAS = ['no_util', 'perdida'];

export const ETAPA_LABELS = {
  no_asignado: 'No Asignado',
  por_cotizar: 'Por Cotizar',
  seguimiento: 'Seguimiento',
  anticipo_pagado: 'Anticipo pagado',
  pedido_liberado: 'Pedido liberado',
  saldo_pagado: 'Saldo pagado',
  producto_entregado: 'Producto entregado',
  no_util: 'No útil',
  perdida: 'Perdida',
};

const ETAPAS_SET = new Set(ETAPAS);
const SALIDAS_SET = new Set(SALIDAS);

export function esEtapa(valor) {
  return ETAPAS_SET.has(valor);
}

export function esSalida(valor) {
  return SALIDAS_SET.has(valor);
}

// Etapas desde las que una cotizacion creada para la tarjeta la lleva a
// Seguimiento. Mismo conjunto para los dos disparadores automaticos: el Cotizador
// (genera la cotizacion) y Operam (reporta una cotizacion creada). Ver CONTEXT.md
// "Etapas del pipeline".
const ORIGENES_COTIZACION = new Set(['por_cotizar', 'seguimiento', 'no_util']);

// Regla de dominio de la transicion automatica disparada por una cotizacion.
// Devuelve la etapa destino ('seguimiento') o null si la cotizacion no debe mover
// la tarjeta desde su etapa actual. No salta etapas: No Asignado primero necesita
// vendedor, las post-venta las mueve Operam y no retroceden, y Perdida no revive
// (revivir es solo desde No util). Ya en Seguimiento es idempotente.
export function transicionPorCotizacion(etapaActual) {
  return ORIGENES_COTIZACION.has(etapaActual) ? 'seguimiento' : null;
}

// Regla de dominio de la transicion automatica disparada por asignar un vendedor
// (issue #57, CONTEXT.md "Etapas del pipeline"). Simetrica de
// transicionPorCotizacion: una tarjeta en No Asignado pasa a Por Cotizar al
// asignarle dueno; en cualquier otra etapa asignar (o reasignar) vendedor no la
// mueve (ya tiene dueno, o es una salida). Devuelve la etapa destino o null.
export function transicionPorAsignacion(etapaActual) {
  return etapaActual === 'no_asignado' ? 'por_cotizar' : null;
}

// Estado PRE / folio de Operam nullable (issue #63, CONTEXT.md "Pre-cotizacion").
// Una pre-cotizacion es una cotizacion sin registro en Operam: la AUSENCIA del
// folio define el estado "PRE". El folio (quote_id/factura_no de Operam) es un
// identificador positivo; null, undefined y cadena vacia cuentan como ausencia.
// Excepcion: una cotizacion historica de registro desconocido (registroDesconocido,
// ver migrar-pipeline) se asume registrada (el folio no se capturaba antes de #63).
export function esPreCotizacion(cot) {
  if (cot?.registroDesconocido) return false;
  const folio = cot?.folioOperam;
  return folio == null || folio === '';
}

// Etiqueta visible de la cotizacion: "Cotizacion N" si esta registrada, "PRE"
// mientras sea pre-cotizacion, cadena vacia para una historica de registro
// desconocido (no se pinta badge). La distincion debe verse igual en la tarjeta,
// la cola Hoy y el tablero (todos reusan esta misma funcion). La convencion
// "#Operam N" (#63) se retiro en #309: nombraba el ERP en vez de la cosa.
export function etiquetaFolioOperam(cot) {
  const folio = cot?.folioOperam;
  if (folio != null && folio !== '') return `Cotización ${folio}`;
  return esPreCotizacion(cot) ? 'PRE' : '';
}

// POR QUE una cotizacion quedo en PRE (#204). Hasta ahora PRE era un solo estado
// ("Operam no respondio"); con la dedup por nombre ejerciendose de verdad
// aparecio un segundo motivo con consecuencias OPUESTAS:
//   'operam' -> Operam fallo o no contesto a tiempo. El documento es legitimo y
//               sale igual (ADR-0009); el vendedor reintenta cuando quiera.
//   'dedup'  -> hay un posible duplicado sin resolver. Aqui el documento NO debe
//               existir: entregarlo es justo lo que crea el cliente duplicado que
//               la dedup vino a evitar. El vendedor resuelve (elegir / crear
//               nuevo) o el registro se borra a las 24 horas.
// Vive en data.motivoPre (+ data.motivoPreDesde, marca de tiempo del estado);
// server.js tiene UN solo punto de escritura y lo limpia en cuanto hay folio.
//   'sin-lista' -> (#285) el cliente de Operam se quedo SIN lista de precios
//               (sales_type 0) y no puede valuar el documento. Se comporta como
//               'operam' para el candado (el documento sale igual, ADR-0009),
//               pero el arreglo esta en el CLIENTE, no en la cotizacion:
//               reintentar sin asignarle una lista en Operam da el mismo error
//               para siempre, y por eso el historial lo dice con todas sus
//               letras en vez del PRE generico.
export const MOTIVO_PRE_DEDUP = 'dedup';
export const MOTIVO_PRE_OPERAM = 'operam';
export const MOTIVO_PRE_SIN_LISTA = 'sin-lista';
export const HORAS_VIDA_DEDUP = 24;
export const LEYENDA_DEDUP_PENDIENTE = 'Esta cotizacion tiene un posible duplicado pendiente de resolver';

// Acepta la entrada completa (data.motivoPre, como la maneja el server) y la
// fila APLANADA del Historial (GET /api/cotizaciones expone los campos de data
// uno por uno, no el data entero). Es el mismo campo a dos alturas -- el mismo
// trato que ya recibe folioOperam.
export function motivoPre(cot) {
  return cot?.data?.motivoPre ?? cot?.motivoPre ?? null;
}

// El candado del documento. Se lee literal del motivo y NO se exige ademas que
// siga PRE: si el borrado del flag fallara tras conseguir folio, preferimos un
// documento bloqueado (ruidoso y recuperable) a uno que se escapa. La asimetria
// con cotizacionesDedupVencidas es deliberada -- ver alla.
export function documentoBloqueado(cot) {
  return motivoPre(cot) === MOTIVO_PRE_DEDUP;
}

// Que borrar en el barrido: ids de las cotizaciones detenidas por duplicado sin
// resolver desde hace mas de HORAS_VIDA_DEDUP. SOLO esas.
// Tres guardas, todas por el mismo motivo -- borrar es irreversible:
//   - motivo 'dedup' exacto: una PRE por fallo de Operam jamas se toca;
//   - sigue siendo PRE: si ya tiene folio hay un quote real en Operam detras,
//     asi que aunque el flag haya quedado sucio no se borra (aqui la asimetria
//     con documentoBloqueado: bloquear de mas se perdona, borrar de mas no);
//   - marca de tiempo valida: sin ella no se conoce la antiguedad y se deja.
export function cotizacionesDedupVencidas(cotizaciones, ahora = new Date()) {
  const limite = (ahora instanceof Date ? ahora : new Date(ahora)).getTime() - HORAS_VIDA_DEDUP * 3600 * 1000;
  return (cotizaciones || [])
    .filter(c => motivoPre(c) === MOTIVO_PRE_DEDUP)
    .filter(c => esPreCotizacion(c))
    .filter(c => {
      const desde = Date.parse(c?.data?.motivoPreDesde ?? '');
      return Number.isFinite(desde) && desde <= limite;
    })
    .map(c => c.id);
}
