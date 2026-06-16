'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let COLUMNAS_PIPELINE, COLUMNA_LABELS, agruparPipeline, buildTableroPipelineHtml, esSalida, oportunidadesActivas, etiquetaFolioOperam, badgeFolioOperamHtml, puedeCompletarPreCotizacion, botonCompletarHtml, siguientePasoFormalizacion;
before(async () => {
  ({ COLUMNAS_PIPELINE, COLUMNA_LABELS, agruparPipeline, buildTableroPipelineHtml, esSalida, oportunidadesActivas, etiquetaFolioOperam, badgeFolioOperamHtml, puedeCompletarPreCotizacion, botonCompletarHtml, siguientePasoFormalizacion } =
    await import('../pipeline-logica.js'));
});

// Una oportunidad: antes de cotizar es el prospecto (etapa por_cotizar /
// no_asignado), al cotizar lleva la cotizacion (seguimiento y post-venta). El
// board recibe oportunidades ya con su etapa migrada y las reparte en columnas.
function prospecto(extra) {
  return {
    tipo: 'prospecto', id: 1, nombre: 'Laura', vendedor: 'Memo', celular: '+52 5512345678',
    ciudad: 'Puebla', canal: 'WhatsApp', etapa: 'por_cotizar', total: 0, eventos: [], data: {},
    ...extra,
  };
}
function cotizacion(extra) {
  return {
    tipo: 'cotizacion', id: 10, cliente: 'Hotel Azul', vendedor: 'Memo', total: 5000,
    totalPiezas: 50, etapa: 'seguimiento', fecha: '2026-06-10T00:00:00Z', ...extra,
  };
}

test('Q1: COLUMNAS_PIPELINE son las 7 etapas del embudo en orden (las salidas no son columnas)', () => {
  assert.deepEqual(COLUMNAS_PIPELINE, [
    'no_asignado', 'por_cotizar', 'seguimiento', 'anticipo_pagado',
    'pedido_liberado', 'saldo_pagado', 'producto_entregado',
  ]);
  assert.equal(COLUMNAS_PIPELINE.includes('no_util'), false);
  assert.equal(COLUMNAS_PIPELINE.includes('perdida'), false);
});

test('Q2: COLUMNA_LABELS tiene etiqueta legible para cada columna del embudo', () => {
  assert.equal(COLUMNA_LABELS.no_asignado, 'No Asignado');
  assert.equal(COLUMNA_LABELS.por_cotizar, 'Por Cotizar');
  assert.equal(COLUMNA_LABELS.seguimiento, 'Seguimiento');
  assert.equal(COLUMNA_LABELS.producto_entregado, 'Producto entregado');
  for (const c of COLUMNAS_PIPELINE) assert.ok(COLUMNA_LABELS[c], `falta label ${c}`);
});

test('Q3: agruparPipeline reparte cada oportunidad en la columna de su etapa', () => {
  const cols = agruparPipeline([
    prospecto({ id: 1, etapa: 'por_cotizar' }),
    prospecto({ id: 2, etapa: 'no_asignado' }),
    cotizacion({ id: 10, etapa: 'seguimiento' }),
    cotizacion({ id: 11, etapa: 'anticipo_pagado' }),
  ]);
  assert.deepEqual(cols.por_cotizar.map(o => o.id), [1]);
  assert.deepEqual(cols.no_asignado.map(o => o.id), [2]);
  assert.deepEqual(cols.seguimiento.map(o => o.id), [10]);
  assert.deepEqual(cols.anticipo_pagado.map(o => o.id), [11]);
  for (const c of COLUMNAS_PIPELINE) assert.ok(Array.isArray(cols[c]), `columna faltante ${c}`);
});

test('Q4: agruparPipeline mantiene fuera del tablero las salidas (No util y Perdida)', () => {
  const cols = agruparPipeline([
    prospecto({ id: 1, etapa: 'no_util' }),
    cotizacion({ id: 10, etapa: 'perdida' }),
    prospecto({ id: 2, etapa: 'por_cotizar' }),
  ]);
  for (const c of COLUMNAS_PIPELINE) {
    assert.equal(cols[c].some(o => esSalida(o.etapa)), false, `salida en columna activa ${c}`);
  }
  assert.deepEqual(cols.por_cotizar.map(o => o.id), [2]);
});

test('Q5: buildTableroPipelineHtml pinta las 7 columnas con label, contador y data-etapa', () => {
  const html = buildTableroPipelineHtml([
    prospecto({ id: 1, etapa: 'por_cotizar' }),
    cotizacion({ id: 10, etapa: 'seguimiento' }),
  ]);
  for (const c of COLUMNAS_PIPELINE) assert.match(html, new RegExp(`data-etapa="${c}"`));
  assert.match(html, /Por Cotizar/);
  assert.match(html, /Seguimiento/);
  assert.match(html, /No Asignado/);
  assert.match(html, /Producto entregado/);
});

test('Q6: cada tarjeta del tablero muestra la identidad de la oportunidad (nombre del prospecto o cliente)', () => {
  const html = buildTableroPipelineHtml([
    prospecto({ id: 1, nombre: 'Laura', etapa: 'por_cotizar' }),
    cotizacion({ id: 10, cliente: 'Hotel Azul', etapa: 'seguimiento' }),
  ]);
  assert.match(html, /Laura/);
  assert.match(html, /Hotel Azul/);
});

test('Q7: el tablero muestra la suma en pesos por columna', () => {
  const html = buildTableroPipelineHtml([
    cotizacion({ id: 10, total: 5000, etapa: 'seguimiento' }),
    cotizacion({ id: 11, total: 2500, etapa: 'seguimiento' }),
  ]);
  assert.match(html, /\$7,500\.00/);
});

test('Q8: una columna vacia pinta su estado vacio', () => {
  const html = buildTableroPipelineHtml([]);
  assert.match(html, /tablero-col-vacia/);
});

test('Q9: el tablero escapa los datos de usuario (XSS)', () => {
  const html = buildTableroPipelineHtml([prospecto({ id: 1, nombre: '<img src=x onerror=alert(1)>', etapa: 'por_cotizar' })]);
  assert.equal(html.includes('<img src=x'), false);
  assert.match(html, /&lt;img/);
});

// Estado PRE / folio Operam (issue #63): la tarjeta del tablero distingue una
// pre-cotizacion (badge "PRE") de una cotizacion registrada en Operam ("#Operam
// N"). Reusa la regla pura del dominio (etiquetaFolioOperam).
test('Q11: etiquetaFolioOperam reexpone la regla de dominio: PRE sin folio, #Operam N con folio', () => {
  assert.equal(etiquetaFolioOperam({ folioOperam: null }), 'PRE');
  assert.equal(etiquetaFolioOperam({}), 'PRE');
  assert.equal(etiquetaFolioOperam({ folioOperam: '7788' }), '#Operam 7788');
});

test('Q12: la tarjeta de una cotizacion sin folio muestra el badge PRE', () => {
  const html = buildTableroPipelineHtml([cotizacion({ id: 10, etapa: 'seguimiento', folioOperam: null })]);
  assert.match(html, /PRE/);
  assert.equal(html.includes('#Operam'), false);
});

test('Q13: la tarjeta de una cotizacion con folio muestra #Operam N en vez de PRE', () => {
  const html = buildTableroPipelineHtml([cotizacion({ id: 10, etapa: 'seguimiento', folioOperam: '55123' })]);
  assert.match(html, /#Operam 55123/);
  assert.equal(/>PRE</.test(html), false);
});

test('Q14: un prospecto (aun sin cotizar) no muestra badge PRE/Operam', () => {
  const html = buildTableroPipelineHtml([prospecto({ id: 1, etapa: 'por_cotizar' })]);
  assert.equal(html.includes('PRE'), false);
  assert.equal(html.includes('#Operam'), false);
});

test('Q15: una cotizacion historica (registro desconocido, sin folio) no muestra badge PRE ni #Operam', () => {
  const html = buildTableroPipelineHtml([cotizacion({ id: 10, etapa: 'seguimiento', folioOperam: null, registroDesconocido: true })]);
  assert.equal(html.includes('PRE'), false);
  assert.equal(html.includes('#Operam'), false);
});

// El badge es una sola fuente reusada por tablero, cola Hoy y vista lista: PRE
// (ambar) sin folio, #Operam (azul) con folio, y nada para una historica de
// registro desconocido (evita el chip vacio en cola/lista).
test('Q16: badgeFolioOperamHtml unifica el chip PRE / #Operam / vacio', () => {
  assert.match(badgeFolioOperamHtml({ folioOperam: null }), /badge-pre/);
  assert.match(badgeFolioOperamHtml({ folioOperam: null }), />PRE</);
  assert.match(badgeFolioOperamHtml({ folioOperam: '900' }), /badge-operam/);
  assert.match(badgeFolioOperamHtml({ folioOperam: '900' }), /#Operam 900/);
  assert.equal(badgeFolioOperamHtml({ folioOperam: null, registroDesconocido: true }), '');
});

// Formalizar una pre-cotizacion desde su tarjeta (issue #66, AC1): el boton
// "Completar" solo aplica sobre una cotizacion que todavia es PRE (sin folio y
// no historica de registro desconocido). Una cotizacion ya registrada (#Operam
// N) o una historica no ofrece "Completar". Misma regla de dominio que el badge.
test('Q17: puedeCompletarPreCotizacion solo es true para una cotizacion PRE (sin folio, no historica)', () => {
  assert.equal(puedeCompletarPreCotizacion({ folioOperam: null }), true);
  assert.equal(puedeCompletarPreCotizacion({}), true);
  assert.equal(puedeCompletarPreCotizacion({ folioOperam: '' }), true);
  assert.equal(puedeCompletarPreCotizacion({ folioOperam: '7788' }), false);
  assert.equal(puedeCompletarPreCotizacion({ folioOperam: null, registroDesconocido: true }), false);
  assert.equal(puedeCompletarPreCotizacion(null), false);
});

test('Q18: botonCompletarHtml pinta el boton Completar solo sobre una tarjeta PRE, con su disparador', () => {
  const pre = botonCompletarHtml({ id: 42, folioOperam: null });
  assert.match(pre, /Completar/);
  assert.match(pre, /completarPreCotizacion\(42\)/);
  // Una cotizacion ya registrada (#Operam N) no ofrece Completar.
  assert.equal(botonCompletarHtml({ id: 7, folioOperam: '900' }), '');
  // Una historica de registro desconocido tampoco.
  assert.equal(botonCompletarHtml({ id: 9, folioOperam: null, registroDesconocido: true }), '');
});

// Encadenamiento de la formalizacion (issue #66, AC1): "Completar" intenta el
// registro directo; el siguiente paso lo decide el resultado. Si Operam no halla
// el cliente, el vendedor pasa al alta (flujo existente, prellenado); si el
// registro funciono, queda listo (folio); cualquier otro fallo se reporta sin
// mandar al alta. Funcion pura sobre la respuesta del servidor (status + error).
test('Q19: siguientePasoFormalizacion encadena registro directo, fallback al alta o error', () => {
  // Registro OK: la cotizacion obtuvo folio, ya no es PRE.
  assert.equal(siguientePasoFormalizacion({ ok: true, folio: 77001 }), 'listo');
  // Operam no halla al cliente -> hay que darlo de alta primero.
  assert.equal(
    siguientePasoFormalizacion({ ok: false, status: 503, error: 'No se pudo subir a Operam: Cliente no encontrado en Operam' }),
    'alta',
  );
  // Cualquier otro fallo (Operam caido, 404, etc.) no manda al alta: se reporta.
  assert.equal(siguientePasoFormalizacion({ ok: false, status: 503, error: 'No se pudo subir a Operam: Operam 500' }), 'error');
  assert.equal(siguientePasoFormalizacion({ ok: false, status: 404, error: 'Cotizacion no encontrada' }), 'error');
});

test('Q10: oportunidadesActivas excluye las salidas (No util, Perdida) -- misma regla que el tablero, para la vista lista', () => {
  const activas = oportunidadesActivas([
    prospecto({ id: 1, etapa: 'por_cotizar' }),
    prospecto({ id: 2, etapa: 'no_util' }),
    cotizacion({ id: 10, etapa: 'seguimiento' }),
    cotizacion({ id: 11, etapa: 'perdida' }),
  ]);
  assert.deepEqual(activas.map(o => o.id), [1, 10]);
  assert.equal(activas.some(o => esSalida(o.etapa)), false);
  assert.deepEqual(oportunidadesActivas([]), []);
  assert.deepEqual(oportunidadesActivas(null), []);
});
