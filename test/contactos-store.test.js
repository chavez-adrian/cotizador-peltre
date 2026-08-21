import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync, borrarArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, '..', 'data', 'contactos-google.json');

// El mapeo celular normalizado -> ficha de Google es la AUTORIDAD de identidad
// (spec #224): sin DATABASE_URL cae a data/*.json como los demas stores, y ese
// es el camino que ejercitan estas pruebas.
const store = await import('../lib/contactos-store.js');

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

const ENTRADA = {
  celular10: '5512345678', resourceName: 'people/c1', etag: 'e1',
  clase: 'propio', huella: 'h1',
};

test('lo guardado se recupera con su resourceName, etag y huella', async () => {
  await store.guardar(ENTRADA);
  const mapeo = await store.listar();
  assert.deepEqual(mapeo, [ENTRADA]);
});

test('guardar dos veces el mismo celular corrige la ficha, no la duplica', async () => {
  await store.guardar(ENTRADA);
  await store.guardar({ ...ENTRADA, etag: 'e2', huella: 'h2' });
  const mapeo = await store.listar();
  assert.equal(mapeo.length, 1);
  assert.equal(mapeo[0].etag, 'e2');
  assert.equal(mapeo[0].huella, 'h2');
  assert.equal(mapeo[0].resourceName, 'people/c1');
});

test('sin nada guardado el mapeo esta vacio, no falla', async () => {
  assert.deepEqual(await store.listar(), []);
});
