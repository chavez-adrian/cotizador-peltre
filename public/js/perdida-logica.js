// Nucleo PURO de la salida Perdida (#482, CONTEXT.md "Perdida"; decision
// 2026-09-28 a sugerencia de Alejandro): una Oportunidad que ya tiene pedido en
// Operam ya se cerro y no se puede perder. Lo consumen server.js (las rutas que
// cierran como Perdida responden 409) y los cinco caminos del navegador que
// ofrecen Perdida (tarjeta y arrastre del tablero, Hoy, reunion vencida e
// Historial), para que el que decide y el que pinta no diverjan.
//
// Modulo HOJA: no importa de ningun otro *-logica.js porque pipeline-logica.js y
// cotizaciones-logica.js lo importan a el. Las cuatro etapas post-venta se
// reexpresan aqui (como COLUMNAS_PIPELINE); test/pipeline.test.js las compara con
// lib/pipeline.js para que no deriven.

export const ETAPAS_POST_VENTA = ['anticipo_pagado', 'pedido_liberado', 'saldo_pagado', 'producto_entregado'];

const POST_VENTA = new Set(ETAPAS_POST_VENTA);

export const MENSAJE_PERDIDA_CON_PEDIDO = 'Esta oportunidad ya tiene pedido en Operam: ya no se puede cerrar como Perdida. Si la venta se cay\u00f3, avisa al administrador.';

// "Tiene pedido": la etapa es post-venta O el espejo de Operam que persiste el
// sync (data.espejoOperam, #67) ya trae pedido. El segundo caso es la decorada
// con pedido, sin pago y con el checklist de calca incompleto: el candado de
// calca (#61) la retiene en Seguimiento aunque Operam ya tenga el pedido. El
// espejo llega a dos alturas -- la entrada completa (server) y la fila aplanada
// de las listas (navegador) --, como motivoPre.
export function tienePedido(o) {
  if (!o) return false;
  if (POST_VENTA.has(o.etapa)) return true;
  const pedido = (o.data?.espejoOperam ?? o.espejoOperam)?.pedido;
  return pedido != null && pedido !== '';
}
