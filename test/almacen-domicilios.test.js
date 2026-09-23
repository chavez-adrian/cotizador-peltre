import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reporteAlmacenDomicilios, excepcionesAlmacen, marcarAsiVaBien, desmarcarAsiVaBien,
} from '../lib/almacen-domicilios.js';

// Nucleo puro del barrido de domicilios con almacen mal configurado (#416,
// derivado de #409): sobre el padron de domicilios de entrega, cuales entregan
// desde un almacen distinto del de producto terminado. Sin IO -- el endpoint lee
// Operam y le pasa lo leido.
//
// El caso real del ticket: el domicilio "Pestalozzi" del Cliente Operam 15 estaba
// configurado con Almacen MP (loc_code 10) en vez de PT (40).

const OPERAM_URL = 'https://peltrenacional.operam.pro';
const ALMACENES = new Map([['10', 'Almacen MP'], ['40', 'Almacen PT'], ['41', 'PT2']]);

function cliente(customer_id, CustName, branches) {
  return { customer_id, CustName, branches };
}

test('el domicilio que entrega desde otro almacen sale con el nombre del almacen y la liga al Cliente Operam', () => {
  const r = reporteAlmacenDomicilios({
    clientes: [cliente('15', 'CLIENTE DE PRUEBA', [
      { branch_code: '20', br_name: 'Pestalozzi' },
      { branch_code: '21', br_name: 'Matriz' },
    ])],
    branches: {
      20: { branch_code: '20', br_name: 'Pestalozzi', default_location: '10' },
      21: { branch_code: '21', br_name: 'Matriz', default_location: '40' },
    },
    almacenes: ALMACENES,
    operamUrl: OPERAM_URL + '/',
  });

  assert.deepEqual(r.filas, [{
    clienteId: '15',
    cliente: 'CLIENTE DE PRUEBA',
    branchCode: '20',
    domicilio: 'Pestalozzi',
    almacen: '10',
    almacenNombre: 'Almacen MP',
    url: 'https://peltrenacional.operam.pro/sales/manage/customers.php?debtor_no=15',
  }]);
  assert.equal(r.esperado, '40');
  assert.equal(r.esperadoNombre, 'Almacen PT');
  assert.equal(r.revisados, 2);
});

// Lo que no se midio NO es una anomalia (mismo criterio que el aviso de #409),
// pero tampoco puede desaparecer: un barrido que se trague los domicilios que no
// alcanzo a leer se ve igual que uno que los reviso todos.
test('el domicilio que no se pudo leer sale aparte con su motivo, nunca como mal configurado', () => {
  const r = reporteAlmacenDomicilios({
    clientes: [cliente('15', 'CLIENTE DE PRUEBA', [
      { branch_code: '20', br_name: 'Pestalozzi' },
      { branch_code: '22', br_name: 'Bodega' },
    ])],
    branches: { 22: { branch_code: '22', br_name: 'Bodega', default_location: null } },
    errores: { 20: 'Operam 500' },
    almacenes: ALMACENES,
    operamUrl: OPERAM_URL,
  });

  assert.deepEqual(r.filas, []);
  assert.deepEqual(r.sinLeer.map(s => [s.branchCode, s.domicilio, s.motivo, s.detalle]), [
    ['20', 'Pestalozzi', 'No se pudo leer de que almacen entrega este domicilio', 'Operam 500'],
    ['22', 'Bodega', 'No se pudo leer de que almacen entrega este domicilio', 'Operam no devolvio default_location'],
  ]);
  assert.equal(r.sinLeer[0].url, 'https://peltrenacional.operam.pro/sales/manage/customers.php?debtor_no=15');
  assert.equal(r.revisados, 2);
});

// Decision de Adrian (2026-09-23, comentario de #416): constante 40 + lista de
// excepciones. El domicilio marcado "asi va bien" deja de salir en cada corrida.
// Primera excepcion confirmada: Cliente Operam 8, domicilio 8 ("Mercado de
// Antiguedades de La Lagunilla"), almacen 41 PT2.
test('el domicilio marcado "asi va bien" deja de salir en el reporte y se lista aparte', () => {
  const r = reporteAlmacenDomicilios({
    clientes: [cliente('8', 'CLIENTE OCHO', [{ branch_code: '8', br_name: 'Mercado de Antiguedades de La Lagunilla' }])],
    branches: { 8: { branch_code: '8', br_name: 'Mercado de Antiguedades de La Lagunilla', default_location: '41' } },
    almacenes: ALMACENES,
    operamUrl: OPERAM_URL,
    excepciones: [{ clienteId: '8', branchCode: '8', almacen: '41' }],
  });

  assert.deepEqual(r.filas, []);
  assert.deepEqual(r.asiVaBien, [{
    clienteId: '8',
    cliente: 'CLIENTE OCHO',
    branchCode: '8',
    domicilio: 'Mercado de Antiguedades de La Lagunilla',
    almacen: '41',
    almacenNombre: 'PT2',
    url: 'https://peltrenacional.operam.pro/sales/manage/customers.php?debtor_no=8',
  }]);
});

// Lo que se aprobo es ESA configuracion: si alguien mueve el domicilio a otro
// almacen, la aprobacion ya no dice nada de hoy y el domicilio vuelve a salir.
test('la excepcion cubre el almacen que se aprobo: el mismo domicilio en otro almacen vuelve a salir', () => {
  const r = reporteAlmacenDomicilios({
    clientes: [cliente('8', 'CLIENTE OCHO', [{ branch_code: '8', br_name: 'Lagunilla' }])],
    branches: { 8: { branch_code: '8', br_name: 'Lagunilla', default_location: '10' } },
    almacenes: ALMACENES,
    excepciones: [{ clienteId: '8', branchCode: '8', almacen: '41' }],
  });

  assert.deepEqual(r.filas.map(f => [f.branchCode, f.almacen]), [['8', '10']]);
});

// La lista del panel tiene que dejar desmarcar TODO lo marcado, tambien lo que
// el ultimo barrido no encontro (o todavia no hay barrido): sin nombres, con ids.
test('una excepcion que el barrido no encontro se sigue listando, con sus ids', () => {
  const r = reporteAlmacenDomicilios({
    excepciones: [{ clienteId: '8', branchCode: '8', almacen: '41' }],
    almacenes: ALMACENES,
    operamUrl: OPERAM_URL,
  });

  assert.deepEqual(r.asiVaBien, [{
    clienteId: '8', cliente: '', branchCode: '8', domicilio: '', almacen: '41', almacenNombre: 'PT2',
    url: 'https://peltrenacional.operam.pro/sales/manage/customers.php?debtor_no=8',
  }]);
});

// La lista vive en la configuracion del panel (#276), que en produccion ya es
// una fila de Neon SIN esta llave: la semilla no puede depender de
// data/config.json (que solo siembra una tabla vacia). La llave AUSENTE es la
// semilla; una lista guardada -- aunque sea vacia -- manda.
test('sin lista guardada, la excepcion sembrada es la del Cliente Operam 8, domicilio 8, almacen 41', () => {
  assert.deepEqual(excepcionesAlmacen(undefined), [{ clienteId: '8', branchCode: '8', almacen: '41' }]);
  assert.deepEqual(excepcionesAlmacen({ tiposActivos: ['PL'] }), [{ clienteId: '8', branchCode: '8', almacen: '41' }]);
});

test('una lista guardada manda sobre la semilla, tambien vacia: desmarcar la sembrada es una decision', () => {
  assert.deepEqual(excepcionesAlmacen({ excepcionesAlmacen: [] }), []);
  assert.deepEqual(
    excepcionesAlmacen({ excepcionesAlmacen: [{ clienteId: 30, branchCode: 31, almacen: 10 }, { branchCode: '', almacen: '41' }, null] }),
    [{ clienteId: '30', branchCode: '31', almacen: '10' }],
  );
});

// El Cliente Operam 14 (PUBLICO EN GENERAL) tiene el domicilio "Bazaar Sabado"
// en el almacen Bazaar: probablemente es excepcion legitima, pero Adrian NO lo ha
// marcado (2026-09-23). Sigue saliendo hasta que lo marque desde el panel. El
// loc_code del almacen Bazaar es ilustrativo.
test('con la semilla, el domicilio 8 en PT2 no sale y el Bazaar Sabado del Cliente Operam 14 si', () => {
  const r = reporteAlmacenDomicilios({
    clientes: [
      cliente('8', 'CLIENTE OCHO', [{ branch_code: '8', br_name: 'Lagunilla' }]),
      cliente('14', 'PUBLICO EN GENERAL', [{ branch_code: '90', br_name: 'Bazaar Sabado' }]),
    ],
    branches: {
      8: { branch_code: '8', br_name: 'Lagunilla', default_location: '41' },
      90: { branch_code: '90', br_name: 'Bazaar Sabado', default_location: '60' },
    },
    almacenes: new Map([...ALMACENES, ['60', 'Bazaar']]),
    excepciones: excepcionesAlmacen({}),
  });

  assert.deepEqual(r.filas.map(f => [f.clienteId, f.domicilio, f.almacenNombre]), [['14', 'Bazaar Sabado', 'Bazaar']]);
  assert.deepEqual(r.asiVaBien.map(e => [e.clienteId, e.branchCode, e.almacen]), [['8', '8', '41']]);
});

test('marcar "asi va bien" agrega el domicilio con el almacen que se aprueba; marcarlo otra vez lo reemplaza', () => {
  const sembrada = excepcionesAlmacen({});
  const una = marcarAsiVaBien(sembrada, { clienteId: 14, branchCode: 90, almacen: 60 });
  assert.deepEqual(una, [
    { clienteId: '8', branchCode: '8', almacen: '41' },
    { clienteId: '14', branchCode: '90', almacen: '60' },
  ]);
  assert.deepEqual(sembrada, [{ clienteId: '8', branchCode: '8', almacen: '41' }], 'no muta la lista recibida');

  const otra = marcarAsiVaBien(una, { clienteId: '14', branchCode: '90', almacen: '61' });
  assert.deepEqual(otra, [
    { clienteId: '8', branchCode: '8', almacen: '41' },
    { clienteId: '14', branchCode: '90', almacen: '61' },
  ]);
});

test('marcar sin domicilio o sin almacen no es una excepcion: null', () => {
  assert.equal(marcarAsiVaBien([], { clienteId: '14', almacen: '60' }), null);
  assert.equal(marcarAsiVaBien([], { clienteId: '14', branchCode: '90', almacen: ' ' }), null);
  assert.equal(marcarAsiVaBien([], null), null);
});

test('desmarcar quita el domicilio de la lista y deja lo demas', () => {
  const lista = [
    { clienteId: '8', branchCode: '8', almacen: '41' },
    { clienteId: '14', branchCode: '90', almacen: '60' },
  ];
  assert.deepEqual(desmarcarAsiVaBien(lista, 8), [{ clienteId: '14', branchCode: '90', almacen: '60' }]);
  assert.deepEqual(desmarcarAsiVaBien(lista, '99'), lista);
});
