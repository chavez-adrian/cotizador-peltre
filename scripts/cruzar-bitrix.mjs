// Cruce del export de Bitrix24 contra el cotizador y Operam (issue #159, padre
// #155). Clasifica cada identidad del export en (a) ya existe, (b) prospecto
// vivo sin presencia en nuestros sistemas -- candidato a importar -- y (c) resto
// historico, y escribe un REPORTE en markdown para que Adrian lo revise.
//
// ESTE SCRIPT NO IMPORTA NADA. Es READ-ONLY contra Operam y contra Neon (solo
// SELECT) y su unica escritura es el reporte .md dentro del directorio del
// export, que esta en .gitignore. La importacion vive en scripts/importar-bitrix.mjs
// y exige la aprobacion explicita de Adrian sobre la lista (b).
//
// Uso:
//   DATABASE_URL="postgres://..." node scripts/cruzar-bitrix.mjs
//   DATABASE_URL="..." node scripts/cruzar-bitrix.mjs --ventana 90
//   DATABASE_URL="..." node scripts/cruzar-bitrix.mjs --fecha 2026-08-16
//
// DATABASE_URL es OBLIGATORIA y se pasa por el entorno EN LA INVOCACION: la
// regla de la casa prohibe ponerla en el .env local (varias suites escriben via
// stores y le pegarian a la Neon de produccion). Sin ella el cruce seria una
// mentira: los prospectos ya importados del cotizador apareceran como
// candidatos nuevos y el reporte propondria duplicar identidades vivas.
import { existsSync, readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { leerArchivoSync, escribirArchivoSync } from '../lib/fs-reintento.js';
import { clasificarBitrix, VENTANA_VIVO_DIAS, MAPA_SOURCE_CANAL, normalizarCorreo, esTelefonoMexicano } from '../lib/cruce-bitrix.js';
import { ultimos10 } from '../lib/telefono-llave.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIR_EXPORT = join(ROOT, 'data', 'export-bitrix');

// Solo OPERAM_*: DATABASE_URL jamas se lee del .env (ver cabecera).
const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^(OPERAM_[A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const argv = process.argv.slice(2);
function flag(nombre, porDefecto = null) {
  const i = argv.indexOf(nombre);
  return i === -1 ? porDefecto : argv[i + 1];
}

const VENTANA = Number(flag('--ventana', VENTANA_VIVO_DIAS));
if (!Number.isFinite(VENTANA) || VENTANA <= 0) {
  console.error('ABORTA: --ventana necesita un numero de dias positivo.');
  process.exit(1);
}

function ultimaFechaDeExport() {
  if (!existsSync(DIR_EXPORT)) return null;
  const fechas = readdirSync(DIR_EXPORT).filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f)).sort();
  return fechas.length ? fechas[fechas.length - 1] : null;
}

const FECHA = flag('--fecha') || ultimaFechaDeExport();
if (!FECHA) {
  console.error(`ABORTA: no hay export en ${DIR_EXPORT}. Corre antes scripts/export-bitrix.mjs (#158).`);
  process.exit(1);
}
const DIR = join(DIR_EXPORT, FECHA);

if (!process.env.DATABASE_URL) {
  console.error(
    'ABORTA: falta DATABASE_URL (la Neon de PRODUCCION del cotizador).\n\n' +
    'Sin ella no se pueden leer los prospectos del cotizador y el cruce quedaria\n' +
    'incompleto: los prospectos que YA existen apareceran como candidatos nuevos y\n' +
    'el reporte propondria duplicar identidades vivas. Pasala EN LA INVOCACION\n' +
    '(nunca en el .env, que lo leen las suites de tests):\n\n' +
    '  DATABASE_URL="postgres://..." node scripts/cruzar-bitrix.mjs\n'
  );
  process.exit(1);
}

function cargar(nombre) {
  const ruta = join(DIR, `${nombre}.json`);
  if (!existsSync(ruta)) return [];
  return JSON.parse(leerArchivoSync(ruta));
}

// --- Identidades del COTIZADOR (Neon, SOLO SELECT) ---
async function identidadesCotizador() {
  const { query } = await import('../lib/db.js');
  const telefonos = new Set();
  const correos = new Set();

  const prospectos = await query(
    "SELECT celular10, data->>'correo' AS correo FROM prospectos"
  );
  if (prospectos === null) throw new Error('lib/db.js no abrio pool: DATABASE_URL invalida.');
  for (const row of prospectos.rows) {
    if (row.celular10) telefonos.add(row.celular10);
    const correo = normalizarCorreo(row.correo);
    if (correo) correos.add(correo);
  }

  // La bandeja de revision (#122/#124) tambien es presencia conocida: un
  // candidato que ya espera decision ahi no debe volver a entrar por Bitrix.
  let bandeja = { rows: [] };
  try {
    bandeja = await query('SELECT celular, email FROM bandeja_operam') || { rows: [] };
  } catch (err) {
    console.warn(`  aviso: no se pudo leer bandeja_operam (${err.message}); se sigue sin ella.`);
  }
  for (const row of bandeja.rows) {
    const llave = ultimos10(row.celular);
    if (llave.length === 10) telefonos.add(llave);
    const correo = normalizarCorreo(row.email);
    if (correo) correos.add(correo);
  }

  return { telefonos, correos, prospectos: prospectos.rows.length, bandeja: bandeja.rows.length };
}

// --- Identidades de OPERAM (read-only) ---
async function identidadesOperam() {
  const { listarTodosClientes } = await import('../lib/operam-client.js');
  const clientes = await listarTodosClientes();
  const telefonos = new Set();
  const correos = new Set();
  for (const c of clientes) {
    const crudos = [c.phone];
    for (const ct of c.contacts || []) {
      crudos.push(ct.phone, ct.phone2);
      const correo = normalizarCorreo(ct.email);
      if (correo) correos.add(correo);
    }
    for (const b of c.branches || []) crudos.push(b.phone);
    for (const raw of crudos) {
      if (!raw) continue;
      const llave = ultimos10(raw);
      if (llave.length === 10) telefonos.add(llave);
    }
  }
  return { telefonos, correos, clientes: clientes.length };
}

// Nombre legible de cada SOURCE_ID, tal como lo muestra Bitrix
// (crm.status.list ENTITY_ID=SOURCE, leido el 2026-08-16). Solo para el
// reporte: el mapeo que manda es MAPA_SOURCE_CANAL.
const NOMBRES_BITRIX = {
  'WZdaac8842-31c5-4d24-b0b4-1e3f81aef185': 'Whatsapp 5217207870782',
  '2|FBINSTAGRAMDIRECT': 'Instagram Direct - Canal Abierto',
  '2|FACEBOOK': 'Facebook - Canal Abierto',
  WEBFORM: 'Formulario Mayoreo',
  EMAIL: 'E-Mail',
  REPEAT_SALE: 'Abastur',
  PARTNER: 'Cliente Existente',
  RECOMMENDATION: 'Por Recomendacion',
  CALL: 'Llamada',
  CALLBACK: 'Videollamada',
  STORE: 'Tienda online',
  WEB: 'Sitio web',
  RC_GENERATOR: 'Impulso de ventas',
  BOOKING: 'Reserva online',
  OTHER: 'Otro',
  '': '(sin origen)',
};

// --- Reporte ---
function tabla(encabezados, filas) {
  const escapar = v => String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const lineas = [
    `| ${encabezados.join(' | ')} |`,
    `| ${encabezados.map(() => '---').join(' | ')} |`,
  ];
  for (const fila of filas) lineas.push(`| ${fila.map(escapar).join(' | ')} |`);
  return lineas.join('\n');
}

function agrupar(lista, clave) {
  const m = new Map();
  for (const x of lista) {
    const k = clave(x);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function generarReporte({ resultado, sensibilidad, cotizador, operam, hoy, exportBitrix }) {
  const { candidatos, yaExiste, resto, conteos } = resultado;
  const L = [];

  L.push('# Cruce del export de Bitrix24 - lista para revision');
  L.push('');
  L.push(`**Generado:** ${hoy.toISOString()}  `);
  L.push(`**Export:** \`data/export-bitrix/${FECHA}/\` (leads ${exportBitrix.leads.length}, contactos ${exportBitrix.contactos.length}, companias ${exportBitrix.companias.length}, deals ${exportBitrix.deals.length}, actividades ${exportBitrix.actividades.length})  `);
  L.push(`**Cruzado contra:** cotizador (${cotizador.prospectos} prospectos + ${cotizador.bandeja} en bandeja) y Operam (${operam.clientes} clientes)  `);
  L.push(`**Ventana de "vivo":** ${resultado.ventanaDias} dias`);
  L.push('');
  L.push('> **NADA SE HA IMPORTADO.** Este documento es la lista que espera tu aprobacion.');
  L.push('> La importacion corre aparte (`scripts/importar-bitrix.mjs`) y solo despues de que');
  L.push('> apruebes la lista (b) y el mapeo de canales de la seccion 3.');
  L.push('');

  L.push('## 1. Conteos');
  L.push('');
  L.push(tabla(['Categoria', 'Identidades', 'Que se hace'], [
    ['(a) Ya existe en cotizador u Operam', conteos.yaExiste, 'No se toca'],
    ['**(b) Prospecto vivo sin presencia**', `**${conteos.candidatos}**`, 'Candidato a importar - REQUIERE TU APROBACION'],
    ['(c) Resto historico', conteos.resto, 'Queda solo en el respaldo de Dropbox'],
    ['Total de identidades', conteos.identidades, ''],
  ]));
  L.push('');
  L.push(`Las ${conteos.identidades} identidades salen de fusionar los ${exportBitrix.leads.length + exportBitrix.contactos.length + exportBitrix.companias.length} registros de Bitrix: el mismo humano repetido como lead y como contacto cuenta UNA vez (se fusiona por celular y por la liga \`CONTACT_ID\` del propio Bitrix).`);
  L.push('');

  L.push('## 2. Criterio de "vivo" (el que decide quien entra en (b))');
  L.push('');
  L.push('Una identidad es candidata **solo si cumple TODO** lo siguiente:');
  L.push('');
  L.push('1. **No existe** en el cotizador ni en Operam (llave primaria: ultimos 10 digitos del celular; secundaria: correo en minusculas).');
  L.push('2. **Tiene celular usable** (10 digitos). Sin celular no hay importacion posible: es obligatorio en la captura y es la llave de deduplicacion.');
  L.push('3. **No fue descartada a mano en Bitrix** (lead en `JUNK` / "Prospecto no util"). Ese es un juicio humano explicito y se respeta; la unica excepcion es que tenga un deal abierto, que lo contradice de frente.');
  L.push('4. **Tiene al menos una senal de vida** dentro de la ventana de ' + resultado.ventanaDias + ' dias:');
  L.push('');
  L.push(tabla(['Senal', 'Que significa'], [
    ['`deal-abierto`', 'Un deal ligado sigue abierto (`CLOSED=N`, etapa en proceso) y con movimiento en la ventana'],
    ['`actividad-reciente`', 'Hay una actividad registrada (llamada, correo, chat, formulario) en la ventana, sobre la persona o sobre su deal'],
    ['`lead-en-proceso`', 'Un lead sigue en etapa de proceso y se movio dentro de la ventana'],
    ['`alta-reciente`', 'El registro se creo dentro de la ventana (interes fresco que nadie alcanzo a trabajar)'],
  ]));
  L.push('');
  L.push('**En la duda va a (c), no a (b)**: importar basura al embudo cuesta mas que dejar un caso dudoso en el historico, que de todas formas queda completo en Dropbox.');
  L.push('');
  L.push('Dos decisiones que conviene que revises porque nacen de datos sucios:');
  L.push('');
  L.push('- **`LAST_COMMUNICATION_TIME` se ignora.** Bitrix lo entrega como `DD/MM/YYYY` mientras el resto de sus fechas son ISO; leerlo sin cuidado produce fechas en el futuro (9 casos reales en este export). No se adivina: se ignora.');
  L.push('- **`TYPE_ID=SUPPLIER` NO excluye a nadie.** 210 de los ' + exportBitrix.contactos.length + ' contactos estan marcados como "proveedor", pero al leerlos son prospectos de Abastur ("mayoreo cadena de restaurantes", "enviar catalogo"): es un error de la carga masiva, no un dato. Excluirlos habria tirado la mayor parte del historico comercial.');
  L.push('');

  L.push('### Sensibilidad de la ventana');
  L.push('');
  L.push('Cuantos candidatos salen si mueves el unico numero discutible del criterio:');
  L.push('');
  L.push(tabla(['Ventana', '(a) Ya existe', '(b) Candidatos', '(c) Resto'],
    sensibilidad.map(s => [`${s.dias} dias${s.dias === resultado.ventanaDias ? ' **(usada)**' : ''}`, s.yaExiste, s.candidatos, s.resto])));
  L.push('');

  L.push('## 3. Mapeo de origen (Bitrix) -> canal (cotizador) - REQUIERE TU APROBACION');
  L.push('');
  L.push('El canal no es cosmetico: decide la cadencia de seguimiento (el semaforo por canal). Por eso ninguno se inventa fuera del catalogo cerrado.');
  L.push('');
  // La tabla se DERIVA de MAPA_SOURCE_CANAL (lib/cruce-bitrix.js): si alguien
  // cambia el mapeo, el reporte que aprueba Adrian cambia con el. Duplicarlo a
  // mano aqui era la via directa a que el documento aprobado y el codigo que
  // importa dijeran cosas distintas.
  const usados = new Map(agrupar(candidatos, c => c.sourceId || ''));
  L.push(tabla(['SOURCE_ID de Bitrix', 'Nombre en Bitrix', 'Canal propuesto', 'Candidatos'],
    Object.entries(MAPA_SOURCE_CANAL).map(([source, canal]) => [
      source.length > 24 ? `${source.slice(0, 12)}...${source.slice(-6)}` : source,
      NOMBRES_BITRIX[source] || '',
      canal,
      usados.get(source) || 0,
    ])));
  L.push('');
  L.push('**Ojo con `REPEAT_SALE`:** el nombre suena a recompra, pero en este Bitrix es la etiqueta de **Abastur** (la feria). Por eso mapea a `Feria/Expo`.');
  L.push('');
  const sinCanal = candidatos.filter(c => !c.canal);
  L.push(`**Sin canal equivalente (${sinCanal.length} candidatos).** El catalogo del cotizador no tiene entrada para estos origenes. El importador **se niega** a importarlos hasta que decidas:`);
  L.push('');
  if (sinCanal.length) {
    L.push(tabla(['SOURCE_ID', 'Nombre en Bitrix', 'Candidatos', 'Decision pendiente'],
      agrupar(sinCanal, c => c.sourceId || '').map(([src, n]) => [
        src || '(vacio)',
        NOMBRES_BITRIX[src] || src,
        n,
        'elegir canal o dejarlos fuera',
      ])));
  } else {
    L.push('_Ninguno: todos los candidatos tienen canal mapeado._');
  }
  L.push('');

  L.push(`## 4. (b) Candidatos a importar - ${candidatos.length}`);
  L.push('');
  L.push('Esta es **la lista que apruebas o recortas**. Ordenada por actividad mas reciente.');
  L.push('');
  const ordenados = [...candidatos].sort((a, b) => {
    const da = a.ultimaActividadDias == null ? 99999 : a.ultimaActividadDias;
    const db = b.ultimaActividadDias == null ? 99999 : b.ultimaActividadDias;
    return da - db;
  });
  L.push(tabla(
    ['#', 'Nombre', 'Celular', 'Correo', 'Empresa', 'Origen (Bitrix)', 'Canal', 'Ult. act.', 'Por que esta vivo', 'Registros'],
    ordenados.map((c, i) => [
      i + 1,
      c.nombre || '(sin nombre)',
      esTelefonoMexicano(c.telefono) ? c.telefono : `${c.telefono} (no MX)`,
      c.correo || '',
      c.empresa,
      c.sourceId || '(vacio)',
      c.canal || '**SIN CANAL**',
      c.ultimaActividadDias == null ? '?' : `${c.ultimaActividadDias}d`,
      c.senales.join(', '),
      c.origenes.join(' '),
    ])
  ));
  L.push('');
  const extranjeros = ordenados.filter(c => !esTelefonoMexicano(c.telefono));
  if (extranjeros.length) {
    L.push(`**${extranjeros.length} con telefono de otro pais** (marcados "no MX"): no se descartan solos porque son inquietudes reales, pero son otra venta. Dime si los quieres fuera.`);
    L.push('');
  }
  L.push('**Todos entrarian sin ciudad.** Bitrix no guarda ciudad: `ADDRESS_CITY` viene vacio en los 693 registros del export. El prospecto nace sin ella y el vendedor la captura al primer contacto; sin ciudad no se puede estimar envio. Derivarla de la lada del telefono seria adivinar.');
  L.push('');

  L.push(`## 5. (a) Ya existen - ${yaExiste.length}`);
  L.push('');
  L.push('No se tocan. Resumen por la llave con la que se reconocieron:');
  L.push('');
  L.push(tabla(['Llave', 'Sistema', 'Identidades'],
    agrupar(yaExiste, x => `${x.llave}|${x.donde}`).map(([k, n]) => [k.split('|')[0], k.split('|')[1], n])));
  L.push('');
  L.push('<details><summary>Ver las ' + yaExiste.length + ' identidades</summary>');
  L.push('');
  L.push(tabla(['Nombre', 'Celular', 'Empresa', 'Llave', 'Sistema'],
    yaExiste.map(x => [x.nombre || '(sin nombre)', x.telefono, x.empresa, x.llave, x.donde])));
  L.push('');
  L.push('</details>');
  L.push('');

  L.push(`## 6. (c) Resto historico - ${resto.length}`);
  L.push('');
  L.push('Se queda solo en el respaldo de Dropbox. Motivos:');
  L.push('');
  L.push(tabla(['Motivo', 'Identidades', 'Que significa'],
    agrupar(resto, x => x.motivo).map(([m, n]) => [m, n, {
      'sin-senal-de-vida': 'Nadie lo toco dentro de la ventana y no tiene deal abierto',
      'sin-celular': 'No hay celular de 10 digitos: no se puede importar ni deduplicar',
      'descartado-en-bitrix': 'Marcado a mano como "Prospecto no util" en Bitrix',
    }[m] || ''])));
  L.push('');
  L.push('<details><summary>Ver los descartados por falta de celular (por si reconoces alguno)</summary>');
  L.push('');
  const sinCel = resto.filter(x => x.motivo === 'sin-celular');
  L.push(tabla(['Nombre', 'Correo', 'Empresa', 'Origen', 'Ult. act.'],
    sinCel.map(x => [x.nombre || '(sin nombre)', x.correo || '', x.empresa, x.sourceId || '', x.ultimaActividadDias == null ? '?' : `${x.ultimaActividadDias}d`])));
  L.push('');
  L.push('</details>');
  L.push('');

  L.push('## 7. Si apruebas');
  L.push('');
  L.push('1. Dime que candidatos quitar (por numero de la tabla 4), si hay alguno.');
  L.push('2. Decide el canal de los origenes sin mapeo de la seccion 3 (o confirma que quedan fuera).');
  L.push('3. Hasta entonces no se importa nada.');
  L.push('');

  return L.join('\n');
}

async function main() {
  console.log(`Cruce del export de Bitrix (#159) -- export ${FECHA}, ventana ${VENTANA} dias\n`);
  console.log('READ-ONLY: cero escrituras a Operam, cero escrituras a Bitrix, SOLO SELECT en Neon.');
  console.log('NO IMPORTA NADA: la unica salida es el reporte .md.\n');

  const exportBitrix = {
    leads: cargar('leads'),
    contactos: cargar('contactos'),
    companias: cargar('companias'),
    deals: cargar('deals'),
    actividades: cargar('actividades'),
  };
  if (!exportBitrix.contactos.length && !exportBitrix.leads.length) {
    console.error(`ABORTA: el export de ${DIR} viene vacio.`);
    process.exit(1);
  }
  const conTelefono = exportBitrix.contactos.filter(c => (c.PHONE || []).length).length;
  if (conTelefono === 0) {
    console.error(
      'ABORTA: el export NO trae telefonos (campo PHONE ausente en todos los contactos).\n' +
      'El comodin "*" de Bitrix no incluye los campos multiples: hay que pedir PHONE/EMAIL\n' +
      'por nombre. Vuelve a correr scripts/export-bitrix.mjs --force (ya corregido) ANTES\n' +
      'de que venza el plan de Bitrix; sin telefono no hay llave de identidad y el cruce\n' +
      'no significa nada.'
    );
    process.exit(1);
  }
  console.log(`  export cargado: ${exportBitrix.contactos.length} contactos (${conTelefono} con telefono), ${exportBitrix.leads.length} leads, ${exportBitrix.deals.length} deals`);

  console.log('  leyendo prospectos del cotizador (Neon, SELECT)...');
  const cotizador = await identidadesCotizador();
  console.log(`    ${cotizador.prospectos} prospectos, ${cotizador.bandeja} en bandeja -> ${cotizador.telefonos.size} telefonos, ${cotizador.correos.size} correos`);

  console.log('  leyendo clientes de Operam (read-only)...');
  const operam = await identidadesOperam();
  console.log(`    ${operam.clientes} clientes -> ${operam.telefonos.size} telefonos, ${operam.correos.size} correos`);

  const hoy = new Date();
  const entrada = { exportBitrix, cotizador, operam };
  const resultado = clasificarBitrix(entrada, { hoy, ventanaDias: VENTANA });

  const sensibilidad = [90, 180, 365].map(dias => {
    const r = clasificarBitrix(entrada, { hoy, ventanaDias: dias });
    return { dias, yaExiste: r.conteos.yaExiste, candidatos: r.conteos.candidatos, resto: r.conteos.resto };
  });

  console.log('\nClasificacion:');
  console.log(`  (a) ya existe: ${resultado.conteos.yaExiste}`);
  console.log(`  (b) candidatos vivos: ${resultado.conteos.candidatos}`);
  console.log(`  (c) resto historico: ${resultado.conteos.resto}`);
  console.log(`  total identidades: ${resultado.conteos.identidades}`);

  const reporte = generarReporte({ resultado, sensibilidad, cotizador, operam, hoy, exportBitrix });
  const destino = join(DIR, 'REPORTE-CRUCE.md');
  escribirArchivoSync(destino, reporte);
  const datos = join(DIR, 'cruce.json');
  escribirArchivoSync(datos, JSON.stringify({
    generado: hoy.toISOString(),
    ventanaDias: VENTANA,
    conteos: resultado.conteos,
    candidatos: resultado.candidatos,
  }, null, 2));

  console.log(`\nReporte -> ${destino}`);
  console.log(`Datos de los candidatos -> ${datos}`);
  console.log('\nNADA IMPORTADO. Revisa el reporte con Adrian antes de correr scripts/importar-bitrix.mjs.');
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(`\nERROR: ${err.message}`);
      process.exit(1);
    });
}
