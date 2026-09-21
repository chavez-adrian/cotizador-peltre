import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buscarClientes, resetSession, _setBackoffRedBase } from '../lib/operam-client.js';
import { fetchSinRedEnPruebas, ErrorRedEnPruebas } from '../lib/red-en-pruebas.js';

const fetchOriginal = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  resetSession();
});

test('#410: sin mock, el cliente de Operam rechaza al instante en vez de salir a la red', async () => {
  const t0 = Date.now();
  await assert.rejects(
    () => buscarClientes('cualquiera'),
    err => err instanceof ErrorRedEnPruebas && /mock/i.test(err.message) && /login/.test(err.message),
  );
  assert.ok(Date.now() - t0 < 1000, 'no debe esperar reintentos de red');
});

test('#410: con token vigente la lectura tampoco sale a la red ni entra al backoff de errores de red', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ token: 'T' }) });
  await buscarClientes('calienta el token').catch(() => {});
  globalThis.fetch = fetchOriginal;

  const t0 = Date.now();
  await assert.rejects(
    () => buscarClientes('cualquiera'),
    err => err instanceof ErrorRedEnPruebas && /customers/.test(err.message),
  );
  assert.ok(Date.now() - t0 < 1000, 'el backoff de red (1+2+4+8 s) no debe correr');
});

test('#410: con fetch mockeado la llamada pasa al mock', async () => {
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    if (String(url).includes('/login')) return { ok: true, status: 200, json: async () => ({ token: 'T' }) };
    return { ok: true, status: 200, json: async () => ({ data: [] }), text: async () => '{"data":[]}' };
  };
  await buscarClientes('algo');
  assert.ok(urls.some(u => u.includes('/login')));
  assert.ok(urls.some(u => u.includes('customers')));
});

test('#410: fuera de node:test el fetch nativo pasa intacto', async () => {
  let llamado = null;
  const nativo = async url => { llamado = url; return 'respuesta'; };
  const r = await fetchSinRedEnPruebas('http://x/y', {}, { enPruebas: false, fetchNativo: nativo, fetchActual: nativo });
  assert.equal(r, 'respuesta');
  assert.equal(llamado, 'http://x/y');
});

test('#410: bajo node:test el backoff de errores de red no duerme, pero SI reintenta', async () => {
  let lecturas = 0;
  globalThis.fetch = async url => {
    if (String(url).includes('/login')) return { ok: true, status: 200, json: async () => ({ token: 'T' }) };
    lecturas++;
    if (lecturas < 3) throw new Error('ECONNRESET');
    return { ok: true, status: 200, json: async () => ({ data: [] }), text: async () => '{"data":[]}' };
  };
  const t0 = Date.now();
  await buscarClientes('algo');
  assert.equal(lecturas, 3);
  assert.ok(Date.now() - t0 < 500, 'dos reintentos con la base real serian 3 s');
});

test('#410: Operam caido agota los 4 reintentos y propaga, sin dormir 15 s', async () => {
  let lecturas = 0;
  globalThis.fetch = async url => {
    if (String(url).includes('/login')) return { ok: true, status: 200, json: async () => ({ token: 'T' }) };
    lecturas++;
    throw new Error('ECONNRESET');
  };
  const t0 = Date.now();
  await assert.rejects(() => buscarClientes('algo'), /ECONNRESET/);
  assert.equal(lecturas, 5);
  assert.ok(Date.now() - t0 < 500);
});

test('#410: la base del backoff de red es ajustable, como la del 429', async () => {
  _setBackoffRedBase(60);
  try {
    let lecturas = 0;
    globalThis.fetch = async url => {
      if (String(url).includes('/login')) return { ok: true, status: 200, json: async () => ({ token: 'T' }) };
      lecturas++;
      if (lecturas < 2) throw new Error('ECONNRESET');
      return { ok: true, status: 200, json: async () => ({ data: [] }), text: async () => '{"data":[]}' };
    };
    const t0 = Date.now();
    await buscarClientes('algo');
    assert.ok(Date.now() - t0 >= 55, 'con base 60 el primer reintento espera 60 ms');
  } finally {
    _setBackoffRedBase(0);
  }
});
