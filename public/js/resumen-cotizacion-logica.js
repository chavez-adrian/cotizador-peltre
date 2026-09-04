// Nucleo unico del Resumen de la cotizacion (#307, CONTEXT.md "Resumen de la
// cotizacion"): lo que el cliente recibe por WhatsApp. Modulo puro sin efectos
// de navegador, mismo patron que origen-logica.js: lo consumen app.js (la
// cotizacion recien generada), cotizaciones-logica.js (el historial) y los
// tests .cjs via import().

function fmtMoneda(n) {
  if (n == null) return '0.00';
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// #311: sin numero no hay mensaje, sea cual sea el motivo por el que falta (PRE
// por fallo de Operam o registro sin id). Un numero es la identidad de la
// cotizacion (ADR-0009); compartir sin numero es compartir algo sin identidad.
export const LEYENDA_SIN_FOLIO = 'Sin número de cotización no se puede compartir; se habilita en cuanto Operam lo asigne';

export function motivoSinResumen(registro) {
  const r = registro || {};
  if (r.id == null || r.id === '') return LEYENDA_SIN_FOLIO;
  if (r.folioOperam == null || r.folioOperam === '') return LEYENDA_SIN_FOLIO;
  return null;
}

// registro = { id, cliente, total, folioOperam }. La liga es SIEMPRE al documento
// HTML, la unica cara del documento hacia el cliente; el PDF es la descarga del
// vendedor.
export function mensajeCotizacion(registro, origin = '') {
  const r = registro || {};
  if (motivoSinResumen(r)) return null;
  const texto = `Cotizacion Peltre Nacional\nCliente: ${r.cliente || 'Cliente'}\nTotal: $${fmtMoneda(r.total)}\n\nVer cotizacion:\n${origin}/api/cotizacion/html/${r.id}`;
  return { texto, waUrl: `https://wa.me/?text=${encodeURIComponent(texto)}` };
}
