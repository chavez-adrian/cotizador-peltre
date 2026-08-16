import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numeroTelefonoEsPosible } from '../lib/telefono-posible.js';

test('T1: un numero MX de 10 digitos valido pasa', () => {
  assert.equal(numeroTelefonoEsPosible('+52 5512345678'), true);
});

test('T2: un numero con el largo correcto pero imposible para su pais no pasa', () => {
  // +52 0000000000 tiene 10 digitos (pasa validarTelefono, que solo mira largo)
  // pero ningun area code mexicano empieza en 0000: libphonenumber-js lo rechaza.
  assert.equal(numeroTelefonoEsPosible('+52 0000000000'), false);
});

test('T3: un numero US valido pasa', () => {
  assert.equal(numeroTelefonoEsPosible('+1 2025550123'), true);
});

test('T4: vacio o basura no pasa', () => {
  assert.equal(numeroTelefonoEsPosible(''), false);
  assert.equal(numeroTelefonoEsPosible(null), false);
  assert.equal(numeroTelefonoEsPosible('no es un telefono'), false);
});
