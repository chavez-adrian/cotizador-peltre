'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let tierPorVolumen, resolverTier, avisoListaFijada, validarTierCotizacion, MENSAJE_SIN_PERMISO_TIER;
let normalizarPuedeFijarLista, puedeFijarLista;
let tierAlCargarCotizacion, opcionesTierSelect, MENSAJE_COPIA_LISTA_FIJADA;
before(async () => {
  ({
    tierPorVolumen, resolverTier, avisoListaFijada, validarTierCotizacion, MENSAJE_SIN_PERMISO_TIER,
    normalizarPuedeFijarLista, puedeFijarLista,
    tierAlCargarCotizacion, opcionesTierSelect, MENSAJE_COPIA_LISTA_FIJADA,
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

// === normalizarPuedeFijarLista / puedeFijarLista (#153, prior art #137) ===

test('normalizarPuedeFijarLista: solo true exacto es permiso; basura, string y ausente degradan a false', () => {
  assert.strictEqual(normalizarPuedeFijarLista(true), true);
  assert.strictEqual(normalizarPuedeFijarLista(false), false);
  assert.strictEqual(normalizarPuedeFijarLista('true'), false);
  assert.strictEqual(normalizarPuedeFijarLista(1), false);
  assert.strictEqual(normalizarPuedeFijarLista(null), false);
  assert.strictEqual(normalizarPuedeFijarLista(undefined), false);
});

test('puedeFijarLista: admin siempre puede, sin checkbox', () => {
  assert.strictEqual(puedeFijarLista({ role: 'admin' }), true);
  assert.strictEqual(puedeFijarLista({ role: 'admin', puedeFijarLista: false }), true);
});

test('puedeFijarLista: vendedor depende del flag normalizado', () => {
  assert.strictEqual(puedeFijarLista({ role: 'vendedor', puedeFijarLista: true }), true);
  assert.strictEqual(puedeFijarLista({ role: 'vendedor', puedeFijarLista: false }), false);
  assert.strictEqual(puedeFijarLista({ role: 'vendedor' }), false);
  assert.strictEqual(puedeFijarLista(null), false);
});

// === validarTierCotizacion con tierPrevioEditado (#154) ===

test('sin permiso, editando: el tier identico al ya guardado en ESE registro pasa aunque difiera del tabulador', () => {
  const r = validarTierCotizacion(TIERS, 1600, 'M550', false, 'M550');
  assert.strictEqual(r.ok, true);
});

test('sin permiso, editando: un tier DISTINTO al ya guardado se sigue rechazando', () => {
  const r = validarTierCotizacion(TIERS, 1600, 'M6000', false, 'M550');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.mensaje, MENSAJE_SIN_PERMISO_TIER);
});

test('sin permiso, sin tierPrevioEditado (Copiar, registro nuevo): el mismo tier que antes se rechaza igual', () => {
  const r = validarTierCotizacion(TIERS, 1600, 'M550', false, null);
  assert.strictEqual(r.ok, false);
});

// === tierAlCargarCotizacion: que hereda Editar/Copiar del historial (#154) ===

test('cotizacion sin lista fijada (tier = tabulador de su volumen): Editar y Copiar arrancan en Auto', () => {
  const editar = tierAlCargarCotizacion(TIERS, 1600, 'M1500', 'actualizar', false);
  assert.deepStrictEqual(editar, { tierFijado: '', avisoListaPerdida: false });
  const copiar = tierAlCargarCotizacion(TIERS, 1600, 'M1500', 'nueva', false);
  assert.deepStrictEqual(copiar, { tierFijado: '', avisoListaPerdida: false });
});

test('Editar con lista fijada: se conserva SIEMPRE, con o sin permiso', () => {
  const conPermiso = tierAlCargarCotizacion(TIERS, 1600, 'M550', 'actualizar', true);
  assert.deepStrictEqual(conPermiso, { tierFijado: 'M550', avisoListaPerdida: false });
  const sinPermiso = tierAlCargarCotizacion(TIERS, 1600, 'M550', 'actualizar', false);
  assert.deepStrictEqual(sinPermiso, { tierFijado: 'M550', avisoListaPerdida: false });
});

test('Copiar con lista fijada y permiso: la hereda', () => {
  const r = tierAlCargarCotizacion(TIERS, 1600, 'M550', 'nueva', true);
  assert.deepStrictEqual(r, { tierFijado: 'M550', avisoListaPerdida: false });
});

test('Copiar con lista fijada y SIN permiso: arranca en Auto con aviso', () => {
  const r = tierAlCargarCotizacion(TIERS, 1600, 'M550', 'nueva', false);
  assert.deepStrictEqual(r, { tierFijado: '', avisoListaPerdida: true });
});

// === opcionesTierSelect: opciones acotadas sin permiso (#154) ===

test('con permiso: todas las opciones del tabulador', () => {
  assert.deepStrictEqual(opcionesTierSelect(TIERS, true, 'M550'), TIERS);
});

test('sin permiso y sin tierFijado: sin opciones (el selector se oculta)', () => {
  assert.deepStrictEqual(opcionesTierSelect(TIERS, false, ''), []);
});

test('sin permiso y con tierFijado: solo esa opcion, nunca el resto del tabulador', () => {
  const opciones = opcionesTierSelect(TIERS, false, 'M550');
  assert.strictEqual(opciones.length, 1);
  assert.strictEqual(opciones[0].id, 'M550');
});

test('MENSAJE_COPIA_LISTA_FIJADA existe y menciona Auto', () => {
  assert.match(MENSAJE_COPIA_LISTA_FIJADA, /Auto/);
});
