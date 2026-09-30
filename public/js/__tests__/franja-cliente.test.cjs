'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let identidadFranja, franjaCliente;
before(async () => {
  ({ identidadFranja, franjaCliente } = await import('../franja-cliente-logica.js'));
});

// La franja entre el stepper y el paso (#480) dice a quien se cotiza en los 4
// pasos. Cada dato sale solo si existe; sin nada elegido en el paso 1, el texto
// que pide elegir.

test('F1: Cliente Operam con datos fiscales y Contacto: nombre corto, razon social con etiqueta, contacto y celular', () => {
  const vista = franjaCliente({
    clienteOperam: { nombreCorto: 'La Cocina de Rosa', nombre: 'ROSA MARTINEZ LOPEZ', sinDatosFiscales: false },
    contacto: { nombre: 'Rosa Martinez', celular: '5512345678' },
    folio: null,
  });
  assert.equal(vista.vacia, false);
  assert.deepEqual(vista.partes, [
    { etiqueta: 'Nombre corto', valor: 'La Cocina de Rosa' },
    { etiqueta: 'Raz\u00f3n social', valor: 'ROSA MARTINEZ LOPEZ' },
    { etiqueta: 'Contacto', valor: 'Rosa Martinez \u00b7 5512345678' },
  ]);
});

test('F2: Cliente Operam Sin datos fiscales: su nombre sale sin la etiqueta Razon social', () => {
  const vista = franjaCliente({
    clienteOperam: { nombreCorto: 'Tienda Pepe', nombre: 'Jose Perez', sinDatosFiscales: true },
    contacto: null,
    folio: null,
  });
  assert.deepEqual(vista.partes, [
    { etiqueta: 'Nombre corto', valor: 'Tienda Pepe' },
    { etiqueta: '', valor: 'Jose Perez' },
  ]);
});

test('F3: Contacto sin Cliente Operam: solo el Contacto y su celular', () => {
  const vista = franjaCliente({
    clienteOperam: null,
    contacto: { nombre: 'Laura Gomez', celular: '3311223344' },
    folio: null,
  });
  assert.deepEqual(vista.partes, [{ etiqueta: 'Contacto', valor: 'Laura Gomez \u00b7 3311223344' }]);
});

test('F4: sin nombre corto la parte no sale', () => {
  const vista = franjaCliente({
    clienteOperam: { nombreCorto: '', nombre: 'ABARROTES DEL NORTE SA DE CV', sinDatosFiscales: false },
    contacto: null,
    folio: null,
  });
  assert.deepEqual(vista.partes, [{ etiqueta: 'Raz\u00f3n social', valor: 'ABARROTES DEL NORTE SA DE CV' }]);
});

test('F5: con folio de Operam sale Cotizacion N; sin folio no sale nada (ni PRE)', () => {
  const base = { clienteOperam: null, contacto: { nombre: 'Laura Gomez', celular: '' } };
  assert.deepEqual(franjaCliente({ ...base, folio: 1296 }).partes, [
    { etiqueta: 'Contacto', valor: 'Laura Gomez' },
    { etiqueta: '', valor: 'Cotizaci\u00f3n 1296' },
  ]);
  assert.deepEqual(franjaCliente({ ...base, folio: null }).partes, [
    { etiqueta: 'Contacto', valor: 'Laura Gomez' },
  ]);
});

test('F6: sin seleccion la franja pide elegir', () => {
  assert.deepEqual(franjaCliente(null), { vacia: true, texto: 'Elige un Contacto o Cliente Operam', partes: [] });
  assert.deepEqual(franjaCliente({ clienteOperam: null, contacto: null, folio: null }),
    { vacia: true, texto: 'Elige un Contacto o Cliente Operam', partes: [] });
});

test('F7: el nombre corto igual a la razon social no se repite', () => {
  const vista = franjaCliente({
    clienteOperam: { nombreCorto: 'jose  perez', nombre: 'Jose Perez', sinDatosFiscales: true },
    contacto: null,
    folio: null,
  });
  assert.deepEqual(vista.partes, [{ etiqueta: '', valor: 'Jose Perez' }]);
});

// La identidad se arma de lo mismo que se guarda y se sube: pcState.cliente y
// lo que devuelve leerClienteFormulario.

test('I1: sin cliente elegido no hay identidad', () => {
  assert.equal(identidadFranja(null, { razonSocial: 'algo' }, null), null);
});

test('I2: fila Operam con RFC real: Cliente Operam con datos fiscales, sin Contacto conocido', () => {
  const identidad = identidadFranja(
    { tipo: 'operam', id: 88, name: 'ABARROTES DEL NORTE SA DE CV', ref: 'Abarrotes', telefono: '8112345678' },
    { customerId: 88, razonSocial: 'ABARROTES DEL NORTE SA DE CV', nombreCorto: 'Abarrotes', rfc: 'ANO010101AB1' },
    1301,
  );
  assert.deepEqual(identidad, {
    clienteOperam: { nombreCorto: 'Abarrotes', nombre: 'ABARROTES DEL NORTE SA DE CV', sinDatosFiscales: false },
    contacto: null,
    folio: 1301,
  });
});

test('I3: prospecto que ya cotizo: Cliente Operam Sin datos fiscales (sin RFC) y su Contacto', () => {
  const identidad = identidadFranja(
    { tipo: 'prospecto', id: null, clienteOperamId: 530, name: 'Laura Gomez', ref: 'Laura Gomez', rfc: '', telefono: '3311223344' },
    { customerId: 530, razonSocial: 'Laura Gomez', nombreCorto: 'Laura Gomez', rfc: '' },
    null,
  );
  assert.deepEqual(identidad, {
    clienteOperam: { nombreCorto: 'Laura Gomez', nombre: 'Laura Gomez', sinDatosFiscales: true },
    contacto: { nombre: 'Laura Gomez', celular: '3311223344' },
    folio: null,
  });
});

test('I4: contacto nuevo sin Cliente Operam: solo Contacto; RFC generico cuenta como Sin datos fiscales', () => {
  assert.deepEqual(
    identidadFranja({ tipo: 'nuevo', id: null, name: 'Pedro Ruiz', telefono: '5599887766' },
      { customerId: null, razonSocial: 'Pedro Ruiz', nombreCorto: 'Pedro Ruiz', rfc: '' }, null),
    { clienteOperam: null, contacto: { nombre: 'Pedro Ruiz', celular: '5599887766' }, folio: null },
  );
  const generico = identidadFranja({ tipo: 'operam', id: 15, name: 'Adrian Chavez Rosete' },
    { customerId: 15, razonSocial: 'Adrian Chavez Rosete', nombreCorto: '', rfc: 'XAXX010101000' }, null);
  assert.equal(generico.clienteOperam.sinDatosFiscales, true);
});
