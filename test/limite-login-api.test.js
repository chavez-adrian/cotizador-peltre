// #450: el PIN es de 4 digitos y el login no limitaba intentos. Tras 5 fallos
// seguidos para un vendedor, o 5 desde una IP, POST /api/login responde 429 con
// los minutos que faltan durante 15 min, sin revisar el PIN. Es la misma ruta
// para / y para los paneles de administracion (`soloAdmin`), asi que el limite
// vive una sola vez, en el servidor. El reloj es falso (mock.timers sobre Date).
import { test, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import supertest from 'supertest';
import { fotoDatos, fijarDatos } from './helpers/datos-aislados.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VENDEDORES_PATH = join(__dirname, '..', 'data', 'vendedores.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}
delete process.env.DATABASE_URL;

const { app } = await import('../server.js');
const { resetLimiteLogin } = await import('../lib/limite-login.js');

const REGISTRO = [
  { id: 1, name: 'Jefa Test', pin: '9001', role: 'admin', operam_id: 1 },
  { id: 2, name: 'Vendedor Test', pin: '9002', role: 'vendedor', operam_id: 2 },
  { id: 3, name: 'Otro Vendedor Test', pin: '9003', role: 'vendedor', operam_id: 3 },
];

const MIN = 60 * 1000;

let restaurarDatos;
before(() => {
  restaurarDatos = fotoDatos([VENDEDORES_PATH]);
  fijarDatos(VENDEDORES_PATH, REGISTRO);
});
after(() => { restaurarDatos(); });

beforeEach(() => {
  resetLimiteLogin();
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-25T10:00:00Z') });
});
afterEach(() => { mock.timers.reset(); });

function login(ip, body) {
  return supertest(app).post('/api/login').set('X-Forwarded-For', ip).send(body);
}

async function fallar(ip, vendedorId, veces, extra = {}) {
  const respuestas = [];
  for (let i = 0; i < veces; i++) respuestas.push(await login(ip, { vendedorId, pin: '0000', ...extra }));
  return respuestas;
}

test('#450 cinco PINes fallidos bloquean al vendedor 15 min con 429 y los minutos que faltan', async () => {
  const [r1, r2, r3, r4, r5] = await fallar('10.0.0.1', 2, 5);
  for (const r of [r1, r2, r3, r4]) assert.equal(r.status, 401);
  assert.equal(r5.status, 429);
  assert.equal(r5.body.error, 'Demasiados intentos, espera 15 min');

  mock.timers.tick(4 * MIN);
  const correcto = await login('10.0.0.2', { vendedorId: 2, pin: '9002' });
  assert.equal(correcto.status, 429, 'durante el bloqueo ni el PIN correcto entra');
  assert.equal(correcto.body.error, 'Demasiados intentos, espera 11 min');
  assert.equal(correcto.body.token, undefined);

  mock.timers.tick(11 * MIN);
  const alVencer = await login('10.0.0.2', { vendedorId: 2, pin: '9002' });
  assert.equal(alVencer.status, 200, 'al vencer la espera entra');
  assert.ok(alVencer.body.token);
});

test('#450 cinco fallos desde una IP contra vendedores distintos bloquean esa IP 15 min', async () => {
  const ip = '10.0.1.1';
  const respuestas = [
    ...await fallar(ip, 1, 2),
    ...await fallar(ip, 2, 2),
    ...await fallar(ip, 3, 1),
  ];
  assert.deepEqual(respuestas.map(r => r.status), [401, 401, 401, 401, 429]);
  assert.equal(respuestas[4].body.error, 'Demasiados intentos, espera 15 min');

  mock.timers.tick(10 * MIN);
  const correcto = await login(ip, { vendedorId: 3, pin: '9003' });
  assert.equal(correcto.status, 429, 'desde la IP bloqueada ni el PIN correcto entra');
  assert.equal(correcto.body.error, 'Demasiados intentos, espera 5 min');

  mock.timers.tick(5 * MIN);
  assert.equal((await login(ip, { vendedorId: 3, pin: '9003' })).status, 200, 'al vencer la espera entra');
});

test('#450 un bloqueo no alcanza a otros vendedores ni a otras IPs', async () => {
  await fallar('10.0.2.1', 2, 5);

  const otroVendedorOtraIp = await login('10.0.2.2', { vendedorId: 3, pin: '9003' });
  assert.equal(otroVendedorOtraIp.status, 200, 'otro vendedor desde otra IP entra');
  const otroVendedorPinMalo = await login('10.0.2.2', { vendedorId: 3, pin: '0000' });
  assert.equal(otroVendedorPinMalo.status, 401, 'y su PIN equivocado sigue siendo un 401 comun');

  const mismoVendedorOtraIp = await login('10.0.2.2', { vendedorId: 2, pin: '9002' });
  assert.equal(mismoVendedorOtraIp.status, 429, 'el vendedor bloqueado sigue bloqueado desde otra IP');
  const otroVendedorMismaIp = await login('10.0.2.1', { vendedorId: 3, pin: '9003' });
  assert.equal(otroVendedorMismaIp.status, 429, 'la IP que llego al tope queda bloqueada para todos');
});

test('#450 un login correcto antes del tope reinicia el contador de ese vendedor', async () => {
  await fallar('10.0.3.1', 2, 4);
  mock.timers.tick(1 * MIN);
  assert.equal((await login('10.0.3.2', { vendedorId: 2, pin: '9002' })).status, 200);

  // Sin el reinicio el primero de estos seria el quinto fallo y ya responderia 429.
  mock.timers.tick(1 * MIN);
  const otraRonda = await fallar('10.0.3.2', 2, 4);
  assert.deepEqual(otraRonda.map(r => r.status), [401, 401, 401, 401]);
  assert.equal((await login('10.0.3.3', { vendedorId: 2, pin: '9002' })).status, 200);
});
