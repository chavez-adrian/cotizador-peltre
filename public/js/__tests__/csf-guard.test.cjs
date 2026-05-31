'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildCsfDuplicadoBanner, buildClienteSnapshot } = require('./helpers.cjs');

test('buildCsfDuplicadoBanner returns banner text with id and name', () => {
  const cliente = { id: 42, name: 'PELTRE NACIONAL SA DE CV' };
  const banner = buildCsfDuplicadoBanner(cliente);

  assert.ok(banner.includes('42'), 'banner must include cliente id');
  assert.ok(banner.includes('PELTRE NACIONAL SA DE CV'), 'banner must include name');
  assert.ok(banner.includes('registrado'), 'banner must include word registrado');
});

test('buildCsfDuplicadoBanner works with numeric id', () => {
  const cliente = { id: 999, name: 'EMPRESA EJEMPLO SA DE CV' };
  const banner = buildCsfDuplicadoBanner(cliente);

  assert.ok(banner.includes('999'));
  assert.ok(banner.includes('EMPRESA EJEMPLO SA DE CV'));
});

test('buildClienteSnapshot returns id->value for all provided field IDs', () => {
  const fieldIds = ['cl-razon-social', 'cl-rfc', 'cl-cp-fiscal', 'cl-calle'];
  const values = {
    'cl-razon-social': 'PELTRE NACIONAL SA DE CV',
    'cl-rfc': 'PNA010101AAA',
    'cl-cp-fiscal': '56530',
    'cl-calle': 'AVENIDA PRINCIPAL',
  };
  const getVal = (id) => values[id] || '';

  const snapshot = buildClienteSnapshot(fieldIds, getVal);

  assert.equal(snapshot['cl-razon-social'], 'PELTRE NACIONAL SA DE CV');
  assert.equal(snapshot['cl-rfc'], 'PNA010101AAA');
  assert.equal(snapshot['cl-cp-fiscal'], '56530');
  assert.equal(snapshot['cl-calle'], 'AVENIDA PRINCIPAL');
  assert.equal(Object.keys(snapshot).length, 4);
});

test('buildClienteSnapshot returns empty strings for missing values', () => {
  const fieldIds = ['cl-razon-social', 'cl-rfc'];
  const getVal = () => '';

  const snapshot = buildClienteSnapshot(fieldIds, getVal);

  assert.equal(snapshot['cl-razon-social'], '');
  assert.equal(snapshot['cl-rfc'], '');
});
