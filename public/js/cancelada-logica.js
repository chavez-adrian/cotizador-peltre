// Nucleo PURO de la salida Cancelada (#484, GLOSSARY.md "Cancelada"; decision de
// Adrian 2026-09-28): la Oportunidad que si llego a pedido y despues se cayo (el
// Contacto pago y se echo para atras). Es la unica salida posible con pedido
// (sin pedido, la salida es Perdida), la decide solo el admin y lleva motivo en
// TEXTO LIBRE obligatorio, no de catalogo. No cancela nada en Operam: solo saca
// la tarjeta del tablero. No se confunde con "cancelado" (el documento anulado en
// Operam, lib/cancelados.js).
//
// Lo consumen server.js (PATCH /api/cotizacion/:id/estado con estado cancelada)
// y la tarjeta del tablero, para que el que decide y el que pinta no diverjan.
// "Tiene pedido" es LA regla de #482 (perdida-logica.js), no otra.

import { tienePedido, notaLimpia, motivoDeSalida } from './perdida-logica.js';

export const MENSAJE_CANCELADA_SOLO_ADMIN = 'Solo el administrador puede cerrar una oportunidad como Cancelada.';
export const MENSAJE_CANCELADA_SIN_PEDIDO = 'Esta oportunidad no tiene pedido en Operam: no se cancela, ci\u00e9rrala como Perdida.';
export const MENSAJE_CANCELADA_NO_CAMBIA = 'Esta oportunidad ya est\u00e1 Cancelada: su estado ya no cambia. Si el cliente vuelve, abre una Nueva oportunidad.';
export const MENSAJE_SIN_MOTIVO_CANCELADA = 'Escribe el motivo de la cancelaci\u00f3n';

// Una Cancelada ya salio del tablero y no se reabre (reabrirla no esta en el
// alcance): manda la etapa, que es por la que el tablero reparte.
export function esCancelada(o) {
  return o?.etapa === 'cancelada';
}

// El motivo es texto libre: vacio o solo espacios no cuenta.
export function errorMotivoCancelada(motivo) {
  return notaLimpia(motivo) ? null : MENSAJE_SIN_MOTIVO_CANCELADA;
}

// Se ofrece solo al admin y solo sobre una Oportunidad con pedido. Quien pinta
// ya excluye las que salieron del embudo.
export function puedeCancelar(o, esAdmin) {
  return esAdmin === true && tienePedido(o);
}

// El motivo vive en el evento del cierre (etapa -> cancelada), como el de
// Perdida; manda el ULTIMO cierre.
export function camposMotivoCancelada(eventos) {
  return { motivoCancelada: motivoDeSalida(eventos, 'cancelada')?.motivo ?? null };
}
