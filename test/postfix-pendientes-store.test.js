import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { fotoDatos } from './helpers/datos-aislados.js';
import { borrarArchivoSync } from '../lib/fs-reintento.js';

// Cola PERSISTIDA de post-fixes sin verificar (#380). En produccion vive en Neon (un
// deploy de Render perderia una cola en memoria); aqui se prueba el fallback JSON, el
// de dev y tests (sin DATABASE_URL).

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, '..', 'data', 'postfix-pendientes.json');

const store = await import('../lib/postfix-pendientes-store.js');

let restaurar;
before(() => { restaurar = fotoDatos([JSON_PATH]); });
after(() => restaurar());
beforeEach(() => { if (existsSync(JSON_PATH)) borrarArchivoSync(JSON_PATH); });

const PENDIENTE = {
  folio: '1263', cotizacionId: 41, vendedor: 'Alejandro Chavez', origen: 'post-fix',
  vigencia: '2026-10-04', lista: '9', transportista: null, fechaDocumento: '2026-09-02',
  estado: 'pendiente', intentos: 0, proximoIntento: '2026-09-25T18:01:00.000Z',
  motivo: 'vigencia: se esperaba 2026-10-04 y se leyo 2026-09-05',
};

test('sin archivo la cola esta vacia', async () => {
  assert.deepEqual(await store.listar(), []);
});

test('encolar deja el pendiente en la cola y se lee igual', async () => {
  assert.equal(await store.encolar(PENDIENTE), true);
  const [fila] = await store.listar();
  assert.equal(fila.folio, '1263');
  assert.equal(fila.vigencia, '2026-10-04');
  assert.equal(fila.proximoIntento, '2026-09-25T18:01:00.000Z');
  assert.equal(fila.intentos, 0);
});

test('encolar un folio que ya esta NO reinicia sus intentos', async () => {
  await store.encolar(PENDIENTE);
  await store.guardar({ ...PENDIENTE, intentos: 2, proximoIntento: '2026-09-25T19:00:00.000Z' });
  assert.equal(await store.encolar({ ...PENDIENTE, intentos: 0 }), false);
  const [fila] = await store.listar();
  assert.equal(fila.intentos, 2);
  assert.equal(fila.proximoIntento, '2026-09-25T19:00:00.000Z');
});

test('guardar actualiza el estado y borrar lo saca de la cola', async () => {
  await store.encolar(PENDIENTE);
  await store.encolar({ ...PENDIENTE, folio: '1270' });
  await store.guardar({ ...PENDIENTE, estado: 'avisado', proximoIntento: null });
  const avisado = (await store.listar()).find(f => f.folio === '1263');
  assert.equal(avisado.estado, 'avisado');
  assert.equal(avisado.proximoIntento, null);
  await store.borrar('1263');
  assert.deepEqual((await store.listar()).map(f => f.folio), ['1270']);
});
