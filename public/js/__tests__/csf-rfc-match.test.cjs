'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { findRfcMatch } = require('./helpers.cjs');

test('findRfcMatch returns cliente when RFC matches exactly', () => {
  const clientes = [
    { id: 10, name: 'EMPRESA A SA DE CV', rfc: 'EMA010101AAA' },
    { id: 42, name: 'PELTRE NACIONAL SA DE CV', rfc: 'PNA010101BBB' },
    { id: 99, name: 'OTRO CLIENTE', rfc: 'OCL010101CCC' },
  ];

  const result = findRfcMatch(clientes, 'PNA010101BBB');

  assert.ok(result !== null, 'should find a match');
  assert.equal(result.id, 42);
  assert.equal(result.name, 'PELTRE NACIONAL SA DE CV');
});

test('findRfcMatch returns null when no exact RFC match', () => {
  const clientes = [
    { id: 10, name: 'EMPRESA A', rfc: 'EMA010101AAA' },
  ];

  const result = findRfcMatch(clientes, 'RFC_DIFERENTE');

  assert.equal(result, null);
});

test('findRfcMatch is case-insensitive', () => {
  const clientes = [
    { id: 5, name: 'EMPRESA', rfc: 'EMP010101AAA' },
  ];

  const result = findRfcMatch(clientes, 'emp010101aaa');

  assert.ok(result !== null);
  assert.equal(result.id, 5);
});

test('findRfcMatch returns null for empty clientes array', () => {
  const result = findRfcMatch([], 'PNA010101BBB');
  assert.equal(result, null);
});

test('findRfcMatch returns null for empty rfc', () => {
  const clientes = [{ id: 1, name: 'X', rfc: '' }];
  const result = findRfcMatch(clientes, '');
  assert.equal(result, null);
});
