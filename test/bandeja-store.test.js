import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync, borrarArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Sin DATABASE_URL el store usa el fallback JSON (data/bandeja.json), el mismo
// modo en que corren dev local y esta suite (mismo patron que
// cotizaciones-store / prospectos-store).
import { listar, obtener, proponer, aceptar, descartar } from '../lib/bandeja-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BANDEJA_PATH = join(__dirname, '..', 'data', 'bandeja.json');

function readBandeja() {
  if (!existsSync(BANDEJA_PATH)) return [];
  return JSON.parse(leerArchivoSync(BANDEJA_PATH));
}
function writeBandeja(data) {
  escribirArchivoSync(BANDEJA_PATH, JSON.stringify(data, null, 2));
}

let savedBandeja;
let existia;
before(() => {
  existia = existsSync(BANDEJA_PATH);
  savedBandeja = readBandeja();
});
after(() => {
  if (existia) writeBandeja(savedBandeja);
  else if (existsSync(BANDEJA_PATH)) borrarArchivoSync(BANDEJA_PATH);
});
beforeEach(() => {
  writeBandeja([]);
});

const CANDIDATO = {
  folio: 934,
  tipo: 'prospecto',
  fecha: '2026-07-21T00:00:00.000Z',
  contacto: 'Mariana Gutierrez Solis',
  celular: '+52 1 55 2314 8890',
  email: 'mariana.gs@hotmail.com',
  proyecto: 'Hotel Boutique Valle',
  domicilio: 'Av. de los Insurgentes 1420, Col. Del Valle, CDMX',
  monto: 48250,
  debtorId: 184,
  debtorNombre: 'GENERICO TIENDAS DIGITALES',
  vendedor: 'Alejandro',
  marcas: { comproOtraCosa: true, posibleDuplicado: false },
};

test('proponer guarda el candidato completo y nace pendiente, sin prospecto ligado', async () => {
  assert.equal(await proponer(CANDIDATO), true);
  const c = await obtener('934');
  assert.equal(c.folio, '934');
  assert.equal(c.tipo, 'prospecto');
  assert.equal(c.estado, 'pendiente');
  assert.equal(c.contacto, 'Mariana Gutierrez Solis');
  assert.equal(c.celular, '+52 1 55 2314 8890');
  assert.equal(c.email, 'mariana.gs@hotmail.com');
  assert.equal(c.proyecto, 'Hotel Boutique Valle');
  assert.equal(c.domicilio, 'Av. de los Insurgentes 1420, Col. Del Valle, CDMX');
  assert.equal(c.monto, 48250);
  assert.equal(c.fecha, '2026-07-21T00:00:00.000Z');
  assert.equal(c.debtorId, 184);
  assert.equal(c.debtorNombre, 'GENERICO TIENDAS DIGITALES');
  assert.equal(c.vendedor, 'Alejandro');
  assert.deepEqual(c.marcas, { comproOtraCosa: true, posibleDuplicado: false });
  assert.equal(c.prospectoId, null);
});

test('el folio es la clave natural: el mismo folio no se duplica ni pisa lo guardado', async () => {
  await proponer(CANDIDATO);
  // el folio llega como numero y como texto: es el MISMO candidato
  assert.equal(await proponer({ ...CANDIDATO, folio: '934', contacto: 'Otro nombre' }), false);
  const todos = await listar();
  assert.equal(todos.length, 1);
  assert.equal(todos[0].contacto, 'Mariana Gutierrez Solis');
});

test('obtener devuelve undefined para un folio que nadie propuso', async () => {
  assert.equal(await obtener('999'), undefined);
});

test('listar devuelve los candidatos de la bandeja, del mas reciente al mas viejo', async () => {
  await proponer({ ...CANDIDATO, folio: 902, fecha: '2026-06-28T00:00:00.000Z' });
  await proponer(CANDIDATO);
  await proponer({ ...CANDIDATO, folio: 921, fecha: '2026-07-14T00:00:00.000Z' });
  const todos = await listar();
  assert.deepEqual(todos.map(c => c.folio), ['934', '921', '902']);
});

test('proponer rechaza un tipo que no es prospecto ni cotizacion', async () => {
  await assert.rejects(proponer({ ...CANDIDATO, tipo: 'pedido' }), /tipo/i);
  assert.equal((await listar()).length, 0);
});

test('proponer rechaza un candidato sin folio: sin clave natural no hay idempotencia', async () => {
  await assert.rejects(proponer({ ...CANDIDATO, folio: '' }), /folio/);
  assert.equal((await listar()).length, 0);
});

test('aceptar marca aceptado, guarda el vendedor elegido y liga el prospecto creado', async () => {
  await proponer(CANDIDATO);
  assert.equal(await aceptar('934', { vendedor: 'Oswaldo', prospectoId: 41 }), true);
  const c = await obtener('934');
  assert.equal(c.estado, 'aceptado');
  assert.equal(c.vendedor, 'Oswaldo');
  assert.equal(c.prospectoId, 41);
});

test('aceptar dos veces no re-liga: el segundo intento no cambia nada', async () => {
  await proponer(CANDIDATO);
  await aceptar('934', { vendedor: 'Oswaldo', prospectoId: 41 });
  assert.equal(await aceptar('934', { vendedor: 'Alejandro', prospectoId: 99 }), false);
  const c = await obtener('934');
  assert.equal(c.vendedor, 'Oswaldo');
  assert.equal(c.prospectoId, 41);
});

test('aceptar un folio que no esta en la bandeja devuelve false', async () => {
  assert.equal(await aceptar('999', { vendedor: 'Oswaldo', prospectoId: 1 }), false);
});

test('descartar marca sin borrar: el candidato sigue en la bandeja', async () => {
  await proponer(CANDIDATO);
  assert.equal(await descartar('934'), true);
  const todos = await listar();
  assert.equal(todos.length, 1);
  assert.equal(todos[0].estado, 'descartado');
  assert.equal(todos[0].prospectoId, null);
});

test('un candidato descartado no se acepta ni se re-propone', async () => {
  await proponer(CANDIDATO);
  await descartar('934');
  assert.equal(await aceptar('934', { vendedor: 'Oswaldo', prospectoId: 41 }), false);
  assert.equal(await descartar('934'), false);
  assert.equal(await proponer(CANDIDATO), false);
  const c = await obtener('934');
  assert.equal(c.estado, 'descartado');
});

test('un candidato aceptado no se descarta ni se re-propone', async () => {
  await proponer(CANDIDATO);
  await aceptar('934', { vendedor: 'Oswaldo', prospectoId: 41 });
  assert.equal(await descartar('934'), false);
  assert.equal(await proponer(CANDIDATO), false);
  const c = await obtener('934');
  assert.equal(c.estado, 'aceptado');
  assert.equal(c.prospectoId, 41);
});
