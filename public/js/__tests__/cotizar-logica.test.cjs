'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let validarDomicilioEntrega, formatCarrier, formatServicio, cpValido, buildConfirmarVendedorModalHtml;
let debeInvalidarEnvioPorCantidad, bloqueaGeneracionPorEnvioInvalidado, MENSAJE_ENVIO_INVALIDADO;
let notaTiempoEntrega, aplicarNotaTiempoEntrega, formatTiempoEntrega, formatDescripcionEnvioEnvia;
let buildEnvioEstructurado, restaurarEnvioDesdeCotizacion, debeAutoCotizarEnvia, buildEnviaRateRestauradaHtml;
let nombreVisibleProducto, buildItemEnvio, calcularTotalesItems, buildItemsYTotales, importeLinea;
before(async () => {
  ({
    validarDomicilioEntrega, formatCarrier, formatServicio, cpValido, buildConfirmarVendedorModalHtml,
    debeInvalidarEnvioPorCantidad, bloqueaGeneracionPorEnvioInvalidado, MENSAJE_ENVIO_INVALIDADO,
    notaTiempoEntrega, aplicarNotaTiempoEntrega, formatTiempoEntrega, formatDescripcionEnvioEnvia,
    buildEnvioEstructurado, restaurarEnvioDesdeCotizacion, debeAutoCotizarEnvia, buildEnviaRateRestauradaHtml,
    nombreVisibleProducto, buildItemEnvio, calcularTotalesItems, buildItemsYTotales, importeLinea,
  } = await import('../cotizar-logica.js'));
});

// === AC1: CP + pais sin Calle -> procede con leyenda ===
test('AC1-1: CP + pais validos sin Calle -> ok con leyenda', () => {
  const r = validarDomicilioEntrega({ calle: '', cp: '06600', pais: 'MX' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.leyenda, 'Favor de confirmar el domicilio de entrega');
  assert.ok(!r.error);
});

test('AC1-2: CP + pais + Calle -> ok sin leyenda', () => {
  const r = validarDomicilioEntrega({ calle: 'Reforma 100', cp: '06600', pais: 'MX' });
  assert.strictEqual(r.ok, true);
  assert.ok(!r.leyenda);
  assert.ok(!r.error);
});

test('AC1-3: Calle solo con espacios cuenta como vacia -> leyenda', () => {
  const r = validarDomicilioEntrega({ calle: '   ', cp: '06600', pais: 'MX' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.leyenda, 'Favor de confirmar el domicilio de entrega');
});

// === AC4 (#84): nada de la direccion es requisito para GENERAR -- el gate de
// CP+pais obligatorios se elimina (antes bloqueaba, #71); solo importa si hay
// Calle para decidir la leyenda. CP+pais siguen obligatorios pero SOLO para
// cotizar paqueteria (envia.com), fuera de esta funcion.
test('AC4-1: falta CP (con Calle) -> ok:true, sin leyenda (Calle presente)', () => {
  const r = validarDomicilioEntrega({ calle: 'Reforma 100', cp: '', pais: 'MX' });
  assert.strictEqual(r.ok, true);
  assert.ok(!r.leyenda);
});

test('AC4-2: falta pais (con Calle) -> ok:true, sin leyenda', () => {
  const r = validarDomicilioEntrega({ calle: 'Reforma 100', cp: '06600', pais: '' });
  assert.strictEqual(r.ok, true);
  assert.ok(!r.leyenda);
});

test('AC4-3: CP con formato invalido (con Calle) -> ok:true, ya no bloquea', () => {
  const r = validarDomicilioEntrega({ calle: 'Reforma 100', cp: '123', pais: 'MX' });
  assert.strictEqual(r.ok, true);
  assert.ok(!r.leyenda);
});

test('AC4-4: CP valido canadiense sin Calle -> ok con leyenda (falta Calle)', () => {
  const r = validarDomicilioEntrega({ calle: '', cp: 'K1A 0A9', pais: 'CA' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.leyenda, 'Favor de confirmar el domicilio de entrega');
});

test('AC4-5: entrega totalmente ausente (sin CP, pais ni Calle) -> ok con leyenda', () => {
  const r = validarDomicilioEntrega({ calle: '', cp: '', pais: '' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.leyenda, 'Favor de confirmar el domicilio de entrega');
});

test('AC4-6: parcial, solo CP (sin Calle) -> ok con leyenda', () => {
  const r = validarDomicilioEntrega({ calle: '', cp: '06600', pais: 'MX' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.leyenda, 'Favor de confirmar el domicilio de entrega');
});

// === cpValido: espejo de lib/validar-cp.js, reusado por chipsCompletitud ===
test('CP1: MX de 5 digitos es valido', () => {
  assert.strictEqual(cpValido('06600', 'MX'), true);
});

test('CP2: MX con menos de 5 digitos es invalido', () => {
  assert.strictEqual(cpValido('123', 'MX'), false);
});

test('CP3: CA con formato correcto es valido', () => {
  assert.strictEqual(cpValido('K1A 0A9', 'CA'), true);
});

test('CP4: CA sin espacio tambien es valido', () => {
  assert.strictEqual(cpValido('K1A0A9', 'CA'), true);
});

// === AC3: nombres canonicos de paqueteria (carrier con su marca + servicio Title Case) ===
test('AC3-1: carrier canonico preserva el acronimo/marca sin importar el case de entrada', () => {
  assert.strictEqual(formatCarrier('fedex'), 'FedEx');
  assert.strictEqual(formatCarrier('FEDEX'), 'FedEx');
  assert.strictEqual(formatCarrier('FedEx'), 'FedEx');
  assert.strictEqual(formatCarrier('dhl'), 'DHL');
  assert.strictEqual(formatCarrier('DHL'), 'DHL');
  assert.strictEqual(formatCarrier('ups'), 'UPS');
  assert.strictEqual(formatCarrier('estafeta'), 'Estafeta');
});

test('AC3-2: carrier desconocido -> Title Case (no rompe, presentable)', () => {
  assert.strictEqual(formatCarrier('paqueteria local'), 'Paqueteria Local');
});

test('AC3-3: servicio en Title Case', () => {
  assert.strictEqual(formatServicio('ground'), 'Ground');
  assert.strictEqual(formatServicio('STANDARD OVERNIGHT'), 'Standard Overnight');
  assert.strictEqual(formatServicio('Express'), 'Express');
});

test('AC3-4: vacios / null / undefined -> cadena vacia', () => {
  assert.strictEqual(formatCarrier(''), '');
  assert.strictEqual(formatCarrier(null), '');
  assert.strictEqual(formatServicio(undefined), '');
});

test('AC3-5: combinacion carrier + servicio (lo que va al documento)', () => {
  assert.strictEqual(`${formatCarrier('fedex')} ${formatServicio('ground')}`.trim(), 'FedEx Ground');
  assert.strictEqual(`${formatCarrier('DHL')} ${formatServicio('express')}`.trim(), 'DHL Express');
  assert.strictEqual(`${formatCarrier('ups')} ${formatServicio('ground')}`.trim(), 'UPS Ground');
});

// === #87: confirmacion de vendedor antes de generar (evitar estampar al vendedor equivocado) ===
test('#87-1: buildConfirmarVendedorModalHtml incluye el nombre del vendedor logueado', () => {
  const html = buildConfirmarVendedorModalHtml('Alejandro Chávez');
  assert.ok(html.includes('Alejandro Chávez'));
  assert.ok(html.includes('confirmar-vendedor-confirmar'));
  assert.ok(html.includes('confirmar-vendedor-cancelar'));
});

test('#87-2: buildConfirmarVendedorModalHtml escapa HTML del nombre (XSS)', () => {
  const html = buildConfirmarVendedorModalHtml('<script>alert(1)</script>');
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

// === #89: cambiar cantidades en el resumen invalida la tarifa de envia.com
// vigente (en vez de recalcular sola -- evita 3 llamadas a paqueteria por toque).
// El envio manual capturado a mano NO se invalida.
test('#89-1: hay tarifa de envia seleccionada y el envio activo es envia -> invalida', () => {
  const r = debeInvalidarEnvioPorCantidad('envia', { desc: 'FedEx Ground', cost: 150 });
  assert.strictEqual(r, true);
});

test('#89-2: sin tarifa de envia seleccionada -> no hay nada que invalidar', () => {
  const r = debeInvalidarEnvioPorCantidad('envia', null);
  assert.strictEqual(r, false);
});

test('#89-3: envio manual (no envia.com) -> nunca se invalida aunque haya rate previo', () => {
  const r = debeInvalidarEnvioPorCantidad('manual', { desc: 'FedEx Ground', cost: 150 });
  assert.strictEqual(r, false);
});

test('#89-4: sin envio (none) -> no aplica invalidacion', () => {
  const r = debeInvalidarEnvioPorCantidad('none', { desc: 'FedEx Ground', cost: 150 });
  assert.strictEqual(r, false);
});

test('#89-5: bloquea generacion cuando el envio quedo invalidado por cambio de cantidad', () => {
  assert.strictEqual(bloqueaGeneracionPorEnvioInvalidado(true), true);
  assert.strictEqual(bloqueaGeneracionPorEnvioInvalidado(false), false);
  assert.strictEqual(bloqueaGeneracionPorEnvioInvalidado(undefined), false);
});

test('#89-6: mensaje de aviso visible cuando el envio se invalida', () => {
  assert.strictEqual(MENSAJE_ENVIO_INVALIDADO, 'Las cantidades cambiaron, vuelve a cotizar el envío');
});

// === #90: nota de tiempo de entrega -- default 4 semanas, 6 si lleva calca/decorado ===
test('#90-1: notaTiempoEntrega(false) -> 4 semanas (default, producto normal)', () => {
  assert.strictEqual(
    notaTiempoEntrega(false),
    '- Tiempo de entrega: 4 semanas contadas a partir del pago del anticipo.'
  );
});

test('#90-2: notaTiempoEntrega(true) -> 6 semanas (lleva calca/decorado)', () => {
  assert.strictEqual(
    notaTiempoEntrega(true),
    '- Tiempo de entrega: 6 semanas contadas a partir del pago del anticipo.'
  );
});

const NOTAS_DEFAULT_4 = `- Precios EXW Ixtapaluca, Estado de Mexico. No incluye envio.
- Envio a costo y riesgo del cliente.
- Tiempo de entrega: 4 semanas contadas a partir del pago del anticipo.
- Se requiere 50% de anticipo para comenzar la produccion.
- Pago del saldo previo a la entrega.`;

test('#90-3: aplicarNotaTiempoEntrega marca decorado -> reemplaza la linea a 6 semanas, preserva el resto', () => {
  const r = aplicarNotaTiempoEntrega(NOTAS_DEFAULT_4, true);
  assert.ok(r.includes('- Tiempo de entrega: 6 semanas contadas a partir del pago del anticipo.'));
  assert.ok(!r.includes('4 semanas'));
  assert.ok(r.includes('- Precios EXW Ixtapaluca'));
  assert.ok(r.includes('- Pago del saldo previo a la entrega.'));
});

test('#90-4: aplicarNotaTiempoEntrega desmarca decorado -> vuelve a 4 semanas', () => {
  const notasCon6 = aplicarNotaTiempoEntrega(NOTAS_DEFAULT_4, true);
  const r = aplicarNotaTiempoEntrega(notasCon6, false);
  assert.ok(r.includes('- Tiempo de entrega: 4 semanas contadas a partir del pago del anticipo.'));
  assert.ok(!r.includes('6 semanas'));
});

test('#90-5: si el vendedor edito la linea a mano (texto que no coincide con ninguna version auto), no se pisotea', () => {
  const notasEditadas = NOTAS_DEFAULT_4.replace(
    '- Tiempo de entrega: 4 semanas contadas a partir del pago del anticipo.',
    '- Tiempo de entrega: 10 dias habiles, urge.'
  );
  const r = aplicarNotaTiempoEntrega(notasEditadas, true);
  assert.strictEqual(r, notasEditadas);
});

test('#90-6: si el vendedor borro la linea por completo, no se vuelve a agregar', () => {
  const sinLinea = NOTAS_DEFAULT_4.split('\n').filter(l => !l.includes('Tiempo de entrega')).join('\n');
  const r = aplicarNotaTiempoEntrega(sinLinea, true);
  assert.strictEqual(r, sinLinea);
});

// === #88: tiempo estimado de entrega -- envia.com NO puebla rate.days (shape
// real verificado en vivo contra api.envia.com/ship/rate/, FedEx/UPS, CP 78000
// San Luis Potosi). El campo real es deliveryEstimate (string humano ya
// formateado por envia.com) o deliveryDate.dateDifference (numero de dias).
test('#88-1: shape real de FedEx (ground, CP 78000) -> usa deliveryEstimate', () => {
  const rate = {
    carrier: 'fedex', service: 'ground', totalPrice: 259,
    deliveryEstimate: '1-2 días',
    deliveryDate: { date: '2026-07-15', dateDifference: 2, timeUnit: 'days', time: '21:00' },
  };
  assert.strictEqual(formatTiempoEntrega(rate), '1-2 días');
});

test('#88-2: shape real de FedEx (express, dia siguiente) -> usa deliveryEstimate', () => {
  const rate = {
    carrier: 'fedex', service: 'express', totalPrice: 382,
    deliveryEstimate: 'Día siguiente',
    deliveryDate: { date: '2026-07-14', dateDifference: 1, timeUnit: 'day', time: '21:00' },
  };
  assert.strictEqual(formatTiempoEntrega(rate), 'Día siguiente');
});

test('#88-3: shape real de UPS (saver, CP 78000) -> usa deliveryEstimate', () => {
  const rate = {
    carrier: 'ups', service: 'saver', totalPrice: 703.89,
    deliveryEstimate: '2-4 días',
    deliveryDate: { date: '2026-07-17', dateDifference: 4, timeUnit: 'days', time: '23:30' },
  };
  assert.strictEqual(formatTiempoEntrega(rate), '2-4 días');
});

test('#88-4: sin deliveryEstimate pero con deliveryDate.dateDifference -> arma "N dias"', () => {
  assert.strictEqual(formatTiempoEntrega({ deliveryDate: { dateDifference: 3 } }), '3 días');
  assert.strictEqual(formatTiempoEntrega({ deliveryDate: { dateDifference: 1 } }), '1 día');
});

test('#88-5: sin deliveryEstimate ni deliveryDate, con rate.days (fallback legacy) -> lo usa', () => {
  assert.strictEqual(formatTiempoEntrega({ days: 5 }), '5 días');
  assert.strictEqual(formatTiempoEntrega({ days: 1 }), '1 día');
});

test('#88-6: sin ningun campo de tiempo -> cadena vacia (no rompe el render)', () => {
  assert.strictEqual(formatTiempoEntrega({ carrier: 'dhl' }), '');
  assert.strictEqual(formatTiempoEntrega(null), '');
  assert.strictEqual(formatTiempoEntrega(undefined), '');
});

// === #136: descripcion literal de la partida ENVIO -- servicio + tiempo tal
// cual los reporta envia.com, "habiles" solo si el estimado termina en "dias"
// (nunca sobre "Dia siguiente", que no es plural de dias).
test('#136-1: serviceDescription + deliveryEstimate en dias -> agrega "habiles"', () => {
  const rate = { serviceDescription: 'FedEx Nacional Económico', deliveryEstimate: '1-2 días' };
  assert.strictEqual(formatDescripcionEnvioEnvia(rate), 'FedEx Nacional Económico — entrega estimada 1-2 días hábiles');
});

test('#136-2: deliveryEstimate "Día siguiente" -> NO agrega "habiles"', () => {
  const rate = { serviceDescription: 'FedEx Express', deliveryEstimate: 'Día siguiente' };
  assert.strictEqual(formatDescripcionEnvioEnvia(rate), 'FedEx Express — entrega estimada Día siguiente');
});

test('#136-3: sin serviceDescription -> cae a carrier + servicio formateados', () => {
  const rate = { carrier: 'dhl', service: 'ground', deliveryEstimate: '2-4 días' };
  assert.strictEqual(formatDescripcionEnvioEnvia(rate), 'DHL Ground — entrega estimada 2-4 días hábiles');
});

test('#136-4: sin tiempo de entrega disponible -> solo el servicio, sin guion', () => {
  const rate = { serviceDescription: 'UPS Saver' };
  assert.strictEqual(formatDescripcionEnvioEnvia(rate), 'UPS Saver');
});

test('#136-5: rate nulo/indefinido -> cadena vacia', () => {
  assert.strictEqual(formatDescripcionEnvioEnvia(null), '');
  assert.strictEqual(formatDescripcionEnvioEnvia(undefined), '');
});

// === #102: persistir el envio estructurado {carrier, servicio, precio} en vez
// de solo hornearlo en la descripcion de la partida ENVIO -- necesario para
// restaurarlo tal cual al Cargar desde historial sin re-cotizar con envia.com.
test('#102-1: buildEnvioEstructurado con shippingOpt none -> null (nada que persistir)', () => {
  const r = buildEnvioEstructurado({ shippingOpt: 'none', shippingCost: 0, shippingDesc: 'Envio', enviaRateSeleccionado: null });
  assert.strictEqual(r, null);
});

test('#102-2: buildEnvioEstructurado con costo 0 -> null aunque haya opcion elegida', () => {
  const r = buildEnvioEstructurado({ shippingOpt: 'manual', shippingCost: 0, shippingDesc: 'Envio', enviaRateSeleccionado: null });
  assert.strictEqual(r, null);
});

test('#102-3: buildEnvioEstructurado manual -> opcion manual, carrier/servicio null, precio y descripcion capturados', () => {
  const r = buildEnvioEstructurado({ shippingOpt: 'manual', shippingCost: 150, shippingDesc: 'Paquete propio', enviaRateSeleccionado: null });
  assert.deepStrictEqual(r, { opcion: 'manual', carrier: null, servicio: null, precio: 150, descripcion: 'Paquete propio', descuento: 0 });
});

test('#102-4: buildEnvioEstructurado envia con rate seleccionada -> carrier/servicio estructurados (no horneados en un string)', () => {
  const r = buildEnvioEstructurado({
    shippingOpt: 'envia', shippingCost: 259, shippingDesc: 'FedEx Ground',
    enviaRateSeleccionado: { carrier: 'fedex', servicio: 'ground', desc: 'FedEx Ground', cost: 259 },
  });
  assert.deepStrictEqual(r, { opcion: 'envia', carrier: 'fedex', servicio: 'ground', precio: 259, descripcion: 'FedEx Ground', descuento: 0 });
});

test('#102-5: buildEnvioEstructurado envia sin rate seleccionada -> carrier/servicio null (degradado, no rompe)', () => {
  const r = buildEnvioEstructurado({ shippingOpt: 'envia', shippingCost: 200, shippingDesc: 'Envio', enviaRateSeleccionado: null });
  assert.deepStrictEqual(r, { opcion: 'envia', carrier: null, servicio: null, precio: 200, descripcion: 'Envio', descuento: 0 });
});

test('#102-6: restaurarEnvioDesdeCotizacion sin envio (undefined) -> degrada a "none" sin seleccion', () => {
  const r = restaurarEnvioDesdeCotizacion(undefined);
  assert.deepStrictEqual(r, {
    opcion: 'none', mostrarEnvia: false, mostrarManual: false, cost: '', desc: 'Envio', descuento: 0, enviaRateSeleccionado: null,
  });
});

test('#102-7: restaurarEnvioDesdeCotizacion con envio null (cotizacion vieja) -> degrada igual que undefined', () => {
  const r = restaurarEnvioDesdeCotizacion(null);
  assert.strictEqual(r.opcion, 'none');
  assert.strictEqual(r.enviaRateSeleccionado, null);
});

test('#102-8: restaurarEnvioDesdeCotizacion manual -> restaura costo/descripcion, sin rate de envia', () => {
  const r = restaurarEnvioDesdeCotizacion({ opcion: 'manual', carrier: null, servicio: null, precio: 200, descripcion: 'Paquete propio' });
  assert.deepStrictEqual(r, {
    opcion: 'manual', mostrarEnvia: false, mostrarManual: true, cost: '200.00', desc: 'Paquete propio', descuento: 0, enviaRateSeleccionado: null,
  });
});

test('#102-9: restaurarEnvioDesdeCotizacion envia -> restaura carrier/servicio como rate seleccionada (evita re-cotizar)', () => {
  const r = restaurarEnvioDesdeCotizacion({ opcion: 'envia', carrier: 'fedex', servicio: 'ground', precio: 259, descripcion: 'FedEx Ground' });
  assert.deepStrictEqual(r, {
    opcion: 'envia', mostrarEnvia: true, mostrarManual: false, cost: '259.00', desc: 'FedEx Ground', descuento: 0,
    enviaRateSeleccionado: { carrier: 'fedex', servicio: 'ground', desc: 'FedEx Ground', cost: 259 },
  });
});

test('#102-10: restaurarEnvioDesdeCotizacion con opcion desconocida -> degrada a none (no rompe)', () => {
  const r = restaurarEnvioDesdeCotizacion({ opcion: 'algo-viejo-invalido', precio: 100 });
  assert.strictEqual(r.opcion, 'none');
  assert.strictEqual(r.enviaRateSeleccionado, null);
});

test('#102-11: debeAutoCotizarEnvia -- envia sin rate previa y carrito con productos -> SI auto-cotiza', () => {
  assert.strictEqual(debeAutoCotizarEnvia('envia', 3, null), true);
});

test('#102-12: debeAutoCotizarEnvia -- ya hay un envio elegido (restaurado del historial) -> NO re-dispara envia.com', () => {
  assert.strictEqual(debeAutoCotizarEnvia('envia', 3, { carrier: 'fedex', servicio: 'ground', desc: 'FedEx Ground', cost: 259 }), false);
});

test('#102-13: debeAutoCotizarEnvia -- carrito vacio -> no auto-cotiza', () => {
  assert.strictEqual(debeAutoCotizarEnvia('envia', 0, null), false);
});

test('#102-14: debeAutoCotizarEnvia -- opcion manual o none -> nunca auto-cotiza envia.com', () => {
  assert.strictEqual(debeAutoCotizarEnvia('manual', 3, null), false);
  assert.strictEqual(debeAutoCotizarEnvia('none', 3, null), false);
});

// === #102 (hallazgo del code review): sin esta tarjeta, el tab Envio se veia
// vacio para un envio via envia.com restaurado del historial -- los valores
// quedaban bien en shipping-cost/shipping-desc (ocultos dentro de #shipping-manual,
// no visible cuando opcion es 'envia') pero el vendedor no tenia confirmacion
// visual y podia pulsar "Cotizar" de nuevo, perdiendo la restauracion.
test('#102-15: buildEnviaRateRestauradaHtml muestra carrier/servicio/precio formateados', () => {
  const html = buildEnviaRateRestauradaHtml({ carrier: 'fedex', servicio: 'ground', precio: 259 });
  assert.ok(html.includes('FedEx'));
  assert.ok(html.includes('Ground'));
  assert.ok(html.includes('259.00'));
  assert.ok(html.includes('envia-rate-card'));
  assert.ok(html.includes('selected'));
});

// === #135 (prefactor de #134): builder unico del payload de items (articulos,
// calcas y envio) y de los totales -- antes generatePDF y generateHTML en app.js
// duplicaban linea a linea el mapeo carrito->items, el push condicional de ENVIO
// y el calculo de subtotal/iva/total. Cero cambio de comportamiento: mismos
// documentos, mismos payloads.
test('#135-1: nombreVisibleProducto quita el prefijo de SKU (2-3 letras + 2 digitos + espacio)', () => {
  assert.strictEqual(nombreVisibleProducto('CAL10 Producto decorado'), 'Producto decorado');
  assert.strictEqual(nombreVisibleProducto('AB12 Olla peltre'), 'Olla peltre');
});

test('#135-2: nombreVisibleProducto sin prefijo reconocible se deja igual', () => {
  assert.strictEqual(nombreVisibleProducto('Olla peltre'), 'Olla peltre');
});

test('#135-3: nombreVisibleProducto vacio/nulo -> cadena vacia', () => {
  assert.strictEqual(nombreVisibleProducto(''), '');
  assert.strictEqual(nombreVisibleProducto(null), '');
  assert.strictEqual(nombreVisibleProducto(undefined), '');
});

test('#135-4: buildItemEnvio con costo > 0 (manual) -> partida ENVIO, unidad ACT', () => {
  const r = buildItemEnvio({ shippingOpt: 'manual', shippingCost: 150, shippingDesc: 'Paquete propio' });
  assert.deepStrictEqual(r, {
    codigo: 'ENVIO', descripcion: 'Paquete propio', cantidad: 1, unidad: 'ACT', precio: 150, descuento: 0,
  });
});

test('#135-5: buildItemEnvio sin descripcion capturada -> descripcion default "Envio"', () => {
  const r = buildItemEnvio({ shippingOpt: 'envia', shippingCost: 259, shippingDesc: '' });
  assert.strictEqual(r.descripcion, 'Envio');
});

test('#135-6: buildItemEnvio con costo 0 o negativo -> null (nada que agregar)', () => {
  assert.strictEqual(buildItemEnvio({ shippingOpt: 'manual', shippingCost: 0, shippingDesc: 'Envio' }), null);
  assert.strictEqual(buildItemEnvio({ shippingOpt: 'manual', shippingCost: -10, shippingDesc: 'Envio' }), null);
});

test('#135-7: buildItemEnvio con shippingOpt none -> null aunque haya costo capturado', () => {
  assert.strictEqual(buildItemEnvio({ shippingOpt: 'none', shippingCost: 150, shippingDesc: 'Envio' }), null);
});

test('#135-8: calcularTotalesItems suma cantidad*precio con descuento por linea, IVA 16%', () => {
  const r = calcularTotalesItems([
    { cantidad: 2, precio: 100, descuento: 0 },
    { cantidad: 1, precio: 50, descuento: 10 },
  ]);
  assert.strictEqual(r.subtotal, 245);
  assert.ok(Math.abs(r.iva - 39.2) < 1e-9);
  assert.ok(Math.abs(r.total - 284.2) < 1e-9);
});

test('#135-9: calcularTotalesItems con arreglo vacio -> todo en cero', () => {
  assert.deepStrictEqual(calcularTotalesItems([]), { subtotal: 0, iva: 0, total: 0 });
});

test('#135-10: buildItemsYTotales arma articulos + calca + envio y sus totales, en el orden del carrito', () => {
  const cartEntries = [
    { codigo: 'AB12', nombre: 'AB12 Olla peltre', cantidad: 3, precio: 100 },
    { codigo: 'CAL10', nombre: 'CAL10 Calca logo', cantidad: 3, precio: 20 },
  ];
  const r = buildItemsYTotales(cartEntries, { shippingOpt: 'manual', shippingCost: 150, shippingDesc: 'Paquete propio' });
  assert.deepStrictEqual(r.items, [
    { codigo: 'AB12', descripcion: 'Olla peltre', cantidad: 3, unidad: 'pza', precio: 100, descuento: 0 },
    { codigo: 'CAL10', descripcion: 'Calca logo', cantidad: 3, unidad: 'pza', precio: 20, descuento: 0 },
    { codigo: 'ENVIO', descripcion: 'Paquete propio', cantidad: 1, unidad: 'ACT', precio: 150, descuento: 0 },
  ]);
  assert.strictEqual(r.subtotal, 510);
  assert.ok(Math.abs(r.iva - 81.6) < 1e-9);
  assert.ok(Math.abs(r.total - 591.6) < 1e-9);
});

test('#135-11: buildItemsYTotales sin envio (opcion none) -> items solo del carrito', () => {
  const cartEntries = [{ codigo: 'AB12', nombre: 'AB12 Olla peltre', cantidad: 1, precio: 100 }];
  const r = buildItemsYTotales(cartEntries, { shippingOpt: 'none', shippingCost: 0, shippingDesc: '' });
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(r.subtotal, 100);
});

test('#135-12: buildItemsYTotales con carrito vacio y sin envio -> items vacio, totales en cero', () => {
  const r = buildItemsYTotales([], { shippingOpt: 'none', shippingCost: 0, shippingDesc: '' });
  assert.deepStrictEqual(r.items, []);
  assert.deepStrictEqual({ subtotal: r.subtotal, iva: r.iva, total: r.total }, { subtotal: 0, iva: 0, total: 0 });
});

// === #137: el descuento por linea viaja del carrito al documento y a Operam ===
test('#137-1: buildItemsYTotales conserva el descuento de cada entrada del carrito', () => {
  const cartEntries = [
    { codigo: 'AB12', nombre: 'AB12 Olla peltre', cantidad: 3, precio: 100, descuento: 10 },
    { codigo: 'CAL10', nombre: 'CAL10 Calca logo', cantidad: 3, precio: 20, descuento: 25 },
  ];
  const r = buildItemsYTotales(cartEntries, { shippingOpt: 'none', shippingCost: 0, shippingDesc: '' });
  assert.strictEqual(r.items[0].descuento, 10);
  assert.strictEqual(r.items[1].descuento, 25);
  // 3*100*0.9 + 3*20*0.75 = 270 + 45
  assert.strictEqual(r.subtotal, 315);
});

test('#137-2: entrada sin descuento -> 0 (el carrito viejo no cambia de comportamiento)', () => {
  const r = buildItemsYTotales([{ codigo: 'AB12', nombre: 'Olla', cantidad: 1, precio: 100 }],
    { shippingOpt: 'none', shippingCost: 0, shippingDesc: '' });
  assert.strictEqual(r.items[0].descuento, 0);
});

test('#137-3: la partida ENVIO lleva su propio descuento', () => {
  const envio = { shippingOpt: 'envia', shippingCost: 500, shippingDesc: 'FedEx', shippingDescuento: 40 };
  assert.strictEqual(buildItemEnvio(envio).descuento, 40);
  const r = buildItemsYTotales([{ codigo: 'AB12', nombre: 'Olla', cantidad: 1, precio: 100 }], envio);
  // 100 + 500*0.6
  assert.strictEqual(r.subtotal, 400);
});

test('#137-4: envio sin descuento capturado -> 0', () => {
  assert.strictEqual(buildItemEnvio({ shippingOpt: 'manual', shippingCost: 150, shippingDesc: 'Envio' }).descuento, 0);
});

// === #139: la descripcion que escribe el vendedor es la que ve el cliente ===
test('#139-1: buildItemsYTotales manda la descripcion editada en vez de la del catalogo', () => {
  const cartEntries = [
    { codigo: 'AB12', nombre: 'AB12 Olla peltre', cantidad: 1, precio: 100, descripcion: 'Olla 20 cm esmaltada a mano' },
  ];
  const r = buildItemsYTotales(cartEntries, { shippingOpt: 'none', shippingCost: 0, shippingDesc: '' });
  assert.strictEqual(r.items[0].descripcion, 'Olla 20 cm esmaltada a mano');
  // La marca viaja con la partida: es lo que hace que al actualizar el quote de
  // Operam se re-escriba la descripcion en vez de dejar la del catalogo.
  assert.strictEqual(r.items[0].descripcionEditada, true);
});

test('#139-2: sin descripcion capturada manda la del catalogo y no marca nada', () => {
  const r = buildItemsYTotales([{ codigo: 'AB12', nombre: 'AB12 Olla peltre', cantidad: 1, precio: 100 }],
    { shippingOpt: 'none', shippingCost: 0, shippingDesc: '' });
  assert.strictEqual(r.items[0].descripcion, 'Olla peltre');
  assert.strictEqual(r.items[0].descripcionEditada, undefined);
});

test('#137-5: importeLinea es la unica formula de importe neto de una partida', () => {
  assert.strictEqual(importeLinea({ cantidad: 3, precio: 100, descuento: 10 }), 270);
  assert.strictEqual(importeLinea({ cantidad: 2, precio: 50 }), 100);
  assert.strictEqual(importeLinea({ cantidad: 1, precio: 100, descuento: 100 }), 0);
});

// El envio estructurado es lo que permite restaurar la seleccion al Cargar del
// historial (#102): sin el descuento ahi, regenerar perderia la bonificacion.
test('#137-6: buildEnvioEstructurado persiste el descuento del envio', () => {
  const r = buildEnvioEstructurado({
    shippingOpt: 'envia', shippingCost: 500, shippingDesc: 'FedEx', shippingDescuento: 40,
    enviaRateSeleccionado: { carrier: 'fedex', servicio: 'ground' },
  });
  assert.strictEqual(r.descuento, 40);
});

test('#137-7: restaurarEnvioDesdeCotizacion devuelve el descuento guardado', () => {
  const r = restaurarEnvioDesdeCotizacion({ opcion: 'envia', carrier: 'fedex', servicio: 'ground', precio: 500, descuento: 40 });
  assert.strictEqual(r.descuento, 40);
});

test('#137-8: cotizacion vieja sin descuento de envio -> 0', () => {
  assert.strictEqual(restaurarEnvioDesdeCotizacion({ opcion: 'manual', precio: 150 }).descuento, 0);
  assert.strictEqual(restaurarEnvioDesdeCotizacion(null).descuento, 0);
});
