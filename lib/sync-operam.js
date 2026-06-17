// Nucleo puro del sync post-venta con Operam (issue #62, AC3; PRD #52; CONTEXT.md
// "Sincronizacion post-venta con Operam"; ADR-0005). Dado un conjunto de HECHOS
// normalizados sobre el estado en Operam de una oportunidad, devuelve la etapa
// post-venta destino. SIN red, SIN IO, SIN escritura: la capa que lee Operam
// (webhooks/polling) y mapea el JSON crudo a `hechos`, y el movimiento real de la
// tarjeta, son la sesion HITL posterior. Aqui solo la regla pura.
//
// Forma de `hechos` (ya normalizado; lo produce el IO layer fuera de alcance):
//   {
//     pago: { allocated, outstanding, total },  // montos agregados de la oportunidad
//     tienePedido: boolean,                     // existe un pedido en Operam (trans_type 11)
//     tieneRemision: boolean,                   // existe una remision (trans_type 30 / CustDelivery)
//   }
//
// Decisiones de Adrian (PROGRESS #62):
//   - anticipo_pagado: pago parcial (allocated > 0 && outstanding > 0).
//   - pedido_liberado: existe un pedido en Operam (tienePedido).
//   - saldo_pagado: liquidado (outstanding == 0 && total > 0).
//   - producto_entregado: existe una remision (tieneRemision).
// Post-venta no retrocede: si varios hechos aplican, gana la etapa MAS avanzada.

import { ETAPAS } from './pipeline.js';
import { puedeLiberar } from '../public/js/decorados-logica.js';

// Orden post-venta tomado del pipeline canonico (las 4 etapas finales en orden):
// anticipo_pagado < pedido_liberado < saldo_pagado < producto_entregado.
const ETAPAS_POST_VENTA = ETAPAS.slice(ETAPAS.indexOf('anticipo_pagado'));
const RANGO = new Map(ETAPAS_POST_VENTA.map((e, i) => [e, i]));

const PAGO_VACIO = { allocated: 0, outstanding: 0, total: 0 };

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Las etapas post-venta que los hechos implican, sin gate ni monotonia. Cada
// regla es independiente; el caller toma la mas avanzada.
function etapasImplicadas(hechos) {
  const pago = (hechos && hechos.pago) || PAGO_VACIO;
  const allocated = num(pago.allocated);
  const outstanding = num(pago.outstanding);
  const total = num(pago.total);
  const implicadas = new Set();
  if (allocated > 0 && outstanding > 0) implicadas.add('anticipo_pagado');
  if (hechos && hechos.tienePedido) implicadas.add('pedido_liberado');
  if (total > 0 && outstanding === 0) implicadas.add('saldo_pagado');
  if (hechos && hechos.tieneRemision) implicadas.add('producto_entregado');
  return implicadas;
}

// Etapa post-venta destino dada la informacion de Operam ya normalizada y la
// oportunidad (opcional). Devuelve la etapa MAS avanzada alcanzada o null si
// ningun hecho post-venta aplica (la oportunidad sigue en Seguimiento).
//
// Gate de decorados (#61): una oportunidad decorada con checklist incompleto NO
// avanza a pedido_liberado ni mas alla; se topa en la mayor etapa NO bloqueada
// por el gate (anticipo_pagado, o null si ni eso aplica). El sync NO la libera
// aunque Operam diga que hay pedido.
//
// Monotonia / idempotencia: post-venta no retrocede. Si la etapa actual de la
// oportunidad ya es igual o mas avanzada que la calculada, devuelve null.
export function etapaPostVenta(hechos, oportunidad) {
  const implicadas = etapasImplicadas(hechos);
  if (implicadas.size === 0) return null;

  const bloqueaGate = oportunidad != null && !puedeLiberar(oportunidad);

  let destino = null;
  let mejorRango = -1;
  for (const etapa of implicadas) {
    if (bloqueaGate && RANGO.get(etapa) >= RANGO.get('pedido_liberado')) continue;
    const r = RANGO.get(etapa);
    if (r > mejorRango) {
      mejorRango = r;
      destino = etapa;
    }
  }
  if (destino == null) return null;

  const actual = oportunidad && oportunidad.etapa;
  if (RANGO.has(actual) && RANGO.get(actual) >= mejorRango) return null;

  return destino;
}

// Normalizacion PROVISIONAL de un payload crudo de Operam a `hechos`. El IO real
// (webhooks/polling sobre la API v3) es HITL y vive fuera de este modulo; esto es
// lo minimo para probar el nucleo contra una forma parecida a la de Operam.
//
// Entrada: lista de transacciones de un mismo order_ (PROGRESS #62). trans_type
// 10=cotizacion, 11=pedido, 13=factura, 30=remision. Los montos de pago
// (allocated/outstanding/total_amount) se agregan sobre las transacciones.
export function hechosDesdeOperam(transacciones) {
  const lista = Array.isArray(transacciones) ? transacciones : [];
  const hechos = {
    pago: { allocated: 0, outstanding: 0, total: 0 },
    tienePedido: false,
    tieneRemision: false,
  };
  for (const t of lista) {
    if (!t) continue;
    const tipo = num(t.trans_type);
    if (tipo === 11) hechos.tienePedido = true;
    if (tipo === 30) hechos.tieneRemision = true;
    if (tipo === 13) {
      hechos.pago.total += num(t.total_amount);
      hechos.pago.allocated += num(t.allocated);
      hechos.pago.outstanding += num(t.outstanding);
    }
  }
  return hechos;
}
