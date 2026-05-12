import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarCP } from '../lib/validar-cp.js';

test('B3-1: MX CP de 5 digitos valido', () => {
  assert.strictEqual(validarCP('12345', 'MX'), true);
});

test('B3-2: MX CP de 4 digitos invalido', () => {
  assert.strictEqual(validarCP('1234', 'MX'), false);
});

test('B3-3: US CP de 5 digitos valido', () => {
  assert.strictEqual(validarCP('90210', 'US'), true);
});

test('B3-4: CA codigo postal con espacio valido', () => {
  assert.strictEqual(validarCP('K1A 0A9', 'CA'), true);
});

test('B3-5: CA codigo postal sin espacio valido', () => {
  assert.strictEqual(validarCP('K1A0A9', 'CA'), true);
});

test('B3-6: CA codigo postal invalido', () => {
  assert.strictEqual(validarCP('123', 'CA'), false);
});
