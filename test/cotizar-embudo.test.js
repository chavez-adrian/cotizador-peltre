import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROSPECTOS_PATH = join(__dirname, '..', 'data', 'prospectos.json');
const COTS_PATH = join(__dirname, '..', 'data', 'cotizaciones.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');
const { resetIndice } = await import('../lib/indice-telefonos.js');
const { resetSession } = await import('../lib/operam-client.js');
const MEMO_TOKEN = jwt.sign({ id: 7, name: 'Memo', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });
const ANA_TOKEN = jwt.sign({ id: 8, name: 'Ana', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });

function readProspectos() {
  if (!existsSync(PROSPECTOS_PATH)) return [];
  return JSON.parse(readFileSync(PROSPECTOS_PATH, 'utf8'));
}
function writeProspectos(data) {
  writeFileSync(PROSPECTOS_PATH, JSON.stringify(data, null, 2));
}
function readCots() {
  if (!existsSync(COTS_PATH)) return [];
  return JSON.parse(readFileSync(COTS_PATH, 'utf8'));
}

// Ningun test pega a Operam real: fetch bloqueado por defecto (la clasificacion
// best effort cae a libre) y cada test que necesita Operam instala sus handlers.
const originalFetch = globalThis.fetch;
const fetchBloqueado = async (url) => { throw new Error('fetch sin mock en tests: ' + url); };

function mockFetchByUrl(handlers) {
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

function mockListadoClientes(clientes) {
  mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': () => jsonResponse({ total: clientes.length, data: clientes }),
  });
}

const CLIENTE_OPERAM = {
  customer_id: '77', CustName: 'HOTELERA DEL SUR SA DE CV',
  contacts: [{ phone: '+52 55 1234 5678', phone2: '' }],
  branches: [],
};

function prospectoDe(vendedor, etapa = 'por_cotizar', extra = {}) {
  return {
    id: 1, fecha: '2026-06-01T00:00:00Z', vendedor, celular: '+52 5512345678',
    celular10: '5512345678', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp',
    etapa, eventos: [], data: {}, ...extra,
  };
}

let savedProspectos, savedCots;
let existiaProspectos;
before(() => {
  existiaProspectos = existsSync(PROSPECTOS_PATH);
  savedProspectos = readProspectos();
  savedCots = readCots();
  globalThis.fetch = fetchBloqueado;
});
after(() => {
  if (existiaProspectos) writeProspectos(savedProspectos);
  else if (existsSync(PROSPECTOS_PATH)) unlinkSync(PROSPECTOS_PATH);
  writeFileSync(COTS_PATH, JSON.stringify(savedCots, null, 2));
  globalThis.fetch = originalFetch;
});
beforeEach(() => {
  globalThis.fetch = fetchBloqueado;
  resetIndice();
  resetSession();
});

// === GET /api/prospectos/clasificar (pre-clasificacion para el frontend) ===

test('E1: GET /api/prospectos/clasificar sin token responde 401', async () => {
  const res = await supertest(app).get('/api/prospectos/clasificar?celular=%2B52%205512345678');
  assert.equal(res.status, 401);
});

test('E2: GET /api/prospectos/clasificar sin celular responde 400', async () => {
  const res = await supertest(app).get('/api/prospectos/clasificar')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(res.status, 400);
});

test('E3: celular de prospecto clasifica como prospecto exponiendo nombre y vendedor, sea de quien sea (#69)', async () => {
  writeProspectos([prospectoDe('Memo')]);
  const propio = await supertest(app).get('/api/prospectos/clasificar')
    .query({ celular: '+52 55 1234 5678' })
    .set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(propio.status, 200);
  assert.deepEqual(propio.body, { tipo: 'prospecto', prospecto: { nombre: 'Laura', vendedor: 'Memo' } });
  const ajeno = await supertest(app).get('/api/prospectos/clasificar')
    .query({ celular: '+52 5512345678' })
    .set('Authorization', `Bearer ${ANA_TOKEN}`);
  assert.deepEqual(ajeno.body, { tipo: 'prospecto', prospecto: { nombre: 'Laura', vendedor: 'Memo' } });
});

test('E4: celular de cliente Operam clasifica como cliente con su nombre', async () => {
  writeProspectos([]);
  mockListadoClientes([CLIENTE_OPERAM]);
  const res = await supertest(app).get('/api/prospectos/clasificar')
    .query({ celular: '+52 5512345678' })
    .set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { tipo: 'cliente', cust_name: 'HOTELERA DEL SUR SA DE CV' });
});

test('E5: celular desconocido clasifica libre, tambien cuando Operam falla (best effort)', async () => {
  writeProspectos([]);
  mockListadoClientes([CLIENTE_OPERAM]);
  const libre = await supertest(app).get('/api/prospectos/clasificar')
    .query({ celular: '+52 5599999999' })
    .set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.deepEqual(libre.body, { tipo: 'libre' });
  resetIndice();
  resetSession();
  globalThis.fetch = fetchBloqueado;
  const caido = await supertest(app).get('/api/prospectos/clasificar')
    .query({ celular: '+52 5512345678' })
    .set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.deepEqual(caido.body, { tipo: 'libre' });
});

// === Hook al crear cotizacion (los tres caminos del issue #46) ===

function bodyCotizacion(telefono, extra = {}) {
  return {
    fecha: '2026-06-11', vigencia: '2026-07-11', tier: 'Mayoreo',
    cliente: {
      razonSocial: 'LAURA SA DE CV', nombreCorto: 'Laura', telefono,
      municipio: 'Puebla', estado: 'Puebla',
    },
    items: [{ codigo: 'TEST', descripcion: 'Test', cantidad: 10, unidad: 'pza', precio: 100, descuento: 0 }],
    subtotal: 1000, iva: 160, total: 1160, notas: [],
    ...extra,
  };
}

async function cotizarHtml(token, body) {
  return supertest(app).post('/api/cotizacion/html')
    .set('Authorization', `Bearer ${token}`).send(body);
}

test('H1: cotizar con el celular de un prospecto lo pasa a Seguimiento con el evento de la cotizacion', async () => {
  writeProspectos([prospectoDe('Memo')]);
  const res = await cotizarHtml(MEMO_TOKEN, bodyCotizacion('+52 55 1234 5678'));
  assert.equal(res.status, 200);
  const cotizacionId = Number(res.headers['x-cotizacion-id']);
  assert.ok(cotizacionId > 0);
  const p = readProspectos()[0];
  assert.equal(p.etapa, 'seguimiento');
  const ev = p.eventos.find(e => e.tipo === 'cotizacion');
  assert.ok(ev, 'evento de cotizacion registrado');
  assert.equal(ev.cotizacion_id, cotizacionId);
  assert.equal(ev.de, 'por_cotizar');
  assert.equal(ev.vendedor, 'Memo');
  assert.ok(ev.fecha);
});

test('H2: la transicion automatica a Seguimiento aplica aunque el prospecto sea de otro vendedor', async () => {
  writeProspectos([prospectoDe('Memo', 'por_cotizar')]);
  const res = await cotizarHtml(ANA_TOKEN, bodyCotizacion('+52 5512345678'));
  assert.equal(res.status, 200);
  const p = readProspectos()[0];
  assert.equal(p.etapa, 'seguimiento');
  const ev = p.eventos.find(e => e.tipo === 'cotizacion');
  assert.equal(ev.de, 'por_cotizar');
  assert.equal(ev.vendedor, 'Ana');
});

test('H3: cotizar revive un prospecto en No util y registra de donde venia', async () => {
  writeProspectos([prospectoDe('Memo', 'no_util')]);
  const res = await cotizarHtml(MEMO_TOKEN, bodyCotizacion('+52 5512345678'));
  assert.equal(res.status, 200);
  const p = readProspectos()[0];
  assert.equal(p.etapa, 'seguimiento');
  const ev = p.eventos.find(e => e.tipo === 'cotizacion');
  assert.equal(ev.de, 'no_util');
});

test('H4: cotizar a un prospecto ya en Seguimiento solo registra el evento nuevo (idempotente)', async () => {
  writeProspectos([prospectoDe('Memo', 'seguimiento', {
    eventos: [{ tipo: 'cotizacion', cotizacion_id: 5, de: 'por_cotizar', fecha: '2026-06-10T10:00:00Z', vendedor: 'Memo' }],
  })]);
  const res = await cotizarHtml(MEMO_TOKEN, bodyCotizacion('+52 5512345678'));
  assert.equal(res.status, 200);
  const cotizacionId = Number(res.headers['x-cotizacion-id']);
  const p = readProspectos()[0];
  assert.equal(p.etapa, 'seguimiento');
  const eventos = p.eventos.filter(e => e.tipo === 'cotizacion');
  assert.equal(eventos.length, 2);
  assert.equal(eventos[1].cotizacion_id, cotizacionId);
  assert.equal(p.eventos.filter(e => e.tipo === 'etapa').length, 0);
});

test('H5: celular libre con canal valido auto-crea el prospecto en Seguimiento con datos de la cotizacion', async () => {
  writeProspectos([]);
  const res = await cotizarHtml(MEMO_TOKEN, bodyCotizacion('+52 5599999999', { canal: 'Instagram' }));
  assert.equal(res.status, 200);
  const cotizacionId = Number(res.headers['x-cotizacion-id']);
  const prospectos = readProspectos();
  assert.equal(prospectos.length, 1);
  const p = prospectos[0];
  assert.equal(p.etapa, 'seguimiento');
  assert.equal(p.nombre, 'Laura');
  assert.equal(p.ciudad, 'Puebla');
  assert.equal(p.canal, 'Instagram');
  assert.equal(p.vendedor, 'Memo');
  assert.equal(p.celular, '+52 5599999999');
  const ev = p.eventos.find(e => e.tipo === 'cotizacion');
  assert.ok(ev, 'la cotizacion que lo origino queda en su historial');
  assert.equal(ev.cotizacion_id, cotizacionId);
});

test('H6: celular libre sin canal en el body no auto-crea prospecto (API directa)', async () => {
  writeProspectos([]);
  const res = await cotizarHtml(MEMO_TOKEN, bodyCotizacion('+52 5599999999'));
  assert.equal(res.status, 200);
  assert.equal(readProspectos().length, 0);
});

test('H7: canal fuera del catalogo cerrado no auto-crea prospecto', async () => {
  writeProspectos([]);
  const res = await cotizarHtml(MEMO_TOKEN, bodyCotizacion('+52 5599999999', { canal: 'TikTok' }));
  assert.equal(res.status, 200);
  assert.equal(readProspectos().length, 0);
});

test('H8: celular de un cliente Operam no crea prospecto aunque venga canal', async () => {
  writeProspectos([]);
  mockListadoClientes([CLIENTE_OPERAM]);
  const res = await cotizarHtml(MEMO_TOKEN, bodyCotizacion('+52 5512345678', { canal: 'WhatsApp' }));
  assert.equal(res.status, 200);
  assert.equal(readProspectos().length, 0);
});

test('H9: un fallo del hook jamas rompe la generacion de la cotizacion', async () => {
  writeFileSync(PROSPECTOS_PATH, '{corrupto');
  const res = await cotizarHtml(MEMO_TOKEN, bodyCotizacion('+52 5512345678', { canal: 'WhatsApp' }));
  assert.equal(res.status, 200);
  assert.match(res.text, /Laura|LAURA/);
  writeProspectos([]);
});

test('H11: la regla de dominio gobierna el hook: una cotizacion no retrocede una tarjeta post-venta', async () => {
  // producto_entregado es post-venta: lo mueve Operam, no una cotizacion. El hook
  // debe respetar transicionPorCotizacion (null) y NO regresar la tarjeta a
  // Seguimiento; solo deja el evento de la cotizacion en el historial.
  writeProspectos([prospectoDe('Memo', 'producto_entregado')]);
  const res = await cotizarHtml(MEMO_TOKEN, bodyCotizacion('+52 5512345678'));
  assert.equal(res.status, 200);
  const cotizacionId = Number(res.headers['x-cotizacion-id']);
  const p = readProspectos()[0];
  assert.equal(p.etapa, 'producto_entregado');
  const ev = p.eventos.find(e => e.tipo === 'cotizacion');
  assert.ok(ev, 'la cotizacion queda registrada aunque la etapa no cambie');
  assert.equal(ev.cotizacion_id, cotizacionId);
});

test('H10: el hook tambien corre al generar PDF', async () => {
  writeProspectos([prospectoDe('Memo')]);
  const res = await supertest(app).post('/api/cotizacion/pdf')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`)
    .send(bodyCotizacion('+52 5512345678'));
  assert.equal(res.status, 200);
  const p = readProspectos()[0];
  assert.equal(p.etapa, 'seguimiento');
  assert.ok(p.eventos.some(e => e.tipo === 'cotizacion'));
});

// === Subir a Operam guarda el folio (issue #63: la cotizacion deja de ser PRE) ===

const cotStore = await import('../lib/cotizaciones-store.js');
const { esPreCotizacion } = await import('../lib/pipeline.js');

test('O1: subir una cotizacion a Operam le guarda el folio devuelto (deja de ser PRE)', async () => {
  writeProspectos([]);
  const id = await cotStore.crear({
    fecha: '2026-06-10T00:00:00Z', vendedor: 'Memo', cliente: 'HOTELERA DEL SUR',
    totalPiezas: 10, total: 1160, tier: 'Mayoreo',
    data: { cliente: { razonSocial: 'HOTELERA DEL SUR SA DE CV', rfc: 'HSU010101AAA' }, items: [] },
  });
  // Pre-condicion: nace sin folio (pre-cotizacion).
  assert.equal((await cotStore.obtener(id)).folioOperam, null);
  mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': () => jsonResponse({ total: 1, data: [{ customer_id: '77', tax_id: 'HSU010101AAA', CustName: 'HOTELERA DEL SUR SA DE CV', branches: [{ branch_code: '1' }] }] }),
    '/api/v3/sales/quote': () => jsonResponse({ result: true, quote_id: 55123 }),
  });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.folio, 55123);
  // El folio quedo persistido como identificador (texto): la cotizacion ya no es PRE.
  assert.equal((await cotStore.obtener(id)).folioOperam, '55123');
  assert.equal(esPreCotizacion(await cotStore.obtener(id)), false);
});

test('O3: generar una pre-cotizacion (celular libre, sin alta) mueve la tarjeta a Seguimiento conservando el PRE', async () => {
  // Prospecto Minimo: celular libre + canal del catalogo, sin alta de cliente en
  // Operam. La cotizacion se genera, auto-crea el prospecto en Seguimiento (#46/#55)
  // y nace SIN folio: es una pre-cotizacion (estado PRE) que conserva su PRE hasta
  // formalizarse. Slice end-to-end del issue #63.
  writeProspectos([]);
  const res = await cotizarHtml(MEMO_TOKEN, bodyCotizacion('+52 5599999999', { canal: 'WhatsApp' }));
  assert.equal(res.status, 200);
  const cotizacionId = Number(res.headers['x-cotizacion-id']);
  // La oportunidad esta en Seguimiento...
  const p = readProspectos()[0];
  assert.equal(p.etapa, 'seguimiento');
  assert.equal(p.celular, '+52 5599999999');
  // ...y la cotizacion sigue siendo PRE (sin folio de Operam): no se registro nada.
  const cot = await cotStore.obtener(cotizacionId);
  assert.equal(cot.folioOperam, null);
  assert.equal(esPreCotizacion(cot), true);
});

// === Formalizar pre-cotizacion: alta de cliente + registro (issue #66) ===
// "Completar despues" desde la tarjeta encadena dos piezas existentes (alta de
// cliente con guardrails/dedup + registro de la cotizacion). Idempotentes y
// desacopladas: si el registro fallara el alta ya hecha persiste y la cotizacion
// sigue PRE para reintentar (O2). Aqui el camino feliz end-to-end y el guardrail.

test('F1: formalizar una pre-cotizacion da de alta el cliente y registra la cotizacion, que deja de ser PRE', async () => {
  writeProspectos([]);
  // Pre-cotizacion (sin folio = PRE), emitida con Prospecto Minimo y RFC capturado.
  const id = await cotStore.crear({
    fecha: '2026-06-16T00:00:00Z', vendedor: 'Memo', cliente: 'LAURA SA DE CV',
    totalPiezas: 10, total: 1160, tier: 'Mayoreo',
    data: { cliente: { razonSocial: 'LAURA SA DE CV', rfc: 'LAU010101AAA' }, items: [] },
  });
  assert.equal(esPreCotizacion(await cotStore.obtener(id)), true);

  // Paso 1: alta de cliente en Operam (RFC nuevo: el guardrail de dedup deja pasar).
  mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/branches/600': () => jsonResponse({ result: true }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return jsonResponse({ result: true, customer_id: 500 });
      if (u.includes('/500')) return jsonResponse({ data: [{ branches: [{ branch_code: 600 }] }] });
      return jsonResponse({ total: 0, data: [] }); // dedup: RFC no existe -> alta procede
    },
  });
  const alta = await supertest(app).post('/api/crear-cliente')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`)
    .send({ tax_id: 'LAU010101AAA', CustName: 'LAURA SA DE CV', entrega: {} });
  assert.equal(alta.status, 200);
  assert.equal(alta.body.ok, true);
  assert.equal(alta.body.duplicado, false);
  assert.equal(alta.body.customer_id, 500);

  // Paso 2: registrar la cotizacion (el cliente ya existe en Operam por RFC).
  resetSession();
  mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': () => jsonResponse({ total: 1, data: [{ customer_id: '500', tax_id: 'LAU010101AAA', CustName: 'LAURA SA DE CV', branches: [{ branch_code: '600' }] }] }),
    '/api/v3/sales/quote': () => jsonResponse({ result: true, quote_id: 77001 }),
  });
  const reg = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({});
  assert.equal(reg.status, 200);
  assert.equal(reg.body.folio, 77001);
  // La pre-cotizacion se formalizo: tiene folio de Operam y ya no es PRE.
  const cot = await cotStore.obtener(id);
  assert.equal(cot.folioOperam, '77001');
  assert.equal(esPreCotizacion(cot), false);
});

test('F2: el alta del paso de formalizacion conserva el guardrail de deduplicacion (RFC ya en Operam no duplica)', async () => {
  writeProspectos([]);
  // Caso "ya es cliente Operam": el RFC ya existe. El alta NO crea un duplicado;
  // devuelve el cliente existente para que la formalizacion solo registre.
  let postCustomerCalled = false;
  mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { postCustomerCalled = true; return jsonResponse({ result: true, customer_id: 999 }); }
      // GET por tax_id (dedup): el cliente ya existe.
      return jsonResponse({ total: 1, data: [{ customer_id: 500, CustName: 'LAURA SA DE CV', tax_id: 'LAU010101AAA', branches: [] }] });
    },
  });
  const alta = await supertest(app).post('/api/crear-cliente')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`)
    .send({ tax_id: 'LAU010101AAA', CustName: 'LAURA SA DE CV', entrega: {} });
  assert.equal(alta.status, 200);
  assert.equal(alta.body.duplicado, true, 'el guardrail detecta el RFC existente');
  assert.equal(alta.body.customer_id, 500, 'reutiliza el cliente existente');
  assert.equal(postCustomerCalled, false, 'no crea un cliente duplicado');
});

test('O2: si la subida a Operam falla, la cotizacion sigue sin folio (sigue PRE)', async () => {
  writeProspectos([]);
  const id = await cotStore.crear({
    fecha: '2026-06-10T00:00:00Z', vendedor: 'Memo', cliente: 'HOTELERA DEL SUR',
    totalPiezas: 10, total: 1160, tier: 'Mayoreo',
    data: { cliente: { razonSocial: 'HOTELERA DEL SUR SA DE CV', rfc: 'HSU010101AAA' }, items: [] },
  });
  mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': () => jsonResponse({ total: 0, data: [] }),
  });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({});
  // #68: cliente no identificado por RFC -> 422 (problema de datos), no se sube ni
  // se persiste folio. Antes era 503 enmascarando un fallo de Operam inexistente.
  assert.equal(res.status, 422);
  assert.equal((await cotStore.obtener(id)).folioOperam, null);
});
