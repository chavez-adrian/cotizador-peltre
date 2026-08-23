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
import * as pedidosShopifyStore from './pedidos-shopify-store.js';
import * as contactosExcluidosStore from './contactos-excluidos-store.js';
import { clientesCacheados, enumerarTelefonosClientes } from './indice-telefonos.js';
import {
  credencialesConfiguradas, crearContacto, actualizarContacto, leerContacto, leerLibreta,
  marcarContactoInactivo, reactivarContacto,
} from './google-contactos.js';

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

// Una ficha del mapeo cuyo resourceName ya no existe en Google (alguien la
// borro a mano desde el telefono): el PATCH -- o la relectura por etag viejo,
// que apunta al mismo resourceName -- responde 404. Se distingue por CODIGO,
// a diferencia del etag viejo que se distingue por motivo (#249: la respuesta
// correcta no es reintentar ni abortar la pasada, es olvidar la fila para que
// la siguiente pasada trate ese celular como nuevo).
function esFichaBorrada(err) {
  return err?.status === 404;
}

// Motivo legible que ve el panel de #230 cuando una fila se olvido por 404. Se
// clasifica ya como 'datos' (igual que los frenos de #231) porque su texto no
// trae codigo de Google que clasificarError() pueda reconocer.
const MOTIVO_FICHA_BORRADA = 'ficha borrada en Google, se olvida del mapeo (se recrea en la siguiente pasada)';

// Lock en memoria para que dos barridos no se pisen. Como el lock
// subidasOperamEnCurso y la cola de post-fixes de vigencia, ASUME UNA SOLA
// INSTANCIA (Render plan Starter).
let barridoEnCurso = false;

function resumenVacio(omitido) {
  return { omitido, creados: 0, actualizados: 0, inactivados: 0, errores: [] };
}

// Se llama en cuanto Google confirma UNA ficha, no al final de la pasada: ahi
// esta la garantia de que un fallo posterior no descarta lo ya aplicado.
async function persistir(entrada, { resourceName, etag }) {
  await contactosStore.guardar({
    celular10: entrada.celular10, resourceName, etag,
    clase: entrada.clase, huella: entrada.huella,
  });
}

async function aplicarCreacion(entrada) {
  await persistir(entrada, await crearContacto(entrada.ficha, entrada.mascara));
}

async function aplicarActualizacion(entrada) {
  // REACTIVACION (#231): primero sale del grupo Inactivo y luego se le escribe.
  // En este orden porque el que persiste es el segundo paso: si la salida del
  // grupo falla, la ficha sigue marcada en el mapeo y la siguiente pasada
  // reintenta las dos cosas. Al reves quedaria sin marca pero dentro del grupo.
  if (entrada.reactivar) await reactivarContacto(entrada.resourceName);
  let resultado;
  try {
    resultado = await actualizarContacto(entrada);
  } catch (err) {
    if (!esEtagViejo(err)) throw err;
    // Alguien edito el contacto desde el telefono: releer y reintentar UNA vez
    // con el etag fresco.
    const { etag } = await leerContacto(entrada.resourceName);
    resultado = await actualizarContacto({ ...entrada, etag });
  }
  await persistir(entrada, resultado);
}

export async function barrerContactosGoogle() {
  if (!credencialesConfiguradas()) return resumenVacio('sin credenciales');
  if (barridoEnCurso) return resumenVacio('barrido en curso');
  barridoEnCurso = true;
  const resumen = resumenVacio(null);
  try {
    // La libreta se lee ENTERA antes de planificar (#229): sin saber que
    // celulares ya tienen contacto hecho a mano, el plan crearia una segunda
    // ficha de cada uno. Si la lectura falla, la pasada se ABORTA en vez de
    // crear a ciegas: el costo de no hacer nada es esperar quince minutos; el de
    // crear a ciegas es una libreta con duplicados que nadie va a borrar (nada
    // se borra nunca, ADR-0013).
    let libreta;
    try {
      libreta = await leerLibreta();
    } catch (err) {
      resumen.omitido = 'libreta ilegible';
      resumen.errores.push({ motivo: err.message });
      return resumen;
    }
    // Los clientes salen del cache del indice de telefonos (#228): ese cache es
    // el unico punto donde se decide cada cuanto se relee Operam, y este barrido
    // hereda su ritmo horario en vez de imponer uno propio. Con el cache tibio la
    // pasada no toca Operam.
    // Los pedidos de la tienda en linea (#255) salen de la tabla que llena el
    // sondeo horario (lib/pedidos-shopify-io.js), NUNCA de Shopify: la red no
    // entra al plan, y un sondeo caido se ve aqui como una tabla que no crece,
    // no como una pasada rota.
    // Excluidos (#259): la lista se lee en cada pasada, igual que el mapeo -- es
    // barata y una solicitud de cancelacion tiene que surtir efecto en la
    // siguiente corrida, no en el proximo despliegue.
    const [prospectos, clientes, pedidos, mapeo, excluidos] = await Promise.all([
      prospectosStore.listar(),
      clientesCacheados().then(enumerarTelefonosClientes),
      pedidosShopifyStore.listar(),
      contactosStore.listar(),
      contactosExcluidosStore.listar(),
    ]);
    const plan = planificarContactos({ prospectos, clientes, pedidos, mapeo, libreta, excluidos });
    // Los errores del PLAN (#231: tope de inactivacion, fuente sin evidencia) no
    // son fallos de una ficha: son la razon por la que una parte del plan no se
    // va a aplicar. Van al mismo arreglo que ve el panel, ya clasificados.
    resumen.errores.push(...(plan.errores || []));

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
        if (esFichaBorrada(err)) {
          // Olvidar la fila, NO reintentar: sin ella la siguiente pasada trata
          // el celular como nuevo (lo CREA, o lo ADOPTA si hay una ficha
          // manual con ese numero en la libreta). No es un DELETE a People
          // API (ADR-0013): es borrar la fila del mapeo, que es nuestro.
          await contactosStore.eliminar(entrada.celular10);
          resumen.errores.push({ celular10: entrada.celular10, motivo: MOTIVO_FICHA_BORRADA, categoria: 'datos' });
        } else {
          resumen.errores.push({ celular10: entrada.celular10, motivo: err.message });
        }
      }
    }
    // Lo que perdio respaldo (#231). Va AL FINAL a proposito: si la pasada se
    // rompe antes, lo que se pierde es una etiqueta que la siguiente pasada
    // vuelve a calcular, no una escritura de datos.
    //
    // Primero Google y luego el mapeo, por la misma razon que las otras dos
    // listas: la marca local solo se escribe cuando Google ya confirmo. Al
    // reves, la ficha quedaria "inactiva" para el cotizador y activa en el
    // telefono, y nadie volveria a intentarlo.
    for (const entrada of plan.inactivar) {
      try {
        await marcarContactoInactivo(entrada.resourceName);
        await contactosStore.marcarInactivo(entrada.celular10);
        resumen.inactivados += 1;
      } catch (err) {
        resumen.errores.push({ celular10: entrada.celular10, motivo: err.message });
      }
    }
  } finally {
    barridoEnCurso = false;
  }
  return resumen;
}
