'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

// El contacto de entrega al cambiar de domicilio (#422, decision de Adrian del
// 2026-09-25, opcion (a)). Hallazgo de la prueba de #415 (cotizacion 1292,
// cliente 52): pasar del domicilio 58 al 59 cambiaba el contacto por el del
// domicilio nuevo y vaciaba el celular que el vendedor habia capturado a mano.
// La regla es la misma de no pisar de #291/#409: lo que puso el selector
// anterior se reemplaza (y lo que el nuevo no trae se borra); lo capturado a
// mano y "+ Nuevo contacto" sobreviven siempre.

let contactoAlCambiarDomicilio, contactosEntregaDisponibles;

before(async () => {
  ({ contactoAlCambiarDomicilio, contactosEntregaDisponibles } = await import('../alta-logica.js'));
});

// Cliente 52: el domicilio 58 (G J Y ASOCIADOS ABOGADOS SC) y el 59 (PIZZA
// STUDIO), cada uno con su propio contacto. El de 59 es el de la tabla del issue.
const DOM_58 = { contacto: 'Laura Guzman', telefono: '55 2233 4455', email: 'lguzman@gjy.mx' };
const DOM_59 = { contacto: 'David Jimenez', telefono: '', email: 'djimenez993tt@gmail.com' };
const antes = () => contactosEntregaDisponibles(DOM_58, []);
const despues = () => contactosEntregaDisponibles(DOM_59, []);

// EL caso de la 1292: "+ Nuevo contacto" con PIZZA STUDIO y 5534667682 tecleados.
test('CD1: "+ Nuevo contacto" capturado a mano sobrevive al cambio de domicilio', () => {
  const capturado = { nombre: 'PIZZA STUDIO', telefono: '5534667682', email: '' };
  assert.deepStrictEqual(
    contactoAlCambiarDomicilio(antes(), despues(), capturado, true),
    { indice: null, aplicar: false },
  );
});

// El domicilio 58 abrio con su propio contacto (autollenado de siempre) y el
// vendedor no toco nada: lo que hay en los campos lo puso el selector. Al pasar
// al 59 manda el contacto de ESE domicilio, y como David Jimenez no trae
// celular, el de Laura Guzman se borra -- igual que la direccion (#409).
test('CD2: lo que puso el selector anterior se reemplaza por el contacto del domicilio nuevo', () => {
  const capturado = { nombre: 'Laura Guzman', telefono: '+52 55 2233 4455', email: 'lguzman@gjy.mx' };
  const r = contactoAlCambiarDomicilio(antes(), despues(), capturado, false);
  assert.deepStrictEqual(r, { indice: 0, aplicar: true });
  assert.deepStrictEqual(
    { nombre: despues()[r.indice].nombre, telefono: despues()[r.indice].telefono, email: despues()[r.indice].email },
    { nombre: 'David Jimenez', telefono: '', email: 'djimenez993tt@gmail.com' },
  );
});

// EL criterio del ticket: un celular capturado a mano no se vacia por cambiar de
// domicilio. Aqui sin la marca de "+ Nuevo contacto" (no viaja en el borrador):
// el selector puso a Laura Guzman y el vendedor tecleo encima otro celular. Eso
// ya no es de nadie de la lista anterior, asi que lo escribio una persona.
test('CD3: campo capturado a mano (sin la marca) sobrevive; el celular no se vacia', () => {
  const capturado = { nombre: 'Laura Guzman', telefono: '5534667682', email: 'lguzman@gjy.mx' };
  assert.deepStrictEqual(
    contactoAlCambiarDomicilio(antes(), despues(), capturado, false),
    { indice: null, aplicar: false },
  );
});

test('CD4: campos vacios -> se propone el contacto del domicilio nuevo', () => {
  assert.deepStrictEqual(
    contactoAlCambiarDomicilio(antes(), despues(), { nombre: '', telefono: '', email: '' }, false),
    { indice: 0, aplicar: true },
  );
});

// El domicilio nuevo no trae contacto y el cliente no tiene otros: lo que puso el
// selector anterior se BORRA (indice null = sin opcion que elegir), como el campo
// de la direccion que el domicilio nuevo no trae.
test('CD5: lo del selector anterior sin contacto en el domicilio nuevo -> se borra', () => {
  const capturado = { nombre: 'Laura Guzman', telefono: '+52 55 2233 4455', email: 'lguzman@gjy.mx' };
  assert.deepStrictEqual(
    contactoAlCambiarDomicilio(antes(), contactosEntregaDisponibles({ calle: 'Reforma 100' }, []), capturado, false),
    { indice: null, aplicar: true },
  );
});
