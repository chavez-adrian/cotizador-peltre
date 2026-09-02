import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, chmodSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync, borrarArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { handlersWebFichaCliente } from './helpers/ficha-cliente-web.js';

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
const { app, cargarListasPrecios, barrerCotizacionesDedupVencidas, _resetListasPrecios } = await import('../server.js');
const { resetSession } = await import('../lib/operam-client.js');
const { resetIndice } = await import('../lib/indice-telefonos.js');
const { _resetSesionWeb, _esperarPostFixes } = await import('../lib/operam-web.js');
const TOKEN = jwt.sign({ id: 99, name: 'Tester', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

function readJson(path) { return existsSync(path) ? JSON.parse(leerArchivoSync(path)) : []; }
function writeJson(path, data) { escribirArchivoSync(path, JSON.stringify(data, null, 2)); }

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

// La web legacy responde HTML, no JSON, y su sesion viaja en cookies.
function htmlResponse(html) {
  return { ok: true, status: 200, text: async () => html, headers: { getSetCookie: () => ['FA=sesion-de-prueba; path=/'] } };
}

// Post-fix de la vigencia (#106): el quote se corrige por la web legacy en cuanto existe.
// Estos handlers cubren las dos paginas que toca -- el formulario de edicion y la vista
// read-only con la que se verifica -- para que la subida se pruebe COMPLETA.
const FORM_QUOTE = readFileSync(join(__dirname, 'fixtures', 'operam-quote-form.html'), 'utf8');
// La vista se sirve con su HTML REAL (fixture) y solo se le cambia la fecha: un HTML
// sintetico no probaria que la verificacion sabe leer la pagina que Operam devuelve.
// validoHasta null = la vista no trae el campo (no se pudo verificar).
const VISTA_QUOTE = readFileSync(join(__dirname, 'fixtures', 'operam-quote-vista.html'), 'utf8');
function mockWebLegacy({ validoHasta = '2026-08-05', onPost = () => {} } = {}) {
  return {
    'sales_order_entry.php': (u, opts) => {
      if (opts?.method === 'POST') { onPost(String(opts.body)); return htmlResponse('<html>ok</html>'); }
      return htmlResponse(FORM_QUOTE);
    },
    'view_sales_order.php': () => htmlResponse(
      validoHasta == null ? '<table><tr><td>Cotizacion</td></tr></table>' : VISTA_QUOTE.replace('2026-08-26', validoHasta),
    ),
  };
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
  else if (existsSync(PROSPECTOS_PATH)) borrarArchivoSync(PROSPECTOS_PATH);
  globalThis.fetch = originalFetch;
});
beforeEach(() => {
  globalThis.fetch = fetchBloqueado;
  resetSession();
  _resetSesionWeb();
  // La dedup por cust_ref (#242) lee el padron cacheado de indice-telefonos, que
  // vive en memoria del modulo con TTL de 1 h: sin este reset el padron del primer
  // test contestaria por todos los demas.
  resetIndice();
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
      if (u.includes('/910')) { llamadas.push('GET customer'); return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 911 }] }] }); }
      // MINA (#81): la dedup por RFC EXACTO de crearCliente matchearia este otro
      // generico y reutilizaria el cliente EQUIVOCADO. El flujo debe saltarla.
      if (u.includes('tax_id=')) { llamadas.push('GET tax_id'); return jsonResponse({ total: 1, data: [{ customer_id: 444, CustName: 'OTRO GENERICO SA', tax_id: 'XAXX010101000', sales_type: '12', branches: [{ branch_code: 445 }] }] }); }
      // Dedup por nombre (ADR-0001): hay genericos pero ninguno con nombre similar.
      llamadas.push('GET search');
      return jsonResponse({ total: 1, data: [{ customer_id: 444, CustName: 'FERRETERIA EL CLAVO', cust_ref: 'El Clavo', tax_id: 'XAXX010101000' }] });
    },
    // issue #189: sin domicilio de entrega el PUT del branch YA NO se omite (escribe
    // tax_group_id/sales_account); br_name coincide con lo derivado del nombre corto
    // del cliente para que la verificacion post-PUT no reporte una discrepancia.
    '/api/v3/sales/branches/911': (u, opts) => {
      if (opts?.method === 'PUT') { llamadas.push('PUT branch'); return jsonResponse({ result: true }); }
      llamadas.push('GET branch');
      return jsonResponse({ data: [{ br_name: 'Hotel Azul' }] });
    },
    '/api/v3/sales/quote': (u, opts) => { llamadas.push('POST quote'); quoteBody = JSON.parse(opts.body); return jsonResponse({ result: true, added_trans_no: 1701 }); },
    ...mockWebLegacy(),
  });
  await cargarListasPrecios();

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.folio, 1701);
  assert.equal(res.body.customer_id, 910);
  // #93: el frontend usa este flag para ofrecer la CSF junto al folio y para
  // refrescar pcState.cliente.clienteOperamId -- el chip Fiscal se vuelve
  // accionable de inmediato, sin depender de una nueva busqueda.
  assert.equal(res.body.clienteGenerico, true);
  assert.ok(Array.isArray(res.body.steps), 'la respuesta reporta los pasos (ADR-0002)');
  assert.ok(res.body.steps.every(s => s.name && s.status === 'ok'), 'todos los pasos en ok');

  // Orden: primero el POST del cliente, despues la cotizacion a su nombre.
  assert.ok(llamadas.includes('POST customer'));
  assert.ok(llamadas.indexOf('POST customer') < llamadas.indexOf('POST quote'));

  // Cliente generico: RFC generico nacional, nombre y vendedor REALES, lista de
  // precios de la cotizacion (tier M100 -> id 15 en Operam) y los parametros
  // fiscales estandar de la casa (issue #121): nombre en MAYUSCULAS, CP fiscal
  // 56577, regimen 616 y uso CFDI S01.
  assert.equal(clienteBody.tax_id, 'XAXX010101000');
  assert.equal(clienteBody.cust_name, 'HOTEL AZUL CENTRO');
  assert.equal(clienteBody.postal_code, '56577');
  assert.equal(clienteBody.cfdi_regimen_fiscal, '616');
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
      if (u.includes('/910')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 911 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/branches/911': () => jsonResponse({ result: true, data: [{}] }),
    '/api/v3/sales/quote': (u, opts) => jsonResponse({ result: true, added_trans_no: 1701 }),
  });
  await cargarListasPrecios();

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});

  assert.equal(res.status, 200);
  assert.ok(clienteBody, 'se debio crear el cliente');
  assert.equal(clienteBody.sales_type, '12', 'Menudeo sin lista homonima -> "Precio de lista" (id 12), nunca omitido');
});

test('#246-5: alta generica con listasPrecios vacia al inicio -> la recarga perezosa resuelve el sales_type del tier antes del POST customer', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  const id = nuevaCotizacion();
  _resetListasPrecios(); // simula el arranque que dejo la lista vacia (#246)
  let clienteBody = null;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/sales_types': () => jsonResponse({ data: [{ id: '15', sales_type: 'M100', inactive: '0' }] }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { clienteBody = JSON.parse(opts.body); return jsonResponse({ result: true, customer_id: 910 }); }
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      if (u.includes('/910')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 911 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/branches/911': () => jsonResponse({ result: true, data: [{}] }),
    '/api/v3/sales/quote': () => jsonResponse({ result: true, added_trans_no: 1701 }),
    ...mockWebLegacy(),
  });
  // Sin llamar cargarListasPrecios(): la lista arranca vacia y la recarga
  // perezosa (obtenerListasPrecios) debe dispararse dentro del propio flujo.

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(clienteBody, 'se debio crear el cliente');
  assert.equal(clienteBody.sales_type, '15', 'tier M100 -> id 15 en Operam, resuelto tras la recarga perezosa');
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
      if (u.includes('/555')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 556 }] }] });
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

test('G3: nombre similar a un generico de Operam -> 409 con candidatos, sin crear y sin subir (sin el flag de escape)', async () => {
  writeJson(PROSPECTOS_PATH, []);
  // RFC generico capturado en el formulario: tampoco resuelve por RFC (ADR-0001).
  const id = nuevaCotizacion({ rfc: 'XAXX010101000' });
  let postCustomer = false;
  let quoteLlamado = false;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { postCustomer = true; return jsonResponse({ result: true, customer_id: 999 }); }
      // El pool SOLO sale por tax_id (#194): el ?search= de Operam busca por
      // nombre y no indexa el RFC, asi que devolvia vacio y la dedup por nombre
      // de ADR-0001 nunca veia un candidato.
      if (!u.includes('tax_id=XAXX010101000')) return jsonResponse({ total: 0, data: [] });
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

// G3b (#210): el 409 de candidatos viaja con los hechos del picker -- palabras
// de diferencia del nombre en ambas direcciones y letreros celular/correo con
// tres estados. Prueba de INTEGRACION contra el endpoint real (no solo el
// nucleo puro de deduplicacion.test.js ni el render de pipeline-logica.test.cjs):
// verifica que server.js de verdad conecta hechosCandidato al contrato.
test('G3b: el 409 de candidatos viaja con diferenciaNombre y celular/correoMatch (#210)', async () => {
  writeJson(PROSPECTOS_PATH, []);
  // razonSocial default 'Hotel Azul Centro' (tokens: hotel, azul, centro),
  // celular default CELULAR (ultimos10 5588776655); se agrega emailFactura
  // para ejercer tambien el letrero de correo.
  const id = nuevaCotizacion({ rfc: 'XAXX010101000', emailFactura: 'ventas@hotelazul.mx' });
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return jsonResponse({ result: true, customer_id: 999 });
      if (!u.includes('tax_id=XAXX010101000')) return jsonResponse({ total: 0, data: [] });
      return jsonResponse({ total: 1, data: [
        {
          customer_id: 10, CustName: 'HOTEL AZUL NORTE', cust_ref: 'Hotel Azul', tax_id: 'XAXX010101000',
          contacts: [{ phone: '5588776655', email: 'ventas@hotelazul.mx' }],
        },
      ] });
    },
  });

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});

  assert.equal(res.status, 409);
  const cand = res.body.candidatos[0];
  assert.equal(cand.id, 10);
  // "centro" (input) vs "norte" (Operam): diferencia cruda en las dos direcciones.
  assert.deepEqual(cand.diferenciaNombre, { soloInput: ['centro'], soloCandidato: ['norte'] });
  assert.equal(cand.celularMatch, 'coincide');
  assert.equal(cand.correoMatch, 'coincide');
});

// G3c (#210): sin telefono/correo en la ficha del candidato, el 409 dice
// "sin_dato" honestamente -- nunca "no_coincide" (41% de las fichas historicas
// no tienen telefono).
test('G3c: el 409 de candidatos marca sin_dato (no no_coincide) cuando la ficha no trae telefono ni correo (#210)', async () => {
  writeJson(PROSPECTOS_PATH, []);
  const id = nuevaCotizacion({ rfc: 'XAXX010101000' });
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return jsonResponse({ result: true, customer_id: 999 });
      if (!u.includes('tax_id=XAXX010101000')) return jsonResponse({ total: 0, data: [] });
      return jsonResponse({ total: 1, data: [
        { customer_id: 10, CustName: 'HOTEL AZUL NORTE', cust_ref: 'Hotel Azul', tax_id: 'XAXX010101000' },
      ] });
    },
  });

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});

  assert.equal(res.status, 409);
  const cand = res.body.candidatos[0];
  assert.equal(cand.celularMatch, 'sin_dato');
  assert.equal(cand.correoMatch, 'sin_dato');
});

// === Escape "ninguno es el mismo cliente" (#204) ===
// ADR-0001 decidio que la parada por nombre NO tuviera escape. Con el pool
// completo que estreno #194 la parada se dispara sobre falsos positivos y deja
// al vendedor sin salida: el documento degrada a PRE. El flag crearNuevo salta
// ESA parada y NADA MAS.

test('G3b: crearNuevo salta la parada por nombre similar, crea el generico y sube', async () => {
  writeJson(PROSPECTOS_PATH, []);
  const id = nuevaCotizacion({ rfc: 'XAXX010101000' });
  let postCustomer = false;
  let quoteBody = null;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/sales_types': () => jsonResponse({ data: [{ id: '15', sales_type: 'M100', inactive: '0' }] }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { postCustomer = true; return jsonResponse({ result: true, customer_id: 999 }); }
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      if (u.includes('/999')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 998 }] }] });
      if (!u.includes('tax_id=XAXX010101000')) return jsonResponse({ total: 0, data: [] });
      return jsonResponse({ total: 1, data: [
        { customer_id: 10, CustName: 'HOTEL AZUL SA DE CV', cust_ref: 'Hotel Azul', tax_id: 'XAXX010101000' },
      ] });
    },
    '/api/v3/sales/branches/998': (u, opts) => {
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      return jsonResponse({ data: [{ br_name: 'Hotel Azul' }] });
    },
    '/api/v3/sales/quote': (u, opts) => { quoteBody = JSON.parse(opts.body); return jsonResponse({ result: true, added_trans_no: 1704 }); },
    ...mockWebLegacy(),
  });
  await cargarListasPrecios();

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({ crearNuevo: true });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.customer_id, 999);
  assert.equal(postCustomer, true, 'con el escape SI se crea el cliente nuevo');
  assert.equal(quoteBody.customer_id, 999);
  const cot = readJson(COTS_PATH).find(c => c.id === id);
  assert.equal(String(cot.folioOperam), '1704');

  // El forzado queda registrado: paso visible para el vendedor y renglon en
  // clientes_log para que higiene-clientes (#86) pueda revisarlo despues.
  const dedup = res.body.steps.find(s => s.name === 'dedup');
  assert.equal(dedup.status, 'warn', 'la creacion forzada no se reporta como un alta limpia');
  assert.match(dedup.info, /forz/i);
  const audit = res.body.steps.find(s => s.name === 'log auditoria');
  assert.equal(audit.info, 'cotizador-generico');
});

test('G3c: crearNuevo NO salta la reutilizacion por celular de un prospecto convertido', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase({ cliente_id: 555 })]);
  const id = nuevaCotizacion();
  let postCustomer = false;
  let quoteBody = null;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { postCustomer = true; return jsonResponse({ result: true, customer_id: 999 }); }
      if (u.includes('/555')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 556 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/quote': (u, opts) => { quoteBody = JSON.parse(opts.body); return jsonResponse({ result: true, added_trans_no: 1705 }); },
  });

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({ crearNuevo: true });

  assert.equal(res.status, 200);
  assert.equal(res.body.customer_id, 555, 'el celular ya mapea a un cliente: se reutiliza');
  assert.equal(postCustomer, false, 'el escape no autoriza un segundo cliente para el mismo celular');
  assert.equal(quoteBody.customer_id, 555);
});

test('G3d: crearNuevo no debilita la guarda del customerId contradictorio', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase({ cliente_id: 555 })]);
  const id = nuevaCotizacion();
  let postCustomer = false;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { postCustomer = true; return jsonResponse({ result: true, customer_id: 999 }); }
      return jsonResponse({ total: 0, data: [] });
    },
  });

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({ customerId: 10, crearNuevo: true });

  assert.equal(res.status, 409, 'el celular ya esta ligado a 555 y el elegido es otro');
  assert.equal(postCustomer, false);
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
      if (u.includes('/10')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 20 }] }] });
      // #208: la revalidacion recalcula el pool por tax_id -- el elegido debe
      // seguir apareciendo en el.
      if (u.includes('tax_id=')) return jsonResponse({ total: 1, data: [
        { customer_id: 10, CustName: 'HOTEL AZUL SA DE CV', cust_ref: 'Hotel Azul', tax_id: 'XAXX010101000' },
      ] });
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

// #208 (spec #205, hueco BAJA de la auditoria STOP-RFC): el customerId elegido
// llega en el BODY del request -- puede venir manipulado o apuntar a una lista
// de candidatos que ya cambio desde el 409 original. El servidor recalcula el
// pool (mismo pipeline: buscarClientesPorRfc + detectarDuplicados) y exige que
// el elegido siga perteneciendo a el; si no, mismo contrato del 409 de
// candidatos, con la lista FRESCA para que el vendedor vuelva a elegir.
test('G4b: customerId elegido que ya no esta en la lista recalculada -> 409 con candidatos frescos, cero escrituras', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  const id = nuevaCotizacion();
  let postCustomer = false;
  let quoteLlamado = false;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { postCustomer = true; return jsonResponse({ result: true, customer_id: 999 }); }
      // La lista cambio: el 10 que el vendedor eligio (de un 409 anterior) ya no
      // aparece -- el pool fresco solo trae al 11.
      if (u.includes('tax_id=')) return jsonResponse({ total: 1, data: [
        { customer_id: 11, CustName: 'HOTEL AZUL NORTE SA', cust_ref: 'Hotel Azul', tax_id: 'XAXX010101000' },
      ] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/quote': () => { quoteLlamado = true; return jsonResponse({ result: true, added_trans_no: 1 }); },
  });

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({ customerId: 10 });

  assert.equal(res.status, 409);
  assert.ok(res.body.error);
  assert.ok(Array.isArray(res.body.candidatos), 'debe devolver la lista fresca');
  assert.equal(res.body.candidatos.length, 1);
  assert.equal(res.body.candidatos[0].id, 11, 'la lista fresca, no la que trajo el vendedor');
  assert.equal(postCustomer, false, 'no debe crear');
  assert.equal(quoteLlamado, false, 'no debe subir');

  const cot = readJson(COTS_PATH).find(c => c.id === id);
  assert.ok(!cot.folioOperam, 'la cotizacion sigue PRE');
  assert.equal(cot.data.cliente.customerId, undefined, 'no persiste el elegido rechazado');
  assert.equal(cot.data.motivoPre, 'dedup', 'mismo candado que la parada original');
  const p = readJson(PROSPECTOS_PATH).find(x => x.id === 1);
  assert.equal(p.data.cliente_id, undefined, 'el prospecto no se liga a un elegido rechazado');
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
      if (u.includes('/920')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 921 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/branches/921': () => jsonResponse({ result: true, data: [{}] }),
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
      // #285: el cliente ya creado se relee antes del POST del quote para
      // comprobar que tiene lista de precios; sin lista no puede valuarse.
      if (u.includes('/920')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 921 }] }] });
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
  // Todas las lecturas del padron que hace la dedup: los pools por tax_id (#194)
  // y, desde #242, el listado completo que alimenta la busqueda por cust_ref.
  const dedupUrls = [];
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { clienteBody = JSON.parse(opts.body); return jsonResponse({ result: true, customer_id: 930 }); }
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      if (u.includes('/930')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 931 }] }] });
      dedupUrls.push(u);
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/branches/931': () => jsonResponse({ result: true, data: [{}] }),
    '/api/v3/sales/quote': () => jsonResponse({ result: true, added_trans_no: 1706 }),
  });

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  // #194: el pool se pide por tax_id. Con ?search= Operam no indexa el RFC y la
  // dedup corria contra una lista vacia.
  const porTaxId = dedupUrls.filter(u => u.includes('tax_id='));
  assert.ok(porTaxId.some(u => u.includes('tax_id=XEXX010101000')), 'la dedup de nombre corre contra el generico extranjero, por tax_id');
  assert.ok(dedupUrls.every(u => !u.includes('search=')), 'nunca por el buscador de nombre');
  // F4: el pool de genericos crece por diseno (#81); la dedup no puede truncarse
  // a una pagina corta.
  assert.ok(porTaxId.every(u => u.includes('limit=100')), 'la dedup generica pagina de 100 en 100');
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
      if (u.includes('/950')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 951 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/branches/951': () => jsonResponse({ result: true, data: [{}] }),
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
      if (u.includes('/10')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 20 }] }] });
      // #208: la revalidacion recalcula el pool por tax_id -- el elegido debe
      // seguir apareciendo en el.
      if (u.includes('tax_id=')) return jsonResponse({ total: 1, data: [
        { customer_id: 10, CustName: 'HOTEL AZUL SA DE CV', cust_ref: 'Hotel Azul', tax_id: 'XAXX010101000' },
      ] });
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
      if (u.includes('tax_id=')) { taxIdLookup = true; return jsonResponse({ total: 1, data: [{ customer_id: 444, CustName: 'OTRO GENERICO SA', tax_id: 'XEXX010101000', sales_type: '12', branches: [{ branch_code: 445 }] }] }); }
      if (u.includes('/940')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 941 }] }] });
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

// === Domicilio de entrega -> branch del cliente generico (issue #96) ===
// subirConAltaGenerica creaba el cliente pero NUNCA actualizaba el branch: el
// domicilio de entrega del paso Envio se quedaba solo en el cotizador. Ahora, para
// el cliente RECIEN creado, hace el PUT del branch con el domicilio (customer_id en
// el body por el quirk #74) y verifica releyendo. Nunca pisa el branch de un cliente
// preexistente (reusado por celular o elegido de candidatos).

const DOMICILIO = {
  nombreEntrega: 'Recepcion', calle: 'Av Reforma 100', numInt: 'Piso 3',
  colonia: 'Juarez', cpEntrega: '06600', municipio: 'Cuauhtemoc', estado: 'CDMX',
  celEntrega: '+52 5511223344', emailEntrega: 'entrega@hotelazul.mx',
  referencias: 'Porton negro entre A y B', referencia: 'REF',
};

test('D1: cliente generico recien creado con domicilio -> PUT del branch con customer_id y verificacion', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  const id = nuevaCotizacion(DOMICILIO);
  let branchPut = null;
  let branchGets = 0;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/branches/911': (u, opts) => {
      if (opts?.method === 'PUT') { branchPut = JSON.parse(opts.body); return jsonResponse({ result: true }); }
      branchGets++;
      return jsonResponse({ data: [{ br_name: 'Recepcion', addr_street: 'Av Reforma 100', addr_interior: 'Piso 3', addr_colony: 'Juarez',
        addr_city: 'Cuauhtemoc', addr_state: 'CDMX', addr_zip: '06600', addr_reference: 'Porton negro entre A y B',
        phone: '+52 5511223344', email: 'entrega@hotelazul.mx' }] });
    },
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return jsonResponse({ result: true, customer_id: 910 });
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      if (u.includes('/910')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 911 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/quote': () => jsonResponse({ result: true, added_trans_no: 1801 }),
  });

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});

  assert.equal(res.status, 200);
  assert.equal(res.body.folio, 1801);
  assert.ok(branchPut, 'debio hacer el PUT del branch');
  assert.equal(branchPut.customer_id, 910, 'customer_id en el body (quirk #74: sin el, debtor_no se resetea a 0)');
  assert.equal(branchPut.br_name, 'Recepcion', 'nombre del branch en Title Case (issue #170)');
  assert.equal(branchPut.addr_street, 'Av Reforma 100');
  assert.equal(branchPut.addr_zip, '06600');
  assert.equal(branchPut.addr_city, 'Cuauhtemoc');
  assert.equal(branchPut.addr_reference, 'Porton negro entre A y B');
  assert.equal(branchPut.location, 40, 'PUT usa location (no default_location)');
  assert.equal(branchPut.ship_via, 1, 'PUT usa ship_via (no default_ship_via)');
  assert.ok(branchGets >= 1, 'releela el branch para verificar');
  const put = res.body.steps.find(s => s.name === 'PUT branch (domicilio)');
  assert.ok(put && put.status === 'ok', 'reporta el PUT del branch');
  const ver = res.body.steps.find(s => s.name === 'verificar branch');
  assert.ok(ver && ver.status === 'ok', 'la verificacion no encontro discrepancias');
});

// issue #189: sin domicilio de entrega, el PUT del branch YA NO SE OMITE -- corre
// igual para escribir tax_group_id/sales_account (no dependen del domicilio, solo
// del pais del cliente). Antes la falta de calle/CP cancelaba el PUT completo y se
// llevaba el grupo de impuestos, que Operam entonces auto-creaba con su default fijo
// (gravado), incorrecto para un cliente extranjero.
test('D2: sin domicilio de entrega -> el PUT del branch corre igual (SOLO tax_group_id/sales_account, issue #189)', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  const id = nuevaCotizacion();
  let branchPut = null;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/branches/911': (u, opts) => {
      if (opts?.method === 'PUT') { branchPut = JSON.parse(opts.body); return jsonResponse({ result: true }); }
      return jsonResponse({ result: true, data: [{}] });
    },
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return jsonResponse({ result: true, customer_id: 910 });
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      if (u.includes('/910')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 911 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/quote': () => jsonResponse({ result: true, added_trans_no: 1802 }),
  });

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});

  assert.equal(res.status, 200);
  assert.equal(res.body.folio, 1802);
  assert.ok(branchPut, 'sin domicilio SI debe hacer el PUT del branch (tax_group_id/sales_account)');
  assert.equal(branchPut.tax_group_id, 1, 'cliente MX -> gravado');
  assert.equal(branchPut.sales_account, '401-01-001');
  assert.equal(branchPut.addr_street, '', 'sin domicilio no manda calle (actualizarBranchCliente default vacio)');
  const put = res.body.steps.find(s => s.name === 'PUT branch (domicilio)');
  assert.ok(put && put.status === 'ok', 'reporta el PUT del branch');
});

// issue #189, zona gris: sin domicilio de entrega no hay pais de entrega que mirar --
// la inferencia decidida es el pais del CLIENTE (`c.pais`, area). Un extranjero puede
// recibir en Mexico y esto lo pasaria por alto, pero es preferible al default fijo de
// Operam (siempre gravado), que es lo que se media en vivo con 5 clientes extranjeros.
test('D2b: sin domicilio de entrega, cliente extranjero -> tax_group_id/sales_account de exportacion (issue #189)', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  const id = nuevaCotizacion({ pais: 'US' });
  let branchPut = null;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/branches/911': (u, opts) => {
      if (opts?.method === 'PUT') { branchPut = JSON.parse(opts.body); return jsonResponse({ result: true }); }
      return jsonResponse({ result: true, data: [{}] });
    },
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return jsonResponse({ result: true, customer_id: 910 });
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      if (u.includes('/910')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 911 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/quote': () => jsonResponse({ result: true, added_trans_no: 1807 }),
  });

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});

  assert.equal(res.status, 200);
  assert.equal(res.body.folio, 1807);
  assert.ok(branchPut, 'sin domicilio SI debe hacer el PUT del branch');
  assert.equal(branchPut.tax_group_id, 2, 'cliente extranjero -> exportacion');
  assert.equal(branchPut.sales_account, '401-07-000');
});

test('D3: Operam ignora un campo del branch -> verificacion lo reporta, la subida sigue OK', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  const id = nuevaCotizacion(DOMICILIO);
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/branches/911': (u, opts) => {
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      // Operam persiste todo MENOS el CP (quirk result:true que ignora campos).
      return jsonResponse({ data: [{ addr_street: 'Av Reforma 100', addr_interior: 'Piso 3', addr_colony: 'Juarez',
        addr_city: 'Cuauhtemoc', addr_state: 'CDMX', addr_zip: '', addr_reference: 'Porton negro entre A y B',
        phone: '+52 5511223344', email: 'entrega@hotelazul.mx' }] });
    },
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return jsonResponse({ result: true, customer_id: 910 });
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      if (u.includes('/910')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 911 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/quote': () => jsonResponse({ result: true, added_trans_no: 1803 }),
  });

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});

  assert.equal(res.status, 200);
  assert.equal(res.body.folio, 1803, 'la subida se completa pese a la discrepancia');
  const ver = res.body.steps.find(s => s.name === 'verificar branch');
  assert.ok(ver, 'reporta la verificacion');
  assert.equal(ver.status, 'warn');
  assert.ok(Array.isArray(ver.camposNoActualizados), 'lista los campos no persistidos');
  assert.ok(ver.camposNoActualizados.some(x => x.campo === 'addr_zip'), 'el CP ignorado se reporta');
});

test('D4: fallo del PUT del branch NO tumba la subida (cliente creado, quote subido, step error)', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  const id = nuevaCotizacion(DOMICILIO);
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/branches/911': (u, opts) => {
      if (opts?.method === 'PUT') return jsonResponse({ error: 'boom' }, 500);
      return jsonResponse({ data: [{}] });
    },
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return jsonResponse({ result: true, customer_id: 910 });
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      if (u.includes('/910')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 911 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/quote': () => jsonResponse({ result: true, added_trans_no: 1804 }),
  });

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});

  assert.equal(res.status, 200, 'la subida se completa aunque el branch falle');
  assert.equal(res.body.folio, 1804);
  const put = res.body.steps.find(s => s.name === 'PUT branch (domicilio)');
  assert.ok(put && put.status === 'error', 'reporta el fallo del branch sin tumbar la subida');
});

test('D5: retry con customerId elegido (cliente preexistente) NUNCA pisa su branch, aun con domicilio', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  const id = nuevaCotizacion(DOMICILIO);
  let branchPut = false;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/branches/20': (u, opts) => { if (opts?.method === 'PUT') branchPut = true; return jsonResponse({ result: true, data: [{}] }); },
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return jsonResponse({ result: true, customer_id: 999 });
      if (u.includes('/10')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 20 }] }] });
      // #208: la revalidacion recalcula el pool por tax_id -- el elegido debe
      // seguir apareciendo en el.
      if (u.includes('tax_id=')) return jsonResponse({ total: 1, data: [
        { customer_id: 10, CustName: 'HOTEL AZUL SA DE CV', cust_ref: 'Hotel Azul', tax_id: 'XAXX010101000' },
      ] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/quote': () => jsonResponse({ result: true, added_trans_no: 1805 }),
  });

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({ customerId: 10 });

  assert.equal(res.status, 200);
  assert.equal(res.body.customer_id, 10);
  assert.equal(branchPut, false, 'cliente preexistente elegido: su domicilio real NO se pisa');
  assert.ok(!res.body.steps.some(s => s.name === 'PUT branch (domicilio)'));
});

test('D6: cliente reutilizado por celular (preexistente) NUNCA pisa su branch, aun con domicilio', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase({ cliente_id: 555 })]);
  const id = nuevaCotizacion(DOMICILIO);
  let branchPut = false;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/branches/556': (u, opts) => { if (opts?.method === 'PUT') branchPut = true; return jsonResponse({ result: true, data: [{}] }); },
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return jsonResponse({ result: true, customer_id: 999 });
      if (u.includes('/555')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 556 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/quote': () => jsonResponse({ result: true, added_trans_no: 1806 }),
  });

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});

  assert.equal(res.status, 200);
  assert.equal(res.body.customer_id, 555);
  assert.equal(branchPut, false, 'cliente reutilizado por celular: su domicilio real NO se pisa');
});

// === "Es sucursal de este cliente" (#211, spec #206) ==========================
// El vendedor declara que el negocio capturado es otra plaza de un cliente
// existente: { sucursalDe } crea una sucursal NUEVA bajo ese cliente (SOLO POST,
// jamas PUT sobre branches existentes -- es REPLACE destructivo, ver
// docs/arquitectura.md) y sube el quote a nombre del cliente con esa sucursal.
// Contrato del POST verificado en vivo sobre el cliente 497 (paso 0 del ticket):
// POST /api/v3/sales/branches responde { result: true, cust_branch_id } y las
// sucursales previas quedan intactas campo por campo.

test('SUC1: { sucursalDe } crea UNA sucursal nueva, sube el quote al cliente existente y liga el prospecto', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  const id = nuevaCotizacion(DOMICILIO);
  let branchPost = null;
  let branchPuts = 0;
  let branchPosts = 0;
  let postCustomer = false;
  let quoteBody = null;
  let branchesDelCliente = [{ branch_code: 20, br_name: 'Matriz' }];
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/branches': (u, opts) => {
      if (opts?.method === 'POST') {
        branchPosts++;
        branchPost = JSON.parse(opts.body);
        // Operam devuelve el codigo de la sucursal creada; la relectura es la
        // unica prueba de que existe (un 200 no garantiza nada, quirk #74).
        branchesDelCliente = [...branchesDelCliente, { branch_code: 33, br_name: branchPost.br_name }];
        return jsonResponse({ result: true, cust_branch_id: 33 });
      }
      if (opts?.method === 'PUT') { branchPuts++; return jsonResponse({ result: true }); }
      return jsonResponse({ data: [{}] });
    },
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { postCustomer = true; return jsonResponse({ result: true, customer_id: 999 }); }
      if (u.includes('/10')) return jsonResponse({ data: [{ sales_type: '12', branches: branchesDelCliente }] });
      if (u.includes('tax_id=')) return jsonResponse({ total: 1, data: [
        { customer_id: 10, CustName: 'HOTEL AZUL SA DE CV', cust_ref: 'Hotel Azul', tax_id: 'XAXX010101000' },
      ] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/quote': (u, opts) => { quoteBody = JSON.parse(opts.body); return jsonResponse({ result: true, added_trans_no: 1901 }); },
    ...mockWebLegacy(),
  });

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({ sucursalDe: 10 });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.customer_id, 10);
  assert.equal(res.body.folio, 1901);
  assert.equal(postCustomer, false, 'declarar sucursal NUNCA crea un cliente');
  assert.equal(branchPosts, 1, 'exactamente UN POST de sucursal');
  assert.equal(branchPuts, 0, 'CERO PUT sobre branches (REPLACE destructivo)');

  // La sucursal nace bajo el cliente elegido, con el domicilio de entrega y el
  // contacto capturados en la cotizacion.
  assert.equal(branchPost.customer_id, 10);
  assert.equal(branchPost.br_name, 'Recepcion');
  assert.equal(branchPost.br_ref, 'Recepcion', 'la sucursal nueva no tiene referencia que conservar');
  assert.equal(branchPost.addr_street, 'Av Reforma 100');
  assert.equal(branchPost.addr_zip, '06600');
  assert.equal(branchPost.addr_city, 'Cuauhtemoc');
  assert.equal(branchPost.phone, '+52 5511223344');
  assert.equal(branchPost.email, 'entrega@hotelazul.mx');
  assert.equal(branchPost.location, 40, 'POST usa location (no default_location)');
  assert.equal(branchPost.ship_via, 1);

  // El quote sale a nombre del cliente existente, con la sucursal recien creada.
  assert.equal(quoteBody.customer_id, 10);
  assert.equal(quoteBody.branch_id, 33);

  // Prospecto ligado al cliente correcto y auditoria con fuente propia.
  const p = readJson(PROSPECTOS_PATH).find(x => x.id === 1);
  assert.equal(p.data.cliente_id, 10);
  const audit = res.body.steps.find(s => s.name === 'log auditoria');
  assert.ok(audit && audit.info === 'sucursal-creada', 'la creacion de sucursal tiene fuente propia en el log');
  assert.ok(res.body.steps.every(s => s.status === 'ok'), 'todos los pasos en ok');

  const cot = readJson(COTS_PATH).find(c => c.id === id);
  assert.equal(cot.data.cliente.customerId, 10);
  assert.equal(cot.data.cliente.branchId, 33, 'la sucursal creada se persiste');
  assert.equal(String(cot.folioOperam), '1901');
  assert.equal(cot.data.motivoPre, null, 'con folio el candado se levanta');
});

test('SUC2: la sucursal no aparece en la relectura -> paso en error, la cotizacion NO finge exito', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  const id = nuevaCotizacion(DOMICILIO);
  let quoteLlamado = false;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    // Operam responde result:true pero la sucursal no queda: el cliente sigue
    // con su unica sucursal previa (quirk #74, el 200 no garantiza nada).
    '/api/v3/sales/branches': (u, opts) => {
      if (opts?.method === 'POST') return jsonResponse({ result: true, cust_branch_id: 33 });
      return jsonResponse({ data: [{}] });
    },
    '/api/v3/sales/customers': (u, opts) => {
      if (u.includes('/10')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 20, br_name: 'Matriz' }] }] });
      if (u.includes('tax_id=')) return jsonResponse({ total: 1, data: [
        { customer_id: 10, CustName: 'HOTEL AZUL SA DE CV', cust_ref: 'Hotel Azul', tax_id: 'XAXX010101000' },
      ] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/quote': () => { quoteLlamado = true; return jsonResponse({ result: true, added_trans_no: 1902 }); },
  });

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({ sucursalDe: 10 });

  assert.equal(res.status, 503);
  assert.match(res.body.error, /sucursal/i);
  const paso = res.body.steps.find(s => s.name === 'verificar sucursal');
  assert.ok(paso && paso.status === 'error', 'el paso de verificacion queda en error');
  assert.equal(quoteLlamado, false, 'sin sucursal verificada no se sube el quote');

  const cot = readJson(COTS_PATH).find(c => c.id === id);
  assert.ok(!cot.folioOperam, 'la cotizacion queda PRE');
  assert.equal(cot.data.motivoPre, 'operam', 'PRE por Operam: el documento SI se entrega, sin numero');
  assert.equal(cot.data.cliente.branchId, undefined, 'no persiste una sucursal que no existe');
});

test('SUC3: reintentar "es sucursal" sobre la misma cotizacion NO crea una segunda sucursal', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  // La cotizacion ya quedo ligada al cliente 10 con la sucursal 33 que creo el
  // intento anterior (persistencia previa a la subida): el reintento la reusa.
  const id = nuevaCotizacion({ ...DOMICILIO, customerId: 10, branchId: 33 });
  let branchPosts = 0;
  let quoteBody = null;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/branches': (u, opts) => {
      if (opts?.method === 'POST') { branchPosts++; return jsonResponse({ result: true, cust_branch_id: 34 }); }
      return jsonResponse({ data: [{}] });
    },
    '/api/v3/sales/customers': (u, opts) => {
      if (u.includes('/10')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 20 }, { branch_code: 33 }] }] });
      if (u.includes('tax_id=')) return jsonResponse({ total: 1, data: [
        { customer_id: 10, CustName: 'HOTEL AZUL SA DE CV', cust_ref: 'Hotel Azul', tax_id: 'XAXX010101000' },
      ] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/quote': (u, opts) => { quoteBody = JSON.parse(opts.body); return jsonResponse({ result: true, added_trans_no: 1903 }); },
    ...mockWebLegacy(),
  });

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({ sucursalDe: 10 });

  assert.equal(res.status, 200);
  assert.equal(branchPosts, 0, 'la sucursal del intento anterior se reusa, no se duplica');
  assert.equal(quoteBody.customer_id, 10);
  assert.equal(quoteBody.branch_id, 33, 'el quote sale con la sucursal ya creada');
});

// El caso que de verdad puede duplicar: el POST SI escribio en Operam pero la
// relectura no la vio (justo el escenario que motiva releer, #74). El reintento
// entra sin nada persistido -- si no mirara antes de crear, dejaria DOS
// sucursales identicas bajo el cliente y ninguna forma de distinguirlas.
test('SUC3b: el POST escribio pero la relectura fallo -> el reintento reusa esa sucursal, no crea otra', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  const id = nuevaCotizacion(DOMICILIO);
  let branchPosts = 0;
  let quoteBody = null;
  // Operam si guarda la sucursal, pero el cliente tarda en listarla: el primer
  // intento no la ve y el segundo si.
  let branchesVisibles = [{ branch_code: 20, br_name: 'Matriz' }];
  let creadaEnOperam = null;
  const handlers = {
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/branches': (u, opts) => {
      if (opts?.method === 'POST') {
        branchPosts++;
        creadaEnOperam = { branch_code: 33, ...JSON.parse(opts.body) };
        return jsonResponse({ result: true, cust_branch_id: 33 });
      }
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      // GET de un branch por codigo: el 20 es la matriz, el 33 la recien creada.
      if (u.includes('/branches/33')) return jsonResponse({ data: [creadaEnOperam ? { ...creadaEnOperam, branch_code: 33 } : {}] });
      return jsonResponse({ data: [{ branch_code: 20, br_name: 'Matriz', addr_street: 'Otra calle', addr_zip: '11000' }] });
    },
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return jsonResponse({ result: true, customer_id: 999 });
      if (u.includes('/10')) return jsonResponse({ data: [{ sales_type: '12', branches: branchesVisibles }] });
      if (u.includes('tax_id=')) return jsonResponse({ total: 1, data: [
        { customer_id: 10, CustName: 'HOTEL AZUL SA DE CV', cust_ref: 'Hotel Azul', tax_id: 'XAXX010101000' },
      ] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/quote': (u, opts) => { quoteBody = JSON.parse(opts.body); return jsonResponse({ result: true, added_trans_no: 1904 }); },
    ...mockWebLegacy(),
  };
  mockOperamFetch(handlers);

  const primero = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({ sucursalDe: 10 });
  assert.equal(primero.status, 503, 'la relectura no la vio: no finge exito');
  assert.equal(branchPosts, 1);

  // Ahora Operam si la lista: el reintento debe encontrarla antes de crear.
  branchesVisibles = [...branchesVisibles, { branch_code: 33, br_name: 'Recepcion' }];

  const segundo = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({ sucursalDe: 10 });

  assert.equal(segundo.status, 200);
  assert.equal(branchPosts, 1, 'el reintento NO crea una segunda sucursal');
  assert.equal(quoteBody.customer_id, 10);
  assert.equal(quoteBody.branch_id, 33, 'el quote sale con la sucursal que si quedo en Operam');
});

test('SUC4: el flag de sucursal no debilita la guarda del celular ya ligado a OTRO cliente', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase({ cliente_id: 555 })]);
  const id = nuevaCotizacion(DOMICILIO);
  let escrituras = 0;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/branches': (u, opts) => { if (opts?.method !== 'GET') escrituras++; return jsonResponse({ result: true, cust_branch_id: 33 }); },
    '/api/v3/sales/customers': () => jsonResponse({ total: 0, data: [] }),
    '/api/v3/sales/quote': () => { escrituras++; return jsonResponse({ result: true, added_trans_no: 1 }); },
  });

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({ sucursalDe: 10 });

  assert.equal(res.status, 409);
  assert.match(res.body.error, /555/, 'dice a que cliente esta ligado el celular');
  assert.equal(escrituras, 0, 'cero escrituras en Operam');
});

test('SUC5: sucursalDe que ya no esta en el pool recalculado -> 409 con candidatos frescos, cero escrituras', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  const id = nuevaCotizacion(DOMICILIO);
  let branchPosts = 0;
  let quoteLlamado = false;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/branches': (u, opts) => { if (opts?.method === 'POST') branchPosts++; return jsonResponse({ result: true, cust_branch_id: 33 }); },
    '/api/v3/sales/customers': (u) => {
      // El 10 ya no esta en el pool: el vendedor trae un id de un 409 viejo.
      if (u.includes('tax_id=')) return jsonResponse({ total: 1, data: [
        { customer_id: 11, CustName: 'HOTEL AZUL NORTE SA', cust_ref: 'Hotel Azul', tax_id: 'XAXX010101000' },
      ] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/quote': () => { quoteLlamado = true; return jsonResponse({ result: true, added_trans_no: 1 }); },
  });

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({ sucursalDe: 10 });

  assert.equal(res.status, 409);
  assert.equal(res.body.candidatos.length, 1);
  assert.equal(res.body.candidatos[0].id, 11, 'la lista fresca, no la que trajo el vendedor');
  assert.equal(branchPosts, 0, 'no crea sucursal bajo un cliente que ya no es candidato');
  assert.equal(quoteLlamado, false);
  const cot = readJson(COTS_PATH).find(c => c.id === id);
  assert.equal(cot.data.motivoPre, 'dedup', 'mismo candado que la parada original');
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
      if (u.includes('/930')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 931 }] }] });
      return jsonResponse({ total: 0, data: [] }); // dedup por nombre: libre
    },
    '/api/v3/sales/branches/931': () => jsonResponse({ result: true, data: [{}] }),
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
      if (u.includes('/940')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 941 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/branches/941': () => jsonResponse({ result: true, data: [{}] }),
    '/api/v3/sales/quote': () => jsonResponse({ result: true, added_trans_no: 1751 }),
  });
  const intento2 = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});
  assert.equal(intento2.status, 200, 'el lock no quedo tomado tras el fallo');
});

// --- Post-fix de la vigencia (#106, ADR-0007) --------------------------------
// El POST del quote ignora valid_until y deja el campo nativo "Valido hasta" en
// ord_date-1, asi que Operam marca como vencidas cotizaciones vivas. Se corrige por la
// web legacy en cuanto el quote existe, y se verifica releyendo.

function mockSubidaBase(extra = {}) {
  return {
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/sales_types': () => jsonResponse({ data: [{ id: '15', sales_type: 'M100', inactive: '0' }] }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return jsonResponse({ result: true, customer_id: 960 });
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      if (u.includes('/960')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 961 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
    // issue #189: el PUT del branch ya no se omite sin domicilio (escribe tax_group_id/
    // sales_account); estos tests no verifican el branch, solo necesitan que no truene.
    '/api/v3/sales/branches/961': () => jsonResponse({ result: true, data: [{}] }),
    '/api/v3/sales/quote': () => jsonResponse({ result: true, added_trans_no: 1801 }),
    ...extra,
  };
}

test('V1: tras subir el quote se corrige la vigencia y el body lleva ProcessOrder, nunca CancelOrder', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  const id = nuevaCotizacion();
  let bodyPosteado = null;
  mockOperamFetch(mockSubidaBase(mockWebLegacy({ onPost: (b) => { bodyPosteado = b; } })));
  await cargarListasPrecios();

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});

  assert.equal(res.status, 200);
  const paso = res.body.steps.find(s => s.name === 'post-fix vigencia');
  assert.ok(paso, 'la subida reporta el paso del post-fix');
  assert.equal(paso.status, 'ok');

  const enviado = new URLSearchParams(bodyPosteado);
  // La fecha escrita es la MISMA vigencia que viajo en comments, no una recalculada.
  assert.equal(enviado.get('delivery_date'), '2026-08-05');
  assert.equal(enviado.get('ProcessOrder'), 'Confirmar Cambios');
  assert.equal(enviado.has('CancelOrder'), false, 'CancelOrder anularia la cotizacion');
  assert.equal(enviado.has('update'), false, 'update es "Recalculate"');
  // El resto del documento viaja intacto: el post-fix no decide su contenido.
  assert.equal(enviado.get('customer_id'), '376');
  assert.equal(enviado.get('sales_type'), '16');
});

test('V2: si la web legacy falla, la subida NO se cae -- el quote ya existe', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  const id = nuevaCotizacion();
  mockOperamFetch(mockSubidaBase({
    'sales_order_entry.php': () => { throw new Error('ECONNRESET'); },
    'view_sales_order.php': () => { throw new Error('ECONNRESET'); },
  }));
  await cargarListasPrecios();

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});

  assert.equal(res.status, 200, 'la subida se completa: comments sigue llevando la vigencia');
  assert.equal(res.body.folio, 1801);
  const paso = res.body.steps.find(s => s.name === 'post-fix vigencia');
  assert.equal(paso.status, 'error');
});

// Operam responde 200 aunque ignore campos (mismo quirk del PUT de clientes): sin
// releer, un post-fix que no pego se reportaria como exito.
test('V3: si la relectura no coincide, el paso queda en warn (no en ok)', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  const id = nuevaCotizacion();
  mockOperamFetch(mockSubidaBase(mockWebLegacy({ validoHasta: '2026-07-05' })));
  await cargarListasPrecios();

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});

  assert.equal(res.status, 200);
  const paso = res.body.steps.find(s => s.name === 'post-fix vigencia');
  assert.equal(paso.status, 'warn');
  assert.equal(paso.esperado, '2026-08-05');
  assert.equal(paso.encontrado, '2026-07-05');
});

// "No se pudo verificar" no es lo mismo que "quedo mal": si la vista no trae el campo,
// el paso lo dice (verificado: false) en vez de afirmar una discrepancia que nadie
// comprobo. El aviso al vendedor es el mismo -- revisar Operam -- pero el reporte no
// inventa un valor encontrado.
test('V4: vista sin el campo -> warn con verificado false, no una discrepancia inventada', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  const id = nuevaCotizacion();
  mockOperamFetch(mockSubidaBase(mockWebLegacy({ validoHasta: null })));
  await cargarListasPrecios();

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});

  assert.equal(res.status, 200);
  const paso = res.body.steps.find(s => s.name === 'post-fix vigencia');
  assert.equal(paso.status, 'warn');
  assert.equal(paso.verificado, false);
  assert.equal(paso.encontrado, null);
});

// --- Post-fix del SEGMENTO del cliente generico (#186) -----------------------
// El POST /customers manda segmento_id desde #121 y Operam lo IGNORA (la API v3 no lo
// escribe por ningun camino, #172): todo prospecto creado al subir una cotizacion quedaba
// en "Sin segmento" aunque el vendedor lo hubiera capturado. Lo repara el mismo post-fix
// web del upgrade fiscal, pero aqui va FIRE-AND-FORGET y encolado DESPUES del post-fix de
// vigencia: este camino corre dentro de la subida, que el frontend abandona a los 20s
// entregando una PRE-COTIZACION.

function mockFichaYWeb(opciones = {}) {
  const web = handlersWebFichaCliente(opciones);
  const orden = [];
  const handlers = mockSubidaBase({
    ...mockWebLegacy({ onPost: () => orden.push('vigencia') }),
    '/sales/manage/customers.php': (u, opts) => {
      if (opts?.method === 'POST') orden.push('segmento');
      return web.handlers['/sales/manage/customers.php'](u, opts);
    },
  });
  return { web, orden, handlers };
}

test('S1: cliente generico recien creado con segmento capturado -> el post-fix web lo escribe, despues de la vigencia', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  const id = nuevaCotizacion({ segmentoId: '14' });
  const { web, orden, handlers } = mockFichaYWeb();
  mockOperamFetch(handlers);
  await cargarListasPrecios();

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});
  await _esperarPostFixes();

  assert.equal(res.status, 200);
  assert.equal(res.body.folio, 1801, 'el folio sale sin esperar al post-fix del segmento');
  assert.deepEqual(web.gets, ['960'], 'pide la ficha del cliente que acaba de crear');
  assert.equal(web.posts.length, 1, 'un solo POST a la ficha');
  assert.equal(web.posts[0].get('segmento_id'), '14');
  assert.equal(web.posts[0].get('process'), 'Actualizar Cliente', 'el submit real de la ficha');
  assert.equal(web.estado.segmento, '14', 'el segmento quedo escrito en Operam');
  // La cola de post-fixes es FIFO y compartida: encolar el segmento ANTES meteria su
  // latencia en el camino critico aunque no se esperara el resultado.
  assert.deepEqual(orden, ['vigencia', 'segmento']);
});

test('S2: sin segmento capturado la subida NO toca la ficha de cliente', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  const id = nuevaCotizacion();
  const { web, handlers } = mockFichaYWeb();
  mockOperamFetch(handlers);
  await cargarListasPrecios();

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});
  await _esperarPostFixes();

  assert.equal(res.status, 200);
  assert.deepEqual(web.gets, [], 'sin segmento capturado no hay nada que corregir');
  assert.deepEqual(web.posts, []);
});

// Regla de #186: a un cliente que YA existe solo se le escribe el segmento si estaba en
// "Sin segmento". Un cliente clasificado antes no pierde su clasificacion porque en esta
// cotizacion se eligiera otra cosa (mismo espiritu que el PUT del branch de #96, que
// tampoco pisa el domicilio real de un cliente preexistente).
test('S3: cliente reutilizado por celular YA clasificado -> conserva su segmento', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase({ cliente_id: 555 })]);
  const id = nuevaCotizacion({ segmentoId: '14' });
  const { web, handlers } = mockFichaYWeb({ segmentoInicial: '10' });
  mockOperamFetch({
    ...handlers,
    '/api/v3/sales/customers': (u, opts) => {
      if (u.includes('/555')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 556 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
  });
  await cargarListasPrecios();

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});
  await _esperarPostFixes();

  assert.equal(res.status, 200);
  assert.equal(res.body.customer_id, 555);
  assert.deepEqual(web.gets, ['555'], 'lee la ficha: es la unica forma de saber como esta hoy');
  assert.deepEqual(web.posts, [], 'pero NO escribe: el cliente ya estaba clasificado');
  assert.equal(web.estado.segmento, '10');
});

test('S5: cliente reutilizado por celular SIN clasificar -> recibe el segmento capturado', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase({ cliente_id: 555 })]);
  const id = nuevaCotizacion({ segmentoId: '14' });
  const { web, handlers } = mockFichaYWeb({ segmentoInicial: '1' });
  mockOperamFetch({
    ...handlers,
    '/api/v3/sales/customers': (u, opts) => {
      if (u.includes('/555')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 556 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
  });
  await cargarListasPrecios();

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});
  await _esperarPostFixes();

  assert.equal(res.status, 200);
  assert.equal(web.posts.length, 1, 'estaba en "Sin segmento": aqui si se escribe');
  assert.equal(web.posts[0].get('segmento_id'), '14');
  assert.equal(web.estado.segmento, '14');
});

test('S4: la web rechaza el guardado -> la subida ya respondio con folio y nada se cae', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  const id = nuevaCotizacion({ segmentoId: '14' });
  const { web, handlers } = mockFichaYWeb({ err: 'El codigo postal no puede ser vacio' });
  mockOperamFetch(handlers);
  await cargarListasPrecios();

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});
  await _esperarPostFixes();

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.folio, 1801);
  assert.equal(web.estado.segmento, '1', 'FA rechazo el formulario entero: el segmento sigue como estaba');
  const cot = readJson(COTS_PATH).find(c => c.id === id);
  assert.equal(String(cot.folioOperam), '1801', 'la cotizacion quedo subida pese al fallo del post-fix');
});

// === Candado del documento por duplicado sin resolver (#204, ajuste) ===
// Ante candidatos la subida se detiene y ADEMAS el documento queda bajo llave:
// entregarlo con el duplicado sin resolver es justo lo que la dedup viene a
// evitar. El candado se aplica en los GET que regeneran, que van SIN auth.

test('M1: 409 por candidatos deja motivoPre dedup con marca de tiempo y bloquea el documento', async () => {
  writeJson(PROSPECTOS_PATH, []);
  const id = nuevaCotizacion({ rfc: 'XAXX010101000' });
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': (u) => {
      if (!u.includes('tax_id=XAXX010101000')) return jsonResponse({ total: 0, data: [] });
      return jsonResponse({ total: 1, data: [
        { customer_id: 10, CustName: 'HOTEL AZUL SA DE CV', cust_ref: 'Hotel Azul', tax_id: 'XAXX010101000' },
      ] });
    },
  });

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});
  assert.equal(res.status, 409);

  const cot = readJson(COTS_PATH).find(c => c.id === id);
  assert.equal(cot.data.motivoPre, 'dedup');
  assert.ok(Number.isFinite(Date.parse(cot.data.motivoPreDesde)), 'la marca de tiempo alimenta el barrido de 24h');

  // El candado vive en el GET, no en la UI: la ruta va sin auth y es el unico
  // camino que genera documento.
  const html = await supertest(app).get(`/api/cotizacion/html/${id}`);
  assert.equal(html.status, 409);
  assert.match(html.text, /duplicado/i);
  assert.doesNotMatch(html.text, /Portavasos|Plato/, 'no se filtra el documento');

  const pdf = await supertest(app).get(`/api/cotizacion/pdf/${id}`);
  assert.equal(pdf.status, 409);
  assert.match(pdf.body.error, /duplicado/i);
});

test('M2: resolver eligiendo candidato limpia motivoPre y libera el documento', async () => {
  writeJson(PROSPECTOS_PATH, []);
  const id = nuevaCotizacion({ rfc: 'XAXX010101000' });
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': (u) => {
      if (u.includes('/10')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 20 }] }] });
      if (!u.includes('tax_id=XAXX010101000')) return jsonResponse({ total: 0, data: [] });
      return jsonResponse({ total: 1, data: [
        { customer_id: 10, CustName: 'HOTEL AZUL SA DE CV', cust_ref: 'Hotel Azul', tax_id: 'XAXX010101000' },
      ] });
    },
    '/api/v3/sales/quote': () => jsonResponse({ result: true, added_trans_no: 1810 }),
  });

  await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', `Bearer ${TOKEN}`).send({});
  assert.equal(readJson(COTS_PATH).find(c => c.id === id).data.motivoPre, 'dedup');

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({ customerId: 10 });
  assert.equal(res.status, 200);

  const cot = readJson(COTS_PATH).find(c => c.id === id);
  assert.equal(cot.data.motivoPre, null, 'resuelto: el candado se levanta');
  const html = await supertest(app).get(`/api/cotizacion/html/${id}`);
  assert.equal(html.status, 200);
});

// El PRE por fallo de Operam NO es un duplicado: el documento sale igual, sin
// numero (ADR-0009). Es la distincion que justifica guardar el motivo.
test('M3: un fallo de Operam deja motivoPre operam y el documento SI se genera', async () => {
  writeJson(PROSPECTOS_PATH, [prospectoBase()]);
  const id = nuevaCotizacion();
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return jsonResponse({ result: true, customer_id: 930 });
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      if (u.includes('/930')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 931 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/branches/931': () => jsonResponse({ result: true, data: [{}] }),
    '/api/v3/sales/quote': () => jsonResponse({ error: 'boom' }, 500),
  });

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});
  assert.equal(res.status, 503);

  const cot = readJson(COTS_PATH).find(c => c.id === id);
  assert.equal(cot.data.motivoPre, 'operam');
  const html = await supertest(app).get(`/api/cotizacion/html/${id}`);
  assert.equal(html.status, 200, 'el PRE por fallo de Operam entrega documento');
});

// El barrido borra la cotizacion detenida por duplicado y NADA mas. Se prueba la
// orquestacion (listar -> nucleo puro -> borrar); la decision de que borrar tiene
// sus propios tests en test/pipeline.test.js.
test('M4: el barrido borra solo las dedup vencidas y respeta el resto', async () => {
  const viejo = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
  const idDedupVieja = nuevaCotizacion();
  const idDedupNueva = nuevaCotizacion();
  const idOperamVieja = nuevaCotizacion();
  const cots = readJson(COTS_PATH);
  Object.assign(cots.find(c => c.id === idDedupVieja).data, { motivoPre: 'dedup', motivoPreDesde: viejo });
  Object.assign(cots.find(c => c.id === idDedupNueva).data, { motivoPre: 'dedup', motivoPreDesde: new Date().toISOString() });
  Object.assign(cots.find(c => c.id === idOperamVieja).data, { motivoPre: 'operam', motivoPreDesde: viejo });
  writeJson(COTS_PATH, cots);

  const borradas = await barrerCotizacionesDedupVencidas();

  assert.deepEqual(borradas, [idDedupVieja]);
  const quedan = readJson(COTS_PATH).map(c => c.id);
  assert.ok(!quedan.includes(idDedupVieja), 'la dedup vencida se borro');
  assert.ok(quedan.includes(idDedupNueva), 'la dedup reciente sigue viva');
  assert.ok(quedan.includes(idOperamVieja), 'el PRE por fallo de Operam JAMAS se toca');
});

// === #242: el cust_ref es UNICO GLOBAL en Operam ==============================
// El nombre corto de la cotizacion se escribe como cust_ref del cliente generico
// y Operam lo exige unico en TODO el padron, sin importar el RFC. Dos frentes:
// DESCUBRIR (el dueno del nombre corto entra al picker aunque tenga RFC real, y
// asi el vendedor puede ligar la cotizacion al cliente que ya existia) y dar
// SALIDA (el 406 se traduce en un error accionable en vez de un callejon).

// Respuesta 406 de Operam tal cual llega: el validador acumula quejas en el mismo
// cuerpo, por eso el mensaje del cust_ref viaja acompanado (medido 2026-08-21).
function respuesta406CustRef() {
  return {
    ok: false, status: 406,
    text: async () => JSON.stringify({ messages: ['Already exists customer with same cust_ref', 'Campos requeridos no se encontraron'] }),
  };
}

// Padron completo de Operam (listado paginado que cachea indice-telefonos). Las
// rutas de dedup por RFC (?tax_id=) son OTRA consulta: aqui se distingue por la
// URL, igual que lo hace el cliente de Operam.
function esListadoPadron(u) {
  return u.includes('limit=100') && u.includes('skip=');
}

test('CR1: el dueno del nombre corto entra al picker aunque tenga RFC REAL y la dedup diga libre', async () => {
  writeJson(PROSPECTOS_PATH, []);
  // nombreCorto 'Hotel Azul'; el dueno lo tiene con otro case y espacios de sobra.
  const id = nuevaCotizacion({ rfc: 'XAXX010101000' });
  let postCustomer = false;
  let quoteLlamado = false;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { postCustomer = true; return jsonResponse({ result: true, customer_id: 999 }); }
      if (esListadoPadron(u)) {
        return jsonResponse({ total: 2, data: [
          { customer_id: 499, CustName: 'CUMBIARCA SA DE CV', cust_ref: '  hotel AZUL ', tax_id: 'CPE921211N76' },
          { customer_id: 77, CustName: 'OTRA COSA SA', cust_ref: 'Otra', tax_id: 'XAXX010101000' },
        ] });
      }
      // Los pools de los dos genericos no traen nada parecido: sin #242 el
      // veredicto seria 'libre' y el POST se estrellaria contra el 406.
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/quote': () => { quoteLlamado = true; return jsonResponse({ result: true, added_trans_no: 1 }); },
  });

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});

  assert.equal(res.status, 409);
  assert.equal(res.body.candidatos.length, 1, 'solo el dueno del nombre corto');
  const cand = res.body.candidatos[0];
  assert.equal(cand.id, 499);
  assert.equal(cand.custRefIgual, true, 'el picker tiene que poder decir POR QUE entro');
  assert.equal(cand.CustName, 'CUMBIARCA SA DE CV');
  assert.equal(cand.tax_id, 'CPE921211N76', 'el vendedor necesita ver que vive bajo otro RFC');
  assert.equal(postCustomer, false, 'no debe crear');
  assert.equal(quoteLlamado, false, 'no debe subir');
});

test('CR2: elegir al dueno del nombre corto pasa la revalidacion (#208) y sube el quote a ese cliente', async () => {
  writeJson(PROSPECTOS_PATH, []);
  const id = nuevaCotizacion({ rfc: 'XAXX010101000' });
  let postCustomer = false;
  let quoteBody = null;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { postCustomer = true; return jsonResponse({ result: true, customer_id: 999 }); }
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      if (esListadoPadron(u)) {
        return jsonResponse({ total: 1, data: [
          { customer_id: 499, CustName: 'CUMBIARCA SA DE CV', cust_ref: 'Hotel Azul', tax_id: 'CPE921211N76' },
        ] });
      }
      if (u.includes('/499')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 546 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/quote': (u, opts) => { quoteBody = JSON.parse(opts.body); return jsonResponse({ result: true, added_trans_no: 1801 }); },
    ...mockWebLegacy(),
  });

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({ customerId: 499 });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.customer_id, 499);
  assert.equal(postCustomer, false, 'elegir un candidato NO crea cliente');
  assert.equal(quoteBody.customer_id, 499);
  const cot = readJson(COTS_PATH).find(c => c.id === id);
  assert.equal(String(cot.folioOperam), '1801');
  assert.equal(cot.data.cliente.customerId, 499);
});

test('CR3: con el padron caido, el 406 de cust_ref se traduce en un error accionable (409) y el reintento no crea nada', async () => {
  writeJson(PROSPECTOS_PATH, []);
  const id = nuevaCotizacion({ rfc: 'XAXX010101000' });
  let intentosPost = 0;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/sales_types': () => jsonResponse({ data: [{ id: '15', sales_type: 'M100', inactive: '0' }] }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { intentosPost++; return respuesta406CustRef(); }
      // Padron vacio: la busqueda por cust_ref no aporta candidatos y el unico
      // aviso posible es el que da Operam al rechazar el POST.
      return jsonResponse({ total: 0, data: [] });
    },
  });
  await cargarListasPrecios();

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});

  assert.equal(res.status, 409);
  assert.equal(res.body.codigo, 'CUST_REF_DUPLICADO');
  assert.equal(res.body.nombreCorto, 'Hotel Azul');
  assert.match(res.body.error, /nombre corto/i);
  const paso = res.body.steps.find(s => s.name === 'POST customer');
  assert.equal(paso.status, 'error');
  assert.match(paso.error, /same cust_ref/);

  const cot = readJson(COTS_PATH).find(c => c.id === id);
  assert.ok(!cot.folioOperam, 'la cotizacion sigue PRE');
  assert.equal(cot.data.cliente.customerId, undefined, 'no quedo ligada a ningun cliente');

  // Reintentar SIN cambiar el nombre corto da exactamente lo mismo: el vendedor
  // tiene que cambiarlo, y el mensaje es lo unico que se lo puede decir.
  const otra = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});
  assert.equal(otra.status, 409);
  assert.equal(otra.body.codigo, 'CUST_REF_DUPLICADO');
  assert.equal(intentosPost, 2, 'el reintento vuelve a intentar y vuelve a chocar, sin crear nada');
});

test('CR3b: si el padron puede nombrar al dueno del cust_ref, el error accionable lo dice', async () => {
  writeJson(PROSPECTOS_PATH, []);
  const id = nuevaCotizacion({ rfc: 'XAXX010101000' });
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/sales_types': () => jsonResponse({ data: [{ id: '15', sales_type: 'M100', inactive: '0' }] }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return respuesta406CustRef();
      // El padron ve al dueno, pero el vendedor ya dijo "ninguno es el mismo
      // cliente" (#204): se crea de todos modos y Operam lo frena. El error tiene
      // que nombrar al dueno para que el vendedor sepa contra que choco.
      if (esListadoPadron(u)) {
        return jsonResponse({ total: 1, data: [
          { customer_id: 499, CustName: 'CUMBIARCA SA DE CV', cust_ref: 'Hotel Azul', tax_id: 'CPE921211N76' },
        ] });
      }
      return jsonResponse({ total: 0, data: [] });
    },
  });
  await cargarListasPrecios();

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({ crearNuevo: true });

  assert.equal(res.status, 409);
  assert.equal(res.body.codigo, 'CUST_REF_DUPLICADO');
  assert.match(res.body.error, /CUMBIARCA SA DE CV/);
  assert.match(res.body.error, /CPE921211N76/);
});

test('CR4: un 406 que NO es el del cust_ref conserva el 503 de siempre', async () => {
  writeJson(PROSPECTOS_PATH, []);
  const id = nuevaCotizacion({ rfc: 'XAXX010101000' });
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/sales_types': () => jsonResponse({ data: [{ id: '15', sales_type: 'M100', inactive: '0' }] }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') {
        return { ok: false, status: 406, text: async () => JSON.stringify({ messages: ['Campos requeridos no se encontraron'] }) };
      }
      return jsonResponse({ total: 0, data: [] });
    },
  });
  await cargarListasPrecios();

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});

  assert.equal(res.status, 503);
  assert.equal(res.body.codigo, undefined, 'solo el choque de cust_ref se traduce');
  const cot = readJson(COTS_PATH).find(c => c.id === id);
  assert.equal(cot.data.motivoPre, 'operam');
});

test('CR5: sin nombre corto no hay busqueda por cust_ref y el alta corre como siempre', async () => {
  writeJson(PROSPECTOS_PATH, []);
  const id = nuevaCotizacion({ nombreCorto: '' });
  let postCustomer = false;
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/sales_types': () => jsonResponse({ data: [{ id: '15', sales_type: 'M100', inactive: '0' }] }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { postCustomer = true; return jsonResponse({ result: true, customer_id: 940 }); }
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      if (u.includes('/940')) return jsonResponse({ data: [{ sales_type: '12', branches: [{ branch_code: 941 }] }] });
      // Un cliente del padron CON cust_ref vacio no puede volverse candidato de
      // una cotizacion sin nombre corto (dos vacios no son una coincidencia).
      if (esListadoPadron(u)) {
        return jsonResponse({ total: 1, data: [{ customer_id: 499, CustName: 'CUMBIARCA SA', cust_ref: '', tax_id: 'CPE921211N76' }] });
      }
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/branches/941': (u, opts) => {
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      return jsonResponse({ data: [{ br_name: 'Hotel Azul Centro' }] });
    },
    '/api/v3/sales/quote': () => jsonResponse({ result: true, added_trans_no: 1802 }),
    ...mockWebLegacy(),
  });
  await cargarListasPrecios();

  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${TOKEN}`).send({});

  assert.equal(res.status, 200);
  assert.equal(postCustomer, true);
  assert.equal(res.body.customer_id, 940);
});
