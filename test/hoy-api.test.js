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
  else if (existsSync(PROSPECTOS_PATH)) borrarArchivoSync(PROSPECTOS_PATH);
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

// === Issue #156 (spec #155): la cola Hoy adopta las tarjetas No Asignado ===
// Un lead sin dueno es un pendiente del dia, pero SOLO para quien lo puede
// resolver: el admin o el vendedor con el permiso de asignacion. Para el resto
// la regla de Visibilidad queda intacta -- ni en el tablero ni en la cola.
const VENDEDORES_PATH = join(__dirname, '..', 'data', 'vendedores.json');
const GERENTE_TOKEN = jwt.sign({ id: 2, name: 'Alejandro Chávez', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });

function conSinAsignar() {
  return [
    ...prospectosFixture(),
    {
      id: 3, fecha: haceHoras(5), vendedor: null, celular: '+52 5511112222',
      nombre: 'Mayoreo Web', ciudad: 'Toluca', canal: 'Formulario web',
      etapa: 'no_asignado', eventos: [], data: {},
    },
  ];
}

async function conPermisoDeAsignacion(idVendedor, fn) {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    const registro = JSON.parse(original);
    registro.find(v => v.id === idVendedor).puedeAsignar = true;
    escribirArchivoSync(VENDEDORES_PATH, JSON.stringify(registro, null, 2));
    await fn();
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
}

test('#156: la cola Hoy del admin incluye la tarjeta No Asignado y la pone al frente', async () => {
  writeJson(PROSPECTOS_PATH, conSinAsignar());
  const res = await supertest(app).get('/api/hoy').set('Authorization', `Bearer ${ADMIN_TOKEN}`);
  assert.equal(res.status, 200);
  assert.equal(res.body[0].tipo, 'no_asignado');
  assert.equal(res.body[0].nombre, 'Mayoreo Web');
  assert.equal(res.body.filter(i => i.tipo === 'no_asignado').length, 1);
});

test('#156: el vendedor con permiso ve la tarjeta No Asignado en su cola, ademas de lo suyo', async () => {
  writeJson(PROSPECTOS_PATH, conSinAsignar());
  await conPermisoDeAsignacion(2, async () => {
    const res = await supertest(app).get('/api/hoy').set('Authorization', `Bearer ${GERENTE_TOKEN}`);
    assert.equal(res.status, 200);
    const tipos = res.body.map(i => i.tipo);
    assert.equal(tipos[0], 'no_asignado');
    // Sigue sin ver la cartera de Memo ni la de Ana: solo lo sin dueno.
    assert.equal(res.body.some(i => i.vendedor === 'Memo' || i.vendedor === 'Ana'), false);
  });
});

test('#156: el vendedor SIN permiso no ve tarjetas No Asignado en la cola Hoy', async () => {
  writeJson(PROSPECTOS_PATH, conSinAsignar());
  const memo = await supertest(app).get('/api/hoy').set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(memo.status, 200);
  assert.equal(memo.body.some(i => i.tipo === 'no_asignado'), false);
  const gerente = await supertest(app).get('/api/hoy').set('Authorization', `Bearer ${GERENTE_TOKEN}`);
  assert.equal(gerente.body.some(i => i.tipo === 'no_asignado'), false);
});

// === Issue #262 (spec #260, CONTEXT.md "Siguiente contacto") ===
// El compromiso de contacto con el prospecto manda sobre la cola del dia:
// mientras la fecha es futura la tarjeta no aparece (el jueves de una expo la
// cola no es una pared roja); llegada la fecha vuelve con la instruccion.

function conSiguienteContacto(evs) {
  return [{ ...prospectosFixture()[0], eventos: evs }];
}

function siguienteContacto(canal, fechaContacto, fechaRegistro) {
  return { tipo: 'siguiente_contacto', canal, fecha_contacto: fechaContacto, fecha: fechaRegistro, vendedor: 'Memo' };
}

test('#262: con siguiente contacto futuro la tarjeta no aparece en la cola Hoy', async () => {
  writeJson(PROSPECTOS_PATH, conSiguienteContacto([
    siguienteContacto('WhatsApp', new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(), haceHoras(1)),
  ]));
  const res = await supertest(app).get('/api/hoy').set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.some(i => i.tipo === 'prospecto'), false);
});

test('#262: llegada la fecha la tarjeta vuelve a la cola Hoy con el canal y la fecha del compromiso', async () => {
  const fechaCompromiso = haceHoras(1);
  writeJson(PROSPECTOS_PATH, conSiguienteContacto([
    siguienteContacto('WhatsApp', fechaCompromiso, haceHoras(30)),
  ]));
  const res = await supertest(app).get('/api/hoy').set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(res.status, 200);
  const item = res.body.find(i => i.tipo === 'prospecto');
  assert.ok(item, 'el prospecto debio volver a la cola');
  assert.deepEqual(item.siguienteContacto, { canal: 'WhatsApp', fecha: fechaCompromiso });
});

test('#262: un toque posterior a la fecha cierra el compromiso y la tarjeta sigue en la cadencia normal', async () => {
  writeJson(PROSPECTOS_PATH, conSiguienteContacto([
    siguienteContacto('Llamada', haceHoras(3), haceHoras(30)),
    { tipo: 'toque', fecha: haceHoras(1), vendedor: 'Memo' },
  ]));
  const res = await supertest(app).get('/api/hoy').set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(res.status, 200);
  const item = res.body.find(i => i.tipo === 'prospecto');
  assert.ok(item, 'sin compromiso vivo la tarjeta sigue en la cola');
  assert.equal(item.siguienteContacto, null);
  assert.equal(item.toques, 1);
});
