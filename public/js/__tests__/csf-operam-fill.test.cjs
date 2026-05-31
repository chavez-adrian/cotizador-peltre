'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildOperamPreFillMap } = require('./helpers.cjs');

test('buildOperamPreFillMap maps billing fields from Operam cliente', () => {
  const cliente = {
    id: 42,
    name: 'PELTRE NACIONAL SA DE CV',
    ref: 'PELTRE NAC',
    rfc: 'PNA010101AAA',
    cp: '56530',
    telefono: '5551234567',
    nombreEntrega: 'BODEGA PRINCIPAL',
    calle: 'AVENIDA PRINCIPAL',
    numInt: 'B',
    colonia: 'CENTRO',
    municipio: 'IXTAPALUCA',
    estado: 'ESTADO DE MEXICO',
    email: 'ventas@peltre.com',
  };

  const mapa = buildOperamPreFillMap(cliente);

  assert.equal(mapa['cl-razon-social'], 'PELTRE NACIONAL SA DE CV');
  assert.equal(mapa['cl-nombre-corto'], 'PELTRE NAC');
  assert.equal(mapa['cl-rfc'], 'PNA010101AAA');
  assert.equal(mapa['cl-cp-fiscal'], '56530');
  assert.equal(mapa['cl-telefono'], '5551234567');
});

test('buildOperamPreFillMap maps delivery fields from Operam cliente', () => {
  const cliente = {
    id: 99,
    name: 'EMPRESA TEST SA DE CV',
    ref: 'EMPRESA TEST',
    rfc: 'ETE010101BBB',
    cp: '01234',
    telefono: '5559876543',
    nombreEntrega: 'ALMACEN NORTE',
    calle: 'CALLE DOS',
    numInt: '',
    colonia: 'COL SUR',
    municipio: 'CIUDAD DE MEXICO',
    estado: 'CDMX',
    email: 'contacto@empresa.com',
  };

  const mapa = buildOperamPreFillMap(cliente);

  assert.equal(mapa['cl-nombre-entrega'], 'ALMACEN NORTE');
  assert.equal(mapa['cl-calle'], 'CALLE DOS');
  assert.equal(mapa['cl-num-int'], '');
  assert.equal(mapa['cl-colonia'], 'COL SUR');
  assert.equal(mapa['cl-cp-entrega'], '01234');
  assert.equal(mapa['cl-municipio'], 'CIUDAD DE MEXICO');
  assert.equal(mapa['cl-estado'], 'CDMX');
  assert.equal(mapa['cl-cel-entrega'], '5559876543');
  assert.equal(mapa['cl-email-entrega'], 'contacto@empresa.com');
});

test('buildOperamPreFillMap handles missing optional fields gracefully', () => {
  const cliente = {
    id: 1,
    name: 'CLIENTE MINIMO',
    ref: '',
    rfc: 'CMI010101CCC',
    cp: '',
    telefono: '',
    nombreEntrega: '',
    calle: '',
    numInt: '',
    colonia: '',
    municipio: '',
    estado: '',
    email: '',
  };

  const mapa = buildOperamPreFillMap(cliente);

  assert.equal(mapa['cl-razon-social'], 'CLIENTE MINIMO');
  assert.equal(mapa['cl-rfc'], 'CMI010101CCC');
  assert.ok(typeof mapa['cl-cp-fiscal'] !== 'undefined');
});
