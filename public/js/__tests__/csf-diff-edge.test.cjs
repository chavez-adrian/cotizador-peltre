'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { calcularDiff, buildConfirmacionItems } = require('./helpers.cjs');

const CSF_FORM_FIELD_IDS = [
  'cl-razon-social', 'cl-nombre-corto', 'cl-rfc', 'cl-cp-fiscal', 'cl-telefono',
  'cl-nombre-entrega', 'cl-calle', 'cl-num-int', 'cl-colonia', 'cl-cp-entrega',
  'cl-municipio', 'cl-estado', 'cl-cel-entrega', 'cl-email-entrega',
];

test('calcularDiff con snapshot de CSF_FORM_FIELD_IDS detecta solo campos modificados', () => {
  const snapshot = {};
  for (const id of CSF_FORM_FIELD_IDS) snapshot[id] = '';
  snapshot['cl-razon-social'] = 'EMPRESA ORIGINAL SA DE CV';
  snapshot['cl-municipio'] = 'IXTAPALUCA';

  const formValues = { ...snapshot };
  formValues['cl-razon-social'] = 'EMPRESA MODIFICADA SA DE CV';
  // municipio no cambia

  const diff = calcularDiff(snapshot, formValues);

  assert.equal(Object.keys(diff).length, 1, 'solo debe haber 1 campo modificado');
  assert.ok('cl-razon-social' in diff);
  assert.equal(diff['cl-razon-social'].anterior, 'EMPRESA ORIGINAL SA DE CV');
  assert.equal(diff['cl-razon-social'].nuevo, 'EMPRESA MODIFICADA SA DE CV');
});

test('calcularDiff: ninguna modificacion retorna objeto vacio para todos los CSF_FORM_FIELD_IDS', () => {
  const snapshot = {};
  for (const id of CSF_FORM_FIELD_IDS) snapshot[id] = 'valor de prueba';

  const formValues = { ...snapshot };

  const diff = calcularDiff(snapshot, formValues);

  assert.deepEqual(diff, {});
});

test('buildConfirmacionItems: todos los CSF_FORM_FIELD_IDS tienen label legible', () => {
  const diff = {};
  for (const id of CSF_FORM_FIELD_IDS) {
    diff[id] = { anterior: 'A', nuevo: 'B' };
  }

  const items = buildConfirmacionItems(diff);

  for (const item of items) {
    assert.ok(item.label, 'label debe existir para ' + item.fieldId);
    assert.notEqual(item.label, item.fieldId, 'label debe ser diferente del fieldId para ' + item.fieldId);
  }
});

test('calcularDiff: email vacio y null se tratan igual', () => {
  const snapshot = { 'cl-email-entrega': null };
  const formValues = { 'cl-email-entrega': '' };

  const diff = calcularDiff(snapshot, formValues);

  assert.deepEqual(diff, {}, 'null y empty string no deben producir diff');
});

test('buildConfirmacionItems: mantiene orden de campos del diff', () => {
  const diff = {
    'cl-calle': { anterior: 'CALLE A', nuevo: 'CALLE B' },
    'cl-colonia': { anterior: 'COL A', nuevo: 'COL B' },
  };

  const items = buildConfirmacionItems(diff);

  assert.equal(items[0].fieldId, 'cl-calle');
  assert.equal(items[1].fieldId, 'cl-colonia');
});
