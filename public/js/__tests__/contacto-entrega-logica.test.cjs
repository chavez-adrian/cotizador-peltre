'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

// Lo que el Contacto de entrega y el domicilio de entrega exigen para generar o
// actualizar (#558, ADR-0024 regla 1): el telefono del Contacto de entrega y el
// domicilio de entrega son obligatorios; el correo no. Es EL juicio que comparten el
// navegador (no manda la cotizacion y enfoca el campo) y la Subida del quote
// (bloqueo con motivo).

let bloqueoContactoEntrega;

before(async () => {
  ({ bloqueoContactoEntrega } = await import('../contacto-entrega-logica.js'));
});

const COMPLETO = {
  nombreEntrega: 'Pedro Almacen', calle: 'Av. Reforma 123', cpEntrega: '06600',
  celEntrega: '+52 55 1234 5678', emailEntrega: '',
};

test('sin telefono del Contacto de entrega: bloquea y manda al campo del celular de entrega', () => {
  const r = bloqueoContactoEntrega({ ...COMPLETO, celEntrega: '' });
  assert.equal(r.motivo, 'sin-telefono-entrega');
  assert.equal(r.campo, 'cl-cel-entrega');
  assert.match(r.mensaje, /tel\u00e9fono del Contacto de entrega/);
});

test('sin domicilio de entrega (sin calle): bloquea y manda al campo de la calle', () => {
  const r = bloqueoContactoEntrega({ ...COMPLETO, calle: '   ' });
  assert.equal(r.motivo, 'sin-domicilio-entrega');
  assert.equal(r.campo, 'cl-calle');
  assert.match(r.mensaje, /domicilio de entrega/);
});

test('sin domicilio ni telefono: va primero a la calle (orden del paso Envio) y el mensaje nombra los dos', () => {
  const r = bloqueoContactoEntrega({ ...COMPLETO, calle: '', celEntrega: '' });
  assert.equal(r.campo, 'cl-calle');
  assert.deepEqual(r.faltan, ['sin-domicilio-entrega', 'sin-telefono-entrega']);
  assert.match(r.mensaje, /domicilio de entrega/);
  assert.match(r.mensaje, /tel\u00e9fono del Contacto de entrega/);
});

test('con domicilio y telefono, sin correo de entrega: no bloquea (el correo es opcional)', () => {
  assert.equal(bloqueoContactoEntrega({ ...COMPLETO, emailEntrega: '' }), null);
});

test('un codigo de pais suelto no es telefono', () => {
  assert.equal(bloqueoContactoEntrega({ ...COMPLETO, celEntrega: '+52' })?.motivo, 'sin-telefono-entrega');
  assert.equal(bloqueoContactoEntrega({ ...COMPLETO, celEntrega: ' +1 ' })?.motivo, 'sin-telefono-entrega');
});

test('una cotizacion sin cliente bloquea por los dos datos', () => {
  assert.deepEqual(bloqueoContactoEntrega(undefined).faltan, ['sin-domicilio-entrega', 'sin-telefono-entrega']);
});

test('el mensaje va en palabras del glosario y el detalle tecnico aparte (Mensaje en dos capas)', () => {
  const r = bloqueoContactoEntrega({ ...COMPLETO, celEntrega: '' });
  assert.doesNotMatch(r.mensaje, /celEntrega|cl-cel-entrega/);
  assert.match(r.detalle, /celEntrega/);
});

test('sin CP de entrega tampoco hay domicilio de entrega: el alta solo escribe el domicilio en Operam con calle y CP', () => {
  const r = bloqueoContactoEntrega({ ...COMPLETO, cpEntrega: ' ' });
  assert.equal(r.motivo, 'sin-domicilio-entrega');
  assert.equal(r.campo, 'cl-cp-entrega');
  assert.match(r.detalle, /cpEntrega/);
});

test('sin CP ni calle: va primero al CP, que el paso Envio pinta antes que la calle', () => {
  const r = bloqueoContactoEntrega({ ...COMPLETO, cpEntrega: '', calle: '' });
  assert.equal(r.campo, 'cl-cp-entrega');
  assert.deepEqual(r.faltan, ['sin-domicilio-entrega']);
});
