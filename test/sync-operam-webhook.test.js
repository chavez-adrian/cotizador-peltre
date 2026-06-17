import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extraerIdentificador, claveEvento } from '../lib/sync-operam-webhook.js';

// Extraccion defensiva del identificador del payload de webhook de Operam y clave
// idempotente del evento (issue #62, F3). El formato exacto del webhook aun no se
// captura; estas funciones toleran varias formas/anidamientos.

test('extraerIdentificador: lee order_ del payload raiz', () => {
  const id = extraerIdentificador({ order_: '7077', tax_id: 'CPE921211N76', debtor_no: '345' });
  assert.equal(id.order, '7077');
  assert.equal(id.rfc, 'CPE921211N76');
  assert.equal(id.customerId, '345');
});

test('extraerIdentificador: lee order_no anidado en data', () => {
  const id = extraerIdentificador({ model: 'Pedido', event: 'ADD', data: { order_no: '7230', debtor_no: '345' } });
  assert.equal(id.order, '7230');
  assert.equal(id.customerId, '345');
  assert.equal(id.modelo, 'Pedido');
  assert.equal(id.evento, 'ADD');
});

test('extraerIdentificador: order_=0 (pago/nota credito) no cuenta como order resoluble', () => {
  const id = extraerIdentificador({ type: '12', order_: '0', tax_id: 'ABC010101AAA' });
  assert.equal(id.order, null);
  assert.equal(id.rfc, 'ABC010101AAA');
});

test('extraerIdentificador: payload vacio o no objeto devuelve todo null', () => {
  const vacio = extraerIdentificador(null);
  assert.equal(vacio.order, null);
  assert.equal(vacio.rfc, null);
  assert.equal(vacio.customerId, null);
});

test('claveEvento: usa el id externo cuando viene (idempotencia por evento)', () => {
  const k1 = claveEvento({ model: 'Payment', event: 'ADD', id: 'evt-99', order_: '7077' });
  const k2 = claveEvento({ model: 'Payment', event: 'ADD', id: 'evt-99', order_: '7077' });
  assert.equal(k1, k2); // mismo evento -> misma clave
  assert.ok(k1.includes('evt-99'));
});

test('claveEvento: sin id externo deriva una clave estable de modelo+evento+identificador', () => {
  const k = claveEvento({ model: 'CustDelivery', event: 'ADD', order_: '7077' });
  assert.ok(k.includes('CustDelivery'));
  assert.ok(k.includes('7077'));
  // Estable: dos llamadas iguales -> misma clave.
  assert.equal(k, claveEvento({ model: 'CustDelivery', event: 'ADD', order_: '7077' }));
});

test('claveEvento: eventos distintos producen claves distintas', () => {
  const a = claveEvento({ model: 'Payment', event: 'ADD', trans_no: '6735' });
  const b = claveEvento({ model: 'Payment', event: 'ADD', trans_no: '6800' });
  assert.notEqual(a, b);
});
