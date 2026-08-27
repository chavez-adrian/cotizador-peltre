'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let buildReporteImportacionHtml;
before(async () => {
  ({ buildReporteImportacionHtml } = await import('../importar-feria-logica.js'));
});

test('IF1: el reporte muestra nuevos, enriquecidos, desglose por vendedor y descartados con motivo', () => {
  const html = buildReporteImportacionHtml({
    importados: 3,
    enriquecidos: 2,
    porVendedor: { 'Oswaldo Chávez': 2, 'Jaime Abaroa': 1 },
    descartados: [
      { fila: 4, nombre: 'Ana Lopez', motivo: 'telefono invalido' },
      { fila: 7, nombre: 'Omar Olvera', motivo: 'ya es cliente' },
    ],
    sinCelular: [],
  });
  assert.match(html, /3 prospectos nuevos/);
  assert.match(html, /2 prospectos enriquecidos/);
  // "ya es cliente" es una categoria del resumen, no un descarte mas de la lista
  assert.match(html, /1 celular que ya es cliente/);
  assert.match(html, /Oswaldo Chávez: 2/);
  assert.match(html, /Jaime Abaroa: 1/);
  assert.match(html, /2 filas descartadas/);
  assert.match(html, /Fila 4: Ana Lopez - telefono invalido/);
  assert.match(html, /Fila 7: Omar Olvera - ya es cliente/);
});

test('IF2: los gafetes sin celular salen con empresa, correo y scoring para perseguirlos a mano', () => {
  const html = buildReporteImportacionHtml({
    importados: 1,
    enriquecidos: 0,
    porVendedor: { Tester: 1 },
    descartados: [],
    sinCelular: [
      { fila: 5, nombre: 'Luz Ramos', empresa: 'Hotel Bonito', correo: 'luz@hotelb.mx', scoring: 4 },
    ],
  });
  assert.match(html, /1 gafete sin celular/);
  assert.match(html, /Luz Ramos/);
  assert.match(html, /Hotel Bonito/);
  assert.match(html, /luz@hotelb\.mx/);
  assert.match(html, /calificaci&#243;n 4|calificación 4/);
  assert.equal(/descartadas/.test(html), false);
});

test('IF3: escapa HTML en nombres, motivos y correos', () => {
  const html = buildReporteImportacionHtml({
    importados: 0,
    enriquecidos: 0,
    porVendedor: {},
    descartados: [{ fila: 2, nombre: '<img onerror=x>', motivo: 'telefono invalido' }],
    sinCelular: [{ fila: 3, nombre: 'Ok', empresa: '<b>x</b>', correo: 'a@b.mx', scoring: '' }],
  });
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('<b>'), false);
  assert.match(html, /&lt;img/);
});

test('IF4: fila sin nombre se reporta legible y el reporte vacio no truena', () => {
  const html = buildReporteImportacionHtml({
    importados: 0,
    enriquecidos: 0,
    porVendedor: {},
    descartados: [{ fila: 9, nombre: '', motivo: 'sin nombre' }],
    sinCelular: [],
  });
  assert.match(html, /Fila 9: \(sin nombre\) - sin nombre/);
  assert.equal(typeof buildReporteImportacionHtml(null), 'string');
  assert.match(buildReporteImportacionHtml(null), /0 prospectos nuevos/);
});

test('IF5: los avisos de forma del archivo (issue #277) se pintan junto a los descartados', () => {
  const html = buildReporteImportacionHtml({
    importados: 1,
    enriquecidos: 0,
    porVendedor: { Tester: 1 },
    descartados: [],
    sinCelular: [],
    avisos: {
      columnasNoEncontradas: ['Scoring'],
      actividadesSinMapeo: [{ actividad: 'Fabricante - Manufactura', filas: 2 }],
    },
  });
  assert.match(html, /Scoring/);
  assert.match(html, /Fabricante - Manufactura/);
  assert.match(html, /2/);
});

test('IF6: sin avisos (o sin ambas listas) no se pinta nada de mas ni truena', () => {
  const html = buildReporteImportacionHtml({
    importados: 1, enriquecidos: 0, porVendedor: {}, descartados: [], sinCelular: [],
    avisos: { columnasNoEncontradas: [], actividadesSinMapeo: [] },
  });
  assert.equal(/aviso/i.test(html), false);
  const sinAvisos = buildReporteImportacionHtml({
    importados: 1, enriquecidos: 0, porVendedor: {}, descartados: [], sinCelular: [],
  });
  assert.equal(typeof sinAvisos, 'string');
});

test('IF7: escapa HTML en los avisos', () => {
  const html = buildReporteImportacionHtml({
    importados: 0, enriquecidos: 0, porVendedor: {}, descartados: [], sinCelular: [],
    avisos: {
      columnasNoEncontradas: ['<img onerror=x>'],
      actividadesSinMapeo: [{ actividad: '<b>x</b>', filas: 1 }],
    },
  });
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('<b>x</b>'), false);
});
