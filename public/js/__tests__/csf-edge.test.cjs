'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildPreFillMap, buildEntregaPayload } = require('./helpers.cjs');

test('buildEntregaPayload with all empty fields returns object with empty strings', () => {
  const getVal = () => '';
  const entrega = buildEntregaPayload(getVal);

  for (const val of Object.values(entrega)) {
    assert.equal(val, '', `Expected empty string but got "${val}"`);
  }
});

test('buildEntregaPayload with undefined getter returns empty strings', () => {
  const getVal = (id) => undefined;
  const entrega = buildEntregaPayload(getVal);

  assert.equal(entrega.br_name, undefined);
  assert.equal(entrega.addr_zip, undefined);
});

test('buildPreFillMap with partial datos (no calle/colonia) fills what is available', () => {
  const datos = {
    razonSocial: 'EMPRESA PARCIAL SA',
    rfc: 'EPA010101ZZZ',
    cp: '99999',
    calle: undefined,
    numInt: undefined,
    colonia: undefined,
    municipio: undefined,
    estado: undefined,
  };

  const mapa = buildPreFillMap(datos);

  assert.equal(mapa['cl-razon-social'], 'EMPRESA PARCIAL SA');
  assert.equal(mapa['cl-rfc'], 'EPA010101ZZZ');
  assert.equal(mapa['cl-cp-fiscal'], '99999');
  assert.equal(mapa['cl-calle'], undefined);
  assert.equal(mapa['cl-estado'], undefined);
});

test('buildPreFillMap copies cp to both cl-cp-fiscal and cl-cp-entrega', () => {
  const datos = {
    razonSocial: 'X',
    rfc: 'X',
    cp: '54321',
    calle: '',
    numInt: '',
    colonia: '',
    municipio: '',
    estado: '',
  };

  const mapa = buildPreFillMap(datos);

  assert.equal(mapa['cl-cp-fiscal'], '54321');
  assert.equal(mapa['cl-cp-entrega'], '54321');
});

test('buildPreFillMap never includes cl-nombre-corto even when nombreCorto is present', () => {
  const datos = {
    razonSocial: 'EMPRESA',
    rfc: 'EMP010101AAA',
    cp: '12345',
    calle: 'CALLE',
    numInt: '',
    colonia: 'COL',
    municipio: 'CIUDAD',
    estado: 'ESTADO',
    nombreCorto: 'EMPRESA CORTO',
  };

  const mapa = buildPreFillMap(datos);

  assert.ok(!('cl-nombre-corto' in mapa), 'cl-nombre-corto must not be set by buildPreFillMap');
});
