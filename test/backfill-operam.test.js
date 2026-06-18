import { test } from 'node:test';
import assert from 'node:assert/strict';

import { esCandidatoBackfill } from '../lib/backfill-operam.mjs';

// Backfill de cotizaciones reales via pedidos (issue #76). Funciones PURAS;
// el script scripts/backfill-operam.mjs las orquesta con IO inyectada. Sin
// llamadas a Operam real aqui (mocks / datos crudos).

// --- esCandidatoBackfill: filtro de pedidos que representan una cotizacion ---

test('esCandidatoBackfill: pedido con trans_no_from no vacio es candidato', () => {
  assert.equal(esCandidatoBackfill({ order_no: '7269', trans_no_from: '1141', debtor_no: '394' }), true);
});

test('esCandidatoBackfill: venta directa (trans_no_from vacio) NO es candidato', () => {
  assert.equal(esCandidatoBackfill({ order_no: '8000', trans_no_from: '', debtor_no: '500' }), false);
  assert.equal(esCandidatoBackfill({ order_no: '8001', trans_no_from: null, debtor_no: '500' }), false);
  assert.equal(esCandidatoBackfill({ order_no: '8002', debtor_no: '500' }), false);
});

test('esCandidatoBackfill: excluye el pedido de prueba 7270 (sonda de #67)', () => {
  assert.equal(esCandidatoBackfill({ order_no: '7270', trans_no_from: '1163', debtor_no: '394' }), false);
  // tolera order_no numerico ademas de string
  assert.equal(esCandidatoBackfill({ order_no: 7270, trans_no_from: '1163', debtor_no: 394 }), false);
});

test('esCandidatoBackfill: excluye debtors de prueba PUBLICO EN GENERAL (14) y 1', () => {
  assert.equal(esCandidatoBackfill({ order_no: '8100', trans_no_from: '1200', debtor_no: '14' }), false);
  assert.equal(esCandidatoBackfill({ order_no: '8101', trans_no_from: '1201', debtor_no: 14 }), false);
  assert.equal(esCandidatoBackfill({ order_no: '8102', trans_no_from: '1202', debtor_no: '1' }), false);
  assert.equal(esCandidatoBackfill({ order_no: '8103', trans_no_from: '1203', debtor_no: 1 }), false);
});

test('esCandidatoBackfill: pedido nulo o sin order_no no es candidato', () => {
  assert.equal(esCandidatoBackfill(null), false);
  assert.equal(esCandidatoBackfill(undefined), false);
  assert.equal(esCandidatoBackfill({ trans_no_from: '1300' }), false);
});
