import pg from 'pg';
const { Pool } = pg;

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

if (pool) {
  pool.query(`
    CREATE TABLE IF NOT EXISTS clientes_log (
      id          SERIAL PRIMARY KEY,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      rfc         TEXT NOT NULL,
      nombre      TEXT,
      resultado   TEXT,
      cliente_id  INTEGER,
      fuente      TEXT,
      dropbox_ok  BOOLEAN,
      error_msg   TEXT
    )
  `).catch(err => console.error('[db] Error creando clientes_log:', err.message));

  // Log idempotente de webhooks de Operam (issue #62, sync post-venta). event_key
  // unico evita reprocesar el mismo evento; el payload crudo queda para auditoria.
  pool.query(`
    CREATE TABLE IF NOT EXISTS operam_webhooks_log (
      id            SERIAL PRIMARY KEY,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      event_key     TEXT UNIQUE,
      modelo        TEXT,
      identificador TEXT,
      payload       JSONB,
      procesado_en  TIMESTAMPTZ,
      resultado     TEXT
    )
  `).catch(err => console.error('[db] Error creando operam_webhooks_log:', err.message));
}

export async function query(sql, params) {
  if (!pool) return null;
  const res = await pool.query(sql, params);
  return res;
}

// Transaccion sobre un solo client del pool, para escrituras multi-statement
// que no pueden quedar a medias (p. ej. el DELETE+INSERT del registro de
// vendedores: un fallo entre ambos dejaria la tabla vacia). Regresa null sin
// pool, como query().
export async function transaccion(fn) {
  if (!pool) return null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await fn((sql, params) => client.query(sql, params));
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
