'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

// Correos de factura del paso Envio (#105, alcance de LECTURA decidido por Adrian
// 2026-09-25): se muestran los correos de los Contactos en Operam marcados Invoices
// del Cliente Operam y de su domicilio de entrega, para que el vendedor sepa a donde
// llegara la factura. Un contacto sin la marca NUNCA cuenta (el bug de origen
// prellenaba gustavo_barcia@yahoo.com, que es el General). Sin ninguno Invoices el
// correo de factura queda para captura manual.

let correosFactura, textoCorreosFactura, avisoCorreosFactura;

before(async () => {
  ({ correosFactura, textoCorreosFactura, avisoCorreosFactura } = await import('../alta-logica.js'));
});

// Forma de contacts[] de GET /api/operam/clientes/:id/domicilios (mapearContactosCliente).
const CONTACTOS_CLIENTE = [
  { tag: 'general', nombre: 'Gustavo Barcia', telefono: '55 4860 9144', email: 'gustavo_barcia@yahoo.com' },
  { tag: 'invoice', nombre: 'Elisa Betancourt', telefono: '', email: 'elisa.betancourt@cliente.mx' },
  { tag: 'delivery', nombre: 'Almacen', telefono: '55 1111 2222', email: 'almacen@cliente.mx' },
  { tag: 'invoice', nombre: 'Flor Sosa', telefono: '', email: 'flor.sosa@cliente.mx' },
];

test('C1: solo los contactos Invoices del Cliente Operam (caso Elisa Betancourt y Flor Sosa)', () => {
  assert.deepEqual(correosFactura(null, CONTACTOS_CLIENTE), [
    { nombre: 'Elisa Betancourt', email: 'elisa.betancourt@cliente.mx' },
    { nombre: 'Flor Sosa', email: 'flor.sosa@cliente.mx' },
  ]);
});

test('C2: un contacto sin la marca Invoices nunca es correo de factura (gustavo_barcia@yahoo.com)', () => {
  const soloGeneral = [CONTACTOS_CLIENTE[0], CONTACTOS_CLIENTE[2]];
  assert.deepEqual(correosFactura(null, soloGeneral), []);
  const todos = correosFactura(null, CONTACTOS_CLIENTE).map(c => c.email);
  assert.ok(!todos.includes('gustavo_barcia@yahoo.com'));
});

test('C3: un contacto Invoices sin correo no aporta nada (no hay a donde mandar la factura)', () => {
  const r = correosFactura(null, [{ tag: 'invoice', nombre: 'Facturacion', telefono: '55 0000 0000', email: '' }]);
  assert.deepEqual(r, []);
});

test('C4: los Invoices del domicilio de entrega van primero y luego los del Cliente Operam', () => {
  const domicilio = {
    branch_code: '564',
    contactos: [
      { tag: 'delivery', nombre: 'Adrian Bosques Nombre', telefono: '', email: 'bosques@cliente.mx' },
      { tag: 'invoice', nombre: 'Cuentas Bosques', telefono: '', email: 'cxp.bosques@cliente.mx' },
    ],
  };
  assert.deepEqual(correosFactura(domicilio, CONTACTOS_CLIENTE), [
    { nombre: 'Cuentas Bosques', email: 'cxp.bosques@cliente.mx' },
    { nombre: 'Elisa Betancourt', email: 'elisa.betancourt@cliente.mx' },
    { nombre: 'Flor Sosa', email: 'flor.sosa@cliente.mx' },
  ]);
});

test('C5: el mismo correo en el domicilio y en el Cliente Operam sale una vez (mayusculas y espacios no cuentan)', () => {
  const domicilio = { contactos: [{ tag: 'invoice', nombre: 'Elisa B.', telefono: '', email: ' Elisa.Betancourt@Cliente.mx ' }] };
  const r = correosFactura(domicilio, CONTACTOS_CLIENTE);
  assert.equal(r.length, 2);
  assert.equal(r[0].nombre, 'Elisa B.');
  assert.equal(r[0].email, 'Elisa.Betancourt@Cliente.mx');
  assert.equal(r[1].email, 'flor.sosa@cliente.mx');
});

test('C6: sin domicilio, sin contactos o con la cache fria del domicilio (sin contactos) no truena', () => {
  assert.deepEqual(correosFactura(undefined, undefined), []);
  assert.deepEqual(correosFactura({ branch_code: '15' }, null), []);
  assert.deepEqual(correosFactura({ contactos: null }, []), []);
});

test('T1: el texto nombra a cada contacto con su correo', () => {
  const t = textoCorreosFactura([
    { nombre: 'Elisa Betancourt', email: 'elisa.betancourt@cliente.mx' },
    { nombre: 'Flor Sosa', email: 'flor.sosa@cliente.mx' },
  ]);
  assert.equal(t, 'La factura llega a los contactos de Facturacion en Operam: Elisa Betancourt (elisa.betancourt@cliente.mx), Flor Sosa (flor.sosa@cliente.mx)');
});

test('T2: un contacto sin nombre sale solo con su correo', () => {
  assert.equal(
    textoCorreosFactura([{ nombre: '', email: 'factura@cliente.mx' }]),
    'La factura llega a los contactos de Facturacion en Operam: factura@cliente.mx'
  );
});

test('T3: sin ninguno Invoices el texto lo dice y manda a la captura manual', () => {
  assert.equal(
    textoCorreosFactura([]),
    'Este Cliente Operam no tiene contactos de Facturacion en Operam: captura el correo para factura a mano.'
  );
});

// Lo que pinta el paso Envio. domicilio.contactos en null = el servidor todavia no
// tiene el padron de contact_list (cache fria u Operam caido): no se sabe si el
// domicilio tiene contactos de Facturacion y el aviso no puede afirmar que no hay.
test('A1: con contactos Invoices el aviso los nombra, aunque el domicilio aun no se sepa', () => {
  const t = avisoCorreosFactura({ branch_code: '15', contactos: null }, CONTACTOS_CLIENTE);
  assert.equal(t, 'La factura llega a los contactos de Facturacion en Operam: Elisa Betancourt (elisa.betancourt@cliente.mx), Flor Sosa (flor.sosa@cliente.mx)');
});

test('A2: sin ninguno Invoices y con el domicilio leido, dice que no hay y manda a captura manual', () => {
  const soloGeneral = [CONTACTOS_CLIENTE[0]];
  const esperado = 'Este Cliente Operam no tiene contactos de Facturacion en Operam: captura el correo para factura a mano.';
  assert.equal(avisoCorreosFactura({ branch_code: '15', contactos: [] }, soloGeneral), esperado);
  assert.equal(avisoCorreosFactura(undefined, soloGeneral), esperado, 'sin domicilios no hay nada mas que leer');
});

test('A3: sin ninguno Invoices y con el domicilio SIN leer, no afirma nada (null)', () => {
  assert.equal(avisoCorreosFactura({ branch_code: '564', contactos: null }, [CONTACTOS_CLIENTE[0]]), null);
  assert.equal(avisoCorreosFactura({ branch_code: '564' }, []), null);
});
