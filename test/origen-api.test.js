// Origen heredado en los GET que el navegador NO puede resolver solo (issue
// #287): el Historial carga cotizaciones sin prospectos y la cola Hoy llega ya
// fusionada del servidor, asi que la herencia (cotizacion -> prospecto del mismo
// celular) se resuelve en el mismo GET, sin ida extra. El pipeline, que si carga
// las dos listas, la resuelve en el navegador con el MISMO nucleo puro.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync, borrarArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { ultimos10 } from '../lib/telefono-llave.js';
import { llaveCelularOrigen, origenDe, indiceOrigenPorCelular } from '../public/js/origen-logica.js';

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
const MEMO_TOKEN = jwt.sign({ id: 7, name: 'Memo', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });

function readJson(p) { return existsSync(p) ? JSON.parse(leerArchivoSync(p)) : []; }
function writeJson(p, data) { escribirArchivoSync(p, JSON.stringify(data, null, 2)); }
const hace = (dias) => new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
const haceHoras = (h) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

function prospectosFixture() {
  return [
    {
      id: 1, fecha: haceHoras(40), vendedor: 'Memo', celular: '+52 55 1234 5678',
      nombre: 'Laura', ciudad: 'Puebla', canal: 'Instagram', etapa: 'por_cotizar',
      eventos: [], data: {},
    },
    // De otro vendedor: Memo no lo ve, asi que tampoco hereda su origen.
    {
      id: 2, fecha: haceHoras(40), vendedor: 'Ana', celular: '+52 5599999999',
      nombre: 'Pedro', ciudad: 'CDMX', canal: 'Feria/Expo', etapa: 'por_cotizar',
      eventos: [], data: {},
    },
  ];
}

function cotsFixture() {
  return [
    // Mismo celular que Laura, capturado en otro formato: hereda Instagram.
    {
      id: 10, fecha: hace(3), vendedor: 'Memo', cliente: 'LAURA SA',
      totalPiezas: 200, total: 15000, tier: 'M100',
      data: { cliente: { razonSocial: 'LAURA SA', telefono: '5512345678' }, items: [] },
    },
    // Sin prospecto ligado: origen vacio -> "Origen sin identificar" en la tarjeta.
    {
      id: 11, fecha: hace(3), vendedor: 'Memo', cliente: 'CLIENTE HISTORICO',
      totalPiezas: 50, total: 4000, tier: 'M100',
      data: { cliente: { razonSocial: 'CLIENTE HISTORICO', telefono: '5544443333' }, items: [] },
    },
    // Celular del prospecto de Ana: Memo no lo ve (Visibilidad, CONTEXT.md).
    {
      id: 12, fecha: hace(3), vendedor: 'Memo', cliente: 'AJENA SA',
      totalPiezas: 50, total: 4000, tier: 'M100',
      data: { cliente: { razonSocial: 'AJENA SA', telefono: '5599999999' }, items: [] },
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
  else if (existsSync(PROSPECTOS_PATH)) borrarArchivoSync(PROSPECTOS_PATH);
  writeJson(COTS_PATH, savedCots);
});
beforeEach(() => {
  writeJson(PROSPECTOS_PATH, prospectosFixture());
  writeJson(COTS_PATH, cotsFixture());
});

test('GET /api/cotizaciones anota el Origen heredado del prospecto del mismo celular', async () => {
  const res = await supertest(app).get('/api/cotizaciones').set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(res.status, 200);
  const porId = Object.fromEntries(res.body.map(c => [c.id, c.origen]));
  assert.equal(porId[10], 'Instagram');
  assert.equal(porId[11], '');
});

test('GET /api/cotizaciones no hereda de un prospecto que el vendedor no ve', async () => {
  const res = await supertest(app).get('/api/cotizaciones').set('Authorization', `Bearer ${MEMO_TOKEN}`);
  const cot = res.body.find(c => c.id === 12);
  assert.equal(cot.origen, '');
});

test('GET /api/hoy anota el Origen en las cotizaciones de la cola', async () => {
  const res = await supertest(app).get('/api/hoy').set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(res.status, 200);
  const cot = res.body.find(i => i.tipo === 'cotizacion' && i.id === 10);
  assert.ok(cot, 'la cotizacion 10 tiene que estar en la cola');
  assert.equal(cot.origen, 'Instagram');
  // El prospecto sigue trayendo su canal: la cola no lo pierde al anotar.
  const prospecto = res.body.find(i => i.tipo === 'prospecto');
  assert.equal(prospecto.canal, 'Instagram');
});

// La llave de identidad es una sola (CONTEXT.md): si la reexpresion browser-safe
// de origen-logica.js deriva de ultimos10, la herencia falla en silencio.
test('llaveCelularOrigen y ultimos10 son la MISMA llave', () => {
  const casos = [
    '+52 55 1234 5678', '5512345678', '525512345678', '5215512345678',
    '(55) 1234-5678', '55 5395 2615 ext 116', '5553952615,116', '', null,
  ];
  for (const caso of casos) assert.equal(llaveCelularOrigen(caso), ultimos10(caso), `llave distinta para ${caso}`);
});

test('el nucleo del servidor y el del navegador resuelven igual la misma herencia', () => {
  const indice = indiceOrigenPorCelular(prospectosFixture());
  assert.deepEqual(origenDe({ telefono: '5215512345678' }, indice), { origen: 'Instagram', identificado: true });
});
