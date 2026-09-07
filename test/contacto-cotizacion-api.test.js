// La liga fija Oportunidad -> Contacto por HTTP (#342, spec #337, ADR-0016,
// CONTEXT.md "Oportunidad"): la cotizacion anota el celular de su Contacto al
// nacer y ninguna edicion posterior del telefono la mueve a otra persona.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync, borrarArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const COTS_PATH = join(DATA_DIR, 'cotizaciones.json');
const PROSPECTOS_PATH = join(DATA_DIR, 'prospectos.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');
const TOKEN = jwt.sign({ id: 1, name: 'Admin Test', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

function readJson(p) { return existsSync(p) ? JSON.parse(leerArchivoSync(p)) : []; }
function writeJson(p, data) { escribirArchivoSync(p, JSON.stringify(data, null, 2)); }
const hace = (dias) => new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

const CEL_CONTACTO = '5512345678';
const CEL_EQUIVOCADO = '5599998888';

// El Contacto real de la Oportunidad: su Origen es el que la tarjeta hereda.
const CONTACTO = {
  id: 1, fecha: hace(10), vendedor: 'Admin Test', celular: `+52 ${CEL_CONTACTO}`,
  nombre: 'Jorge Orea', ciudad: 'CDMX', canal: 'Feria/Expo', etapa: 'seguimiento',
  eventos: [], data: {},
};
// Otra persona, la del telefono mal tecleado: no debe adoptar la Oportunidad.
const OTRO_CONTACTO = {
  id: 2, fecha: hace(4), vendedor: 'Admin Test', celular: `+52 ${CEL_EQUIVOCADO}`,
  nombre: 'Ana Perez', ciudad: 'Puebla', canal: 'Instagram', etapa: 'por_cotizar',
  eventos: [], data: {},
};

// Cotizacion ya migrada (campo propio anotado) con el telefono CORREGIDO
// despues a otra persona: la liga fija manda.
const COT_CORREGIDA = {
  id: 50, fecha: hace(3), vendedor: 'Admin Test', cliente: 'JORGE OREA', etapa: 'seguimiento',
  totalPiezas: 10, total: 1000, tier: 'Menudeo', folioOperam: 1300,
  contactoCelular: CEL_CONTACTO,
  data: { cliente: { razonSocial: 'JORGE OREA', telefono: `+52 ${CEL_EQUIVOCADO}` }, items: [] },
};
// Cotizacion historica sin Contacto y sin telefono utilizable: la tarjeta lo
// dice y ofrece capturarlo a mano.
const COT_SIN_CONTACTO = {
  id: 51, fecha: hace(2), vendedor: 'Admin Test', cliente: 'CLIENTE HISTORICO', etapa: 'seguimiento',
  totalPiezas: 5, total: 500, tier: 'Menudeo', folioOperam: 1301,
  data: { cliente: { razonSocial: 'CLIENTE HISTORICO' }, items: [] },
};

function cotizacionNueva(telefono, extra = {}) {
  return {
    fecha: '2026-01-01', vigencia: '2026-02-01', tier: 'Menudeo',
    cliente: { razonSocial: 'Nueva SA de CV', nombreCorto: 'Nueva', telefono },
    items: [{ codigo: 'AB12', descripcion: 'Olla', cantidad: 10, unidad: 'pza', precio: 100, descuento: 0 }],
    subtotal: 1000, iva: 160, total: 1160, notas: [],
    ...extra,
  };
}

let savedCots, savedProspectos, existiaCots, existiaProspectos;
before(() => {
  existiaCots = existsSync(COTS_PATH);
  existiaProspectos = existsSync(PROSPECTOS_PATH);
  savedCots = readJson(COTS_PATH);
  savedProspectos = readJson(PROSPECTOS_PATH);
});
after(() => {
  if (existiaCots) writeJson(COTS_PATH, savedCots);
  else if (existsSync(COTS_PATH)) borrarArchivoSync(COTS_PATH);
  if (existiaProspectos) writeJson(PROSPECTOS_PATH, savedProspectos);
  else if (existsSync(PROSPECTOS_PATH)) borrarArchivoSync(PROSPECTOS_PATH);
});
beforeEach(() => {
  writeJson(COTS_PATH, [COT_CORREGIDA, COT_SIN_CONTACTO]);
  writeJson(PROSPECTOS_PATH, [CONTACTO, OTRO_CONTACTO]);
});

const post = (body) => supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TOKEN}`).send(body);
const get = (ruta) => supertest(app).get(ruta).set('Authorization', `Bearer ${TOKEN}`);

// AC1: el POST anota el celular del Contacto en el campo propio.
test('#342: al guardar, la cotizacion anota el celular de su Contacto en el campo propio', async () => {
  const res = await post(cotizacionNueva(`+52 ${CEL_CONTACTO}`));
  assert.equal(res.status, 200);
  const guardada = readJson(COTS_PATH).find(c => c.id === res.body.id);
  assert.equal(guardada.contactoCelular, CEL_CONTACTO);
});

// AC1: un guardado posterior con OTRO telefono no mueve la liga.
test('#342: regenerar la misma cotizacion con otro telefono NO cambia el Contacto anotado', async () => {
  const creada = await post(cotizacionNueva(`+52 ${CEL_CONTACTO}`));
  const id = creada.body.id;
  const res = await post(cotizacionNueva(`+52 ${CEL_EQUIVOCADO}`, { cotizacionId: id }));
  assert.equal(res.status, 200);
  assert.equal(res.body.id, id, 'sigue siendo la misma cotizacion');
  const guardada = readJson(COTS_PATH).find(c => c.id === id);
  assert.equal(guardada.contactoCelular, CEL_CONTACTO);
  assert.equal(guardada.data.cliente.telefono, `+52 ${CEL_EQUIVOCADO}`, 'el documento si lleva el telefono corregido');
});

// AC2: el tablero cruza por el campo propio.
test('#342: la Oportunidad con el telefono corregido sigue siendo la tarjeta del mismo Contacto', async () => {
  const res = await get('/api/oportunidades');
  assert.equal(res.status, 200);
  const porId = Object.fromEntries(res.body.map(o => [o.id, o]));
  // El Contacto real ya no tiene tarjeta propia: su Oportunidad es la cotizacion.
  assert.equal(porId['p1'], undefined);
  // La persona del telefono mal tecleado conserva la suya, intacta.
  assert.equal(porId['p2'].etapa, 'por_cotizar');
  // Y la cotizacion hereda el Origen del Contacto anotado, no el del tecleado.
  assert.equal(porId['c50'].origen, 'Feria/Expo');
  assert.equal(porId['c50'].contactoCelular, CEL_CONTACTO);
});

// AC2: el Historial cruza por el campo propio.
test('#342: el Historial hereda el Origen del Contacto anotado, no el del telefono tecleado', async () => {
  const res = await get('/api/cotizaciones');
  const fila = res.body.find(c => c.id === 50);
  assert.equal(fila.origen, 'Feria/Expo');
  assert.equal(fila.contactoCelular, CEL_CONTACTO);
});

// AC2: la cola Hoy cruza por el campo propio.
test('#342: la cola Hoy hereda el Origen del Contacto anotado', async () => {
  const res = await get('/api/hoy');
  const item = res.body.find(i => i.tipo === 'cotizacion' && i.id === 50);
  assert.equal(item.origen, 'Feria/Expo');
});

// AC6: la Oportunidad sin Contacto se ve como tal.
test('#342: una Oportunidad sin Contacto lo dice en su tarjeta', async () => {
  const res = await get('/api/oportunidades');
  const sin = res.body.find(o => o.id === 'c51');
  assert.equal(sin.contactoCelular, null);
});

// AC6: y se le puede capturar el celular a mano, que la liga en ese momento.
test('#342: capturar el celular a mano liga la Oportunidad con su Contacto', async () => {
  const res = await supertest(app).post('/api/cotizacion/51/contacto')
    .set('Authorization', `Bearer ${TOKEN}`).send({ celular: `+52 ${CEL_CONTACTO}` });
  assert.equal(res.status, 200);
  assert.equal(res.body.contactoCelular, CEL_CONTACTO);
  const tablero = await get('/api/oportunidades');
  const tarjeta = tablero.body.find(o => o.id === 'c51');
  assert.equal(tarjeta.contactoCelular, CEL_CONTACTO);
  assert.equal(tarjeta.origen, 'Feria/Expo', 'ya hereda el Origen de su Contacto');
});

test('#342: un celular que no alcanza 10 digitos no liga nada', async () => {
  const res = await supertest(app).post('/api/cotizacion/51/contacto')
    .set('Authorization', `Bearer ${TOKEN}`).send({ celular: '55 12' });
  assert.equal(res.status, 400);
  const guardada = readJson(COTS_PATH).find(c => c.id === 51);
  assert.equal(guardada.contactoCelular ?? null, null);
});

// AC5: el Contacto que nace de la migracion (fuente 2/3) NO fue capturado por
// nadie -- existe para que la Oportunidad tenga de quien ser. Sin tarjeta
// propia: una tarjeta es una Oportunidad, y ese Contacto no tiene ninguna
// abierta (CONTEXT.md "Oportunidad").
test('#342: un Contacto nacido de la migracion no genera tarjeta en el tablero', async () => {
  const contactos = readJson(PROSPECTOS_PATH);
  contactos.push({
    id: 3, fecha: hace(1), vendedor: 'Admin Test', celular: '+52 5500009999',
    nombre: 'CLIENTE HISTORICO', ciudad: '', canal: '', etapa: 'seguimiento',
    eventos: [], data: { sinCaptura: true, cliente_id: 514, fuenteContacto: 'operam' },
  });
  writeJson(PROSPECTOS_PATH, contactos);
  const res = await get('/api/oportunidades');
  assert.equal(res.body.some(o => o.id === 'p3'), false);
  // El Contacto si existe: la Tabla de prospectos lo lista y dice de donde vino.
  const tabla = await get('/api/prospectos/tabla');
  const fila = tabla.body.find(f => f.id === 3);
  assert.equal(fila.sinCaptura, true);
});

// La liga es FIJA: ni siquiera la captura manual pisa una ya anotada.
test('#342: la captura manual no pisa una liga ya anotada', async () => {
  const res = await supertest(app).post('/api/cotizacion/50/contacto')
    .set('Authorization', `Bearer ${TOKEN}`).send({ celular: `+52 ${CEL_EQUIVOCADO}` });
  assert.equal(res.status, 409);
  const guardada = readJson(COTS_PATH).find(c => c.id === 50);
  assert.equal(guardada.contactoCelular, CEL_CONTACTO);
});
