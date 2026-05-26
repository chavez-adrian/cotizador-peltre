'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

// Inline copy of buildPreFillMap for testing (pure function, no DOM dependency)
// This file is the RED phase: import from helpers.cjs once it exists
const { buildPreFillMap } = require('./helpers.cjs');

test('buildPreFillMap returns billing fields', () => {
  const datos = {
    razonSocial: 'PELTRE NACIONAL SA DE CV',
    rfc: 'PNA010101AAA',
    cp: '56530',
    calle: 'AVENIDA PRINCIPAL',
    numInt: 'B',
    colonia: 'CENTRO',
    municipio: 'IXTAPALUCA',
    estado: 'ESTADO DE MEXICO',
    nombreCorto: 'PELTRE NACIONAL',
  };

  const mapa = buildPreFillMap(datos);

  assert.equal(mapa['cl-razon-social'], 'PELTRE NACIONAL SA DE CV');
  assert.equal(mapa['cl-rfc'], 'PNA010101AAA');
  assert.equal(mapa['cl-cp-fiscal'], '56530');
});

test('buildPreFillMap returns delivery fields', () => {
  const datos = {
    razonSocial: 'PELTRE NACIONAL SA DE CV',
    rfc: 'PNA010101AAA',
    cp: '56530',
    calle: 'AVENIDA PRINCIPAL',
    numInt: 'B',
    colonia: 'CENTRO',
    municipio: 'IXTAPALUCA',
    estado: 'ESTADO DE MEXICO',
    nombreCorto: 'PELTRE NACIONAL',
  };

  const mapa = buildPreFillMap(datos);

  assert.equal(mapa['cl-calle'], 'AVENIDA PRINCIPAL');
  assert.equal(mapa['cl-num-int'], 'B');
  assert.equal(mapa['cl-colonia'], 'CENTRO');
  assert.equal(mapa['cl-cp-entrega'], '56530');
  assert.equal(mapa['cl-municipio'], 'IXTAPALUCA');
  assert.equal(mapa['cl-estado'], 'ESTADO DE MEXICO');
});

test('buildPreFillMap does not set cl-nombre-corto (comes from Operam)', () => {
  const datos = {
    razonSocial: 'EMPRESA SA DE CV',
    rfc: 'EMP010101BBB',
    cp: '01234',
    calle: '',
    numInt: '',
    colonia: '',
    municipio: '',
    estado: '',
    nombreCorto: 'EMPRESA',
  };

  const mapa = buildPreFillMap(datos);

  assert.ok(!('cl-nombre-corto' in mapa), 'cl-nombre-corto should not be in the map');
});

test('buildPreFillMap handles partial datos gracefully', () => {
  const datos = {
    razonSocial: 'SOLO RAZON SOCIAL',
    rfc: 'SRS010101CCC',
    cp: '',
    calle: '',
    numInt: '',
    colonia: '',
    municipio: '',
    estado: '',
  };

  const mapa = buildPreFillMap(datos);

  assert.equal(mapa['cl-razon-social'], 'SOLO RAZON SOCIAL');
  assert.equal(mapa['cl-rfc'], 'SRS010101CCC');
  assert.equal(mapa['cl-cp-fiscal'], '');
});
