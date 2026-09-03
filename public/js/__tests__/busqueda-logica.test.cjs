'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let filtrarPorCriterio;
before(async () => {
  ({ filtrarPorCriterio } = await import('../busqueda-logica.js'));
});

const CAMPOS = { camposDe: x => [x.nombre, x.ciudad] };

test('B1: sin texto ni fechas devuelve todo (copia, no el mismo arreglo)', () => {
  const lista = [{ nombre: 'Ana' }, { nombre: 'Beto' }];
  const todos = filtrarPorCriterio(lista, {}, CAMPOS);
  assert.deepEqual(todos.map(x => x.nombre), ['Ana', 'Beto']);
  assert.notEqual(todos, lista);
});

test('B2: el texto matchea como subcadena ignorando mayusculas y acentos', () => {
  const lista = [{ nombre: 'Hernández' }, { nombre: 'Lopez' }];
  assert.deepEqual(filtrarPorCriterio(lista, { texto: 'HERNANDEZ' }, CAMPOS).map(x => x.nombre), ['Hernández']);
  assert.deepEqual(filtrarPorCriterio(lista, { texto: 'lópez' }, CAMPOS).map(x => x.nombre), ['Lopez']);
});

test('B3: el celular matchea por digitos sin importar como se capturo', () => {
  const opciones = { ...CAMPOS, digitosDe: x => x.celular };
  const lista = [
    { nombre: 'Ana', celular: '+52 55 1234 5678' },
    { nombre: 'Beto', celular: '9981234567' },
  ];
  assert.deepEqual(filtrarPorCriterio(lista, { texto: '5512' }, opciones).map(x => x.nombre), ['Ana']);
  assert.deepEqual(filtrarPorCriterio(lista, { texto: '(55) 1234-5678' }, opciones).map(x => x.nombre), ['Ana']);
  assert.deepEqual(filtrarPorCriterio(lista, { texto: '998123' }, opciones).map(x => x.nombre), ['Beto']);
  assert.deepEqual(filtrarPorCriterio(lista, { texto: '0000' }, opciones), []);
});

test('B4: digitosDe acepta varios telefonos por item (la cola Hoy mezcla dos tipos)', () => {
  const opciones = { ...CAMPOS, digitosDe: x => [x.celular, x.telefono] };
  const lista = [
    { nombre: 'Ana', celular: '5512345678' },
    { nombre: 'Beto', telefono: '5219981234567' },
  ];
  assert.deepEqual(filtrarPorCriterio(lista, { texto: '99812' }, opciones).map(x => x.nombre), ['Beto']);
});

test('B5: un campo ausente no estorba ni rompe el filtro', () => {
  const lista = [{ nombre: 'Ana' }, {}];
  assert.deepEqual(filtrarPorCriterio(lista, { texto: 'ana' }, CAMPOS).map(x => x.nombre), ['Ana']);
  assert.equal(filtrarPorCriterio(lista, { texto: '' }, CAMPOS).length, 2);
  assert.deepEqual(filtrarPorCriterio(null, { texto: 'ana' }, CAMPOS), []);
  assert.deepEqual(filtrarPorCriterio([{ nombre: 'Ana' }], { texto: 'ana' }, {}), []);
});

test('B6: Desde y Hasta son independientes y sus bordes entran', () => {
  const opciones = { ...CAMPOS, fechaDe: x => x.fecha };
  const lista = [
    { nombre: 'Ana', fecha: '2026-06-01T15:00:00' },
    { nombre: 'Beto', fecha: '2026-06-08T15:00:00' },
    { nombre: 'Cris', fecha: '2026-06-11T15:00:00' },
  ];
  assert.deepEqual(filtrarPorCriterio(lista, { desde: '2026-06-08' }, opciones).map(x => x.nombre), ['Beto', 'Cris']);
  assert.deepEqual(filtrarPorCriterio(lista, { hasta: '2026-06-08' }, opciones).map(x => x.nombre), ['Ana', 'Beto']);
  assert.deepEqual(
    filtrarPorCriterio(lista, { desde: '2026-06-01', hasta: '2026-06-08' }, opciones).map(x => x.nombre),
    ['Ana', 'Beto']
  );
});

// El filtro corre SOLO en el navegador y la tarjeta muestra la fecha en hora
// local: comparar contra el dia UTC ocultaria una tarjeta que dice "12 ago" al
// filtrar "Desde 13" (o al reves) segun el huso del vendedor.
test('B7: el rango compara contra el dia LOCAL, no el UTC', () => {
  const opciones = { ...CAMPOS, fechaDe: x => x.fecha };
  const local = new Date(2026, 7, 12, 23, 30);
  const lista = [{ nombre: 'Ana', fecha: local.toISOString() }];
  assert.deepEqual(filtrarPorCriterio(lista, { desde: '2026-08-13' }, opciones), []);
  assert.deepEqual(filtrarPorCriterio(lista, { hasta: '2026-08-12' }, opciones).map(x => x.nombre), ['Ana']);
});

test('B8: un item sin fecha no entra a ningun rango pero si pasa sin fechas', () => {
  const opciones = { ...CAMPOS, fechaDe: x => x.fecha };
  const lista = [{ nombre: 'Ana' }];
  assert.deepEqual(filtrarPorCriterio(lista, { desde: '2026-01-01' }, opciones), []);
  assert.deepEqual(filtrarPorCriterio(lista, { hasta: '2026-01-01' }, opciones), []);
  assert.deepEqual(filtrarPorCriterio(lista, {}, opciones).map(x => x.nombre), ['Ana']);
});

// Las dos convenciones de fecha caen en dias distintos en un huso negativo, y
// cada vista tiene que filtrar por el dia que su tarjeta pinta: `fechaDe` es un
// instante (se convierte a dia local, como toLocaleDateString) y `diaDe` es un
// dia calendario ya resuelto (Rescatados, que pinta el dia del quote sin pasar
// por Date). Mismo dato, dos resultados.
test('B10: diaDe compara el dia calendario literal; fechaDe lo convierte a dia local', () => {
  const lista = [{ nombre: 'Ana', fecha: '2026-07-21T00:00:00.000Z' }];
  const porDia = { ...CAMPOS, diaDe: x => String(x.fecha || '').slice(0, 10) };
  assert.deepEqual(filtrarPorCriterio(lista, { desde: '2026-07-21' }, porDia).map(x => x.nombre), ['Ana']);
  assert.deepEqual(filtrarPorCriterio(lista, { hasta: '2026-07-21' }, porDia).map(x => x.nombre), ['Ana']);
  assert.deepEqual(filtrarPorCriterio(lista, { desde: '2026-07-22' }, porDia), []);
  // El mismo instante por `fechaDe` en un huso negativo cae en el dia anterior.
  const porInstante = { ...CAMPOS, fechaDe: x => x.fecha };
  const diaLocal = new Date('2026-07-21T00:00:00.000Z').getDate();
  if (diaLocal === 20) {
    assert.deepEqual(filtrarPorCriterio(lista, { desde: '2026-07-21' }, porInstante), []);
    assert.deepEqual(filtrarPorCriterio(lista, { hasta: '2026-07-20' }, porInstante).map(x => x.nombre), ['Ana']);
  }
});

test('B9: texto y rango de fechas se combinan con AND', () => {
  const opciones = { ...CAMPOS, fechaDe: x => x.fecha };
  const lista = [
    { nombre: 'Hotel Azul', fecha: '2026-06-01T15:00:00' },
    { nombre: 'Hotel Verde', fecha: '2026-06-20T15:00:00' },
    { nombre: 'Panaderia', fecha: '2026-06-02T15:00:00' },
  ];
  assert.deepEqual(
    filtrarPorCriterio(lista, { texto: 'hotel', desde: '2026-06-01', hasta: '2026-06-08' }, opciones).map(x => x.nombre),
    ['Hotel Azul']
  );
});
