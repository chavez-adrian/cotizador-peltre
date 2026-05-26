'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildEntregaPayload } = require('./helpers.cjs');

test('buildEntregaPayload returns correct entrega sub-object', () => {
  const fields = {
    'cl-nombre-entrega': 'PELTRE NACIONAL',
    'cl-calle': 'AVENIDA PRINCIPAL',
    'cl-num-int': 'B',
    'cl-colonia': 'COL CENTRO',
    'cl-cp-entrega': '56530',
    'cl-municipio': 'IXTAPALUCA',
    'cl-estado': 'ESTADO DE MEXICO',
    'cl-cel-entrega': '5551234567',
    'cl-email-entrega': 'contacto@empresa.com',
  };
  const getVal = (id) => fields[id] || '';

  const entrega = buildEntregaPayload(getVal);

  assert.equal(entrega.br_name, 'PELTRE NACIONAL');
  assert.equal(entrega.addr_street, 'AVENIDA PRINCIPAL');
  assert.equal(entrega.addr_interior, 'B');
  assert.equal(entrega.addr_colony, 'COL CENTRO');
  assert.equal(entrega.addr_zip, '56530');
  assert.equal(entrega.addr_city, 'IXTAPALUCA');
  assert.equal(entrega.addr_state, 'ESTADO DE MEXICO');
  assert.equal(entrega.phone, '5551234567');
  assert.equal(entrega.email, 'contacto@empresa.com');
});

test('buildEntregaPayload returns empty strings for missing fields', () => {
  const getVal = () => '';

  const entrega = buildEntregaPayload(getVal);

  assert.equal(entrega.br_name, '');
  assert.equal(entrega.addr_street, '');
  assert.equal(entrega.addr_zip, '');
  assert.equal(entrega.email, '');
});

test('buildEntregaPayload object has exactly the expected keys', () => {
  const getVal = () => 'x';

  const entrega = buildEntregaPayload(getVal);
  const expectedKeys = ['br_name', 'addr_street', 'addr_interior', 'addr_colony', 'addr_zip', 'addr_city', 'addr_state', 'phone', 'email'];

  assert.deepEqual(Object.keys(entrega).sort(), expectedKeys.sort());
});
