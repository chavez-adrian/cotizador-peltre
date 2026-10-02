import { existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from './fs-reintento.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { query } from './db.js';

// El log de los avisos (webhooks) de Operam (#62; estados y repeticiones desde
// #510): una fila por aviso, con su clave idempotente (lib/sync-operam-webhook.js),
// el payload crudo y como termino. Tres estados:
//   - en cola: `resultado` y `procesado_en` en null;
//   - atendido: `procesado_en` con fecha y `resultado` `reconciliadas:N`;
//   - fallido: `resultado` `error: ...` y `procesado_en` en null. Su reenvio se
//     vuelve a atender (hasta #510 un fallo quedaba como `reconciliadas:0`).
// El reenvio de uno que sigue en cola tambien se atiende: la fila vive en memoria
// y un deploy a media fila la deja en cola para siempre (atenderlo dos veces no
// mueve nada de mas). El repetido de uno atendido no se atiende pero deja rastro:
// `repeticiones` y `ultima_repeticion` (hasta #510 el repetido no dejaba ninguno y
// no se podia saber si Operam lo habia enviado). Postgres (Neon) con
// DATABASE_URL, fallback a data/operam-webhooks-log.json sin ella. A diferencia de
// lib/dropbox-subidas-store.js estas funciones SI lanzan: quien llama decide (la
// ruta atiende el aviso aunque no se pueda registrar).

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, '..', 'data', 'operam-webhooks-log.json');

// El fallback de disco es de dev: sin tope creceria sin fin.
const MAX_JSON = 1000;

// lib/db.js crea la tabla al arrancar; las columnas de #510 le entran aparte.
const SCHEMA = [
  'ALTER TABLE operam_webhooks_log ADD COLUMN IF NOT EXISTS repeticiones INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE operam_webhooks_log ADD COLUMN IF NOT EXISTS ultima_repeticion TIMESTAMPTZ',
];

let schemaListo = null;
async function ensureSchema() {
  if (!schemaListo) {
    schemaListo = (async () => { for (const sql of SCHEMA) await query(sql); })().catch(err => {
      schemaListo = null;
      throw err;
    });
  }
  return schemaListo;
}

const esError = (resultado) => typeof resultado === 'string' && resultado.startsWith('error:');

function leerJson() {
  if (!existsSync(JSON_PATH)) return [];
  const filas = JSON.parse(leerArchivoSync(JSON_PATH));
  return Array.isArray(filas) ? filas : [];
}

function escribirJson(filas) {
  escribirArchivoSync(JSON_PATH, JSON.stringify(filas.slice(-MAX_JSON), null, 2));
}

// Registra la llegada de un aviso y dice si hay que atenderlo: { atender, clave,
// repetido, reintento }. Nuevo -> se atiende. Repetido de uno fallido o que sigue
// en cola -> vuelve a la cola y se atiende (reintento). Repetido de uno atendido
// -> no se atiende. Todo repetido suma su repeticion.
export async function registrarAviso(aviso, payload) {
  const clave = aviso.clave;
  await ensureSchema();
  const r = await query(
    `WITH previo AS (SELECT resultado FROM operam_webhooks_log WHERE event_key = $1)
     INSERT INTO operam_webhooks_log (event_key, modelo, identificador, payload)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (event_key) DO UPDATE SET
       repeticiones = operam_webhooks_log.repeticiones + 1,
       ultima_repeticion = NOW(),
       resultado = CASE WHEN operam_webhooks_log.resultado LIKE 'error:%' THEN NULL ELSE operam_webhooks_log.resultado END
     RETURNING (xmax = 0) AS nuevo, (SELECT resultado FROM previo) AS previo`,
    [clave, aviso.modelo, aviso.identificador, JSON.stringify(payload ?? null)]
  );
  if (r !== null) {
    const fila = r.rows[0] || {};
    return decision(clave, fila.nuevo === true, fila.previo);
  }

  const filas = leerJson();
  const existente = filas.find(f => f.event_key === clave);
  if (!existente) {
    const id = filas.reduce((m, f) => Math.max(m, Number(f.id) || 0), 0) + 1;
    filas.push({
      id, created_at: new Date().toISOString(), event_key: clave, modelo: aviso.modelo,
      identificador: aviso.identificador, payload: payload ?? null,
      procesado_en: null, resultado: null, repeticiones: 0, ultima_repeticion: null,
    });
    escribirJson(filas);
    return decision(clave, true, null);
  }
  const previo = existente.resultado ?? null;
  existente.repeticiones = (Number(existente.repeticiones) || 0) + 1;
  existente.ultima_repeticion = new Date().toISOString();
  if (esError(previo)) existente.resultado = null;
  escribirJson(filas);
  return decision(clave, false, previo);
}

function decision(clave, nuevo, previo) {
  if (nuevo) return { atender: true, clave, repetido: false, reintento: false };
  const reintento = previo == null || esError(previo);
  return { atender: reintento, clave, repetido: true, reintento };
}

// Anota como termino la atencion: atendido (con fecha) o fallido (sin fecha, para
// que su reenvio se vuelva a atender).
export async function marcarAviso(clave, { ok, resultado }) {
  await ensureSchema();
  const r = await query(
    `UPDATE operam_webhooks_log SET procesado_en = CASE WHEN $3 THEN NOW() ELSE NULL END, resultado = $2 WHERE event_key = $1`,
    [clave, resultado, ok === true]
  );
  if (r !== null) return;
  const filas = leerJson();
  const fila = filas.find(f => f.event_key === clave);
  if (!fila) return;
  fila.resultado = resultado;
  fila.procesado_en = ok === true ? new Date().toISOString() : null;
  escribirJson(filas);
}
