import { test } from 'node:test';
import assert from 'node:assert/strict';
import { referenciaDelCliente } from '../lib/referencia-cliente.js';

test('usa la referencia capturada cuando existe', () => {
  assert.equal(referenciaDelCliente({
    referencia: 'OC-4521', nombreCorto: 'El Pendulo',
    nombreEntrega: 'Almacen Roma', razonSocial: 'EL PENDULO SA DE CV',
  }), 'OC-4521');
});

test('sin referencia cae a nombreCorto', () => {
  assert.equal(referenciaDelCliente({
    nombreCorto: 'El Pendulo', nombreEntrega: 'Almacen Roma', razonSocial: 'EL PENDULO SA DE CV',
  }), 'El Pendulo');
});

test('sin referencia ni nombreCorto cae a nombreEntrega', () => {
  assert.equal(referenciaDelCliente({
    nombreEntrega: 'Almacen Roma', razonSocial: 'EL PENDULO SA DE CV',
  }), 'Almacen Roma');
});

test('razonSocial es el ultimo escalon', () => {
  assert.equal(referenciaDelCliente({ razonSocial: 'EL PENDULO SA DE CV' }), 'EL PENDULO SA DE CV');
});

test('un escalon de solo espacios cuenta como vacio', () => {
  assert.equal(referenciaDelCliente({
    referencia: '   ', nombreCorto: '\t', nombreEntrega: '\n  ', razonSocial: 'EL PENDULO SA DE CV',
  }), 'EL PENDULO SA DE CV');
});

test('devuelve la fuente elegida sin espacios de orilla', () => {
  assert.equal(referenciaDelCliente({ referencia: '  Boda Fernandez  ' }), 'Boda Fernandez');
});

test('cliente vacio, nulo o no objeto da cadena vacia', () => {
  assert.equal(referenciaDelCliente({}), '');
  assert.equal(referenciaDelCliente(null), '');
  assert.equal(referenciaDelCliente(undefined), '');
});

test('NO trunca: el limite de 60 es del quote de Operam, no del documento', () => {
  const larga = 'A'.repeat(80);
  assert.equal(referenciaDelCliente({ referencia: larga }), larga);
});
