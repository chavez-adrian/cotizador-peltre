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

// El diff que manda el panel "Confirmar y actualizar en Operam" viene de
// calcularDiffFiscal, con llaves de LECTURA (CustName). El PUT de Operam las ignora en
// silencio (#169): el endpoint debe traducirlas a llaves de escritura antes de mandar.
// Sin tax_id en el diff: el gate anti-fusion de #207 no aplica aqui, se prueba aparte.
test('PATCH /api/operam/clientes/:id: traduce CustName del diff a cust_name en el PUT (#169)', async () => {
  resetSession();
  let putBody = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers/42': (url, opts) => {
      putBody = JSON.parse(opts.body);
      return jsonResponse({ version: '3.26.32', cust_name: 'Peltre Nacional SA de CV' });
    },
  });
  try {
    const diff = {
      CustName: { anterior: 'PROSPECTO', nuevo: 'Peltre Nacional SA de CV', label: 'Razon Social' },
      'cl-cp-fiscal': { anterior: '44100', nuevo: '45100' },
    };
    const res = await req
      .patch('/api/operam/clientes/42')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ diff });

    assert.equal(res.status, 200);
    assert.equal(putBody.cust_name, 'Peltre Nacional SA de CV');
    assert.ok(!('CustName' in putBody), 'CustName en el PUT no persiste el nombre');
    assert.equal(putBody['cl-cp-fiscal'], '45100', 'los campos sin llave alterna viajan igual');
  } finally {
    restore();
  }
});

// === Gate anti-fusion por RFC (issue #207) ===
//
// Hasta #207 este PATCH escribia tax_id sin objecion (el test de arriba lo probaba con
// un RFC arbitrario, ver auditoria de #205): ahora, cuando el diff toca tax_id, el
// verificador compartido de "RFC libre" (lib/operam-client.js, extraido del gate del
// upgrade fiscal #85) corre ANTES de tocar Operam.

test('PATCH /api/operam/clientes/:id: tax_id de OTRO cliente -> 409 con la identidad del dueno, CERO escrituras a Operam', async () => {
  resetSession();
  let putCalled = false;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    'tax_id=': () => jsonResponse({
      total: 1,
      data: [{ customer_id: 99, CustName: 'Otro Cliente SA de CV', tax_id: 'PNA010203ABC', branches: [] }],
    }),
    '/api/v3/sales/customers/42': () => {
      putCalled = true;
      return jsonResponse({ result: true });
    },
  });
  try {
    const diff = { tax_id: { anterior: '', nuevo: 'PNA010203ABC', label: 'RFC' } };
    const res = await req
      .patch('/api/operam/clientes/42')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ diff });

    assert.equal(res.status, 409, 'debe frenar con 409');
    assert.equal(res.body.fusion, true);
    assert.equal(res.body.cliente.cliente_id, 99, 'identifica al dueno del RFC');
    assert.equal(res.body.cliente.CustName, 'Otro Cliente SA de CV');
    assert.match(res.body.error, /99/, 'el mensaje incluye la identidad del dueno');
    assert.equal(putCalled, false, 'CERO escrituras al ERP cuando el gate frena');
  } finally {
    restore();
  }
});

test('PATCH /api/operam/clientes/:id: tax_id del MISMO cliente (minusculas y espacios) -> pasa', async () => {
  resetSession();
  let putBody = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    'tax_id=': () => jsonResponse({
      total: 1,
      data: [{ customer_id: 42, CustName: 'Cliente Propio SA de CV', tax_id: 'PNA010203ABC', branches: [] }],
    }),
    '/api/v3/sales/customers/42': (url, opts) => {
      putBody = JSON.parse(opts.body);
      return jsonResponse({ result: true, tax_id: 'PNA010203ABC' });
    },
  });
  try {
    const diff = { tax_id: { anterior: 'PNA010203ABC', nuevo: ' pna010203abc ', label: 'RFC' } };
    const res = await req
      .patch('/api/operam/clientes/42')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ diff });

    assert.equal(res.status, 200, 'no debe frenar el RFC del propio cliente');
    assert.ok(putBody, 'debe llamar a Operam');
    assert.equal(putBody.tax_id, ' pna010203abc ', 'el valor capturado viaja tal cual al PUT');
  } finally {
    restore();
  }
});

test('PATCH /api/operam/clientes/:id: tax_id generico -> exento del gate, ni siquiera consulta el pool', async () => {
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
    const diff = { tax_id: { anterior: '', nuevo: 'XAXX010101000', label: 'RFC' } };
    const res = await req
      .patch('/api/operam/clientes/42')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ diff });

    assert.equal(res.status, 200);
    assert.equal(putCalled, true, 'el generico no pasa por el pool de tax_id (sin mock, tronaria si lo consultara)');
  } finally {
    restore();
  }
});

test('PATCH /api/operam/clientes/:id: Operam no disponible en el gate -> 503, CERO escrituras', async () => {
  resetSession();
  let putCalled = false;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    'tax_id=': () => jsonResponse({ error: 'boom' }, 500),
    '/api/v3/sales/customers/42': () => {
      putCalled = true;
      return jsonResponse({ result: true });
    },
  });
  try {
    const diff = { tax_id: { anterior: '', nuevo: 'PNA010203ABC', label: 'RFC' } };
    const res = await req
      .patch('/api/operam/clientes/42')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ diff });

    assert.equal(res.status, 503);
    assert.equal(putCalled, false);
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
