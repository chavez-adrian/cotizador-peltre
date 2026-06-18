'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let validarDomicilioEntrega, formatCarrier, formatServicio;
before(async () => {
  ({ validarDomicilioEntrega, formatCarrier, formatServicio } = await import('../cotizar-logica.js'));
});

// === AC1: CP + pais sin Calle -> procede con leyenda ===
test('AC1-1: CP + pais validos sin Calle -> ok con leyenda', () => {
  const r = validarDomicilioEntrega({ calle: '', cp: '06600', pais: 'MX' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.leyenda, 'Favor de confirmar el domicilio de entrega');
  assert.ok(!r.error);
});

test('AC1-2: CP + pais + Calle -> ok sin leyenda', () => {
  const r = validarDomicilioEntrega({ calle: 'Reforma 100', cp: '06600', pais: 'MX' });
  assert.strictEqual(r.ok, true);
  assert.ok(!r.leyenda);
  assert.ok(!r.error);
});

test('AC1-3: Calle solo con espacios cuenta como vacia -> leyenda', () => {
  const r = validarDomicilioEntrega({ calle: '   ', cp: '06600', pais: 'MX' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.leyenda, 'Favor de confirmar el domicilio de entrega');
});

// === AC2: falta CP o pais -> bloquea ===
test('AC2-1: falta CP -> ok:false con error', () => {
  const r = validarDomicilioEntrega({ calle: 'Reforma 100', cp: '', pais: 'MX' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
  assert.ok(!r.leyenda);
});

test('AC2-2: falta pais -> ok:false con error', () => {
  const r = validarDomicilioEntrega({ calle: 'Reforma 100', cp: '06600', pais: '' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

test('AC2-3: CP con formato invalido para el pais -> ok:false con error', () => {
  const r = validarDomicilioEntrega({ calle: 'Reforma 100', cp: '123', pais: 'MX' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

test('AC2-4: CP valido canadiense con pais CA -> ok', () => {
  const r = validarDomicilioEntrega({ calle: '', cp: 'K1A 0A9', pais: 'CA' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.leyenda, 'Favor de confirmar el domicilio de entrega');
});

test('AC2-5: falta CP y falta pais -> ok:false', () => {
  const r = validarDomicilioEntrega({ calle: '', cp: '', pais: '' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

// === AC3: nombres canonicos de paqueteria (carrier con su marca + servicio Title Case) ===
test('AC3-1: carrier canonico preserva el acronimo/marca sin importar el case de entrada', () => {
  assert.strictEqual(formatCarrier('fedex'), 'FedEx');
  assert.strictEqual(formatCarrier('FEDEX'), 'FedEx');
  assert.strictEqual(formatCarrier('FedEx'), 'FedEx');
  assert.strictEqual(formatCarrier('dhl'), 'DHL');
  assert.strictEqual(formatCarrier('DHL'), 'DHL');
  assert.strictEqual(formatCarrier('ups'), 'UPS');
  assert.strictEqual(formatCarrier('estafeta'), 'Estafeta');
});

test('AC3-2: carrier desconocido -> Title Case (no rompe, presentable)', () => {
  assert.strictEqual(formatCarrier('paqueteria local'), 'Paqueteria Local');
});

test('AC3-3: servicio en Title Case', () => {
  assert.strictEqual(formatServicio('ground'), 'Ground');
  assert.strictEqual(formatServicio('STANDARD OVERNIGHT'), 'Standard Overnight');
  assert.strictEqual(formatServicio('Express'), 'Express');
});

test('AC3-4: vacios / null / undefined -> cadena vacia', () => {
  assert.strictEqual(formatCarrier(''), '');
  assert.strictEqual(formatCarrier(null), '');
  assert.strictEqual(formatServicio(undefined), '');
});

test('AC3-5: combinacion carrier + servicio (lo que va al documento)', () => {
  assert.strictEqual(`${formatCarrier('fedex')} ${formatServicio('ground')}`.trim(), 'FedEx Ground');
  assert.strictEqual(`${formatCarrier('DHL')} ${formatServicio('express')}`.trim(), 'DHL Express');
  assert.strictEqual(`${formatCarrier('ups')} ${formatServicio('ground')}`.trim(), 'UPS Ground');
});
