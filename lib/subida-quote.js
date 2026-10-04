import { actualizarQuoteOperam } from './operam-web.js';
import { huellaContenidoQuote } from './operam-client.js';
import { sacarDeLaColaPostFix } from './postfix-reintento-io.js';
import { filaEncabezado, pasoEncabezadoQuote } from './postfix-encabezado-quote.js';
import { puedeActualizarCotizacion } from '../public/js/editar-cotizacion-logica.js';
import * as cotStore from './cotizaciones-store.js';

// Modulo Subida del quote (#524, ADR-0022): deja la cotizacion registrada en
// Operam como quote con su folio (crear) o reescribe el quote conservando el folio
// (actualizar). Precedente: el Alta de cliente (ADR-0017) -- devuelve VALORES y
// nunca un status HTTP, no importa Express ni server.js, y recibe sus dependencias
// por `deps` con fallback a las reales. Los handlers solo traducen.
//
// A diferencia del alta, este modulo SI escribe en el registro de la cotizacion
// (huella, marca de quote desactualizado): la subida es justo eso.
//
// Por ahora (tajada 1 de 3) solo cubre ACTUALIZAR; crear sigue en server.js y
// usa el candado de aqui.
//
// --- Valores de actualizarQuote ---------------------------------------------
//   OCUPADO                                       (otra operacion en vuelo)
//   { tipo: 'no-encontrada' }
//   { tipo: 'bloqueo', motivo: 'no-actualizable', mensaje }   (el gate, #104/#502)
//   { tipo: 'actualizada', folio, pasos }
//   { tipo: 'no-actualizada', folio, escrito, verificado, error, discrepancias, pasos }
// Una excepcion inesperada (el store que falla) se propaga, como antes.
//
// --- Dependencias (deps = {}) -----------------------------------------------
// Cada llave se llama igual que la funcion real a la que sustituye; el
// adaptador en memoria de los tests (test/helpers/subida-quote-memoria.js)
// implementa las mismas.
//   de cotizaciones-store:  obtener, actualizarDatos
//   de operam-web:          actualizarQuoteOperam
//   de postfix-reintento-io: sacarDeLaColaPostFix
//   ahora()                 la fecha de la marca quoteDesactualizado
//   listaDelQuote(entry), transportistaDelQuote(entry): OBLIGATORIAS, sin
//     fallback. Viven en server.js (la lista cuelga del catalogo que lee
//     server.js) y el handler las pasa.

function resolverDeps(deps) {
  for (const llave of ['listaDelQuote', 'transportistaDelQuote']) {
    if (typeof deps[llave] !== 'function') {
      throw new Error(`subida-quote: falta la dependencia obligatoria ${llave}`);
    }
  }
  return {
    obtener: deps.obtener || cotStore.obtener,
    actualizarDatos: deps.actualizarDatos || cotStore.actualizarDatos,
    actualizarQuoteOperam: deps.actualizarQuoteOperam || actualizarQuoteOperam,
    sacarDeLaColaPostFix: deps.sacarDeLaColaPostFix || sacarDeLaColaPostFix,
    ahora: deps.ahora || (() => new Date()),
    listaDelQuote: deps.listaDelQuote,
    transportistaDelQuote: deps.transportistaDelQuote,
  };
}

// --- Candado por id de cotizacion -------------------------------------------
// F3 de la revision de #83: la idempotencia de la subida cubre reintentos
// SECUENCIALES, no concurrencia -- dos requests EN VUELO al mismo id
// (auto-subida + Reintentar del Historial, o doble click en Elegir candidato)
// leerian ambos customerId null y crearian DOS clientes genericos; una subida y
// una actualizacion en vuelo se pisarian el carrito de FA. Instancia unica en
// Render (plan Starter): un Set basta -- con varias instancias haria falta un lock
// compartido (Neon). Ocupado NO espera: devuelve OCUPADO al instante y cada ruta
// responde su 425 con su texto.
//
// NO es reentrante: tomarlo otra vez para el mismo id dentro de la misma
// operacion (p. ej. crear que llama a actualizar) devuelve OCUPADO. Quien ya lo
// tiene llama a la parte sin candado.
//
// Quien llama compara por IDENTIDAD (`r === OCUPADO`): lo que devuelva `fn` nunca
// se confunde con el centinela, aunque traiga un campo `tipo`.
export const OCUPADO = Object.freeze({ tipo: 'ocupado' });

const subidasEnCurso = new Set();

export async function conCandadoSubida(id, fn) {
  if (subidasEnCurso.has(id)) return OCUPADO;
  subidasEnCurso.add(id);
  try {
    return await fn();
  } finally {
    subidasEnCurso.delete(id);
  }
}

// --- Pasos del encabezado ---------------------------------------------------
// Los pasos de la lista (#403) y del transportista (#448) del encabezado: UN solo
// constructor (`pasoEncabezadoQuote`, lib/postfix-encabezado-quote.js) con los textos
// de cada fila. `t` es el mapeo de la linea (transportistaDelQuote): cuando no habia
// transportista que mandar, el motivo util es el del mapeo -- sin envio, envio manual,
// linea sin id --, no el "no hay nada que escribir" de la web.
export function pasoListaQuote(folio, lista) {
  return pasoEncabezadoQuote(filaEncabezado('lista'), folio, lista);
}

export function pasoTransportistaQuote(folio, r, t) {
  return pasoEncabezadoQuote(filaEncabezado('transportista'), folio, r, t);
}

// El almacen del que se entrega, cuando el domicilio nuevo lo movio (#409). NO es un
// error del cotizador ni de la subida: FA lo deriva del `default_location` del
// DOMICILIO, asi que un domicilio mal configurado en Operam arrastra el almacen sin
// que nadie lo pida -- y el pedido que se derive lo hereda. Por eso sale como `warn`
// accionable y nombra el almacen (el vendedor reconoce "Almacen MP", no un loc_code).
// Sin cambio no se pinta ningun paso: un aviso que aparece siempre deja de leerse.
export function pasoAlmacenQuote(folio, almacen) {
  if (!almacen || !almacen.cambio) return null;
  return {
    name: 'almacen de entrega',
    status: 'warn',
    mensaje: `El domicilio elegido cambio el almacen de entrega a "${almacen.a}". Si no es el correcto, el domicilio esta mal configurado en Operam.`,
    detalle: 'quote ' + folio + ': el almacen paso de ' + almacen.de + ' a ' + almacen.a +
      ' porque Operam lo toma del domicilio (default_location del branch)',
  };
}

// --- Actualizar -------------------------------------------------------------
// Reescribe el quote ya registrado conservando el folio (#104, ADR-0008). El
// REGISTRO del cotizador ya lo actualizo la generacion del documento
// (crearOActualizarCotizacion honra cotizacionId): aqui solo se reescribe el quote
// en Operam, que no tiene PUT en la API v3 (501) y solo se puede editar por la web
// legacy.
//
// Si la edicion falla, el registro del cotizador NO se revierte -- es la fuente del
// PDF/HTML que el cliente ya tiene -- y la cotizacion queda marcada con
// data.quoteDesactualizado para que el historial ofrezca reintentar (analogo al
// estado PRE de la subida), incluido si se alcanzo a escribir (`escrito`).
export async function actualizarQuote(id, deps = {}) {
  const x = resolverDeps(deps);
  return conCandadoSubida(id, () => actualizarSinCandado(id, x));
}

async function actualizarSinCandado(id, x) {
  const entry = await x.obtener(id);
  if (!entry) return { tipo: 'no-encontrada' };
  // El gate es el MISMO que decide los botones en el historial, pero la autoridad
  // esta aqui: la UI no es la que permite escribir en el ERP.
  const gate = puedeActualizarCotizacion({
    hasData: !!entry.data,
    folioOperam: entry.folioOperam,
    orderOperam: entry.data?.orderOperam ?? null,
    espejoOperam: entry.data?.espejoOperam ?? null,
  });
  if (!gate.puede) return { tipo: 'bloqueo', motivo: 'no-actualizable', mensaje: gate.motivo };

  const folio = entry.folioOperam;
  // El transportista de la linea de envio viaja en el mismo ProcessOrder (#448).
  const transportista = x.transportistaDelQuote(entry);
  const r = await x.actualizarQuoteOperam(folio, entry.data, { lista: x.listaDelQuote(entry), transportista: transportista.shipVia });
  const pasosEncabezado = [
    pasoListaQuote(folio, r.lista),
    pasoTransportistaQuote(folio, r.transportista, transportista),
    pasoAlmacenQuote(folio, r.almacen),
  ].filter(Boolean);

  if (r.ok) {
    // Nueva huella (#114): el quote acaba de quedar con ESTE contenido, asi que
    // regenerar el mismo carrito (otro formato) ya no debe reescribir nada.
    const opcionesHuella = { listaId: x.listaDelQuote(entry), shipVia: x.transportistaDelQuote(entry).shipVia };
    await x.actualizarDatos(id, { quoteDesactualizado: null, huellaQuote: huellaContenidoQuote(entry.data, opcionesHuella) });
    // Lo encolado antes (#380) traeria lista/transportista/vigencia VIEJOS.
    await x.sacarDeLaColaPostFix(folio);
    return { tipo: 'actualizada', folio, pasos: [{ name: 'actualizar quote', status: 'ok' }, ...pasosEncabezado] };
  }

  const escrito = !!r.escrito;
  const verificado = !!r.verificado;
  const error = r.error ?? null;
  const discrepancias = r.discrepancias ?? [];
  await x.actualizarDatos(id, { quoteDesactualizado: { fecha: x.ahora().toISOString(), escrito, error, discrepancias } });
  return {
    tipo: 'no-actualizada', folio, escrito, verificado, error, discrepancias,
    pasos: [{ name: 'actualizar quote', status: 'error', error, discrepancias }, ...pasosEncabezado],
  };
}
