// #151 (spec #98): la lista fijada la hace valer el SERVIDOR, no la pantalla.
// Prior art: test/descuentos-api.test.js (#137), mismo patron de permiso.
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

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');

const tokenVendedor = jwt.sign({ id: 2, name: 'Vendedor Test', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });
const tokenAdmin = jwt.sign({ id: 1, name: 'Admin Test', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

function readJson(path) {
  return JSON.parse(leerArchivoSync(path));
}
function writeJson(path, data) {
  escribirArchivoSync(path, JSON.stringify(data, null, 2));
}
function readCots() {
  if (!existsSync(COTS_PATH)) return [];
  return readJson(COTS_PATH);
}

// 10 piezas de producto: el tabulador vigente en data/precios.json las resuelve
// a Menudeo (min_qty 1 es el unico umbral que cabe).
const ITEM_BASE = { codigo: 'AB12', descripcion: 'Olla', cantidad: 10, unidad: 'pza', precio: 100 };

function cotizacionCon(tier) {
  return {
    fecha: '2026-01-01', vigencia: '2026-02-01', tier,
    cliente: { razonSocial: 'Tier SA', nombreCorto: 'Tier', telefono: '+52 55 1234 5678' },
    items: [ITEM_BASE],
    subtotal: 1000, iva: 160, total: 1160, notas: [],
  };
}

let cotsOriginal;
before(() => { cotsOriginal = readCots(); });
after(() => { writeJson(COTS_PATH, cotsOriginal); });

test('vendedor: tier que coincide con el tabulador se guarda sin permiso especial', async () => {
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenVendedor}`)
    .send(cotizacionCon('Menudeo'));
  assert.strictEqual(res.status, 200);
});

test('vendedor: tier ajeno al tabulador -> rechazo y nada guardado', async () => {
  const antes = readCots().length;
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenVendedor}`)
    .send(cotizacionCon('M1500'));
  assert.strictEqual(res.status, 403);
  assert.match(res.body.error, /permiso/i);
  assert.strictEqual(readCots().length, antes);
});

test('admin: cualquier tier fijado se guarda, incluso ajeno al tabulador', async () => {
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send(cotizacionCon('M1500'));
  assert.strictEqual(res.status, 200);
  const guardada = readCots().find(c => c.id === res.body.id);
  assert.strictEqual(guardada.tier, 'M1500');
});

test('admin: fijar Menudeo tambien pasa (#98: incluye Menudeo)', async () => {
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send(cotizacionCon('Menudeo'));
  assert.strictEqual(res.status, 200);
});

test('vendedor: tier vacio (ausente) no cuenta como override', async () => {
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenVendedor}`)
    .send(cotizacionCon(''));
  assert.strictEqual(res.status, 200);
});
