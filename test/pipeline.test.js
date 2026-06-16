import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ETAPAS, SALIDAS, ETAPA_LABELS, esEtapa, esSalida } from '../lib/pipeline.js';

// El vocabulario canonico de las 7 etapas del pipeline unificado (CONTEXT.md
// "Etapas del pipeline", ADR-0005). El orden es el del embudo: del primer
// interes al producto entregado.
test('ETAPAS son las 7 etapas canonicas en orden del embudo', () => {
  assert.deepEqual(ETAPAS, [
    'no_asignado',
    'por_cotizar',
    'seguimiento',
    'anticipo_pagado',
    'pedido_liberado',
    'saldo_pagado',
    'producto_entregado',
  ]);
});

test('SALIDAS son las dos salidas del pipeline', () => {
  assert.deepEqual(SALIDAS, ['no_util', 'perdida']);
});

test('ETAPA_LABELS tiene una etiqueta legible para cada etapa y cada salida', () => {
  assert.equal(ETAPA_LABELS.no_asignado, 'No Asignado');
  assert.equal(ETAPA_LABELS.por_cotizar, 'Por Cotizar');
  assert.equal(ETAPA_LABELS.seguimiento, 'Seguimiento');
  assert.equal(ETAPA_LABELS.anticipo_pagado, 'Anticipo pagado');
  assert.equal(ETAPA_LABELS.pedido_liberado, 'Pedido liberado');
  assert.equal(ETAPA_LABELS.saldo_pagado, 'Saldo pagado');
  assert.equal(ETAPA_LABELS.producto_entregado, 'Producto entregado');
  assert.equal(ETAPA_LABELS.no_util, 'No útil');
  assert.equal(ETAPA_LABELS.perdida, 'Perdida');
  for (const k of [...ETAPAS, ...SALIDAS]) {
    assert.ok(ETAPA_LABELS[k], `falta label para ${k}`);
  }
});

test('esEtapa distingue una etapa del pipeline de una salida o un valor invalido', () => {
  assert.equal(esEtapa('por_cotizar'), true);
  assert.equal(esEtapa('producto_entregado'), true);
  assert.equal(esEtapa('no_util'), false);
  assert.equal(esEtapa('cotizado'), false);
  assert.equal(esEtapa(''), false);
  assert.equal(esEtapa(undefined), false);
});

test('esSalida reconoce solo las dos salidas', () => {
  assert.equal(esSalida('no_util'), true);
  assert.equal(esSalida('perdida'), true);
  assert.equal(esSalida('por_cotizar'), false);
  assert.equal(esSalida(undefined), false);
});
