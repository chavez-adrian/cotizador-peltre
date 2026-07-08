import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateQuotePDF } from '../lib/pdf-generator.js';

// PDFKit encodes strings as hex in TJ operators with kerning splits.
// _compress:false disables FlateDecode so the content stream is human-readable.
// Use toHex() to convert literal strings to searchable hex substrings.
function toHex(s) {
  return Buffer.from(s, 'latin1').toString('hex');
}

test('B1: generateQuotePDF retorna un Buffer', async () => {
  const result = await generateQuotePDF({});
  assert.ok(Buffer.isBuffer(result));
  assert.ok(result.length > 0);
});

test('B2: el buffer es un PDF valido (empieza con %PDF)', async () => {
  const result = await generateQuotePDF({});
  assert.equal(result.slice(0, 4).toString(), '%PDF');
});

test('B3: el PDF contiene el texto COTIZACION', async () => {
  const result = await generateQuotePDF({ _compress: false });
  const text = result.toString('latin1');
  // PDFKit kern-splits COTIZACION; TIZA and CION are reliable contiguous chunks
  const found = text.includes(toHex('TIZA')) || text.includes(toHex('CION'));
  assert.ok(found, 'No encontrado "COTIZACION" en el PDF');
});

test('B4: el PDF contiene RFC de la empresa PNA170810CF1', async () => {
  const result = await generateQuotePDF({ _compress: false, cliente: {} });
  const text = result.toString('latin1');
  // PNA170810CF1 is alphanumeric — stored as one contiguous hex block
  assert.ok(text.includes(toHex('PNA170810CF1')), 'RFC no encontrado en el PDF');
});

test('B5: el PDF contiene datos bancarios de Banorte', async () => {
  const result = await generateQuotePDF({ _compress: false });
  const text = result.toString('latin1');
  // PDFKit kern-splits "Banorte" between 'r' and 't'; "Banor" is a reliable prefix
  assert.ok(text.includes(toHex('Banor')), '"Banorte" no encontrado en el PDF');
});

test('B6: (#71 AC1) el PDF pinta leyendaDomicilio cuando esta presente', async () => {
  const result = await generateQuotePDF({
    _compress: false,
    cliente: { cpEntrega: '06600', leyendaDomicilio: 'Favor de confirmar el domicilio de entrega' },
  });
  const text = result.toString('latin1');
  // PDFKit kern-splittea "confirmar"; "domicilio" es una palabra contigua fiable de la leyenda
  assert.ok(text.includes(toHex('domicilio')), 'leyenda de domicilio no encontrada en el PDF');
});

// === #84 AC4: entrega ausente/parcial/completa, sin secciones vacias ni "undefined" ===

test('B7: (#84) entrega totalmente ausente -> PDF sin "undefined", con la leyenda', async () => {
  const result = await generateQuotePDF({
    _compress: false,
    cliente: { razonSocial: 'Cliente Test', leyendaDomicilio: 'Favor de confirmar el domicilio de entrega' },
  });
  const text = result.toString('latin1');
  assert.ok(!text.includes(toHex('undefined')), 'no debe imprimir "undefined"');
  assert.ok(text.includes(toHex('domicilio')), 'debe traer la leyenda de confirmacion');
});

test('B8: (#84) entrega parcial (solo CP) -> muestra el CP y la leyenda, sin "undefined"', async () => {
  const result = await generateQuotePDF({
    _compress: false,
    cliente: { cpEntrega: '06600', leyendaDomicilio: 'Favor de confirmar el domicilio de entrega' },
  });
  const text = result.toString('latin1');
  assert.ok(text.includes(toHex('06600')), 'debe mostrar el CP capturado');
  assert.ok(text.includes(toHex('domicilio')), 'debe traer la leyenda de confirmacion');
  assert.ok(!text.includes(toHex('undefined')), 'no debe imprimir "undefined"');
});

test('B9: (#84) entrega parcial (solo ciudad/municipio) -> muestra el municipio y la leyenda', async () => {
  const result = await generateQuotePDF({
    _compress: false,
    cliente: { municipio: 'Puebla', leyendaDomicilio: 'Favor de confirmar el domicilio de entrega' },
  });
  const text = result.toString('latin1');
  // PDFKit kern-splits "Puebla" entre 'b' y 'l'; "Pueb" es un prefijo contiguo fiable
  assert.ok(text.includes(toHex('Pueb')), 'debe mostrar el municipio capturado');
  assert.ok(text.includes(toHex('domicilio')), 'debe traer la leyenda de confirmacion');
  assert.ok(!text.includes(toHex('undefined')), 'no debe imprimir "undefined"');
});

test('B10: (#84) entrega completa -> no imprime la leyenda de confirmacion', async () => {
  const result = await generateQuotePDF({
    _compress: false,
    cliente: { calle: 'Reforma 100', cpEntrega: '06600', municipio: 'CDMX', leyendaDomicilio: '' },
  });
  const text = result.toString('latin1');
  assert.ok(!text.includes(toHex('domicilio')), 'no debe traer la leyenda cuando la entrega esta completa');
  assert.ok(!text.includes(toHex('undefined')), 'no debe imprimir "undefined"');
});
