import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync, borrarArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

// Rutas de la bandeja de revision "Rescatados de Operam" (issue #122). Los
// candidatos se SIEMBRAN via el store (este ticket no habla con Operam: ninguna
// ruta de aqui sale a la red).

const __dirname = dirname(fileURLToPath(import.meta.url));
const BANDEJA_PATH = join(__dirname, '..', 'data', 'bandeja.json');
const PROSPECTOS_PATH = join(__dirname, '..', 'data', 'prospectos.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');
const { proponer, obtener } = await import('../lib/bandeja-store.js');
const { listar: listarProspectos, crear: crearProspecto } = await import('../lib/prospectos-store.js');
const ADMIN_TOKEN = jwt.sign({ id: 99, name: 'Tester', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
const MEMO_TOKEN = jwt.sign({ id: 7, name: 'Memo', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });

function leerArchivoJson(path) {
  if (!existsSync(path)) return [];
  return JSON.parse(leerArchivoSync(path));
}
function escribirArchivoJson(path, data) {
  escribirArchivoSync(path, JSON.stringify(data, null, 2));
}

// Ninguna ruta de la bandeja sale a la red: si alguna lo intentara, el test lo
// delata (mismo guardrail que prospectos-api.test.js).
const originalFetch = globalThis.fetch;
const fetchBloqueado = async (url) => { throw new Error('fetch sin mock en tests: ' + url); };

let savedBandeja, savedProspectos, existiaBandeja, existiaProspectos;
before(() => {
  existiaBandeja = existsSync(BANDEJA_PATH);
  existiaProspectos = existsSync(PROSPECTOS_PATH);
  savedBandeja = leerArchivoJson(BANDEJA_PATH);
  savedProspectos = leerArchivoJson(PROSPECTOS_PATH);
  globalThis.fetch = fetchBloqueado;
});
after(() => {
  if (existiaBandeja) escribirArchivoJson(BANDEJA_PATH, savedBandeja);
  else if (existsSync(BANDEJA_PATH)) borrarArchivoSync(BANDEJA_PATH);
  if (existiaProspectos) escribirArchivoJson(PROSPECTOS_PATH, savedProspectos);
  else if (existsSync(PROSPECTOS_PATH)) borrarArchivoSync(PROSPECTOS_PATH);
  globalThis.fetch = originalFetch;
});
beforeEach(() => {
  escribirArchivoJson(BANDEJA_PATH, []);
  escribirArchivoJson(PROSPECTOS_PATH, []);
  globalThis.fetch = fetchBloqueado;
});

const CANDIDATO = {
  folio: 934,
  tipo: 'prospecto',
  fecha: '2026-07-21T00:00:00.000Z',
  contacto: 'Mariana Gutierrez Solis',
  celular: '+52 55 2314 8890',
  email: 'mariana.gs@hotmail.com',
  proyecto: 'Hotel Boutique Valle',
  domicilio: 'Av. de los Insurgentes 1420, Col. Del Valle, CDMX',
  monto: 48250,
  debtorId: 184,
  debtorNombre: 'GENERICO TIENDAS DIGITALES',
  vendedor: 'Alejandro Chávez',
  marcas: { comproOtraCosa: true, posibleDuplicado: false },
};

test('el admin ve los candidatos sembrados con todos sus campos y marcas', async () => {
  await proponer(CANDIDATO);
  const res = await supertest(app).get('/api/admin/bandeja')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  const c = res.body[0];
  assert.equal(c.folio, '934');
  assert.equal(c.tipo, 'prospecto');
  assert.equal(c.estado, 'pendiente');
  assert.equal(c.contacto, 'Mariana Gutierrez Solis');
  assert.equal(c.celular, '+52 55 2314 8890');
  assert.equal(c.email, 'mariana.gs@hotmail.com');
  assert.equal(c.proyecto, 'Hotel Boutique Valle');
  assert.equal(c.domicilio, 'Av. de los Insurgentes 1420, Col. Del Valle, CDMX');
  assert.equal(c.monto, 48250);
  assert.equal(c.debtorNombre, 'GENERICO TIENDAS DIGITALES');
  assert.equal(c.vendedor, 'Alejandro Chávez');
  assert.deepEqual(c.marcas, { comproOtraCosa: true, posibleDuplicado: false });
});

test('un vendedor no admin no ve la bandeja', async () => {
  await proponer(CANDIDATO);
  const lista = await supertest(app).get('/api/admin/bandeja')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`);
  assert.equal(lista.status, 403);
});

test('sin token la bandeja responde 401', async () => {
  const res = await supertest(app).get('/api/admin/bandeja');
  assert.equal(res.status, 401);
});

// === Aceptar ===

test('aceptar crea el prospecto con el vendedor elegido y liga el candidato al id creado', async () => {
  await proponer(CANDIDATO);
  const res = await supertest(app).post('/api/admin/bandeja/934/aceptar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: 'Oswaldo Chávez' });
  assert.equal(res.status, 201);
  assert.ok(res.body.prospectoId);

  const prospectos = await listarProspectos();
  assert.equal(prospectos.length, 1);
  const p = prospectos[0];
  assert.equal(p.id, res.body.prospectoId);
  assert.equal(p.nombre, 'Mariana Gutierrez Solis');
  assert.equal(p.celular, '+52 55 2314 8890');
  // el vendedor del body gana sobre el propuesto por el candidato (editable)
  assert.equal(p.vendedor, 'Oswaldo Chávez');
  // trazabilidad del rescate: de que quote de Operam salio la tarjeta
  assert.equal(p.data.folioOperam, '934');

  const c = await obtener('934');
  assert.equal(c.estado, 'aceptado');
  assert.equal(c.prospectoId, res.body.prospectoId);
  assert.equal(c.vendedor, 'Oswaldo Chávez');
});

test('aceptar sin vendedor en el body usa el vendedor propuesto del candidato', async () => {
  await proponer(CANDIDATO);
  const res = await supertest(app).post('/api/admin/bandeja/934/aceptar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({});
  assert.equal(res.status, 201);
  const prospectos = await listarProspectos();
  assert.equal(prospectos[0].vendedor, 'Alejandro Chávez');
});

test('aceptar con un vendedor fuera del catalogo no crea nada', async () => {
  await proponer(CANDIDATO);
  const res = await supertest(app).post('/api/admin/bandeja/934/aceptar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: 'Quien Sea' });
  assert.equal(res.status, 400);
  assert.equal((await listarProspectos()).length, 0);
  assert.equal((await obtener('934')).estado, 'pendiente');
});

test('aceptar dos veces el mismo folio no crea un segundo prospecto', async () => {
  await proponer(CANDIDATO);
  const primero = await supertest(app).post('/api/admin/bandeja/934/aceptar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: 'Oswaldo Chávez' });
  assert.equal(primero.status, 201);
  const segundo = await supertest(app).post('/api/admin/bandeja/934/aceptar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: 'Alejandro Chávez' });
  assert.equal(segundo.status, 409);
  assert.equal((await listarProspectos()).length, 1);
  const c = await obtener('934');
  assert.equal(c.prospectoId, primero.body.prospectoId);
  assert.equal(c.vendedor, 'Oswaldo Chávez');
});

test('aceptar un candidato tipo cotizacion se rechaza en el servidor (llega con #125)', async () => {
  await proponer({ ...CANDIDATO, folio: 940, tipo: 'cotizacion' });
  const res = await supertest(app).post('/api/admin/bandeja/940/aceptar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: 'Oswaldo Chávez' });
  assert.equal(res.status, 422);
  assert.match(res.body.error, /#125/);
  assert.equal((await listarProspectos()).length, 0);
  assert.equal((await obtener('940')).estado, 'pendiente');
});

test('aceptar un folio que no esta en la bandeja responde 404', async () => {
  const res = await supertest(app).post('/api/admin/bandeja/999/aceptar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: 'Oswaldo Chávez' });
  assert.equal(res.status, 404);
  assert.equal((await listarProspectos()).length, 0);
});

test('un vendedor no admin no puede aceptar', async () => {
  await proponer(CANDIDATO);
  const res = await supertest(app).post('/api/admin/bandeja/934/aceptar')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({ vendedor: 'Oswaldo Chávez' });
  assert.equal(res.status, 403);
  assert.equal((await listarProspectos()).length, 0);
  assert.equal((await obtener('934')).estado, 'pendiente');
});

// === Descartar ===

test('descartar marca sin borrar: el candidato sigue en la bandeja y no vuelve a proponerse', async () => {
  await proponer(CANDIDATO);
  const res = await supertest(app).post('/api/admin/bandeja/934/descartar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({});
  assert.equal(res.status, 200);

  const lista = await supertest(app).get('/api/admin/bandeja')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
  assert.equal(lista.body.length, 1);
  assert.equal(lista.body[0].estado, 'descartado');
  // un run futuro que lo vuelva a encontrar en Operam no lo re-propone
  assert.equal(await proponer(CANDIDATO), false);
  assert.equal((await obtener('934')).estado, 'descartado');
  assert.equal((await listarProspectos()).length, 0);
});

test('descartar un candidato ya aceptado responde 409 y no lo cambia', async () => {
  await proponer(CANDIDATO);
  await supertest(app).post('/api/admin/bandeja/934/aceptar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: 'Oswaldo Chávez' });
  const res = await supertest(app).post('/api/admin/bandeja/934/descartar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({});
  assert.equal(res.status, 409);
  assert.equal((await obtener('934')).estado, 'aceptado');
});

test('descartar un folio que no esta en la bandeja responde 404', async () => {
  const res = await supertest(app).post('/api/admin/bandeja/999/descartar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({});
  assert.equal(res.status, 404);
});

test('un vendedor no admin no puede descartar', async () => {
  await proponer(CANDIDATO);
  const res = await supertest(app).post('/api/admin/bandeja/934/descartar')
    .set('Authorization', `Bearer ${MEMO_TOKEN}`).send({});
  assert.equal(res.status, 403);
  assert.equal((await obtener('934')).estado, 'pendiente');
});

test('si el celular ya es un prospecto, aceptar liga al existente sin duplicarlo', async () => {
  const idExistente = await crearProspecto({
    fecha: '2026-06-01T00:00:00.000Z', vendedor: 'Alejandro Chávez',
    celular: '5523148890', nombre: 'Mariana G.', ciudad: 'CDMX', canal: 'WhatsApp',
  });
  await proponer(CANDIDATO);
  const res = await supertest(app).post('/api/admin/bandeja/934/aceptar')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ vendedor: 'Oswaldo Chávez' });
  assert.equal(res.status, 200);
  assert.equal(res.body.prospectoId, idExistente);
  assert.equal(res.body.existente, true);
  assert.equal((await listarProspectos()).length, 1);
  const c = await obtener('934');
  assert.equal(c.estado, 'aceptado');
  assert.equal(c.prospectoId, idExistente);
});
