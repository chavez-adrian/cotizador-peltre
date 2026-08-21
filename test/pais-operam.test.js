import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paisDeClienteOperam, PAIS_A_COUNTRY, AREA_POR_PAIS } from '../lib/pais-operam.js';

// Tabla de casos medida en vivo el 2026-08-21 contra el padron completo de
// Operam (473 clientes via GET /api/v3/sales/customers paginado). El listado
// NO trae area/tax_group_id (473/473 undefined): la unica fuente es el texto
// libre country. Los acentos de los casos reales (Mexico, MEXICO, Panama,
// ESPANA) se arman con String.fromCharCode para que este archivo se quede en
// ASCII estricto.
function conAcento(...codes) {
  return String.fromCharCode(...codes);
}
const MEXICO_ACENTO = conAcento(77, 233, 120, 105, 99, 111); // Mexico
const MEXICO_MAYUS_ACENTO = conAcento(77, 201, 88, 73, 67, 79); // MEXICO
const PANAMA_ACENTO = conAcento(80, 97, 110, 97, 109, 225); // Panama
const ESPANA_ACENTO = conAcento(69, 83, 80, 65, 209, 65); // ESPANA

test('paisDeClienteOperam: sinonimos de Mexico', () => {
  assert.equal(paisDeClienteOperam({ country: 'Mexico', tax_id: 'ABC010101XYZ' }), 'MX');
  assert.equal(paisDeClienteOperam({ country: 'MEXICO', tax_id: 'ABC010101XYZ' }), 'MX');
  assert.equal(paisDeClienteOperam({ country: MEXICO_ACENTO, tax_id: 'ABC010101XYZ' }), 'MX');
  assert.equal(paisDeClienteOperam({ country: MEXICO_MAYUS_ACENTO, tax_id: 'ABC010101XYZ' }), 'MX');
  assert.equal(paisDeClienteOperam({ country: 'MX', tax_id: 'ABC010101XYZ' }), 'MX');
});

test('paisDeClienteOperam: sinonimos de Estados Unidos', () => {
  assert.equal(paisDeClienteOperam({ country: 'Estados Unidos', tax_id: 'ABC' }), 'US');
  assert.equal(paisDeClienteOperam({ country: 'USA', tax_id: 'ABC' }), 'US');
  assert.equal(paisDeClienteOperam({ country: 'United States of America', tax_id: 'ABC' }), 'US');
  assert.equal(paisDeClienteOperam({ country: 'ESTADOS UNIDOS', tax_id: 'ABC' }), 'US');
  assert.equal(paisDeClienteOperam({ country: 'US', tax_id: 'ABC' }), 'US');
  assert.equal(paisDeClienteOperam({ country: 'united states', tax_id: 'ABC' }), 'US');
  assert.equal(paisDeClienteOperam({ country: 'eeuu', tax_id: 'ABC' }), 'US');
  assert.equal(paisDeClienteOperam({ country: 'e.u.a.', tax_id: 'ABC' }), 'US');
  assert.equal(paisDeClienteOperam({ country: 'estados unidos de america', tax_id: 'ABC' }), 'US');
});

test('paisDeClienteOperam: sinonimos de Canada', () => {
  assert.equal(paisDeClienteOperam({ country: 'CANADA', tax_id: 'ABC' }), 'CA');
  assert.equal(paisDeClienteOperam({ country: 'Canada', tax_id: 'ABC' }), 'CA');
  assert.equal(paisDeClienteOperam({ country: 'ca', tax_id: 'ABC' }), 'CA');
});

test('paisDeClienteOperam: texto vacio o area ausente -> null', () => {
  assert.equal(paisDeClienteOperam({ country: '', tax_id: 'ABC010101XYZ' }), null);
  assert.equal(paisDeClienteOperam({ tax_id: 'ABC010101XYZ' }), null);
  assert.equal(paisDeClienteOperam({}), null);
});

test('paisDeClienteOperam: pais no mapeable al select de 3 opciones -> null', () => {
  assert.equal(paisDeClienteOperam({ country: 'PANAMA', tax_id: 'ABC' }), null);
  assert.equal(paisDeClienteOperam({ country: PANAMA_ACENTO, tax_id: 'ABC' }), null);
  assert.equal(paisDeClienteOperam({ country: 'Brazil', tax_id: 'ABC' }), null);
  assert.equal(paisDeClienteOperam({ country: ESPANA_ACENTO, tax_id: 'ABC' }), null);
  assert.equal(paisDeClienteOperam({ country: 'BEL', tax_id: 'ABC' }), null);
});

// D1-bis: el RFC generico de extranjero no puede afirmar MX con confianza --
// 3 de los 34 clientes con este RFC dicen "Mexico" solo porque el cotizador
// (antes de #245) escribia country: 'Mexico' hardcodeado sin importar el pais
// real del cliente.
test('paisDeClienteOperam: RFC generico de extranjero nunca resuelve a MX', () => {
  assert.equal(paisDeClienteOperam({ country: 'Mexico', tax_id: 'XEXX010101000' }), null);
  assert.equal(paisDeClienteOperam({ country: '', tax_id: 'XEXX010101000' }), null);
  assert.equal(paisDeClienteOperam({ country: '', tax_id: 'xexx010101000' }), null);
});

test('paisDeClienteOperam: RFC generico de extranjero SI resuelve a US/CA cuando el texto lo dice', () => {
  assert.equal(paisDeClienteOperam({ country: 'Estados Unidos', tax_id: 'XEXX010101000' }), 'US');
  assert.equal(paisDeClienteOperam({ country: 'PANAMA', tax_id: 'XEXX010101000' }), null);
});

test('PAIS_A_COUNTRY: inversa textual para el lado de escritura (D3)', () => {
  assert.equal(PAIS_A_COUNTRY.MX, 'Mexico');
  assert.equal(PAIS_A_COUNTRY.US, 'Estados Unidos');
  assert.equal(PAIS_A_COUNTRY.CA, 'Canada');
});

test('AREA_POR_PAIS: la tabla vive en un solo lugar (D1)', () => {
  assert.deepEqual(AREA_POR_PAIS, { MX: 1, US: 5, CA: 7 });
});
