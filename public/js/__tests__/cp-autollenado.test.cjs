'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let decidirCampoAsistido, planAutollenadoCP;

before(async () => {
  ({ decidirCampoAsistido, planAutollenadoCP } = await import('../cp-autollenado.js'));
});

test('un campo vacio recibe lo que resolvio el indice y lo recuerda', () => {
  assert.deepEqual(
    decidirCampoAsistido('', '', 'Cuauhtemoc'),
    { valor: 'Cuauhtemoc', delIndice: 'Cuauhtemoc' },
  );
});

test('lo tecleado a mano no se pisa, y el indice deja de reclamar el campo', () => {
  assert.deepEqual(
    decidirCampoAsistido('Cholula', '', 'Puebla'),
    { valor: 'Cholula', delIndice: '' },
  );
});

test('lo que puso el indice antes si lo reemplaza la nueva resolucion', () => {
  assert.deepEqual(
    decidirCampoAsistido('Cuauhtemoc', 'Cuauhtemoc', 'Puebla'),
    { valor: 'Puebla', delIndice: 'Puebla' },
  );
});

test('sin resolucion se borra SOLO lo que puso el indice', () => {
  assert.deepEqual(
    decidirCampoAsistido('Cuauhtemoc', 'Cuauhtemoc', ''),
    { valor: '', delIndice: '' },
  );
});

test('sin resolucion, lo tecleado a mano se queda', () => {
  assert.deepEqual(
    decidirCampoAsistido('Cholula', '', ''),
    { valor: 'Cholula', delIndice: '' },
  );
});

test('el plan llena los dos campos vacios y arma el aviso con lo que resolvio', () => {
  assert.deepEqual(
    planAutollenadoCP(
      { ciudad: '', estado: '' },
      { ciudad: '', estado: '' },
      { ciudad: 'Cuauhtemoc', estado: 'Ciudad de Mexico' },
    ),
    {
      valores: { ciudad: 'Cuauhtemoc', estado: 'Ciudad de Mexico' },
      delIndice: { ciudad: 'Cuauhtemoc', estado: 'Ciudad de Mexico' },
      aviso: '✓ Cuauhtemoc, Ciudad de Mexico',
    },
  );
});

test('sin resolucion el plan limpia lo del indice, respeta lo tecleado y no avisa', () => {
  assert.deepEqual(
    planAutollenadoCP(
      { ciudad: 'Cuauhtemoc', estado: 'Jalisco' },
      { ciudad: 'Cuauhtemoc', estado: '' },
      null,
    ),
    {
      valores: { ciudad: '', estado: 'Jalisco' },
      delIndice: { ciudad: '', estado: '' },
      aviso: '',
    },
  );
});

test('el plan decide campo por campo: llena el vacio y deja el tecleado', () => {
  assert.deepEqual(
    planAutollenadoCP(
      { ciudad: 'Cholula', estado: '' },
      { ciudad: '', estado: '' },
      { ciudad: 'Puebla', estado: 'Puebla' },
    ),
    {
      valores: { ciudad: 'Cholula', estado: 'Puebla' },
      delIndice: { ciudad: '', estado: 'Puebla' },
      // El aviso enumera lo que el indice PUSO: la ciudad tecleada no es suya.
      aviso: '✓ Puebla',
    },
  );
});

test('con los dos campos escritos a mano el indice no aporta nada y no hay aviso', () => {
  assert.deepEqual(
    planAutollenadoCP(
      { ciudad: 'Cholula', estado: 'Pue.' },
      { ciudad: '', estado: '' },
      { ciudad: 'Puebla', estado: 'Puebla' },
    ),
    {
      valores: { ciudad: 'Cholula', estado: 'Pue.' },
      delIndice: { ciudad: '', estado: '' },
      aviso: '',
    },
  );
});

test('solo MX, US y CA tienen indice; "Otro" no dispara la consulta', async () => {
  const { paisTieneIndiceCP } = await import('../cp-autollenado.js');
  assert.equal(paisTieneIndiceCP('MX'), true);
  assert.equal(paisTieneIndiceCP('US'), true);
  assert.equal(paisTieneIndiceCP('CA'), true);
  assert.equal(paisTieneIndiceCP('OT'), false);
  assert.equal(paisTieneIndiceCP(''), false);
  assert.equal(paisTieneIndiceCP(undefined), false);
});
