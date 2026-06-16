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
