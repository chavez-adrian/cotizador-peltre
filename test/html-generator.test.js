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

test('8. Header shows company email, not website URL', () => {
  const html = generateQuoteHTML({});
  assert.ok(html.includes('contacto@pppeltre.mx'), 'should show email contacto@pppeltre.mx');
  assert.ok(!html.includes('e-Mail: www.'), 'should NOT show website URL as e-Mail');
});

test('9. Logo img tag is embedded as data URL (works in blob context)', () => {
  const html = generateQuoteHTML({});
  assert.ok(html.includes('data:image/png;base64,'), 'logo should be embedded as base64 data URL');
});

test('10. Datos de Facturacion shows cpFiscal when provided', () => {
  const html = generateQuoteHTML({ cliente: { razonSocial: 'Test SA', rfc: 'TST010101AAA', cpFiscal: '06600' } });
  assert.ok(html.includes('06600'), 'cpFiscal should appear in billing section');
});

test('11. Datos de entrega shows celEntrega and emailEntrega on same line (formato Operam)', () => {
  const html = generateQuoteHTML({
    cliente: { celEntrega: '55 1234 5678', emailEntrega: 'cliente@test.com' },
  });
  assert.ok(html.includes('55 1234 5678'), 'celEntrega should appear');
  assert.ok(html.includes('cliente@test.com'), 'emailEntrega should appear');
  // Telefono y Correo deben aparecer en el mismo bloque de linea (formato Operam)
  assert.ok(html.includes('fono:'), 'should have Telefono/Teléfono label');
  assert.ok(html.includes('Correo:'), 'should have Correo label');
});

test('12. Numeric product columns use class="num" for right-alignment', () => {
  const html = generateQuoteHTML({
    items: [{ codigo: 'A001', descripcion: 'Item', cantidad: 5, unidad: 'pza', precio: 100, descuento: 0 }],
  });
  assert.ok(html.includes('class="num"'), 'numeric cells should have class="num"');
  assert.ok(html.includes('td-code'), 'codigo column should have class td-code');
});

test('13. Total row has class total-row for bold styling', () => {
  const html = generateQuoteHTML({ subtotal: 100, iva: 16, total: 116 });
  assert.ok(html.includes('class="total-row"'), 'TOTAL row should have class total-row');
  assert.ok(html.includes('>TOTAL<'), 'TOTAL label should be present');
});

test('14. (#71 AC1) leyendaDomicilio se pinta en datos de entrega cuando esta presente', () => {
  const html = generateQuoteHTML({ cliente: { cpEntrega: '06600', leyendaDomicilio: 'Favor de confirmar el domicilio de entrega' } });
  assert.ok(html.includes('Favor de confirmar el domicilio de entrega'), 'should contain la leyenda de domicilio');
});

test('15. (#71 AC1) sin leyendaDomicilio no se inventa la leyenda', () => {
  const html = generateQuoteHTML({ cliente: { calle: 'Reforma 100', cpEntrega: '06600' } });
  assert.ok(!html.includes('Favor de confirmar el domicilio de entrega'), 'should NOT contain la leyenda cuando hay calle');
});

// === #84 AC4: entrega ausente/parcial/completa, sin secciones vacias ni "undefined" ===

test('16. (#84) entrega totalmente ausente -> HTML sin "undefined", con la leyenda', () => {
  const html = generateQuoteHTML({ cliente: { razonSocial: 'Cliente Test', leyendaDomicilio: 'Favor de confirmar el domicilio de entrega' } });
  assert.ok(!html.includes('undefined'), 'no debe imprimir "undefined"');
  assert.ok(html.includes('Favor de confirmar el domicilio de entrega'), 'debe traer la leyenda de confirmacion');
});

test('17. (#84) entrega parcial (solo CP) -> muestra el CP y la leyenda, sin "undefined"', () => {
  const html = generateQuoteHTML({ cliente: { cpEntrega: '06600', leyendaDomicilio: 'Favor de confirmar el domicilio de entrega' } });
  assert.ok(html.includes('06600'), 'debe mostrar el CP capturado');
  assert.ok(html.includes('Favor de confirmar el domicilio de entrega'), 'debe traer la leyenda de confirmacion');
  assert.ok(!html.includes('undefined'), 'no debe imprimir "undefined"');
});

test('18. (#84) entrega parcial (solo ciudad/municipio) -> muestra el municipio y la leyenda', () => {
  const html = generateQuoteHTML({ cliente: { municipio: 'Puebla', leyendaDomicilio: 'Favor de confirmar el domicilio de entrega' } });
  assert.ok(html.includes('Puebla'), 'debe mostrar el municipio capturado');
  assert.ok(html.includes('Favor de confirmar el domicilio de entrega'), 'debe traer la leyenda de confirmacion');
  assert.ok(!html.includes('undefined'), 'no debe imprimir "undefined"');
});

test('19. (#84) entrega completa -> no imprime la leyenda de confirmacion', () => {
  const html = generateQuoteHTML({ cliente: { calle: 'Reforma 100', cpEntrega: '06600', municipio: 'CDMX', leyendaDomicilio: '' } });
  assert.ok(!html.includes('Favor de confirmar el domicilio de entrega'), 'no debe traer la leyenda cuando la entrega esta completa');
  assert.ok(!html.includes('undefined'), 'no debe imprimir "undefined"');
});
