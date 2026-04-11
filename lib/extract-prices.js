import XLSX from 'xlsx';
import { writeFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

// Ruta por defecto — se usa cuando se corre como script standalone
const DEFAULT_EXCEL = 'C:/Users/chave/Dropbox/PELTRE NACIONAL/1.0 COMERCIALIZACIÓN/VENTAS/PRECIOS/LISTA DE PRECIOS 2025 Mayo.xlsx';

/**
 * Parsea el Excel maestro de precios y devuelve el objeto de datos.
 * @param {Buffer|string} input — ruta al archivo o Buffer del upload
 * @returns {{ version, extracted, products, calcas, aplicacionExtra, tiers, boxMap }}
 */
export function extractPrices(input) {
  const wb = typeof input === 'string'
    ? XLSX.readFile(input)
    : XLSX.read(input, { type: 'buffer' });

  const pna = XLSX.utils.sheet_to_json(wb.Sheets['precios_pna'], { header: 1 });

  // Detectar version desde celda [0][0] o [1][0]
  const versionRaw = pna[1]?.[0]?.toString() ?? '';
  const version = versionRaw || 'desconocida';

  const products = [];
  const calcas = [];
  let aplicacionExtra = null;

  // Filas 7+ contienen productos, decorados, calcas y extras
  for (let i = 7; i < pna.length; i++) {
    const row = pna[i];
    if (!row || !row[0]) continue;

    const name = row[0]?.toString().trim() ?? '';
    const nameEn = row[1]?.toString().trim() ?? '';
    const key = row[3]?.toString().trim() ?? '';
    const weightRaw = row[2];
    const weight = typeof weightRaw === 'number' ? weightRaw : null;

    // Columnas de precios
    const menudeo = typeof row[6] === 'number' ? row[6] : null;
    const c100 = typeof row[9] === 'number' ? row[9] : null;
    const m100 = typeof row[10] === 'number' ? row[10] : null;
    const m350 = typeof row[11] === 'number' ? row[11] : null;
    const m550 = typeof row[12] === 'number' ? row[12] : null;
    const m1500 = typeof row[13] === 'number' ? row[13] : null;
    const m6000 = typeof row[14] === 'number' ? row[14] : null;

    // Aplicacion extra (tiene key N/A, hay que capturarlo antes del filtro)
    if (name.toLowerCase().startsWith('aplicación extra') || name.toLowerCase().startsWith('aplicacion extra')) {
      aplicacionExtra = {
        name,
        prices: { M100: m100, M350: m350, M550: m550, M1500: m1500, M6000: m6000 }
      };
      continue;
    }

    if (!key || key === 'N/A') continue;

    // Calcas vitrificables (key empieza con CAL)
    if (key.startsWith('CAL')) {
      if (m100 == null && c100 == null) continue;
      calcas.push({
        code: key,
        name,
        nameEn,
        unit: 'ACT',
        prices: {
          Menudeo: c100, // calcas no tienen menudeo, usar C100 como piso
          M100: m100 ?? c100,
          M350: m350,
          M550: m550,
          M1500: m1500,
          M6000: m6000,
        }
      });
      continue;
    }

    // Producto regular — solo si tiene precio M100
    if (m100 == null) continue; // decorados a mano se excluyen

    // Extraer modelo (primeros 4 chars del key, sin la letra de variante)
    const model = key.replace(/[A-Z]$/, '');

    products.push({
      key,
      name,
      nameEn,
      model,
      weight_kg: weight,
      prices: {
        Menudeo: menudeo,
        M100: m100,
        M350: m350,
        M550: m550,
        M1500: m1500,
        M6000: m6000,
      }
    });
  }

  // === Tablas del catalogo: colores, texturas, filetes, color_fil, price_key ===
  const catData = wb.Sheets['catalogo']
    ? XLSX.utils.sheet_to_json(wb.Sheets['catalogo'], { header: 1, defval: '' })
    : [];

  // Colores: col 33 (código), col 34 (nombre masculino). Parar al llegar a la sección DECORADO.
  const colores = {};
  for (const row of catData.slice(1)) {
    const codigo = row[33]?.toString().trim();
    if (codigo === 'DECORADO') break;
    const nombre = row[34]?.toString().trim();
    if (codigo && nombre) colores[codigo] = nombre;
  }

  // Texturas (TEXTURA=1..9), Filetes (1..5) y color_fil (1..5) están todos en col 40-41
  // separados por headers 'CAPAS', 'FILETES', 'color_fil', 'PAQ'
  const texturas = {};
  const filestesCat = {};
  const colorFiletes = {};
  let texSection = 'textura';
  for (const row of catData.slice(1)) {
    const c40 = row[40];
    const c41 = row[41]?.toString().trim();
    if (c40 === 'CAPAS') { texSection = 'capas'; continue; }
    if (c40 === 'FILETES') { texSection = 'filetes'; continue; }
    if (c40 === 'color_fil') { texSection = 'color_fil'; continue; }
    if (c40 === 'PAQ') break;
    if (typeof c40 !== 'number' || c40 === 0) continue;
    if (texSection === 'textura') texturas[c40] = c41;
    else if (texSection === 'filetes') filestesCat[c40] = c41;
    else if (texSection === 'color_fil') colorFiletes[c40] = c41;
  }

  // Nombres de tipos (modelo -> nombre_comercial)
  const tiposNombre = {};
  for (const row of catData.slice(1)) {
    const modelo = row[0]?.toString().trim();
    const nombre = row[2]?.toString().trim();
    if (modelo && nombre && !tiposNombre[modelo]) tiposNombre[modelo] = nombre;
  }

  // Tabla textura_nombre + capas -> price_key letter (cols 60-63)
  const texCapasKeyMap = {};
  for (const row of catData.slice(1)) {
    const texNombre = row[60]?.toString().trim();
    const capas = row[61];
    const letter = row[63]?.toString().trim();
    if (texNombre && letter && letter !== 'price_key') {
      texCapasKeyMap[`${texNombre}:${capas}`] = letter;
    }
  }

  // === SKUs de carga_artículos ===
  const caData = wb.Sheets['carga_artículos']
    ? XLSX.utils.sheet_to_json(wb.Sheets['carga_artículos'], { header: 1, defval: '' })
    : [];

  const priceKeysSet = new Set(products.map(p => p.key));

  const skus = [];
  for (const row of caData.slice(1)) {
    const sku = row[13]?.toString().trim();
    if (!sku) continue;

    const tipo = row[0]?.toString().trim();
    const tamano = row[1]?.toString().trim();
    const color1 = row[2]?.toString().trim();
    const texNum = typeof row[3] === 'number' ? row[3] : (parseInt(row[3]) || 0);
    const capas = typeof row[4] === 'number' ? row[4] : (parseInt(row[4]) || 0);
    const filetesNum = typeof row[5] === 'number' ? row[5] : (parseInt(row[5]) || 0);
    const color2Raw = row[6]?.toString().trim() || '';
    const colorRisoRaw = row[7]?.toString().trim() || '';
    const nombre = row[14]?.toString().trim() || '';

    if (!tipo || !tamano) continue;

    // Excluir decorados a mano (8), decorados (9) y muestras (0)
    if ([0, 8, 9].includes(texNum)) continue;

    // Solo FILETES 1 (con borde) y 2 (sin borde) en el flujo guiado
    if (![1, 2].includes(filetesNum)) continue;

    // Calcular price_key
    const texNombre = texturas[texNum] || '';
    const letter = texCapasKeyMap[`${texNombre}:${capas}`] || '';
    if (!letter) continue;
    const tam = tamano.toString().padStart(2, '0');
    const priceKey = `${tipo}${tam}${letter}`;
    if (!priceKeysSet.has(priceKey)) continue;

    const color2 = color2Raw && color2Raw !== '00' && color2Raw !== '0' ? color2Raw : null;
    const colorRiso = colorRisoRaw && colorRisoRaw !== '0' ? (parseInt(colorRisoRaw) || null) : null;

    skus.push({ sku, tipo, tamano, color1, textura: texNum, capas, filetes: filetesNum, color2, colorRiso, priceKey, nombre });
  }

  const tiposProducto = [...new Set(skus.map(s => s.tipo))].sort();

  // Extraer dimensiones de piezas desde catalogo
  const dimMap = {};
  if (wb.Sheets['catalogo']) {
    const cat = XLSX.utils.sheet_to_json(wb.Sheets['catalogo'], { header: 1, defval: null });
    for (let i = 1; i < cat.length; i++) {
      const row = cat[i];
      if (!row || !row[0]) continue;
      const modelo = row[0]?.toString().trim();
      const largo = typeof row[27] === 'number' && row[27] > 0 ? row[27] : null;
      const ancho = typeof row[28] === 'number' && row[28] > 0 ? row[28] : null;
      const alto = typeof row[29] === 'number' && row[29] > 0 ? row[29] : null;
      if (modelo && largo && ancho && alto) {
        dimMap[modelo] = { largo_cm: largo, ancho_cm: ancho, alto_cm: alto };
      }
    }
  }

  // Extraer mapeo de cajas desde calcula_cajas
  const boxMap = [];
  if (wb.Sheets['calcula_cajas']) {
    const cc = XLSX.utils.sheet_to_json(wb.Sheets['calcula_cajas'], { header: 1 });
    for (let i = 1; i < cc.length; i++) {
      const row = cc[i];
      if (!row || !row[0]) continue;
      const modelo = row[0]?.toString().trim();
      const pesoG = typeof row[1] === 'number' ? row[1] : null;
      const caja = row[3]?.toString().trim() ?? '';
      const pzPorCaja = typeof row[4] === 'number' ? row[4] : null;
      if (modelo && pzPorCaja) {
        const dims = dimMap[modelo] || {};
        boxMap.push({ modelo, peso_g: pesoG, caja, pz_por_caja: pzPorCaja, ...dims });
      }
    }
  }

  const tiers = [
    { id: 'Menudeo', label: 'Menudeo', min_qty: 1 },
    { id: 'M100', label: '100+ pzs', min_qty: 100 },
    { id: 'M350', label: '350+ pzs', min_qty: 350 },
    { id: 'M550', label: '550+ pzs', min_qty: 550 },
    { id: 'M1500', label: '1,500+ pzs', min_qty: 1500 },
    { id: 'M6000', label: '6,000+ pzs', min_qty: 6000 },
  ];

  return {
    version,
    extracted: new Date().toISOString(),
    products,
    calcas,
    aplicacionExtra,
    tiers,
    boxMap,
    skus,
    colores,
    texturas,
    filetes: filestesCat,
    colorFiletes,
    tiposProducto,
    tiposNombre,
  };
}

/**
 * Compara dos versiones de precios y devuelve resumen de cambios.
 */
export function diffPrices(oldData, newData) {
  const oldMap = new Map(oldData.products.map(p => [p.key, p]));
  const newMap = new Map(newData.products.map(p => [p.key, p]));

  const added = newData.products.filter(p => !oldMap.has(p.key));
  const removed = oldData.products.filter(p => !newMap.has(p.key));
  const changed = [];

  for (const np of newData.products) {
    const op = oldMap.get(np.key);
    if (!op) continue;
    const diffs = [];
    for (const tier of Object.keys(np.prices)) {
      if (np.prices[tier] !== op.prices[tier]) {
        diffs.push({ tier, old: op.prices[tier], new: np.prices[tier] });
      }
    }
    if (diffs.length > 0) changed.push({ key: np.key, name: np.name, diffs });
  }

  return {
    totalProducts: newData.products.length,
    totalCalcas: newData.calcas.length,
    added: added.length,
    removed: removed.length,
    priceChanges: changed.length,
    unchanged: newData.products.length - added.length - changed.length,
    details: { added, removed, changed },
  };
}

// Ejecucion como script standalone
if (process.argv[1] && process.argv[1].includes('extract-prices')) {
  const excelPath = process.argv[2] || DEFAULT_EXCEL;
  console.log(`Leyendo: ${excelPath}`);

  const data = extractPrices(excelPath);

  console.log(`Version: ${data.version}`);
  console.log(`Productos (price keys): ${data.products.length}`);
  console.log(`SKUs individuales: ${data.skus.length}`);
  console.log(`Tipos de producto: ${data.tiposProducto.join(', ')}`);
  console.log(`Calcas: ${data.calcas.length}`);
  console.log(`Box map: ${data.boxMap.length} modelos`);
  if (data.aplicacionExtra) console.log(`Aplicacion extra: si`);

  // Validar que todos los productos tienen precios en todos los tiers
  let warnings = 0;
  for (const p of data.products) {
    for (const tier of ['Menudeo', 'M100', 'M350', 'M550', 'M1500', 'M6000']) {
      if (p.prices[tier] == null) {
        console.warn(`WARN: ${p.key} (${p.name}) sin precio ${tier}`);
        warnings++;
      }
    }
  }
  if (warnings === 0) console.log('Validacion: todos los productos tienen precios completos');

  const outPath = join(DATA_DIR, 'precios.json');
  writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`Guardado en: ${outPath}`);
}
