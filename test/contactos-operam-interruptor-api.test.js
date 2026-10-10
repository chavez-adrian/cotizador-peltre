// D6 (decisiones de Adrian 2026-10-09): el panel /admin avisa mientras la escritura de
// Contactos en Operam no este en `todos`. GET /api/admin/contactos-operam-escritura
// devuelve el valor de hoy de CONTACTOS_OPERAM_ESCRITURA interpretado por el nucleo
// puro (lib/contactos-operam-logica.js) y el aviso en palabras simples; solo admin.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { fijarInterruptorContactos } from './helpers/interruptor-contactos.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}
delete process.env.DATABASE_URL;

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');
const ADMIN = 'Bearer ' + jwt.sign({ id: 99, name: 'Tester', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
const VENDEDOR = 'Bearer ' + jwt.sign({ id: 7, name: 'Memo', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });
const RUTA = '/api/admin/contactos-operam-escritura';

let restaurar;
before(() => { restaurar = fijarInterruptorContactos(undefined); });
after(() => restaurar());

test('D6 sin la variable: el panel recibe modo apagado y el aviso con el valor de hoy', async () => {
  fijarInterruptorContactos(undefined);
  const res = await supertest(app).get(RUTA).set('Authorization', ADMIN);
  assert.equal(res.status, 200);
  assert.equal(res.body.variable, 'CONTACTOS_OPERAM_ESCRITURA');
  assert.equal(res.body.valor, '');
  assert.equal(res.body.modo, 'apagado');
  assert.deepEqual(res.body.clientes, []);
  assert.match(res.body.aviso, /no escribe Contactos de entrega en Operam/);
  assert.match(res.body.aviso, /CONTACTOS_OPERAM_ESCRITURA no tiene valor/);
});

test('D6 con una lista: modo lista con sus Clientes Operam y el aviso que los nombra', async () => {
  fijarInterruptorContactos('15');
  const res = await supertest(app).get(RUTA).set('Authorization', ADMIN);
  assert.equal(res.body.modo, 'lista');
  assert.deepEqual(res.body.clientes, ['15']);
  assert.match(res.body.aviso, /solo escribe Contactos de entrega en Operam para el Cliente Operam 15/);
});

test('D6 con `todos`: sin aviso', async () => {
  fijarInterruptorContactos('todos');
  const res = await supertest(app).get(RUTA).set('Authorization', ADMIN);
  assert.equal(res.body.modo, 'todos');
  assert.equal(res.body.aviso, null);
});

test('D6 la ruta es solo de administradores', async () => {
  const res = await supertest(app).get(RUTA).set('Authorization', VENDEDOR);
  assert.equal(res.status, 403);
});
