'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildPaisConfig } = require('./helpers.cjs');

test('buildPaisConfig: MX retorna country MX, curr_code MXN, area_pais 1', () => {
  const config = buildPaisConfig('MX');
  assert.equal(config.country, 'MX');
  assert.equal(config.curr_code, 'MXN');
  assert.equal(config.area_pais, '1');
});

test('buildPaisConfig: US retorna country US, curr_code USD, area_pais 5', () => {
  const config = buildPaisConfig('US');
  assert.equal(config.country, 'US');
  assert.equal(config.curr_code, 'USD');
  assert.equal(config.area_pais, '5');
});

test('buildPaisConfig: CA retorna country CA, curr_code USD, area_pais 7', () => {
  const config = buildPaisConfig('CA');
  assert.equal(config.country, 'CA');
  assert.equal(config.curr_code, 'USD');
  assert.equal(config.area_pais, '7');
});

test('buildPaisConfig: otro retorna curr_code USD, area_pais 6', () => {
  const config = buildPaisConfig('DE');
  assert.equal(config.country, 'DE');
  assert.equal(config.curr_code, 'USD');
  assert.equal(config.area_pais, '6');
});
