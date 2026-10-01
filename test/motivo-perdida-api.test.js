// #483 (CONTEXT.md "Perdida"; sugerencia de Alejandro 2026-09-28): cerrar una
// Oportunidad como Perdida pide un Motivo de Perdida de catalogo, igual que No
// util pide el suyo, para poder medir por que se pierde. Aplica a las rutas que
// cierran como Perdida -- la de la cotizacion (PATCH estado y resultado de la
// reunion) y la del prospecto (PATCH etapa) --: sin motivo, con uno fuera del
// catalogo o con Otro sin nota responden 400 y no escriben nada; con un motivo
// valido cierran y el motivo (y la nota) se leen en el tablero y el Historial.
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

// Jorge Orea: Contacto separado (#343) con la Oportunidad 101, de la que nacio la
// cotizacion 10, y la 102, que sigue en Por Cotizar sin cotizar.
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
const OP_POR_COTIZAR = {
  id: 102, fecha: hace(3), contactoId: 1, contacto10: '5555550001', vendedor: 'Memo', etapa: 'por_cotizar',
  eventos: [{ tipo: 'apertura', fecha: hace(3), vendedor: 'Memo' }], data: {},
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

function fijar(cot = COT_JORGE) {
  fijarDatos(PROSPECTOS_PATH, [JORGE]);
  fijarDatos(OPORTUNIDADES_PATH, [OP_DE_LA_COTIZACION, OP_POR_COTIZAR]);
  fijarDatos(COTS_PATH, [cot]);
}
beforeEach(() => fijar());

const perderCotizacion = (body) => supertest(app).patch('/api/cotizacion/10/estado')
  .set('Authorization', MEMO).send({ estado: 'perdida', ...body });
const tablero = () => supertest(app).get('/api/oportunidades').set('Authorization', MEMO);
const historial = () => supertest(app).get('/api/cotizaciones').set('Authorization', MEMO);

function assertNadaCambio(cot = COT_JORGE) {
  assert.deepEqual(readJson(COTS_PATH), [cot], 'la cotizacion no cambia');
  assert.deepEqual(readJson(OPORTUNIDADES_PATH), [OP_DE_LA_COTIZACION, OP_POR_COTIZAR], 'las Oportunidades no cambian');
}

const INVALIDOS = [
  ['sin motivo', {}, /motivo/i],
  ['con un motivo fuera del catalogo', { motivo: 'se fue con otro' }, /motivo/i],
  ['con un motivo de No util', { motivo: 'menudeo' }, /motivo/i],
  ['con Otro sin nota', { motivo: 'otro' }, /nota/i],
  ['con Otro y una nota en blanco', { motivo: 'otro', nota: '   ' }, /nota/i],
];

for (const [caso, body, error] of INVALIDOS) {
  test(`#483: PATCH estado a perdida ${caso} responde 400 y no escribe nada`, async () => {
    const res = await perderCotizacion(body);
    assert.equal(res.status, 400);
    assert.match(res.body.error, error);
    assertNadaCambio();
  });
}

test('#483: PATCH estado a perdida con motivo valido cierra la cotizacion y el Historial y el tablero lo muestran', async () => {
  const res = await perderCotizacion({ motivo: 'competencia' });
  assert.equal(res.status, 200);
  const cot = readJson(COTS_PATH)[0];
  assert.equal(cot.estado, 'perdida');
  assert.equal(cot.etapa, 'perdida');

  const fila = (await historial()).body.find(c => c.id === 10);
  assert.equal(fila.motivoPerdida, 'competencia');
  assert.equal(fila.notaPerdida, null);
  const tarjeta = (await tablero()).body.find(t => t.id === 'c10');
  assert.equal(tarjeta.motivoPerdida, 'competencia');
  assert.equal(tarjeta.notaPerdida, null);
});

test('#483: Otro con nota guarda las dos', async () => {
  const res = await perderCotizacion({ motivo: 'otro', nota: '  El cliente cerro su negocio  ' });
  assert.equal(res.status, 200);
  const fila = (await historial()).body.find(c => c.id === 10);
  assert.equal(fila.motivoPerdida, 'otro');
  assert.equal(fila.notaPerdida, 'El cliente cerro su negocio');
});

// #482 gana: con pedido la Oportunidad ya no se puede perder, traiga o no
// motivo; el texto que el vendedor necesita es ese, no el de elegir un motivo.
test('#483: con pedido el 409 de #482 gana sobre el 400 del motivo', async () => {
  const conPedido = { ...COT_JORGE, etapa: 'anticipo_pagado' };
  fijar(conPedido);
  const res = await perderCotizacion({});
  assert.equal(res.status, 409);
  assertNadaCambio(conPedido);
});

// Las Perdidas anteriores al catalogo no traen motivo: se siguen sirviendo, con
// el motivo en null, sin romper el Historial ni el tablero.
test('#483: una Perdida anterior sin motivo se sigue sirviendo con motivo null', async () => {
  fijar({
    ...COT_JORGE, estado: 'perdida', etapa: 'perdida',
    eventos: [{ tipo: 'etapa', de: 'seguimiento', a: 'perdida', fecha: hace(2), vendedor: 'Memo' }],
  });
  const h = await historial();
  assert.equal(h.status, 200);
  assert.equal(h.body.find(c => c.id === 10).motivoPerdida, null);
  const t = await tablero();
  assert.equal(t.status, 200);
  assert.equal(t.body.find(o => o.id === 'c10').motivoPerdida, null);
});

// #481 cierra tambien la Oportunidad de la que nacio la cotizacion ("mismo motivo
// si lo hay"): ahora que hay Motivo de Perdida, la Oportunidad lleva el MISMO
// motivo y la misma nota, y la vista de Cerradas los muestra en las dos.
test('#483: la Oportunidad que se cierra con la cotizacion (#481) lleva el mismo motivo y nota', async () => {
  const res = await perderCotizacion({ motivo: 'otro', nota: 'Compro en el extranjero' });
  assert.equal(res.status, 200);
  const tarjeta = (await tablero()).body.find(t => t.id === 'p101');
  assert.equal(tarjeta.etapa, 'perdida');
  assert.equal(tarjeta.motivoPerdida, 'otro');
  assert.equal(tarjeta.notaPerdida, 'Compro en el extranjero');
});

// La otra puerta de la cotizacion a Perdida: el resultado de la reunion vencida.
const conReunionVencida = {
  ...COT_JORGE, seguimientos: [{ tipo: 'reunion', fecha_reunion: hace(1), fecha: hace(2), vendedor: 'Memo' }],
};
const resultadoPerdida = (body) => supertest(app).post('/api/cotizacion/10/reunion-resultado')
  .set('Authorization', MEMO).send({ resultado: 'perdida', ...body });

for (const [caso, body, error] of INVALIDOS) {
  test(`#483: reunion-resultado perdida ${caso} responde 400 y no escribe nada`, async () => {
    fijar(conReunionVencida);
    const res = await resultadoPerdida(body);
    assert.equal(res.status, 400);
    assert.match(res.body.error, error);
    assertNadaCambio(conReunionVencida);
  });
}

test('#483: reunion-resultado perdida con motivo valido cierra y guarda el motivo', async () => {
  fijar(conReunionVencida);
  const res = await resultadoPerdida({ motivo: 'tiempo_produccion' });
  assert.equal(res.status, 200);
  assert.equal(readJson(COTS_PATH)[0].estado, 'perdida');
  assert.equal((await historial()).body.find(c => c.id === 10).motivoPerdida, 'tiempo_produccion');
  assert.equal((await tablero()).body.find(t => t.id === 'p101').motivoPerdida, 'tiempo_produccion');
});

test('#483: reunion-resultado con pedido: el 409 de #482 gana sobre el 400 del motivo', async () => {
  const conPedido = { ...conReunionVencida, etapa: 'saldo_pagado' };
  fijar(conPedido);
  const res = await resultadoPerdida({});
  assert.equal(res.status, 409);
  assertNadaCambio(conPedido);
});

// La ruta del prospecto: la Oportunidad que todavia no cotiza tambien se pierde
// con motivo (boton Perdida de su tarjeta en el tablero).
const perderProspecto = (body) => supertest(app).patch('/api/prospectos/102/etapa')
  .set('Authorization', MEMO).send({ etapa: 'perdida', ...body });

for (const [caso, body, error] of INVALIDOS) {
  test(`#483: PATCH etapa del prospecto a perdida ${caso} responde 400 y no escribe nada`, async () => {
    const res = await perderProspecto(body);
    assert.equal(res.status, 400);
    assert.match(res.body.error, error);
    assertNadaCambio();
  });
}

test('#483: PATCH etapa del prospecto a perdida con motivo valido la cierra y el tablero muestra motivo y nota', async () => {
  const res = await perderProspecto({ motivo: 'proyecto_pospuesto', nota: 'Retoman en enero' });
  assert.equal(res.status, 200);
  assert.equal(readJson(OPORTUNIDADES_PATH).find(o => o.id === 102).etapa, 'perdida');
  const tarjeta = (await tablero()).body.find(t => t.id === 'p102');
  assert.equal(tarjeta.etapa, 'perdida');
  assert.equal(tarjeta.motivoPerdida, 'proyecto_pospuesto');
  assert.equal(tarjeta.notaPerdida, 'Retoman en enero');
});

test('#483: una Oportunidad Perdida antes del catalogo sigue en el tablero con motivo null', async () => {
  fijarDatos(OPORTUNIDADES_PATH, [OP_DE_LA_COTIZACION, {
    ...OP_POR_COTIZAR, etapa: 'perdida',
    eventos: [...OP_POR_COTIZAR.eventos, { tipo: 'etapa', de: 'por_cotizar', a: 'perdida', fecha: hace(1), vendedor: 'Memo' }],
  }]);
  const res = await tablero();
  assert.equal(res.status, 200);
  const tarjeta = res.body.find(t => t.id === 'p102');
  assert.equal(tarjeta.etapa, 'perdida');
  assert.equal(tarjeta.motivoPerdida, null);
  assert.equal(tarjeta.notaPerdida, null);
});
