'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let validarTelefono, separarTelefonoCodigo, combinarTelefonoConCodigo;
before(async () => {
  ({ validarTelefono, separarTelefonoCodigo, combinarTelefonoConCodigo } = await import('../alta-logica.js'));
});

test('T1: validarTelefono con codigo +52 y 10 digitos retorna null', () => {
  assert.strictEqual(validarTelefono('+52', '5512345678'), null);
  assert.strictEqual(validarTelefono('+52', '55 1234 5678'), null);
});

test('T2: validarTelefono con codigo +1 / +1-CA y 10 digitos retorna null', () => {
  assert.strictEqual(validarTelefono('+1', '5551234567'), null);
  assert.strictEqual(validarTelefono('+1-CA', '5551234567'), null);
});

test('T3: validarTelefono numero vacio retorna error de obligatorio', () => {
  assert.match(validarTelefono('+52', ''), /obligatorio/i);
  assert.match(validarTelefono('+52', '   '), /obligatorio/i);
});

test('T4: validarTelefono con menos o mas de 10 digitos para +52/+1 retorna error', () => {
  assert.match(validarTelefono('+52', '551234'), /10 digitos/i);
  assert.match(validarTelefono('+1', '55512345678'), /10 digitos/i);
});

test('T5: validarTelefono codigo Otro exige numero internacional completo con +', () => {
  assert.strictEqual(validarTelefono('+', '+34 612 345 678'), null);
  assert.match(validarTelefono('+', '612345678'), /codigo de pais/i);
});

test('T6: validarTelefono numero que ya trae + se valida por longitud total', () => {
  assert.strictEqual(validarTelefono('+52', '+52 5512345678'), null);
  assert.match(validarTelefono('+52', '+52 1234'), /codigo de pais/i);
});

test('T7: separarTelefonoCodigo deshace lo que combinarTelefonoConCodigo arma', () => {
  assert.deepStrictEqual(separarTelefonoCodigo('+52 5512345678'), { code: '+52', numero: '5512345678' });
  assert.deepStrictEqual(separarTelefonoCodigo('+1 5551234567'), { code: '+1', numero: '5551234567' });
});

test('T8: separarTelefonoCodigo con digitos pegados detecta prefijo conocido', () => {
  assert.deepStrictEqual(separarTelefonoCodigo('525512345678'), { code: '+52', numero: '5512345678' });
  assert.deepStrictEqual(separarTelefonoCodigo('15551234567'), { code: '+1', numero: '5551234567' });
});

test('T9: separarTelefonoCodigo legacy 10 digitos asume +52', () => {
  assert.deepStrictEqual(separarTelefonoCodigo('5512345678'), { code: '+52', numero: '5512345678' });
});

test('T10: separarTelefonoCodigo vacio o desconocido no truena', () => {
  assert.deepStrictEqual(separarTelefonoCodigo(''), { code: '+52', numero: '' });
  assert.deepStrictEqual(separarTelefonoCodigo(undefined), { code: '+52', numero: '' });
  assert.deepStrictEqual(separarTelefonoCodigo('+34 612 345 678'), { code: '+', numero: '+34 612 345 678' });
});

test('T11: validarTelefono acepta el "1" de movil mexicano heredado (+52 1 + 10 digitos)', () => {
  assert.strictEqual(validarTelefono('+52', '13222320749'), null);
  assert.strictEqual(validarTelefono('+52', '1 322 232 0749'), null);
  assert.strictEqual(validarTelefono('+1', '13222320749'), null); // "1" = codigo de pais US
  // 11 digitos que NO empiezan con 1 siguen siendo invalidos
  assert.match(validarTelefono('+52', '55512345678'), /10 digitos/i);
});

test('T12: combinarTelefonoConCodigo normaliza quitando el "1" lider', () => {
  assert.strictEqual(combinarTelefonoConCodigo('+52', '13222320749'), '+52 3222320749');
  assert.strictEqual(combinarTelefonoConCodigo('+52', '1 322 232 0749'), '+52 322 232 0749');
  assert.strictEqual(combinarTelefonoConCodigo('+1', '13222320749'), '+1 3222320749');
  // numero normal de 10 digitos no se toca
  assert.strictEqual(combinarTelefonoConCodigo('+52', '3222320749'), '+52 3222320749');
});
