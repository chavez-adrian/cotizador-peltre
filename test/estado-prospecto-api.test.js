// #457 (spec #398): el selector "Estado del prospecto" de la vista Prospectos
// filtra en el navegador, pero el Estado lo DERIVA el servidor (CONTEXT.md
// "Estado del prospecto"; la pantalla no lo calcula, igual que la Tabla de
// prospectos). Viaja en las dos puertas que alimentan la vista: la lista
// (GET /api/prospectos) y la cola "Que toca hoy" (GET /api/prospectos/cola),
// con la MISMA escalera y la MISMA visibilidad que GET /api/prospectos/tabla.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { escribirArchivoSync } from '../lib/fs-reintento.js';
import { fotoDatos, fijarDatos } from './helpers/datos-aislados.js';
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

function writeJson(p, data) { escribirArchivoSync(p, JSON.stringify(data, null, 2)); }

function escribirFixtures(prospectos, cotizaciones = []) {
  writeJson(PROSPECTOS_PATH, prospectos);
  writeJson(COTS_PATH, cotizaciones);
}

function get(ruta, token) {
  return supertest(app).get(ruta).set('Authorization', `Bearer ${token}`);
}

// Ningun test de este archivo pega a Operam: las rutas solo leen stores.
const originalFetch = globalThis.fetch;
const fetchBloqueado = async (url) => { throw new Error('fetch sin mock en tests: ' + url); };

let restaurarDatos;
before(() => {
  restaurarDatos = fotoDatos([PROSPECTOS_PATH, OPORTUNIDADES_PATH, COTS_PATH]);
  globalThis.fetch = fetchBloqueado;
});
after(() => {
  restaurarDatos();
  globalThis.fetch = originalFetch;
});
beforeEach(() => {
  globalThis.fetch = fetchBloqueado;
  fijarDatos(OPORTUNIDADES_PATH, []);
  escribirFixtures([], []);
});

const BASE = {
  fecha: '2026-09-01T10:00:00.000Z', vendedor: 'Memo', ciudad: 'Puebla', canal: 'WhatsApp',
  etapa: 'por_cotizar', eventos: [], data: {},
};
const SIN_CONTACTAR = { ...BASE, id: 1, nombre: 'Ana', celular: '+52 5511111111', celular10: '5511111111' };
const CONTACTADO = {
  ...BASE, id: 2, nombre: 'Beto', celular: '+52 5522222222', celular10: '5522222222',
  eventos: [{ tipo: 'toque', fecha: '2026-09-02T09:00:00.000Z', vendedor: 'Memo' }],
};
const CLIENTE = {
  ...BASE, id: 3, nombre: 'Lupe', celular: '+52 5533333333', celular10: '5533333333',
  data: { cliente_id: 514 },
};
const COTIZADO = {
  ...BASE, id: 4, nombre: 'Rosa', celular: '+52 5544444444', celular10: '5544444444',
};

function cotDe(celular, over = {}) {
  return {
    id: 600, fecha: '2026-09-05T10:00:00.000Z', vendedor: 'Memo', cliente: 'ROSA',
    total: 15000, totalPiezas: 200, tier: 'M100', estado: 'abierta', etapa: 'seguimiento',
    folioOperam: 1254, registroDesconocido: false, seguimientos: [],
    data: { cliente: { razonSocial: 'ROSA', rfc: 'XAXX010101000', telefono: celular, celEntrega: '' } },
    ...over,
  };
}

function estadosPorNombre(body) {
  return Object.fromEntries(body.map(p => [p.nombre, p.estado]));
}

test('#457: la lista de Prospectos trae el Estado del prospecto de cada fila', async () => {
  escribirFixtures([SIN_CONTACTAR, CONTACTADO, CLIENTE, COTIZADO], [cotDe('5544444444')]);
  const res = await get('/api/prospectos', MEMO_TOKEN);
  assert.equal(res.status, 200);
  assert.deepEqual(estadosPorNombre(res.body), {
    Ana: 'sin_contactar', Beto: 'contactado', Lupe: 'cliente', Rosa: 'cotizado',
  });
});

test('#457: la cola "Que toca hoy" trae el mismo Estado del prospecto', async () => {
  escribirFixtures([SIN_CONTACTAR, CONTACTADO, CLIENTE], []);
  const res = await get('/api/prospectos/cola', MEMO_TOKEN);
  assert.equal(res.status, 200);
  assert.deepEqual(estadosPorNombre(res.body), { Ana: 'sin_contactar', Beto: 'contactado', Lupe: 'cliente' });
});

test('#457: el Estado de la lista es el de la Tabla de prospectos, con la misma visibilidad', async () => {
  // La cotizacion de Ana la vendio otro: Memo no la ve y para el Ana no esta
  // cotizada; el admin si la ve.
  escribirFixtures([SIN_CONTACTAR, CONTACTADO], [cotDe('5511111111', { vendedor: 'Ana Maria' })]);
  for (const token of [MEMO_TOKEN, ADMIN_TOKEN]) {
    const lista = await get('/api/prospectos', token);
    const tabla = await get('/api/prospectos/tabla', token);
    assert.equal(lista.status, 200);
    assert.equal(tabla.status, 200);
    assert.deepEqual(estadosPorNombre(lista.body), estadosPorNombre(tabla.body));
  }
  const deMemo = await get('/api/prospectos', MEMO_TOKEN);
  assert.equal(estadosPorNombre(deMemo.body).Ana, 'sin_contactar');
  const deAdmin = await get('/api/prospectos', ADMIN_TOKEN);
  assert.equal(estadosPorNombre(deAdmin.body).Ana, 'cotizado');
});
