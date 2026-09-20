// #356 (hijo de #354): los fallos de subida a Dropbox eran invisibles -- el
// resultado de la promesa se descartaba con un catch que solo hacia
// console.error. Aqui se prueba el ENVOLTORIO COMUN (lib/dropbox.js#upload),
// que es el unico punto por el que pasan los tres flujos del repo, con el fetch
// mockeado: exito, fallo, y que un fallo del propio registro no propague.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync, borrarArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, '..', 'data', 'dropbox-subidas.json');

const { upload } = await import('../lib/dropbox.js');
const store = await import('../lib/dropbox-subidas-store.js');

// Desde #357 el destino lo arma el flujo, no el llamador: `upload` recibe
// `{flujo, archivo}` con la ruta RELATIVA y el registro guarda la ruta que
// realmente se pidio. Por eso aqui se afirma el FINAL del destino y no la
// cadena completa -- la base la decide lib/dropbox-destinos.js, y en el flujo
// bitrix depende ademas de BITRIX_EXPORT_DROPBOX_PATH.

const envPrevio = {
  DROPBOX_REFRESH_TOKEN: process.env.DROPBOX_REFRESH_TOKEN,
  DROPBOX_APP_KEY: process.env.DROPBOX_APP_KEY,
  DROPBOX_APP_SECRET: process.env.DROPBOX_APP_SECRET,
};
const originalFetch = globalThis.fetch;

let respaldo = null;
let existia = false;

before(() => {
  existia = existsSync(JSON_PATH);
  if (existia) respaldo = leerArchivoSync(JSON_PATH);
  process.env.DROPBOX_REFRESH_TOKEN = 'refresh';
  process.env.DROPBOX_APP_KEY = 'key';
  process.env.DROPBOX_APP_SECRET = 'secret';
});

after(() => {
  globalThis.fetch = originalFetch;
  for (const [k, v] of Object.entries(envPrevio)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  if (existia) escribirArchivoSync(JSON_PATH, respaldo);
  else if (existsSync(JSON_PATH)) borrarArchivoSync(JSON_PATH);
});

beforeEach(() => {
  escribirArchivoSync(JSON_PATH, '[]');
});

// expires_in 0 a proposito: lib/dropbox.js cachea el token en una variable de
// modulo que este test no puede restaurar, y un token vivo haria que el
// siguiente consumidor de Dropbox se saltara su propio mock del refresh
// (mismo cuidado que test/server.test.js #350).
function mockDropbox(respuestaUpload) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2/token')) return { ok: true, json: async () => ({ access_token: 'dbx', expires_in: 0 }) };
    if (u.includes('files/upload')) return respuestaUpload();
    throw new Error('Unmocked fetch: ' + u);
  };
  return () => { globalThis.fetch = originalFetch; };
}

const OK = () => ({ ok: true, json: async () => ({ path_display: '/CRM/BACKUP/leads.json' }) });
const CONFLICTO = () => ({ ok: false, status: 409, text: async () => 'path/conflict/file' });

test('una subida exitosa deja un registro de exito con su flujo y su destino', async () => {
  const restore = mockDropbox(OK);
  try {
    await upload({ flujo: 'bitrix', archivo: '2026-09-13/leads.json' }, '{}', 'overwrite');
  } finally {
    restore();
  }
  const [fila] = await store.listarRecientes();
  assert.equal(fila.flujo, 'bitrix');
  assert.ok(fila.destino.endsWith('/2026-09-13/leads.json'), 'destino: ' + fila.destino);
  assert.ok(fila.destino.startsWith('/'), 'el destino es una ruta absoluta: ' + fila.destino);
  assert.equal(fila.archivo, 'leads.json');
  assert.equal(fila.ok, true);
  assert.equal(fila.error, null);
});

test('una subida fallida deja el mensaje de error y sigue lanzando como antes', async () => {
  const restore = mockDropbox(CONFLICTO);
  try {
    await assert.rejects(
      () => upload({ flujo: 'csf', archivo: 'ABC010101AB1 - Cliente.pdf' }, Buffer.from('x'), 'add'),
      /Dropbox 409/
    );
  } finally {
    restore();
  }
  const [fila] = await store.listarRecientes();
  assert.equal(fila.flujo, 'csf');
  assert.equal(fila.archivo, 'ABC010101AB1 - Cliente.pdf');
  assert.equal(fila.ok, false);
  assert.match(fila.error, /Dropbox 409: path\/conflict\/file/);
});

test('el fallo del token tambien es una subida fallida, no un hueco en el registro', async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes('oauth2/token')) return { ok: false, status: 401, text: async () => 'invalid_grant' };
    throw new Error('Unmocked fetch: ' + url);
  };
  try {
    await assert.rejects(() => upload({ flujo: 'csf', archivo: 'sin-token.pdf' }, 'x', 'add'), /token refresh 401/);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const [fila] = await store.listarRecientes();
  assert.equal(fila.ok, false);
  assert.equal(fila.archivo, 'sin-token.pdf');
});

// === Flujo bitrix: el backup del export (scripts/export-bitrix.mjs) ===
// No pasa por Express: el unico seam es la subida del paquete, que el script
// expone para poder medirla sin hablar con Bitrix.
async function conExportEnDisco(fn) {
  const { subirExportDropbox } = await import('../scripts/export-bitrix.mjs');
  const dir = join(__dirname, '..', 'data', 'export-bitrix', 'test-356');
  mkdirSync(dir, { recursive: true });
  const resumen = join(dir, 'resumen.json');
  escribirArchivoSync(resumen, '{"leads":1}');
  try {
    await fn(() => subirExportDropbox(dir, 'test-356'));
  } finally {
    borrarArchivoSync(resumen);
    rmSync(dir, { recursive: true, force: true });
  }
}

test('el backup del export de Bitrix registra su subida con flujo bitrix', async () => {
  await conExportEnDisco(async subir => {
    const restore = mockDropbox(OK);
    try {
      await subir();
    } finally {
      restore();
    }
    const [fila] = await store.listarRecientes();
    assert.equal(fila.flujo, 'bitrix');
    assert.equal(fila.ok, true);
    assert.equal(fila.archivo, 'resumen.json');
    assert.ok(fila.destino.includes('test-356'), 'el destino pretendido queda registrado: ' + fila.destino);
  });
});

test('un backup de Bitrix que falla queda registrado con su error', async () => {
  await conExportEnDisco(async subir => {
    const restore = mockDropbox(CONFLICTO);
    try {
      // El script si aborta ante un fallo de subida (no es fire-and-forget): lo
      // que #356 agrega es que ademas quede el rastro de que se intento y donde.
      await assert.rejects(subir, /Dropbox 409/);
    } finally {
      restore();
    }
    const [fila] = await store.listarRecientes();
    assert.equal(fila.flujo, 'bitrix');
    assert.equal(fila.ok, false);
    assert.match(fila.error, /Dropbox 409: path\/conflict\/file/);
  });
});

test('un fallo del propio registro no altera lo que devuelve upload', async () => {
  escribirArchivoSync(JSON_PATH, '{esto no es JSON');
  const restore = mockDropbox(OK);
  try {
    const data = await upload({ flujo: 'bitrix', archivo: '2026-09-13/deals.json' }, '{}', 'overwrite');
    assert.equal(data.path_display, '/CRM/BACKUP/leads.json');
  } finally {
    restore();
  }
});

// La union de #356 y #357: el flujo dejo de ser una etiqueta suelta del
// registro y es la llave que decide el destino, asi que uno que no exista no
// puede caer en 'desconocido' -- no hay ruta que armar. Revienta antes de pedir
// token, sin emitir peticion y sin dejar fila: es un error de programacion, no
// una subida fallida.
test('un flujo inexistente revienta sin subir y sin registrar', async () => {
  let peticiones = 0;
  globalThis.fetch = async () => { peticiones++; throw new Error('no deberia llamarse'); };
  try {
    await assert.rejects(
      () => upload({ flujo: 'inventado', archivo: 'x.json' }, '{}', 'overwrite'),
      /Flujo de Dropbox desconocido: inventado/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(peticiones, 0);
  assert.deepEqual(await store.listarRecientes(), []);
});
