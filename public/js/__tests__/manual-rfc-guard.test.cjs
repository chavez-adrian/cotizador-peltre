'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { shouldTriggerRfcSearch, buildCsfDuplicadoBanner, buildClienteSnapshot, buildOperamPreFillMap, findRfcMatch } = require('./helpers.cjs');

test('shouldTriggerRfcSearch returns true for RFC with exactly 12 chars', () => {
  assert.equal(shouldTriggerRfcSearch('PNA010101BBB'), true);
});

test('shouldTriggerRfcSearch returns true for RFC with 13 chars', () => {
  assert.equal(shouldTriggerRfcSearch('PNA010101BBBB'), true);
});

test('shouldTriggerRfcSearch returns false for RFC with 11 chars', () => {
  assert.equal(shouldTriggerRfcSearch('PNA010101BB'), false);
});

test('shouldTriggerRfcSearch returns false for empty string', () => {
  assert.equal(shouldTriggerRfcSearch(''), false);
});

test('shouldTriggerRfcSearch returns false for null', () => {
  assert.equal(shouldTriggerRfcSearch(null), false);
});

test('shouldTriggerRfcSearch returns false for undefined', () => {
  assert.equal(shouldTriggerRfcSearch(undefined), false);
});

test('shouldTriggerRfcSearch trims whitespace before checking length', () => {
  assert.equal(shouldTriggerRfcSearch('  PNA010101BBB  '), true);
  assert.equal(shouldTriggerRfcSearch('  PNA010101B  '), false);
});

// Tests for integration: when a match is found in manual panel,
// buildCsfDuplicadoBanner and buildClienteSnapshot work correctly.

test('buildCsfDuplicadoBanner shows id and name for manual RFC match', () => {
  const cliente = { id: 77, name: 'TIENDA PAPELERIA SA DE CV' };
  const banner = buildCsfDuplicadoBanner(cliente);
  assert.ok(banner.includes('77'));
  assert.ok(banner.includes('TIENDA PAPELERIA SA DE CV'));
});

test('buildClienteSnapshot captures all manual form fields', () => {
  const fieldIds = ['cl-razon-social', 'cl-rfc', 'cl-cp-fiscal', 'cl-calle', 'cl-municipio'];
  const values = {
    'cl-razon-social': 'TIENDA PAPELERIA SA DE CV',
    'cl-rfc': 'TPA010101AAA',
    'cl-cp-fiscal': '06600',
    'cl-calle': 'Av. Insurgentes Sur 100',
    'cl-municipio': 'Benito Juarez',
  };
  const snap = buildClienteSnapshot(fieldIds, (id) => values[id] || '');
  assert.equal(snap['cl-razon-social'], 'TIENDA PAPELERIA SA DE CV');
  assert.equal(snap['cl-rfc'], 'TPA010101AAA');
  assert.equal(Object.keys(snap).length, 5);
});

test('findRfcMatch finds cliente when RFC typed in manual mode', () => {
  const clientes = [
    { id: 77, name: 'TIENDA PAPELERIA SA DE CV', rfc: 'TPA010101AAA' },
    { id: 88, name: 'OTRA EMPRESA', rfc: 'OEM010101BBB' },
  ];
  const match = findRfcMatch(clientes, 'TPA010101AAA');
  assert.ok(match !== null);
  assert.equal(match.id, 77);
});

test('findRfcMatch returns null when RFC typed in manual mode has no match', () => {
  const clientes = [
    { id: 77, name: 'TIENDA PAPELERIA SA DE CV', rfc: 'TPA010101AAA' },
  ];
  const match = findRfcMatch(clientes, 'RFC_DIFERENTE123');
  assert.equal(match, null);
});

// Edge cases for shouldTriggerRfcSearch with generic/foreign RFC
test('shouldTriggerRfcSearch returns true for XEXX010101000 (foreign RFC placeholder)', () => {
  // This is 13 chars, would trigger - but the blur handler checks readOnly separately
  assert.equal(shouldTriggerRfcSearch('XEXX010101000'), true);
});

test('shouldTriggerRfcSearch returns true for XAXX010101000 (no-RFC placeholder)', () => {
  assert.equal(shouldTriggerRfcSearch('XAXX010101000'), true);
});

// Verifying that buildOperamPreFillMap maps all CSF_FORM_FIELD_IDS fields
test('buildOperamPreFillMap returns all expected field IDs', () => {
  const cliente = {
    name: 'EMPRESA TEST', ref: 'EMP TEST', rfc: 'EMP010101AAA',
    cp: '01234', telefono: '5512345678', nombreEntrega: 'Juan Perez',
    calle: 'Av. Test 100', numInt: 'Depto 1', colonia: 'Centro',
    municipio: 'Cuauhtemoc', estado: 'CDMX', email: 'test@test.com',
  };
  const mapa = buildOperamPreFillMap(cliente);
  const expectedKeys = [
    'cl-razon-social', 'cl-nombre-corto', 'cl-rfc', 'cl-cp-fiscal', 'cl-telefono',
    'cl-nombre-entrega', 'cl-calle', 'cl-num-int', 'cl-colonia', 'cl-cp-entrega',
    'cl-municipio', 'cl-estado', 'cl-cel-entrega', 'cl-email-entrega',
  ];
  for (const key of expectedKeys) {
    assert.ok(key in mapa, `mapa should have key ${key}`);
  }
});
