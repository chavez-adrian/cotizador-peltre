// #137: el tope de descuento lo hace valer el SERVIDOR, no la pantalla.
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
const VENDEDORES_PATH = join(DATA_DIR, 'vendedores.json');
const COTS_PATH = join(DATA_DIR, 'cotizaciones.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');

const ID_VENDEDOR = 2;
const tokenVendedor = jwt.sign({ id: ID_VENDEDOR, name: 'Vendedor Test', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });
const tokenAdmin = jwt.sign({ id: 1, name: 'Admin Test', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

function readJson(path) {
  return JSON.parse(leerArchivoSync(path));
}

function writeJson(path, data) {
  escribirArchivoSync(path, JSON.stringify(data, null, 2));
}

// Deja al vendedor de prueba con el tope indicado (null = sin campo, el estado
// de un vendedor al que el admin nunca le asigno nada).
function setTope(tope) {
  const vendedores = readJson(VENDEDORES_PATH).map(v => {
    if (v.id !== ID_VENDEDOR) return v;
    const copia = { ...v };
    if (tope === null) delete copia.topeDescuento;
    else copia.topeDescuento = tope;
    return copia;
  });
  writeJson(VENDEDORES_PATH, vendedores);
}

function cotizacionCon(items) {
  return {
    fecha: '2026-01-01', vigencia: '2026-02-01', tier: 'Mayoreo',
    cliente: { razonSocial: 'Descuento SA', nombreCorto: 'Desc', telefono: '+52 55 1234 5678' },
    items,
    subtotal: 100, iva: 16, total: 116, notas: [],
  };
}

const ITEM_BASE = { codigo: 'AB12', descripcion: 'Olla', cantidad: 1, unidad: 'pza', precio: 100 };

function readCots() {
  if (!existsSync(COTS_PATH)) return [];
  return readJson(COTS_PATH);
}

// El registro de vendedores esta versionado: se restaura el TEXTO original, no
// una re-serializacion, para no dejar el archivo del repo reformateado.
let vendedoresOriginal, cotsOriginal;
before(() => {
  vendedoresOriginal = leerArchivoSync(VENDEDORES_PATH);
  cotsOriginal = readCots();
});
after(() => {
  escribirArchivoSync(VENDEDORES_PATH, vendedoresOriginal);
  writeJson(COTS_PATH, cotsOriginal);
});

test('AC3: vendedor SIN tope que manda descuento -> rechazo y nada guardado', async () => {
  setTope(null);
  const antes = readCots().length;
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenVendedor}`)
    .send(cotizacionCon([{ ...ITEM_BASE, descuento: 5 }]));
  assert.strictEqual(res.status, 403);
  assert.match(res.body.error, /permiso/i);
  assert.strictEqual(readCots().length, antes);
});

test('AC3: vendedor con tope que lo rebasa -> rechazo que nombra la partida y el tope', async () => {
  setTope(15);
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenVendedor}`)
    .send(cotizacionCon([{ ...ITEM_BASE, descuento: 20 }]));
  assert.strictEqual(res.status, 403);
  assert.match(res.body.error, /AB12/);
  assert.match(res.body.error, /15%/);
});

test('AC3: el tope tambien aplica a la partida de envio', async () => {
  setTope(15);
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenVendedor}`)
    .send(cotizacionCon([
      { ...ITEM_BASE, descuento: 10 },
      { codigo: 'ENVIO', descripcion: 'FedEx', cantidad: 1, unidad: 'ACT', precio: 500, descuento: 40 },
    ]));
  assert.strictEqual(res.status, 403);
  assert.match(res.body.error, /ENVIO/);
});

test('AC3: dentro del tope se guarda con el descuento por linea', async () => {
  setTope(15);
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenVendedor}`)
    .send(cotizacionCon([
      { ...ITEM_BASE, descuento: 15 },
      { codigo: 'ENVIO', descripcion: 'FedEx', cantidad: 1, unidad: 'ACT', precio: 500, descuento: 12 },
    ]));
  assert.strictEqual(res.status, 200);
  const guardada = readCots().find(c => c.id === res.body.id);
  assert.strictEqual(guardada.data.items[0].descuento, 15);
  assert.strictEqual(guardada.data.items[1].descuento, 12);
});

test('AC1: el admin no tiene tope', async () => {
  setTope(null);
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send(cotizacionCon([{ ...ITEM_BASE, descuento: 40 }]));
  assert.strictEqual(res.status, 200);
});

test('la pantalla recibe su tope vigente en /api/precios', async () => {
  setTope(15);
  const res = await supertest(app).get('/api/precios').set('Authorization', `Bearer ${tokenVendedor}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.topeDescuento, 15);

  setTope(null);
  const sinTope = await supertest(app).get('/api/precios').set('Authorization', `Bearer ${tokenVendedor}`);
  assert.strictEqual(sinTope.body.topeDescuento, 0);

  const admin = await supertest(app).get('/api/precios').set('Authorization', `Bearer ${tokenAdmin}`);
  assert.strictEqual(admin.body.topeDescuento, 100);
});

test('AC1: el admin asigna el tope y queda en el registro de vendedores', async () => {
  setTope(null);
  const vendedores = readJson(VENDEDORES_PATH).map(v => (v.id === ID_VENDEDOR ? { ...v, topeDescuento: '20' } : v));
  const res = await supertest(app).put('/api/admin/vendedores')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send(vendedores);
  assert.strictEqual(res.status, 200);
  const guardado = readJson(VENDEDORES_PATH).find(v => v.id === ID_VENDEDOR);
  assert.strictEqual(guardado.topeDescuento, 20);
});

test('AC1: un tope invalido no se guarda como permiso ilimitado', async () => {
  const vendedores = readJson(VENDEDORES_PATH).map(v => (v.id === ID_VENDEDOR ? { ...v, topeDescuento: 150 } : v));
  await supertest(app).put('/api/admin/vendedores')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send(vendedores);
  assert.strictEqual(readJson(VENDEDORES_PATH).find(v => v.id === ID_VENDEDOR).topeDescuento, 100);

  const basura = readJson(VENDEDORES_PATH).map(v => (v.id === ID_VENDEDOR ? { ...v, topeDescuento: 'mucho' } : v));
  await supertest(app).put('/api/admin/vendedores')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send(basura);
  assert.strictEqual(readJson(VENDEDORES_PATH).find(v => v.id === ID_VENDEDOR).topeDescuento, 0);
});

test('AC1: solo el admin ve y edita los topes', async () => {
  const res = await supertest(app).get('/api/admin/vendedores').set('Authorization', `Bearer ${tokenVendedor}`);
  assert.strictEqual(res.status, 403);
  const put = await supertest(app).put('/api/admin/vendedores')
    .set('Authorization', `Bearer ${tokenVendedor}`).send([]);
  assert.strictEqual(put.status, 403);
});

// El envio estructurado (data.envio) es un segundo domicilio del descuento del
// flete: se persiste aparte y se restaura al Cargar. Sin regla propia, un body
// con envio.descuento por encima del tope entraria al registro y volveria a la
// pantalla al Cargar la cotizacion.
test('AC3: el descuento del envio estructurado tambien pasa por el tope', async () => {
  setTope(15);
  const body = cotizacionCon([{ ...ITEM_BASE, descuento: 10 }]);
  body.envio = { opcion: 'manual', carrier: null, servicio: null, precio: 500, descripcion: 'FedEx', descuento: 60 };
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenVendedor}`)
    .send(body);
  assert.strictEqual(res.status, 403);
  assert.match(res.body.error, /ENVIO/);
});

// === #139: la descripcion de partida tampoco depende de la pantalla ===
// 1000 es el limite del textarea de Operam: un texto mas largo lo truncaria el ERP
// en silencio y el quote diria algo distinto del documento que ya vio el cliente.
test('#139: una descripcion mas larga que el limite de Operam -> rechazo y nada guardado', async () => {
  setTope(null);
  const antes = readCots().length;
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenVendedor}`)
    .send(cotizacionCon([{ ...ITEM_BASE, descripcion: 'a'.repeat(1001), descripcionEditada: true }]));
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /AB12/);
  assert.match(res.body.error, /1000/);
  assert.strictEqual(readCots().length, antes);
});

test('#139: la descripcion editada se guarda con su marca para poder regenerar', async () => {
  setTope(null);
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenVendedor}`)
    .send(cotizacionCon([{ ...ITEM_BASE, descripcion: 'Olla 20 cm esmaltada a mano', descripcionEditada: true }]));
  assert.strictEqual(res.status, 200);
  const guardada = readCots().find(c => c.id === res.body.id);
  assert.strictEqual(guardada.data.items[0].descripcion, 'Olla 20 cm esmaltada a mano');
  assert.strictEqual(guardada.data.items[0].descripcionEditada, true);
});
