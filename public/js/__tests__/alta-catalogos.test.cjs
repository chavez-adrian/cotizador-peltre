'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildAltaSelectoresOpts } = require('./helpers.cjs');

const CATALOGOS_MOCK = {
  listas_precios: [
    { id: 'M100', nombre: 'Mayoreo 100' },
    { id: 'M350', nombre: 'Mayoreo 350' },
    { id: 'US100', nombre: 'USA 100' },
  ],
  segmentos: [
    { id: 0, nombre: 'Sin segmento' },
    { id: 1, nombre: 'Ferreteria' },
    { id: 2, nombre: 'Distribuidor' },
  ],
  vendedores: [
    { id: 1, name: 'Adrian Chavez', operam_id: 1 },
    { id: 2, name: 'Alejandro Chavez', operam_id: 2 },
  ],
};

test('A1: buildAltaSelectoresOpts listas_precios genera opciones con value=id y label con nombre', () => {
  const opts = buildAltaSelectoresOpts(CATALOGOS_MOCK);
  assert.strictEqual(opts.listas.length, 3);
  assert.strictEqual(opts.listas[0].value, 'M100');
  assert.ok(opts.listas[0].label.includes('M100'));
  assert.ok(opts.listas[0].label.includes('Mayoreo 100'));
});

test('A2: buildAltaSelectoresOpts segmentos incluye Sin segmento con value "0"', () => {
  const opts = buildAltaSelectoresOpts(CATALOGOS_MOCK);
  assert.strictEqual(opts.segmentos.length, 3);
  const sinSeg = opts.segmentos.find(s => s.label === 'Sin segmento');
  assert.ok(sinSeg, 'debe existir opcion Sin segmento');
  assert.strictEqual(sinSeg.value, '0');
});

test('A3: buildAltaSelectoresOpts vendedores genera opciones con value=operam_id', () => {
  const opts = buildAltaSelectoresOpts(CATALOGOS_MOCK);
  assert.strictEqual(opts.vendedores.length, 2);
  assert.strictEqual(opts.vendedores[0].value, '1');
  assert.strictEqual(opts.vendedores[0].label, 'Adrian Chavez');
});

test('A4: buildAltaSelectoresOpts con catalogos vacios retorna arrays vacios', () => {
  const opts = buildAltaSelectoresOpts({ listas_precios: [], segmentos: [], vendedores: [] });
  assert.strictEqual(opts.listas.length, 0);
  assert.strictEqual(opts.segmentos.length, 0);
  assert.strictEqual(opts.vendedores.length, 0);
});
