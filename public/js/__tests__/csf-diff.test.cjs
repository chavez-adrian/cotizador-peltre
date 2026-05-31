'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { calcularDiff } = require('./helpers.cjs');

test('calcularDiff: retorna campos que cambiaron con valores anterior y nuevo', () => {
  const snapshot = {
    'cl-razon-social': 'EMPRESA A',
    'cl-municipio': 'GUADALAJARA',
    'cl-cp-fiscal': '44100',
  };
  const formValues = {
    'cl-razon-social': 'EMPRESA A MODIFICADA',
    'cl-municipio': 'GUADALAJARA',
    'cl-cp-fiscal': '44200',
  };

  const diff = calcularDiff(snapshot, formValues);

  assert.ok('cl-razon-social' in diff, 'debe incluir cl-razon-social');
  assert.equal(diff['cl-razon-social'].anterior, 'EMPRESA A');
  assert.equal(diff['cl-razon-social'].nuevo, 'EMPRESA A MODIFICADA');
  assert.ok('cl-cp-fiscal' in diff, 'debe incluir cl-cp-fiscal');
  assert.equal(diff['cl-cp-fiscal'].anterior, '44100');
  assert.equal(diff['cl-cp-fiscal'].nuevo, '44200');
  assert.ok(!('cl-municipio' in diff), 'no debe incluir cl-municipio (sin cambio)');
});

test('calcularDiff: retorna objeto vacio si no hay cambios', () => {
  const snapshot = {
    'cl-razon-social': 'EMPRESA A',
    'cl-cp-fiscal': '44100',
  };
  const formValues = {
    'cl-razon-social': 'EMPRESA A',
    'cl-cp-fiscal': '44100',
  };

  const diff = calcularDiff(snapshot, formValues);

  assert.deepEqual(diff, {});
});

test('calcularDiff: ignora campos que estan en snapshot pero no en formValues', () => {
  const snapshot = { 'cl-razon-social': 'A', 'cl-extra': 'X' };
  const formValues = { 'cl-razon-social': 'A' };

  const diff = calcularDiff(snapshot, formValues);

  assert.ok(!('cl-extra' in diff));
  assert.deepEqual(diff, {});
});

test('calcularDiff: ignora campos que estan en formValues pero no en snapshot', () => {
  const snapshot = { 'cl-razon-social': 'A' };
  const formValues = { 'cl-razon-social': 'A', 'cl-nuevo': 'X' };

  const diff = calcularDiff(snapshot, formValues);

  assert.ok(!('cl-nuevo' in diff));
  assert.deepEqual(diff, {});
});

test('calcularDiff: compara por string trim (espacios no cuentan como cambio)', () => {
  const snapshot = { 'cl-razon-social': 'EMPRESA A' };
  const formValues = { 'cl-razon-social': '  EMPRESA A  ' };

  const diff = calcularDiff(snapshot, formValues);

  assert.deepEqual(diff, {});
});

test('calcularDiff: trata null/undefined/vacio como string vacio para comparar', () => {
  const snapshot = { 'cl-num-int': null, 'cl-colonia': undefined, 'cl-calle': '' };
  const formValues = { 'cl-num-int': '', 'cl-colonia': '', 'cl-calle': null };

  const diff = calcularDiff(snapshot, formValues);

  assert.deepEqual(diff, {});
});
