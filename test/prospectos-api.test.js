import { test, before, after, beforeEach } from 'node:test';
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
const { resetIndice } = await import('../lib/indice-telefonos.js');
const { resetSession } = await import('../lib/operam-client.js');
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

// Ningun test de este archivo pega a Operam real: fetch queda bloqueado por
// defecto (el guardrail del indice es best effort y procede ante el fallo) y
// cada test que necesita Operam instala sus propios handlers.
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

let savedProspectos;
let existia;
before(() => {
  existia = existsSync(PROSPECTOS_PATH);
  savedProspectos = readProspectos();
  globalThis.fetch = fetchBloqueado;
});
after(() => {
  if (existia) writeProspectos(savedProspectos);
  else if (existsSync(PROSPECTOS_PATH)) unlinkSync(PROSPECTOS_PATH);
  globalThis.fetch = originalFetch;
});
beforeEach(() => {
  globalThis.fetch = fetchBloqueado;
  resetIndice();
  resetSession();
});

const CAPTURA = {
  celular: '+52 5512345678', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp',
  empresa: 'Hotel Azul', temperatura: 4,
};

test('vendedor autenticado captura un prospecto y lo ve en su lista en Por Cotizar', async () => {
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
  assert.equal(p.etapa, 'por_cotizar');
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

test('capturar un celular que ya es prospecto de otro vendedor responde 409 con el dueno y sin exponer datos', async () => {
  writeProspectos([]);
  await supertest(app).post('/api/prospectos')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send(CAPTURA);
  const res = await supertest(app).post('/api/prospectos')
    .set('Authorization', `Bearer ${ANA_TOKEN}`).send(CAPTURA);
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'Este celular ya lo atiende Memo');
  assert.deepEqual(Object.keys(res.body), ['error']);
  assert.equal(readProspectos().length, 1);
});

test('GET /api/prospectos muestra solo los del vendedor; admin ve todos', async () => {
  writeProspectos([
    { id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', celular: '+52 5511111111', celular10: '5511111111', nombre: 'A', ciudad: 'CDMX', canal: 'WhatsApp', etapa: 'por_cotizar', data: {} },
    { id: 2, fecha: '2026-06-02T00:00:00Z', vendedor: 'Ana', celular: '+52 5522222222', celular10: '5522222222', nombre: 'B', ciudad: 'Puebla', canal: 'Referido', etapa: 'por_cotizar', data: {} },
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

// === Issue #57: alta sin asignar (No Asignado) + asignacion de vendedor ===

// La ruta de alta sin asignar es admin-only en este slice: la consumira el
// formulario web "Peltre de Mayoreo" (y a futuro un bot), pero su auth publica
// es una decision de seguridad posterior y fuera de alcance. No se expone una
// escritura publica sin control.
test('POST /api/prospectos/sin-asignar crea la tarjeta en No Asignado sin vendedor (admin)', async () => {
  writeProspectos([]);
  const res = await supertest(app).post('/api/prospectos/sin-asignar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
    .send({ celular: '+52 5512345678', nombre: 'Mayoreo Web', ciudad: 'Toluca', canal: 'Formulario web' });
  assert.equal(res.status, 201);
  assert.ok(res.body.id);
  const p = readProspectos()[0];
  assert.equal(p.etapa, 'no_asignado');
  assert.equal(p.vendedor, null);
  assert.equal(p.nombre, 'Mayoreo Web');
  assert.equal(p.canal, 'Formulario web');
});

test('POST /api/prospectos/sin-asignar exige admin: vendedor 403, sin token 401', async () => {
  writeProspectos([]);
  const sinToken = await supertest(app).post('/api/prospectos/sin-asignar')
    .send({ celular: '+52 5512345678', nombre: 'X', ciudad: 'Toluca', canal: 'Formulario web' });
  assert.equal(sinToken.status, 401);
  const vendedor = await supertest(app).post('/api/prospectos/sin-asignar')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`)
    .send({ celular: '+52 5512345678', nombre: 'X', ciudad: 'Toluca', canal: 'Formulario web' });
  assert.equal(vendedor.status, 403);
  assert.equal(readProspectos().length, 0);
});

test('POST /api/prospectos/sin-asignar valida obligatorios y rechaza con 400', async () => {
  writeProspectos([]);
  const sinNombre = await supertest(app).post('/api/prospectos/sin-asignar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
    .send({ celular: '+52 5512345678', nombre: '', ciudad: 'Toluca', canal: 'Formulario web' });
  assert.equal(sinNombre.status, 400);
  const canalInvalido = await supertest(app).post('/api/prospectos/sin-asignar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
    .send({ celular: '+52 5512345678', nombre: 'X', ciudad: 'Toluca', canal: 'TikTok' });
  assert.equal(canalInvalido.status, 400);
  assert.equal(readProspectos().length, 0);
});

test('POST /api/prospectos/sin-asignar reusa los guardrails: un celular que ya es prospecto no se duplica', async () => {
  // Un prospecto propio de Memo (ya con dueno): el alta sin asignar no lo duplica.
  writeProspectos([prospectoDe('Memo', 'por_cotizar')]);
  const res = await supertest(app).post('/api/prospectos/sin-asignar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
    .send({ celular: '+52 5512345678', nombre: 'Otro', ciudad: 'Toluca', canal: 'Formulario web' });
  assert.equal(res.status, 409);
  assert.equal(readProspectos().length, 1);
});

test('POST /api/prospectos/sin-asignar reusa el guardrail de cliente Operam: no crea prospecto', async () => {
  writeProspectos([]);
  mockListadoClientes([CLIENTE_OPERAM]);
  const res = await supertest(app).post('/api/prospectos/sin-asignar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
    .send({ celular: '+52 1 55 1234 5678', nombre: 'X', ciudad: 'Toluca', canal: 'Formulario web' });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /como cliente/i);
  assert.equal(readProspectos().length, 0);
});

function noAsignado(extra = {}) {
  return {
    id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: null, celular: '+52 5512345678',
    celular10: '5512345678', nombre: 'Mayoreo Web', ciudad: 'Toluca', canal: 'Formulario web',
    etapa: 'no_asignado', eventos: [], data: {}, ...extra,
  };
}

// El vendedor asignado debe ser uno del catalogo (data/vendedores.json, la misma
// fuente que GET /api/catalogos que pobla el selector del admin).
const VENDEDOR_CATALOGO = 'Alejandro Chávez';

test('PATCH /api/prospectos/:id/asignar mueve la tarjeta a Por Cotizar con el vendedor elegido (admin)', async () => {
  writeProspectos([noAsignado()]);
  const res = await supertest(app).patch('/api/prospectos/1/asignar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: VENDEDOR_CATALOGO });
  assert.equal(res.status, 200);
  assert.equal(res.body.etapa, 'por_cotizar');
  const p = readProspectos()[0];
  assert.equal(p.vendedor, VENDEDOR_CATALOGO);
  assert.equal(p.etapa, 'por_cotizar');
  const ev = p.eventos.find(e => e.tipo === 'asignacion');
  assert.ok(ev, 'evento de asignacion registrado');
  assert.equal(ev.a, VENDEDOR_CATALOGO);
  assert.equal(ev.de, 'no_asignado');
  assert.equal(ev.vendedor, 'Tester');
});

test('PATCH /api/prospectos/:id/asignar exige admin: vendedor 403, sin token 401', async () => {
  writeProspectos([noAsignado()]);
  const sinToken = await supertest(app).patch('/api/prospectos/1/asignar').send({ vendedor: VENDEDOR_CATALOGO });
  assert.equal(sinToken.status, 401);
  const vendedor = await supertest(app).patch('/api/prospectos/1/asignar')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ vendedor: VENDEDOR_CATALOGO });
  assert.equal(vendedor.status, 403);
  assert.equal(readProspectos()[0].etapa, 'no_asignado');
});

test('PATCH /api/prospectos/:id/asignar rechaza un vendedor fuera del catalogo con 400', async () => {
  writeProspectos([noAsignado()]);
  const res = await supertest(app).patch('/api/prospectos/1/asignar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: 'Fantasma' });
  assert.equal(res.status, 400);
  const sinVendedor = await supertest(app).patch('/api/prospectos/1/asignar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({});
  assert.equal(sinVendedor.status, 400);
  assert.equal(readProspectos()[0].etapa, 'no_asignado');
});

test('PATCH /api/prospectos/:id/asignar solo aplica desde No Asignado (regla de dominio)', async () => {
  // una tarjeta que ya tiene dueno (Por Cotizar) no se reasigna por esta ruta
  writeProspectos([noAsignado({ vendedor: 'Memo', etapa: 'por_cotizar' })]);
  const res = await supertest(app).patch('/api/prospectos/1/asignar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: VENDEDOR_CATALOGO });
  assert.equal(res.status, 400);
  const p = readProspectos()[0];
  assert.equal(p.vendedor, 'Memo');
  assert.equal(p.etapa, 'por_cotizar');
});

test('PATCH /api/prospectos/:id/asignar sobre tarjeta inexistente responde 404', async () => {
  writeProspectos([]);
  const res = await supertest(app).patch('/api/prospectos/9/asignar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: VENDEDOR_CATALOGO });
  assert.equal(res.status, 404);
});

test('No Asignado solo lo ve quien asigna (admin); el vendedor no ve tarjetas sin dueno', async () => {
  writeProspectos([
    noAsignado({ id: 1 }),
    { id: 2, fecha: '2026-06-02T00:00:00Z', vendedor: 'Memo', celular: '+52 5522222222', celular10: '5522222222', nombre: 'Mio', ciudad: 'CDMX', canal: 'WhatsApp', etapa: 'por_cotizar', eventos: [], data: {} },
  ]);
  const memo = await supertest(app).get('/api/prospectos').set('Authorization', `Bearer ${MEMO_TOKEN}`);
  // Memo solo ve la suya; la No Asignado (vendedor null) no aparece en su cartera
  assert.deepEqual(memo.body.map(p => p.id), [2]);
  const admin = await supertest(app).get('/api/prospectos').set('Authorization', `Bearer ${ADMIN_TOKEN}`);
  assert.deepEqual(admin.body.map(p => p.id).sort(), [1, 2]);
  const sinDueno = admin.body.find(p => p.id === 1);
  assert.equal(sinDueno.etapa, 'no_asignado');
  assert.equal(sinDueno.vendedor, null);
});

// === Issue #43: etapas, toques, No util e historial ===

function prospectoDe(vendedor, etapa = 'por_cotizar', extra = {}) {
  return {
    id: 1, fecha: '2026-06-01T00:00:00Z', vendedor, celular: '+52 5512345678',
    celular10: '5512345678', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp',
    etapa, eventos: [], data: {}, ...extra,
  };
}

test('en el pipeline unificado no hay avance manual de etapa antes de cotizar: el PATCH se rechaza', async () => {
  writeProspectos([prospectoDe('Memo')]);
  for (const etapa of ['seguimiento', 'anticipo_pagado', 'por_cotizar', 'cotizado', 'inventada', undefined]) {
    const res = await supertest(app).patch('/api/prospectos/1/etapa')
      .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ etapa });
    assert.equal(res.status, 400, `etapa ${etapa} debio rechazarse`);
  }
  const guardado = readProspectos()[0];
  assert.equal(guardado.etapa, 'por_cotizar');
  assert.equal(guardado.eventos.length, 0);
});

test('un vendedor no puede operar el prospecto de otro; admin si puede (salida a No util)', async () => {
  writeProspectos([prospectoDe('Memo')]);
  const ana = await supertest(app).patch('/api/prospectos/1/etapa')
    .set('Authorization', `Bearer ${ANA_TOKEN}`).send({ etapa: 'no_util', motivo: 'spam' });
  assert.equal(ana.status, 403);
  const anaToque = await supertest(app).post('/api/prospectos/1/toques')
    .set('Authorization', `Bearer ${ANA_TOKEN}`);
  assert.equal(anaToque.status, 403);
  assert.equal(readProspectos()[0].eventos.length, 0);
  const admin = await supertest(app).patch('/api/prospectos/1/etapa')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ etapa: 'no_util', motivo: 'spam' });
  assert.equal(admin.status, 200);
  assert.equal(readProspectos()[0].eventos[0].vendedor, 'Tester');
});

test('PATCH etapa y POST toques sobre prospecto inexistente responden 404', async () => {
  writeProspectos([]);
  const etapa = await supertest(app).patch('/api/prospectos/9/etapa')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ etapa: 'no_util', motivo: 'spam' });
  assert.equal(etapa.status, 404);
  const toque = await supertest(app).post('/api/prospectos/9/toques')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(toque.status, 404);
});

test('registrar un toque guarda fecha y autor y aparece en la lista', async () => {
  writeProspectos([prospectoDe('Memo', 'por_cotizar')]);
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
  writeProspectos([prospectoDe('Memo', 'por_cotizar')]);
  const sinMotivo = await supertest(app).patch('/api/prospectos/1/etapa')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ etapa: 'no_util' });
  assert.equal(sinMotivo.status, 400);
  const motivoInvalido = await supertest(app).patch('/api/prospectos/1/etapa')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ etapa: 'no_util', motivo: 'no me gusto' });
  assert.equal(motivoInvalido.status, 400);
  assert.equal(readProspectos()[0].etapa, 'por_cotizar');
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

// === Issue #56: mover a Seguimiento a mano capturando folio Operam ===

test('PATCH etapa a Seguimiento sin folio se rechaza server-side y la tarjeta no avanza (#56)', async () => {
  writeProspectos([prospectoDe('Memo', 'por_cotizar')]);
  const sinFolio = await supertest(app).patch('/api/prospectos/1/etapa')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ etapa: 'seguimiento' });
  assert.equal(sinFolio.status, 400);
  assert.match(sinFolio.body.error, /folio/i);
  const folioVacio = await supertest(app).patch('/api/prospectos/1/etapa')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ etapa: 'seguimiento', folio: '   ' });
  assert.equal(folioVacio.status, 400);
  const guardado = readProspectos()[0];
  assert.equal(guardado.etapa, 'por_cotizar');
  assert.equal(guardado.eventos.length, 0);
});

test('PATCH etapa a Seguimiento con folio mueve la tarjeta y guarda data.folioOperam (#56)', async () => {
  writeProspectos([prospectoDe('Memo', 'por_cotizar', { data: { empresa: 'Hotel Azul' } })]);
  const res = await supertest(app).patch('/api/prospectos/1/etapa')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ etapa: 'seguimiento', folio: '55123' });
  assert.equal(res.status, 200);
  assert.equal(res.body.etapa, 'seguimiento');
  const guardado = readProspectos()[0];
  assert.equal(guardado.etapa, 'seguimiento');
  assert.equal(guardado.data.folioOperam, '55123');
  assert.equal(guardado.data.empresa, 'Hotel Azul');
  const ev = guardado.eventos.find(e => e.tipo === 'etapa');
  assert.equal(ev.a, 'seguimiento');
  assert.equal(ev.folio, '55123');
  assert.equal(ev.vendedor, 'Memo');
});

test('PATCH etapa a Seguimiento desde una etapa que no es Por Cotizar sigue invalido aun con folio (#56)', async () => {
  writeProspectos([prospectoDe('Memo', 'no_asignado')]);
  const res = await supertest(app).patch('/api/prospectos/1/etapa')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ etapa: 'seguimiento', folio: '55123' });
  assert.equal(res.status, 400);
  assert.equal(readProspectos()[0].etapa, 'no_asignado');
});

// === Issue #66: editar/complementar el prospecto desde su tarjeta ===

test('PATCH /api/prospectos/:id edita nombre/ciudad y opcionales (empresa, tipo de cliente, piezas, correo, temperatura, notas)', async () => {
  writeProspectos([prospectoDe('Memo', 'seguimiento', { data: { empresa: 'Hotel Azul' } })]);
  const res = await supertest(app).patch('/api/prospectos/1')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`)
    .send({
      nombre: 'Laura Perez', ciudad: 'CDMX', empresa: 'Hotel Verde',
      segmento_id: 14, piezas_estimadas: '+550', correo: 'laura@hotel.mx',
      temperatura: 5, notas: 'pidio catalogo',
    });
  assert.equal(res.status, 200);
  const p = readProspectos()[0];
  assert.equal(p.nombre, 'Laura Perez');
  assert.equal(p.ciudad, 'CDMX');
  assert.equal(p.data.empresa, 'Hotel Verde');
  assert.equal(p.data.segmento_id, 14);
  assert.equal(p.data.piezas_estimadas, '+550');
  assert.equal(p.data.correo, 'laura@hotel.mx');
  assert.equal(p.data.temperatura, 5);
  assert.equal(p.data.notas, 'pidio catalogo');
  // editar no mueve la etapa ni inventa eventos
  assert.equal(p.etapa, 'seguimiento');
  assert.equal(p.eventos.length, 0);
});

test('PATCH /api/prospectos/:id se permite en cualquier etapa activa pero no en una salida (No util/Perdida)', async () => {
  // activa: post-venta tambien es editable
  writeProspectos([prospectoDe('Memo', 'anticipo_pagado')]);
  const activa = await supertest(app).patch('/api/prospectos/1')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ notas: 'al dia' });
  assert.equal(activa.status, 200);
  assert.equal(readProspectos()[0].data.notas, 'al dia');
  // salida: no editable
  writeProspectos([prospectoDe('Memo', 'no_util')]);
  const salida = await supertest(app).patch('/api/prospectos/1')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ notas: 'tarde' });
  assert.equal(salida.status, 400);
  assert.equal(readProspectos()[0].data.notas, undefined);
});

test('PATCH /api/prospectos/:id rechaza vaciar un obligatorio (nombre/ciudad) sin persistir', async () => {
  writeProspectos([prospectoDe('Memo', 'por_cotizar')]);
  const sinNombre = await supertest(app).patch('/api/prospectos/1')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ nombre: '   ' });
  assert.equal(sinNombre.status, 400);
  const sinCiudad = await supertest(app).patch('/api/prospectos/1')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ ciudad: '' });
  assert.equal(sinCiudad.status, 400);
  const p = readProspectos()[0];
  assert.equal(p.nombre, 'Laura');
  assert.equal(p.ciudad, 'Puebla');
});

test('PATCH /api/prospectos/:id respeta visibilidad: otro vendedor 403, inexistente 404, sin token 401', async () => {
  writeProspectos([prospectoDe('Memo', 'por_cotizar')]);
  const sinToken = await supertest(app).patch('/api/prospectos/1').send({ notas: 'x' });
  assert.equal(sinToken.status, 401);
  const ana = await supertest(app).patch('/api/prospectos/1')
    .set('Authorization', `Bearer ${ANA_TOKEN}`).send({ notas: 'x' });
  assert.equal(ana.status, 403);
  const noExiste = await supertest(app).patch('/api/prospectos/9')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ notas: 'x' });
  assert.equal(noExiste.status, 404);
  // admin si puede editar el de cualquiera
  const admin = await supertest(app).patch('/api/prospectos/1')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ notas: 'visto por admin' });
  assert.equal(admin.status, 200);
  assert.equal(readProspectos()[0].data.notas, 'visto por admin');
});

// === Issue #44: cola de seguimiento ===

test('GET /api/prospectos/cola sin token responde 401', async () => {
  writeProspectos([]);
  const res = await supertest(app).get('/api/prospectos/cola');
  assert.equal(res.status, 401);
});

test('la cola excluye Seguimiento y No util y respeta la visibilidad vendedor/admin', async () => {
  writeProspectos([
    prospectoDe('Memo', 'por_cotizar', { id: 1 }),
    prospectoDe('Memo', 'seguimiento', { id: 2, celular: '+52 5522222222', celular10: '5522222222' }),
    prospectoDe('Memo', 'no_util', { id: 3, celular: '+52 5533333333', celular10: '5533333333' }),
    prospectoDe('Ana', 'por_cotizar', { id: 4, celular: '+52 5544444444', celular10: '5544444444' }),
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
    prospectoDe('Memo', 'por_cotizar', { id: 1, canal: 'Correo' }),
    prospectoDe('Memo', 'por_cotizar', { id: 2, celular: '+52 5522222222', celular10: '5522222222', eventos: [
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
    prospectoDe('Memo', 'por_cotizar', { id: 4, celular: '+52 5544444444', celular10: '5544444444' }),
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

// === Issue #45: reunion diagnostico ===

const FUTURO = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const PASADO = new Date(Date.now() - 3600 * 1000).toISOString();

test('agendar reunion con fecha futura registra el evento y saca al prospecto de la cola', async () => {
  writeProspectos([prospectoDe('Memo', 'por_cotizar')]);
  const res = await supertest(app).post('/api/prospectos/1/reunion')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ fecha: FUTURO });
  assert.equal(res.status, 200);
  const ev = readProspectos()[0].eventos[0];
  assert.equal(ev.tipo, 'reunion');
  assert.equal(ev.fecha_reunion, FUTURO);
  assert.equal(ev.vendedor, 'Memo');
  assert.ok(ev.fecha);
  const cola = await supertest(app).get('/api/prospectos/cola')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.deepEqual(cola.body, []);
});

test('agendar reunion rechaza fecha pasada, ausente o invalida con 400 y no registra nada', async () => {
  writeProspectos([prospectoDe('Memo')]);
  for (const body of [{ fecha: PASADO }, {}, { fecha: 'no-es-fecha' }]) {
    const res = await supertest(app).post('/api/prospectos/1/reunion')
      .set('Authorization', `Bearer ${MEMO_TOKEN}`).send(body);
    assert.equal(res.status, 400, `body ${JSON.stringify(body)} debio rechazarse`);
  }
  assert.equal(readProspectos()[0].eventos.length, 0);
});

test('reunion respeta visibilidad: otro vendedor 403, inexistente 404, sin token 401', async () => {
  writeProspectos([prospectoDe('Memo')]);
  const ana = await supertest(app).post('/api/prospectos/1/reunion')
    .set('Authorization', `Bearer ${ANA_TOKEN}`).send({ fecha: FUTURO });
  assert.equal(ana.status, 403);
  const noExiste = await supertest(app).post('/api/prospectos/9/reunion')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ fecha: FUTURO });
  assert.equal(noExiste.status, 404);
  const sinToken = await supertest(app).post('/api/prospectos/1/reunion').send({ fecha: FUTURO });
  assert.equal(sinToken.status, 401);
  const resultado = await supertest(app).post('/api/prospectos/1/reunion-resultado').send({ resultado: 'no_util' });
  assert.equal(resultado.status, 401);
  assert.equal(readProspectos()[0].eventos.length, 0);
});

function reunionPasada() {
  return { tipo: 'reunion', fecha_reunion: PASADO, fecha: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), vendedor: 'Memo' };
}

test('con reunion pasada el prospecto reaparece en la cola al frente con reunionVencida', async () => {
  writeProspectos([
    prospectoDe('Memo', 'por_cotizar', { id: 1, eventos: [reunionPasada()] }),
    prospectoDe('Memo', 'por_cotizar', { id: 2, celular: '+52 5522222222', celular10: '5522222222', fecha: '2026-06-01T00:00:00Z' }),
  ]);
  const cola = await supertest(app).get('/api/prospectos/cola')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(cola.status, 200);
  assert.deepEqual(cola.body.map(i => i.id), [1, 2]);
  assert.equal(cola.body[0].reunionVencida, true);
  assert.equal(cola.body[0].fechaReunion, PASADO);
  assert.equal(cola.body[1].reunionVencida, false);
});

test('resultado no_util exige motivo del catalogo y registra la salida', async () => {
  writeProspectos([prospectoDe('Memo', 'por_cotizar', { eventos: [reunionPasada()] })]);
  const sinMotivo = await supertest(app).post('/api/prospectos/1/reunion-resultado')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ resultado: 'no_util' });
  assert.equal(sinMotivo.status, 400);
  const motivoInvalido = await supertest(app).post('/api/prospectos/1/reunion-resultado')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ resultado: 'no_util', motivo: 'no me gusto' });
  assert.equal(motivoInvalido.status, 400);
  assert.equal(readProspectos()[0].etapa, 'por_cotizar');
  const ok = await supertest(app).post('/api/prospectos/1/reunion-resultado')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ resultado: 'no_util', motivo: 'sin presupuesto' });
  assert.equal(ok.status, 200);
  const guardado = readProspectos()[0];
  assert.equal(guardado.etapa, 'no_util');
  const ev = guardado.eventos.find(e => e.tipo === 'no_util');
  assert.equal(ev.motivo, 'sin presupuesto');
  assert.equal(ev.vendedor, 'Memo');
});

test('reunion-resultado rechaza sin reunion pendiente o con resultado invalido', async () => {
  // sin reunion
  writeProspectos([prospectoDe('Memo')]);
  const sinReunion = await supertest(app).post('/api/prospectos/1/reunion-resultado')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ resultado: 'no_util', motivo: 'spam' });
  assert.equal(sinReunion.status, 400);
  // reunion futura: aun no hay resultado que registrar
  writeProspectos([prospectoDe('Memo', 'por_cotizar', { eventos: [
    { tipo: 'reunion', fecha_reunion: FUTURO, fecha: new Date().toISOString(), vendedor: 'Memo' },
  ] })]);
  const futura = await supertest(app).post('/api/prospectos/1/reunion-resultado')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ resultado: 'no_util', motivo: 'spam' });
  assert.equal(futura.status, 400);
  // reunion pasada pero con evento posterior (la condicion se limpio)
  writeProspectos([prospectoDe('Memo', 'por_cotizar', { eventos: [
    reunionPasada(),
    { tipo: 'toque', fecha: new Date().toISOString(), vendedor: 'Memo' },
  ] })]);
  const limpiada = await supertest(app).post('/api/prospectos/1/reunion-resultado')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ resultado: 'no_util', motivo: 'spam' });
  assert.equal(limpiada.status, 400);
  // resultado fuera de catalogo (calificado se elimino del modelo, ADR-0005)
  writeProspectos([prospectoDe('Memo', 'por_cotizar', { eventos: [reunionPasada()] })]);
  const invalido = await supertest(app).post('/api/prospectos/1/reunion-resultado')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ resultado: 'calificado' });
  assert.equal(invalido.status, 400);
  assert.equal(readProspectos()[0].etapa, 'por_cotizar');
});

test('re-agendar registra otro evento reunion y la ultima manda en la cola', async () => {
  writeProspectos([prospectoDe('Memo', 'por_cotizar', { eventos: [reunionPasada()] })]);
  const res = await supertest(app).post('/api/prospectos/1/reunion')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ fecha: FUTURO });
  assert.equal(res.status, 200);
  const eventos = readProspectos()[0].eventos.filter(e => e.tipo === 'reunion');
  assert.equal(eventos.length, 2);
  const cola = await supertest(app).get('/api/prospectos/cola')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.deepEqual(cola.body, []);
});

// === Issue #42: frenos de frontera ===

const CLIENTE_OPERAM = {
  customer_id: '77', CustName: 'HOTELERA DEL SUR SA DE CV',
  contacts: [{ phone: '+52 1 55 1234 5678 ext.4', phone2: '' }],
  branches: [{ branch_code: '7', phone: '' }],
};

function mockListadoClientes(clientes) {
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': () => jsonResponse({ total: clientes.length, data: clientes }),
  });
}

test('capturar un celular que matchea un cliente Operam responde 409 con aviso y no crea prospecto', async () => {
  writeProspectos([]);
  mockListadoClientes([CLIENTE_OPERAM]);
  const res = await supertest(app).post('/api/prospectos')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send(CAPTURA);
  assert.equal(res.status, 409);
  assert.match(res.body.error, /HOTELERA DEL SUR SA DE CV/);
  assert.match(res.body.error, /como cliente/i);
  assert.equal('prospecto' in res.body, false);
  assert.equal(readProspectos().length, 0);
});

test('si Operam falla, la captura procede sin bloquear (best effort)', async () => {
  writeProspectos([]);
  const res = await supertest(app).post('/api/prospectos')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send(CAPTURA);
  assert.equal(res.status, 201);
  assert.equal(readProspectos().length, 1);
});

test('si el celular no matchea ningun cliente Operam, la captura procede', async () => {
  writeProspectos([]);
  mockListadoClientes([{ ...CLIENTE_OPERAM, contacts: [{ phone: '+52 5599887766' }] }]);
  const res = await supertest(app).post('/api/prospectos')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send(CAPTURA);
  assert.equal(res.status, 201);
  assert.equal(readProspectos().length, 1);
});

function mockAltaCliente() {
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/branches/188': () => jsonResponse({ result: true }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return jsonResponse({ result: true, customer_id: 88 });
      if (u.includes('/88')) return jsonResponse({ data: [{ branches: [{ branch_code: 188 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
  });
}

async function esperarEventoCliente() {
  for (let i = 0; i < 50; i++) {
    const p = readProspectos()[0];
    if (p && (p.eventos || []).some(e => e.tipo === 'cliente')) return p;
    await new Promise(r => setTimeout(r, 10));
  }
  return readProspectos()[0];
}

test('al completar el alta de cliente, el prospecto con ese celular queda ligado al cliente', async () => {
  writeProspectos([prospectoDe('Memo')]);
  mockAltaCliente();
  const res = await supertest(app).post('/api/crear-cliente')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`)
    .send({ tax_id: 'AAA010101AA1', CustName: 'LAURA SA DE CV', phone: '55 1234 5678', entrega: {} });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  const guardado = await esperarEventoCliente();
  const ev = guardado.eventos.find(e => e.tipo === 'cliente');
  assert.ok(ev, 'evento de conversion registrado');
  assert.equal(ev.cliente_id, 88);
  assert.equal(ev.nombre, 'LAURA SA DE CV');
  assert.equal(ev.vendedor, 'Memo');
  assert.ok(ev.fecha);
  assert.equal(guardado.data.cliente_id, 88);
});

test('la conversion tambien liga por celular_nota cuando el payload no trae phone', async () => {
  writeProspectos([prospectoDe('Memo')]);
  mockAltaCliente();
  const res = await supertest(app).post('/api/crear-cliente')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`)
    .send({ tax_id: 'AAA010101AA1', CustName: 'LAURA SA DE CV', celular_nota: '+52 55 1234 5678', entrega: {} });
  assert.equal(res.status, 200);
  const guardado = await esperarEventoCliente();
  assert.ok(guardado.eventos.some(e => e.tipo === 'cliente' && e.cliente_id === 88));
});

test('un fallo del store de prospectos no rompe el alta de cliente (fire-and-forget)', async () => {
  writeFileSync(PROSPECTOS_PATH, '{corrupto');
  mockAltaCliente();
  const res = await supertest(app).post('/api/crear-cliente')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`)
    .send({ tax_id: 'AAA010101AA1', CustName: 'LAURA SA DE CV', phone: '55 1234 5678', entrega: {} });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  writeProspectos([]);
});
