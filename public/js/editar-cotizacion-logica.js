// Editar una cotizacion (#104, ADR-0008; #502): el gate y su boton, en un
// modulo HOJA. Lo consumen cotizaciones-logica.js (Historial y "Cotizaciones
// previas", junto a Copiar) y pipeline-logica.js (la tarjeta del tablero y la
// fila de la lista, solo Editar); como cotizaciones-logica.js ya importa
// pipeline-logica.js, vivir en cualquiera de los dos cerraria un ciclo.

import { escapeHtml } from './prospectos-logica.js';

// Gate de "Actualizar cotizacion" (#104, ADR-0008). Hasta ahora "Cargar" hacia dos
// cosas a la vez: restaurar el carrito y, calladamente, empezar una cotizacion NUEVA
// (#83 F1 reseteaba lastCotizacionId a proposito). Actualizar reusa el registro Y
// reescribe el quote de Operam conservando el folio, asi que solo aplica cuando hay
// un quote que editar y nadie lo ha convertido todavia:
//   - sin data persistida no hay carrito que reescribir (registro historico);
//   - sin folio no existe el quote (PRE): lo que toca es completar la subida;
//   - con pedido asociado (data.orderOperam, sync #62) el quote ya se convirtio --
//     Operam mismo deshabilita su edicion, y el gate del cotizador es consistente.
// Lo usa la UI para decidir que boton habilitar y server.js como autoridad real
// antes de tocar Operam: una sola definicion, sin que la UI sea la que "permite".
// El quote ya se convirtio en pedido (data.orderOperam, sync #62): la condicion
// del gate que el Pipeline usa ademas para OCULTAR Editar (#502).
export function tienePedidoAsociado(cot) {
  const order = cot?.orderOperam;
  return order != null && order !== '';
}

export function puedeActualizarCotizacion(cot) {
  const c = cot || {};
  if (!c.hasData) return { puede: false, motivo: 'Esta cotizaci\u00f3n no guarda su detalle: no hay nada que actualizar' };
  if (c.folioOperam == null || c.folioOperam === '') {
    return { puede: false, motivo: 'La cotizaci\u00f3n todav\u00eda no est\u00e1 registrada en Operam: primero completa la subida' };
  }
  if (tienePedidoAsociado(c)) {
    return { puede: false, motivo: 'La cotizaci\u00f3n ya tiene un pedido asociado en Operam: copia la cotizaci\u00f3n' };
  }
  return { puede: true };
}

// El boton Editar de toda superficie que carga una cotizacion: UNA definicion del
// boton y del gate. Sin data no hay carrito que restaurar ("Datos no
// disponibles", el texto del Historial); si el gate no deja, apagado CON su
// motivo en el title -- deshabilitar sin explicar convierte una regla de negocio
// en un boton roto. `cot.id` es el id REAL del registro: la tarjeta del Pipeline
// pasa su refId, nunca el `c<id>` prefijado.
export function buildBotonEditarHtml(cot) {
  const c = cot || {};
  if (!c.hasData) return `<button class="btn btn-secondary btn-sm" disabled title="Datos no disponibles">Editar</button>`;
  const gate = puedeActualizarCotizacion(c);
  return gate.puede
    ? `<button class="btn btn-primary btn-sm" onclick="cargarCotizacion(${c.id}, 'actualizar')">Editar</button>`
    : `<button class="btn btn-secondary btn-sm" disabled title="${escapeHtml(gate.motivo)}">Editar</button>`;
}
