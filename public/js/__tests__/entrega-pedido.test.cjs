// #531: la fecha de entrega del pedido en la tarjeta del tablero y en la fila
// cerrada de la lista del Pipeline, desde Anticipo pagado. Formato elegido por
// Adrian (variante A del prototipo, 2026-10-05): "Entrega mar 20/oct/26 . en 15 d"
// y, en Producto entregado, "Entregado lun 28/sep/26" sin cuenta de dias.
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

function cot(etapa, fechaEntrega, extra) {
  return {
    tipo: 'cotizacion', id: 'c41', refId: 41, nombre: 'Hotel Azul', etapa, total: 5000, folioOperam: '1300',
    contactoCelular: '+52 5598765432',
    espejoOperam: { cotizacion: '1300', pedido: '7801', ...(fechaEntrega === undefined ? {} : { fechaEntrega }) },
    ...extra,
  };
}

test('las cuatro etapas post-venta llevan la fecha; Producto entregado dice Entregado y sin cuenta de dias', () => {
  assert.deepEqual(E.entregaPedido(cot('anticipo_pagado', '2026-10-20'), AHORA), { rotulo: 'Entrega', fecha: 'mar 20/oct/26', relativo: 'en 15 d', estado: 'futura' });
  assert.deepEqual(E.entregaPedido(cot('pedido_liberado', '2026-10-05'), AHORA), { rotulo: 'Entrega', fecha: 'lun 05/oct/26', relativo: 'hoy', estado: 'hoy' });
  assert.deepEqual(E.entregaPedido(cot('saldo_pagado', '2026-10-12'), AHORA), { rotulo: 'Entrega', fecha: 'lun 12/oct/26', relativo: 'en 7 d', estado: 'futura' });
  assert.deepEqual(E.entregaPedido(cot('producto_entregado', '2026-09-28'), AHORA), { rotulo: 'Entregado', fecha: 'lun 28/sep/26', relativo: '', estado: 'entregado' });
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
  assert.match(conFecha, /Entrega <b>mar 20\/oct\/26<\/b>/);
  assert.match(conFecha, /en 15 d/);
  assert.doesNotMatch(conFecha, /entrega-pedido-ya/, 'una fecha futura no se destaca');
  assert.match(L.buildTableroPipelineHtml([cot('anticipo_pagado', '2026-10-01')], ctx), /entrega-pedido-ya">\u00b7 venci\u00f3 hace 4 d/);
  assert.ok(conFecha.indexOf('entrega-pedido') > conFecha.indexOf('cot-card-header'), 'despues del encabezado');
  const entregado = L.buildTableroPipelineHtml([cot('producto_entregado', '2026-09-28')], ctx);
  assert.match(entregado, /Entregado <b>lun 28\/sep\/26<\/b>/);
  assert.doesNotMatch(L.buildTableroPipelineHtml([cot('seguimiento', '2026-10-20')], ctx), /entrega-pedido/);
  assert.doesNotMatch(L.buildTableroPipelineHtml([cot('pedido_liberado', undefined)], ctx), /entrega-pedido/);
});

test('la fila CERRADA de la lista pinta la fecha sin abrir nada', () => {
  const ctx = { vendedores: [], puedeAsignar: false, ahora: AHORA };
  const cerrada = L.buildFilaListaPipelineHtml(cot('saldo_pagado', '2026-10-12'), ctx);
  assert.match(cerrada, /class="entrega-pedido"/);
  assert.match(cerrada, /Entrega <b>lun 12\/oct\/26<\/b>/);
  const cabecera = cerrada.slice(0, cerrada.indexOf('</button>'));
  assert.match(cabecera, /entrega-pedido/, 'dentro del boton de la fila cerrada');
  assert.doesNotMatch(L.buildFilaListaPipelineHtml(cot('seguimiento', '2026-10-12'), ctx), /entrega-pedido/);
});
