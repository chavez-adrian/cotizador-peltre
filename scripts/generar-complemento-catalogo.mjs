// Extrae data/catalogo-complemento.json del catalogo vigente (issue #128, padre #120).
//
// El catalogo se genera desde Operam, pero Operam NO modela: las cajas de envio, el
// peso, el nombre en ingles (vive en el Excel porque GS1 Mexico lo exige), la
// aplicacion extra (concepto puro del cotizador), el vocabulario del selector guiado
// (colores, texturas, filetes, nombres de tipo) ni la lectura de los codigos legacy
// que no codifican sus partes. Todo eso se congela UNA vez desde data/precios.json y
// el nucleo lo mezcla al construir.
//
// Uso:
//   node scripts/generar-complemento-catalogo.mjs            # imprime el resumen (NO escribe)
//   node scripts/generar-complemento-catalogo.mjs --escribir # escribe data/catalogo-complemento.json
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { leerArchivoSync, escribirArchivoSync } from '../lib/fs-reintento.js';
import { decodificarSku } from '../lib/catalogo-operam.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, '..', 'data');

const ESCRIBIR = process.argv.slice(2).includes('--escribir');

const precios = JSON.parse(leerArchivoSync(join(DATA, 'precios.json')));

// (textura, capas) -> letra de la clave de precio. En el Excel esa tabla es una hoja;
// aqui se deriva de las claves ya asignadas y se verifica que no tenga contradicciones.
const letrasPrecio = {};
for (const s of precios.skus) {
  const clave = `${s.textura}:${s.capas}`;
  const letra = s.priceKey.slice(-1);
  if (letrasPrecio[clave] && letrasPrecio[clave] !== letra) {
    throw new Error(`Contradiccion en letrasPrecio para ${clave}: ${letrasPrecio[clave]} vs ${letra} (${s.sku})`);
  }
  letrasPrecio[clave] = letra;
}

const productos = {};
for (const p of precios.products) {
  productos[p.key] = { name: p.name, nameEn: p.nameEn || null, weight_kg: p.weight_kg ?? null };
}

const calcas = {};
for (const c of precios.calcas) {
  calcas[c.code] = { nameEn: c.nameEn || null };
}

// Lectura congelada de los articulos cuyo codigo NO dice sus partes: los legacy
// (TA14G11211, TA14P1N1M0, PL20B1N1M01RA) y el puno de canonicos cuyo codigo
// contradice lo que el Excel registro. Los demas se leen del codigo y no se guardan.
const ATRIBUTOS = ['tipo', 'tamano', 'color1', 'color2', 'textura', 'capas', 'filetes', 'colorRiso'];
const skus = {};
for (const s of precios.skus) {
  const leido = decodificarSku(s.sku);
  const igual = leido && ATRIBUTOS.every(a => String(leido[a]) === String(s[a]));
  if (igual) continue;
  const entrada = {};
  for (const a of ATRIBUTOS) entrada[a] = s[a] ?? null;
  skus[s.sku] = entrada;
}

const complemento = {
  version: precios.version,
  origen: 'data/precios.json',
  letrasPrecio,
  productos,
  calcas,
  aplicacionExtra: precios.aplicacionExtra ?? null,
  boxMap: precios.boxMap || [],
  colores: precios.colores || {},
  texturas: precios.texturas || {},
  filetes: precios.filetes || {},
  colorFiletes: precios.colorFiletes || {},
  tiposNombre: precios.tiposNombre || {},
  skus,
};

console.log(`version           : ${complemento.version}`);
console.log(`letrasPrecio      : ${Object.keys(letrasPrecio).length}`);
console.log(`productos (fichas): ${Object.keys(productos).length}`);
console.log(`calcas            : ${Object.keys(calcas).length}`);
console.log(`boxMap            : ${complemento.boxMap.length}`);
console.log(`skus legacy       : ${Object.keys(skus).length} de ${precios.skus.length}`);

if (ESCRIBIR) {
  const salida = join(DATA, 'catalogo-complemento.json');
  escribirArchivoSync(salida, JSON.stringify(complemento, null, 2));
  console.log(`\nEscrito: ${salida}`);
} else {
  console.log('\n(dry-run: usa --escribir para guardar data/catalogo-complemento.json)');
}
