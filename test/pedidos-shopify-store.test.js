import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync, borrarArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, '..', 'data', 'pedidos-shopify.json');

// La tabla de pedidos de la tienda en linea (spec #254, ticket #255): sin
// DATABASE_URL cae a data/pedidos-shopify.json como los demas stores, y ese es
// el camino que ejercitan estas pruebas.
const store = await import('../lib/pedidos-shopify-store.js');

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
  if (existsSync(JSON_PATH)) borrarArchivoSync(JSON_PATH);
});

const FILA = {
  pedido: 'S1898',
  creadoEn: '2026-08-21T23:31:03.000Z',
  telefono: '+529991632568',
  celular10: '9991632568',
  nombre: 'Gerardo Cardenas Guillermo',
  correo: 'gerardo@ejemplo.mx',
  fuente: 'envio',
};

test('sin archivo, la tabla esta vacia y no hay cursor', async () => {
  assert.deepEqual(await store.listar(), []);
  assert.equal(await store.leerCursor(), null);
});

test('lo guardado se recupera entero', async () => {
  await store.guardar([FILA]);
  assert.deepEqual(await store.listar(), [FILA]);
});

// El sondeo relee por `updated_at`, asi que el MISMO pedido vuelve a pasar por
// aqui cada vez que alguien le corrige la direccion. Sin upsert, cada relectura
// agregaria una fila y el plan de contactos veria el mismo telefono N veces.
test('reingerir el mismo pedido corrige la fila, no la duplica', async () => {
  await store.guardar([FILA]);
  await store.guardar([{ ...FILA, nombre: 'Gerardo Cardenas' }]);
  const filas = await store.listar();
  assert.equal(filas.length, 1);
  assert.equal(filas[0].nombre, 'Gerardo Cardenas');
});

test('el mismo telefono en dos pedidos son dos filas', async () => {
  await store.guardar([FILA, { ...FILA, pedido: 'S1897', creadoEn: '2026-08-21T23:25:55.000Z' }]);
  assert.equal((await store.listar()).length, 2);
});

test('dos telefonos del mismo pedido son dos filas', async () => {
  await store.guardar([FILA, { ...FILA, celular10: '5512345678', telefono: '+525512345678' }]);
  assert.equal((await store.listar()).length, 2);
});

// El cursor es lo unico que hace incremental al sondeo: si se pierde, la
// siguiente corrida relee los sesenta dias completos (caro, pero inofensivo
// gracias al upsert de arriba).
test('el cursor se persiste y se relee', async () => {
  await store.guardarCursor('2026-08-21T23:31:06.000Z');
  assert.equal(await store.leerCursor(), '2026-08-21T23:31:06.000Z');
});

test('guardar filas no borra el cursor ni el cursor borra las filas', async () => {
  await store.guardarCursor('2026-08-21T23:31:06.000Z');
  await store.guardar([FILA]);
  assert.equal(await store.leerCursor(), '2026-08-21T23:31:06.000Z');
  await store.guardarCursor('2026-08-22T00:00:00.000Z');
  assert.deepEqual(await store.listar(), [FILA]);
});

test('guardar una lista vacia no rompe ni escribe nada', async () => {
  await store.guardar([]);
  assert.deepEqual(await store.listar(), []);
});
