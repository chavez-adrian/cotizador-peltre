// UNICA cadena de la "Referencia del cliente" (CONTEXT.md, #241): la referencia
// que el cliente da a la operacion -- proyecto, evento u orden de compra -- que
// nace en la cotizacion y se hereda al pedido y a la factura. La comparten el
// quote de Operam (cust_ref) y el documento del cliente (PDF/HTML, donde sale en
// el bloque del cliente Y en la tabla comercial): si cada consumidor arma la suya
// el ERP y el documento prometen cosas distintas.
//
// El orden lo fijo Adrian en #241 (antes, #108: referencia -> nombreCorto ->
// razonSocial -> nombreEntrega). trim() por escalon para que uno de solo espacios
// cuente como vacio. Aqui NO se trunca: el limite de 60 es del quote de Operam y
// lo aplica su propio consumidor.
export function referenciaDelCliente(cliente) {
  const c = cliente || {};
  return [c.referencia, c.nombreCorto, c.nombreEntrega, c.razonSocial]
    .map(v => (v || '').trim())
    .find(Boolean) || '';
}
