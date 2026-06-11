import { test } from 'node:test';
import assert from 'node:assert/strict';
import { horasHabilesEntre, FESTIVOS } from '../lib/horas-habiles.js';

// Todas las fechas de los tests son instantes UTC (sufijo Z). El horario habil
// se evalua en America/Mexico_City (UTC-6 fijo desde 2022): CDMX 10:00 = 16:00Z,
// CDMX 18:00 = 00:00Z del dia siguiente. Semana de referencia: lunes 8 de junio
// de 2026 a domingo 14 de junio de 2026 (sin festivos).

test('H1: mismo dia dentro de horario cuenta las horas exactas', () => {
  // miercoles 10 jun, 10:00 -> 12:00 CDMX
  assert.equal(horasHabilesEntre('2026-06-10T16:00:00Z', '2026-06-10T18:00:00Z'), 2);
});

test('H2: cuenta fracciones de hora', () => {
  // miercoles 10:30 -> 11:15 CDMX
  assert.equal(horasHabilesEntre('2026-06-10T16:30:00Z', '2026-06-10T17:15:00Z'), 0.75);
});

test('H3: instantes fuera de horario no acumulan', () => {
  // miercoles 07:00 -> 09:00 CDMX (antes de abrir)
  assert.equal(horasHabilesEntre('2026-06-10T13:00:00Z', '2026-06-10T15:00:00Z'), 0);
  // miercoles 19:00 -> 21:00 CDMX (despues de cerrar)
  assert.equal(horasHabilesEntre('2026-06-11T01:00:00Z', '2026-06-11T03:00:00Z'), 0);
});

test('H4: un rango que cubre todo el dia habil cuenta 8 horas L-V', () => {
  // miercoles 08:00 -> 20:00 CDMX
  assert.equal(horasHabilesEntre('2026-06-10T14:00:00Z', '2026-06-11T02:00:00Z'), 8);
});

test('H5: cruce de medianoche suma el cierre de un dia y la apertura del siguiente', () => {
  // miercoles 17:00 -> jueves 11:00 CDMX
  assert.equal(horasHabilesEntre('2026-06-10T23:00:00Z', '2026-06-11T17:00:00Z'), 2);
});

test('H6: el sabado cierra a las 14:00', () => {
  // sabado 13 jun, 10:00 -> 16:00 CDMX
  assert.equal(horasHabilesEntre('2026-06-13T16:00:00Z', '2026-06-13T22:00:00Z'), 4);
});

test('H7: capturado en fin de semana no acumula espera', () => {
  // sabado 15:00 CDMX (tras el cierre) -> lunes 10:00 CDMX
  assert.equal(horasHabilesEntre('2026-06-13T21:00:00Z', '2026-06-15T16:00:00Z'), 0);
  // domingo 12:00 CDMX -> lunes 11:00 CDMX = 1
  assert.equal(horasHabilesEntre('2026-06-14T18:00:00Z', '2026-06-15T17:00:00Z'), 1);
});

test('H8: viernes tarde a lunes manana cuenta viernes, sabado corto y lunes', () => {
  // viernes 12 jun 17:00 -> lunes 15 jun 11:00 CDMX = 1 + 4 + 0 + 1
  assert.equal(horasHabilesEntre('2026-06-12T23:00:00Z', '2026-06-15T17:00:00Z'), 6);
});

test('H9: los festivos no acumulan horas', () => {
  // 16 sep 2026 es miercoles y festivo: martes 15 17:00 -> jueves 17 11:00 CDMX = 1 + 0 + 1
  assert.equal(horasHabilesEntre('2026-09-15T23:00:00Z', '2026-09-17T17:00:00Z'), 2);
  // capturado el festivo mismo -> jueves 11:00 = 1
  assert.equal(horasHabilesEntre('2026-09-16T18:00:00Z', '2026-09-17T17:00:00Z'), 1);
});

test('H10: rango multi-dia de semana completa suma 44 horas (5x8 + 4)', () => {
  // lunes 8 jun 10:00 -> sabado 13 jun 14:00 CDMX
  assert.equal(horasHabilesEntre('2026-06-08T16:00:00Z', '2026-06-13T20:00:00Z'), 44);
});

test('H11: rango vacio o invertido devuelve 0', () => {
  assert.equal(horasHabilesEntre('2026-06-10T17:00:00Z', '2026-06-10T17:00:00Z'), 0);
  assert.equal(horasHabilesEntre('2026-06-10T18:00:00Z', '2026-06-10T16:00:00Z'), 0);
});

test('H12: el dia habil se evalua en CDMX, no en el dia UTC', () => {
  // viernes 17:00 -> 18:00 CDMX cruza la medianoche UTC hacia el sabado UTC;
  // evaluado en UTC seria 0, en CDMX es 1 hora de viernes habil
  assert.equal(horasHabilesEntre('2026-06-12T23:00:00Z', '2026-06-13T00:00:00Z'), 1);
  // martes 15 sep 10:00 -> 18:00 CDMX: el extremo final cae en el 16 sep UTC
  // (festivo); evaluado en CDMX sigue siendo el martes 15 completo
  assert.equal(horasHabilesEntre('2026-09-15T16:00:00Z', '2026-09-16T00:00:00Z'), 8);
});

test('H13: acepta Date ademas de string ISO', () => {
  assert.equal(horasHabilesEntre(new Date('2026-06-10T16:00:00Z'), new Date('2026-06-10T18:00:00Z')), 2);
});

test('H14: FESTIVOS trae los siete festivos de 2026 y 2027 con los lunes moviles correctos', () => {
  const f2026 = ['2026-01-01', '2026-02-02', '2026-03-16', '2026-05-01', '2026-09-16', '2026-11-16', '2026-12-25'];
  const f2027 = ['2027-01-01', '2027-02-01', '2027-03-15', '2027-05-01', '2027-09-16', '2027-11-15', '2027-12-25'];
  for (const f of [...f2026, ...f2027]) {
    assert.ok(FESTIVOS.includes(f), `falta el festivo ${f}`);
  }
});
