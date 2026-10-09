import { existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from './fs-reintento.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { query } from './db.js';

// Cola PERSISTIDA de los post-fixes web del quote que no quedaron verificados (#380).
// Una fila por folio: lo que el post-fix debia dejar (vigencia, lista, transportista,
// desde #556 el telefono y el correo del Contacto de entrega, y la fecha del
// documento), cuantos reintentos lleva, cuando toca el siguiente y el
// motivo del ultimo fallo. `estado` = 'pendiente' (se reintenta) o 'avisado' (se agoto
// o el rechazo no es transitorio y ya se mando el correo: se queda para que el barrido
// diario no lo vuelva a encolar). En Neon con DATABASE_URL -- una cola en memoria se
// perderia en cada deploy de Render --; sin ella, data/postfix-pendientes.json, mismo
// patron que lib/contactos-observabilidad-store.js.

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, '..', 'data', 'postfix-pendientes.json');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS postfix_pendientes (
    folio            TEXT PRIMARY KEY,
    cotizacion_id    INTEGER,
    vendedor         TEXT,
    origen           TEXT NOT NULL,
    vigencia         TEXT,
    lista            TEXT,
    transportista    TEXT,
    fecha_documento  TEXT,
    estado           TEXT NOT NULL,
    intentos         INTEGER NOT NULL DEFAULT 0,
    proximo_intento  TIMESTAMPTZ,
    motivo           TEXT,
    creado           TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado      TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

// #556: el telefono y el correo del Contacto de entrega, una columna por campo como
// los demas. La tabla ya existe en produccion: se agregan sin tocar las filas, que
// quedan en NULL (encoladas antes de #556: no se intentaron, no se escriben).
const SCHEMA_TELEFONO_ENTREGA = `ALTER TABLE postfix_pendientes ADD COLUMN IF NOT EXISTS telefono_entrega TEXT`;
const SCHEMA_CORREO_ENTREGA = `ALTER TABLE postfix_pendientes ADD COLUMN IF NOT EXISTS correo_entrega TEXT`;

let schemaListo = null;
async function ensureSchema() {
  if (!schemaListo) {
    schemaListo = query(SCHEMA)
      .then(() => query(SCHEMA_TELEFONO_ENTREGA))
      .then(() => query(SCHEMA_CORREO_ENTREGA));
  }
  return schemaListo;
}

function leerJson() {
  if (!existsSync(JSON_PATH)) return [];
  return JSON.parse(leerArchivoSync(JSON_PATH));
}

function escribirJson(filas) {
  escribirArchivoSync(JSON_PATH, JSON.stringify(filas, null, 2));
}

const texto = (v) => (v == null || v === '' ? null : String(v));
// El telefono y el correo del Contacto de entrega (#556): el vacio es un valor que se
// intento escribir y se conserva; solo null/undefined es "no se intento".
const textoConVacio = (v) => (v == null ? null : String(v));
const iso = (v) => (v == null || v === '' ? null : new Date(v).toISOString());

// La forma unica de una fila, venga de Neon o del JSON.
function normalizar(p) {
  return {
    folio: String(p.folio),
    cotizacionId: p.cotizacionId ?? null,
    vendedor: p.vendedor ?? null,
    origen: p.origen ?? 'post-fix',
    vigencia: texto(p.vigencia),
    lista: texto(p.lista),
    transportista: texto(p.transportista),
    telefonoEntrega: textoConVacio(p.telefonoEntrega),
    correoEntrega: textoConVacio(p.correoEntrega),
    fechaDocumento: texto(p.fechaDocumento),
    estado: p.estado ?? 'pendiente',
    intentos: Number(p.intentos) || 0,
    proximoIntento: iso(p.proximoIntento),
    motivo: p.motivo ?? null,
  };
}

function filaAPendiente(row) {
  return normalizar({
    folio: row.folio, cotizacionId: row.cotizacion_id, vendedor: row.vendedor, origen: row.origen,
    vigencia: row.vigencia, lista: row.lista, transportista: row.transportista,
    telefonoEntrega: row.telefono_entrega, correoEntrega: row.correo_entrega,
    fechaDocumento: row.fecha_documento, estado: row.estado, intentos: row.intentos,
    proximoIntento: row.proximo_intento, motivo: row.motivo,
  });
}

const COLUMNAS = p => [
  p.folio, p.cotizacionId, p.vendedor, p.origen, p.vigencia, p.lista, p.transportista,
  p.fechaDocumento, p.estado, p.intentos, p.proximoIntento, p.motivo,
  p.telefonoEntrega, p.correoEntrega,
];

export async function listar() {
  await ensureSchema();
  const r = await query('SELECT * FROM postfix_pendientes ORDER BY creado, folio');
  if (r === null) return leerJson().map(normalizar);
  return r.rows.map(filaAPendiente);
}

// Mete el folio a la cola SOLO si no estaba: un segundo fallo del mismo quote (o el
// barrido que lo vuelve a ver) no le reinicia el backoff. true = se encolo.
export async function encolar(pendiente) {
  await ensureSchema();
  const p = normalizar(pendiente);
  const r = await query(
    `INSERT INTO postfix_pendientes
       (folio, cotizacion_id, vendedor, origen, vigencia, lista, transportista, fecha_documento, estado, intentos, proximo_intento, motivo, telefono_entrega, correo_entrega)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (folio) DO NOTHING`,
    COLUMNAS(p),
  );
  if (r !== null) return r.rowCount > 0;
  const filas = leerJson();
  if (filas.some(f => String(f.folio) === p.folio)) return false;
  filas.push(p);
  escribirJson(filas);
  return true;
}

// Reemplaza la fila del folio con lo que trae `pendiente` (intentos, proximo, estado,
// motivo). Es la escritura del worker despues de cada reintento.
export async function guardar(pendiente) {
  await ensureSchema();
  const p = normalizar(pendiente);
  const r = await query(
    `INSERT INTO postfix_pendientes
       (folio, cotizacion_id, vendedor, origen, vigencia, lista, transportista, fecha_documento, estado, intentos, proximo_intento, motivo, telefono_entrega, correo_entrega)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (folio) DO UPDATE SET
       cotizacion_id = EXCLUDED.cotizacion_id, vendedor = EXCLUDED.vendedor, origen = EXCLUDED.origen,
       vigencia = EXCLUDED.vigencia, lista = EXCLUDED.lista, transportista = EXCLUDED.transportista,
       fecha_documento = EXCLUDED.fecha_documento, estado = EXCLUDED.estado, intentos = EXCLUDED.intentos,
       proximo_intento = EXCLUDED.proximo_intento, motivo = EXCLUDED.motivo,
       telefono_entrega = EXCLUDED.telefono_entrega, correo_entrega = EXCLUDED.correo_entrega, actualizado = now()`,
    COLUMNAS(p),
  );
  if (r !== null) return true;
  const filas = leerJson().filter(f => String(f.folio) !== p.folio);
  filas.push(p);
  escribirJson(filas);
  return true;
}

// Sale de la cola: el reintento quedo verificado.
export async function borrar(folio) {
  await ensureSchema();
  const r = await query('DELETE FROM postfix_pendientes WHERE folio = $1', [String(folio)]);
  if (r !== null) return true;
  escribirJson(leerJson().filter(f => String(f.folio) !== String(folio)));
  return true;
}
