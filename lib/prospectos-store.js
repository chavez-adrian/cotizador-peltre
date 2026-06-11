import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { query } from './db.js';

// Persistencia de prospectos (ADR-0004, issue #41): Postgres (Neon) cuando hay
// DATABASE_URL, fallback a data/prospectos.json cuando no (dev local y tests).
// Mismo patron que lib/cotizaciones-store.js. Identidad: 1 celular = 1 prospecto,
// comparacion por los ultimos 10 digitos del numero nacional (CONTEXT.md).

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, '..', 'data', 'prospectos.json');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS prospectos (
    id INTEGER PRIMARY KEY,
    fecha TIMESTAMPTZ NOT NULL,
    vendedor TEXT,
    celular TEXT NOT NULL,
    celular10 TEXT NOT NULL,
    nombre TEXT,
    ciudad TEXT,
    canal TEXT,
    etapa TEXT NOT NULL DEFAULT 'nuevo',
    eventos JSONB NOT NULL DEFAULT '[]',
    data JSONB
  )
`;

const INDICE_UNICO = 'CREATE UNIQUE INDEX IF NOT EXISTS prospectos_celular10_uniq ON prospectos (celular10)';

// Migracion para tablas creadas antes de #43 (la columna eventos no existia).
const MIGRACION_EVENTOS = "ALTER TABLE prospectos ADD COLUMN IF NOT EXISTS eventos JSONB NOT NULL DEFAULT '[]'";

let schemaListo = null;
async function ensureSchema() {
  if (!schemaListo) {
    schemaListo = query(SCHEMA).then(r =>
      (r === null ? null : query(INDICE_UNICO).then(() => query(MIGRACION_EVENTOS)))
    );
  }
  return schemaListo;
}

export function ultimos10(celular) {
  return String(celular || '').replace(/\D/g, '').slice(-10);
}

function leerJson() {
  if (!existsSync(JSON_PATH)) return [];
  return JSON.parse(readFileSync(JSON_PATH, 'utf8'));
}

function escribirJson(data) {
  writeFileSync(JSON_PATH, JSON.stringify(data, null, 2));
}

function filaAEntrada(row) {
  return {
    id: row.id,
    fecha: row.fecha instanceof Date ? row.fecha.toISOString() : row.fecha,
    vendedor: row.vendedor,
    celular: row.celular,
    celular10: row.celular10,
    nombre: row.nombre,
    ciudad: row.ciudad,
    canal: row.canal,
    etapa: row.etapa,
    eventos: row.eventos || [],
    data: row.data,
  };
}

export async function listar() {
  await ensureSchema();
  const r = await query('SELECT * FROM prospectos ORDER BY id');
  if (r === null) return leerJson();
  return r.rows.map(filaAEntrada);
}

export async function buscarPorCelular(celular) {
  const c10 = ultimos10(celular);
  if (!c10) return undefined;
  await ensureSchema();
  const r = await query('SELECT * FROM prospectos WHERE celular10 = $1', [c10]);
  if (r === null) return leerJson().find(p => p.celular10 === c10);
  return r.rows[0] ? filaAEntrada(r.rows[0]) : undefined;
}

export async function obtener(id) {
  await ensureSchema();
  const r = await query('SELECT * FROM prospectos WHERE id = $1', [id]);
  if (r === null) return leerJson().find(p => p.id === id);
  return r.rows[0] ? filaAEntrada(r.rows[0]) : undefined;
}

export async function registrarEvento(id, evento) {
  await ensureSchema();
  const r = await query(
    'UPDATE prospectos SET eventos = eventos || $2::jsonb WHERE id = $1 RETURNING eventos',
    [id, JSON.stringify([evento])]
  );
  if (r === null) {
    const log = leerJson();
    const entry = log.find(p => p.id === id);
    if (!entry) return null;
    entry.eventos = entry.eventos || [];
    entry.eventos.push(evento);
    escribirJson(log);
    return entry.eventos;
  }
  return r.rows[0] ? r.rows[0].eventos : null;
}

// Liga el prospecto al cliente Operam en el que se convirtio (issue #42):
// guarda la referencia en data.cliente_id y registra el evento en el historial.
export async function ligarCliente(id, clienteId, evento) {
  await ensureSchema();
  const r = await query(
    "UPDATE prospectos SET data = COALESCE(data, '{}'::jsonb) || $2::jsonb, eventos = eventos || $3::jsonb WHERE id = $1",
    [id, JSON.stringify({ cliente_id: clienteId }), JSON.stringify([evento])]
  );
  if (r === null) {
    const log = leerJson();
    const entry = log.find(p => p.id === id);
    if (!entry) return false;
    entry.data = { ...(entry.data || {}), cliente_id: clienteId };
    entry.eventos = entry.eventos || [];
    entry.eventos.push(evento);
    escribirJson(log);
    return true;
  }
  return r.rowCount > 0;
}

export async function cambiarEtapa(id, etapa, evento) {
  await ensureSchema();
  const r = await query(
    'UPDATE prospectos SET etapa = $2, eventos = eventos || $3::jsonb WHERE id = $1',
    [id, etapa, JSON.stringify([evento])]
  );
  if (r === null) {
    const log = leerJson();
    const entry = log.find(p => p.id === id);
    if (!entry) return false;
    entry.etapa = etapa;
    entry.eventos = entry.eventos || [];
    entry.eventos.push(evento);
    escribirJson(log);
    return true;
  }
  return r.rowCount > 0;
}

export async function crear(entry) {
  const celular10 = ultimos10(entry.celular);
  const etapa = entry.etapa || 'nuevo';
  await ensureSchema();
  const r = await query(
    `INSERT INTO prospectos (id, fecha, vendedor, celular, celular10, nombre, ciudad, canal, etapa, data)
     VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM prospectos), $1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [entry.fecha, entry.vendedor, entry.celular, celular10, entry.nombre, entry.ciudad, entry.canal, etapa, JSON.stringify(entry.data || {})]
  );
  if (r === null) {
    const log = leerJson();
    if (log.some(p => p.celular10 === celular10)) {
      throw Object.assign(new Error('celular duplicado'), { code: '23505' });
    }
    const id = log.reduce((m, p) => Math.max(m, p.id), 0) + 1;
    log.push({ id, ...entry, celular10, etapa, eventos: [], data: entry.data || {} });
    escribirJson(log);
    return id;
  }
  return r.rows[0].id;
}
