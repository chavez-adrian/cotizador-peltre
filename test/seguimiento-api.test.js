import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
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
const ADMIN_TOKEN = jwt.sign({ id: 99, name: 'Tester', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
const MEMO_TOKEN = jwt.sign({ id: 7, name: 'Memo', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });

function readCots() {
  if (!existsSync(COTS_PATH)) return [];
  return JSON.parse(readFileSync(COTS_PATH, 'utf8'));
}
function writeCots(data) {
  writeFileSync(COTS_PATH, JSON.stringify(data, null, 2));
}

const hace = (dias) => new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

function fixture() {
  return [
    {
      id: 1, fecha: hace(3), vendedor: 'Memo', cliente: 'RESTAURANTE LA LUPITA',
      totalPiezas: 200, total: 15000, tier: 'M100',
      data: { cliente: { razonSocial: 'RESTAURANTE LA LUPITA', rfc: 'RLU200101AAA', telefono: '5512345678' }, items: [] },
    },
    {
      id: 2, fecha: hace(8), vendedor: 'Ana', cliente: 'HOTEL AZUL',
      totalPiezas: 550, total: 40000, tier: 'M550',
      data: { cliente: { razonSocial: 'HOTEL AZUL', rfc: 'HAZ190101BBB', telefono: '5587654321' }, items: [] },
    },
  ];
}

let savedCots;
before(() => { savedCots = readCots(); });
after(() => { writeCots(savedCots); });

test('GET /api/seguimiento devuelve solo la cola del vendedor autenticado', async () => {
  writeCots(fixture());
  const res = await supertest(app).get('/api/seguimiento').set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].id, 1);
  assert.equal(res.body[0].paso, 'dia2');
});

test('GET /api/seguimiento como admin devuelve toda la cola', async () => {
  writeCots(fixture());
  const res = await supertest(app).get('/api/seguimiento').set('Authorization', `Bearer ${ADMIN_TOKEN}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2);
});

test('GET /api/seguimiento sin token responde 401', async () => {
  const res = await supertest(app).get('/api/seguimiento');
  assert.equal(res.status, 401);
});

test('POST /api/seguimiento/:id registra el paso y el item sale de la cola', async () => {
  writeCots(fixture());
  const res = await supertest(app).post('/api/seguimiento/1')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ paso: 'dia2' });
  assert.equal(res.status, 200);
  const guardado = readCots().find(c => c.id === 1);
  assert.equal(guardado.seguimientos.length, 1);
  assert.equal(guardado.seguimientos[0].paso, 'dia2');
  assert.equal(guardado.seguimientos[0].vendedor, 'Memo');
  assert.ok(guardado.seguimientos[0].fecha);
  const cola = await supertest(app).get('/api/seguimiento').set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(cola.body.length, 0);
});

test('POST /api/seguimiento/:id sobre cotizacion ajena responde 403', async () => {
  writeCots(fixture());
  const res = await supertest(app).post('/api/seguimiento/2')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ paso: 'dia7' });
  assert.equal(res.status, 403);
});

test('POST /api/seguimiento/:id con paso invalido responde 400', async () => {
  writeCots(fixture());
  const res = await supertest(app).post('/api/seguimiento/1')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ paso: 'manana' });
  assert.equal(res.status, 400);
});

test('POST /api/seguimiento/:id inexistente responde 404', async () => {
  writeCots(fixture());
  const res = await supertest(app).post('/api/seguimiento/999')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ paso: 'dia2' });
  assert.equal(res.status, 404);
});

test('PATCH /api/cotizacion/:id/estado marca ganada y sale de la cola', async () => {
  writeCots(fixture());
  const res = await supertest(app).patch('/api/cotizacion/1/estado')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ estado: 'ganada' });
  assert.equal(res.status, 200);
  const guardado = readCots().find(c => c.id === 1);
  assert.equal(guardado.estado, 'ganada');
  const cola = await supertest(app).get('/api/seguimiento').set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(cola.body.length, 0);
});

test('PATCH estado abierta reabre una cotizacion cerrada', async () => {
  const cots = fixture();
  cots[0].estado = 'perdida';
  writeCots(cots);
  const res = await supertest(app).patch('/api/cotizacion/1/estado')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ estado: 'abierta' });
  assert.equal(res.status, 200);
  assert.equal(readCots().find(c => c.id === 1).estado, 'abierta');
});

test('GET /api/cotizaciones expone estado y telefono wa para el tablero (#50)', async () => {
  const cots = fixture();
  cots[1].estado = 'ganada';
  delete cots[1].data.cliente.telefono;
  writeCots(cots);
  const res = await supertest(app).get('/api/cotizaciones').set('Authorization', `Bearer ${ADMIN_TOKEN}`);
  assert.equal(res.status, 200);
  const [c1, c2] = res.body;
  assert.equal(c1.estado, 'abierta');
  assert.equal(c1.telefono, '525512345678');
  assert.equal(c2.estado, 'ganada');
  assert.equal(c2.telefono, null);
});

test('PATCH estado invalido responde 400 y ajeno 403', async () => {
  writeCots(fixture());
  const inv = await supertest(app).patch('/api/cotizacion/1/estado')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ estado: 'cancelada' });
  assert.equal(inv.status, 400);
  const ajeno = await supertest(app).patch('/api/cotizacion/2/estado')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ estado: 'ganada' });
  assert.equal(ajeno.status, 403);
});

// === Issue #65: reunion de diagnostico sobre una COTIZACION en Seguimiento ===
const hoyMas = (dias) => new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString();

test('CR1: POST /api/cotizacion/:id/reunion agenda la reunion y la cotizacion sale de la cola', async () => {
  writeCots(fixture());
  const futura = hoyMas(2);
  const res = await supertest(app).post('/api/cotizacion/1/reunion')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ fecha: futura });
  assert.equal(res.status, 200);
  const guardado = readCots().find(c => c.id === 1);
  const reunion = guardado.seguimientos.find(s => s.tipo === 'reunion');
  assert.ok(reunion);
  assert.equal(reunion.vendedor, 'Memo');
  assert.ok(reunion.fecha_reunion);
  // reunion futura suprime la cadencia -> sale de la cola
  const cola = await supertest(app).get('/api/seguimiento').set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(cola.body.find(i => i.id === 1), undefined);
});

test('CR2: POST /api/cotizacion/:id/reunion sin fecha futura responde 400', async () => {
  writeCots(fixture());
  const sinFecha = await supertest(app).post('/api/cotizacion/1/reunion')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({});
  assert.equal(sinFecha.status, 400);
  const pasada = await supertest(app).post('/api/cotizacion/1/reunion')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ fecha: hace(1) });
  assert.equal(pasada.status, 400);
});

test('CR3: POST /api/cotizacion/:id/reunion sobre cotizacion ajena responde 403, inexistente 404', async () => {
  writeCots(fixture());
  const ajena = await supertest(app).post('/api/cotizacion/2/reunion')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ fecha: hoyMas(2) });
  assert.equal(ajena.status, 403);
  const noExiste = await supertest(app).post('/api/cotizacion/999/reunion')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ fecha: hoyMas(2) });
  assert.equal(noExiste.status, 404);
});

test('CR4: reunion-resultado avance registra el avance y la reunion deja de estar pendiente', async () => {
  const cots = fixture();
  // reunion ya vencida (ayer) sin evento posterior -> pendiente de resultado
  cots[0].seguimientos = [{ tipo: 'reunion', fecha_reunion: hace(1), fecha: hace(2), vendedor: 'Memo' }];
  writeCots(cots);
  const res = await supertest(app).post('/api/cotizacion/1/reunion-resultado')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ resultado: 'avance' });
  assert.equal(res.status, 200);
  const guardado = readCots().find(c => c.id === 1);
  // el avance se registra como un evento posterior a la reunion (limpia el pendiente)
  assert.ok(guardado.seguimientos.length >= 2);
  const ultimo = guardado.seguimientos[guardado.seguimientos.length - 1];
  assert.ok(new Date(ultimo.fecha) > new Date(hace(1)));
});

test('CR5: reunion-resultado perdida cierra la cotizacion como Perdida (Modelo A)', async () => {
  const cots = fixture();
  cots[0].seguimientos = [{ tipo: 'reunion', fecha_reunion: hace(1), fecha: hace(2), vendedor: 'Memo' }];
  writeCots(cots);
  const res = await supertest(app).post('/api/cotizacion/1/reunion-resultado')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ resultado: 'perdida' });
  assert.equal(res.status, 200);
  assert.equal(readCots().find(c => c.id === 1).estado, 'perdida');
});

test('CR6: reunion-resultado no_util es invalido para una cotizacion (Modelo A: solo Perdida)', async () => {
  const cots = fixture();
  cots[0].seguimientos = [{ tipo: 'reunion', fecha_reunion: hace(1), fecha: hace(2), vendedor: 'Memo' }];
  writeCots(cots);
  const res = await supertest(app).post('/api/cotizacion/1/reunion-resultado')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ resultado: 'no_util', motivo: 'spam' });
  assert.equal(res.status, 400);
  // no se toco el estado
  assert.equal(readCots().find(c => c.id === 1).estado, undefined);
});

test('CR7: reunion-resultado sin reunion pendiente responde 400', async () => {
  writeCots(fixture()); // sin reuniones
  const res = await supertest(app).post('/api/cotizacion/1/reunion-resultado')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ resultado: 'avance' });
  assert.equal(res.status, 400);
});

test('CR8: reunion-resultado sobre cotizacion ajena responde 403', async () => {
  const cots = fixture();
  cots[1].seguimientos = [{ tipo: 'reunion', fecha_reunion: hace(1), fecha: hace(2), vendedor: 'Ana' }];
  writeCots(cots);
  const res = await supertest(app).post('/api/cotizacion/2/reunion-resultado')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ resultado: 'avance' });
  assert.equal(res.status, 403);
});
