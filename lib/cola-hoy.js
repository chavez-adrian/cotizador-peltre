// Cola Hoy fusionada (issue #64, PRD #52, CONTEXT.md "Cola Hoy"): funcion pura
// que toma prospectos en Por Cotizar y cotizaciones en Seguimiento y produce UNA
// sola cola del dia. NO reimplementa la cadencia de ninguno de los dos: delega
// en los motores existentes (calcularColaProspectos en horas habiles,
// calcularCola en dias naturales) y solo mezcla, etiqueta por tipo y ordena.

import { calcularColaProspectos, UMBRALES_POR_CANAL, UMBRAL_RESTO } from './seguimiento-prospectos.js';
import { calcularCola } from './seguimiento.js';

// Cada reloj con su medida (CONTEXT.md "Horas habiles"): el prospecto se mide en
// horas habiles contra el umbral rojo de su canal; la cotizacion en dias
// naturales contra su vencimiento (28 dias, paso 'vencida' en lib/seguimiento.js).
const DIAS_VENCIDA = 28;

// Urgencia relativa unificada: cada tipo se normaliza contra SU propio umbral de
// maxima urgencia, lo que vuelve comparables dos relojes distintos sin tocar la
// cadencia de ninguno. urgencia = 1 significa "alcanzo su limite" (prospecto en
// rojo / cotizacion vencida); urgencia > 1, lo rebaso. Asi un prospecto rojo
// (horas/umbralRojo >= 1) y una cotizacion vencida (dias/28 >= 1) compiten en la
// misma escala. La reunion vencida del prospecto es un caso aparte: en el motor
// de prospectos ya encabeza su cola, asi que aqui se mantiene por encima de
// cualquier urgencia (la cola del dia pide registrar su resultado primero,
// CONTEXT.md "Reunion de diagnostico").
function umbralRojoProspecto(item) {
  return (UMBRALES_POR_CANAL[item.canal] || UMBRAL_RESTO).rojo;
}

function urgenciaProspecto(item) {
  return item.horas / umbralRojoProspecto(item);
}

function urgenciaCotizacion(item) {
  return item.dias / DIAS_VENCIDA;
}

export function calcularColaHoy(prospectos, cotizaciones, ahora = new Date()) {
  const colaProspectos = calcularColaProspectos(prospectos, ahora)
    .map(p => ({ ...p, tipo: 'prospecto', urgencia: urgenciaProspecto(p) }));
  const colaCotizaciones = calcularCola(cotizaciones, ahora)
    .map(c => ({ ...c, tipo: 'cotizacion', urgencia: urgenciaCotizacion(c) }));
  const fusionada = [...colaProspectos, ...colaCotizaciones];
  fusionada.sort((a, b) =>
    // Reunion de prospecto vencida primero (solo los prospectos la traen).
    ((b.reunionVencida ? 1 : 0) - (a.reunionVencida ? 1 : 0)) ||
    (b.urgencia - a.urgencia)
  );
  return fusionada;
}
