import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { query } from './db.js';
import { migrarCotizacion } from './migrar-pipeline.js';

// Persistencia de cotizaciones: Postgres (Neon) cuando hay DATABASE_URL,
// fallback a data/cotizaciones.json cuando no (dev local y tests).
// El id lo asigna el store de forma secuencial en ambos backends para
// conservar la numeracion historica de cotizaciones.

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, '..', 'data', 'cotizaciones.json');

const SCHEMA = `
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
`;

let schemaListo = null;
async function ensureSchema() {
  if (!schemaListo) schemaListo = query(SCHEMA);
  return schemaListo;
}

function leerJson() {
  if (!existsSync(JSON_PATH)) return [];
  return JSON.parse(readFileSync(JSON_PATH, 'utf8'));
}

function escribirJson(data) {
  writeFileSync(JSON_PATH, JSON.stringify(data, null, 2));
}

// La lectura es la frontera de la migracion al pipeline (issue #53, ADR-0005):
// cada cotizacion sale con su etapa del embudo derivada del estado
// (abierta/ganada -> seguimiento; perdida/descartada -> perdida). Idempotente:
// una cotizacion que ya trae etapa del pipeline (futuro post-venta) la conserva.
function filaAEntrada(row) {
  return migrarCotizacion({
    id: row.id,
    fecha: row.fecha instanceof Date ? row.fecha.toISOString() : row.fecha,
    vendedor: row.vendedor,
    cliente: row.cliente,
    totalPiezas: row.total_piezas,
    total: row.total === null ? 0 : Number(row.total),
    tier: row.tier,
    ...(row.estado ? { estado: row.estado } : {}),
    seguimientos: row.seguimientos || [],
    data: row.data,
  });
}

export async function listar() {
  await ensureSchema();
  const r = await query('SELECT * FROM cotizaciones ORDER BY id');
  if (r === null) return leerJson().map(migrarCotizacion);
  return r.rows.map(filaAEntrada);
}

export async function obtener(id) {
  await ensureSchema();
  const r = await query('SELECT * FROM cotizaciones WHERE id = $1', [id]);
  if (r === null) {
    const c = leerJson().find(c => c.id === id);
    return c ? migrarCotizacion(c) : undefined;
  }
  return r.rows[0] ? filaAEntrada(r.rows[0]) : undefined;
}

export async function crear(entry) {
  await ensureSchema();
  const r = await query(
    `INSERT INTO cotizaciones (id, fecha, vendedor, cliente, total_piezas, total, tier, data)
     VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM cotizaciones), $1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [entry.fecha, entry.vendedor, entry.cliente, entry.totalPiezas || 0, entry.total || 0, entry.tier || '', JSON.stringify(entry.data || {})]
  );
  if (r === null) {
    const log = leerJson();
    const id = log.reduce((m, c) => Math.max(m, c.id), 0) + 1;
    log.push({ id, ...entry });
    escribirJson(log);
    return id;
  }
  return r.rows[0].id;
}

export async function registrarSeguimiento(id, seguimiento) {
  await ensureSchema();
  const r = await query(
    `UPDATE cotizaciones SET seguimientos = seguimientos || $2::jsonb WHERE id = $1 RETURNING seguimientos`,
    [id, JSON.stringify([seguimiento])]
  );
  if (r === null) {
    const log = leerJson();
    const entry = log.find(c => c.id === id);
    if (!entry) return null;
    entry.seguimientos = entry.seguimientos || [];
    entry.seguimientos.push(seguimiento);
    escribirJson(log);
    return entry.seguimientos;
  }
  return r.rows[0] ? r.rows[0].seguimientos : null;
}

export async function setEstado(id, estado) {
  await ensureSchema();
  const r = await query('UPDATE cotizaciones SET estado = $2 WHERE id = $1', [id, estado]);
  if (r === null) {
    const log = leerJson();
    const entry = log.find(c => c.id === id);
    if (!entry) return false;
    entry.estado = estado;
    escribirJson(log);
    return true;
  }
  return r.rowCount > 0;
}
