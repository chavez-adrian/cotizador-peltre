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

export const MENSAJE_PERDIDA_CON_PEDIDO = 'Esta oportunidad ya tiene pedido en Operam: ya no se puede cerrar como Perdida. Si la venta se cay\u00f3, avisa al administrador para que la cierre como Cancelada.';

// "Tiene pedido": la etapa es post-venta O el espejo de Operam que persiste el
// sync (data.espejoOperam, #67) ya trae pedido. El segundo caso es la decorada
// con pedido, sin pago y con el checklist de calca incompleto: el candado de
// calca (#61) la retiene en Seguimiento aunque Operam ya tenga el pedido. El
// espejo llega a dos alturas -- la entrada completa (server) y la fila aplanada
// de las listas (navegador) --, como motivoPre.
// #484: una Cancelada (CONTEXT.md "Cancelada") llego a pedido por definicion,
// aunque su espejo no exista: tampoco se puede perder.
export function tienePedido(o) {
  if (!o) return false;
  if (POST_VENTA.has(o.etapa) || o.etapa === 'cancelada') return true;
  return pedidoEnEspejo(o);
}

// El pedido que el sync anoto en el espejo de Operam, a las dos alturas. Lo usa
// tambien el Editar del Pipeline (#502): el pedido puede estar solo aqui, sin
// data.orderOperam (Cotizacion 1293 con Pedido #7722).
export function pedidoEnEspejo(o) {
  const pedido = (o?.data?.espejoOperam ?? o?.espejoOperam)?.pedido;
  return pedido != null && pedido !== '';
}

// #483 (CONTEXT.md "Perdida"; lista final de Adrian 2026-09-30, base HubSpot):
// cerrar como Perdida pide un Motivo de Perdida, para medir por que se pierde.
// Catalogo PROPIO, distinto del de No util aunque compartan "sin respuesta": "No
// cumple los requerimientos" es que lo cotizado no resolvia lo que el Contacto
// necesitaba, no descalificar a un prospecto. `valor` es lo que se guarda y viaja;
// `texto`, lo que se pinta. `exigeNota` marca el motivo que no se entiende sin una
// nota (Otro). La forma la comparte cualquier catalogo de salida que pida nota.
export const MOTIVOS_PERDIDA = [
  { valor: 'precio', texto: 'Precio' },
  { valor: 'proyecto_pospuesto', texto: 'Proyecto pospuesto' },
  { valor: 'competencia', texto: 'Competencia' },
  { valor: 'tiempo_produccion', texto: 'Tiempo de producci\u00f3n' },
  { valor: 'sin_respuesta', texto: 'Sin respuesta' },
  { valor: 'no_cumple_requerimientos', texto: 'No cumple los requerimientos' },
  { valor: 'otro', texto: 'Otro', exigeNota: true },
];

export const MENSAJE_SIN_MOTIVO_PERDIDA = 'Elige el Motivo de Perdida (cat\u00e1logo cerrado)';
export const MENSAJE_PERDIDA_SIN_NOTA = 'Con el motivo Otro, escribe una nota que diga por qu\u00e9 se perdi\u00f3';

// El juicio de un motivo de salida contra SU catalogo: null si procede, el texto
// del error si no. Lo comparten el servidor (400) y la ventana del navegador.
export function errorMotivoDeCatalogo(catalogo, motivo, nota, mensajes) {
  const entrada = catalogo.find(m => m.valor === motivo);
  if (!entrada) return mensajes.sinMotivo;
  if (entrada.exigeNota && !notaLimpia(nota)) return mensajes.sinNota;
  return null;
}

export function errorMotivoPerdida(motivo, nota) {
  return errorMotivoDeCatalogo(MOTIVOS_PERDIDA, motivo, nota,
    { sinMotivo: MENSAJE_SIN_MOTIVO_PERDIDA, sinNota: MENSAJE_PERDIDA_SIN_NOTA });
}

// La nota tal como se guarda: texto recortado, o null si no hay nada que decir.
export function notaLimpia(nota) {
  const texto = typeof nota === 'string' ? nota.trim() : '';
  return texto || null;
}

// El Motivo de Perdida de una Oportunidad vive en el evento con el que se cerro
// (etapa -> perdida), como el de No util vive en su evento. Manda el ULTIMO
// cierre: una cotizacion reabierta y vuelta a perder dice por que se perdio la
// segunda vez, y una reabierta (etapa desde perdida) ya no tiene motivo. Una
// Perdida anterior a #483 no trae motivo: null, y se pinta igual que antes.
// #484: la misma lectura sirve a cualquier salida con motivo (Cancelada).
export function motivoDeSalida(eventos, salida) {
  let cierre = null;
  for (const e of eventos || []) {
    if (!e || e.tipo !== 'etapa') continue;
    if (e.a === salida) cierre = e;
    else if (e.de === salida) cierre = null;
  }
  if (!cierre || !cierre.motivo) return null;
  return { motivo: cierre.motivo, nota: notaLimpia(cierre.nota) };
}

export function motivoPerdidaDe(eventos) {
  return motivoDeSalida(eventos, 'perdida');
}

// Los dos campos con los que una tarjeta o una fila del Historial lleva su Motivo
// de Perdida; null en los dos si no hay (sin perder, o Perdida anterior a #483).
export function camposMotivoPerdida(eventos) {
  const perdida = motivoPerdidaDe(eventos);
  return { motivoPerdida: perdida?.motivo ?? null, notaPerdida: perdida?.nota ?? null };
}

export function textoMotivoPerdida(valor) {
  return MOTIVOS_PERDIDA.find(m => m.valor === valor)?.texto ?? valor;
}
