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
    // Telefono para el buscador del pipeline (#289) y por donde la tarjeta
    // hereda el Origen del Contacto (#287): la cotizacion lo trae con ese
    // nombre, el prospecto como celular, y los dos se buscan igual.
    telefono: telefonoWa(cli.celEntrega || cli.telefono),
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

// Las tarjetas visibles para quien pregunta, en todas las etapas. Recibe lo que
// la ruta ya filtro por visibilidad -- una cotizacion que el vendedor no ve
// tampoco puede callar la tarjeta del prospecto que si ve.
//
// La liga prospecto -> cotizaciones es la MISMA de la Tabla de prospectos
// (cotizacionesDelProspecto, #319): evento 'cotizacion' o celular del cliente de
// la cotizacion. Una sola definicion de "esta Oportunidad ya es una cotizacion".
//
// Solo callan la tarjeta del prospecto las cotizaciones VIVAS (cotizacionesVivas,
// tambien de #319): una cotizacion que ya salio del embudo -- Perdida o No util --
// no es una Oportunidad que la reemplace en el tablero, y sin esta guarda el
// prospecto activo desapareceria de las 7 columnas sin dejar tarjeta en ninguna
// parte.
export function tarjetasOportunidades(prospectos, cotizaciones) {
  const cots = cotizaciones || [];
  const sinCotizacion = (prospectos || [])
    .filter(p => cotizacionesVivas(cotizacionesDelProspecto(p, cots)).length === 0);
  return [
    ...sinCotizacion.map(prospectoAOportunidad),
    ...cots.map(cotizacionAOportunidad),
  ];
}
