// #531: la fecha de entrega del pedido en la tarjeta del tablero y en la fila
// cerrada de la lista del Pipeline, desde Anticipo pagado. Formato elegido por
// Adrian (variante A del prototipo, 2026-10-05). #534: antes de Producto entregado
// el rotulo es "Despacho" (la Fecha compromiso de despacho, el "Requerido para") --
// "Despacho mar 20/oct/26 . en 15 d" --, y en Producto entregado la fecha es la de
// la ULTIMA remision (Fecha de despacho): "Entregado jue 17/sep/26" o, si falta
// mercancia, "Entregado parcialmente" con su aviso.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let E;
let L;
before(async () => {
  E = await import('../entrega-pedido-logica.js');
  L = await import('../pipeline-logica.js');
});

// Lunes 5 de octubre de 2026, mediodia local.
const AHORA = new Date(2026, 9, 5, 12, 0, 0);

function cot(etapa, fechaEntrega, extra, entrega) {
  return {
    tipo: 'cotizacion', id: 'c41', refId: 41, nombre: 'Hotel Azul', etapa, total: 5000, folioOperam: '1300',
    contactoCelular: '+52 5598765432',
    espejoOperam: { cotizacion: '1300', pedido: '7801', ...(fechaEntrega === undefined ? {} : { fechaEntrega }), ...entrega },
    ...extra,
  };
}

// Como la 1235: "Requerido para" 06/oct (manana), su remision salio el 17/sep.
const entregada = (entregaCompleta) => cot('producto_entregado', '2026-10-06', undefined, { fechaDespacho: '2026-09-17', entregaCompleta });

test('antes de Producto entregado el rotulo es Despacho con la Fecha compromiso de despacho y la cuenta de dias', () => {
  assert.deepEqual(E.entregaPedido(cot('anticipo_pagado', '2026-10-20'), AHORA), { rotulo: 'Despacho', fecha: 'mar 20/oct/26', relativo: 'en 15 d', estado: 'futura' });
  assert.deepEqual(E.entregaPedido(cot('pedido_liberado', '2026-10-20'), AHORA), { rotulo: 'Despacho', fecha: 'mar 20/oct/26', relativo: 'en 15 d', estado: 'futura' });
  assert.deepEqual(E.entregaPedido(cot('pedido_liberado', '2026-10-05'), AHORA), { rotulo: 'Despacho', fecha: 'lun 05/oct/26', relativo: 'hoy', estado: 'hoy' });
  assert.deepEqual(E.entregaPedido(cot('saldo_pagado', '2026-10-12'), AHORA), { rotulo: 'Despacho', fecha: 'lun 12/oct/26', relativo: 'en 7 d', estado: 'futura' });
});

test('Producto entregado: la fecha de la ultima remision, Entregado o Entregado parcialmente, sin cuenta de dias', () => {
  assert.deepEqual(E.entregaPedido(entregada(true), AHORA), { rotulo: 'Entregado', fecha: 'jue 17/sep/26', relativo: '', estado: 'entregado' });
  assert.deepEqual(E.entregaPedido(entregada(false), AHORA), { rotulo: 'Entregado parcialmente', fecha: 'jue 17/sep/26', relativo: '', estado: 'parcial' });
});

test('Producto entregado sin fecha de despacho (o sin saber si se completo) no pinta fecha: nunca el Requerido para como Entregado', () => {
  assert.equal(E.entregaPedido(cot('producto_entregado', '2026-09-28'), AHORA), null);
  assert.equal(E.entregaPedido(cot('producto_entregado', '2026-09-28', undefined, { fechaDespacho: '2026-09-17' }), AHORA), null);
  assert.equal(E.entregaPedido(cot('producto_entregado', '2026-09-28', undefined, { fechaDespacho: '', entregaCompleta: true }), AHORA), null);
  assert.equal(E.entregaPedido(cot('producto_entregado', '2026-09-28', undefined, { fechaDespacho: 'no', entregaCompleta: true }), AHORA), null);
});

test('una fecha que ya paso dice cuanto hace que vencio; manana y ayer por su nombre', () => {
  assert.equal(E.entregaPedido(cot('anticipo_pagado', '2026-10-01'), AHORA).relativo, 'venci\u00f3 hace 4 d');
  assert.equal(E.entregaPedido(cot('anticipo_pagado', '2026-10-01'), AHORA).estado, 'vencida');
  assert.equal(E.entregaPedido(cot('anticipo_pagado', '2026-10-04'), AHORA).relativo, 'venci\u00f3 ayer');
  assert.equal(E.entregaPedido(cot('anticipo_pagado', '2026-10-06'), AHORA).relativo, 'ma\u00f1ana');
});

test('una fecha de Operam serializada como medianoche UTC se lee como ese dia, nunca el anterior (#428)', () => {
  const r = E.entregaPedido(cot('pedido_liberado', '2026-10-20T00:00:00.000Z'), AHORA);
  assert.equal(r.fecha, 'mar 20/oct/26');
  assert.equal(r.relativo, 'en 15 d');
});

test('no se pinta antes de Anticipo pagado, en Oportunidades sin pedido ni sin fecha', () => {
  assert.equal(E.entregaPedido(cot('seguimiento', '2026-10-20'), AHORA), null);
  assert.equal(E.entregaPedido(cot('anticipo_pagado', undefined), AHORA), null);
  assert.equal(E.entregaPedido(cot('anticipo_pagado', ''), AHORA), null);
  assert.equal(E.entregaPedido(cot('anticipo_pagado', 'no es fecha'), AHORA), null);
  assert.equal(E.entregaPedido(cot('anticipo_pagado', '2026-10-20', { espejoOperam: null }), AHORA), null);
  const prospecto = { tipo: 'prospecto', id: 'p7', refId: 7, etapa: 'por_cotizar', espejoOperam: { fechaEntrega: '2026-10-20' } };
  assert.equal(E.entregaPedido(prospecto, AHORA), null);
  assert.equal(E.entregaPedido(null, AHORA), null);
});

test('la tarjeta del tablero pinta la fecha bajo el encabezado, solo cuando aplica', () => {
  const ctx = { vendedores: [], puedeAsignar: false, ahora: AHORA };
  const conFecha = L.buildTableroPipelineHtml([cot('anticipo_pagado', '2026-10-20')], ctx);
  assert.match(conFecha, /class="entrega-pedido"/);
  assert.match(conFecha, /Despacho <b>mar 20\/oct\/26<\/b>/);
  assert.match(conFecha, /en 15 d/);
  assert.doesNotMatch(conFecha, /entrega-pedido-ya/, 'una fecha futura no se destaca');
  assert.match(L.buildTableroPipelineHtml([cot('anticipo_pagado', '2026-10-01')], ctx), /entrega-pedido-ya">\u00b7 venci\u00f3 hace 4 d/);
  assert.ok(conFecha.indexOf('entrega-pedido') > conFecha.indexOf('cot-card-header'), 'despues del encabezado');
  const entregado = L.buildTableroPipelineHtml([entregada(true)], ctx);
  assert.match(entregado, /Entregado <b>jue 17\/sep\/26<\/b>/);
  assert.doesNotMatch(entregado, /parcialmente|entrega-pedido-parcial/);
  assert.doesNotMatch(L.buildTableroPipelineHtml([cot('producto_entregado', '2026-09-28')], ctx), /entrega-pedido/);
  assert.doesNotMatch(L.buildTableroPipelineHtml([cot('seguimiento', '2026-10-20')], ctx), /entrega-pedido/);
  assert.doesNotMatch(L.buildTableroPipelineHtml([cot('pedido_liberado', undefined)], ctx), /entrega-pedido/);
});

test('la fila CERRADA de la lista pinta la fecha sin abrir nada', () => {
  const ctx = { vendedores: [], puedeAsignar: false, ahora: AHORA };
  const cerrada = L.buildFilaListaPipelineHtml(cot('saldo_pagado', '2026-10-12'), ctx);
  assert.match(cerrada, /class="entrega-pedido"/);
  assert.match(cerrada, /Despacho <b>lun 12\/oct\/26<\/b>/);
  const cabecera = cerrada.slice(0, cerrada.indexOf('</button>'));
  assert.match(cabecera, /entrega-pedido/, 'dentro del boton de la fila cerrada');
  assert.doesNotMatch(L.buildFilaListaPipelineHtml(cot('seguimiento', '2026-10-12'), ctx), /entrega-pedido/);
});

test('Entregado parcialmente lleva la marca de aviso, en la tarjeta y en la fila cerrada', () => {
  const ctx = { vendedores: [], puedeAsignar: false, ahora: AHORA };
  const tarjeta = L.buildTableroPipelineHtml([entregada(false)], ctx);
  assert.match(tarjeta, /class="entrega-pedido entrega-pedido-parcial"/);
  assert.match(tarjeta, /\u26a0\ufe0f Entregado parcialmente <b>jue 17\/sep\/26<\/b>/);
  const cerrada = L.buildFilaListaPipelineHtml(entregada(false), ctx);
  assert.match(cerrada.slice(0, cerrada.indexOf('</button>')), /\u26a0\ufe0f Entregado parcialmente <b>jue 17\/sep\/26<\/b>/);
});
