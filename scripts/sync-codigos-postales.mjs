// Sync MANUAL del indice CP -> ciudad/estado desde GeoNames (issue #160,
// ADR-0012 pto. 3). Descarga MX.zip/US.zip/CA.zip de download.geonames.org
// (CC BY 4.0, atribucion en el pie de public/mayoreo.html), construye el indice
// con el nucleo puro de lib/codigos-postales.js (MX = municipio, no colonia, con
// las normalizaciones de estado del #160; US = ciudad + abreviatura de estado;
// CA = solo el FSA de 3 caracteres -- CA_full.csv.zip NUNCA se toca, es dato
// licenciado por Canada Post) y lo commitea a data/cp-mx.json / cp-us.json /
// cp-ca.json: el disco de Render es efimero y el arranque del cotizador no debe
// depender de que geonames.org este arriba.
//
// Mismo patron operativo que scripts/sync-catalogo.mjs: dry-run por default
// (descarga + resumen, NO escribe), --apply escribe, escritura via
// lib/fs-reintento.js (NUNCA fs directo -- OneDrive suelta EBUSY).
//
// No se usa ningun paquete de unzip: GeoNames publica zips simples (STORE o
// DEFLATE, sin cifrar, sin ZIP64) y un lector minimo del directorio central mas
// zlib.inflateRawSync alcanza (verificado byte a byte contra bsdtar el
// 2026-08-16). Evita una dependencia nueva y el problema de que en Windows el
// `tar` de Git Bash NO entiende .zip (el de System32 si, pero no es portable).
//
// Uso:
//   node scripts/sync-codigos-postales.mjs           # DRY-RUN: descarga + resumen (NO escribe)
//   node scripts/sync-codigos-postales.mjs --apply    # escribe data/cp-mx.json, cp-us.json, cp-ca.json
import { existsSync } from 'fs';
import { inflateRawSync } from 'zlib';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { leerArchivoSync, escribirArchivoSync } from '../lib/fs-reintento.js';
import { construirIndiceCP } from '../lib/codigos-postales.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, '..', 'data');

const PAISES = ['MX', 'US', 'CA'];
// Umbral de cordura por pais (muy por debajo de los conteos reales del #160:
// 32448/41488/1653): una descarga degenerada (geonames.org caido a medias, zip
// truncado) no debe pisar el indice commiteado en silencio.
const MINIMO_ESPERADO = { MX: 1000, US: 1000, CA: 100 };

async function descargarZip(pais) {
  const url = `https://download.geonames.org/export/zip/${pais}.zip`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GeoNames respondio ${res.status} para ${pais}.zip`);
  return Buffer.from(await res.arrayBuffer());
}

// Lector minimo de ZIP: ubica el End Of Central Directory al final del archivo,
// camina el directorio central buscando `nombreArchivo` y decodifica sus datos
// (metodo 0 = guardado tal cual, metodo 8 = deflate crudo via zlib).
function extraerTxt(zipBuffer, nombreArchivo) {
  const EOCD_SIG = 0x06054b50;
  let eocdOffset = -1;
  const desde = Math.max(0, zipBuffer.length - 22 - 65557);
  for (let i = zipBuffer.length - 22; i >= desde; i--) {
    if (zipBuffer.readUInt32LE(i) === EOCD_SIG) { eocdOffset = i; break; }
  }
  if (eocdOffset < 0) throw new Error(`EOCD no encontrado en el zip de ${nombreArchivo}`);

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  let ptr = zipBuffer.readUInt32LE(eocdOffset + 16);
  const CD_SIG = 0x02014b50;

  for (let i = 0; i < totalEntries; i++) {
    if (zipBuffer.readUInt32LE(ptr) !== CD_SIG) throw new Error('Directorio central del zip malformado');
    const compMethod = zipBuffer.readUInt16LE(ptr + 10);
    const compSize = zipBuffer.readUInt32LE(ptr + 20);
    const nameLen = zipBuffer.readUInt16LE(ptr + 28);
    const extraLen = zipBuffer.readUInt16LE(ptr + 30);
    const commentLen = zipBuffer.readUInt16LE(ptr + 32);
    const localOffset = zipBuffer.readUInt32LE(ptr + 42);
    const nombre = zipBuffer.toString('utf8', ptr + 46, ptr + 46 + nameLen);

    if (nombre === nombreArchivo) {
      const lfNameLen = zipBuffer.readUInt16LE(localOffset + 26);
      const lfExtraLen = zipBuffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + lfNameLen + lfExtraLen;
      const compData = zipBuffer.subarray(dataStart, dataStart + compSize);
      if (compMethod === 0) return compData.toString('utf8');
      if (compMethod === 8) return inflateRawSync(compData).toString('utf8');
      throw new Error(`Metodo de compresion no soportado (${compMethod}) en ${nombreArchivo}`);
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`No se encontro ${nombreArchivo} dentro del zip`);
}

function diffContraActual(nuevo, pais) {
  const archivo = join(DATA, `cp-${pais.toLowerCase()}.json`);
  const actual = existsSync(archivo) ? JSON.parse(leerArchivoSync(archivo)) : {};
  const nuevoSet = new Set(Object.keys(nuevo));
  const actualSet = new Set(Object.keys(actual));
  return {
    total: nuevoSet.size,
    nuevos: [...nuevoSet].filter(cp => !actualSet.has(cp)).length,
    quitados: [...actualSet].filter(cp => !nuevoSet.has(cp)).length,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const APPLY = argv.includes('--apply');

  console.log(`\nSync de codigos postales #160 (${APPLY ? 'APPLY' : 'DRY-RUN'})`);
  console.log('Descargando GeoNames (CC BY 4.0): MX.zip, US.zip, CA.zip...');

  const [mxBuf, usBuf, caBuf] = await Promise.all(PAISES.map(descargarZip));
  const mx = extraerTxt(mxBuf, 'MX.txt');
  const us = extraerTxt(usBuf, 'US.txt');
  const ca = extraerTxt(caBuf, 'CA.txt');

  const indice = construirIndiceCP({ mx, us, ca });

  console.log('');
  for (const pais of PAISES) {
    const diff = diffContraActual(indice[pais], pais);
    console.log(`${pais}: ${diff.total} CPs en el indice nuevo (nuevos: ${diff.nuevos}, quitados: ${diff.quitados})`);
    if (diff.total < MINIMO_ESPERADO[pais]) {
      console.error(`\nABORTA: ${pais} trae solo ${diff.total} CPs (se esperaban miles) -- descarga degenerada.\nNo se escribio nada.`);
      process.exit(1);
    }
  }

  // Prueba de cordura del ticket #160: el ejemplo verificado del CP de la fabrica.
  const ixtapaluca = indice.MX['56530'];
  if (!ixtapaluca || ixtapaluca[0] !== 'Ixtapaluca') {
    console.error('\nABORTA: 56530 no resolvio a Ixtapaluca -- revisar el parseo antes de aplicar.');
    process.exit(1);
  }
  console.log(`\nPrueba de cordura: 56530 -> ${ixtapaluca[0]}, ${ixtapaluca[1]}`);

  if (!APPLY) {
    console.log('\nDRY-RUN: no se escribio nada (usa --apply para guardar data/cp-*.json).');
    return;
  }

  for (const pais of PAISES) {
    const archivo = join(DATA, `cp-${pais.toLowerCase()}.json`);
    // Sin indentacion: a nivel municipio el indice MX ya pesa varios MB (#160);
    // el pretty-print de otros data/*.json no se justifica aqui.
    escribirArchivoSync(archivo, JSON.stringify(indice[pais]));
  }
  console.log('\nAPPLY: escritos data/cp-mx.json, cp-us.json, cp-ca.json');
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  await main();
}
