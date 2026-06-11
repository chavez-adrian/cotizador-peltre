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
  const etapa = await supertest(app).patch('/api/prospectos/1/etapa').send({ etapa: 'contactado' });
  assert.equal(etapa.status, 401);
  const toque = await supertest(app).post('/api/prospectos/1/toques');
  assert.equal(toque.status, 401);
  assert.equal(readProspectos().length, 0);
});

// === Issue #43: etapas, toques, No util e historial ===

function prospectoDe(vendedor, etapa = 'nuevo', extra = {}) {
  return {
    id: 1, fecha: '2026-06-01T00:00:00Z', vendedor, celular: '+52 5512345678',
    celular10: '5512345678', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp',
    etapa, eventos: [], data: {}, ...extra,
  };
}

test('el vendedor avanza su prospecto nuevo -> contactado -> calificado y queda en el historial', async () => {
  writeProspectos([prospectoDe('Memo')]);
  const r1 = await supertest(app).patch('/api/prospectos/1/etapa')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ etapa: 'contactado' });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.etapa, 'contactado');
  const r2 = await supertest(app).patch('/api/prospectos/1/etapa')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ etapa: 'calificado' });
  assert.equal(r2.status, 200);
  const guardado = readProspectos()[0];
  assert.equal(guardado.etapa, 'calificado');
  assert.equal(guardado.eventos.length, 2);
  assert.equal(guardado.eventos[0].tipo, 'etapa');
  assert.equal(guardado.eventos[0].de, 'nuevo');
  assert.equal(guardado.eventos[0].a, 'contactado');
  assert.equal(guardado.eventos[0].vendedor, 'Memo');
  assert.ok(guardado.eventos[0].fecha);
  assert.equal(guardado.eventos[1].a, 'calificado');
});

test('transiciones invalidas de etapa se rechazan server-side con 400', async () => {
  writeProspectos([prospectoDe('Memo')]);
  for (const etapa of ['calificado', 'nuevo', 'cotizado', 'inventada', undefined]) {
    const res = await supertest(app).patch('/api/prospectos/1/etapa')
      .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ etapa });
    assert.equal(res.status, 400, `etapa ${etapa} debio rechazarse`);
  }
  const guardado = readProspectos()[0];
  assert.equal(guardado.etapa, 'nuevo');
  assert.equal(guardado.eventos.length, 0);
});

test('un vendedor no puede operar el prospecto de otro; admin si puede', async () => {
  writeProspectos([prospectoDe('Memo')]);
  const ana = await supertest(app).patch('/api/prospectos/1/etapa')
    .set('Authorization', `Bearer ${ANA_TOKEN}`).send({ etapa: 'contactado' });
  assert.equal(ana.status, 403);
  const anaToque = await supertest(app).post('/api/prospectos/1/toques')
    .set('Authorization', `Bearer ${ANA_TOKEN}`);
  assert.equal(anaToque.status, 403);
  assert.equal(readProspectos()[0].eventos.length, 0);
  const admin = await supertest(app).patch('/api/prospectos/1/etapa')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ etapa: 'contactado' });
  assert.equal(admin.status, 200);
  assert.equal(readProspectos()[0].eventos[0].vendedor, 'Tester');
});

test('PATCH etapa y POST toques sobre prospecto inexistente responden 404', async () => {
  writeProspectos([]);
  const etapa = await supertest(app).patch('/api/prospectos/9/etapa')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ etapa: 'contactado' });
  assert.equal(etapa.status, 404);
  const toque = await supertest(app).post('/api/prospectos/9/toques')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(toque.status, 404);
});

test('registrar un toque guarda fecha y autor y aparece en la lista', async () => {
  writeProspectos([prospectoDe('Memo', 'contactado')]);
  const res = await supertest(app).post('/api/prospectos/1/toques')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(res.status, 200);
  const toque = readProspectos()[0].eventos[0];
  assert.equal(toque.tipo, 'toque');
  assert.equal(toque.vendedor, 'Memo');
  assert.ok(toque.fecha);
  const lista = await supertest(app).get('/api/prospectos')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(lista.body[0].eventos.length, 1);
  assert.equal(lista.body[0].eventos[0].tipo, 'toque');
});

test('salida a No util exige motivo del catalogo; sin motivo o fuera de catalogo no procede', async () => {
  writeProspectos([prospectoDe('Memo', 'contactado')]);
  const sinMotivo = await supertest(app).patch('/api/prospectos/1/etapa')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ etapa: 'no_util' });
  assert.equal(sinMotivo.status, 400);
  const motivoInvalido = await supertest(app).patch('/api/prospectos/1/etapa')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ etapa: 'no_util', motivo: 'no me gusto' });
  assert.equal(motivoInvalido.status, 400);
  assert.equal(readProspectos()[0].etapa, 'contactado');
  const ok = await supertest(app).patch('/api/prospectos/1/etapa')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ etapa: 'no_util', motivo: 'fuera de zona' });
  assert.equal(ok.status, 200);
  const guardado = readProspectos()[0];
  assert.equal(guardado.etapa, 'no_util');
  assert.equal(guardado.eventos[0].tipo, 'no_util');
  assert.equal(guardado.eventos[0].motivo, 'fuera de zona');
  assert.equal(guardado.eventos[0].vendedor, 'Memo');
  // ya en No util no se puede seguir operando
  const despues = await supertest(app).patch('/api/prospectos/1/etapa')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ etapa: 'no_util', motivo: 'spam' });
  assert.equal(despues.status, 400);
});

// === Issue #44: cola de seguimiento ===

test('GET /api/prospectos/cola sin token responde 401', async () => {
  writeProspectos([]);
  const res = await supertest(app).get('/api/prospectos/cola');
  assert.equal(res.status, 401);
});

test('la cola excluye cotizado y No util y respeta la visibilidad vendedor/admin', async () => {
  writeProspectos([
    prospectoDe('Memo', 'nuevo', { id: 1 }),
    prospectoDe('Memo', 'cotizado', { id: 2, celular: '+52 5522222222', celular10: '5522222222' }),
    prospectoDe('Memo', 'no_util', { id: 3, celular: '+52 5533333333', celular10: '5533333333' }),
    prospectoDe('Ana', 'contactado', { id: 4, celular: '+52 5544444444', celular10: '5544444444' }),
  ]);
  const memo = await supertest(app).get('/api/prospectos/cola')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(memo.status, 200);
  assert.deepEqual(memo.body.map(i => i.id), [1]);
  const admin = await supertest(app).get('/api/prospectos/cola')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
  assert.deepEqual(admin.body.map(i => i.id).sort(), [1, 4]);
});

test('la cola trae horas habiles, semaforo y sugerencia de No util tras 3 toques, mas urgente primero', async () => {
  // capturas viejas (2026-06-01): para cualquier "ahora" posterior ambos canales
  // ya estan saturados, pero WhatsApp es mas urgente relativo a su umbral.
  const toque = f => ({ tipo: 'toque', fecha: f, vendedor: 'Memo' });
  writeProspectos([
    prospectoDe('Memo', 'nuevo', { id: 1, canal: 'Correo' }),
    prospectoDe('Memo', 'contactado', { id: 2, celular: '+52 5522222222', celular10: '5522222222', eventos: [
      toque('2026-06-01T17:00:00Z'), toque('2026-06-02T17:00:00Z'), toque('2026-06-03T17:00:00Z'),
    ] }),
  ]);
  const res = await supertest(app).get('/api/prospectos/cola')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map(i => i.id), [2, 1]);
  const [wa, correo] = res.body;
  assert.equal(wa.canal, 'WhatsApp');
  assert.ok(wa.horas >= 2);
  assert.equal(wa.color, 'rojo');
  assert.equal(wa.toques, 3);
  assert.equal(wa.sugerirNoUtil, true);
  assert.equal(correo.toques, 0);
  assert.equal(correo.sugerirNoUtil, false);
  assert.ok(correo.horas > 0);
});

test('admin consulta los motivos de No util acumulados; vendedor no', async () => {
  writeProspectos([
    prospectoDe('Memo', 'no_util', { eventos: [{ tipo: 'no_util', motivo: 'spam', fecha: '2026-06-11T10:00:00Z', vendedor: 'Memo' }] }),
    prospectoDe('Ana', 'no_util', { id: 2, celular: '+52 5522222222', celular10: '5522222222', eventos: [{ tipo: 'no_util', motivo: 'spam', fecha: '2026-06-12T10:00:00Z', vendedor: 'Ana' }] }),
    prospectoDe('Ana', 'no_util', { id: 3, celular: '+52 5533333333', celular10: '5533333333', eventos: [{ tipo: 'no_util', motivo: 'menudeo', fecha: '2026-06-13T10:00:00Z', vendedor: 'Ana' }] }),
    prospectoDe('Memo', 'nuevo', { id: 4, celular: '+52 5544444444', celular10: '5544444444' }),
  ]);
  const admin = await supertest(app).get('/api/admin/prospectos/no-util')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
  assert.equal(admin.status, 200);
  assert.deepEqual(admin.body, { spam: 2, menudeo: 1 });
  const memo = await supertest(app).get('/api/admin/prospectos/no-util')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(memo.status, 403);
  const sinToken = await supertest(app).get('/api/admin/prospectos/no-util');
  assert.equal(sinToken.status, 401);
});
