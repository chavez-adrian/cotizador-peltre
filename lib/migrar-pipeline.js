// Migracion del modelo previo (dos mundos: etapas de prospecto + estados de
// cotizacion) al pipeline unificado de 7 etapas (issue #53, ADR-0005
// "Migracion de datos"). Modulo puro: mapea una entidad a su etapa nueva
// preservando el resto (historial de eventos / seguimientos intactos). La
// migracion es idempotente -- aplicarla sobre una entidad ya migrada no la
// cambia -- para que pueda correr mas de una vez sin daño.

import { esEtapa, esSalida } from './pipeline.js';

// Mapeo de etapa de prospecto del modelo previo. Las etapas intermedias de
// prospeccion (Contactado, Calificado) desaparecen y colapsan a Por Cotizar
// junto con Nuevo: el dato real es "ya tiene vendedor y aun no se cotiza".
// Cotizado se reinterpreta como Seguimiento. No util se conserva. Un valor ya
// del vocabulario nuevo (etapa o salida) se devuelve igual (idempotencia).
const PROSPECTO_VIEJO_A_NUEVO = {
  nuevo: 'por_cotizar',
  contactado: 'por_cotizar',
  calificado: 'por_cotizar',
  cotizado: 'seguimiento',
  no_util: 'no_util',
};

export function etapaProspectoMigrada(etapaVieja) {
  if (esEtapa(etapaVieja) || esSalida(etapaVieja)) return etapaVieja;
  return PROSPECTO_VIEJO_A_NUEVO[etapaVieja] || 'por_cotizar';
}

// Mapeo de estado de cotizacion a etapa del pipeline. En este slice no se lee
// Operam, asi que toda cotizacion viva (abierta/sin estado, o ganada) vive en
// Seguimiento; el avance post-venta real lo dirige Operam en un issue posterior.
// Perdida y descartada salen del tablero a la salida Perdida.
const COTIZACION_ESTADO_A_ETAPA = {
  abierta: 'seguimiento',
  ganada: 'seguimiento',
  perdida: 'perdida',
  descartada: 'perdida',
};

export function etapaCotizacionMigrada(estado) {
  if (estado == null) return 'seguimiento';
  return COTIZACION_ESTADO_A_ETAPA[estado] || 'seguimiento';
}

export function migrarProspecto(p) {
  return { ...p, etapa: etapaProspectoMigrada(p.etapa) };
}

// Corte de pre-cotizacion (issue #63, decision de Adrian 2026-06-16): el folio
// de Operam no se persistia historicamente, asi que una cotizacion anterior al
// despliegue de #63 y sin folio no se puede distinguir de una pre-cotizacion. Se
// asume registrada (no PRE): se marca con registroDesconocido para que el dominio
// no la trate como PRE ni le pinte badge. Las cotizaciones nuevas (desde el corte)
// sin folio si son pre-cotizaciones. El corte va por fecha (robusto entre Neon y
// el fallback JSON; los ids historicos no son contiguos).
const PRE_COTIZACION_DESDE = new Date('2026-06-16T00:00:00.000Z');

function registroHistoricoDesconocido(c) {
  const folio = c.folioOperam;
  if (!(folio == null || folio === '')) return false; // ya esta registrada
  if (c.registroDesconocido) return true;             // idempotente
  const f = new Date(c.fecha);
  return !isNaN(f.getTime()) && f < PRE_COTIZACION_DESDE;
}

// Idempotente: si la cotizacion ya trae una etapa del pipeline (migrada antes,
// o avanzada por Operam en un issue posterior) se respeta; si no, se deriva del
// estado. Ademas aplica el corte de pre-cotizacion (registroDesconocido).
export function migrarCotizacion(c) {
  const etapa = esEtapa(c.etapa) || esSalida(c.etapa)
    ? c.etapa
    : etapaCotizacionMigrada(c.estado);
  const migrada = { ...c, etapa };
  if (registroHistoricoDesconocido(c)) migrada.registroDesconocido = true;
  return migrada;
}
