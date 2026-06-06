'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildAltaSelectoresOpts, altaToggleSeccionState, buildCargarCatalogosRequest, buildAltaComercialPayload } = require('./helpers.cjs');

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

test('A5: altaToggleSeccionState abre seccion 1 desde estado inicial', () => {
  const estado = { seccionAbierta: null };
  const siguiente = altaToggleSeccionState(estado, 1);
  assert.strictEqual(siguiente.seccionAbierta, 1);
});

test('A6: altaToggleSeccionState cierra seccion si ya esta abierta', () => {
  const estado = { seccionAbierta: 2 };
  const siguiente = altaToggleSeccionState(estado, 2);
  assert.strictEqual(siguiente.seccionAbierta, null);
});

test('A7: altaToggleSeccionState NO abre secciones bloqueadas (3 y 4)', () => {
  const estado = { seccionAbierta: null };
  const sig3 = altaToggleSeccionState(estado, 3);
  assert.strictEqual(sig3.seccionAbierta, null);
  const sig4 = altaToggleSeccionState(estado, 4);
  assert.strictEqual(sig4.seccionAbierta, null);
});

test('A8: altaToggleSeccionState cambia de seccion 1 a seccion 2', () => {
  const estado = { seccionAbierta: 1 };
  const siguiente = altaToggleSeccionState(estado, 2);
  assert.strictEqual(siguiente.seccionAbierta, 2);
});

test('A9: buildCargarCatalogosRequest incluye URL /api/catalogos y Authorization header', () => {
  const req = buildCargarCatalogosRequest('Bearer tok123');
  assert.strictEqual(req.url, '/api/catalogos');
  assert.strictEqual(req.headers['Authorization'], 'Bearer tok123');
});

test('B1: buildAltaComercialPayload extrae lista_precios, segmento_id y salesman del formulario', () => {
  const getVal = id => ({ 'alta-lista-precios': 'M350', 'alta-segmento': '2', 'alta-vendedor': '5', 'alta-email-factura': '', 'alta-celular': '' })[id] || '';
  const payload = buildAltaComercialPayload(getVal);
  assert.strictEqual(payload.sales_type, 'M350');
  assert.strictEqual(payload.segmento_id, '2');
  assert.strictEqual(payload.salesman, '5');
});

test('B2: buildAltaComercialPayload incluye invoice_email y celular_nota', () => {
  const getVal = id => ({ 'alta-lista-precios': 'US100', 'alta-segmento': '0', 'alta-vendedor': '1', 'alta-email-factura': 'fact@empresa.com', 'alta-celular': '5512345678' })[id] || '';
  const payload = buildAltaComercialPayload(getVal);
  assert.strictEqual(payload.invoice_email, 'fact@empresa.com');
  assert.strictEqual(payload.celular_nota, '5512345678');
});

test('B3: buildAltaComercialPayload con campos vacios retorna strings vacios', () => {
  const getVal = () => '';
  const payload = buildAltaComercialPayload(getVal);
  assert.strictEqual(payload.sales_type, '');
  assert.strictEqual(payload.segmento_id, '');
  assert.strictEqual(payload.salesman, '');
  assert.strictEqual(payload.invoice_email, '');
  assert.strictEqual(payload.celular_nota, '');
});
