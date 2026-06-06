'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildAltaDomicilioPayload, validarAltaDomicilio } = require('./helpers.cjs');

test('E1: buildAltaDomicilioPayload extrae todos los campos de entrega', () => {
  const vals = {
    'alta-br-name': 'Almacen Central',
    'alta-br-ref': 'ALMCEN',
    'alta-addr-street': 'Reforma',
    'alta-addr-exterior': '100',
    'alta-addr-interior': '2A',
    'alta-addr-colony': 'Juarez',
    'alta-addr-zip': '06600',
    'alta-addr-city': 'Cuauhtemoc',
    'alta-addr-state': 'CDMX',
    'alta-pais': 'MX',
    'alta-addr-phone': '5512345678',
    'alta-addr-reference': 'Entre Insurgentes y Liverpool',
    'alta-addr-email': 'entrega@empresa.com',
  };
  const getVal = (id) => vals[id] || '';
  const payload = buildAltaDomicilioPayload(getVal);
  assert.strictEqual(payload.br_name, 'Almacen Central');
  assert.strictEqual(payload.br_ref, 'ALMCEN');
  assert.strictEqual(payload.addr_street, 'Reforma');
  assert.strictEqual(payload.addr_exterior, '100');
  assert.strictEqual(payload.addr_interior, '2A');
  assert.strictEqual(payload.addr_colony, 'Juarez');
  assert.strictEqual(payload.addr_zip, '06600');
  assert.strictEqual(payload.addr_city, 'Cuauhtemoc');
  assert.strictEqual(payload.addr_state, 'CDMX');
  assert.strictEqual(payload.pais, 'MX');
  assert.strictEqual(payload.phone, '5512345678');
  assert.strictEqual(payload.addr_reference, 'Entre Insurgentes y Liverpool');
  assert.strictEqual(payload.email, 'entrega@empresa.com');
});

test('E2: buildAltaDomicilioPayload con campos vacios retorna strings vacios', () => {
  const getVal = () => '';
  const payload = buildAltaDomicilioPayload(getVal);
  assert.strictEqual(payload.br_name, '');
  assert.strictEqual(payload.addr_zip, '');
  assert.strictEqual(payload.pais, '');
});

test('E3: validarAltaDomicilio retorna null cuando campos requeridos estan presentes', () => {
  const getVal = (id) => {
    if (id === 'alta-br-name') return 'Almacen';
    if (id === 'alta-br-ref') return 'ALM';
    if (id === 'alta-addr-street') return 'Reforma';
    if (id === 'alta-addr-zip') return '06600';
    if (id === 'alta-addr-city') return 'CDMX';
    if (id === 'alta-addr-state') return 'CDMX';
    return '';
  };
  const err = validarAltaDomicilio(getVal);
  assert.strictEqual(err, null, 'no debe haber error con campos requeridos presentes');
});

test('E4: validarAltaDomicilio retorna error cuando falta br_name', () => {
  const getVal = (id) => {
    if (id === 'alta-br-ref') return 'ALM';
    if (id === 'alta-addr-street') return 'Reforma';
    if (id === 'alta-addr-zip') return '06600';
    if (id === 'alta-addr-city') return 'CDMX';
    if (id === 'alta-addr-state') return 'CDMX';
    return '';
  };
  const err = validarAltaDomicilio(getVal);
  assert.ok(err, 'debe retornar error cuando falta br_name');
  assert.ok(typeof err === 'string');
});

test('E5: validarAltaDomicilio retorna error cuando falta br_ref', () => {
  const getVal = (id) => {
    if (id === 'alta-br-name') return 'Almacen';
    if (id === 'alta-addr-street') return 'Reforma';
    if (id === 'alta-addr-zip') return '06600';
    if (id === 'alta-addr-city') return 'CDMX';
    if (id === 'alta-addr-state') return 'CDMX';
    return '';
  };
  const err = validarAltaDomicilio(getVal);
  assert.ok(err, 'debe retornar error cuando falta br_ref');
});
