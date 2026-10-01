'use strict';
// #482 (CONTEXT.md "Perdida", decision 2026-09-28 a sugerencia de Alejandro):
// una Oportunidad que ya tiene pedido en Operam ya se cerro y no se puede
// perder. "Tiene pedido" es UNA regla: etapa post-venta (Anticipo pagado o
// posterior) O el espejo de Operam de la cotizacion ya trae pedido -- el caso de
// la decorada que el candado de calca retiene en Seguimiento.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let tienePedido;
before(async () => {
  ({ tienePedido } = await import('../perdida-logica.js'));
});

test('#482: en Anticipo pagado, Pedido liberado, Saldo pagado o Producto entregado tiene pedido', () => {
  for (const etapa of ['anticipo_pagado', 'pedido_liberado', 'saldo_pagado', 'producto_entregado']) {
    assert.equal(tienePedido({ etapa }), true, etapa);
  }
});

test('#482: antes de la venta no tiene pedido', () => {
  for (const etapa of ['no_asignado', 'por_cotizar', 'seguimiento', undefined]) {
    assert.equal(tienePedido({ etapa }), false, String(etapa));
  }
  assert.equal(tienePedido(null), false);
});

test('#482: en Seguimiento con pedido en el espejo de Operam tiene pedido (entrada completa y fila aplanada)', () => {
  assert.equal(tienePedido({ etapa: 'seguimiento', data: { espejoOperam: { cotizacion: '1240', pedido: '873', remisiones: [] } } }), true);
  assert.equal(tienePedido({ etapa: 'seguimiento', espejoOperam: { cotizacion: '1240', pedido: '873', remisiones: [] } }), true);
});

test('#482: un espejo sin pedido no cuenta', () => {
  assert.equal(tienePedido({ etapa: 'seguimiento', espejoOperam: { cotizacion: '1240', remisiones: [] } }), false);
  assert.equal(tienePedido({ etapa: 'seguimiento', espejoOperam: { cotizacion: '1240', pedido: '' } }), false);
  assert.equal(tienePedido({ etapa: 'seguimiento', espejoOperam: null }), false);
});
