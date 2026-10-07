// Nucleo puro de las tarjetas del tablero (#340, spec #337, ADR-0016): las dos
// fuentes que el navegador fusionaba (prospectos y cotizaciones) se resuelven
// aqui, en una sola lista de Oportunidades con forma homogenea.
//
// La regla que este modulo hace cumplir es la del glosario (GLOSSARY.md
// "Oportunidad"): toda tarjeta es una Oportunidad, y el prospecto cuya
// Oportunidad YA es una cotizacion no genera tarjeta propia. Sin ella la misma
// persona salia dos veces -- la tarjeta inerte del prospecto y la de su
// cotizacion avanzando.
//
// Sin IO: la ruta lee los stores, filtra por visibilidad y llama aqui.

import { telefonoWa, pasoPendiente, mensajeSeguimiento, cerradaParaSeguimiento } from './seguimiento.js';
import { reunionFuturaDe } from '../public/js/prospectos-logica.js';
import { ultimos10 } from './telefono-llave.js';
import { indiceContactosPorCelular } from './etiquetas-contacto.js';
import { cotizacionesDelProspecto, cotizacionesVivas, faltaCotizar, estadoProspecto } from './tabla-prospectos.js';
import { esContactoSinCaptura, celularesDeCruce } from './contacto-cotizacion.js';
import { esSalida } from './pipeline.js';
import { camposMotivoPerdida } from '../public/js/perdida-logica.js';
import { camposMotivoCancelada } from '../public/js/cancelada-logica.js';

// El motivo de la salida a No util vive en el evento no_util (issue #59, AC3):
// el filtro de cerradas lo muestra. El ultimo evento no_util manda.
function motivoNoUtilDe(p) {
  let motivo = null;
  for (const e of (p && p.eventos) || []) {
    if (e.tipo === 'no_util' && e.motivo) motivo = e.motivo;
  }
  return motivo;
}

// Tarjeta de una Oportunidad todavia sin cotizacion (el registro de prospecto).
// El id lleva prefijo porque las dos clases de tarjeta comparten lista; `refId`
// es el id real con el que se dispara la accion.
export function prospectoAOportunidad(p) {
  return {
    tipo: 'prospecto', id: `p${p.id}`, refId: p.id, nombre: p.nombre,
    vendedor: p.vendedor, ciudad: p.ciudad, canal: p.canal, etapa: p.etapa,
    total: 0, fecha: p.fecha,
    // Celular para el buscador del pipeline (#289): match por digitos.
    celular: p.celular,
    // El correo de la ficha del Contacto (#519): el acceso de Correo de la tarjeta.
    correo: textoONull(p.data?.correo),
    // Folio de Operam de un prospecto movido a mano (issue #56): vive en el bag
    // data porque cotizo por fuera (no hay cotizacion en el sistema). La tarjeta
    // pinta "Cotizacion N" solo si hay folio (nunca PRE, eso es de cotizaciones).
    folioOperam: p.data?.folioOperam ?? null,
    // Motivo de la salida a No util (issue #59, AC3): lo muestra el filtro de
    // cerradas.
    motivoNoUtil: motivoNoUtilDe(p),
    // Motivo de Perdida y su nota (#483): los muestra el filtro de cerradas.
    ...camposMotivoPerdida(p.eventos),
    // El motivo de la Cancelada (#484): la Oportunidad que cierra junto con su cotizacion.
    ...camposMotivoCancelada(p.eventos),
    // Evento de expo (issue #261): el filtro del pipeline responde cuantos
    // prospectos dejo Abastur.
    evento: p.data?.evento ?? null,
    // El Cliente Operam ligado al Contacto (#344): el que dejo ligarCliente al
    // dar de alta sin cotizar todavia. La ruta lo cambia por sus dos estados.
    clienteOperamId: p.data?.cliente_id ?? null,
  };
}

// Tarjeta de una Oportunidad ya cotizada, desde el registro del store (no desde
// la fila aplanada del Historial): el aplanado de GET /api/cotizaciones sirve a
// otra vista y no tiene por que viajar entero en cada tarjeta.
export function cotizacionAOportunidad(c) {
  const cli = c.data?.cliente || {};
  return {
    tipo: 'cotizacion', id: `c${c.id}`, refId: c.id, nombre: c.cliente,
    vendedor: c.vendedor, etapa: c.etapa, total: c.total, totalPiezas: c.totalPiezas,
    fecha: c.fecha, folioOperam: c.folioOperam ?? null,
    // El gate de Editar (#502, puedeActualizarCotizacion) con la MISMA
    // semantica que la fila del Historial en GET /api/cotizaciones.
    hasData: !!c.data, orderOperam: c.data?.orderOperam ?? null,
    // Telefono para el buscador del pipeline (#289) y para el link de WhatsApp:
    // el del DOCUMENTO, que es a donde se le escribe.
    telefono: telefonoWa(cli.celEntrega || cli.telefono),
    // El Contacto de la Oportunidad (#342, ADR-0016): la liga fija por la que la
    // tarjeta hereda su Origen (#287) y por la que se sabe de quien es. null =
    // "sin Contacto", y la tarjeta lo dice y ofrece capturarlo a mano.
    contactoCelular: c.contactoCelular ?? null,
    // El celular por el que esta Oportunidad cruza contra su Contacto (#344):
    // la liga fija si la tiene y, en una historica que la migracion no ha
    // tocado, lo tecleado. NO se recalcula aqui: sale de `celularesDeCruce`
    // (#342), que es LA definicion de ese cruce -- la misma que usan el
    // tablero, el Historial, Hoy y la Tabla de prospectos.
    celularCruce: celularesDeCruce(c)[0] ?? null,
    // El Cliente Operam al que se cotizo (#344): la liga que tampoco se mueve
    // (ADR-0016). Viaja como id pelado; la ruta le agrega sus dos estados, que
    // se derivan de Operam y no de la cotizacion.
    clienteOperamId: cli.customerId ?? null,
    decorado: c.data?.decorado === true,
    calcaChecklist: c.data?.calcaChecklist ?? null,
    // Cadena de folios de Operam (issue #67, AC4): el espejo persistido por el
    // sync que la tarjeta pinta para trazabilidad.
    espejoOperam: c.data?.espejoOperam ?? null,
    // Pago sin registrar (issue #77): la entregada-impaga muestra el badge hasta
    // que el sync detecte el pago y apague el flag.
    pagoSinRegistrar: c.data?.pagoSinRegistrar === true,
    // Comprobante de pago (#485): archivos y fecha que Dropbox confirmo; sin el,
    // la tarjeta post-venta pinta "Falta comprobante".
    comprobantesPago: c.data?.comprobantesPago ?? null,
    // Hubo anticipo (#486): la venta va a dos pagos y lleva comprobante del saldo.
    huboAnticipo: c.data?.huboAnticipo === true,
    // Motivo de Perdida y su nota (#483): los muestra el filtro de cerradas.
    ...camposMotivoPerdida(c.eventos),
    // El motivo de la Cancelada (#484): lo muestra el filtro de cerradas.
    ...camposMotivoCancelada(c.eventos),
  };
}

// Un Contacto nacido de la migracion (#342) no tiene tarjeta propia: existe
// para que su Oportunidad tenga de quien ser, pero nadie lo capturo y no hay
// ninguna intencion de compra abierta suya que trabajar. Si su cotizacion sigue
// viva, la tarjeta es esa; si ya salio del embudo, no hay tarjeta -- que es
// distinto de la tarjeta inerte que el tablero venia a quitar.
//
// Sin esta guarda, las 14 cotizaciones con telefono sin prospecto y las que
// resuelve el indice de Operam habrian aparecido como tarjetas de personas que
// nadie prospecto nunca.
//
// Las tarjetas visibles para quien pregunta, en todas las etapas. Recibe lo que
// la ruta ya filtro por visibilidad -- una cotizacion que el vendedor no ve
// tampoco puede callar la tarjeta del prospecto que si ve.
//
// La liga prospecto -> cotizaciones es la MISMA de la Tabla de prospectos
// (cotizacionesDelProspecto, #319): evento 'cotizacion' o el celular con el que
// la cotizacion cruza -- desde #342, su Contacto anotado. Una sola definicion de
// "esta Oportunidad ya es una cotizacion".
//
// Solo callan la tarjeta del prospecto las cotizaciones VIVAS (cotizacionesVivas,
// tambien de #319): una cotizacion que ya salio del embudo -- Perdida o No util --
// no es una Oportunidad que la reemplace en el tablero, y sin esta guarda el
// prospecto activo desapareceria de las 7 columnas sin dejar tarjeta en ninguna
// parte.
// Las cotizaciones que representan a ESTA Oportunidad (#343): una Oportunidad
// con registro propio solo la representa la cotizacion que nacio de ella (el
// evento 'cotizacion'), nunca el celular. Desde la separacion un Contacto puede
// tener varias Oportunidades, y el cruce por celular -- que sigue siendo el
// correcto mientras la Oportunidad ES la fila del Contacto -- las callaria
// TODAS con una sola cotizacion.
export function cotizacionesDeLaOportunidad(op, cotizaciones) {
  return op && op.propia
    ? cotizacionesDelProspecto({ eventos: op.eventos }, cotizaciones)
    : cotizacionesDelProspecto(op, cotizaciones);
}

// #481 (decision de Adrian 2026-09-30): las Oportunidades que se cierran como
// Perdida junto con la cotizacion que se pierde -- la que nacio de ELLA, con la
// misma liga que la calla en el tablero (cotizacionesDeLaOportunidad). Sin esto
// la tarjeta volvia a Seguimiento en cuanto la cotizacion salia del embudo.
// Recibe TODAS las filas, sin filtro de visibilidad: el cierre es consecuencia
// de perder la cotizacion, no algo que decida quien pregunta.
// Mientras la Oportunidad conserve OTRA cotizacion viva no se cierra: su tarjeta
// sigue callada y esa otra todavia puede llegar a pedido (GLOSSARY.md "Perdida").
// Tampoco la que ya salio del embudo, ni el Contacto sin captura (#342), que no
// es una Oportunidad sino de quien es la cotizacion.
export function oportunidadesQueCierraLaPerdida(filas, cotizacion, cotizaciones) {
  const otras = (cotizaciones || []).filter(c => c.id !== cotizacion.id);
  return (filas || [])
    .filter(op => op.propia || !esContactoSinCaptura(op))
    .filter(op => !esSalida(op.etapa))
    .filter(op => cotizacionesDeLaOportunidad(op, [cotizacion]).length > 0)
    .filter(op => cotizacionesVivas(cotizacionesDeLaOportunidad(op, otras)).length === 0);
}

// #400: los ids de las Oportunidades que llevan la etiqueta "Ya tiene Cliente
// Operam, falta cotizar" (GLOSSARY.md). El juicio es `faltaCotizar` y la liga con
// sus cotizaciones es la MISMA que usa la tarjeta del tablero y la Tabla de
// prospectos (cotizacionesDeLaOportunidad, #343): un solo criterio de "esta
// Oportunidad ya es una cotizacion" en todas las pantallas.
//
// Recibe lo que la ruta ya filtro por visibilidad, igual que las tarjetas: una
// cotizacion que el vendedor no ve tampoco puede callarle la etiqueta -- asi la
// senal no le cuenta de cotizaciones ajenas. El Set lo consumen la lista de
// Prospectos y la cola, que solo pintan lo que aqui se decidio.
export function oportunidadesQueFaltaCotizar(oportunidades, cotizaciones) {
  const cots = cotizaciones || [];
  return new Set((oportunidades || [])
    .filter(op => faltaCotizar(op, cotizacionesDeLaOportunidad(op, cots)))
    .map(op => op.id));
}

// #457 (spec #398): el Estado del prospecto de cada Oportunidad (id -> estado),
// para el selector de la vista Prospectos. EL juicio es `estadoProspecto` con la
// misma liga y la misma visibilidad que la fila de la Tabla de prospectos: las
// dos pantallas no pueden discrepar. Lo anotan GET /api/prospectos y la cola.
export function estadosDeOportunidades(oportunidades, cotizaciones, ahora = new Date()) {
  const cots = cotizaciones || [];
  return new Map((oportunidades || [])
    .map(op => [op.id, estadoProspecto(op, cotizacionesDeLaOportunidad(op, cots), ahora)]));
}

function textoONull(correo) {
  const limpio = String(correo ?? '').trim();
  return limpio || null;
}

// Los accesos de WhatsApp y Correo de la tarjeta de cotizacion (#519). El correo
// es el del Contacto (su ficha) y, si no tiene, el de entrega de la cotizacion.
// El mensaje de seguimiento es el MISMO que la cola Hoy (mensajeSeguimiento con
// su paso pendiente) y solo en Seguimiento, con los descartes de Hoy: cerrada
// (una ganada sigue en Seguimiento) o con reunion futura, sin mensaje. La forma
// del correo la valida quien pinta el acceso. Se resuelve aqui
// porque lib/ no viaja al navegador: la tarjeta pinta lo que recibe.
function contactoDirectoDeCotizacion(c, indiceContactos, ahora) {
  const delContacto = indiceContactos.get(ultimos10(c.contactoCelular));
  const paso = c.etapa === 'seguimiento' && !cerradaParaSeguimiento(c) && !reunionFuturaDe(c.seguimientos || [], ahora)
    ? pasoPendiente(c, ahora) : null;
  return {
    correo: textoONull(delContacto?.data?.correo) ?? textoONull(c.data?.cliente?.emailEntrega),
    mensajeSeguimiento: paso ? mensajeSeguimiento(c, paso) : null,
  };
}

// `contactos` (#519) son las fichas de donde sale el correo de la cotizacion; sin
// ellas bastan las filas de prospecto que llegan. `ahora` decide el paso de
// cadencia del mensaje de WhatsApp.
export function tarjetasOportunidades(prospectos, cotizaciones, { contactos, ahora = new Date() } = {}) {
  const cots = cotizaciones || [];
  const indiceContactos = indiceContactosPorCelular(contactos || prospectos);
  const sinCotizacion = (prospectos || [])
    // La marca de "nadie lo capturo" es del CONTACTO, no de la intencion: una
    // Nueva oportunidad abierta sobre un Contacto historico SI es una tarjeta.
    .filter(p => p.propia || !esContactoSinCaptura(p))
    .filter(p => cotizacionesVivas(cotizacionesDeLaOportunidad(p, cots)).length === 0);
  return [
    ...sinCotizacion.map(prospectoAOportunidad),
    ...cots.map(c => ({ ...cotizacionAOportunidad(c), ...contactoDirectoDeCotizacion(c, indiceContactos, ahora) })),
  ];
}
