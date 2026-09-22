// La lista de documentos ANULADOS en Operam (#408, derivado de #406). La API v3 no
// expone la cancelacion: la foto de data/cancelados.json la arma por scraping
// scripts/detectar-cancelados.mjs, que solo recorre los candidatos del BACKFILL (#76).
// Un documento que deja de ser candidato ya no se vuelve a mirar, asi que una escritura
// que REEMPLAZA pierde lo ya medido: el 2026-09-21 una corrida dejo `quotes: []` y borro
// los cuatro folios de junio (1077, 1093, 1098, 1105).
//
// Aqui se prueba el NUCLEO PURO de la union. El IO (login web, scraping, escribir el
// archivo) vive en scripts/detectar-cancelados.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { unirCancelados } from '../lib/cancelados.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

const GENERADO = '2026-09-22T12:00:00.000Z';

// Lo que el archivo traia de junio antes del refresco que los borro.
const previoDeJunio = JSON.stringify({
  generado: '2026-06-30T00:00:00.000Z',
  nota: 'foto anterior',
  orders: ['5960'],
  quotes: ['1077', '1093', '1098', '1105'],
});

test('#408: la corrida se UNE con lo que el archivo ya traia, no lo reemplaza', () => {
  const out = unirCancelados({
    previo: previoDeJunio, orders: ['7321'], quotes: ['1196'], generado: GENERADO,
  });
  assert.deepEqual(out.orders, ['5960', '7321']);
  assert.deepEqual(out.quotes, ['1077', '1093', '1098', '1105', '1196']);
});

// Los folios son strings pero se ordenan como NUMEROS, igual que antes de #408: por
// texto, '980' se iria al final de la lista.
test('#408: las dos listas quedan ordenadas numericamente ascendente', () => {
  const previo = JSON.stringify({ orders: ['7321'], quotes: ['1105'] });
  const out = unirCancelados({
    previo, orders: ['985', '6092'], quotes: ['980', '1196'], generado: GENERADO,
  });
  assert.deepEqual(out.orders, ['985', '6092', '7321']);
  assert.deepEqual(out.quotes, ['980', '1105', '1196']);
});

test('#408: un folio que esta en el archivo previo y en la corrida nueva aparece una sola vez', () => {
  const previo = JSON.stringify({ orders: ['5960'], quotes: ['1077'] });
  const out = unirCancelados({
    previo, orders: ['5960', '7321'], quotes: ['1077'], generado: GENERADO,
  });
  assert.deepEqual(out.orders, ['5960', '7321']);
  assert.deepEqual(out.quotes, ['1077']);
});

// Las dos numeraciones son independientes (trans_type 30 vs 32): el pedido 5960 y el
// quote 1077 no tienen nada que ver, y un folio de una lista no puede aparecer en la
// otra por haberse unido de mas.
test('#408: orders y quotes se unen por separado, ningun folio cruza de una lista a la otra', () => {
  const previo = JSON.stringify({ orders: ['5960'], quotes: ['1077'] });
  const out = unirCancelados({
    previo, orders: ['6092'], quotes: ['1196'], generado: GENERADO,
  });
  assert.deepEqual(out.orders, ['5960', '6092']);
  assert.deepEqual(out.quotes, ['1077', '1196']);
});

// La primera corrida en una maquina limpia no tiene de que acumular, y un archivo a
// medio escribir no puede tumbar una corrida que ya gasto media hora de scraping: en
// los dos casos el resultado es lo recien verificado, como antes de #408.
test('#408: sin archivo previo el resultado es el conjunto recien verificado', () => {
  const out = unirCancelados({ previo: null, orders: ['7321'], quotes: ['1196'], generado: GENERADO });
  assert.deepEqual(out.orders, ['7321']);
  assert.deepEqual(out.quotes, ['1196']);
});

test('#408: con un archivo previo ilegible el resultado es el conjunto recien verificado y no lanza', () => {
  const out = unirCancelados({
    previo: '{"orders": ["5960", ', orders: ['7321'], quotes: ['1196'], generado: GENERADO,
  });
  assert.deepEqual(out.orders, ['7321']);
  assert.deepEqual(out.quotes, ['1196']);
});

// La forma del archivo no cambia (generado, nota, orders, quotes) y la `nota` es donde
// el que lo abra lee que esta foto NO es un censo: su universo son los candidatos del
// backfill, no todos los documentos de Operam (por eso el 1196 estaba anulado sin que
// la lista lo supiera, #406).
test('#408: el archivo conserva su forma y la nota declara que el universo es el del backfill', () => {
  const out = unirCancelados({
    previo: previoDeJunio, orders: ['7321'], quotes: ['1196'], generado: GENERADO,
  });
  assert.deepEqual(Object.keys(out), ['generado', 'nota', 'orders', 'quotes']);
  assert.equal(out.generado, GENERADO);
  assert.match(out.nota, /candidatos del BACKFILL/i);
  assert.match(out.nota, /no es un censo/i);
});

// El otro sitio donde ese limite tiene que estar escrito es la cabecera del script: lo
// que se leyo como censo fue el ARCHIVO, y quien lo vuelva a correr abre primero el
// .mjs. Guard de documentacion, como el de terminologia (#363).
test('#408: la cabecera de detectar-cancelados.mjs declara que su universo es el del backfill y que no es un censo', () => {
  const lineas = readFileSync(join(RAIZ, 'scripts', 'detectar-cancelados.mjs'), 'utf8').split('\n');
  const hastaElCodigo = lineas.findIndex(l => !l.startsWith('//'));
  const cabecera = lineas.slice(0, hastaElCodigo).join('\n');
  assert.match(cabecera, /candidatos del BACKFILL/i);
  assert.match(cabecera, /no es un censo/i);
});
