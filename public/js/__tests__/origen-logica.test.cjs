'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let origenDe, indiceOrigenPorCelular, llaveCelularOrigen, anotarOrigen;
before(async () => {
  ({ origenDe, indiceOrigenPorCelular, llaveCelularOrigen, anotarOrigen } =
    await import('../origen-logica.js'));
});

const PROSPECTOS = [
  { id: 1, nombre: 'Laura', canal: 'Instagram', celular: '+52 55 1234 5678' },
  { id: 2, nombre: 'Jorge Orea', canal: 'Feria/Expo', celular: '2223334444' },
];

test('O1: el prospecto trae su propio Origen en el campo canal', () => {
  const p = { nombre: 'Laura', canal: 'Instagram', celular: '+52 55 1234 5678' };
  assert.deepEqual(origenDe(p, new Map()), { origen: 'Instagram', identificado: true });
});

test('O2: la cotizacion hereda el Origen del prospecto del mismo celular, en cualquier formato', () => {
  const indice = indiceOrigenPorCelular(PROSPECTOS);
  // El telefono de la cotizacion viene en formato wa (52 + 10 digitos); el del
  // prospecto se capturo con espacios y codigo de pais con +.
  assert.deepEqual(origenDe({ cliente: 'Laura SA', telefono: '5215512345678' }, indice),
    { origen: 'Instagram', identificado: true });
  assert.deepEqual(origenDe({ cliente: 'Jorge Orea', telefono: '(222) 333-4444' }, indice),
    { origen: 'Feria/Expo', identificado: true });
});

test('O2b: el indice se arma por los ultimos 10 digitos (llave de identidad)', () => {
  const indice = indiceOrigenPorCelular(PROSPECTOS);
  assert.deepEqual([...indice.keys()].sort(), ['2223334444', '5512345678']);
  assert.equal(llaveCelularOrigen('+52 55 1234 5678 ext. 116'), '5512345678');
  // Un prospecto sin canal no aporta origen; uno sin celular no tiene llave.
  const parcial = indiceOrigenPorCelular([
    { celular: '5500000000', canal: '' },
    { celular: '', canal: 'Correo' },
  ]);
  assert.equal(parcial.size, 0);
});

test('O3: sin prospecto ligado el Origen queda sin identificar', () => {
  const indice = indiceOrigenPorCelular(PROSPECTOS);
  assert.deepEqual(origenDe({ cliente: 'Cliente historico', telefono: '5599998888' }, indice),
    { origen: '', identificado: false });
  assert.deepEqual(origenDe({ cliente: 'Cliente sin telefono' }, indice),
    { origen: '', identificado: false });
});

test('O4: anotarOrigen deja el origen en cada item sin mutar el listado', () => {
  const indice = indiceOrigenPorCelular(PROSPECTOS);
  const items = [
    { cliente: 'Laura SA', telefono: '5215512345678' },
    { cliente: 'Cliente historico', telefono: '5599998888' },
  ];
  const anotados = anotarOrigen(items, indice);
  assert.deepEqual(anotados.map(i => i.origen), ['Instagram', '']);
  assert.equal(items[0].origen, undefined);
});

test('O5: el cliente de Operam liga por cualquiera de sus telefonos', () => {
  const indice = indiceOrigenPorCelular(PROSPECTOS);
  const fila = { tipo: 'operam', nombre: 'JORGE OREA SA', telefonos: ['555 000 0000', '+52 222 333 4444'] };
  assert.deepEqual(origenDe(fila, indice), { origen: 'Feria/Expo', identificado: true });
});
