// Los avisos (webhooks) de Operam del sync post-venta (#62; reescrito en #510).
// Nucleo PURO: que dice cada aviso y con que clave se evita reprocesarlo. El log
// de los avisos vive en lib/operam-webhooks-store.js y la reconciliacion en
// lib/sync-operam-io.js (reconciliarAviso).
//
// Formas REALES, medidas en operam_webhooks_log de produccion (#506, 2026-10-02).
// Todos traen `type` (el evento: "ADD"), `model`, `description` y `data`:
//   - Pedido (`model: "Order"`): `data` es el pedido completo. Trae `customer_id`,
//     `reference` (el folio del pedido, "2606741") y `trans_no_from` (el folio de
//     la cotizacion de origen; vacio en una venta directa). `order_no` llega en
//     null y `trans_no` es un OBJETO de una llave, no un numero.
//   - Pago (`model: "Payment"`): `data` trae `trans_no` (el del pago), `debtor_no`,
//     `tax_id` y `order_` en "0": un pago no dice a que pedido pertenece.
//   - Remision (`model: "CustDelivery"`): `data` es solo un numero.
// Hasta #510 la clave salia de `data.trans_no` o de un identificador generico:
// todos los pedidos daban `Order:ev:[object Object]` y todas las remisiones
// `CustDelivery:ev:sin-id`, asi que desde junio de 2026 cada aviso de Pedido y de
// Remision se descartaba como repetido. Ahora la clave sale del identificador de
// SU modelo y, si no lo hay, de la huella del aviso completo: nunca de una
// constante.

import { createHash } from 'node:crypto';

export const AVISO_PEDIDO = 'pedido';
export const AVISO_PAGO = 'pago';
export const AVISO_REMISION = 'remision';

const TIPO_POR_MODELO = {
  Order: AVISO_PEDIDO,
  Payment: AVISO_PAGO,
  CustDelivery: AVISO_REMISION,
};

const texto = (v) => (v == null || typeof v === 'object' ? '' : String(v).trim());

// El identificador propio del aviso dentro de su modelo: el folio del pedido, el
// numero del pago o el numero de la remision.
function identificadorDelModelo(tipo, data) {
  if (tipo === AVISO_PEDIDO) return texto(data?.reference);
  if (tipo === AVISO_PAGO) return texto(data?.trans_no);
  if (tipo === AVISO_REMISION) return texto(data);
  return '';
}

function huella(payload) {
  return createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex').slice(0, 16);
}

// Que dice un aviso: { modelo, evento, tipo, clave, identificador, documento,
// cliente }. `tipo` es pedido/pago/remision o null (modelo que el sync no
// atiende). `documento` es el folio de la cotizacion de origen del pedido;
// `cliente`, el Cliente Operam del pago. Un "0" no es cliente.
export function interpretarAviso(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const modelo = texto(p.model) || null;
  const evento = texto(p.type) || 'ev';
  const tipo = TIPO_POR_MODELO[modelo] || null;
  const data = p.data;
  const propio = identificadorDelModelo(tipo, data);
  const documento = tipo === AVISO_PEDIDO ? texto(data?.trans_no_from) || null : null;
  const deudor = tipo === AVISO_PAGO ? texto(data?.debtor_no) : '';
  const cliente = deudor !== '' && deudor !== '0' ? deudor : null;
  return {
    modelo,
    evento,
    tipo,
    clave: `${modelo || 'op'}:${evento}:${propio || 'h' + huella(payload)}`,
    identificador: documento || cliente || propio || null,
    documento,
    cliente,
  };
}

// La clave idempotente del aviso: el mismo aviso reenviado da la misma; dos
// avisos distintos, claves distintas.
export function claveEvento(payload) {
  return interpretarAviso(payload).clave;
}

// Como quedo la atencion de un aviso, para su fila del log: `ok` false si no se
// pudo leer lo necesario o si alguna cotizacion fallo (Operam caido, 429, la web
// legacy). Un aviso que fallo NO queda procesado: su reenvio se vuelve a atender.
export function resultadoDelAviso(resultados, error) {
  const lista = Array.isArray(resultados) ? resultados : [];
  if (error) return { ok: false, resultado: `error: ${error}` };
  const fallidas = lista.filter(r => r && r.error);
  if (fallidas.length) {
    return { ok: false, resultado: `error: ${fallidas.map(r => `${r.id}: ${r.error}`).join('; ')}` };
  }
  return { ok: true, resultado: `reconciliadas:${lista.length}` };
}
