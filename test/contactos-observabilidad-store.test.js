import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync, borrarArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, '..', 'data', 'contactos-google-barridos.json');

// Estado por barrido de sincronizacion de contactos (issue #230): sin
// DATABASE_URL cae a data/*.json como los demas stores, y ese es el camino
// que ejercitan estas pruebas.
const store = await import('../lib/contactos-observabilidad-store.js');

let respaldo = null;
let existia = false;

before(() => {
  existia = existsSync(JSON_PATH);
  if (existia) respaldo = leerArchivoSync(JSON_PATH);
});

after(() => {
  if (existia) escribirArchivoSync(JSON_PATH, respaldo);
  else if (existsSync(JSON_PATH)) borrarArchivoSync(JSON_PATH);
});

beforeEach(() => {
  escribirArchivoSync(JSON_PATH, '{}');
});

const ESTADO = {
  ultimaCorrida: '2026-08-21T00:00:00.000Z', ultimaCorridaExitosa: '2026-08-21T00:00:00.000Z',
  creados: 2, actualizados: 1, inactivados: 0,
  errores: [], ultimoAviso: null,
};

test('lo guardado se recupera igual', async () => {
  await store.guardar('prospectos', ESTADO);
  const leido = await store.leer('prospectos');
  assert.deepEqual(leido, ESTADO);
});

test('un barrido sin estado guardado lee null, no falla', async () => {
  assert.equal(await store.leer('prospectos'), null);
});

test('guardar dos veces el mismo barrido corrige el estado, no lo duplica', async () => {
  await store.guardar('prospectos', ESTADO);
  await store.guardar('prospectos', { ...ESTADO, creados: 9 });
  const todos = await store.listarTodos();
  assert.equal(todos.length, 1);
  assert.equal(todos[0].creados, 9);
});

test('cada nombre de barrido tiene su propio estado, sin pisarse', async () => {
  await store.guardar('prospectos', ESTADO);
  await store.guardar('clientes', { ...ESTADO, creados: 40 });
  assert.equal((await store.leer('prospectos')).creados, 2);
  assert.equal((await store.leer('clientes')).creados, 40);
  const todos = await store.listarTodos();
  assert.equal(todos.length, 2);
});

test('errores con motivo y categoria persisten intactos', async () => {
  const conErrores = {
    ...ESTADO,
    errores: [{ celular10: '5512345678', motivo: 'Google People 401: expirado', categoria: 'autorizacion' }],
  };
  await store.guardar('prospectos', conErrores);
  const leido = await store.leer('prospectos');
  assert.deepEqual(leido.errores, conErrores.errores);
});
