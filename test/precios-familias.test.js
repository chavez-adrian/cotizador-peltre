// #312: el indice modelo -> familia viaja al navegador DENTRO del catalogo que
// el servidor ya le manda (GET /api/precios). El Resumen de la cotizacion se
// arma en el navegador y sin este indice no podria agrupar por Familia de
// producto; una llamada aparte solo para 36 renglones seria un viaje de mas.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}
// Misma defensa que la suite del maestro de articulos: sin DATABASE_URL el store
// cae al archivo versionado y ningun test le pega a Neon real.
delete process.env.DATABASE_URL;

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');

const TOKEN = jwt.sign({ id: 2, name: 'Vendedor Test', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });

let body;
before(async () => {
  const res = await supertest(app).get('/api/precios').set('Authorization', `Bearer ${TOKEN}`);
  assert.equal(res.status, 200);
  body = res.body;
});

test('GET /api/precios entrega el indice de familias por modelo', () => {
  assert.equal(body.familias.VA05, 'taza');
  assert.equal(body.familias.PL27, 'plato');
  assert.equal(body.familias.TA14, 'tazón');
});

// El indice es por MODELO (los 4 primeros caracteres del SKU, ADR-0016), no por
// SKU: 36 llaves, no 1,268.
test('el indice esta indexado por modelo y cubre el maestro completo', () => {
  const modelos = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'modelos.json'), 'utf8'));
  assert.equal(Object.keys(body.familias).length, modelos.length);
  assert.ok(Object.keys(body.familias).every(m => m.length === 4));
});
