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
const VENDEDORES_PATH = join(DATA_DIR, 'vendedores.json');

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

// #153: el checkbox de admin en el registro de vendedores extiende el permiso
// mas alla de rol admin. Se modifica el registro real y se restaura al final
// (mismo cuidado que test/vendedores-store-api.test.js).
test('vendedor con checkbox de fijar lista (#153): tier ajeno al tabulador se guarda', async () => {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    const registro = JSON.parse(original);
    registro.find(v => v.id === 2).puedeFijarLista = true;
    escribirArchivoSync(VENDEDORES_PATH, JSON.stringify(registro, null, 2));
    const res = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send(cotizacionCon('M1500'));
    assert.strictEqual(res.status, 200);
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
});

// #153: el flag viaja con la sesion igual que el tope (prior art:
// "la pantalla recibe su tope vigente en /api/precios", test/descuentos-api.test.js).
test('la pantalla recibe su permiso de fijar lista vigente en /api/precios', async () => {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    const registro = JSON.parse(original);
    registro.find(v => v.id === 2).puedeFijarLista = true;
    escribirArchivoSync(VENDEDORES_PATH, JSON.stringify(registro, null, 2));
    const conFlag = await supertest(app).get('/api/precios').set('Authorization', `Bearer ${tokenVendedor}`);
    assert.strictEqual(conFlag.body.puedeFijarLista, true);

    registro.find(v => v.id === 2).puedeFijarLista = false;
    escribirArchivoSync(VENDEDORES_PATH, JSON.stringify(registro, null, 2));
    const sinFlag = await supertest(app).get('/api/precios').set('Authorization', `Bearer ${tokenVendedor}`);
    assert.strictEqual(sinFlag.body.puedeFijarLista, false);

    const admin = await supertest(app).get('/api/precios').set('Authorization', `Bearer ${tokenAdmin}`);
    assert.strictEqual(admin.body.puedeFijarLista, true);
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
});

// #154: editar (mismo registro) conserva un tier ya fijado aunque quien edita
// no tenga permiso -- corregir cantidades/notas no debe tumbar una
// autorizacion que ya ocurrio. La excepcion compara contra el tier YA
// GUARDADO en ese registro, nunca contra el tabulador del volumen actual, y
// SOLO cuando quien edita es dueno del registro (o admin): sin ese chequeo,
// un cotizacionId AJENO con lista fijada seria una via para colarse el
// permiso -- el riesgo que el propio ticket #154 senala.
test('vendedor sin permiso, editando SU PROPIO registro: el tier identico al ya guardado se acepta', async () => {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    // El registro nace CON el checkbox (autorizacion real de #153) y despues
    // se le quita: queda una cotizacion con lista fijada de un vendedor que
    // ya no tiene permiso -- exactamente el caso que #154 describe.
    const registro = JSON.parse(original);
    registro.find(v => v.id === 2).puedeFijarLista = true;
    escribirArchivoSync(VENDEDORES_PATH, JSON.stringify(registro, null, 2));
    const creado = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send(cotizacionCon('M1500'));
    assert.strictEqual(creado.status, 200);
    const id = creado.body.id;

    registro.find(v => v.id === 2).puedeFijarLista = false;
    escribirArchivoSync(VENDEDORES_PATH, JSON.stringify(registro, null, 2));
    const editado = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send({ ...cotizacionCon('M1500'), cotizacionId: id });
    assert.strictEqual(editado.status, 200);
    assert.strictEqual(editado.body.id, id);
    assert.strictEqual(readCots().find(c => c.id === id).tier, 'M1500');
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
});

test('vendedor sin permiso, editando SU PROPIO registro: un tier DISTINTO al ya guardado se sigue rechazando', async () => {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    const registro = JSON.parse(original);
    registro.find(v => v.id === 2).puedeFijarLista = true;
    escribirArchivoSync(VENDEDORES_PATH, JSON.stringify(registro, null, 2));
    const creado = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send(cotizacionCon('M1500'));
    assert.strictEqual(creado.status, 200);
    const id = creado.body.id;

    registro.find(v => v.id === 2).puedeFijarLista = false;
    escribirArchivoSync(VENDEDORES_PATH, JSON.stringify(registro, null, 2));
    const tierAntes = readCots().find(c => c.id === id).tier;
    const res = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send({ ...cotizacionCon('M6000'), cotizacionId: id });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(readCots().find(c => c.id === id).tier, tierAntes);
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
});

// El hallazgo central del riesgo de seguridad del ticket: el tier identico NO
// basta si el registro es ajeno -- sin este chequeo, cualquier vendedor sin
// permiso podria tomar el cotizacionId de una cotizacion AJENA con lista
// fijada (de un admin, por ejemplo) y colarse la excepcion.
test('vendedor sin permiso, editando un registro AJENO con el MISMO tier ya guardado: se rechaza (el dueno importa, no solo el tier)', async () => {
  const creado = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send(cotizacionCon('M1500'));
  assert.strictEqual(creado.status, 200);
  const id = creado.body.id;
  const tierAntes = readCots().find(c => c.id === id).tier;

  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenVendedor}`)
    .send({ ...cotizacionCon('M1500'), cotizacionId: id });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(readCots().find(c => c.id === id).tier, tierAntes);
});

test('vendedor sin permiso, Copiar (sin cotizacionId): el mismo tier de una cotizacion ajena se rechaza igual que antes', async () => {
  const creado = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send(cotizacionCon('M1500'));
  assert.strictEqual(creado.status, 200);

  const antes = readCots().length;
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenVendedor}`)
    .send(cotizacionCon('M1500'));
  assert.strictEqual(res.status, 403);
  assert.strictEqual(readCots().length, antes);
});

// #153: un valor basura capturado en /admin nunca se guarda como permiso.
test('PUT /api/admin/vendedores: un valor basura en puedeFijarLista se normaliza a false', async () => {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    const registro = JSON.parse(original);
    const conBasura = registro.map(v => (v.id === 2 ? { ...v, puedeFijarLista: 'si' } : v));
    const res = await supertest(app).put('/api/admin/vendedores')
      .set('Authorization', `Bearer ${tokenAdmin}`).send(conBasura);
    assert.strictEqual(res.status, 200);
    const guardado = JSON.parse(leerArchivoSync(VENDEDORES_PATH)).find(v => v.id === 2);
    assert.strictEqual(guardado.puedeFijarLista, false);
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
});
