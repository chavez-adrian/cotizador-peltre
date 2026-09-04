// #310: el bloque de modelos del maestro de articulos (36 filas x 32 columnas)
// se muda a una tabla propia en Neon con el patron de la casa: semilla desde el
// archivo versionado solo si la tabla esta vacia, fallback a data/modelos.json
// sin DATABASE_URL. La API de administracion es la costura mas alta que ejercita
// el store, asi que la suite vive ahi.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODELOS_PATH = join(__dirname, '..', 'data', 'modelos.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}
// Mismo motivo que las suites de vendedores y configuracion: aqui se ESCRIBE via
// el store, y con pool real el PUT le pegaria a Neon. El pool de lib/db.js nace
// durante el import dinamico de abajo, que corre despues de esta linea.
delete process.env.DATABASE_URL;

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const store = await import('../lib/modelos-store.js');
const { app } = await import('../server.js');

const TOKEN_ADMIN = jwt.sign({ id: 1, name: 'Jefa Test', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
const TOKEN_VENDEDOR = jwt.sign({ id: 2, name: 'Vendedor Test', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });

// El archivo esta versionado y el fallback lo ESCRIBE: se restaura el TEXTO
// original, no una re-serializacion, para no dejarlo reformateado en el repo.
let original;
before(() => { original = leerArchivoSync(MODELOS_PATH); });
after(() => {
  escribirArchivoSync(MODELOS_PATH, original);
  store._reiniciar();
});
beforeEach(() => { escribirArchivoSync(MODELOS_PATH, original); });

function getModelos() {
  return supertest(app).get('/api/admin/modelos').set('Authorization', `Bearer ${TOKEN_ADMIN}`);
}

function putModelo(modelo, campos, token = TOKEN_ADMIN) {
  return supertest(app).put(`/api/admin/modelos/${modelo}`)
    .set('Authorization', `Bearer ${token}`).send(campos);
}

test('GET /api/admin/modelos lista los 36 modelos con las correcciones de la semilla', async () => {
  const res = await getModelos();
  assert.equal(res.status, 200);
  assert.equal(res.body.modelos.length, 36);

  const por = m => res.body.modelos.find(x => x.modelo === m);
  // Las correcciones que ADR-0016 pidio que entraran CON la semilla.
  assert.equal(por('CL28').familia, 'comal', 'CL28 deja de estar en ingles (griddle)');
  assert.equal(por('BA30').familia, 'base', 'BA30 estrena familia');
  assert.equal(por('OL24').familia, 'olla', 'OL24 estrena familia');
  assert.equal(por('TP12').familia, 'budinera', 'la tapa se queda con la budinera, a proposito');
  assert.equal(por('TP24').familia, 'budinera');
  assert.notEqual(por('SA08').nombre_comercial, por('SC08').nombre_comercial,
    'la salsera recta y la conica dejan de compartir nombre comercial');

  // La fila entra COMPLETA: el panel solo edita dos columnas, pero sembrar a
  // medias dejaria el maestro parcial.
  assert.equal(Object.keys(por('VT05')).length, 32);
  assert.deepEqual(res.body.sinFamilia, []);
});

test('PUT /api/admin/modelos/:modelo corrige familia y nombre comercial, y el GET siguiente lo refleja', async () => {
  const put = await putModelo('SA08', { familia: 'salsera recta', nombre_comercial: 'Salsera recta 8 cm' });
  assert.equal(put.status, 200);
  assert.equal(put.body.familia, 'salsera recta');
  assert.equal(put.body.nombre_comercial, 'Salsera recta 8 cm');
  // La correccion es parcial: lo que el panel no manda no se pierde.
  assert.equal(put.body.sat_codigo, 52152007);

  const res = await getModelos();
  const sa08 = res.body.modelos.find(m => m.modelo === 'SA08');
  assert.equal(sa08.familia, 'salsera recta');
  assert.equal(sa08.nombre_comercial, 'Salsera recta 8 cm');
});

// ADR-0016: un modelo sin familia es un pendiente VISIBLE, nunca un silencio.
test('PUT con familia vacia deja el modelo en la lista de pendientes del GET', async () => {
  const put = await putModelo('CL28', { familia: '' });
  assert.equal(put.status, 200);
  assert.equal(put.body.familia, '');

  const res = await getModelos();
  assert.deepEqual(res.body.sinFamilia, ['CL28']);
  assert.equal(res.body.modelos.find(m => m.modelo === 'CL28').familia, '');
});

test('PUT con una columna fuera de la lista blanca responde 400 y no toca la fila', async () => {
  const res = await putModelo('VT05', { familia: 'copa', sat_codigo: 1 });
  assert.equal(res.status, 400);

  const lista = await getModelos();
  const vt05 = lista.body.modelos.find(m => m.modelo === 'VT05');
  assert.equal(vt05.familia, 'tequilero', 'el rechazo es total: ni la columna editable se guardo');
  assert.equal(vt05.sat_codigo, 52152102);
});

test('PUT de un modelo inexistente responde 404', async () => {
  const res = await putModelo('ZZ99', { familia: 'inventada' });
  assert.equal(res.status, 404);
});

// Solo el rol admin alcanza el maestro: el vendedor no lo lee ni lo corrige.
test('un vendedor sin rol admin recibe 403 en el GET y en el PUT', async () => {
  const get = await supertest(app).get('/api/admin/modelos').set('Authorization', `Bearer ${TOKEN_VENDEDOR}`);
  assert.equal(get.status, 403);

  const put = await putModelo('VT05', { familia: 'copa' }, TOKEN_VENDEDOR);
  assert.equal(put.status, 403);

  const lista = await getModelos();
  assert.equal(lista.body.modelos.find(m => m.modelo === 'VT05').familia, 'tequilero');
});

// --- La semilla, por la costura del store (mismo recurso que config-store.test.js) ---
//
// Base falsa de una tabla: interpreta el SQL por substring, como el mock de
// Operam interpreta las URLs. Cuenta las siembras para poder afirmar que la
// tabla vacia se puebla y que la que ya tiene datos no se pisa.
function baseFalsa({ filas = null } = {}) {
  const base = { filas, siembras: 0 };
  base.query = async (sql, params) => {
    if (sql.includes('CREATE TABLE')) return { rows: [] };
    if (sql.includes('COUNT(*)')) return { rows: [{ n: base.filas === null ? 0 : base.filas.length }] };
    if (sql.includes('DO NOTHING')) {
      base.siembras++;
      if (base.filas === null) base.filas = JSON.parse(params[0]);
      return { rows: [] };
    }
    if (sql.startsWith('UPDATE')) {
      const fila = (base.filas || []).find(m => m.modelo === params[0]);
      if (!fila) return { rows: [] };
      for (const [, columna, pos] of sql.matchAll(/(\w+) = \$(\d+)/g)) fila[columna] = params[pos - 1];
      return { rows: [fila] };
    }
    if (sql.includes('SELECT *')) return { rows: base.filas === null ? [] : base.filas };
    throw new Error('SQL no esperado: ' + sql);
  };
  return base;
}

test('tabla vacia: se siembra el bloque completo desde el archivo versionado', async () => {
  const base = baseFalsa();
  store._reiniciar(base.query);

  const modelos = await store.listar();
  assert.equal(base.siembras, 1);
  assert.equal(modelos.length, 36);
  assert.equal(modelos.find(m => m.modelo === 'CL28').familia, 'comal');
});

test('tabla con datos: la semilla no pisa lo guardado y el archivo se ignora', async () => {
  const base = baseFalsa({ filas: [{ modelo: 'CL28', familia: 'plancha', nombre: 'Comal 28' }] });
  store._reiniciar(base.query);

  const modelos = await store.listar();
  assert.equal(base.siembras, 0, 'con datos ni se intenta la siembra');
  assert.deepEqual(modelos.map(m => m.modelo), ['CL28']);
  assert.equal(modelos[0].familia, 'plancha');
});

test('redeploy: la correccion hecha en el panel sobrevive a un proceso nuevo contra la misma base', async () => {
  const base = baseFalsa();
  store._reiniciar(base.query);
  await store.cargar();

  const put = await putModelo('OL24', { familia: 'olla de presion' });
  assert.equal(put.status, 200);
  // Lo guardado vive en la base: el archivo versionado no se toca.
  assert.equal(JSON.parse(leerArchivoSync(MODELOS_PATH)).find(m => m.modelo === 'OL24').familia, 'olla');

  store._reiniciar(base.query); // proceso nuevo: schema por asegurar, misma base
  const res = await getModelos();
  assert.equal(res.body.modelos.find(m => m.modelo === 'OL24').familia, 'olla de presion');
  assert.equal(base.siembras, 1, 'el arranque nuevo no re-siembra sobre lo corregido');
});
