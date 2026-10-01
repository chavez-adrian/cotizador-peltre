// #484 (CONTEXT.md "Cancelada", decision de Adrian 2026-09-28): la Oportunidad
// que si llego a pedido y despues se cayo (el Contacto pago y se echo para
// atras) sale del tablero como Cancelada. Es la unica salida posible con pedido,
// solo la decide el admin y lleva motivo en texto libre obligatorio. No cancela
// nada en Operam: solo saca la tarjeta del tablero. Viaja por la ruta que ya
// cierra una cotizacion (PATCH /api/cotizacion/:id/estado), como Perdida.
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
const ADRIAN = `Bearer ${jwt.sign({ id: 1, name: 'Adrian', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' })}`;

const readJson = (p) => (existsSync(p) ? JSON.parse(leerArchivoSync(p)) : []);
const hace = (dias) => new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

const JORGE = {
  id: 1, fecha: hace(30), vendedor: 'Memo', celular: '+52 5555550001', celular10: '5555550001',
  nombre: 'Jorge Orea', ciudad: 'CDMX', canal: 'Feria/Expo', etapa: 'seguimiento', eventos: [], data: {},
};
// La Oportunidad pre-cotizacion de la que nacio la cotizacion: callada en el
// tablero mientras su cotizacion siga viva (#343).
const OP_DE_LA_COTIZACION = {
  id: 101, fecha: hace(20), contactoId: 1, contacto10: '5555550001', vendedor: 'Memo', etapa: 'seguimiento',
  eventos: [
    { tipo: 'apertura', fecha: hace(20), vendedor: 'Memo' },
    { tipo: 'cotizacion', cotizacion_id: 10, de: 'por_cotizar', fecha: hace(19), vendedor: 'Memo' },
  ],
  data: {},
};
// Pago el anticipo: la cotizacion ya tiene pedido (#482).
const COT_CON_PEDIDO = {
  id: 10, fecha: hace(19), vendedor: 'Memo', cliente: 'JORGE OREA', etapa: 'anticipo_pagado', estado: 'abierta',
  totalPiezas: 200, total: 15000, tier: 'M100', folioOperam: 1240, contactoCelular: '5555550001',
  eventos: [], seguimientos: [],
  data: {
    cliente: { razonSocial: 'JORGE OREA', telefono: '+52 5555550001' }, items: [],
    espejoOperam: { cotizacion: '1240', pedido: '873', remisiones: [] },
  },
};

let restaurar;
before(() => { restaurar = fotoDatos([PROSPECTOS_PATH, OPORTUNIDADES_PATH, COTS_PATH]); });
after(() => restaurar());

function fijar(cot) {
  fijarDatos(PROSPECTOS_PATH, [JORGE]);
  fijarDatos(OPORTUNIDADES_PATH, [OP_DE_LA_COTIZACION]);
  fijarDatos(COTS_PATH, [cot]);
}
beforeEach(() => fijar(COT_CON_PEDIDO));

const cancelar = (quien, cuerpo) => supertest(app).patch('/api/cotizacion/10/estado')
  .set('Authorization', quien).send({ estado: 'cancelada', ...cuerpo });

const MOTIVO = 'Pago el anticipo y se echo para atras: ya no quiere la vajilla';

test('#484: el admin cierra como Cancelada una Oportunidad con pedido; la cotizacion y su Oportunidad salen del tablero activo', async () => {
  const res = await cancelar(ADRIAN, { motivo: `  ${MOTIVO}  ` });
  assert.equal(res.status, 200);

  const cot = readJson(COTS_PATH).find(c => c.id === 10);
  assert.equal(cot.estado, 'cancelada');
  assert.equal(cot.etapa, 'cancelada');
  const cierre = cot.eventos.at(-1);
  assert.equal(cierre.tipo, 'etapa');
  assert.equal(cierre.de, 'anticipo_pagado');
  assert.equal(cierre.a, 'cancelada');
  assert.equal(cierre.motivo, MOTIVO);
  assert.equal(cierre.vendedor, 'Adrian');

  // La Oportunidad de origen no reaparece en Seguimiento: se cierra igual.
  const op = readJson(OPORTUNIDADES_PATH).find(o => o.id === 101);
  assert.equal(op.etapa, 'cancelada');
  assert.equal(op.eventos.at(-1).motivo, MOTIVO);

  const tarjetas = (await supertest(app).get('/api/oportunidades').set('Authorization', ADRIAN)).body;
  const activas = tarjetas.filter(t => !['no_util', 'perdida', 'cancelada'].includes(t.etapa));
  assert.deepEqual(activas, [], 'ninguna tarjeta queda en el tablero activo');
  const tarjeta = tarjetas.find(t => t.tipo === 'cotizacion' && t.refId === 10);
  assert.equal(tarjeta.etapa, 'cancelada');
  assert.equal(tarjeta.motivoCancelada, MOTIVO);

  const fila = (await supertest(app).get('/api/cotizaciones').set('Authorization', ADRIAN)).body.find(c => c.id === 10);
  assert.equal(fila.estado, 'cancelada');
  assert.equal(fila.motivoCancelada, MOTIVO);
});

function assertNadaCambio(cot) {
  assert.deepEqual(readJson(COTS_PATH), [cot], 'la cotizacion no cambia');
  assert.deepEqual(readJson(OPORTUNIDADES_PATH), [OP_DE_LA_COTIZACION], 'la Oportunidad de la que nacio no cambia');
}

for (const [caso, cuerpo] of [['sin motivo', {}], ['motivo vacio', { motivo: '' }], ['motivo solo espacios', { motivo: '   \n ' }]]) {
  test(`#484: ${caso} responde 400 pidiendo el motivo y no cambia nada`, async () => {
    const res = await cancelar(ADRIAN, cuerpo);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /motivo de la cancelaci/);
    assertNadaCambio(COT_CON_PEDIDO);
  });
}

test('#484: el vendedor duenio de la cotizacion que intenta Cancelada recibe 403 y no cambia nada', async () => {
  const res = await cancelar(MEMO, { motivo: MOTIVO });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /Solo el administrador/);
  assertNadaCambio(COT_CON_PEDIDO);
});

test('#484: sobre una Oportunidad SIN pedido Cancelada se rechaza (esa es Perdida) y no cambia nada', async () => {
  const sinPedido = { ...COT_CON_PEDIDO, etapa: 'seguimiento', data: { ...COT_CON_PEDIDO.data, espejoOperam: null } };
  fijar(sinPedido);
  const res = await cancelar(ADRIAN, { motivo: MOTIVO });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /no tiene pedido en Operam/);
  assert.match(res.body.error, /Perdida/);
  assertNadaCambio(sinPedido);
});

// La decorada con pedido que el candado de calca retiene en Seguimiento tambien
// "tiene pedido" (#482): se puede cancelar.
test('#484: en Seguimiento con pedido en el espejo de Operam el admin si puede cancelar', async () => {
  fijar({ ...COT_CON_PEDIDO, etapa: 'seguimiento', data: { ...COT_CON_PEDIDO.data, decorado: true } });
  const res = await cancelar(ADRIAN, { motivo: MOTIVO });
  assert.equal(res.status, 200);
  const cot = readJson(COTS_PATH).find(c => c.id === 10);
  assert.equal(cot.etapa, 'cancelada');
  assert.equal(cot.eventos.at(-1).de, 'seguimiento');
});

test('#484: la Perdida con pedido le dice al vendedor que el administrador la cierra como Cancelada', async () => {
  const res = await supertest(app).patch('/api/cotizacion/10/estado')
    .set('Authorization', MEMO).send({ estado: 'perdida', motivo: 'precio' });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /avisa al administrador para que la cierre como Cancelada/);
  assertNadaCambio(COT_CON_PEDIDO);
});

// Una Cancelada ya llego a pedido (CONTEXT.md "Cancelada") aunque su espejo de
// Operam no exista (el sync solo lo persiste con binding preciso): el vendedor
// no la puede convertir en Perdida, que es solo sin pedido.
test('#484: el vendedor no puede cerrar como Perdida una Cancelada, aunque no tenga espejo de Operam', async () => {
  const cancelada = {
    ...COT_CON_PEDIDO, etapa: 'cancelada', estado: 'cancelada',
    eventos: [{ tipo: 'etapa', de: 'anticipo_pagado', a: 'cancelada', motivo: MOTIVO, fecha: hace(1), vendedor: 'Adrian' }],
    data: { ...COT_CON_PEDIDO.data, espejoOperam: null },
  };
  fijar(cancelada);
  const res = await supertest(app).patch('/api/cotizacion/10/estado')
    .set('Authorization', MEMO).send({ estado: 'perdida', motivo: 'precio' });
  assert.equal(res.status, 409);
  assertNadaCambio(cancelada);
});

// Una Cancelada ya salio del tablero: ninguna ruta de estado la mueve, ni el
// vendedor duenio ni el admin (reabrirla no esta en el alcance). Sin la guarda,
// el estado cambiaba y la etapa se quedaba en cancelada: una fila incoherente.
const COT_CANCELADA = {
  ...COT_CON_PEDIDO, estado: 'cancelada', etapa: 'cancelada',
  eventos: [{ tipo: 'etapa', de: 'anticipo_pagado', a: 'cancelada', motivo: MOTIVO, fecha: hace(2), vendedor: 'Adrian' }],
};

for (const estado of ['abierta', 'ganada', 'descartada', 'perdida']) {
  for (const [quien, token] of [['el vendedor duenio', MEMO], ['el admin', ADRIAN]]) {
    test(`#484: ${quien} no cambia una Cancelada a ${estado}: 409 y no cambia nada`, async () => {
      fijar(COT_CANCELADA);
      const res = await supertest(app).patch('/api/cotizacion/10/estado')
        .set('Authorization', token).send({ estado, motivo: 'precio', nota: 'x' });
      assert.equal(res.status, 409);
      assert.match(res.body.error, /ya est\u00e1 Cancelada/);
      assert.match(res.body.error, /Nueva oportunidad/);
      assertNadaCambio(COT_CANCELADA);
    });
  }
}

test('#484: el resultado de una reunion no mueve una Cancelada: 409 y no cambia nada', async () => {
  const conReunion = { ...COT_CANCELADA, seguimientos: [{ tipo: 'reunion', fecha_reunion: hace(1), fecha: hace(3), vendedor: 'Memo' }] };
  fijar(conReunion);
  for (const resultado of ['avance', 'perdida']) {
    const res = await supertest(app).post('/api/cotizacion/10/reunion-resultado')
      .set('Authorization', MEMO).send({ resultado, motivo: 'precio' });
    assert.equal(res.status, 409, resultado);
    assert.match(res.body.error, /ya est\u00e1 Cancelada/);
    assertNadaCambio(conReunion);
  }
});
