// Export completo de Bitrix24 antes del vencimiento del plan de pago (issue #158,
// padre #155, deadline 2026-08-21). Congela el ano de historia comercial de
// peltrenacional.bitrix24.mx en JSON: leads, contactos, companias y deals con
// TODOS los campos (incluye UF_* -- custom fields), mas timeline (comentarios) y
// actividades por cada registro. Complementa (no sustituye) los CSV de respaldo
// que se exportan a mano desde la UI de Bitrix. Al terminar sube el paquete a
// Dropbox reutilizando lib/dropbox.js.
//
// === Como obtener la URL del webhook (Adrian, en Bitrix24) ===
//   1. Bitrix24 > Aplicaciones > Recursos para desarrolladores > Otro >
//      "Webhook entrante".
//   2. Marcar el permiso "CRM" (crm.*: cubre lead/contact/company/deal/
//      timeline.comment/activity). El script solo LEE (metodos *.list), no
//      necesita mas scopes.
//   3. Copiar la URL generada, forma:
//        https://peltrenacional.bitrix24.mx/rest/<user_id>/<token>/
//   4. Pegarla en el .env LOCAL del cotizador (JAMAS en un commit, JAMAS en
//      logs compartidos) como:
//        BITRIX_WEBHOOK_URL=https://peltrenacional.bitrix24.mx/rest/<user_id>/<token>/
//      Este script carga .env manualmente (mismo patron que
//      scripts/sync-catalogo.mjs y scripts/detectar-cancelados.mjs: solo
//      rellena vars AUSENTES, no pisa lo que ya este en el entorno).
//
// === Como correrlo ===
//   node scripts/export-bitrix.mjs --dry-run   # valida conectividad + conteos totales, NO descarga
//   node scripts/export-bitrix.mjs             # export completo -> data/export-bitrix/<fecha>/ + Dropbox
//   node scripts/export-bitrix.mjs --force     # re-descarga leads/contactos/companias/deals aunque ya existan
//
// === Que verifica el dry-run ===
// Llama a cada *.list con start=0 y select minimo (una sola pagina, no
// descarga registros) y lee `total` de la respuesta de Bitrix para leads,
// contactos, companias y deals. Sirve para (a) confirmar que la URL del
// webhook responde y (b) contrastar esos totales A OJO contra los contadores
// que muestra la UI de Bitrix ANTES de correr el export completo.
//
// === Salida ===
// data/export-bitrix/<fecha>/{leads,contactos,companias,deals,timeline,actividades}.json
// mas resumen.json (conteos por entidad, para contrastar contra la UI de
// Bitrix -- criterio de aceptacion del issue #158). El directorio esta en
// .gitignore: el export JAMAS se commitea.
//
// === Empaquetado ===
// Sin dependencias nuevas (sin librerias de zip): se suben los JSON sueltos a
// Dropbox, un archivo por PUT, bajo BITRIX_EXPORT_DROPBOX_PATH (env,
// opcional) o el default definido abajo.
//
// === Reintentos y reanudacion ===
// Cada llamada a Bitrix reintenta con backoff exponencial ante fallos de red
// o 503/QUERY_LIMIT_EXCEEDED (rate limit de Bitrix). Los 4 catalogos
// principales escriben su JSON final solo al terminar; si ya existe se
// SALTA en la siguiente corrida (usa --force para re-descargar). Timeline y
// actividades hacen UN request POR CADA registro ya descargado (pueden ser
// miles): escriben progreso incremental en un .ndjson.tmp que se relee al
// reanudar, asi que una corrida interrumpida retoma donde se quedo en vez de
// repetir todo. Si un registro puntual falla tras agotar reintentos, el
// script aborta con un mensaje que identifica la entidad y el id exactos.
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { leerArchivoSync, escribirArchivoSync, agregarArchivoSync, borrarArchivoSync } from '../lib/fs-reintento.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const DROPBOX_PATH_DEFAULT = '/PELTRE NACIONAL/3.0 ADMINISTRACION/CRM/BACKUP BITRIX24';

// Entidades CRM del export. tipoTimeline = ENTITY_TYPE de crm.timeline.comment.list
// (string); ownerTypeId = OWNER_TYPE_ID de crm.activity.list (numerico, constante
// de Bitrix: Lead=1, Deal=2, Contact=3, Company=4 -- confirmado en
// apidocs.bitrix24.com/api-reference/crm/main-entities-fields.html).
//
// multifield: campos MULTIPLES de Bitrix (PHONE, EMAIL, WEB, IM). El comodin
// '*' NO los incluye -- hay que pedirlos por nombre (apidocs.bitrix24.com,
// crm.*.list). El export original de #158 solo pedia ['*','UF_*'] y por eso
// salio con HAS_PHONE='Y' en 311 de 327 contactos pero SIN un solo telefono:
// justo la llave primaria de identidad del cotizador (ultimos10). Los deals no
// tienen multifields propios (heredan los del contacto/compania ligados).
const MULTIFIELD = ['PHONE', 'EMAIL', 'WEB', 'IM'];

const ENTIDADES = [
  { key: 'leads', metodo: 'crm.lead.list', tipoTimeline: 'lead', ownerTypeId: 1, multifield: true },
  { key: 'contactos', metodo: 'crm.contact.list', tipoTimeline: 'contact', ownerTypeId: 3, multifield: true },
  { key: 'companias', metodo: 'crm.company.list', tipoTimeline: 'company', ownerTypeId: 4, multifield: true },
  { key: 'deals', metodo: 'crm.deal.list', tipoTimeline: 'deal', ownerTypeId: 2 },
];

function cargarEnv() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}

function normalizarBase(url) {
  if (!url) return null;
  return url.endsWith('/') ? url : `${url}/`;
}

// Throttle proactivo anti-QUERY_LIMIT_EXCEEDED (mismo patron que
// lib/operam-client.js / scripts/sync-catalogo.mjs para Operam): 600ms entre
// llamadas se queda debajo del limite sostenido de 2 req/s de los planes
// estandar de Bitrix24 (apidocs.bitrix24.com/limits.html).
const THROTTLE_MS = Number(process.env.BITRIX_THROTTLE_MS) || 600;
const MAX_REINTENTOS = Number(process.env.BITRIX_MAX_REINTENTOS) || 5;
let ultimaLlamada = 0;

function esperar(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function esperarTurno() {
  const falta = ultimaLlamada + THROTTLE_MS - Date.now();
  if (falta > 0) await esperar(falta);
  ultimaLlamada = Date.now();
}

function backoff(intento) {
  return Math.min(1000 * 2 ** (intento - 1), 30000);
}

// Llama un metodo REST de Bitrix via el webhook entrante (POST JSON). Reintenta
// con backoff exponencial ante fallos de red y ante 503/QUERY_LIMIT_EXCEEDED
// (rate limit); otros errores de Bitrix (token invalido, metodo sin permiso,
// etc.) fallan de inmediato -- reintentar no los arregla.
async function bitrixCall(base, metodo, params = {}) {
  const url = `${base}${metodo}.json`;
  let intento = 0;
  for (;;) {
    intento++;
    await esperarTurno();
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
    } catch (err) {
      if (intento > MAX_REINTENTOS) throw new Error(`Bitrix ${metodo}: fallo de red tras ${intento} intentos: ${err.message}`);
      await esperar(backoff(intento));
      continue;
    }
    let body = null;
    try { body = await res.json(); } catch { /* body no-JSON, tratado abajo */ }
    const limitado = res.status === 503 || (body && body.error === 'QUERY_LIMIT_EXCEEDED');
    if (limitado) {
      if (intento > MAX_REINTENTOS) throw new Error(`Bitrix ${metodo}: QUERY_LIMIT_EXCEEDED tras ${intento} intentos`);
      await esperar(backoff(intento));
      continue;
    }
    if (!res.ok || !body || body.error) {
      const detalle = body ? `${body.error}: ${body.error_description || ''}` : `HTTP ${res.status}`;
      throw new Error(`Bitrix ${metodo} fallo: ${detalle}`);
    }
    return body;
  }
}

// Pagina un metodo *.list completo (start/next/total, pagina fija de 50 --
// apidocs.bitrix24.com). Devuelve TODOS los registros y el total reportado.
async function listarTodo(base, metodo, params) {
  let start = 0;
  let total = null;
  const items = [];
  for (;;) {
    const body = await bitrixCall(base, metodo, { ...params, start });
    if (total == null) total = body.total;
    items.push(...(body.result || []));
    if (body.next == null) break;
    start = body.next;
  }
  return { items, total };
}

async function exportarEntidad(base, dir, ent, force) {
  const archivo = join(dir, `${ent.key}.json`);
  if (existsSync(archivo) && !force) {
    console.log(`  [${ent.key}] ya existe, se omite (usa --force para re-descargar).`);
    return JSON.parse(leerArchivoSync(archivo));
  }
  console.log(`  [${ent.key}] descargando (${ent.metodo})...`);
  let items, total;
  try {
    const select = ent.multifield ? ['*', 'UF_*', ...MULTIFIELD] : ['*', 'UF_*'];
    ({ items, total } = await listarTodo(base, ent.metodo, { select, order: { ID: 'asc' } }));
  } catch (err) {
    throw new Error(`[${ent.key}] fallo descargando (${ent.metodo}): ${err.message}`);
  }
  if (total != null && Number(total) !== items.length) {
    console.warn(`  [${ent.key}] AVISO: total reportado por Bitrix (${total}) != registros descargados (${items.length}).`);
  }
  escribirArchivoSync(archivo, JSON.stringify(items, null, 2));
  console.log(`  [${ent.key}] ${items.length} registros -> ${archivo}`);
  return items;
}

// select explicito (no el default de Bitrix) para leer TODOS los campos del
// comentario, igual que en los catalogos principales.
async function llamarComentarios(base, tipoTimeline, id) {
  const { items } = await listarTodo(base, 'crm.timeline.comment.list', {
    select: ['*'],
    filter: { ENTITY_ID: id, ENTITY_TYPE: tipoTimeline },
    order: { ID: 'asc' },
  });
  return items;
}

async function llamarActividades(base, ownerTypeId, id) {
  const { items } = await listarTodo(base, 'crm.activity.list', {
    select: ['*', 'UF_*'],
    filter: { OWNER_TYPE_ID: ownerTypeId, OWNER_ID: id },
    order: { ID: 'asc' },
  });
  return items;
}

// Exporta datos que requieren UN request por cada registro ya descargado
// (timeline / actividades), con reanudacion: escribe cada resultado como una
// linea NDJSON en un .tmp; si el proceso muere a la mitad, la siguiente
// corrida relee el .tmp, salta lo ya cubierto y sigue. Al terminar aplana
// todo a un JSON final y borra el .tmp (idempotente: si el JSON final ya
// existe, se omite el paso completo).
async function exportarPorRegistro({ nombre, dir, registrosPorTipo, llamar }) {
  const finalPath = join(dir, `${nombre}.json`);
  if (existsSync(finalPath)) {
    console.log(`  [${nombre}] ya existe, se omite.`);
    return JSON.parse(leerArchivoSync(finalPath)).length;
  }

  const tmpPath = join(dir, `${nombre}.ndjson.tmp`);
  const cubiertos = new Set();
  if (existsSync(tmpPath)) {
    for (const linea of leerArchivoSync(tmpPath).split('\n')) {
      if (!linea.trim()) continue;
      const entrada = JSON.parse(linea);
      cubiertos.add(`${entrada.tipo}:${entrada.id}`);
    }
    console.log(`  [${nombre}] reanudando: ${cubiertos.size} registros ya cubiertos en ${tmpPath}`);
  }

  let totalRegistros = 0;
  for (const lista of Object.values(registrosPorTipo)) totalRegistros += lista.length;
  let procesados = cubiertos.size;

  for (const [tipo, lista] of Object.entries(registrosPorTipo)) {
    for (const registro of lista) {
      const id = registro.ID;
      const clave = `${tipo}:${id}`;
      if (cubiertos.has(clave)) continue;
      let items;
      try {
        items = await llamar(tipo, id);
      } catch (err) {
        throw new Error(
          `${nombre}: fallo en ${tipo} id=${id} (${procesados}/${totalRegistros} ya procesados). ` +
          `Vuelve a correr el mismo comando para reanudar desde aqui. Detalle: ${err.message}`
        );
      }
      agregarArchivoSync(tmpPath, `${JSON.stringify({ tipo, id, items })}\n`);
      cubiertos.add(clave);
      procesados++;
      if (procesados % 100 === 0) console.log(`  [${nombre}] ${procesados}/${totalRegistros}...`);
    }
  }

  const todos = [];
  for (const linea of leerArchivoSync(tmpPath).split('\n')) {
    if (!linea.trim()) continue;
    todos.push(...JSON.parse(linea).items);
  }
  escribirArchivoSync(finalPath, JSON.stringify(todos, null, 2));
  borrarArchivoSync(tmpPath);
  console.log(`  [${nombre}] ${todos.length} registros (${procesados} entidades consultadas) -> ${finalPath}`);
  return todos.length;
}

async function main() {
  cargarEnv();
  const argv = process.argv.slice(2);
  const DRY_RUN = argv.includes('--dry-run');
  const FORCE = argv.includes('--force');

  const base = normalizarBase(process.env.BITRIX_WEBHOOK_URL);
  if (!base) {
    console.error('Falta BITRIX_WEBHOOK_URL en el entorno (.env local, JAMAS en un commit). Ver cabecera de este script.');
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('DRY-RUN: validando conectividad y conteos totales (sin descargar registros)...\n');
    for (const ent of ENTIDADES) {
      const body = await bitrixCall(base, ent.metodo, { select: ['ID'], start: 0 });
      console.log(`  ${ent.key}: total=${body.total}`);
    }
    console.log('\nDRY-RUN OK. Contrasta estos totales contra la UI de Bitrix antes de correr el export completo.');
    return;
  }

  const fecha = new Date().toISOString().slice(0, 10);
  const dir = join(ROOT, 'data', 'export-bitrix', fecha);
  mkdirSync(dir, { recursive: true });
  console.log(`Export completo de Bitrix24 (#158) -> ${dir}\n`);

  console.log('Catalogos principales:');
  const registrosPorTipo = {};
  for (const ent of ENTIDADES) {
    registrosPorTipo[ent.key] = await exportarEntidad(base, dir, ent, FORCE);
  }
  const entidadPorKey = Object.fromEntries(ENTIDADES.map((e) => [e.key, e]));

  console.log('\nTimeline (comentarios), un request por registro:');
  const totalComentarios = await exportarPorRegistro({
    nombre: 'timeline',
    dir,
    registrosPorTipo,
    llamar: (tipo, id) => llamarComentarios(base, entidadPorKey[tipo].tipoTimeline, id),
  });

  console.log('\nActividades, un request por registro:');
  const totalActividades = await exportarPorRegistro({
    nombre: 'actividades',
    dir,
    registrosPorTipo,
    llamar: (tipo, id) => llamarActividades(base, entidadPorKey[tipo].ownerTypeId, id),
  });

  const resumen = {
    generado: new Date().toISOString(),
    leads: registrosPorTipo.leads.length,
    contactos: registrosPorTipo.contactos.length,
    companias: registrosPorTipo.companias.length,
    deals: registrosPorTipo.deals.length,
    timeline: totalComentarios,
    actividades: totalActividades,
  };
  escribirArchivoSync(join(dir, 'resumen.json'), JSON.stringify(resumen, null, 2));
  console.log('\nResumen (contrasta contra la UI de Bitrix):');
  console.log(JSON.stringify(resumen, null, 2));

  console.log('\nSubiendo a Dropbox...');
  const { upload } = await import('../lib/dropbox.js');
  const destino = (process.env.BITRIX_EXPORT_DROPBOX_PATH || DROPBOX_PATH_DEFAULT).replace(/\/$/, '');
  const archivos = ['leads.json', 'contactos.json', 'companias.json', 'deals.json', 'timeline.json', 'actividades.json', 'resumen.json'];
  for (const archivo of archivos) {
    const ruta = join(dir, archivo);
    if (!existsSync(ruta)) continue;
    const contenido = leerArchivoSync(ruta);
    const pathDropbox = `${destino}/${fecha}/${archivo}`;
    await upload(pathDropbox, contenido, 'overwrite');
    console.log(`  subido: ${pathDropbox}`);
  }

  console.log('\nListo. Revisa resumen.json contra los conteos de la UI de Bitrix y pega la evidencia en el issue #158.');
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(`\nERROR: ${err.message}`);
    process.exit(1);
  });
}
