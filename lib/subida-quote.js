import { actualizarQuoteOperam, corregirVigenciaQuote } from './operam-web.js';
import { armarContenidoQuote, huellaContenidoQuote, vigenciaDeCotizacion, resolverClienteDeCotizacion, subirCotizacionOperam } from './operam-client.js';
import { sacarDeLaColaPostFix, encolarPostFix } from './postfix-reintento-io.js';
import { filaEncabezado, pasoEncabezadoQuote } from './postfix-encabezado-quote.js';
import { necesitaAltaGenerica, resolverSalesTypeId } from './alta-generica.js';
import { darDeAlta, MOTIVO_SIN_VENDEDOR_OPERAM } from './alta-cliente.js';
import { escribirContactoEntrega } from './contactos-operam.js';
import { fundirContactos } from './fusion-contactos.js';
import { celularesDeCruce } from './contacto-cotizacion.js';
import { ligasDeContacto, decidirLiga } from './ligas-contacto.js';
import { esErrorRateMoneda, ErrorClienteSinLista, MENSAJE_CLIENTE_SIN_LISTA } from './lista-precios-cliente.js';
import { MOTIVO_PRE_OPERAM, MOTIVO_PRE_SIN_LISTA, MOTIVO_PRE_DEDUP, MOTIVO_PRE_SIN_VENDEDOR } from './pipeline.js';
import { ErrorClienteMonedaExtranjera } from '../public/js/moneda-cliente-logica.js';
import { puedeActualizarCotizacion } from '../public/js/editar-cotizacion-logica.js';
import { bloqueoContactoEntrega } from '../public/js/contacto-entrega-logica.js';
import * as cotStore from './cotizaciones-store.js';
import * as prospectosStore from './prospectos-store.js';

// Modulo Subida del quote (#524, ADR-0022): deja la cotizacion registrada en
// Operam como quote con su folio (crear) o reescribe el quote conservando el folio
// (actualizar). Precedente: el Alta de cliente (ADR-0017) -- devuelve VALORES y
// nunca un status HTTP, no importa Express ni server.js, y recibe sus dependencias
// por `deps` con fallback a las reales. Los handlers solo traducen.
//
// A diferencia del alta, este modulo SI escribe en el registro de la cotizacion
// (huella, marca de quote desactualizado): la subida es justo eso.
//
// Crear tiene dos caminos (#525, #526): el NORMAL (el Cliente Operam ya elegido
// o resuelto por el RFC) y el del ALTA DE CLIENTE (sin Cliente Operam, o con un
// candidato o domicilio que eligio el vendedor), que pide el alta al modulo Alta
// de cliente (ADR-0017) y sube el quote sobre el cliente que este deja listo.
// Los valores que el handler responde distinto segun el camino llevan `camino`.
//
// --- Valores de subirQuote --------------------------------------------------
//   OCUPADO                                       (otra operacion en vuelo)
//   { tipo: 'no-encontrada' }
//   { tipo: 'ya-subida', folio, clienteId, preguntaContacto? }
//                                                 (con folio y sin marca; sin tocar Operam;
//                                                 con el Contacto de entrega pendiente,
//                                                 #562, vuelve a traer su pregunta)
//   { tipo: 'contacto-entrega', folio, pasos, preguntaContacto? }
//                                                 (#562: con folio, el contacto pendiente y
//                                                 `solicitud.contactoEntrega` = la decision
//                                                 del vendedor, `{ desplazar: [personId],
//                                                 pisar?: [{ personId, campo, viejo }] }`
//                                                 (#563) o `{ conservar: true }`; no sube nada)
//   Con folio Y marca quoteDesactualizado (#528), los de actualizarQuote con
//   operacion: 'actualizar':
//   { tipo: 'actualizada', operacion: 'actualizar', folio, pasos, preguntaContacto? }
//   { tipo: 'no-actualizada', operacion: 'actualizar', folio, escrito, verificado, error, discrepancias, pasos }
//   { tipo: 'bloqueo', operacion: 'actualizar', motivo: 'no-actualizable', mensaje }
//   { tipo: 'bloqueo', operacion: 'actualizar', motivo, campo, faltan, mensaje, detalle }
//                                                 (sin Contacto de entrega completo, #558)
//   { tipo: 'bloqueo', etapa: 'quote', motivo, campo, faltan, mensaje, detalle }
//     motivo: 'sin-domicilio-entrega' o 'sin-telefono-entrega' (#558): sin folio,
//     antes de decidir el camino; no toca Operam, el registro ni el motivo de PRE.
//   { tipo: 'pregunta', motivo: 'otra-razon-social', camino, contacto, ligadas, clienteId }
//   { tipo: 'pregunta', motivo: 'candidatos', mensaje, candidatos, opciones }
//                                                 (del alta; ya marco 'dedup')
//   { tipo: 'bloqueo', etapa: 'alta', motivo, mensaje, detalle, pasos, clienteId?, ... }
//                                                 (lo que el alta trajo; motivo de PRE ya marcado)
//   { tipo: 'lograda', camino: 'normal', folio, pasos }
//                                                 (folio vacio = pasos [], nada escrito)
//   { tipo: 'lograda', camino: 'alta', folio, clienteId, pasos }
//                                                 (pasos del alta y luego los del quote)
//     Con folio, los dos caminos agregan tras el post-fix el paso 'contacto de
//     entrega' (#561): el modulo Contactos en Operam escribe el Contacto de entrega
//     en el domicilio, y si falla la subida sigue lograda con ese paso de aviso. Si
//     el domicilio ya tenia General (#562), la lograda lleva ademas
//     `preguntaContacto` ({ motivo, contacto, desplazados, mensaje, detalle }) y el
//     registro la marca `data.contactoEntregaPendiente`. Con la persona elegida en el
//     selector (#563, `data.cliente.contactoEntregaPersonId`) y datos suyos que se
//     pisarian, la pregunta y la marca llevan ademas `persona` y `pisa`.
//     #565: si el modulo confirma (relectura) que el Cel de esa persona cambio, tras
//     el paso del contacto va el de 'fusion de Contactos' (lib/fusion-contactos.js),
//     tambien en `actualizada` y en `contacto-entrega`; si la fusion falla, paso `warn`.
//   { tipo: 'bloqueo', etapa: 'quote', camino, motivo, mensaje, moneda?, clienteId?, pasos? }
//     motivo: 'cliente-no-identificado', 'sin-lista-precios', 'moneda-extranjera'
//     u 'operam' (clasificarErrorQuote); en el camino del alta lleva ademas el
//     clienteId y los pasos.
//
// --- Valores de actualizarQuote ---------------------------------------------
//   OCUPADO                                       (otra operacion en vuelo)
//   { tipo: 'no-encontrada' }
//   { tipo: 'bloqueo', motivo: 'no-actualizable', mensaje }   (el gate, #104/#502)
//   { tipo: 'bloqueo', motivo, campo, faltan, mensaje, detalle }
//     motivo: 'sin-domicilio-entrega' o 'sin-telefono-entrega' (#558)
//   { tipo: 'actualizada', folio, pasos, preguntaContacto? }
//     (#563: reescrito el quote, tambien el paso 'contacto de entrega', en el Cliente
//     Operam y el domicilio que viajaron en el ProcessOrder, con la misma pregunta y
//     marca que al crear)
//   { tipo: 'no-actualizada', folio, escrito, verificado, error, discrepancias, pasos }
// Una excepcion inesperada (el store que falla) se propaga, como antes.
//
// --- Dependencias (deps = {}) -----------------------------------------------
// Cada llave se llama igual que la funcion real a la que sustituye; el
// adaptador en memoria de los tests (test/helpers/subida-quote-memoria.js)
// implementa las mismas.
//   de cotizaciones-store:  obtener, actualizarDatos, setFolioOperam
//   de prospectos-store:    buscarPorCelular, ligarCliente
//   de operam-client:       resolverClienteDeCotizacion, subirCotizacionOperam
//   de operam-web:          actualizarQuoteOperam, corregirVigenciaQuote
//   de postfix-reintento-io: sacarDeLaColaPostFix, encolarPostFix
//   de alta-cliente:        darDeAlta
//   de contactos-operam:    escribirContactoEntrega
//   de fusion-contactos:    fundirContactos (#565)
//   ahora()                 la fecha de la marca quoteDesactualizado, del motivo
//                           de PRE y de la liga del Contacto
//   listaDelQuote(entry), transportistaDelQuote(entry): OBLIGATORIAS, sin
//     fallback. Viven en server.js (la lista cuelga del catalogo que lee
//     server.js) y el handler las pasa.
//   obtenerListasPrecios(): OBLIGATORIA para subirQuote, sin fallback. Vive en
//     server.js (el catalogo de listas de Operam con su recarga perezosa, #246)
//     y el handler la pasa.
// Las funciones puras (huellaContenidoQuote, vigenciaDeCotizacion,
// necesitaAltaGenerica, resolverSalesTypeId) se importan directo: no hay nada
// que sustituir.

function exigir(deps, llaves) {
  for (const llave of llaves) {
    if (typeof deps[llave] !== 'function') {
      throw new Error(`subida-quote: falta la dependencia obligatoria ${llave}`);
    }
  }
}

function depsBase(deps) {
  return {
    obtener: deps.obtener || cotStore.obtener,
    actualizarDatos: deps.actualizarDatos || cotStore.actualizarDatos,
    setFolioOperam: deps.setFolioOperam || cotStore.setFolioOperam,
    buscarPorCelular: deps.buscarPorCelular || prospectosStore.buscarPorCelular,
    ligarCliente: deps.ligarCliente || prospectosStore.ligarCliente,
    resolverClienteDeCotizacion: deps.resolverClienteDeCotizacion || resolverClienteDeCotizacion,
    subirCotizacionOperam: deps.subirCotizacionOperam || subirCotizacionOperam,
    actualizarQuoteOperam: deps.actualizarQuoteOperam || actualizarQuoteOperam,
    corregirVigenciaQuote: deps.corregirVigenciaQuote || corregirVigenciaQuote,
    sacarDeLaColaPostFix: deps.sacarDeLaColaPostFix || sacarDeLaColaPostFix,
    encolarPostFix: deps.encolarPostFix || encolarPostFix,
    darDeAlta: deps.darDeAlta || darDeAlta,
    escribirContactoEntrega: deps.escribirContactoEntrega || escribirContactoEntrega,
    fundirContactos: deps.fundirContactos || fundirContactos,
    ahora: deps.ahora || (() => new Date()),
  };
}

function resolverDeps(deps) {
  exigir(deps, ['listaDelQuote', 'transportistaDelQuote']);
  return {
    ...depsBase(deps),
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

// Los pasos del telefono y el correo del Contacto de entrega (#556, ADR-0024), en ese
// orden: `r` es lo que devolvio la web legacy, con un resultado por campo. Uno que no
// viene (una respuesta sin el campo) no se pinta.
const CAMPOS_CONTACTO_ENTREGA = ['telefonoEntrega', 'correoEntrega'];

export function pasosContactoEntrega(folio, r) {
  return CAMPOS_CONTACTO_ENTREGA
    .map((campo) => pasoEncabezadoQuote(filaEncabezado(campo), folio, r?.[campo]))
    .filter(Boolean);
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

// Lo que la huella del quote (#114) necesita y no vive en `data`: la lista del
// encabezado (#403) y el transportista (#448). Una sola copia para crear y actualizar.
function opcionesHuella(entry, x) {
  return { listaId: x.listaDelQuote(entry), shipVia: x.transportistaDelQuote(entry).shipVia };
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
//
// La marca tiene dos formas (#528): { fecha, pendiente: true } la pone el GUARDADO
// cuando el contenido cambio y el quote todavia no se reescribe, y
// { fecha, escrito, error, discrepancias } la pone aqui la escritura fallida. Los
// lectores solo miran si hay marca.
export async function actualizarQuote(id, deps = {}) {
  const x = resolverDeps(deps);
  return conCandadoSubida(id, () => actualizarSinCandado(id, x));
}

async function actualizarSinCandado(id, x) {
  const entry = await x.obtener(id);
  if (!entry) return { tipo: 'no-encontrada' };
  return actualizarRegistro(id, entry, x);
}

// La secuencia de actualizar sobre el registro YA leido: la comparten
// actualizarQuote y la entrada unica (subirQuote con folio y marca, #528), que
// decide con esa misma lectura.
async function actualizarRegistro(id, entry, x) {
  // El gate es el MISMO que decide los botones en el historial, pero la autoridad
  // esta aqui: la UI no es la que permite escribir en el ERP.
  const gate = puedeActualizarCotizacion({
    hasData: !!entry.data,
    folioOperam: entry.folioOperam,
    orderOperam: entry.data?.orderOperam ?? null,
    espejoOperam: entry.data?.espejoOperam ?? null,
  });
  if (!gate.puede) return { tipo: 'bloqueo', motivo: 'no-actualizable', mensaje: gate.motivo };
  // #558 (ADR-0024): sin el telefono del Contacto de entrega o sin domicilio de entrega
  // no se reescribe el quote. Tampoco se toca el registro: la marca del guardado se
  // queda y la siguiente llamada, ya con el dato capturado, vuelve a actualizar.
  const entrega = bloqueoContactoEntrega(entry.data?.cliente);
  if (entrega) return { tipo: 'bloqueo', ...entrega };

  const folio = entry.folioOperam;
  // El transportista de la linea de envio viaja en el mismo ProcessOrder (#448).
  const transportista = x.transportistaDelQuote(entry);
  const r = await x.actualizarQuoteOperam(folio, entry.data, { lista: x.listaDelQuote(entry), transportista: transportista.shipVia });
  const pasosEncabezado = [
    pasoListaQuote(folio, r.lista),
    pasoTransportistaQuote(folio, r.transportista, transportista),
    ...pasosContactoEntrega(folio, r),
    pasoAlmacenQuote(folio, r.almacen),
  ].filter(Boolean);

  if (r.ok) {
    // Nueva huella (#114): el quote acaba de quedar con ESTE contenido, asi que
    // regenerar el mismo carrito (otro formato) ya no debe reescribir nada.
    const huella = huellaContenidoQuote(entry.data, opcionesHuella(entry, x));
    // #528: un guardado que llego mientras se escribia dejo el registro con OTRO
    // contenido que el quote no tiene. Se relee y la marca solo se quita si el
    // registro sigue diciendo lo que se escribio; si no, se queda (o nace la
    // pendiente) y la siguiente llamada vuelve a actualizar. Entre la relectura y
    // esta escritura queda una ventana de milisegundos, aceptada (ADR-0022).
    const actual = await x.obtener(id);
    const coincide = !actual || huellaContenidoQuote(actual.data, opcionesHuella(actual, x)) === huella;
    const marca = coincide ? null : (actual.data?.quoteDesactualizado || { fecha: x.ahora().toISOString(), pendiente: true });
    await x.actualizarDatos(id, { quoteDesactualizado: marca, huellaQuote: huella });
    // Lo encolado antes (#380) traeria lista/transportista/vigencia VIEJOS.
    await x.sacarDeLaColaPostFix(folio);
    // #563: la Subida del quote cubre crear Y actualizar (ADR-0022), asi que reescrito
    // el quote tambien se escribe el Contacto de entrega -- con la misma pregunta, marca
    // y reintento que al crear --, en el Cliente Operam y el domicilio que viajaron en el
    // ProcessOrder (el camino normal de crear no guarda el Cliente Operam del RFC). Sin
    // esto, cambiar desde el cotizador el celular de una persona al Editar no llegaba a
    // Operam. Solo con el quote reescrito: si no, el siguiente intento vuelve a pasar.
    const contacto = await contactoEntregaEnOperam(id, entry, r.customerId ?? null, r.branchId ?? null, x);
    return {
      tipo: 'actualizada', folio, pasos: [{ name: 'actualizar quote', status: 'ok' }, ...pasosEncabezado, ...contacto.pasos],
      ...conPregunta(contacto),
    };
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

// --- Motivo de PRE ----------------------------------------------------------
// UNICO punto de escritura del motivo de PRE (#204). Guarda POR QUE la cotizacion
// se quedo sin folio, porque los motivos tienen consecuencias opuestas: 'operam'
// entrega el documento igual (ADR-0009) y 'dedup' lo deja bajo candado hasta que
// el vendedor resuelva. La marca de tiempo es la que consume el barrido de 24
// horas. motivo null limpia ambos campos: se llama en cuanto hay folio, por
// cualquiera de los caminos (elegir candidato, crear nuevo, reintento exitoso).
// No es bloqueante para el vendedor: si el store fallara, el peor caso es un
// candado de mas (recuperable) o una PRE sin motivo (se comporta como antes).
// Solo necesita el store y `ahora`: no exige las dependencias obligatorias.
export async function marcarMotivoPre(id, motivo, deps = {}) {
  const x = depsBase(deps);
  try {
    await x.actualizarDatos(id, {
      motivoPre: motivo,
      motivoPreDesde: motivo ? x.ahora().toISOString() : null,
    });
  } catch (err) {
    console.error('[motivoPre] no se pudo persistir el motivo', motivo, 'en la cotizacion', id, err.message);
  }
}

// --- Errores del quote ------------------------------------------------------
// LA regla que reparte un error de la subida del quote en su desenlace: la usan
// los dos caminos de crear, por bloqueoDelQuote.
//   cliente-no-identificado (#68): problema de datos de la cotizacion, no de
//     disponibilidad de Operam.
//   sin-lista-precios (#285): dos entradas al mismo desenlace -- el corte ANTES
//     del POST (ErrorClienteSinLista) y el 406 "rate de moneda" que llegue de
//     todos modos, que no trae el nombre (el mensaje sin el sigue diciendo que
//     hacer).
//   moneda-extranjera (#297, ADR-0015): el cotizador todavia no le puede cotizar.
//   operam: lo demas, indisponibilidad de Operam.
export function clasificarErrorQuote(err) {
  const texto = err?.message;
  if (/identificar el cliente/i.test(String(texto))) return { motivo: 'cliente-no-identificado', mensaje: texto };
  if (err instanceof ErrorClienteSinLista) return { motivo: 'sin-lista-precios', mensaje: texto };
  if (esErrorRateMoneda(texto)) return { motivo: 'sin-lista-precios', mensaje: MENSAJE_CLIENTE_SIN_LISTA() };
  if (err instanceof ErrorClienteMonedaExtranjera) return { motivo: 'moneda-extranjera', mensaje: texto, moneda: err.moneda };
  return { motivo: 'operam', mensaje: 'No se pudo subir a Operam: ' + texto };
}

// El motivo de PRE de cada bloqueo del quote: el cliente sin lista y Operam caido
// lo marcan; el cliente no identificado y la moneda extranjera no (el 422 dice el
// motivo completo en cada intento, y el catalogo de motivos es del pipeline).
const MOTIVO_PRE_DE_ERROR = {
  'sin-lista-precios': MOTIVO_PRE_SIN_LISTA,
  operam: MOTIVO_PRE_OPERAM,
};

// --- Post-fix del quote -----------------------------------------------------
// Post-fix de la vigencia (#106, ADR-0007). El POST del quote ignora valid_until y deja
// el campo nativo "Valido hasta" en ord_date-1, asi que Operam marca como vencidas
// cotizaciones vivas; se corrige por la web legacy en cuanto el quote existe. NO es
// bloqueante: el quote ya esta subido y comments sigue llevando la vigencia, asi que un
// fallo aqui se reporta como step y nunca tumba la subida. La verificacion post-escritura
// (releer y comparar) sigue el mismo patron que el PUT del branch (#96) y el quirk del
// PUT de clientes, que responde 200 aunque ignore campos.
//
// Desde #403 el mismo POST lleva la LISTA DE PRECIOS del encabezado, el otro campo del
// quote que la API v3 no escribe: el quote nacia con la lista del CLIENTE aunque se
// hubiera cotizado en otra, y de ese encabezado hereda el pedido. Son dos campos
// independientes y se reportan como dos pasos -- que la lista no se pueda escribir no
// dice nada de la vigencia, ni al reves.
//
// Desde #448 lleva tambien el TRANSPORTISTA de la linea de envio elegida: el POST de
// la API v3 no lo manda y el quote heredaba el del domicilio (1 = "Default"). Es un
// tercer paso con la misma regla: se relee y, si no se confirma, avisa sin tumbar.
//
// Desde #556 lleva tambien el TELEFONO y el CORREO del Contacto de entrega, del mismo
// mapeo que el POST (`armarContenidoQuote`). El POST de la API v3 los ignora y el
// formulario web los prellena con el contacto General del cliente, asi que este
// ProcessOrder los escribe SIEMPRE explicitos, tambien vacios: nunca se deja que Operam
// los deduzca. Dos pasos mas, con la misma regla: se releen y avisan sin tumbar.
//
// Lo usan los dos caminos de crear, por el tramo comun (quoteSubido).
export async function postFixQuote(folio, entry, deps = {}) {
  return postFixResuelto(folio, entry, resolverDeps(deps));
}

async function postFixResuelto(folio, entry, x) {
  if (folio == null || folio === '') return [];
  const data = entry?.data;
  const transportista = x.transportistaDelQuote(entry);
  const { contactPhone, contactEmail } = armarContenidoQuote(data || {});
  // Lo que este post-fix debe dejar, tal cual: si no queda verificado se encola CON
  // estos valores (#380) y el reintento repite exactamente esta escritura.
  const esperado = {
    folio, cotizacionId: entry?.id ?? null, vendedor: entry?.vendedor ?? null,
    vigencia: vigenciaDeCotizacion(data), lista: x.listaDelQuote(entry), transportista: transportista.shipVia,
    telefonoEntrega: contactPhone, correoEntrega: contactEmail,
    fechaDocumento: data?.fecha ?? null,
  };
  try {
    const r = await x.corregirVigenciaQuote(folio, esperado.vigencia, {
      lista: esperado.lista, transportista: esperado.transportista,
      telefonoEntrega: esperado.telefonoEntrega, correoEntrega: esperado.correoEntrega,
    });
    // Fire-and-forget y nunca lanza: lo verificado no se encola, lo demas se reintenta
    // solo (o se avisa por correo si no tiene caso reintentar).
    x.encolarPostFix({ ...esperado, resultado: r });
    const pasos = [];
    if (r.ok) {
      pasos.push({
        name: 'post-fix vigencia', status: 'ok',
        mensaje: 'La vigencia quedo corregida en Operam',
        detalle: 'quote ' + folio + ' campo Valido hasta',
      });
    } else {
      // Rastro en Render (#380): antes solo la rama de la excepcion escribia en los logs,
      // y un warn como el del 1263 no dejaba nada que buscar.
      console.error('[post-fix vigencia] sin verificar en el quote', folio, '- se esperaba', r.esperado ?? '(sin dato)', 'y se leyo', r.encontrado ?? '(sin dato)');
      // verificado false = la vista no traia el campo, asi que no se sabe como quedo; se
      // reporta distinto de "quedo con otra fecha" para no afirmar lo que no se comprobo.
      pasos.push({
        name: 'post-fix vigencia', status: 'warn',
        mensaje: 'Revisa la vigencia de la cotizacion en Operam: pudo no quedar corregida',
        detalle: 'quote ' + folio + ': se esperaba ' + (r.esperado ?? '(sin dato)') + ' y se leyo ' + (r.encontrado ?? '(sin dato)'),
        verificado: r.verificado, esperado: r.esperado, encontrado: r.encontrado,
      });
    }
    const pasoLista = pasoListaQuote(folio, r.lista);
    if (pasoLista) pasos.push(pasoLista);
    const pasoTransportista = pasoTransportistaQuote(folio, r.transportista, transportista);
    if (pasoTransportista) pasos.push(pasoTransportista);
    pasos.push(...pasosContactoEntrega(folio, r));
    return pasos;
  } catch (err) {
    console.error('[post-fix vigencia] fallo en el quote', folio, err.message);
    x.encolarPostFix({ ...esperado, error: err.message });
    // El post-fix no llego a escribir NADA, asi que la lista y el transportista
    // tampoco: cada uno se nombra con su motivo real en vez de callarlo -- desde #403 el
    // vendedor espera un paso por campo, y el silencio se leeria como "si quedo". Los
    // que no tenian valor que mandar no se pintan. El telefono y el correo del Contacto
    // de entrega (#556) siempre tienen valor -- el vacio tambien se escribe --, asi que
    // siempre se pintan.
    const noEnviado = (esperadoCampo) => ({
      aplica: true, esperado: String(esperadoCampo), escrita: false, yaCorrecto: false,
      ok: false, verificado: false, encontrado: null,
      motivo: 'el post-fix fallo antes de escribir: ' + err.message,
    });
    return [{
      name: 'post-fix vigencia', status: 'error',
      mensaje: 'No se pudo corregir la vigencia de la cotizacion en Operam',
      detalle: 'quote ' + folio + ': ' + err.message,
    }, ...(esperado.lista == null ? [] : [pasoListaQuote(folio, noEnviado(esperado.lista))]),
    ...(esperado.transportista == null ? [] : [pasoTransportistaQuote(folio, noEnviado(esperado.transportista), transportista)]),
    ...pasosContactoEntrega(folio, Object.fromEntries(CAMPOS_CONTACTO_ENTREGA.map((campo) => [campo, noEnviado(esperado[campo])]))),];
  }
}

// --- Crear ------------------------------------------------------------------
// `solicitud` es lo que contesto el vendedor en el body: customerIdElegido y
// sucursalDe (eligio un candidato del dedup, o "es otro domicilio de este
// cliente"), crearNuevo ("ninguno es el mismo") y otraRazonSocial (confirmo la
// pregunta de #345). Los dos primeros deciden el camino.
export async function subirQuote(id, solicitud = {}, deps = {}) {
  exigir(deps, ['obtenerListasPrecios']);
  const x = { ...resolverDeps(deps), obtenerListasPrecios: deps.obtenerListasPrecios };
  return conCandadoSubida(id, () => subirSinCandado(id, solicitud, x));
}

async function subirSinCandado(id, solicitud, x) {
  const entry = await x.obtener(id);
  if (!entry) return { tipo: 'no-encontrada' };
  // Ya subida (#83, F1c): los quotes de Operam no se editan por API -- re-subir
  // duplicaria el quote. Se devuelve el folio existente sin tocar Operam.
  // Desde #114 este corte significa UNA sola cosa: el contenido no cambio (regenerar
  // el mismo carrito en otro formato). Una regeneracion CON cambios ya no llega
  // aqui: POST /api/cotizacion devuelve requiereActualizacionOperam y la generacion
  // entra por /actualizar (#104, ADR-0008). Va ANTES de decidir el camino: una
  // cotizacion con folio nunca llega al alta de cliente. El clienteId es el eco del
  // customer_id ya ligado (#167 causa 3): sin el, regenerar no refresca el chip Fiscal.
  //
  // Desde #528 esta es la entrada unica: con folio decide la MARCA que dejo el
  // guardado (data.quoteDesactualizado, pendiente o de fallo). Con marca se
  // actualiza aqui mismo, dentro del candado ya tomado (no es reentrante: nunca
  // actualizarQuote desde aqui) y con esta misma lectura.
  if (entry.folioOperam != null && entry.folioOperam !== '' && entry.data?.quoteDesactualizado) {
    return { ...(await actualizarRegistro(id, entry, x)), operacion: 'actualizar' };
  }
  if (entry.folioOperam != null && entry.folioOperam !== '') {
    // #562: con el Contacto de entrega pendiente, la respuesta del vendedor se atiende
    // aqui (sin volver a subir nada) y, sin ella, ya-subida vuelve a traer la pregunta.
    const marca = entry.data?.contactoEntregaPendiente;
    const decision = decisionContactoEntrega(solicitud.contactoEntrega);
    if (marca && decision) return atenderContactoPendiente(id, entry, marca, decision, x);
    return {
      tipo: 'ya-subida', folio: entry.folioOperam, clienteId: entry.data?.cliente?.customerId ?? null,
      ...(marca ? { preguntaContacto: preguntaDeLaMarca(marca) } : {}),
    };
  }
  // #558 (ADR-0024): sin el telefono del Contacto de entrega o sin domicilio de entrega
  // no se crea nada en Operam -- ni el quote ni, por el camino del alta, el Cliente
  // Operam --, asi que va ANTES de decidir el camino. Despues de "ya subida": regenerar
  // lo que no cambio no escribe nada. No marca motivo de PRE: el bloqueo dice el motivo
  // completo en cada intento, como la moneda extranjera.
  const entrega = bloqueoContactoEntrega(entry.data?.cliente);
  if (entrega) return { tipo: 'bloqueo', etapa: 'quote', ...entrega };
  // Alta temprana de cliente generico (#81, ADR-0006): sin cliente en Operam se crea
  // uno con RFC generico; un candidato o un domicilio elegido por el vendedor
  // tambien pasan por el alta.
  if (solicitud.customerIdElegido != null || solicitud.sucursalDe != null || necesitaAltaGenerica(entry)) {
    return subirCaminoAlta(id, entry, solicitud, x);
  }
  return subirCaminoNormal(id, entry, solicitud, x);
}

// --- Tramo comun de los dos caminos -----------------------------------------
// Hay folio: la cotizacion deja de ser pre-cotizacion (#63). El ORDEN es parte de
// la regla: folio, huella y motivo null quedan guardados antes del post-fix.
// `antesDelPostFix` corre despues de guardar (o de no tener nada que guardar, sin
// folio) y antes del post-fix: el camino del alta anota ahi su paso del POST.
// Devuelve los pasos del post-fix.
//
// La huella (#114) es lo unico que cambia entre los dos caminos, y por eso entra
// como `dataHuella`:
//   - camino normal: `entry.data`. La cotizacion NO guarda el Cliente Operam que
//     salio del RFC, asi que la siguiente regeneracion tampoco lo trae.
//   - camino del alta: los datos CON el cliente recien ligado (customerId /
//     branchId). Ese cliente si quedo anotado en el registro y la siguiente
//     regeneracion lo trae (crearOActualizarCotizacion lo copia del registro):
//     calcularla sobre entry.data haria que toda regeneracion pareciera un cambio.
// Sin huella la proxima regeneracion no puede saber si el contenido cambio, que
// es lo que decide si hay que reescribir el quote o dejarlo en paz.
async function quoteSubido(id, entry, folio, dataHuella, x, antesDelPostFix = () => {}) {
  if (folio != null && folio !== '') {
    await x.setFolioOperam(id, folio);
    await x.actualizarDatos(id, { huellaQuote: huellaContenidoQuote(dataHuella, opcionesHuella(entry, x)) });
    // Hay folio: se resolvio por el camino que sea (candidato elegido, cliente
    // nuevo forzado o reintento) y el candado se levanta (#204).
    await marcarMotivoPre(id, null, x);
  }
  antesDelPostFix();
  return postFixResuelto(folio, entry, x);
}

// Un error de la etapa del quote -> el valor `bloqueo`, con el motivo de PRE ya
// marcado ANTES de devolver: el candado de los GET aplica de inmediato.
//
// En el camino del alta el "no se pudo identificar el cliente" NO tiene trato
// propio: el quote va sobre el cliente recien ligado, y ese error ahi se trata
// como cualquier falla de Operam (503 y motivo 'operam').
async function bloqueoDelQuote(id, err, camino, x, extra = {}) {
  let bloqueo = clasificarErrorQuote(err);
  if (camino === 'alta' && bloqueo.motivo === 'cliente-no-identificado') {
    bloqueo = { motivo: 'operam', mensaje: 'No se pudo subir a Operam: ' + err?.message };
  }
  const motivoPre = MOTIVO_PRE_DE_ERROR[bloqueo.motivo];
  if (motivoPre) await marcarMotivoPre(id, motivoPre, x);
  return { tipo: 'bloqueo', etapa: 'quote', camino, ...bloqueo, ...extra };
}

// Camino normal: el Cliente Operam ya lo eligio el vendedor en el paso Cliente
// ("Ya lo conozco") o sale del RFC. Aqui tambien nace una liga Contacto -> Cliente
// Operam (#345): sin ella, cotizarle al restaurante desde el celular propio de la
// compradora dejaba al Contacto sin ningun Cliente Operam, y la unica forma de
// ligarlo era dar de alta uno sin datos fiscales que duplicaba al que ya existia.
// Con el Contacto ya ligado a OTRO Cliente Operam se pregunta, exactamente igual
// que en el alta generica.
async function subirCaminoNormal(id, entry, { otraRazonSocial = false }, x) {
  // Fuera del try: un fallo del store de prospectos se propaga, no es Operam caido.
  const contacto = await contactoDeLaSubida(entry, x);
  const ligadas = ligasDeContacto(contacto?.data);
  try {
    // Sin customerId en la cotizacion el Cliente Operam sale del RFC (#460). Se
    // resuelve AQUI, antes del POST, y no dentro de la subida: la pregunta tiene que
    // llegar sin quote escrito ("sin confirmar no se sube nada"), asi que un
    // reintento tras la pregunta no encuentra nada que duplicar.
    const resuelto = await x.resolverClienteDeCotizacion(entry.data);
    const decisionLiga = decidirLiga(ligadas, resuelto.customerId, { confirmado: otraRazonSocial });
    if (decisionLiga.accion === 'confirmar') {
      return { tipo: 'pregunta', motivo: 'otra-razon-social', camino: 'normal', contacto, ligadas, clienteId: resuelto.customerId };
    }
    // La subida recibe el cliente ya resuelto para no volver a buscar el RFC. La
    // huella de abajo sigue saliendo de entry.data: la cotizacion no guarda este id.
    const dataSubida = { ...entry.data, cliente: { ...entry.data.cliente, customerId: resuelto.customerId, branchId: resuelto.branchId } };
    const { folio, customerId, branchId } = await x.subirCotizacionOperam(dataSubida);
    const pasosPostFix = await quoteSubido(id, entry, folio, entry.data, x);
    const contactoEntrega = folio != null && folio !== '' ? await contactoEntregaEnOperam(id, entry, customerId, branchId, x, folio) : { pasos: [] };
    // La liga solo se anota cuando el quote ya existe: sin folio no hubo venta que
    // ligar, y el reintento vuelve a pasar por aqui. Va con el Cliente Operam que
    // DEVOLVIO la subida.
    const pasosLiga = [];
    if (folio != null && folio !== '' && contacto && decisionLiga.accion === 'agregar') {
      pasosLiga.push(await agregarLigaAlContacto(contacto, customerId, entry, x));
    }
    return { tipo: 'lograda', camino: 'normal', folio, pasos: [...pasosPostFix, ...contactoEntrega.pasos, ...pasosLiga], ...conPregunta(contactoEntrega) };
  } catch (err) {
    return bloqueoDelQuote(id, err, 'normal', x);
  }
}

// Camino del alta de cliente (#81, ADR-0006): primero el alta del Cliente Operam
// sin datos fiscales, que hace el modulo Alta de cliente y devuelve valores, y
// luego el quote sobre lo que devolvio. Las escrituras en la cotizacion son de la
// subida, no del alta (ADR-0017).
//
// Dedup en capas ANTES de crear (las hace el alta): el celular contra los
// Contactos (un Contacto ya ligado reutiliza su Cliente Operam) y el nombre contra
// los genericos de Operam (ADR-0001): con parecidos se DETIENE con la pregunta de
// candidatos y el vendedor resuelve reintentando con un candidato elegido,
// "es otro domicilio de este cliente" o, desde #204, "ninguno es el mismo"
// (`crearNuevo`, que solo salta la parada por nombre; ver la nota de ADR-0001).
//
// El Contacto y el alta van FUERA del try: si lanzan, la excepcion se propaga
// sin marcar motivo ni volverse bloqueo. El try cubre solo la etapa del quote.
async function subirCaminoAlta(id, entry, solicitud, x) {
  const { customerIdElegido = null, sucursalDe = null, crearNuevo = false, otraRazonSocial = false } = solicitud;
  const c = entry.data?.cliente || {};
  const prospecto = await contactoDeLaSubida(entry, x);
  const decision = decisionDeLaSubida(customerIdElegido, crearNuevo, sucursalDe);
  const alta = await x.darDeAlta(solicitudDeAlta(entry, {
    prospecto, decision, otraRazonSocial,
    salesTypeId: resolverSalesTypeId(entry.tier, await x.obtenerListasPrecios()),
  }));

  // Idempotencia del reintento (ADR-0017): en cuanto el alta deja un Cliente Operam se
  // anota en la cotizacion ANTES de seguir, aunque el desenlace sea un bloqueo -- si
  // no, el reintento entraria sin id persistido y crearia un SEGUNDO cliente. La
  // pregunta queda fuera a proposito: ahi no se creo ni se escribio nada y el vendedor
  // todavia puede elegir otro cliente.
  // #566: con el person_id de la persona que el alta dejo como Contacto de entrega,
  // Editar y la actualizacion del quote editan a ESA persona (#563).
  if (alta.tipo !== 'pregunta' && alta.clienteId != null) {
    const personaDelAlta = alta.contactoEntrega?.escrito ? { contactoEntregaPersonId: alta.contactoEntrega.personId } : {};
    await x.actualizarDatos(id, { cliente: { ...c, customerId: alta.clienteId, branchId: alta.domicilioId ?? null, ...personaDelAlta } });
    alta.pasos.push({
      name: 'persistir customer_id', status: 'ok',
      mensaje: 'La cotizacion quedo ligada a este Cliente Operam',
      detalle: `cotizacion ${id} -> cliente ${alta.clienteId}, branch ${alta.domicilioId ?? '(sin resolver)'}`,
    });
  }

  if (alta.tipo === 'pregunta') {
    if (alta.motivo === 'otra-razon-social') {
      return { tipo: 'pregunta', motivo: 'otra-razon-social', camino: 'alta', contacto: alta.contacto, ligadas: alta.ligadas, clienteId: alta.clienteId };
    }
    // Sin resolver no hay documento (#204): el motivo se marca ANTES de devolver para
    // que el candado de los GET aplique de inmediato. Las salidas las manda el ALTA
    // (#377): con un candidato del mismo RFC real no viene "ninguno es el mismo".
    await marcarMotivoPre(id, MOTIVO_PRE_DEDUP, x);
    return { tipo: 'pregunta', motivo: alta.motivo, mensaje: alta.mensaje, candidatos: alta.candidatos, opciones: alta.opciones };
  }
  if (alta.tipo === 'bloqueo') {
    const motivoPre = alta.motivo in MOTIVO_PRE_DE_BLOQUEO ? MOTIVO_PRE_DE_BLOQUEO[alta.motivo] : MOTIVO_PRE_OPERAM;
    if (motivoPre) await marcarMotivoPre(id, motivoPre, x);
    const { tipo, segmentoDiferido, ...bloqueo } = alta;
    return { tipo: 'bloqueo', etapa: 'alta', ...bloqueo };
  }

  const { clienteId, domicilioId, creadoNuevo, pasos } = alta;
  try {
    const dataSubida = { ...entry.data, cliente: { ...c, customerId: clienteId, branchId: domicilioId } };
    // El cliente que ACABA de crear esta alta nace con la lista de su tier
    // (buildClienteGenerico): releerlo solo para comprobarlo seria una lectura de
    // mas dentro del camino critico de la subida (#285). El cliente reusado o
    // elegido si se checa: puede llevar anos sin lista.
    const { folio } = await x.subirCotizacionOperam(dataSubida, { verificarListaPrecios: !creadoNuevo });
    pasos.push(...await quoteSubido(id, entry, folio, dataSubida, x, () => pasos.push({
      name: 'POST quote', status: 'ok',
      mensaje: folio ? 'La cotizacion quedo registrada en Operam' : 'La cotizacion se envio a Operam pero volvio sin numero',
      detalle: 'POST quote -> folio ' + (folio == null || folio === '' ? '(ninguno)' : folio),
    })));
    // #566: el alta que creo al Cliente Operam ya dejo a su persona como el Contacto de
    // entrega (lo dice `alta.contactoEntrega`, logrado o no) y su paso ya esta en el
    // reporte. Escribirlo otra vez veria a esa persona como el General del domicilio y
    // le preguntaria al vendedor por desplazarla.
    const contactoEntrega = folio != null && folio !== '' && !alta.contactoEntrega
      ? await contactoEntregaEnOperam(id, entry, clienteId, domicilioId, x, folio)
      : { pasos: [] };
    pasos.push(...contactoEntrega.pasos);
    return { tipo: 'lograda', camino: 'alta', folio, clienteId, pasos, ...conPregunta(contactoEntrega) };
  } catch (err) {
    pasos.push({
      name: 'POST quote', status: 'error',
      mensaje: 'La cotizacion no se pudo registrar en Operam',
      detalle: 'POST quote: ' + err.message,
    });
    // El cliente EXISTENTE que el vendedor eligio (o al que se le colgo el
    // domicilio) puede estar sin lista (#285) o cotizar en otra moneda (#297); el
    // recien creado por esta misma alta nace con la lista de su tier y en MXN.
    // Con await: el finally (el segmento) corre DESPUES de guardar el motivo de PRE.
    return await bloqueoDelQuote(id, err, 'alta', x, { clienteId, pasos });
  } finally {
    // La escritura diferida del segmento (#365) se dispara al FINAL, suba el quote o
    // no: el cliente ya existe y un reintento no vuelve a pasar por el alta. Antes
    // del POST del quote se encolaria en la sesion web delante del post-fix de la
    // vigencia, que si se espera. Solo la trae el alta lograda.
    alta.segmentoDiferido?.();
  }
}

// De lo que el vendedor contesto a la decision de dedup que entiende el alta
// (GLOSSARY.md "Solicitud de alta"). Con varios a la vez manda el elegido:
// reutilizar tal cual es el desenlace mas conservador (no escribe nada nuevo).
function decisionDeLaSubida(customerIdElegido, crearNuevo, sucursalDe) {
  if (customerIdElegido != null) return { tipo: 'usar', clienteId: customerIdElegido };
  if (sucursalDe != null) return { tipo: 'otro-domicilio', clienteId: sucursalDe };
  if (crearNuevo) return { tipo: 'ninguno' };
  return null;
}

// La Solicitud de alta armada desde la cotizacion: TODA la traduccion que hace la
// subida hacia el modulo Alta de cliente (ADR-0017). Sin datos fiscales, porque
// este camino siempre da de alta un Cliente Operam sin ellos (ADR-0006), y con el
// segmento en 'diferido' -- la latencia de la subida manda, asi que el alta no
// dispara su escritura: la devuelve como segmentoDiferido y su fallo queda como
// segmento pendiente (#365), que el administrador ve en /admin.
//
// salesTypeId viaja RESUELTO: el catalogo de listas de precios ya vive cacheado en
// server.js (obtenerListasPrecios, con la recarga perezosa de #246) y pasarselo le
// ahorra al alta una lectura a Operam dentro del camino critico del vendedor.
function solicitudDeAlta(entry, { prospecto, decision, otraRazonSocial, salesTypeId }) {
  const c = entry.data?.cliente || {};
  return {
    contacto: {
      celular: c.telefono || '',
      prospecto,
      ligas: ligasDeContacto(prospecto?.data),
      otraRazonSocialConfirmada: !!otraRazonSocial,
    },
    identidad: {
      razonSocial: c.razonSocial || '',
      nombreCorto: c.nombreCorto || '',
      nombreVisible: entry.cliente || '',
      rfc: c.rfc || '',
      pais: c.pais || 'MX',
    },
    datosFiscales: null,
    comercial: {
      vendedor: entry.vendedor,
      tier: entry.tier,
      salesTypeId,
      segmentoId: c.segmentoId,
      correoFacturacion: c.emailFactura || '',
      usoCfdi: c.usoCfdi,
    },
    contactoEntrega: { nombre: c.nombreEntrega || '', telefono: c.celEntrega || '', correo: c.emailEntrega || '' },
    domicilioEntrega: {
      nombre: c.nombreEntrega || '',
      calle: c.calle || '',
      numInt: c.numInt || '',
      colonia: c.colonia || '',
      municipio: c.municipio || '',
      estado: c.estado || '',
      cp: c.cpEntrega || '',
      referencias: c.referencias || '',
      telefono: c.celEntrega || '',
      correo: c.emailEntrega || '',
    },
    ligaFija: { clienteId: c.customerId ?? null, domicilioId: c.branchId ?? c.branch_id ?? null },
    decision,
    segmento: { preferencia: 'diferido' },
  };
}

// El motivo de PRE que le toca a cada bloqueo del alta (#204): 'dedup' deja el
// documento bajo candado hasta que el vendedor resuelva, y los demas lo entregan
// igual (ADR-0009). Un motivo fuera de la tabla cae a 'operam'. La liga fija de la
// cotizacion no marca motivo: no es una PRE por falta de resolucion sino una
// cotizacion que ya pertenece a otro cliente.
const MOTIVO_PRE_DE_BLOQUEO = {
  'liga-fija': null,
  // El mismo RFC real de otro Cliente Operam (#377) es un duplicado que el vendedor
  // tiene que resolver, igual que los candidatos: el documento queda bajo candado.
  fusion: MOTIVO_PRE_DEDUP,
  'sin-lista-precios': MOTIVO_PRE_SIN_LISTA,
  // El vendedor sin ID de Operam (#466): mismo trato que el cliente sin lista -- el
  // documento sale igual y el arreglo lo hace un administrador en /admin.
  [MOTIVO_SIN_VENDEDOR_OPERAM]: MOTIVO_PRE_SIN_VENDEDOR,
};

// El Contacto de la cotizacion (#345, ADR-0016): el celular ANOTADO al nacer (#342)
// manda, y solo si la cotizacion es anterior a ese campo se cae a lo tecleado. Asi
// corregir un telefono despues no cambia de quien es la Oportunidad ni a quien se le
// liga el Cliente Operam. Lo comparten los dos caminos de crear.
async function contactoDeLaSubida(entry, x) {
  const { buscarPorCelular } = x;
  for (const celular of celularesDeCruce(entry)) {
    const p = await buscarPorCelular(celular);
    if (p) return p;
  }
  return null;
}

// El Contacto de entrega queda en Operam como contacto del domicilio de entrega
// (#561, ADR-0024 regla 4): lo escribe el modulo Contactos en Operam DESPUES del
// quote, sobre el Cliente Operam y el domicilio a los que se subio, y su paso entra al
// reporte. El quote ya tiene el encabezado correcto, asi que cualquier falla de este
// paso deja la subida lograda con aviso; el modulo devuelve sus propios desenlaces y
// solo una excepcion inesperada se traduce aqui.
//
// #562: si el domicilio ya tiene un General, el modulo no escribe y devuelve la
// pregunta al vendedor. El quote ya existe, asi que la subida sigue LOGRADA y lleva la
// pregunta junto al folio (`preguntaContacto`), y el registro guarda la marca
// `data.contactoEntregaPendiente` con lo que se pregunto y DONDE: es lo que hace cierto
// "el contacto queda pendiente" y por donde entra el reintento con la decision.
// Devuelve `{ pasos, pregunta? }`.
async function contactoEntregaEnOperam(id, entry, clienteId, domicilioId, x, folio = entry.folioOperam) {
  try {
    const r = await x.escribirContactoEntrega({ clienteId, domicilioId, contacto: contactoDeEntrega(entry) });
    if (r?.tipo === 'pregunta') {
      const marca = marcaContactoPendiente(r, contactoDeEntrega(entry).nombre, clienteId, domicilioId, x);
      await x.actualizarDatos(id, { contactoEntregaPendiente: marca });
      return { pasos: r.pasos || [], pregunta: preguntaDeLaMarca(marca) };
    }
    // Al actualizar (#563) puede quedar la marca de una pregunta anterior: escrito u
    // omitido por otra razon, ya no hay nada pendiente. Si la web legacy fallo, se queda.
    if (r?.tipo === 'lograda' && entry.data?.contactoEntregaPendiente) {
      await x.actualizarDatos(id, { contactoEntregaPendiente: null });
    }
    return { pasos: [...(r?.pasos || []), ...await fusionTrasCambioDeCel(r, id, folio, entry, x)] };
  } catch (err) {
    console.error('[contacto de entrega] fallo al escribirlo en Operam, cotizacion', entry.id, err.message);
    return {
      pasos: [{
        name: 'contacto de entrega', status: 'warn',
        mensaje: 'La cotizacion quedo registrada, pero no se pudo escribir el Contacto de entrega en Operam: revisalo ahi.',
        detalle: `cliente ${clienteId}, domicilio ${domicilioId ?? '(sin domicilio)'}: ${err.message}`,
      }],
    };
  }
}

// El Contacto de entrega de la cotizacion, con el person_id de la persona que el
// vendedor eligio en el selector cuando la hay (#563): con el, el modulo edita a ESA
// persona del domicilio en vez de reconocerla por su numero o su nombre.
function contactoDeEntrega(entry) {
  const c = entry.data?.cliente || {};
  const personId = c.contactoEntregaPersonId == null ? '' : String(c.contactoEntregaPersonId).trim();
  return { nombre: c.nombreEntrega || '', telefono: c.celEntrega || '', correo: c.emailEntrega || '', ...(personId ? { personId } : {}) };
}

// La marca guarda la pregunta tal cual y donde se hizo: el reintento escribe en ESE
// Cliente Operam y domicilio (el camino normal no persiste el Cliente Operam que salio
// del RFC) y la pregunta se vuelve a servir sin leer Operam.
function marcaContactoPendiente(pregunta, nombre, clienteId, domicilioId, x) {
  return {
    fecha: x.ahora().toISOString(), clienteId, domicilioId, motivo: pregunta.motivo,
    contacto: { nombre },
    desplazados: pregunta.desplazados, ...detallePisa(pregunta), mensaje: pregunta.mensaje, detalle: pregunta.detalle,
  };
}

// #563: la persona elegida y las casillas que se pisarian (con su valor viejo y el
// nuevo) viajan en la marca y en la pregunta solo cuando las hay; la pregunta del
// General de #562 conserva su forma.
const detallePisa = (p) => ({
  ...(p.persona ? { persona: p.persona } : {}),
  ...(p.pisa?.length ? { pisa: p.pisa } : {}),
});

function preguntaDeLaMarca(marca) {
  return { motivo: marca.motivo, contacto: marca.contacto, desplazados: marca.desplazados, ...detallePisa(marca), mensaje: marca.mensaje, detalle: marca.detalle };
}

const conPregunta = (contactoEntrega) => (contactoEntrega.pregunta ? { preguntaContacto: contactoEntrega.pregunta } : {});

// La respuesta del vendedor a la pregunta del General (#562), como la dicta el servidor
// en `reintentar`: `{ desplazar: [personId...] }` (si, que deje de ser General) o
// `{ conservar: true }` (no, se queda). Cualquier otra cosa no es una decision.
// #563: la confirmacion lleva ademas `pisar`, las casillas de la persona elegida con
// el valor viejo que vio el vendedor (`[{ personId, campo, viejo }]`), para que el
// modulo revalide contra lo que hay ahora en Operam.
const CASILLAS_PISABLES = ['cel', 'telefono', 'secundario', 'correo'];
const esId = (v) => (typeof v === 'string' || typeof v === 'number') && String(v).trim() !== '';

function decisionContactoEntrega(cuerpo) {
  if (cuerpo?.conservar === true) return { conservar: true };
  const ids = cuerpo?.desplazar ?? [];
  const pisar = cuerpo?.pisar ?? [];
  if (!Array.isArray(ids) || !Array.isArray(pisar) || !(ids.length + pisar.length)) return null;
  if (!ids.every(esId)) return null;
  if (!pisar.every((p) => esId(p?.personId) && CASILLAS_PISABLES.includes(p.campo) && typeof p.viejo === 'string')) return null;
  return {
    desplazar: ids.map(String),
    ...(pisar.length ? { pisar: pisar.map((p) => ({ personId: String(p.personId), campo: p.campo, viejo: p.viejo })) } : {}),
  };
}

// El reintento con la decision, sobre el Cliente Operam y el domicilio de la marca. El
// modulo revalida (si el General cambio vuelve a preguntar y la marca se reemplaza); si
// la web legacy falla la marca se queda, para que el vendedor pueda volver a contestar;
// escrito u omitido por otra razon, la marca se va.
async function atenderContactoPendiente(id, entry, marca, decision, x) {
  const folio = entry.folioOperam;
  const donde = `domicilio ${marca.domicilioId} del cliente ${marca.clienteId}`;
  const personas = marca.desplazados || [];
  if (decision.conservar) {
    await x.actualizarDatos(id, { contactoEntregaPendiente: null });
    // #563: con casillas que se pisarian, lo que se conserva son los datos de la
    // persona elegida (y, si tambien se preguntaba, el General que ya estaba).
    const conservados = [
      ...(marca.pisa?.length ? [`${marca.persona?.nombre || 'la persona elegida'} conserva sus datos en Operam como estaban`] : []),
      ...(personas.length ? [`${personas.map((d) => d.nombre).join(' y ')} sigue como contacto General del domicilio de entrega`] : []),
    ];
    return {
      tipo: 'contacto-entrega', folio,
      pasos: [{
        name: 'contacto de entrega', status: 'omitido',
        mensaje: `El Contacto de entrega no se escribio en Operam: ${conservados.join(' y ')}, como lo decidiste.`,
        detalle: `${donde}: el vendedor conservo ` + [
          ...(marca.pisa?.length ? [`las casillas de la persona ${marca.persona?.personId} (${marca.pisa.map((p) => p.campo).join(', ')})`] : []),
          ...(personas.length ? [`al General (${personas.map((d) => `persona ${d.personId}`).join(', ')})`] : []),
        ].join(' y '),
      }],
    };
  }
  let r;
  try {
    r = await x.escribirContactoEntrega({
      clienteId: marca.clienteId, domicilioId: marca.domicilioId, contacto: contactoDeEntrega(entry),
      cotizacion: { id, folio }, decision,
    });
  } catch (err) {
    console.error('[contacto de entrega] fallo al escribirlo en Operam, cotizacion', id, err.message);
    r = {
      tipo: 'bloqueo',
      pasos: [{
        name: 'contacto de entrega', status: 'warn',
        mensaje: 'No se pudo confirmar que el Contacto de entrega quedo escrito en Operam: revisa el domicilio de entrega ahi.',
        detalle: `${donde}: ${err.message}`,
      }],
    };
  }
  if (r?.tipo === 'pregunta') {
    const nueva = marcaContactoPendiente(r, contactoDeEntrega(entry).nombre, marca.clienteId, marca.domicilioId, x);
    await x.actualizarDatos(id, { contactoEntregaPendiente: nueva });
    return { tipo: 'contacto-entrega', folio, pasos: r.pasos || [], preguntaContacto: preguntaDeLaMarca(nueva) };
  }
  if (r?.tipo === 'bloqueo') {
    return { tipo: 'contacto-entrega', folio, pasos: r.pasos || [], preguntaContacto: preguntaDeLaMarca(marca) };
  }
  await x.actualizarDatos(id, { contactoEntregaPendiente: null });
  return { tipo: 'contacto-entrega', folio, pasos: [...(r?.pasos || []), ...await fusionTrasCambioDeCel(r, id, folio, entry, x)] };
}

// #565 (enmienda a ADR-0016): el modulo Contactos en Operam confirmo, releyendo, que el
// Cel de una persona cambio. Su person_id dice que es la misma persona, asi que el
// Contacto del numero viejo se funde en el del nuevo. Solo el Cel: es donde el
// cotizador escribe el celular y donde el equipo lo busca (el Telefono que pasa a
// Secundario no deja de estar en Operam). El contacto ya quedo escrito: una falla de la
// fusion es un aviso, nunca tumba la operacion.
async function fusionTrasCambioDeCel(r, id, folio, entry, x) {
  if (r?.tipo !== 'lograda' || !r.escrito) return [];
  const cambio = (r.cambios || []).find((c) => c.campo === 'cel');
  if (!cambio) return [];
  try {
    const f = await x.fundirContactos({
      celularViejo: cambio.viejo, celularNuevo: cambio.nuevo, personId: cambio.personId,
      cotizacion: { id, folio }, vendedor: entry.vendedor,
    });
    return f?.pasos || [];
  } catch (err) {
    console.error('[fusion de Contactos] fallo tras cambiar el Cel, cotizacion', id, err.message);
    return [{
      name: 'fusion de Contactos', status: 'warn',
      mensaje: 'El Cel qued\u00f3 cambiado en Operam, pero no se pudo fundir el Contacto del n\u00famero anterior en el del nuevo: av\u00edsale a un administrador.',
      detalle: `persona ${cambio.personId}, ${cambio.viejo} -> ${cambio.nuevo}: ${err.message}`,
    }];
  }
}

// La liga se AGREGA, nunca reemplaza (ADR-0016). El quote ya esta en Operam: un
// fallo del store solo se reporta como paso y la subida sigue lograda.
async function agregarLigaAlContacto(contacto, clienteId, entry, x) {
  try {
    await x.ligarCliente(contacto.id, clienteId, {
      tipo: 'cliente', cliente_id: clienteId,
      nombre: entry.data?.cliente?.razonSocial || entry.data?.cliente?.nombreCorto || '',
      fecha: x.ahora().toISOString(), vendedor: entry.vendedor,
    });
    return { name: 'ligar prospecto', status: 'ok' };
  } catch (err) {
    console.error('[prospectos] No se pudo ligar el Contacto al Cliente Operam:', err.message);
    return { name: 'ligar prospecto', status: 'error', error: err.message };
  }
}
