import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ETAPAS, SALIDAS, ETAPA_LABELS, esEtapa, esSalida, transicionPorCotizacion, transicionPorAsignacion, esPreCotizacion, etiquetaFolioOperam, documentoBloqueado, LEYENDA_DEDUP_PENDIENTE, MOTIVO_PRE_SIN_LISTA, cotizacionesDedupVencidas, HORAS_VIDA_DEDUP } from '../lib/pipeline.js';

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

// La regla de dominio de la transicion automatica disparada por una cotizacion
// (CONTEXT.md "Etapas del pipeline": "La transicion Por Cotizar -> Seguimiento es
// automatica al generar una pre-cotizacion o cotizacion con el Cotizador, o cuando
// Operam reporta una cotizacion creada para la tarjeta"). Misma regla para ambos
// disparadores automaticos. Devuelve la etapa destino, o null si la cotizacion no
// debe mover la tarjeta desde la etapa actual (no salta etapas).
test('transicionPorCotizacion: Por Cotizar pasa a Seguimiento (la transicion central)', () => {
  assert.equal(transicionPorCotizacion('por_cotizar'), 'seguimiento');
});

test('transicionPorCotizacion: No util revive a Seguimiento al cotizar', () => {
  assert.equal(transicionPorCotizacion('no_util'), 'seguimiento');
});

test('transicionPorCotizacion: ya en Seguimiento sigue en Seguimiento (idempotente)', () => {
  assert.equal(transicionPorCotizacion('seguimiento'), 'seguimiento');
});

test('transicionPorCotizacion: no salta etapas desde No Asignado ni desde post-venta', () => {
  // No Asignado necesita primero asignar vendedor (-> Por Cotizar); una cotizacion
  // no debe brincarlo a Seguimiento sin dueno.
  assert.equal(transicionPorCotizacion('no_asignado'), null);
  // Las etapas post-venta las mueve Operam, no una cotizacion: nunca retroceden.
  assert.equal(transicionPorCotizacion('anticipo_pagado'), null);
  assert.equal(transicionPorCotizacion('pedido_liberado'), null);
  assert.equal(transicionPorCotizacion('saldo_pagado'), null);
  assert.equal(transicionPorCotizacion('producto_entregado'), null);
  // Perdida es una salida cerrada: no revive por cotizar (revivir es solo No util).
  assert.equal(transicionPorCotizacion('perdida'), null);
});

test('transicionPorCotizacion: una etapa desconocida no mueve la tarjeta', () => {
  assert.equal(transicionPorCotizacion('cotizado'), null);
  assert.equal(transicionPorCotizacion(undefined), null);
});

// La regla de dominio de la transicion automatica disparada por asignar un
// vendedor (issue #57, CONTEXT.md "Etapas del pipeline": "No Asignado [...]
// Requiere asignar un vendedor; al asignarlo, la tarjeta pasa automaticamente a
// Por Cotizar"). Simetrica de transicionPorCotizacion: devuelve la etapa destino
// o null si asignar un vendedor no debe mover la tarjeta desde la etapa actual.
test('transicionPorAsignacion: No Asignado pasa a Por Cotizar al asignar vendedor', () => {
  assert.equal(transicionPorAsignacion('no_asignado'), 'por_cotizar');
});

test('transicionPorAsignacion: asignar vendedor no mueve una tarjeta que ya tiene dueno', () => {
  // Por Cotizar en adelante la tarjeta ya tiene vendedor: reasignar no la avanza.
  assert.equal(transicionPorAsignacion('por_cotizar'), null);
  assert.equal(transicionPorAsignacion('seguimiento'), null);
  assert.equal(transicionPorAsignacion('anticipo_pagado'), null);
  assert.equal(transicionPorAsignacion('pedido_liberado'), null);
  assert.equal(transicionPorAsignacion('saldo_pagado'), null);
  assert.equal(transicionPorAsignacion('producto_entregado'), null);
  // Las salidas no reviven por asignar vendedor.
  assert.equal(transicionPorAsignacion('no_util'), null);
  assert.equal(transicionPorAsignacion('perdida'), null);
});

test('transicionPorAsignacion: una etapa desconocida no mueve la tarjeta', () => {
  assert.equal(transicionPorAsignacion('cotizado'), null);
  assert.equal(transicionPorAsignacion(undefined), null);
});

// Estado PRE / folio Operam nullable (issue #63, CONTEXT.md "Pre-cotizacion"):
// una cotizacion sin folio de Operam es una pre-cotizacion (estado "PRE"); la
// ausencia del folio define el estado. Con folio, la cotizacion esta registrada
// en Operam y muestra "#Operam N". El folio puede valer 0 legitimamente? No:
// Operam devuelve quote_id/factura_no, un identificador positivo; null/undefined
// y cadena vacia cuentan como ausencia.
test('esPreCotizacion: sin folio de Operam la cotizacion es PRE', () => {
  assert.equal(esPreCotizacion({ folioOperam: null }), true);
  assert.equal(esPreCotizacion({ folioOperam: undefined }), true);
  assert.equal(esPreCotizacion({ folioOperam: '' }), true);
  assert.equal(esPreCotizacion({}), true);
});

test('esPreCotizacion: con folio de Operam la cotizacion ya no es PRE', () => {
  assert.equal(esPreCotizacion({ folioOperam: 12345 }), false);
  assert.equal(esPreCotizacion({ folioOperam: '12345' }), false);
});

test('etiquetaFolioOperam: PRE sin folio, #Operam N con folio', () => {
  assert.equal(etiquetaFolioOperam({ folioOperam: null }), 'PRE');
  assert.equal(etiquetaFolioOperam({}), 'PRE');
  assert.equal(etiquetaFolioOperam({ folioOperam: 12345 }), '#Operam 12345');
  assert.equal(etiquetaFolioOperam({ folioOperam: '7788' }), '#Operam 7788');
});

// Cotizacion historica sin folio (registroDesconocido, ver migrar-pipeline): se
// asume registrada en Operam (el folio no se capturaba antes de #63), asi que NO
// es PRE y NO muestra badge (ni "PRE" ni "#Operam N").
test('esPreCotizacion: una historica con registro desconocido no es PRE', () => {
  assert.equal(esPreCotizacion({ folioOperam: null, registroDesconocido: true }), false);
});

test('etiquetaFolioOperam: una historica con registro desconocido no muestra etiqueta', () => {
  assert.equal(etiquetaFolioOperam({ folioOperam: null, registroDesconocido: true }), '');
});

// ============================================================
// Candado del documento por duplicado sin resolver (#204, ajuste posterior a la
// nota de ADR-0001). Ante candidatos ya no hay salida comoda: el vendedor
// resuelve (elegir / crear nuevo) o el registro muere a las 24 horas. Mientras
// tanto el documento NO se genera -- y eso se decide aqui porque los GET que
// regeneran van SIN auth.
// ============================================================

test('P1: documentoBloqueado solo con motivoPre dedup', () => {
  assert.equal(documentoBloqueado({ data: { motivoPre: 'dedup' } }), true);
  // 'operam' es el PRE de siempre (Operam fallo): el documento SI sale.
  assert.equal(documentoBloqueado({ data: { motivoPre: 'operam' } }), false);
  assert.equal(documentoBloqueado({ data: {} }), false);
  assert.equal(documentoBloqueado({}), false);
  assert.equal(documentoBloqueado(null), false);
});

// La fila del Historial llega APLANADA (GET /api/cotizaciones expone los campos
// de data uno por uno, no el data entero), mientras el server trabaja con la
// entrada completa. Es el mismo campo a dos alturas, como folioOperam.
test('P1b: documentoBloqueado tambien lee la fila aplanada del Historial', () => {
  assert.equal(documentoBloqueado({ id: 1, motivoPre: 'dedup' }), true);
  assert.equal(documentoBloqueado({ id: 1, motivoPre: 'operam' }), false);
  assert.equal(documentoBloqueado({ id: 1, motivoPre: null }), false);
});

test('P2: la leyenda del candado nombra el duplicado pendiente', () => {
  assert.match(LEYENDA_DEDUP_PENDIENTE, /duplicado/i);
});

// #285: tercer motivo de PRE. El cliente de Operam se quedo sin lista de precios
// y no puede valuar el documento; el arreglo esta en el CLIENTE, no en la
// cotizacion. Como 'operam', el documento SI sale (ADR-0009) -- lo que cambia es
// que reintentar sin tocar Operam da exactamente el mismo error.
test('P2c: motivoPre sin-lista no bloquea el documento', () => {
  assert.equal(MOTIVO_PRE_SIN_LISTA, 'sin-lista');
  assert.equal(documentoBloqueado({ data: { motivoPre: MOTIVO_PRE_SIN_LISTA } }), false);
  assert.equal(documentoBloqueado({ id: 1, motivoPre: MOTIVO_PRE_SIN_LISTA }), false);
});

// public/js/pipeline-logica.js NO puede importar de lib/ (solo public/ se sirve
// al navegador: un import a ../../lib/ da 404 y solo se ve EJECUTANDO). Por eso
// reexpresa el candado, igual que ya hace con el vocabulario de etapas. Esta es
// la prueba que impide que las dos definiciones deriven.
test('P2b: la reexpresion frontend del candado coincide con la de lib/', async () => {
  const frontend = await import('../public/js/pipeline-logica.js');
  assert.equal(frontend.LEYENDA_DEDUP_PENDIENTE, LEYENDA_DEDUP_PENDIENTE);
  for (const cot of [
    { data: { motivoPre: 'dedup' } },
    { data: { motivoPre: 'operam' } },
    { motivoPre: 'dedup' },
    { motivoPre: 'operam' },
    { data: { motivoPre: 'sin-lista' } },
    { motivoPre: 'sin-lista' },
    { data: {} },
    {},
  ]) {
    assert.equal(frontend.documentoBloqueado(cot), documentoBloqueado(cot), JSON.stringify(cot));
  }
});

// El barrido borra SOLO las 'dedup' vencidas. Las 'operam' son el flujo PRE
// normal (Operam se cayo) y jamas se tocan: ahi el vendedor tiene un documento
// legitimo y un reintento pendiente.
test('P3: cotizacionesDedupVencidas borra las dedup con mas de 24h y respeta las demas', () => {
  const ahora = new Date('2026-08-20T12:00:00Z');
  const hace = h => new Date(ahora.getTime() - h * 3600 * 1000).toISOString();
  const cots = [
    { id: 1, data: { motivoPre: 'dedup', motivoPreDesde: hace(25) } },
    { id: 2, data: { motivoPre: 'dedup', motivoPreDesde: hace(23) } },
    { id: 3, data: { motivoPre: 'operam', motivoPreDesde: hace(500) } },
    { id: 4, data: {} },
    { id: 5, folioOperam: '1234', data: {} },
  ];
  assert.deepEqual(cotizacionesDedupVencidas(cots, ahora), [1]);
});

test('P4: el umbral del barrido es de 24 horas', () => {
  assert.equal(HORAS_VIDA_DEDUP, 24);
});

// Salvaguarda asimetrica: si el borrado del flag fallara tras conseguir folio,
// bloquear el documento es un fastidio recuperable, pero BORRAR una cotizacion
// ya registrada en Operam es irreversible. El barrido exige ademas que siga PRE.
test('P5: cotizacionesDedupVencidas nunca borra una cotizacion que ya tiene folio', () => {
  const ahora = new Date('2026-08-20T12:00:00Z');
  const viejo = new Date(ahora.getTime() - 99 * 3600 * 1000).toISOString();
  const cots = [{ id: 9, folioOperam: '1230', data: { motivoPre: 'dedup', motivoPreDesde: viejo } }];
  assert.deepEqual(cotizacionesDedupVencidas(cots, ahora), []);
});

// Sin marca de tiempo no se puede saber la antiguedad: no se borra (mejor dejar
// basura que borrar algo que quiza es de hace un minuto).
test('P6: cotizacionesDedupVencidas ignora una dedup sin marca de tiempo', () => {
  const cots = [{ id: 7, data: { motivoPre: 'dedup' } }];
  assert.deepEqual(cotizacionesDedupVencidas(cots, new Date('2026-08-20T12:00:00Z')), []);
});
