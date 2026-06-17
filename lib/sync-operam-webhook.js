// Capa de webhook del sync post-venta con Operam (issue #62, AC2 / F3). El webhook
// es solo una SENAL: Operam avisa "algo cambio para este cliente/order_/modelo".
// NO se confia en el formato exacto de su payload (aun sin capturar): se extrae un
// identificador de forma defensiva y la reconciliacion lee la verdad por API.
//
// Aqui: (1) extraccion defensiva del identificador, (2) clave idempotente del
// evento, (3) log idempotente en Neon (graceful sin DATABASE_URL: dev/tests).

import { query } from './db.js';

// Busca un valor en varias formas/anidamientos del payload (Operam aun no fija el
// formato). Devuelve el primer valor no vacio entre las claves dadas, mirando el
// objeto raiz y un nivel de anidamiento comun (data/record/object/payload).
function buscarCampo(payload, claves) {
  if (!payload || typeof payload !== 'object') return null;
  const contenedores = [payload];
  for (const k of ['data', 'record', 'object', 'payload', 'body']) {
    if (payload[k] && typeof payload[k] === 'object') contenedores.push(payload[k]);
  }
  for (const cont of contenedores) {
    for (const clave of claves) {
      const v = cont[clave];
      if (v != null && v !== '' && v !== '0') return String(v);
    }
  }
  return null;
}

// Extrae el identificador resoluble de un payload de webhook de Operam. Prioriza
// el order_ (la llave de la cadena), luego el RFC, luego el customer_id. Devuelve
// { order, rfc, customerId, modelo, evento } con lo que se haya podido leer.
export function extraerIdentificador(payload) {
  return {
    order: buscarCampo(payload, ['order_', 'order_no', 'orderNo', 'order']),
    rfc: buscarCampo(payload, ['tax_id', 'rfc', 'customer_rfc', 'taxId']),
    customerId: buscarCampo(payload, ['debtor_no', 'customer_id', 'customerId', 'debtorNo']),
    modelo: buscarCampo(payload, ['model', 'modelo', 'tipo', 'type']),
    evento: buscarCampo(payload, ['event', 'evento', 'action', 'accion']),
  };
}

// Clave idempotente del evento. Si el payload trae un id de evento/transaccion lo
// usa; si no, deriva una clave estable de modelo+evento+identificador. El mismo
// evento dos veces produce la misma clave -> el UNIQUE de Neon evita reprocesar.
export function claveEvento(payload) {
  const idExterno = buscarCampo(payload, ['id', 'event_id', 'eventId', 'webhook_id', 'trans_no', 'transNo']);
  const { order, rfc, customerId, modelo, evento } = extraerIdentificador(payload);
  if (idExterno) return `${modelo || 'op'}:${evento || 'ev'}:${idExterno}`;
  const ident = order || rfc || customerId || 'sin-id';
  return `${modelo || 'op'}:${evento || 'ev'}:${ident}`;
}

// Registra el evento en el log idempotente. Devuelve { nuevo: boolean }: nuevo=false
// si el event_key ya existia (ya se proceso, no reprocesar). Graceful sin pool
// (dev/tests): devuelve { nuevo: true, sinPool: true } para que el flujo continue
// (la idempotencia real del movimiento la garantiza la monotonia del nucleo).
export async function registrarEvento(payload) {
  const event_key = claveEvento(payload);
  const { order, rfc, customerId, modelo } = extraerIdentificador(payload);
  const identificador = order || rfc || customerId || null;
  const r = await query(
    `INSERT INTO operam_webhooks_log (event_key, modelo, identificador, payload)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (event_key) DO NOTHING
     RETURNING id`,
    [event_key, modelo, identificador, JSON.stringify(payload || {})]
  );
  if (r === null) return { nuevo: true, sinPool: true, event_key };
  return { nuevo: r.rowCount > 0, event_key };
}

// Marca un evento como procesado (auditoria). Graceful sin pool.
export async function marcarProcesado(event_key, resultado) {
  await query(
    `UPDATE operam_webhooks_log SET procesado_en = NOW(), resultado = $2 WHERE event_key = $1`,
    [event_key, resultado]
  );
}
