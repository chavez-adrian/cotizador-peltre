// Importacion de los candidatos aprobados del cruce de Bitrix (issue #159,
// padre #155). Sigue el patron del import de Feria/Expo (#47): crea PROSPECTOS
// en Por Cotizar, deduplicando por celular contra los prospectos del cotizador
// y contra los clientes de Operam, con la fecha de la IMPORTACION (no la del
// registro original: con la fecha vieja toda la cola naceria en rojo con las
// horas habiles ya vencidas).
//
// === GATE HUMANO ===
// Este script NO corre solo y NO se ejecuta como parte del cruce. Exige, todas
// juntas:
//   1. --importar                       (si falta: DRY-RUN, no escribe nada)
//   2. --aprobado-por "<nombre>"        (quien aprobo la lista; queda en el evento)
//   3. --vendedor "<nombre>"            (a quien se asignan los prospectos)
//   4. DATABASE_URL en el entorno       (sin ella escribiria al JSON de dev)
// Sin las cuatro, imprime el plan y termina. La lista que importa es la que
// dejo scripts/cruzar-bitrix.mjs en cruce.json, menos lo que se excluya con
// --excluir. Ningun candidato sin canal se importa: el canal decide la cadencia
// de seguimiento y no se inventa fuera del catalogo cerrado.
//
// Uso:
//   node scripts/importar-bitrix.mjs                             # DRY-RUN
//   node scripts/importar-bitrix.mjs --excluir 3,7,12            # DRY-RUN sin esos
//   DATABASE_URL="..." node scripts/importar-bitrix.mjs \
//     --importar --aprobado-por "Adrian Chavez" --vendedor "Adrian Chavez"
import { existsSync, readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { leerArchivoSync, escribirArchivoSync } from '../lib/fs-reintento.js';
import { ordenarCandidatos, nombrePropio, empresaPropia } from '../lib/cruce-bitrix.js';

// Mismas dos funciones que usa el import de Feria/Expo (#47) para el celular:
// normalizar primero (Bitrix guarda numeros mexicanos como "+2225592022", con
// el "+" pegado y sin lada de pais) y validar despues con el gate del sistema.
import { normalizarCelularFeria } from '../lib/importar-prospectos.js';
import { validarTelefono } from '../public/js/alta-logica.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIR_EXPORT = join(ROOT, 'data', 'export-bitrix');

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

const IMPORTAR = argv.includes('--importar');
const APROBADO_POR = flag('--aprobado-por');
const VENDEDOR = flag('--vendedor');
const EXCLUIR = new Set(
  String(flag('--excluir', '') || '')
    .split(',')
    .map(s => Number(s.trim()))
    .filter(n => Number.isFinite(n))
);

function ultimaFechaDeExport() {
  if (!existsSync(DIR_EXPORT)) return null;
  const fechas = readdirSync(DIR_EXPORT).filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f)).sort();
  return fechas.length ? fechas[fechas.length - 1] : null;
}

const FECHA = flag('--fecha') || ultimaFechaDeExport();
const DIR = FECHA ? join(DIR_EXPORT, FECHA) : null;
const RUTA_CRUCE = DIR ? join(DIR, 'cruce.json') : null;

if (!RUTA_CRUCE || !existsSync(RUTA_CRUCE)) {
  console.error(
    `ABORTA: no encuentro ${RUTA_CRUCE || '(sin export)'}.\n` +
    'Corre primero el cruce y haz que Adrian apruebe la lista:\n' +
    '  DATABASE_URL="..." node scripts/cruzar-bitrix.mjs'
  );
  process.exit(1);
}

const cruce = JSON.parse(leerArchivoSync(RUTA_CRUCE));
const todos = cruce.candidatos || [];

// El numero que ve Adrian en el reporte es la POSICION en la tabla 4. El orden
// lo define ordenarCandidatos en el nucleo -- la MISMA funcion que uso el
// reporte -- para que "--excluir 3" quite exactamente la fila 3 que el vio.
const ordenados = ordenarCandidatos(todos);

const plan = [];
const fuera = [];
ordenados.forEach((c, i) => {
  const numero = i + 1;
  if (EXCLUIR.has(numero)) {
    fuera.push({ numero, nombre: c.nombre, motivo: 'excluido por Adrian' });
    return;
  }
  if (!c.canal) {
    fuera.push({ numero, nombre: c.nombre, motivo: `sin canal mapeado (SOURCE_ID=${c.sourceId || 'vacio'})` });
    return;
  }
  if (!c.telefonoLlave) {
    fuera.push({ numero, nombre: c.nombre, motivo: 'sin celular' });
    return;
  }
  plan.push({ numero, ...c });
});

console.log(`Importacion de candidatos de Bitrix (#159) -- cruce ${FECHA}\n`);
console.log(`  candidatos en el cruce: ${todos.length}`);
console.log(`  a importar:            ${plan.length}`);
console.log(`  fuera:                 ${fuera.length}`);
for (const f of fuera) console.log(`    #${f.numero} ${f.nombre || '(sin nombre)'}: ${f.motivo}`);

const faltantes = [];
if (!IMPORTAR) faltantes.push('--importar');
if (!APROBADO_POR) faltantes.push('--aprobado-por "<quien aprobo>"');
if (!VENDEDOR) faltantes.push('--vendedor "<a quien se asignan>"');
if (!process.env.DATABASE_URL) faltantes.push('DATABASE_URL en el entorno');

if (faltantes.length) {
  console.log('\n--- DRY-RUN: no se escribio NADA ---');
  console.log('Falta para importar de verdad:');
  for (const f of faltantes) console.log(`  - ${f}`);
  console.log('\nPlan (los primeros 10):');
  for (const p of plan.slice(0, 10)) {
    console.log(`  #${p.numero} ${p.nombre || '(sin nombre)'} | ${p.telefono} | canal ${p.canal} | ${p.empresa || 'sin empresa'}`);
  }
  process.exit(0);
}

// --- Importacion real (solo con las cuatro condiciones cumplidas) ---
const prospectosStore = await import('../lib/prospectos-store.js');
const { matchCliente, refrescarIndice } = await import('../lib/indice-telefonos.js');

// El indice de Operam se refresca UNA VEZ antes del loop (leccion de #46: no
// por fila). Si falla, se importa igual -- best effort, mismo trade-off que la
// captura manual y que el import de Feria.
let indiceListo = false;
try {
  await refrescarIndice();
  indiceListo = true;
} catch (err) {
  console.warn(`\naviso: sin indice de Operam (${err.message}); se importa sin ese filtro.`);
}

const fecha = new Date().toISOString();
const importados = [];
const descartados = [];

for (const p of plan) {
  const celular = normalizarCelularFeria(p.telefono);
  const invalido = validarTelefono('', celular);
  if (invalido) {
    descartados.push({ numero: p.numero, nombre: p.nombre, motivo: `telefono invalido (${invalido})` });
    continue;
  }
  const existente = await prospectosStore.buscarPorCelular(celular);
  if (existente) {
    descartados.push({ numero: p.numero, nombre: p.nombre, motivo: 'ya es prospecto' });
    continue;
  }
  if (indiceListo) {
    const cliente = await matchCliente(celular);
    if (cliente) {
      descartados.push({ numero: p.numero, nombre: p.nombre, motivo: `ya es cliente Operam (${cliente.cust_name})` });
      continue;
    }
  }

  // Normalizacion pedida por Adrian al aprobar la lista (2026-08-16): Bitrix
  // trae nombres en mayusculas sostenidas o todo minusculas segun el capturista.
  const data = { origen_bitrix: p.origenes.join(' '), importado_de: 'bitrix24', aprobado_por: APROBADO_POR };
  if (p.empresa) data.empresa = empresaPropia(p.empresa);
  if (p.correo) data.correo = p.correo;

  try {
    const id = await prospectosStore.crear({
      fecha,
      vendedor: VENDEDOR,
      celular,
      nombre: nombrePropio(p.nombre) || '(sin nombre)',
      // Bitrix no guarda ciudad: ADDRESS_CITY viene vacio en los 693 registros
      // del export (verificado 2026-08-16). El prospecto nace sin ciudad y el
      // vendedor la captura al primer contacto; sin ella no se puede estimar
      // envio. Inventarla desde la LADA del telefono seria adivinar.
      ciudad: '',
      canal: p.canal,
      data,
    });
    importados.push({ numero: p.numero, id, nombre: p.nombre, celular });
  } catch (err) {
    if (err.code !== '23505') throw err;
    descartados.push({ numero: p.numero, nombre: p.nombre, motivo: 'celular duplicado (carrera)' });
  }
}

console.log(`\n--- IMPORTACION APLICADA (aprobada por ${APROBADO_POR}) ---`);
console.log(`  importados: ${importados.length}`);
for (const i of importados) console.log(`    #${i.numero} -> prospecto ${i.id}: ${i.nombre} ${i.celular}`);
console.log(`  descartados en la importacion: ${descartados.length}`);
for (const d of descartados) console.log(`    #${d.numero} ${d.nombre}: ${d.motivo}`);
console.log(`\nTodos quedaron en Por Cotizar, canal segun el mapeo aprobado, asignados a ${VENDEDOR}.`);

// El reporte final se GUARDA, no solo se imprime: es la evidencia de cuantos
// entraron, cuantos se descartaron y por que (criterio de aceptacion de #159).
const resumen = [
  '# Importacion de candidatos de Bitrix -- resultado',
  '',
  `**Fecha:** ${fecha}  `,
  `**Aprobada por:** ${APROBADO_POR}  `,
  `**Asignados a:** ${VENDEDOR}  `,
  `**Cruce de origen:** ${FECHA}`,
  '',
  `- candidatos en la lista aprobada: ${todos.length}`,
  `- importados: ${importados.length}`,
  `- fuera antes de importar: ${fuera.length}`,
  `- descartados durante la importacion: ${descartados.length}`,
  '',
  '## Importados',
  '',
  ...importados.map(i => `- #${i.numero} prospecto ${i.id}: ${i.nombre} ${i.celular}`),
  '',
  '## Fuera antes de importar',
  '',
  ...fuera.map(f => `- #${f.numero} ${f.nombre || '(sin nombre)'}: ${f.motivo}`),
  '',
  '## Descartados durante la importacion',
  '',
  ...descartados.map(d => `- #${d.numero} ${d.nombre || '(sin nombre)'}: ${d.motivo}`),
  '',
].join('\n');
const destinoReporte = join(DIR, 'REPORTE-IMPORTACION.md');
escribirArchivoSync(destinoReporte, resumen);
console.log(`Reporte final -> ${destinoReporte}`);
process.exit(0);
