import { existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from './fs-reintento.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { query } from './db.js';

// Estado persistido por barrido de sincronizacion de contactos a Google
// (issue #230, padre #224): ultima corrida, ultima corrida EXITOSA, totales
// de la ultima pasada y sus errores clasificados. Llave = nombre del barrido
// ('prospectos' hoy; #228 agregara 'clientes') para que un barrido nuevo
// entre sin cambiar este modulo. Postgres (Neon) con DATABASE_URL, fallback a
// data/contactos-google-barridos.json sin ella -- mismo patron que
// lib/contactos-store.js.

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, '..', 'data', 'contactos-google-barridos.json');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS contactos_google_barridos (
    nombre_barrido        TEXT PRIMARY KEY,
    ultima_corrida         TIMESTAMPTZ,
    ultima_corrida_exitosa TIMESTAMPTZ,
    creados                INTEGER NOT NULL DEFAULT 0,
    actualizados           INTEGER NOT NULL DEFAULT 0,
    inactivados            INTEGER NOT NULL DEFAULT 0,
    errores                JSONB NOT NULL DEFAULT '[]',
    ultimo_aviso           TIMESTAMPTZ
  )
`;

// totales (issue #257): objeto LIBRE por barrido (leidos/filas/descartes del
// sondeo de Shopify, por ejemplo), sin forma fija para este modulo. Columna
// nueva sobre una tabla que ya existe en produccion -- ALTER, no CREATE.
const SCHEMA_TOTALES = `ALTER TABLE contactos_google_barridos ADD COLUMN IF NOT EXISTS totales JSONB`;

let schemaListo = null;
async function ensureSchema() {
  if (!schemaListo) {
    schemaListo = (async () => {
      await query(SCHEMA);
      await query(SCHEMA_TOTALES);
    })();
  }
  return schemaListo;
}

function leerJson() {
  if (!existsSync(JSON_PATH)) return {};
  return JSON.parse(leerArchivoSync(JSON_PATH));
}

function escribirJson(data) {
  escribirArchivoSync(JSON_PATH, JSON.stringify(data, null, 2));
}

function filaAEstado(row) {
  return {
    ultimaCorrida: row.ultima_corrida ? new Date(row.ultima_corrida).toISOString() : null,
    ultimaCorridaExitosa: row.ultima_corrida_exitosa ? new Date(row.ultima_corrida_exitosa).toISOString() : null,
    creados: row.creados, actualizados: row.actualizados, inactivados: row.inactivados,
    errores: row.errores || [],
    ultimoAviso: row.ultimo_aviso ? new Date(row.ultimo_aviso).toISOString() : null,
    totales: row.totales ?? null,
  };
}

export async function leer(nombreBarrido) {
  await ensureSchema();
  const r = await query('SELECT * FROM contactos_google_barridos WHERE nombre_barrido = $1', [nombreBarrido]);
  if (r === null) return leerJson()[nombreBarrido] || null;
  return r.rows[0] ? filaAEstado(r.rows[0]) : null;
}

// Todos los barridos registrados, para la vista de admin (issue #230): hoy
// solo 'prospectos', #228 agregara 'clientes' sin tocar este modulo.
export async function listarTodos() {
  await ensureSchema();
  const r = await query('SELECT * FROM contactos_google_barridos ORDER BY nombre_barrido');
  if (r === null) {
    const data = leerJson();
    return Object.keys(data).sort().map(nombreBarrido => ({ nombreBarrido, ...data[nombreBarrido] }));
  }
  return r.rows.map(row => ({ nombreBarrido: row.nombre_barrido, ...filaAEstado(row) }));
}

export async function guardar(nombreBarrido, estado) {
  await ensureSchema();
  const {
    ultimaCorrida, ultimaCorridaExitosa, creados, actualizados, inactivados, errores, ultimoAviso, totales,
  } = estado;
  const r = await query(
    `INSERT INTO contactos_google_barridos
       (nombre_barrido, ultima_corrida, ultima_corrida_exitosa, creados, actualizados, inactivados, errores, ultimo_aviso, totales)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (nombre_barrido) DO UPDATE SET
       ultima_corrida = EXCLUDED.ultima_corrida,
       ultima_corrida_exitosa = EXCLUDED.ultima_corrida_exitosa,
       creados = EXCLUDED.creados,
       actualizados = EXCLUDED.actualizados,
       inactivados = EXCLUDED.inactivados,
       errores = EXCLUDED.errores,
       ultimo_aviso = EXCLUDED.ultimo_aviso,
       totales = EXCLUDED.totales`,
    [
      nombreBarrido, ultimaCorrida ?? null, ultimaCorridaExitosa ?? null,
      creados || 0, actualizados || 0, inactivados || 0,
      JSON.stringify(errores || []), ultimoAviso ?? null,
      totales ? JSON.stringify(totales) : null,
    ]
  );
  if (r === null) {
    const data = leerJson();
    data[nombreBarrido] = {
      ultimaCorrida: ultimaCorrida ?? null, ultimaCorridaExitosa: ultimaCorridaExitosa ?? null,
      creados: creados || 0, actualizados: actualizados || 0, inactivados: inactivados || 0,
      errores: errores || [], ultimoAviso: ultimoAviso ?? null,
      totales: totales || null,
    };
    escribirJson(data);
  }
  return true;
}
