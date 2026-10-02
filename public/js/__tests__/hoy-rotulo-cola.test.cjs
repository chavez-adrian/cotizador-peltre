'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Rotulo de la cola Hoy (#496): #hoy-cola es UNA sola lista donde se mezclan
// No Asignado, prospectos y cotizaciones por urgencia, asi que el encabezado
// fijo no puede decir "Prospectos por contactar". Sin DOM en Node: se lee el
// markup de la vista.

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const inicio = html.indexOf('id="hoy-view"');
const fin = html.indexOf('id="prospectos-view"');
const vistaHoy = html.slice(inicio, fin);

test('la vista Hoy existe en el markup', () => {
  assert.ok(inicio >= 0 && fin > inicio);
});

test('"Prospectos por contactar" ya no encabeza la cola de Hoy', () => {
  assert.equal(vistaHoy.includes('Prospectos por contactar'), false);
});

test('la cola de Hoy la encabeza "Pendientes de hoy"', () => {
  const rotulo = vistaHoy.indexOf('>Pendientes de hoy<');
  const cola = vistaHoy.indexOf('id="hoy-cola"');
  assert.ok(rotulo >= 0, 'falta el rotulo "Pendientes de hoy"');
  assert.ok(rotulo < cola, 'el rotulo va antes de #hoy-cola');
});
