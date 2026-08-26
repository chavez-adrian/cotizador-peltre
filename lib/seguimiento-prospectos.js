// Motor de la cola de seguimiento de prospectos (issue #44, CONTEXT.md
// "Cadencia de prospecto"): funcion pura (prospectos, ahora) -> cola, mismo
// patron que lib/seguimiento.js para cotizaciones. La espera corre en horas
// habiles (lib/horas-habiles.js) desde el ultimo toque, o desde la captura si
// no hay toques. El semaforo depende del canal: mensajeria espera respuesta en
// horas; el resto tolera mas. La sugerencia de No util tras 3 toques es solo
// eso -- una sugerencia que el vendedor confirma, nunca se aplica sola.

import { horasHabilesEntre } from './horas-habiles.js';
import { CANALES, reunionFutura, reunionPendienteResultado, siguienteContactoFuturo, siguienteContactoVencido } from '../public/js/prospectos-logica.js';

export const UMBRAL_MENSAJERIA = { ambar: 1, rojo: 2 };
export const UMBRAL_RESTO = { ambar: 4, rojo: 8 };

const CANALES_MENSAJERIA = new Set(['WhatsApp', 'Instagram', 'Facebook/Messenger', 'Meta Ads']);

export const UMBRALES_POR_CANAL = Object.fromEntries(
  CANALES.map(c => [c, CANALES_MENSAJERIA.has(c) ? UMBRAL_MENSAJERIA : UMBRAL_RESTO])
);

export const SUGERIR_NO_UTIL_TOQUES = 3;

// La cadencia de prospecto corre en Por Cotizar -- el unico lugar previo a la
// cotizacion en el pipeline unificado (issue #53, ADR-0005). Las etapas de
// prospeccion del modelo previo (nuevo/contactado/calificado) colapsaron aqui.
const ETAPAS_EN_COLA = new Set(['por_cotizar']);

function umbral(canal) {
  return UMBRALES_POR_CANAL[canal] || UMBRAL_RESTO;
}

export function semaforo(horas, canal) {
  const u = umbral(canal);
  if (horas >= u.rojo) return 'rojo';
  if (horas >= u.ambar) return 'ambar';
  return 'verde';
}

export function calcularColaProspectos(prospectos, ahora) {
  const cola = [];
  for (const p of prospectos || []) {
    if (!ETAPAS_EN_COLA.has(p.etapa)) continue;
    // Reunion diagnostico (issue #45): mientras la reunion esta en el futuro
    // la espera esta justificada y el prospecto sale de la cola; pasada la
    // fecha sin evento posterior, vuelve al frente pidiendo el resultado.
    if (reunionFutura(p, ahora)) continue;
    // Siguiente contacto futuro (issue #262): el compromiso acordado con el
    // prospecto suprime la cadencia igual que una reunion futura -- no se le
    // escribe antes de la fecha prometida.
    if (siguienteContactoFuturo(p, ahora)) continue;
    const fechaReunion = reunionPendienteResultado(p, ahora);
    // Compromiso vencido sin toque posterior: la cadencia corre desde la fecha
    // prometida, no desde la captura (que puede ser de hace dias, como en una
    // expo). Por construccion ningun toque es posterior al compromiso mientras
    // sigue vencido, asi que la fecha del compromiso es el punto mas reciente.
    const siguiente = siguienteContactoVencido(p, ahora);
    const toques = (p.eventos || []).filter(e => e.tipo === 'toque');
    let desde = p.fecha;
    for (const t of toques) {
      if (new Date(t.fecha) > new Date(desde)) desde = t.fecha;
    }
    if (siguiente) desde = siguiente.fecha;
    const horas = horasHabilesEntre(desde, ahora);
    cola.push({
      id: p.id,
      nombre: p.nombre,
      celular: p.celular,
      ciudad: p.ciudad,
      canal: p.canal,
      etapa: p.etapa,
      vendedor: p.vendedor,
      horas,
      toques: toques.length,
      color: semaforo(horas, p.canal),
      sugerirNoUtil: toques.length >= SUGERIR_NO_UTIL_TOQUES,
      // Prospecto convertido en cliente (#46, CONTEXT.md): sigue en la cola
      // hasta Cotizado o No util, con etiqueta visible en la UI.
      yaEsCliente: !!(p.data && p.data.cliente_id),
      reunionVencida: !!fechaReunion,
      fechaReunion: fechaReunion || null,
      // Instruccion visible del dia (issue #262): canal y fecha del compromiso
      // que ya vencio. El nombre del evento viaja aparte para la cola Hoy.
      siguienteContacto: siguiente,
      evento: (p.data && p.data.evento) || null,
    });
  }
  cola.sort((a, b) =>
    (b.reunionVencida - a.reunionVencida) ||
    (b.horas / umbral(b.canal).rojo - a.horas / umbral(a.canal).rojo)
  );
  return cola;
}
