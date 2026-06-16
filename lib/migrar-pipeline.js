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

// Idempotente: si la cotizacion ya trae una etapa del pipeline (migrada antes,
// o avanzada por Operam en un issue posterior) se respeta; si no, se deriva del
// estado.
export function migrarCotizacion(c) {
  const etapa = esEtapa(c.etapa) || esSalida(c.etapa)
    ? c.etapa
    : etapaCotizacionMigrada(c.estado);
  return { ...c, etapa };
}
