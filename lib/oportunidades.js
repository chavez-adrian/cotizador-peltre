// Nucleo puro de las tarjetas del tablero (#340, spec #337, ADR-0016): las dos
// fuentes que el navegador fusionaba (prospectos y cotizaciones) se resuelven
// aqui, en una sola lista de Oportunidades con forma homogenea.
//
// La regla que este modulo hace cumplir es la del glosario (CONTEXT.md
// "Oportunidad"): toda tarjeta es una Oportunidad, y el prospecto cuya
// Oportunidad YA es una cotizacion no genera tarjeta propia. Sin ella la misma
// persona salia dos veces -- la tarjeta inerte del prospecto y la de su
// cotizacion avanzando.
//
// Sin IO: la ruta lee los stores, filtra por visibilidad y llama aqui.

import { telefonoWa } from './seguimiento.js';
import { cotizacionesDelProspecto, cotizacionesVivas } from './tabla-prospectos.js';
import { esContactoSinCaptura } from './contacto-cotizacion.js';

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
    // Folio de Operam de un prospecto movido a mano (issue #56): vive en el bag
    // data porque cotizo por fuera (no hay cotizacion en el sistema). La tarjeta
    // pinta "Cotizacion N" solo si hay folio (nunca PRE, eso es de cotizaciones).
    folioOperam: p.data?.folioOperam ?? null,
    // Motivo de la salida a No util (issue #59, AC3): lo muestra el filtro de
    // cerradas.
    motivoNoUtil: motivoNoUtilDe(p),
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
    // Telefono para el buscador del pipeline (#289) y para el link de WhatsApp:
    // el del DOCUMENTO, que es a donde se le escribe.
    telefono: telefonoWa(cli.celEntrega || cli.telefono),
    // El Contacto de la Oportunidad (#342, ADR-0016): la liga fija por la que la
    // tarjeta hereda su Origen (#287) y por la que se sabe de quien es. null =
    // "sin Contacto", y la tarjeta lo dice y ofrece capturarlo a mano.
    contactoCelular: c.contactoCelular ?? null,
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
export function tarjetasOportunidades(prospectos, cotizaciones) {
  const cots = cotizaciones || [];
  const sinCotizacion = (prospectos || [])
    .filter(p => !esContactoSinCaptura(p))
    .filter(p => cotizacionesVivas(cotizacionesDelProspecto(p, cots)).length === 0);
  return [
    ...sinCotizacion.map(prospectoAOportunidad),
    ...cots.map(cotizacionAOportunidad),
  ];
}
