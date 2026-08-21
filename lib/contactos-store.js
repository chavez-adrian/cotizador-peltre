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

// La tabla ya existe en Neon desde #227, y CREATE TABLE IF NOT EXISTS no le
// agrega columnas: la marca de inactiva (#231) entra por un ALTER idempotente
// que corre en cada arranque y no hace nada cuando la columna ya esta.
const MIGRACION_INACTIVO = `
  ALTER TABLE contactos_google ADD COLUMN IF NOT EXISTS inactivo_desde TIMESTAMPTZ
`;

let schemaListo = null;
async function ensureSchema() {
  if (!schemaListo) {
    schemaListo = (async () => {
      await query(SCHEMA);
      await query(MIGRACION_INACTIVO);
    })();
  }
  return schemaListo;
}

function leerJson() {
  if (!existsSync(JSON_PATH)) return [];
  // La marca de inactiva llega normalizada tambien por aqui: una fila escrita
  // antes de #231 no tiene la llave y el nucleo puro no tiene por que saberlo.
  return JSON.parse(leerArchivoSync(JSON_PATH))
    .map(e => ({ ...e, inactivoDesde: aIso(e.inactivoDesde) }));
}

function escribirJson(data) {
  escribirArchivoSync(JSON_PATH, JSON.stringify(data, null, 2));
}

function aIso(v) {
  // Postgres devuelve Date y el JSON devuelve la cadena que se escribio: el
  // nucleo puro recibe SIEMPRE la misma forma, para que una prueba contra el
  // fallback no mida algo distinto de lo que corre en produccion.
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function filaAEntrada(row) {
  return {
    celular10: row.celular10,
    resourceName: row.resource_name,
    etag: row.etag,
    clase: row.clase,
    huella: row.huella,
    inactivoDesde: aIso(row.inactivo_desde),
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
//
// Escribir la ficha LIMPIA la marca de inactiva (#231): si se le escribio es
// porque su origen esta vivo, y ahi termina la reactivacion sin un metodo
// aparte. Una ficha inactiva no recibe escrituras (el plan no las emite), asi
// que esto no puede reactivar nada por accidente.
export async function guardar(entrada) {
  await ensureSchema();
  const { celular10, resourceName, etag, clase, huella } = entrada;
  const r = await query(
    `INSERT INTO contactos_google (celular10, resource_name, etag, clase, huella, actualizado_en, inactivo_desde)
     VALUES ($1, $2, $3, $4, $5, NOW(), NULL)
     ON CONFLICT (celular10) DO UPDATE SET
       resource_name = EXCLUDED.resource_name,
       etag = EXCLUDED.etag,
       clase = EXCLUDED.clase,
       huella = EXCLUDED.huella,
       actualizado_en = NOW(),
       inactivo_desde = NULL`,
    [celular10, resourceName, etag ?? null, clase || 'propio', huella ?? null]
  );
  if (r === null) {
    const log = leerJson();
    const fila = { celular10, resourceName, etag, clase: clase || 'propio', huella, inactivoDesde: null };
    const i = log.findIndex(e => e.celular10 === celular10);
    if (i === -1) log.push(fila);
    else log[i] = fila;
    escribirJson(log);
  }
  return true;
}

// La ficha que perdio respaldo (#231). NO se borra ni se cambia de clase: sigue
// siendo propia, conserva su resourceName y su nombre, y solo gana la fecha en
// que dejo de tener origen. Es lo que hace que las pasadas siguientes la
// ignoren y lo que permite reactivarla si el origen vuelve.
export async function marcarInactivo(celular10, cuando = new Date()) {
  await ensureSchema();
  const fecha = cuando instanceof Date ? cuando : new Date(cuando);
  const r = await query(
    'UPDATE contactos_google SET inactivo_desde = $2 WHERE celular10 = $1',
    [celular10, fecha]
  );
  if (r === null) {
    const log = leerJson();
    const i = log.findIndex(e => e.celular10 === celular10);
    if (i === -1) return false;
    log[i] = { ...log[i], inactivoDesde: fecha.toISOString() };
    escribirJson(log);
  }
  return true;
}
