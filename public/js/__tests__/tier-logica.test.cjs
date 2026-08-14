'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let tierPorVolumen, resolverTier, avisoListaFijada, validarTierCotizacion, MENSAJE_SIN_PERMISO_TIER;
before(async () => {
  ({
    tierPorVolumen, resolverTier, avisoListaFijada, validarTierCotizacion, MENSAJE_SIN_PERMISO_TIER,
  } = await import('../tier-logica.js'));
});

// Mismo tabulador de data/precios.json, replicado aqui a proposito (el test es
// independiente del archivo de datos).
const TIERS = [
  { id: 'Menudeo', label: 'Menudeo', min_qty: 1 },
  { id: 'M100', label: '100+ pzs', min_qty: 100 },
  { id: 'M350', label: '350+ pzs', min_qty: 350 },
  { id: 'M550', label: '550+ pzs', min_qty: 550 },
  { id: 'M1500', label: '1,500+ pzs', min_qty: 1500 },
  { id: 'M6000', label: '6,000+ pzs', min_qty: 6000 },
];

// === tierPorVolumen: el tabulador tal cual, sin override ===

test('carrito vacio cae en el primer tier (Menudeo)', () => {
  assert.strictEqual(tierPorVolumen(TIERS, 0).id, 'Menudeo');
});

test('el volumen exacto de un umbral entra a ese tier', () => {
  assert.strictEqual(tierPorVolumen(TIERS, 550).id, 'M550');
  assert.strictEqual(tierPorVolumen(TIERS, 549).id, 'M350');
});

test('volumen por encima del ultimo umbral cae en el tier mas alto', () => {
  assert.strictEqual(tierPorVolumen(TIERS, 50000).id, 'M6000');
});

// === resolverTier: Auto vs fijado ===

test('sin tierFijadoId resuelve Auto (el tabulador)', () => {
  const r = resolverTier(TIERS, 1600, null);
  assert.strictEqual(r.fijado, false);
  assert.strictEqual(r.tier.id, 'M1500');
});

test('con tierFijadoId valido, manda el fijado aunque el volumen de para otro (ambas direcciones)', () => {
  const abajo = resolverTier(TIERS, 1600, 'M550'); // fijar hacia abajo del que tocaria
  assert.strictEqual(abajo.fijado, true);
  assert.strictEqual(abajo.tier.id, 'M550');

  const arriba = resolverTier(TIERS, 10, 'M6000'); // fijar hacia arriba del que tocaria
  assert.strictEqual(arriba.fijado, true);
  assert.strictEqual(arriba.tier.id, 'M6000');
});

test('un tierFijadoId que ya no existe en el catalogo degrada a Auto', () => {
  const r = resolverTier(TIERS, 10, 'M9999');
  assert.strictEqual(r.fijado, false);
  assert.strictEqual(r.tier.id, 'Menudeo');
});

test('Menudeo se puede fijar como cualquier otro tier (#98: incluye Menudeo)', () => {
  const r = resolverTier(TIERS, 6000, 'Menudeo');
  assert.strictEqual(r.fijado, true);
  assert.strictEqual(r.tier.id, 'Menudeo');
});

// === avisoListaFijada: bidireccional, nunca bloqueante ===

test('sin lista fijada, sin aviso', () => {
  assert.strictEqual(avisoListaFijada(TIERS, 1600, null), null);
});

test('lista fijada que coincide con el tabulador, sin aviso', () => {
  assert.strictEqual(avisoListaFijada(TIERS, 1600, 'M1500'), null);
});

test('lista fijada por debajo del volumen: aviso con formato "Lista fijada: X - el volumen (N pzs) corresponde a Y"', () => {
  const aviso = avisoListaFijada(TIERS, 1600, 'M550');
  assert.strictEqual(aviso, 'Lista fijada: M550 - el volumen (1,600 pzs) corresponde a M1500');
});

test('lista fijada por encima del volumen: mismo formato en la otra direccion', () => {
  const aviso = avisoListaFijada(TIERS, 10, 'M6000');
  assert.strictEqual(aviso, 'Lista fijada: M6000 - el volumen (10 pzs) corresponde a Menudeo');
});

// === validarTierCotizacion: enforcement del servidor (#151, prior art #137) ===

test('admin: cualquier tier pasa, incluso uno ajeno al tabulador', () => {
  assert.strictEqual(validarTierCotizacion(TIERS, 10, 'M6000', true).ok, true);
});

test('sin permiso: el tier que coincide con el tabulador pasa', () => {
  assert.strictEqual(validarTierCotizacion(TIERS, 1600, 'M1500', false).ok, true);
});

test('sin permiso: tier ajeno al tabulador se rechaza con el mensaje de permiso', () => {
  const r = validarTierCotizacion(TIERS, 1600, 'M550', false);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.mensaje, MENSAJE_SIN_PERMISO_TIER);
});

test('sin permiso: tier ausente o vacio no cuenta como override (pasa)', () => {
  assert.strictEqual(validarTierCotizacion(TIERS, 10, '', false).ok, true);
  assert.strictEqual(validarTierCotizacion(TIERS, 10, undefined, false).ok, true);
});
