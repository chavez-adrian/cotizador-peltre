'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let COLUMNAS_PIPELINE, COLUMNA_LABELS, agruparPipeline, buildTableroPipelineHtml, esSalida, oportunidadesActivas, etiquetaFolioOperam, badgeFolioOperamHtml, badgeFolioOperamProspectoHtml, puedeCompletarPreCotizacion, botonCompletarHtml, siguientePasoFormalizacion, buildColaHoyHtml, buildColaCotizacionItemHtml, ACCIONES_NUEVO, buildMenuNuevoHtml, esAsignable, buildAsignarControlHtml, buildMoverSeguimientoControlHtml, buildSalidaControlHtml, buildCerradasHtml, buildDecoradoControlHtml, cadenaOperamTexto, cadenaOperamHtml, cobranzaSinRegistrar, badgePagoSinRegistrarHtml;
before(async () => {
  ({ COLUMNAS_PIPELINE, COLUMNA_LABELS, agruparPipeline, buildTableroPipelineHtml, esSalida, oportunidadesActivas, etiquetaFolioOperam, badgeFolioOperamHtml, badgeFolioOperamProspectoHtml, puedeCompletarPreCotizacion, botonCompletarHtml, siguientePasoFormalizacion, buildColaHoyHtml, buildColaCotizacionItemHtml, ACCIONES_NUEVO, buildMenuNuevoHtml, esAsignable, buildAsignarControlHtml, buildMoverSeguimientoControlHtml, buildSalidaControlHtml, buildCerradasHtml, buildDecoradoControlHtml, cadenaOperamTexto, cadenaOperamHtml, cobranzaSinRegistrar, badgePagoSinRegistrarHtml } =
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

// === Issue #65: reunion de diagnostico sobre una cotizacion en la cola Hoy ===

test('Q25: la card de cotizacion ofrece agendar reunion (input datetime + boton con el id numerico)', () => {
  const html = buildColaCotizacionItemHtml(itemCotizacion({ id: 10 }));
  assert.match(html, /type="datetime-local"/);
  assert.match(html, /id="cot-reunion-10"/);
  assert.match(html, /agendarReunionCotizacion\(10\)/);
});

test('Q26: una cotizacion con reunion vencida pide el resultado: avance (Hecho) o Perdida, nunca No util (Modelo A)', () => {
  const html = buildColaCotizacionItemHtml(itemCotizacion({
    id: 10, reunionVencida: true, fechaReunion: '2026-06-09T17:00:00Z',
  }));
  assert.match(html, /registrar resultado/i);
  assert.match(html, /resultadoReunionCotizacion\(10, 'avance'\)/);
  assert.match(html, /resultadoReunionCotizacion\(10, 'perdida'\)/);
  // Modelo A: una cotizacion no sale por No util.
  assert.equal(html.includes('No útil'), false);
  assert.equal(html.includes('marcarNoUtil'), false);
});

test('Q27: una cotizacion sin reunion vencida conserva el flujo de seguimiento normal', () => {
  const html = buildColaCotizacionItemHtml(itemCotizacion({ id: 10, paso: 'dia7', reunionVencida: false }));
  assert.match(html, /marcarSeguimiento\(10, 'dia7'\)/);
  assert.equal(html.includes('registrar resultado'), false);
  assert.equal(html.includes('resultadoReunionCotizacion'), false);
});

test('Q28: una cotizacion que reaparece solo por reunion vencida (paso null) no pinta marcar Hecho roto', () => {
  const html = buildColaCotizacionItemHtml(itemCotizacion({
    id: 10, paso: null, reunionVencida: true, fechaReunion: '2026-06-09T17:00:00Z',
  }));
  // no debe quedar un onclick con 'null' como paso
  assert.equal(/marcarSeguimiento\(10, 'null'\)/.test(html), false);
  // el resultado de reunion sigue disponible
  assert.match(html, /resultadoReunionCotizacion\(10, 'avance'\)/);
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

// Cadena de folios de Operam en la tarjeta (issue #67, AC4): la oportunidad que ya
// sincronizo con Operam (espejoOperam persistido en #67 AC3) muestra su cadena para
// trazabilidad sin entrar al ERP. Texto compacto, estilo badge; solo los eslabones
// presentes. Logica pura aqui (texto/estructura); el wiring en app.js.
test('Q34b: cadenaOperamTexto arma la cadena completa con solo los eslabones presentes', () => {
  // El estado de pago es derivado (espejo.pago), no un folio: 'pagado'/'anticipo'
  // (los pagos tipo 12 no son atribuibles a un pedido por la API, decision #67).
  const espejo = {
    cotizacion: '1141', pedido: '7269',
    factura: { numero: '6735', ref: 'A1907' },
    remisiones: ['2142'], pago: 'pagado',
  };
  assert.equal(
    cadenaOperamTexto(espejo),
    'Cot #1141 - Pedido #7269 - Factura A1907 - Remision - Pagado'
  );
});

test('Q34c: cadenaOperamTexto muestra solo los eslabones que existen', () => {
  // Solo cotizacion + pedido (aun sin factura/remision/pago).
  assert.equal(
    cadenaOperamTexto({ cotizacion: '1141', pedido: '7269', remisiones: [] }),
    'Cot #1141 - Pedido #7269'
  );
  // Factura con ref vacia: usa el numero como fallback.
  assert.equal(
    cadenaOperamTexto({ pedido: '7269', factura: { numero: '6735', ref: '' }, remisiones: [] }),
    'Pedido #7269 - Factura 6735'
  );
  // Estado de pago "anticipo" (pago parcial de la factura).
  assert.equal(
    cadenaOperamTexto({ cotizacion: '1', pedido: '2', factura: { numero: '6735', ref: 'A1907' }, remisiones: [], pago: 'anticipo' }),
    'Cot #1 - Pedido #2 - Factura A1907 - Anticipo'
  );
});

test('Q34d: cadenaOperamTexto sin espejo (o vacio) devuelve cadena vacia', () => {
  assert.equal(cadenaOperamTexto(null), '');
  assert.equal(cadenaOperamTexto(undefined), '');
  assert.equal(cadenaOperamTexto({}), '');
  assert.equal(cadenaOperamTexto({ remisiones: [] }), '');
});

test('Q34e: cadenaOperamHtml envuelve la cadena en un elemento solo si hay eslabones; escapa el texto', () => {
  const espejo = { cotizacion: '1141', pedido: '7269', remisiones: [] };
  const html = cadenaOperamHtml(espejo);
  assert.match(html, /Cot #1141 - Pedido #7269/);
  assert.match(html, /cot-cadena-operam/);
  // Sin espejo no pinta nada.
  assert.equal(cadenaOperamHtml(null), '');
  assert.equal(cadenaOperamHtml({}), '');
});

test('Q34f: la tarjeta de una cotizacion con espejoOperam muestra la cadena de folios', () => {
  const op = cotizacion({
    id: 10, etapa: 'producto_entregado', folioOperam: '1141',
    espejoOperam: {
      cotizacion: '1141', pedido: '7269', factura: { numero: '6735', ref: 'A1907' },
      remisiones: ['2142'], pago: 'pagado',
    },
  });
  const html = buildTableroPipelineHtml([op]);
  assert.match(html, /Pedido #7269/);
  assert.match(html, /Factura A1907/);
});

// Mover a Seguimiento a mano desde la tarjeta (issue #56, AC1): un boton sobre la
// tarjeta de un PROSPECTO en Por Cotizar abre la captura del folio (cotizo por
// fuera). El arrastre esta fuera de alcance; el trigger es un boton (mismo patron
// que el control de asignar de #57). Lo ve quien opera la tarjeta (dueno o admin),
// NO es admin-only. Una cotizacion (ya cotizada en el sistema) no lo lleva: su
// avance es automatico (#55).
test('Q35: buildMoverSeguimientoControlHtml pinta el boton solo para un prospecto en Por Cotizar, con su disparador', () => {
  const html = buildMoverSeguimientoControlHtml(prospecto({ id: 5, etapa: 'por_cotizar' }));
  assert.match(html, /<button/);
  assert.match(html, /moverASeguimientoTablero\(5\)/);
  assert.match(html, /Seguimiento/);
});

test('Q36: buildMoverSeguimientoControlHtml no pinta el boton fuera de Por Cotizar ni para una cotizacion', () => {
  assert.equal(buildMoverSeguimientoControlHtml(prospecto({ id: 5, etapa: 'no_asignado' })), '');
  assert.equal(buildMoverSeguimientoControlHtml(prospecto({ id: 5, etapa: 'seguimiento' })), '');
  assert.equal(buildMoverSeguimientoControlHtml(cotizacion({ id: 10, etapa: 'por_cotizar' })), '');
  assert.equal(buildMoverSeguimientoControlHtml(undefined), '');
});

test('Q37: el tablero pinta el boton de mover a Seguimiento en la tarjeta de prospecto Por Cotizar', () => {
  const html = buildTableroPipelineHtml([
    prospecto({ id: 7, etapa: 'por_cotizar' }),
    prospecto({ id: 8, etapa: 'no_asignado' }),
    cotizacion({ id: 10, etapa: 'seguimiento' }),
  ]);
  assert.match(html, /moverASeguimientoTablero\(7\)/);
  assert.equal(html.includes('moverASeguimientoTablero(8)'), false);
  assert.equal(html.includes('moverASeguimientoTablero(10)'), false);
});

// Regresion (hallazgo del orquestador al verificar #56): prospectoAOportunidad
// arma la oportunidad con id PREFIJADO ('p7') y el id numerico real en refId (7).
// Los controles de tarjeta deben disparar la accion con el id NUMERICO (refId);
// con el id prefijado el onclick queda "accion(p7)" -- un identificador sin
// comillas que el navegador interpreta como variable undefined (el control no
// hace nada). Los helpers de test usaban id numerico sin refId, por eso el bug de
// #57 (asignar) no se cazo. Estos casos usan la forma real.
test('Q38: buildAsignarControlHtml usa el id numerico (refId), no el id prefijado de la oportunidad', () => {
  const o = { tipo: 'prospecto', id: 'p7', refId: 7, etapa: 'no_asignado' };
  const html = buildAsignarControlHtml(o, VENDEDORES, true);
  assert.match(html, /asignarVendedorTablero\(7\)/);
  assert.match(html, /id="asignar-vendedor-7"/);
  assert.equal(html.includes('asignarVendedorTablero(p7)'), false);
  assert.equal(html.includes('asignar-vendedor-p7'), false);
});

test('Q39: buildMoverSeguimientoControlHtml usa el id numerico (refId) con la oportunidad prefijada', () => {
  const o = { tipo: 'prospecto', id: 'p7', refId: 7, etapa: 'por_cotizar' };
  const html = buildMoverSeguimientoControlHtml(o);
  assert.match(html, /moverASeguimientoTablero\(7\)/);
  assert.equal(html.includes('moverASeguimientoTablero(p7)'), false);
});

// === Issue #59: controles de salida en la tarjeta del tablero (Modelo A) ===
// PROSPECTO activo: No util (select de motivo del catalogo) + Perdida (confirm).
// COTIZACION activa: solo Perdida (confirm) -- una cotizacion sale del embudo solo
// por Perdida, no por No util (Modelo A). Las salidas no llevan estos controles.

test('Q40: buildSalidaControlHtml de un prospecto activo ofrece No util con motivo de catalogo y Perdida', () => {
  const html = buildSalidaControlHtml(prospecto({ id: 5, etapa: 'por_cotizar' }));
  assert.match(html, /marcarNoUtilTablero\(5\)/);
  assert.match(html, /id="salida-motivo-5"/);
  for (const m of ['menudeo', 'fuera de zona', 'sin presupuesto', 'spam', 'sin respuesta']) {
    assert.ok(html.includes(m), `falta motivo ${m}`);
  }
  assert.match(html, /cerrarPerdidaTablero\(5\)/);
});

test('Q41: buildSalidaControlHtml de una cotizacion activa ofrece solo Perdida, no No util (Modelo A)', () => {
  const html = buildSalidaControlHtml(cotizacion({ id: 10, etapa: 'seguimiento' }));
  assert.match(html, /cerrarPerdidaTablero\(10\)/);
  assert.equal(html.includes('marcarNoUtilTablero'), false);
  assert.equal(html.includes('salida-motivo'), false);
});

test('Q42: buildSalidaControlHtml no pinta nada para una oportunidad ya en salida', () => {
  assert.equal(buildSalidaControlHtml(prospecto({ id: 5, etapa: 'no_util' })), '');
  assert.equal(buildSalidaControlHtml(cotizacion({ id: 10, etapa: 'perdida' })), '');
  assert.equal(buildSalidaControlHtml(undefined), '');
});

test('Q43: buildSalidaControlHtml usa el id numerico (refId) con la oportunidad prefijada (#57)', () => {
  const pros = buildSalidaControlHtml({ tipo: 'prospecto', id: 'p7', refId: 7, etapa: 'por_cotizar' });
  assert.match(pros, /marcarNoUtilTablero\(7\)/);
  assert.match(pros, /cerrarPerdidaTablero\(7\)/);
  assert.match(pros, /id="salida-motivo-7"/);
  assert.equal(pros.includes('(p7)'), false);
  assert.equal(pros.includes('salida-motivo-p7'), false);
  const cot = buildSalidaControlHtml({ tipo: 'cotizacion', id: 'c10', refId: 10, etapa: 'seguimiento' });
  assert.match(cot, /cerrarPerdidaTablero\(10\)/);
  assert.equal(cot.includes('(c10)'), false);
});

test('Q44: el tablero pinta los controles de salida en las tarjetas activas, no en las de salida', () => {
  const html = buildTableroPipelineHtml([
    prospecto({ id: 7, etapa: 'por_cotizar' }),
    cotizacion({ id: 10, etapa: 'seguimiento' }),
  ]);
  assert.match(html, /marcarNoUtilTablero\(7\)/);
  assert.match(html, /cerrarPerdidaTablero\(7\)/);
  assert.match(html, /cerrarPerdidaTablero\(10\)/);
  // una cotizacion no ofrece No util (Modelo A)
  assert.equal(html.includes('marcarNoUtilTablero(10)'), false);
});

// === Issue #59 (AC3): filtro/historial de cerradas (No util / Perdida) ===

test('Q45: buildCerradasHtml lista solo las oportunidades en salida con su tipo de cierre', () => {
  const html = buildCerradasHtml([
    prospecto({ id: 1, nombre: 'Laura', etapa: 'por_cotizar' }),
    prospecto({ id: 2, nombre: 'Pedro', etapa: 'no_util', motivoNoUtil: 'spam' }),
    cotizacion({ id: 10, cliente: 'Hotel Azul', etapa: 'perdida' }),
  ]);
  // las activas no aparecen
  assert.equal(html.includes('Laura'), false);
  // No util con su motivo
  assert.match(html, /Pedro/);
  assert.match(html, /No útil/);
  assert.match(html, /spam/);
  // Perdida
  assert.match(html, /Hotel Azul/);
  assert.match(html, /Perdida/);
});

test('Q46: buildCerradasHtml muestra un vacio cuando no hay cerradas y escapa datos de usuario', () => {
  assert.match(buildCerradasHtml([]), /Sin/i);
  assert.match(buildCerradasHtml([prospecto({ id: 1, etapa: 'por_cotizar' })]), /Sin/i);
  const xss = buildCerradasHtml([prospecto({ id: 2, nombre: '<b>x</b>', etapa: 'no_util', motivoNoUtil: '<i>spam</i>' })]);
  assert.equal(xss.includes('<b>x</b>'), false);
  assert.equal(xss.includes('<i>spam</i>'), false);
});

// === Issue #61: control de decorado (calca) en la tarjeta de cotizacion ===
// Marcar decorada + checklist de 6 pasos con progreso (3/6) + togglear pasos.
// Solo aplica a cotizaciones (un prospecto sin cotizar no lleva calca). Usa el id
// numerico (refId), nunca el prefijado ("c10"), leccion del bug de #57.

test('Q47: buildDecoradoControlHtml ofrece marcar decorada en una cotizacion no decorada (sin checklist)', () => {
  const html = buildDecoradoControlHtml(cotizacion({ decorado: false }));
  assert.match(html, /decorada/i);
  // no pinta el checklist de pasos si no esta decorada
  assert.equal(/Arte final/i.test(html), false);
});

test('Q48: buildDecoradoControlHtml no pinta nada para un prospecto', () => {
  assert.equal(buildDecoradoControlHtml(prospecto({})), '');
});

test('Q49: una cotizacion decorada muestra el checklist de 6 pasos con su progreso (3/6)', () => {
  const checklist = [
    { clave: 'cotizacion_proveedor', completo: true },
    { clave: 'posicion_cliente', completo: true },
    { clave: 'arte_final', completo: true },
    { clave: 'dummy_autorizado', completo: false },
    { clave: 'liberacion_produccion', completo: false },
    { clave: 'archivos_dropbox', completo: false },
  ];
  const html = buildDecoradoControlHtml(cotizacion({ decorado: true, calcaChecklist: checklist }));
  assert.match(html, /3\s*\/\s*6/);
  // los 6 labels aparecen
  assert.match(html, /Cotizacion con proveedor/i);
  assert.match(html, /Arte final/i);
  assert.match(html, /Archivos de posicion/i);
});

test('Q50: el control de decorado usa el id numerico (refId) con la oportunidad prefijada (#57)', () => {
  const o = cotizacion({ id: 'c10', refId: 10, decorado: true, calcaChecklist: [{ clave: 'arte_final', completo: false }] });
  const html = buildDecoradoControlHtml(o);
  // las acciones togglean por id numerico 10, nunca por "c10"
  assert.equal(html.includes('c10'), false);
  assert.match(html, /\(10/);
});

test('Q51: el paso de archivos (paso 6) ofrece un input de archivo para subir a Dropbox', () => {
  const o = cotizacion({ decorado: true, calcaChecklist: [{ clave: 'archivos_dropbox', completo: false }] });
  const html = buildDecoradoControlHtml(o);
  assert.match(html, /type="file"/i);
});

test('Q52: la tarjeta del tablero pinta el control de decorado en una cotizacion en Seguimiento', () => {
  const tablero = buildTableroPipelineHtml([cotizacion({ id: 'c10', refId: 10, etapa: 'seguimiento', decorado: true, calcaChecklist: [{ clave: 'arte_final', completo: true }] })]);
  assert.match(tablero, /1\s*\/\s*6/);
});

// === Issue #77: badge "Pago sin registrar" (eje secundario de cobranza) ===
// El eje que manda en el pipeline es el cumplimiento: un pedido entregado se ve como
// producto_entregado aunque el pago no este registrado (desfase de la contadora). La
// cobranza pendiente se senala con un badge, sin retroceder la etapa. La senal de pago
// es el espejo del sync (#67, fresco) con respaldo en data.cobranza (snapshot del
// backfill #77); pagado en cualquiera de los dos -> sin badge.
test('Q53: cobranzaSinRegistrar solo en producto_entregado con pago no liquidado', () => {
  assert.equal(cobranzaSinRegistrar(cotizacion({ etapa: 'producto_entregado', cobranza: 'pendiente' })), true);
  assert.equal(cobranzaSinRegistrar(cotizacion({ etapa: 'producto_entregado', cobranza: 'anticipo' })), true);
  // entregado y pagado -> no hay nada que registrar
  assert.equal(cobranzaSinRegistrar(cotizacion({ etapa: 'producto_entregado', cobranza: 'pagado' })), false);
  // no entregado -> el badge es de entrega, no aplica aunque el pago falte
  assert.equal(cobranzaSinRegistrar(cotizacion({ etapa: 'pedido_liberado', cobranza: 'pendiente' })), false);
  // sin ninguna senal de pago -> no se afirma cobranza pendiente
  assert.equal(cobranzaSinRegistrar(cotizacion({ etapa: 'producto_entregado' })), false);
  assert.equal(cobranzaSinRegistrar(undefined), false);
});

test('Q54: cobranzaSinRegistrar prioriza el espejo del sync (fresco) sobre data.cobranza (snapshot)', () => {
  // el sync ya registro el pago (espejo.pago=pagado) aunque el snapshot del backfill diga pendiente -> sin badge
  assert.equal(cobranzaSinRegistrar(cotizacion({ etapa: 'producto_entregado', cobranza: 'pendiente', espejoOperam: { pago: 'pagado' } })), false);
  // el espejo dice anticipo -> sigue pendiente de registro -> badge
  assert.equal(cobranzaSinRegistrar(cotizacion({ etapa: 'producto_entregado', espejoOperam: { pago: 'anticipo' } })), true);
});

test('Q55: badgePagoSinRegistrarHtml pinta el chip "Pago sin registrar" solo cuando aplica', () => {
  assert.match(badgePagoSinRegistrarHtml(cotizacion({ etapa: 'producto_entregado', cobranza: 'pendiente' })), /Pago sin registrar/);
  assert.match(badgePagoSinRegistrarHtml(cotizacion({ etapa: 'producto_entregado', cobranza: 'pendiente' })), /cot-badge/);
  assert.equal(badgePagoSinRegistrarHtml(cotizacion({ etapa: 'producto_entregado', cobranza: 'pagado' })), '');
  assert.equal(badgePagoSinRegistrarHtml(cotizacion({ etapa: 'seguimiento' })), '');
});

test('Q56: la tarjeta del tablero en Producto entregado con cobranza pendiente muestra el badge', () => {
  const tablero = buildTableroPipelineHtml([cotizacion({ id: 'c10', refId: 10, etapa: 'producto_entregado', cobranza: 'pendiente' })]);
  assert.match(tablero, /Pago sin registrar/);
});
