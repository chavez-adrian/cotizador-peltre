'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

// Lo que el Contacto de entrega y el domicilio de entrega exigen para generar o
// actualizar (#558, ADR-0024 regla 1): el telefono del Contacto de entrega y el
// domicilio de entrega son obligatorios; el correo no. Es EL juicio que comparten el
// navegador (no manda la cotizacion y enfoca el campo) y la Subida del quote
// (bloqueo con motivo).
// D3 (decisiones de Adrian 2026-10-09): de quien recibe se exige lo mismo que el
// Registro minimo de un prospecto (GLOSSARY.md): celular, nombre (sin apellido vale) y
// CP (hace las veces de ciudad). La calle deja de ser obligatoria.

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

test('D3: sin calle no bloquea: con CP, nombre y celular se genera', () => {
  assert.equal(bloqueoContactoEntrega({ ...COMPLETO, calle: '   ' }), null);
});

test('sin CP ni telefono: va primero al CP (orden del paso Envio) y el mensaje nombra los dos', () => {
  const r = bloqueoContactoEntrega({ ...COMPLETO, cpEntrega: '', celEntrega: '' });
  assert.equal(r.campo, 'cl-cp-entrega');
  assert.deepEqual(r.faltan, ['sin-domicilio-entrega', 'sin-telefono-entrega']);
  assert.match(r.mensaje, /domicilio de entrega/);
  assert.match(r.mensaje, /tel\u00e9fono del Contacto de entrega/);
});

test('D3: sin nombre del Contacto de entrega: bloquea y manda al campo "Entregar a"', () => {
  const r = bloqueoContactoEntrega({ ...COMPLETO, nombreEntrega: ' ' });
  assert.equal(r.motivo, 'sin-nombre-entrega');
  assert.equal(r.campo, 'cl-nombre-entrega');
  assert.match(r.mensaje, /nombre del Contacto de entrega/);
  assert.match(r.detalle, /nombreEntrega/);
});

test('D3: el nombre sin apellido vale', () => {
  assert.equal(bloqueoContactoEntrega({ ...COMPLETO, nombreEntrega: 'Pedro' }), null);
});

test('D3: sin nombre ni celular va primero al nombre, que el paso Envio pinta antes que el celular', () => {
  const r = bloqueoContactoEntrega({ ...COMPLETO, nombreEntrega: '', celEntrega: '' });
  assert.equal(r.campo, 'cl-nombre-entrega');
  assert.deepEqual(r.faltan, ['sin-nombre-entrega', 'sin-telefono-entrega']);
});

test('con domicilio y telefono, sin correo de entrega: no bloquea (el correo es opcional)', () => {
  assert.equal(bloqueoContactoEntrega({ ...COMPLETO, emailEntrega: '' }), null);
});

test('un codigo de pais suelto no es telefono', () => {
  assert.equal(bloqueoContactoEntrega({ ...COMPLETO, celEntrega: '+52' })?.motivo, 'sin-telefono-entrega');
  assert.equal(bloqueoContactoEntrega({ ...COMPLETO, celEntrega: ' +1 ' })?.motivo, 'sin-telefono-entrega');
});

test('una cotizacion sin cliente bloquea por los tres datos, en el orden del paso Envio', () => {
  assert.deepEqual(bloqueoContactoEntrega(undefined).faltan, ['sin-domicilio-entrega', 'sin-nombre-entrega', 'sin-telefono-entrega']);
});

test('el mensaje va en palabras del glosario y el detalle tecnico aparte (Mensaje en dos capas)', () => {
  const r = bloqueoContactoEntrega({ ...COMPLETO, celEntrega: '' });
  assert.doesNotMatch(r.mensaje, /celEntrega|cl-cel-entrega/);
  assert.match(r.detalle, /celEntrega/);
});

test('sin CP de entrega no hay domicilio de entrega: es lo que el alta necesita para escribirlo en Operam', () => {
  const r = bloqueoContactoEntrega({ ...COMPLETO, cpEntrega: ' ' });
  assert.equal(r.motivo, 'sin-domicilio-entrega');
  assert.equal(r.campo, 'cl-cp-entrega');
  assert.match(r.detalle, /cpEntrega/);
});

test('sin CP ni calle: solo falta el CP', () => {
  const r = bloqueoContactoEntrega({ ...COMPLETO, cpEntrega: '', calle: '' });
  assert.equal(r.campo, 'cl-cp-entrega');
  assert.deepEqual(r.faltan, ['sin-domicilio-entrega']);
  assert.doesNotMatch(r.detalle, /calle/);
});
