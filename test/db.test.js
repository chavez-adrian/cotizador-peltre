import { test } from 'node:test';
import assert from 'node:assert/strict';

const { query } = await import('../lib/db.js');

test('query() retorna null cuando DATABASE_URL no esta configurada', async () => {
  const result = await query('SELECT 1');
  assert.equal(result, null);
});
