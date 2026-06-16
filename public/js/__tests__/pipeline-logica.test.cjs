'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let COLUMNAS_PIPELINE, COLUMNA_LABELS, agruparPipeline, buildTableroPipelineHtml, esSalida, oportunidadesActivas, etiquetaFolioOperam, badgeFolioOperamHtml, badgeFolioOperamProspectoHtml, puedeCompletarPreCotizacion, botonCompletarHtml, siguientePasoFormalizacion, buildColaHoyHtml, buildColaCotizacionItemHtml, ACCIONES_NUEVO, buildMenuNuevoHtml, esAsignable, buildAsignarControlHtml, buildMoverSeguimientoControlHtml;
before(async () => {
  ({ COLUMNAS_PIPELINE, COLUMNA_LABELS, agruparPipeline, buildTableroPipelineHtml, esSalida, oportunidadesActivas, etiquetaFolioOperam, badgeFolioOperamHtml, badgeFolioOperamProspectoHtml, puedeCompletarPreCotizacion, botonCompletarHtml, siguientePasoFormalizacion, buildColaHoyHtml, buildColaCotizacionItemHtml, ACCIONES_NUEVO, buildMenuNuevoHtml, esAsignable, buildAsignarControlHtml, buildMoverSeguimientoControlHtml } =
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

// Cola Hoy fusionada (issue #64, CONTEXT.md "Cola Hoy"): buildColaHoyHtml itera
// la cola que ya viene fusionada y ordenada del backend (lib/cola-hoy.js) y
// delega la pintura por tipo, PRESERVANDO el orden (no reagrupa por tipo). El
// item de prospecto reusa buildColaProspectosHtml; el de cotizacion lleva su
// mensaje de seguimiento por WhatsApp.
function itemProspecto(extra) {
  return {
    tipo: 'prospecto', id: 1, nombre: 'Laura', celular: '+52 5512345678',
    ciudad: 'Puebla', canal: 'WhatsApp', etapa: 'por_cotizar', vendedor: 'Memo',
    horas: 30, toques: 1, color: 'rojo', sugerirNoUtil: false, yaEsCliente: false,
    reunionVencida: false, fechaReunion: null, urgencia: 3, ...extra,
  };
}
function itemCotizacion(extra) {
  return {
    tipo: 'cotizacion', id: 10, paso: 'dia7', dias: 9, cliente: 'Hotel Azul',
    vendedor: 'Memo', total: 5000, totalPiezas: 50, fecha: '2026-06-07T00:00:00Z',
    folioOperam: null, registroDesconocido: false, telefono: '525598765432',
    mensaje: 'Hola Hotel Azul, te escribe Memo de pp.peltre sobre la cotizacion...',
    waLink: 'https://wa.me/525598765432?text=Hola', urgencia: 0.32, ...extra,
  };
}

test('Q20: buildColaHoyHtml pinta la cola fusionada en el ORDEN del backend, sin reagrupar por tipo', () => {
  // El backend ya ordeno: cotizacion vencida primero, luego el prospecto.
  const html = buildColaHoyHtml([itemCotizacion({ id: 10 }), itemProspecto({ id: 1 })]);
  const posCot = html.indexOf('Hotel Azul');
  const posPro = html.indexOf('Laura');
  assert.ok(posCot >= 0 && posPro >= 0, 'pinta ambos items');
  assert.ok(posCot < posPro, 'preserva el orden del backend (cotizacion antes que prospecto)');

  // Mismo arreglo en orden inverso: el HTML invierte tambien.
  const html2 = buildColaHoyHtml([itemProspecto({ id: 1 }), itemCotizacion({ id: 10 })]);
  assert.ok(html2.indexOf('Laura') < html2.indexOf('Hotel Azul'), 'preserva el nuevo orden');
});

test('Q21: cada item de la cola Hoy expone la accion de su tipo', () => {
  const html = buildColaHoyHtml([
    itemProspecto({ id: 1 }),
    itemCotizacion({ id: 10, waLink: 'https://wa.me/525598765432?text=Hola' }),
  ]);
  // Prospecto: registrar contacto (reusa buildColaProspectosHtml).
  assert.match(html, /registrarToqueProspecto\(1\)/);
  // Cotizacion: WhatsApp de seguimiento + marcar el paso hecho + cerrar estado.
  assert.match(html, /href="https:\/\/wa\.me\/525598765432/);
  assert.match(html, /marcarSeguimiento\(10, 'dia7'\)/);
  assert.match(html, /cambiarEstadoCotizacion\(10, 'ganada'\)/);
  assert.match(html, /cambiarEstadoCotizacion\(10, 'perdida'\)/);
});

test('Q22: el item de cotizacion en Hoy reutiliza un builder propio (WhatsApp, badge folio, paso, dias)', () => {
  const html = buildColaCotizacionItemHtml(itemCotizacion({
    id: 10, paso: 'vencida', dias: 30, total: 5000, cliente: 'Hotel Azul',
    folioOperam: '7788', waLink: 'https://wa.me/525598765432?text=Hola',
  }));
  assert.match(html, /Hotel Azul/);
  assert.match(html, /Operam 7788/);          // badge de folio (#Operam N)
  assert.match(html, /Vencida/);               // etiqueta del paso
  assert.match(html, /href="https:\/\/wa\.me\/525598765432/);
  assert.match(html, /marcarSeguimiento\(10, 'vencida'\)/);
});

test('Q23: cotizacion sin telefono pinta WhatsApp deshabilitado, no un enlace roto', () => {
  const html = buildColaCotizacionItemHtml(itemCotizacion({ id: 10, telefono: null, waLink: null }));
  assert.match(html, /disabled/);
  assert.equal(/href="https:\/\/wa\.me/.test(html), false);
});

test('Q24: buildColaHoyHtml con cola vacia muestra el estado vacio', () => {
  assert.match(buildColaHoyHtml([]), /Nada pendiente/);
  assert.match(buildColaHoyHtml(null), /Nada pendiente/);
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

// Boton + global (issue #54, PRD #52 historias 4-5, CONTEXT.md "Captura de
// prospecto"): visible en todos los destinos del bottom-nav, ofrece dos
// acciones -- "Nueva cotizacion" (la vista de cotizar existente) y "Nuevo
// prospecto" (la captura minima existente). Logica pura de presentacion del
// menu, sin DOM (mismo patron que el resto del modulo).
test('Q25: ACCIONES_NUEVO ofrece exactamente Nueva cotizacion y Nuevo prospecto', () => {
  assert.deepEqual(ACCIONES_NUEVO.map(a => a.label), ['Nueva cotizacion', 'Nuevo prospecto']);
  assert.deepEqual(ACCIONES_NUEVO.map(a => a.accion), ['nuevaCotizacion', 'nuevoProspecto']);
});

test('Q26: buildMenuNuevoHtml pinta un boton por accion con su disparador', () => {
  const html = buildMenuNuevoHtml();
  assert.match(html, /Nueva cotizacion/);
  assert.match(html, /Nuevo prospecto/);
  assert.match(html, /onclick="nuevaCotizacion\(\)"/);
  assert.match(html, /onclick="nuevoProspecto\(\)"/);
  // Un boton por accion, ninguno de mas.
  assert.equal((html.match(/<button/g) || []).length, ACCIONES_NUEVO.length);
});

// Asignar vendedor a una tarjeta en No Asignado (issue #57): la PRIMERA accion de
// tarjeta del tablero (hasta ahora solo-lectura, #53). Solo aparece para el admin
// (quien asigna) y solo sobre una oportunidad en no_asignado; al elegir un
// vendedor y confirmar, app.js llama PATCH /api/prospectos/:id/asignar y la
// tarjeta pasa a Por Cotizar (regla de dominio).
const VENDEDORES = [{ id: 2, name: 'Alejandro Chavez' }, { id: 3, name: 'Oswaldo Chavez' }];

test('Q27: esAsignable solo en no_asignado', () => {
  assert.equal(esAsignable(prospecto({ etapa: 'no_asignado' })), true);
  assert.equal(esAsignable(prospecto({ etapa: 'por_cotizar' })), false);
  assert.equal(esAsignable(cotizacion({ etapa: 'seguimiento' })), false);
  assert.equal(esAsignable(undefined), false);
});

test('Q28: buildAsignarControlHtml pinta el selector de vendedores y el boton solo para admin en No Asignado', () => {
  const html = buildAsignarControlHtml(prospecto({ id: 5, etapa: 'no_asignado' }), VENDEDORES, true);
  assert.match(html, /<select/);
  assert.match(html, /Alejandro Chavez/);
  assert.match(html, /Oswaldo Chavez/);
  assert.match(html, /asignarVendedorTablero\(5\)/);
  // el selector se identifica por el id de la tarjeta (lo lee app.js)
  assert.match(html, /asignar-vendedor-5/);
});

test('Q29: buildAsignarControlHtml no pinta control fuera de No Asignado ni para no-admin', () => {
  assert.equal(buildAsignarControlHtml(prospecto({ etapa: 'por_cotizar' }), VENDEDORES, true), '');
  assert.equal(buildAsignarControlHtml(prospecto({ etapa: 'no_asignado' }), VENDEDORES, false), '');
});

test('Q30: el tablero pinta el control de asignar en la tarjeta No Asignado para admin', () => {
  const html = buildTableroPipelineHtml(
    [prospecto({ id: 7, etapa: 'no_asignado' }), prospecto({ id: 8, etapa: 'por_cotizar' })],
    { vendedores: VENDEDORES, esAdmin: true }
  );
  assert.match(html, /asignarVendedorTablero\(7\)/);
  // no aparece sobre la tarjeta que ya tiene dueno
  assert.equal(html.includes('asignarVendedorTablero(8)'), false);
});

test('Q31: el tablero sin opciones (no-admin o sin vendedores) no pinta el control de asignar (read-only)', () => {
  const html = buildTableroPipelineHtml([prospecto({ id: 7, etapa: 'no_asignado' })]);
  assert.equal(html.includes('asignarVendedorTablero'), false);
  const noAdmin = buildTableroPipelineHtml([prospecto({ id: 7, etapa: 'no_asignado' })], { vendedores: VENDEDORES, esAdmin: false });
  assert.equal(noAdmin.includes('asignarVendedorTablero'), false);
});

// Folio de Operam de un PROSPECTO movido a mano (issue #56, AC3): el folio vive
// en el prospecto (data.folioOperam, cotizo por fuera). La tarjeta muestra
// "#Operam N" SOLO si hay folio; jamas pinta "PRE" (PRE es un concepto de
// cotizacion, no de prospecto). Sin folio no muestra nada.
test('Q32: badgeFolioOperamProspectoHtml pinta #Operam N solo con folio; nunca PRE', () => {
  assert.match(badgeFolioOperamProspectoHtml({ folioOperam: '55123' }), /#Operam 55123/);
  assert.match(badgeFolioOperamProspectoHtml({ folioOperam: '55123' }), /badge-operam/);
  assert.equal(badgeFolioOperamProspectoHtml({ folioOperam: null }), '');
  assert.equal(badgeFolioOperamProspectoHtml({ folioOperam: '' }), '');
  assert.equal(badgeFolioOperamProspectoHtml({}), '');
  assert.equal(/PRE/.test(badgeFolioOperamProspectoHtml({ folioOperam: null })), false);
});

test('Q33: la tarjeta de un prospecto movido a mano (con folio) muestra #Operam N y nunca PRE', () => {
  const html = buildTableroPipelineHtml([prospecto({ id: 1, etapa: 'seguimiento', folioOperam: '55123' })]);
  assert.match(html, /#Operam 55123/);
  assert.equal(html.includes('PRE'), false);
});

test('Q34: un prospecto sin folio no muestra badge (ni PRE ni #Operam)', () => {
  const html = buildTableroPipelineHtml([prospecto({ id: 1, etapa: 'por_cotizar', folioOperam: null })]);
  assert.equal(html.includes('PRE'), false);
  assert.equal(html.includes('#Operam'), false);
});
