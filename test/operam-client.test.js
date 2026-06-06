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

const { actualizarCliente, buscarClientePorRFC, crearCliente, resetSession, buildClienteBody, actualizarBranchCliente } = await import('../lib/operam-client.js');

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
    assert.ok(putUrl !== null);
    assert.ok(putUrl.includes('/api/v3/sales/customers/42'));
    assert.equal(putBody['cl-municipio'], 'ZAPOPAN');
    assert.equal(putBody['cl-cp-fiscal'], '45100');
    assert.ok(!('anterior' in putBody));
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
    await assert.rejects(() => actualizarCliente(99, diff), (err) => { assert.ok(err.message.length > 0); return true; });
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
    await actualizarCliente(10, { 'cl-municipio': { anterior: 'A', nuevo: 'B' } });
    assert.ok(calledUrls.some(u => u.includes('test-operam.example.com')));
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
        customer_id: 101, CustName: 'Test SA de CV', tax_id: 'TST010101ABC',
        street: 'Insurgentes Sur', street_number: '1234', suite_number: '',
        district: 'Del Valle', postal_code: '03100', city: 'Benito Juarez',
        state: 'CDMX', cfdi_regimen_fiscal: '601',
        branches: [{ br_name: 'Test SA de CV', addr_street: 'Insurgentes Sur', addr_colony: 'Del Valle', addr_zip: '03100', addr_city: 'Benito Juarez', addr_state: 'CDMX', phone: '5512345678', email: 'contacto@test.com' }],
      }],
    }),
  });
  try {
    const res = await buscarClientePorRFC('TST010101ABC');
    assert.equal(res.encontrado, true);
    assert.equal(res.cliente_id, 101);
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
  } finally {
    restore();
  }
});

test('crearCliente: crea cliente nuevo y retorna { duplicado:false, cliente_id, nombre }', async () => {
  resetSession();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': (url, opts) => {
      if (opts && opts.method === 'POST') return jsonResponse({ result: true, customer_id: 999 });
      return jsonResponse({ total: 0, data: [] });
    },
  });
  try {
    const res = await crearCliente({ tax_id: 'NVO010101ABC', CustName: 'Nuevo SA de CV' });
    assert.equal(res.duplicado, false);
    assert.equal(res.cliente_id, 999);
    assert.ok(res.nombre);
  } finally {
    restore();
  }
});

test('crearCliente: retorna { duplicado:true } con datos cuando RFC ya existe', async () => {
  resetSession();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': () => jsonResponse({
      total: 1,
      data: [{ customer_id: 42, CustName: 'Existente SA', tax_id: 'EXT010101ABC', street: 'Reforma', street_number: '1', suite_number: '', district: 'Juarez', postal_code: '06600', city: 'CDMX', state: 'CDMX', cfdi_regimen_fiscal: '601', branches: [] }],
    }),
  });
  try {
    const res = await crearCliente({ tax_id: 'EXT010101ABC', CustName: 'Existente SA' });
    assert.equal(res.duplicado, true);
    assert.equal(res.cliente_id, 42);
  } finally {
    restore();
  }
});

// === buildClienteBody() — campos nuevos (issue #29) ===

test('buildClienteBody: area derivada MX -> 1', () => {
  const body = buildClienteBody({ tax_id: 'RFC000001ABC', CustName: 'Test SA', pais: 'MX' });
  assert.strictEqual(body.area, 1, 'area debe ser entero 1 para MX');
});

test('buildClienteBody: area derivada US -> 5', () => {
  const body = buildClienteBody({ tax_id: 'RFC000001ABC', CustName: 'Test SA', pais: 'US' });
  assert.strictEqual(body.area, 5, 'area debe ser entero 5 para US');
});

test('buildClienteBody: area derivada CA -> 7', () => {
  const body = buildClienteBody({ tax_id: 'RFC000001ABC', CustName: 'Test SA', pais: 'CA' });
  assert.strictEqual(body.area, 7, 'area debe ser entero 7 para CA');
});

test('buildClienteBody: area derivada pais desconocido -> 6', () => {
  const body = buildClienteBody({ tax_id: 'RFC000001ABC', CustName: 'Test SA', pais: 'DE' });
  assert.strictEqual(body.area, 6, 'area debe ser entero 6 para pais desconocido');
});

test('buildClienteBody: area default (sin pais) -> 1', () => {
  const body = buildClienteBody({ tax_id: 'RFC000001ABC', CustName: 'Test SA' });
  assert.strictEqual(body.area, 1, 'area default debe ser 1 (MX)');
});

test('buildClienteBody: incluye sales_type desde input', () => {
  const body = buildClienteBody({ tax_id: 'RFC000001ABC', CustName: 'Test SA', sales_type: 'M350' });
  assert.strictEqual(body.sales_type, 'M350', 'sales_type debe venir del input');
});

test('buildClienteBody: incluye segmento_id desde input', () => {
  const body = buildClienteBody({ tax_id: 'RFC000001ABC', CustName: 'Test SA', segmento_id: '3' });
  assert.strictEqual(body.segmento_id, '3', 'segmento_id debe venir del input');
});

test('buildClienteBody: salesman usa operam_id, no id interno', () => {
  const body = buildClienteBody({ tax_id: 'RFC000001ABC', CustName: 'Test SA', salesman: 47 });
  assert.strictEqual(body.salesman, 47, 'salesman debe usar operam_id pasado como campo salesman');
});

test('buildClienteBody: timbrado_uso_cfdi desde input cuando viene', () => {
  const body = buildClienteBody({ tax_id: 'RFC000001ABC', CustName: 'Test SA', timbrado_uso_cfdi: 'G03' });
  assert.strictEqual(body.timbrado_uso_cfdi, 'G03', 'timbrado_uso_cfdi debe ser el del input');
});

test('buildClienteBody: timbrado_uso_cfdi fallback S01 cuando viene vacio', () => {
  const body = buildClienteBody({ tax_id: 'RFC000001ABC', CustName: 'Test SA', timbrado_uso_cfdi: '' });
  assert.strictEqual(body.timbrado_uso_cfdi, 'S01', 'fallback S01 cuando timbrado_uso_cfdi es string vacio');
});

test('buildClienteBody: timbrado_uso_cfdi fallback S01 cuando no viene', () => {
  const body = buildClienteBody({ tax_id: 'RFC000001ABC', CustName: 'Test SA' });
  assert.strictEqual(body.timbrado_uso_cfdi, 'S01', 'fallback S01 cuando timbrado_uso_cfdi no esta en input');
});

// === actualizarBranchCliente() — issue #29 ===

test('actualizarBranchCliente: PUT /api/v3/sales/branches/:id con location:40 y ship_via:1 como enteros', async () => {
  resetSession();
  let putBody = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/branches/200': (url, opts) => {
      putBody = JSON.parse(opts.body);
      return jsonResponse({ result: true });
    },
  });
  try {
    await actualizarBranchCliente(100, 200, {
      br_name: 'Almacen Central', br_ref: 'ALMCEN',
      pais: 'MX', salesman: 47,
      addr_street: 'Reforma', addr_exterior: '1', addr_interior: '', addr_colony: 'Juarez',
      addr_city: 'CDMX', addr_state: 'CDMX', addr_zip: '06600', addr_reference: '',
      phone: '5512345678', email: 'entrega@test.com',
    });
    assert.strictEqual(typeof putBody.location, 'number', 'location debe ser number');
    assert.strictEqual(putBody.location, 40, 'location debe ser 40');
    assert.strictEqual(typeof putBody.ship_via, 'number', 'ship_via debe ser number');
    assert.strictEqual(putBody.ship_via, 1, 'ship_via debe ser 1');
  } finally {
    restore();
  }
});

test('actualizarBranchCliente: tax_group_id 1 para MX', async () => {
  resetSession();
  let putBody = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/branches/200': (url, opts) => {
      putBody = JSON.parse(opts.body);
      return jsonResponse({ result: true });
    },
  });
  try {
    await actualizarBranchCliente(100, 200, {
      br_name: 'Almacen', br_ref: 'ALM', pais: 'MX', salesman: 47,
      addr_street: 'X', addr_exterior: '1', addr_interior: '', addr_colony: 'X',
      addr_city: 'CDMX', addr_state: 'CDMX', addr_zip: '06600', addr_reference: '',
      phone: '', email: '',
    });
    assert.strictEqual(putBody.tax_group_id, 1, 'tax_group_id debe ser 1 para MX');
  } finally {
    restore();
  }
});

test('actualizarBranchCliente: tax_group_id 2 para pais extranjero', async () => {
  resetSession();
  let putBody = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/branches/201': (url, opts) => {
      putBody = JSON.parse(opts.body);
      return jsonResponse({ result: true });
    },
  });
  try {
    await actualizarBranchCliente(100, 201, {
      br_name: 'USA Branch', br_ref: 'USA', pais: 'US', salesman: 47,
      addr_street: 'Main St', addr_exterior: '10', addr_interior: '', addr_colony: '',
      addr_city: 'Los Angeles', addr_state: 'CA', addr_zip: '90001', addr_reference: '',
      phone: '', email: '',
    });
    assert.strictEqual(putBody.tax_group_id, 2, 'tax_group_id debe ser 2 para pais extranjero');
  } finally {
    restore();
  }
});

test('actualizarBranchCliente: NO incluye sales_account en el body del PUT', async () => {
  resetSession();
  let putBody = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/branches/200': (url, opts) => {
      putBody = JSON.parse(opts.body);
      return jsonResponse({ result: true });
    },
  });
  try {
    await actualizarBranchCliente(100, 200, {
      br_name: 'Almacen', br_ref: 'ALM', pais: 'MX', salesman: 47,
      addr_street: 'X', addr_exterior: '1', addr_interior: '', addr_colony: 'X',
      addr_city: 'CDMX', addr_state: 'CDMX', addr_zip: '06600', addr_reference: '',
      phone: '', email: '',
    });
    assert.ok(!('sales_account' in putBody), 'sales_account NO debe estar en el body del PUT');
  } finally {
    restore();
  }
});

test('actualizarBranchCliente: cuando branchId es null hace GET customer para obtener branch_code', async () => {
  resetSession();
  let getCustomerCalled = false;
  let putBranchUrl = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers/100': (url, opts) => {
      if (!opts || opts.method !== 'POST') {
        getCustomerCalled = true;
        return jsonResponse({ data: [{ branches: [{ branch_code: 300 }] }] });
      }
      return jsonResponse({ result: true, customer_id: 100 });
    },
    '/api/v3/sales/branches/300': (url, opts) => {
      putBranchUrl = url;
      return jsonResponse({ result: true });
    },
  });
  try {
    await actualizarBranchCliente(100, null, {
      br_name: 'Almacen', br_ref: 'ALM', pais: 'MX', salesman: 47,
      addr_street: 'X', addr_exterior: '1', addr_interior: '', addr_colony: 'X',
      addr_city: 'CDMX', addr_state: 'CDMX', addr_zip: '06600', addr_reference: '',
      phone: '', email: '',
    });
    assert.ok(getCustomerCalled, 'debe haber llamado GET /customers/:id para obtener branch_code');
    assert.ok(putBranchUrl && putBranchUrl.includes('/branches/300'), 'debe hacer PUT al branch_code obtenido');
  } finally {
    restore();
  }
});
