// UNICA cadena de la "Referencia del cliente" (CONTEXT.md, #241): la referencia
// que el cliente da a la operacion -- proyecto, evento u orden de compra -- que
// nace en la cotizacion y se hereda al pedido y a la factura. La comparten el
// quote de Operam (cust_ref) y el documento del cliente (PDF/HTML, donde sale en
// el bloque del cliente Y en la tabla comercial): si cada consumidor arma la suya
// el ERP y el documento prometen cosas distintas.
//
// El orden lo fijo Adrian en #241 (antes, #108: referencia -> nombreCorto ->
// razonSocial -> nombreEntrega). trim() por escalon para que uno de solo espacios
// cuente como vacio.

import { aTitulo } from '../public/js/titulo-logica.js';

// Limite del campo cust_ref del quote de Operam. Vive en el nucleo, no en el
// consumidor de Operam, para que el documento del cliente corte donde corta el
// ERP: con un escalon de fallback largo (razon social mexicana tipica) el quote
// truncaba y el PDF no, y los dos decian cosas distintas.
const LIMITE_CUST_REF_OPERAM = 60;

// La normalizacion del texto gritado NO vive aqui desde #293: es EL titulador
// del repo (public/js/titulo-logica.js), el mismo que usan el Contacto de
// Google, la captura de prospecto y el importador del export de feria. Aqui solo
// se decide QUE escalon se normaliza -- la razon social, que llega del SAT en
// MAYUSCULAS -- y a cuanto se trunca.

export function referenciaDelCliente(cliente) {
  const c = cliente || {};
  const escalones = [
    { valor: c.referencia, normalizar: false },
    { valor: c.nombreCorto, normalizar: false },
    { valor: c.nombreEntrega, normalizar: false },
    { valor: c.razonSocial, normalizar: true },
  ];
  const elegido = escalones
    .map(e => ({ ...e, valor: (e.valor || '').trim() }))
    .find(e => e.valor);
  if (!elegido) return '';
  const texto = elegido.normalizar ? aTitulo(elegido.valor) : elegido.valor;
  return texto.slice(0, LIMITE_CUST_REF_OPERAM);
}
