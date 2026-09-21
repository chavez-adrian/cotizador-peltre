// Correccion de la lista de precios registrada en los quotes historicos (#406,
// derivado de #403). Antes de #403 el cotizador nunca mandaba la lista del
// ENCABEZADO: Operam le ponia la del CLIENTE, asi que un cliente de Menudeo
// cotizado en M350 quedo registrado en Menudeo (los precios por partida siempre
// fueron correctos) y el pedido que se derive hereda ese order_type.
//
// Aqui se prueba el NUCLEO PURO: que quotes tienen desfase, cuales se excluyen y
// con que motivo. El IO (leer Operam, escribir por la web legacy) vive en
// scripts/corregir-lista-quotes.mjs y en lib/operam-web.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRUPOS,
  folioDeCotizacion,
  pedidoDeQuote,
  foliosPorLeer,
  planearCorreccionListas,
  formatearReporte,
} from '../lib/correccion-lista-quotes.js';

// Los tiers reales del catalogo vigente (data/precios.json), recortados.
const TIERS = [
  { id: 'Menudeo', label: 'Menudeo', min_qty: 1, listaId: '12' },
  { id: 'M100', label: '100+ pzs', min_qty: 100, listaId: '15' },
  { id: 'M350', label: '350+ pzs', min_qty: 350, listaId: '16' },
  { id: 'Segundas', label: 'Segundas', listaId: '9' },
  { id: 'SinLista', label: 'Sin lista' },
];

const cot = (over = {}) => ({
  id: 1, cliente: 'Cliente de prueba', tier: 'M350', folioOperam: '1269',
  ...over,
  data: { ...(over.data || {}) },
});

const quote = (orderType, detalles = []) => ({ order_type: orderType, detalles });

// Un plan de una sola cotizacion: el caso bajo prueba, sin ruido alrededor.
function planDeUna(cotizacion, { quotes = new Map(), pedidosPorQuote = new Map(), quotesCancelados = [] } = {}) {
  const plan = planearCorreccionListas({
    cotizaciones: [cotizacion], tiers: TIERS, quotesCancelados, quotes, pedidosPorQuote,
  });
  assert.equal(plan.filas.length, 1);
  return plan.filas[0];
}

// --- Que se excluye y por que -----------------------------------------------

test('#406 la cotizacion que nunca se registro en Operam queda aparte, no en fuera de alcance', () => {
  const fila = planDeUna(cot({ folioOperam: null }));
  assert.equal(fila.grupo, GRUPOS.SIN_FOLIO);
  assert.match(fila.motivo, /folio/i);
});

test('#406 el quote cancelado se excluye aunque tenga desfase', () => {
  const fila = planDeUna(cot(), {
    quotes: new Map([['1269', quote('12')]]),
    quotesCancelados: ['1269'],
  });
  assert.equal(fila.grupo, GRUPOS.CANCELADO);
  assert.match(fila.motivo, /cancelad/i);
});

test('#406 el tier que ya no existe en el catalogo se reporta, no se adivina', () => {
  const fila = planDeUna(cot({ tier: 'M9999' }), { quotes: new Map([['1269', quote('12')]]) });
  assert.equal(fila.grupo, GRUPOS.TIER_DESCONOCIDO);
  assert.equal(fila.esperado, null);
  assert.match(fila.motivo, /M9999/);
});

test('#406 el tier sin listaId tampoco se adivina', () => {
  const fila = planDeUna(cot({ tier: 'SinLista' }), { quotes: new Map([['1269', quote('12')]]) });
  assert.equal(fila.grupo, GRUPOS.TIER_DESCONOCIDO);
});

test('#406 la cotizacion sin tier guardado cae en tier desconocido', () => {
  const fila = planDeUna(cot({ tier: '' }), { quotes: new Map([['1269', quote('12')]]) });
  assert.equal(fila.grupo, GRUPOS.TIER_DESCONOCIDO);
});

test('#406 el folio que Operam no conoce queda fuera de alcance', () => {
  const fila = planDeUna(cot(), { quotes: new Map([['1269', null]]) });
  assert.equal(fila.grupo, GRUPOS.FUERA_DE_ALCANCE);
  assert.match(fila.motivo, /1269/);
});

test('#406 el quote que no se alcanzo a leer NO se cuenta como sin desfase', () => {
  const fila = planDeUna(cot(), { quotes: new Map() });
  assert.equal(fila.grupo, GRUPOS.FUERA_DE_ALCANCE);
  assert.match(fila.motivo, /no se leyo/i);
});

test('#406 el quote sin order_type queda fuera de alcance: no hay contra que comparar', () => {
  const fila = planDeUna(cot(), { quotes: new Map([['1269', quote(null)]]) });
  assert.equal(fila.grupo, GRUPOS.FUERA_DE_ALCANCE);
  assert.match(fila.motivo, /order_type/);
});

// Dos registros con el mismo folio no pueden decidir con que lista se cotizo: el
// script escribiria una lista y despues la otra sobre el MISMO quote.
test('#406 un folio repetido en dos cotizaciones no se corrige: las dos salen de alcance', () => {
  const plan = planearCorreccionListas({
    cotizaciones: [cot({ id: 1, tier: 'M350' }), cot({ id: 2, tier: 'Menudeo' })],
    tiers: TIERS,
    quotes: new Map([['1269', quote('12')]]),
  });
  assert.equal(plan.filas.length, 2);
  for (const f of plan.filas) {
    assert.equal(f.grupo, GRUPOS.FUERA_DE_ALCANCE);
    assert.match(f.motivo, /mas de una cotizacion/i);
  }
});

// --- El desfase --------------------------------------------------------------

test('#406 el quote que ya esta en la lista cotizada no tiene nada que corregir', () => {
  const fila = planDeUna(cot(), { quotes: new Map([['1269', quote('16')]]) });
  assert.equal(fila.grupo, GRUPOS.SIN_DESFASE);
  assert.equal(fila.esperado, '16');
  assert.equal(fila.actual, '16');
});

test('#406 order_type numerico y listaId de texto son la MISMA lista', () => {
  const fila = planDeUna(cot(), { quotes: new Map([['1269', quote(16)]]) });
  assert.equal(fila.grupo, GRUPOS.SIN_DESFASE);
});

test('#406 el quote con desfase y sin pedido es corregible', () => {
  const fila = planDeUna(cot(), { quotes: new Map([['1269', quote('15')]]) });
  assert.equal(fila.grupo, GRUPOS.CORREGIBLE);
  assert.equal(fila.esperado, '16');
  assert.equal(fila.actual, '15');
  assert.equal(fila.pedido, null);
});

// El reporte lo lee un humano: el id de la lista de Operam por si solo no dice con
// que quedo registrado el quote. El nombre sale del catalogo, no de una tabla.
test('#406 la lista registrada viaja con el nombre que el cotizador le da', () => {
  const fila = planDeUna(cot(), { quotes: new Map([['1269', quote('15')]]) });
  assert.equal(fila.actualNombre, 'M100');
});

test('#406 una lista que el cotizador no precia se queda con su id crudo', () => {
  const fila = planDeUna(cot(), { quotes: new Map([['1269', quote('77')]]) });
  assert.equal(fila.actual, '77');
  assert.equal(fila.actualNombre, null);
});

test('#406 el quote con desfase que ya se convirtio en pedido se separa para decision', () => {
  const fila = planDeUna(cot(), {
    quotes: new Map([['1269', quote('15')]]),
    pedidosPorQuote: new Map([['1269', '6210']]),
  });
  assert.equal(fila.grupo, GRUPOS.CON_PEDIDO);
  assert.equal(fila.pedido.orden, '6210');
  assert.match(fila.motivo, /6210/);
});

test('#406 el pedido ya facturado o remisionado viaja en el reporte', () => {
  const fila = planDeUna(
    cot({ data: { espejoOperam: { pedido: '6210', factura: { numero: '900', ref: 'A1907' }, remisiones: ['R1'], pago: 'pagado' } } }),
    { quotes: new Map([['1269', quote('15')]]) },
  );
  assert.equal(fila.grupo, GRUPOS.CON_PEDIDO);
  assert.equal(fila.pedido.orden, '6210');
  assert.equal(fila.pedido.factura, 'A1907');
  assert.deepEqual(fila.pedido.remisiones, ['R1']);
  assert.equal(fila.pedido.pago, 'pagado');
});

test('#406 el pedido anotado en el registro cuenta aunque el barrido no lo traiga', () => {
  const fila = planDeUna(cot({ data: { orderOperam: '6001' } }), { quotes: new Map([['1269', quote('15')]]) });
  assert.equal(fila.grupo, GRUPOS.CON_PEDIDO);
  assert.equal(fila.pedido.orden, '6001');
});

// Sin desfase no hay nada que decidir, tenga pedido o no.
test('#406 el quote con pedido y sin desfase sale como sin desfase', () => {
  const fila = planDeUna(cot(), {
    quotes: new Map([['1269', quote('16')]]),
    pedidosPorQuote: new Map([['1269', '6210']]),
  });
  assert.equal(fila.grupo, GRUPOS.SIN_DESFASE);
});

// --- Los folios que hay que leer de Operam -----------------------------------

test('#406 solo se leen de Operam los folios que pueden tener desfase', () => {
  const folios = foliosPorLeer({
    cotizaciones: [
      cot({ id: 1, folioOperam: '1269' }),
      cot({ id: 2, folioOperam: null }),
      cot({ id: 3, folioOperam: '1270' }),
      cot({ id: 4, folioOperam: '1271', tier: 'M9999' }),
      cot({ id: 5, folioOperam: '1272' }),
      cot({ id: 6, folioOperam: '1272' }),
    ],
    tiers: TIERS,
    quotesCancelados: ['1270'],
  });
  assert.deepEqual(folios, ['1269']);
});

// --- Idempotencia ------------------------------------------------------------

test('#406 despues de aplicar, una segunda corrida no reporta corregibles', () => {
  const cotizaciones = [cot({ id: 1, folioOperam: '1269', tier: 'M350' })];
  const antes = planearCorreccionListas({ cotizaciones, tiers: TIERS, quotes: new Map([['1269', quote('15')]]) });
  assert.equal(antes.grupos[GRUPOS.CORREGIBLE].length, 1);
  const despues = planearCorreccionListas({ cotizaciones, tiers: TIERS, quotes: new Map([['1269', quote('16')]]) });
  assert.equal(despues.grupos[GRUPOS.CORREGIBLE].length, 0);
  assert.equal(despues.resumen[GRUPOS.SIN_DESFASE], 1);
});

// --- El reporte --------------------------------------------------------------

test('#406 el reporte separa los casos y nombra la lista de cada uno', () => {
  const plan = planearCorreccionListas({
    cotizaciones: [
      cot({ id: 1, folioOperam: '1269', tier: 'M350' }),
      cot({ id: 2, folioOperam: '1270', tier: 'M100' }),
      cot({ id: 3, folioOperam: '1271', tier: 'Menudeo' }),
      cot({ id: 4, folioOperam: '1272', tier: 'M9999' }),
    ],
    tiers: TIERS,
    quotesCancelados: ['1271'],
    quotes: new Map([['1269', quote('15')], ['1270', quote('16')], ['1272', quote('12')]]),
    pedidosPorQuote: new Map([['1270', '6210']]),
  });
  assert.equal(plan.resumen[GRUPOS.CORREGIBLE], 1);
  assert.equal(plan.resumen[GRUPOS.CON_PEDIDO], 1);
  assert.equal(plan.resumen[GRUPOS.CANCELADO], 1);
  assert.equal(plan.resumen[GRUPOS.TIER_DESCONOCIDO], 1);

  const texto = formatearReporte(plan);
  assert.match(texto, /1269/);
  assert.match(texto, /M350/);
  assert.match(texto, /6210/);
  assert.match(texto, /M9999/);
  // Lo que el dry-run NO puede medir se dice donde se lee: si FA deja repostear un
  // quote ya convertido en pedido solo se sabe intentandolo (spec #406).
  assert.match(texto, /SIN MEDIR/);
  assert.match(texto, /ModifyOrderNumber/);
});

// La spec pide "si tiene pedido asociado" en el reporte, de TODAS las filas: un tier
// fuera del catalogo con pedido no se lee igual que uno sin el.
test('#406 el pedido se anota tambien en la fila que se resolvio sin mirar el quote', () => {
  const fila = planDeUna(cot({ tier: 'M9999' }), {
    quotes: new Map([['1269', quote('12')]]),
    pedidosPorQuote: new Map([['1269', '6210']]),
  });
  assert.equal(fila.grupo, GRUPOS.TIER_DESCONOCIDO);
  assert.equal(fila.pedido.orden, '6210');
});

test('#406 folioDeCotizacion normaliza el folio a texto y el vacio a null', () => {
  assert.equal(folioDeCotizacion({ folioOperam: 1269 }), '1269');
  assert.equal(folioDeCotizacion({ folioOperam: '' }), null);
  assert.equal(folioDeCotizacion({}), null);
  assert.equal(folioDeCotizacion(null), null);
});

test('#406 sin pedido en ninguna de las dos fuentes no se inventa uno', () => {
  assert.equal(pedidoDeQuote(cot(), new Map()), null);
});
