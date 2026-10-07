'use strict';
// #482 (GLOSSARY.md "Perdida", decision 2026-09-28 a sugerencia de Alejandro):
// una Oportunidad que ya tiene pedido en Operam ya se cerro y no se puede
// perder. "Tiene pedido" es UNA regla: etapa post-venta (Anticipo pagado o
// posterior) O el espejo de Operam de la cotizacion ya trae pedido -- aunque la
// etapa no se haya movido (hasta #535, la decorada que el candado de calca
// retenia en Seguimiento).
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

// #483 (GLOSSARY.md "Perdida"; lista final de Adrian 2026-09-30): cerrar como
// Perdida pide un Motivo de Perdida de un catalogo propio, en este orden; Otro
// exige una nota. El catalogo vive aqui para que servidor y navegador no diverjan.
test('#483: el catalogo de Motivos de Perdida es la lista final, en su orden y con acentos en pantalla', async () => {
  const { MOTIVOS_PERDIDA } = await import('../perdida-logica.js');
  assert.deepEqual(MOTIVOS_PERDIDA.map(m => m.texto), [
    'Precio', 'Proyecto pospuesto', 'Competencia', 'Tiempo de producci\u00f3n',
    'Sin respuesta', 'No cumple los requerimientos', 'Otro',
  ]);
  assert.equal(MOTIVOS_PERDIDA.find(m => m.texto === 'Otro').valor, 'otro');
});

test('#483: sin motivo o con uno fuera del catalogo no se cierra como Perdida', async () => {
  const { errorMotivoPerdida } = await import('../perdida-logica.js');
  assert.match(errorMotivoPerdida(undefined), /motivo/i);
  assert.match(errorMotivoPerdida(''), /motivo/i);
  assert.match(errorMotivoPerdida('se fue con otro'), /motivo/i);
  assert.match(errorMotivoPerdida('menudeo'), /motivo/i, 'un motivo de No util no es Motivo de Perdida');
});

test('#483: Otro exige una nota; los demas motivos no', async () => {
  const { errorMotivoPerdida, MOTIVOS_PERDIDA } = await import('../perdida-logica.js');
  assert.match(errorMotivoPerdida('otro'), /nota/i);
  assert.match(errorMotivoPerdida('otro', '   '), /nota/i);
  assert.equal(errorMotivoPerdida('otro', 'El cliente cerro su negocio'), null);
  for (const { valor } of MOTIVOS_PERDIDA.filter(m => m.valor !== 'otro')) {
    assert.equal(errorMotivoPerdida(valor), null, valor);
  }
});

test('#483: el motivo de una Perdida sale de su ultimo evento de cierre; una Perdida anterior sin motivo da null', async () => {
  const { motivoPerdidaDe, textoMotivoPerdida } = await import('../perdida-logica.js');
  assert.deepEqual(motivoPerdidaDe([
    { tipo: 'etapa', de: 'seguimiento', a: 'perdida', motivo: 'precio', nota: null },
    { tipo: 'etapa', de: 'perdida', a: 'seguimiento' },
    { tipo: 'etapa', de: 'seguimiento', a: 'perdida', motivo: 'competencia', nota: null },
    { tipo: 'toque' },
  ]), { motivo: 'competencia', nota: null });
  assert.deepEqual(motivoPerdidaDe([{ tipo: 'etapa', de: 'seguimiento', a: 'perdida', motivo: 'otro', nota: 'Cerro su negocio' }]),
    { motivo: 'otro', nota: 'Cerro su negocio' });
  assert.equal(motivoPerdidaDe([{ tipo: 'etapa', de: 'seguimiento', a: 'perdida', fecha: '2026-09-01' }]), null);
  assert.equal(motivoPerdidaDe(undefined), null);
  assert.equal(motivoPerdidaDe([
    { tipo: 'etapa', de: 'seguimiento', a: 'perdida', motivo: 'precio', nota: null },
    { tipo: 'etapa', de: 'perdida', a: 'seguimiento' },
  ]), null, 'reabierta ya no esta Perdida');
  assert.equal(textoMotivoPerdida('tiempo_produccion'), 'Tiempo de producci\u00f3n');
});
