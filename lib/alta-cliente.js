import { RFC_GENERICOS, detectarDuplicados, normalizarNombre, hechosCandidato, agregarCandidatosPorCustRef, coincideCustRef, poolClientesParaDedup } from './deduplicacion.js';
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
  actualizarBranchCliente, listarSalesTypes,
} from './operam-client.js';
import { actualizarSegmentoClienteWeb } from './operam-web.js';
import { clientesCacheados, actualizarClienteEnCache } from './indice-telefonos.js';
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
//   datosFiscales: null | { ... }
//       null = Cliente Operam sin datos fiscales; el modulo elige el RFC
//       generico que le toca por pais (rfcGenericoDe). Los datos fiscales
//       reales los consume el alta completa (#366).
//   comercial: { vendedor, tier, salesTypeId, segmentoId, correoFacturacion, usoCfdi }
//       `salesTypeId` gana sobre `tier`: quien ya tiene el catalogo de listas de
//       precios en la mano lo resuelve y ahorra la lectura; sin el, el modulo
//       pide el catalogo (listarSalesTypes) y mapea el tier.
//   domicilioEntrega: { nombre, calle, numInt, colonia, municipio, estado, cp,
//                       referencias, telefono, correo }
//   ligaFija: { clienteId, domicilioId }
//       El Cliente Operam al que quien pide el alta YA esta ligado (la liga de
//       la cotizacion es fija) y el domicilio de entrega que ya trae anotado.
//   decision: null | { tipo: 'usar' | 'otro-domicilio' | 'ninguno', clienteId }
//       La salida que eligio el vendedor ante la pregunta de duplicado.
//       El segmento comercial viaja en `comercial.segmentoId`.
//   segmento: { preferencia: 'diferido' | 'esperar' }
//       Quien ESPERA la escritura del segmento por la web legacy y quien no
//       (#365). `esperar` la reporta como un paso mas; `diferido` (la subida de
//       la cotizacion, cuya latencia manda) la dispara sin esperarla y anota su
//       fallo en la auditoria como segmento pendiente, visible en /admin. Sin
//       valor se asume `diferido`.
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
//   de operam-web:       actualizarSegmentoClienteWeb
//
// El padron se refresca con actualizarClienteEnCache y no con refrescarIndice:
// el alta ya relee al cliente recien creado para verificar el Cel, asi que la
// entrada fresca esta en la mano y un refresco completo seria releer el padron
// paginado entero por un cliente (mismo criterio de #327).

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
    actualizarSegmentoClienteWeb: deps.actualizarSegmentoClienteWeb || actualizarSegmentoClienteWeb,
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
    calle: dom.calle || '',
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
  return id.razonSocial || id.nombreCorto || id.nombreVisible || '';
}

// La deduplicacion en capas de ADR-0001 sobre los DOS RFC genericos a la vez
// (#244) mas la busqueda del nombre corto en el padron COMPLETO (#242): Operam
// exige `cust_ref` unico global sin importar el RFC, asi que un choque es el
// unico camino que puede DESCUBRIR que el cliente ya existe bajo un RFC real.
// El padron es best effort (clientesCacheados nunca lanza): con la cache fria el
// respaldo es el 406 traducido mas abajo. Se devuelve para nombrar al dueno del
// nombre corto si el POST choca.
async function poolDedup(solicitud, io) {
  const c = clienteCapturado(solicitud);
  const rfcGenerico = rfcGenericoDe(c);
  const nombre = nombreDeAlta(solicitud);
  const [pools, padron] = await Promise.all([
    Promise.all([...RFC_GENERICOS].map(g => io.buscarClientesPorRfc(g))),
    // 5 s y no el default largo: aqui hay un vendedor esperando.
    io.clientesCacheados({ timeoutMs: 5000 }),
  ]);
  const dedup = detectarDuplicados(rfcGenerico, nombre, poolClientesParaDedup(pools));
  return { rfcGenerico, nombre, padron, dedup: agregarCandidatosPorCustRef(dedup, padron, c.nombreCorto) };
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

function esErrorCustRefDuplicado(err) {
  return /same cust_ref/i.test(String(err?.message || ''));
}

// Traduccion del 406 de cust_ref duplicado (#242) a algo que el vendedor pueda
// EJECUTAR: reintentar da exactamente el mismo error, porque el nombre corto es
// unico global en Operam. Si el padron alcanza a nombrar al dueno, se nombra:
// saber contra que se choco es la diferencia entre cambiar el nombre corto a
// ciegas y darse cuenta de que ese cliente ya existia. Jamas se desambigua con
// un sufijo automatico: esconderia el hallazgo.
function mensajeCustRefDuplicado(nombreCorto, padron) {
  const dueno = (padron || []).find(k => coincideCustRef(k?.cust_ref, nombreCorto));
  const quien = dueno
    ? ` Lo usa ${dueno.CustName || `el Cliente Operam ${dueno.customer_id}`}${dueno.tax_id ? ` (RFC ${dueno.tax_id})` : ''}.`
    : '';
  const cual = nombreCorto ? ` "${nombreCorto}"` : '';
  return `El nombre corto${cual} ya lo usa otro Cliente Operam, que lo exige unico.${quien}` +
    ' Cambia el nombre corto y vuelve a generar la cotizacion.';
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

// Vendedor -> su `salesman` de Operam (que Operam guarda en el domicilio de
// entrega, no en el cliente; ver docs/arquitectura.md).
async function salesmanDeVendedor(nombreVendedor, io) {
  return (await io.listar()).find(v => v.name === nombreVendedor)?.operam_id ?? undefined;
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
    Promise.resolve()
      .then(() => io.actualizarSegmentoClienteWeb(clienteId, segmentoId, { soloSinSegmento: true }))
      .then(r => {
        if (r?.ok) return;
        anotarSegmentoPendiente(io, { clienteId, rfc, nombre, fuente, detalle: `web legacy de Operam: ${r?.error ?? '(sin motivo)'}` });
      })
      .catch(err => {
        anotarSegmentoPendiente(io, { clienteId, rfc, nombre, fuente, detalle: `web legacy de Operam: ${err?.message ?? err}` });
      });
    pasos.push({
      name: 'segmento', status: 'omitido',
      mensaje: 'El segmento se escribe despues para no demorar la cotizacion',
      detalle: `cliente ${clienteId} -> segmento ${segmentoId} diferido; un fallo queda como segmento pendiente en la auditoria`,
    });
    return;
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
  let clienteId = idElegido;
  let creadoNuevo = false;
  let salesman;

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
      if (!frescos.some(k => String(k.customer_id) === String(clienteId))) {
        const ctx = contextoHechos(c, nombreRevalida);
        return {
          tipo: 'pregunta', motivo: 'candidatos', pasos,
          mensaje: 'El Cliente Operam que elegiste ya no esta en la lista de parecidos: elige uno para continuar',
          detalle: `cliente ${clienteId} fuera del pool recalculado`,
          opciones: ['usar', 'otro-domicilio', 'ninguno'],
          candidatos: frescos.map(k => candidatoParaContrato(k, ctx)),
        };
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
      const { rfcGenerico, nombre, padron, dedup } = await poolDedup(s, io);
      if (dedup.tipo === 'candidatos' && !crearNuevo) {
        const ctx = contextoHechos(c, nombre);
        return {
          tipo: 'pregunta', motivo: 'candidatos', pasos,
          mensaje: 'Hay Clientes Operam sin datos fiscales con nombre parecido: elige uno para continuar',
          detalle: `pool por RFC generico + nombre corto: ${dedup.candidatos.map(k => k.customer_id).join(', ')}`,
          opciones: ['usar', 'otro-domicilio', 'ninguno'],
          candidatos: dedup.candidatos.map(k => candidatoParaContrato(k, ctx)),
        };
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
          detalle: `sin candidatos para "${nombre}" (${rfcGenerico})`,
        });

      salesman = await salesmanDeVendedor(s.comercial?.vendedor, io);
      const salesTypeId = await salesTypeDeLaSolicitud(s.comercial, io);
      let creado;
      try {
        // crearClienteDirecto: SIN la dedup por RFC exacto de crearCliente (con
        // RFC generico devolveria cualquier generico existente; la dedup
        // correcta por nombre ya corrio arriba).
        creado = await io.crearClienteDirecto(buildClienteGenerico(
          { data: { cliente: c }, cliente: s.identidad?.nombreVisible || '' },
          { salesman, salesTypeId },
        ));
      } catch (err) {
        pasos.push({
          name: 'POST customer', status: 'error',
          mensaje: 'No se pudo crear el Cliente Operam en Operam',
          detalle: `POST /customers: ${err.message}`,
        });
        io.logCliente(rfcGenerico, nombre, 'error', null, FUENTE_ALTA_GENERICA, null, err.message);
        if (esErrorCustRefDuplicado(err)) {
          return {
            tipo: 'bloqueo', motivo: 'cust-ref-duplicado', pasos,
            mensaje: mensajeCustRefDuplicado(c.nombreCorto, padron),
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
      io.logCliente(rfcGenerico, nombre, forzado ? 'creado-forzado' : 'creado', clienteId, FUENTE_ALTA_GENERICA, null,
        forzado ? `El vendedor eligio "ninguno es el mismo cliente" pese a los candidatos ${forzado} (#204)` : null);
      pasos.push({
        name: 'log auditoria', status: 'ok',
        mensaje: 'El alta quedo registrada en la auditoria',
        detalle: FUENTE_ALTA_GENERICA,
      });
    }

    // Con un cliente elegido NUNCA se reutiliza un domicilio de entrega ya
    // anotado (pudo capturarse para OTRO cliente): se resuelve siempre el del
    // elegido. La EXCEPCION es el domicilio nuevo (#211): si la liga fija ya
    // apunta a ESTE mismo cliente y trae domicilio, ese domicilio ES el que este
    // mismo camino creo en un intento anterior -- reusarlo es lo que impide que
    // un reintento cree un segundo domicilio identico.
    let domicilioId = idElegido != null ? null : (s.ligaFija?.domicilioId ?? null);
    if (crearDomicilio && String(s.ligaFija?.clienteId ?? '') === String(clienteId)) {
      domicilioId = s.ligaFija?.domicilioId ?? null;
    }
    // LA bandera del ADR: solo lo que ESTA corrida escribio se verifica. Un
    // domicilio reusado de un intento anterior no se toco aqui, y sobre un
    // domicilio que no acaba de crearse nunca se escribe.
    let domicilioEscritoAqui = false;

    if (crearDomicilio && domicilioId == null) {
      if (salesman === undefined) salesman = await salesmanDeVendedor(s.comercial?.vendedor, io);
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
        io.logCliente(rfcGenericoDe(c), nombreDeAlta(s), 'creado', clienteId, FUENTE_SUCURSAL_CREADA, null,
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
        io.logCliente(rfcGenericoDe(c), nombreDeAlta(s), 'error', clienteId, FUENTE_SUCURSAL_CREADA, null, err.message);
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

    // El POST de Operam ignora dimension_id/dimension2_id (#74): se persisten
    // por PUT, no bloqueante.
    if (creadoNuevo) {
      try {
        await io.actualizarClienteDirecto(clienteId, { dimension_id: 1, dimension2_id: 5 });
        pasos.push({
          name: 'PUT customer (dimensiones)', status: 'ok',
          mensaje: 'Se guardo la clasificacion interna del Cliente Operam',
          detalle: `PUT /customers/${clienteId} dimension_id=1 dimension2_id=5`,
        });
      } catch (err) {
        pasos.push({
          name: 'PUT customer (dimensiones)', status: 'error',
          mensaje: 'No se guardo la clasificacion interna del Cliente Operam',
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
    } else {
      pasos.push({
        name: 'PUT branch (domicilio)', status: 'omitido',
        mensaje: 'El Cliente Operam ya existia: no se toco su domicilio de entrega',
        detalle: `branch ${domicilioId} preexistente`,
      });
    }

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

    await pasoSegmento(s, { io, pasos, clienteId, rfc: rfcGenericoDe(c), nombre: nombreDeAlta(s) });

    return { tipo: 'lograda', clienteId, domicilioId, creadoNuevo, pasos };
  } catch (err) {
    return {
      tipo: 'bloqueo', motivo: 'inesperado', pasos,
      ...(clienteId != null ? { clienteId } : {}),
      mensaje: 'No se pudo completar el alta del Cliente Operam',
      detalle: err?.stack || String(err?.message ?? err),
    };
  }
}
