'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildAltaDarDeAltaPayload } = require('./helpers.cjs');

test('F1: buildAltaDarDeAltaPayload incluye campos comerciales y domicilio', () => {
  const csfDatos = {
    rfc: 'TST010101ABC', razonSocial: 'Test SA de CV', nombreCorto: 'Test SA',
    idcif: '12345', regimenFiscal: '601', cp: '06600', municipio: 'Cuauhtemoc', estado: 'CDMX',
  };
  const comercial = { sales_type: 'M350', segmento_id: '3', salesman: '47', uso_cfdi: 'G03' };
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

test('F2: buildAltaDarDeAltaPayload pasa customer_id y branch_id para reintento', () => {
  const payload = buildAltaDarDeAltaPayload({}, {}, {}, 502, 602);
  assert.strictEqual(payload.customer_id, 502);
  assert.strictEqual(payload.branch_id, 602);
});
