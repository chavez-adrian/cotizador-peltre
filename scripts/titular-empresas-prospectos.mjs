// Parche unico de #293: los prospectos que ya estan guardados con la empresa
// entera en MAYUSCULAS. Son 98 de los 162 de Abastur 2026 (medido en Neon el
// 2026-09-02) y todos nacieron por el importador del export, que titulaba el
// nombre con una funcion propia y guardaba la empresa cruda. Desde #293 el
// importador pasa por normalizarTextosProspecto y esto no se vuelve a producir;
// este script corrige lo que quedo escrito antes.
//
// Reusa normalizarTextosProspecto (la MISMA regla que la captura, la edicion y
// el importador) y el store de prospectos: sin DATABASE_URL opera sobre
// data/prospectos.json. Escribe solo los que cambian, asi que es idempotente
// -- una segunda corrida no encuentra trabajo.
//
// La libreta de Google NO se toca a mano: al cambiar la empresa cambia la
// huella de la ficha y el barrido de contactos la reescribe solo (#231).
//
// DRY-RUN por defecto, como los demas scripts de administracion del repo.
//
// Uso:
//   node scripts/titular-empresas-prospectos.mjs             # DRY-RUN: lista y no escribe
//   node scripts/titular-empresas-prospectos.mjs --dry-run   # lo mismo, explicito
//   node scripts/titular-empresas-prospectos.mjs --aplicar   # escribe
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { listar, actualizarDatos } from '../lib/prospectos-store.js';
import { normalizarTextosProspecto } from '../public/js/prospectos-logica.js';

// Nucleo puro: prospectos -> las correcciones de empresa que hay que escribir.
// El criterio no es "esta en mayusculas" sino "la regla lo cambia": es la misma
// pregunta que hace el importador y ademas es lo que hace la corrida idempotente
// (lo ya corregido no vuelve a entrar).
export function planParche(prospectos) {
  const plan = [];
  for (const p of prospectos || []) {
    const empresa = (p.data || {}).empresa;
    if (empresa === undefined || empresa === null) continue;
    const antes = String(empresa);
    if (!antes.trim()) continue;
    const despues = normalizarTextosProspecto({ data: { empresa: antes } }).data.empresa;
    if (despues !== antes) plan.push({ id: p.id, antes, despues });
  }
  return plan;
}

async function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const envPath = join(__dirname, '..', '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  }
  const argv = process.argv.slice(2);
  const aplicar = argv.includes('--aplicar') && !argv.includes('--dry-run');
  const prospectos = await listar();
  const plan = planParche(prospectos);
  console.log(`Parche de empresas de prospecto #293 (${aplicar ? 'APLICAR' : 'DRY-RUN'}) -- ${prospectos.length} prospecto(s) revisado(s)\n`);
  for (const c of plan) console.log(`  ${c.id}: ${c.antes}  ->  ${c.despues}`);
  if (!plan.length) {
    console.log('  (nada que corregir)');
    return;
  }
  if (!aplicar) {
    console.log(`\nDRY-RUN: se corregirian ${plan.length} prospecto(s). No se escribio nada (sin --aplicar).`);
    return;
  }
  let escritos = 0;
  for (const c of plan) {
    if (await actualizarDatos(c.id, { data: { empresa: c.despues } })) escritos++;
    else console.log(`  AVISO: el prospecto ${c.id} ya no existe, no se escribio`);
  }
  console.log(`\n${escritos} prospecto(s) corregido(s).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
