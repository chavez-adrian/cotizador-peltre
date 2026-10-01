// #482 (CONTEXT.md "Perdida", decision 2026-09-28 a sugerencia de Alejandro):
// una Oportunidad que ya tiene pedido en Operam ya se cerro y no se puede perder.
// "Tiene pedido" = etapa post-venta (Anticipo pagado o posterior) O el espejo de
// Operam de la cotizacion ya trae pedido (la decorada que el candado de calca
// retiene en Seguimiento). El servidor la rechaza aunque llegue a mano, por las
// dos rutas que cierran una cotizacion como Perdida, y no cambia nada: ni la
// cotizacion ni la Oportunidad de la que nacio (#481).
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
const COT_JORGE = {
  id: 10, fecha: hace(19), vendedor: 'Memo', cliente: 'JORGE OREA', etapa: 'seguimiento', estado: 'abierta',
  totalPiezas: 200, total: 15000, tier: 'M100', folioOperam: 1240, contactoCelular: '5555550001',
  eventos: [], seguimientos: [],
  data: { cliente: { razonSocial: 'JORGE OREA', telefono: '+52 5555550001' }, items: [] },
};

let restaurar;
before(() => { restaurar = fotoDatos([PROSPECTOS_PATH, OPORTUNIDADES_PATH, COTS_PATH]); });
after(() => restaurar());

function fijar(cot) {
  fijarDatos(PROSPECTOS_PATH, [JORGE]);
  fijarDatos(OPORTUNIDADES_PATH, [OP_DE_LA_COTIZACION]);
  fijarDatos(COTS_PATH, [cot]);
}
beforeEach(() => fijar(COT_JORGE));

const perder = (id) => supertest(app).patch(`/api/cotizacion/${id}/estado`)
  .set('Authorization', MEMO).send({ estado: 'perdida', motivo: 'precio' });

function assertNadaCambio(cot) {
  assert.deepEqual(readJson(COTS_PATH), [cot], 'la cotizacion no cambia');
  assert.deepEqual(readJson(OPORTUNIDADES_PATH), [OP_DE_LA_COTIZACION], 'la Oportunidad de la que nacio no cambia');
}

for (const etapa of ['anticipo_pagado', 'pedido_liberado', 'saldo_pagado', 'producto_entregado']) {
  test(`#482: en ${etapa} el PATCH de estado a perdida responde 409 con texto accionable y no cambia nada`, async () => {
    const cot = { ...COT_JORGE, etapa };
    fijar(cot);
    const res = await perder(10);
    assert.equal(res.status, 409);
    assert.match(res.body.error, /ya tiene pedido en Operam/);
    assert.match(res.body.error, /avisa al administrador/);
    assertNadaCambio(cot);
  });
}

// La decorada con pedido, sin pago y con el checklist de calca incompleto: el
// candado de calca (#61) la retiene en Seguimiento, pero el espejo ya trae pedido.
test('#482: en Seguimiento con pedido en el espejo de Operam tambien responde 409 y no cambia nada', async () => {
  const cot = {
    ...COT_JORGE,
    data: {
      ...COT_JORGE.data, decorado: true,
      espejoOperam: { cotizacion: '1240', pedido: '873', remisiones: [] },
    },
  };
  fijar(cot);
  const res = await perder(10);
  assert.equal(res.status, 409);
  assert.match(res.body.error, /ya tiene pedido en Operam/);
  assertNadaCambio(cot);
});

test('#482: en Seguimiento sin pedido Perdida sigue funcionando como hoy', async () => {
  const res = await perder(10);
  assert.equal(res.status, 200);
  const cot = readJson(COTS_PATH).find(c => c.id === 10);
  assert.equal(cot.estado, 'perdida');
  assert.equal(cot.etapa, 'perdida');
  assert.equal(readJson(OPORTUNIDADES_PATH).find(o => o.id === 101).etapa, 'perdida');
});

// El resultado de una reunion vencida es el otro camino del servidor que cierra
// una cotizacion como Perdida.
const REUNION_VENCIDA = [{ tipo: 'reunion', fecha_reunion: hace(1), fecha: hace(3), vendedor: 'Memo' }];

test('#482: el resultado Perdida de una reunion vencida con pedido responde 409 y no cambia nada', async () => {
  const cot = { ...COT_JORGE, etapa: 'anticipo_pagado', seguimientos: REUNION_VENCIDA };
  fijar(cot);
  const res = await supertest(app).post('/api/cotizacion/10/reunion-resultado')
    .set('Authorization', MEMO).send({ resultado: 'perdida', motivo: 'precio' });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /ya tiene pedido en Operam/);
  assertNadaCambio(cot);
});

test('#482: el resultado Perdida de una reunion vencida sin pedido sigue cerrando', async () => {
  fijar({ ...COT_JORGE, seguimientos: REUNION_VENCIDA });
  const res = await supertest(app).post('/api/cotizacion/10/reunion-resultado')
    .set('Authorization', MEMO).send({ resultado: 'perdida', motivo: 'precio' });
  assert.equal(res.status, 200);
  assert.equal(readJson(COTS_PATH).find(c => c.id === 10).estado, 'perdida');
});
