// Migracion del vinculo Oportunidad -> Contacto (#342, spec #337, ADR-0016):
// cada cotizacion existente recibe el celular de su Contacto en el campo propio,
// una sola vez y para siempre. Las nuevas lo anotan solas al nacer.
//
// El QUE lo decide el nucleo puro (lib/contacto-cotizacion.js) con las cuatro
// fuentes en orden: (1) cruce con un Contacto existente por el telefono
// anotado; (2) telefono anotado sin Contacto -> nace un Contacto SIN etiqueta
// prospecto, ligado al Cliente Operam de la cotizacion; (3) sin telefono ->
// indice de Operam bajo su customer_id, primero Cel, luego Telefono, luego
// Telefono Secundario; (4) nada -> sin Contacto, y el vendedor se lo captura a
// mano desde la tarjeta. Aqui solo vive el IO.
//
// IDEMPOTENTE: una cotizacion que ya tiene Contacto anotado sale como `anotado`
// y no se toca (la guarda vive en cotizaciones-store.setContactoCelular, que
// nunca pisa una liga existente). Correrlo dos veces no cambia nada la segunda.
//
// READ-ONLY contra Operam (cero escrituras). Con --apply escribe SOLO en el
// cotizador: el campo propio de la cotizacion y, cuando hace falta, la ficha del
// Contacto que nadie capturo.
//
// Uso:
//   node scripts/migrar-contacto-cotizaciones.mjs              # DRY-RUN: imprime el log (NO escribe)
//   node scripts/migrar-contacto-cotizaciones.mjs --dry-run    # lo mismo, explicito
//   node scripts/migrar-contacto-cotizaciones.mjs --apply      # aplica (EXIGE DATABASE_URL)
//
// --apply exige DATABASE_URL: sin ella los stores caen al fallback JSON local y
// migrarian datos de dev.
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// OPERAM_* desde .env del cotizador (lectura); DATABASE_URL del entorno.
const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^(OPERAM_[A-Z]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');

if (APPLY && !process.env.DATABASE_URL) {
  console.error('ABORTA: --apply requiere DATABASE_URL (la Neon del cotizador). Sin ella los\n' +
    'stores usan el fallback JSON local y migrarian datos de dev.');
  process.exit(1);
}

const { listarTodosClientes, obtenerPedido } = await import('../lib/operam-client.js');
const { enumerarTelefonosClientes } = await import('../lib/indice-telefonos.js');
const { planearMigracion, FUENTES, MOTIVO_SIN_CONTACTO } = await import('../lib/contacto-cotizacion.js');
const cotStore = await import('../lib/cotizaciones-store.js');
const prospectosStore = await import('../lib/prospectos-store.js');
const { ultimos10 } = await import('../lib/telefono-llave.js');

// El indice de Operam que consume el nucleo: customer_id -> telefonos con su
// casilla. Sale de la MISMA enumeracion de las seis casillas que alimenta el
// indice de telefonos (#338), no de un recorrido propio.
function indiceOperam(clientes) {
  const mapa = new Map();
  for (const e of enumerarTelefonosClientes(clientes)) {
    const llave = String(e.customerId);
    if (!mapa.has(llave)) mapa.set(llave, []);
    mapa.get(llave).push({ telefono: e.telefono, casilla: e.casilla });
  }
  return mapa;
}

async function cargarClientesOperam() {
  try {
    return await listarTodosClientes();
  } catch (err) {
    console.warn(`AVISO: no se pudo leer el padron de Operam (${err.message}).`);
    console.warn('Las cotizaciones sin telefono quedaran sin Contacto en este plan.');
    return [];
  }
}

// El Cliente Operam de las cotizaciones que no lo anotaron. Las 40 sin telefono
// son las que dejo el backfill (#76): su `data.cliente` trae rfc, customer_ref y
// contacto de entrega, pero NO el customer_id -- sin el, el respaldo por el
// indice de Operam no tiene bajo que buscar. El pedido que si guardaron
// (`data.orderOperam`) lo sabe: viaja como `debtor_no`. Lectura pura, una por
// cotizacion que la necesite, con el throttle anti-429 del cliente de Operam.
async function resolverClienteOperam(cotizaciones) {
  const resueltas = [];
  for (const c of cotizaciones) {
    const cli = c.data?.cliente || {};
    const tieneTelefono = ultimos10(cli.telefono).length === 10 || ultimos10(cli.celEntrega).length === 10;
    if (tieneTelefono || cli.customerId != null || !c.data?.orderOperam) {
      resueltas.push(c);
      continue;
    }
    try {
      const pedido = await obtenerPedido(c.data.orderOperam);
      const plano = pedido?.data || pedido || {};
      const debtor = plano.debtor_no;
      resueltas.push(debtor != null && debtor !== '' ? { ...c, clienteOperam: debtor } : c);
    } catch (err) {
      console.warn(`AVISO: pedido ${c.data.orderOperam} de la cotizacion ${c.id} no se pudo leer (${err.message}).`);
      resueltas.push(c);
    }
  }
  return resueltas;
}

const cotizaciones = await resolverClienteOperam(await cotStore.listar());
const prospectos = await prospectosStore.listar();
const clientes = await cargarClientesOperam();

const contactos = new Set(
  prospectos.map(p => p.celular10 || ultimos10(p.celular)).filter(k => k && k.length === 10)
);
const plan = planearMigracion(cotizaciones, { contactos, telefonosOperam: indiceOperam(clientes) });

console.log(`Cotizaciones: ${cotizaciones.length} | Contactos existentes: ${contactos.size} | Clientes Operam: ${clientes.length}`);
console.log(APPLY ? '--- APLICANDO ---' : '--- DRY-RUN (no escribe) ---');

const conteo = { [FUENTES.ANOTADO]: 0, [FUENTES.CRUCE]: 0, [FUENTES.TELEFONO]: 0, [FUENTES.OPERAM]: 0, [MOTIVO_SIN_CONTACTO]: 0 };
let creados = 0;
let ligados = 0;

for (const p of plan) {
  const fuente = p.fuente || p.motivo;
  conteo[fuente] = (conteo[fuente] || 0) + 1;
  const detalle = [
    `id=${p.id}`,
    `contacto=${p.contacto || '-'}`,
    `fuente=${fuente}`,
    p.casilla ? `casilla=${p.casilla}` : null,
    p.crear ? 'crea-contacto' : null,
  ].filter(Boolean).join(' ');
  console.log(detalle);
  if (!APPLY || p.fuente === FUENTES.ANOTADO || !p.contacto) continue;

  const cot = cotizaciones.find(c => c.id === p.id);
  if (p.crear) {
    try {
      await prospectosStore.crear({
        fecha: cot.fecha, vendedor: cot.vendedor,
        celular: p.contacto,
        nombre: cot.data?.cliente?.nombreCorto || cot.cliente || 'Sin nombre',
        ciudad: cot.data?.cliente?.municipio || cot.data?.cliente?.estado || '',
        // Sin Origen: nadie lo capturo, asi que no hay puerta por la que haya
        // llegado. Inventarle una seria mentir en el chip de Origen (#287).
        canal: '',
        // Fuera del tablero: la Oportunidad de este Contacto es la cotizacion,
        // no una tarjeta propia (lib/oportunidades.js lo filtra por sinCaptura).
        etapa: 'seguimiento',
        data: {
          // La marca que dice que este Contacto NO se capturo (AC5): sin ella
          // se leeria como un prospecto trabajado que nunca existio.
          sinCaptura: true,
          fuenteContacto: p.fuente,
          // La liga al Cliente Operam de la cotizacion, la misma clave que deja
          // prospectos-store.ligarCliente.
          ...(p.clienteOperam != null ? { cliente_id: p.clienteOperam } : {}),
        },
      });
      creados++;
    } catch (err) {
      // Un celular que ya era Contacto (carrera o dato movido entre la lectura y
      // la escritura) no es un fallo: la liga se escribe igual.
      if (err.code !== '23505') throw err;
    }
  }
  if (await cotStore.setContactoCelular(p.id, p.contacto)) ligados++;
}

console.log('--- Distribucion ---');
console.log(`ya anotadas (sin tocar): ${conteo[FUENTES.ANOTADO]}`);
console.log(`cruzan con Contacto:     ${conteo[FUENTES.CRUCE]}`);
console.log(`telefono sin Contacto:   ${conteo[FUENTES.TELEFONO]}`);
console.log(`respaldo de Operam:      ${conteo[FUENTES.OPERAM]}`);
console.log(`sin Contacto:            ${conteo[MOTIVO_SIN_CONTACTO]}`);
if (APPLY) console.log(`Escrituras: ${ligados} cotizaciones ligadas, ${creados} Contactos creados.`);
else console.log(`Escribiria: ${plan.filter(p => p.contacto && p.fuente !== FUENTES.ANOTADO).length} ligas, ${plan.filter(p => p.crear).length} Contactos.`);

process.exit(0);
