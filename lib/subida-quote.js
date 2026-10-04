import { actualizarQuoteOperam, corregirVigenciaQuote } from './operam-web.js';
import { huellaContenidoQuote, vigenciaDeCotizacion, resolverClienteDeCotizacion, subirCotizacionOperam } from './operam-client.js';
import { sacarDeLaColaPostFix, encolarPostFix } from './postfix-reintento-io.js';
import { filaEncabezado, pasoEncabezadoQuote } from './postfix-encabezado-quote.js';
import { necesitaAltaGenerica } from './alta-generica.js';
import { celularesDeCruce } from './contacto-cotizacion.js';
import { ligasDeContacto, decidirLiga } from './ligas-contacto.js';
import { esErrorRateMoneda, ErrorClienteSinLista, MENSAJE_CLIENTE_SIN_LISTA } from './lista-precios-cliente.js';
import { MOTIVO_PRE_OPERAM, MOTIVO_PRE_SIN_LISTA } from './pipeline.js';
import { ErrorClienteMonedaExtranjera } from '../public/js/moneda-cliente-logica.js';
import { puedeActualizarCotizacion } from '../public/js/editar-cotizacion-logica.js';
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
// Tajada 2 de 3 (#525): crear por el CAMINO NORMAL (el Cliente Operam ya
// elegido o resuelto por el RFC). El camino con alta de cliente todavia vive en
// server.js y entra por la dependencia PROVISIONAL `caminoAlta`; la tajada 3 la
// borra.
//
// --- Valores de subirQuote --------------------------------------------------
//   OCUPADO                                       (otra operacion en vuelo)
//   { tipo: 'no-encontrada' }
//   { tipo: 'ya-subida', folio, clienteId }       (sin tocar Operam)
//   { tipo: 'via-alta' }                          (provisional: caminoAlta ya respondio)
//   { tipo: 'pregunta', motivo: 'otra-razon-social', contacto, ligadas, clienteId }
//   { tipo: 'lograda', folio, pasos }             (folio vacio = pasos [], nada escrito)
//   { tipo: 'bloqueo', motivo, mensaje, moneda? } motivo: 'cliente-no-identificado',
//     'sin-lista-precios', 'moneda-extranjera' u 'operam' (clasificarErrorQuote)
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
//   de cotizaciones-store:  obtener, actualizarDatos, setFolioOperam
//   de prospectos-store:    buscarPorCelular, ligarCliente
//   de operam-client:       resolverClienteDeCotizacion, subirCotizacionOperam
//   de operam-web:          actualizarQuoteOperam, corregirVigenciaQuote
//   de postfix-reintento-io: sacarDeLaColaPostFix, encolarPostFix
//   ahora()                 la fecha de la marca quoteDesactualizado, del motivo
//                           de PRE y de la liga del Contacto
//   listaDelQuote(entry), transportistaDelQuote(entry): OBLIGATORIAS, sin
//     fallback. Viven en server.js (la lista cuelga del catalogo que lee
//     server.js) y el handler las pasa.
//   caminoAlta(entry): OBLIGATORIA para subirQuote y PROVISIONAL (#525): el
//     camino con alta de cliente que sigue en server.js; responde el mismo.
// Las funciones puras (huellaContenidoQuote, vigenciaDeCotizacion,
// necesitaAltaGenerica) se importan directo: no hay nada que sustituir.

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
// el camino normal (aqui) y los responders del camino del alta (server.js).
//   cliente-no-identificado (#68): problema de datos de la cotizacion, no de
//     disponibilidad de Operam.
//   sin-lista-precios (#285): dos entradas al mismo desenlace -- el corte ANTES
//     del POST (ErrorClienteSinLista) y el 406 "rate de moneda" que llegue de
//     todos modos, que no trae el nombre (el mensaje sin el sigue diciendo que
//     hacer).
//   moneda-extranjera (#297, ADR-0015): el cotizador todavia no le puede cotizar.
//   operam: lo demas, indisponibilidad de Operam.
export function clasificarErrorQuote(err) {
  const texto = err?.message ?? '';
  if (/identificar el cliente/i.test(texto)) return { motivo: 'cliente-no-identificado', mensaje: texto };
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
// Lo usan los dos caminos de crear: el normal (aqui) y el del alta, que sigue en
// server.js (#526) y le pasa listaDelQuote y transportistaDelQuote.
export async function postFixQuote(folio, entry, deps = {}) {
  return postFixResuelto(folio, entry, resolverDeps(deps));
}

async function postFixResuelto(folio, entry, x) {
  if (folio == null || folio === '') return [];
  const data = entry?.data;
  const transportista = x.transportistaDelQuote(entry);
  // Lo que este post-fix debe dejar, tal cual: si no queda verificado se encola CON
  // estos valores (#380) y el reintento repite exactamente esta escritura.
  const esperado = {
    folio, cotizacionId: entry?.id ?? null, vendedor: entry?.vendedor ?? null,
    vigencia: vigenciaDeCotizacion(data), lista: x.listaDelQuote(entry), transportista: transportista.shipVia,
    fechaDocumento: data?.fecha ?? null,
  };
  try {
    const r = await x.corregirVigenciaQuote(folio, esperado.vigencia, { lista: esperado.lista, transportista: esperado.transportista });
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
    return pasos;
  } catch (err) {
    console.error('[post-fix vigencia] fallo en el quote', folio, err.message);
    x.encolarPostFix({ ...esperado, error: err.message });
    // El post-fix no llego a escribir NADA, asi que la lista y el transportista
    // tampoco: cada uno se nombra con su motivo real en vez de callarlo -- desde #403 el
    // vendedor espera un paso por campo, y el silencio se leeria como "si quedo". Los
    // que no tenian valor que mandar no se pintan.
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
    ...(esperado.transportista == null ? [] : [pasoTransportistaQuote(folio, noEnviado(esperado.transportista), transportista)]),];
  }
}

// --- Crear ------------------------------------------------------------------
// `solicitud` es lo que contesto el vendedor en el body: customerIdElegido y
// sucursalDe (eligio un candidato del dedup, o "es otro domicilio de este
// cliente"), crearNuevo ("ninguno es el mismo") y otraRazonSocial (confirmo la
// pregunta de #345). Los dos primeros deciden el camino; el resto del camino del
// alta los recibe por su cuenta en `caminoAlta`.
export async function subirQuote(id, solicitud = {}, deps = {}) {
  exigir(deps, ['caminoAlta']);
  const x = { ...resolverDeps(deps), caminoAlta: deps.caminoAlta };
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
  if (entry.folioOperam != null && entry.folioOperam !== '') {
    return { tipo: 'ya-subida', folio: entry.folioOperam, clienteId: entry.data?.cliente?.customerId ?? null };
  }
  // Alta temprana de cliente generico (#81, ADR-0006): sin cliente en Operam se crea
  // uno con RFC generico; un candidato o un domicilio elegido por el vendedor
  // tambien pasan por el alta. Mientras ese camino viva en server.js (#526) se
  // espera aqui, DENTRO del candado: la peticion lo toma una sola vez.
  if (solicitud.customerIdElegido != null || solicitud.sucursalDe != null || necesitaAltaGenerica(entry)) {
    await x.caminoAlta(entry);
    return { tipo: 'via-alta' };
  }
  return subirCaminoNormal(id, entry, solicitud, x);
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
      return { tipo: 'pregunta', motivo: 'otra-razon-social', contacto, ligadas, clienteId: resuelto.customerId };
    }
    // La subida recibe el cliente ya resuelto para no volver a buscar el RFC. La
    // huella de abajo sigue saliendo de entry.data: la cotizacion no guarda este id.
    const dataSubida = { ...entry.data, cliente: { ...entry.data.cliente, customerId: resuelto.customerId, branchId: resuelto.branchId } };
    const { folio, customerId } = await x.subirCotizacionOperam(dataSubida);
    // Persistir el folio: la cotizacion deja de ser pre-cotizacion (#63). El ORDEN es
    // parte de la regla: folio, huella y motivo quedan guardados antes del post-fix.
    if (folio != null && folio !== '') {
      await x.setFolioOperam(id, folio);
      // Huella de lo que quedo en el quote (#114): sin ella la proxima regeneracion
      // no puede saber si el contenido cambio, que es lo que decide si hay que
      // reescribir el quote o dejarlo en paz.
      const opcionesHuella = { listaId: x.listaDelQuote(entry), shipVia: x.transportistaDelQuote(entry).shipVia };
      await x.actualizarDatos(id, { huellaQuote: huellaContenidoQuote(entry.data, opcionesHuella) });
      await marcarMotivoPre(id, null, x);
    }
    const pasosPostFix = await postFixResuelto(folio, entry, x);
    // La liga solo se anota cuando el quote ya existe: sin folio no hubo venta que
    // ligar, y el reintento vuelve a pasar por aqui. Va con el Cliente Operam que
    // DEVOLVIO la subida.
    const pasosLiga = [];
    if (folio != null && folio !== '' && contacto && decisionLiga.accion === 'agregar') {
      pasosLiga.push(await agregarLigaAlContacto(contacto, customerId, entry, x));
    }
    return { tipo: 'lograda', folio, pasos: [...pasosPostFix, ...pasosLiga] };
  } catch (err) {
    const bloqueo = clasificarErrorQuote(err);
    const motivoPre = MOTIVO_PRE_DE_ERROR[bloqueo.motivo];
    // El motivo se marca ANTES de devolver: el candado de los GET aplica de inmediato.
    if (motivoPre) await marcarMotivoPre(id, motivoPre, x);
    return { tipo: 'bloqueo', ...bloqueo };
  }
}

// El Contacto de la cotizacion (#345, ADR-0016): el celular ANOTADO al nacer (#342)
// manda, y solo si la cotizacion es anterior a ese campo se cae a lo tecleado. Asi
// corregir un telefono despues no cambia de quien es la Oportunidad ni a quien se le
// liga el Cliente Operam. Lo comparte el camino del alta, que sigue en server.js.
export async function contactoDeLaSubida(entry, deps = {}) {
  const { buscarPorCelular } = depsBase(deps);
  for (const celular of celularesDeCruce(entry)) {
    const p = await buscarPorCelular(celular);
    if (p) return p;
  }
  return null;
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
