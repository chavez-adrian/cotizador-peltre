import { existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from './fs-reintento.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { query as queryDb } from './db.js';

// Bloque de modelos del maestro de articulos (issue #310, ADR-0016): las 36
// filas y 32 columnas que hasta ahora vivian en la pestana catalogo del Excel
// maestro. Postgres (Neon) cuando hay DATABASE_URL, fallback a
// data/modelos.json cuando no (dev local y tests), mismo patron que
// lib/vendedores-store.js y lib/config-store.js.
//
// El archivo versionado se degrada a SEMILLA: si la tabla esta vacia se puebla
// una sola vez desde el; con datos, el archivo se ignora. Por eso una
// correccion hecha en /admin/catalogo sobrevive al deploy siguiente.
//
// Sin cache: los lectores son asincronos (handlers de /api/admin/modelos), asi
// que el store no hereda el supuesto de una sola instancia de config-store.js.

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, '..', 'data', 'modelos.json');

// Las 32 columnas del bloque agrupadas por tipo, que es como nace la tabla y
// como viaja la semilla. El tipo sale del que trae el archivo: TEXT para lo que
// se lee, NUMERIC para lo que se mide.
const COLUMNAS_TEXTO = [
  'nombre', 'nombre_comercial', 'nombre_comercial_p', 'genero', 'genero_comercial',
  'name2', 'shopify_name', 'gs1_name', 'cap_ml', 'cap_oz',
  'caja_1', 'caja_wholesale', 'familia', 'nombre_p',
];
const COLUMNAS_NUMERO = [
  'gs1_type', 'diam', 'altura', 'peso', 'cap_h2o', 'diam_in', 'height_in',
  'caja_1_pzxcaja', 'caja_wholesale_pzxcaja', 'hs_fedex', 'hs_shopify',
  'sat_codigo', 'largo', 'ancho', 'alto', 'volumen', 'peso_vol',
];
// Las mismas 32, ahora en el orden del archivo: es el que ve quien edita la
// semilla y el que devuelve listar(), venga de la base o del fallback.
const COLUMNAS = [
  'modelo', 'nombre', 'nombre_comercial', 'nombre_comercial_p', 'genero', 'genero_comercial',
  'name2', 'shopify_name', 'gs1_name', 'gs1_type', 'diam', 'altura', 'peso',
  'cap_ml', 'cap_oz', 'cap_h2o', 'diam_in', 'height_in', 'caja_1', 'caja_1_pzxcaja',
  'caja_wholesale', 'caja_wholesale_pzxcaja', 'hs_fedex', 'hs_shopify', 'sat_codigo',
  'familia', 'nombre_p', 'largo', 'ancho', 'alto', 'volumen', 'peso_vol',
];

// Lo que el panel de #310 deja corregir. El resto del bloque (genero, GS1,
// codigo SAT, capacidades, nombres de tienda) es de solo lectura por ahora:
// sigue derivandose de las formulas del Excel, que #304 todavia no reemplaza.
export const CAMPOS_EDITABLES = [
  'nombre_comercial', 'familia', 'peso', 'diam', 'altura', 'largo', 'ancho', 'alto',
  'caja_1', 'caja_1_pzxcaja', 'caja_wholesale', 'caja_wholesale_pzxcaja',
];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS modelos (
    modelo                 TEXT PRIMARY KEY,
    ${COLUMNAS_TEXTO.map(c => `${c} TEXT`).join(',\n    ')},
    ${COLUMNAS_NUMERO.map(c => `${c} NUMERIC`).join(',\n    ')},
    actualizado_en         TIMESTAMPTZ DEFAULT NOW()
  )
`;

// La lista de columnas del INSERT va agrupada por tipo, igual que el SELECT: en
// el orden del archivo los valores caerian en la columna equivocada.
const SEMILLA = `
  INSERT INTO modelos (${['modelo', ...COLUMNAS_TEXTO, ...COLUMNAS_NUMERO].join(', ')})
  SELECT ${['modelo', ...COLUMNAS_TEXTO].map(c => `m->>'${c}'`).join(', ')},
         ${COLUMNAS_NUMERO.map(c => `(m->>'${c}')::numeric`).join(', ')}
  FROM jsonb_array_elements($1::jsonb) AS m
  ON CONFLICT (modelo) DO NOTHING
`;

let ejecutarQuery = queryDb;

function leerJson() {
  if (!existsSync(JSON_PATH)) return [];
  return JSON.parse(leerArchivoSync(JSON_PATH));
}

function escribirJson(modelos) {
  escribirArchivoSync(JSON_PATH, JSON.stringify(modelos, null, 2));
}

// El SELECT de Postgres entrega NUMERIC como cadena y ordena las columnas por
// como nacio la tabla: la fila se rearma en el orden y los tipos del archivo
// para que el fallback y la base entreguen exactamente lo mismo.
function filaAEntrada(row) {
  const m = {};
  for (const c of COLUMNAS) {
    const v = row[c];
    m[c] = COLUMNAS_NUMERO.includes(c) && v != null ? Number(v) : v;
  }
  return m;
}

// Un fallo transitorio (Neon, red) durante schema o siembra no puede quedar
// cacheado como rechazo permanente: se resetea para reintentar en la siguiente
// llamada, igual que el schemaListo del registro de vendedores.
let schemaListo = null;
export function cargar() {
  if (!schemaListo) {
    schemaListo = ejecutarQuery(SCHEMA).then(r => (r === null ? null : sembrar()));
    schemaListo.catch(() => { schemaListo = null; });
  }
  return schemaListo;
}

async function sembrar() {
  const r = await ejecutarQuery('SELECT COUNT(*)::int AS n FROM modelos');
  if (r.rows[0].n > 0) return;
  const semilla = leerJson();
  if (!semilla.length) return;
  await ejecutarQuery(SEMILLA, [JSON.stringify(semilla)]);
}

export async function listar() {
  await cargar();
  const r = await ejecutarQuery('SELECT * FROM modelos ORDER BY modelo');
  if (r === null) return leerJson().slice().sort((a, b) => a.modelo.localeCompare(b.modelo));
  return r.rows.map(filaAEntrada);
}

// El panel manda solo las columnas que toco, asi que la correccion es PARCIAL:
// lo que no viaja se conserva. Devuelve la fila actualizada, o null si el modelo
// no existe -- el llamador lo traduce a 404.
export async function actualizar(modelo, campos) {
  await cargar();
  const editables = CAMPOS_EDITABLES.filter(c => campos[c] !== undefined);
  const valores = editables.map(c => normalizarValor(c, campos[c]));

  const set = editables.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const sql = `UPDATE modelos SET ${set}${set ? ', ' : ''}actualizado_en = NOW()
               WHERE modelo = $1 RETURNING *`;
  const r = await ejecutarQuery(sql, [modelo, ...valores]);
  if (r !== null) return r.rows[0] ? filaAEntrada(r.rows[0]) : null;

  const modelos = leerJson();
  const fila = modelos.find(m => m.modelo === modelo);
  if (!fila) return null;
  editables.forEach((c, i) => { fila[c] = valores[i]; });
  escribirJson(modelos);
  return fila;
}

// El formulario del panel entrega todo como texto: una medida vacia es la
// columna sin dato (NULL), no un cero. La familia vacia SI se conserva como
// cadena, que es como el admin declara "pendiente" desde el panel.
function normalizarValor(columna, valor) {
  if (!COLUMNAS_NUMERO.includes(columna)) return valor;
  if (valor === '' || valor === null) return null;
  return Number(valor);
}

// Modelo sin familia asignada = pendiente visible, nunca un cajon de "Otros"
// (ADR-0016). La columna vacia cuenta igual que la nula: el panel guarda ''
// cuando el admin borra el campo.
export async function sinFamilia() {
  return (await listar()).filter(m => !m.familia).map(m => m.modelo);
}

// Seam de prueba: deja el modulo como un proceso recien arrancado (schema por
// asegurar) y permite inyectar un query() falso para ejercitar el camino Neon
// sin base real. Sin argumento vuelve al query() de lib/db.js.
export function _reiniciar(queryFalsa) {
  ejecutarQuery = queryFalsa || queryDb;
  schemaListo = null;
}
