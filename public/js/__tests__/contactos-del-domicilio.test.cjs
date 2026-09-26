'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

// Los Contactos en Operam de CADA domicilio de entrega en el selector "Contacto de
// entrega" del paso Envio (#397, decision de Adrian del 2026-09-25). Caso real:
// el cliente 15 tiene "Adrian Pestalozzi Nombre" en el domicilio Pestalozzi
// (branch 15) y "Adrian Bosques Nombre" en Bosques de Europa (branch 564), y el
// selector solo ofrecia "Adrian Cliente Nombre", el contacto del Cliente Operam.
// Los del domicilio llegan en `domicilio.contactos` (padron de contact_list, #105);
// `null` = el servidor aun no lo sabe (cache fria u Operam caido).

let contactosEntregaDisponibles, contactoAlCambiarDomicilio;

before(async () => {
  ({ contactosEntregaDisponibles, contactoAlCambiarDomicilio } = await import('../alta-logica.js'));
});

const PESTALOZZI = {
  branch_code: '15', descripcion: 'Pestalozzi (Nombre del Domicilio)', contacto: '', telefono: '', email: '',
  contactos: [{ tag: 'delivery', nombre: 'Adrian Pestalozzi Nombre', telefono: '', email: '' }],
};
const BOSQUES = {
  branch_code: '564', descripcion: 'Bosques de Europa (Nombre del Domicilio)', contacto: '', telefono: '', email: '',
  contactos: [{ tag: 'delivery', nombre: 'Adrian Bosques Nombre', telefono: '', email: '' }],
};
const DEL_CLIENTE = [{ tag: 'general', nombre: 'Adrian Cliente Nombre', telefono: '55 1111 2222', email: 'adrian@cliente.mx' }];

const nombres = lista => lista.map(c => c.nombre);

test('CDD1: primero los contactos del domicilio elegido, luego los del Cliente Operam', () => {
  assert.deepStrictEqual(nombres(contactosEntregaDisponibles(PESTALOZZI, DEL_CLIENTE)), [
    'Adrian Pestalozzi Nombre', 'Adrian Cliente Nombre',
  ]);
  assert.deepStrictEqual(nombres(contactosEntregaDisponibles(BOSQUES, DEL_CLIENTE)), [
    'Adrian Bosques Nombre', 'Adrian Cliente Nombre',
  ]);
});

// Cache fria u Operam caido: el servidor manda `contactos: null` y el selector
// cae EN SILENCIO al de antes de #397 -- el contacto propio del branch y los del
// Cliente Operam, sin aviso ni opcion vacia.
test('CDD2: sin padron (contactos null) el selector es el de hoy', () => {
  const branch = { contacto: 'Recepcion Pestalozzi', telefono: '55 3333 4444', email: '' };
  const hoy = contactosEntregaDisponibles(branch, DEL_CLIENTE);
  assert.deepStrictEqual(contactosEntregaDisponibles({ ...branch, contactos: null }, DEL_CLIENTE), hoy);
  assert.deepStrictEqual(nombres(hoy), ['Recepcion Pestalozzi', 'Adrian Cliente Nombre']);
});

// Con #422: el selector habia puesto a Adrian Pestalozzi y el vendedor pasa a
// Bosques de Europa sin tocar nada. Manda el contacto de ESE domicilio.
test('CDD3: cambiar de Pestalozzi a Bosques reemplaza lo que puso el selector por Adrian Bosques', () => {
  const antes = contactosEntregaDisponibles(PESTALOZZI, DEL_CLIENTE);
  const despues = contactosEntregaDisponibles(BOSQUES, DEL_CLIENTE);
  const capturado = { nombre: 'Adrian Pestalozzi Nombre', telefono: '', email: '' };
  const r = contactoAlCambiarDomicilio(antes, despues, capturado, false);
  assert.deepStrictEqual(r, { indice: 0, aplicar: true });
  assert.equal(despues[r.indice].nombre, 'Adrian Bosques Nombre');
});

// Y la regla de #422 sigue: lo capturado a mano no se pisa aunque el domicilio
// nuevo ya traiga sus propios contactos.
test('CDD4: lo capturado a mano sobrevive al pasar a un domicilio con contactos', () => {
  const antes = contactosEntregaDisponibles(PESTALOZZI, DEL_CLIENTE);
  const despues = contactosEntregaDisponibles(BOSQUES, DEL_CLIENTE);
  const capturado = { nombre: 'Juan Almacen', telefono: '5534667682', email: '' };
  assert.deepStrictEqual(contactoAlCambiarDomicilio(antes, despues, capturado, false), { indice: null, aplicar: false });
});
