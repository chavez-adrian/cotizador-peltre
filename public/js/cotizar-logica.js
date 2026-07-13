// Logica pura del flujo de cotizacion (sin efectos de navegador).
// Compartida con app.js (import nativo) y probada en cotizar-logica.test.cjs.

const LEYENDA_DOMICILIO = 'Favor de confirmar el domicilio de entrega';

// Espejo de lib/validar-cp.js (validarCP): la misma regla por pais, replicada aqui
// porque lib/ NO se sirve al navegador (solo public/). Mantener ambas en sincronia.
// Se exporta: chipsCompletitud (alta-logica.js) la reusa para el estado del chip
// Entrega ("CP capturado" vs "pendiente"), issue #84.
export function cpValido(cp, pais) {
  if (pais === 'CA') return /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/.test(cp);
  return /^\d{5}$/.test(cp);
}

// Domicilio de entrega para el DOCUMENTO (issue #84): nada es requisito para
// generar. Solo decide si hace falta la leyenda de confirmacion -- ausente que
// falte Calle (con o sin CP/pais) -> leyenda; Calle presente -> sin leyenda.
// Antes (#71) bloqueaba la generacion si faltaba CP/pais; el gate se releva por
// completo aqui porque CP+pais siguen siendo obligatorios solo para COTIZAR
// PAQUETERIA (envia.com), no para generar el documento -- ese gate vive aparte,
// en cotizarEnvia (app.js), que sigue exigiendo un CP valido.
export function validarDomicilioEntrega({ calle } = {}) {
  if (!(calle || '').trim()) return { ok: true, leyenda: LEYENDA_DOMICILIO };
  return { ok: true };
}

// Nombres canonicos de paqueteria (issue #71, decision Adrian): el carrier se
// muestra con su marca real (preserva acronimos: DHL, UPS, FedEx) y el servicio en
// Title Case. Arregla el "fedex ground" feo sin convertir DHL->Dhl ni UPS->Ups.
const CARRIERS_CANONICOS = {
  fedex: 'FedEx', dhl: 'DHL', ups: 'UPS', estafeta: 'Estafeta',
  redpack: 'Redpack', paquetexpress: 'Paquetexpress',
};

function tituloPalabras(str) {
  return (str || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Carrier con su marca canonica si es conocido; si no, Title Case (presentable).
export function formatCarrier(carrier) {
  const c = (carrier || '').trim();
  if (!c) return '';
  return CARRIERS_CANONICOS[c.toLowerCase()] || tituloPalabras(c);
}

// Servicio de paqueteria en Title Case ("ground" -> "Ground").
export function formatServicio(servicio) {
  return tituloPalabras(servicio);
}

// Tiempo estimado de entrega de una tarifa de envia.com (issue #88). El shape
// real de api.envia.com/ship/rate/ (verificado en vivo, FedEx/UPS, destino
// CP 78000) NO trae `rate.days` -- ese campo nunca aparecio en la respuesta real.
// Los campos reales son `deliveryEstimate` (string humano ya formateado, ej.
// "1-2 días", "Día siguiente") y `deliveryDate.dateDifference` (numero de dias,
// estructurado). Se prefiere `deliveryEstimate` por ser el texto que envia.com
// ya redacta para el usuario final; `rate.days` se conserva como fallback por si
// algun carrier/servicio futuro lo llegara a usar.
export function formatTiempoEntrega(rate) {
  if (!rate) return '';
  if (rate.deliveryEstimate) return rate.deliveryEstimate;
  const dias = rate.deliveryDate?.dateDifference;
  if (dias != null) return `${dias} día${dias !== 1 ? 's' : ''}`;
  if (rate.days != null) return `${rate.days} día${rate.days !== 1 ? 's' : ''}`;
  return '';
}

// Escape local (no se importa de prospectos-logica.js para evitar un ciclo:
// prospectos-logica.js -> alta-logica.js -> cotizar-logica.js).
function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Cambiar cantidades en el resumen invalida la tarifa de envia.com (issue #89):
// recotizar en cada toque dispararia llamadas a las 3 paqueterias, asi que en vez
// de recalcular solo se invalida y se avisa. Solo aplica a envia.com -- el envio
// manual capturado a mano no se toca (no hay nada que "recotizar" ahi).
export const MENSAJE_ENVIO_INVALIDADO = 'Las cantidades cambiaron, vuelve a cotizar el envío';

export function debeInvalidarEnvioPorCantidad(shippingOpt, enviaRateSeleccionado) {
  return shippingOpt === 'envia' && !!enviaRateSeleccionado;
}

// Compuerta de generacion: con el envio de envia.com invalidado por un cambio de
// cantidades, no se genera PDF/HTML hasta volver a cotizar.
export function bloqueaGeneracionPorEnvioInvalidado(envioInvalidado) {
  return !!envioInvalidado;
}

// Nota de tiempo de entrega en el resumen (issue #90): default 4 semanas para
// producto normal, 6 semanas cuando el pedido lleva calca/decorado. La deteccion
// automatica desde el carrito no es posible hoy (no hay forma de meter un SKU de
// calca/decorado al carrito, ver issue #90) -- por eso es un checkbox manual en
// el resumen en vez de una regla derivada del carrito.
export function notaTiempoEntrega(decorado) {
  const semanas = decorado ? 6 : 4;
  return `- Tiempo de entrega: ${semanas} semanas contadas a partir del pago del anticipo.`;
}

const LINEAS_AUTO_TIEMPO_ENTREGA = [notaTiempoEntrega(false), notaTiempoEntrega(true)];

// Actualiza SOLO la linea de tiempo de entrega dentro del textarea de notas, sin
// tocar el resto. Si el vendedor ya edito esa linea a mano (no coincide con
// ninguna de las dos versiones auto-generadas) o la borro por completo, se deja
// tal cual -- togglear el checkbox no debe pisotear una edicion manual.
export function aplicarNotaTiempoEntrega(notasText, decorado) {
  const lineas = (notasText || '').split('\n');
  const idx = lineas.findIndex(l => LINEAS_AUTO_TIEMPO_ENTREGA.includes(l.trim()));
  if (idx === -1) return notasText;
  lineas[idx] = notaTiempoEntrega(decorado);
  return lineas.join('\n');
}

// Modal de confirmacion de identidad antes de generar el PDF/HTML (issue #87):
// evita estampar la cotizacion al vendedor equivocado cuando el dispositivo
// quedo logueado con otro usuario. Mismo patron que buildCanalModalHtml
// (prospectos-logica.js): HTML puro, el overlay/promesa vive en app.js.
export function buildConfirmarVendedorModalHtml(vendedorNombre) {
  return `
    <div style="background:#fff;border-radius:8px;padding:20px;max-width:340px;width:90%">
      <div style="font-weight:600;margin-bottom:4px">Cotización a nombre de: ${escapeHtml(vendedorNombre)}</div>
      <div class="cot-card-meta" style="margin-bottom:8px">Confirma que eres tú quien esta generando esta cotización.</div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-secondary btn-sm" id="confirmar-vendedor-cancelar">Cancelar</button>
        <button class="btn btn-primary btn-sm" id="confirmar-vendedor-confirmar">Confirmar</button>
      </div>
    </div>
  `;
}
