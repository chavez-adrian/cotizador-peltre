import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planParche } from '../scripts/titular-empresas-prospectos.mjs';

// Parche unico de #293: los prospectos que ya estan guardados con la empresa
// entera en MAYUSCULAS (98 de Abastur 2026, todos nacidos del importador antes
// de que pasara por normalizarTextosProspecto). El plan es puro: quien escribe
// es el store, y solo las filas que cambian.

const prospecto = (id, empresa) => ({ id, nombre: 'Alejandra Arena', data: { empresa } });

test('el plan lista la empresa gritada con su forma corregida', () => {
  const plan = planParche([
    prospecto(1, 'DORADOS CONVENTION & RESORT'),
    prospecto(2, 'ACESA INTERABASTO S.A DE C.V'),
  ]);
  assert.deepEqual(plan, [
    { id: 1, antes: 'DORADOS CONVENTION & RESORT', despues: 'Dorados Convention & Resort' },
    { id: 2, antes: 'ACESA INTERABASTO S.A DE C.V', despues: 'Acesa Interabasto S.A de C.V' },
  ]);
});

test('lo que ya esta bien escrito no entra al plan: la segunda corrida no cambia nada', () => {
  const ya = [
    prospecto(3, 'Dorados Convention & Resort'),
    prospecto(4, "McDonald's Insurgentes"),
    prospecto(5, 'Hotel La Joya'),
    prospecto(6, 'CDMX Foods'),
  ];
  assert.deepEqual(planParche(ya), []);
  // idempotencia: aplicar el plan y volver a planear no produce trabajo nuevo
  const corregidos = planParche([prospecto(1, 'DORADOS CONVENTION & RESORT')])
    .map(c => prospecto(c.id, c.despues));
  assert.deepEqual(planParche(corregidos), []);
});

test('el prospecto sin empresa, con empresa vacia o sin data se ignora', () => {
  assert.deepEqual(planParche([
    { id: 7, data: {} },
    { id: 8, data: { empresa: '' } },
    { id: 9, data: { empresa: '   ' } },
    { id: 10 },
    { id: 11, data: null },
  ]), []);
});

test('una lista vacia o nula no revienta', () => {
  assert.deepEqual(planParche([]), []);
  assert.deepEqual(planParche(null), []);
});
