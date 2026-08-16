// Cola Hoy fusionada (issue #64, PRD #52, CONTEXT.md "Cola Hoy"): funcion pura
// que toma prospectos en Por Cotizar y cotizaciones en Seguimiento y produce UNA
// sola cola del dia. NO reimplementa la cadencia de ninguno de los dos: delega
// en los motores existentes (calcularColaProspectos en horas habiles,
// calcularCola en dias naturales) y solo mezcla, etiqueta por tipo y ordena.

import { calcularColaProspectos, semaforo, UMBRALES_POR_CANAL, UMBRAL_RESTO } from './seguimiento-prospectos.js';
import { calcularCola } from './seguimiento.js';
import { horasHabilesEntre } from './horas-habiles.js';

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

// Tarjetas No Asignado (#156, spec #155, CONTEXT.md "Cola Hoy"): un lead sin
// dueno es un pendiente del dia, no un detalle del tablero. NO pasa por el motor
// de prospectos porque la cadencia mide la espera DEL VENDEDOR (toques, sugerencia
// de No util a los 3): aqui todavia no hay vendedor que la haya tocado, lo unico
// pendiente es asignarle uno. Entra con su espera en horas habiles desde la
// captura y encabeza la cola completa: cualquier otra tarjeta ya tiene a alguien
// trabajandola. QUIEN ve estas tarjetas (admin o vendedor con permiso de
// asignacion) lo decide la ruta, no este nucleo.
function colaNoAsignado(prospectos, ahora) {
  return (prospectos || [])
    .filter(p => p.etapa === 'no_asignado')
    .map(p => {
      const horas = horasHabilesEntre(p.fecha, ahora);
      return {
        id: p.id, nombre: p.nombre, celular: p.celular, ciudad: p.ciudad,
        canal: p.canal, etapa: p.etapa, vendedor: null, fecha: p.fecha,
        horas, color: semaforo(horas, p.canal),
        tipo: 'no_asignado', sinDueno: true, urgencia: horas / umbralRojoProspecto(p),
      };
    });
}

export function calcularColaHoy(prospectos, cotizaciones, ahora = new Date()) {
  const colaProspectos = calcularColaProspectos(prospectos, ahora)
    .map(p => ({ ...p, tipo: 'prospecto', urgencia: urgenciaProspecto(p) }));
  const colaCotizaciones = calcularCola(cotizaciones, ahora)
    .map(c => ({ ...c, tipo: 'cotizacion', urgencia: urgenciaCotizacion(c) }));
  const fusionada = [...colaNoAsignado(prospectos, ahora), ...colaProspectos, ...colaCotizaciones];
  fusionada.sort((a, b) =>
    // Sin dueno primero: nadie la esta trabajando todavia.
    ((b.sinDueno ? 1 : 0) - (a.sinDueno ? 1 : 0)) ||
    // Reunion de prospecto vencida primero (solo los prospectos la traen).
    ((b.reunionVencida ? 1 : 0) - (a.reunionVencida ? 1 : 0)) ||
    (b.urgencia - a.urgencia)
  );
  return fusionada;
}
