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

const { actualizarCliente, buscarClientes, buscarClientePorRFC, crearCliente, resetSession, buildClienteBody, actualizarBranchCliente, listarTransacciones, listarPedidos, subirCotizacionOperam, esZonaMetroLocal, obtenerClientePorId, obtenerDomicilios, armarComentariosQuote, obtenerQuote, obtenerCliente, listarSalesTypes, listarPreciosCompletos, listarItemsCompletos, _setBackoff429Base, _setMinInterval } = await import('../lib/operam-client.js');

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

// Rate limit de Operam (#76): una rafaga de lecturas (el backfill) dispara 429.
// apiCall reintenta con backoff exponencial en vez de tronar.
test('apiCall: reintenta ante 429 (rate limit) con backoff y luego responde', async () => {
  resetSession();
  _setBackoff429Base(1); // backoff casi instantaneo para no demorar el test
  let llamadas = 0;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/sales_orders': () => {
      llamadas++;
      return llamadas === 1 ? jsonResponse({}, 429) : jsonResponse({ data: [{ order_no: '7000' }] });
    },
  });
  try {
    const peds = await listarPedidos({ desde: '2026-01-01', hasta: '2026-06-18' });
    assert.equal(llamadas, 2, 'debe reintentar tras el 429');
    assert.equal(peds.length, 1);
  } finally {
    restore();
    _setBackoff429Base(2000);
  }
});

// Throttle PROACTIVO anti-429 (#76): el backfill hace ~800-1000 lecturas; el backoff
// REACTIVO no basta (el limite de Operam dura mas que la ventana de reintentos -> el
// dry-run en vivo del 2026-06-19 trono). Un intervalo minimo entre llamadas evita
// disparar el limite. apiCall serializa las llamadas (incluso concurrentes) con
// >= minIntervalMs entre cada una reservando slots crecientes.
test('apiCall: con intervalo minimo, espacia las llamadas concurrentes (throttle proactivo anti-429)', async () => {
  resetSession();
  _setMinInterval(40);
  const tiempos = [];
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/sales_orders': () => { tiempos.push(Date.now()); return jsonResponse({ data: [] }); },
  });
  try {
    await Promise.all([
      listarPedidos({ desde: 'a', hasta: 'b' }),
      listarPedidos({ desde: 'a', hasta: 'b' }),
      listarPedidos({ desde: 'a', hasta: 'b' }),
    ]);
    assert.equal(tiempos.length, 3);
    // Asercion ACUMULATIVA (no por-gap): el jitter de setTimeout bajo carga puede
    // comprimir un gap individual (un timer que se atrasa adelanta su distancia al
    // siguiente), pero el tiempo total entre la 1a y la 3a lectura solo CRECE con el
    // jitter -> 3 llamadas a >=40ms toman >= 2 intervalos (~80ms). Robusto, no flaky.
    const total = tiempos[2] - tiempos[0];
    assert.ok(total >= 70, `total=${total}ms entre la 1a y 3a lectura debe ser >= ~80 (2 intervalos de 40ms)`);
  } finally {
    restore();
    _setMinInterval(0);
  }
});

// Sin intervalo (default 0) NO hay pacing: la app normal (no-backfill) no cambia.
test('apiCall: intervalo 0 (default) no espacia (la app normal no se ve afectada)', async () => {
  resetSession();
  _setMinInterval(0);
  const tiempos = [];
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/sales_orders': () => { tiempos.push(Date.now()); return jsonResponse({ data: [] }); },
  });
  try {
    await Promise.all([
      listarPedidos({ desde: 'a', hasta: 'b' }),
      listarPedidos({ desde: 'a', hasta: 'b' }),
    ]);
    assert.equal(tiempos.length, 2);
    assert.ok((tiempos[1] - tiempos[0]) < 30, 'sin intervalo, sin espera apreciable entre llamadas');
  } finally {
    restore();
  }
});

// Robustez del backfill (#76) y el sync #62: un cliente sin transacciones/pedidos en
// el rango hace que Operam responda 404. Eso NO es error: es una lista vacia. Sin esto
// el backfill truena a media corrida al toparse un cliente sin movimientos (visto en
// vivo 2026-06-19: 404 en listarTransacciones aborto el dry-run).
test('listarTransacciones: un 404 de Operam (cliente sin transacciones) devuelve [], no lanza', async () => {
  resetSession();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/transactions': () => jsonResponse({ errors: ['No transactions found'] }, 404),
  });
  try {
    const r = await listarTransacciones({ rfc: 'XAXX010101000', desde: '2025-01-01', hasta: '2026-01-01' });
    assert.deepEqual(r, []);
  } finally {
    restore();
  }
});

test('listarPedidos: un 404 de Operam (cliente sin pedidos) devuelve [], no lanza', async () => {
  resetSession();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/sales_orders': () => jsonResponse({ errors: ['No orders found'] }, 404),
  });
  try {
    const r = await listarPedidos({ debtorNo: 999999, desde: '2025-01-01', hasta: '2026-01-01' });
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

// === obtenerClientePorId: relectura de verificacion post-PUT (#85) ===
// GET /api/v3/sales/customers/:id normalizado a los campos que consume
// calcularDiffFiscal (CustName/tax_id/street/...), para detectar el quirk de
// Operam (PUT 200 que ignora campos en silencio).

test('obtenerClientePorId: normaliza data.[0] (envelope) y devuelve los campos fiscales crudos', async () => {
  resetSession();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers/455': () => jsonResponse({ data: [{ customer_id: 455, CustName: 'Real SA', tax_id: 'REA010101AB1', street: 'Reforma', postal_code: '06600' }] }),
  });
  try {
    const c = await obtenerClientePorId(455);
    assert.equal(c.customer_id, 455);
    assert.equal(c.CustName, 'Real SA');
    assert.equal(c.tax_id, 'REA010101AB1');
    assert.equal(c.street, 'Reforma');
    assert.equal(c.postal_code, '06600');
  } finally {
    restore();
  }
});

test('obtenerClientePorId: tolera respuesta sin envelope (objeto plano)', async () => {
  resetSession();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers/456': () => jsonResponse({ customer_id: 456, CustName: 'Plano SA', tax_id: 'PLA010101AB1' }),
  });
  try {
    const c = await obtenerClientePorId(456);
    assert.equal(c.CustName, 'Plano SA');
    assert.equal(c.tax_id, 'PLA010101AB1');
  } finally {
    restore();
  }
});

// === obtenerDomicilios: prefactor issue #99 -- expone contacts[] del cliente ===
// con sus tags (base compartida con el slice de correos "invoices"), ademas de los
// domicilios (branches) que ya devolvia.

test('obtenerDomicilios: devuelve { domicilios, contacts } -- contacts trae tag/nombre/telefono/email del cliente', async () => {
  resetSession();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers/900': () => jsonResponse({
      data: [{
        customer_id: 900,
        branches: [{ branch_code: '1', br_name: 'Bodega Norte', contact_name: '', phone: '', email: '' }],
        contacts: [
          { action: 'general', name: 'Gustavo Barcia', phone: '55 4860 9144', email: 'gustavo_barcia@yahoo.com' },
          { action: 'invoice', name: 'Facturacion GUM', phone: '', email: 'factura@gum.com' },
        ],
      }],
    }),
    '/api/v3/sales/branches/1': () => jsonResponse({ data: [{ br_name: 'Bodega Norte', contact_name: '', phone: '', email: '' }] }),
  });
  try {
    const r = await obtenerDomicilios(900);
    assert.ok(Array.isArray(r.domicilios), 'domicilios debe ser array');
    assert.equal(r.domicilios[0].descripcion, 'Bodega Norte');
    assert.ok(Array.isArray(r.contacts), 'contacts debe ser array');
    assert.equal(r.contacts.length, 2);
    assert.equal(r.contacts[0].tag, 'general');
    assert.equal(r.contacts[0].nombre, 'Gustavo Barcia');
    assert.equal(r.contacts[0].telefono, '55 4860 9144');
    assert.equal(r.contacts[0].email, 'gustavo_barcia@yahoo.com');
    assert.equal(r.contacts[1].tag, 'invoice');
    assert.equal(r.contacts[1].nombre, 'Facturacion GUM');
  } finally {
    restore();
  }
});

test('obtenerDomicilios: contacts vacios/sin nombre-ni-telefono-ni-email se descartan', async () => {
  resetSession();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers/901': () => jsonResponse({
      data: [{
        customer_id: 901,
        branches: [],
        contacts: [{ action: 'general', name: '', phone: '', email: '' }],
      }],
    }),
  });
  try {
    const r = await obtenerDomicilios(901);
    assert.deepEqual(r.contacts, []);
  } finally {
    restore();
  }
});

test('obtenerDomicilios: cliente sin contacts -> contacts es []', async () => {
  resetSession();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers/902': () => jsonResponse({ data: [{ customer_id: 902, branches: [] }] }),
  });
  try {
    const r = await obtenerDomicilios(902);
    assert.deepEqual(r.contacts, []);
    assert.deepEqual(r.domicilios, []);
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

// === buildClienteBody() — parametros fiscales estandar para RFC generico (issue #121) ===
// Un RFC generico (XAXX/XEXX) no tiene datos fiscales reales: se normaliza SIEMPRE a
// los parametros de la casa, sin importar lo que el caller haya mandado (accordion de
// alta completa, alta generica automatica, o cualquier otro camino que cree un cliente
// con este tax_id).

test('buildClienteBody: RFC generico MX -> nombre en MAYUSCULAS, CP fiscal 56577, regimen 616, uso CFDI S01', () => {
  const body = buildClienteBody({ tax_id: 'XAXX010101000', CustName: 'hotel azul centro' });
  assert.strictEqual(body.cust_name, 'HOTEL AZUL CENTRO');
  assert.strictEqual(body.postal_code, '56577');
  assert.strictEqual(body.cfdi_regimen_fiscal, '616');
  assert.strictEqual(body.timbrado_uso_cfdi, 'S01');
});

test('buildClienteBody: RFC generico extranjero (XEXX) -> mismos parametros estandar', () => {
  const body = buildClienteBody({ tax_id: 'XEXX010101000', CustName: 'blue hotel llc' });
  assert.strictEqual(body.cust_name, 'BLUE HOTEL LLC');
  assert.strictEqual(body.postal_code, '56577');
  assert.strictEqual(body.cfdi_regimen_fiscal, '616');
  assert.strictEqual(body.timbrado_uso_cfdi, 'S01');
});

test('buildClienteBody: RFC generico -> ignora overrides explicitos de CP/regimen/uso CFDI/mayusculas del caller', () => {
  const body = buildClienteBody({
    tax_id: 'xaxx010101000', CustName: 'hotel azul centro',
    postal_code: '01000', cfdi_regimen_fiscal: '612', timbrado_uso_cfdi: 'G03',
  });
  assert.strictEqual(body.cust_name, 'HOTEL AZUL CENTRO');
  assert.strictEqual(body.postal_code, '56577');
  assert.strictEqual(body.cfdi_regimen_fiscal, '616');
  assert.strictEqual(body.timbrado_uso_cfdi, 'S01');
});

test('buildClienteBody: RFC real -> sin overrides de RFC generico (comportamiento actual)', () => {
  const body = buildClienteBody({ tax_id: 'PNA010203ABC', CustName: 'hotel azul centro', postal_code: '01000' });
  assert.strictEqual(body.cust_name, 'hotel azul centro');
  assert.strictEqual(body.postal_code, '01000');
  assert.strictEqual(body.cfdi_regimen_fiscal, '612');
  assert.strictEqual(body.timbrado_uso_cfdi, 'S01');
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
    // La vigencia va en comments: la API del quote no permite setear "Valido hasta" (HITL #68).
    assert.ok(/Valido hasta: 2026-07-17/.test(quoteBody.comments || ''), 'la vigencia (valido hasta) va en comments');
  } finally {
    restore();
  }
});

async function subirYCapturarCustRef(cliente, customerId) {
  resetSession();
  let quoteBody = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers': () => jsonResponse({
      total: 1,
      data: [{ customer_id: customerId, tax_id: cliente.rfc, CustName: cliente.razonSocial || '', branches: [{ branch_code: 88 }] }],
    }),
    '/api/v3/sales/quote': (url, opts) => {
      quoteBody = JSON.parse(opts.body);
      return jsonResponse({ result: true, quote_id: customerId });
    },
  });
  try {
    await subirCotizacionOperam({
      fecha: '2026-06-17',
      cliente,
      items: [{ codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 1, precio: 100 }],
    });
    return quoteBody.cust_ref;
  } finally {
    restore();
  }
}

test('subirCotizacionOperam: cust_ref cae a nombreCorto si no hay referencia', async () => {
  const custRef = await subirYCapturarCustRef({
    rfc: 'CPE921211N76', razonSocial: 'El Pendulo SA de CV', nombreCorto: 'El Pendulo',
  }, 322);
  assert.equal(custRef, 'El Pendulo', 'cust_ref debe caer a cliente.nombreCorto');
});

test('subirCotizacionOperam: cust_ref cae a razonSocial si no hay referencia ni nombreCorto', async () => {
  const custRef = await subirYCapturarCustRef({
    rfc: 'CPE921211N76', razonSocial: 'El Pendulo SA de CV',
  }, 323);
  assert.equal(custRef, 'El Pendulo SA de CV', 'cust_ref debe caer a cliente.razonSocial');
});

test('subirCotizacionOperam: cust_ref cae a nombreEntrega si no hay referencia, nombreCorto ni razonSocial', async () => {
  const custRef = await subirYCapturarCustRef({
    rfc: 'CPE921211N76', nombreEntrega: 'Almacen Roma',
  }, 324);
  assert.equal(custRef, 'Almacen Roma', 'cust_ref debe caer a cliente.nombreEntrega');
});

test('subirCotizacionOperam: campos de solo espacios en blanco cuentan como vacios', async () => {
  const custRef = await subirYCapturarCustRef({
    rfc: 'CPE921211N76', razonSocial: 'El Pendulo SA de CV',
    referencia: '   ', nombreCorto: '\t',
  }, 325);
  assert.equal(custRef, 'El Pendulo SA de CV', 'los escalones de solo espacios deben tratarse como vacios');
});

test('subirCotizacionOperam: cust_ref se trunca a 60 caracteres', async () => {
  const razonSocialLarga = 'A'.repeat(80);
  const custRef = await subirYCapturarCustRef({
    rfc: 'CPE921211N76', razonSocial: razonSocialLarga,
  }, 326);
  assert.equal(custRef.length, 60, 'cust_ref no debe exceder 60 caracteres');
  assert.equal(custRef, 'A'.repeat(60));
});

test('subirCotizacionOperam: si los cuatro escalones estan vacios, cust_ref queda vacio y no falla', async () => {
  const custRef = await subirYCapturarCustRef({
    rfc: 'CPE921211N76',
  }, 327);
  assert.equal(custRef, '', 'sin ningun escalon disponible, cust_ref debe quedar vacio sin lanzar error');
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
    // 2026-06-17 + 30 dias = 2026-07-17, entregado en comments (la API no setea "Valido hasta")
    assert.ok(/Valido hasta: 2026-07-17/.test(quoteBody.comments || ''), 'sin vigencia explicita: fecha+30 en comments');
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

// #137: el flete deja de fijar Disc 0 -- el vendedor puede bonificar el envio y
// el quote de Operam tiene que decir lo mismo que el documento del cliente.
test('subirCotizacionOperam: el descuento de la partida de envio viaja en su Disc', async () => {
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
      cliente: { rfc: 'CPE921211N76', razonSocial: 'El Pendulo', cpEntrega: '44100' },
      items: [
        { codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 10, precio: 100, descuento: 12 },
        { codigo: 'ENVIO', descripcion: 'Envio FedEx', cantidad: 1, precio: 480, descuento: 35 },
      ],
    });
    const flete = partidaFlete(quoteBody);
    assert.equal(flete.Disc, 35, 'el flete lleva su propio descuento, ya no un 0 fijo');
    const producto = quoteBody.items.find(i => i.stock_id === 'CR20-PLATO');
    assert.equal(producto.Disc, 12);
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

// #107: pruebas directas de la funcion pura, sin pasar por subirCotizacionOperam.
test('armarComentariosQuote: notas puntuadas, sin envio -> sin "..", una nota por linea', () => {
  const comments = armarComentariosQuote(['A.', 'B.'], '2026-07-17', []);
  assert.equal(comments, '- A.\n- B.\nValido hasta: 2026-07-17');
  assert.equal(/\.\./.test(comments), false);
});

test('armarComentariosQuote: nota sin punto final no se pega a la siguiente linea', () => {
  const comments = armarComentariosQuote(['Precio sujeto a cambio'], '2026-07-17', []);
  assert.equal(comments, '- Precio sujeto a cambio\nValido hasta: 2026-07-17');
});

test('armarComentariosQuote: sin notas -> solo Valido hasta (mas envio si aplica)', () => {
  assert.equal(armarComentariosQuote([], '2026-07-17', []), 'Valido hasta: 2026-07-17');
  assert.equal(armarComentariosQuote(null, '2026-07-17', []), 'Valido hasta: 2026-07-17');
});

test('armarComentariosQuote: notas de solo espacios se descartan igual que vacias', () => {
  const comments = armarComentariosQuote(['A.', '   ', 'B.'], '2026-07-17', []);
  assert.equal(comments, '- A.\n- B.\nValido hasta: 2026-07-17');
});

test('armarComentariosQuote: envio Lalamove va despues de Valido hasta, sin ".."', () => {
  const comments = armarComentariosQuote(['A.'], '2026-07-17', [{ descripcion: 'Lalamove auto', precio: 250 }]);
  assert.equal(comments, '- A.\nValido hasta: 2026-07-17\nEnvio: Lalamove auto $250');
  assert.equal(/\.\./.test(comments), false);
});

// #107: las notas ya llegan puntuadas (el vendedor las captura como vinetas terminadas
// en punto). join('. ') sobre eso producia ".." -- ahora cada nota es su propia linea
// con vineta, sin agregar puntuacion nueva.
test('subirCotizacionOperam: comments no lleva ".." con notas ya puntuadas', async () => {
  resetSession();
  let quoteBody = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers': () => jsonResponse({
      total: 1,
      data: [{ customer_id: 340, tax_id: 'CPE921211N76', CustName: 'El Pendulo', branches: [{ branch_code: 88 }] }],
    }),
    '/api/v3/sales/quote': (url, opts) => {
      quoteBody = JSON.parse(opts.body);
      return jsonResponse({ result: true, quote_id: 1600 });
    },
  });
  try {
    await subirCotizacionOperam({
      fecha: '2026-06-17',
      vigencia: '2026-07-17',
      cliente: { rfc: 'CPE921211N76', razonSocial: 'El Pendulo' },
      items: [{ codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 10, precio: 100, descuento: 0 }],
      notas: ['A.', 'B.'],
    });
    assert.equal(/\.\./.test(quoteBody.comments || ''), false, 'comments no debe contener ".."');
    assert.equal(quoteBody.comments, '- A.\n- B.\nValido hasta: 2026-07-17');
  } finally {
    restore();
  }
});

test('subirCotizacionOperam: una nota sin punto final no queda pegada a la siguiente', async () => {
  resetSession();
  let quoteBody = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers': () => jsonResponse({
      total: 1,
      data: [{ customer_id: 341, tax_id: 'CPE921211N76', CustName: 'El Pendulo', branches: [{ branch_code: 88 }] }],
    }),
    '/api/v3/sales/quote': (url, opts) => {
      quoteBody = JSON.parse(opts.body);
      return jsonResponse({ result: true, quote_id: 1601 });
    },
  });
  try {
    await subirCotizacionOperam({
      fecha: '2026-06-17',
      vigencia: '2026-07-17',
      cliente: { rfc: 'CPE921211N76', razonSocial: 'El Pendulo' },
      items: [{ codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 10, precio: 100, descuento: 0 }],
      notas: ['Precio sujeto a cambio', 'Pago de contado'],
    });
    assert.equal(quoteBody.comments, '- Precio sujeto a cambio\n- Pago de contado\nValido hasta: 2026-07-17');
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

// Lecturas read-only para el backfill (issue #76). GET de la cabecera de un quote
// por id y GET del cliente (debtor) por id. Toleran que la respuesta venga
// envuelta en `data` (array o no), como el resto de la API v3.

test('obtenerQuote: GET /api/v3/sales/quote/:id devuelve la cabecera del quote', async () => {
  resetSession();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/quote/1141': () => jsonResponse({
      data: [{
        trans_no: 1141, ord_date: '2026-05-20', delivery_date: '2026-06-19',
        cust_ref: 'Tienda Juana', total: '16954', salesman: 8,
        detalles: [{ stock_id: 'SA08A3001112', qty: 10 }],
      }],
    }),
  });
  try {
    const q = await obtenerQuote(1141);
    assert.equal(q.trans_no, 1141);
    assert.equal(q.cust_ref, 'Tienda Juana');
    assert.equal(q.delivery_date, '2026-06-19');
    assert.equal(q.total, '16954');
    assert.equal(q.salesman, 8);
  } finally {
    restore();
  }
});

test('obtenerQuote: tolera respuesta sin envoltura data (objeto directo)', async () => {
  resetSession();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/quote/1200': () => jsonResponse({
      trans_no: 1200, ord_date: '2026-06-01', total: '500',
    }),
  });
  try {
    const q = await obtenerQuote(1200);
    assert.equal(q.trans_no, 1200);
    assert.equal(q.total, '500');
  } finally {
    restore();
  }
});

test('obtenerCliente: GET /api/v3/sales/customers/:id devuelve el cliente (debtor) con RFC y moneda', async () => {
  resetSession();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers/394': () => jsonResponse({
      data: [{
        customer_id: 394, CustName: 'JUANA HERNANDEZ GARCIA', tax_id: 'HEGJ800101AB1',
        curr_code: 'MXN', branches: [{ branch_code: 400 }],
      }],
    }),
  });
  try {
    const c = await obtenerCliente(394);
    assert.equal(c.CustName, 'JUANA HERNANDEZ GARCIA');
    assert.equal(c.tax_id, 'HEGJ800101AB1');
    assert.equal(c.curr_code, 'MXN');
  } finally {
    restore();
  }
});

test('obtenerCliente: un 404 (cliente inexistente) devuelve null, no lanza', async () => {
  resetSession();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/customers/999999': () => jsonResponse({ errors: ['No customers found'] }, 404),
  });
  try {
    assert.equal(await obtenerCliente(999999), null);
  } finally {
    restore();
  }
});

// === Huella del contenido que viaja al quote (issue #114) ===
// Regenerar una cotizacion ya subida debe reescribir su quote SOLO si el contenido
// cambio: sin esto, o el quote se queda con lo viejo mientras el documento sale
// numerado con lo nuevo (el bug de #114), o cada "genera el PDF y ahora el HTML"
// dispararia una reescritura completa por la web legacy sin motivo.
const { huellaContenidoQuote, contenidoQuoteCambio } = await import('../lib/operam-client.js');

function cotizacionBase(extra = {}) {
  return {
    fecha: '2026-07-29',
    vigencia: '2026-08-28',
    cliente: { rfc: 'CPE921211N76', razonSocial: 'El Pendulo', nombreCorto: 'Pendulo', cpEntrega: '56530', customerId: 376 },
    items: [{ codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 10, precio: 100, descuento: 0 }],
    notas: ['Precio sujeto a cambio'],
    subtotal: 1000, iva: 160, total: 1160,
    ...extra,
  };
}

test('#114 huellaContenidoQuote: el mismo contenido produce la misma huella', () => {
  assert.equal(huellaContenidoQuote(cotizacionBase()), huellaContenidoQuote(cotizacionBase()));
});

// #115: la vigencia SI viaja al quote (comments + "Valido hasta"), asi que cambiarla
// tiene que reescribirlo. Lo que no puede contar es la FECHA absoluta, que el frontend
// recalcula en cada generacion: cuenta el PLAZO en dias que eligio el vendedor.
test('#115 huellaContenidoQuote: los DIAS de vigencia SI cuentan como cambio', () => {
  const base = huellaContenidoQuote(cotizacionBase());
  // misma fecha de generacion, vigencia mas larga = otro plazo elegido (30 -> 63 dias)
  assert.notEqual(huellaContenidoQuote(cotizacionBase({ vigencia: '2026-09-30' })), base);
});

test('#115 huellaContenidoQuote: el mismo plazo en otra fecha de generacion NO cuenta como cambio', () => {
  const base = huellaContenidoQuote(cotizacionBase());
  // generar el mismo carrito al dia siguiente: fecha y vigencia se mueven juntas
  assert.equal(huellaContenidoQuote(cotizacionBase({ fecha: '2026-07-30', vigencia: '2026-08-29' })), base);
});

// El plazo se deriva con las mismas reglas que construyen el comments que SI se sube,
// defaults incluidos (sin vigencia = fecha + 30). Por eso sin vigencia explicita el plazo
// es constante y mover la fecha de generacion no es un cambio, mientras que fijar otra
// vigencia si lo es: cambia la linea que Operam va a mostrar.
test('#115 huellaContenidoQuote: sin vigencia explicita el plazo es el default y la fecha no lo mueve', () => {
  const sinVigencia = (extra) => huellaContenidoQuote(cotizacionBase({ vigencia: '', ...extra }));
  assert.equal(sinVigencia(), sinVigencia({ fecha: '2026-12-01' }));
});

test('#115 huellaContenidoQuote: fijar una vigencia distinta SI cambia la huella', () => {
  const sinFecha = (extra) => huellaContenidoQuote(cotizacionBase({ fecha: '', ...extra }));
  assert.notEqual(sinFecha(), sinFecha({ vigencia: '2026-12-01' }));
});

// #115 (segunda parte): las notas SI viajan al quote -- armarComentariosQuote las mete
// en `comments`, una linea por nota -- asi que editarlas deja el comments de Operam
// desactualizado si no se reescribe. El argumento del ruido que justifica excluir la
// FECHA de vigencia no aplica aqui: las notas solo cambian si el vendedor las edita.
test('#115 huellaContenidoQuote: las notas SI cuentan como cambio (viajan a comments)', () => {
  const base = huellaContenidoQuote(cotizacionBase());
  assert.notEqual(huellaContenidoQuote(cotizacionBase({ notas: ['Otra nota'] })), base);
  assert.notEqual(huellaContenidoQuote(cotizacionBase({ notas: [] })), base, 'quitar las notas tambien');
  assert.notEqual(huellaContenidoQuote(cotizacionBase({ notas: ['Precio sujeto a cambio', 'Nota extra'] })), base,
    'agregar una nota tambien');
});

test('#115 huellaContenidoQuote: el formato del documento NO cuenta como cambio', () => {
  const base = huellaContenidoQuote(cotizacionBase());
  assert.equal(huellaContenidoQuote(cotizacionBase({ incluirFotos: true })), base);
});

// Lalamove no es partida del quote (#72 pendiente): viaja en comments. Un cambio de su
// descripcion con el mismo precio no mueve items ni importes, asi que solo lo caza el
// comments.
test('#115 huellaContenidoQuote: la descripcion de un envio Lalamove SI cuenta como cambio', () => {
  const conLalamove = (desc) => huellaContenidoQuote(cotizacionBase({
    items: [
      { codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 10, precio: 100, descuento: 0 },
      { codigo: 'ENVIO', descripcion: desc, cantidad: 1, precio: 666, descuento: 0 },
    ],
  }));
  assert.notEqual(conLalamove('Lalamove camioneta'), conLalamove('Lalamove moto'));
});

// #137: bonificar el flete es un cambio de contenido del quote como cualquier otro.
test('#137 huellaContenidoQuote: el descuento del envio SI cuenta como cambio', () => {
  const conFlete = (descuento) => huellaContenidoQuote(cotizacionBase({
    items: [
      { codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 10, precio: 100, descuento: 0 },
      { codigo: 'ENVIO', descripcion: 'Envio FedEx', cantidad: 1, precio: 480, descuento },
    ],
  }));
  assert.notEqual(conFlete(50), conFlete(0));
});

test('#114 huellaContenidoQuote: cantidad, precio, descuento y codigo SI cuentan como cambio', () => {
  const base = huellaContenidoQuote(cotizacionBase());
  const conItems = (i) => huellaContenidoQuote(cotizacionBase({ items: [{ codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 10, precio: 100, descuento: 0, ...i }] }));
  assert.notEqual(conItems({ cantidad: 11 }), base);
  assert.notEqual(conItems({ precio: 99 }), base);
  assert.notEqual(conItems({ descuento: 5 }), base);
  assert.notEqual(conItems({ codigo: 'CR20-TAZA' }), base);
});

test('#114 huellaContenidoQuote: los importes SI cuentan como cambio', () => {
  assert.notEqual(huellaContenidoQuote(cotizacionBase({ total: 2000 })), huellaContenidoQuote(cotizacionBase()));
});

test('#114 huellaContenidoQuote: el cliente del quote SI cuenta como cambio', () => {
  const base = huellaContenidoQuote(cotizacionBase());
  assert.notEqual(huellaContenidoQuote(cotizacionBase({ cliente: { ...cotizacionBase().cliente, customerId: 999 } })), base);
  // nombreCorto alimenta el cust_ref del quote (#108)
  assert.notEqual(huellaContenidoQuote(cotizacionBase({ cliente: { ...cotizacionBase().cliente, nombreCorto: 'Otro' } })), base);
});

// El envio es una PARTIDA del quote (#68): su precio y el SKU de flete que resuelve
// el CP de entrega (local vs foraneo) son contenido, no presentacion.
test('#114 huellaContenidoQuote: el envio y la zona del CP de entrega SI cuentan como cambio', () => {
  const conEnvio = (extra = {}) => cotizacionBase({
    items: [
      { codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 10, precio: 100, descuento: 0 },
      { codigo: 'ENVIO', descripcion: 'FedEx Ground', cantidad: 1, precio: 350, descuento: 0 },
    ],
    ...extra,
  });
  const base = huellaContenidoQuote(conEnvio());
  assert.notEqual(base, huellaContenidoQuote(cotizacionBase()), 'agregar el envio es un cambio');
  const otroPrecio = conEnvio();
  otroPrecio.items[1].precio = 420;
  assert.notEqual(huellaContenidoQuote(otroPrecio), base);
  assert.notEqual(huellaContenidoQuote(conEnvio({ cliente: { ...cotizacionBase().cliente, cpEntrega: '44100' } })), base,
    'el CP de entrega decide el SKU de flete (local/foraneo)');
});

test('#114 contenidoQuoteCambio: contra la huella de lo subido, sin cambios es false', () => {
  const data = cotizacionBase();
  assert.equal(contenidoQuoteCambio(data, huellaContenidoQuote(data)), false);
  assert.equal(contenidoQuoteCambio(cotizacionBase({ incluirFotos: true }), huellaContenidoQuote(data)), false);
  assert.equal(contenidoQuoteCambio(cotizacionBase({ total: 99 }), huellaContenidoQuote(data)), true);
  // #115: las notas viajan a comments, editarlas hay que llevarlo al quote
  assert.equal(contenidoQuoteCambio(cotizacionBase({ notas: ['Otra'] }), huellaContenidoQuote(data)), true);
  // #115: otro plazo de vigencia SI es un cambio que hay que llevar al quote
  assert.equal(contenidoQuoteCambio(cotizacionBase({ vigencia: '2026-12-31' }), huellaContenidoQuote(data)), true);
});

// Cotizaciones anteriores a #114: se subieron sin dejar huella. No se puede afirmar
// que el quote coincida, y el riesgo de NO reescribir (documento numerado que diverge)
// es peor que el de reescribirlo con el contenido que el cotizador ya tiene.
test('#114 contenidoQuoteCambio: sin huella previa asume que cambio', () => {
  assert.equal(contenidoQuoteCambio(cotizacionBase(), null), true);
  assert.equal(contenidoQuoteCambio(cotizacionBase(), undefined), true);
  assert.equal(contenidoQuoteCambio(cotizacionBase(), ''), true);
});

// === Lectores del catalogo (#128, padre #120) — read-only y paginados ===

// "Bazaar" (id 18) esta INACTIVA en Operam y aun asi tiene 461 filas vivas en
// prices_list: sin show_inactive=1 la lista no aparece y sus precios quedan sin lista
// a la que pertenecen. Por eso el lector del catalogo la pide explicitamente.
test('listarSalesTypes: con showInactive pide show_inactive=1 (Bazaar esta inactiva y tiene precios vivos)', async () => {
  resetSession();
  const urls = [];
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/sales_types': (url) => {
      urls.push(url);
      return jsonResponse({ total: 2, data: [
        { id: '12', sales_type: 'Precio de lista', factor: '1', inactive: '0' },
        { id: '18', sales_type: 'Bazaar', factor: '0.5', inactive: '1' },
      ] });
    },
  });
  try {
    const listas = await listarSalesTypes({ showInactive: true });
    assert.deepEqual(listas.map(l => l.sales_type), ['Precio de lista', 'Bazaar']);
    assert.equal(urls.length, 1);
    assert.match(urls[0], /show_inactive=1/);
  } finally {
    restore();
  }
});

test('listarSalesTypes: sin showInactive no manda show_inactive', async () => {
  resetSession();
  const urls = [];
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/sales_types': (url) => { urls.push(url); return jsonResponse({ total: 0, data: [] }); },
  });
  try {
    await listarSalesTypes();
    assert.equal(/show_inactive/.test(urls[0]), false);
  } finally {
    restore();
  }
});

// prices_list son ~2,010 filas y items ~1,603: se vuelcan completos en paginas de 500
// (verificado en vivo el 2026-08-03) hasta agotar el total que reporta la API.
test('listarPreciosCompletos: pagina de 500 en 500 hasta agotar el total', async () => {
  resetSession();
  const urls = [];
  const total = 1100;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/prices_list': (url) => {
      urls.push(url);
      const skip = Number(new URL(url).searchParams.get('skip'));
      const n = Math.min(500, total - skip);
      const data = Array.from({ length: n }, (_, i) => ({ stock_id: `SKU${skip + i}`, sales_type_id: '12', price: '10' }));
      return jsonResponse({ total, data });
    },
  });
  try {
    const filas = await listarPreciosCompletos();
    assert.equal(filas.length, total);
    assert.equal(urls.length, 3);
    assert.match(urls[0], /limit=500&skip=0/);
    assert.match(urls[1], /limit=500&skip=500/);
    assert.match(urls[2], /limit=500&skip=1000/);
    assert.equal(filas[1099].stock_id, 'SKU1099');
  } finally {
    restore();
  }
});

test('listarItemsCompletos: pagina el maestro de articulos igual que los precios', async () => {
  resetSession();
  const urls = [];
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/inventory/items': (url) => {
      urls.push(url);
      const skip = Number(new URL(url).searchParams.get('skip'));
      const n = Math.min(500, 600 - skip);
      return jsonResponse({ total: 600, data: Array.from({ length: n }, (_, i) => ({ stock_id: `IT${skip + i}`, description: 'x' })) });
    },
  });
  try {
    const items = await listarItemsCompletos();
    assert.equal(items.length, 600);
    assert.equal(urls.length, 2);
  } finally {
    restore();
  }
});

// Los tres lectores son GET y nada mas: un volcado de catalogo no puede escribir en
// el ERP ni por accidente.
test('los lectores del catalogo son read-only (solo GET)', async () => {
  resetSession();
  const metodos = new Set();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/sales_types': (url, opts) => { metodos.add(opts?.method); return jsonResponse({ total: 0, data: [] }); },
    '/api/v3/sales/prices_list': (url, opts) => { metodos.add(opts?.method); return jsonResponse({ total: 0, data: [] }); },
    '/api/v3/inventory/items': (url, opts) => { metodos.add(opts?.method); return jsonResponse({ total: 0, data: [] }); },
  });
  try {
    await listarSalesTypes({ showInactive: true });
    await listarPreciosCompletos();
    await listarItemsCompletos();
    assert.deepEqual([...metodos], ['GET']);
  } finally {
    restore();
  }
});

// El volcado completo son ~10 lecturas seguidas: tienen que pasar por el mismo
// throttle proactivo anti-429 que usa el backfill (#76).
test('listarPreciosCompletos: sus paginas pasan por el throttle proactivo', async () => {
  resetSession();
  _setMinInterval(40);
  const tiempos = [];
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/sales/prices_list': (url) => {
      tiempos.push(Date.now());
      const skip = Number(new URL(url).searchParams.get('skip'));
      return jsonResponse({ total: 1200, data: Array.from({ length: Math.min(500, 1200 - skip) }, () => ({ stock_id: 'X', sales_type_id: '12', price: '1' })) });
    },
  });
  try {
    await listarPreciosCompletos();
    assert.equal(tiempos.length, 3);
    const total = tiempos[2] - tiempos[0];
    assert.ok(total >= 70, `total=${total}ms entre la 1a y la 3a pagina debe ser >= ~80 (2 intervalos de 40ms)`);
  } finally {
    restore();
    _setMinInterval(0);
  }
});

// Si la respuesta no trae `total`, la unica senal de fin es la pagina incompleta:
// dar por terminado el volcado en la primera pagina llena lo truncaria en silencio.
test('listarItemsCompletos: sin total en la respuesta sigue paginando hasta la pagina incompleta', async () => {
  resetSession();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse(LOGIN_RESPONSE),
    '/api/v3/inventory/items': (url) => {
      const skip = Number(new URL(url).searchParams.get('skip'));
      const n = Math.min(500, 900 - skip);
      return jsonResponse({ data: Array.from({ length: n }, (_, i) => ({ stock_id: `IT${skip + i}` })) });
    },
  });
  try {
    const items = await listarItemsCompletos();
    assert.equal(items.length, 900);
  } finally {
    restore();
  }
});
