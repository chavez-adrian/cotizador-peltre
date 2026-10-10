import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';

// /health dice que commit sirve produccion (Render pone RENDER_GIT_COMMIT en cada deploy):
// asi se espera un deploy comparando contra el hash, sin buscar un texto en un JS servido.
const previo = process.env.RENDER_GIT_COMMIT;
const { app } = await import('../server.js');

after(() => {
  if (previo === undefined) delete process.env.RENDER_GIT_COMMIT;
  else process.env.RENDER_GIT_COMMIT = previo;
});

test('/health responde el commit desplegado', async () => {
  process.env.RENDER_GIT_COMMIT = '723d5651953c738c155ae2cb563bd79a37d9a338';
  const res = await supertest(app).get('/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: 'ok', commit: '723d5651953c738c155ae2cb563bd79a37d9a338' });
});

test('/health sin RENDER_GIT_COMMIT (local) responde commit null', async () => {
  delete process.env.RENDER_GIT_COMMIT;
  const res = await supertest(app).get('/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: 'ok', commit: null });
});
