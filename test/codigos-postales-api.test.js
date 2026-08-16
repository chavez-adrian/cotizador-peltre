import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const { app } = await import('../server.js');

// GET publico de CP (issue #160, ADR-0012 pto. 3): sin auth, solo lectura contra
// el indice de GeoNames commiteado en data/cp-mx.json / cp-us.json / cp-ca.json.
// Los CPs usados aqui son REALES del indice (verificados contra el .txt de
// GeoNames descargado el 2026-08-16), no fixtures inventados.

test('GET /api/cp/MX/56530: acierto responde Ixtapaluca, Estado de Mexico (el CP de la fabrica)', async () => {
  const res = await supertest(app).get('/api/cp/MX/56530');
  assert.equal(res.status, 200);
  assert.equal(res.body.ciudad, 'Ixtapaluca');
  assert.equal(res.body.estado, 'Estado de México');
});

test('GET /api/cp/MX/02000: los renglones de DF salen como Ciudad de Mexico', async () => {
  const res = await supertest(app).get('/api/cp/MX/02000');
  assert.equal(res.status, 200);
  assert.equal(res.body.estado, 'Ciudad de México');
});

test('GET /api/cp/US/90210: acierto responde ciudad + abreviatura de estado', async () => {
  const res = await supertest(app).get('/api/cp/US/90210');
  assert.equal(res.status, 200);
  assert.equal(res.body.ciudad, 'Beverly Hills');
  assert.equal(res.body.estado, 'CA');
});

test('GET /api/cp/CA/M5V%203L9: acierto por FSA aunque se teclee el codigo completo', async () => {
  const res = await supertest(app).get('/api/cp/CA/M5V%203L9');
  assert.equal(res.status, 200);
  assert.equal(res.body.estado, 'Ontario');
  assert.match(res.body.ciudad, /Downtown Toronto/);
});

test('GET /api/cp/MX/1234: formato invalido (menos de 5 digitos) se rechaza con 400', async () => {
  const res = await supertest(app).get('/api/cp/MX/1234');
  assert.equal(res.status, 400);
});

test('GET /api/cp/CA/123: formato invalido de CA se rechaza con 400', async () => {
  const res = await supertest(app).get('/api/cp/CA/123');
  assert.equal(res.status, 400);
});

test('GET /api/cp/FR/75001: pais fuera del catalogo (MX/US/CA) se rechaza con 400', async () => {
  const res = await supertest(app).get('/api/cp/FR/75001');
  assert.equal(res.status, 400);
});

test('GET /api/cp/MX/99999: formato valido pero no encontrado responde 404', async () => {
  const res = await supertest(app).get('/api/cp/MX/99999');
  assert.equal(res.status, 404);
});

test('GET /api/cp/US/00000: formato valido pero no encontrado responde 404', async () => {
  const res = await supertest(app).get('/api/cp/US/00000');
  assert.equal(res.status, 404);
});

test('GET /api/cp/CA/Z9Z 9Z9: formato valido pero FSA inexistente (ninguno empieza con Z) responde 404', async () => {
  const res = await supertest(app).get('/api/cp/CA/' + encodeURIComponent('Z9Z 9Z9'));
  assert.equal(res.status, 404);
});

test('GET /api/cp no exige autenticacion (superficie publica del formulario)', async () => {
  const res = await supertest(app).get('/api/cp/MX/56530');
  assert.notEqual(res.status, 401);
});
