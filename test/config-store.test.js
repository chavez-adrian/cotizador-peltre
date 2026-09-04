// #276: la configuracion del panel /admin (tipos y texturas activos, evento
// activo, ligas) se muda al patron de la casa: Neon con DATABASE_URL, archivo
// como fallback (dev y tests) y como SEMILLA de una tabla vacia. Sin base el
// comportamiento tiene que ser el de siempre -- la suite entera vive ahi.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '..', 'data', 'config.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}
// Mismo motivo que la suite de vendedores: aqui se escribe via el store, y con
// pool real el POST de administracion le pegaria a Neon. El pool de lib/db.js
// nace durante el import dinamico de abajo, despues de esta linea.
delete process.env.DATABASE_URL;

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const store = await import('../lib/config-store.js');
const { app } = await import('../server.js');

const ADMIN_TOKEN = jwt.sign({ id: 1, name: 'Jefa Test', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

const CONFIG_ARCHIVO = {
  tiposActivos: ['PL'], texturasActivas: [1],
  eventoActivo: { nombre: 'Expo del archivo', fin: '2026-08-28' },
  catalogoUrl: 'https://ejemplo.mx/catalogo', sitioUrl: 'https://ejemplo.mx',
};

// Base falsa de una sola fila: interpreta el SQL por substring, como el mock de
// Operam interpreta las URLs. Cuenta las siembras para poder afirmar que la
// semilla corre UNA vez y que un proceso nuevo no la repite.
function baseFalsa({ fila = null, persisteSiembra = true } = {}) {
  const base = { fila, siembras: 0, caida: false };
  base.query = async (sql, params) => {
    if (base.caida) throw new Error('Neon no disponible');
    if (sql.includes('CREATE TABLE')) return { rows: [] };
    if (sql.includes('DO NOTHING')) {
      base.siembras++;
      if (persisteSiembra && base.fila === null) base.fila = JSON.parse(params[0]);
      return { rows: [] };
    }
    if (sql.includes('DO UPDATE')) {
      base.fila = JSON.parse(params[0]);
      return { rows: [] };
    }
    if (sql.includes('SELECT')) return { rows: base.fila === null ? [] : [{ data: base.fila }] };
    throw new Error('SQL no esperado: ' + sql);
  };
  return base;
}

// El archivo esta versionado: se restaura el TEXTO original para no dejarlo
// reformateado en el repo.
let original;
before(() => { original = leerArchivoSync(CONFIG_PATH); });
after(() => {
  escribirArchivoSync(CONFIG_PATH, original);
  store._reiniciar();
});

beforeEach(() => {
  escribirArchivoSync(CONFIG_PATH, JSON.stringify(CONFIG_ARCHIVO, null, 2));
  store._reiniciar();
});

test('sin base: leer() devuelve lo que dice el archivo', () => {
  assert.deepEqual(store.leer(), CONFIG_ARCHIVO);
});

test('sin base: guardar() escribe el archivo y la lectura siguiente lo refleja', async () => {
  await store.guardar({ ...CONFIG_ARCHIVO, sitioUrl: 'https://otro.mx' });
  assert.equal(store.leer().sitioUrl, 'https://otro.mx');
  assert.equal(JSON.parse(leerArchivoSync(CONFIG_PATH)).sitioUrl, 'https://otro.mx');
});

test('tabla vacia: se siembra desde el archivo y las lecturas siguientes salen de la base', async () => {
  const base = baseFalsa();
  store._reiniciar(base.query);
  await store.cargar();
  assert.equal(base.siembras, 1);
  assert.deepEqual(base.fila, CONFIG_ARCHIVO);
  // La lectura ya no depende del archivo: cambiarlo no mueve nada.
  escribirArchivoSync(CONFIG_PATH, JSON.stringify({ tiposActivos: ['ZZ'] }, null, 2));
  assert.deepEqual(store.leer(), CONFIG_ARCHIVO);
});

test('tabla con datos: el archivo se ignora y no se re-siembra', async () => {
  const guardado = { tiposActivos: ['VT'], texturasActivas: [7], sitioUrl: 'https://guardado.mx' };
  const base = baseFalsa({ fila: guardado });
  store._reiniciar(base.query);
  await store.cargar();
  assert.equal(base.siembras, 1, 'la siembra se intenta, pero el ON CONFLICT no pisa');
  assert.deepEqual(base.fila, guardado);
  assert.deepEqual(store.leer(), guardado);
});

test('redeploy: lo guardado sobrevive a un proceso nuevo contra la misma base', async () => {
  const base = baseFalsa();
  store._reiniciar(base.query);
  await store.cargar();
  await store.guardar({ ...CONFIG_ARCHIVO, eventoActivo: { nombre: 'Expo nueva', fin: '2026-09-30' } });
  // El archivo versionado NO se toca cuando manda la base.
  assert.deepEqual(JSON.parse(leerArchivoSync(CONFIG_PATH)), CONFIG_ARCHIVO);

  // El arranque nuevo vuelve a intentar la semilla; el ON CONFLICT no la deja
  // pisar lo guardado. Esa es exactamente la reversion que hoy hace el deploy.
  store._reiniciar(base.query); // proceso nuevo: cache fria, misma base
  await store.cargar();
  assert.deepEqual(store.leer().eventoActivo, { nombre: 'Expo nueva', fin: '2026-09-30' });
});

test('guardar() con base refresca la cache: la lectura sincrona siguiente ya trae lo nuevo', async () => {
  const base = baseFalsa();
  store._reiniciar(base.query);
  await store.cargar();
  await store.guardar({ ...CONFIG_ARCHIVO, catalogoUrl: 'https://nuevo.mx/catalogo' });
  assert.equal(store.leer().catalogoUrl, 'https://nuevo.mx/catalogo');
});

test('tabla vacia que no acepta la semilla: cae al archivo, nunca deja al sistema sin configuracion', async () => {
  const base = baseFalsa({ persisteSiembra: false });
  store._reiniciar(base.query);
  await store.cargar();
  assert.deepEqual(store.leer(), CONFIG_ARCHIVO);
});

test('la API de administracion lee de la base, no del archivo', async () => {
  const guardado = { tiposActivos: ['VT'], texturasActivas: [7], sitioUrl: 'https://guardado.mx' };
  const base = baseFalsa({ fila: guardado });
  store._reiniciar(base.query);
  await store.cargar();

  const leer = await supertest(app).get('/api/admin/config').set('Authorization', `Bearer ${ADMIN_TOKEN}`);
  assert.equal(leer.status, 200);
  assert.deepEqual(leer.body.config.tiposActivos, ['VT']);
  assert.equal(leer.body.config.sitioUrl, 'https://guardado.mx');
});

test('la API de administracion guarda en la base conservando el merge, sin tocar el archivo', async () => {
  const base = baseFalsa({ fila: { tiposActivos: ['PL'], texturasActivas: [1], sitioUrl: 'https://guardado.mx' } });
  store._reiniciar(base.query);
  await store.cargar();

  const res = await supertest(app).post('/api/admin/config')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
    .send({ tiposActivos: ['VT'], texturasActivas: [7] });
  assert.equal(res.status, 200);
  assert.deepEqual(base.fila.tiposActivos, ['VT']);
  assert.equal(base.fila.sitioUrl, 'https://guardado.mx', 'lo que el panel no manda se conserva');
  assert.deepEqual(JSON.parse(leerArchivoSync(CONFIG_PATH)), CONFIG_ARCHIVO);
});

test('con la cache fria el merge parte de la base, no del archivo semilla', async () => {
  const base = baseFalsa({ fila: { tiposActivos: ['PL'], texturasActivas: [1], sitioUrl: 'https://guardado.mx' } });
  store._reiniciar(base.query); // cache fria: el warm de arranque fallo o va en vuelo

  const res = await supertest(app).post('/api/admin/config')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
    .send({ tiposActivos: ['VT'], texturasActivas: [7] });
  assert.equal(res.status, 200);
  assert.equal(base.fila.sitioUrl, 'https://guardado.mx', 'lo guardado en la base manda sobre la semilla');
  assert.equal(base.fila.eventoActivo, undefined, 'el evento del archivo no se cuela a la base');
});

test('el evento activo y las ligas llegan a /api/catalogos desde la base', async () => {
  const enBase = {
    tiposActivos: ['VT'], texturasActivas: [7],
    eventoActivo: { nombre: 'Expo de la base', fin: '2026-09-30' },
    catalogoUrl: 'https://base.mx/catalogo', sitioUrl: 'https://base.mx',
  };
  const base = baseFalsa({ fila: enBase });
  store._reiniciar(base.query);
  await store.cargar();

  const res = await supertest(app).get('/api/catalogos').set('Authorization', `Bearer ${ADMIN_TOKEN}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.eventoActivo.nombre, 'Expo de la base');
  assert.equal(res.body.catalogoUrl, 'https://base.mx/catalogo');
  assert.equal(res.body.sitioUrl, 'https://base.mx');
});

test('los tipos y texturas activos llegan a /api/precios desde la base', async () => {
  const base = baseFalsa({ fila: { tiposActivos: ['VT'], texturasActivas: [7] } });
  store._reiniciar(base.query);
  await store.cargar();

  const res = await supertest(app).get('/api/precios').set('Authorization', `Bearer ${ADMIN_TOKEN}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.config.tiposActivos, ['VT']);
  assert.deepEqual(res.body.config.texturasActivas, [7]);
});

// El handler es async desde #276 y Express 4 no atrapa promesas rechazadas: la
// lectura tiene que estar dentro del mismo try que el guardado.
test('la API responde 500 si la configuracion no se puede leer, en vez de tumbar el proceso', async () => {
  escribirArchivoSync(CONFIG_PATH, '{ esto no es json');
  const res = await supertest(app).post('/api/admin/config')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
    .send({ tiposActivos: ['VT'], texturasActivas: [7] });
  assert.equal(res.status, 500);
});

test('la API responde 500 si la base falla al guardar, en vez de tumbar el proceso', async () => {
  const base = baseFalsa();
  store._reiniciar(base.query);
  await store.cargar();
  base.caida = true;

  const res = await supertest(app).post('/api/admin/config')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
    .send({ tiposActivos: ['VT'], texturasActivas: [7] });
  assert.equal(res.status, 500);
});
