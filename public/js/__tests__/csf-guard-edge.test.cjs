'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { findRfcMatch, buildClienteSnapshot, buildCsfDuplicadoBanner, buildOperamPreFillMap } = require('./helpers.cjs');

const CSF_FORM_FIELD_IDS = [
  'cl-razon-social', 'cl-nombre-corto', 'cl-rfc', 'cl-cp-fiscal', 'cl-telefono',
  'cl-nombre-entrega', 'cl-calle', 'cl-num-int', 'cl-colonia', 'cl-cp-entrega',
  'cl-municipio', 'cl-estado', 'cl-cel-entrega', 'cl-email-entrega',
];

test('buildClienteSnapshot captures all CSF_FORM_FIELD_IDS', () => {
  const values = {
    'cl-razon-social': 'EMPRESA SA DE CV',
    'cl-nombre-corto': 'EMPRESA',
    'cl-rfc': 'EMP010101AAA',
    'cl-cp-fiscal': '56530',
    'cl-telefono': '5551234567',
    'cl-nombre-entrega': 'ALMACEN',
    'cl-calle': 'CALLE 1',
    'cl-num-int': '',
    'cl-colonia': 'COLONIA',
    'cl-cp-entrega': '56530',
    'cl-municipio': 'IXTAPALUCA',
    'cl-estado': 'ESTADO DE MEXICO',
    'cl-cel-entrega': '5559876543',
    'cl-email-entrega': 'correo@empresa.com',
  };
  const getVal = (id) => values[id] !== undefined ? values[id] : '';

  const snap = buildClienteSnapshot(CSF_FORM_FIELD_IDS, getVal);

  assert.equal(Object.keys(snap).length, CSF_FORM_FIELD_IDS.length);
  assert.equal(snap['cl-razon-social'], 'EMPRESA SA DE CV');
  assert.equal(snap['cl-nombre-corto'], 'EMPRESA');
  assert.equal(snap['cl-email-entrega'], 'correo@empresa.com');
});

test('findRfcMatch does not return partial RFC match', () => {
  const clientes = [
    { id: 1, name: 'EMPRESA A', rfc: 'EMA010101AAA123' },
  ];
  // Searching shorter RFC should not match
  const result = findRfcMatch(clientes, 'EMA010101AAA');
  assert.equal(result, null);
});

test('buildCsfDuplicadoBanner text does not contain Unicode dashes', () => {
  const cliente = { id: 7, name: 'EMPRESA TEST' };
  const banner = buildCsfDuplicadoBanner(cliente);
  // Must use ASCII double-dash, not em-dash
  assert.ok(!banner.includes('—'), 'should not contain em-dash');
  assert.ok(!banner.includes('–'), 'should not contain en-dash');
});

test('buildOperamPreFillMap does not overwrite cl-pais', () => {
  const cliente = {
    id: 1, name: 'X', ref: 'X', rfc: 'X', cp: '', telefono: '',
    nombreEntrega: '', calle: '', numInt: '', colonia: '',
    municipio: '', estado: '', email: '',
  };
  const mapa = buildOperamPreFillMap(cliente);
  assert.ok(!('cl-pais' in mapa), 'cl-pais should not be overwritten by buildOperamPreFillMap');
});

test('csfClienteExistente snapshot shape: has id, nombre, snapshot keys', () => {
  // Simulate the state object set in procesarCSF when match found
  const match = { id: 42, name: 'PELTRE NACIONAL SA DE CV', rfc: 'PNA010101AAA' };
  const getVal = () => '';
  const snap = buildClienteSnapshot(CSF_FORM_FIELD_IDS, getVal);
  const csfClienteExistente = { id: match.id, nombre: match.name, snapshot: snap };

  assert.equal(csfClienteExistente.id, 42);
  assert.equal(csfClienteExistente.nombre, 'PELTRE NACIONAL SA DE CV');
  assert.ok(typeof csfClienteExistente.snapshot === 'object');
  assert.ok('cl-rfc' in csfClienteExistente.snapshot);
});
