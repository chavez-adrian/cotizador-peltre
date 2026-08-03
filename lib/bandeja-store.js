import { existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from './fs-reintento.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { query } from './db.js';
import { esDebtorGenerico } from './deduplicacion.js';

// Persistencia de la bandeja de revision "Rescatados de Operam" (issue #122):
// Postgres (Neon) cuando hay DATABASE_URL, fallback a data/bandeja.json cuando
// no (dev local y tests). Mismo patron que lib/cotizaciones-store.js.
//
// La clave natural es el FOLIO del quote de Operam -- ahi vive la idempotencia
// de toda la bandeja: un folio ya propuesto no se vuelve a proponer, y uno ya
// resuelto (aceptado o descartado) nunca regresa a pendiente. El folio se guarda
// como texto (es un identificador, no un numero para operar; misma convencion
// que folio_operam en cotizaciones).
//
// FORMA DEL CAMPO `quote` (opcional, issue #125). El candidato tipo cotizacion
// carga el DETALLE del quote dentro de si mismo: quien lo propone (el lote de #124
// o el descubrimiento de #126) guarda aqui el payload que ya leyo de Operam, y
// aceptarlo construye la oportunidad DESDE este payload -- la aceptacion nunca
// habla con Operam. La forma es la MISMA que consumen construirEntradaCotizacion y
// mapearPartidasQuote de lib/backfill-operam.mjs (#76), es decir la respuesta cruda
// de GET /sales/quote/{folio} mas el debtor ya resuelto:
//   {
//     ord_date, delivery_date,          // fecha del quote y "Valido hasta" nativo
//     total, subtotal,                  // subtotal opcional: sin el se deriva /1.16
//     cust_ref | customer_ref,          // referencia del cliente -> Proyecto
//     deliver_to,                       // contacto de entrega -> Prospecto
//     debtor_no,
//     salesman | branch: { salesman },  // vendedor de Operam (operam_id)
//     user: { real_name },              // usuario creador (fallback de vendedor)
//     detalles: [                       // PARTIDAS: sin ellas el documento
//       { stock_id, stock_id_text,      // regenerado sale sin renglones
//         quantity, units, unit_price, discount_percent }
//     ],
//     debtor: { debtor_no, CustName, tax_id, curr_code }  // el cliente del quote;
//   }                                   // tax_id es el RFC con el que liga el sync
// Se persiste TAL CUAL (JSONB en Neon, objeto en el JSON de disco): el store no lo
// interpreta, solo lo transporta.

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, '..', 'data', 'bandeja.json');

// Marca de origen en el prospecto creado al aceptar: la tarjeta no nacio de una
// captura del vendedor sino del rescate de un quote de Operam (misma idea que
// FUENTE_ALTA_GENERICA en lib/alta-generica.js).
export const FUENTE_BANDEJA_OPERAM = 'bandeja-operam';

export const TIPOS = ['prospecto', 'cotizacion'];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS bandeja_operam (
    folio TEXT PRIMARY KEY,
    tipo TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'pendiente',
    fecha TIMESTAMPTZ,
    contacto TEXT,
    celular TEXT,
    email TEXT,
    proyecto TEXT,
    domicilio TEXT,
    monto NUMERIC,
    debtor_id INTEGER,
    debtor_nombre TEXT,
    vendedor TEXT,
    marcas JSONB NOT NULL DEFAULT '{}',
    prospecto_id INTEGER
  )
`;

// Detalle del quote de Operam que carga el candidato tipo cotizacion (issue #125)
// y la cotizacion del pipeline a la que se acepto. Se anaden por separado (CREATE
// TABLE IF NOT EXISTS no altera columnas ya creadas), mismo patron que las columnas
// tardias de cotizaciones-store. Idempotente.
const SCHEMA_QUOTE = `ALTER TABLE bandeja_operam ADD COLUMN IF NOT EXISTS quote JSONB`;
const SCHEMA_COTIZACION = `ALTER TABLE bandeja_operam ADD COLUMN IF NOT EXISTS cotizacion_id INTEGER`;

let schemaListo = null;
async function ensureSchema() {
  if (!schemaListo) {
    schemaListo = query(SCHEMA)
      .then(() => query(SCHEMA_QUOTE))
      .then(() => query(SCHEMA_COTIZACION));
  }
  return schemaListo;
}

function leerJson() {
  if (!existsSync(JSON_PATH)) return [];
  return JSON.parse(leerArchivoSync(JSON_PATH));
}

function escribirJson(data) {
  escribirArchivoSync(JSON_PATH, JSON.stringify(data, null, 2));
}

// Las dos marcas del candidato viajan siempre completas (nunca undefined): la
// vista las pinta por presencia y un booleano ausente se leeria como false por
// accidente en vez de por decision. "comproOtraCosa" viene del cruce por
// identidad (#123) y "posibleDuplicado" del indice de telefonos (#42).
function normalizarMarcas(marcas) {
  const m = marcas || {};
  return {
    comproOtraCosa: m.comproOtraCosa === true,
    posibleDuplicado: m.posibleDuplicado === true,
  };
}

function texto(v) {
  return v == null ? '' : String(v);
}

function filaAEntrada(row) {
  return {
    folio: String(row.folio),
    tipo: row.tipo,
    estado: row.estado,
    fecha: row.fecha instanceof Date ? row.fecha.toISOString() : row.fecha,
    contacto: texto(row.contacto),
    celular: texto(row.celular),
    email: texto(row.email),
    proyecto: texto(row.proyecto),
    domicilio: texto(row.domicilio),
    monto: row.monto == null ? 0 : Number(row.monto),
    debtorId: row.debtor_id == null ? null : Number(row.debtor_id),
    // Un debtor GENERICO (cliente-cajon) jamas puede aceptarse como cotizacion del
    // pipeline (#125): el fallback por cliente del binding del sync (#67, prioridad
    // 3) mezclaria las transacciones de todos los contactos que comparten el debtor
    // y cerraria esas tarjetas en masa. La marca viaja derivada del debtorId para
    // que el gate del servidor y la vista lean el MISMO dato; el gate NO confia en
    // este campo (lo re-deriva del debtorId), la vista solo lo pinta.
    debtorGenerico: esDebtorGenerico(row.debtor_id),
    debtorNombre: texto(row.debtor_nombre),
    vendedor: row.vendedor == null ? null : row.vendedor,
    marcas: normalizarMarcas(row.marcas),
    prospectoId: row.prospecto_id == null ? null : Number(row.prospecto_id),
    // Detalle del quote (#125). null cuando el candidato no lo trae (los de #122
    // no lo cargaban): la ausencia se expone como null, nunca como undefined, para
    // que el caller distinga "no hay payload" de "campo que no viaja".
    quote: row.quote == null ? null : row.quote,
    cotizacionId: row.cotizacion_id == null ? null : Number(row.cotizacion_id),
  };
}

function entradaJson(c) {
  return filaAEntrada({
    folio: c.folio,
    tipo: c.tipo,
    estado: c.estado,
    fecha: c.fecha,
    contacto: c.contacto,
    celular: c.celular,
    email: c.email,
    proyecto: c.proyecto,
    domicilio: c.domicilio,
    monto: c.monto,
    debtor_id: c.debtorId,
    debtor_nombre: c.debtorNombre,
    vendedor: c.vendedor,
    marcas: c.marcas,
    prospecto_id: c.prospectoId,
    quote: c.quote,
    cotizacion_id: c.cotizacionId,
  });
}

// Del mas reciente al mas viejo: la bandeja se trabaja empezando por lo ultimo
// que paso en Operam. El folio desempata (es creciente en el tiempo).
function porFechaDesc(a, b) {
  const fa = a.fecha || '';
  const fb = b.fecha || '';
  if (fa !== fb) return fb.localeCompare(fa);
  return String(b.folio).localeCompare(String(a.folio), undefined, { numeric: true });
}

export async function listar() {
  await ensureSchema();
  const r = await query('SELECT * FROM bandeja_operam ORDER BY fecha DESC NULLS LAST, folio DESC');
  if (r === null) return leerJson().map(entradaJson).sort(porFechaDesc);
  return r.rows.map(filaAEntrada);
}

export async function obtener(folio) {
  const clave = String(folio == null ? '' : folio);
  await ensureSchema();
  const r = await query('SELECT * FROM bandeja_operam WHERE folio = $1', [clave]);
  if (r === null) {
    const c = leerJson().find(c => String(c.folio) === clave);
    return c ? entradaJson(c) : undefined;
  }
  return r.rows[0] ? filaAEntrada(r.rows[0]) : undefined;
}

// Propone un candidato a la bandeja. Devuelve true si lo agrego y false si el
// folio ya estaba en la bandeja -- en CUALQUIER estado. Esa es la idempotencia
// que pide el issue: un candidato aceptado o descartado no puede re-proponerse,
// y uno pendiente no se duplica ni se pisa (lo que el humano ve es lo que se
// propuso). El candidato nace SIEMPRE pendiente y sin prospecto ligado.
export async function proponer(candidato) {
  const c = candidato || {};
  const folio = String(c.folio == null ? '' : c.folio).trim();
  if (!folio) throw new Error('El candidato necesita folio de Operam (clave natural de la bandeja)');
  if (!TIPOS.includes(c.tipo)) throw new Error(`Tipo de candidato invalido: ${c.tipo}`);
  const marcas = normalizarMarcas(c.marcas);
  const quote = c.quote == null ? null : c.quote;
  await ensureSchema();
  const r = await query(
    `INSERT INTO bandeja_operam
       (folio, tipo, estado, fecha, contacto, celular, email, proyecto, domicilio, monto, debtor_id, debtor_nombre, vendedor, marcas, quote)
     VALUES ($1, $2, 'pendiente', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb)
     ON CONFLICT (folio) DO NOTHING`,
    [folio, c.tipo, c.fecha || null, texto(c.contacto), texto(c.celular), texto(c.email),
      texto(c.proyecto), texto(c.domicilio), c.monto == null ? 0 : Number(c.monto),
      c.debtorId == null ? null : Number(c.debtorId), texto(c.debtorNombre),
      c.vendedor || null, JSON.stringify(marcas),
      quote == null ? null : JSON.stringify(quote)]
  );
  if (r === null) {
    const log = leerJson();
    if (log.some(x => String(x.folio) === folio)) return false;
    log.push({
      folio, tipo: c.tipo, estado: 'pendiente', fecha: c.fecha || null,
      contacto: texto(c.contacto), celular: texto(c.celular), email: texto(c.email),
      proyecto: texto(c.proyecto), domicilio: texto(c.domicilio),
      monto: c.monto == null ? 0 : Number(c.monto),
      debtorId: c.debtorId == null ? null : Number(c.debtorId),
      debtorNombre: texto(c.debtorNombre), vendedor: c.vendedor || null,
      marcas, prospectoId: null, quote, cotizacionId: null,
    });
    escribirJson(log);
    return true;
  }
  return r.rowCount > 0;
}

// Acepta el candidato: lo marca aceptado, fija el vendedor con el que se creo la
// tarjeta y lo liga a lo creado -- el prospecto (#122) o la cotizacion del pipeline
// (#125), segun el camino por el que se acepto. La transicion es ATOMICA sobre el
// estado pendiente -- devuelve false si el folio no existe o si ya estaba resuelto,
// y en ese caso NO pisa el vendedor ni la liga previa. Asi un doble click (o dos
// runs) no crean dos tarjetas para el mismo folio.
export async function aceptar(folio, { vendedor, prospectoId, cotizacionId } = {}) {
  const clave = String(folio == null ? '' : folio);
  await ensureSchema();
  const r = await query(
    `UPDATE bandeja_operam SET estado = 'aceptado', vendedor = COALESCE($2, vendedor), prospecto_id = $3, cotizacion_id = $4
     WHERE folio = $1 AND estado = 'pendiente'`,
    [clave, vendedor || null, prospectoId == null ? null : Number(prospectoId),
      cotizacionId == null ? null : Number(cotizacionId)]
  );
  if (r === null) {
    const log = leerJson();
    const entry = log.find(c => String(c.folio) === clave);
    if (!entry || entry.estado !== 'pendiente') return false;
    entry.estado = 'aceptado';
    if (vendedor) entry.vendedor = vendedor;
    entry.prospectoId = prospectoId == null ? null : Number(prospectoId);
    entry.cotizacionId = cotizacionId == null ? null : Number(cotizacionId);
    escribirJson(log);
    return true;
  }
  return r.rowCount > 0;
}

// Descarta el candidato: MARCA, nunca borra (el issue lo pide explicito -- el
// folio descartado sigue en la bandeja para que ningun run futuro lo re-proponga).
// Misma transicion atomica desde pendiente que aceptar.
export async function descartar(folio) {
  const clave = String(folio == null ? '' : folio);
  await ensureSchema();
  const r = await query(
    "UPDATE bandeja_operam SET estado = 'descartado' WHERE folio = $1 AND estado = 'pendiente'",
    [clave]
  );
  if (r === null) {
    const log = leerJson();
    const entry = log.find(c => String(c.folio) === clave);
    if (!entry || entry.estado !== 'pendiente') return false;
    entry.estado = 'descartado';
    escribirJson(log);
    return true;
  }
  return r.rowCount > 0;
}
