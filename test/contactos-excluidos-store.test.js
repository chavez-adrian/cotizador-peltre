import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync, borrarArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, '..', 'data', 'contactos-excluidos.json');

// La lista de exclusion por celular (#259, spec #254): sin DATABASE_URL cae a
// data/contactos-excluidos.json como los demas stores, y ese es el camino que
// ejercitan estas pruebas.
const store = await import('../lib/contactos-excluidos-store.js');

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
  escribirArchivoSync(JSON_PATH, '[]');
});

test('sin nada excluido la lista esta vacia', async () => {
  assert.deepEqual(await store.listar(), []);
});

test('lo agregado se recupera con su motivo', async () => {
  await store.agregar('5512345678', 'solicitud del titular');
  const lista = await store.listar();
  assert.equal(lista.length, 1);
  assert.equal(lista[0].celular10, '5512345678');
  assert.equal(lista[0].motivo, 'solicitud del titular');
  assert.ok(lista[0].excluidoEn);
});

test('agregar sin motivo no falla', async () => {
  await store.agregar('5512345678');
  const [fila] = await store.listar();
  assert.equal(fila.motivo, '');
});

// Idempotente: pedir la exclusion dos veces no debe duplicar la fila ni
// desordenar el motivo original con un vacio (#259).
test('agregar el mismo celular dos veces no lo duplica', async () => {
  await store.agregar('5512345678', 'primera solicitud');
  await store.agregar('5512345678', 'segunda solicitud');
  const lista = await store.listar();
  assert.equal(lista.length, 1);
  assert.equal(lista[0].motivo, 'primera solicitud');
});

test('estaExcluido reconoce un celular ya excluido y no otro', async () => {
  await store.agregar('5512345678', 'motivo');
  assert.equal(await store.estaExcluido('5512345678'), true);
  assert.equal(await store.estaExcluido('5598765432'), false);
});
