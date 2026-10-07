'use strict';
// #535 (GLOSSARY.md "Producto decorado (calca)", grilling 2026-10-05): el tablero
// sigue a Operam y el checklist de calca es AVISO, no candado. Una decorada en
// Pedido liberado o despues con el checklist incompleto muestra "Calca
// incompleta" en la tarjeta y en la fila cerrada de la lista, y su plegable de
// la calca pasa del tono pendiente al de alerta.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let calcaIncompletaAvanzada, PASOS_DECORADO, L;
before(async () => {
  ({ calcaIncompletaAvanzada, PASOS_DECORADO } = await import('../decorados-logica.js'));
  L = await import('../pipeline-logica.js');
});

const AVANZADAS = ['pedido_liberado', 'saldo_pagado', 'producto_entregado'];
const ANTES = ['seguimiento', 'anticipo_pagado'];
const completo = () => PASOS_DECORADO.map(p => ({ clave: p.clave, completo: true }));
const parcial = () => PASOS_DECORADO.map((p, i) => ({ clave: p.clave, completo: i < 3 }));
const cot = (etapa, extra = {}) => ({ tipo: 'cotizacion', id: 'c64', refId: 64, nombre: 'CALCA SA', vendedor: 'Memo', etapa, total: 15000, ...extra });
const decorada = (etapa, calcaChecklist = []) => cot(etapa, { decorado: true, calcaChecklist });

test('#535: el aviso aplica a la decorada incompleta en Pedido liberado, Saldo pagado y Producto entregado', () => {
  for (const etapa of AVANZADAS) {
    assert.equal(calcaIncompletaAvanzada(decorada(etapa)), true, etapa);
    assert.equal(calcaIncompletaAvanzada(decorada(etapa, parcial())), true, etapa);
    // La forma persistida (marca y checklist en data) tambien cuenta.
    assert.equal(calcaIncompletaAvanzada({ etapa, data: { decorado: true, calcaChecklist: parcial() } }), true, etapa);
  }
});

test('#535: la decorada que nunca marco un paso (checklist null, como lo sirve /api/oportunidades) tambien lleva el aviso', () => {
  for (const etapa of AVANZADAS) {
    assert.equal(calcaIncompletaAvanzada(cot(etapa, { decorado: true, calcaChecklist: null })), true, etapa);
    assert.equal(calcaIncompletaAvanzada(cot(etapa, { decorado: true })), true, etapa);
    assert.equal(calcaIncompletaAvanzada({ etapa, data: { decorado: true } }), true, etapa);
    const o = cot(etapa, { decorado: true, calcaChecklist: null });
    assert.match(L.buildTableroPipelineHtml([o]), /Calca incompleta/, etapa);
    assert.match(L.buildFilaListaPipelineHtml(o, { abierta: false }), /Calca incompleta/, etapa);
    assert.match(L.buildDecoradoControlHtml(o), /pl-estado-alerta/, etapa);
  }
});

test('#535: sin aviso antes de Pedido liberado, con checklist completo o sin marca de decorada', () => {
  for (const etapa of ANTES) assert.equal(calcaIncompletaAvanzada(decorada(etapa)), false, etapa);
  for (const etapa of AVANZADAS) {
    assert.equal(calcaIncompletaAvanzada(decorada(etapa, completo())), false, etapa);
    assert.equal(calcaIncompletaAvanzada(cot(etapa)), false, etapa);
  }
  assert.equal(calcaIncompletaAvanzada(null), false);
});

test('#535: la tarjeta y la fila cerrada pintan "Calca incompleta" exactamente cuando aplica', () => {
  const casos = [
    ...AVANZADAS.map(e => [decorada(e), true]),
    ...AVANZADAS.map(e => [decorada(e, completo()), false]),
    ...AVANZADAS.map(e => [cot(e), false]),
    ...ANTES.map(e => [decorada(e), false]),
  ];
  for (const [o, aplica] of casos) {
    const etiqueta = `${o.etapa} decorado=${!!o.decorado}`;
    const tarjeta = L.buildTableroPipelineHtml([o]);
    const fila = L.buildFilaListaPipelineHtml(o, { abierta: false });
    assert.equal(/Calca incompleta/.test(tarjeta), aplica, `tarjeta ${etiqueta}`);
    assert.equal(/Calca incompleta/.test(fila), aplica, `fila ${etiqueta}`);
  }
});

const tonoTarjeta = (o) => (L.buildDecoradoControlHtml(o).match(/<summary>Calca <span class="pl-estado pl-estado-(\w+)"/) || [])[1];
const tonoLista = (o) => (L.buildDetalleListaPipelineHtml(o).match(/pl-calca[\s\S]*?pl-estado pl-estado-(\w+)/) || [])[1];

test('#535: el plegable de la calca va en tono de alerta cuando aplica el aviso, en la tarjeta y en la lista', () => {
  for (const etapa of AVANZADAS) {
    assert.equal(tonoTarjeta(decorada(etapa)), 'alerta', etapa);
    assert.equal(tonoLista(decorada(etapa)), 'alerta', etapa);
    assert.match(L.buildDecoradoControlHtml(decorada(etapa)), /0\/6/, etapa);
    assert.match(L.buildDetalleListaPipelineHtml(decorada(etapa)), /0 de 6/, etapa);
  }
});

test('#535: fuera del aviso el plegable conserva pendiente u ok como hoy', () => {
  for (const etapa of ANTES) {
    assert.equal(tonoTarjeta(decorada(etapa, parcial())), 'pend', etapa);
    assert.equal(tonoLista(decorada(etapa, parcial())), 'pend', etapa);
  }
  for (const etapa of [...ANTES, ...AVANZADAS]) {
    assert.equal(tonoTarjeta(decorada(etapa, completo())), 'ok', etapa);
    assert.equal(tonoLista(decorada(etapa, completo())), 'ok', etapa);
  }
});
