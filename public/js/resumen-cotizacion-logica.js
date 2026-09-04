// Nucleo unico del Resumen de la cotizacion (#307, CONTEXT.md "Resumen de la
// cotizacion"): lo que el cliente recibe por WhatsApp. Modulo puro sin efectos
// de navegador, mismo patron que origen-logica.js: lo consumen app.js (la
// cotizacion recien generada), cotizaciones-logica.js (el historial) y los
// tests .cjs via import().

function fmtMoneda(n) {
  if (n == null) return '0.00';
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// registro = { id, cliente, total }. La liga es SIEMPRE al documento HTML, la
// unica cara del documento hacia el cliente; el PDF es la descarga del vendedor.
export function mensajeCotizacion(registro, origin = '') {
  const r = registro || {};
  if (r.id == null || r.id === '') return null;
  const texto = `Cotizacion Peltre Nacional\nCliente: ${r.cliente || 'Cliente'}\nTotal: $${fmtMoneda(r.total)}\n\nVer cotizacion:\n${origin}/api/cotizacion/html/${r.id}`;
  return { texto, waUrl: `https://wa.me/?text=${encodeURIComponent(texto)}` };
}
