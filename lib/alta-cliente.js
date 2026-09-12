import { RFC_GENERICOS, detectarDuplicados, normalizarNombre, normalizarRfc, hechosCandidato, agregarCandidatosPorCustRef, coincideCustRef, poolClientesParaDedup } from './deduplicacion.js';
import {
  rfcGenericoDe, buildClienteGenerico, buildBranchGenerico, sucursalEquivalente,
  diffBranchDomicilio, resolverSalesTypeId, FUENTE_ALTA_GENERICA, FUENTE_SUCURSAL_CREADA,
} from './alta-generica.js';
import { celsNoAplicados } from './cel-operam.js';
import { MENSAJE_CLIENTE_SIN_LISTA, esErrorRateMoneda } from './lista-precios-cliente.js';
import { ligasDeContacto, ligaPrincipal, decidirLiga } from './ligas-contacto.js';
import {
  buscarClientesPorRfc, crearClienteDirecto, actualizarClienteDirecto, obtenerClientePorId,
  obtenerBranchesCliente, obtenerBranch, obtenerBranchId, crearBranchCliente,
  actualizarBranchCliente, listarSalesTypes, verificarRfcLibre, buildClienteBody,
} from './operam-client.js';
import { actualizarSegmentoClienteWeb } from './operam-web.js';
import {
  buildActualizarFiscalPayload, calcularDiffFiscal, camposNoAplicados,
} from '../public/js/alta-logica.js';
import { clientesCacheados, actualizarClienteEnCache, refrescarIndice } from './indice-telefonos.js';
import { DIFF_FISCAL_CAMPOS, leerValorOperam } from '../public/js/alta-logica.js';
import { logCliente } from './clientes-log.js';
import {
  fuenteSegmento, motivoSegmentoPendiente,
  RESULTADO_SEGMENTO_ESCRITO, RESULTADO_SEGMENTO_PENDIENTE,
} from './segmento-pendiente.js';
import * as vendedoresStore from './vendedores-store.js';
import * as prospectosStore from './prospectos-store.js';

// EL modulo Alta de cliente (ADR-0017): garantiza que existe un Cliente Operam
// listo para cotizar y facturar. No conoce la cotizacion, ni Express, ni un
// status HTTP -- devuelve VALORES y quien lo llama traduce. El POST del quote,
// la vigencia y escribir customerId/branchId en la cotizacion son de la subida
// (ADR-0009).
//
// --- Solicitud de alta (CONTEXT.md "Solicitud de alta") ---------------------
// Objeto plano; la subida de cotizacion la arma desde la cotizacion y el
// formulario de alta desde lo capturado.
//
//   contacto: { celular, prospecto, ligas }
//       El Contacto (su celular) y, si ya se conocen, su ficha y sus ligas a
//       Clientes Operam. Sin `ligas` se derivan de `prospecto.data`.
//       `otraRazonSocialConfirmada: true` = el vendedor ya contesto la pregunta
//       por el celular ligado a otro Cliente Operam.
//   identidad: { razonSocial, nombreCorto, nombreVisible, rfc, pais }
//       Con que nombre nace o se busca el cliente. `nombreVisible` es el ultimo
//       recurso (el nombre a la vista de quien pide el alta) y `rfc` solo cuenta
//       si ya es un RFC generico capturado: el RFC real vive en datosFiscales.
//   datosFiscales: null | { rfc, razonSocial, regimen, idcif, calle, numExt,
//                           numInt, colonia, cp, municipio, estado,
//                           actividades, csfFecha, taxIdExtranjero }
//       null = Cliente Operam sin datos fiscales; el modulo elige el RFC
//       generico que le toca por pais (rfcGenericoDe). Con ellos (#366) el
//       cliente nace con su RFC real y su domicilio FISCAL, la dedup parte del
//       RFC exacto y el alta toma el lock por RFC. El domicilio de aqui es el
//       fiscal; el operativo es domicilioEntrega y son distintos (CONTEXT.md).
//   comercial: { vendedor, salesmanId, tier, salesTypeId, segmentoId,
//                correoFacturacion, usoCfdi }
//       `salesTypeId` gana sobre `tier` y `salesmanId` sobre `vendedor`: quien ya
//       tiene el catalogo en la mano lo resuelve y ahorra la lectura; sin ellos
//       el modulo pide el catalogo (listarSalesTypes / listar) y mapea.
//   domicilioEntrega: { nombre, referenciaCorta, calle, numExt, numInt, colonia,
//                       municipio, estado, cp, referencias, telefono, correo }
//   ligaFija: { clienteId, domicilioId }
//       El Cliente Operam al que quien pide el alta YA esta ligado (la liga de
//       la cotizacion es fija) y el domicilio de entrega que ya trae anotado.
//   decision: null | { tipo: 'usar' | 'otro-domicilio' | 'ninguno', clienteId,
//                      domicilioId? }
//       La salida que eligio el vendedor ante la pregunta de duplicado. Con
//       `usar`, `domicilioId` es el domicilio de entrega que el vendedor eligio
//       entre los del cliente (#252): sin el se resuelve el primero, que en un
//       cliente con varias plazas no es el que se escogio. Un `clienteId` que ya
//       no esta en el pool fresco -- o un `domicilioId` que ya no es de ese
//       cliente -- vuelven a preguntar, nunca escriben a ciegas (#208).
//       El segmento comercial viaja en `comercial.segmentoId`.
//   segmento: { preferencia: 'diferido' | 'esperar' }
//       Quien ESPERA la escritura del segmento por la web legacy y quien no
//       (#365). `esperar` la reporta como un paso mas; `diferido` (la subida de
//       la cotizacion, cuya latencia manda) NO la dispara: la devuelve en el
//       resultado como `segmentoDiferido()` para que el caller la dispare
//       despues de responder, y su fallo se anota en la auditoria como segmento
//       pendiente, visible en /admin. Sin valor se asume `diferido`.
//   auditoria: { fuente }
//       Con que fuente queda el alta en clientes_log. Sin ella, la del alta que
//       nace con la cotizacion (FUENTE_ALTA_GENERICA).
//
// --- Resultado --------------------------------------------------------------
//   { tipo: 'lograda',  clienteId, domicilioId, creadoNuevo, pasos }
//   { tipo: 'pregunta', motivo, mensaje, opciones, candidatos, pasos, ... }
//   { tipo: 'bloqueo',  motivo, mensaje, detalle, pasos, clienteId? }
//
// Cada paso es { name, status: 'ok'|'warn'|'error'|'omitido', mensaje, detalle?,
// camposNoActualizados? }: `name` es la llave tecnica que leen los tableros,
// `mensaje` lo que ve el vendedor y `detalle` lo que se necesita para depurar
// (Mensaje en dos capas, CONTEXT.md). Un paso que no aplica sale 'omitido' con
// su motivo, nunca se salta en silencio.
//
// TODO resultado que ya tenga un Cliente Operam lo devuelve -- tambien el
// bloqueo --, para que quien pide el alta lo persista antes de responder y un
// reintento reuse ese cliente en vez de crear un segundo (idempotencia).
//
// --- Dependencias (deps = {}) -----------------------------------------------
// Cada llave se llama igual que la funcion real a la que sustituye; el
// adaptador en memoria de los tests implementa las mismas.
//   de operam-client:  buscarClientesPorRfc, crearClienteDirecto,
//                      actualizarClienteDirecto, obtenerClientePorId,
//                      obtenerBranchesCliente, obtenerBranch, obtenerBranchId,
//                      crearBranchCliente, actualizarBranchCliente,
//                      listarSalesTypes
//   de indice-telefonos: clientesCacheados, actualizarClienteEnCache
//   de clientes-log:     logCliente
//   de vendedores-store: listar
//   de prospectos-store: ligarCliente
//   de operam-client:    verificarRfcLibre        (upgrade fiscal, #367)
//   de operam-web:       actualizarSegmentoClienteWeb (segmento, #365; upgrade fiscal, #367)
//   de indice-telefonos: refrescarIndice          (alta completa, #366; upgrade fiscal, #367)
//
// El alta SIN datos fiscales refresca el padron con actualizarClienteEnCache y no
// con refrescarIndice: ya relee al cliente recien creado para verificar el Cel,
// asi que la entrada fresca esta en la mano y un refresco completo seria releer el
// padron paginado entero por un cliente (mismo criterio de #327). El alta CON
// datos fiscales si lo relee entero (#366): ahi no hay cotizacion esperando, el
// cliente pudo ser uno reutilizado al que se le acaba de cambiar la configuracion
// (esa entrada no esta en la mano) y el buscador de la vista Clientes es lo
// siguiente que el vendedor abre.

function deOperam(deps) {
  return {
    buscarClientesPorRfc: deps.buscarClientesPorRfc || buscarClientesPorRfc,
    crearClienteDirecto: deps.crearClienteDirecto || crearClienteDirecto,
    actualizarClienteDirecto: deps.actualizarClienteDirecto || actualizarClienteDirecto,
    obtenerClientePorId: deps.obtenerClientePorId || obtenerClientePorId,
    obtenerBranchesCliente: deps.obtenerBranchesCliente || obtenerBranchesCliente,
    obtenerBranch: deps.obtenerBranch || obtenerBranch,
    obtenerBranchId: deps.obtenerBranchId || obtenerBranchId,
    crearBranchCliente: deps.crearBranchCliente || crearBranchCliente,
    actualizarBranchCliente: deps.actualizarBranchCliente || actualizarBranchCliente,
    listarSalesTypes: deps.listarSalesTypes || listarSalesTypes,
    clientesCacheados: deps.clientesCacheados || clientesCacheados,
    actualizarClienteEnCache: deps.actualizarClienteEnCache || actualizarClienteEnCache,
    logCliente: deps.logCliente || logCliente,
    listar: deps.listar || vendedoresStore.listar,
    ligarCliente: deps.ligarCliente || prospectosStore.ligarCliente,
    verificarRfcLibre: deps.verificarRfcLibre || verificarRfcLibre,
    actualizarSegmentoClienteWeb: deps.actualizarSegmentoClienteWeb || actualizarSegmentoClienteWeb,
    refrescarIndice: deps.refrescarIndice || refrescarIndice,
  };
}

// La Solicitud, aplanada a la forma que hablan los constructores puros de
// alta-generica.js (seam interno del modulo, ADR-0017): sus otros importadores
// no cambian, asi que la traduccion vive aqui y no alla.
function clienteCapturado(solicitud) {
  const s = solicitud || {};
  const id = s.identidad || {};
  const com = s.comercial || {};
  const dom = s.domicilioEntrega || {};
  return {
    razonSocial: id.razonSocial || '',
    nombreCorto: id.nombreCorto || '',
    rfc: id.rfc || '',
    pais: id.pais || 'MX',
    telefono: s.contacto?.celular || '',
    emailFactura: com.correoFacturacion || '',
    segmentoId: com.segmentoId,
    nombreEntrega: dom.nombre || '',
    refEntrega: dom.referenciaCorta || '',
    calle: dom.calle || '',
    numExt: dom.numExt || '',
    numInt: dom.numInt || '',
    colonia: dom.colonia || '',
    municipio: dom.municipio || '',
    estado: dom.estado || '',
    cpEntrega: dom.cp || '',
    referencias: dom.referencias || '',
    celEntrega: dom.telefono || '',
    emailEntrega: dom.correo || '',
  };
}

function nombreDeAlta(solicitud) {
  const id = solicitud?.identidad || {};
  return id.razonSocial || id.nombreCorto || id.nombreVisible || solicitud?.datosFiscales?.razonSocial || '';
}

// El RFC REAL de la Solicitud, o cadena vacia. Es lo que decide los dos rasgos
// propios del alta con datos fiscales: la dedup parte del RFC exacto y el alta
// toma el lock. Un RFC generico capturado NO cuenta -- lo comparten por diseno
// (ADR-0001), asi que ni identifica ni serializa nada.
function rfcRealDe(solicitud) {
  const rfc = normalizarRfc(solicitud?.datosFiscales?.rfc);
  return rfc && !RFC_GENERICOS.has(rfc) ? rfc : '';
}

// La deduplicacion en capas de ADR-0001 sobre los DOS RFC genericos a la vez
// (#244) mas la busqueda del nombre corto en el padron COMPLETO (#242): Operam
// exige `cust_ref` unico global sin importar el RFC, asi que un choque es el
// unico camino que puede DESCUBRIR que el cliente ya existe bajo un RFC real.
// El padron es best effort (clientesCacheados nunca lanza): con la cache fria el
// respaldo es el 406 traducido mas abajo. Se devuelve para nombrar al dueno del
// nombre corto si el POST choca.
// Con datos fiscales el pool es el del RFC REAL exacto (#366): ahi un match no
// es un parecido sino EL cliente, y por eso se normaliza a la misma forma de
// candidatos que el camino generico -- la pregunta al vendedor es una sola (usar
// / otro-domicilio / ninguno) y el dueno del nombre corto (#242) puede sumarse a
// la misma lista.
async function poolDedup(solicitud, io) {
  const c = clienteCapturado(solicitud);
  const rfcReal = rfcRealDe(solicitud);
  const rfc = rfcReal || rfcGenericoDe(c);
  const nombre = nombreDeAlta(solicitud);
  const [pools, padron] = await Promise.all([
    Promise.all((rfcReal ? [rfcReal] : [...RFC_GENERICOS]).map(g => io.buscarClientesPorRfc(g))),
    // 5 s y no el default largo: aqui hay un vendedor esperando.
    io.clientesCacheados({ timeoutMs: 5000 }),
  ]);
  const crudo = detectarDuplicados(rfc, nombre, poolClientesParaDedup(pools));
  const dedup = crudo.tipo === 'exacto' ? { tipo: 'candidatos', candidatos: [crudo.cliente] } : crudo;
  return { rfc, nombre, padron, dedup: agregarCandidatosPorCustRef(dedup, padron, c.nombreCorto) };
}

// Contexto para los hechos del picker (#210): el telefono/correo REALES del
// Contacto capturado, para que celularMatch/correoMatch dejen de ser "sin dato"
// por falta de plomeria cuando el dato si existe.
function contextoHechos(c, nombre) {
  return { tokensInput: normalizarNombre(nombre), telefonoInput: c.telefono, correoInput: c.emailFactura || c.emailEntrega || '' };
}

// Forma del candidato que viaja en la pregunta (#210): datos base + hechos
// crudos (diferencia de nombre en ambas direcciones, letreros de celular y
// correo), calculados APARTE de la seleccion. El humano decide; ninguna
// combinacion bloquea las salidas. custRefIgual (#242) es el hecho mas duro:
// Operam no dejaria crear un cliente con ese nombre corto.
function candidatoParaContrato(k, ctx) {
  const hechos = hechosCandidato(k, ctx.tokensInput, ctx.telefonoInput, ctx.correoInput);
  return {
    id: k.customer_id, CustName: k.CustName, cust_ref: k.cust_ref, tax_id: k.tax_id,
    diferenciaNombre: hechos.diferenciaNombre, celularMatch: hechos.celularMatch, correoMatch: hechos.correoMatch,
    custRefIgual: k._custRefIgual === true,
  };
}

// La pregunta al vendedor con sus TRES salidas (CONTEXT.md "Deduplicacion de
// cliente"). Un solo constructor: la parada nace en tres momentos -- los
// parecidos que encontro la dedup, el Cliente Operam elegido que ya no esta en
// el pool y el domicilio de entrega que ya no es de ese cliente -- y las tres
// tienen que ofrecer exactamente las mismas salidas o el navegador pintaria
// menos botones segun por donde entro.
function preguntaCandidatos({ pasos, mensaje, detalle, candidatos, ctx }) {
  return {
    tipo: 'pregunta', motivo: 'candidatos', pasos, mensaje, detalle,
    opciones: ['usar', 'otro-domicilio', 'ninguno'],
    candidatos: (candidatos || []).map(k => candidatoParaContrato(k, ctx)),
  };
}

function esErrorCustRefDuplicado(err) {
  return /same cust_ref/i.test(String(err?.message || ''));
}

// Traduccion del 406 de cust_ref duplicado (#242) a algo que el vendedor pueda
// EJECUTAR: reintentar da exactamente el mismo error, porque el nombre corto es
// unico global en Operam. Si el padron alcanza a nombrar al dueno, se nombra:
// saber contra que se choco es la diferencia entre cambiar el nombre corto a
// ciegas y darse cuenta de que ese cliente ya existia. Jamas se desambigua con
// un sufijo automatico: esconderia el hallazgo.
function mensajeCustRefDuplicado(nombreCorto, padron, queRehacer) {
  const dueno = (padron || []).find(k => coincideCustRef(k?.cust_ref, nombreCorto));
  const quien = dueno
    ? ` Lo usa ${dueno.CustName || `el Cliente Operam ${dueno.customer_id}`}${dueno.tax_id ? ` (RFC ${dueno.tax_id})` : ''}.`
    : '';
  const cual = nombreCorto ? ` "${nombreCorto}"` : '';
  return `El nombre corto${cual} ya lo usa otro Cliente Operam, que lo exige unico.${quien}` +
    ` Cambia el nombre corto y ${queRehacer}.`;
}

// Un fallo de Operam -> bloqueo con las dos capas. El 406 "rate de moneda" es la
// excepcion que hay que traducir (#285): no dice ni cliente ni lista, pero
// significa que al CLIENTE le falta lista de precios, y sin decirlo el vendedor
// reintenta para siempre. El texto crudo del ERP se conserva en el detalle.
function bloqueoDeOperam(err, { pasos, clienteId, mensaje, detalle }) {
  if (esErrorRateMoneda(err?.message)) {
    return {
      tipo: 'bloqueo', motivo: 'sin-lista-precios', pasos,
      ...(clienteId != null ? { clienteId } : {}),
      mensaje: MENSAJE_CLIENTE_SIN_LISTA(),
      detalle: `${detalle}: ${err.message}`,
    };
  }
  return {
    tipo: 'bloqueo', motivo: 'operam', pasos,
    ...(clienteId != null ? { clienteId } : {}),
    mensaje, detalle: `${detalle}: ${err?.message ?? ''}`,
  };
}

// El cliente NUEVO tal como lo consume buildClienteBody, que es el UNICO mapeo
// cliente -> Operam (ahi viven los overrides fiscales del RFC generico, #121) y
// el que crearClienteDirecto aplica. Sin datos fiscales es el generico de
// siempre; con ellos, el mismo objeto mas el RFC real y el domicilio FISCAL.
function clienteNuevoDeSolicitud(s, c, opciones) {
  const base = buildClienteGenerico(
    { data: { cliente: c }, cliente: s.identidad?.nombreVisible || '' },
    opciones,
  );
  const f = s.datosFiscales;
  if (!f) return base;
  const usoCfdi = s.comercial?.usoCfdi || '';
  return {
    ...base,
    tax_id: normalizarRfc(f.rfc),
    idcif: f.idcif || '',
    street: f.calle || '',
    street_number: f.numExt || '',
    suite_number: f.numInt || '',
    district: f.colonia || '',
    postal_code: f.cp || '',
    city: f.municipio || '',
    state: f.estado || '',
    cfdi_regimen_fiscal: f.regimen || '',
    actividades: f.actividades || [],
    csf_fecha: f.csfFecha || '',
    ...(usoCfdi ? { timbrado_uso_cfdi: usoCfdi } : {}),
    ...(f.taxIdExtranjero ? { invoice_tax_id: f.taxIdExtranjero } : {}),
    // Contacto principal del cliente = quien recibe en el domicilio de entrega
    // (#16): el formulario de alta nunca capturo uno aparte.
    phone: c.celEntrega || c.telefono || '',
    email: c.emailEntrega || '',
  };
}

// Configuracion comercial que el PUT de cliente SI persiste. La correspondencia
// llave-que-se-escribe / llave-que-se-lee (#169: no son la misma, `segmento_id`
// se lee como `segmento.id`) NO se copia aqui: sale de DIFF_FISCAL_CAMPOS, que es
// donde vive esa tabla, para que no haya dos versiones que puedan divergir.
// Fuera quedan, a proposito, dos campos que el formulario si captura:
//   - el vendedor vive en el domicilio de entrega, no en el cliente (#187), y el
//     domicilio de un Cliente Operam reutilizado no se toca (#250);
//   - el correo de facturacion viaja dentro de `notes`, que el PUT REEMPLAZA
//     entero: escribirlo borraria las notas del cliente.
const CAMPOS_COMERCIALES = [
  ['sales_type', 'la lista de precios'],
  ['segmento_id', 'el segmento'],
  ['timbrado_uso_cfdi', 'el uso de CFDI'],
].map(([operam, que]) => {
  const mapeo = DIFF_FISCAL_CAMPOS.find(x => x.operam === operam);
  return { campo: mapeo.write || mapeo.operam, mapeo, que };
});

// La configuracion comercial de un Cliente Operam REUTILIZADO (#250): se lee lo
// que ya tiene y solo viaja lo que de verdad cambia. Un valor vacio no es un
// dato -- Operam lo coerciona (sales_type '' -> 0) y el cliente pierde su lista.
// Sobre un cliente recien creado el paso no aplica: nacio con esta configuracion
// en el POST.
async function pasoConfiguracionComercial(clienteId, creadoNuevo, comercial, io) {
  const name = 'PUT customer (config comercial)';
  if (creadoNuevo) {
    return {
      name, status: 'omitido',
      mensaje: 'El Cliente Operam nacio con la configuracion comercial que capturaste',
      detalle: `cliente ${clienteId} recien creado: el POST ya la llevaba`,
    };
  }
  const capturado = {
    sales_type: comercial?.salesTypeId,
    segmento_id: comercial?.segmentoId,
    timbrado_uso_cfdi: comercial?.usoCfdi,
  };
  let actual;
  try {
    actual = await io.obtenerClientePorId(clienteId);
  } catch (err) {
    return {
      name, status: 'error',
      mensaje: 'No se pudo leer la configuracion comercial que ya tenia el Cliente Operam',
      detalle: `GET /customers/${clienteId}: ${err.message}`,
    };
  }
  const cambios = {};
  const cambiado = [];
  for (const { campo, mapeo, que } of CAMPOS_COMERCIALES) {
    const nuevo = capturado[campo];
    if (nuevo === '' || nuevo == null) continue;
    if (String(leerValorOperam(actual, mapeo) ?? '') === String(nuevo)) continue;
    cambios[campo] = nuevo;
    cambiado.push(que);
  }
  if (!cambiado.length) {
    return {
      name, status: 'omitido',
      mensaje: 'El Cliente Operam ya tenia la configuracion comercial que capturaste',
      detalle: `cliente ${clienteId} sin diferencias en ${CAMPOS_COMERCIALES.map(x => x.campo).join(', ')}`,
    };
  }
  try {
    await io.actualizarClienteDirecto(clienteId, cambios);
    return {
      name, status: 'ok',
      mensaje: `Se actualizo ${cambiado.join(', ')} del Cliente Operam`,
      detalle: `PUT /customers/${clienteId} ${Object.keys(cambios).join(', ')}`,
    };
  } catch (err) {
    return {
      name, status: 'error',
      mensaje: 'No se pudo actualizar la configuracion comercial del Cliente Operam',
      detalle: `PUT /customers/${clienteId}: ${err.message}`,
    };
  }
}

// Lock en memoria por RFC REAL (#209, antes en server.js): dos altas EN VUELO
// con el mismo RFC nuevo (doble click, dos pestanas) verian ambas el pool vacio
// y crearian DOS Clientes Operam. La segunda no falla: ESPERA a que la primera
// termine y solo entonces corre su propia dedup, que para ese momento SI
// encuentra al recien creado. Los RFC genericos quedan exentos (los comparten por
// diseno, ADR-0001). Map<rfc, Promise> hace de cola FIFO por RFC, con la misma
// asuncion de UN SOLO proceso Node que el resto de los locks del repo.
const altaEnCursoPorRfc = new Map();

function conLockPorRfc(rfc, tarea) {
  if (!rfc) return tarea();
  const previa = altaEnCursoPorRfc.get(rfc);
  const actual = (previa ? previa.catch(() => {}) : Promise.resolve()).then(tarea);
  altaEnCursoPorRfc.set(rfc, actual);
  // Solo libera quien sigue siendo la promesa mas nueva del mapa: si alguien ya
  // se encolo detras, es esa la que manda liberar cuando termine.
  return actual.finally(() => {
    if (altaEnCursoPorRfc.get(rfc) === actual) altaEnCursoPorRfc.delete(rfc);
  });
}

// Vendedor -> su `salesman` de Operam (que Operam guarda en el domicilio de
// entrega, no en el cliente; ver docs/arquitectura.md). Ya resuelto gana: el
// formulario de alta elige del catalogo y manda el id, no el nombre.
async function salesmanDeVendedor(comercial, io) {
  const id = comercial?.salesmanId;
  if (id != null && id !== '') return id;
  if (!comercial?.vendedor) return undefined;
  return (await io.listar()).find(v => v.name === comercial.vendedor)?.operam_id ?? undefined;
}

// La lista de precios con la que nace el Cliente Operam. Ya resuelta gana; con
// solo el tier se pide el catalogo y se mapea por nombre (resolverSalesTypeId
// cae a "Precio de lista" cuando el tier no tiene lista homonima, #92).
async function salesTypeDeLaSolicitud(comercial, io) {
  if (comercial?.salesTypeId != null) return comercial.salesTypeId;
  if (!comercial?.tier) return undefined;
  const listas = (await io.listarSalesTypes())
    .filter(t => t.inactive !== '1' && t.inactive !== 1)
    .map(t => ({ id: t.id, nombre: t.sales_type }));
  return resolverSalesTypeId(comercial.tier, listas);
}

// El ULTIMO paso de la secuencia: el segmento comercial (#365). La API v3 no lo
// escribe por ningun camino (#172, sondeo en vivo), asi que lo escribe la web
// legacy, que es lenta y caprichosa. Quien lo pide decide si lo espera:
//
//   'esperar'  -- el alta completa y el upgrade fiscal: el vendedor esta mirando
//                 la pantalla, asi que el desenlace es un paso mas del reporte.
//   'diferido' -- la subida de la cotizacion: su latencia manda (ADR-0017) y la
//                 respuesta no puede quedarse esperando a la web legacy. El fallo
//                 no cabe en la respuesta (ya se fue), asi que se anota en la
//                 auditoria como segmento pendiente y se ve en /admin. Un exito
//                 diferido no deja rastro: no hay nada que atender.
//
// `soloSinSegmento` en los dos casos (#186): a un Cliente Operam ya clasificado
// no se le pisa su segmento porque en esta alta se eligiera otro.
const MENSAJE_SEGMENTO_FALLIDO = 'El segmento no quedo guardado en Operam';

async function pasoSegmento(solicitud, { io, pasos, clienteId, rfc, nombre }) {
  const segmentoId = solicitud?.comercial?.segmentoId;
  if (!segmentoId) {
    pasos.push({
      name: 'segmento', status: 'omitido',
      mensaje: 'Sin segmento capturado: no hay clasificacion comercial que guardar',
      detalle: `cliente ${clienteId} sin segmento en la solicitud`,
    });
    return;
  }
  const fuente = fuenteSegmento(segmentoId);

  if (solicitud?.segmento?.preferencia !== 'esperar') {
    pasos.push({
      name: 'segmento', status: 'omitido',
      mensaje: 'El segmento se escribe despues para no demorar la cotizacion',
      detalle: `cliente ${clienteId} -> segmento ${segmentoId} diferido; un fallo queda como segmento pendiente en la auditoria`,
    });
    // La escritura diferida NO se dispara aqui: la cola de post-fixes de la web
    // legacy es FIFO y compartida, y quien pide el alta todavia va a esperar el
    // post-fix de vigencia detras de ella. Se devuelve como funcion para que el
    // caller la dispare DESPUES de responder.
    return () => Promise.resolve()
      .then(() => io.actualizarSegmentoClienteWeb(clienteId, segmentoId, { soloSinSegmento: true }))
      .then(r => {
        if (r?.ok) return;
        anotarSegmentoPendiente(io, { clienteId, rfc, nombre, fuente, detalle: `web legacy de Operam: ${r?.error ?? '(sin motivo)'}` });
      })
      .catch(err => {
        anotarSegmentoPendiente(io, { clienteId, rfc, nombre, fuente, detalle: `web legacy de Operam: ${err?.message ?? err}` });
      });
  }

  let r;
  try {
    r = await io.actualizarSegmentoClienteWeb(clienteId, segmentoId, { soloSinSegmento: true });
  } catch (err) {
    r = { ok: false, error: err?.message ?? String(err) };
  }
  if (!r?.ok) {
    pasos.push({
      name: 'segmento', status: 'error',
      mensaje: MENSAJE_SEGMENTO_FALLIDO,
      detalle: `web legacy de Operam: ${r?.error ?? '(sin motivo)'}`,
    });
    return;
  }
  if (r.conservado) {
    pasos.push({
      name: 'segmento', status: 'omitido',
      mensaje: 'El Cliente Operam ya estaba clasificado en Operam: se conservo su segmento',
      detalle: `cliente ${clienteId} conserva el segmento ${r.actual}; se pidio ${segmentoId}`,
    });
    return;
  }
  if (r.yaCorrecto) {
    pasos.push({
      name: 'segmento', status: 'ok',
      mensaje: 'El Cliente Operam ya tenia el segmento capturado',
      detalle: `cliente ${clienteId} ya estaba en el segmento ${segmentoId}`,
    });
    return;
  }
  io.logCliente(rfc, nombre, RESULTADO_SEGMENTO_ESCRITO, clienteId, fuente, null, null);
  pasos.push({
    name: 'segmento', status: 'ok',
    mensaje: 'Se guardo el segmento del Cliente Operam',
    detalle: `cliente ${clienteId} -> segmento ${segmentoId}`,
  });
}

// La auditoria es lo UNICO que queda de un post-fix diferido que fallo: la
// respuesta ya se fue. El console.warn se conserva para quien este mirando el log
// en vivo, pero ya no es el unico lugar donde vive el hecho (#365).
function anotarSegmentoPendiente(io, { clienteId, rfc, nombre, fuente, detalle }) {
  console.warn('[segmento pendiente] cliente', clienteId, detalle);
  try {
    io.logCliente(rfc, nombre, RESULTADO_SEGMENTO_PENDIENTE, clienteId, fuente, null,
      motivoSegmentoPendiente(MENSAJE_SEGMENTO_FALLIDO, detalle));
  } catch (err) {
    console.error('[segmento pendiente] no se pudo anotar en la auditoria el cliente', clienteId, err.message);
  }
}

export async function darDeAlta(solicitud, deps = {}) {
  return conLockPorRfc(rfcRealDe(solicitud), () => altaSinLock(solicitud, deps));
}

async function altaSinLock(solicitud, deps = {}) {
  const io = deOperam(deps);
  const s = solicitud || {};
  const c = clienteCapturado(s);
  const decision = s.decision || null;
  const pasos = [];
  // "Es otro domicilio de este cliente" (#211): el cliente existente manda igual
  // que al elegirlo -- mismas guardas, misma revalidacion contra el pool -- y
  // ademas se le crea un domicilio de entrega nuevo.
  const crearDomicilio = decision?.tipo === 'otro-domicilio';
  const idElegido = decision?.tipo === 'usar' || crearDomicilio ? decision.clienteId : null;
  const crearNuevo = decision?.tipo === 'ninguno';
  const fuenteAuditoria = s.auditoria?.fuente || FUENTE_ALTA_GENERICA;
  let clienteId = idElegido;
  let creadoNuevo = false;
  // El domicilio de entrega que el vendedor eligio entre los del Cliente Operam
  // elegido (#252, absorbido por #368). Sin el, la cotizacion hereda el PRIMERO
  // de la lista, que en un cliente con varias plazas no es el que se escogio.
  let domicilioElegido = null;
  let salesman;
  // El uso de CFDI con el que NACIO el cliente, ya pasado por el unico mapeo a
  // Operam. El POST lo ignora y solo el PUT lo persiste (#217), asi que hay que
  // reenviarlo -- y tiene que salir de buildClienteBody, no del capturado, o el
  // RFC generico terminaria con el uso que eligio el vendedor en vez del S01 que
  // #121 impone.
  let usoCfdiDelPost;

  try {
    const prospecto = s.contacto?.prospecto || null;
    const ligas = Array.isArray(s.contacto?.ligas) ? s.contacto.ligas : ligasDeContacto(prospecto?.data);

    if (clienteId != null) {
      // El elegido no puede contradecir la liga FIJA de quien pide el alta: la
      // cotizacion ya ligada a otro cliente mandaria el mismo documento a dos
      // cuentas.
      const ligaFija = s.ligaFija?.clienteId;
      if (ligaFija != null && String(ligaFija) !== String(clienteId)) {
        return {
          tipo: 'bloqueo', motivo: 'liga-fija', pasos,
          mensaje: `La cotizacion ya esta ligada al Cliente Operam ${ligaFija} y no coincide con el que elegiste (${clienteId})`,
          detalle: `liga fija cliente ${ligaFija} vs elegido ${clienteId}`,
        };
      }
      // La liga del CONTACTO, en cambio, no bloquea (#345): una persona compra
      // para varias razones sociales, asi que se pregunta y con su confirmacion
      // la liga se AGREGA. Sin confirmar no se crea ni se toca nada.
      if (decidirLiga(ligas, clienteId, { confirmado: s.contacto?.otraRazonSocialConfirmada }).accion === 'confirmar') {
        return {
          tipo: 'pregunta', motivo: 'otra-razon-social', pasos,
          mensaje: 'El celular de esta cotizacion ya esta ligado a otro Cliente Operam. ' +
            'Confirma si es otra razon social del mismo Contacto para agregar la liga sin quitar la que ya tenia.',
          opciones: ['confirmar', 'dejar-pre'],
          candidatos: [],
          contacto: prospecto, ligadas: ligas, clienteId,
          decision: decision ? { ...decision } : null,
        };
      }
      // #208: el cliente elegido viene de una eleccion del vendedor sobre una
      // lista que pudo cambiar (o venir manipulada). Se recalcula el MISMO pool
      // que genero la parada y se exige que siga perteneciendo a el; si no, se
      // vuelve a preguntar con la lista FRESCA, cero escrituras. La
      // reutilizacion por celular NO pasa por aqui: ese cliente no lo elige el
      // vendedor en esta solicitud.
      const { nombre: nombreRevalida, dedup: dedupRevalida } = await poolDedup(s, io);
      const frescos = dedupRevalida.tipo === 'candidatos' ? dedupRevalida.candidatos : [];
      const ctxRevalida = contextoHechos(c, nombreRevalida);
      if (!frescos.some(k => String(k.customer_id) === String(clienteId))) {
        return preguntaCandidatos({
          pasos, candidatos: frescos, ctx: ctxRevalida,
          mensaje: 'El Cliente Operam que elegiste ya no esta en la lista de parecidos: elige uno para continuar',
          detalle: `cliente ${clienteId} fuera del pool recalculado`,
        });
      }
      // El domicilio de entrega elegido se revalida por la misma razon que el
      // cliente: llega de una eleccion del vendedor sobre una lista que pudo
      // cambiar (o venir manipulada). Uno que ya no es de este cliente vuelve a
      // preguntar; jamas se crea a ciegas ni se cotiza a un domicilio ajeno.
      const domicilioPedido = decision?.tipo === 'usar' ? decision.domicilioId : null;
      if (domicilioPedido != null && domicilioPedido !== '') {
        const suyos = await io.obtenerBranchesCliente(clienteId);
        const suyo = suyos.find(b => String(b.branch_code) === String(domicilioPedido));
        if (!suyo) {
          return preguntaCandidatos({
            pasos, candidatos: frescos, ctx: ctxRevalida,
            mensaje: 'El domicilio de entrega que elegiste ya no es de este Cliente Operam: elige uno para continuar',
            detalle: `branch ${domicilioPedido} fuera de los del cliente ${clienteId}`,
          });
        }
        domicilioElegido = suyo.branch_code;
      }
      pasos.push({
        name: 'dedup', status: 'ok',
        mensaje: crearDomicilio
          ? 'Se uso el Cliente Operam que elegiste y se le agrega un domicilio de entrega'
          : 'Se uso el Cliente Operam que elegiste',
        detalle: `cliente ${clienteId} revalidado contra el pool`,
      });
    } else if (ligas.length) {
      // Capa 1 de la deduplicacion: la PRIMERA liga del Contacto. Con varias
      // razones sociales el vendedor elige; sin eleccion se conserva el
      // desenlace conservador de siempre.
      clienteId = ligaPrincipal(ligas);
      pasos.push({
        name: 'dedup', status: 'ok',
        mensaje: 'Se uso el Cliente Operam que ya estaba ligado a este celular',
        detalle: `liga del Contacto -> cliente ${clienteId}`,
      });
    } else {
      const { rfc, nombre, padron, dedup } = await poolDedup(s, io);
      if (dedup.tipo === 'candidatos' && !crearNuevo) {
        return preguntaCandidatos({
          pasos, candidatos: dedup.candidatos, ctx: contextoHechos(c, nombre),
          mensaje: s.datosFiscales
            ? 'Ya hay un Cliente Operam con este RFC o con este nombre corto: elige uno para continuar'
            : 'Hay Clientes Operam sin datos fiscales con nombre parecido: elige uno para continuar',
          detalle: `pool por RFC ${rfc} + nombre corto: ${dedup.candidatos.map(k => k.customer_id).join(', ')}`,
        });
      }
      // El vendedor dijo "ninguno es el mismo cliente" (#204): se crea, pero el
      // paso queda en warn y el motivo viaja a la auditoria -- es la unica forma
      // de que higiene-clientes (#86) distinga despues un cliente nuevo legitimo
      // de uno forzado sobre un parecido que si era el mismo.
      const forzado = dedup.tipo === 'candidatos' ? dedup.candidatos.map(k => k.customer_id).join(', ') : null;
      pasos.push(forzado
        ? {
          name: 'dedup', status: 'warn',
          mensaje: 'Se creo un Cliente Operam nuevo aunque habia parecidos, porque elegiste que ninguno es el mismo',
          detalle: `candidatos ignorados: ${forzado}`,
        }
        : {
          name: 'dedup', status: 'ok',
          mensaje: 'No hay ningun Cliente Operam parecido: se crea uno nuevo',
          detalle: `sin candidatos para "${nombre}" (${rfc})`,
        });

      salesman = await salesmanDeVendedor(s.comercial, io);
      const salesTypeId = await salesTypeDeLaSolicitud(s.comercial, io);
      const clienteNuevo = clienteNuevoDeSolicitud(s, c, { salesman, salesTypeId });
      usoCfdiDelPost = buildClienteBody(clienteNuevo).timbrado_uso_cfdi;
      let creado;
      try {
        // crearClienteDirecto: SIN la dedup por RFC exacto de crearCliente (con
        // RFC generico devolveria cualquier generico existente; la dedup
        // correcta por nombre ya corrio arriba, y con RFC real la de este mismo
        // modulo, que pregunta en vez de devolver un cliente ajeno).
        creado = await io.crearClienteDirecto(clienteNuevo);
      } catch (err) {
        pasos.push({
          name: 'POST customer', status: 'error',
          mensaje: 'No se pudo crear el Cliente Operam en Operam',
          detalle: `POST /customers: ${err.message}`,
        });
        io.logCliente(rfc, nombre, 'error', null, fuenteAuditoria, null, err.message);
        if (esErrorCustRefDuplicado(err)) {
          return {
            tipo: 'bloqueo', motivo: 'cust-ref-duplicado', pasos,
            // Que rehacer depende de desde donde se pidio el alta: en el
            // formulario no hay ninguna cotizacion que volver a generar.
            mensaje: mensajeCustRefDuplicado(c.nombreCorto, padron,
              s.datosFiscales ? 'vuelve a dar de alta al cliente' : 'vuelve a generar la cotizacion'),
            detalle: `POST /customers: ${err.message}`,
            nombreCorto: c.nombreCorto,
          };
        }
        return bloqueoDeOperam(err, {
          pasos, mensaje: 'No se pudo crear el Cliente Operam en Operam', detalle: 'POST /customers',
        });
      }
      clienteId = creado.cliente_id;
      creadoNuevo = true;
      pasos.push({
        name: 'POST customer', status: 'ok',
        mensaje: 'Se creo el Cliente Operam',
        detalle: `POST /customers -> cliente ${clienteId}`,
      });
      io.logCliente(rfc, nombre, forzado ? 'creado-forzado' : 'creado', clienteId, fuenteAuditoria, null,
        forzado ? `El vendedor eligio "ninguno es el mismo cliente" pese a los candidatos ${forzado} (#204)` : null);
      pasos.push({
        name: 'log auditoria', status: 'ok',
        mensaje: 'El alta quedo registrada en la auditoria',
        detalle: fuenteAuditoria,
      });
    }

    // La configuracion comercial va sobre el Cliente Operam ya resuelto, y solo
    // si de verdad cambia (#250): el recien creado ya nacio con ella.
    pasos.push(await pasoConfiguracionComercial(clienteId, creadoNuevo, s.comercial, io));

    // Con un cliente elegido NUNCA se reutiliza un domicilio de entrega ya
    // anotado (pudo capturarse para OTRO cliente): se resuelve siempre el del
    // elegido -- el que el vendedor escogio entre los suyos, si lo escogio
    // (#252), y si no el que resuelve obtenerBranchId mas abajo. La EXCEPCION es
    // el domicilio nuevo (#211): si la liga fija ya
    // apunta a ESTE mismo cliente y trae domicilio, ese domicilio ES el que este
    // mismo camino creo en un intento anterior -- reusarlo es lo que impide que
    // un reintento cree un segundo domicilio identico.
    let domicilioId = idElegido != null ? domicilioElegido : (s.ligaFija?.domicilioId ?? null);
    if (crearDomicilio && String(s.ligaFija?.clienteId ?? '') === String(clienteId)) {
      domicilioId = s.ligaFija?.domicilioId ?? null;
    }
    // LA bandera del ADR: solo lo que ESTA corrida escribio se verifica. Un
    // domicilio reusado de un intento anterior no se toco aqui, y sobre un
    // domicilio que no acaba de crearse nunca se escribe.
    let domicilioEscritoAqui = false;

    if (crearDomicilio && domicilioId == null) {
      if (salesman === undefined) salesman = await salesmanDeVendedor(s.comercial, io);
      const datosDomicilio = buildBranchGenerico(c, { salesman });
      let creada = null;
      try {
        // BUSCAR ANTES DE CREAR (sucursalEquivalente): un intento anterior pudo
        // escribir el domicilio en Operam y morir despues (la relectura no lo
        // vio -- quirk #74 --, o la persistencia no alcanzo a correr). Sin esto
        // el reintento dejaria dos domicilios identicos. Si la lectura falla se
        // cae al catch: bloqueo SIN escribir, que es la salida segura.
        const previas = await Promise.all(
          (await io.obtenerBranchesCliente(clienteId))
            .map(async b => ({ branch_code: b.branch_code, ...(await io.obtenerBranch(b.branch_code) || {}) }))
        );
        const yaCreada = sucursalEquivalente(previas, datosDomicilio);
        if (yaCreada) {
          domicilioId = yaCreada.branch_code;
          pasos.push({
            name: 'POST branch', status: 'omitido',
            mensaje: 'El domicilio de entrega ya existia en Operam de un intento anterior: no se creo otro',
            detalle: `branch ${domicilioId} equivalente bajo el cliente ${clienteId}`,
          });
        } else {
          creada = await io.crearBranchCliente(clienteId, datosDomicilio);
          domicilioEscritoAqui = true;
          pasos.push({
            name: 'POST branch', status: 'ok',
            mensaje: 'Se creo el domicilio de entrega',
            detalle: `POST /branches -> branch ${creada.branch_id ?? '(sin codigo)'}`,
          });
          // RELEER: Operam responde result:true aunque no haya escrito nada
          // (#74). El domicilio tiene que aparecer bajo el cliente o el paso
          // queda en error -- nada finge exito ni se cotiza a un domicilio
          // inventado.
          const branches = await io.obtenerBranchesCliente(clienteId);
          const fresca = branches.find(b => String(b.branch_code) === String(creada.branch_id));
          if (!fresca) {
            throw new Error(`el domicilio ${creada.branch_id ?? '(sin codigo)'} no aparece bajo el cliente ${clienteId} al releer`);
          }
          domicilioId = fresca.branch_code;
          pasos.push({
            name: 'verificar branch', status: 'ok',
            mensaje: 'El domicilio de entrega quedo guardado en Operam',
            detalle: `GET /customers/${clienteId} branches -> ${domicilioId}`,
          });
        }
        io.logCliente(rfcRealDe(s) || rfcGenericoDe(c), nombreDeAlta(s), 'creado', clienteId, FUENTE_SUCURSAL_CREADA, null,
          yaCreada
            ? `Domicilio de entrega ${domicilioId} del cliente ${clienteId} reusado: ya existia de un intento anterior (#211)`
            : `Domicilio de entrega ${domicilioId} creado bajo el cliente ${clienteId} por decision del vendedor (#211)`);
        pasos.push({
          name: 'log auditoria', status: 'ok',
          mensaje: 'El domicilio de entrega nuevo quedo registrado en la auditoria',
          detalle: FUENTE_SUCURSAL_CREADA,
        });
      } catch (err) {
        // El nombre del paso distingue "no se pudo crear" de "se creo pero la
        // relectura no lo vio": el segundo caso puede haber dejado un domicilio
        // en Operam y el reintento tiene que volver a mirar antes de crear.
        pasos.push({
          name: creada ? 'verificar branch' : 'POST branch', status: 'error',
          mensaje: creada
            ? 'El domicilio de entrega no aparece en Operam al volver a leerlo'
            : 'No se pudo crear el domicilio de entrega en Operam',
          detalle: `${creada ? 'GET' : 'POST'} /branches: ${err.message}`,
        });
        io.logCliente(rfcRealDe(s) || rfcGenericoDe(c), nombreDeAlta(s), 'error', clienteId, FUENTE_SUCURSAL_CREADA, null, err.message);
        return bloqueoDeOperam(err, {
          pasos, clienteId,
          mensaje: 'No se pudo crear el domicilio de entrega en Operam',
          detalle: creada ? 'GET /branches' : 'POST /branches',
        });
      }
    } else if (crearDomicilio) {
      pasos.push({
        name: 'POST branch', status: 'omitido',
        mensaje: 'El domicilio de entrega ya se creo en un intento anterior',
        detalle: `branch ${domicilioId} ya anotado para el cliente ${clienteId}`,
      });
    }

    // Ligar el Contacto es fire-and-forget (mismo trato que Dropbox): el cliente
    // YA existe y el alta debe completarse; un fallo del store solo se reporta.
    // La liga se AGREGA, nunca reemplaza (#345): si el Contacto ya tenia otra
    // razon social, la pregunta ya se contesto y esta es la segunda liga.
    if (prospecto && decidirLiga(ligas, clienteId, { confirmado: true }).accion === 'agregar') {
      try {
        await io.ligarCliente(prospecto.id, clienteId, {
          tipo: 'cliente', cliente_id: clienteId,
          nombre: s.identidad?.razonSocial || s.identidad?.nombreCorto || '',
          fecha: new Date().toISOString(), vendedor: s.comercial?.vendedor,
        });
        pasos.push({
          name: 'ligar prospecto', status: 'ok',
          mensaje: 'El Contacto quedo ligado a este Cliente Operam',
          detalle: `prospecto ${prospecto.id} -> cliente ${clienteId}`,
        });
      } catch (err) {
        pasos.push({
          name: 'ligar prospecto', status: 'error',
          mensaje: 'El Contacto no quedo ligado a este Cliente Operam',
          detalle: `ligarCliente: ${err.message}`,
        });
      }
    }

    // El POST de Operam ignora dimension_id/dimension2_id (#74) y tambien
    // timbrado_uso_cfdi (#217, medido en vivo: el POST guarda su default G03 y
    // el PUT si lo persiste): los tres se persisten por este PUT, no bloqueante.
    if (creadoNuevo) {
      const dimensiones = { dimension_id: 1, dimension2_id: 5, timbrado_uso_cfdi: usoCfdiDelPost };
      try {
        await io.actualizarClienteDirecto(clienteId, dimensiones);
        pasos.push({
          name: 'PUT customer (dimensiones)', status: 'ok',
          mensaje: 'Se guardaron la clasificacion interna y el uso de CFDI del Cliente Operam',
          detalle: `PUT /customers/${clienteId} dimension_id=1 dimension2_id=5 timbrado_uso_cfdi=${usoCfdiDelPost}`,
        });
      } catch (err) {
        pasos.push({
          name: 'PUT customer (dimensiones)', status: 'error',
          mensaje: 'No se guardaron la clasificacion interna y el uso de CFDI del Cliente Operam',
          detalle: `PUT /customers/${clienteId}: ${err.message}`,
        });
      }
    } else {
      pasos.push({
        name: 'PUT customer (dimensiones)', status: 'omitido',
        mensaje: 'El Cliente Operam ya existia: se conserva su clasificacion interna',
        detalle: `cliente ${clienteId} preexistente`,
      });
    }

    // La cotizacion debe ir al domicilio de entrega del cliente (Operam lo
    // auto-crea con el cliente), no al domicilio 1 por omision.
    if (domicilioId == null) {
      try {
        domicilioId = await io.obtenerBranchId(clienteId);
        pasos.push({
          name: 'GET branch_id', status: 'ok',
          mensaje: 'Se ubico el domicilio de entrega del Cliente Operam',
          detalle: `GET /customers/${clienteId} -> branch ${domicilioId}`,
        });
      } catch (err) {
        pasos.push({
          name: 'GET branch_id', status: 'error',
          mensaje: 'No se pudo ubicar el domicilio de entrega del Cliente Operam',
          detalle: `GET /customers/${clienteId}: ${err.message}`,
        });
        return bloqueoDeOperam(err, {
          pasos, clienteId,
          mensaje: 'No se pudo ubicar el domicilio de entrega del Cliente Operam',
          detalle: `GET /customers/${clienteId}`,
        });
      }
    } else if (domicilioElegido != null) {
      pasos.push({
        name: 'GET branch_id', status: 'ok',
        mensaje: 'Se uso el domicilio de entrega que elegiste del Cliente Operam',
        detalle: `branch ${domicilioId} elegido entre los del cliente ${clienteId}`,
      });
    } else if (crearDomicilio) {
      // El domicilio nuevo (#374): ya quedo resuelto al crearlo, asi que no hay
      // nada que buscar -- pero el paso tiene que existir o la fila "Obtener
      // domicilio" se queda en pendiente y el vendedor no sabe a donde va su
      // cotizacion. Un reintento que reuso el domicilio de un intento anterior no
      // lo creo AQUI, y el mensaje lo dice.
      pasos.push({
        name: 'GET branch_id', status: 'ok',
        mensaje: domicilioEscritoAqui
          ? 'Se usa el domicilio de entrega recien creado'
          : 'Se usa el domicilio de entrega que ya se habia creado en un intento anterior',
        detalle: `branch ${domicilioId} del cliente ${clienteId}`,
      });
    }

    // El domicilio de entrega capturado (#96) + tax_group_id/sales_account
    // (#189, SIEMPRE, tambien sin domicilio: no dependen de el sino del pais).
    // SOLO sobre el domicilio que ACABA de nacer con este cliente: uno
    // preexistente puede tener un domicilio real que no debemos pisar, y este
    // PUT es un REPLACE destructivo (#250, issue #195). El fallo NO tumba el
    // alta: el cliente ya existe.
    // Lo enviado se calcula UNA vez: el PUT y la relectura que lo comprueba tienen
    // que comparar exactamente lo mismo, o la verificacion mediria otro domicilio.
    const datosDomicilio = buildBranchGenerico(c, { salesman });
    if (creadoNuevo) {
      try {
        await io.actualizarBranchCliente(clienteId, domicilioId, datosDomicilio);
        domicilioEscritoAqui = true;
        pasos.push({
          name: 'PUT branch (domicilio)', status: 'ok',
          mensaje: 'Se guardo el domicilio de entrega en Operam',
          detalle: `PUT /branches/${domicilioId}`,
        });
      } catch (err) {
        pasos.push({
          name: 'PUT branch (domicilio)', status: 'error',
          mensaje: 'El domicilio de entrega no quedo guardado en Operam',
          detalle: `PUT /branches/${domicilioId}: ${err.message}`,
        });
      }
    } else if (!crearDomicilio) {
      pasos.push({
        name: 'PUT branch (domicilio)', status: 'omitido',
        mensaje: 'El Cliente Operam ya existia: no se toco su domicilio de entrega',
        detalle: `branch ${domicilioId} preexistente`,
      });
    }
    // Con domicilio nuevo (#374) este paso NO se empuja: lo capturado ya viajo en
    // el POST que lo creo. Empujar un omitido detras -- el ultimo manda en la fila
    // del panel -- pintaba de gris un domicilio recien creado y lo llamaba
    // preexistente. Lo que ese camino comprueba es que el domicilio aparece bajo el
    // cliente; la comparacion campo por campo (diffBranchDomicilio) sigue colgando
    // de `creadoNuevo`, o sea que por aqui no corre.

    // Releer y comparar SIEMPRE lo que esta corrida escribio: Operam responde
    // result:true aunque ignore campos (#74).
    if (creadoNuevo) {
      try {
        const fresco = await io.obtenerBranch(domicilioId);
        const camposNoActualizados = diffBranchDomicilio(fresco, datosDomicilio);
        pasos.push(camposNoActualizados.length
          ? {
            name: 'verificar branch', status: 'warn',
            mensaje: 'El domicilio de entrega no quedo completo en Operam',
            detalle: `GET /branches/${domicilioId}: Operam ignoro ${camposNoActualizados.map(x => x.campo).join(', ')}`,
            camposNoActualizados,
          }
          : {
            name: 'verificar branch', status: 'ok',
            mensaje: 'El domicilio de entrega quedo guardado en Operam',
            detalle: `GET /branches/${domicilioId}`,
          });
      } catch (err) {
        pasos.push({
          name: 'verificar branch', status: 'error',
          mensaje: 'No se pudo comprobar el domicilio de entrega en Operam',
          detalle: `GET /branches/${domicilioId}: ${err.message}`,
        });
      }
    }

    // Verificacion del Cel (#339): el unico lector de `fax` es
    // GET /customers/:id, que trae contacts[] y branches[] en una sola llamada.
    // Un Cel que no quedo escrito NO tumba el alta: viaja como campo no aplicado
    // (ADR-0002). Solo se verifica lo que esta corrida escribio.
    const celContacto = c.telefono;
    if (celContacto && (creadoNuevo || domicilioEscritoAqui)) {
      try {
        const fresco = await io.obtenerClientePorId(clienteId);
        // El padron cacheado se queda con la entrada fresca que ya esta en la
        // mano (#327): sin esto el buscador sigue sin ver al cliente nuevo hasta
        // una hora despues.
        if (creadoNuevo) io.actualizarClienteEnCache(fresco);
        const noAplicados = celsNoAplicados(fresco, {
          celCliente: creadoNuevo ? celContacto : '',
          celBranch: domicilioEscritoAqui ? celContacto : '',
          branchId: domicilioId,
        });
        pasos.push(noAplicados.length
          ? {
            name: 'verificar Cel', status: 'warn',
            mensaje: 'El celular del Contacto no quedo guardado en la casilla Cel de Operam',
            detalle: `GET /customers/${clienteId}: campo fax sin el celular enviado`,
            camposNoActualizados: noAplicados,
          }
          : {
            name: 'verificar Cel', status: 'ok',
            mensaje: 'El celular del Contacto quedo guardado en la casilla Cel de Operam',
            detalle: `GET /customers/${clienteId} campo fax`,
          });
      } catch (err) {
        pasos.push({
          name: 'verificar Cel', status: 'error',
          mensaje: 'No se pudo comprobar el celular del Contacto en Operam',
          detalle: `GET /customers/${clienteId}: ${err.message}`,
        });
      }
    } else {
      pasos.push({
        name: 'verificar Cel', status: 'omitido',
        mensaje: celContacto
          ? 'No se escribio nada en este Cliente Operam: no hay Cel que comprobar'
          : 'Sin celular capturado: no hay Cel que guardar',
        detalle: `cliente ${clienteId}, celular ${celContacto ? 'capturado' : 'ausente'}`,
      });
    }

    // Padron de telefonos tras un alta CON datos fiscales (#366): fire-and-forget
    // como Dropbox -- el alta ya esta hecha y el vendedor no espera por esto. Ver
    // la cabecera para por que aqui si se relee entero y en la otra alta no.
    if (s.datosFiscales) {
      try {
        Promise.resolve(io.refrescarIndice())
          .catch(err => console.warn('[alta-cliente] el refresco del padron fallo:', err?.message));
      } catch (err) {
        console.warn('[alta-cliente] el refresco del padron fallo:', err?.message);
      }
    }

    const segmentoDiferido = await pasoSegmento(s, { io, pasos, clienteId, rfc: rfcGenericoDe(c), nombre: nombreDeAlta(s) });

    return { tipo: 'lograda', clienteId, domicilioId, creadoNuevo, pasos, ...(segmentoDiferido ? { segmentoDiferido } : {}) };
  } catch (err) {
    return {
      tipo: 'bloqueo', motivo: 'inesperado', pasos,
      ...(clienteId != null ? { clienteId } : {}),
      mensaje: 'No se pudo completar el alta del Cliente Operam',
      detalle: err?.stack || String(err?.message ?? err),
    };
  }
}

// --- Upgrade fiscal (#367; #85, #207, #360, #253) ---------------------------
//
// La otra operacion del modulo (ADR-0017): completar un Cliente Operam que ya
// existe con sus datos fiscales reales -- la Constancia de Situacion Fiscal, o
// los minimos capturados a mano. NUNCA crea un Cliente Operam: el destino es
// siempre el id que recibe.
//
// `datosFiscales` es lo que el vendedor capturo, con las llaves de la CSF que ya
// hablan las funciones puras (rfc, razonSocial, nombreCorto, calle, ...,
// segmentoId, salesType, invoiceEmail, taxIdExtranjero, actividades, csf_fecha).
// El mapeo a los campos de Operam sigue siendo DIFF_FISCAL_CAMPOS, la UNICA
// fuente de las llaves de escritura y de lectura (#169).
//
// Resultado:
//   { tipo: 'lograda', clienteId, eco, camposNoAplicados, segmento, pasos }
//   { tipo: 'bloqueo', motivo: 'fusion', mensaje, detalle, dueno, pasos }
//   { tipo: 'bloqueo', motivo: 'operam'|'sin-lista-precios', mensaje, detalle, pasos }
export const FUENTE_CSF_UPGRADE = 'csf-upgrade';

const MENSAJE_CAMPO_IGNORADO = 'Operam no guardo este dato: sigue con el valor anterior';

// El nombre corto es el nombre COMERCIAL del cliente (CONTEXT.md "Nombre corto"),
// no su razon social normalizada: si ya hay uno escrito, el upgrade no lo pisa
// (#360). Solo se llena cuando esta vacio o cuando sigue siendo el que puso el
// alta generica -- es decir, el que buildClienteGenerico habria escrito con el
// nombre que el Cliente Operam tiene HOY (nace con el mismo texto en los dos).
function nombreCortoSustituible(clienteOperam) {
  const actual = String(clienteOperam?.cust_ref || '').trim();
  if (!actual) return true;
  const nombre = String(clienteOperam?.CustName || '').trim();
  const delAlta = buildClienteGenerico({ data: { cliente: { razonSocial: nombre, nombreCorto: nombre } } }).cust_ref || '';
  return coincideCustRef(actual, delAlta);
}

// El GET de Operam devuelve el segmento ANIDADO (`segmento: { id }`), nunca
// plano (#172).
function segmentoDe(clienteOperam) {
  const anidado = clienteOperam?.segmento?.id;
  return String((anidado == null ? clienteOperam?.segmento_id : anidado) ?? '');
}

// Campo que Operam no guardo -> Mensaje en dos capas: el vendedor lee que dato
// falta y con que valor se quedo, y el motivo tecnico (el eco del PUT o el error
// real de la web) va en el detalle.
function campoNoAplicado({ campo, label, anterior, nuevo, motivo }, clienteId) {
  return {
    campo, label,
    mensaje: `${MENSAJE_CAMPO_IGNORADO}: ${label} quedo en "${anterior || '(vacio)'}" y no en "${nuevo}"`,
    detalle: `PUT /customers/${clienteId} campo ${campo}: ${motivo}`,
    esperado: nuevo, leido: anterior,
  };
}

// Tax ID extranjero (#95 regla 5) y actividades economicas de la CSF (#171) no
// tienen campo propio en la API v3: viajan compuestos sobre las notas del
// cliente, asi que no estan en DIFF_FISCAL_CAMPOS y se verifican por su texto.
function notasNoAplicadas(fresco, datos, clienteId) {
  const notas = String(fresco?.notes || '');
  const salida = [];
  const pendiente = (label, esperado) => {
    if (notas.includes(esperado)) return;
    salida.push({
      campo: 'notes', label,
      mensaje: `${MENSAJE_CAMPO_IGNORADO}: ${label} no quedo en las notas del Cliente Operam`,
      detalle: `GET /customers/${clienteId} notes sin "${esperado}"`,
      esperado, leido: notas,
    });
  };
  if (datos.taxIdExtranjero) pendiente('Tax ID extranjero', `Tax ID: ${datos.taxIdExtranjero}`);
  if (Array.isArray(datos.actividades) && datos.actividades.length) {
    pendiente('Actividades economicas', datos.csf_fecha
      ? `Actividades economicas (CSF ${datos.csf_fecha}):`
      : 'Actividades economicas:');
  }
  return salida;
}

export async function upgradeFiscal(id, datosFiscales, deps = {}) {
  const io = deOperam(deps);
  const datos = datosFiscales || {};
  const rfc = normalizarRfc(datos.rfc);
  const razonSocial = datos.razonSocial || '';
  const pasos = [];

  // Gate anti-fusion por RFC exacto (#85) via el verificador compartido (#207):
  // un RFC que ya es de OTRO Cliente Operam significa que el prospecto resulto
  // ser un cliente formal que ya existia, y juntarlos es trabajo manual. Cero
  // escrituras.
  let verificacion;
  try {
    verificacion = await io.verificarRfcLibre(rfc, id);
  } catch (err) {
    pasos.push({
      name: 'gate RFC', status: 'error',
      mensaje: 'No se pudo comprobar en Operam si el RFC ya es de otro Cliente Operam',
      detalle: `GET /customers?tax_id=${rfc}: ${err.message}`,
    });
    return bloqueoDeOperam(err, {
      pasos, clienteId: id,
      mensaje: 'No se pudo comprobar en Operam si el RFC ya es de otro Cliente Operam',
      detalle: `GET /customers?tax_id=${rfc}`,
    });
  }
  if (verificacion.estado === 'otro') {
    const nombre = verificacion.dueno?.CustName || `el Cliente Operam ${verificacion.dueno?.cliente_id}`;
    const mensaje = `Este RFC ya pertenece a otro Cliente Operam (${nombre}): es una fusion manual`;
    const detalle = `RFC ${rfc} del Cliente Operam ${verificacion.dueno?.cliente_id}`;
    io.logCliente(rfc, razonSocial, 'fusion-bloqueada', verificacion.dueno?.cliente_id, FUENTE_CSF_UPGRADE, null, null);
    pasos.push({ name: 'gate RFC', status: 'error', mensaje, detalle });
    return {
      tipo: 'bloqueo', motivo: 'fusion', pasos, mensaje, detalle,
      dueno: { cliente_id: verificacion.dueno?.cliente_id, nombre },
    };
  }
  pasos.push({
    name: 'gate RFC', status: 'ok',
    mensaje: 'El RFC no es de ningun otro Cliente Operam',
    detalle: `verificarRfcLibre(${rfc}) -> ${verificacion.estado}`,
  });

  // Lectura previa: de aqui salen las tres cosas que solo se saben ANTES de
  // escribir -- el nombre corto que el cliente ya tenia (#360), sus notas (que
  // se componen, nunca se pisan) y el segmento con el que llego (#253). Que
  // falle no tumba el upgrade: se escribe lo que no depende de ella.
  let clienteAntes = null;
  try {
    clienteAntes = await io.obtenerClientePorId(id);
    if (!clienteAntes) throw new Error('Operam no devolvio el Cliente Operam');
    pasos.push({
      name: 'GET customer', status: 'ok',
      mensaje: 'Se leyo el Cliente Operam antes de escribirle',
      detalle: `GET /customers/${id}`,
    });
  } catch (err) {
    pasos.push({
      name: 'GET customer', status: 'error',
      mensaje: 'No se pudo leer el Cliente Operam antes de escribirle: se conservan su nombre corto y sus notas',
      detalle: `GET /customers/${id}: ${err.message}`,
    });
  }

  const payload = buildActualizarFiscalPayload(
    datos,
    // Sin la lectura previa no se sabe que notas tiene: null le dice al
    // constructor que OMITA notes en vez de reconstruirlas desde vacio.
    (datos.taxIdExtranjero || (Array.isArray(datos.actividades) && datos.actividades.length))
      ? (clienteAntes ? String(clienteAntes.notes || '') : null)
      : undefined
  );
  if ('cust_ref' in payload) {
    // Vacio NO es "borralo" (#360): el vendedor que no capturo nombre corto no
    // esta pidiendo quitarle al Cliente Operam el que ya tenia.
    const vacio = String(payload.cust_ref || '').trim() === '';
    const propio = !(clienteAntes && nombreCortoSustituible(clienteAntes));
    if (vacio || propio) {
      delete payload.cust_ref;
      pasos.push({
        name: 'nombre corto', status: 'omitido',
        mensaje: vacio
          ? 'No capturaste nombre corto: se conserva el que el Cliente Operam ya tenia'
          : 'El Cliente Operam ya tiene nombre corto propio: se conserva el que tenia',
        detalle: `cust_ref "${clienteAntes?.cust_ref ?? '(no se pudo leer)'}" conservado`,
      });
    }
  }

  let eco = null;
  try {
    eco = await io.actualizarClienteDirecto(id, payload);
    pasos.push({
      name: 'PUT customer (fiscal)', status: 'ok',
      mensaje: 'Se guardaron los datos fiscales en el Cliente Operam',
      detalle: `PUT /customers/${id}`,
    });
  } catch (err) {
    pasos.push({
      name: 'PUT customer (fiscal)', status: 'error',
      mensaje: 'No se pudieron guardar los datos fiscales en Operam',
      detalle: `PUT /customers/${id}: ${err.message}`,
    });
    io.logCliente(rfc, razonSocial, 'error', id, FUENTE_CSF_UPGRADE, null, err.message);
    // El nombre corto es UNICO GLOBAL en Operam (#242) y aqui es un campo que el
    // upgrade escribe: reintentar da el mismo 406, asi que el bloqueo tiene que
    // pedir lo unico que lo resuelve. Jamas se desambigua con un sufijo.
    if (esErrorCustRefDuplicado(err)) {
      return {
        tipo: 'bloqueo', motivo: 'cust-ref-duplicado', pasos, clienteId: id,
        mensaje: `El nombre corto${datos.nombreCorto ? ` "${datos.nombreCorto}"` : ''} ya lo usa otro Cliente Operam, que lo exige unico.` +
          ' Cambialo y vuelve a confirmar los datos fiscales.',
        detalle: `PUT /customers/${id}: ${err.message}`,
        nombreCorto: datos.nombreCorto || '',
      };
    }
    return bloqueoDeOperam(err, {
      pasos, clienteId: id,
      mensaje: 'No se pudieron guardar los datos fiscales en Operam',
      detalle: `PUT /customers/${id}`,
    });
  }

  // Post-fix del segmento por la web legacy (#172): la API v3 no lo escribe por
  // ningun camino. Preferencia ESPERAR (el vendedor esta mirando) y SIN "solo si
  // no tiene segmento": aqui el vendedor edita a proposito, y esta es la via
  // para corregir un segmento mal asignado (#253). Corre DESPUES del PUT (que ya
  // escribio el CP, sin el cual la ficha web no guarda) y ANTES de la relectura,
  // para que la verificacion vea el segmento ya aplicado.
  const segmentoAnterior = segmentoDe(clienteAntes);
  let segmentoFallo = null;
  if (datos.segmentoId) {
    const r = await io.actualizarSegmentoClienteWeb(id, datos.segmentoId);
    if (r.ok) {
      io.logCliente(rfc, razonSocial, 'segmento-escrito', id, FUENTE_CSF_UPGRADE, null,
        `Segmento ${segmentoAnterior || '(sin segmento)'} -> ${datos.segmentoId}`);
      pasos.push({
        name: 'segmento', status: 'ok',
        mensaje: 'Se guardo el segmento que elegiste en el Cliente Operam',
        detalle: `web legacy: segmento ${segmentoAnterior || '(sin segmento)'} -> ${datos.segmentoId}`,
      });
    } else {
      segmentoFallo = r.error;
      pasos.push({
        name: 'segmento', status: 'error',
        mensaje: 'No se pudo guardar el segmento en Operam: corrigelo en la ficha del cliente',
        detalle: `web legacy: ${r.error}`,
      });
    }
  } else {
    pasos.push({
      name: 'segmento', status: 'omitido',
      mensaje: 'No elegiste segmento: se conserva el que el Cliente Operam ya tenia',
      detalle: `segmento ${segmentoAnterior || '(sin segmento)'} sin cambios`,
    });
  }

  // Releer y comparar SIEMPRE: Operam responde 200 aunque ignore campos en
  // silencio (#74). El eco del PUT es lo unico que ABSUELVE a los campos que el
  // GET de detalle no expone (idcif, invoice_email).
  let camposPendientes = [];
  let segmentoActual = segmentoAnterior;
  try {
    const fresco = await io.obtenerClientePorId(id);
    if (!fresco) throw new Error('Operam no devolvio el Cliente Operam en la relectura');
    // El padron cacheado se entera aqui (#327): la entrada fresca ya esta en la
    // mano y releerlo entero costaria el padron paginado completo.
    io.actualizarClienteEnCache(fresco);
    segmentoActual = segmentoDe(fresco);
    camposPendientes = camposNoAplicados(calcularDiffFiscal(fresco, datos), eco)
      // Un segmento que la web no pudo escribir ya se reporto como paso, con el
      // motivo real: repetirlo como campo ignorado diria que lo ignoro el PUT,
      // que es falso -- la API v3 nunca lo escribe.
      .filter(c => !(segmentoFallo && c.campo === 'segmento_id'))
      .map(c => campoNoAplicado(c, id))
      .concat(notasNoAplicadas(fresco, datos, id));
    pasos.push(camposPendientes.length
      ? {
        name: 'verificar fiscal', status: 'warn',
        mensaje: 'Operam no guardo todos los datos fiscales: revisa los campos pendientes',
        detalle: `GET /customers/${id}: ${camposPendientes.map(c => c.campo).join(', ')}`,
        camposNoActualizados: camposPendientes,
      }
      : {
        name: 'verificar fiscal', status: 'ok',
        mensaje: 'Los datos fiscales quedaron guardados en Operam',
        detalle: `GET /customers/${id}`,
      });
  } catch (err) {
    pasos.push({
      name: 'verificar fiscal', status: 'error',
      mensaje: 'No se pudo comprobar en Operam que los datos fiscales quedaran guardados',
      detalle: `GET /customers/${id}: ${err.message}`,
    });
    // Sin entrada fresca que meterle al padron, el unico camino honesto es
    // releerlo entero -- fire-and-forget, el vendedor no espera por esto (#327).
    io.refrescarIndice().catch(e => console.warn('[indice-telefonos] refresh tras upgrade fallo:', e.message));
  }

  io.logCliente(rfc, razonSocial, 'actualizado', id, FUENTE_CSF_UPGRADE, null,
    pasos.some(p => p.name === 'verificar fiscal' && p.status === 'error')
      ? 'La verificacion post-PUT fallo (el PUT si se aplico)'
      : null);

  return {
    tipo: 'lograda', clienteId: id, eco,
    camposNoAplicados: camposPendientes,
    segmento: { anterior: segmentoAnterior, actual: segmentoActual },
    pasos,
  };
}
