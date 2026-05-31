'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { shouldTriggerRfcSearch } = require('./helpers.cjs');

test('shouldTriggerRfcSearch returns true for RFC with exactly 12 chars', () => {
  assert.equal(shouldTriggerRfcSearch('PNA010101BBB'), true);
});

test('shouldTriggerRfcSearch returns true for RFC with 13 chars', () => {
  assert.equal(shouldTriggerRfcSearch('PNA010101BBBB'), true);
});

test('shouldTriggerRfcSearch returns false for RFC with 11 chars', () => {
  assert.equal(shouldTriggerRfcSearch('PNA010101BB'), false);
});

test('shouldTriggerRfcSearch returns false for empty string', () => {
  assert.equal(shouldTriggerRfcSearch(''), false);
});

test('shouldTriggerRfcSearch returns false for null', () => {
  assert.equal(shouldTriggerRfcSearch(null), false);
});

test('shouldTriggerRfcSearch returns false for undefined', () => {
  assert.equal(shouldTriggerRfcSearch(undefined), false);
});

test('shouldTriggerRfcSearch trims whitespace before checking length', () => {
  assert.equal(shouldTriggerRfcSearch('  PNA010101BBB  '), true);
  assert.equal(shouldTriggerRfcSearch('  PNA010101B  '), false);
});
