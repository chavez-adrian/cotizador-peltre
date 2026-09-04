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

// --- #314: agendado ---
// El compromiso va con fecha PASADA y sin ningun toque que lo cierre: la ruta
// usa el reloj real, y un compromiso vencido y abierto sigue siendo Agendado
// corra el test hoy o dentro de un ano (una fecha futura caducaria).

const CARMEN = {
  id: 10, fecha: '2026-08-20T10:00:00.000Z', vendedor: 'Memo', celular: '+52 5511223344',
  celular10: '5511223344', nombre: 'Carmen', ciudad: 'Morelia', canal: 'WhatsApp',
  etapa: 'por_cotizar',
  eventos: [
    { tipo: 'toque', fecha: '2026-08-21T09:00:00.000Z', vendedor: 'Memo' },
    {
      tipo: 'siguiente_contacto', canales: ['WhatsApp'], fecha_contacto: '2026-08-25T17:00:00.000Z',
      fecha: '2026-08-21T09:05:00.000Z', vendedor: 'Memo',
    },
  ],
  data: {},
};

test('#314: la fila de un prospecto con siguiente contacto abierto dice agendado', async () => {
  escribirFixtures([CARMEN]);
  const res = await tabla(MEMO_TOKEN);
  assert.equal(res.status, 200);
  const fila = res.body.find(f => f.nombre === 'Carmen');
  assert.equal(fila.estado, 'agendado');
  assert.equal(fila.ultimoContacto, '2026-08-21T09:00:00.000Z');
  assert.equal(fila.toques, 1);
});

// --- #321: que falta (prospectos) ---

const DIANA = {
  id: 80, fecha: '2026-09-01T12:00:00.000Z', vendedor: 'Memo', celular: '+52 5511122233',
  celular10: '5511122233', nombre: 'Diana', ciudad: 'Puebla', canal: 'WhatsApp',
  etapa: 'por_cotizar', eventos: [],
  data: { evento: 'Abastur 2026', correo: '' },
};

test('#321: la fila trae queFalta con la calificacion pendiente de un prospecto de evento sin correo', async () => {
  escribirFixtures([DIANA]);
  const res = await tabla(MEMO_TOKEN);
  assert.equal(res.status, 200);
  const fila = res.body.find(f => f.nombre === 'Diana');
  assert.deepEqual(fila.queFalta, ['calificacion', 'correo']);
});

// --- #317: cualquier prospecto, Origen y /prospectos ---
// La tabla dejo de ser de la expo: un prospecto que nunca vino de un evento entra
// igual, y su fila trae el Origen del glosario para que la pantalla filtre por
// el.

test('#317: un prospecto sin evento sale en la tabla con su Origen', async () => {
  const deInstagram = { ...PEDRO, vendedor: 'Memo', canal: 'Instagram' };
  escribirFixtures([deInstagram]);
  const res = await tabla(MEMO_TOKEN);
  assert.equal(res.status, 200);
  const fila = res.body.find(f => f.nombre === 'Pedro');
  assert.equal(fila.data.evento, undefined);
  assert.equal(fila.origen, 'Instagram');
});

// --- #315: cotizado y cliente ---

const RAQUEL = {
  id: 20, fecha: '2026-08-15T10:00:00.000Z', vendedor: 'Memo', celular: '+52 5566778899',
  celular10: '5566778899', nombre: 'Raquel', ciudad: 'Queretaro', canal: 'WhatsApp',
  etapa: 'seguimiento',
  eventos: [
    { tipo: 'cotizacion', cotizacion_id: 600, fecha: '2026-08-18T10:00:00.000Z', vendedor: 'Memo' },
    { tipo: 'cliente', cliente_id: 4321, nombre: 'Raquel', fecha: '2026-08-19T10:00:00.000Z' },
  ],
  data: { cliente_id: 4321 },
};
const TOMAS = {
  id: 21, fecha: '2026-08-16T10:00:00.000Z', vendedor: 'Memo', celular: '+52 5533445566',
  celular10: '5533445566', nombre: 'Tomas', ciudad: 'Leon', canal: 'Instagram',
  etapa: 'seguimiento',
  eventos: [
    { tipo: 'cotizacion', cotizacion_id: 601, fecha: '2026-08-20T10:00:00.000Z', vendedor: 'Memo' },
  ],
  data: {},
};

test('#315: la fila de un prospecto con cliente ligado dice cliente y trae el clienteId', async () => {
  escribirFixtures([RAQUEL]);
  const res = await tabla(MEMO_TOKEN);
  assert.equal(res.status, 200);
  const fila = res.body.find(f => f.nombre === 'Raquel');
  assert.equal(fila.estado, 'cliente');
  assert.equal(fila.clienteId, 4321);
});

test('#315: la fila de un prospecto con cotizacion y sin cliente dice cotizado y trae clienteId null', async () => {
  escribirFixtures([TOMAS]);
  const res = await tabla(MEMO_TOKEN);
  assert.equal(res.status, 200);
  const fila = res.body.find(f => f.nombre === 'Tomas');
  assert.equal(fila.estado, 'cotizado');
  assert.equal(fila.clienteId, null);
});

// --- #318: que sigue (prospectos) ---

const ELENA = {
  id: 50, fecha: '2026-09-01T13:00:00.000Z', vendedor: 'Memo', celular: '+52 5566778899',
  celular10: '5566778899', nombre: 'Elena', ciudad: 'Puebla', canal: 'WhatsApp',
  etapa: 'por_cotizar', eventos: [], data: {},
};

test('#318: la fila de un prospecto sin toques trae queSigue con la accion de escribirle', async () => {
  escribirFixtures([ELENA]);
  const res = await tabla(MEMO_TOKEN);
  assert.equal(res.status, 200);
  const fila = res.body.find(f => f.nombre === 'Elena');
  assert.equal(fila.queSigue.accion, 'Escribirle');
});

// --- #323: liga Ver en Operam ---
// server.js pisa process.env con el .env al importarse (arriba en este mismo
// archivo), asi que OPERAM_URL se fija DESPUES de ese import, dentro del test,
// y se restaura al terminar para no filtrar a otras suites.

test('#323: GET /api/catalogos expone operamUrl sin la barra final', async () => {
  const original = process.env.OPERAM_URL;
  process.env.OPERAM_URL = 'https://ejemplo.operam.pro/';
  try {
    const res = await supertest(app).get('/api/catalogos').set('Authorization', `Bearer ${MEMO_TOKEN}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.operamUrl, 'https://ejemplo.operam.pro');
  } finally {
    if (original === undefined) delete process.env.OPERAM_URL;
    else process.env.OPERAM_URL = original;
  }
});

test('#323: GET /api/catalogos expone operamUrl vacio sin OPERAM_URL', async () => {
  const original = process.env.OPERAM_URL;
  delete process.env.OPERAM_URL;
  try {
    const res = await supertest(app).get('/api/catalogos').set('Authorization', `Bearer ${MEMO_TOKEN}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.operamUrl, '');
  } finally {
    if (original === undefined) delete process.env.OPERAM_URL;
    else process.env.OPERAM_URL = original;
  }
});

// --- #319: cotizaciones del prospecto ---
// La ruta liga las cotizaciones al prospecto por los dos caminos y respeta la
// visibilidad: un vendedor nunca ve la cotizacion de otro, ni siquiera cuando
// el celular del cliente es el mismo prospecto. El dia de cadencia no se
// afirma aqui (la ruta usa el reloj real): eso lo cubren los tests del nucleo.

const NORA = {
  id: 60, fecha: '2026-08-15T10:00:00.000Z', vendedor: 'Memo', celular: '+52 5512345678',
  celular10: '5512345678', nombre: 'Nora', ciudad: 'Puebla', canal: 'WhatsApp',
  etapa: 'seguimiento',
  eventos: [{ tipo: 'cotizacion', cotizacion_id: 600, fecha: '2026-08-18T10:00:00.000Z', vendedor: 'Memo' }],
  data: {},
};
const OLGA = {
  id: 61, fecha: '2026-08-16T10:00:00.000Z', vendedor: 'Memo', celular: '+52 5577665544',
  celular10: '5577665544', nombre: 'Olga', ciudad: 'León', canal: 'Instagram',
  etapa: 'seguimiento', eventos: [], data: {},
};

function cotFixture(over = {}) {
  const { cliente: sobreCliente, ...resto } = over;
  return {
    id: 600, fecha: '2026-08-20T10:00:00.000Z', vendedor: 'Memo', cliente: 'LA LUPITA',
    total: 15000, totalPiezas: 200, tier: 'M100', estado: 'abierta', etapa: 'seguimiento',
    folioOperam: 1141, registroDesconocido: false, seguimientos: [],
    data: {
      cliente: {
        razonSocial: 'LA LUPITA', nombreCorto: 'La Lupita', rfc: 'XAXX010101000',
        telefono: '5599887766', celEntrega: '', customerId: 900, ...sobreCliente,
      },
    },
    ...resto,
  };
}

test('#319: la ruta liga la cotizacion por el evento del prospecto aunque el celular no coincida', async () => {
  escribirFixtures([NORA], [cotFixture(), cotFixture({ id: 601 })]);
  const res = await tabla(MEMO_TOKEN);
  assert.equal(res.status, 200);
  const fila = res.body.find(f => f.nombre === 'Nora');
  assert.deepEqual(fila.cotizaciones.map(c => c.id), [600]);
});

test('#319: la ruta liga la cotizacion por el celular del cliente aunque no haya evento', async () => {
  escribirFixtures([OLGA], [cotFixture({ id: 602, cliente: { telefono: '+52 55 7766 5544' } })]);
  const res = await tabla(MEMO_TOKEN);
  assert.equal(res.status, 200);
  const fila = res.body.find(f => f.nombre === 'Olga');
  assert.deepEqual(fila.cotizaciones.map(c => c.id), [602]);
});

test('#319: la cotizacion de otro vendedor no llega a la fila del vendedor, pero si a la del admin', async () => {
  const ajena = cotFixture({ id: 603, vendedor: 'Ana', cliente: { telefono: '5577665544' } });
  escribirFixtures([OLGA], [ajena]);
  const deMemo = await tabla(MEMO_TOKEN);
  assert.equal(deMemo.status, 200);
  assert.deepEqual(deMemo.body.find(f => f.nombre === 'Olga').cotizaciones, []);
  const deAdmin = await tabla(ADMIN_TOKEN);
  assert.equal(deAdmin.status, 200);
  assert.deepEqual(deAdmin.body.find(f => f.nombre === 'Olga').cotizaciones.map(c => c.id), [603]);
});

test('#319: la fila nombra la cotizacion por su folio, nunca por el id interno', async () => {
  escribirFixtures([NORA], [cotFixture()]);
  const res = await tabla(MEMO_TOKEN);
  assert.equal(res.status, 200);
  const fila = res.body.find(f => f.nombre === 'Nora');
  assert.equal(fila.cotizaciones[0].folio, '#Operam 1141');
  assert.equal(fila.estado, 'cotizado');
  assert.equal(fila.queSigue.folio, '#Operam 1141');
});

// --- #320: que sigue (clientes) ---
// La ruta arma la fila del cliente con lo que los dos stores ya guardan: la
// etapa post-venta que dejo el sync y el orden de "la mas avanzada manda". El
// texto de la etapa no depende del reloj, asi que se afirma completo.

const RITA = {
  id: 70, fecha: '2026-08-15T10:00:00.000Z', vendedor: 'Memo', celular: '+52 5512340070',
  celular10: '5512340070', nombre: 'Rita', ciudad: 'Querétaro', canal: 'WhatsApp',
  etapa: 'anticipo_pagado',
  eventos: [
    { tipo: 'cotizacion', cotizacion_id: 700, fecha: '2026-08-18T10:00:00.000Z', vendedor: 'Memo' },
    { tipo: 'cotizacion', cotizacion_id: 701, fecha: '2026-08-25T10:00:00.000Z', vendedor: 'Memo' },
  ],
  data: { cliente_id: 900 },
};
const TERE = {
  id: 71, fecha: '2026-08-16T10:00:00.000Z', vendedor: 'Memo', celular: '+52 5512340071',
  celular10: '5512340071', nombre: 'Tere', ciudad: 'Morelia', canal: 'Instagram',
  etapa: 'por_cotizar', eventos: [], data: { cliente_id: 901 },
};

test('#320: la fila del cliente sin cotizacion pide cotizarle', async () => {
  escribirFixtures([TERE], []);
  const res = await tabla(MEMO_TOKEN);
  assert.equal(res.status, 200);
  const fila = res.body.find(f => f.nombre === 'Tere');
  assert.equal(fila.estado, 'cliente');
  assert.equal(fila.queSigue.accion, 'Cotizarle');
});

test('#320: con dos cotizaciones vivas la fila del cliente muestra la mas avanzada y avisa que hay una mas', async () => {
  escribirFixtures([RITA], [
    cotFixture({ id: 700, etapa: 'seguimiento', folioOperam: 1141 }),
    cotFixture({ id: 701, etapa: 'anticipo_pagado', folioOperam: 1150 }),
  ]);
  const res = await tabla(MEMO_TOKEN);
  assert.equal(res.status, 200);
  const fila = res.body.find(f => f.nombre === 'Rita');
  assert.equal(fila.queSigue.tipo, 'etapa');
  assert.equal(fila.queSigue.etapa, 'anticipo_pagado');
  assert.equal(fila.queSigue.accion, 'Anticipo pagado (#Operam 1150) y 1 más');
  assert.equal(fila.queSigue.masCotizaciones, 1);
});

// --- #322: que falta (clientes) ---
// El AC del ticket: la tabla se arma SIN consultar Operam. El test lo hace
// verificable dejando un `globalThis.fetch` que revienta -- cualquier llamada
// saldria como 500 -- y aun asi la fila del cliente generico trae sus huecos.

const RITA_322 = {
  id: 90, fecha: '2026-08-10T10:00:00.000Z', vendedor: 'Memo', celular: '+52 5511223344',
  celular10: '5511223344', nombre: 'Rita', ciudad: 'Puebla', canal: 'WhatsApp',
  etapa: 'seguimiento', eventos: [],
  data: { correo: 'rita@ejemplo.com', cliente_id: 507 },
};

const COT_RITA = {
  id: 900, fecha: '2026-08-20T10:00:00.000Z', vendedor: 'Memo', cliente: 'RITA',
  total: 8000, totalPiezas: 100, tier: 'M100', estado: 'abierta', etapa: 'seguimiento',
  folioOperam: 1200, registroDesconocido: false, seguimientos: [],
  data: {
    cliente: {
      razonSocial: 'RITA', nombreCorto: 'Rita', rfc: 'XAXX010101000',
      telefono: '5511223344', celEntrega: '', calle: '', cpEntrega: '', customerId: 507,
    },
  },
};

test('#322: la tabla arma los huecos del cliente sin una sola llamada a Operam', async () => {
  escribirFixtures([RITA_322], [COT_RITA]);
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('fetch prohibido'); };
  try {
    const res = await tabla(MEMO_TOKEN);
    assert.equal(res.status, 200);
    const fila = res.body.find(f => f.nombre === 'Rita');
    assert.equal(fila.estado, 'cliente');
    assert.deepEqual(fila.queFalta, ['datos_fiscales', 'domicilio']);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});
