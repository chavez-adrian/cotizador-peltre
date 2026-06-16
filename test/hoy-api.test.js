import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROSPECTOS_PATH = join(__dirname, '..', 'data', 'prospectos.json');
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

function readJson(p) { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : []; }
function writeJson(p, data) { writeFileSync(p, JSON.stringify(data, null, 2)); }

const hace = (dias) => new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
const haceHoras = (h) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

function prospectosFixture() {
  return [
    // Memo: prospecto en Por Cotizar, capturado hace varias horas.
    {
      id: 1, fecha: haceHoras(40), vendedor: 'Memo', celular: '+52 5512345678',
      nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp', etapa: 'por_cotizar',
      eventos: [], data: {},
    },
    // Ana: no debe verlo Memo.
    {
      id: 2, fecha: haceHoras(40), vendedor: 'Ana', celular: '+52 5599999999',
      nombre: 'Pedro', ciudad: 'CDMX', canal: 'WhatsApp', etapa: 'por_cotizar',
      eventos: [], data: {},
    },
  ];
}

function cotsFixture() {
  return [
    // Memo: cotizacion en seguimiento, cotizada hace 3 dias (paso dia2).
    {
      id: 10, fecha: hace(3), vendedor: 'Memo', cliente: 'RESTAURANTE LA LUPITA',
      totalPiezas: 200, total: 15000, tier: 'M100',
      data: { cliente: { razonSocial: 'RESTAURANTE LA LUPITA', rfc: 'RLU200101AAA', telefono: '5512345678' }, items: [] },
    },
    // Ana: no debe verla Memo.
    {
      id: 11, fecha: hace(8), vendedor: 'Ana', cliente: 'HOTEL AZUL',
      totalPiezas: 550, total: 40000, tier: 'M550',
      data: { cliente: { razonSocial: 'HOTEL AZUL', rfc: 'HAZ190101BBB', telefono: '5587654321' }, items: [] },
    },
  ];
}

let savedProspectos, savedCots, existiaProspectos;
before(() => {
  existiaProspectos = existsSync(PROSPECTOS_PATH);
  savedProspectos = readJson(PROSPECTOS_PATH);
  savedCots = readJson(COTS_PATH);
});
after(() => {
  if (existiaProspectos) writeJson(PROSPECTOS_PATH, savedProspectos);
  else if (existsSync(PROSPECTOS_PATH)) unlinkSync(PROSPECTOS_PATH);
  writeJson(COTS_PATH, savedCots);
});
beforeEach(() => {
  writeJson(PROSPECTOS_PATH, prospectosFixture());
  writeJson(COTS_PATH, cotsFixture());
});

test('GET /api/hoy fusiona prospectos y cotizaciones del vendedor en un solo listado', async () => {
  const res = await supertest(app).get('/api/hoy').set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(res.status, 200);
  const tipos = res.body.map(i => i.tipo).sort();
  assert.deepEqual(tipos, ['cotizacion', 'prospecto']);
  // Solo lo de Memo: 1 prospecto + 1 cotizacion.
  assert.equal(res.body.length, 2);
});

test('GET /api/hoy respeta la visibilidad: el vendedor solo ve lo suyo', async () => {
  const res = await supertest(app).get('/api/hoy').set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(res.status, 200);
  for (const item of res.body) {
    assert.equal(item.vendedor, 'Memo');
  }
});

test('GET /api/hoy como admin ve prospectos y cotizaciones de todos', async () => {
  const res = await supertest(app).get('/api/hoy').set('Authorization', `Bearer ${ADMIN_TOKEN}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 4); // 2 prospectos + 2 cotizaciones
});

test('GET /api/hoy viene ordenado por urgencia (cada item trae su urgencia)', async () => {
  const res = await supertest(app).get('/api/hoy').set('Authorization', `Bearer ${ADMIN_TOKEN}`);
  assert.equal(res.status, 200);
  for (let i = 1; i < res.body.length; i++) {
    const prev = res.body[i - 1];
    const cur = res.body[i];
    const prevKey = (prev.reunionVencida ? 1 : 0);
    const curKey = (cur.reunionVencida ? 1 : 0);
    assert.ok(prevKey > curKey || (prevKey === curKey && prev.urgencia >= cur.urgencia));
  }
});

test('GET /api/hoy sin token responde 401', async () => {
  const res = await supertest(app).get('/api/hoy');
  assert.equal(res.status, 401);
});
