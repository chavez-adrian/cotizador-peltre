import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');
const { resetSession } = await import('../lib/operam-client.js');

const TOKEN = jwt.sign({ id: 1, name: 'Test', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
const req = supertest(app);

const LOGIN_RESPONSE = { token: 'fake-bearer-token', result: true };

function mockFetchByUrl(urlHandlers) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    for (const [pattern, handler] of Object.entries(urlHandlers)) {
      if (urlStr.includes(pattern)) return handler(url, opts);
    }
    throw new Error('Unmocked fetch: ' + urlStr);
  };
  return () => { globalThis.fetch = original; };
}

function jsonResponse(data, status = 200) {
  return { ok: status < 400, status, json: async () => data };
}

test('PATCH /api/operam/clientes/:id: actualiza cliente en Operam con campos del diff', async () => {
  resetSession();
  let putBody = null;
  let putUrl = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers/42': (url, opts) => {
      putUrl = url;
      putBody = JSON.parse(opts.body);
      return jsonResponse({ result: true, customer_id: 42 });
    },
  });
  try {
    const diff = {
      'cl-municipio': { anterior: 'GUADALAJARA', nuevo: 'ZAPOPAN' },
      'cl-cp-fiscal': { anterior: '44100', nuevo: '45100' },
    };
    const res = await req
      .patch('/api/operam/clientes/42')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ diff });

    assert.equal(res.status, 200, 'debe responder 200');
    assert.ok(res.body.ok, 'body debe tener ok: true');
    assert.ok(putUrl !== null, 'debe haber llamado a Operam');
    assert.equal(putBody['cl-municipio'], 'ZAPOPAN', 'envia nuevo valor de municipio');
    assert.equal(putBody['cl-cp-fiscal'], '45100', 'envia nuevo valor de cp');
  } finally {
    restore();
  }
});

test('PATCH /api/operam/clientes/:id: sin auth token retorna 401', async () => {
  const res = await req
    .patch('/api/operam/clientes/42')
    .send({ diff: {} });

  assert.equal(res.status, 401);
});

test('PATCH /api/operam/clientes/:id: Operam devuelve error, responde con 503 y mensaje', async () => {
  resetSession();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers/99': () => jsonResponse({ result: false, messages: ['No encontrado'] }),
  });
  try {
    const diff = { 'cl-municipio': { anterior: 'A', nuevo: 'B' } };
    const res = await req
      .patch('/api/operam/clientes/99')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ diff });

    assert.equal(res.status, 503, 'debe responder 503');
    assert.ok(res.body.error, 'debe tener campo error');
  } finally {
    restore();
  }
});

test('PATCH /api/operam/clientes/:id: diff vacio igual llama a Operam (validacion en frontend)', async () => {
  resetSession();
  let putCalled = false;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers/42': () => {
      putCalled = true;
      return jsonResponse({ result: true });
    },
  });
  try {
    const res = await req
      .patch('/api/operam/clientes/42')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ diff: {} });

    assert.equal(res.status, 200, 'debe responder 200 con diff vacio');
    assert.ok(putCalled, 'debe llamar a Operam aunque diff sea vacio');
  } finally {
    restore();
  }
});
