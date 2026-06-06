'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

// Functions not yet exported from helpers.cjs -- will fail RED
const { validarRfcManual, buildManualDatosExtraidos, buildCsfDatosExtraidos } = require('./helpers.cjs');

// ─── validarRfcManual ─────────────────────────────────────────────────────────

test('M1: validarRfcManual RFC persona fisica MX valido retorna null', () => {
  // UEGA850312KL5 = 13 chars persona fisica
  const err = validarRfcManual('UEGA850312KL5', 'MX');
  assert.strictEqual(err, null);
});

test('M2: validarRfcManual RFC persona moral MX valido retorna null', () => {
  // SMS200716NZ4 = 12 chars persona moral
  const err = validarRfcManual('SMS200716NZ4', 'MX');
  assert.strictEqual(err, null);
});

test('M3: validarRfcManual XAXX010101000 (RFC generico MX) valido retorna null', () => {
  const err = validarRfcManual('XAXX010101000', 'MX');
  assert.strictEqual(err, null);
});

test('M4: validarRfcManual XEXX010101000 (RFC generico extranjero) valido en MX retorna null', () => {
  const err = validarRfcManual('XEXX010101000', 'MX');
  assert.strictEqual(err, null);
});

test('M5: validarRfcManual RFC formato invalido MX retorna error', () => {
  const err = validarRfcManual('123', 'MX');
  assert.ok(err, 'debe retornar mensaje de error');
  assert.ok(typeof err === 'string', 'error debe ser string');
});

test('M6: validarRfcManual RFC demasiado corto para MX retorna error', () => {
  const err = validarRfcManual('ABCD1234', 'MX');
  assert.ok(err, 'debe retornar error para RFC corto');
});

test('M7: validarRfcManual pais extranjero US acepta cualquier valor retorna null', () => {
  const err = validarRfcManual('ANY_VALUE_123', 'US');
  assert.strictEqual(err, null);
});

test('M8: validarRfcManual pais extranjero CA acepta cualquier valor retorna null', () => {
  const err = validarRfcManual('12345', 'CA');
  assert.strictEqual(err, null);
});

test('M9: validarRfcManual pais Otro acepta cualquier valor retorna null', () => {
  const err = validarRfcManual('FOREIGN-TAX-ID', 'Otro');
  assert.strictEqual(err, null);
});

test('M10: validarRfcManual RFC vacio en MX retorna error', () => {
  const err = validarRfcManual('', 'MX');
  assert.ok(err, 'RFC vacio debe retornar error');
});

// ─── buildManualDatosExtraidos ────────────────────────────────────────────────

const CAMPOS_MANUAL_COMPLETOS = {
  rfc: 'SMS200716NZ4',
  razonSocial: 'SAGO MEDICAL SERVICE SA DE CV',
  nombreCorto: 'SAGO MEDICAL',
  idcif: '20090146505',
  cp: '06760',
  municipio: 'CUAUHTEMOC',
  estado: 'CIUDAD DE MEXICO',
  regimenFiscal: '601',
  usoCfdi: 'G01',
  pais: 'MX',
};

test('M11: buildManualDatosExtraidos con campos completos retorna todos los campos', () => {
  const payload = buildManualDatosExtraidos(CAMPOS_MANUAL_COMPLETOS);
  assert.strictEqual(payload.rfc, 'SMS200716NZ4');
  assert.strictEqual(payload.razonSocial, 'SAGO MEDICAL SERVICE SA DE CV');
  assert.strictEqual(payload.nombreCorto, 'SAGO MEDICAL');
  assert.strictEqual(payload.idcif, '20090146505');
  assert.strictEqual(payload.cp, '06760');
  assert.strictEqual(payload.municipio, 'CUAUHTEMOC');
  assert.strictEqual(payload.estado, 'CIUDAD DE MEXICO');
  assert.strictEqual(payload.regimenFiscal, '601');
  assert.strictEqual(payload.usoCfdi, 'G01');
  assert.strictEqual(payload.pais, 'MX');
});

test('M12: buildManualDatosExtraidos retorna error si falta rfc', () => {
  const { rfc: _r, ...sinRfc } = CAMPOS_MANUAL_COMPLETOS;
  const payload = buildManualDatosExtraidos(sinRfc);
  assert.ok(payload.error, 'debe tener campo error');
  assert.ok(payload.error.includes('rfc'), 'error menciona rfc');
});

test('M13: buildManualDatosExtraidos retorna error si falta razonSocial', () => {
  const { razonSocial: _r, ...sinNombre } = CAMPOS_MANUAL_COMPLETOS;
  const payload = buildManualDatosExtraidos(sinNombre);
  assert.ok(payload.error, 'debe tener campo error');
  assert.ok(payload.error.includes('razonSocial'), 'error menciona razonSocial');
});

test('M14: buildManualDatosExtraidos retorna error si falta nombreCorto', () => {
  const { nombreCorto: _n, ...sinNombreCorto } = CAMPOS_MANUAL_COMPLETOS;
  const payload = buildManualDatosExtraidos(sinNombreCorto);
  assert.ok(payload.error, 'debe tener campo error');
  assert.ok(payload.error.includes('nombreCorto'), 'error menciona nombreCorto');
});

test('M15: buildManualDatosExtraidos campos opcionales ausentes no generan error', () => {
  const soloRequeridos = { rfc: 'SMS200716NZ4', razonSocial: 'SAGO MEDICAL SERVICE', nombreCorto: 'SAGO' };
  const payload = buildManualDatosExtraidos(soloRequeridos);
  assert.ok(!payload.error, 'no debe tener error');
  assert.strictEqual(payload.idcif, '');
  assert.strictEqual(payload.cp, '');
  assert.strictEqual(payload.municipio, '');
  assert.strictEqual(payload.estado, '');
  assert.strictEqual(payload.regimenFiscal, '');
  assert.strictEqual(payload.usoCfdi, 'S01');
  assert.strictEqual(payload.pais, 'MX');
});

// ─── invariante: misma estructura que buildCsfDatosExtraidos ─────────────────

test('M16: buildManualDatosExtraidos produce misma estructura que buildCsfDatosExtraidos', () => {
  const csfInput = {
    rfc: 'SMS200716NZ4',
    razonSocial: 'SAGO MEDICAL SERVICE SA DE CV',
    nombreCorto: 'SAGO MEDICAL',
    idcif: '20090146505',
    cp: '06760',
    municipio: 'CUAUHTEMOC',
    estado: 'CIUDAD DE MEXICO',
    regimenFiscal: '601',
    usoCfdi: 'G01',
  };
  const manualInput = { ...csfInput, pais: 'MX' };

  const csfPayload = buildCsfDatosExtraidos(csfInput);
  const manualPayload = buildManualDatosExtraidos(manualInput);

  // Campos canonicos que deben existir en ambos
  const campos = ['rfc', 'razonSocial', 'nombreCorto', 'idcif', 'cp', 'municipio', 'estado', 'regimenFiscal', 'usoCfdi'];
  for (const campo of campos) {
    assert.ok(campo in csfPayload, `CSF debe tener ${campo}`);
    assert.ok(campo in manualPayload, `Manual debe tener ${campo}`);
    assert.strictEqual(manualPayload[campo], csfPayload[campo], `${campo} debe ser igual en ambos modos`);
  }
});

test('M17: buildManualDatosExtraidos incluye campo pais que no existe en CSF', () => {
  const payload = buildManualDatosExtraidos(CAMPOS_MANUAL_COMPLETOS);
  assert.ok('pais' in payload, 'modo manual debe incluir campo pais');
  assert.strictEqual(payload.pais, 'MX');
});
