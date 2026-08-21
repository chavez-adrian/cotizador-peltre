import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync, borrarArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import supertest from 'supertest';

// Contrato fire-and-forget de la alerta de mayoreo (issue #163) visto desde el
// endpoint publico: un fallo del wrapper de correo NUNCA debe alterar la
// respuesta opaca ni impedir la tarjeta (mismo contrato que subirCsfDropbox), y
// sin variables SMTP configuradas la captura debe funcionar identica.
// `_inyectarAlertaMayoreo` (server.js) es el punto de inyeccion agregado para
// esto: nodemailer no pasa por fetch, asi que no hay mock de URL que lo intercepte.

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROSPECTOS_PATH = join(__dirname, '..', 'data', 'prospectos.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}
// Esta suite prueba el camino SIN credenciales SMTP a proposito (issue #163,
// AC "sin env vars de SMTP la captura funciona identica y no hay intento de
// conexion"): el .env local de la casa nunca las trae, pero se borran aqui
// tambien por si algun entorno las tuviera, para que el test sea el que manda.
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;

const { app, _inyectarAlertaMayoreo } = await import('../server.js');
const { resetIndice } = await import('../lib/indice-telefonos.js');
const { resetSession } = await import('../lib/operam-client.js');
const { resetRateLimitPublico } = await import('../lib/rate-limit-publico.js');

function readProspectos() {
  if (!existsSync(PROSPECTOS_PATH)) return [];
  return JSON.parse(leerArchivoSync(PROSPECTOS_PATH));
}
function writeProspectos(data) {
  escribirArchivoSync(PROSPECTOS_PATH, JSON.stringify(data, null, 2));
}

const originalFetch = globalThis.fetch;
const fetchBloqueado = async (url) => { throw new Error('fetch sin mock en tests: ' + url); };

function formulario(extra = {}) {
  return {
    tipo: 'Restaurantes', otro: '', empresa: 'Hotel Azul',
    cant: '+350', cp: '56530', ciudad: 'Ixtapaluca',
    cuando: 'En los próximos 3 meses',
    nombre: 'Laura', apellido: 'Mendoza', cargo: 'Compras',
    celCode: '+52', cel: '5512345678', correo: 'laura@gmail.com',
    web: '@hotelazul', promos: false,
    ...extra,
  };
}
function enviar(body) {
  return supertest(app).post('/api/prospectos/publico').send(body);
}

let savedProspectos;
let existia;
before(() => {
  existia = existsSync(PROSPECTOS_PATH);
  savedProspectos = readProspectos();
  globalThis.fetch = fetchBloqueado;
});
after(() => {
  if (existia) writeProspectos(savedProspectos);
  else if (existsSync(PROSPECTOS_PATH)) borrarArchivoSync(PROSPECTOS_PATH);
  globalThis.fetch = originalFetch;
  _inyectarAlertaMayoreo(null);
});
beforeEach(() => {
  globalThis.fetch = fetchBloqueado;
  resetIndice();
  resetSession();
  resetRateLimitPublico();
  writeProspectos([]);
  _inyectarAlertaMayoreo(null);
});

test('un fallo del wrapper de alerta no altera la respuesta opaca ni impide la tarjeta', async () => {
  let llamado = false;
  let recibido = null;
  _inyectarAlertaMayoreo(async (prospecto) => {
    llamado = true;
    recibido = prospecto;
    throw new Error('SMTP caido de prueba');
  });

  const res = await enviar(formulario());

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  const p = readProspectos()[0];
  assert.ok(p, 'la tarjeta se crea aunque la alerta falle');
  assert.equal(p.nombre, 'Laura Mendoza');

  assert.equal(llamado, true, 'el wrapper inyectado debio dispararse');
  assert.equal(recibido.nombre, 'Laura Mendoza');
  assert.equal(recibido.tipoProyecto, 'Restaurantes');
  assert.equal(recibido.cantidadEstimada, '+350');
  // #165: la alerta lleva la informacion COMPLETA del formulario, no solo los
  // 5 campos originales de #163.
  assert.equal(recibido.cp, '56530');
  assert.equal(recibido.empresa, 'Hotel Azul');
  assert.equal(recibido.cargo, 'Compras');
  assert.equal(recibido.correo, 'laura@gmail.com');
  assert.equal(recibido.cuando, 'En los próximos 3 meses');
  assert.equal(recibido.web, '@hotelazul');
  assert.deepEqual(recibido.promos, { acepta: false });
});

test('#165: "tipo" Otro lleva el texto libre por separado (tipoProyectoOtro) para que la alerta lo muestre', async () => {
  let recibido = null;
  _inyectarAlertaMayoreo(async (prospecto) => { recibido = prospecto; });

  const res = await enviar(formulario({ tipo: 'Otro', otro: 'Panaderia artesanal', cel: '5511122233' }));

  assert.equal(res.status, 200);
  assert.equal(recibido.tipoProyecto, 'Otro');
  assert.equal(recibido.tipoProyectoOtro, 'Panaderia artesanal');
});

// --- #236: el apellido llega a la alerta como campo propio, en las 3 ramas ---
//
// La vCard necesita el nombre de pila y el apellido POR SEPARADO para emitir N:
// (sin ella Contactos de Apple lee la ficha como ficha de empresa, ver
// lib/alerta-mayoreo.js), y el corte entre los dos no sobrevive al aplanado de
// buildCapturaMayoreo (la tarjeta guarda un solo nombre): viajan del cuerpo
// crudo del formulario, misma via que el cargo y el texto libre de "Otro" (#165).

function prospectoExistente(extra = {}) {
  return {
    id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', celular: '+52 5512345678',
    celular10: '5512345678', nombre: 'Laura Mendoza', ciudad: 'Ixtapaluca',
    canal: 'WhatsApp', etapa: 'por_cotizar', data: {}, eventos: [],
    ...extra,
  };
}

test('#236: rama prospecto NUEVO -- nombre de pila y apellido llegan como campos propios, con las mayusculas ya corregidas', async () => {
  let recibido = null;
  _inyectarAlertaMayoreo(async (prospecto) => { recibido = prospecto; });

  // Campos CRUDOS en mayusculas: capitalizarCampo (#235) solo se aplica dentro
  // de buildCapturaMayoreo, asi que sin corregirlos aqui la ficha diria
  // "Laura Mendoza" en FN: y "LAURA"/"MENDOZA" en N:, el mismo nombre de dos formas.
  const res = await enviar(formulario({ nombre: 'LAURA', apellido: 'MENDOZA' }));

  assert.equal(res.status, 200);
  assert.equal(readProspectos().length, 1, 'la rama del prospecto nuevo es la que corrio');
  assert.equal(recibido.nombrePila, 'Laura');
  assert.equal(recibido.apellido, 'Mendoza');
  assert.equal(recibido.nombre, 'Laura Mendoza', 'el nombre unido de la tarjeta no cambia');
});

test('#236: rama prospecto QUE YA EXISTIA -- los campos separados tambien llegan a la alerta', async () => {
  writeProspectos([prospectoExistente()]);
  let recibido = null;
  _inyectarAlertaMayoreo(async (prospecto) => { recibido = prospecto; });

  const res = await enviar(formulario({ nombre: 'LAURA', apellido: 'MENDOZA' }));

  assert.equal(res.status, 200);
  assert.equal(readProspectos().length, 1, 'no se duplico la tarjeta: corrio la rama del existente');
  assert.equal(recibido.nombrePila, 'Laura');
  assert.equal(recibido.apellido, 'Mendoza');
});

test('#236: rama CARRERA contra el indice unico -- los campos separados tambien llegan a la alerta', async () => {
  // La tarjeta duplicada aparece DESPUES de que el endpoint clasifico el celular
  // (el archivo arranca vacio) y ANTES de crear: se cuela en el hueco asincrono
  // del indice de telefonos, que consulta Operam por fetch. Asi el store lanza
  // 23505 y corre la tercera rama, la unica que de otro modo no es alcanzable
  // desde afuera en un solo proceso.
  globalThis.fetch = async (url) => {
    writeProspectos([prospectoExistente()]);
    throw new Error('fetch sin mock en tests: ' + url);
  };
  let recibido = null;
  _inyectarAlertaMayoreo(async (prospecto) => { recibido = prospecto; });

  const res = await enviar(formulario({ nombre: 'LAURA', apellido: 'MENDOZA' }));

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  const todos = readProspectos();
  assert.equal(todos.length, 1, 'la creacion perdio la carrera: no hay tarjeta nueva');
  assert.equal(todos[0].vendedor, 'Memo', 'sobrevive la tarjeta que gano el indice unico');
  assert.equal(todos[0].eventos.at(-1).tipo, 'captura_publica', 'la captura se registro en la que gano');
  assert.ok(recibido, 'la tercera rama tambien dispara la alerta');
  assert.equal(recibido.nombrePila, 'Laura');
  assert.equal(recibido.apellido, 'Mendoza');
});

// --- #238: la fecha de captura llega a la alerta, en las 3 ramas ---
//
// La nota de la vCard imprime esa fecha como "foto del momento", y el nucleo
// puro nunca consulta el reloj: el instante lo inyecta este endpoint. Tiene que
// ser el MISMO con el que se armo la captura, no uno nuevo -- por eso se afirma
// contra la fecha del consentimiento de promociones, que buildCapturaMayoreo
// sella con ese instante y es el unico rastro observable de el desde afuera.

function afirmarFechaCaptura(recibido) {
  assert.match(recibido.fechaCaptura, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'la fecha llega como instante ISO');
  assert.equal(recibido.fechaCaptura, recibido.promos.fecha, 'es el mismo instante con el que se armo la captura');
}

test('#238: rama prospecto NUEVO -- la fecha de captura llega a la alerta', async () => {
  let recibido = null;
  _inyectarAlertaMayoreo(async (prospecto) => { recibido = prospecto; });

  const res = await enviar(formulario({ promos: true }));

  assert.equal(res.status, 200);
  assert.equal(readProspectos().length, 1, 'la rama del prospecto nuevo es la que corrio');
  afirmarFechaCaptura(recibido);
});

test('#238: rama prospecto QUE YA EXISTIA -- la fecha de captura tambien llega', async () => {
  writeProspectos([prospectoExistente()]);
  let recibido = null;
  _inyectarAlertaMayoreo(async (prospecto) => { recibido = prospecto; });

  const res = await enviar(formulario({ promos: true }));

  assert.equal(res.status, 200);
  assert.equal(readProspectos().length, 1, 'no se duplico la tarjeta: corrio la rama del existente');
  afirmarFechaCaptura(recibido);
});

test('#238: rama CARRERA contra el indice unico -- la fecha de captura tambien llega', async () => {
  globalThis.fetch = async (url) => {
    writeProspectos([prospectoExistente()]);
    throw new Error('fetch sin mock en tests: ' + url);
  };
  let recibido = null;
  _inyectarAlertaMayoreo(async (prospecto) => { recibido = prospecto; });

  const res = await enviar(formulario({ promos: true }));

  assert.equal(res.status, 200);
  const todos = readProspectos();
  assert.equal(todos.length, 1, 'la creacion perdio la carrera: no hay tarjeta nueva');
  assert.equal(todos[0].vendedor, 'Memo', 'sobrevive la tarjeta que gano el indice unico');
  assert.ok(recibido, 'la tercera rama tambien dispara la alerta');
  afirmarFechaCaptura(recibido);
});

test('sin SMTP_USER/SMTP_PASS configuradas, la captura funciona identica con el wrapper real (sin inyeccion)', async () => {
  // Sin _inyectarAlertaMayoreo: corre el wrapper real (lib/alerta-mayoreo-io.js)
  // contra el entorno real, que no trae SMTP_USER/SMTP_PASS (borradas arriba).
  // Que nodemailer.createTransport nunca se llame sin credenciales ya esta
  // probado a nivel unidad en test/alerta-mayoreo-io.test.js; aqui se prueba que
  // el endpoint completo no se cae ni cambia de comportamiento por eso.
  const res = await enviar(formulario({ cel: '5587654321' }));

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  const p = readProspectos()[0];
  assert.ok(p, 'la tarjeta se crea igual sin credenciales SMTP');
  assert.equal(p.celular, '+52 5587654321');
});
