'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'csf-upload.html'), 'utf8');

const DELIVERY_FIELD_IDS = [
  'f_del_name', 'f_del_street', 'f_del_ext', 'f_del_int',
  'f_del_colony', 'f_del_zip', 'f_del_city', 'f_del_state',
  'f_del_phone', 'f_del_email',
];

for (const fieldId of DELIVERY_FIELD_IDS) {
  test(`Card entrega: campo #${fieldId} existe en HTML`, () => {
    assert.ok(html.includes(`id="${fieldId}"`));
  });
}

test('buildEntregaPreFill: mapea datos fiscales a campos de entrega', () => {
  const match = html.match(/function buildEntregaPreFill\(data\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(match, 'buildEntregaPreFill no encontrada en csf-upload.html');
  const fn = new Function('data', match[1] + '\n');
  const data = { CustName: 'ACEROS SA DE CV', street: 'insurgentes sur', street_number: '1234', suite_number: 'int 5', district: 'del valle', postal_code: '03100', city: 'benito juarez', state: 'cdmx' };
  const result = fn(data);
  assert.equal(result.f_del_name, data.CustName);
  assert.equal(result.f_del_street, data.street);
  assert.equal(result.f_del_ext, data.street_number);
  assert.equal(result.f_del_colony, data.district);
  assert.equal(result.f_del_zip, data.postal_code);
});

test('poblarForm llama a buildEntregaPreFill', () => {
  assert.ok(html.includes('buildEntregaPreFill'));
});

test('buildEntregaPayload: construye sub-objeto entrega con valores de f_del_*', () => {
  const match = html.match(/function buildEntregaPayload\(get\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(match, 'buildEntregaPayload no encontrada');
  const fn = new Function('get', match[1] + '\n');
  const values = { f_del_name: 'Almacen Central', f_del_street: 'Insurgentes Sur', f_del_ext: '1234', f_del_int: 'Int 5', f_del_colony: 'Del Valle', f_del_zip: '03100', f_del_city: 'Benito Juarez', f_del_state: 'CDMX', f_del_phone: '+52 55 1234 5678', f_del_email: 'almacen@empresa.com' };
  const result = fn(id => values[id] || '');
  assert.equal(result.br_name, values.f_del_name);
  assert.equal(result.addr_street, values.f_del_street);
  assert.equal(result.addr_zip, values.f_del_zip);
  assert.equal(result.phone, values.f_del_phone);
});

test('csf-upload.html: llama a /api/buscar-cliente despues de parsear RFC', () => {
  assert.ok(html.includes('/api/buscar-cliente'));
});

test('csf-upload.html: tiene bannerDuplicado y _clienteExistente', () => {
  assert.ok(html.includes('id="bannerDuplicado"'));
  assert.ok(html.includes('_clienteExistente'));
});

test('csf-upload.html: boton tiene texto "Actualizar cliente"', () => {
  assert.ok(html.includes('Actualizar cliente'));
});

test('csf-upload.html: tiene panelConfirmacion con botones', () => {
  assert.ok(html.includes('id="panelConfirmacion"'));
  assert.ok(html.includes('id="btnConfirmar"'));
  assert.ok(html.includes('id="btnCancelarConfirmacion"'));
});

test('csf-upload.html: panel de confirmacion tiene mensaje correcto', () => {
  assert.ok(html.includes('Se van a modificar los datos del cliente en Operam'));
});

test('csf-upload.html: define funciones mostrarPanelConfirmacion y confirmarCambios', () => {
  assert.ok(html.includes('function mostrarPanelConfirmacion'));
  assert.ok(html.includes('function confirmarCambios'));
  assert.ok(html.includes('function cancelarConfirmacion'));
});

test('csf-upload.html: usa PUT para actualizar y referencia /api/actualizar-cliente', () => {
  assert.ok(html.includes('/api/actualizar-cliente'));
  assert.ok(html.includes("method: 'PUT'") || html.includes('method:"PUT"'));
});

test('csf-upload.html: tiene select#f_pais con opciones MX, US, CA', () => {
  assert.ok(html.includes('id="f_pais"'));
  assert.ok(html.includes('value="MX"'));
  assert.ok(html.includes('value="US"'));
  assert.ok(html.includes('value="CA"'));
});

test('csf-upload.html: tiene input#f_invoice_email', () => {
  assert.ok(html.includes('id="f_invoice_email"'));
});

test('csf-upload.html: usa paths relativos (sin operam-server.onrender.com)', () => {
  assert.ok(!html.includes('operam-server.onrender.com'), 'no debe tener URLs hardcodeadas de operam');
  assert.ok(html.includes("API_BASE        = ''"), 'API_BASE debe ser string vacio');
});
