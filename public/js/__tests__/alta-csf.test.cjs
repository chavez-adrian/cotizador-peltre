'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildCsfDropzoneState, buildCsfDatosExtraidos } = require('./helpers.cjs');

// ─── buildCsfDropzoneState ────────────────────────────────────────────────────

test('C1: buildCsfDropzoneState estado inicial es idle', () => {
  const state = buildCsfDropzoneState({ status: 'idle' }, { type: 'INIT' });
  assert.strictEqual(state.status, 'idle');
});

test('C2: buildCsfDropzoneState accion LOADING retorna status loading con texto spinner', () => {
  const state = buildCsfDropzoneState({ status: 'idle' }, { type: 'LOADING' });
  assert.strictEqual(state.status, 'loading');
  assert.ok(state.spinnerText, 'debe tener spinnerText');
  assert.ok(state.spinnerText.includes('RFC'), 'spinner menciona RFC');
});

test('C3: buildCsfDropzoneState accion SUCCESS retorna status success con rfc y fileName', () => {
  const state = buildCsfDropzoneState(
    { status: 'loading' },
    { type: 'SUCCESS', rfc: 'BMF821130AR3', fileName: 'csf.pdf' }
  );
  assert.strictEqual(state.status, 'success');
  assert.strictEqual(state.rfc, 'BMF821130AR3');
  assert.strictEqual(state.fileName, 'csf.pdf');
});

test('C4: buildCsfDropzoneState accion ERROR retorna status error con mensaje', () => {
  const state = buildCsfDropzoneState(
    { status: 'loading' },
    { type: 'ERROR', mensaje: 'No se pudo leer el PDF' }
  );
  assert.strictEqual(state.status, 'error');
  assert.strictEqual(state.mensaje, 'No se pudo leer el PDF');
});

test('C5: buildCsfDropzoneState accion RESET retorna status idle limpio', () => {
  const state = buildCsfDropzoneState(
    { status: 'success', rfc: 'BMF821130AR3', fileName: 'csf.pdf' },
    { type: 'RESET' }
  );
  assert.strictEqual(state.status, 'idle');
  assert.strictEqual(state.rfc, null);
  assert.strictEqual(state.fileName, null);
});

// ─── buildCsfDatosExtraidos ───────────────────────────────────────────────────

const DATOS_COMPLETOS = {
  rfc: 'BMF821130AR3',
  razonSocial: 'BANCO DE MEXICO FIDEICOMISO',
  nombreCorto: 'BANCO DE MEXICO',
  idcif: '12345678901',
  cp: '06000',
  municipio: 'CUAUHTEMOC',
  estado: 'CIUDAD DE MEXICO',
  regimenFiscal: '601',
};

test('C6: buildCsfDatosExtraidos con datos completos retorna payload con todos los campos', () => {
  const payload = buildCsfDatosExtraidos(DATOS_COMPLETOS);
  assert.strictEqual(payload.rfc, 'BMF821130AR3');
  assert.strictEqual(payload.razonSocial, 'BANCO DE MEXICO FIDEICOMISO');
  assert.strictEqual(payload.nombreCorto, 'BANCO DE MEXICO');
  assert.strictEqual(payload.idcif, '12345678901');
  assert.strictEqual(payload.cp, '06000');
  assert.strictEqual(payload.municipio, 'CUAUHTEMOC');
  assert.strictEqual(payload.estado, 'CIUDAD DE MEXICO');
  assert.strictEqual(payload.regimenFiscal, '601');
});

test('C7: buildCsfDatosExtraidos campo usoCfdi tiene valor por defecto S01 si no se pasa', () => {
  const payload = buildCsfDatosExtraidos(DATOS_COMPLETOS);
  assert.strictEqual(payload.usoCfdi, 'S01');
});

test('C8: buildCsfDatosExtraidos acepta usoCfdi personalizado', () => {
  const payload = buildCsfDatosExtraidos({ ...DATOS_COMPLETOS, usoCfdi: 'G01' });
  assert.strictEqual(payload.usoCfdi, 'G01');
});

test('C9: buildCsfDatosExtraidos retorna error si falta rfc', () => {
  const { rfc: _r, ...sinRfc } = DATOS_COMPLETOS;
  const payload = buildCsfDatosExtraidos(sinRfc);
  assert.ok(payload.error, 'debe tener campo error');
  assert.ok(payload.error.includes('rfc'), 'error menciona rfc');
});

test('C10: buildCsfDatosExtraidos retorna error si falta razonSocial', () => {
  const { razonSocial: _r, ...sinNombre } = DATOS_COMPLETOS;
  const payload = buildCsfDatosExtraidos(sinNombre);
  assert.ok(payload.error, 'debe tener campo error');
  assert.ok(payload.error.includes('razonSocial'), 'error menciona razonSocial');
});

test('C11: buildCsfDatosExtraidos retorna error si falta nombreCorto', () => {
  const { nombreCorto: _n, ...sinNombreCorto } = DATOS_COMPLETOS;
  const payload = buildCsfDatosExtraidos(sinNombreCorto);
  assert.ok(payload.error, 'debe tener campo error');
  assert.ok(payload.error.includes('nombreCorto'), 'error menciona nombreCorto');
});

test('C12: buildCsfDatosExtraidos campos opcionales ausentes no generan error', () => {
  const soloRequeridos = { rfc: 'BMF821130AR3', razonSocial: 'BANCO DE MEXICO', nombreCorto: 'BANCO' };
  const payload = buildCsfDatosExtraidos(soloRequeridos);
  assert.ok(!payload.error, 'no debe tener error con campos requeridos presentes');
  assert.strictEqual(payload.idcif, '');
  assert.strictEqual(payload.cp, '');
  assert.strictEqual(payload.municipio, '');
  assert.strictEqual(payload.estado, '');
  assert.strictEqual(payload.regimenFiscal, '');
});

// ─── validarCsfCampos ─────────────────────────────────────────────────────────
const { validarCsfCampos } = require('./helpers.cjs');

test('C13: validarCsfCampos con todos los campos requeridos retorna null', () => {
  const getVal = id => ({ 'csf-rfc': 'BMF821130AR3', 'csf-razon-social': 'BANCO DE MEXICO', 'csf-nombre-corto': 'BANCO' })[id] || '';
  const err = validarCsfCampos(getVal);
  assert.strictEqual(err, null);
});

test('C14: validarCsfCampos sin RFC retorna mensaje de error con "RFC"', () => {
  const getVal = id => ({ 'csf-razon-social': 'BANCO DE MEXICO', 'csf-nombre-corto': 'BANCO' })[id] || '';
  const err = validarCsfCampos(getVal);
  assert.ok(err, 'debe retornar error');
  assert.ok(err.includes('RFC'), 'menciona RFC');
});

test('C15: validarCsfCampos sin razon social retorna mensaje de error', () => {
  const getVal = id => ({ 'csf-rfc': 'BMF821130AR3', 'csf-nombre-corto': 'BANCO' })[id] || '';
  const err = validarCsfCampos(getVal);
  assert.ok(err, 'debe retornar error');
  assert.ok(err.toLowerCase().includes('razon'), 'menciona razon social');
});

test('C16: validarCsfCampos sin nombre corto retorna mensaje de error', () => {
  const getVal = id => ({ 'csf-rfc': 'BMF821130AR3', 'csf-razon-social': 'BANCO DE MEXICO' })[id] || '';
  const err = validarCsfCampos(getVal);
  assert.ok(err, 'debe retornar error');
  assert.ok(err.toLowerCase().includes('nombre corto') || err.toLowerCase().includes('nombre'), 'menciona nombre corto');
});

// ─── buildCsfConfirmarPayload ─────────────────────────────────────────────────
const { buildCsfConfirmarPayload } = require('./helpers.cjs');

test('C17: buildCsfConfirmarPayload extrae todos los campos del formulario', () => {
  const vals = {
    'csf-rfc': 'BMF821130AR3',
    'csf-razon-social': 'BANCO DE MEXICO',
    'csf-nombre-corto': 'BANCO',
    'csf-idcif': '12345678901',
    'csf-regimen-fiscal': '601',
    'csf-uso-cfdi': 'G01',
    'csf-cp': '06000',
    'csf-municipio': 'CUAUHTEMOC',
    'csf-estado': 'CIUDAD DE MEXICO',
  };
  const getVal = id => vals[id] || '';
  const payload = buildCsfConfirmarPayload(getVal);
  assert.strictEqual(payload.rfc, 'BMF821130AR3');
  assert.strictEqual(payload.razonSocial, 'BANCO DE MEXICO');
  assert.strictEqual(payload.nombreCorto, 'BANCO');
  assert.strictEqual(payload.idcif, '12345678901');
  assert.strictEqual(payload.regimenFiscal, '601');
  assert.strictEqual(payload.usoCfdi, 'G01');
  assert.strictEqual(payload.cp, '06000');
  assert.strictEqual(payload.municipio, 'CUAUHTEMOC');
  assert.strictEqual(payload.estado, 'CIUDAD DE MEXICO');
});

test('C18: buildCsfConfirmarPayload con campos vacios retorna strings vacios', () => {
  const getVal = () => '';
  const payload = buildCsfConfirmarPayload(getVal);
  assert.strictEqual(payload.rfc, '');
  assert.strictEqual(payload.razonSocial, '');
  assert.strictEqual(payload.nombreCorto, '');
});
