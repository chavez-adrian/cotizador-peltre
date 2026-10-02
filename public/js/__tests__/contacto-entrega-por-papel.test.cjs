'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

// El contacto de entrega que PROPONE el cotizador (#494, criterio del triage del
// 2026-09-30 sin objecion de Adrian). Hallazgo de la verificacion de #459: con el
// domicilio en la opcion vacia la lista son los contactos del Cliente Operam en el
// orden de Operam, y si el primero era el de Facturacion el contacto de entrega
// abria en el, que no suele ser quien recibe la mercancia. La propuesta va por
// papel: Entrega, luego General, y Facturacion solo si no hay otro; entre iguales,
// el orden de la lista. Lo capturado a mano no se mueve (#422).

let seleccionContactoEntrega, contactoAlCambiarDomicilio, contactosEntregaDisponibles;

before(async () => {
  ({ seleccionContactoEntrega, contactoAlCambiarDomicilio, contactosEntregaDisponibles } = await import('../alta-logica.js'));
});

const FACTURACION = { tag: 'invoice', nombre: 'Marta Contabilidad', telefono: '55 1111 0000', email: 'facturas@cliente.mx' };
const GENERAL = { tag: 'general', nombre: 'Luis Compras', telefono: '55 2222 0000', email: 'compras@cliente.mx' };
const ENTREGA = { tag: 'delivery', nombre: 'Pedro Almacen', telefono: '55 3333 0000', email: 'almacen@cliente.mx' };
const VACIO = { nombre: '', telefono: '', email: '' };

const sinDomicilio = contactosCliente => contactosEntregaDisponibles(null, contactosCliente);

test('CP1: [Facturacion, General] sin domicilio -> se propone el General', () => {
  const contactos = sinDomicilio([FACTURACION, GENERAL]);
  const r = seleccionContactoEntrega(contactos, VACIO);
  assert.deepStrictEqual(r, { indice: 1, aplicar: true });
  assert.equal(contactos[r.indice].nombre, 'Luis Compras');
});

test('CP2: [Facturacion, General, Entrega] -> se propone el de Entrega', () => {
  const contactos = sinDomicilio([FACTURACION, GENERAL, ENTREGA]);
  const r = seleccionContactoEntrega(contactos, VACIO);
  assert.deepStrictEqual(r, { indice: 2, aplicar: true });
  assert.equal(contactos[r.indice].nombre, 'Pedro Almacen');
});

test('CP3: [Facturacion] solo -> se propone el de Facturacion', () => {
  const contactos = sinDomicilio([FACTURACION]);
  assert.deepStrictEqual(seleccionContactoEntrega(contactos, VACIO), { indice: 0, aplicar: true });
});

// "Solo si no hay otro": un contacto de Operam sin marca tambien le gana al de
// Facturacion.
test('CP4: [Facturacion, sin marca] -> se propone el que no tiene marca', () => {
  const contactos = sinDomicilio([FACTURACION, { tag: '', nombre: 'Rosa Recepcion', telefono: '55 4444 0000', email: '' }]);
  assert.deepStrictEqual(seleccionContactoEntrega(contactos, VACIO), { indice: 1, aplicar: true });
});

// Una persona con varios papeles (#424) cuenta por el mejor: la que es Facturacion
// y General a la vez es un General.
test('CP5: [Facturacion, Facturacion+General] -> se propone la persona que tambien es General', () => {
  const contactos = sinDomicilio([
    { tag: 'invoice', nombre: 'Marta Contabilidad', telefono: '', email: 'facturas@cliente.mx' },
    { tag: 'invoice', nombre: 'Luis Compras', telefono: '55 2222 0000', email: 'compras@cliente.mx' },
    { tag: 'general', nombre: 'Luis Compras', telefono: '55 2222 0000', email: 'compras@cliente.mx' },
  ]);
  assert.equal(contactos.length, 2);
  assert.deepStrictEqual(seleccionContactoEntrega(contactos, VACIO), { indice: 1, aplicar: true });
});

// El contacto propio del domicilio elegido es la persona de ESA direccion: sigue
// siendo la propuesta aunque el Cliente Operam tenga uno de Entrega (#397).
test('CP6: el contacto propio del domicilio sigue primero frente a un Entrega del Cliente Operam', () => {
  const contactos = contactosEntregaDisponibles(
    { contacto: 'Recepcion Pestalozzi', telefono: '55 3333 4444', email: '' },
    [FACTURACION, ENTREGA],
  );
  assert.deepStrictEqual(seleccionContactoEntrega(contactos, VACIO), { indice: 0, aplicar: true });
  assert.equal(contactos[0].nombre, 'Recepcion Pestalozzi');
});

// Cambio de domicilio (#422): lo que puso el selector se reemplaza por la
// PROPUESTA del domicilio nuevo, con la misma regla. Pasar del domicilio con su
// propio contacto a la opcion vacia (#459) deja solo los del Cliente Operam.
const CON_CONTACTO = { contacto: 'Laura Guzman', telefono: '55 2233 4455', email: 'lguzman@gjy.mx' };
const PUSO_EL_SELECTOR = { nombre: 'Laura Guzman', telefono: '+52 55 2233 4455', email: 'lguzman@gjy.mx' };

test('CP7: lo que puso el selector, al pasar a la opcion vacia, se reemplaza por el General y no por Facturacion', () => {
  const antes = contactosEntregaDisponibles(CON_CONTACTO, [FACTURACION, GENERAL]);
  const despues = sinDomicilio([FACTURACION, GENERAL]);
  const r = contactoAlCambiarDomicilio(antes, despues, PUSO_EL_SELECTOR, false);
  assert.deepStrictEqual(r, { indice: 1, aplicar: true });
  assert.equal(despues[r.indice].nombre, 'Luis Compras');
});

// Y lo tecleado a mano no se mueve aunque la lista nueva tenga un General que
// proponer (#422).
test('CP8: lo tecleado a mano sobrevive al cambio de domicilio aunque haya a quien proponer', () => {
  const antes = contactosEntregaDisponibles(CON_CONTACTO, [FACTURACION, GENERAL]);
  const despues = sinDomicilio([FACTURACION, GENERAL]);
  const tecleado = { nombre: 'Juan Almacen', telefono: '5534667682', email: '' };
  assert.deepStrictEqual(contactoAlCambiarDomicilio(antes, despues, tecleado, false), { indice: null, aplicar: false });
  assert.deepStrictEqual(contactoAlCambiarDomicilio(antes, despues, VACIO, true), { indice: null, aplicar: false });
});
