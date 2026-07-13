import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, unlinkSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

// Alta temprana de cliente generico al subir una cotizacion (issue #81, ADR-0006):
// una cotizacion de una oportunidad SIN cliente en Operam deduplica en capas
// (celular contra prospectos -> nombre contra los genericos de Operam, ADR-0001),
// crea el cliente generico y sube la cotizacion a su nombre como UNA operacion
// server-side con reporte de pasos (estilo /api/crear-cliente, ADR-0002). Todo por
// el seam HTTP con el patron mockOperamFetch de server.test.js.

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const COTS_PATH = join(DATA_DIR, 'cotizaciones.json');
const PROSPECTOS_PATH = join(DATA_DIR, 'prospectos.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app, cargarListasPrecios } = await import('../server.js');
const { resetSession } = await import('../lib/operam-client.js');
const TOKEN = jwt.sign({ id: 99, name: 'Tester', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

function readJson(path) { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : []; }
function writeJson(path, data) { writeFileSync(path, JSON.stringify(data, null, 2)); }

const originalFetch = globalThis.fetch;
const fetchBloqueado = async (url) => { throw new Error('fetch sin mock en tests: ' + url); };

function mockOperamFetch(handlers) {
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    for (const [pat, fn] of Object.entries(handlers)) {
      if (u.includes(pat)) return fn(u, opts);
    }
    throw new Error('Unmocked fetch: ' + u);
  };
}

function jsonResponse(data, status = 200) {
  return { ok: status < 400, status, json: async () => data };
}

let savedCots, savedProspectos, existiaProspectos;
before(() => {
  savedCots = readJson(COTS_PATH);
  existiaProspectos = existsSync(PROSPECTOS_PATH);
  savedProspectos = readJson(PROSPECTOS_PATH);
});
after(() => {
  writeJson(COTS_PATH, savedCots);
  if (existiaProspectos) writeJson(PROSPECTOS_PATH, savedProspectos);
  else if (existsSync(PROSPECTOS_PATH)) unlinkSync(PROSPECTOS_PATH);
  globalThis.fetch = originalFetch;
});
beforeEach(() => {
  globalThis.fetch = fetchBloqueado;
  resetSession();
});

const CELULAR = '+52 5588776655';

// Cotizacion de Prospecto Minimo: sin customerId y sin RFC real (la oportunidad
// no tiene cliente en Operam). El vendedor existe en data/vendedores.json con
// operam_id 2; el tier M100 es la lista de precios que cotizo.
function nuevaCotizacion(cliente = {}, tier = 'M100') {
  const cots = readJson(COTS_PATH);
  const id = cots.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  cots.push({
    id, fecha: '2026-07-06T00:00:00Z', vendedor: 'Alejandro Chávez', cliente: 'Hotel Azul',
    totalPiezas: 100, total: 11600, tier,
    data: {
      fecha: '2026-07-06', vigencia: '2026-08-05',
      cliente: { razonSocial: 'Hotel Azul Centro', nombreCorto: 'Hotel Azul', telefono: CELULAR, pais: 'MX', ...cliente },
      items: [{ codigo: 'PV08', descripcion: 'Plato', cantidad: 100, precio: 100, descuento: 0 }],
    },
  });
  writeJson(COTS_PATH, cots);
  return id;
}

function prospectoBase(extraData = {}) {
  return {
    id: 1, fecha: '2026-07-01T00:00:00Z', vendedor: 'Alejandro Chávez',
    celular: CELULAR, celular10: '5588776655', nombre: 'Hotel Azul', ciudad: 'CDMX',
    canal: 'WhatsApp', etapa: 'seguimiento', eventos: [], data: { ...extraData },
  };
}

test('G1: cotizacion sin cliente crea el generico y sube la cotizacion a su nombre (orden, payloads, persistencia)', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  const id = nuevaCotizacion();
  const llamadas = [];
  let clienteBody = null;
  let quoteBody = null;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/sales_types': () => jsonResponse({ data: [{ id: '15', sales_type: 'M100', inactive: '0' }] }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { llamadas.push('POST customer'); clienteBody = JSON.parse(opts.body); return jsonResponse({ result: true, customer_id: 910 }); }
      if (opts?.method === 'PUT') { llamadas.push('PUT customer'); return jsonResponse({ result: true }); }
      if (u.includes('/910')) { llamadas.push('GET customer'); return jsonResponse({ data: [{ branches: [{ branch_code: 911 }] }] }); }
      // MINA (#81): la dedup por RFC EXACTO de crearCliente matchearia este otro
      // generico y reutilizaria el cliente EQUIVOCADO. El flujo debe saltarla.
      if (u.includes('tax_id=')) { llamadas.push('GET tax_id'); return jsonResponse({ total: 1, data: [{ customer_id: 444, CustName: 'OTRO GENERICO SA', tax_id: 'XAXX010101000', branches: [{ branch_code: 445 }] }] }); }
      // Dedup por nombre (ADR-0001): hay genericos pero ninguno con nombre similar.
      llamadas.push('GET search');
      return jsonResponse({ total: 1, data: [{ customer_id: 444, CustName: 'FERRETERIA EL CLAVO', cust_ref: 'El Clavo', tax_id: 'XAXX010101000' }] });
    },
    '/api/v3/sales/quote': (u, opts) => { llamadas.push('POST quote'); quoteBody = JSON.parse(opts.body); return jsonResponse({ result: true, added_trans_no: 1701 }); },
  });
  await cargarListasPrecios();

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.folio, 1701);
  assert.equal(res.body.customer_id, 910);
  assert.ok(Array.isArray(res.body.steps), 'la respuesta reporta los pasos (ADR-0002)');
  assert.ok(res.body.steps.every(s => s.name && s.status === 'ok'), 'todos los pasos en ok');

  // Orden: primero el POST del cliente, despues la cotizacion a su nombre.
  assert.ok(llamadas.includes('POST customer'));
  assert.ok(llamadas.indexOf('POST customer') < llamadas.indexOf('POST quote'));

  // Cliente generico: RFC generico nacional, nombre y vendedor REALES, lista de
  // precios de la cotizacion (tier M100 -> id 15 en Operam) y uso CFDI default.
  assert.equal(clienteBody.tax_id, 'XAXX010101000');
  assert.equal(clienteBody.cust_name, 'Hotel Azul Centro');
  assert.equal(clienteBody.salesman, 2, 'Alejandro Chavez -> operam_id 2 de data/vendedores.json');
  assert.equal(clienteBody.sales_type, '15');
  assert.equal(clienteBody.timbrado_uso_cfdi, 'S01');

  // La cotizacion va al cliente creado y a SU branch (no al fallback 1).
  assert.equal(quoteBody.customer_id, 910);
  assert.equal(quoteBody.branch_id, 911);

  // Persistencia: folio y customer_id en la cotizacion; customer_id en el prospecto.
  const cot = readJson(COTS_PATH).find(c => c.id === id);
  assert.equal(String(cot.folioOperam), '1701');
  assert.equal(cot.data.cliente.customerId, 910);
  const p = readJson(PROSPECTOS_PATH).find(x => x.id === 1);
  assert.equal(p.data.cliente_id, 910, 'el prospecto ES el mapeo celular -> customer_id');
  assert.ok(p.eventos.some(e => e.tipo === 'cliente' && e.cliente_id === 910));

  // Auditoria del alta generica con fuente distinguible (clientes_log via logCliente).
  const audit = res.body.steps.find(s => s.name === 'log auditoria');
  assert.ok(audit, 'reporta el paso de auditoria');
  assert.equal(audit.info, 'cotizador-generico');
});

test('G1b: tier Menudeo (sin lista homonima en Operam) -> sales_type cae a "Precio de lista", nunca se omite (issue #92)', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  const id = nuevaCotizacion({}, 'Menudeo');
  let clienteBody = null;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/sales_types': () => jsonResponse({ data: [
      { id: '1', sales_type: 'M550', inactive: '0' },
      { id: '12', sales_type: 'Precio de lista', inactive: '0' },
      { id: '15', sales_type: 'M100', inactive: '0' },
    ] }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { clienteBody = JSON.parse(opts.body); return jsonResponse({ result: true, customer_id: 910 }); }
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      if (u.includes('/910')) return jsonResponse({ data: [{ branches: [{ branch_code: 911 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/quote': (u, opts) => jsonResponse({ result: true, added_trans_no: 1701 }),
  });
  await cargarListasPrecios();

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});

  assert.equal(res.status, 200);
  assert.ok(clienteBody, 'se debio crear el cliente');
  assert.equal(clienteBody.sales_type, '12', 'Menudeo sin lista homonima -> "Precio de lista" (id 12), nunca omitido');
});

test('G2: celular ya convertido en cliente -> reutiliza el customer_id, no crea un segundo generico', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase({ cliente_id: 555 })]);
  const id = nuevaCotizacion();
  let postCustomer = false;
  let quoteBody = null;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { postCustomer = true; return jsonResponse({ result: true, customer_id: 999 }); }
      if (u.includes('/555')) return jsonResponse({ data: [{ branches: [{ branch_code: 556 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/quote': (u, opts) => { quoteBody = JSON.parse(opts.body); return jsonResponse({ result: true, added_trans_no: 1702 }); },
  });

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.customer_id, 555);
  assert.equal(postCustomer, false, 'NO debe crear un segundo cliente generico');
  assert.equal(quoteBody.customer_id, 555);
  const cot = readJson(COTS_PATH).find(c => c.id === id);
  assert.equal(cot.data.cliente.customerId, 555);
  assert.equal(String(cot.folioOperam), '1702');
});

test('G3: nombre similar a un generico de Operam -> 409 con candidatos, sin crear y sin subir (sin escape)', async () => {
  writeJson(PROSPECTOS_PATH, []);
  // RFC generico capturado en el formulario: tampoco resuelve por RFC (ADR-0001).
  const id = nuevaCotizacion({ rfc: 'XAXX010101000' });
  let postCustomer = false;
  let quoteLlamado = false;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { postCustomer = true; return jsonResponse({ result: true, customer_id: 999 }); }
      return jsonResponse({ total: 2, data: [
        { customer_id: 10, CustName: 'HOTEL AZUL SA DE CV', cust_ref: 'Hotel Azul', tax_id: 'XAXX010101000' },
        { customer_id: 11, CustName: 'FERRETERIA EL CLAVO', cust_ref: 'El Clavo', tax_id: 'XAXX010101000' },
      ] });
    },
    '/api/v3/sales/quote': () => { quoteLlamado = true; return jsonResponse({ result: true, added_trans_no: 1 }); },
  });

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});

  assert.equal(res.status, 409);
  assert.ok(res.body.error);
  assert.ok(Array.isArray(res.body.candidatos), 'debe devolver los candidatos');
  assert.equal(res.body.candidatos.length, 1, 'solo el generico con nombre similar');
  assert.equal(res.body.candidatos[0].id, 10);
  assert.equal(postCustomer, false, 'no debe crear');
  assert.equal(quoteLlamado, false, 'no debe subir');
  const cot = readJson(COTS_PATH).find(c => c.id === id);
  assert.ok(!cot.folioOperam, 'la cotizacion sigue PRE');
  assert.equal(cot.data.cliente.customerId, undefined, 'no persiste customer_id');
});

test('G4: reintento con customerId elegido tras candidatos -> reutiliza, liga el prospecto y sube', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  const id = nuevaCotizacion();
  let postCustomer = false;
  let quoteBody = null;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { postCustomer = true; return jsonResponse({ result: true, customer_id: 999 }); }
      if (u.includes('/10')) return jsonResponse({ data: [{ branches: [{ branch_code: 20 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/quote': (u, opts) => { quoteBody = JSON.parse(opts.body); return jsonResponse({ result: true, added_trans_no: 1703 }); },
  });

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({ customerId: 10 });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.customer_id, 10);
  assert.equal(postCustomer, false, 'elegir candidato nunca crea');
  assert.equal(quoteBody.customer_id, 10);
  assert.equal(quoteBody.branch_id, 20);
  const p = readJson(PROSPECTOS_PATH).find(x => x.id === 1);
  assert.equal(p.data.cliente_id, 10, 'el prospecto queda ligado al cliente elegido');
  const cot = readJson(COTS_PATH).find(c => c.id === id);
  assert.equal(cot.data.cliente.customerId, 10);
  assert.equal(String(cot.folioOperam), '1703');
});

test('G5: reintento tras fallo parcial (cliente creado, subida fallida) no duplica cliente y retoma en la subida', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  const id = nuevaCotizacion();
  let postsCustomer = 0;

  // Intento 1: el cliente se crea pero la subida del quote falla (Operam 500).
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { postsCustomer++; return jsonResponse({ result: true, customer_id: 920 }); }
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      if (u.includes('/920')) return jsonResponse({ data: [{ branches: [{ branch_code: 921 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/quote': () => jsonResponse({ error: 'boom' }, 500),
  });
  const intento1 = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});
  assert.equal(intento1.status, 503);
  assert.equal(intento1.body.customer_id, 920, 'reporta el cliente ya creado');
  // El customer_id quedo persistido ANTES de la subida (idempotencia #81).
  let cot = readJson(COTS_PATH).find(c => c.id === id);
  assert.equal(cot.data.cliente.customerId, 920);
  assert.ok(!cot.folioOperam, 'sin folio: la subida fallo');
  assert.equal(readJson(PROSPECTOS_PATH)[0].data.cliente_id, 920);

  // Intento 2: encuentra el customer_id persistido y retoma en la subida.
  resetSession();
  let quoteBody = null;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { postsCustomer++; return jsonResponse({ result: true, customer_id: 999 }); }
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/quote': (u, opts) => { quoteBody = JSON.parse(opts.body); return jsonResponse({ result: true, added_trans_no: 1705 }); },
  });
  const intento2 = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});
  assert.equal(intento2.status, 200);
  assert.equal(intento2.body.folio, 1705);
  assert.equal(postsCustomer, 1, 'UN solo POST customer entre los dos intentos');
  assert.equal(quoteBody.customer_id, 920);
  assert.equal(quoteBody.branch_id, 921, 'reusa el branch persistido en el intento 1');
  cot = readJson(COTS_PATH).find(c => c.id === id);
  assert.equal(String(cot.folioOperam), '1705');
});

test('G6: cliente extranjero usa XEXX010101000 y deduplica contra los genericos extranjeros', async () => {
  writeJson(PROSPECTOS_PATH, []);
  const id = nuevaCotizacion({ pais: 'US', telefono: '+1 5551234567' });
  let clienteBody = null;
  let searchUrl = null;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { clienteBody = JSON.parse(opts.body); return jsonResponse({ result: true, customer_id: 930 }); }
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      if (u.includes('/930')) return jsonResponse({ data: [{ branches: [{ branch_code: 931 }] }] });
      searchUrl = u;
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/quote': () => jsonResponse({ result: true, added_trans_no: 1706 }),
  });

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(searchUrl.includes('XEXX010101000'), 'la dedup de nombre corre contra el generico extranjero');
  // F4: el pool de genericos crece por diseno (#81); la dedup no puede truncarse
  // al limit=10 default de buscarClientes.
  assert.ok(searchUrl.includes('limit=100'), 'la dedup generica consulta con limit=100');
  assert.equal(clienteBody.tax_id, 'XEXX010101000');
});

test('F1: cotizacion legacy sin datos del contacto -> 422 del camino viejo, cero llamadas a Operam', async () => {
  writeJson(PROSPECTOS_PATH, []);
  const cots = readJson(COTS_PATH);
  const id = cots.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  cots.push({
    id, fecha: '2026-01-01T00:00:00Z', vendedor: 'Tester', cliente: '',
    totalPiezas: 0, total: 0, tier: '', data: { cliente: {}, items: [] },
  });
  writeJson(COTS_PATH, cots);
  // fetch queda bloqueado (beforeEach): si el flujo tocara Operam, la respuesta
  // seria 503 y no el 422 limpio del camino viejo. Antes de F1 esto creaba un
  // cliente generico fantasma con CustName vacio.
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});
  assert.equal(res.status, 422);
  assert.match(res.body.error, /cliente/i);
  const cot = readJson(COTS_PATH).find(c => c.id === id);
  assert.ok(!cot.folioOperam, 'no persiste folio');
  assert.equal(cot.data.cliente.customerId, undefined, 'no persiste customer_id');
});

test('F2: fallo al ligar el prospecto no aborta la operacion (cliente creado y cotizacion subida)', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  const id = nuevaCotizacion();
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return jsonResponse({ result: true, customer_id: 950 });
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      if (u.includes('/950')) return jsonResponse({ data: [{ branches: [{ branch_code: 951 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/quote': () => jsonResponse({ result: true, added_trans_no: 1707 }),
  });
  // prospectos.json de solo lectura: buscarPorCelular (lee) funciona pero
  // ligarCliente (escribe) truena -- simula un fallo transitorio del store por el
  // seam del filesystem, sin seams nuevos.
  chmodSync(PROSPECTOS_PATH, 0o444);
  let res;
  try {
    res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
      .set('Authorization', `Bearer ${TOKEN}`).send({});
  } finally {
    chmodSync(PROSPECTOS_PATH, 0o666);
  }
  assert.equal(res.status, 200, 'la subida debe completarse pese al fallo de ligado');
  assert.equal(res.body.ok, true);
  assert.equal(res.body.folio, 1707);
  const ligar = res.body.steps.find(s => s.name === 'ligar prospecto');
  assert.ok(ligar, 'reporta el paso de ligar prospecto');
  assert.equal(ligar.status, 'error');
  const cot = readJson(COTS_PATH).find(c => c.id === id);
  assert.equal(cot.data.cliente.customerId, 950);
  assert.equal(String(cot.folioOperam), '1707');
  assert.equal(readJson(PROSPECTOS_PATH)[0].data.cliente_id, undefined, 'el prospecto quedo sin ligar (el fallo fue real)');
});

test('F3a: customerId elegido que difiere del ya ligado a la cotizacion -> 409 sin tocar Operam', async () => {
  writeJson(PROSPECTOS_PATH, []);
  const id = nuevaCotizacion({ customerId: 920 });
  // fetch bloqueado (beforeEach): la validacion debe frenar antes de cualquier llamada.
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({ customerId: 10 });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /difiere/i);
  assert.match(res.body.error, /920/);
});

test('F3b: customerId elegido que difiere del cliente ya ligado al celular -> 409 sin tocar Operam', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase({ cliente_id: 555 })]);
  const id = nuevaCotizacion();
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({ customerId: 10 });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /555/);
  const cot = readJson(COTS_PATH).find(c => c.id === id);
  assert.equal(cot.data.cliente.customerId, undefined, 'no persiste el elegido contradictorio');
});

test('F3c: con customerId elegido no se reutiliza un branchId persistido (pudo ser de otro cliente)', async () => {
  writeJson(PROSPECTOS_PATH, []);
  const id = nuevaCotizacion({ branchId: 77 });
  let quoteBody = null;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': (u) => {
      if (u.includes('/10')) return jsonResponse({ data: [{ branches: [{ branch_code: 20 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/quote': (u, opts) => { quoteBody = JSON.parse(opts.body); return jsonResponse({ result: true, added_trans_no: 1708 }); },
  });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({ customerId: 10 });
  assert.equal(res.status, 200);
  assert.equal(quoteBody.branch_id, 20, 'resuelve el branch del cliente ELEGIDO, no el persistido');
  const cot = readJson(COTS_PATH).find(c => c.id === id);
  assert.equal(cot.data.cliente.branchId, 20, 'persiste el branch correcto para reintentos');
});

test('F6: POST /api/crear-cliente con RFC generico NO deduplica por RFC exacto', async () => {
  writeJson(PROSPECTOS_PATH, []);
  // Antes de F6, el lookup por tax_id matchearia este OTRO generico y el alta
  // devolveria duplicado:true con el cliente equivocado.
  let taxIdLookup = false;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return jsonResponse({ result: true, customer_id: 940 });
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      if (u.includes('tax_id=')) { taxIdLookup = true; return jsonResponse({ total: 1, data: [{ customer_id: 444, CustName: 'OTRO GENERICO SA', tax_id: 'XEXX010101000', branches: [{ branch_code: 445 }] }] }); }
      if (u.includes('/940')) return jsonResponse({ data: [{ branches: [{ branch_code: 941 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/branches/941': () => jsonResponse({ result: true }),
  });
  const res = await supertest(app).post('/api/crear-cliente')
    .set('Authorization', `Bearer ${TOKEN}`)
    .send({
      tax_id: 'XEXX010101000', CustName: 'Blue Hotel LLC', pais: 'US', salesman: 2,
      entrega: { br_name: 'Blue Hotel', br_ref: 'BLUE', pais: 'US' },
    });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.duplicado, false, 'no debe reportar duplicado contra otro generico');
  assert.equal(res.body.customer_id, 940);
  assert.equal(taxIdLookup, false, 'con RFC generico no debe consultar por tax_id exacto');
});

// === Concurrencia (F3 de la revision de #83): lock por id de cotizacion ===
// La auto-subida es fire-and-forget: el vendedor puede llegar al Historial y
// clickear "Reintentar" con la subida original EN VUELO, o doble-clickear
// "Elegir" candidato. Sin lock, dos requests concurrentes leen customerId null
// y crean DOS clientes genericos (la idempotencia de #81 cubre reintentos
// SECUENCIALES, no concurrencia). El server rechaza al segundo con 425 claro.

test('C1: dos requests concurrentes al mismo id crean UN solo cliente generico (lock por id)', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  const id = nuevaCotizacion();
  let postCustomers = 0;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': async (u, opts) => {
      if (opts?.method === 'POST') {
        postCustomers++;
        // Mantiene al primer request EN VUELO para que el segundo lo alcance.
        await new Promise(r => setTimeout(r, 80));
        return jsonResponse({ result: true, customer_id: 930 });
      }
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      if (u.includes('/930')) return jsonResponse({ data: [{ branches: [{ branch_code: 931 }] }] });
      return jsonResponse({ total: 0, data: [] }); // dedup por nombre: libre
    },
    '/api/v3/sales/quote': () => jsonResponse({ result: true, added_trans_no: 1750 }),
  });

  const [r1, r2] = await Promise.all([
    supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', `Bearer ${TOKEN}`).send({}),
    supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', `Bearer ${TOKEN}`).send({}),
  ]);

  const statuses = [r1.status, r2.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 425], 'uno completa, el otro recibe 425 (subida en curso)');
  assert.equal(postCustomers, 1, 'UN solo POST customer: no se duplico el cliente generico');
  const rechazado = r1.status === 425 ? r1 : r2;
  assert.match(rechazado.body.error, /en curso/i, 'el 425 explica que hay una subida en curso');
  // El lock se libero al terminar: la cotizacion quedo con su folio (el ganador).
  const cot = readJson(COTS_PATH).find(c => c.id === id);
  assert.equal(String(cot.folioOperam), '1750');
});

test('C2: el lock se libera tras un fallo (el reintento posterior NO recibe 425)', async () => {
  writeJson(PROSPECTOS_PATH, []);
  const id = nuevaCotizacion();
  // Primer intento: Operam caido en el POST customer -> 503.
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return jsonResponse({ error: 'boom' }, 500);
      return jsonResponse({ total: 0, data: [] });
    },
  });
  const intento1 = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});
  assert.equal(intento1.status, 503);
  // Reintento secuencial: el lock ya no esta tomado.
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return jsonResponse({ result: true, customer_id: 940 });
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      if (u.includes('/940')) return jsonResponse({ data: [{ branches: [{ branch_code: 941 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/quote': () => jsonResponse({ result: true, added_trans_no: 1751 }),
  });
  const intento2 = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});
  assert.equal(intento2.status, 200, 'el lock no quedo tomado tras el fallo');
});
