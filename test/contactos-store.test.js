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
  assert.deepEqual(mapeo, [{ ...ENTRADA, inactivoDesde: null }]);
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

// --- La marca de inactiva (#231) ---

test('marcar inactiva una ficha conserva todo lo demas: nada se borra', async () => {
  await store.guardar(ENTRADA);
  await store.marcarInactivo('5512345678', new Date('2026-08-21T12:00:00Z'));
  const [fila] = await store.listar();
  assert.equal(fila.inactivoDesde, '2026-08-21T12:00:00.000Z');
  assert.equal(fila.resourceName, 'people/c1');
  assert.equal(fila.huella, 'h1');
});

test('volver a escribir la ficha la reactiva: la marca se limpia sola', async () => {
  // La reactivacion no necesita un metodo propio: si la ficha se volvio a
  // escribir es porque su origen volvio, y una ficha con respaldo no puede
  // quedarse marcada como inactiva.
  await store.guardar(ENTRADA);
  await store.marcarInactivo('5512345678', new Date('2026-08-21T12:00:00Z'));
  await store.guardar({ ...ENTRADA, huella: 'h2' });
  const [fila] = await store.listar();
  assert.equal(fila.inactivoDesde, null);
});
