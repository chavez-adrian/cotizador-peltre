'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let filtrarPorCriterio, fechaLocal;
before(async () => {
  ({ filtrarPorCriterio, fechaLocal } = await import('../busqueda-logica.js'));
});

// #428: la zona se fija DENTRO de la prueba (Node relee process.env.TZ al
// asignarla) y se restaura al salir, para que el resultado no dependa del huso
// de la maquina ni contamine las demas pruebas del archivo.
function enZona(tz, fn) {
  const previa = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (previa === undefined) delete process.env.TZ;
    else process.env.TZ = previa;
  }
}

const DIA_MES = { day: 'numeric', month: 'short' };

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
// por Date). Mismo dato, dos resultados. Desde #428 el ejemplo es un instante de
// las 03:00 UTC: uno EXACTO en medianoche UTC ya es un dia calendario tambien por
// `fechaDe` (fechaLocal, decision de Adrian 2026-09-25; ver F9).
test('B10: diaDe compara el dia calendario literal; fechaDe lo convierte a dia local', () => {
  const lista = [{ nombre: 'Ana', fecha: '2026-07-21T03:00:00.000Z' }];
  const porDia = { ...CAMPOS, diaDe: x => String(x.fecha || '').slice(0, 10) };
  assert.deepEqual(filtrarPorCriterio(lista, { desde: '2026-07-21' }, porDia).map(x => x.nombre), ['Ana']);
  assert.deepEqual(filtrarPorCriterio(lista, { hasta: '2026-07-21' }, porDia).map(x => x.nombre), ['Ana']);
  assert.deepEqual(filtrarPorCriterio(lista, { desde: '2026-07-22' }, porDia), []);
  // El mismo instante por `fechaDe` en un huso negativo cae en el dia anterior.
  const porInstante = { ...CAMPOS, fechaDe: x => x.fecha };
  const diaLocal = new Date('2026-07-21T03:00:00.000Z').getDate();
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

// #428: el backfill (#76) y los rescates guardan `fecha` = `ord_date` de
// Operam, un dia SIN hora. `new Date('2026-05-08')` es medianoche UTC y en
// Mexico se pinta "7 may". Casos vistos en produccion el 2026-09-22.
test('F1: una fecha sin hora se lee como ese dia en hora local (1128, 1155, 1166)', () => {
  enZona('America/Mexico_City', () => {
    assert.equal(fechaLocal('2026-05-08').toLocaleDateString('es-MX', DIA_MES), '8 may');
    assert.equal(fechaLocal('2026-06-15').toLocaleDateString('es-MX', DIA_MES), '15 jun');
    assert.equal(fechaLocal('2026-06-29').toLocaleDateString('es-MX', DIA_MES), '29 jun');
  });
});

test('F2: una fecha ISO con hora sigue siendo un instante: se pinta en su dia local', () => {
  enZona('America/Mexico_City', () => {
    assert.equal(fechaLocal('2026-05-08T02:00:00.000Z').toLocaleDateString('es-MX', DIA_MES), '7 may');
  });
  enZona('Asia/Tokyo', () => {
    assert.equal(fechaLocal('2026-05-08T20:00:00.000Z').toLocaleDateString('es-MX', DIA_MES), '9 may');
  });
});

test('F3: el dia sin hora no depende del huso del navegador', () => {
  for (const tz of ['America/Mexico_City', 'UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
    enZona(tz, () => {
      assert.equal(fechaLocal('2026-05-08').toLocaleDateString('es-MX', DIA_MES), '8 may', tz);
    });
  }
});

test('F4: cualquier otra cosa se comporta como new Date(valor)', () => {
  enZona('America/Mexico_City', () => {
    const instante = new Date('2026-05-08T02:00:00.000Z');
    assert.equal(fechaLocal(instante).getTime(), instante.getTime());
    assert.equal(fechaLocal(0).getTime(), 0);
    assert.equal(fechaLocal('2026-05-08T02:00:00').getTime(), new Date(2026, 4, 8, 2).getTime());
    assert.ok(Number.isNaN(fechaLocal(undefined).getTime()));
    assert.ok(Number.isNaN(fechaLocal('no es fecha').getTime()));
  });
});

// #428: el filtro compara contra el MISMO dia que pinta la tarjeta. Antes
// diaLocal leia '2026-05-08' como medianoche UTC a proposito, para coincidir con
// la tarjeta mal pintada ("7 may"); arreglado el pintado, "Desde 8" la incluye.
test('F5: el rango trata la fecha sin hora como el dia que dice (Desde/Hasta)', () => {
  enZona('America/Mexico_City', () => {
    const opciones = { ...CAMPOS, fechaDe: x => x.fecha };
    const lista = [{ nombre: 'Cotizacion 1128', fecha: '2026-05-08' }];
    assert.deepEqual(filtrarPorCriterio(lista, { desde: '2026-05-08' }, opciones).map(x => x.nombre), ['Cotizacion 1128']);
    assert.deepEqual(filtrarPorCriterio(lista, { hasta: '2026-05-07' }, opciones), []);
    assert.deepEqual(filtrarPorCriterio(lista, { hasta: '2026-05-08' }, opciones).map(x => x.nombre), ['Cotizacion 1128']);
  });
});

test('F6: una fecha ISO con hora se sigue filtrando por su dia local', () => {
  enZona('America/Mexico_City', () => {
    const opciones = { ...CAMPOS, fechaDe: x => x.fecha };
    const lista = [{ nombre: 'Ana', fecha: '2026-05-08T02:00:00.000Z' }];
    assert.deepEqual(filtrarPorCriterio(lista, { desde: '2026-05-08' }, opciones), []);
    assert.deepEqual(filtrarPorCriterio(lista, { hasta: '2026-05-07' }, opciones).map(x => x.nombre), ['Ana']);
  });
});

// #428, decision de Adrian (2026-09-25, opcion A): en produccion Neon guarda
// `fecha` como TIMESTAMPTZ y el servidor la manda con toISOString(), asi que la
// ord_date '2026-05-08' llega al navegador como '2026-05-08T00:00:00.000Z',
// nunca como '2026-05-08'. Un ISO que cae EXACTO en medianoche UTC es un dia
// calendario, igual que Rescatados (diaDe): se lee el dia literal.
test('F7: un ISO a medianoche UTC exacta se lee como el dia que dice (1128, 1155, 1166)', () => {
  enZona('America/Mexico_City', () => {
    assert.equal(fechaLocal('2026-05-08T00:00:00.000Z').toLocaleDateString('es-MX', DIA_MES), '8 may');
    assert.equal(fechaLocal('2026-06-15T00:00:00.000Z').toLocaleDateString('es-MX', DIA_MES), '15 jun');
    assert.equal(fechaLocal('2026-06-29T00:00:00.000Z').toLocaleDateString('es-MX', DIA_MES), '29 jun');
    assert.equal(fechaLocal('2026-05-08T00:00:00Z').getTime(), new Date(2026, 4, 8).getTime());
    assert.equal(fechaLocal('2026-05-08T00:00:00+00:00').getTime(), new Date(2026, 4, 8).getTime());
    assert.equal(fechaLocal('2026-05-08T00:00:00.000+00:00').getTime(), new Date(2026, 4, 8).getTime());
  });
  enZona('Asia/Tokyo', () => {
    assert.equal(fechaLocal('2026-05-08T00:00:00.000Z').toLocaleDateString('es-MX', DIA_MES), '8 may');
  });
});

test('F8: un instante que no cae exacto en medianoche UTC sigue siendo un instante', () => {
  enZona('America/Mexico_City', () => {
    assert.equal(fechaLocal('2026-05-08T00:00:00.001Z').toLocaleDateString('es-MX', DIA_MES), '7 may');
    assert.equal(fechaLocal('2026-05-08T00:00:01.000Z').toLocaleDateString('es-MX', DIA_MES), '7 may');
    assert.equal(fechaLocal('2026-05-08T00:00:00.000-06:00').toLocaleDateString('es-MX', DIA_MES), '8 may');
    assert.equal(fechaLocal('2026-05-08T00:00:00.000+02:00').toLocaleDateString('es-MX', DIA_MES), '7 may');
    const medianocheUtc = new Date('2026-05-08T00:00:00.000Z');
    assert.equal(fechaLocal(medianocheUtc).getTime(), medianocheUtc.getTime());
  });
});

test('F9: el rango trata el ISO a medianoche UTC como el dia que dice (Desde/Hasta)', () => {
  enZona('America/Mexico_City', () => {
    const opciones = { ...CAMPOS, fechaDe: x => x.fecha };
    const lista = [{ nombre: 'Cotizacion 1128', fecha: '2026-05-08T00:00:00.000Z' }];
    assert.deepEqual(filtrarPorCriterio(lista, { desde: '2026-05-08' }, opciones).map(x => x.nombre), ['Cotizacion 1128']);
    assert.deepEqual(filtrarPorCriterio(lista, { hasta: '2026-05-07' }, opciones), []);
  });
});
