import { existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from './fs-reintento.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { query } from './db.js';

// Lista de exclusion por celular (spec #254, ticket #259; ADR-0013 "Consecuencias":
// la solicitud de borrado se atiende a mano). `planificarContactos`
// (lib/contactos-logica.js) la respeta SIEMPRE y para TODAS las fuentes: un
// celular de aqui no se crea, no se actualiza, no se adopta y no se reactiva, sea
// cual sea su origen. El borrado real de la ficha en Google se hace a mano
// (scripts/excluir-celular.mjs solo lo recuerda); esta tabla es lo que impide que
// el sondeo o una reingestion la recreen.
//
// Postgres (Neon) cuando hay DATABASE_URL, fallback a
// data/contactos-excluidos.json cuando no (dev local y tests). Mismo patron que
// lib/contactos-store.js.

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, '..', 'data', 'contactos-excluidos.json');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS contactos_excluidos (
    celular10   TEXT PRIMARY KEY,
    motivo      TEXT,
    excluido_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

function aIso(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function filaAEntrada(row) {
  return { celular10: row.celular10, motivo: row.motivo || '', excluidoEn: aIso(row.excluido_en) };
}

export async function listar() {
  await ensureSchema();
  const r = await query('SELECT * FROM contactos_excluidos ORDER BY celular10');
  if (r === null) return leerJson();
  return r.rows.map(filaAEntrada);
}

// Idempotente A PROPOSITO (#259): pedir la exclusion dos veces no duplica la
// fila ni pisa el motivo original con uno vacio de una segunda llamada sin
// motivo -- ON CONFLICT DO NOTHING dejar intacta la primera fila es lo correcto,
// porque la primera solicitud ya es la que cuenta.
export async function agregar(celular10, motivo = '') {
  await ensureSchema();
  const r = await query(
    `INSERT INTO contactos_excluidos (celular10, motivo, excluido_en)
     VALUES ($1, $2, NOW())
     ON CONFLICT (celular10) DO NOTHING`,
    [celular10, motivo || '']
  );
  if (r === null) {
    const lista = leerJson();
    if (!lista.some(e => e.celular10 === celular10)) {
      lista.push({ celular10, motivo: motivo || '', excluidoEn: new Date().toISOString() });
      escribirJson(lista);
    }
  }
  return true;
}

export async function estaExcluido(celular10) {
  const lista = await listar();
  return lista.some(e => e.celular10 === celular10);
}
