// Motor de la cola de seguimiento de prospectos (issue #44, CONTEXT.md
// "Cadencia de prospecto"): funcion pura (prospectos, ahora) -> cola, mismo
// patron que lib/seguimiento.js para cotizaciones. La espera corre en horas
// habiles (lib/horas-habiles.js) desde el ultimo toque, o desde la captura si
// no hay toques. El semaforo depende del canal: mensajeria espera respuesta en
// horas; el resto tolera mas. La sugerencia de No util tras 3 toques es solo
// eso -- una sugerencia que el vendedor confirma, nunca se aplica sola.

import { horasHabilesEntre } from './horas-habiles.js';
import { CANALES } from '../public/js/prospectos-logica.js';

export const UMBRAL_MENSAJERIA = { ambar: 1, rojo: 2 };
export const UMBRAL_RESTO = { ambar: 4, rojo: 8 };

const CANALES_MENSAJERIA = new Set(['WhatsApp', 'Instagram', 'Facebook/Messenger', 'Meta Ads']);

export const UMBRALES_POR_CANAL = Object.fromEntries(
  CANALES.map(c => [c, CANALES_MENSAJERIA.has(c) ? UMBRAL_MENSAJERIA : UMBRAL_RESTO])
);

export const SUGERIR_NO_UTIL_TOQUES = 3;

const ETAPAS_EN_COLA = new Set(['nuevo', 'contactado', 'calificado']);

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
    const toques = (p.eventos || []).filter(e => e.tipo === 'toque');
    let desde = p.fecha;
    for (const t of toques) {
      if (new Date(t.fecha) > new Date(desde)) desde = t.fecha;
    }
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
    });
  }
  cola.sort((a, b) => b.horas / umbral(b.canal).rojo - a.horas / umbral(a.canal).rojo);
  return cola;
}
