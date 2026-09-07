// Nueva oportunidad desde la ficha del Contacto (#343, spec #337, ADR-0016,
// CONTEXT.md "Oportunidad"): un Contacto que ya cotizo vuelve a preguntar. Hasta
// este ticket ese interes no tenia donde vivir -- su celular ya era prospecto y
// no se podia capturar otra vez.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync, borrarArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROSPECTOS_PATH = join(__dirname, '..', 'data', 'prospectos.json');
const OPORTUNIDADES_PATH = join(__dirname, '..', 'data', 'oportunidades.json');
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
const ANA_TOKEN = jwt.sign({ id: 8, name: 'Ana', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });

function readJson(p) { return existsSync(p) ? JSON.parse(leerArchivoSync(p)) : []; }
function writeJson(p, data) { escribirArchivoSync(p, JSON.stringify(data, null, 2)); }
const hace = (dias) => new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

// Jorge Orea ya cotizo: su Oportunidad ES la cotizacion 10, y vuelve a
// preguntar por un evento.
const JORGE = {
  id: 1, fecha: hace(20), vendedor: 'Memo', celular: '+52 5555550001', celular10: '5555550001',
  nombre: 'Jorge Orea', ciudad: 'CDMX', canal: 'Feria/Expo', etapa: 'seguimiento',
  eventos: [{ tipo: 'cotizacion', cotizacion_id: 10, fecha: hace(19), vendedor: 'Memo' }], data: {},
};
// Laura sigue en Por Cotizar: su Oportunidad de siempre tiene que seguir donde
// estaba cuando se le abre otra.
const LAURA = {
  id: 2, fecha: hace(2), vendedor: 'Memo', celular: '+52 5512345678', celular10: '5512345678',
  nombre: 'Laura', ciudad: 'Puebla', canal: 'Instagram', etapa: 'por_cotizar',
  eventos: [], data: {},
};
// Contacto de otra vendedora.
const PEDRO = {
  id: 3, fecha: hace(3), vendedor: 'Ana', celular: '+52 5599999999', celular10: '5599999999',
  nombre: 'Pedro', ciudad: 'CDMX', canal: 'WhatsApp', etapa: 'por_cotizar', eventos: [], data: {},
};

const COT_JORGE = {
  id: 10, fecha: hace(19), vendedor: 'Memo', cliente: 'JORGE OREA', etapa: 'seguimiento',
  totalPiezas: 200, total: 15000, tier: 'M100', folioOperam: 1240, contactoCelular: '5555550001',
  data: { cliente: { razonSocial: 'JORGE OREA', telefono: '+52 5555550001' }, items: [] },
};

function fixtures() {
  writeJson(PROSPECTOS_PATH, [JORGE, LAURA, PEDRO]);
  writeJson(COTS_PATH, [COT_JORGE]);
  if (existsSync(OPORTUNIDADES_PATH)) borrarArchivoSync(OPORTUNIDADES_PATH);
}

const abrir = (token, body) => supertest(app).post('/api/oportunidades')
  .set('Authorization', `Bearer ${token}`).send(body);

let savedProspectos, savedCots, savedOportunidades;
let existiaProspectos, existiaCots, existiaOportunidades;
before(() => {
  existiaProspectos = existsSync(PROSPECTOS_PATH);
  existiaCots = existsSync(COTS_PATH);
  existiaOportunidades = existsSync(OPORTUNIDADES_PATH);
  savedProspectos = readJson(PROSPECTOS_PATH);
  savedCots = readJson(COTS_PATH);
  savedOportunidades = readJson(OPORTUNIDADES_PATH);
});
after(() => {
  if (existiaProspectos) writeJson(PROSPECTOS_PATH, savedProspectos);
  else if (existsSync(PROSPECTOS_PATH)) borrarArchivoSync(PROSPECTOS_PATH);
  if (existiaCots) writeJson(COTS_PATH, savedCots);
  else if (existsSync(COTS_PATH)) borrarArchivoSync(COTS_PATH);
  if (existiaOportunidades) writeJson(OPORTUNIDADES_PATH, savedOportunidades);
  else if (existsSync(OPORTUNIDADES_PATH)) borrarArchivoSync(OPORTUNIDADES_PATH);
});
beforeEach(() => { fixtures(); });

test('#343: sin token responde 401', async () => {
  const res = await supertest(app).post('/api/oportunidades').send({ celular: JORGE.celular });
  assert.equal(res.status, 401);
});

// AC1 + AC2
test('#343: abre una Oportunidad en Por Cotizar, asignada a quien la abre y con el Origen del Contacto', async () => {
  const res = await abrir(MEMO_TOKEN, { celular: '+52 5555550001' });
  assert.equal(res.status, 201);
  const t = res.body.oportunidad;
  assert.equal(t.tipo, 'prospecto');
  assert.equal(t.etapa, 'por_cotizar');
  assert.equal(t.vendedor, 'Memo');
  assert.equal(t.nombre, 'Jorge Orea');
  // El Origen se HEREDA del Contacto: el POST no lo pide ni lo acepta.
  assert.equal(t.origen, 'Feria/Expo');
  const guardadas = readJson(OPORTUNIDADES_PATH);
  const nueva = guardadas.find(o => o.id === t.refId);
  assert.equal(nueva.contactoId, 1);
  assert.deepEqual(nueva.eventos.map(e => e.tipo), ['apertura']);
  assert.equal(nueva.eventos[0].vendedor, 'Memo');
});

test('#343: el origen que venga en el cuerpo se ignora -- el Origen es del Contacto', async () => {
  const res = await abrir(MEMO_TOKEN, { celular: '+52 5555550001', canal: 'Instagram', origen: 'Instagram' });
  assert.equal(res.status, 201);
  assert.equal(res.body.oportunidad.origen, 'Feria/Expo');
  assert.equal(readJson(OPORTUNIDADES_PATH).some(o => o.canal || o.origen), false);
});

// AC3
test('#343: la Oportunidad nueva sale en el tablero y la anterior del mismo Contacto sigue donde estaba', async () => {
  const abierta = await abrir(MEMO_TOKEN, { celular: '+52 5512345678' });
  assert.equal(abierta.status, 201);
  const res = await supertest(app).get('/api/oportunidades').set('Authorization', `Bearer ${MEMO_TOKEN}`);
  const deLaura = res.body.filter(o => o.tipo === 'prospecto' && o.nombre === 'Laura');
  assert.equal(deLaura.length, 2, 'las dos Oportunidades de Laura tienen tarjeta');
  // La de siempre conserva su id y su etapa.
  const anterior = deLaura.find(o => o.refId === 2);
  assert.equal(anterior.etapa, 'por_cotizar');
  assert.equal(anterior.origen, 'Instagram');
});

test('#343: la Oportunidad nueva entra a la cola Hoy con cadencia de horas habiles', async () => {
  const abierta = await abrir(MEMO_TOKEN, { celular: '+52 5555550001' });
  const res = await supertest(app).get('/api/hoy').set('Authorization', `Bearer ${MEMO_TOKEN}`);
  const item = res.body.find(i => i.tipo === 'prospecto' && i.id === abierta.body.oportunidad.refId);
  assert.ok(item, 'la Oportunidad recien abierta es un pendiente del dia');
  assert.equal(typeof item.horas, 'number');
  assert.equal(item.color, 'verde');
});

// AC4
test('#343: capturar un celular que ya es Contacto no crea prospecto y ofrece Nueva oportunidad', async () => {
  const antes = readJson(PROSPECTOS_PATH).length;
  const res = await supertest(app).post('/api/prospectos')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`)
    .send({ celular: '+52 5555550001', nombre: 'Jorge', ciudad: 'CDMX', canal: 'WhatsApp' });
  assert.equal(res.status, 409);
  assert.equal(res.body.tipo, 'prospecto_propio');
  assert.equal(res.body.nuevaOportunidad.celular, JORGE.celular);
  assert.equal(readJson(PROSPECTOS_PATH).length, antes, 'no se crea prospecto');
  // Y el celular que ofrece la respuesta es el que abre la Oportunidad.
  const abierta = await abrir(MEMO_TOKEN, { celular: res.body.nuevaOportunidad.celular });
  assert.equal(abierta.status, 201);
});

test('#343: un celular que todavia no es Contacto responde 404 y no crea nada', async () => {
  const res = await abrir(MEMO_TOKEN, { celular: '+52 5500000000' });
  assert.equal(res.status, 404);
  assert.equal(readJson(OPORTUNIDADES_PATH).length, 0);
});

test('#343: no se abre una Oportunidad sobre el Contacto de otro vendedor', async () => {
  const res = await abrir(MEMO_TOKEN, { celular: PEDRO.celular });
  assert.equal(res.status, 403);
  assert.equal(readJson(OPORTUNIDADES_PATH).length, 0);
  // Su duena si puede.
  assert.equal((await abrir(ANA_TOKEN, { celular: PEDRO.celular })).status, 201);
});

test('#343: sin celular responde 400', async () => {
  assert.equal((await abrir(ADMIN_TOKEN, {})).status, 400);
});

// AC6: la tarjeta nueva se trabaja por las MISMAS rutas de siempre, con su
// propio id -- sin esto la Oportunidad nueva seria inerte.
test('#343: la tarjeta nueva se trabaja por las rutas de siempre y no mueve a la anterior', async () => {
  const abierta = await abrir(MEMO_TOKEN, { celular: '+52 5512345678' });
  const id = abierta.body.oportunidad.refId;
  const toque = await supertest(app).post(`/api/prospectos/${id}/toques`)
    .set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(toque.status, 200);
  assert.equal(toque.body.eventos.filter(e => e.tipo === 'toque').length, 1);
  const salida = await supertest(app).patch(`/api/prospectos/${id}/etapa`)
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ etapa: 'perdida' });
  assert.equal(salida.status, 200);
  const guardadas = readJson(OPORTUNIDADES_PATH);
  assert.equal(guardadas.find(o => o.id === id).etapa, 'perdida');
  assert.equal(guardadas.find(o => o.id === 2).etapa, 'por_cotizar', 'la anterior no se movio');
});
