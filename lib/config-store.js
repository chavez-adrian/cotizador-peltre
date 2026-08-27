import { existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from './fs-reintento.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { query as queryDb } from './db.js';

// Configuracion del panel /admin (issue #276): tipos y texturas activos, evento
// activo y las ligas del sitio y del catalogo. Postgres (Neon) cuando hay
// DATABASE_URL, fallback a data/config.json cuando no (dev local y tests),
// mismo patron que lib/vendedores-store.js.
//
// El archivo versionado se degrada a SEMILLA: si la tabla esta vacia se puebla
// una sola vez desde el (ON CONFLICT DO NOTHING, nunca pisa lo guardado); con
// datos, el archivo se ignora. Desde aqui, editar data/config.json en un commit
// ya NO llega a produccion: la feria nueva se configura desde el panel.
//
// La configuracion es UN documento y sus cinco lectores son SINCRONOS en medio
// de handlers de request, asi que se sirve de una cache en memoria: se carga al
// arrancar (cargar()) y se refresca al guardar. Eso ASUME UNA SOLA INSTANCIA,
// como el lock de subidas a Operam y la cola de post-fixes de vigencia.

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, '..', 'data', 'config.json');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS config_panel (
    id             INTEGER PRIMARY KEY,
    data           JSONB NOT NULL,
    actualizado_en TIMESTAMPTZ DEFAULT NOW()
  )
`;

const SEMILLA = `
  INSERT INTO config_panel (id, data) VALUES (1, $1)
  ON CONFLICT (id) DO NOTHING
`;

const UPSERT = `
  INSERT INTO config_panel (id, data) VALUES (1, $1)
  ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, actualizado_en = NOW()
`;

let ejecutarQuery = queryDb;
let cache = null;
let sinPool = false;
let cargaEnCurso = null;

function leerJson() {
  if (!existsSync(JSON_PATH)) return null;
  return JSON.parse(leerArchivoSync(JSON_PATH));
}

function escribirJson(config) {
  escribirArchivoSync(JSON_PATH, JSON.stringify(config, null, 2));
}

// Un fallo transitorio (Neon, red) no puede quedar cacheado como rechazo
// permanente: se resetea para reintentar en la siguiente llamada, igual que el
// schemaListo del registro de vendedores.
export function cargar() {
  if (!cargaEnCurso) {
    cargaEnCurso = cargarDeBase();
    cargaEnCurso.catch(() => { cargaEnCurso = null; });
  }
  return cargaEnCurso;
}

async function cargarDeBase() {
  const creada = await ejecutarQuery(SCHEMA);
  if (creada === null) {
    sinPool = true;
    return null;
  }
  const semilla = leerJson();
  if (semilla) await ejecutarQuery(SEMILLA, [JSON.stringify(semilla)]);
  const r = await ejecutarQuery('SELECT data FROM config_panel WHERE id = 1');
  // Sin fila (tabla vacia que ni la semilla pudo poblar) la cache se queda
  // vacia a proposito: leer() cae al archivo. Una tabla vacia jamas debe dejar
  // al sistema sin configuracion -- los tipos y texturas activos apagan el
  // catalogo completo.
  cache = r.rows[0] ? r.rows[0].data : null;
  return cache;
}

// Lectura SINCRONA, la que usan los handlers. Devuelve null cuando no hay
// configuracion en ningun lado (los llamadores ya tienen su default), igual que
// el readJSON que sustituye.
export function leer() {
  if (cache) return cache;
  // Cache fria: el warm de arranque va en vuelo, fallo, o la tabla esta vacia.
  // Se contesta con el archivo (la semilla) y se pide la carga -- que esta
  // memoizada, asi que solo REINTENTA de verdad cuando el intento anterior
  // fallo; con la tabla vacia el archivo sigue mandando hasta el proximo
  // guardar(), que es justo lo que se quiere.
  if (!sinPool) cargar().catch(err => console.warn('[config-store] carga fallo:', err.message));
  return leerJson();
}

export async function guardar(config) {
  await cargar();
  const r = await ejecutarQuery(UPSERT, [JSON.stringify(config)]);
  if (r === null) escribirJson(config);
  else cache = config;
}

// Seam de prueba: deja el modulo como un proceso recien arrancado (cache fria)
// y permite inyectar un query() falso para ejercitar el camino Neon sin base
// real. Sin argumento vuelve al query() de lib/db.js.
export function _reiniciar(queryFalsa) {
  ejecutarQuery = queryFalsa || queryDb;
  cache = null;
  sinPool = false;
  cargaEnCurso = null;
}
