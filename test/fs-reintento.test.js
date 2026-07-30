import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conReintentoEBUSY } from '../lib/fs-reintento.js';

function errorEBUSY() {
  const e = new Error('EBUSY: resource busy or locked');
  e.code = 'EBUSY';
  return e;
}

test('conReintentoEBUSY reintenta ante EBUSY y devuelve el resultado al liberarse', () => {
  let intentos = 0;
  const r = conReintentoEBUSY(() => {
    intentos++;
    if (intentos < 3) throw errorEBUSY();
    return 'ok';
  });
  assert.equal(r, 'ok');
  assert.equal(intentos, 3);
});

test('conReintentoEBUSY NO reintenta errores distintos de EBUSY', () => {
  let intentos = 0;
  const e = new Error('EPERM: operation not permitted');
  e.code = 'EPERM';
  assert.throws(() => conReintentoEBUSY(() => { intentos++; throw e; }), /EPERM/);
  assert.equal(intentos, 1);
});

test('conReintentoEBUSY se rinde tras agotar los reintentos y propaga el EBUSY', () => {
  let intentos = 0;
  assert.throws(() => conReintentoEBUSY(() => { intentos++; throw errorEBUSY(); }, { esperaMs: 1 }), /EBUSY/);
  assert.ok(intentos > 1, `debe reintentar mas de una vez (hizo ${intentos})`);
});

test('conReintentoEBUSY sin fallo ejecuta una sola vez', () => {
  let intentos = 0;
  conReintentoEBUSY(() => { intentos++; });
  assert.equal(intentos, 1);
});
