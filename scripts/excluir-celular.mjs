// Comando de administracion para atender una solicitud de cancelacion (#254,
// ticket #259; ADR-0013 "Consecuencias": la solicitud de borrado se atiende a
// mano). Un celular excluido no vuelve NUNCA a la libreta de Google: ni el
// sondeo de Shopify ni el barrido de contactos lo recrean
// (`planificarContactos` la respeta para las tres fuentes).
//
// Lo que este script SI hace: agrega el celular a la lista de exclusion, borra
// su fila del mapeo (lib/contactos-store.js) y sus filas de pedidos_shopify
// (lib/pedidos-shopify-store.js).
//
// Lo que este script NUNCA hace: borrar la ficha en Google. Es la UNICA
// escritura destructiva del procedimiento y queda fuera del codigo a proposito
// (ADR-0013, "nada se borra nunca" en el barrido automatico); el script solo
// imprime el recordatorio de hacerlo a mano en la libreta de pppeltre@gmail.com.
//
// DRY-RUN por defecto: imprime que haria y no escribe nada. Idempotente:
// correrlo dos veces con --aplicar no duplica la exclusion ni falla al no
// encontrar filas que ya se borraron.
//
// Uso:
//   node scripts/excluir-celular.mjs <telefono>                       # DRY-RUN
//   node scripts/excluir-celular.mjs <telefono> --motivo "..."        # con motivo
//   node scripts/excluir-celular.mjs <telefono> --aplicar             # escribe
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// DATABASE_URL desde el .env del cotizador (como los demas scripts de
// administracion): sin ella los stores caen al fallback JSON local.
const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const argv = process.argv.slice(2);
const APLICAR = argv.includes('--aplicar');

function flagTexto(nombre) {
  const i = argv.indexOf(nombre);
  if (i === -1) return null;
  const v = argv[i + 1];
  if (!v || v.startsWith('--')) {
    console.error(`ABORTA: ${nombre} necesita un valor.`);
    process.exit(1);
  }
  return v;
}

const motivo = flagTexto('--motivo') || '';
const iMotivo = argv.indexOf('--motivo');
const posicionales = argv.filter((a, i) => !a.startsWith('--') && (iMotivo === -1 || i !== iMotivo + 1));
const telefonoCrudo = posicionales[0];

if (!telefonoCrudo) {
  console.error('ABORTA: falta el telefono.\nUso: node scripts/excluir-celular.mjs <telefono> [--motivo "..."] [--aplicar]');
  process.exit(1);
}

const { ultimos10 } = await import('../lib/telefono-llave.js');
const celular10 = ultimos10(telefonoCrudo);

if (celular10.length !== 10) {
  console.error(`ABORTA: "${telefonoCrudo}" no arma un celular de diez digitos (dio "${celular10}").`);
  process.exit(1);
}

const contactosExcluidosStore = await import('../lib/contactos-excluidos-store.js');
const contactosStore = await import('../lib/contactos-store.js');
const pedidosShopifyStore = await import('../lib/pedidos-shopify-store.js');

console.log(`\nExclusion de celular #259 (${APLICAR ? 'APLICAR' : 'DRY-RUN'}) -- ${telefonoCrudo} -> ${celular10}`);
if (motivo) console.log(`Motivo: ${motivo}`);

const yaExcluido = await contactosExcluidosStore.estaExcluido(celular10);
const filaMapeo = (await contactosStore.listar()).find(f => f.celular10 === celular10);
const filasPedidos = (await pedidosShopifyStore.listar()).filter(f => f.celular10 === celular10);

console.log(`\nEstado actual:`);
console.log(`  Ya en la lista de exclusion: ${yaExcluido ? 'SI' : 'no'}`);
console.log(`  Fila en el mapeo de contactos: ${filaMapeo ? `SI (resourceName ${filaMapeo.resourceName}, clase ${filaMapeo.clase})` : 'no'}`);
console.log(`  Filas en pedidos_shopify: ${filasPedidos.length}${filasPedidos.length ? ` (${filasPedidos.map(f => f.pedido).join(', ')})` : ''}`);

if (!APLICAR) {
  console.log(`\nDRY-RUN: se agregaria ${celular10} a la exclusion, se borraria ${filaMapeo ? '1 fila del mapeo' : '0 filas del mapeo'} y ${filasPedidos.length} fila(s) de pedidos_shopify. No se escribio nada (sin --aplicar).`);
  console.log('\nRECORDATORIO: este script NO borra nada en Google. Falta borrar a mano la ficha en la libreta de pppeltre@gmail.com.');
  process.exit(0);
}

await contactosExcluidosStore.agregar(celular10, motivo);
const mapeoEliminado = await contactosStore.eliminar(celular10);
const pedidosEliminados = await pedidosShopifyStore.eliminarPorCelular(celular10);

console.log(`\nAPLICADO:`);
console.log(`  Agregado a la exclusion: si`);
console.log(`  Fila del mapeo borrada: ${mapeoEliminado ? 'si' : 'no habia ninguna'}`);
console.log(`  Filas de pedidos_shopify borradas: ${pedidosEliminados}`);
console.log('\nRECORDATORIO: este script NO borra nada en Google (ADR-0013: es la unica escritura destructiva del');
console.log('procedimiento y queda fuera del codigo a proposito). Falta borrar a mano la ficha de este comprador');
console.log('en la libreta de Contactos de pppeltre@gmail.com para que la cancelacion quede completa.');
process.exit(0);
