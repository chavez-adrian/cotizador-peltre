import { test } from 'node:test';
import assert from 'node:assert/strict';
import { celsNoAplicados } from '../lib/cel-operam.js';

// Nucleo puro de la verificacion del Cel (#339, ADR-0016): recibe el cliente
// RELEIDO de Operam (GET /customers/:id, el unico que expone `fax` de contactos y
// sucursales) y devuelve lo que NO quedo escrito.

test('el Cel guardado con otro formato cuenta como escrito: la llave es el celular, no el texto', () => {
  const fresco = { contacts: [{ action: 'general', fax: '+52 55 3466 7682' }], branches: [] };
  assert.deepEqual(celsNoAplicados(fresco, { celCliente: '5534667682' }), []);
});

test('con varios Contactos en Operam basta que uno traiga el Cel', () => {
  const fresco = {
    contacts: [
      { action: 'invoice', fax: '' },
      { action: 'general', fax: '5534667682' },
    ],
    branches: [],
  };
  assert.deepEqual(celsNoAplicados(fresco, { celCliente: '5534667682' }), []);
});

test('sin el Cel en ningun Contacto lo reporta como campo no aplicado', () => {
  const fresco = { contacts: [{ action: 'general', fax: '', phone: '5534667682' }], branches: [] };
  assert.deepEqual(celsNoAplicados(fresco, { celCliente: '5534667682' }), [
    { campo: 'fax', label: 'Cel del contacto', nuevo: '5534667682' },
  ]);
});

test('la sucursal se identifica por su branch_code: el Cel en otra sucursal no cuenta', () => {
  const fresco = { contacts: [], branches: [{ branch_code: '15', fax: '5534667682' }, { branch_code: '564', fax: '' }] };
  assert.deepEqual(celsNoAplicados(fresco, { celBranch: '5534667682', branchId: 564 }), [
    { campo: 'fax', label: 'Cel de la sucursal', nuevo: '5534667682' },
  ]);
  assert.deepEqual(celsNoAplicados(fresco, { celBranch: '5534667682', branchId: '15' }), []);
});

test('lo que no se envio no se verifica', () => {
  const fresco = { contacts: [], branches: [] };
  assert.deepEqual(celsNoAplicados(fresco, { celCliente: '', celBranch: '' }), []);
});

test('un cliente releido sin contacts ni branches reporta lo enviado, no truena', () => {
  assert.deepEqual(celsNoAplicados({}, { celCliente: '5534667682', celBranch: '5534667682', branchId: 1 }), [
    { campo: 'fax', label: 'Cel del contacto', nuevo: '5534667682' },
    { campo: 'fax', label: 'Cel de la sucursal', nuevo: '5534667682' },
  ]);
});
