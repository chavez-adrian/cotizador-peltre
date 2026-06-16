'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let COLUMNAS_PIPELINE, COLUMNA_LABELS, agruparPipeline, buildTableroPipelineHtml, esSalida;
before(async () => {
  ({ COLUMNAS_PIPELINE, COLUMNA_LABELS, agruparPipeline, buildTableroPipelineHtml, esSalida } =
    await import('../pipeline-logica.js'));
});

// Una oportunidad: antes de cotizar es el prospecto (etapa por_cotizar /
// no_asignado), al cotizar lleva la cotizacion (seguimiento y post-venta). El
// board recibe oportunidades ya con su etapa migrada y las reparte en columnas.
function prospecto(extra) {
  return {
    tipo: 'prospecto', id: 1, nombre: 'Laura', vendedor: 'Memo', celular: '+52 5512345678',
    ciudad: 'Puebla', canal: 'WhatsApp', etapa: 'por_cotizar', total: 0, eventos: [], data: {},
    ...extra,
  };
}
function cotizacion(extra) {
  return {
    tipo: 'cotizacion', id: 10, cliente: 'Hotel Azul', vendedor: 'Memo', total: 5000,
    totalPiezas: 50, etapa: 'seguimiento', fecha: '2026-06-10T00:00:00Z', ...extra,
  };
}

test('Q1: COLUMNAS_PIPELINE son las 7 etapas del embudo en orden (las salidas no son columnas)', () => {
  assert.deepEqual(COLUMNAS_PIPELINE, [
    'no_asignado', 'por_cotizar', 'seguimiento', 'anticipo_pagado',
    'pedido_liberado', 'saldo_pagado', 'producto_entregado',
  ]);
  assert.equal(COLUMNAS_PIPELINE.includes('no_util'), false);
  assert.equal(COLUMNAS_PIPELINE.includes('perdida'), false);
});

test('Q2: COLUMNA_LABELS tiene etiqueta legible para cada columna del embudo', () => {
  assert.equal(COLUMNA_LABELS.no_asignado, 'No Asignado');
  assert.equal(COLUMNA_LABELS.por_cotizar, 'Por Cotizar');
  assert.equal(COLUMNA_LABELS.seguimiento, 'Seguimiento');
  assert.equal(COLUMNA_LABELS.producto_entregado, 'Producto entregado');
  for (const c of COLUMNAS_PIPELINE) assert.ok(COLUMNA_LABELS[c], `falta label ${c}`);
});

test('Q3: agruparPipeline reparte cada oportunidad en la columna de su etapa', () => {
  const cols = agruparPipeline([
    prospecto({ id: 1, etapa: 'por_cotizar' }),
    prospecto({ id: 2, etapa: 'no_asignado' }),
    cotizacion({ id: 10, etapa: 'seguimiento' }),
    cotizacion({ id: 11, etapa: 'anticipo_pagado' }),
  ]);
  assert.deepEqual(cols.por_cotizar.map(o => o.id), [1]);
  assert.deepEqual(cols.no_asignado.map(o => o.id), [2]);
  assert.deepEqual(cols.seguimiento.map(o => o.id), [10]);
  assert.deepEqual(cols.anticipo_pagado.map(o => o.id), [11]);
  for (const c of COLUMNAS_PIPELINE) assert.ok(Array.isArray(cols[c]), `columna faltante ${c}`);
});

test('Q4: agruparPipeline mantiene fuera del tablero las salidas (No util y Perdida)', () => {
  const cols = agruparPipeline([
    prospecto({ id: 1, etapa: 'no_util' }),
    cotizacion({ id: 10, etapa: 'perdida' }),
    prospecto({ id: 2, etapa: 'por_cotizar' }),
  ]);
  for (const c of COLUMNAS_PIPELINE) {
    assert.equal(cols[c].some(o => esSalida(o.etapa)), false, `salida en columna activa ${c}`);
  }
  assert.deepEqual(cols.por_cotizar.map(o => o.id), [2]);
});

test('Q5: buildTableroPipelineHtml pinta las 7 columnas con label, contador y data-etapa', () => {
  const html = buildTableroPipelineHtml([
    prospecto({ id: 1, etapa: 'por_cotizar' }),
    cotizacion({ id: 10, etapa: 'seguimiento' }),
  ]);
  for (const c of COLUMNAS_PIPELINE) assert.match(html, new RegExp(`data-etapa="${c}"`));
  assert.match(html, /Por Cotizar/);
  assert.match(html, /Seguimiento/);
  assert.match(html, /No Asignado/);
  assert.match(html, /Producto entregado/);
});

test('Q6: cada tarjeta del tablero muestra la identidad de la oportunidad (nombre del prospecto o cliente)', () => {
  const html = buildTableroPipelineHtml([
    prospecto({ id: 1, nombre: 'Laura', etapa: 'por_cotizar' }),
    cotizacion({ id: 10, cliente: 'Hotel Azul', etapa: 'seguimiento' }),
  ]);
  assert.match(html, /Laura/);
  assert.match(html, /Hotel Azul/);
});

test('Q7: el tablero muestra la suma en pesos por columna', () => {
  const html = buildTableroPipelineHtml([
    cotizacion({ id: 10, total: 5000, etapa: 'seguimiento' }),
    cotizacion({ id: 11, total: 2500, etapa: 'seguimiento' }),
  ]);
  assert.match(html, /\$7,500\.00/);
});

test('Q8: una columna vacia pinta su estado vacio', () => {
  const html = buildTableroPipelineHtml([]);
  assert.match(html, /tablero-col-vacia/);
});

test('Q9: el tablero escapa los datos de usuario (XSS)', () => {
  const html = buildTableroPipelineHtml([prospecto({ id: 1, nombre: '<img src=x onerror=alert(1)>', etapa: 'por_cotizar' })]);
  assert.equal(html.includes('<img src=x'), false);
  assert.match(html, /&lt;img/);
});
