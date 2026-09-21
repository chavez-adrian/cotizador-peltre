import { existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from './fs-reintento.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { query } from './db.js';

// Intentos de subida a Dropbox, uno por fila (issue #356, hijo de #354): flujo
// de origen, destino pretendido, nombre del archivo, resultado, mensaje de
// error y momento. Desde #399 tambien el NAMESPACE contra el que viajo la
// subida: la ruta sola no dice si el archivo cayo en el Dropbox real o en el
// sandbox de la app (las dos filas decian "Subido"). Sin namespace = sandbox. Las subidas son fire-and-forget en los tres flujos del repo
// (constancia fiscal, posicion de calca, backup del export de Bitrix) y hasta
// #356 su fallo solo llegaba a console.error, donde nadie lo ve: #354 es el
// caso real de una integracion escribiendo meses en el lugar equivocado con
// exito aparente. Postgres (Neon) con DATABASE_URL, fallback a
// data/dropbox-subidas.json sin ella -- mismo patron que
// lib/contactos-observabilidad-store.js.
//
// NINGUNA funcion de aqui lanza: registrar es el ultimo eslabon de una cadena
// fire-and-forget y un fallo suyo (Neon caido, disco bloqueado) jamas puede
// alterar una respuesta HTTP ni un exit code.

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, '..', 'data', 'dropbox-subidas.json');

// El fallback de disco es un log: sin tope creceria sin fin. En Neon no hace
// falta (la tabla se consulta con LIMIT).
const MAX_JSON = 500;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS dropbox_subidas (
    id         SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    flujo      TEXT NOT NULL,
    destino    TEXT NOT NULL,
    archivo    TEXT,
    ok         BOOLEAN NOT NULL,
    error_msg  TEXT
  )
`;

// La tabla ya existe en produccion desde #356: la columna de #399 entra aparte.
// Las filas anteriores quedan en NULL, que es lo que fueron (o se infieren por
// su ruta: lib/dropbox-destinos.js#lugarDeSubida).
const SCHEMA_NAMESPACE = 'ALTER TABLE dropbox_subidas ADD COLUMN IF NOT EXISTS namespace TEXT';

let schemaListo = null;
async function ensureSchema() {
  if (!schemaListo) schemaListo = query(SCHEMA).then(() => query(SCHEMA_NAMESPACE));
  return schemaListo;
}

function leerJson() {
  if (!existsSync(JSON_PATH)) return [];
  const filas = JSON.parse(leerArchivoSync(JSON_PATH));
  return Array.isArray(filas) ? filas : [];
}

// El destino pretendido es la ruta completa; el nombre del archivo es su ultimo
// tramo, que es lo que se busca de un vistazo en el panel.
function nombreDeArchivo(destino) {
  const tramos = String(destino || '').split('/');
  return tramos[tramos.length - 1] || null;
}

function filaASubida(row) {
  return {
    momento: row.created_at ? new Date(row.created_at).toISOString() : null,
    flujo: row.flujo,
    destino: row.destino,
    namespace: row.namespace ?? null,
    archivo: row.archivo ?? null,
    ok: row.ok,
    error: row.error_msg ?? null,
  };
}

export async function registrar({ flujo, destino, namespace, ok, error } = {}) {
  try {
    await ensureSchema();
    const subida = {
      flujo: flujo || 'desconocido',
      destino: destino || '',
      namespace: namespace || null,
      archivo: nombreDeArchivo(destino),
      ok: ok === true,
      error: error || null,
    };
    const r = await query(
      'INSERT INTO dropbox_subidas (flujo, destino, namespace, archivo, ok, error_msg) VALUES ($1,$2,$3,$4,$5,$6)',
      [subida.flujo, subida.destino, subida.namespace, subida.archivo, subida.ok, subida.error]
    );
    if (r === null) {
      const filas = leerJson();
      filas.push({ momento: new Date().toISOString(), ...subida });
      escribirArchivoSync(JSON_PATH, JSON.stringify(filas.slice(-MAX_JSON), null, 2));
    }
    return true;
  } catch (err) {
    console.error('[dropbox] Error registrando la subida:', err.message);
    return false;
  }
}

export async function listarRecientes(limite = 100) {
  try {
    await ensureSchema();
    const r = await query(
      'SELECT * FROM dropbox_subidas ORDER BY created_at DESC, id DESC LIMIT $1', [limite]
    );
    if (r === null) return leerJson().slice(-limite).reverse().map(f => ({ ...f, namespace: f.namespace ?? null }));
    return r.rows.map(filaASubida);
  } catch (err) {
    console.error('[dropbox] Error leyendo las subidas:', err.message);
    return [];
  }
}
