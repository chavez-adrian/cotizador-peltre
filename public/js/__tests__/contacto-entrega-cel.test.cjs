'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

// El selector "Contacto de entrega" del paso Envio ve el Cel (#559, ADR-0024 regla 2):
// cada persona que llega del modulo Contactos en Operam trae sus casillas, y el
// telefono que se le propone es el SUYO en el orden de ADR-0016 -- Cel, Telefono,
// Secundario --, nunca el del General ni el de otra persona. Antes el servidor
// mandaba `phone || phone2` y una persona con solo Cel salia sin telefono.

let contactosEntregaDisponibles, seleccionContactoEntrega;

before(async () => {
  ({ contactosEntregaDisponibles, seleccionContactoEntrega } = await import('../alta-logica.js'));
});

const casillas = (c = {}) => ({ cel: '', telefono: '', secundario: '', correo: '', ...c });
const persona = (personId, tag, nombre, numeros = {}, correo = '') => ({
  personId, tag, nombre, email: correo, casillas: casillas({ ...numeros, correo }),
});

const telefonoDe = (lista, nombre) => lista.find(c => c.nombre === nombre).telefono;

test('CE1: una persona del domicilio con solo Cel aparece en el selector con ese numero', () => {
  const domicilio = { contactos: [persona('1288', 'delivery', 'Rosa Almacen', { cel: '5500000031' })] };
  const lista = contactosEntregaDisponibles(domicilio, []);
  assert.equal(telefonoDe(lista, 'Rosa Almacen'), '5500000031');
});

test('CE2: con Cel y Telefono propone el Cel; sin Cel, el Telefono; sin ambos, el Secundario', () => {
  const delCliente = [
    persona('1', 'general', 'Con Cel y Telefono', { cel: '55 1111 1111', telefono: '55 2222 2222', secundario: '55 3333 3333' }),
    persona('2', 'delivery', 'Sin Cel', { telefono: '55 4444 4444', secundario: '55 5555 5555' }),
    persona('3', 'order', 'Solo Secundario', { secundario: '55 6666 6666' }),
  ];
  const lista = contactosEntregaDisponibles(null, delCliente);
  assert.equal(telefonoDe(lista, 'Con Cel y Telefono'), '55 1111 1111');
  assert.equal(telefonoDe(lista, 'Sin Cel'), '55 4444 4444');
  assert.equal(telefonoDe(lista, 'Solo Secundario'), '55 6666 6666');
});

// La persona sin numeros es la de Entrega del domicilio, la que el selector propone
// (#494); el General del domicilio y el del Cliente Operam tienen numero, y ninguno
// de los dos se le presta.
test('CE3: una persona sin ningun numero se propone sin telefono, nunca con el del General ni de otra persona', () => {
  const domicilio = {
    contactos: [
      persona('1249', 'delivery', 'Adrian Bosques Nombre'),
      persona('1250', 'general', 'Laura General', { telefono: '55 7777 7777' }),
    ],
  };
  const delCliente = [persona('61', 'general', 'Adrian Cliente Nombre', { telefono: '+52 55 3466 7682' })];
  const lista = contactosEntregaDisponibles(domicilio, delCliente);
  assert.equal(telefonoDe(lista, 'Adrian Bosques Nombre'), '');

  const sel = seleccionContactoEntrega(lista, { nombre: '', telefono: '', email: '' }, false);
  assert.equal(sel.aplicar, true);
  assert.equal(lista[sel.indice].nombre, 'Adrian Bosques Nombre');
  assert.equal(lista[sel.indice].telefono, '');
});

// El caso de la verificacion AFK: el General del domicilio solo tiene Cel. Llega dos
// veces -- aplanado en el domicilio (`contacto`/`telefono`/`cel`) y como persona del
// modulo -- y las dos son la misma opcion, que se propone con su Cel.
test('CE4: el General del domicilio con solo Cel se propone con ese Cel', () => {
  const domicilio = {
    contacto: 'Rosa Almacen', telefono: '', cel: '5500000031', email: 'rosa@cliente.mx',
    contactos: [persona('1288', 'general', 'Rosa Almacen', { cel: '5500000031' }, 'rosa@cliente.mx')],
  };
  const delCliente = [persona('61', 'general', 'Adrian Cliente Nombre', { telefono: '+52 55 3466 7682' })];
  const lista = contactosEntregaDisponibles(domicilio, delCliente);
  const sel = seleccionContactoEntrega(lista, { nombre: '', telefono: '', email: '' }, false);
  assert.equal(lista[sel.indice].nombre, 'Rosa Almacen');
  assert.equal(lista[sel.indice].telefono, '5500000031');
  assert.equal(lista.filter(c => c.nombre === 'Rosa Almacen').length, 1, 'el aplanado y la persona son una sola opcion');
});
