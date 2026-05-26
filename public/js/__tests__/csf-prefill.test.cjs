'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { applyPreFillMap } = require('./helpers.cjs');

test('applyPreFillMap sets values on elements returned by getter', () => {
  const elements = {};
  const getEl = (id) => {
    if (!elements[id]) elements[id] = { value: '' };
    return elements[id];
  };

  const mapa = {
    'cl-razon-social': 'EMPRESA SA DE CV',
    'cl-rfc': 'EMP010101AAA',
    'cl-cp-fiscal': '01234',
    'cl-calle': 'CALLE UNO',
    'cl-colonia': 'COL CENTRO',
    'cl-cp-entrega': '01234',
    'cl-municipio': 'CIUDAD',
    'cl-estado': 'ESTADO',
    'cl-num-int': '',
  };

  applyPreFillMap(mapa, getEl);

  assert.equal(elements['cl-razon-social'].value, 'EMPRESA SA DE CV');
  assert.equal(elements['cl-rfc'].value, 'EMP010101AAA');
  assert.equal(elements['cl-calle'].value, 'CALLE UNO');
  assert.equal(elements['cl-cp-entrega'].value, '01234');
});

test('applyPreFillMap skips null elements gracefully', () => {
  const getEl = () => null;
  const mapa = { 'cl-rfc': 'ABC010101AAA' };

  assert.doesNotThrow(() => applyPreFillMap(mapa, getEl));
});

test('applyPreFillMap sets cl-pais to MX via explicit call', () => {
  const elements = {};
  const getEl = (id) => {
    if (!elements[id]) elements[id] = { value: '' };
    return elements[id];
  };

  const mapa = { 'cl-pais': 'MX', 'cl-rfc': 'RFC010101AAA' };
  applyPreFillMap(mapa, getEl);

  assert.equal(elements['cl-pais'].value, 'MX');
});
