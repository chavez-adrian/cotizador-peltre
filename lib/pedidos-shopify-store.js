import { existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from './fs-reintento.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { query } from './db.js';

// Tabla de pedidos de la tienda en linea (spec #254, ticket #255; ADR-0014).
// Una fila por (pedido, telefono resuelto): el telefono ya viene en E.164 y con
// su motivo de descarte resuelto AGUAS ARRIBA, en el nucleo puro
// (lib/pedidos-shopify-logica.js). Esta tabla ES la fuente del barrido de
// contactos: la red nunca entra al plan.
//
// La llave es (pedido, celular10) y no el telefono escrito: un pedido puede
// traer dos telefonos distintos, y un telefono puede aparecer en varios pedidos
// (ahi gana el mas reciente, y eso lo decide el nucleo de contactos, no una
// consulta).
//
// Postgres (Neon) cuando hay DATABASE_URL, fallback a data/pedidos-shopify.json
// cuando no (dev local y tests). Mismo patron que lib/contactos-store.js.

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, '..', 'data', 'pedidos-shopify.json');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS pedidos_shopify (
    pedido         TEXT NOT NULL,
    celular10      TEXT NOT NULL,
    creado_en      TIMESTAMPTZ,
    telefono       TEXT NOT NULL,
    nombre         TEXT,
    correo         TEXT,
    fuente         TEXT,
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (pedido, celular10)
  )
`;

// El cursor del sondeo (`updated_at` del ultimo pedido leido) vive en su propia
// tabla de una fila por clave: meterlo en pedidos_shopify obligaria a una fila
// falsa de pedido, y una tabla de estado se lee sin tocar los datos.
const SCHEMA_ESTADO = `
  CREATE TABLE IF NOT EXISTS pedidos_shopify_estado (
    clave TEXT PRIMARY KEY,
    valor TEXT
  )
`;

const CLAVE_CURSOR = 'ultimo_updated_at';

let schemaListo = null;
async function ensureSchema() {
  if (!schemaListo) {
    schemaListo = (async () => {
      await query(SCHEMA);
      await query(SCHEMA_ESTADO);
    })();
  }
  return schemaListo;
}

function leerJson() {
  if (!existsSync(JSON_PATH)) return { cursor: null, filas: [] };
  const data = JSON.parse(leerArchivoSync(JSON_PATH));
  return { cursor: data.cursor ?? null, filas: data.filas || [] };
}

function escribirJson(data) {
  escribirArchivoSync(JSON_PATH, JSON.stringify(data, null, 2));
}

function aIso(v) {
  // Postgres devuelve Date y el JSON devuelve la cadena que se escribio: el
  // nucleo puro recibe SIEMPRE la misma forma, para que una prueba contra el
  // fallback no mida algo distinto de lo que corre en produccion.
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function filaAEntrada(row) {
  return {
    pedido: row.pedido,
    creadoEn: aIso(row.creado_en),
    telefono: row.telefono,
    celular10: row.celular10,
    nombre: row.nombre || '',
    correo: row.correo || '',
    fuente: row.fuente || '',
  };
}

export async function listar() {
  await ensureSchema();
  const r = await query('SELECT * FROM pedidos_shopify ORDER BY pedido, celular10');
  if (r === null) return leerJson().filas;
  return r.rows.map(filaAEntrada);
}

// Upsert por (pedido, celular10). Idempotente a proposito: el sondeo relee por
// `updated_at` y un fallo a mitad de una pagina hace que la siguiente corrida
// vuelva a pasar los mismos pedidos por aqui. Reingerir no puede duplicar.
export async function guardar(filas) {
  const lista = filas || [];
  if (lista.length === 0) return true;
  await ensureSchema();
  for (const fila of lista) {
    const r = await query(
      `INSERT INTO pedidos_shopify (pedido, celular10, creado_en, telefono, nombre, correo, fuente, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (pedido, celular10) DO UPDATE SET
         creado_en = EXCLUDED.creado_en,
         telefono = EXCLUDED.telefono,
         nombre = EXCLUDED.nombre,
         correo = EXCLUDED.correo,
         fuente = EXCLUDED.fuente,
         actualizado_en = NOW()`,
      [fila.pedido, fila.celular10, fila.creadoEn || null, fila.telefono, fila.nombre || '', fila.correo || '', fila.fuente || '']
    );
    if (r === null) {
      const data = leerJson();
      const i = data.filas.findIndex(f => f.pedido === fila.pedido && f.celular10 === fila.celular10);
      if (i === -1) data.filas.push(fila);
      else data.filas[i] = fila;
      escribirJson(data);
    }
  }
  return true;
}

// Borra TODAS las filas de un celular, sin importar en cuantos pedidos aparezca
// (#259, el comando de exclusion): un telefono puede repetirse en varios
// pedidos, y una solicitud de cancelacion tiene que borrar los rastros de todos.
export async function eliminarPorCelular(celular10) {
  await ensureSchema();
  const r = await query('DELETE FROM pedidos_shopify WHERE celular10 = $1', [celular10]);
  if (r === null) {
    const data = leerJson();
    const antes = data.filas.length;
    data.filas = data.filas.filter(f => f.celular10 !== celular10);
    if (data.filas.length !== antes) escribirJson(data);
    return antes - data.filas.length;
  }
  return r.rowCount;
}

export async function leerCursor() {
  await ensureSchema();
  const r = await query('SELECT valor FROM pedidos_shopify_estado WHERE clave = $1', [CLAVE_CURSOR]);
  if (r === null) return leerJson().cursor;
  return r.rows[0]?.valor ?? null;
}

export async function guardarCursor(valor) {
  await ensureSchema();
  const r = await query(
    `INSERT INTO pedidos_shopify_estado (clave, valor) VALUES ($1, $2)
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`,
    [CLAVE_CURSOR, valor]
  );
  if (r === null) {
    const data = leerJson();
    data.cursor = valor;
    escribirJson(data);
  }
  return true;
}
