// #481 (follow-up de #461, decision de Adrian 2026-09-30): perder una cotizacion
// cierra TAMBIEN la Oportunidad pre-cotizacion de la que nacio. Sin esto la
// cotizacion salia del tablero y su Oportunidad volvia a aparecer como tarjeta en
// Seguimiento, porque la regla de #340 / cotizacionesDeLaOportunidad solo la calla
// mientras la cotizacion sigue viva. Si el cliente vuelve, se abre una Nueva
// oportunidad (POST /api/oportunidades): reabrir la cotizacion no revive la
// anterior.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync } from '../lib/fs-reintento.js';
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
delete process.env.DATABASE_URL;

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');
const MEMO = `Bearer ${jwt.sign({ id: 7, name: 'Memo', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' })}`;

const readJson = (p) => (existsSync(p) ? JSON.parse(leerArchivoSync(p)) : []);
const hace = (dias) => new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

// Jorge Orea: Contacto ya separado (#343) con DOS Oportunidades -- la 101, de la
// que nacio la cotizacion 10, y la 102, que abrio despues con "Nueva
// oportunidad" y sigue en Por Cotizar.
const JORGE = {
  id: 1, fecha: hace(30), vendedor: 'Memo', celular: '+52 5555550001', celular10: '5555550001',
  nombre: 'Jorge Orea', ciudad: 'CDMX', canal: 'Feria/Expo', etapa: 'seguimiento', eventos: [], data: {},
};
const OP_DE_LA_COTIZACION = {
  id: 101, fecha: hace(20), contactoId: 1, contacto10: '5555550001', vendedor: 'Memo', etapa: 'seguimiento',
  eventos: [
    { tipo: 'apertura', fecha: hace(20), vendedor: 'Memo' },
    { tipo: 'cotizacion', cotizacion_id: 10, de: 'por_cotizar', fecha: hace(19), vendedor: 'Memo' },
  ],
  data: {},
};
const OTRA_OP_DE_JORGE = {
  id: 102, fecha: hace(3), contactoId: 1, contacto10: '5555550001', vendedor: 'Memo', etapa: 'por_cotizar',
  eventos: [{ tipo: 'apertura', fecha: hace(3), vendedor: 'Memo' }], data: {},
};
const COT_JORGE = {
  id: 10, fecha: hace(19), vendedor: 'Memo', cliente: 'JORGE OREA', etapa: 'seguimiento',
  totalPiezas: 200, total: 15000, tier: 'M100', folioOperam: 1240, contactoCelular: '5555550001',
  eventos: [], seguimientos: [],
  data: { cliente: { razonSocial: 'JORGE OREA', telefono: '+52 5555550001' }, items: [] },
};

let restaurar;
before(() => { restaurar = fotoDatos([PROSPECTOS_PATH, OPORTUNIDADES_PATH, COTS_PATH]); });
after(() => restaurar());
beforeEach(() => {
  fijarDatos(PROSPECTOS_PATH, [JORGE]);
  fijarDatos(OPORTUNIDADES_PATH, [OP_DE_LA_COTIZACION, OTRA_OP_DE_JORGE]);
  fijarDatos(COTS_PATH, [COT_JORGE]);
});

const perder = (id) => supertest(app).patch(`/api/cotizacion/${id}/estado`)
  .set('Authorization', MEMO).send({ estado: 'perdida', motivo: 'precio' });
const tablero = () => supertest(app).get('/api/oportunidades').set('Authorization', MEMO);

test('#481: perder la cotizacion cierra como Perdida la Oportunidad de la que nacio', async () => {
  const antes = await tablero();
  assert.equal(antes.body.some(t => t.id === 'p101'), false, 'con la cotizacion viva su Oportunidad no tiene tarjeta');

  const res = await perder(10);
  assert.equal(res.status, 200);

  const despues = await tablero();
  const tarjeta = despues.body.find(t => t.id === 'p101');
  assert.ok(tarjeta, 'la Oportunidad tiene tarjeta en el tablero');
  assert.equal(tarjeta.etapa, 'perdida');
  assert.equal(readJson(OPORTUNIDADES_PATH).find(o => o.id === 101).etapa, 'perdida');
});

test('#481: otra Oportunidad del mismo Contacto sigue igual', async () => {
  await perder(10);
  const otra = readJson(OPORTUNIDADES_PATH).find(o => o.id === 102);
  assert.deepEqual(otra, OTRA_OP_DE_JORGE);
  const tarjeta = (await tablero()).body.find(t => t.id === 'p102');
  assert.equal(tarjeta.etapa, 'por_cotizar');
});

// Antes de la migracion de #343 el Contacto ES su propia Oportunidad: se cierra
// su fila de prospectos, que es donde esa Oportunidad vive.
test('#481: con el Contacto todavia sin separar, se cierra la fila del Contacto', async () => {
  const laura = {
    id: 5, fecha: hace(10), vendedor: 'Memo', celular: '+52 5512345678', celular10: '5512345678',
    nombre: 'Laura', ciudad: 'Puebla', canal: 'Instagram', etapa: 'seguimiento',
    eventos: [{ tipo: 'cotizacion', cotizacion_id: 11, de: 'por_cotizar', fecha: hace(9), vendedor: 'Memo' }],
    data: {},
  };
  const cotLaura = {
    ...COT_JORGE, id: 11, cliente: 'LAURA', contactoCelular: '5512345678',
    data: { cliente: { razonSocial: 'LAURA', telefono: '+52 5512345678' }, items: [] },
  };
  fijarDatos(PROSPECTOS_PATH, [JORGE, laura]);
  fijarDatos(COTS_PATH, [COT_JORGE, cotLaura]);

  const res = await perder(11);
  assert.equal(res.status, 200);
  assert.equal(readJson(PROSPECTOS_PATH).find(p => p.id === 5).etapa, 'perdida');
  assert.equal((await tablero()).body.find(t => t.id === 'p5').etapa, 'perdida');
  assert.equal(readJson(OPORTUNIDADES_PATH).find(o => o.id === 101).etapa, 'seguimiento');
});

test('#481: cotizacion SIN Oportunidad de origen -- perder se comporta como antes', async () => {
  const cotSuelta = {
    ...COT_JORGE, id: 12, cliente: 'RESTAURANTE SIN PROSPECTO', contactoCelular: '5587654321',
    data: { cliente: { razonSocial: 'RESTAURANTE SIN PROSPECTO', telefono: '+52 5587654321' }, items: [] },
  };
  fijarDatos(COTS_PATH, [COT_JORGE, cotSuelta]);
  const prospectosAntes = leerArchivoSync(PROSPECTOS_PATH);
  const oportunidadesAntes = leerArchivoSync(OPORTUNIDADES_PATH);

  const res = await perder(12);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, estado: 'perdida' });
  const cot = readJson(COTS_PATH).find(c => c.id === 12);
  assert.equal(cot.estado, 'perdida');
  assert.equal(cot.etapa, 'perdida');
  assert.equal(leerArchivoSync(PROSPECTOS_PATH), prospectosAntes);
  assert.equal(leerArchivoSync(OPORTUNIDADES_PATH), oportunidadesAntes);
});

// Una Oportunidad puede llevar dos cotizaciones (el segundo evento cae en la
// misma cuando no hay otra que avance, oportunidadQueCotiza). Mientras la otra
// siga viva la tarjeta no reaparece, y esa otra todavia puede llegar a pedido:
// Perdida es solo para la Oportunidad que no llego (CONTEXT.md "Perdida").
test('#481: si la Oportunidad conserva otra cotizacion viva, no se cierra', async () => {
  const segunda = { ...COT_JORGE, id: 13, fecha: hace(5), folioOperam: 1290 };
  fijarDatos(OPORTUNIDADES_PATH, [{
    ...OP_DE_LA_COTIZACION,
    eventos: [...OP_DE_LA_COTIZACION.eventos,
      { tipo: 'cotizacion', cotizacion_id: 13, de: 'seguimiento', fecha: hace(5), vendedor: 'Memo' }],
  }, OTRA_OP_DE_JORGE]);
  fijarDatos(COTS_PATH, [COT_JORGE, segunda]);

  await perder(10);
  assert.equal(readJson(OPORTUNIDADES_PATH).find(o => o.id === 101).etapa, 'seguimiento');

  await perder(13);
  assert.equal(readJson(OPORTUNIDADES_PATH).find(o => o.id === 101).etapa, 'perdida');
});

// El Contacto que nacio sin captura (#342) no es una Oportunidad: existe para
// que la cotizacion tenga de quien ser. Perder esa cotizacion lo deja como
// estaba, igual que a cualquier cotizacion sin Oportunidad de origen.
test('#481: el Contacto sin captura de la cotizacion no se toca', async () => {
  const sinCaptura = {
    id: 6, fecha: hace(10), vendedor: 'Memo', celular: '5587654321', celular10: '5587654321',
    nombre: 'Restaurante', ciudad: '', canal: '', etapa: 'seguimiento', eventos: [],
    data: { sinCaptura: true, fuenteContacto: 'captura_manual' },
  };
  const cot = {
    ...COT_JORGE, id: 14, cliente: 'RESTAURANTE', contactoCelular: '5587654321',
    data: { cliente: { razonSocial: 'RESTAURANTE', telefono: '+52 5587654321' }, items: [] },
  };
  fijarDatos(PROSPECTOS_PATH, [JORGE, sinCaptura]);
  fijarDatos(COTS_PATH, [COT_JORGE, cot]);

  const res = await perder(14);
  assert.equal(res.status, 200);
  assert.deepEqual(readJson(PROSPECTOS_PATH).find(p => p.id === 6), sinCaptura);
});

// Una Oportunidad que ya salio del embudo (No util o Perdida) no se vuelve a
// cerrar: ni cambia de salida ni gana otro evento.
test('#481: una Oportunidad que ya salio del embudo queda como estaba', async () => {
  const yaPerdida = {
    ...OP_DE_LA_COTIZACION, etapa: 'perdida',
    eventos: [...OP_DE_LA_COTIZACION.eventos,
      { tipo: 'etapa', de: 'seguimiento', a: 'perdida', fecha: hace(2), vendedor: 'Memo' }],
  };
  fijarDatos(OPORTUNIDADES_PATH, [yaPerdida, OTRA_OP_DE_JORGE]);

  await perder(10);
  assert.deepEqual(readJson(OPORTUNIDADES_PATH).find(o => o.id === 101), yaPerdida);
});

// Decision de Adrian (2026-09-30): si el cliente vuelve, se abre una Nueva
// oportunidad; reabrir la cotizacion no revive la que se cerro con ella.
test('#481: reabrir la cotizacion no revive su Oportunidad', async () => {
  await perder(10);
  const res = await supertest(app).patch('/api/cotizacion/10/estado')
    .set('Authorization', MEMO).send({ estado: 'abierta' });
  assert.equal(res.status, 200);
  assert.equal(readJson(COTS_PATH).find(c => c.id === 10).etapa, 'seguimiento');
  assert.equal(readJson(OPORTUNIDADES_PATH).find(o => o.id === 101).etapa, 'perdida');
});

// La otra puerta a Perdida de una cotizacion (#461) pasa por el mismo cierre.
test('#481: perder desde el resultado de la reunion tambien cierra la Oportunidad', async () => {
  fijarDatos(COTS_PATH, [{
    ...COT_JORGE, seguimientos: [{ tipo: 'reunion', fecha_reunion: hace(1), fecha: hace(2), vendedor: 'Memo' }],
  }]);
  const res = await supertest(app).post('/api/cotizacion/10/reunion-resultado')
    .set('Authorization', MEMO).send({ resultado: 'perdida', motivo: 'precio' });
  assert.equal(res.status, 200);
  assert.equal(readJson(OPORTUNIDADES_PATH).find(o => o.id === 101).etapa, 'perdida');
});
