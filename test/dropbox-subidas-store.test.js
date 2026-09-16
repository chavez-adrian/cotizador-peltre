// Registro de intentos de subida a Dropbox (issue #356, hijo de #354). Las
// subidas son fire-and-forget en los tres flujos del repo y su fallo no dejaba
// rastro en ningun lado: este store es el lugar donde se ve. Calcado de
// lib/contactos-observabilidad-store.js -- Neon con DATABASE_URL, fallback a
// data/dropbox-subidas.json sin ella, y ese es el camino que ejercitan estas
// pruebas.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync, borrarArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, '..', 'data', 'dropbox-subidas.json');

const store = await import('../lib/dropbox-subidas-store.js');

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

const CSF = '/PELTRE NACIONAL/3.0 ADMINISTRACION/CONTABILIDAD/PNA170810CF1/CONSTANCIA SITUACION FISCAL CLIENTES/OGA140604560 - Operadora Gastronomica.pdf';

test('una subida exitosa queda registrada con flujo, destino, archivo y momento', async () => {
  await store.registrar({ flujo: 'csf', destino: CSF, ok: true });
  const [fila] = await store.listarRecientes();
  assert.equal(fila.flujo, 'csf');
  assert.equal(fila.destino, CSF);
  assert.equal(fila.archivo, 'OGA140604560 - Operadora Gastronomica.pdf');
  assert.equal(fila.ok, true);
  assert.equal(fila.error, null);
  assert.ok(!Number.isNaN(Date.parse(fila.momento)), 'el momento es una fecha: ' + fila.momento);
});

test('una subida fallida guarda el mensaje de error', async () => {
  await store.registrar({ flujo: 'calca', destino: '/1.0/CALCAS/pos.pdf', ok: false, error: 'Dropbox 409: path/conflict/file' });
  const [fila] = await store.listarRecientes();
  assert.equal(fila.ok, false);
  assert.equal(fila.error, 'Dropbox 409: path/conflict/file');
});

test('listarRecientes devuelve primero la mas reciente y respeta el limite', async () => {
  await store.registrar({ flujo: 'bitrix', destino: '/CRM/BACKUP/leads.json', ok: true });
  await store.registrar({ flujo: 'bitrix', destino: '/CRM/BACKUP/deals.json', ok: true });
  await store.registrar({ flujo: 'bitrix', destino: '/CRM/BACKUP/resumen.json', ok: true });
  const filas = await store.listarRecientes(2);
  assert.equal(filas.length, 2);
  assert.deepEqual(filas.map(f => f.archivo), ['resumen.json', 'deals.json']);
});

test('registrar no lanza cuando el propio registro falla: el archivo corrupto se traga', async () => {
  escribirArchivoSync(JSON_PATH, '{esto no es JSON');
  assert.equal(await store.registrar({ flujo: 'csf', destino: '/x/y.pdf', ok: true }), false);
});

test('listarRecientes no lanza cuando el propio registro falla: devuelve lista vacia', async () => {
  escribirArchivoSync(JSON_PATH, '{esto no es JSON');
  assert.deepEqual(await store.listarRecientes(), []);
});
