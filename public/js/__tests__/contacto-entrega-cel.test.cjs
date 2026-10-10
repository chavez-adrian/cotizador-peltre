'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

// El telefono que propone el selector "Contacto de entrega" del paso Envio (#559,
// ADR-0024 regla 2): el de CADA persona, sacado de sus propias casillas en el orden
// de ADR-0016 -- Cel, luego Telefono, luego Secundario -- y nunca el de otra persona
// (ni el del General). Los Contactos en Operam llegan POR PERSONA desde
// lib/contactos-operam.js: `{ personId, nombre, roles, telefono, secundario, cel, email }`.

let contactosEntregaDisponibles, seleccionContactoEntrega, etiquetaPapelesContacto, propuestaContactoOperam;

before(async () => {
  ({ contactosEntregaDisponibles, seleccionContactoEntrega, etiquetaPapelesContacto, propuestaContactoOperam } = await import('../alta-logica.js'));
});

const VACIO = { nombre: '', telefono: '', email: '' };
const persona = (personId, nombre, roles, casillas = {}) => ({
  personId, nombre, roles, telefono: '', secundario: '', cel: '', email: '', ...casillas,
});
const delDomicilio = contactos => ({ branch_code: '564', contacto: '', telefono: '', cel: '', email: '', contactos });
const opcion = (lista, nombre) => lista.find(c => c.nombre === nombre);

test('CE1: una persona que en Operam solo tiene Cel aparece en el selector con ese numero', () => {
  const lista = contactosEntregaDisponibles(delDomicilio([
    persona('1400', 'Recibe Bosques', ['delivery'], { cel: '55 3466 7682' }),
  ]), []);
  assert.equal(opcion(lista, 'Recibe Bosques').telefono, '55 3466 7682');
  const r = seleccionContactoEntrega(lista, VACIO);
  assert.deepEqual(r, { indice: 0, aplicar: true });
  assert.equal(lista[r.indice].telefono, '55 3466 7682');
});

test('CE2: con Cel y Telefono se propone el Cel; sin Cel, el Telefono; sin ninguno de los dos, el Secundario', () => {
  const lista = contactosEntregaDisponibles(null, [
    persona('1', 'Con Cel', ['general'], { telefono: '55 1111 1111', secundario: '55 2222 2222', cel: '55 3333 3333' }),
    persona('2', 'Sin Cel', ['delivery'], { telefono: '55 4444 4444', secundario: '55 5555 5555' }),
    persona('3', 'Solo Secundario', ['order'], { secundario: '55 6666 6666' }),
  ]);
  assert.equal(opcion(lista, 'Con Cel').telefono, '55 3333 3333');
  assert.equal(opcion(lista, 'Sin Cel').telefono, '55 4444 4444');
  assert.equal(opcion(lista, 'Solo Secundario').telefono, '55 6666 6666');
});

test('CE3: una persona sin ningun numero se propone sin telefono, nunca con el del General ni de otra persona', () => {
  const lista = contactosEntregaDisponibles(delDomicilio([
    persona('1500', 'Pedro Almacen', ['delivery'], { email: 'almacen@cliente.mx' }),
    persona('1501', 'Luis General', ['general'], { telefono: '55 7777 7777', cel: '55 8888 8888' }),
  ]), [persona('61', 'Gustavo Barcia', ['general'], { cel: '55 9999 9999' })]);
  const r = seleccionContactoEntrega(lista, VACIO);
  assert.equal(lista[r.indice].nombre, 'Pedro Almacen', 'se propone por papel: Entrega');
  assert.equal(lista[r.indice].telefono, '');
});

// Los roles de la persona son sus papeles en el selector (#424, #494): la que es
// General y Entrega se propone frente a la de Facturacion y se rotula con los dos.
test('CE4: los roles de la persona son sus papeles: se propone y se rotula por ellos', () => {
  const lista = contactosEntregaDisponibles(delDomicilio([
    persona('1600', 'Marta Cuentas', ['invoice'], { email: 'cxp@cliente.mx' }),
    persona('1601', 'Rosa Bodega', ['general', 'delivery'], { cel: '55 1212 1212' }),
  ]), []);
  const r = seleccionContactoEntrega(lista, VACIO);
  assert.equal(lista[r.indice].nombre, 'Rosa Bodega');
  assert.equal(etiquetaPapelesContacto(lista[r.indice]), 'General, Entrega');
});

// Lo que el selector puso en los campos (el Cel) lo reconoce en la siguiente
// repintada (#353): si no, el selector saltaria solo a "+ Nuevo contacto".
test('CE5: tras aplicar el Cel, la repintada reconoce a la misma persona', () => {
  const lista = contactosEntregaDisponibles(delDomicilio([
    persona('1601', 'Rosa Bodega', ['general', 'delivery'], { telefono: '55 2222 3333', cel: '55 1212 1212' }),
  ]), []);
  const puesto = { nombre: 'Rosa Bodega', telefono: '+52 55 1212 1212', email: '' };
  assert.deepEqual(seleccionContactoEntrega(lista, puesto), { indice: 0, aplicar: true });
});

// El contacto propio del domicilio (el General aplanado en el branch) es una persona
// mas: su Cel va primero, y asi coincide con su propio renglon de contact_list y
// sale como UNA opcion (#424).
test('CE6: el contacto propio del domicilio propone su Cel y se junta con su renglon de contact_list', () => {
  const domicilio = {
    branch_code: '564', contacto: 'Rosa Bodega', telefono: '55 2222 3333', cel: '55 1212 1212', email: '',
    contactos: [persona('1601', 'Rosa Bodega', ['general', 'delivery'], { telefono: '55 2222 3333', cel: '55 1212 1212' })],
  };
  const lista = contactosEntregaDisponibles(domicilio, []);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].telefono, '55 1212 1212');
});

// Regresion de #559 al Editar: antes de proponer el Cel, la opcion de una persona
// proponia su Telefono, y eso es lo que guardaron las cotizaciones viejas. Esa persona
// sigue reconocida al cargar la cotizacion -- el selector la elige -- y su Telefono
// guardado NO se pisa en silencio con el Cel (aplicar: false; el documento enviado no
// cambia solo).
test('CE7: una cotizacion guardada con el Telefono de una persona que tiene Cel y Telefono la reconoce sin pisar lo guardado', () => {
  const lista = contactosEntregaDisponibles(delDomicilio([
    persona('1601', 'Rosa Bodega', ['general', 'delivery'], { telefono: '55 2222 3333', cel: '55 1212 1212', email: 'rosa@cliente.mx' }),
  ]), []);
  const guardado = { nombre: 'Rosa Bodega', telefono: '+52 55 2222 3333', email: 'rosa@cliente.mx' };
  assert.deepEqual(seleccionContactoEntrega(lista, guardado), { indice: 0, aplicar: false });
});

// Al Editar se proponen los datos ACTUALES de Operam (#559 punto 3, story 37 de #557)
// y el vendedor decide si los toma; lo guardado no cambia solo (story 36). Rosa
// cambio de numero en Operam despues de que se envio la cotizacion: el selector la
// sigue reconociendo por su nombre, no toca los campos y ofrece lo que Operam tiene hoy.
test('CE8: si la persona cambio de numero en Operam, se la reconoce y se proponen sus datos actuales sin pisar lo guardado', () => {
  const lista = contactosEntregaDisponibles(delDomicilio([
    persona('1601', 'Rosa Bodega', ['general', 'delivery'], { telefono: '55 2222 3333', cel: '55 1212 1212', email: 'rosa@cliente.mx' }),
  ]), []);
  const guardado = { nombre: 'Rosa Bodega', telefono: '+52 55 7777 0000', email: 'rosa@cliente.mx' };
  const r = seleccionContactoEntrega(lista, guardado);
  assert.deepEqual(r, { indice: 0, aplicar: false });
  assert.equal(propuestaContactoOperam(lista[r.indice], guardado), 'Datos actuales en Operam: Rosa Bodega, 55 1212 1212, rosa@cliente.mx');
});

// Tomar la propuesta = aplicar la opcion elegida (sus datos de hoy van a los campos).
// Despues la repintada la reconoce y la aplica sin volver a proponer nada. Igual para
// la cotizacion vieja de CE7: lo que se propone es el Cel.
test('CE9: tomar la propuesta deja los datos de Operam en los campos y la propuesta desaparece', () => {
  const lista = contactosEntregaDisponibles(delDomicilio([
    persona('1601', 'Rosa Bodega', ['general', 'delivery'], { telefono: '55 2222 3333', cel: '55 1212 1212', email: 'rosa@cliente.mx' }),
  ]), []);
  const guardado = { nombre: 'Rosa Bodega', telefono: '+52 55 2222 3333', email: 'rosa@cliente.mx' };
  assert.equal(propuestaContactoOperam(lista[0], guardado), 'Datos actuales en Operam: Rosa Bodega, 55 1212 1212, rosa@cliente.mx');
  const tomado = { nombre: 'Rosa Bodega', telefono: '+52 55 1212 1212', email: 'rosa@cliente.mx' };
  assert.deepEqual(seleccionContactoEntrega(lista, tomado), { indice: 0, aplicar: true });
  assert.equal(propuestaContactoOperam(lista[0], tomado), null);
});

// El Contacto de la cotizacion (#353) no es un Contacto en Operam: un "Entregar a" con
// su nombre y otro telefono es captura de alguien, no un dato viejo de Operam.
test('CE10: con el nombre del Contacto de la cotizacion y otro telefono no se elige ni se propone nada', () => {
  const lista = contactosEntregaDisponibles(null, [], { tag: 'contacto', nombre: 'Erick Tellez', telefono: '+523221508025', email: '' });
  const capturado = { nombre: 'Erick Tellez', telefono: '+52 55 1111 2222', email: '' };
  assert.deepEqual(seleccionContactoEntrega(lista, capturado), { indice: null, aplicar: false });
  assert.equal(propuestaContactoOperam(lista[0], capturado), null);
});
