'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

// === validarCamposCsf (issue #390) ===
// La pestana CSF del panel (alta Y upgrade fiscal, mismo nodo) exige el regimen
// fiscal: si llega vacio al alta, buildClienteBody lo rellena EN SILENCIO con 612.
// Con varios regimenes en la constancia el vendedor confirma uno; "no elegir" nunca
// puede viajar vacio.

let validarCamposCsf;
before(async () => {
  ({ validarCamposCsf } = await import('../alta-logica.js'));
});

const DATOS = {
  rfc: 'PEGJ850214HN2', razonSocial: 'JUAN CARLOS PEREZ GARCIA',
  nombreCorto: 'Juan Carlos Perez', regimenFiscal: '605',
};

test('CSF1: con RFC, razon social, nombre corto y regimen del catalogo no hay error', () => {
  assert.strictEqual(validarCamposCsf(DATOS), null);
});

test('CSF2: sin regimen fiscal no se confirma', () => {
  assert.strictEqual(validarCamposCsf({ ...DATOS, regimenFiscal: '' }), 'El regimen fiscal es obligatorio');
});

test('CSF3: un regimen fuera del catalogo del SAT no se confirma', () => {
  assert.strictEqual(validarCamposCsf({ ...DATOS, regimenFiscal: '999' }),
    'El regimen fiscal no es una clave del catalogo del SAT');
});

test('CSF4: los obligatorios de siempre siguen primero (RFC, razon social, nombre corto)', () => {
  assert.strictEqual(validarCamposCsf({ ...DATOS, rfc: '' }), 'El RFC es obligatorio');
  assert.strictEqual(validarCamposCsf({ ...DATOS, razonSocial: '' }), 'La razon social es obligatoria');
  assert.strictEqual(validarCamposCsf({ ...DATOS, nombreCorto: '' }), 'El nombre corto es obligatorio');
});
