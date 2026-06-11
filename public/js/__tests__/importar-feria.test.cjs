'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let buildReporteImportacionHtml;
before(async () => {
  ({ buildReporteImportacionHtml } = await import('../prospectos-logica.js'));
});

test('IF1: el reporte muestra importados, desglose por vendedor y descartados con motivo', () => {
  const html = buildReporteImportacionHtml({
    importados: 3,
    porVendedor: { 'Oswaldo Chávez': 2, 'Jaime Abaroa': 1 },
    descartados: [
      { fila: 4, nombre: 'ANA LOPEZ', motivo: 'telefono invalido' },
      { fila: 7, nombre: 'OMAR OLVERA', motivo: 'ya es cliente' },
    ],
  });
  assert.match(html, /3 prospectos importados/);
  assert.match(html, /Oswaldo Chávez: 2/);
  assert.match(html, /Jaime Abaroa: 1/);
  assert.match(html, /2 filas descartadas/);
  assert.match(html, /Fila 4: ANA LOPEZ - telefono invalido/);
  assert.match(html, /Fila 7: OMAR OLVERA - ya es cliente/);
});

test('IF2: sin descartados no aparece la seccion de descartes', () => {
  const html = buildReporteImportacionHtml({ importados: 5, porVendedor: { Tester: 5 }, descartados: [] });
  assert.match(html, /5 prospectos importados/);
  assert.equal(/descartadas/.test(html), false);
});

test('IF3: escapa HTML en nombres y motivos', () => {
  const html = buildReporteImportacionHtml({
    importados: 0,
    porVendedor: {},
    descartados: [{ fila: 2, nombre: '<img onerror=x>', motivo: 'telefono invalido' }],
  });
  assert.equal(html.includes('<img'), false);
  assert.match(html, /&lt;img/);
});

test('IF4: fila sin nombre se reporta legible y el reporte vacio no truena', () => {
  const html = buildReporteImportacionHtml({
    importados: 0,
    porVendedor: {},
    descartados: [{ fila: 9, nombre: '', motivo: 'sin nombre' }],
  });
  assert.match(html, /Fila 9: \(sin nombre\) - sin nombre/);
  assert.equal(typeof buildReporteImportacionHtml(null), 'string');
  assert.match(buildReporteImportacionHtml(null), /0 prospectos importados/);
});
