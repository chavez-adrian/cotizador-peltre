// #356 (hijo de #354): la columna clientes_log.dropbox_ok existe desde el
// principio y se escribia SIEMPRE en null a proposito -- cuando el log se
// inserta, la subida de la constancia todavia no resolvio. Para poder corregir
// la fila despues, el helper de auditoria tiene que devolver el identificador de
// lo que inserto, y ese es el contrato que se mide aqui.
//
// La tabla solo existe en Neon (no hay fallback a JSON, a diferencia de los
// stores): el seam es la funcion `query` que estas pruebas inyectan, igual que
// lib/alta-cliente.js recibe sus dependencias.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { logCliente, marcarDropbox } = await import('../lib/clientes-log.js');

function queryEspia(respuesta) {
  const llamadas = [];
  return {
    llamadas,
    query: async (sql, params) => {
      llamadas.push({ sql, params });
      return typeof respuesta === 'function' ? respuesta(sql, params) : respuesta;
    },
  };
}

test('logCliente devuelve el id de la fila que inserto', async () => {
  const espia = queryEspia({ rows: [{ id: 42 }] });
  const id = await logCliente('OGA140604560', 'Operadora', 'creado', 89, 'alta-completa', null, null, { query: espia.query });
  assert.equal(id, 42);
  assert.match(espia.llamadas[0].sql, /INSERT INTO clientes_log/);
  assert.match(espia.llamadas[0].sql, /RETURNING id/);
});

test('logCliente devuelve null sin base de datos, sin lanzar', async () => {
  const espia = queryEspia(null);
  assert.equal(await logCliente('RFC', null, 'creado', 1, 'x', null, null, { query: espia.query }), null);
});

test('logCliente no propaga un fallo de la base: resuelve a null', async () => {
  const espia = queryEspia(() => { throw new Error('Neon caido'); });
  assert.equal(await logCliente('RFC', null, 'creado', 1, 'x', null, null, { query: espia.query }), null);
});

test('marcarDropbox deja dropbox_ok en true tras una subida exitosa', async () => {
  const espia = queryEspia({ rows: [] });
  assert.equal(await marcarDropbox(42, true, { query: espia.query }), true);
  assert.match(espia.llamadas[0].sql, /UPDATE clientes_log/);
  assert.match(espia.llamadas[0].sql, /dropbox_ok/);
  assert.deepEqual(espia.llamadas[0].params, [true, 42]);
});

test('marcarDropbox deja dropbox_ok en false tras una subida fallida', async () => {
  const espia = queryEspia({ rows: [] });
  await marcarDropbox(42, false, { query: espia.query });
  assert.deepEqual(espia.llamadas[0].params, [false, 42]);
});

test('marcarDropbox acepta la promesa del id que devolvio logCliente', async () => {
  const insercion = queryEspia({ rows: [{ id: 7 }] });
  const logId = logCliente('RFC', null, 'creado', 1, 'x', null, null, { query: insercion.query });
  const update = queryEspia({ rows: [] });
  await marcarDropbox(logId, true, { query: update.query });
  assert.deepEqual(update.llamadas[0].params, [true, 7]);
});

test('marcarDropbox sin id no toca la base: sin DATABASE_URL no hay fila que corregir', async () => {
  const espia = queryEspia({ rows: [] });
  assert.equal(await marcarDropbox(null, true, { query: espia.query }), false);
  assert.equal(espia.llamadas.length, 0);
});

test('marcarDropbox se traga un fallo de la base y no lo propaga', async () => {
  const espia = queryEspia(() => { throw new Error('Neon caido'); });
  assert.equal(await marcarDropbox(42, true, { query: espia.query }), false);
});
