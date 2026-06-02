import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const { actualizarCliente, buscarClientePorRFC, resetSession } = await import('../lib/operam-client.js');

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

test('actualizarCliente: hace PUT a /api/v3/sales/customers/:id con los campos del diff', async () => {
  resetSession();
  let putUrl = null;
  let putBody = null;
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
    await actualizarCliente(42, diff);
    assert.ok(putUrl !== null, 'debe llamar a fetch');
    assert.ok(putUrl.includes('/api/v3/sales/customers/42'), 'URL debe incluir el ID');
    assert.equal(putBody['cl-municipio'], 'ZAPOPAN', 'body debe tener el nuevo valor de municipio');
    assert.equal(putBody['cl-cp-fiscal'], '45100', 'body debe tener el nuevo valor de cp');
    assert.ok(!('anterior' in putBody), 'body NO debe tener estructura anterior/nuevo');
  } finally {
    restore();
  }
});

test('actualizarCliente: lanza error si Operam responde result: false', async () => {
  resetSession();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers/99': () => jsonResponse({ result: false, messages: ['Cliente no encontrado'] }),
  });
  try {
    const diff = { 'cl-municipio': { anterior: 'A', nuevo: 'B' } };
    await assert.rejects(
      () => actualizarCliente(99, diff),
      (err) => {
        assert.ok(err.message.includes('Cliente no encontrado') || err.message.length > 0);
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('actualizarCliente: usa OPERAM_URL del env cuando se llama', async () => {
  resetSession();
  const originalUrl = process.env.OPERAM_URL;
  process.env.OPERAM_URL = 'https://test-operam.example.com';
  let calledUrls = [];
  const restore = mockFetchByUrl({
    'test-operam.example.com': (url) => {
      calledUrls.push(url);
      if (url.includes('/api/v3/login')) return jsonResponse({ token: 'test-token', result: true });
      return jsonResponse({ result: true });
    },
  });
  try {
    const diff = { 'cl-municipio': { anterior: 'A', nuevo: 'B' } };
    await actualizarCliente(10, diff);
    assert.ok(calledUrls.length > 0, 'fetch debe haber sido llamado');
    assert.ok(calledUrls.some(u => u.includes('test-operam.example.com')), 'debe usar OPERAM_URL del env');
  } finally {
    restore();
    process.env.OPERAM_URL = originalUrl;
  }
});

test('buscarClientePorRFC: retorna encontrado:true con datos del cliente', async () => {
  resetSession();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': () => jsonResponse({
      total: 1,
      data: [{
        customer_id: 101,
        CustName: 'Test SA de CV',
        tax_id: 'TST010101ABC',
        street: 'Insurgentes Sur',
        street_number: '1234',
        suite_number: '',
        district: 'Del Valle',
        postal_code: '03100',
        city: 'Benito Juarez',
        state: 'CDMX',
        cfdi_regimen_fiscal: '601',
        branches: [{
          br_name: 'Test SA de CV',
          addr_street: 'Insurgentes Sur',
          addr_colony: 'Del Valle',
          addr_zip: '03100',
          addr_city: 'Benito Juarez',
          addr_state: 'CDMX',
          phone: '5512345678',
          email: 'contacto@test.com',
        }],
      }],
    }),
  });
  try {
    const res = await buscarClientePorRFC('TST010101ABC');
    assert.equal(res.encontrado, true);
    assert.equal(res.cliente_id, 101);
    assert.equal(res.CustName, 'Test SA de CV');
    assert.equal(res.tax_id, 'TST010101ABC');
    assert.equal(res.branch.br_name, 'Test SA de CV');
    assert.equal(res.branch.addr_zip, '03100');
  } finally {
    restore();
  }
});

test('buscarClientePorRFC: retorna {encontrado:false} cuando Operam no tiene el RFC', async () => {
  resetSession();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': () => jsonResponse({ total: 0, data: [] }),
  });
  try {
    const res = await buscarClientePorRFC('RFC000000000');
    assert.equal(res.encontrado, false);
    assert.equal(Object.keys(res).length, 1);
  } finally {
    restore();
  }
});
