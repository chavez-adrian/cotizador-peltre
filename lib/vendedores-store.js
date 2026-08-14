import { existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from './fs-reintento.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { query } from './db.js';

// Persistencia del registro de vendedores (issue #140/#141): Postgres (Neon)
// cuando hay DATABASE_URL, fallback a data/vendedores.json cuando no (dev local
// y tests). Mismo patron que lib/prospectos-store.js. El PIN se guarda en claro
// (decision de la spec #140: 4 digitos hasheados no protegen nada y el admin
// necesita poder consultarlos).
//
// El JSON versionado se degrada a SEMILLA: si la tabla existe pero esta vacia se
// puebla una sola vez desde el archivo; con datos, el archivo se ignora. Una
// tabla vacia jamas debe dejar el sistema sin login posible.

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, '..', 'data', 'vendedores.json');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS vendedores (
    id INTEGER PRIMARY KEY,
    name TEXT,
    pin TEXT,
    role TEXT,
    operam_id INTEGER,
    tope_descuento NUMERIC
  )
`;

const INSERT = `
  INSERT INTO vendedores (id, name, pin, role, operam_id, tope_descuento)
  SELECT (v->>'id')::int, v->>'name', v->>'pin', v->>'role',
         (v->>'operam_id')::int, (v->>'topeDescuento')::numeric
  FROM jsonb_array_elements($1::jsonb) AS v
  ON CONFLICT (id) DO NOTHING
`;

let schemaListo = null;
async function ensureSchema() {
  if (!schemaListo) {
    schemaListo = query(SCHEMA).then(r => (r === null ? null : sembrar()));
  }
  return schemaListo;
}

async function sembrar() {
  const r = await query('SELECT COUNT(*)::int AS n FROM vendedores');
  if (r.rows[0].n > 0) return;
  const semilla = leerJson();
  if (!semilla.length) return;
  await query(INSERT, [JSON.stringify(semilla)]);
}

function leerJson() {
  if (!existsSync(JSON_PATH)) return [];
  return JSON.parse(leerArchivoSync(JSON_PATH));
}

function escribirJson(data) {
  escribirArchivoSync(JSON_PATH, JSON.stringify(data, null, 2));
}

// El tope ausente (columna NULL) es "sin tope", no 0 guardado: se omite el campo
// para que el registro se vea igual que en el JSON, donde el vendedor sin
// permiso simplemente no lo trae.
function filaAEntrada(row) {
  const v = {
    id: row.id,
    name: row.name,
    pin: row.pin,
    role: row.role,
    operam_id: row.operam_id,
  };
  if (row.tope_descuento != null) v.topeDescuento = Number(row.tope_descuento);
  return v;
}

export async function listar() {
  await ensureSchema();
  const r = await query('SELECT * FROM vendedores ORDER BY id');
  if (r === null) return leerJson();
  return r.rows.map(filaAEntrada);
}

// El PUT de administracion manda el array completo: altas, bajas y ediciones
// viajan como un reemplazo del registro entero (contrato conservado desde el
// JSON).
export async function reemplazar(vendedores) {
  await ensureSchema();
  const r = await query('DELETE FROM vendedores');
  if (r === null) {
    escribirJson(vendedores);
    return;
  }
  await query(INSERT, [JSON.stringify(vendedores)]);
}
