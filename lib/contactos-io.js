// Envoltura de IO de la sincronizacion de contactos a Google (spec #224, ticket
// #227). Lee las fuentes, aplica el nucleo puro (lib/contactos-logica.js) y
// EJECUTA el plan. No decide nada: mismo reparto que lib/sync-operam-io.js
// frente a lib/sync-operam.js.
//
// Tres reglas que no son negociables y que viven aqui:
//   - Escrituras SECUENCIALES. Google lo pide por escrito en cada metodo de
//     mutacion ("Mutate requests for the same user should be sent sequentially
//     to avoid increased latency and failures"). Nada de Promise.all.
//   - El mapeo se persiste FICHA POR FICHA conforme se escribe, no al final: un
//     fallo a la mitad del plan no puede descartar lo ya aplicado en Google, o
//     la siguiente pasada crearia duplicados de lo que ya existe.
//   - Un fallo de Google jamas altera una respuesta del cotizador. Este modulo
//     no lo invoca ninguna ruta de alta: corre desde el barrido periodico.

import { planificarContactos } from './contactos-logica.js';
import * as contactosStore from './contactos-store.js';
import * as prospectosStore from './prospectos-store.js';
import { credencialesConfiguradas, crearContacto, actualizarContacto, leerContacto } from './google-contactos.js';

// El etag obsoleto llega como 400 con este motivo, NO como 409. Significa
// "alguien edito este contacto desde el telefono": la respuesta correcta es
// releer y reintentar, no tratarlo como un payload malformado.
const MOTIVO_ETAG_VIEJO = 'failedPrecondition';

// Google nombra ese motivo de dos formas segun donde lo ponga (`failedPrecondition`
// en details[].reason, `FAILED_PRECONDITION` en error.status), asi que se compara
// sin separadores ni mayusculas. Un 400 SIN este motivo NO es un etag viejo: es un
// payload malformado, y releer no lo arreglaria.
function esEtagViejo(err) {
  if (err?.status !== 400) return false;
  const motivo = String(err.motivo || '').toLowerCase().replace(/[^a-z]/g, '');
  return motivo === MOTIVO_ETAG_VIEJO.toLowerCase();
}

// Lock en memoria para que dos barridos no se pisen. Como el lock
// subidasOperamEnCurso y la cola de post-fixes de vigencia, ASUME UNA SOLA
// INSTANCIA (Render plan Starter).
let barridoEnCurso = false;

function resumenVacio(omitido) {
  return { omitido, creados: 0, actualizados: 0, inactivados: 0, errores: [] };
}

async function aplicarCreacion(entrada) {
  const { resourceName, etag } = await crearContacto(entrada.ficha, entrada.mascara);
  await contactosStore.guardar({
    celular10: entrada.celular10, resourceName, etag,
    clase: entrada.clase, huella: entrada.huella,
  });
}

async function aplicarActualizacion(entrada) {
  let etag = entrada.etag;
  let resultado;
  try {
    resultado = await actualizarContacto({ ...entrada, etag });
  } catch (err) {
    if (!esEtagViejo(err)) throw err;
    // Releer y reintentar UNA vez con el etag fresco.
    ({ etag } = await leerContacto(entrada.resourceName));
    resultado = await actualizarContacto({ ...entrada, etag });
  }
  await contactosStore.guardar({
    celular10: entrada.celular10, resourceName: resultado.resourceName, etag: resultado.etag,
    clase: entrada.clase, huella: entrada.huella,
  });
}

export async function barrerContactosGoogle() {
  if (!credencialesConfiguradas()) return resumenVacio('sin credenciales');
  if (barridoEnCurso) return resumenVacio('barrido en curso');
  barridoEnCurso = true;
  const resumen = resumenVacio(null);
  try {
    const [prospectos, mapeo] = await Promise.all([
      prospectosStore.listar(),
      contactosStore.listar(),
    ]);
    const plan = planificarContactos({ prospectos, mapeo });

    for (const entrada of plan.crear) {
      try {
        await aplicarCreacion(entrada);
        resumen.creados += 1;
      } catch (err) {
        resumen.errores.push({ celular10: entrada.celular10, motivo: err.message });
      }
    }
    for (const entrada of plan.actualizar) {
      try {
        await aplicarActualizacion(entrada);
        resumen.actualizados += 1;
      } catch (err) {
        resumen.errores.push({ celular10: entrada.celular10, motivo: err.message });
      }
    }
  } finally {
    barridoEnCurso = false;
  }
  return resumen;
}

export { MOTIVO_ETAG_VIEJO };
