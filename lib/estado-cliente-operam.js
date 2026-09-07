// Los dos estados del Cliente Operam (#344, spec #337, ADR-0016, CONTEXT.md
// "Cliente Operam"): nucleo PURO, sin IO.
//
// El ESTADO FISCAL sale del RFC y nada mas: generico -> Sin datos fiscales,
// cualquier otro -> Con datos fiscales. No es una espera ni un pendiente: para
// quien no factura es un estado legitimo y permanente (ADR-0016).
//
// El ESTADO COMERCIAL sale de lo que Operam registra -- pedidos y quotes de
// cualquier origen, tambien los anteriores al cotizador -- y NUNCA de una
// captura. Por eso el Cliente Operam del historico, dado de alta a mano y con
// pedidos que jamas pasaron por aqui, aparece con pedido igual que cualquiera.
//
// El unico hueco conocido son los quotes hechos en la WEB: la API no los
// enumera (GET /sales/quote da 501, peltre-operam.md 12.2), asi que un Cliente
// Operam cotizado solo por ahi se ve sin actividad. El hueco se DECLARA en la
// respuesta (`fuenteIncompleta`) en vez de adivinarse, y solo puede fallar en
// una direccion: sin actividad siendo cotizado, nunca al reves.

import { RFC_GENERICOS, normalizarRfc } from './deduplicacion.js';
// Las cadenas de los estados y su texto de pantalla viven en public/js
// (cross-import de la casa: lib/ importa de public/js, nunca al reves): el
// servidor las decide y el navegador las pinta, y una sola definicion evita que
// un renombre deje a un lado esperando una etiqueta que el otro ya no manda.
export {
  SIN_DATOS_FISCALES, CON_DATOS_FISCALES,
  SIN_ACTIVIDAD, COTIZADO, CON_PEDIDO,
  ETIQUETA_FISCAL, ETIQUETA_COMERCIAL,
} from '../public/js/estado-cliente-logica.js';
import {
  SIN_DATOS_FISCALES, CON_DATOS_FISCALES, SIN_ACTIVIDAD, COTIZADO, CON_PEDIDO,
} from '../public/js/estado-cliente-logica.js';

// Sin RFC capturado el estado es Sin datos fiscales, no un tercer estado: la
// pregunta que contesta la etiqueta es "hay que pedirle la constancia?", y sin
// RFC la respuesta es la misma que con uno generico.
export function estadoFiscalDe(cliente) {
  const rfc = normalizarRfc((cliente && (cliente.tax_id ?? cliente.rfc ?? cliente.RFC)) || '');
  if (!rfc || RFC_GENERICOS.has(rfc)) return SIN_DATOS_FISCALES;
  return CON_DATOS_FISCALES;
}

function vivos(registros) {
  return (registros || []).filter(r => r && r.cancelado !== true);
}

// La actividad de UN Cliente Operam -> su estado comercial. `actividad` es
// { pedidos, quotes }, cada uno una lista de { folio, cancelado }.
export function estadoComercialDe(actividad) {
  const a = actividad || {};
  if (vivos(a.pedidos).length > 0) return CON_PEDIDO;
  if (vivos(a.quotes).length > 0) return COTIZADO;
  return SIN_ACTIVIDAD;
}

// Los quotes web no enumerables solo pueden cambiar el veredicto cuando NO hay
// nada mas: con un quote o un pedido ya registrado, descubrir otro quote no
// mueve el estado. Por eso la marca se pone exactamente en el caso en que el
// hueco importa, y no como una advertencia permanente que nadie leeria.
export function estadosDeClienteOperam(cliente, actividad) {
  const comercial = estadoComercialDe(actividad);
  return {
    fiscal: estadoFiscalDe(cliente),
    comercial,
    fuenteIncompleta: comercial === SIN_ACTIVIDAD,
  };
}

function texto(v) {
  return v == null || v === '' ? null : String(v);
}

// El indice customer_id -> actividad a partir de las TRES fuentes de la spec:
// los pedidos que la API si enumera (listarPedidos, la misma lectura del
// backfill #76), el espejo del sync post-venta que ya vive en cada cotizacion
// del cotizador (#67), y la lista de cancelados detectada por scraping
// (data/cancelados.json, scripts/detectar-cancelados.mjs) -- la API no expone la
// cancelacion por ningun otro camino.
//
// De un pedido cuenta tambien su `trans_no_from`: es el numero de la cotizacion
// de la que nacio (peltre-operam.md 12.2), asi que un pedido es evidencia de que
// ese quote existio aunque la API no lo enumere.
export function construirActividad({ pedidos = [], cotizaciones = [], cancelados = {} } = {}) {
  const ordersCanceladas = new Set((cancelados.orders || []).map(String));
  const quotesCancelados = new Set((cancelados.quotes || []).map(String));
  const mapa = new Map();
  const entrada = (customerId) => {
    const llave = texto(customerId);
    if (llave == null) return null;
    if (!mapa.has(llave)) mapa.set(llave, { pedidos: [], quotes: [] });
    return mapa.get(llave);
  };
  const agregar = (lista, folio, canceladas) => {
    if (folio == null) return;
    if (lista.some(r => r.folio === folio)) return;
    lista.push({ folio, cancelado: canceladas.has(folio) });
  };

  for (const p of pedidos || []) {
    const e = entrada(p && p.debtor_no);
    if (!e) continue;
    agregar(e.pedidos, texto(p.order_no), ordersCanceladas);
    agregar(e.quotes, texto(p.trans_no_from), quotesCancelados);
  }

  for (const c of cotizaciones || []) {
    const cli = (c && c.data && c.data.cliente) || {};
    const e = entrada(cli.customerId ?? (c && c.clienteOperam));
    if (!e) continue;
    agregar(e.quotes, texto(c.folioOperam), quotesCancelados);
    agregar(e.pedidos, texto(c.data?.espejoOperam?.pedido), ordersCanceladas);
  }

  return mapa;
}
