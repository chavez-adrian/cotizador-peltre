// Separacion Contacto / Oportunidad pre-cotizacion (#343, spec #337, ADR-0016):
// la fila de `prospectos` guardaba dos cosas juntas -- la PERSONA y su primera
// INTENCION de compra. Esta migracion le da a la intencion su propio registro,
// para que un Contacto pueda tener varias.
//
// El QUE lo decide el nucleo puro (lib/oportunidad-pre.js, planearSeparacion),
// con los tres casos del ticket:
//   - Contacto en No Asignado / Por Cotizar (o cualquier etapa sin cotizacion
//     viva que lo represente) -> UNA Oportunidad con su etapa y sus eventos.
//   - Contacto cuya cotizacion VIVA ya es su Oportunidad -> NINGUNA (la
//     cotizacion ES la Oportunidad; crear un registro devolveria la tarjeta
//     inerte que #340 quito).
//   - Contacto en Seguimiento con folio capturado a mano (#56) y sin cotizacion
//     en el sistema -> UNA Oportunidad en Seguimiento con ese folio.
// Un Contacto que nadie capturo (el que nacio de la migracion de #342) tampoco
// genera Oportunidad: no hay intencion abierta suya que trabajar.
//
// IDEMPOTENTE: un Contacto que ya tiene registro propio sale como `ya_separada`
// y no se toca. Correrlo dos veces no cambia nada la segunda.
//
// La fila del Contacto NO se vacia: su etapa y sus eventos se quedan como
// estaban. La lectura ya prefiere el registro propio cuando existe
// (lib/oportunidad-pre.js), asi que quedan como respaldo auditable, no como una
// segunda verdad.
//
// El codigo funciona ANTES de que esto corra: un Contacto sin registro propio
// sigue siendo su propia Oportunidad, con su mismo id. Por eso el deploy puede
// llegar antes que el --apply.
//
// El dry-run no escribe NINGUN dato. Lo unico que toca es el esquema: leer por
// los stores dispara sus `ensureSchema` (el CREATE TABLE IF NOT EXISTS de
// `oportunidades`), idempotente y que el propio servidor corre en su primera
// lectura tras el despliegue.
//
// Uso:
//   node scripts/migrar-oportunidades.mjs              # DRY-RUN: imprime el plan (NO escribe)
//   node scripts/migrar-oportunidades.mjs --dry-run    # lo mismo, explicito
//   node scripts/migrar-oportunidades.mjs --apply      # aplica (EXIGE DATABASE_URL)
//
// --apply exige DATABASE_URL: sin ella los stores caen al fallback JSON local y
// migrarian datos de dev.
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');

if (APPLY && !process.env.DATABASE_URL) {
  console.error('ABORTA: --apply requiere DATABASE_URL (la Neon del cotizador). Sin ella los\n' +
    'stores usan el fallback JSON local y migrarian datos de dev.');
  process.exit(1);
}

const { planearSeparacion, MOTIVO_YA_SEPARADA, MOTIVO_SIN_CAPTURA, MOTIVO_ES_LA_COTIZACION } =
  await import('../lib/oportunidad-pre.js');
const cotStore = await import('../lib/cotizaciones-store.js');
const prospectosStore = await import('../lib/prospectos-store.js');
const oportunidadesStore = await import('../lib/oportunidades-store.js');

const contactos = await prospectosStore.listar();
const cotizaciones = await cotStore.listar();
const propias = await oportunidadesStore.listar();
const plan = planearSeparacion(contactos, cotizaciones, propias);

console.log(`Contactos: ${contactos.length} | Cotizaciones: ${cotizaciones.length} | Oportunidades ya separadas: ${propias.length}`);
console.log(APPLY ? '--- APLICANDO ---' : '--- DRY-RUN (no escribe) ---');

const conteo = {
  separa: 0,
  [MOTIVO_YA_SEPARADA]: 0,
  [MOTIVO_SIN_CAPTURA]: 0,
  [MOTIVO_ES_LA_COTIZACION]: 0,
};
let creadas = 0;

for (const p of plan) {
  const clave = p.crear ? 'separa' : p.motivo;
  conteo[clave] = (conteo[clave] || 0) + 1;
  const detalle = [
    `contacto=${p.contactoId}`,
    p.crear ? `separa etapa=${p.fila.etapa}` : `omite motivo=${p.motivo}`,
    p.crear && p.fila.data.folioOperam ? `folio=${p.fila.data.folioOperam}` : null,
  ].filter(Boolean).join(' ');
  console.log(detalle);
  if (!APPLY || !p.crear) continue;
  await oportunidadesStore.crear(p.fila);
  creadas++;
}

console.log('--- Distribucion ---');
console.log(`se separan:                 ${conteo.separa}`);
console.log(`ya separadas (sin tocar):   ${conteo[MOTIVO_YA_SEPARADA]}`);
console.log(`la cotizacion es la suya:   ${conteo[MOTIVO_ES_LA_COTIZACION]}`);
console.log(`nadie los capturo:          ${conteo[MOTIVO_SIN_CAPTURA]}`);
if (APPLY) console.log(`Escrituras: ${creadas} Oportunidades creadas.`);
else console.log(`Escribiria: ${plan.filter(p => p.crear).length} Oportunidades.`);

process.exit(0);
