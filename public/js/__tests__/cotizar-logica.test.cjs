'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let validarDomicilioEntrega, formatCarrier, formatServicio, cpValido, buildConfirmarVendedorModalHtml;
before(async () => {
  ({ validarDomicilioEntrega, formatCarrier, formatServicio, cpValido, buildConfirmarVendedorModalHtml } = await import('../cotizar-logica.js'));
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
