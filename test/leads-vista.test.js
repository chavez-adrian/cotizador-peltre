import { test } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';

const { app } = await import('../server.js');

// La vista de leads de feria se sirve sin token PORQUE no lleva datos: es un
// cascaron que le pide los prospectos a /api/prospectos con el token del
// vendedor. Esa es toda la seguridad de la pantalla, asi que se verifica aqui
// en vez de confiarla a la revision: si alguien alguna vez incrusta datos en el
// HTML para "ahorrarse una llamada", la liga pasa a exponer el padron completo.
test('GET /leads entrega la vista', async () => {
  const res = await supertest(app).get('/leads');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /html/);
  assert.match(res.text, /Leads de feria/);
});

test('GET /leads no incrusta ningun dato de prospectos en el HTML', async () => {
  const res = await supertest(app).get('/leads');
  // Las llaves con las que viajaria un prospecto serializado. `celular10` es la
  // llave de identidad y no tiene por que aparecer nunca en una plantilla.
  for (const llave of ['celular10', 'clientes_log', '"celular"', '"vendedor":']) {
    assert.equal(res.text.includes(llave), false, `el HTML incrusta ${llave}`);
  }
});

test('GET /leads pide a los buscadores que no la indexen', async () => {
  const res = await supertest(app).get('/leads');
  assert.match(res.text, /<meta name="robots" content="noindex/);
});
