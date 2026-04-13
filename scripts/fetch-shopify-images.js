import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TOKEN = process.env.SHOPIFY_API_TOKEN;
const STORE = 'pp-peltre.myshopify.com';

async function fetchAll() {
  let products = [];
  let url = `https://${STORE}/admin/api/2024-01/products.json?limit=250&fields=id,handle,title,images`;

  while (url) {
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': TOKEN },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    products = products.concat(data.products || []);

    const link = res.headers.get('Link') || '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/)?.[1] || null;
    url = next;
    if (next) console.log(`  Página siguiente... (${products.length} hasta ahora)`);
  }
  return products;
}

// Los handles de Shopify siguen el patrón del modelo: "taza-8" → VA08, "plato-20" → PL20
// Intentamos mapear por handle o por el primer SKU del producto al código de modelo (4 chars)
async function main() {
  console.log('Obteniendo productos de Shopify...');
  const products = await fetchAll();
  console.log(`Total productos: ${products.length}`);

  // Mapeo: código de modelo (4 chars, ej. VA08) → URL de imagen
  const images = {};

  for (const p of products) {
    const imgUrl = p.images?.[0]?.src;
    if (!imgUrl) continue;

    // Limpiar query string de la URL de Shopify CDN
    const cleanUrl = imgUrl.split('?')[0];

    // Intentar extraer el código de modelo del handle o del título
    // Handles típicos: "taza-8-amarilla", "plato-20-azul", "vaso-tipo-tarro-08"
    // También revisar variantes para obtener el SKU
    const handle = p.handle || '';
    const title = p.title || '';

    // Guardar por handle por ahora, y también intentar mapear
    console.log(`  ${handle} → ${cleanUrl.slice(-40)}`);

    // Usar el handle como clave temporal
    images[handle] = cleanUrl;
  }

  // Guardar el mapa completo por handle
  const outPath = join(__dirname, '..', 'data', 'shopify-images-raw.json');
  writeFileSync(outPath, JSON.stringify(images, null, 2));
  console.log(`\nGuardado: ${outPath} (${Object.keys(images).length} entradas)`);

  // También intentar extraer código de modelo de las variantes (SKU field)
  const byModel = {};
  for (const p of products) {
    const imgUrl = p.images?.[0]?.src?.split('?')[0];
    if (!imgUrl) continue;

    // Revisar si hay SKUs en las variantes
    for (const v of (p.variants || [])) {
      const sku = v.sku || '';
      if (sku.length >= 4) {
        const modelCode = sku.slice(0, 4).toUpperCase();
        if (!byModel[modelCode]) {
          byModel[modelCode] = imgUrl;
        }
      }
    }
  }

  if (Object.keys(byModel).length > 0) {
    const modelPath = join(__dirname, '..', 'data', 'images.json');
    writeFileSync(modelPath, JSON.stringify(byModel, null, 2));
    console.log(`Mapa por modelo: ${modelPath} (${Object.keys(byModel).length} modelos)`);
    console.log('Muestra:', Object.entries(byModel).slice(0, 5));
  } else {
    console.log('\nNo se encontraron SKUs en variantes. Revisa shopify-images-raw.json para mapear manualmente.');
  }
}

main().catch(console.error);
