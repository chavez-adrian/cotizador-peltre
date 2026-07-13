'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let validarDomicilioEntrega, formatCarrier, formatServicio, cpValido, buildConfirmarVendedorModalHtml;
let debeInvalidarEnvioPorCantidad, bloqueaGeneracionPorEnvioInvalidado, MENSAJE_ENVIO_INVALIDADO;
let notaTiempoEntrega, aplicarNotaTiempoEntrega;
before(async () => {
  ({
    validarDomicilioEntrega, formatCarrier, formatServicio, cpValido, buildConfirmarVendedorModalHtml,
    debeInvalidarEnvioPorCantidad, bloqueaGeneracionPorEnvioInvalidado, MENSAJE_ENVIO_INVALIDADO,
    notaTiempoEntrega, aplicarNotaTiempoEntrega,
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
