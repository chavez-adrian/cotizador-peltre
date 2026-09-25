'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let validarDomicilioEntrega, formatCarrier, formatServicio, cpValido, buildConfirmarVendedorModalHtml;
let sincronizarCorreoFactura;
let debeInvalidarEnvioPorCantidad, bloqueaGeneracionPorEnvioInvalidado, MENSAJE_ENVIO_INVALIDADO;
let notaTiempoEntrega, aplicarNotaTiempoEntrega, formatTiempoEntrega, formatDescripcionEnvioEnvia;
let notaPreciosEnvio, aplicarNotaEnvio, cotizacionLlevaEnvio;
let buildEnvioEstructurado, restaurarEnvioDesdeCotizacion, debeAutoCotizarEnvia, buildEnviaRateRestauradaHtml;
let debeProponerEnvia, cpListoParaCotizarEnvia, avisoEnvioPasoCotizacion, pasoEnvioListo;
let envioTrasCambioDeCp;
let nombreVisibleProducto, buildItemEnvio, calcularTotalesItems, buildItemsYTotales, importeLinea;
let importeLineaOAusente, textoImporteLinea, AUSENCIA_IMPORTE, subtotalLineas;
let fechaEmisionHoy, sumarDiasFecha, contenidoTarjeta, esOpcionTarifa, endpointTarifas, OPCIONES_TARIFA;
before(async () => {
  ({
    validarDomicilioEntrega, formatCarrier, formatServicio, cpValido, buildConfirmarVendedorModalHtml,
    debeInvalidarEnvioPorCantidad, bloqueaGeneracionPorEnvioInvalidado, MENSAJE_ENVIO_INVALIDADO,
    notaTiempoEntrega, aplicarNotaTiempoEntrega, formatTiempoEntrega, formatDescripcionEnvioEnvia,
    notaPreciosEnvio, aplicarNotaEnvio, cotizacionLlevaEnvio,
    buildEnvioEstructurado, restaurarEnvioDesdeCotizacion, debeAutoCotizarEnvia, buildEnviaRateRestauradaHtml,
    debeProponerEnvia, cpListoParaCotizarEnvia, avisoEnvioPasoCotizacion, pasoEnvioListo,
    envioTrasCambioDeCp,
    nombreVisibleProducto, buildItemEnvio, calcularTotalesItems, buildItemsYTotales, importeLinea,
    importeLineaOAusente, textoImporteLinea, AUSENCIA_IMPORTE, subtotalLineas,
    fechaEmisionHoy, sumarDiasFecha, contenidoTarjeta, esOpcionTarifa, endpointTarifas, OPCIONES_TARIFA,
    sincronizarCorreoFactura,
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

// #72: la tarjeta de Lalamove (lib/lalamove-logica.js) llega con la forma de
// envia.com; su serviceDescription es la descripcion de la partida, que es la
// que operam-client.js reconoce como Lalamove para mandarla como flete local.
test('#72: tarjeta Lalamove -> carrier presentable y descripcion con el vehiculo', () => {
  const rate = { carrier: 'lalamove', service: 'Van', serviceDescription: 'Lalamove Van (hasta 1000 kg)', totalPrice: 629.76 };
  assert.strictEqual(formatCarrier(rate.carrier), 'Lalamove');
  assert.strictEqual(formatDescripcionEnvioEnvia(rate), 'Lalamove Van (hasta 1000 kg)');
});

// #72: el selector ya dice que se cotiza Lalamove, asi que su tarjeta no repite
// la marca: el titulo es el vehiculo (sin el Title Case que daba "Suv") y el
// detalle, su carga y medidas maximas. La de paqueteria no cambia.
test('#72: contenidoTarjeta de Lalamove = vehiculo + carga y medidas maximas', () => {
  assert.deepStrictEqual(contenidoTarjeta({ carrier: 'lalamove', service: 'Camion', cargaKg: 1000, medidasCm: [200, 200, 170] }),
    { titulo: 'Camion', detalle: 'Hasta 1,000 kg · 200 x 200 x 170 cm' });
  assert.deepStrictEqual(contenidoTarjeta({ carrier: 'lalamove', service: 'SUV', cargaKg: 300, medidasCm: null }),
    { titulo: 'SUV', detalle: 'Hasta 300 kg' });
  assert.deepStrictEqual(contenidoTarjeta({ carrier: 'lalamove', service: 'Van' }), { titulo: 'Van', detalle: '' });
});

test('#72: contenidoTarjeta de paqueteria = carrier + servicio y tiempo, como antes', () => {
  assert.deepStrictEqual(contenidoTarjeta({ carrier: 'fedex', service: 'ground', deliveryEstimate: '1-2 días' }),
    { titulo: 'FedEx', detalle: 'Ground · 1-2 días' });
  assert.deepStrictEqual(contenidoTarjeta({ carrier: 'dhl', serviceType: 'express' }), { titulo: 'DHL', detalle: 'Express' });
});

// #72: "Cotizar con Lalamove" es una opcion propia del selector; comparte con
// envia.com todo lo de las tarjetas de tarifa y solo cambia el endpoint.
test('#72: esOpcionTarifa y endpointTarifas', () => {
  assert.strictEqual(esOpcionTarifa('envia'), true);
  assert.strictEqual(esOpcionTarifa('lalamove'), true);
  assert.strictEqual(esOpcionTarifa('manual'), false);
  assert.strictEqual(esOpcionTarifa('none'), false);
  assert.strictEqual(endpointTarifas('envia'), '/api/cotizacion/envio');
  assert.strictEqual(endpointTarifas('lalamove'), '/api/cotizacion/envio/lalamove');
});

test('#72: una tarifa de Lalamove se persiste, se restaura, se invalida y entra al documento', () => {
  const rate = { carrier: 'lalamove', servicio: 'Van', desc: 'Lalamove Van (hasta 1000 kg)', cost: 984.23 };
  const envio = buildEnvioEstructurado({ shippingOpt: 'lalamove', shippingCost: 984.23, shippingDesc: rate.desc, shippingDescuento: 0, enviaRateSeleccionado: rate });
  assert.deepStrictEqual(envio, { opcion: 'lalamove', carrier: 'lalamove', servicio: 'Van', precio: 984.23, descripcion: rate.desc, descuento: 0 });
  const r = restaurarEnvioDesdeCotizacion(envio);
  assert.strictEqual(r.opcion, 'lalamove');
  assert.strictEqual(r.mostrarEnvia, true);
  assert.strictEqual(r.enviaRateSeleccionado.carrier, 'lalamove');
  assert.strictEqual(debeInvalidarEnvioPorCantidad('lalamove', rate), true);
  assert.strictEqual(debeAutoCotizarEnvia('lalamove', 3, null), true);
  assert.deepStrictEqual(buildItemEnvio({ shippingOpt: 'lalamove', shippingCost: 984.23, shippingDesc: rate.desc, shippingDescuento: 0 }),
    { codigo: 'ENVIO', descripcion: rate.desc, cantidad: 1, unidad: 'ACT', precio: 984.23, descuento: 0 });
});

// #437: "Cotizar con Tresguerras" es la tercera opcion con tarjetas; solo cambia
// el endpoint. La tarjeta (lib/tresguerras-logica.js) llega con el desglose de la
// cotizacion puerta a puerta medida en vivo (56577 -> 64000, $3,930.95).
test('#437: esOpcionTarifa y endpointTarifas de Tresguerras', () => {
  assert.strictEqual(esOpcionTarifa('tresguerras'), true);
  assert.strictEqual(endpointTarifas('tresguerras'), '/api/cotizacion/envio/tresguerras');
  assert.strictEqual(endpointTarifas('lalamove'), '/api/cotizacion/envio/lalamove');
  assert.strictEqual(endpointTarifas('envia'), '/api/cotizacion/envio');
});

test('#437: contenidoTarjeta de Tresguerras = "Puerta a puerta" y en gris que es tarifa estimada, transito y desglose', () => {
  const rate = { carrier: 'tresguerras', service: 'Puerta a puerta', totalPrice: 3930.95, days: 1,
    desglose: { flete: 1706.34, recoleccion: 783.32, entrega: 783.32, seguro: 100 } };
  assert.deepStrictEqual(contenidoTarjeta(rate), {
    titulo: 'Puerta a puerta',
    detalle: 'Tarifa estimada \u00b7 1 d\u00eda h\u00e1bil de tr\u00e1nsito \u00b7 Flete $1,706.34 \u00b7 Recolecci\u00f3n $783.32 \u00b7 Entrega $783.32 \u00b7 Seguro $100.00',
  });
  assert.strictEqual(contenidoTarjeta({ ...rate, days: 5, desglose: null }).detalle,
    'Tarifa estimada \u00b7 5 d\u00edas h\u00e1biles de tr\u00e1nsito');
  assert.deepStrictEqual(contenidoTarjeta({ carrier: 'tresguerras', service: 'Puerta a puerta' }),
    { titulo: 'Puerta a puerta', detalle: 'Tarifa estimada' });
});

test('#437: una tarifa de Tresguerras se persiste, se restaura, se invalida y entra al documento como partida de envio', () => {
  const tarjeta = { carrier: 'tresguerras', service: 'Puerta a puerta', serviceDescription: 'Tresguerras puerta a puerta', totalPrice: 3930.95, days: 5 };
  assert.strictEqual(formatDescripcionEnvioEnvia(tarjeta), 'Tresguerras puerta a puerta \u2014 entrega estimada 5 d\u00edas h\u00e1biles');
  const rate = { carrier: 'tresguerras', servicio: 'Puerta a puerta', desc: formatDescripcionEnvioEnvia(tarjeta), cost: 3930.95 };
  const envio = buildEnvioEstructurado({ shippingOpt: 'tresguerras', shippingCost: 3930.95, shippingDesc: rate.desc, shippingDescuento: 0, enviaRateSeleccionado: rate });
  assert.deepStrictEqual(envio, { opcion: 'tresguerras', carrier: 'tresguerras', servicio: 'Puerta a puerta', precio: 3930.95, descripcion: rate.desc, descuento: 0 });
  const r = restaurarEnvioDesdeCotizacion(envio);
  assert.strictEqual(r.opcion, 'tresguerras');
  assert.strictEqual(r.mostrarEnvia, true);
  assert.strictEqual(r.cost, '3930.95');
  assert.strictEqual(r.enviaRateSeleccionado.carrier, 'tresguerras');
  assert.strictEqual(debeInvalidarEnvioPorCantidad('tresguerras', rate), true);
  assert.strictEqual(debeAutoCotizarEnvia('tresguerras', 3, null), true);
  assert.strictEqual(cotizacionLlevaEnvio('tresguerras', '3930.95'), true);
  assert.deepStrictEqual(buildItemEnvio({ shippingOpt: 'tresguerras', shippingCost: 3930.95, shippingDesc: rate.desc, shippingDescuento: 0 }),
    { codigo: 'ENVIO', descripcion: rate.desc, cantidad: 1, unidad: 'ACT', precio: 3930.95, descuento: 0 });
  const html = buildEnviaRateRestauradaHtml({ carrier: 'tresguerras', servicio: 'Puerta a puerta', cost: 3930.95 });
  assert.match(html, /envia-rate-carrier">Puerta a puerta</);
  assert.match(html, /envia-rate-servicio">Tarifa estimada</);
});

test('#437: el selector de envio ofrece Tresguerras y cada opcion con tarjetas de tarifa', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  const m = html.match(/<select id="shipping-option">([\s\S]*?)<\/select>/);
  assert.ok(m, 'falta #shipping-option');
  const opciones = [...m[1].matchAll(/<option value="([^"]+)">([^<]*)<\/option>/g)].map(x => [x[1], x[2]]);
  for (const op of OPCIONES_TARIFA) assert.ok(opciones.some(([v]) => v === op), `falta la opcion ${op}`);
  assert.deepStrictEqual(opciones.find(([v]) => v === 'tresguerras'), ['tresguerras', 'Cotizar con Tresguerras (carga consolidada)']);
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

// === #436: la nota de precios dice "No incluye envio." solo sin envio con costo ===
test('#436-1: notaPreciosEnvio -- con envio conserva EXW y quita "No incluye envio."; sin envio la lleva', () => {
  assert.strictEqual(notaPreciosEnvio(true), '- Precios EXW Ixtapaluca, Estado de Mexico.');
  assert.strictEqual(notaPreciosEnvio(false), '- Precios EXW Ixtapaluca, Estado de Mexico. No incluye envio.');
});

const NOTAS_CON_ENVIO = `- Precios EXW Ixtapaluca, Estado de Mexico.
- Envio a costo y riesgo del cliente.
- Tiempo de entrega: 4 semanas contadas a partir del pago del anticipo.
- Se requiere 50% de anticipo para comenzar la produccion.
- Pago del saldo previo a la entrega.`;

test('#436-2: aplicarNotaEnvio con envio quita "No incluye envio." y deja identico el resto (incluida la de costo y riesgo)', () => {
  assert.strictEqual(aplicarNotaEnvio(NOTAS_DEFAULT_4, true), NOTAS_CON_ENVIO);
});

test('#436-3: aplicarNotaEnvio sin envio repone "No incluye envio." y deja identico el resto', () => {
  assert.strictEqual(aplicarNotaEnvio(NOTAS_CON_ENVIO, false), NOTAS_DEFAULT_4);
});

test('#436-4: aplicarNotaEnvio es estable: repetir el mismo estado no cambia nada', () => {
  assert.strictEqual(aplicarNotaEnvio(NOTAS_CON_ENVIO, true), NOTAS_CON_ENVIO);
  assert.strictEqual(aplicarNotaEnvio(NOTAS_DEFAULT_4, false), NOTAS_DEFAULT_4);
});

test('#436-5: si el vendedor edito la linea de precios a mano, no se pisa en ningun sentido', () => {
  const editadas = NOTAS_DEFAULT_4.replace(
    '- Precios EXW Ixtapaluca, Estado de Mexico. No incluye envio.',
    '- Precios LAB Ixtapaluca. Flete por cuenta del cliente.'
  );
  assert.strictEqual(aplicarNotaEnvio(editadas, true), editadas);
  assert.strictEqual(aplicarNotaEnvio(editadas, false), editadas);
});

test('#436-6: si el vendedor borro la linea de precios, no se vuelve a agregar', () => {
  const sinLinea = NOTAS_DEFAULT_4.split('\n').filter(l => !l.includes('Precios EXW')).join('\n');
  assert.strictEqual(aplicarNotaEnvio(sinLinea, true), sinLinea);
  assert.strictEqual(aplicarNotaEnvio(sinLinea, false), sinLinea);
});

test('#436-7: la linea "Envio a costo y riesgo del cliente." sobrevive en los dos sentidos', () => {
  const costoYRiesgo = '- Envio a costo y riesgo del cliente.';
  assert.ok(aplicarNotaEnvio(NOTAS_DEFAULT_4, true).split('\n').includes(costoYRiesgo));
  assert.ok(aplicarNotaEnvio(NOTAS_CON_ENVIO, false).split('\n').includes(costoYRiesgo));
});

test('#436-8: cotizacionLlevaEnvio -- paqueteria, Lalamove o manual con costo > 0 llevan envio (quote 1296: Lalamove $359.90)', () => {
  assert.strictEqual(cotizacionLlevaEnvio('envia', 259), true);
  assert.strictEqual(cotizacionLlevaEnvio('lalamove', '359.90'), true);
  assert.strictEqual(cotizacionLlevaEnvio('manual', '150'), true);
});

test('#436-9: cotizacionLlevaEnvio -- Sin envio, sin tarifa elegida o costo 0 no llevan envio', () => {
  assert.strictEqual(cotizacionLlevaEnvio('none', '500'), false);
  assert.strictEqual(cotizacionLlevaEnvio('envia', ''), false);
  assert.strictEqual(cotizacionLlevaEnvio('lalamove', ''), false);
  assert.strictEqual(cotizacionLlevaEnvio('manual', '0'), false);
  assert.strictEqual(cotizacionLlevaEnvio('manual', 'abc'), false);
  assert.strictEqual(cotizacionLlevaEnvio(undefined, 300), false);
});

test('#436-10: las notas por defecto del resumen nacen con la version sin envio, que es la que se ajusta sola', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  const m = html.match(/<textarea id="resumen-notas"[^>]*>([\s\S]*?)<\/textarea>/);
  assert.ok(m, 'falta #resumen-notas');
  const lineas = m[1].split(/\r?\n/).map(l => l.trim());
  assert.ok(lineas.includes('- Precios EXW Ixtapaluca, Estado de Mexico. No incluye envio.'));
  assert.ok(lineas.includes('- Envio a costo y riesgo del cliente.'));
  const conEnvio = aplicarNotaEnvio(m[1].replace(/\r\n/g, '\n'), true).split('\n');
  assert.ok(conEnvio.includes('- Precios EXW Ixtapaluca, Estado de Mexico.'));
  assert.ok(conEnvio.includes('- Envio a costo y riesgo del cliente.'));
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
  const html = buildEnviaRateRestauradaHtml({ carrier: 'fedex', servicio: 'ground', cost: 259 });
  assert.ok(html.includes('FedEx'));
  assert.ok(html.includes('Ground'));
  assert.ok(html.includes('259.00'));
  assert.ok(html.includes('envia-rate-card'));
  assert.ok(html.includes('selected'));
});

test('#72: la tarjeta restaurada de Lalamove lleva el vehiculo de titulo, sin repetir la marca', () => {
  const html = buildEnviaRateRestauradaHtml({ carrier: 'lalamove', servicio: 'Van', cost: 984.23 });
  assert.match(html, /envia-rate-carrier">Van</);
  assert.ok(!html.includes('Lalamove'));
  assert.ok(html.includes('984.23'));
});

// #444: la tarjeta restaurada en Editar/Copiar salia en $0.00 -- la restauracion
// deja el monto en `cost` (la forma de enviaRateSeleccionado) y la tarjeta lo
// buscaba en `precio`. Montos de las cotizaciones vistas en produccion.
test('#444: Editar/Copiar pintan en la tarjeta restaurada el mismo monto que la partida de envio', () => {
  const casos = [
    { opcion: 'tresguerras', carrier: 'tresguerras', servicio: 'Puerta a puerta', precio: 424.56, descripcion: 'Tresguerras puerta a puerta', monto: '$424.56' },
    { opcion: 'lalamove', carrier: 'lalamove', servicio: 'Hatchback', precio: 359.9, descripcion: 'Envio Lalamove Hatchback (hasta 100 kg)', monto: '$359.90' },
    { opcion: 'envia', carrier: 'fedex', servicio: 'ground', precio: 268, descripcion: 'FedEx Ground', monto: '$268.00' },
  ];
  for (const { monto, ...envio } of casos) {
    const r = restaurarEnvioDesdeCotizacion({ ...envio, descuento: 0 });
    const html = buildEnviaRateRestauradaHtml(r.enviaRateSeleccionado);
    assert.ok(html.includes(`envia-rate-precio">${monto}<`), `${envio.opcion}: ${html}`);
    assert.strictEqual(r.cost, monto.slice(1), envio.opcion);
  }
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

// === #279: el precio manual de calca es dato de la partida y tiene que llegar
// al payload -- sin el, el servidor no puede distinguir una captura de un
// precio de lista y los tickets siguientes (borrador, Editar/Copiar) no tienen
// de donde leerla. Sin captura la llave NO viaja, igual que la descripcion. ===
test('#279-1: buildItemsYTotales lleva el precio manual de la calca al payload', () => {
  const cartEntries = [
    { codigo: 'AB12', nombre: 'AB12 Olla peltre', cantidad: 3, precio: 100 },
    { codigo: 'CAL1050', nombre: 'CAL1050 Calca - Diseño 1', cantidad: 100, precio: 45, descuento: 10, diseno: 1, precioManual: 45 },
  ];
  const r = buildItemsYTotales(cartEntries, { shippingOpt: 'none', shippingCost: 0, shippingDesc: '' });
  assert.strictEqual(r.items[1].precioManual, 45);
  assert.strictEqual(r.items[1].precio, 45);
  // 3*100 + 100*45*0.9
  assert.strictEqual(r.subtotal, 4350);
});

test('#279-2: sin captura la partida no lleva la llave precioManual', () => {
  const cartEntries = [{ codigo: 'CAL1050', nombre: 'CAL1050 Calca - Diseño 1', cantidad: 100, precio: 29.66, diseno: 1 }];
  const r = buildItemsYTotales(cartEntries, { shippingOpt: 'none', shippingCost: 0, shippingDesc: '' });
  assert.strictEqual('precioManual' in r.items[0], false);
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

// === #220: dos diseños del mismo tipo de calca son dos partidas (spec #218) ===
// El carrito manda una entrada por diseño con su propio `diseno` y su nombre ya
// numerado; buildItemsYTotales no las fusiona y el `codigo` que persiste sigue
// siendo el del catalogo, para que piezasDeProducto y el empaque no cambien.
test('#220-12: dos entradas del mismo codigo producen dos items con su diseno y su texto', () => {
  const cartEntries = [
    { codigo: 'VA08B1A321124', nombre: 'Vaso peltre', cantidad: 200, precio: 50 },
    { codigo: 'CAL1025S', nombre: 'Calca chica - Diseño 1', cantidad: 100, precio: 26.9, diseno: 1 },
    { codigo: 'CAL1025S', nombre: 'Calca chica - Diseño 2', cantidad: 100, precio: 26.9, diseno: 2 },
  ];
  const r = buildItemsYTotales(cartEntries, { shippingOpt: 'none', shippingCost: 0, shippingDesc: '' });
  const calcas = r.items.filter(i => i.codigo === 'CAL1025S');
  assert.strictEqual(calcas.length, 2, 'las partidas del mismo codigo no se fusionan');
  assert.deepStrictEqual(calcas.map(i => i.diseno), [1, 2]);
  assert.deepStrictEqual(calcas.map(i => i.descripcion), ['Calca chica - Diseño 1', 'Calca chica - Diseño 2']);
  // 200*50 + 100*26.9 + 100*26.9
  assert.strictEqual(r.subtotal, 15380);
});

// La partida de diseño viaja SIEMPRE marcada como editada: al actualizar el
// quote por la web legacy, FrontAccounting impone el nombre del articulo del
// catalogo y borraria el "Diseño N" de las lineas que no entran a la ronda de
// reescritura por partida (#139).
test('#220-13: la partida de diseno sale marcada como descripcion editada', () => {
  const r = buildItemsYTotales([
    { codigo: 'CAL1025S', nombre: 'Calca chica - Diseño 1', cantidad: 100, precio: 26.9, diseno: 1 },
  ], { shippingOpt: 'none', shippingCost: 0, shippingDesc: '' });
  assert.strictEqual(r.items[0].descripcionEditada, true);
});

test('#220-14: la descripcion que escribio el vendedor manda sobre la del diseno', () => {
  const r = buildItemsYTotales([
    { codigo: 'CAL1025S', nombre: 'Calca chica - Diseño 2', cantidad: 100, precio: 26.9, diseno: 2, descripcion: 'Calca chica - Diseño 2: logo frontal' },
  ], { shippingOpt: 'none', shippingCost: 0, shippingDesc: '' });
  assert.strictEqual(r.items[0].descripcion, 'Calca chica - Diseño 2: logo frontal');
  assert.strictEqual(r.items[0].diseno, 2);
  assert.strictEqual(r.items[0].descripcionEditada, true);
});

test('#220-15: una entrada sin diseno no gana campos (el carrito de producto no cambia)', () => {
  const r = buildItemsYTotales([{ codigo: 'AB12', nombre: 'AB12 Olla peltre', cantidad: 1, precio: 100 }],
    { shippingOpt: 'none', shippingCost: 0, shippingDesc: '' });
  assert.strictEqual(r.items[0].diseno, undefined);
  assert.strictEqual(r.items[0].descripcionEditada, undefined);
});

// === #284: la fecha de emision es la del calendario del vendedor, no la de UTC ===
// El instante y la hora local salen de la evidencia del issue: 2026-09-01 19:07
// GMT-0600 = 2026-09-02T01:07:48Z. Armada en UTC, la cotizacion salia con fecha de
// manana y Operam la rechazaba (406: sin rate de moneda para esa fecha).

test('#284-1: a las 19:07 del centro de Mexico la fecha de emision sigue siendo la de hoy', () => {
  assert.strictEqual(fechaEmisionHoy(new Date('2026-09-02T01:07:48Z')), '2026-09-01');
});

test('#284-2: de dia la fecha de emision coincide con la de UTC', () => {
  assert.strictEqual(fechaEmisionHoy(new Date('2026-09-01T18:00:00Z')), '2026-09-01');
});

// Los bordes de la ventana rota: America/Mexico_City es UTC-6 fijo desde 2022 (sin
// horario de verano), asi que el dia local cambia a las 06:00Z en punto.
test('#284-3: un segundo antes de las 06:00Z sigue siendo el dia anterior', () => {
  assert.strictEqual(fechaEmisionHoy(new Date('2026-09-02T05:59:59Z')), '2026-09-01');
});

test('#284-4: a las 06:00Z ya es el dia nuevo', () => {
  assert.strictEqual(fechaEmisionHoy(new Date('2026-09-02T06:00:00Z')), '2026-09-02');
});

test('#284-5: el mes y el dia van a dos digitos', () => {
  assert.strictEqual(fechaEmisionHoy(new Date('2026-01-05T18:00:00Z')), '2026-01-05');
});

test('#284-6: la vigencia se deriva de la fecha de emision con aritmetica de fechas planas', () => {
  assert.strictEqual(sumarDiasFecha('2026-09-01', 30), '2026-10-01');
});

test('#284-7: sumarDiasFecha cruza fin de mes y fin de anio', () => {
  assert.strictEqual(sumarDiasFecha('2026-12-20', 30), '2027-01-19');
});

test('#284-8: sumarDiasFecha no arrastra la zona horaria de quien la corre', () => {
  // La fecha plana no es un instante: sumarle 0 dias tiene que devolverla igual.
  assert.strictEqual(sumarDiasFecha('2026-09-01', 0), '2026-09-01');
});

// === #290: checkbox "Usar el mismo correo de entrega" ===
test('#290-1: marcar el checkbox copia el correo de entrega al de factura', () => {
  const r = sincronizarCorreoFactura({ marcado: true, entrega: 'juan@ej.com', factura: '', evento: 'checkbox' });
  assert.deepStrictEqual(r, { marcado: true, factura: 'juan@ej.com' });
});

test('#290-2: marcar con correo de entrega vacio deja la factura vacia', () => {
  const r = sincronizarCorreoFactura({ marcado: true, entrega: '', factura: 'previo@ej.com', evento: 'checkbox' });
  assert.deepStrictEqual(r, { marcado: true, factura: '' });
});

test('#290-3: con el checkbox marcado, cambiar el correo de entrega actualiza el de factura', () => {
  const r = sincronizarCorreoFactura({ marcado: true, entrega: 'nuevo@ej.com', factura: 'juan@ej.com', evento: 'entrega' });
  assert.deepStrictEqual(r, { marcado: true, factura: 'nuevo@ej.com' });
});

test('#290-4: con el checkbox desmarcado, cambiar el correo de entrega NO toca el de factura', () => {
  const r = sincronizarCorreoFactura({ marcado: false, entrega: 'nuevo@ej.com', factura: 'propio@ej.com', evento: 'entrega' });
  assert.deepStrictEqual(r, { marcado: false, factura: 'propio@ej.com' });
});

test('#290-5: desmarcar deja el campo de factura editable con su valor actual', () => {
  const r = sincronizarCorreoFactura({ marcado: false, entrega: 'juan@ej.com', factura: 'juan@ej.com', evento: 'checkbox' });
  assert.deepStrictEqual(r, { marcado: false, factura: 'juan@ej.com' });
});

test('#290-6: editar a mano el correo de factura desmarca el checkbox y conserva lo escrito', () => {
  const r = sincronizarCorreoFactura({ marcado: true, entrega: 'juan@ej.com', factura: 'editado@ej.com', evento: 'factura' });
  assert.deepStrictEqual(r, { marcado: false, factura: 'editado@ej.com' });
});

test('#290-7: editar el correo de factura sin estar marcado no cambia nada de estado', () => {
  const r = sincronizarCorreoFactura({ marcado: false, entrega: 'juan@ej.com', factura: 'libre@ej.com', evento: 'factura' });
  assert.deepStrictEqual(r, { marcado: false, factura: 'libre@ej.com' });
});

// === #413: una partida sin precio no tiene importe (null, nunca 0) ===
// Medido en produccion (HITL de #402 y de #299): el paso Cotizacion pintaba
// "CAL1025S - sin precio ... $0.00" en el MISMO renglon donde el detalle decia
// que no hay precio, porque el importe se calculaba con un `?? 0` aparte. Es la
// forma que #91 prohibio, sobreviviendo en la pantalla del resumen.
test('#413-1: sin precio la linea no tiene importe: null, nunca 0', () => {
  assert.strictEqual(importeLineaOAusente({ cantidad: 100, precio: null, descuento: 0 }), null);
});

test('#413-2: una partida que ni siquiera trae la llave precio tampoco tiene importe', () => {
  assert.strictEqual(importeLineaOAusente({ cantidad: 100 }), null);
});

test('#413-3: con precio capturado el importe es el de siempre', () => {
  // CAL1050 con precio manual capturado (#281, la salida legitima de esa linea).
  assert.strictEqual(importeLineaOAusente({ cantidad: 100, precio: 12, descuento: 0 }), 1200);
  assert.strictEqual(importeLineaOAusente({ cantidad: 3, precio: 100, descuento: 10 }), 270);
});

test('#413-4: un precio de cero SI es precio: importe 0, no ausencia', () => {
  assert.strictEqual(importeLineaOAusente({ cantidad: 5, precio: 0, descuento: 0 }), 0);
});

// El renglon de las DOS pantallas se pinta con el mismo texto: el paso Productos
// ya decia la ausencia con el guion largo y el paso Cotizacion tiene que decir
// exactamente eso, no un importe de dinero.
test('#413-5: el importe ausente se pinta con la misma ausencia del paso Productos', () => {
  assert.strictEqual(AUSENCIA_IMPORTE, '&mdash;');
  assert.strictEqual(textoImporteLinea(null, n => n.toFixed(2)), AUSENCIA_IMPORTE);
});

test('#413-6: con importe el texto lleva el signo de pesos y el formato que recibe', () => {
  assert.strictEqual(textoImporteLinea(1200, n => n.toFixed(2)), '$1200.00');
  assert.strictEqual(textoImporteLinea(0, n => n.toFixed(2)), '$0.00');
});

// El subtotal NUNCA mintio (medido en el HITL de #402: $1,210.67 = 10.67 +
// 1,200, sin aportar nada la calca sin precio); lo que mentia era el renglon.
// Sumar la ausencia como 0 es lo que mantiene ese numero igual al de hoy.
test('#413-7: la partida sin precio no aporta al subtotal', () => {
  const lineas = [
    { cantidad: 1, precio: 10.67, descuento: 0 },
    { cantidad: 100, precio: 12, descuento: 0 },
    { cantidad: 100, precio: null, descuento: 0 },
  ];
  assert.strictEqual(subtotalLineas(lineas), 1210.67);
  assert.strictEqual(subtotalLineas(lineas.slice(0, 2)), subtotalLineas(lineas));
});

test('#413-8: subtotalLineas respeta el descuento por partida y el carrito vacio', () => {
  assert.strictEqual(subtotalLineas([{ cantidad: 3, precio: 100, descuento: 10 }]), 270);
  assert.strictEqual(subtotalLineas([]), 0);
});

// === #419: "Sin envio" es una eleccion, no la ausencia de una ===
// Hasta #418, al pintar el tab Envio se forzaba la opcion a envia.com con solo
// ver 'none' + CP + carrito, y de paso se disparaba una consulta de tarifas. Pero
// 'none' es a la vez el default de una cotizacion nueva y el "Sin envio" que el
// vendedor acaba de elegir: en el HITL de #415 hubo que volver a elegirlo tres
// veces en la misma cotizacion. Lo que faltaba no era una opcion, era saber si
// ya hubo DECISION. Hermana de debeAutoCotizarEnvia un escalon antes: aquella
// decide si CONSULTAR tarifas, esta si cambiarle la opcion al vendedor.
test('#419-1: nadie decidio todavia + CP de entrega valido + carrito con partidas -> se propone envia.com', () => {
  assert.strictEqual(debeProponerEnvia({ envioDecidido: false, shippingOpt: 'none', cp: '56577', cartSize: 3 }), true);
});

test('#419-2: con la decision tomada no se propone nada, sea cual sea la opcion vigente', () => {
  for (const shippingOpt of ['none', 'envia', 'manual']) {
    assert.strictEqual(debeProponerEnvia({ envioDecidido: true, shippingOpt, cp: '56577', cartSize: 3 }), false, shippingOpt);
  }
});

test('#419-3: sin CP de entrega de 5 digitos no se propone envia.com', () => {
  for (const cp of ['', '5657', 'K1A 0A9', undefined, null]) {
    assert.strictEqual(debeProponerEnvia({ envioDecidido: false, shippingOpt: 'none', cp, cartSize: 3 }), false, String(cp));
  }
});

test('#419-4: carrito vacio -> no se propone envia.com', () => {
  assert.strictEqual(debeProponerEnvia({ envioDecidido: false, shippingOpt: 'none', cp: '56577', cartSize: 0 }), false);
});

// El borrador de sesion restaura la opcion tal cual pero NO la decision (queda
// declarado como fuera de alcance en #419): si lo restaurado ya es envia.com o
// manual no hay nada que proponer, la propuesta solo existe para salir de 'none'.
test('#419-5: con una opcion ya puesta distinta de "Sin envio" no hay nada que proponer', () => {
  assert.strictEqual(debeProponerEnvia({ envioDecidido: false, shippingOpt: 'envia', cp: '56577', cartSize: 3 }), false);
  assert.strictEqual(debeProponerEnvia({ envioDecidido: false, shippingOpt: 'manual', cp: '56577', cartSize: 3 }), false);
});

// El mismo CP habilita la propuesta y el auto-cotizado que dispara switchTab; el
// segundo lo evalua app.js, que no es importable en Node. Vive en el nucleo para
// que la regla se pruebe una vez y no haya una copia espejo en el manejador.
test('#419-6: cpListoParaCotizarEnvia es la regla MX de 5 digitos, y tolera la ausencia de CP', () => {
  assert.strictEqual(cpListoParaCotizarEnvia('56577'), true);
  for (const cp of ['', '5657', '565778', 'K1A 0A9', undefined, null]) {
    assert.strictEqual(cpListoParaCotizarEnvia(cp), false, String(cp));
  }
});

// === #420: el paso Cotizacion deja de pedir envio cuando ya se decidio que no hay ===
// HITL de #415 (cotizacion 1292): con "Sin envio" elegido a proposito el paso
// Cotizacion seguia diciendo "Recuerda cotizar el envio", porque lo decidia una
// comparacion en linea contra 'none' -- que es tambien el default que nadie toco.
// La entrada que las distingue es la misma de #419: envioDecidido.
test('#420-1: nadie decidio el envio -> advertencia de pendiente con el texto de hoy', () => {
  assert.deepStrictEqual(avisoEnvioPasoCotizacion({ shippingOpt: 'none', envioDecidido: false }), {
    veredicto: 'pendiente',
    texto: 'Recuerda cotizar el envio antes de generar el PDF. Revisa el tab Envio.',
  });
});

// "Sin envio" elegido es una decision valida (el cliente recoge o arregla el
// envio): no falta nada, asi que el paso lo declara en vez de pedirlo.
test('#420-2: "Sin envio" elegido a proposito -> linea de decision tomada, no la advertencia', () => {
  assert.deepStrictEqual(avisoEnvioPasoCotizacion({ shippingOpt: 'none', envioDecidido: true }), {
    veredicto: 'decidido',
    texto: 'Sin envio: el cliente recoge o arregla el envio',
  });
});

// Con paqueteria o costo manual el envio ya esta en los totales: no hay nada que
// pedir ni que declarar. Sin decision tambien: 'envia' sin decision es la
// propuesta automatica de #419, que tampoco se pintaba antes.
test('#420-3: con envio de paqueteria o costo manual no hay nada que pintar, con o sin decision', () => {
  for (const shippingOpt of ['envia', 'manual']) {
    for (const envioDecidido of [true, false]) {
      assert.strictEqual(avisoEnvioPasoCotizacion({ shippingOpt, envioDecidido }), null, `${shippingOpt}/${envioDecidido}`);
    }
  }
});

// === #430: el stepper palomea el paso Envio con "Sin envio" decidido ===
// Tercer lugar del 'none' de #419/#420 (HITL de #419/#420, 2026-09-23): el riel
// del encabezado juzgaba el paso Envio con `opt !== 'none'` en linea dentro de
// estadoFlujoCotizar (app.js), asi que "Sin envio" elegido a proposito se quedaba
// sin palomita. La entrada que distingue el default de la decision es la misma
// de #419/#420: envioDecidido.
test('#430-1: "Sin envio" decidido -> el paso Envio cuenta como listo', () => {
  assert.strictEqual(pasoEnvioListo({ shippingOpt: 'none', envioDecidido: true }), true);
});

test('#430-2: cotizacion nueva con "Sin envio" por default (nadie decidio) -> el paso Envio no esta listo', () => {
  assert.strictEqual(pasoEnvioListo({ shippingOpt: 'none', envioDecidido: false }), false);
});

// Paqueteria o costo manual ya contaban como listos antes de #430 (cualquier
// opcion distinta de 'none'), con o sin decision: el ticket no los mueve. Desde
// #441 la paqueteria cuenta con su tarjeta elegida (sin ella, #441-4).
test('#430-3: con paqueteria o costo manual el paso Envio esta listo, con o sin decision', () => {
  const enviaRateSeleccionado = { carrier: 'fedex', servicio: 'ground', desc: 'FedEx', cost: 259 };
  for (const shippingOpt of ['envia', 'manual']) {
    for (const envioDecidido of [true, false]) {
      assert.strictEqual(pasoEnvioListo({ shippingOpt, envioDecidido, enviaRateSeleccionado }), true, `${shippingOpt}/${envioDecidido}`);
    }
  }
});

// Sin selector que leer, el riel no palomeaba el paso (`!!(opt && ...)`), y la
// decision sola no lo vuelve listo: no hay opcion de la que hablar.
test('#430-4: sin opcion de envio que leer el paso Envio no esta listo', () => {
  for (const shippingOpt of ['', undefined, null]) {
    for (const envioDecidido of [true, false]) {
      assert.strictEqual(pasoEnvioListo({ shippingOpt, envioDecidido }), false, `${shippingOpt}/${envioDecidido}`);
    }
  }
});

// El cableado: app.js no es importable en Node (efectos de navegador en scope de
// modulo) y sin DOM no se puede afirmar el riel, asi que lo que se cuida aqui es
// el fuente -- mismo recurso que #402-1 (calcas-logica.test.cjs) y #404-C3
// (cotizaciones-logica.test.cjs). Ver la palomita en pantalla es HITL.
function fuenteApp() {
  const fs = require('node:fs');
  const path = require('node:path');
  return fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
}

function cuerpoDeFuncion(src, firma) {
  const inicio = src.indexOf(firma);
  assert.ok(inicio > 0, `${firma} debe existir en app.js`);
  const fin = src.indexOf('\n}\n', inicio);
  assert.ok(fin > inicio, `${firma} debe cerrar`);
  return src.slice(inicio, fin);
}

test('#430-5: el stepper juzga el paso Envio con pasoEnvioListo y la bandera de decision, no contra la opcion', () => {
  const cuerpo = cuerpoDeFuncion(fuenteApp(), 'function estadoFlujoCotizar(');
  assert.ok(/envioListo:\s*pasoEnvioListo\(\{[^}]*\benvioDecidido\b[^}]*\}\)/.test(cuerpo),
    'el paso Envio del riel lo decide el nucleo, con la MISMA bandera de #419/#420');
  assert.ok(!cuerpo.includes("'none'"),
    "comparar contra 'none' en linea confunde el default que nadie toco con \"Sin envio\" decidido");
});

// #432-1: "Consultando tarifas..." se pinta en el mismo contenedor donde despues
// se AGREGAN las advertencias y las tarjetas de tarifa, asi que solo el camino de
// error lo borraba y en el de exito quedaba encima de las tarifas. Ver que ya no
// aparece es HITL; aqui se cuida que la respuesta buena lo limpie antes de pintar.
test('#432-1: con respuesta buena de envia.com el aviso de espera se limpia antes de pintar las tarifas', () => {
  const cuerpo = cuerpoDeFuncion(fuenteApp(), 'async function cotizarEnvia(');
  const espera = cuerpo.indexOf('Consultando tarifas...');
  assert.ok(espera > 0, 'si el aviso de espera deja de vivir en el contenedor, este test ya no cuida nada: revisarlo');
  const exito = cuerpo.indexOf('const { rates, resumen, warnings } = data;', espera);
  assert.ok(exito > espera, 'el camino de exito empieza donde se lee la respuesta buena');
  const pintas = [cuerpo.indexOf('resultsEl.appendChild(', exito), cuerpo.indexOf('resultsEl.innerHTML +=', exito)]
    .filter(i => i > 0);
  assert.ok(pintas.length > 0, 'el camino de exito pinta en el contenedor de resultados');
  const limpia = cuerpo.indexOf("resultsEl.innerHTML = ''", exito);
  assert.ok(limpia > exito && limpia < Math.min(...pintas),
    'la respuesta buena tiene que quitar "Consultando tarifas..." antes de agregar advertencias o tarjetas');
});

// === #441: borrar o cambiar el CP suelta la tarifa elegida ===
// HITL 2026-09-23: con la tarjeta de envia.com elegida, borrar el CP de entrega
// dejaba la tarifa puesta y el paso Envio en "OK" con punto verde. La tarifa se
// cotizo para UN destino; con otro CP (o sin CP) ya no vale, y el paso vuelve a
// estar pendiente hasta volver a cotizar o elegir "Sin envio".
const TARIFA_ELEGIDA = { carrier: 'ups', servicio: 'saver', desc: 'UPS Saver', cost: 314.61 };

test('#441-1: vaciar o cambiar el CP suelta la tarifa elegida y el paso Envio deja de estar listo, en las tres opciones de tarifa', () => {
  for (const shippingOpt of OPCIONES_TARIFA) {
    const antes = { shippingOpt, envioDecidido: true, enviaRateSeleccionado: TARIFA_ELEGIDA };
    assert.strictEqual(pasoEnvioListo(antes), true, `premisa: ${shippingOpt} con tarifa elegida esta listo`);
    for (const cpNuevo of ['', '64000']) {
      const tras = envioTrasCambioDeCp({ ...antes, cpAnterior: '78000', cpNuevo });
      assert.strictEqual(tras.soltarTarifa, true, `${shippingOpt} 78000 -> '${cpNuevo}'`);
      assert.strictEqual(tras.enviaRateSeleccionado, null, `${shippingOpt} 78000 -> '${cpNuevo}'`);
      assert.strictEqual(pasoEnvioListo({ ...antes, enviaRateSeleccionado: tras.enviaRateSeleccionado }), false,
        `${shippingOpt} 78000 -> '${cpNuevo}': el paso Envio no esta listo`);
    }
  }
});

// El vendedor que vuelve a escribir el MISMO CP (o solo le agrega espacios) no
// cambio de destino: la tarifa sigue valiendo.
test('#441-2: el mismo CP no suelta la tarifa', () => {
  for (const cpNuevo of ['78000', ' 78000 ']) {
    const tras = envioTrasCambioDeCp({ shippingOpt: 'envia', enviaRateSeleccionado: TARIFA_ELEGIDA, cpAnterior: '78000', cpNuevo });
    assert.strictEqual(tras.soltarTarifa, false);
    assert.strictEqual(tras.enviaRateSeleccionado, TARIFA_ELEGIDA);
  }
});

// El costo manual y "Sin envio" no dependen del CP: no hay tarifa que soltar, y
// el paso sigue como estaba.
test('#441-3: con costo manual o "Sin envio" cambiar el CP no suelta nada ni mueve el paso', () => {
  for (const shippingOpt of ['manual', 'none']) {
    const tras = envioTrasCambioDeCp({ shippingOpt, enviaRateSeleccionado: null, cpAnterior: '78000', cpNuevo: '' });
    assert.strictEqual(tras.soltarTarifa, false, shippingOpt);
    assert.strictEqual(pasoEnvioListo({ shippingOpt, envioDecidido: true, enviaRateSeleccionado: tras.enviaRateSeleccionado }), true, shippingOpt);
  }
});

// Sin tarifa elegida (la soltaron, envia.com no devolvio ninguna o la invalidaron
// las cantidades, #89) no hay envio en los totales: el paso Envio no esta listo
// aunque el selector diga paqueteria. Vuelve a estarlo al elegir una tarjeta.
test('#441-4: una opcion de tarifa sin tarifa elegida no deja listo el paso Envio', () => {
  for (const shippingOpt of OPCIONES_TARIFA) {
    for (const envioDecidido of [true, false]) {
      assert.strictEqual(pasoEnvioListo({ shippingOpt, envioDecidido, enviaRateSeleccionado: null }), false, `${shippingOpt}/${envioDecidido}`);
      assert.strictEqual(pasoEnvioListo({ shippingOpt, envioDecidido, enviaRateSeleccionado: TARIFA_ELEGIDA }), true, `${shippingOpt}/${envioDecidido}`);
    }
  }
});

// El cableado de #441 en app.js (no importable en Node; ver #430-5): el riel lee
// la tarifa elegida, y los caminos por los que el VENDEDOR cambia el CP --
// teclearlo, elegir otro domicilio y cambiar de cliente -- pasan por el mismo
// punto, que suelta la tarifa con el nucleo y repinta nota (#436), resumen y
// riel. Cambiar de cliente vacia el CP en pcPrepararSeleccion (punto unico de
// busqueda, recientes, prospecto y "Cambiar de cliente"): Copiar la cotizacion
// de A con flete a 78000 y pasarla a B con CP 64000 (#385) dejaba la tarifa de
// A. Editar/Copiar (cargarCotizacion) restauran tarifa y CP juntos y no pasan
// por ahi. Ver el "OK" irse en pantalla es HITL.
test('#441-5: app.js suelta la tarifa por el nucleo al teclear el CP, al cambiar de domicilio y al cambiar de cliente, y el riel lee la tarifa', () => {
  const src = fuenteApp();
  assert.ok(/envioListo:\s*pasoEnvioListo\(\{[^}]*\benviaRateSeleccionado\b[^}]*\}\)/.test(cuerpoDeFuncion(src, 'function estadoFlujoCotizar(')),
    'el paso Envio del riel tiene que saber si hay tarjeta elegida');
  const soltar = cuerpoDeFuncion(src, 'function soltarTarifaSiCambioElCp(');
  for (const llamada of ['envioTrasCambioDeCp(', 'sincronizarNotaEnvio()', 'updateResumen()', 'updateTabIndicators()']) {
    assert.ok(soltar.includes(llamada), `soltarTarifaSiCambioElCp debe llamar ${llamada}`);
  }
  assert.ok(/getElementById\('cl-cp-entrega'\)\.addEventListener\('input',[^\n]*soltarTarifaSiCambioElCp\(/.test(src),
    'teclear o borrar el CP de entrega pasa por soltarTarifaSiCambioElCp');
  const dom = cuerpoDeFuncion(src, 'function pcCambiarDomicilio(');
  assert.ok(dom.indexOf('soltarTarifaSiCambioElCp(') > dom.indexOf('aplicarDomicilio('),
    'elegir otro domicilio compara el CP de antes contra el que dejo aplicarDomicilio');
  const prep = cuerpoDeFuncion(src, 'function pcPrepararSeleccion(');
  const limpia = prep.indexOf('pcLimpiarCamposCliente(');
  assert.ok(limpia > 0, 'premisa: pcPrepararSeleccion limpia los campos del cliente');
  const leeCp = prep.indexOf("getElementById('cl-cp-entrega')");
  assert.ok(leeCp > 0 && leeCp < limpia,
    'cambiar de cliente toma el CP de antes de que pcLimpiarCamposCliente lo vacie');
  assert.ok(prep.indexOf('soltarTarifaSiCambioElCp(') > limpia,
    'cambiar de cliente compara ese CP contra el que dejo pcLimpiarCamposCliente');
  const cargar = cuerpoDeFuncion(src, 'async function cargarCotizacion(');
  for (const prohibida of ['soltarTarifaSiCambioElCp(', 'pcPrepararSeleccion(']) {
    assert.ok(!cargar.includes(prohibida), `Editar/Copiar restauran tarifa y CP juntos: cargarCotizacion no llama ${prohibida}`);
  }
});
