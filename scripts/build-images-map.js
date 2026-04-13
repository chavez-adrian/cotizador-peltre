import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const raw = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'shopify-images-raw.json'), 'utf8'));
const precios = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'precios.json'), 'utf8'));
const skus = precios.skus || [];

// ── Parsear handle → atributos del producto ──────────────────────────────────

function parseHandle(handle) {
  const h = handle.toLowerCase();

  // Tipo y tamaño
  let tipo = null, tamanos = [];
  if (/taza-de-mesa|taza-mesa/.test(h)) { tipo = 'VA'; tamanos = ['08']; }
  else if (/taza-para-expreso|taza-de-expreso|taza-expreso/.test(h)) { tipo = 'VA'; tamanos = ['05']; }
  else if (/vaso-tequilero|tequilero/.test(h)) { tipo = 'VT'; tamanos = ['05']; }
  else if (/vaso-de-mesa|vaso-mesa/.test(h)) { tipo = 'VT'; tamanos = ['08']; }
  else if (/tazon/.test(h)) { tipo = 'TA'; tamanos = ['14']; }
  else if (/plato-hondo/.test(h)) { tipo = 'PH'; tamanos = ['20']; }
  else if (/plato-trinche-14|plato-mediano/.test(h)) { tipo = 'PL'; tamanos = ['14']; }
  else if (/plato-trinche-20/.test(h)) { tipo = 'PL'; tamanos = ['20']; }
  else if (/plato-trinche-24/.test(h)) { tipo = 'PL'; tamanos = ['24']; }
  else if (/plato-trinche-27/.test(h)) { tipo = 'PL'; tamanos = ['27']; }
  else if (/plato-mediano/.test(h)) { tipo = 'PL'; tamanos = ['20']; }
  else if (/salsera/.test(h)) { tipo = 'SA'; tamanos = ['08']; }
  else if (/portavasos/.test(h)) { tipo = 'PV'; tamanos = ['08']; }
  else return null;

  // Para detectar el color principal, eliminar el sufijo de borde e interior
  // para que "borde-azul" no se confunda con azul como color principal
  const hColor = h
    .replace(/-con-borde-[a-z]+/, '')
    .replace(/-borde-[a-z]+/, '')
    .replace(/-interior-[a-z]+/, '')
    .replace(/-y-borde-[a-z]+/, '');

  // Color 1 — orden importante (más específico primero)
  let color1 = [];
  if (/negro-obsidiana|negro-mate/.test(hColor))       color1.push('N2');
  else if (/negro-salpicado|negra-salpicado/.test(hColor)) color1.push('N1','N3');
  else if (/negro-con-manchas|negra-con-manchas/.test(hColor)) color1.push('N1','N3');
  else if (/negro|negra/.test(hColor))                 color1.push('N1','N3');

  if (/azul-agave|agave/.test(hColor))                 color1.push('A1');
  else if (/aguamarina/.test(hColor))                  color1.push('A2');
  else if (/azul-cobalto|cobalto/.test(hColor))        color1.push('A3','A4');
  else if (/azul-con-manchas|azul-manchas/.test(hColor)) color1.push('A3','A4');
  else if (/azul-monocromatica/.test(hColor))          color1.push('A3','A4');
  else if (/azul/.test(hColor))                        color1.push('A3','A4');

  if (/blanco-salpicado-azul|blanca-salpicado-azul/.test(hColor)) { color1 = ['BA']; }
  else if (/blanco-salpicado-rosa|blanca-salpicado-rosa/.test(hColor)) { color1 = ['BA']; }
  else if (/blanco-con-manchas|blanca-con-manchas/.test(hColor)) color1.push('B1','B2');
  else if (/blanco-sin-bordes|blanca-sin-bordes|blanco-monocromatica|blanca-monocromatica/.test(hColor)) color1.push('B1','B2');
  else if (/blanco|blanca/.test(hColor) && !color1.includes('BA')) color1.push('B1','B2');

  if (/granito/.test(hColor))   color1.push('G1');
  if (/lila/.test(hColor))      color1.push('L1');

  if (/verde-nevado/.test(hColor))         color1.push('V5','V1');
  else if (/verde-hornitos/.test(hColor))  color1.push('V3');
  else if (/verde-bosque/.test(hColor))    color1.push('V1','V3');
  else if (/verde-con-manchas|verde-mancha/.test(hColor)) color1.push('VR','V1');
  else if (/nopal/.test(hColor))           color1.push('V4');
  else if (/menta-con-manchas|menta-mancha/.test(hColor)) color1.push('M1','M3');
  else if (/menta/.test(hColor))           color1.push('M1','M3');
  else if (/verde/.test(hColor))           color1.push('V1','V2','V3');

  if (/mostaza/.test(hColor))   color1.push('Y3');
  else if (/crema-con-manchas|crema-mancha/.test(hColor)) color1.push('Y2','Y4');
  else if (/crema/.test(hColor)) color1.push('Y2','Y4');

  if (/durazno/.test(hColor))   color1.push('P4');
  if (/petroleo/.test(hColor))  color1.push('A7');

  if (/rosa-cantera/.test(hColor))         color1.push('P1');
  else if (/rosa-con-manchas|rosa-mancha/.test(hColor)) color1.push('P2','P3');
  else if (/rosa-nevado/.test(hColor))     color1.push('P2','P3');
  else if (/rosa-monocromatica/.test(hColor)) color1.push('P2','P3');
  else if (/rosa/.test(hColor))            color1.push('P2','P3');

  if (/rojo-nevada|rojo-nevado/.test(hColor)) color1.push('R2','R1');
  else if (/rojo/.test(hColor))            color1.push('R1','R2');

  // Textura
  let textura = null;
  if (/salpicado/.test(h))     textura = 7;
  else if (/manchas/.test(h))  textura = 2;
  else if (/moteado/.test(h))  textura = 3;
  else if (/lunares/.test(h))  textura = 4;
  else if (/marmol/.test(h))   textura = 5;
  else                          textura = 1; // sólido por defecto

  // Filetes
  let filetes = null;
  if (/sin-bordes|sin-borde|monocromatica/.test(h)) filetes = 2;
  else if (/con-borde|filete/.test(h))              filetes = 1;

  // Color del filete (colorRiso) cuando filetes=1
  let colorRiso = null;
  if (filetes === 1) {
    if (/borde-negro/.test(h))     colorRiso = 1;
    else if (/borde-azul/.test(h)) colorRiso = 2;
    else if (/borde-verde/.test(h)) colorRiso = 3;
    else                            colorRiso = 1; // negro por defecto
  }

  // Interior (color2)
  let color2 = null;
  if (/interior-blanco|interior-blanca/.test(h)) color2 = 'B1';
  else if (/interior-rosa/.test(h))              color2 = 'P2';
  else if (/interior-crema/.test(h))             color2 = 'Y2';
  else if (/interior-menta/.test(h))             color2 = 'M1';

  return { tipo, tamanos, color1: [...new Set(color1)], textura, filetes, colorRiso, color2 };
}

// ── Puntuar qué tan bien coincide un SKU con un handle parseado ─────────────

function score(sku, parsed) {
  if (!parsed || !parsed.tipo) return 0;
  if (sku.tipo !== parsed.tipo) return 0;
  if (parsed.tamanos.length && !parsed.tamanos.includes(sku.tamano)) return 0;

  let pts = 1; // base por tipo+tamano

  // Color1
  if (parsed.color1.length) {
    if (parsed.color1.includes(sku.color1)) pts += 4;
    else return 0; // color requerido, no coincide
  }

  // Textura
  if (parsed.textura !== null) {
    if (sku.textura === parsed.textura) pts += 3;
    else return 0;
  }

  // Filetes
  if (parsed.filetes !== null) {
    if (sku.filetes === parsed.filetes) pts += 2;
    else pts -= 1;
  }

  // ColorRiso
  if (parsed.colorRiso !== null && sku.filetes === 1) {
    if (sku.colorRiso === parsed.colorRiso) pts += 2;
  }

  // Interior (color2)
  if (parsed.color2 !== null && sku.capas === 2) {
    if (sku.color2 === parsed.color2) pts += 1;
  }

  return pts;
}

// ── Construir mapa SKU → URL ─────────────────────────────────────────────────

// Para cada handle, parsear y asignar a todos los SKUs que coincidan
// Si un SKU ya tiene imagen con mayor score, no la sobreescribir

const skuScores = {}; // sku → best score so far
const images = {};    // sku → imageUrl

// Excluir colaboraciones y ediciones especiales
const EXCLUDE = /daviher|cecilia|colabora|tu-yo|jimador|enamorad|sueno|magia|origen|amar-edicion|pizarra|coleccion-de-tazas/;

for (const [handle, url] of Object.entries(raw)) {
  if (EXCLUDE.test(handle)) continue;
  const parsed = parseHandle(handle);
  if (!parsed || !parsed.tipo) continue;

  for (const sku of skus) {
    const s = score(sku, parsed);
    if (s > 0 && (!skuScores[sku.sku] || s > skuScores[sku.sku])) {
      skuScores[sku.sku] = s;
      images[sku.sku] = url;
    }
  }
}

const mapped = Object.keys(images).length;
const total = skus.length;
console.log(`SKUs mapeados: ${mapped} / ${total}`);

// Muestra de SKUs con imagen
const sample = Object.entries(images).slice(0, 10);
for (const [sku, url] of sample) {
  const s = skus.find(x => x.sku === sku);
  console.log(`  ${sku} (score ${skuScores[sku]}) → ${url.split('/').pop()}`);
}

// SKUs sin imagen
const sinImg = skus.filter(s => !images[s.sku]);
if (sinImg.length) {
  console.log(`\nSin imagen (${sinImg.length}):`, [...new Set(sinImg.map(s => s.tipo + s.tamano))].join(', '));
}

writeFileSync(join(__dirname, '..', 'data', 'images.json'), JSON.stringify(images, null, 2));
console.log('\nGuardado: data/images.json');
