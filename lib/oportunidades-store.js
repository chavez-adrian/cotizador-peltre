import { existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from './fs-reintento.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { query } from './db.js';

// Persistencia de la Oportunidad pre-cotizacion (#343, spec #337, ADR-0016):
// Postgres (Neon) con DATABASE_URL, fallback a data/oportunidades.json sin ella
// (dev local y tests). Mismo patron que lib/prospectos-store.js.
//
// El registro guarda SOLO la intencion de compra: de quien es (contacto_id +
// contacto10, la llave de identidad del Contacto), quien la trabaja, en que
// etapa va y su historial. Los datos de la persona siguen en `prospectos`, que
// desde este ticket es la tabla de Contactos.

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, '..', 'data', 'oportunidades.json');
const PROSPECTOS_JSON_PATH = join(__dirname, '..', 'data', 'prospectos.json');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS oportunidades (
    id INTEGER PRIMARY KEY,
    fecha TIMESTAMPTZ NOT NULL,
    contacto_id INTEGER NOT NULL,
    contacto10 TEXT NOT NULL,
    vendedor TEXT,
    etapa TEXT NOT NULL DEFAULT 'por_cotizar',
    eventos JSONB NOT NULL DEFAULT '[]',
    data JSONB
  )
`;

const INDICE = 'CREATE INDEX IF NOT EXISTS oportunidades_contacto_idx ON oportunidades (contacto_id)';

let schemaListo = null;
export async function ensureSchema() {
  if (!schemaListo) {
    schemaListo = query(SCHEMA).then(r => (r === null ? null : query(INDICE)));
  }
  return schemaListo;
}

function leerJson(path) {
  if (!existsSync(path)) return [];
  return JSON.parse(leerArchivoSync(path));
}

function escribirJson(data) {
  escribirArchivoSync(JSON_PATH, JSON.stringify(data, null, 2));
}

function filaAEntrada(row) {
  return {
    id: row.id,
    fecha: row.fecha instanceof Date ? row.fecha.toISOString() : row.fecha,
    contactoId: row.contacto_id,
    contacto10: row.contacto10,
    vendedor: row.vendedor,
    etapa: row.etapa,
    eventos: row.eventos || [],
    data: row.data || {},
  };
}

export async function listar() {
  await ensureSchema();
  const r = await query('SELECT * FROM oportunidades ORDER BY id');
  if (r === null) return leerJson(JSON_PATH);
  return r.rows.map(filaAEntrada);
}

export async function obtener(id) {
  await ensureSchema();
  const r = await query('SELECT * FROM oportunidades WHERE id = $1', [id]);
  if (r === null) return leerJson(JSON_PATH).find(o => o.id === id);
  return r.rows[0] ? filaAEntrada(r.rows[0]) : undefined;
}

// Contactos y Oportunidades comparten UN espacio de ids (#343). No es un lujo:
// mientras la separacion no ha corrido, un Contacto sin registro propio SIGUE
// siendo su propia Oportunidad con el id de su fila de `prospectos`
// (lib/oportunidad-pre.js), asi que dos ids iguales serian dos tarjetas
// distintas con el mismo identificador en las rutas. Por eso las dos tablas
// toman el siguiente id del maximo de AMBAS.
//
// `entry.id` explicito es el caso de la separacion: la Oportunidad que ya
// representaba a un Contacto conserva SU id, y ninguna liga abierta en pantalla
// se rompe cuando la migracion corre.
export async function crear(entry) {
  await ensureSchema();
  const r = await query(
    `INSERT INTO oportunidades (id, fecha, contacto_id, contacto10, vendedor, etapa, eventos, data)
     VALUES (
       COALESCE($8::int, (SELECT GREATEST(
          (SELECT COALESCE(MAX(id), 0) FROM oportunidades),
          (SELECT COALESCE(MAX(id), 0) FROM prospectos)) + 1)),
       $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
     RETURNING id`,
    [entry.fecha, entry.contactoId, entry.contacto10, entry.vendedor ?? null,
      entry.etapa, JSON.stringify(entry.eventos || []), JSON.stringify(entry.data || {}),
      entry.id ?? null]
  );
  if (r === null) {
    const log = leerJson(JSON_PATH);
    const maxOportunidad = log.reduce((m, o) => Math.max(m, o.id), 0);
    const maxContacto = leerJson(PROSPECTOS_JSON_PATH).reduce((m, p) => Math.max(m, p.id), 0);
    const id = entry.id ?? Math.max(maxOportunidad, maxContacto) + 1;
    log.push({
      id, fecha: entry.fecha, contactoId: entry.contactoId, contacto10: entry.contacto10,
      vendedor: entry.vendedor ?? null, etapa: entry.etapa,
      eventos: entry.eventos || [], data: entry.data || {},
    });
    escribirJson(log);
    return id;
  }
  return r.rows[0].id;
}

export async function registrarEvento(id, evento) {
  await ensureSchema();
  const r = await query(
    'UPDATE oportunidades SET eventos = eventos || $2::jsonb WHERE id = $1 RETURNING eventos',
    [id, JSON.stringify([evento])]
  );
  if (r === null) {
    const log = leerJson(JSON_PATH);
    const entry = log.find(o => o.id === id);
    if (!entry) return null;
    entry.eventos = entry.eventos || [];
    entry.eventos.push(evento);
    escribirJson(log);
    return entry.eventos;
  }
  return r.rows[0] ? r.rows[0].eventos : null;
}

export async function cambiarEtapa(id, etapa, evento) {
  await ensureSchema();
  const r = await query(
    'UPDATE oportunidades SET etapa = $2, eventos = eventos || $3::jsonb WHERE id = $1',
    [id, etapa, JSON.stringify([evento])]
  );
  if (r === null) {
    const log = leerJson(JSON_PATH);
    const entry = log.find(o => o.id === id);
    if (!entry) return false;
    entry.etapa = etapa;
    entry.eventos = entry.eventos || [];
    entry.eventos.push(evento);
    escribirJson(log);
    return true;
  }
  return r.rowCount > 0;
}

export async function asignarVendedor(id, vendedor, etapa, evento) {
  await ensureSchema();
  const r = await query(
    'UPDATE oportunidades SET vendedor = $2, etapa = $3, eventos = eventos || $4::jsonb WHERE id = $1',
    [id, vendedor, etapa, JSON.stringify([evento])]
  );
  if (r === null) {
    const log = leerJson(JSON_PATH);
    const entry = log.find(o => o.id === id);
    if (!entry) return false;
    entry.vendedor = vendedor;
    entry.etapa = etapa;
    entry.eventos = entry.eventos || [];
    entry.eventos.push(evento);
    escribirJson(log);
    return true;
  }
  return r.rowCount > 0;
}

export async function moverASeguimientoConFolio(id, folio, evento) {
  await ensureSchema();
  const merge = JSON.stringify({ folioOperam: String(folio) });
  const r = await query(
    "UPDATE oportunidades SET etapa = 'seguimiento', data = COALESCE(data, '{}'::jsonb) || $2::jsonb, eventos = eventos || $3::jsonb WHERE id = $1",
    [id, merge, JSON.stringify([evento])]
  );
  if (r === null) {
    const log = leerJson(JSON_PATH);
    const entry = log.find(o => o.id === id);
    if (!entry) return false;
    entry.etapa = 'seguimiento';
    entry.data = { ...(entry.data || {}), folioOperam: String(folio) };
    entry.eventos = entry.eventos || [];
    entry.eventos.push(evento);
    escribirJson(log);
    return true;
  }
  return r.rowCount > 0;
}
