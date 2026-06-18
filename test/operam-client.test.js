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

const { actualizarCliente, buscarClientes, buscarClientePorRFC, crearCliente, resetSession, buildClienteBody, actualizarBranchCliente, listarTransacciones, listarPedidos, subirCotizacionOperam, esZonaMetroLocal } = await import('../lib/operam-client.js');

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

// Operam responde 404 ("No customers found") cuando una busqueda de cliente no
// tiene resultados (caso normal: cliente nuevo en captura manual). Eso NO es un
// error: debe tratarse como "sin resultados" para que la verificacion de duplicados
// no truene (era el 503 "Operam no disponible: Operam 404").
test('buscarClientes: un 404 de Operam (sin resultados) devuelve lista vacia, no lanza', async () => {
  resetSession();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers': () => jsonResponse({ errors: ['No customers found'] }, 404),
  });
  try {
    const r = await buscarClientes('RFCQUENOEXISTE');
    assert.deepEqual(r, []);
  } finally {
    restore();
  }
});

test('buscarClientePorRFC: un 404 de Operam (RFC inexistente) devuelve { encontrado: false }', async () => {
  resetSession();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers': () => jsonResponse({ errors: ['No customers found'] }, 404),
  });
  try {
    const r = await buscarClientePorRFC('AAAA010101AAA');
    assert.equal(r.encontrado, false);
  } finally {
    restore();
  }
});

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

// === buildClienteBody() — campos huerfanos #17/#18 y contacto principal #16 (issue #26) ===

test('buildClienteBody: invoice_email se concatena en notes (issue #17)', () => {
  const body = buildClienteBody({ tax_id: 'RFC000001ABC', CustName: 'Test SA', invoice_email: 'facturacion@empresa.com' });
  assert.ok(body.notes.includes('facturacion@empresa.com'), 'notes debe incluir el email de facturacion');
  assert.ok(/email de facturaci[oó]n/i.test(body.notes), 'notes debe rotular el campo como email de facturacion');
});

test('buildClienteBody: celular_nota se concatena en notes (issue #18)', () => {
  const body = buildClienteBody({ tax_id: 'RFC000001ABC', CustName: 'Test SA', celular_nota: '5512345678' });
  assert.ok(body.notes.includes('5512345678'), 'notes debe incluir el celular');
  assert.ok(/celular/i.test(body.notes), 'notes debe rotular el campo como celular');
});

test('buildClienteBody: sin invoice_email ni celular_nota no agrega lineas vacias a notes', () => {
  const body = buildClienteBody({ tax_id: 'RFC000001ABC', CustName: 'Test SA' });
  assert.ok(!/email de facturaci[oó]n/i.test(body.notes), 'no debe mencionar email de facturacion si no vino');
  assert.ok(!/celular/i.test(body.notes), 'no debe mencionar celular si no vino');
});

test('buildClienteBody: phone/email a nivel cliente vienen del input (issue #16)', () => {
  const body = buildClienteBody({ tax_id: 'RFC000001ABC', CustName: 'Test SA', phone: '5512345678', email: 'contacto@empresa.com' });
  assert.strictEqual(body.phone, '5512345678', 'phone a nivel cliente debe venir del input');
  assert.strictEqual(body.email, 'contacto@empresa.com', 'email a nivel cliente debe venir del input');
});

// === Dimensiones del cliente — issue #74 ===
// Nombre real del campo en la API v3 REST: dimension_id (D1) y dimension2_id (D2),
// campos escalares (MAPEO_CAMPOS_CLIENTE.md 2.4/4, lib/operam-client.js). El
// dimensiones_id[] (array) de peltre-operam.md es del flujo viejo de web-scraping
// del form PHP, NO de la API v3. SOP pasos 19-20: D1=1 (TALLER CASINO DE LA SELVA),
// D2=5 (CORPORATIVO).

test('buildClienteBody: dimension_id=1 (D1 TALLER CASINO DE LA SELVA) (issue #74)', () => {
  const body = buildClienteBody({ tax_id: 'RFC000001ABC', CustName: 'Test SA' });
  assert.strictEqual(body.dimension_id, 1, 'dimension_id debe ser 1 (D1 TALLER CASINO DE LA SELVA, SOP paso 19)');
});

test('buildClienteBody: dimension2_id=5 (D2 CORPORATIVO) (issue #74)', () => {
  const body = buildClienteBody({ tax_id: 'RFC000001ABC', CustName: 'Test SA' });
  assert.strictEqual(body.dimension2_id, 5, 'dimension2_id debe ser 5 (D2 CORPORATIVO, SOP paso 20)');
});

// El quirk de Operam (acepta 200 e ignora campos) significa que un mock que solo
// devuelve {result:true} no prueba que las dimensiones se hayan MANDADO. Este test
// CAPTURA el body real del POST /customers y afirma que las dimensiones viajan.
test('crearCliente: el POST /customers envia dimension_id=1 y dimension2_id=5 (issue #74)', async () => {
  resetSession();
  let postBody = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers': (url, opts) => {
      if (opts && opts.method === 'POST') {
        postBody = JSON.parse(opts.body);
        return jsonResponse({ result: true, customer_id: 999 });
      }
      return jsonResponse({ total: 0, data: [] });
    },
  });
  try {
    await crearCliente({ tax_id: 'NVO010101ABC', CustName: 'Nuevo SA de CV' });
    assert.ok(postBody, 'debe haberse capturado el body del POST /customers');
    assert.strictEqual(postBody.dimension_id, 1, 'el POST debe enviar dimension_id=1');
    assert.strictEqual(postBody.dimension2_id, 5, 'el POST debe enviar dimension2_id=5');
  } finally {
    restore();
  }
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

// === Domicilio del cliente (branch) — payload completo SOP — issue #74 ===
// AC2: el domicilio creado debe llevar vendedor, area/zona, almacen predeterminado
// y grupo de impuestos. Operam acepta 200 e ignora campos: se CAPTURA el body del
// PUT /branches y se afirma el payload completo, no solo que devuelva 200.
// Fuentes: salesman = operam_id del alta (SOP 10-11); area derivada del pais (SOP 24);
// location = 40 PT (SOP 21-22); tax_group_id por pais del domicilio (ADR-0002, CONTEXT.md).

test('actualizarBranchCliente: el PUT branch lleva vendedor, area, almacen y tax_group (domicilio MX) (issue #74)', async () => {
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
      br_name: 'Almacen Central', br_ref: 'ALMCEN', pais: 'MX', salesman: 47,
      addr_street: 'Reforma', addr_exterior: '1', addr_interior: '', addr_colony: 'Juarez',
      addr_city: 'CDMX', addr_state: 'CDMX', addr_zip: '06600', addr_reference: '',
      phone: '5512345678', email: 'entrega@test.com',
    });
    assert.ok(putBody, 'debe haberse capturado el body del PUT /branches');
    assert.strictEqual(putBody.customer_id, 100, 'el PUT branch debe llevar customer_id para no orfanar el branch (debtor_no->0)');
    assert.strictEqual(putBody.salesman, 47, 'el domicilio debe llevar el vendedor (salesman) del alta');
    assert.strictEqual(putBody.area, 1, 'el domicilio MX debe llevar area/zona 1 (10 Mexico)');
    assert.strictEqual(putBody.location, 40, 'el domicilio debe llevar almacen predeterminado 40 (PT)');
    assert.strictEqual(putBody.tax_group_id, 1, 'domicilio MX debe llevar tax_group_id 1 (gravado)');
  } finally {
    restore();
  }
});

test('actualizarBranchCliente: el PUT branch usa area y tax_group de pais extranjero (US) (issue #74)', async () => {
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
    assert.ok(putBody, 'debe haberse capturado el body del PUT /branches');
    assert.strictEqual(putBody.customer_id, 100, 'el PUT branch debe llevar customer_id para no orfanar el branch (debtor_no->0)');
    assert.strictEqual(putBody.area, 5, 'domicilio US debe llevar area/zona 5 (20 USA)');
    assert.strictEqual(putBody.tax_group_id, 2, 'domicilio extranjero debe llevar tax_group_id 2 (exento)');
    assert.strictEqual(putBody.location, 40, 'el domicilio debe llevar almacen predeterminado 40 (PT)');
    assert.strictEqual(putBody.salesman, 47, 'el domicilio debe llevar el vendedor (salesman) del alta');
  } finally {
    restore();
  }
});

// === Lecturas para el sync post-venta (#62) ===
// listarTransacciones -> GET /api/v3/sales/transactions; listarPedidos ->
// GET /api/v3/sales/sales_orders. Endpoints confirmados contra el Postman v3 y
// la API en vivo (peltre-operam.md seccion 12). Solo lectura.

test('listarTransacciones: GET a /api/v3/sales/transactions con RFC y rango de fechas; devuelve data[]', async () => {
  resetSession();
  let getUrl = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/transactions': (url) => {
      getUrl = String(url);
      return jsonResponse({ total: 2, data: [
        { type: '10', order_: '7077', total_amount: '16954', allocated: '16954', outstanding: '0' },
        { type: '13', order_: '7077', total_amount: '16954', allocated: '0', outstanding: '0' },
      ] });
    },
  });
  try {
    const data = await listarTransacciones({ rfc: 'CPE921211N76', desde: '2026-01-01', hasta: '2026-06-17' });
    assert.equal(data.length, 2);
    assert.ok(getUrl.includes('/api/v3/sales/transactions'));
    assert.ok(getUrl.includes('customer_rfc=CPE921211N76'));
    assert.ok(getUrl.includes('since_date=2026-01-01'));
    assert.ok(getUrl.includes('until_date=2026-06-17'));
  } finally {
    restore();
  }
});

test('listarTransacciones: acepta customerId y filterType', async () => {
  resetSession();
  let getUrl = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/transactions': (url) => { getUrl = String(url); return jsonResponse({ data: [] }); },
  });
  try {
    await listarTransacciones({ customerId: 345, filterType: '10', desde: '2026-01-01', hasta: '2026-06-17' });
    assert.ok(getUrl.includes('customer_id=345'));
    assert.ok(getUrl.includes('filterType=10'));
  } finally {
    restore();
  }
});

test('listarTransacciones: devuelve [] si la respuesta no trae data', async () => {
  resetSession();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/transactions': () => jsonResponse({ total: 0 }),
  });
  try {
    const data = await listarTransacciones({ rfc: 'X', desde: '2026-01-01', hasta: '2026-06-17' });
    assert.deepEqual(data, []);
  } finally {
    restore();
  }
});

test('listarPedidos: GET a /api/v3/sales/sales_orders por debtor_no y rango; devuelve data[]', async () => {
  resetSession();
  let getUrl = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/sales_orders': (url) => {
      getUrl = String(url);
      return jsonResponse({ total: 1, data: [{ order_no: '7077', trans_type: '30', debtor_no: '345', total: '16954' }] });
    },
  });
  try {
    const data = await listarPedidos({ debtorNo: 345, desde: '2026-01-01', hasta: '2026-06-17' });
    assert.equal(data.length, 1);
    assert.equal(data[0].order_no, '7077');
    assert.ok(getUrl.includes('/api/v3/sales/sales_orders'));
    assert.ok(getUrl.includes('debtor_no=345'));
    assert.ok(getUrl.includes('DateFrom=2026-01-01'));
    assert.ok(getUrl.includes('DateTo=2026-06-17'));
  } finally {
    restore();
  }
});

test('listarPedidos: devuelve [] si la respuesta no trae data', async () => {
  resetSession();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/sales_orders': () => jsonResponse({ total: 0 }),
  });
  try {
    const data = await listarPedidos({ debtorNo: 1, desde: '2026-01-01', hasta: '2026-06-17' });
    assert.deepEqual(data, []);
  } finally {
    restore();
  }
});

// === subirCotizacionOperam() — issue #68 (CRITICO: cliente correcto + campos completos) ===
// Antes: si no habia match exacto de RFC caia a clientes[0] (cliente al azar) y subio
// la cotizacion al cliente equivocado (Utilitario Mexicano, cot 1157). Ademas filtraba la
// linea de envio y dejaba referencia/entregar-a/vigencia vacios.

test('subirCotizacionOperam: RFC con match unico -> usa ESE customer_id (no clientes[0])', async () => {
  resetSession();
  let quoteBody = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers': () => jsonResponse({
      total: 1,
      data: [{ customer_id: 314, tax_id: 'CPE921211N76', CustName: 'Cafebreria El Pendulo', branches: [{ branch_code: 88 }] }],
    }),
    '/api/v3/sales/quote': (url, opts) => {
      quoteBody = JSON.parse(opts.body);
      return jsonResponse({ result: true, quote_id: 1200 });
    },
  });
  try {
    const folio = await subirCotizacionOperam({
      fecha: '2026-06-17',
      cliente: { rfc: 'CPE921211N76', razonSocial: 'Cafebreria El Pendulo' },
      items: [{ codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 10, precio: 100, descuento: 0 }],
    });
    assert.equal(folio, 1200);
    assert.equal(quoteBody.customer_id, 314, 'debe usar el customer_id del cliente que matchea por RFC exacto');
  } finally {
    restore();
  }
});

test('subirCotizacionOperam: cuando la cotizacion trae customer_id del cliente, lo usa directo', async () => {
  resetSession();
  let quoteBody = null;
  let busquedaLlamada = false;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers': () => { busquedaLlamada = true; return jsonResponse({ total: 0, data: [] }); },
    '/api/v3/sales/quote': (url, opts) => {
      quoteBody = JSON.parse(opts.body);
      return jsonResponse({ result: true, quote_id: 1300 });
    },
  });
  try {
    const folio = await subirCotizacionOperam({
      fecha: '2026-06-17',
      cliente: { rfc: 'CPE921211N76', customerId: 500, branchId: 77 },
      items: [{ codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 1, precio: 100 }],
    });
    assert.equal(folio, 1300);
    assert.equal(quoteBody.customer_id, 500, 'debe usar el customerId que ya trae la cotizacion');
    assert.equal(busquedaLlamada, false, 'no debe buscar por RFC si ya tiene customerId');
  } finally {
    restore();
  }
});

test('subirCotizacionOperam: sin match de RFC -> lanza error claro y NO sube (no usa clientes[0])', async () => {
  resetSession();
  let quoteLlamado = false;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers': () => jsonResponse({ total: 0, data: [] }),
    '/api/v3/sales/quote': () => { quoteLlamado = true; return jsonResponse({ result: true, quote_id: 1 }); },
  });
  try {
    await assert.rejects(
      () => subirCotizacionOperam({
        fecha: '2026-06-17',
        cliente: { rfc: 'NOEXISTE010101AAA', razonSocial: 'Fantasma SA' },
        items: [{ codigo: 'X', descripcion: 'X', cantidad: 1, precio: 1 }],
      }),
      (err) => { assert.match(err.message, /cliente/i); return true; }
    );
    assert.equal(quoteLlamado, false, 'NO debe subir el quote si no se identifico el cliente');
  } finally {
    restore();
  }
});

test('subirCotizacionOperam: sin RFC -> lanza error claro y NO sube', async () => {
  resetSession();
  let quoteLlamado = false;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers': () => jsonResponse({ total: 1, data: [{ customer_id: 999, tax_id: 'AAA010101AAA', branches: [] }] }),
    '/api/v3/sales/quote': () => { quoteLlamado = true; return jsonResponse({ result: true, quote_id: 1 }); },
  });
  try {
    await assert.rejects(
      () => subirCotizacionOperam({
        fecha: '2026-06-17',
        cliente: { rfc: '', razonSocial: 'Sin RFC SA' },
        items: [{ codigo: 'X', descripcion: 'X', cantidad: 1, precio: 1 }],
      }),
      (err) => { assert.match(err.message, /cliente|RFC/i); return true; }
    );
    assert.equal(quoteLlamado, false, 'sin RFC no debe arriesgar el cliente equivocado');
  } finally {
    restore();
  }
});

test('subirCotizacionOperam: el branch_id sale del branch del cliente resuelto por RFC', async () => {
  resetSession();
  let quoteBody = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers': () => jsonResponse({
      total: 1,
      data: [{ customer_id: 314, tax_id: 'CPE921211N76', CustName: 'El Pendulo', branches: [{ branch_code: 88 }] }],
    }),
    '/api/v3/sales/quote': (url, opts) => {
      quoteBody = JSON.parse(opts.body);
      return jsonResponse({ result: true, quote_id: 1500 });
    },
  });
  try {
    await subirCotizacionOperam({
      fecha: '2026-06-17',
      cliente: { rfc: 'CPE921211N76', razonSocial: 'El Pendulo' },
      items: [{ codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 1, precio: 100 }],
    });
    assert.equal(quoteBody.branch_id, 88, 'branch_id debe ser el branch_code del cliente, no el fallback 1');
  } finally {
    restore();
  }
});

test('subirCotizacionOperam: el quote lleva cust_ref (referencia), deliver_to y vigencia', async () => {
  resetSession();
  let quoteBody = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers': () => jsonResponse({
      total: 1,
      data: [{ customer_id: 320, tax_id: 'CPE921211N76', CustName: 'El Pendulo', branches: [{ branch_code: 88 }] }],
    }),
    '/api/v3/sales/quote': (url, opts) => {
      quoteBody = JSON.parse(opts.body);
      return jsonResponse({ result: true, quote_id: 1400 });
    },
  });
  try {
    await subirCotizacionOperam({
      fecha: '2026-06-17',
      vigencia: '2026-07-17',
      cliente: {
        rfc: 'CPE921211N76', razonSocial: 'El Pendulo',
        referencia: 'OC-4521', nombreEntrega: 'Almacen Roma',
        calle: 'Hamburgo', colonia: 'Juarez', cpEntrega: '06600', municipio: 'CDMX', estado: 'CDMX',
      },
      items: [{ codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 10, precio: 100, descuento: 0 }],
    });
    assert.equal(quoteBody.cust_ref, 'OC-4521', 'cust_ref debe venir de cliente.referencia');
    assert.equal(quoteBody.deliver_to, 'Almacen Roma', 'deliver_to debe venir de cliente.nombreEntrega');
    assert.ok(/2026-07-17/.test(JSON.stringify(quoteBody)), 'la vigencia (valido hasta) debe ir en el quote');
  } finally {
    restore();
  }
});

test('subirCotizacionOperam: sin vigencia explicita usa OrderDate + 30 dias', async () => {
  resetSession();
  let quoteBody = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers': () => jsonResponse({
      total: 1,
      data: [{ customer_id: 321, tax_id: 'CPE921211N76', CustName: 'El Pendulo', branches: [{ branch_code: 88 }] }],
    }),
    '/api/v3/sales/quote': (url, opts) => {
      quoteBody = JSON.parse(opts.body);
      return jsonResponse({ result: true, quote_id: 1401 });
    },
  });
  try {
    await subirCotizacionOperam({
      fecha: '2026-06-17',
      cliente: { rfc: 'CPE921211N76', razonSocial: 'El Pendulo' },
      items: [{ codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 1, precio: 100 }],
    });
    // 2026-06-17 + 30 dias = 2026-07-17
    assert.ok(/2026-07-17/.test(JSON.stringify(quoteBody)), 'sin vigencia explicita debe ser fecha + 30 dias');
  } finally {
    restore();
  }
});

test('subirCotizacionOperam: la linea de envio (ENVIO) NO se pierde del quote', async () => {
  resetSession();
  let quoteBody = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers': () => jsonResponse({
      total: 1,
      data: [{ customer_id: 322, tax_id: 'CPE921211N76', CustName: 'El Pendulo', branches: [{ branch_code: 88 }] }],
    }),
    '/api/v3/sales/quote': (url, opts) => {
      quoteBody = JSON.parse(opts.body);
      return jsonResponse({ result: true, quote_id: 1402 });
    },
  });
  try {
    await subirCotizacionOperam({
      fecha: '2026-06-17',
      cliente: { rfc: 'CPE921211N76', razonSocial: 'El Pendulo' },
      items: [
        { codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 10, precio: 100, descuento: 0 },
        { codigo: 'ENVIO', descripcion: 'Envio FedEx', cantidad: 1, precio: 350, descuento: 0 },
      ],
    });
    const serializado = JSON.stringify(quoteBody);
    assert.ok(/350/.test(serializado), 'el monto del envio (350) debe estar presente en el quote');
    assert.ok(/[Ee]nvio/.test(serializado), 'la descripcion del envio debe estar presente en el quote');
  } finally {
    restore();
  }
});

// === esZonaMetroLocal() — issue #68 (clasificacion CP -> zona metro, funcion pura) ===
// LOCAL: CDMX 01000-16999 + EdoMex metropolitano 52000-57999 (semilla confirmada por
// Adrian). Todo lo demas (incluido valle de Toluca 50xxx-51xxx) = FORANEO. CP vacio o
// invalido -> foraneo por defecto.

const RANGOS_ZONA_METRO = [['01000', '16999'], ['52000', '57999']];

test('esZonaMetroLocal: CP de CDMX (06700) es local', () => {
  assert.equal(esZonaMetroLocal('06700', RANGOS_ZONA_METRO), true);
});

test('esZonaMetroLocal: CP de Neza/EdoMex metropolitano (57000) es local', () => {
  assert.equal(esZonaMetroLocal('57000', RANGOS_ZONA_METRO), true);
});

test('esZonaMetroLocal: CP del valle de Toluca (50000) es foraneo', () => {
  assert.equal(esZonaMetroLocal('50000', RANGOS_ZONA_METRO), false);
});

test('esZonaMetroLocal: CP de Guadalajara (44100) es foraneo', () => {
  assert.equal(esZonaMetroLocal('44100', RANGOS_ZONA_METRO), false);
});

test('esZonaMetroLocal: limites inclusivos (01000 y 16999 son local; 17000 foraneo)', () => {
  assert.equal(esZonaMetroLocal('01000', RANGOS_ZONA_METRO), true);
  assert.equal(esZonaMetroLocal('16999', RANGOS_ZONA_METRO), true);
  assert.equal(esZonaMetroLocal('17000', RANGOS_ZONA_METRO), false);
});

test('esZonaMetroLocal: CP vacio o invalido -> foraneo (false)', () => {
  assert.equal(esZonaMetroLocal('', RANGOS_ZONA_METRO), false);
  assert.equal(esZonaMetroLocal(null, RANGOS_ZONA_METRO), false);
  assert.equal(esZonaMetroLocal('abc', RANGOS_ZONA_METRO), false);
  assert.equal(esZonaMetroLocal('123', RANGOS_ZONA_METRO), false);
});

// === subirCotizacionOperam() — issue #68: envio como PARTIDA nativa del quote ===
// La linea ENVIO de paqueteria deja de ir en comments y se vuelve una partida real
// con el SKU de flete que corresponde a la zona del CP de entrega:
//   local   (CDMX 06700, Neza 57000) -> stock_id 251021001 (FedEx Ground)
//   foraneo (GDL 44100)               -> stock_id 251021002 (FedEx Ground Foraneo)
// El carrier real va SOLO en stock_id_text. qty 1, price = precio del envio, Disc 0.

function partidaFlete(quoteBody) {
  return (quoteBody.items || []).find(i => i.stock_id === '251021001' || i.stock_id === '251021002');
}

test('subirCotizacionOperam: envio paqueteria con CP local -> partida flete stock_id 251021001', async () => {
  resetSession();
  let quoteBody = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers': () => jsonResponse({
      total: 1,
      data: [{ customer_id: 330, tax_id: 'CPE921211N76', CustName: 'El Pendulo', branches: [{ branch_code: 88 }] }],
    }),
    '/api/v3/sales/quote': (url, opts) => {
      quoteBody = JSON.parse(opts.body);
      return jsonResponse({ result: true, quote_id: 1500 });
    },
  });
  try {
    await subirCotizacionOperam({
      fecha: '2026-06-17',
      cliente: { rfc: 'CPE921211N76', razonSocial: 'El Pendulo', cpEntrega: '06700' },
      items: [
        { codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 10, precio: 100, descuento: 0 },
        { codigo: 'ENVIO', descripcion: 'Envio FedEx Ground', cantidad: 1, precio: 350, descuento: 0 },
      ],
    });
    const flete = partidaFlete(quoteBody);
    assert.ok(flete, 'debe existir una partida de flete');
    assert.equal(flete.stock_id, '251021001', 'CP local -> FedEx Ground 251021001');
    assert.equal(flete.stock_id_text, 'Envio FedEx Ground', 'el carrier real va en stock_id_text');
    assert.equal(flete.qty, 1);
    assert.equal(flete.price, 350);
    assert.equal(flete.Disc, 0);
    // las partidas normales siguen ahi
    assert.ok((quoteBody.items || []).some(i => i.stock_id === 'CR20-PLATO'), 'el producto normal sigue en el quote');
    // el envio YA NO esta en comments
    assert.ok(!/Envio:/.test(quoteBody.comments || ''), 'el envio ya no debe duplicarse en comments');
  } finally {
    restore();
  }
});

test('subirCotizacionOperam: envio paqueteria con CP foraneo -> partida flete stock_id 251021002', async () => {
  resetSession();
  let quoteBody = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers': () => jsonResponse({
      total: 1,
      data: [{ customer_id: 331, tax_id: 'CPE921211N76', CustName: 'El Pendulo', branches: [{ branch_code: 88 }] }],
    }),
    '/api/v3/sales/quote': (url, opts) => {
      quoteBody = JSON.parse(opts.body);
      return jsonResponse({ result: true, quote_id: 1501 });
    },
  });
  try {
    await subirCotizacionOperam({
      fecha: '2026-06-17',
      cliente: { rfc: 'CPE921211N76', razonSocial: 'El Pendulo', cpEntrega: '44100' },
      items: [
        { codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 10, precio: 100, descuento: 0 },
        { codigo: 'ENVIO', descripcion: 'Envio DHL', cantidad: 1, precio: 480, descuento: 0 },
      ],
    });
    const flete = partidaFlete(quoteBody);
    assert.ok(flete, 'debe existir una partida de flete');
    assert.equal(flete.stock_id, '251021002', 'CP foraneo (GDL 44100) -> FedEx Ground Foraneo 251021002');
    assert.equal(flete.stock_id_text, 'Envio DHL', 'el carrier real (DHL) va en stock_id_text, no en stock_id');
    assert.equal(flete.qty, 1);
    assert.equal(flete.price, 480);
    assert.ok(!/Envio:/.test(quoteBody.comments || ''), 'el envio ya no debe duplicarse en comments');
  } finally {
    restore();
  }
});

test('subirCotizacionOperam: CP de entrega ausente -> flete foraneo por defecto (251021002)', async () => {
  resetSession();
  let quoteBody = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers': () => jsonResponse({
      total: 1,
      data: [{ customer_id: 332, tax_id: 'CPE921211N76', CustName: 'El Pendulo', branches: [{ branch_code: 88 }] }],
    }),
    '/api/v3/sales/quote': (url, opts) => {
      quoteBody = JSON.parse(opts.body);
      return jsonResponse({ result: true, quote_id: 1502 });
    },
  });
  try {
    await subirCotizacionOperam({
      fecha: '2026-06-17',
      cliente: { rfc: 'CPE921211N76', razonSocial: 'El Pendulo' },
      items: [
        { codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 1, precio: 100, descuento: 0 },
        { codigo: 'ENVIO', descripcion: 'Envio UPS', cantidad: 1, precio: 300, descuento: 0 },
      ],
    });
    const flete = partidaFlete(quoteBody);
    assert.ok(flete, 'debe existir una partida de flete');
    assert.equal(flete.stock_id, '251021002', 'sin CP de entrega clasifica como foraneo (default seguro)');
  } finally {
    restore();
  }
});

test('subirCotizacionOperam: sin linea de envio -> NO se agrega partida de flete', async () => {
  resetSession();
  let quoteBody = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers': () => jsonResponse({
      total: 1,
      data: [{ customer_id: 333, tax_id: 'CPE921211N76', CustName: 'El Pendulo', branches: [{ branch_code: 88 }] }],
    }),
    '/api/v3/sales/quote': (url, opts) => {
      quoteBody = JSON.parse(opts.body);
      return jsonResponse({ result: true, quote_id: 1503 });
    },
  });
  try {
    await subirCotizacionOperam({
      fecha: '2026-06-17',
      cliente: { rfc: 'CPE921211N76', razonSocial: 'El Pendulo', cpEntrega: '06700' },
      items: [{ codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 10, precio: 100, descuento: 0 }],
    });
    assert.equal(partidaFlete(quoteBody), undefined, 'sin envio no debe haber partida de flete');
    assert.equal((quoteBody.items || []).length, 1, 'solo la partida del producto');
  } finally {
    restore();
  }
});

test('subirCotizacionOperam: envio Lalamove -> NO partida, queda en comments (diferido a #72)', async () => {
  resetSession();
  let quoteBody = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers': () => jsonResponse({
      total: 1,
      data: [{ customer_id: 334, tax_id: 'CPE921211N76', CustName: 'El Pendulo', branches: [{ branch_code: 88 }] }],
    }),
    '/api/v3/sales/quote': (url, opts) => {
      quoteBody = JSON.parse(opts.body);
      return jsonResponse({ result: true, quote_id: 1504 });
    },
  });
  try {
    await subirCotizacionOperam({
      fecha: '2026-06-17',
      cliente: { rfc: 'CPE921211N76', razonSocial: 'El Pendulo', cpEntrega: '06700' },
      items: [
        { codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 10, precio: 100, descuento: 0 },
        { codigo: 'ENVIO', descripcion: 'Lalamove auto', cantidad: 1, precio: 250, descuento: 0 },
      ],
    });
    assert.equal(partidaFlete(quoteBody), undefined, 'Lalamove NO debe volverse partida de flete');
    assert.ok(/Lalamove/i.test(quoteBody.comments || ''), 'Lalamove debe quedar en comments');
    assert.ok(/250/.test(quoteBody.comments || ''), 'el monto de Lalamove debe quedar en comments');
  } finally {
    restore();
  }
});

// El POST /api/v3/sales/quote real responde { result, added_trans_type, added_trans_no,
// ref } (verificado en vivo, quote 1160, issue #68). El folio del quote es added_trans_no;
// la funcion debe devolverlo para que server.js persista el folio (setFolioOperam, #63).
// Antes devolvia quote_id||factura_no (campos inexistentes en la respuesta) -> undefined.
test('subirCotizacionOperam: devuelve el folio real del quote (added_trans_no)', async () => {
  resetSession();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers': () => jsonResponse({
      total: 1,
      data: [{ customer_id: 14, tax_id: 'XAXX010101000', CustName: 'PUBLICO EN GENERAL', branches: [{ branch_code: 29 }] }],
    }),
    '/api/v3/sales/quote': () => jsonResponse({
      result: true, added_trans_type: 32, added_trans_no: 1160, ref: 'C2606222',
      messages: ['Cotizacion insertada exitosamente'],
    }),
  });
  try {
    const folio = await subirCotizacionOperam({
      fecha: '2026-06-18',
      cliente: { rfc: 'XAXX010101000', razonSocial: 'PUBLICO EN GENERAL', cpEntrega: '06700' },
      items: [{ codigo: 'PV08P3001120', descripcion: 'Portavasos', cantidad: 10, precio: 45.26, descuento: 0 }],
    });
    assert.equal(folio, 1160, 'debe devolver added_trans_no (folio real), no undefined');
  } finally {
    restore();
  }
});
