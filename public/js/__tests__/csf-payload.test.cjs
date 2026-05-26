'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildEntregaPayload, buildCsfPayload } = require('./helpers.cjs');

test('buildCsfPayload includes entrega sub-object', () => {
  const datos = {
    razonSocial: 'PELTRE NACIONAL SA DE CV',
    rfc: 'PNA010101AAA',
    idcif: '12345',
    calle: 'AVENIDA PRINCIPAL',
    numExt: '10',
    numInt: 'B',
    colonia: 'CENTRO',
    cp: '56530',
    municipio: 'IXTAPALUCA',
    estado: 'ESTADO DE MEXICO',
    regimenFiscal: '601',
    nombreCorto: 'PELTRE NACIONAL',
  };
  const fields = {
    'cl-nombre-entrega': 'BODEGA CENTRAL',
    'cl-calle': 'CALLE DOS',
    'cl-num-int': '',
    'cl-colonia': 'COL NORTE',
    'cl-cp-entrega': '56530',
    'cl-municipio': 'IXTAPALUCA',
    'cl-estado': 'ESTADO DE MEXICO',
    'cl-cel-entrega': '5559876543',
    'cl-email-entrega': 'bodega@empresa.com',
  };
  const getVal = (id) => fields[id] || '';
  const userId = '42';

  const payload = buildCsfPayload(datos, getVal, userId);

  assert.ok(payload.entrega, 'payload should have entrega key');
  assert.equal(payload.entrega.br_name, 'BODEGA CENTRAL');
  assert.equal(payload.entrega.addr_street, 'CALLE DOS');
  assert.equal(payload.entrega.addr_zip, '56530');
  assert.equal(payload.entrega.phone, '5559876543');
  assert.equal(payload.entrega.email, 'bodega@empresa.com');
});

test('buildCsfPayload includes billing fields', () => {
  const datos = {
    razonSocial: 'EMPRESA SA DE CV',
    rfc: 'EMP010101BBB',
    idcif: '',
    calle: 'CALLE',
    numExt: '1',
    numInt: '',
    colonia: 'COL',
    cp: '01234',
    municipio: 'CIUDAD',
    estado: 'ESTADO',
    regimenFiscal: '612',
    nombreCorto: 'EMPRESA',
  };
  const getVal = () => '';
  const userId = '1';

  const payload = buildCsfPayload(datos, getVal, userId);

  assert.equal(payload.CustName, 'EMPRESA SA DE CV');
  assert.equal(payload.tax_id, 'EMP010101BBB');
  assert.equal(payload.fuente, 'cotizador');
  assert.equal(payload.salesman, '1');
});

test('buildCsfPayload entrega has all expected keys', () => {
  const datos = {
    razonSocial: 'X',
    rfc: 'X',
    idcif: '',
    calle: '',
    numExt: '',
    numInt: '',
    colonia: '',
    cp: '',
    municipio: '',
    estado: '',
    regimenFiscal: '',
    nombreCorto: '',
  };
  const getVal = () => '';

  const payload = buildCsfPayload(datos, getVal, '1');

  const expectedKeys = ['br_name', 'addr_street', 'addr_interior', 'addr_colony', 'addr_zip', 'addr_city', 'addr_state', 'phone', 'email'];
  assert.deepEqual(Object.keys(payload.entrega).sort(), expectedKeys.sort());
});
