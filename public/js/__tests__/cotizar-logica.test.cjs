'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let validarDomicilioEntrega, sentenceCase;
before(async () => {
  ({ validarDomicilioEntrega, sentenceCase } = await import('../cotizar-logica.js'));
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

// === AC2: falta CP o pais -> bloquea ===
test('AC2-1: falta CP -> ok:false con error', () => {
  const r = validarDomicilioEntrega({ calle: 'Reforma 100', cp: '', pais: 'MX' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
  assert.ok(!r.leyenda);
});

test('AC2-2: falta pais -> ok:false con error', () => {
  const r = validarDomicilioEntrega({ calle: 'Reforma 100', cp: '06600', pais: '' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

test('AC2-3: CP con formato invalido para el pais -> ok:false con error', () => {
  const r = validarDomicilioEntrega({ calle: 'Reforma 100', cp: '123', pais: 'MX' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

test('AC2-4: CP valido canadiense con pais CA -> ok', () => {
  const r = validarDomicilioEntrega({ calle: '', cp: 'K1A 0A9', pais: 'CA' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.leyenda, 'Favor de confirmar el domicilio de entrega');
});

test('AC2-5: falta CP y falta pais -> ok:false', () => {
  const r = validarDomicilioEntrega({ calle: '', cp: '', pais: '' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

// === AC3: Sentence case ===
test('AC3-1: minusculas -> primera letra mayuscula', () => {
  assert.strictEqual(sentenceCase('fedex ground'), 'Fedex ground');
});

test('AC3-2: mayusculas -> Sentence case', () => {
  assert.strictEqual(sentenceCase('FEDEX GROUND'), 'Fedex ground');
});

test('AC3-3: mixed case -> Sentence case', () => {
  assert.strictEqual(sentenceCase('FedEx Ground'), 'Fedex ground');
});

test('AC3-4: cadena vacia -> cadena vacia', () => {
  assert.strictEqual(sentenceCase(''), '');
});

test('AC3-5: recorta espacios al inicio y fin', () => {
  assert.strictEqual(sentenceCase('  dhl express  '), 'Dhl express');
});

test('AC3-6: null o undefined -> cadena vacia', () => {
  assert.strictEqual(sentenceCase(null), '');
  assert.strictEqual(sentenceCase(undefined), '');
});
