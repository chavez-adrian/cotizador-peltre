// Nucleo puro del padron de contactos de domicilio (#105, hallazgos medidos en #397):
// GET /api/v3/admin/contact_list no filtra y trae TODOS los contactos de Operam
// (supplier, customer y cust_branch). Aqui se queda con los de domicilio de entrega
// (`type: cust_branch`, `entity_id` = branch_code) y descarta las filas vacias.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indiceContactosDomicilio } from '../lib/contactos-domicilio.js';

// Filas tal como las midio #397 en vivo (Operam 3.26.37), mas una de factura.
const FILAS = [
  { id: '3460', person_id: '1248', type: 'cust_branch', action: 'delivery', entity_id: '15', parent: 'Pestalozzi (Nombre del Domicilio)', name: 'Adrian Pestalozzi Nombre', ref: 'Adrian Pestalozzi Referencia', phone: '', email: '' },
  { id: '3462', person_id: '1249', type: 'cust_branch', action: 'delivery', entity_id: '564', parent: 'Bosques de Europa (Nombre del Domicilio)', name: 'Adrian Bosques Nombre', ref: 'Adrian Bosques Referencia', phone: '', email: '' },
  { id: '3463', person_id: '1250', type: 'cust_branch', action: 'invoice', entity_id: '564', parent: 'Bosques de Europa (Nombre del Domicilio)', name: 'Cuentas Bosques', ref: 'Facturacion', phone: '', phone2: '55 3333 4444', email: 'cxp.bosques@cliente.mx' },
  { id: '3425', person_id: '1200', type: 'cust_branch', action: 'delivery', entity_id: '15', parent: 'Pestalozzi', name: '', ref: '', phone: '', email: '' },
  { id: '100', person_id: '50', type: 'customer', action: 'invoice', entity_id: '15', name: 'Facturacion Cliente', phone: '', email: 'factura@cliente.mx' },
  { id: '200', person_id: '60', type: 'supplier', action: 'general', entity_id: '15', name: 'Proveedor', phone: '', email: 'prov@proveedor.mx' },
];

test('indexa los contactos de domicilio por branch_code con su marca y datos', () => {
  const indice = indiceContactosDomicilio(FILAS);
  assert.deepEqual(indice.get('564'), [
    { tag: 'delivery', nombre: 'Adrian Bosques Nombre', telefono: '', email: '' },
    { tag: 'invoice', nombre: 'Cuentas Bosques', telefono: '55 3333 4444', email: 'cxp.bosques@cliente.mx' },
  ]);
  assert.deepEqual(indice.get('15'), [
    { tag: 'delivery', nombre: 'Adrian Pestalozzi Nombre', telefono: '', email: '' },
  ]);
});

test('los contactos del Cliente Operam y de proveedores no entran: tienen su propia fuente (o no son de venta)', () => {
  const indice = indiceContactosDomicilio(FILAS);
  const todos = [...indice.values()].flat().map(c => c.nombre);
  assert.ok(!todos.includes('Facturacion Cliente'));
  assert.ok(!todos.includes('Proveedor'));
});

test('la fila vacia de cust_branch (id 3425) se descarta', () => {
  const indice = indiceContactosDomicilio(FILAS);
  assert.equal(indice.get('15').length, 1);
});

test('la marca sale de action y nunca de ref (en contact_list ref es texto libre)', () => {
  const indice = indiceContactosDomicilio([
    { type: 'cust_branch', action: '', entity_id: '9', name: 'Sin marca', ref: 'invoice', phone: '', email: 'x@y.mx' },
  ]);
  assert.equal(indice.get('9')[0].tag, '');
});

test('sin filas, o filas sin entity_id, deja un indice vacio', () => {
  assert.equal(indiceContactosDomicilio(undefined).size, 0);
  assert.equal(indiceContactosDomicilio([{ type: 'cust_branch', action: 'invoice', name: 'X', email: 'x@y.mx' }]).size, 0);
});
