'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { calcularDiff, buildConfirmacionItems } = require('./helpers.cjs');

test('buildConfirmacionItems: retorna array de items con label, anterior y nuevo', () => {
  const diff = {
    'cl-municipio': { anterior: 'GUADALAJARA', nuevo: 'ZAPOPAN' },
    'cl-cp-fiscal': { anterior: '44100', nuevo: '45100' },
  };

  const items = buildConfirmacionItems(diff);

  assert.ok(Array.isArray(items), 'debe retornar array');
  assert.equal(items.length, 2, 'debe tener 2 items');
  const municipioItem = items.find(i => i.fieldId === 'cl-municipio');
  assert.ok(municipioItem, 'debe incluir cl-municipio');
  assert.ok(municipioItem.label, 'item debe tener label');
  assert.equal(municipioItem.anterior, 'GUADALAJARA');
  assert.equal(municipioItem.nuevo, 'ZAPOPAN');
});

test('buildConfirmacionItems: usa nombre legible para campos conocidos', () => {
  const diff = {
    'cl-razon-social': { anterior: 'EMPRESA A', nuevo: 'EMPRESA B' },
  };

  const items = buildConfirmacionItems(diff);

  assert.equal(items.length, 1);
  assert.ok(items[0].label.length > 0, 'label debe ser no vacio');
  assert.notEqual(items[0].label, 'cl-razon-social', 'label no debe ser el field ID');
});

test('buildConfirmacionItems: usa field ID como fallback si no hay label conocido', () => {
  const diff = {
    'campo-desconocido': { anterior: 'A', nuevo: 'B' },
  };

  const items = buildConfirmacionItems(diff);

  assert.equal(items.length, 1);
  assert.equal(items[0].label, 'campo-desconocido');
});

test('buildConfirmacionItems: retorna array vacio para diff vacio', () => {
  const items = buildConfirmacionItems({});
  assert.deepEqual(items, []);
});

test('calcularDiff + buildConfirmacionItems: flujo completo', () => {
  const snapshot = { 'cl-razon-social': 'EMPRESA A', 'cl-municipio': 'GDL' };
  const formValues = { 'cl-razon-social': 'EMPRESA B', 'cl-municipio': 'GDL' };

  const diff = calcularDiff(snapshot, formValues);
  const items = buildConfirmacionItems(diff);

  assert.equal(items.length, 1);
  assert.equal(items[0].anterior, 'EMPRESA A');
  assert.equal(items[0].nuevo, 'EMPRESA B');
});
