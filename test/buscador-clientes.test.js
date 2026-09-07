// El buscador de la vista Clientes agrupa por Contacto (#346, spec #337,
// ADR-0016): una fila por persona, con sus Clientes Operam anidados, mas las
// filas de los Clientes Operam que no son de ningun Contacto conocido.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { filasBuscadorClientes } from '../lib/buscador-clientes.js';

const LAURA = { id: 1, celular: '+52 55 1234 5678', nombre: 'Laura', ciudad: 'Puebla' };
const MARIO = { id: 2, celular: '5599998888', nombre: 'Mario', ciudad: 'CDMX' };

const JORGE = { id: '514', nombre: 'JORGE OREA', fiscal: 'sin_datos_fiscales', comercial: 'cotizado' };
const HOTELERA = { id: '233', nombre: 'HOTELERA DEL SUR SA DE CV', fiscal: 'con_datos_fiscales', comercial: 'con_pedido' };

test('B1: el Cliente Operam cuyo celular es de un Contacto cuelga de el, no sale suelto', () => {
  const filas = filasBuscadorClientes({
    clientesOperam: [JORGE],
    contactos: [LAURA],
    celularesPorCliente: new Map([['514', ['5512345678']]]),
  });
  assert.equal(filas.length, 1);
  assert.equal(filas[0].tipo, 'contacto');
  assert.equal(filas[0].nombre, 'Laura');
  assert.deepEqual(filas[0].clientesOperam.map(c => c.id), ['514']);
});

test('B2: el Cliente Operam sin ningun Contacto conocido es su propia fila', () => {
  const filas = filasBuscadorClientes({
    clientesOperam: [HOTELERA],
    contactos: [],
    celularesPorCliente: new Map([['233', ['5544443333']]]),
  });
  assert.deepEqual(filas.map(f => f.tipo), ['operam']);
  assert.equal(filas[0].id, '233');
});

// La regla estructural de ADR-0016: el celular en cualquiera de las seis
// casillas liga. La linea compartida de un restaurante es de dos personas.
test('B3: el Cliente Operam con dos Contactos aparece bajo los dos y no como fila suelta', () => {
  const filas = filasBuscadorClientes({
    clientesOperam: [HOTELERA],
    contactos: [LAURA, MARIO],
    celularesPorCliente: new Map([['233', ['5512345678', '5599998888']]]),
  });
  assert.deepEqual(filas.map(f => f.tipo), ['contacto', 'contacto']);
  assert.deepEqual(filas[0].clientesOperam.map(c => c.id), ['233']);
  assert.deepEqual(filas[1].clientesOperam.map(c => c.id), ['233']);
});

test('B4: el Contacto ligado a dos Clientes Operam sale UNA vez con los dos anidados', () => {
  const filas = filasBuscadorClientes({
    clientesOperam: [JORGE],
    contactos: [{ ...LAURA, clientesOperam: [HOTELERA] }],
    celularesPorCliente: new Map([['514', ['5512345678']]]),
  });
  assert.equal(filas.length, 1);
  assert.deepEqual(filas[0].clientesOperam.map(c => c.id), ['233', '514']);
});

test('B5: un Cliente Operam que ya venia ligado al Contacto no se anida dos veces', () => {
  const filas = filasBuscadorClientes({
    clientesOperam: [JORGE],
    contactos: [{ ...LAURA, clientesOperam: [JORGE] }],
    celularesPorCliente: new Map([['514', ['5512345678']]]),
  });
  assert.deepEqual(filas[0].clientesOperam.map(c => c.id), ['514']);
});

// La liga persistida y la derivada apagan IGUAL la fila suelta: un Cliente
// Operam ligado a mano cuyo celular Operam no conoce salia anidado Y suelto.
test('B6: el Cliente Operam ligado SOLO por la lista del Contacto tampoco sale suelto', () => {
  const filas = filasBuscadorClientes({
    clientesOperam: [HOTELERA],
    contactos: [{ ...LAURA, clientesOperam: [HOTELERA] }],
    celularesPorCliente: new Map([['233', []]]),
  });
  assert.deepEqual(filas.map(f => f.tipo), ['contacto']);
  assert.deepEqual(filas[0].clientesOperam.map(c => c.id), ['233']);
});
