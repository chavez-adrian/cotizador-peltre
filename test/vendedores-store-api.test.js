// #141: el registro de vendedores vive en el store (Neon con fallback al JSON).
// Sin DATABASE_URL el comportamiento por HTTP tiene que ser el de siempre: login,
// catalogos y el GET/PUT de administracion, con el array completo como contrato.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VENDEDORES_PATH = join(__dirname, '..', 'data', 'vendedores.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}
// Esta suite ESCRIBE via el store (el PUT hace DELETE en Neon si hay pool). El
// borrado es efectivo porque el pool de lib/db.js nace durante el import
// dinamico de abajo, que corre despues de esta linea.
delete process.env.DATABASE_URL;

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');

const tokenAdmin = jwt.sign({ id: 1, name: 'Jefa Test', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

// Registro controlado: los PIN reales no deben decidir si esta suite pasa.
const REGISTRO = [
  { id: 1, name: 'Jefa Test', pin: '9001', role: 'admin', operam_id: 1 },
  { id: 2, name: 'Vendedor Test', pin: '9002', role: 'vendedor', operam_id: 2, topeDescuento: 15 },
  { id: 3, name: 'Sin Operam Test', pin: '9003', role: 'vendedor', operam_id: null },
];

function escribirRegistro(registro) {
  escribirArchivoSync(VENDEDORES_PATH, JSON.stringify(registro, null, 2));
}

// El registro esta versionado: se restaura el TEXTO original, no una
// re-serializacion, para no dejar el archivo del repo reformateado.
let original;
before(() => {
  original = leerArchivoSync(VENDEDORES_PATH);
  escribirRegistro(REGISTRO);
});
after(() => {
  escribirArchivoSync(VENDEDORES_PATH, original);
});

test('login: el PIN del registro autentica y el equivocado no', async () => {
  escribirRegistro(REGISTRO);
  const ok = await supertest(app).post('/api/login').send({ vendedorId: 2, pin: '9002' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body.user.name, 'Vendedor Test');
  assert.strictEqual(ok.body.user.role, 'vendedor');

  const mal = await supertest(app).post('/api/login').send({ vendedorId: 2, pin: '0001' });
  assert.strictEqual(mal.status, 401);
});

test('GET /api/vendedores lista el registro sin exponer el PIN', async () => {
  escribirRegistro(REGISTRO);
  const res = await supertest(app).get('/api/vendedores');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body.map(v => v.id), [1, 2, 3]);
  assert.ok(res.body.every(v => v.pin === undefined));
});

test('GET /api/admin/vendedores devuelve el registro completo', async () => {
  escribirRegistro(REGISTRO);
  const res = await supertest(app).get('/api/admin/vendedores').set('Authorization', `Bearer ${tokenAdmin}`);
  assert.strictEqual(res.status, 200);
  const v = res.body.find(x => x.id === 2);
  assert.strictEqual(v.pin, '9002');
  assert.strictEqual(v.topeDescuento, 15);
  assert.strictEqual(v.operam_id, 2);
});

// #153: checkbox por vendedor, mismo contrato de reemplazo total que el tope.
test('PUT /api/admin/vendedores persiste el checkbox de fijar lista; vendedores sin flag quedan sin permiso', async () => {
  escribirRegistro(REGISTRO);
  const nuevo = REGISTRO.map(v => (v.id === 2 ? { ...v, puedeFijarLista: true } : v));
  const put = await supertest(app).put('/api/admin/vendedores')
    .set('Authorization', `Bearer ${tokenAdmin}`).send(nuevo);
  assert.strictEqual(put.status, 200);

  const res = await supertest(app).get('/api/admin/vendedores').set('Authorization', `Bearer ${tokenAdmin}`);
  assert.strictEqual(res.body.find(v => v.id === 2).puedeFijarLista, true);
  assert.ok(!res.body.find(v => v.id === 3).puedeFijarLista);
});

// #156: segundo checkbox por vendedor (permiso de asignacion), independiente del
// de fijar lista y con el mismo contrato de reemplazo total.
test('PUT /api/admin/vendedores persiste el checkbox de asignacion, independiente del de fijar lista', async () => {
  escribirRegistro(REGISTRO);
  const nuevo = REGISTRO.map(v => (v.id === 2 ? { ...v, puedeAsignar: true } : v));
  const put = await supertest(app).put('/api/admin/vendedores')
    .set('Authorization', `Bearer ${tokenAdmin}`).send(nuevo);
  assert.strictEqual(put.status, 200);

  const res = await supertest(app).get('/api/admin/vendedores').set('Authorization', `Bearer ${tokenAdmin}`);
  const v2 = res.body.find(v => v.id === 2);
  assert.strictEqual(v2.puedeAsignar, true);
  assert.ok(!v2.puedeFijarLista, 'el permiso de asignacion no arrastra el de fijar lista');
  assert.ok(!res.body.find(v => v.id === 3).puedeAsignar);
});

test('PUT /api/admin/vendedores: un valor basura en puedeAsignar se normaliza a sin permiso', async () => {
  escribirRegistro(REGISTRO);
  const nuevo = REGISTRO.map(v => (v.id === 2 ? { ...v, puedeAsignar: 'si' } : v));
  const put = await supertest(app).put('/api/admin/vendedores')
    .set('Authorization', `Bearer ${tokenAdmin}`).send(nuevo);
  assert.strictEqual(put.status, 200);

  const res = await supertest(app).get('/api/admin/vendedores').set('Authorization', `Bearer ${tokenAdmin}`);
  assert.ok(!res.body.find(v => v.id === 2).puedeAsignar);
});

// #163: la alerta de mayoreo deriva destinatarios del correo del vendedor -- el
// registro no lo tenia antes de este issue.
test('PUT /api/admin/vendedores persiste el correo del vendedor', async () => {
  escribirRegistro(REGISTRO);
  const nuevo = REGISTRO.map(v => (v.id === 2 ? { ...v, email: 'vendedor@pppeltre.mx' } : v));
  const put = await supertest(app).put('/api/admin/vendedores')
    .set('Authorization', `Bearer ${tokenAdmin}`).send(nuevo);
  assert.strictEqual(put.status, 200);

  const res = await supertest(app).get('/api/admin/vendedores').set('Authorization', `Bearer ${tokenAdmin}`);
  assert.strictEqual(res.body.find(v => v.id === 2).email, 'vendedor@pppeltre.mx');
  assert.ok(!res.body.find(v => v.id === 3).email);
});

test('PUT /api/admin/vendedores: el array completo reemplaza el registro (alta y baja)', async () => {
  escribirRegistro(REGISTRO);
  const nuevo = [
    { id: 1, name: 'Jefa Test', pin: '9001', role: 'admin', operam_id: 1 },
    { id: 4, name: 'Recien Llegado', pin: '9004', role: 'vendedor', operam_id: 9 },
  ];
  const put = await supertest(app).put('/api/admin/vendedores')
    .set('Authorization', `Bearer ${tokenAdmin}`).send(nuevo);
  assert.strictEqual(put.status, 200);

  const res = await supertest(app).get('/api/admin/vendedores').set('Authorization', `Bearer ${tokenAdmin}`);
  assert.deepStrictEqual(res.body.map(v => v.id), [1, 4]);

  const alta = await supertest(app).post('/api/login').send({ vendedorId: 4, pin: '9004' });
  assert.strictEqual(alta.status, 200);
  const baja = await supertest(app).post('/api/login').send({ vendedorId: 2, pin: '9002' });
  assert.strictEqual(baja.status, 401);
});

test('GET /api/catalogos toma los vendedores del registro y omite los que no estan en Operam', async () => {
  escribirRegistro(REGISTRO);
  const res = await supertest(app).get('/api/catalogos').set('Authorization', `Bearer ${tokenAdmin}`);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body.vendedores, [
    { id: 1, name: 'Jefa Test', operam_id: 1 },
    { id: 2, name: 'Vendedor Test', operam_id: 2 },
  ]);
});
