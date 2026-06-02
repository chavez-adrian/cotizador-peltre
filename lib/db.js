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
}

export async function query(sql, params) {
  if (!pool) return null;
  const res = await pool.query(sql, params);
  return res;
}
