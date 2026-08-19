'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

// === validarAltaManualMinimos (issue #95 regla 4) ===
// Decision de Adrian: hay clientes que prefieren no compartir su CSF. La pestana
// "Captura manual" debe permitir dar de alta con el domicilio fiscal minimo:
// Razon Social, RFC, Codigo Postal y Regimen Fiscal son obligatorios; calle,
// numero, colonia y estado quedan opcionales. Antes el unico obligatorio adicional
// (fuera de RFC/razon social) era el nombre corto, y CP/regimen fiscal no se
// validaban -- este test fija la validacion nueva EXACTA.

let validarAltaManualMinimos;
before(async () => {
  ({ validarAltaManualMinimos } = await import('../alta-logica.js'));
});

const DATOS_COMPLETOS = {
  rfc: 'SMS200716NZ4', razonSocial: 'Sago Medical Service SA de CV',
  nombreCorto: '', cp: '06760', regimenFiscal: '601',
};

test('M1: con los 4 minimos presentes retorna null (sin nombre corto)', () => {
  assert.strictEqual(validarAltaManualMinimos(DATOS_COMPLETOS), null);
});

test('M2: sin RFC retorna error mencionando RFC', () => {
  const err = validarAltaManualMinimos({ ...DATOS_COMPLETOS, rfc: '' });
  assert.ok(err && err.toUpperCase().includes('RFC'));
});

test('M3: sin razon social retorna error mencionando razon social', () => {
  const err = validarAltaManualMinimos({ ...DATOS_COMPLETOS, razonSocial: '' });
  assert.ok(err && err.toLowerCase().includes('razon social'));
});

test('M4: sin codigo postal retorna error (antes no se exigia)', () => {
  const err = validarAltaManualMinimos({ ...DATOS_COMPLETOS, cp: '' });
  assert.ok(err && err.toLowerCase().includes('codigo postal'));
});

test('M5: sin regimen fiscal retorna error (antes no se exigia)', () => {
  const err = validarAltaManualMinimos({ ...DATOS_COMPLETOS, regimenFiscal: '' });
  assert.ok(err && err.toLowerCase().includes('regimen fiscal'));
});

test('M6: sin nombre corto NO es error (antes era obligatorio, ahora opcional)', () => {
  const err = validarAltaManualMinimos({ ...DATOS_COMPLETOS, nombreCorto: '' });
  assert.strictEqual(err, null);
});

test('M7: calle/numero/colonia/estado ausentes NO son error (opcionales)', () => {
  const err = validarAltaManualMinimos({ ...DATOS_COMPLETOS, calle: '', numExt: '', colonia: '', estado: '' });
  assert.strictEqual(err, null);
});

// El regimen dejo de ser texto libre (issue #191): antes bastaba con que no
// estuviera vacio, asi que un codigo inventado viajaba literal al POST/PUT de
// Operam. Ahora tiene que pertenecer al catalogo del SAT.

test('M8: un regimen que no existe en el catalogo del SAT es error', () => {
  const err = validarAltaManualMinimos({ ...DATOS_COMPLETOS, regimenFiscal: '999' });
  assert.ok(err && err.toLowerCase().includes('regimen fiscal'));
});

test('M9: "6O1" con letra O es error (el error de dedo que antes pasaba)', () => {
  const err = validarAltaManualMinimos({ ...DATOS_COMPLETOS, regimenFiscal: '6O1' });
  assert.ok(err);
});

test('M10: pegar el codigo junto con su descripcion es error', () => {
  const err = validarAltaManualMinimos({ ...DATOS_COMPLETOS, regimenFiscal: '601 General de Ley Personas Morales' });
  assert.ok(err);
});

test('M11: un regimen agregado en #191 (626 RESICO) es aceptado', () => {
  assert.strictEqual(validarAltaManualMinimos({ ...DATOS_COMPLETOS, regimenFiscal: '626' }), null);
});
