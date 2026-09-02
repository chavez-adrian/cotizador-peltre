// #279 (spec #278): el precio manual de calca lo hace valer el SERVIDOR, no la
// pantalla -- esconder el input no frena un POST armado a mano. Prior art exacto:
// test/tier-api.test.js (#151), mismo patron de permiso sobre POST /api/cotizacion.
// En este ticket el permiso es el rol admin; el checkbox por vendedor es #280.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const COTS_PATH = join(DATA_DIR, 'cotizaciones.json');
const VENDEDORES_PATH = join(DATA_DIR, 'vendedores.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

// PDFKit codifica el texto en hex dentro de los operadores TJ: con
// _compress:false el content stream es legible pero solo buscable en hex
// (mismo helper que test/server.test.js).
function toHex(s) {
  return Buffer.from(s, 'latin1').toString('hex');
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');

const tokenAdmin = jwt.sign({ id: 1, name: 'Admin Test', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
const tokenVendedor = jwt.sign({ id: 2, name: 'Vendedor Test', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });

function readCots() {
  if (!existsSync(COTS_PATH)) return [];
  return JSON.parse(leerArchivoSync(COTS_PATH));
}
function writeCots(data) {
  escribirArchivoSync(COTS_PATH, JSON.stringify(data, null, 2));
}

const originalFetch = globalThis.fetch;
function mockFetchByUrl(handlers) {
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    for (const [pat, fn] of Object.entries(handlers)) {
      if (u.includes(pat)) return fn(u, opts);
    }
    throw new Error('Unmocked fetch: ' + u);
  };
  return () => { globalThis.fetch = originalFetch; };
}
function jsonResponse(data, status = 200) {
  return { ok: status < 400, status, json: async () => data };
}

// 10 piezas de producto: el tabulador vigente en data/precios.json las resuelve
// a Menudeo, asi que el tier no dispara la validacion de lista fijada (#151).
// Las 100 piezas de calca no cuentan para el volumen (#91) y su precio de lista
// en M100 es 29.66; 137.5 es lo que "cotizo el proveedor" para ese diseno.
const PRECIO_LISTA_CALCA = 29.66;
const PRECIO_PROVEEDOR = 137.5;

function cotizacionCon(items, extra = {}) {
  return {
    fecha: '2026-01-01', vigencia: '2026-02-01', tier: 'Menudeo', _compress: false,
    cliente: { razonSocial: 'Calca SA de CV', nombreCorto: 'Calca', telefono: '+52 55 1234 5678' },
    items,
    subtotal: 1000, iva: 160, total: 1160, notas: [],
    ...extra,
  };
}

const PARTIDA_PRODUCTO = { codigo: 'AB12', descripcion: 'Olla', cantidad: 10, unidad: 'pza', precio: 100, descuento: 0 };
function partidaCalca(extra = {}) {
  return {
    codigo: 'CAL1050', descripcion: 'Calca mediana - Diseño 1', cantidad: 100, unidad: 'pza',
    precio: PRECIO_LISTA_CALCA, descuento: 0, diseno: 1, descripcionEditada: true, ...extra,
  };
}

function partidaGuardada(id, codigo) {
  return readCots().find(c => c.id === id).data.items.find(i => i.codigo === codigo);
}

let cotsOriginal;
before(() => { cotsOriginal = readCots(); });
after(() => { writeCots(cotsOriginal); globalThis.fetch = originalFetch; });

test('#279 admin: la calca se persiste con el precio del proveedor como precio de la linea', async () => {
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send(cotizacionCon([PARTIDA_PRODUCTO, partidaCalca({ precio: PRECIO_PROVEEDOR, precioManual: PRECIO_PROVEEDOR })]));
  assert.strictEqual(res.status, 200);
  const calca = partidaGuardada(res.body.id, 'CAL1050');
  assert.strictEqual(calca.precio, PRECIO_PROVEEDOR);
  assert.strictEqual(calca.precioManual, PRECIO_PROVEEDOR);
  // La partida de producto no gana la llave: el precio manual es solo de calca.
  assert.strictEqual('precioManual' in partidaGuardada(res.body.id, 'AB12'), false);
});

// El servidor no confia en el `precio` que manda la pantalla: si los dos campos
// llegan distintos, el documento y el quote saldrian con el de lista y el manual
// quedaria de adorno en el registro.
test('#279 admin: con precio y precioManual distintos, el servidor impone el manual', async () => {
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send(cotizacionCon([PARTIDA_PRODUCTO, partidaCalca({ precio: PRECIO_LISTA_CALCA, precioManual: PRECIO_PROVEEDOR })]));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(partidaGuardada(res.body.id, 'CAL1050').precio, PRECIO_PROVEEDOR);
});

test('#279 admin: sin captura la calca conserva su precio de lista y no gana la llave', async () => {
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send(cotizacionCon([PARTIDA_PRODUCTO, partidaCalca()]));
  assert.strictEqual(res.status, 200);
  const calca = partidaGuardada(res.body.id, 'CAL1050');
  assert.strictEqual(calca.precio, PRECIO_LISTA_CALCA);
  assert.strictEqual('precioManual' in calca, false);
});

test('#279 vendedor sin permiso: precio manual rechazado con 403 y nada guardado', async () => {
  const antes = readCots().length;
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenVendedor}`)
    .send(cotizacionCon([PARTIDA_PRODUCTO, partidaCalca({ precio: PRECIO_PROVEEDOR, precioManual: PRECIO_PROVEEDOR })]));
  assert.strictEqual(res.status, 403);
  assert.match(res.body.error, /permiso/i);
  assert.strictEqual(readCots().length, antes);
});

test('#279 vendedor sin permiso: una cotizacion con calca SIN captura se guarda igual que siempre', async () => {
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenVendedor}`)
    .send(cotizacionCon([PARTIDA_PRODUCTO, partidaCalca()]));
  assert.strictEqual(res.status, 200);
});

// #280: checkbox de precio de calca por vendedor, espejo exacto de las pruebas
// de fijar lista en test/tier-api.test.js (#153). Se modifica el registro real
// y se restaura al final (mismo cuidado que esa suite).
test('#280: la pantalla recibe su permiso de precio de calca vigente en /api/precios', async () => {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    const registro = JSON.parse(original);
    registro.find(v => v.id === 2).puedePrecioCalca = true;
    escribirArchivoSync(VENDEDORES_PATH, JSON.stringify(registro, null, 2));
    const conFlag = await supertest(app).get('/api/precios').set('Authorization', `Bearer ${tokenVendedor}`);
    assert.strictEqual(conFlag.body.puedePrecioCalca, true);

    registro.find(v => v.id === 2).puedePrecioCalca = false;
    escribirArchivoSync(VENDEDORES_PATH, JSON.stringify(registro, null, 2));
    const sinFlag = await supertest(app).get('/api/precios').set('Authorization', `Bearer ${tokenVendedor}`);
    assert.strictEqual(sinFlag.body.puedePrecioCalca, false);

    const admin = await supertest(app).get('/api/precios').set('Authorization', `Bearer ${tokenAdmin}`);
    assert.strictEqual(admin.body.puedePrecioCalca, true);
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
});

test('#280: vendedor CON checkbox de precio de calca genera cotizacion con precio manual de punta a punta', async () => {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    const registro = JSON.parse(original);
    registro.find(v => v.id === 2).puedePrecioCalca = true;
    escribirArchivoSync(VENDEDORES_PATH, JSON.stringify(registro, null, 2));

    const res = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send(cotizacionCon([PARTIDA_PRODUCTO, partidaCalca({ precio: PRECIO_PROVEEDOR, precioManual: PRECIO_PROVEEDOR })]));
    assert.strictEqual(res.status, 200);
    const calca = partidaGuardada(res.body.id, 'CAL1050');
    assert.strictEqual(calca.precio, PRECIO_PROVEEDOR);
    assert.strictEqual(calca.precioManual, PRECIO_PROVEEDOR);
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
});

test('#279: precio manual en una partida que no es calca -> 400 y nada guardado', async () => {
  const antes = readCots().length;
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send(cotizacionCon([{ ...PARTIDA_PRODUCTO, precioManual: 45 }]));
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /calca/i);
  assert.strictEqual(readCots().length, antes);
});

test('#279: un precio manual que no es numero mayor que cero -> 400 (dato mal formado, no permiso)', async () => {
  for (const valor of [0, -5, 'abc']) {
    const res = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send(cotizacionCon([PARTIDA_PRODUCTO, partidaCalca({ precioManual: valor })]));
    assert.strictEqual(res.status, 400, `precioManual ${JSON.stringify(valor)}`);
  }
});

// El documento del cliente no lleva marca del precio manual (decision
// 2026-09-01): sale como precio unitario normal de la partida.
test('#279: el PDF y el HTML regenerados imprimen el precio del proveedor', async () => {
  const creada = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send(cotizacionCon([PARTIDA_PRODUCTO, partidaCalca({ precio: PRECIO_PROVEEDOR, precioManual: PRECIO_PROVEEDOR })]));
  assert.strictEqual(creada.status, 200);

  const pdf = await supertest(app).get(`/api/cotizacion/pdf/${creada.body.id}`);
  assert.strictEqual(pdf.status, 200);
  const textoPdf = Buffer.from(pdf.body).toString('latin1');
  assert.ok(textoPdf.includes(toHex('137.50')), 'el PDF imprime el precio capturado');
  assert.ok(!textoPdf.includes(toHex('29.66')), 'el precio de lista ya no aparece');

  const html = await supertest(app).get(`/api/cotizacion/html/${creada.body.id}`);
  assert.strictEqual(html.status, 200);
  assert.ok(html.text.includes('137.50'), 'el HTML imprime el precio capturado');
  assert.ok(!html.text.includes('29.66'));
});

// El quote de Operam recibe el precio manual como unit price normal: el mapeo
// (armarContenidoQuote) ya lee `precio`, por eso el ticket no toca el cliente.
test('#279: el quote de Operam se sube con el precio del proveedor', async () => {
  const creada = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send(cotizacionCon(
      [PARTIDA_PRODUCTO, partidaCalca({ precio: PRECIO_PROVEEDOR, precioManual: PRECIO_PROVEEDOR })],
      { cliente: { razonSocial: 'CALCA SA DE CV', nombreCorto: 'Calca', telefono: '+52 55 1234 5678', rfc: 'CAL010101AAA' } },
    ));
  assert.strictEqual(creada.status, 200);

  let quoteBody = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': () => jsonResponse({ total: 1, data: [{ customer_id: '77', tax_id: 'CAL010101AAA', CustName: 'CALCA SA DE CV', branches: [{ branch_code: '1' }] }] }),
    '/api/v3/sales/quote': (u, opts) => { quoteBody = JSON.parse(opts.body); return jsonResponse({ result: true, quote_id: 55279 }); },
  });
  try {
    const res = await supertest(app).post(`/api/cotizacion/operam/${creada.body.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`).send({});
    assert.strictEqual(res.status, 200);
    const partida = quoteBody.items.find(i => i.stock_id === 'CAL1050');
    assert.strictEqual(partida.price, PRECIO_PROVEEDOR);
  } finally {
    restore();
  }
});
