// Sync del catalogo de precios desde Operam (issue #129, padre #120). Dry-run por
// default: lee Operam (read-only), construye el catalogo con el nucleo de #128
// (lib/catalogo-operam.js) y muestra que cambiaria contra data/precios.json sin
// escribir nada. --apply escribe el catalogo generado a data/precios.json.
//
// Mismo patron operativo que scripts/rescatar-genericos.mjs (#124): dry-run por
// default, read-only contra Operam, throttle proactivo, escritura via
// lib/fs-reintento.js (NUNCA fs directo -- OneDrive suelta EBUSY).
//
// Uso:
//   node scripts/sync-catalogo.mjs           # DRY-RUN: imprime paridad + diff (NO escribe)
//   node scripts/sync-catalogo.mjs --apply   # escribe data/precios.json
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { leerArchivoSync, escribirArchivoSync } from '../lib/fs-reintento.js';
import { construirCatalogo, ESTADOS_PARIDAD } from '../lib/catalogo-operam.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'data');

// diffSkus compara los SKUs del catalogo generado contra los de la referencia vigente
// (data/precios.json): lo que Operam ya tiene y la referencia no (nuevos) y lo que la
// referencia tiene y Operam ya no puede preciar (quitados). Comparacion por codigo de
// sku -- el nombre puede cambiar en Operam sin que el sku sea "distinto".
export function diffSkus(skusGenerados, skusReferencia) {
  const generados = new Set((skusGenerados || []).map(s => s.sku));
  const referencia = new Set((skusReferencia || []).map(s => s.sku));
  return {
    nuevos: [...generados].filter(s => !referencia.has(s)).sort(),
    quitados: [...referencia].filter(s => !generados.has(s)).sort(),
  };
}

// productosSinCaja avisa de un pendiente que calcular-envio.js necesita para no fallar
// en runtime (#102/#68): un producto con ficha en el complementario pero cuyo modelo
// no tiene entrada en boxMap. Sin este aviso el hueco se descubre hasta que un
// vendedor cotiza el modelo nuevo y el calculo de envio truena silenciosamente.
export function productosSinCaja(catalogo) {
  const modelos = new Set((catalogo.boxMap || []).map(b => b.modelo));
  return (catalogo.products || [])
    .filter(p => !modelos.has(p.model))
    .map(p => ({ key: p.key, model: p.model }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function contarEstados(filas) {
  const r = { MATCH: 0, MISMATCH: 0, SIN_SKU: 0, NUEVO: 0 };
  for (const f of filas || []) r[f.estado] = (r[f.estado] || 0) + 1;
  return r;
}

// formatearReporte arma el TEXTO del dry-run a partir de la salida pura de
// construirCatalogo (#128) mas el diff de SKUs y los pendientes de caja: sin IO, el
// script solo hace console.log(el resultado). Las secciones vacias no se imprimen --
// un MISMATCH (0) en la lista no aporta nada que el resumen ya no diga.
export function formatearReporte({ catalogo, paridad, skusDiff, sinCaja }) {
  const lineas = [];
  const r = paridad.resumen;
  const calcas = contarEstados(paridad.calcas);

  lineas.push('=== PARIDAD: catalogo generado desde Operam vs data/precios.json ===');
  lineas.push(`Productos -- MATCH: ${r.MATCH} | MISMATCH: ${r.MISMATCH} | SIN_SKU: ${r.SIN_SKU} | NUEVO: ${r.NUEVO}`);
  lineas.push(`Calcas    -- MATCH: ${calcas.MATCH} | MISMATCH: ${calcas.MISMATCH} | SIN_SKU: ${calcas.SIN_SKU} | NUEVO: ${calcas.NUEVO}`);
  lineas.push(`Huerfanas: ${r.huerfanas} | Divergentes: ${r.divergentes} | Ilegibles: ${r.ilegibles}`);

  const mismatch = paridad.productos.filter(p => p.estado === ESTADOS_PARIDAD.MISMATCH);
  if (mismatch.length) {
    lineas.push('');
    lineas.push(`MISMATCH (${mismatch.length}):`);
    for (const m of mismatch) {
      const detalle = m.diferencias.map(d => `${d.tier} ref=${d.referencia} operam=${d.operam}`).join(', ');
      lineas.push(`  ${m.key}: ${detalle}`);
    }
  }

  const sinSku = paridad.productos.filter(p => p.estado === ESTADOS_PARIDAD.SIN_SKU);
  if (sinSku.length) {
    lineas.push('');
    lineas.push(`SIN_SKU (${sinSku.length}): ${sinSku.map(p => p.key).join(', ')}`);
  }

  const nuevo = paridad.productos.filter(p => p.estado === ESTADOS_PARIDAD.NUEVO);
  if (nuevo.length) {
    lineas.push('');
    lineas.push(`NUEVO (${nuevo.length}): ${nuevo.map(p => p.key).join(', ')}`);
  }

  if (paridad.sinFicha.length) {
    lineas.push('');
    lineas.push('PENDIENTE -- sin ficha en el complementario (con precio en Operam, sin nombre):');
    for (const s of paridad.sinFicha) lineas.push(`  ${s.key} (${s.articulos} articulo(s))`);
  }

  if (sinCaja.length) {
    lineas.push('');
    lineas.push('PENDIENTE -- sin caja en boxMap (calcular-envio no podra cotizar el envio):');
    for (const s of sinCaja) lineas.push(`  ${s.key} (modelo ${s.model})`);
  }

  if (paridad.huerfanas.length) {
    lineas.push('');
    lineas.push(`HUERFANAS (${paridad.huerfanas.length}): fila de precio sin articulo en el maestro:`);
    for (const h of paridad.huerfanas) lineas.push(`  ${h.stock_id} (lista ${h.sales_type_id}, $${h.price.toFixed(2)})`);
  }

  if (paridad.divergentes.length) {
    lineas.push('');
    lineas.push(`DIVERGENTES (${paridad.divergentes.length}): misma clave, SKUs de Operam cobran distinto:`);
    for (const d of paridad.divergentes) {
      const variantes = d.precios.map(p => `base=${p.base} (${p.skus.length} sku(s))`).join(' vs ');
      lineas.push(`  ${d.key}: ${variantes}`);
    }
  }

  if (paridad.ilegibles.length) {
    lineas.push('');
    lineas.push(`ILEGIBLES (${paridad.ilegibles.length}): con precio vivo, codigo no se puede leer:`);
    for (const i of paridad.ilegibles) lineas.push(`  ${i.stock_id} ${i.nombre}`);
  }

  lineas.push('');
  lineas.push(`DIFF DE SKUS -- nuevos: ${skusDiff.nuevos.length} | quitados: ${skusDiff.quitados.length}`);
  if (skusDiff.nuevos.length) lineas.push(`  nuevos: ${skusDiff.nuevos.join(', ')}`);
  if (skusDiff.quitados.length) lineas.push(`  quitados: ${skusDiff.quitados.join(', ')}`);

  return lineas.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const APPLY = argv.includes('--apply');

  // OPERAM_* desde .env del cotizador, mismo patron que rescatar-genericos.mjs (#124).
  const envPath = join(ROOT, '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^(OPERAM_[A-Z]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  }

  const { listarSalesTypes, listarPreciosCompletos, listarItemsCompletos, _setMinInterval } =
    await import('../lib/operam-client.js');

  // Throttle PROACTIVO anti-429 (misma leccion que #76/#124): un intervalo minimo entre
  // llamadas evita disparar el rate-limit de Operam. Ajustable por env.
  const THROTTLE_MS = Number(process.env.SYNC_CATALOGO_THROTTLE_MS) || 1100;
  _setMinInterval(THROTTLE_MS);

  console.log(`\nSync de catalogo #129 (${APPLY ? 'APPLY' : 'DRY-RUN'})`);
  console.log(`Throttle: ${THROTTLE_MS}ms entre lecturas de Operam (anti-429; ajustable con SYNC_CATALOGO_THROTTLE_MS).`);
  console.log('Leyendo Operam (read-only): sales_types, prices_list, inventory/items...');

  const salesTypes = await listarSalesTypes({ showInactive: true });
  const precios = await listarPreciosCompletos();
  const items = await listarItemsCompletos();
  console.log(`  ${salesTypes.length} listas de precios | ${precios.length} filas de precio | ${items.length} articulos`);

  const complemento = JSON.parse(leerArchivoSync(join(DATA, 'catalogo-complemento.json')));
  const precioPath = join(DATA, 'precios.json');
  const referencia = JSON.parse(leerArchivoSync(precioPath));

  const { catalogo, paridad } = construirCatalogo({
    salesTypes, precios, items, complemento, referencia,
    extracted: new Date().toISOString(),
  });

  const skusDiff = diffSkus(catalogo.skus, referencia.skus);
  const sinCaja = productosSinCaja(catalogo);

  console.log('');
  console.log(formatearReporte({ catalogo, paridad, skusDiff, sinCaja }));

  if (!APPLY) {
    console.log('\nDRY-RUN: no se escribio nada (usa --apply para guardar data/precios.json).');
    return;
  }

  // Guarda minima contra una lectura degenerada de Operam (dump vacio, 401 silencioso
  // aguas arriba, etc.): sin productos no hay catalogo que valga la pena escribir, y
  // escribir de todos modos borraria el data/precios.json vigente sin aviso.
  if (catalogo.products.length === 0) {
    console.error('\nABORTA: el catalogo generado no tiene productos (lectura de Operam vacia o degenerada).\n' +
      'No se escribio data/precios.json.');
    process.exit(1);
  }

  escribirArchivoSync(precioPath, JSON.stringify(catalogo, null, 2));
  console.log(`\nAPPLY: escrito ${precioPath}`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  await main();
}
