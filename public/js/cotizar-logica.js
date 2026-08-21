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

// Descripcion literal de la partida ENVIO para una tarifa de envia.com (issue
// #136): servicio + tiempo LITERALES que reporta la paqueteria (nada de
// editorializar el nombre del servicio). "habiles" se agrega solo cuando el
// estimado termina en "dias" -- nunca sobre "Dia siguiente", que no es plural
// de dias. serviceDescription es el campo real del shape de envia.com (#88);
// sin el, cae al mismo carrier+servicio formateados que ya se mostraban.
export function formatDescripcionEnvioEnvia(rate) {
  if (!rate) return '';
  const servicio = rate.serviceDescription
    || `${formatCarrier(rate.carrier)} ${formatServicio(rate.service ?? rate.serviceType)}`.trim();
  const tiempo = formatTiempoEntrega(rate);
  if (!tiempo) return servicio;
  const habiles = /días$/.test(tiempo.trim()) ? ' hábiles' : '';
  return `${servicio} — entrega estimada ${tiempo}${habiles}`;
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

// Envio estructurado {carrier, servicio, precio} (issue #102): prefactor de
// escritura. Antes seleccionarEnviaRate horneaba carrier+servicio en el string
// de descripcion de la partida ENVIO y nada estructurado se persistia -- al
// Cargar desde historial no habia forma de restaurar la seleccion, solo el
// texto de la partida. shippingOpt 'none' o costo <= 0 -> nada que persistir.
export function buildEnvioEstructurado({ shippingOpt, shippingCost, shippingDesc, shippingDescuento, enviaRateSeleccionado }) {
  if (shippingOpt !== 'manual' && shippingOpt !== 'envia') return null;
  if (!(shippingCost > 0)) return null;
  const carrier = shippingOpt === 'envia' ? (enviaRateSeleccionado?.carrier ?? null) : null;
  const servicio = shippingOpt === 'envia' ? (enviaRateSeleccionado?.servicio ?? null) : null;
  return {
    opcion: shippingOpt, carrier, servicio, precio: shippingCost,
    descripcion: shippingDesc || 'Envio',
    // El descuento del flete (#137) se persiste aqui por el mismo motivo que el
    // carrier: sin el, Cargar del historial perderia la bonificacion negociada.
    descuento: shippingDescuento || 0,
  };
}

// Restaura el envio elegido al Cargar una cotizacion del historial (#102): dado
// el envio estructurado persistido (o su ausencia -- cotizaciones viejas antes
// de este prefactor), calcula el estado a aplicar a los campos de la seccion
// Envio SIN volver a llamar a envia.com. opcion desconocida o ausente degrada
// a 'none' (comportamiento identico al de hoy: sin seleccion, no rompe).
export function restaurarEnvioDesdeCotizacion(envio) {
  if (!envio || (envio.opcion !== 'manual' && envio.opcion !== 'envia')) {
    return { opcion: 'none', mostrarEnvia: false, mostrarManual: false, cost: '', desc: 'Envio', descuento: 0, enviaRateSeleccionado: null };
  }
  const desc = envio.descripcion || 'Envio';
  const cost = typeof envio.precio === 'number' ? envio.precio.toFixed(2) : '';
  return {
    opcion: envio.opcion,
    mostrarEnvia: envio.opcion === 'envia',
    mostrarManual: envio.opcion === 'manual',
    cost, desc,
    descuento: envio.descuento || 0,
    enviaRateSeleccionado: envio.opcion === 'envia'
      ? { carrier: envio.carrier ?? null, servicio: envio.servicio ?? null, desc, cost: envio.precio }
      : null,
  };
}

// Compuerta del auto-cotizado al entrar al tab Envio (issue #102 AC2): si ya
// hay una tarifa de envia.com elegida (restaurada del historial, o de la misma
// sesion) no se vuelve a disparar la consulta -- perderia/pisaria la seleccion
// vigente. Espejo minimo de debeInvalidarEnvioPorCantidad (#89): misma idea,
// disparador distinto (entrar al tab vs. cambiar cantidades).
export function debeAutoCotizarEnvia(shippingOpt, cartSize, enviaRateSeleccionado) {
  return shippingOpt === 'envia' && cartSize > 0 && !enviaRateSeleccionado;
}

// Tarjeta de solo lectura para el envio via envia.com restaurado del historial
// (#102, hallazgo del code review): sin ella, #envia-results quedaba vacio y el
// vendedor perdia la confirmacion visual de que ya habia un envio elegido en el
// tab Envio (aunque el valor si estuviera bien restaurado para el Resumen/PDF).
// Mismo marcado que las tarjetas de cotizarEnvia (app.js) para verse igual, sin
// listener de click -- no hay tarifas alternativas que ofrecer sin re-consultar.
export function buildEnviaRateRestauradaHtml({ carrier, servicio, precio }) {
  const money = (typeof precio === 'number' ? precio : 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `
    <div class="envia-rate-card selected">
      <div class="envia-rate-info">
        <div class="envia-rate-carrier">${formatCarrier(carrier)}</div>
        <div class="envia-rate-servicio">${formatServicio(servicio)}</div>
      </div>
      <div class="envia-rate-precio">$${money}</div>
    </div>
  `;
}

// Builder unico del payload de items (articulos, calcas y envio) y de los
// totales (#135, prefactor de #134): antes generatePDF y generateHTML en app.js
// duplicaban linea a linea el mapeo carrito->items, el push condicional de ENVIO
// y el calculo de subtotal/iva/total. Un solo lugar para que los tickets de
// descuentos y descripciones lo toquen.

// Nombre visible del producto sin el prefijo de SKU del catalogo (2-3 letras
// mayusculas + 2 digitos + espacio, ej. "AB12 Olla peltre" -> "Olla peltre").
export function nombreVisibleProducto(name) {
  return (name || '').replace(/^[A-Z]{2,3}\d{2}\s+/, '');
}

// Partida ENVIO para el documento, o null si no hay nada que cobrar (issue #71:
// el carrito no manda envio con costo 0 ni con la opcion 'none').
export function buildItemEnvio({ shippingOpt, shippingCost, shippingDesc, shippingDescuento }) {
  if (shippingOpt !== 'manual' && shippingOpt !== 'envia') return null;
  if (!(shippingCost > 0)) return null;
  return {
    codigo: 'ENVIO', descripcion: shippingDesc || 'Envio',
    cantidad: 1, unidad: 'ACT', precio: shippingCost, descuento: shippingDescuento || 0,
  };
}

// Importe NETO de una partida: la unica formula del descuento comercial (#137).
// La usan las cuatro superficies del cotizador (tabla del carrito, barra
// resumen, resumen final, totales del payload) y los DOS generadores de
// documento (lib/pdf-generator.js y lib/html-generator.js, que la tenian
// copiada linea a linea), para que ninguna pueda divergir de las demas.
export function importeLinea({ cantidad, precio, descuento }) {
  return (cantidad || 0) * (precio || 0) * (1 - (descuento || 0) / 100);
}

// Subtotal/IVA/total de un arreglo de items ya armado, aplicando el % de
// descuento por linea.
export function calcularTotalesItems(items) {
  const subtotal = items.reduce((s, i) => s + importeLinea(i), 0);
  const iva = subtotal * 0.16;
  const total = subtotal + iva;
  return { subtotal, iva, total };
}

// Arma los items del carrito (articulos y calcas) + la partida ENVIO (si aplica)
// y sus totales. cartEntries ya trae el precio resuelto (depende del tier
// vigente, estado que vive en app.js) -- esta funcion solo ensambla el payload.
export function buildItemsYTotales(cartEntries, envioInfo) {
  const items = cartEntries.map(({ codigo, nombre, cantidad, precio, descuento, descripcion, diseno }) => ({
    codigo,
    // La descripcion que escribio el vendedor manda sobre la del catalogo (#139), y
    // viaja marcada: es lo que hace que al ACTUALIZAR el quote de Operam se re-escriba
    // esa linea en vez de dejar la que impone el catalogo de articulos del ERP.
    descripcion: descripcion || nombreVisibleProducto(nombre),
    cantidad, unidad: 'pza', precio, descuento: descuento || 0,
    // El numero de diseño se persiste junto al codigo del catalogo (#220): el GET
    // del documento regenera desde `data`, y sin el no podria distinguir dos
    // partidas del mismo codigo. La partida de diseño viaja SIEMPRE marcada como
    // editada: al actualizar por la web legacy, FA impone el nombre del articulo y
    // borraria el "Diseño N" de las lineas que no entran a la ronda de reescritura.
    ...(diseno ? { diseno } : {}),
    ...(descripcion || diseno ? { descripcionEditada: true } : {}),
  }));
  const itemEnvio = buildItemEnvio(envioInfo);
  if (itemEnvio) items.push(itemEnvio);
  return { items, ...calcularTotalesItems(items) };
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
