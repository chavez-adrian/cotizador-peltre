import { test } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';

const { app } = await import('../server.js');

// La Tabla de prospectos se sirve sin token PORQUE no lleva datos: es un
// cascaron que le pide los prospectos a /api/prospectos/tabla con el token del
// vendedor. Esa es toda la seguridad de la pantalla, asi que se verifica aqui
// en vez de confiarla a la revision: si alguien alguna vez incrusta datos en el
// HTML para "ahorrarse una llamada", la liga pasa a exponer el padron completo.
test('GET /prospectos entrega la vista', async () => {
  const res = await supertest(app).get('/prospectos');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /html/);
  assert.match(res.text, /<title>Prospectos - Cotizador Peltre Nacional<\/title>/);
});

test('GET /prospectos no incrusta ningun dato de prospectos en el HTML', async () => {
  const res = await supertest(app).get('/prospectos');
  // Las llaves con las que viajaria un prospecto serializado. `celular10` es la
  // llave de identidad y no tiene por que aparecer nunca en una plantilla.
  for (const llave of ['celular10', 'clientes_log', '"celular"', '"vendedor":']) {
    assert.equal(res.text.includes(llave), false, `el HTML incrusta ${llave}`);
  }
});

test('GET /prospectos pide a los buscadores que no la indexen', async () => {
  const res = await supertest(app).get('/prospectos');
  assert.match(res.text, /<meta name="robots" content="noindex/);
});

// --- #317: cualquier prospecto, Origen y /prospectos ---
// La liga vieja sigue sirviendo: el vendedor la tiene guardada en el telefono
// desde la feria.
test('GET /leads redirige a /prospectos', async () => {
  const res = await supertest(app).get('/leads');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/prospectos');
});
