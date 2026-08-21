import { existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from './fs-reintento.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { query } from './db.js';

// Mapeo persistido celular NORMALIZADO -> Contacto de Google (spec #224, ticket
// #227). Es la AUTORIDAD de identidad de la sincronizacion: para saber si un
// celular ya tiene ficha se consulta esto, NUNCA la busqueda de contactos de
// Google (corre sobre un cache perezoso, busca por prefijo, topa en 30
// resultados y las escrituras tardan minutos en verse -- preguntarle produce
// duplicados).
//
// La llave es el celular normalizado (ultimos 10 digitos, lib/telefono-llave.js)
// y NO la cadena que se escribe en Google: si fueran la misma, cambiar el
// formato del telefono huerfanaria todas las fichas ya creadas y la siguiente
// pasada las duplicaria en lugar de corregirlas.
//
// Postgres (Neon) cuando hay DATABASE_URL, fallback a data/contactos-google.json
// cuando no (dev local y tests). Mismo patron que lib/prospectos-store.js.

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, '..', 'data', 'contactos-google.json');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS contactos_google (
    celular10      TEXT PRIMARY KEY,
    resource_name  TEXT NOT NULL,
    etag           TEXT,
    clase          TEXT NOT NULL DEFAULT 'propio',
    huella         TEXT,
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

let schemaListo = null;
async function ensureSchema() {
  if (!schemaListo) schemaListo = query(SCHEMA);
  return schemaListo;
}

function leerJson() {
  if (!existsSync(JSON_PATH)) return [];
  return JSON.parse(leerArchivoSync(JSON_PATH));
}

function escribirJson(data) {
  escribirArchivoSync(JSON_PATH, JSON.stringify(data, null, 2));
}

function filaAEntrada(row) {
  return {
    celular10: row.celular10,
    resourceName: row.resource_name,
    etag: row.etag,
    clase: row.clase,
    huella: row.huella,
  };
}

export async function listar() {
  await ensureSchema();
  const r = await query('SELECT * FROM contactos_google ORDER BY celular10');
  if (r === null) return leerJson();
  return r.rows.map(filaAEntrada);
}

// Upsert por celular: una ficha corregida NO produce una segunda fila. Se
// escribe ficha por ficha conforme la envoltura las aplica, no al final de la
// pasada: asi un fallo a la mitad del plan no descarta lo ya escrito en Google
// (y la siguiente pasada no lo vuelve a crear).
export async function guardar(entrada) {
  await ensureSchema();
  const { celular10, resourceName, etag, clase, huella } = entrada;
  const r = await query(
    `INSERT INTO contactos_google (celular10, resource_name, etag, clase, huella, actualizado_en)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (celular10) DO UPDATE SET
       resource_name = EXCLUDED.resource_name,
       etag = EXCLUDED.etag,
       clase = EXCLUDED.clase,
       huella = EXCLUDED.huella,
       actualizado_en = NOW()`,
    [celular10, resourceName, etag ?? null, clase || 'propio', huella ?? null]
  );
  if (r === null) {
    const log = leerJson();
    const fila = { celular10, resourceName, etag, clase: clase || 'propio', huella };
    const i = log.findIndex(e => e.celular10 === celular10);
    if (i === -1) log.push(fila);
    else log[i] = fila;
    escribirJson(log);
  }
  return true;
}
