'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildAltaDarDeAltaPayload, resolveClienteId } = require('./helpers.cjs');

test('F1: buildAltaDarDeAltaPayload incluye campos comerciales y domicilio', () => {
  const csfDatos = {
    rfc: 'TST010101ABC', razonSocial: 'Test SA de CV', nombreCorto: 'Test SA',
    idcif: '12345', regimenFiscal: '601', cp: '06600', municipio: 'Cuauhtemoc', estado: 'CDMX',
  };
  const comercial = { sales_type: 'M350', segmento_id: '3', salesman: '47', uso_cfdi: 'G03', invoice_email: 'fact@test.com', celular_nota: '5599998888' };
  const domicilio = {
    br_name: 'Almacen', br_ref: 'ALM', pais: 'MX',
    addr_street: 'Reforma', addr_exterior: '1', addr_interior: '',
    addr_colony: 'Juarez', addr_city: 'CDMX', addr_state: 'CDMX',
    addr_zip: '06600', addr_reference: '', phone: '5512345678', email: 'x@x.com',
  };
  const payload = buildAltaDarDeAltaPayload(csfDatos, comercial, domicilio, null, null);
  assert.strictEqual(payload.tax_id, 'TST010101ABC');
  assert.strictEqual(payload.sales_type, 'M350');
  assert.strictEqual(payload.segmento_id, '3');
  assert.strictEqual(payload.salesman, '47');
  assert.strictEqual(payload.timbrado_uso_cfdi, 'G03');
  assert.strictEqual(payload.pais, 'MX');
  assert.ok(payload.entrega, 'debe incluir entrega');
  assert.strictEqual(payload.entrega.br_name, 'Almacen');
  assert.strictEqual(payload.customer_id, null, 'customer_id null cuando no hay reintento');
  assert.strictEqual(payload.branch_id, null, 'branch_id null cuando no hay reintento');
});

test('F1b: buildAltaDarDeAltaPayload incluye invoice_email y celular_nota (issues #17/#18)', () => {
  const comercial = { sales_type: 'M350', segmento_id: '3', salesman: '47', uso_cfdi: 'G03', invoice_email: 'fact@test.com', celular_nota: '5599998888' };
  const payload = buildAltaDarDeAltaPayload({}, comercial, {}, null, null);
  assert.strictEqual(payload.invoice_email, 'fact@test.com');
  assert.strictEqual(payload.celular_nota, '5599998888');
});

test('F1c: buildAltaDarDeAltaPayload reusa phone/email del domicilio de entrega como contacto principal (issue #16)', () => {
  const domicilio = { phone: '+52 5512345678', email: 'entrega@test.com' };
  const payload = buildAltaDarDeAltaPayload({}, {}, domicilio, null, null);
  assert.strictEqual(payload.phone, '+52 5512345678', 'phone a nivel cliente debe reusar el del domicilio de entrega');
  assert.strictEqual(payload.email, 'entrega@test.com', 'email a nivel cliente debe reusar el del domicilio de entrega');
});

test('F2: buildAltaDarDeAltaPayload pasa customer_id y branch_id para reintento', () => {
  const payload = buildAltaDarDeAltaPayload({}, {}, {}, 502, 602);
  assert.strictEqual(payload.customer_id, 502);
  assert.strictEqual(payload.branch_id, 602);
});

// === resolveClienteId (issue #31) ===

test('G1: resolveClienteId retorna clienteExistente.id cuando esta definido', () => {
  const state = { clienteExistente: { id: 77, branchIdx: 0 }, customer_id: null };
  assert.strictEqual(resolveClienteId(state), 77);
});

test('G2: resolveClienteId retorna customer_id cuando no hay clienteExistente', () => {
  const state = { clienteExistente: null, customer_id: 502 };
  assert.strictEqual(resolveClienteId(state), 502);
});

test('G3: resolveClienteId retorna null cuando no hay ninguno', () => {
  const state = { clienteExistente: null, customer_id: null };
  assert.strictEqual(resolveClienteId(state), null);
});

test('G4: resolveClienteId prefiere clienteExistente.id sobre customer_id en reintento', () => {
  const state = { clienteExistente: { id: 88 }, customer_id: 502 };
  assert.strictEqual(resolveClienteId(state), 88);
});
