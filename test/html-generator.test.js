import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateQuoteHTML } from '../lib/html-generator.js';

test('1. generateQuoteHTML({}) returns a string containing "COTIZACION"', () => {
  const html = generateQuoteHTML({});
  assert.ok(typeof html === 'string', 'should return a string');
  assert.ok(html.includes('COTIZACION'), 'should contain "COTIZACION"');
});

test('2. HTML includes company RFC "PNA170810CF1" and phone number', () => {
  const html = generateQuoteHTML({});
  assert.ok(html.includes('PNA170810CF1'), 'should contain RFC PNA170810CF1');
  assert.ok(html.includes('(55)43976785') || html.includes('(55) 4397 6785') || html.includes('5543976785'), 'should contain phone (55)43976785');
});

test('3. Tabla comercial includes all 5 headers', () => {
  const html = generateQuoteHTML({});
  assert.ok(html.includes('Referencia del Cliente'), 'should contain "Referencia del Cliente"');
  assert.ok(html.includes('Representante de Ventas'), 'should contain "Representante de Ventas"');
  assert.ok(html.includes('R.F.C.'), 'should contain "R.F.C."');
  assert.ok(html.includes('Cotizaci'), 'should contain "Nº Cotización"');
  assert.ok(html.includes('Valido hasta'), 'should contain "Valido hasta"');
});

test('4. "Terminos de Pago" appears as text outside the products table', () => {
  const html = generateQuoteHTML({ condicionesPago: '30 dias' });
  assert.ok(html.includes('rminos de Pago'), 'should contain "Terminos de Pago"');
  assert.ok(html.includes('30 dias'), 'should contain the payment condition value');
});

test('5. Product table quantity header is "Ctdad" not "Cant."', () => {
  const html = generateQuoteHTML({});
  assert.ok(html.includes('Ctdad'), 'should contain "Ctdad"');
  assert.ok(!html.includes('Cant.'), 'should NOT contain "Cant."');
});

test('6. Sub-Total [N] uses sum of quantities, not item count', () => {
  const html = generateQuoteHTML({
    items: [
      { codigo: 'A001', descripcion: 'Item A', cantidad: 3, precio: 100 },
      { codigo: 'B002', descripcion: 'Item B', cantidad: 2, precio: 200 },
    ],
  });
  assert.ok(html.includes('Sub-Total [5]'), 'should contain "Sub-Total [5]" (3+2=5)');
  assert.ok(!html.includes('Sub-Total [2]'), 'should NOT contain "Sub-Total [2]" (item count)');
});

test('7. Footer contains bank info: "Banco: Banorte" and CLABE', () => {
  const html = generateQuoteHTML({});
  assert.ok(html.includes('Banco: Banorte'), 'should contain "Banco: Banorte"');
  assert.ok(html.includes('002180700947054340'), 'should contain CLABE 002180700947054340');
});
