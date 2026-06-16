// Cola Hoy fusionada (issue #64, PRD #52, CONTEXT.md "Cola Hoy"): funcion pura
// que toma prospectos en Por Cotizar y cotizaciones en Seguimiento y produce UNA
// sola cola del dia. NO reimplementa la cadencia de ninguno de los dos: delega
// en los motores existentes (calcularColaProspectos en horas habiles,
// calcularCola en dias naturales) y solo mezcla, etiqueta por tipo y ordena.

import { calcularColaProspectos, UMBRALES_POR_CANAL, UMBRAL_RESTO } from './seguimiento-prospectos.js';
import { calcularCola } from './seguimiento.js';

// Cada reloj con su medida (CONTEXT.md "Horas hables"): el prospecto se mide en
// horas habiles contra el umbral rojo de su canal; la cotizacion en dias
// naturales contra su vencimiento (28 dias, paso 'vencida' en lib/seguimiento.js).
const DIAS_VENCIDA = 28;

export function calcularColaHoy(prospectos, cotizaciones, ahora = new Date()) {
  const colaProspectos = calcularColaProspectos(prospectos, ahora)
    .map(p => ({ ...p, tipo: 'prospecto' }));
  const colaCotizaciones = calcularCola(cotizaciones, ahora)
    .map(c => ({ ...c, tipo: 'cotizacion' }));
  return [...colaProspectos, ...colaCotizaciones];
}
