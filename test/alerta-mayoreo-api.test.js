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
