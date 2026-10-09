import { existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from './fs-reintento.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { query } from './db.js';

// La liga copia -> persona de origen de los Contactos de entrega (#564, ADR-0024 regla
// 6). Operam no liga una persona existente a un domicilio: cuando el vendedor elige a
// una persona que solo esta en el Cliente Operam, el modulo Contactos en Operam crea
// su COPIA en el domicilio, y esa liga es dato del cotizador, no de Operam. Se consulta
// por domicilio y person_id de origen: la siguiente cotizacion al mismo domicilio con
// la misma persona reutiliza la copia en vez de crear otra. Una liga por domicilio y
// origen; guardar otra (la copia anterior ya no estaba en el domicilio) la reemplaza.
//
// Postgres (Neon) cuando hay DATABASE_URL, fallback a data/copias-contacto.json cuando
// no (dev local y tests). Mismo patron que lib/contactos-excluidos-store.js.

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, '..', 'data', 'copias-contacto.json');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS copias_contacto (
    domicilio_id      TEXT NOT NULL,
    origen_person_id  TEXT NOT NULL,
    copia_person_id   TEXT NOT NULL,
    cliente_id        TEXT,
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (domicilio_id, origen_person_id)
  )
`;

let schemaListo = null;
async function ensureSchema() {
  if (!schemaListo) schemaListo = query(SCHEMA).catch(err => { schemaListo = null; throw err; });
  return schemaListo;
}

function leerJson() {
  if (!existsSync(JSON_PATH)) return [];
  return JSON.parse(leerArchivoSync(JSON_PATH));
}

function escribirJson(data) {
  escribirArchivoSync(JSON_PATH, JSON.stringify(data, null, 2));
}

function aIso(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function filaALiga(row) {
  return {
    domicilioId: row.domicilio_id,
    origenPersonId: row.origen_person_id,
    copiaPersonId: row.copia_person_id,
    clienteId: row.cliente_id ?? null,
    creadoEn: aIso(row.creado_en),
  };
}

// La liga de la persona de origen en ese domicilio, o null.
export async function buscar(domicilioId, origenPersonId) {
  const dom = String(domicilioId);
  const origen = String(origenPersonId);
  await ensureSchema();
  const r = await query('SELECT * FROM copias_contacto WHERE domicilio_id = $1 AND origen_person_id = $2', [dom, origen]);
  if (r === null) return leerJson().find(l => l.domicilioId === dom && l.origenPersonId === origen) || null;
  return r.rows.length ? filaALiga(r.rows[0]) : null;
}

// Guarda la liga; la del mismo domicilio y origen se REEMPLAZA (la copia anterior la
// borraron en Operam y se creo otra).
export async function guardar({ clienteId = null, domicilioId, origenPersonId, copiaPersonId }) {
  const liga = {
    domicilioId: String(domicilioId),
    origenPersonId: String(origenPersonId),
    copiaPersonId: String(copiaPersonId),
    clienteId: clienteId == null ? null : String(clienteId),
  };
  await ensureSchema();
  const r = await query(
    `INSERT INTO copias_contacto (domicilio_id, origen_person_id, copia_person_id, cliente_id, creado_en)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (domicilio_id, origen_person_id)
     DO UPDATE SET copia_person_id = EXCLUDED.copia_person_id, cliente_id = EXCLUDED.cliente_id, creado_en = NOW()`,
    [liga.domicilioId, liga.origenPersonId, liga.copiaPersonId, liga.clienteId]
  );
  if (r === null) {
    const lista = leerJson().filter(l => !(l.domicilioId === liga.domicilioId && l.origenPersonId === liga.origenPersonId));
    lista.push({ ...liga, creadoEn: new Date().toISOString() });
    escribirJson(lista);
  }
  return liga;
}
