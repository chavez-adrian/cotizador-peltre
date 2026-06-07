'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

// csf-upload.html ya no tiene su propio parsearCSF (~123 lineas, regex de SAT duplicados) --
// consume POST /api/parsear-csf (endpoint centralizado de #33, envuelve lib/parsear-csf.js).
// Esta funcion pura mapea { rfc, razonSocial, nombreCorto, calle, numExt, numInt, colonia,
// municipio, estado, cp, idcif, regimenFiscal, pais } (shape del endpoint) + derivados locales
// (regimen_text/notes/csf_fecha/actividades, que el endpoint NO produce -- son presentacion
// exclusiva de esta herramienta) a la forma que poblarForm() espera (issue #34 punto 4).
const { buildCsfUploadDatosDesdeEndpoint, buildCsfUploadDatosParseo } = require('./helpers.cjs');

const DATOS_ENDPOINT_PERSONA_MORAL = {
  rfc: 'SMS200716NZ4',
  razonSocial: 'SAGO MEDICAL SERVICE SA DE CV',
  nombreCorto: 'SAGO MEDICAL SERVICE',
  idcif: '20090146505',
  regimenFiscal: '601',
  calle: 'NAYARIT',
  numExt: '56',
  numInt: '',
  colonia: 'ROMA SUR',
  cp: '06760',
  municipio: 'CUAUHTEMOC',
  estado: 'CIUDAD DE MEXICO',
  pais: 'MX',
};

test('U1: mapea campos centrales del endpoint al shape de poblarForm (tax_id/CustName/street/etc)', () => {
  const r = buildCsfUploadDatosDesdeEndpoint(DATOS_ENDPOINT_PERSONA_MORAL, '');
  assert.strictEqual(r.tax_id, 'SMS200716NZ4');
  assert.strictEqual(r.CustName, 'SAGO MEDICAL SERVICE SA DE CV');
  assert.strictEqual(r.cust_ref, 'SAGO MEDICAL SERVICE');
  assert.strictEqual(r.idcif, '20090146505');
  assert.strictEqual(r.street, 'NAYARIT');
  assert.strictEqual(r.street_number, '56');
  assert.strictEqual(r.suite_number, '');
  assert.strictEqual(r.district, 'ROMA SUR');
  assert.strictEqual(r.postal_code, '06760');
  assert.strictEqual(r.city, 'CUAUHTEMOC');
  assert.strictEqual(r.state, 'CIUDAD DE MEXICO');
  assert.strictEqual(r.cfdi_regimen_fiscal, '601');
});

test('U2: country siempre es Mexico (lib/parsear-csf.js retorna pais:"MX", la herramienta usa nombre completo)', () => {
  const r = buildCsfUploadDatosDesdeEndpoint(DATOS_ENDPOINT_PERSONA_MORAL, '');
  assert.strictEqual(r.country, 'México');
});

test('U3: campos vacios del endpoint mapean a strings vacios (no undefined/null)', () => {
  const r = buildCsfUploadDatosDesdeEndpoint({}, '');
  assert.strictEqual(r.tax_id, '');
  assert.strictEqual(r.street, '');
  assert.strictEqual(r.suite_number, '');
});

test('U4: deriva csf_fecha del texto crudo (formato PDF "A DD DE MES DE AAAA")', () => {
  const texto = 'CONSTANCIA\nA 02 DE ENERO DE 2026\nRFC: SMS200716NZ4';
  const r = buildCsfUploadDatosDesdeEndpoint(DATOS_ENDPOINT_PERSONA_MORAL, texto);
  assert.strictEqual(r.csf_fecha, '2026-01-02');
});

test('U5: deriva regimen_text via REGIMENES (label legible que el endpoint no produce)', () => {
  const texto = 'Regimen Fiscal: 601 General de Ley Personas Morales';
  const r = buildCsfUploadDatosDesdeEndpoint(DATOS_ENDPOINT_PERSONA_MORAL, texto);
  assert.ok(r.regimen_text.includes('General de Ley Personas Morales'), `regimen_text: ${r.regimen_text}`);
});

test('U6: deriva notes con actividades economicas extraidas del texto crudo', () => {
  const texto = '46311 Comercio al por mayor de abarrotes 100 01/01/2020';
  const r = buildCsfUploadDatosDesdeEndpoint(DATOS_ENDPOINT_PERSONA_MORAL, texto);
  assert.ok(r.notes.includes('Comercio al por mayor de abarrotes'), `notes: ${r.notes}`);
});

// ─── buildCsfUploadDatosParseo: decision de parsearCSF ante la respuesta de /api/parsear-csf ──
// Issue #34 (corrida 2): el endpoint puede responder {ok:false} (HTTP 422, "No se detecto un
// RFC en el texto"). El parser viejo NUNCA fallaba (siempre devolvia datos usables, rfc:'' si
// no detectaba nada). Esta funcion mirrorea la decision que debe tomar parsearCSF: SIEMPRE
// devolver un objeto datos mapeado y usable -- nunca lanzar -- para que procesarPDF muestre
// formSection con captura manual habilitada (igual patron que altaCsfResultadoParseo, iter5).
test('U7: {ok:true, datos} mapea al shape de poblarForm con los campos centrales poblados', () => {
  const json = { ok: true, datos: DATOS_ENDPOINT_PERSONA_MORAL };
  const r = buildCsfUploadDatosParseo(json, '');
  assert.strictEqual(r.tax_id, 'SMS200716NZ4');
  assert.strictEqual(r.CustName, 'SAGO MEDICAL SERVICE SA DE CV');
  assert.strictEqual(r.street, 'NAYARIT');
});

test('U8: {ok:false} (RFC no detectado) NO lanza -- devuelve datos usables con campos centrales vacios', () => {
  const json = { ok: false, error: 'No se detecto un RFC en el texto' };
  const r = buildCsfUploadDatosParseo(json, '');
  assert.strictEqual(r.tax_id, '');
  assert.strictEqual(r.CustName, '');
  assert.strictEqual(r.street, '');
  assert.strictEqual(r.suite_number, '');
});

test('U9: {ok:false} preserva los derivados de presentacion del texto crudo (csf_fecha/regimen_text/notes)', () => {
  const texto = 'CONSTANCIA\nA 02 DE ENERO DE 2026\nRegimen Fiscal: 601 General de Ley Personas Morales\n'
    + '46311 Comercio al por mayor de abarrotes 100 01/01/2020';
  const json = { ok: false, error: 'No se detecto un RFC en el texto' };
  const r = buildCsfUploadDatosParseo(json, texto);
  assert.strictEqual(r.csf_fecha, '2026-01-02');
  assert.ok(r.regimen_text.includes('General de Ley Personas Morales'), `regimen_text: ${r.regimen_text}`);
  assert.ok(r.notes.includes('Comercio al por mayor de abarrotes'), `notes: ${r.notes}`);
});

test('U10: respuesta invalida (sin ok ni datos reconocibles) tampoco lanza -- devuelve datos vacios usables', () => {
  const r = buildCsfUploadDatosParseo(null, '');
  assert.strictEqual(r.tax_id, '');
  assert.strictEqual(r.CustName, '');
});
