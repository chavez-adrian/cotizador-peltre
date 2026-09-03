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

function readJson(p) { return existsSync(p) ? JSON.parse(leerArchivoSync(p)) : []; }
function writeJson(p, data) { escribirArchivoSync(p, JSON.stringify(data, null, 2)); }

// Los dos stores que alimentan la fila. Cada ticket de la Tabla de prospectos
// escribe sus propios fixtures con este helper en vez de tocar los ajenos.
function escribirFixtures(prospectos, cotizaciones = []) {
  writeJson(PROSPECTOS_PATH, prospectos);
  writeJson(COTS_PATH, cotizaciones);
}

function tabla(token) {
  const req = supertest(app).get('/api/prospectos/tabla');
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
}

let savedProspectos, savedCots, existiaProspectos;
before(() => {
  existiaProspectos = existsSync(PROSPECTOS_PATH);
  savedProspectos = readJson(PROSPECTOS_PATH);
  savedCots = readJson(COTS_PATH);
});
after(() => {
  if (existiaProspectos) writeJson(PROSPECTOS_PATH, savedProspectos);
  else if (existsSync(PROSPECTOS_PATH)) borrarArchivoSync(PROSPECTOS_PATH);
  writeJson(COTS_PATH, savedCots);
});
beforeEach(() => {
  escribirFixtures([], []);
});

// --- #313: quien ya fue contactado ---

const LAURA = {
  id: 1, fecha: '2026-09-01T10:00:00.000Z', vendedor: 'Memo', celular: '+52 5512345678',
  celular10: '5512345678', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp',
  etapa: 'por_cotizar', eventos: [], data: {},
};
const PEDRO = {
  id: 2, fecha: '2026-09-01T11:00:00.000Z', vendedor: 'Ana', celular: '+52 5599999999',
  celular10: '5599999999', nombre: 'Pedro', ciudad: 'CDMX', canal: 'Instagram',
  etapa: 'por_cotizar', eventos: [], data: {},
};
const SOFIA = {
  id: 3, fecha: '2026-08-20T10:00:00.000Z', vendedor: 'Memo', celular: '+52 5544332211',
  celular10: '5544332211', nombre: 'Sofía', ciudad: 'Toluca', canal: 'WhatsApp',
  etapa: 'por_cotizar',
  eventos: [
    { tipo: 'toque', fecha: '2026-09-02T09:00:00.000Z', vendedor: 'Memo' },
    { tipo: 'toque', fecha: '2026-08-28T18:30:00.000Z', vendedor: 'Memo' },
  ],
  data: {},
};

test('#313: GET /api/prospectos/tabla sin token responde 401', async () => {
  escribirFixtures([LAURA]);
  const res = await tabla(null);
  assert.equal(res.status, 401);
});

test('#313: el vendedor solo ve sus prospectos en la tabla', async () => {
  escribirFixtures([LAURA, PEDRO, SOFIA]);
  const res = await tabla(MEMO_TOKEN);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map(f => f.nombre).sort(), ['Laura', 'Sofía']);
});

test('#313: el admin ve la tabla de todos los vendedores', async () => {
  escribirFixtures([LAURA, PEDRO, SOFIA]);
  const res = await tabla(ADMIN_TOKEN);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map(f => f.nombre).sort(), ['Laura', 'Pedro', 'Sofía']);
});

test('#313: la fila de un prospecto sin toques dice sin contactar', async () => {
  escribirFixtures([LAURA]);
  const res = await tabla(MEMO_TOKEN);
  assert.equal(res.status, 200);
  const fila = res.body.find(f => f.nombre === 'Laura');
  assert.equal(fila.estado, 'sin_contactar');
  assert.equal(fila.ultimoContacto, null);
  assert.equal(fila.toques, 0);
});

test('#313: la fila de un prospecto con toques trae el mas reciente como ultimo contacto', async () => {
  escribirFixtures([SOFIA]);
  const res = await tabla(MEMO_TOKEN);
  assert.equal(res.status, 200);
  const fila = res.body.find(f => f.nombre === 'Sofía');
  assert.equal(fila.estado, 'contactado');
  assert.equal(fila.ultimoContacto, '2026-09-02T09:00:00.000Z');
  assert.equal(fila.toques, 2);
});

// --- #316: gafete ---

test('#316: la fila trae gafete solo_gafete para un prospecto solo escaneado', async () => {
  const escaneada = { ...LAURA, data: { escaneado: '2026-09-01' } };
  escribirFixtures([escaneada]);
  const res = await tabla(MEMO_TOKEN);
  assert.equal(res.status, 200);
  const fila = res.body.find(f => f.nombre === 'Laura');
  assert.equal(fila.gafete, 'solo_gafete');
});
