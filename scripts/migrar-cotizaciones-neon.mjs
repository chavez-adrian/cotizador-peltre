// Migracion unica de data/cotizaciones.json a la tabla cotizaciones en Neon.
// Uso: node scripts/migrar-cotizaciones-neon.mjs <ruta-al-.env-con-DATABASE_URL>
// Idempotente: ON CONFLICT (id) DO NOTHING.
// Excluye entradas generadas por la suite de tests (vendedor Test/Tester).

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = process.argv[2];
if (!envPath) {
  console.error('Falta la ruta al .env con DATABASE_URL');
  process.exit(1);
}

function urlDeEnv(path) {
  const buf = readFileSync(path);
  const texto = (buf[0] === 0xFF && buf[1] === 0xFE) ? buf.toString('utf16le') : buf.toString('utf8');
  for (const line of texto.split(/\r?\n/)) {
    const m = line.replace(/^﻿/, '').match(/^\s*DATABASE_URL\s*=\s*(.+)$/);
    if (m) return m[1].trim();
  }
  return null;
}

const url = urlDeEnv(envPath);
if (!url) {
  console.error(`No hay DATABASE_URL en ${envPath}`);
  process.exit(1);
}

const VENDEDORES_TEST = new Set(['Test', 'Tester']);
const cotizaciones = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'cotizaciones.json'), 'utf8'));

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });

await pool.query(`
  CREATE TABLE IF NOT EXISTS cotizaciones (
    id INTEGER PRIMARY KEY,
    fecha TIMESTAMPTZ NOT NULL,
    vendedor TEXT,
    cliente TEXT,
    total_piezas INTEGER,
    total NUMERIC,
    tier TEXT,
    estado TEXT,
    seguimientos JSONB NOT NULL DEFAULT '[]',
    data JSONB
  )
`);

let insertadas = 0, existentes = 0, excluidas = 0;
for (const c of cotizaciones) {
  if (VENDEDORES_TEST.has(c.vendedor)) { excluidas++; continue; }
  const r = await pool.query(
    `INSERT INTO cotizaciones (id, fecha, vendedor, cliente, total_piezas, total, tier, estado, seguimientos, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO NOTHING`,
    [c.id, c.fecha, c.vendedor || '', c.cliente || '', c.totalPiezas || 0, c.total || 0,
     c.tier || '', c.estado || null, JSON.stringify(c.seguimientos || []), JSON.stringify(c.data || {})]
  );
  if (r.rowCount === 1) insertadas++; else existentes++;
}

const total = await pool.query('SELECT COUNT(*)::int AS n, MAX(id) AS max_id FROM cotizaciones');
console.log(`Insertadas: ${insertadas} | ya existian: ${existentes} | excluidas (test): ${excluidas}`);
console.log(`Total en Neon: ${total.rows[0].n} | id maximo: ${total.rows[0].max_id}`);
await pool.end();
