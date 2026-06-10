import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROSPECTOS_PATH = join(__dirname, '..', 'data', 'prospectos.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');
const ADMIN_TOKEN = jwt.sign({ id: 99, name: 'Tester', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
const MEMO_TOKEN = jwt.sign({ id: 7, name: 'Memo', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });
const ANA_TOKEN = jwt.sign({ id: 8, name: 'Ana', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });

function readProspectos() {
  if (!existsSync(PROSPECTOS_PATH)) return [];
  return JSON.parse(readFileSync(PROSPECTOS_PATH, 'utf8'));
}
function writeProspectos(data) {
  writeFileSync(PROSPECTOS_PATH, JSON.stringify(data, null, 2));
}

let savedProspectos;
let existia;
before(() => {
  existia = existsSync(PROSPECTOS_PATH);
  savedProspectos = readProspectos();
});
after(() => {
  if (existia) writeProspectos(savedProspectos);
  else if (existsSync(PROSPECTOS_PATH)) unlinkSync(PROSPECTOS_PATH);
});

const CAPTURA = {
  celular: '+52 5512345678', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp',
  empresa: 'Hotel Azul', temperatura: 4,
};

test('vendedor autenticado captura un prospecto y lo ve en su lista en etapa nuevo', async () => {
  writeProspectos([]);
  const res = await supertest(app).post('/api/prospectos')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send(CAPTURA);
  assert.equal(res.status, 201);
  assert.ok(res.body.id);

  const lista = await supertest(app).get('/api/prospectos')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(lista.status, 200);
  assert.equal(lista.body.length, 1);
  const p = lista.body[0];
  assert.equal(p.nombre, 'Laura');
  assert.equal(p.ciudad, 'Puebla');
  assert.equal(p.canal, 'WhatsApp');
  assert.equal(p.etapa, 'nuevo');
  assert.equal(p.vendedor, 'Memo');
  assert.equal(p.celular, '+52 5512345678');
  assert.equal(p.data.empresa, 'Hotel Azul');
});

test('POST /api/prospectos rechaza celular sin codigo de pais con 400', async () => {
  writeProspectos([]);
  const res = await supertest(app).post('/api/prospectos')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`)
    .send({ ...CAPTURA, celular: '5512345678' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /codigo de pais/i);
  assert.equal(readProspectos().length, 0);
});

test('POST /api/prospectos rechaza obligatorios faltantes y canal fuera de catalogo con 400', async () => {
  writeProspectos([]);
  const sinNombre = await supertest(app).post('/api/prospectos')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ ...CAPTURA, nombre: '' });
  assert.equal(sinNombre.status, 400);
  const sinCiudad = await supertest(app).post('/api/prospectos')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ ...CAPTURA, ciudad: '' });
  assert.equal(sinCiudad.status, 400);
  const canalInvalido = await supertest(app).post('/api/prospectos')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ ...CAPTURA, canal: 'TikTok' });
  assert.equal(canalInvalido.status, 400);
  assert.equal(readProspectos().length, 0);
});

test('capturar un celular que ya es prospecto propio responde 409 mostrando el existente', async () => {
  writeProspectos([]);
  await supertest(app).post('/api/prospectos')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send(CAPTURA);
  // mismo celular en otro formato (identidad por ultimos 10 digitos)
  const res = await supertest(app).post('/api/prospectos')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`)
    .send({ ...CAPTURA, celular: '+52 55 1234 5678', nombre: 'Otra Laura' });
  assert.equal(res.status, 409);
  assert.ok(res.body.error);
  assert.equal(res.body.prospecto.nombre, 'Laura');
  assert.equal(readProspectos().length, 1);
});

test('capturar un celular que ya es prospecto de otro vendedor responde 409 sin exponer datos', async () => {
  writeProspectos([]);
  await supertest(app).post('/api/prospectos')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send(CAPTURA);
  const res = await supertest(app).post('/api/prospectos')
    .set('Authorization', `Bearer ${ANA_TOKEN}`).send(CAPTURA);
  assert.equal(res.status, 409);
  assert.ok(res.body.error);
  assert.equal('prospecto' in res.body, false);
  assert.equal(readProspectos().length, 1);
});

test('GET /api/prospectos muestra solo los del vendedor; admin ve todos', async () => {
  writeProspectos([
    { id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', celular: '+52 5511111111', celular10: '5511111111', nombre: 'A', ciudad: 'CDMX', canal: 'WhatsApp', etapa: 'nuevo', data: {} },
    { id: 2, fecha: '2026-06-02T00:00:00Z', vendedor: 'Ana', celular: '+52 5522222222', celular10: '5522222222', nombre: 'B', ciudad: 'Puebla', canal: 'Referido', etapa: 'nuevo', data: {} },
  ]);
  const memo = await supertest(app).get('/api/prospectos').set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(memo.body.length, 1);
  assert.equal(memo.body[0].nombre, 'A');
  const admin = await supertest(app).get('/api/prospectos').set('Authorization', `Bearer ${ADMIN_TOKEN}`);
  assert.equal(admin.body.length, 2);
});

test('rutas de prospectos sin token responden 401', async () => {
  writeProspectos([]);
  const lista = await supertest(app).get('/api/prospectos');
  assert.equal(lista.status, 401);
  const alta = await supertest(app).post('/api/prospectos').send(CAPTURA);
  assert.equal(alta.status, 401);
  assert.equal(readProspectos().length, 0);
});
