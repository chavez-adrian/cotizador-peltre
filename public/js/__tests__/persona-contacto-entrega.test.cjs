'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

// #563 (ADR-0024 reglas 5 y 7; la identidad de un Contacto en Operam es su person_id):
// la persona que el vendedor elige en el selector "Contacto de entrega" del paso Envio
// viaja con su person_id en la cotizacion, para que la Subida del quote edite a ESA
// persona en Operam. El person_id se fija al ELEGIR y no al guardar: el selector se
// repinta (borrador, upgrade fiscal, cambio de domicilio) y, con el celular ya
// cambiado, su opcion deja de "explicar" lo capturado; si el person_id saliera del
// <select> en ese momento, la cotizacion viajaria sin el y Operam ganaria una persona
// duplicada.

let contactosEntregaDisponibles, seleccionContactoEntrega, contactoAlCambiarDomicilio;
let personaContactoEntrega, personIdDeOpcion;

before(async () => {
  ({ contactosEntregaDisponibles, seleccionContactoEntrega, contactoAlCambiarDomicilio } = await import('../alta-logica.js'));
  ({ personaContactoEntrega, personIdDeOpcion } = await import('../contacto-entrega-logica.js'));
});

const casillas = (c = {}) => ({ cel: '', telefono: '', secundario: '', correo: '', ...c });
const persona = (personId, tag, nombre, numeros = {}, correo = '') => ({
  personId, tag, nombre, email: correo, casillas: casillas({ ...numeros, correo }),
});

// El domicilio 564 con su General aplanado (la copia que guarda el branch, sin
// person_id) y la persona que ES ese General, con su person_id.
const DOMICILIO_564 = {
  contacto: 'Laura General', cel: '5500000022', telefono: '', email: 'laura@example.com',
  contactos: [
    persona('1289', 'general', 'Laura General', { cel: '5500000022' }, 'laura@example.com'),
    persona('1249', 'delivery', 'Adrian Bosques Nombre'),
  ],
};

test('PE1: el General del domicilio sale una sola vez en el selector y con su person_id, aunque la copia del domicilio llegue primero sin el', () => {
  const lista = contactosEntregaDisponibles(DOMICILIO_564, []);
  const laura = lista.filter(c => c.nombre === 'Laura General');
  assert.equal(laura.length, 1);
  assert.equal(laura[0].personId, '1289');
});

test('PE2: elegir una opcion fija su person_id; "+ Nuevo contacto" y una opcion sin persona no llevan ninguno', () => {
  const lista = contactosEntregaDisponibles(DOMICILIO_564, []);
  const iLaura = lista.findIndex(c => c.nombre === 'Laura General');
  assert.equal(personIdDeOpcion(lista, String(iLaura)), '1289');
  assert.equal(personIdDeOpcion(lista, 'nuevo'), null);
  assert.equal(personIdDeOpcion([{ tag: 'contacto', nombre: 'Prospecto Sin Operam', telefono: '5511112222' }], '0'), null);
});

// El caso de la user story 34: elige a la 1249, le cambia el celular y algo repinta el
// selector. La opcion ya no explica lo capturado (seleccionContactoEntrega no la
// encuentra), pero la persona sigue siendo la 1249 y el selector se queda en ella sin
// pisar lo que el vendedor tecleo.
test('PE3: al repintar con el celular ya cambiado, el selector se queda en la persona elegida, no pisa lo capturado y conserva su person_id', () => {
  const lista = contactosEntregaDisponibles(DOMICILIO_564, []);
  const capturado = { nombre: 'Adrian Bosques Nombre', telefono: '5512345678', email: '' };
  const base = seleccionContactoEntrega(lista, capturado, false);
  assert.equal(base.indice, null);
  const sel = personaContactoEntrega({ contactos: lista, base, personId: '1249', capturaManual: false });
  assert.equal(lista[sel.indice].personId, '1249');
  assert.equal(sel.aplicar, false);
  assert.equal(sel.personId, '1249');
});

// Decision de #563: el nombre tecleado es el del documento; el de la persona en Operam
// no se toca (regla 5). Cambiar el nombre no la convierte en otra persona.
test('PE4: cambiarle el nombre a la persona elegida conserva su person_id', () => {
  const lista = contactosEntregaDisponibles(DOMICILIO_564, []);
  const capturado = { nombre: 'Adrian Bosques (almacen)', telefono: '', email: '' };
  const base = seleccionContactoEntrega(lista, capturado, false);
  const sel = personaContactoEntrega({ contactos: lista, base, personId: '1249', capturaManual: false });
  assert.equal(sel.personId, '1249');
  assert.equal(sel.aplicar, false);
});

test('PE5: cuando el selector aplica una opcion, el person_id es el de esa opcion; con "+ Nuevo contacto" no hay ninguno', () => {
  const lista = contactosEntregaDisponibles(DOMICILIO_564, []);
  const vacio = { nombre: '', telefono: '', email: '' };
  const propuesta = personaContactoEntrega({ contactos: lista, base: seleccionContactoEntrega(lista, vacio, false), personId: null, capturaManual: false });
  assert.equal(propuesta.aplicar, true);
  assert.equal(propuesta.personId, lista[propuesta.indice].personId);
  const manual = personaContactoEntrega({ contactos: lista, base: seleccionContactoEntrega(lista, vacio, true), personId: '1249', capturaManual: true });
  assert.equal(manual.personId, null);
});

// Las personas son de cada domicilio: al cambiar a uno donde la persona elegida no
// esta, la identidad se suelta (lo capturado a mano se queda, como desde #422). Sin
// cambio de domicilio, una lista que todavia no la trae no la suelta: los satelites del
// cliente llegan despues de cargar la cotizacion al Editar.
test('PE6: la persona elegida se suelta al cambiar a un domicilio donde no esta, y no en una repintada cualquiera', () => {
  const otro = { contactos: [persona('1400', 'delivery', 'Pedro Otro Domicilio', { cel: '5599990000' })] };
  const antes = contactosEntregaDisponibles(DOMICILIO_564, []);
  const despues = contactosEntregaDisponibles(otro, []);
  const capturado = { nombre: 'Adrian Bosques Nombre', telefono: '5512345678', email: '' };
  const base = contactoAlCambiarDomicilio(antes, despues, capturado, false);
  assert.equal(personaContactoEntrega({ contactos: despues, base, personId: '1249', capturaManual: false, cambioDeDomicilio: true }).personId, null);
  assert.equal(personaContactoEntrega({ contactos: [], base: { indice: null, aplicar: false }, personId: '1249', capturaManual: false }).personId, '1249');
});
