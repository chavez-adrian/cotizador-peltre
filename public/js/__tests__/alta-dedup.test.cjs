'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDedupRequest,
  buildDedupDomiciliosRequest,
  buildDedupExactoHtml,
  buildDedupDomiciliosHtml,
  buildDedupCandidatosHtml,
} = require('./helpers.cjs');

// === buildDedupRequest ===

test('F1: buildDedupRequest genera URL con rfc y nombre codificados', () => {
  const req = buildDedupRequest('PNA010203ABC', 'Peltre Nacional SA de CV', 'Bearer tok123');
  assert.ok(req.url.includes('/api/buscar-cliente-duplicado'), 'URL debe apuntar al endpoint');
  assert.ok(req.url.includes('rfc=PNA010203ABC'), 'URL debe incluir rfc');
  assert.ok(req.url.includes('nombre='), 'URL debe incluir nombre');
  assert.strictEqual(req.headers['Authorization'], 'Bearer tok123');
});

test('F2: buildDedupRequest codifica espacios en nombre', () => {
  const req = buildDedupRequest('XAXX010101000', 'Comercio General SA', 'Bearer x');
  assert.ok(!req.url.includes(' '), 'URL no debe tener espacios sin codificar');
});

// === buildDedupDomiciliosRequest ===

test('F3: buildDedupDomiciliosRequest genera URL con id de cliente', () => {
  const req = buildDedupDomiciliosRequest(77, 'Bearer tok');
  assert.ok(req.url.includes('/api/operam/clientes/77/domicilios'), 'URL debe incluir el id del cliente');
  assert.strictEqual(req.headers['Authorization'], 'Bearer tok');
});

// === buildDedupExactoHtml (caso exacto) ===

test('F4: buildDedupExactoHtml contiene alerta roja', () => {
  const cliente = { id: 77, CustName: 'Peltre Nacional SA de CV', RFC: 'PNA010203ABC' };
  const html = buildDedupExactoHtml(cliente);
  assert.ok(typeof html === 'string', 'debe retornar string');
  assert.ok(html.includes('RFC ya existe'), 'debe mencionar que el RFC ya existe');
  assert.ok(html.includes('77') || html.includes('Peltre Nacional'), 'debe mostrar datos del cliente');
});

test('F5: buildDedupExactoHtml incluye boton "Usar este cliente"', () => {
  const cliente = { id: 77, CustName: 'Peltre Nacional SA de CV', RFC: 'PNA010203ABC' };
  const html = buildDedupExactoHtml(cliente);
  assert.ok(html.includes('Usar este cliente'), 'debe incluir boton Usar este cliente');
});

test('F6: buildDedupExactoHtml NO incluye opcion de crear nuevo cliente', () => {
  const cliente = { id: 77, CustName: 'Peltre Nacional SA de CV', RFC: 'PNA010203ABC' };
  const html = buildDedupExactoHtml(cliente);
  assert.ok(!html.toLowerCase().includes('crear nuevo'), 'no debe ofrecer crear nuevo cliente');
  assert.ok(!html.toLowerCase().includes('forzar'), 'no debe ofrecer forzar creacion');
});

// === buildDedupDomiciliosHtml ===

test('F7: buildDedupDomiciliosHtml muestra domicilios con radio buttons', () => {
  const domicilios = [
    { descripcion: 'Sucursal Norte', calle: 'Av. Norte 123', cp: '06600', municipio: 'CDMX', estado: 'CDMX' },
    { descripcion: 'Bodega Sur', calle: 'Calle Sur 456', cp: '01000', municipio: 'Alvaro Obregon', estado: 'CDMX' },
  ];
  const html = buildDedupDomiciliosHtml(domicilios, 77);
  assert.ok(typeof html === 'string', 'debe retornar string');
  assert.ok(html.includes('Sucursal Norte') || html.includes('Bodega Sur'), 'debe mostrar nombre del domicilio');
  assert.ok(html.includes('radio') || html.includes('type="radio"'), 'debe incluir radio buttons');
});

test('F8: buildDedupDomiciliosHtml incluye opcion "Crear nuevo domicilio"', () => {
  const domicilios = [
    { descripcion: 'Sucursal Norte', calle: 'Av. Norte 123', cp: '06600', municipio: 'CDMX', estado: 'CDMX' },
  ];
  const html = buildDedupDomiciliosHtml(domicilios, 77);
  assert.ok(html.includes('Crear nuevo domicilio') || html.includes('nuevo domicilio'), 'debe ofrecer crear nuevo domicilio');
});

test('F9: buildDedupDomiciliosHtml con lista vacia muestra solo opcion crear nuevo', () => {
  const html = buildDedupDomiciliosHtml([], 77);
  assert.ok(typeof html === 'string', 'debe retornar string incluso con lista vacia');
  assert.ok(html.includes('Crear nuevo domicilio') || html.includes('nuevo domicilio'), 'siempre ofrece crear nuevo domicilio');
});

// === buildDedupCandidatosHtml (caso candidatos) ===

test('F10: buildDedupCandidatosHtml contiene alerta naranja', () => {
  const candidatos = [
    { id: 10, CustName: 'Comercio General SA de CV', cust_ref: 'COGEN', RFC: 'XAXX010101000', _similitud: 2 },
    { id: 11, CustName: 'Comercializadora Norte SA de CV', cust_ref: 'COGNOR', RFC: 'XAXX010101000', _similitud: 1 },
  ];
  const html = buildDedupCandidatosHtml(candidatos);
  assert.ok(typeof html === 'string', 'debe retornar string');
  assert.ok(html.includes('Posibles clientes'), 'debe mencionar posibles clientes existentes');
});

test('F11: buildDedupCandidatosHtml muestra lista de candidatos con radio buttons', () => {
  const candidatos = [
    { id: 10, CustName: 'Comercio General SA de CV', cust_ref: 'COGEN', RFC: 'XAXX010101000', _similitud: 2 },
  ];
  const html = buildDedupCandidatosHtml(candidatos);
  assert.ok(html.includes('Comercio General') || html.includes('COGEN'), 'debe mostrar nombre/ref del candidato');
  assert.ok(html.includes('type="radio"') || html.includes('radio'), 'debe incluir radio buttons');
});

test('F12: buildDedupCandidatosHtml incluye opcion escalar a Adrian', () => {
  const candidatos = [
    { id: 10, CustName: 'Comercio General SA de CV', cust_ref: 'COGEN', RFC: 'XAXX010101000', _similitud: 1 },
  ];
  const html = buildDedupCandidatosHtml(candidatos);
  assert.ok(html.includes('escalar') || html.includes('Adrián') || html.includes('Adrian'), 'debe incluir opcion escalar a Adrian');
});

test('F13: buildDedupCandidatosHtml NO incluye opcion de crear nuevo cliente', () => {
  const candidatos = [
    { id: 10, CustName: 'Comercio General SA de CV', cust_ref: 'COGEN', RFC: 'XAXX010101000', _similitud: 1 },
  ];
  const html = buildDedupCandidatosHtml(candidatos);
  assert.ok(!html.toLowerCase().includes('crear nuevo cliente'), 'no debe ofrecer crear nuevo cliente');
  assert.ok(!html.toLowerCase().includes('forzar'), 'no debe ofrecer forzar creacion');
});
