// #400: la etiqueta "Ya tiene Cliente Operam, falta cotizar" (CONTEXT.md) la
// DERIVA el servidor, en las dos pantallas que la pintan: la lista de Prospectos
// (GET /api/prospectos) y la cola (GET /api/prospectos/cola, el mismo motor que
// GET /api/hoy). El navegador no la calcula -- necesitaria las cotizaciones que
// quien pregunta puede ver -- y por eso viaja ya juzgada en la fila.
//
// La visibilidad es la MISMA de GET /api/prospectos/tabla (#319): las
// cotizaciones se filtran por vendedor ANTES de ligarlas, asi que la senal nunca
// le cuenta a un vendedor de una cotizacion ajena.

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

function escribirFixtures(prospectos, cotizaciones = []) {
  writeJson(PROSPECTOS_PATH, prospectos);
  writeJson(COTS_PATH, cotizaciones);
}

function lista(token) {
  return supertest(app).get('/api/prospectos').set('Authorization', `Bearer ${token}`);
}

function cola(token) {
  return supertest(app).get('/api/prospectos/cola').set('Authorization', `Bearer ${token}`);
}

// Ningun test de este archivo pega a Operam: las dos rutas solo leen stores.
const originalFetch = globalThis.fetch;
const fetchBloqueado = async (url) => { throw new Error('fetch sin mock en tests: ' + url); };

let savedProspectos, savedCots, existiaProspectos;
before(() => {
  existiaProspectos = existsSync(PROSPECTOS_PATH);
  savedProspectos = readJson(PROSPECTOS_PATH);
  savedCots = readJson(COTS_PATH);
  globalThis.fetch = fetchBloqueado;
});
after(() => {
  if (existiaProspectos) writeJson(PROSPECTOS_PATH, savedProspectos);
  else if (existsSync(PROSPECTOS_PATH)) borrarArchivoSync(PROSPECTOS_PATH);
  writeJson(COTS_PATH, savedCots);
  globalThis.fetch = originalFetch;
});
beforeEach(() => {
  globalThis.fetch = fetchBloqueado;
  escribirFixtures([], []);
});

// El Contacto del caso: Cliente Operam 514 ligado, en Por Cotizar.
const LUPE = {
  id: 1, fecha: '2026-09-01T10:00:00.000Z', vendedor: 'Memo', celular: '+52 5512345678',
  celular10: '5512345678', nombre: 'Lupe', ciudad: 'Puebla', canal: 'WhatsApp',
  etapa: 'por_cotizar', eventos: [], data: { cliente_id: 514 },
};

function cotFixture(over = {}) {
  const { cliente: sobreCliente, ...resto } = over;
  return {
    id: 600, fecha: '2026-09-05T10:00:00.000Z', vendedor: 'Memo', cliente: 'LA LUPITA',
    total: 15000, totalPiezas: 200, tier: 'M100', estado: 'abierta', etapa: 'seguimiento',
    folioOperam: 1254, registroDesconocido: false, seguimientos: [],
    data: {
      cliente: {
        razonSocial: 'LA LUPITA', nombreCorto: 'La Lupita', rfc: 'XAXX010101000',
        telefono: '5512345678', celEntrega: '', customerId: 514, ...sobreCliente,
      },
    },
    ...resto,
  };
}

test('#400: el Contacto con Cliente Operam y sin cotizaciones sale con faltaCotizar en la lista y en la cola', async () => {
  escribirFixtures([LUPE], []);
  const enLista = await lista(MEMO_TOKEN);
  assert.equal(enLista.status, 200);
  assert.equal(enLista.body.find(p => p.nombre === 'Lupe').faltaCotizar, true);
  const enCola = await cola(MEMO_TOKEN);
  assert.equal(enCola.status, 200);
  assert.equal(enCola.body.find(i => i.nombre === 'Lupe').faltaCotizar, true);
});

test('#400: el Contacto que ya cotizo no sale con faltaCotizar, aunque siga ligado a su Cliente Operam', async () => {
  escribirFixtures([LUPE], [cotFixture()]);
  const enLista = await lista(MEMO_TOKEN);
  assert.equal(enLista.status, 200);
  const fila = enLista.body.find(p => p.nombre === 'Lupe');
  assert.equal(fila.faltaCotizar, false);
  assert.equal(fila.data.cliente_id, 514);
  const enCola = await cola(MEMO_TOKEN);
  assert.equal(enCola.status, 200);
  assert.equal(enCola.body.find(i => i.nombre === 'Lupe').faltaCotizar, false);
});

test('#400: el evento de cotizacion del Contacto tambien lo saca de faltaCotizar', async () => {
  const conEvento = {
    ...LUPE,
    eventos: [{ tipo: 'cotizacion', cotizacion_id: 600, fecha: '2026-09-05T10:00:00.000Z', vendedor: 'Memo' }],
  };
  escribirFixtures([conEvento], []);
  const enLista = await lista(MEMO_TOKEN);
  assert.equal(enLista.status, 200);
  assert.equal(enLista.body.find(p => p.nombre === 'Lupe').faltaCotizar, false);
});

test('#400: el Contacto sin Cliente Operam nunca sale con faltaCotizar', async () => {
  escribirFixtures([{ ...LUPE, data: {} }], []);
  const enLista = await lista(MEMO_TOKEN);
  assert.equal(enLista.status, 200);
  assert.equal(enLista.body.find(p => p.nombre === 'Lupe').faltaCotizar, false);
  const enCola = await cola(MEMO_TOKEN);
  assert.equal(enCola.status, 200);
  assert.equal(enCola.body.find(i => i.nombre === 'Lupe').faltaCotizar, false);
});

test('#400: la cotizacion de otro vendedor no le cuenta nada al vendedor que no la ve; el admin si la ve', async () => {
  escribirFixtures([LUPE], [cotFixture({ id: 601, vendedor: 'Ana' })]);
  const deMemo = await lista(MEMO_TOKEN);
  assert.equal(deMemo.status, 200);
  assert.equal(deMemo.body.find(p => p.nombre === 'Lupe').faltaCotizar, true);
  const colaDeMemo = await cola(MEMO_TOKEN);
  assert.equal(colaDeMemo.status, 200);
  assert.equal(colaDeMemo.body.find(i => i.nombre === 'Lupe').faltaCotizar, true);
  const deAdmin = await lista(ADMIN_TOKEN);
  assert.equal(deAdmin.status, 200);
  assert.equal(deAdmin.body.find(p => p.nombre === 'Lupe').faltaCotizar, false);
});

// GET /api/hoy es la otra puerta del mismo motor de cadencia: el juicio viaja
// igual, con las cotizaciones que ese vendedor ve.
function hoy(token) {
  return supertest(app).get('/api/hoy').set('Authorization', `Bearer ${token}`);
}

function itemProspecto(body, nombre) {
  return body.find(i => i.tipo === 'prospecto' && i.nombre === nombre);
}

test('#400: la cola Hoy trae la etiqueta del Contacto que todavia no cotiza', async () => {
  escribirFixtures([LUPE], []);
  const res = await hoy(MEMO_TOKEN);
  assert.equal(res.status, 200);
  assert.equal(itemProspecto(res.body, 'Lupe').faltaCotizar, true);
});

test('#400: en la cola Hoy el Contacto que ya cotizo no trae la etiqueta', async () => {
  escribirFixtures([LUPE], [cotFixture()]);
  const res = await hoy(MEMO_TOKEN);
  assert.equal(res.status, 200);
  assert.equal(itemProspecto(res.body, 'Lupe').faltaCotizar, false);
});

test('#400: en la cola Hoy la cotizacion ajena tampoco calla la etiqueta del que no la ve', async () => {
  escribirFixtures([LUPE], [cotFixture({ id: 602, vendedor: 'Ana' })]);
  const deMemo = await hoy(MEMO_TOKEN);
  assert.equal(deMemo.status, 200);
  assert.equal(itemProspecto(deMemo.body, 'Lupe').faltaCotizar, true);
  const deAdmin = await hoy(ADMIN_TOKEN);
  assert.equal(deAdmin.status, 200);
  assert.equal(itemProspecto(deAdmin.body, 'Lupe').faltaCotizar, false);
});
