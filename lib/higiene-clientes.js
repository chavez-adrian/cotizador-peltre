import { RFC_GENERICOS } from './deduplicacion.js';
import { FUENTE_ALTA_GENERICA } from './alta-generica.js';

// Reporte admin de higiene de clientes con RFC generico (issue #86, ADR-0006
// "Higiene"): cruza el log de altas genericas en Neon (clientes_log, #81) con
// las cotizaciones locales para derivar la ultima actividad de cada cliente
// generico y marcar candidatos a inactivacion manual en Operam. Sin IO ni
// llamadas a Operam -- el caller (server.js) alimenta ambas listas ya leidas.

export const UMBRAL_MESES_INACTIVIDAD = 6;

// Limite de la exclusion de upgradeados: hoy NO existe una senal directa del
// upgrade de CSF -- PUT /api/actualizar-cliente/:id (el camino real del
// upgrade, ADR-0006) no escribe en clientes_log. La unica senal disponible es
// que exista un log POSTERIOR del mismo cliente_id con un RFC no generico,
// que solo se produce si ese cliente_id vuelve a pasar por POST
// /api/crear-cliente (capa de dedup "cliente existente elegido"). Un upgrade
// que solo pasa por el PUT queda invisible para este reporte hasta que el
// upgrade formal (#85) deje su propio rastro.
function fueActualizadoConRfcReal(clienteId, altasLog, fechaAlta) {
  return altasLog.some(r => {
    if (String(r.cliente_id) !== String(clienteId)) return false;
    if (new Date(r.created_at) <= fechaAlta) return false;
    const rfc = String(r.rfc || '').toUpperCase().trim();
    return rfc !== '' && !RFC_GENERICOS.has(rfc);
  });
}

export function construirReporteHigiene(altasLog, cotizaciones, ahora = new Date()) {
  const logs = altasLog || [];
  const cotz = cotizaciones || [];
  const ahoraDate = ahora instanceof Date ? ahora : new Date(ahora);

  const limite = new Date(ahoraDate);
  limite.setMonth(limite.getMonth() - UMBRAL_MESES_INACTIVIDAD);

  // Altas genericas exitosas (cliente_id conocido); las fallidas (resultado
  // 'error', cliente_id null) no crearon cliente y no aplican al reporte.
  const genericas = logs.filter(r => r.fuente === FUENTE_ALTA_GENERICA && r.cliente_id != null);

  // Dedup por cliente_id, quedandose con la fecha de alta mas antigua (primera
  // vez que se creo ese cliente).
  const porCliente = new Map();
  for (const r of genericas) {
    const id = String(r.cliente_id);
    const fecha = new Date(r.created_at);
    const actual = porCliente.get(id);
    if (!actual || fecha < actual.fechaAlta) {
      porCliente.set(id, { clienteId: r.cliente_id, nombre: r.nombre || '', fechaAlta: fecha });
    }
  }

  const filas = [];
  for (const info of porCliente.values()) {
    if (fueActualizadoConRfcReal(info.clienteId, logs, info.fechaAlta)) continue;

    const cotizacionesCliente = cotz
      .filter(c => c.data?.cliente?.customerId != null && String(c.data.cliente.customerId) === String(info.clienteId))
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    const masReciente = cotizacionesCliente[0] || null;

    const ultimaActividad = masReciente ? new Date(masReciente.fecha) : info.fechaAlta;

    filas.push({
      customerId: info.clienteId,
      nombre: info.nombre,
      celular: masReciente?.data?.cliente?.telefono || '',
      vendedor: masReciente?.vendedor || '',
      fechaAlta: info.fechaAlta.toISOString(),
      ultimaActividad: ultimaActividad.toISOString(),
      etapa: masReciente?.etapa || null,
      candidato: ultimaActividad <= limite,
    });
  }

  filas.sort((a, b) => new Date(a.ultimaActividad) - new Date(b.ultimaActividad));
  return filas;
}
