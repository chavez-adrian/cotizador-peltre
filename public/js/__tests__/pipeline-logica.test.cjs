'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let COLUMNAS_PIPELINE, COLUMNA_LABELS, agruparPipeline, buildTableroPipelineHtml, esSalida, oportunidadesActivas, etiquetaFolioOperam, badgeFolioOperamHtml, badgeFolioOperamProspectoHtml, puedeCompletarPreCotizacion, botonCompletarHtml, interpretarSubidaOperam, buildOperamStatusHtml, buildCandidatosOperamHtml, buildColaHoyHtml, buildColaCotizacionItemHtml, ACCIONES_NUEVO, buildMenuNuevoHtml, esAsignable, buildAsignarControlHtml, buildMoverSeguimientoControlHtml, buildSalidaControlHtml, buildCerradasHtml, buildDecoradoControlHtml, cadenaOperamTexto, cadenaOperamHtml, badgePagoSinRegistrarHtml, interpretarActualizacionOperam, buildActualizacionStatusHtml, badgeQuoteDesactualizadoHtml, puedeAsignar, normalizarPuedeAsignar, buildColaNoAsignadoItemHtml;
before(async () => {
  ({ COLUMNAS_PIPELINE, COLUMNA_LABELS, agruparPipeline, buildTableroPipelineHtml, esSalida, oportunidadesActivas, etiquetaFolioOperam, badgeFolioOperamHtml, badgeFolioOperamProspectoHtml, puedeCompletarPreCotizacion, botonCompletarHtml, interpretarSubidaOperam, buildOperamStatusHtml, buildCandidatosOperamHtml, buildColaHoyHtml, buildColaCotizacionItemHtml, ACCIONES_NUEVO, buildMenuNuevoHtml, esAsignable, buildAsignarControlHtml, buildMoverSeguimientoControlHtml, buildSalidaControlHtml, buildCerradasHtml, buildDecoradoControlHtml, cadenaOperamTexto, cadenaOperamHtml, badgePagoSinRegistrarHtml, interpretarActualizacionOperam, buildActualizacionStatusHtml, badgeQuoteDesactualizadoHtml, puedeAsignar, normalizarPuedeAsignar, buildColaNoAsignadoItemHtml } =
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

// #285: la PRE por cliente sin lista de precios se explica en el propio chip. El
// PRE generico no dice nada y el vendedor no tenia como saber que el arreglo
// esta en el CLIENTE (asignarle una lista en Operam), no en la cotizacion: eso
// es lo que convertia el reintento en un callejon sin salida.
test('Q16b: el chip de la PRE por cliente sin lista dice el motivo en vez de "PRE"', () => {
  const html = badgeFolioOperamHtml({ folioOperam: null, motivoPre: 'sin-lista' });
  assert.match(html, /badge-pre/);
  assert.match(html, /cliente sin lista de precios en Operam/);
  assert.equal(html.includes('>PRE<'), false);
  // La entrada completa (data.motivoPre) llega igual que la fila aplanada del
  // Historial: el mismo campo a dos alturas, como folioOperam.
  assert.match(badgeFolioOperamHtml({ folioOperam: null, data: { motivoPre: 'sin-lista' } }), /cliente sin lista/);
  // Los otros motivos siguen con el chip generico.
  assert.match(badgeFolioOperamHtml({ folioOperam: null, motivoPre: 'operam' }), />PRE</);
  assert.match(badgeFolioOperamHtml({ folioOperam: null, motivoPre: 'dedup' }), />PRE</);
  // Con folio ya no hay PRE que explicar.
  assert.match(badgeFolioOperamHtml({ folioOperam: '900', motivoPre: 'sin-lista' }), /#Operam 900/);
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

test('Q18: botonCompletarHtml pinta "Reintentar subida" solo sobre una tarjeta PRE, con su disparador', () => {
  const pre = botonCompletarHtml({ id: 42, folioOperam: null });
  assert.match(pre, /Reintentar subida/);
  // Pasa `this` para que app.js resuelva el slot de SU tarjeta (F2: la misma
  // cotizacion puede estar pintada en dos paneles a la vez).
  assert.match(pre, /completarPreCotizacion\(42, this\)/);
  // Una cotizacion ya registrada (#Operam N) no ofrece reintento.
  assert.equal(botonCompletarHtml({ id: 7, folioOperam: '900' }), '');
  // Una historica de registro desconocido tampoco.
  assert.equal(botonCompletarHtml({ id: 9, folioOperam: null, registroDesconocido: true }), '');
});

// Auto-subida (#83, ADR-0006): interpretarSubidaOperam clasifica la respuesta del
// endpoint de #81 por status + campos estructurados, nunca por el string de error
// (misma disciplina que accionProspecto409). 200 -> folio; 409 con candidatos ->
// candidatos; 422 -> sin_datos (PRE sin reintento util); 503/red/409-conflicto ->
// pre (reintento idempotente).
test('Q19: interpretarSubidaOperam clasifica la respuesta del endpoint por status y campos', () => {
  assert.deepEqual(interpretarSubidaOperam({ ok: true, folio: 77001 }), { estado: 'folio', folio: 77001, yaSubida: false, customerId: null, clienteGenerico: false, vigencia: null });
  assert.deepEqual(interpretarSubidaOperam({ ok: true }), { estado: 'folio', folio: null, yaSubida: false, customerId: null, clienteGenerico: false, vigencia: null });
  // yaSubida (#83 F1c): ya habia folio, el endpoint no re-subio (los quotes de
  // Operam no se editan por API; una regeneracion local no viaja a Operam).
  assert.deepEqual(interpretarSubidaOperam({ ok: true, folio: '55123', yaSubida: true }), { estado: 'folio', folio: '55123', yaSubida: true, customerId: null, clienteGenerico: false, vigencia: null });

  // #93: la subida con alta generica (#81) devuelve el customer_id creado/reutilizado
  // y si el cliente quedo con RFC generico, para ofrecer la CSF junto al folio.
  assert.deepEqual(
    interpretarSubidaOperam({ ok: true, folio: 90001, customerId: 501, clienteGenerico: true }),
    { estado: 'folio', folio: 90001, yaSubida: false, customerId: 501, clienteGenerico: true, vigencia: null }
  );

  const cand = interpretarSubidaOperam({ ok: false, status: 409, error: 'Elige uno', candidatos: [{ id: 10, CustName: 'ABARROTES SA', cust_ref: 'ABA' }] });
  assert.equal(cand.estado, 'candidatos');
  assert.equal(cand.candidatos.length, 1);

  // 422: cotizacion legacy sin datos minimos -> PRE, sin reintento.
  assert.equal(interpretarSubidaOperam({ ok: false, status: 422, error: 'No se pudo identificar el cliente' }).estado, 'sin_datos');

  // 503 (Operam caido) y red (status 0) -> pre con reintento.
  assert.equal(interpretarSubidaOperam({ ok: false, status: 503, error: 'No se pudo subir a Operam: Operam 500' }).estado, 'pre');
  assert.equal(interpretarSubidaOperam({ ok: false, status: 0, error: 'Failed to fetch' }).estado, 'pre');

  // 409 de conflicto (sin lista de candidatos) -> pre, no candidatos.
  assert.equal(interpretarSubidaOperam({ ok: false, status: 409, error: 'La cotizacion ya esta ligada a otro cliente' }).estado, 'pre');
});

// Los botones del bloque de estado pasan `this` (el elemento clickeado), no un
// id de contenedor: la MISMA cotizacion puede pintarse en dos paneles a la vez
// (Historial y cotizaciones previas del cliente) y un id duplicado haria que
// getElementById pintara siempre en el primero -- posiblemente oculto (F2 de la
// revision de #83). app.js resuelve el slot relativo al disparador.
test('Q19b: buildOperamStatusHtml pinta folio, PRE+Reintentar, sin_datos y candidatos', () => {
  const ok = buildOperamStatusHtml(5, { estado: 'folio', folio: 77001 });
  assert.match(ok, /#Operam 77001/);
  assert.doesNotMatch(ok, /Reintentar/);
  assert.doesNotMatch(ok, /coincide/, 'sin nota cuando la subida fue nueva');

  // Ya subida (#83 F1c) -- desde #114 este caso significa UNA sola cosa: el contenido
  // no cambio respecto de lo que se subio, asi que no habia nada que reescribir. La
  // nota vieja ("los cambios locales no actualizan la cotizacion ya subida") describia
  // el bug, no el comportamiento: ahora un cambio SI viaja por el camino de
  // actualizacion.
  const ya = buildOperamStatusHtml(5, { estado: 'folio', folio: '55123', yaSubida: true });
  assert.match(ya, /#Operam 55123/);
  assert.doesNotMatch(ya, /cambios locales no actualizan/);
  assert.match(ya, /coincide/i);
  assert.doesNotMatch(ya, /Reintentar/);

  const pre = buildOperamStatusHtml(5, { estado: 'pre', mensaje: 'Operam caido' });
  assert.match(pre, /badge-pre/);
  assert.match(pre, /PRE/);
  assert.match(pre, /reintentarSubidaOperam\(5, this\)/);

  // sin_datos: PRE claro, SIN boton de reintento (seria inutil).
  const sd = buildOperamStatusHtml(5, { estado: 'sin_datos', mensaje: 'Faltan datos' });
  assert.match(sd, /PRE/);
  assert.doesNotMatch(sd, /Reintentar/);

  const cands = buildOperamStatusHtml(5, { estado: 'candidatos', mensaje: 'Elige', candidatos: [{ id: 10, CustName: 'ABARROTES SA', cust_ref: 'ABA' }] });
  assert.match(cands, /ABARROTES SA/);
  assert.match(cands, /ABA/);
  assert.match(cands, /elegirCandidatoOperam\(5, 10, this\)/);
  // #204 (ajuste): ante candidatos ya NO hay salida comoda. "Dejar como PRE"
  // desaparecio de esta lista -- el vendedor resuelve o el registro muere a las
  // 24h. dejarPreOperam sigue existiendo para el PRE por fallo de Operam.
  assert.doesNotMatch(cands, /dejarPreOperam/);
});

// #204: la lista de candidatos necesita salida. Sin ella un falso positivo de la
// dedup por nombre deja al vendedor eligiendo un cliente que NO es el suyo o
// entregando el documento como PRE. Mismo patron que el "Ninguno es el mismo
// cliente" del alta completa, con el flag que solo salta esa parada.
test('Q19c: la lista de candidatos ofrece crear cliente nuevo cuando ninguno es el mismo', () => {
  const cands = buildCandidatosOperamHtml(5, [{ id: 10, CustName: 'ABARROTES SA', cust_ref: 'ABA' }], 'Elige');
  assert.match(cands, /Ninguno es el mismo cliente/);
  assert.match(cands, /crearNuevoClienteOperam\(5, this\)/);
});

// #93: junto al folio, si la subida creo/reutilizo un cliente con RFC generico
// (alta generica, #81), se ofrece la accion de subir su CSF (reusa el upgrade de
// #85 via pcAbrirUpgradeFiscal). Sin RFC generico (cliente ya real en Operam) no
// hay nada que ofrecer -- mismo criterio que el chip Fiscal de la tarjeta.
test('Q19d: buildOperamStatusHtml ofrece subir la CSF junto al folio cuando el cliente quedo generico', () => {
  const gen = buildOperamStatusHtml(5, { estado: 'folio', folio: 90001, customerId: 501, clienteGenerico: true });
  assert.match(gen, /#Operam 90001/);
  assert.match(gen, /Ya tienes su CSF/);
  // origen 'resumen' explicito: pcAbrirUpgradeFiscal lo usa para saber que debe
  // cambiar al tab cliente antes de mostrar el panel (el panel vive oculto
  // dentro de #tab-cliente cuando se invoca desde el tab resumen).
  assert.match(gen, /pcAbrirUpgradeFiscal\(501, null, 'resumen'\)/);

  const noGen = buildOperamStatusHtml(5, { estado: 'folio', folio: 90001, customerId: 501, clienteGenerico: false });
  assert.doesNotMatch(noGen, /Ya tienes su CSF/);

  const sinCustomer = buildOperamStatusHtml(5, { estado: 'folio', folio: 90001, clienteGenerico: true });
  assert.doesNotMatch(sinCustomer, /Ya tienes su CSF/);
});

// #242: el cust_ref es unico GLOBAL en Operam, asi que el dueno del nombre corto
// entra al picker aunque tenga RFC real -- un cliente que ninguna otra senal
// habria propuesto. El hecho tiene que ser visible CON su RFC: el vendedor
// necesita saber que ese cliente puede vivir bajo otro RFC antes de elegirlo.
test('Q242a: el candidato que choca de nombre corto lo dice, con su RFC', () => {
  const html = buildCandidatosOperamHtml(5, [
    { id: 499, CustName: 'CUMBIARCA SA', cust_ref: 'Studio Iken', tax_id: 'CPE921211N76', custRefIgual: true },
  ], 'Elige');
  assert.match(html, /nombre corto/i);
  assert.match(html, /CPE921211N76/);
  assert.match(html, /elegirCandidatoOperam\(5, 499, this\)/);
});

test('Q242b: un candidato que NO choca de nombre corto no muestra ese hecho', () => {
  const html = buildCandidatosOperamHtml(5, [
    { id: 10, CustName: 'HOTEL AZUL SA', cust_ref: 'Hotel Azul Sur', tax_id: 'XAXX010101000' },
  ], 'Elige');
  assert.doesNotMatch(html, /nombre corto/i);
});

// #242 salida: el 409 con codigo CUST_REF_DUPLICADO NO es un fallo transitorio de
// Operam. Reintentar sin cambiar el nombre corto da exactamente el mismo error,
// asi que el bloque pinta el texto accionable del servidor y NO ofrece Reintentar
// (mismo criterio que 'sin_datos').
test('Q242c: el choque de nombre corto se lee como estado propio, con el texto del servidor', () => {
  const vista = interpretarSubidaOperam({
    ok: false, status: 409, codigo: 'CUST_REF_DUPLICADO', nombreCorto: 'Studio Iken',
    error: 'El nombre corto "Studio Iken" ya lo usa otro cliente en Operam, que lo exige unico. Cambia el nombre corto del cliente y vuelve a generar la cotizacion.',
  });
  assert.equal(vista.estado, 'cust_ref');
  assert.equal(vista.nombreCorto, 'Studio Iken');
  const html = buildOperamStatusHtml(5, vista);
  assert.match(html, /Studio Iken/);
  assert.match(html, /Cambia el nombre corto/);
  assert.doesNotMatch(html, /Reintentar/, 'reintentar sin cambiar el nombre corto da el mismo error');
});

test('Q19c: buildCandidatosOperamHtml escapa nombres y ofrece elegir o crear nuevo', () => {
  const html = buildCandidatosOperamHtml(9, [{ id: 3, CustName: 'A & B <SA>', cust_ref: 'AB' }], 'Elige el cliente');
  assert.match(html, /A &amp; B &lt;SA&gt;/);
  assert.match(html, /elegirCandidatoOperam\(9, 3, this\)/);
  // #204 (ajuste): "Dejar como PRE" se quito -- dejaba un documento entregable
  // con el duplicado sin resolver. Se resuelve o el registro muere a las 24h.
  assert.doesNotMatch(html, /Dejar como PRE/);
});

// #196: el separador ad hoc " . cust_ref" migra al formato unificado de
// parentesis (nombreConCorto), igual que el resto de la app.
test('N196a: buildCandidatosOperamHtml muestra el nombre corto del candidato entre parentesis', () => {
  const html = buildCandidatosOperamHtml(5, [{ id: 70, CustName: 'Decoracion Maria Pia', cust_ref: 'Casa Maria Pia' }], 'Elige');
  assert.match(html, /Decoracion Maria Pia \(Casa Maria Pia\)/);
  assert.doesNotMatch(html, / . Casa Maria Pia/, 'no debe quedar el separador viejo con punto medio');
});

test('N196b: buildCandidatosOperamHtml sin cust_ref no agrega parentesis vacio', () => {
  const html = buildCandidatosOperamHtml(5, [{ id: 71, CustName: 'Sin Corto SA' }], 'Elige');
  assert.doesNotMatch(html, /Sin Corto SA \(/);
  assert.match(html, /Sin Corto SA<\/span>/);
});

// #210: el picker de candidatos muestra hechos (no clasifica). buildCandidatosOperamHtml
// es la MISMA funcion que pinta panel de resultado e Historial (ambos resuelven al
// slot via slotOperamDesde en app.js) -- probarla una vez cubre las dos superficies.
// Palabras de diferencia en ambas direcciones, crudas, sin gazetteer -- familia
// real "Ojo de Agua" con sus tres variantes ({grupo}, {puebla}, {grupo,puebla}).
test('#210: buildCandidatosOperamHtml pinta la diferencia de nombre cruda en ambas direcciones', () => {
  const html = buildCandidatosOperamHtml(5, [
    { id: 70, CustName: 'OJO DE AGUA GRUPO', cust_ref: 'OJOAGUA-GPO', diferenciaNombre: { soloInput: ['sur'], soloCandidato: ['grupo'] }, celularMatch: 'sin_dato', correoMatch: 'sin_dato' },
    { id: 71, CustName: 'OJO DE AGUA PUEBLA', cust_ref: 'OJOAGUA-PUE', diferenciaNombre: { soloInput: ['sur'], soloCandidato: ['puebla'] }, celularMatch: 'sin_dato', correoMatch: 'sin_dato' },
    { id: 72, CustName: 'OJO DE AGUA GRUPO PUEBLA', cust_ref: 'OJOAGUA-GP', diferenciaNombre: { soloInput: ['sur'], soloCandidato: ['grupo', 'puebla'] }, celularMatch: 'sin_dato', correoMatch: 'sin_dato' },
  ], 'Elige');
  assert.match(html, /grupo \(en Operam\)/);
  assert.match(html, /puebla \(en Operam\)/);
  assert.match(html, /grupo, puebla \(en Operam\)/);
  // AMBAS direcciones: lo que trae la captura del vendedor y el candidato no tiene.
  assert.match(html, /sur \(en tu captura\)/);
});

// #210: nombres identicos tras normalizar -- nada de diferencia que mostrar, no
// se inventa un texto donde no hay diferencia.
test('#210: buildCandidatosOperamHtml no pinta diferencia de nombre cuando las dos listas vienen vacias', () => {
  const html = buildCandidatosOperamHtml(5, [
    { id: 10, CustName: 'ABARROTES SA', cust_ref: 'ABA', diferenciaNombre: { soloInput: [], soloCandidato: [] }, celularMatch: 'sin_dato', correoMatch: 'sin_dato' },
  ], 'Elige');
  assert.doesNotMatch(html, /operam-candidato-diff/);
});

// #210: TRES estados de letrero, nunca dos -- "sin dato" NUNCA se confunde
// visualmente con "no coincide" (41% de las fichas historicas no tienen telefono).
test('#210: buildCandidatosOperamHtml pinta los TRES estados de celular y correo', () => {
  const html = buildCandidatosOperamHtml(5, [
    { id: 80, CustName: 'OJO DE AGUA SUR', cust_ref: 'A', diferenciaNombre: { soloInput: [], soloCandidato: [] }, celularMatch: 'coincide', correoMatch: 'no_coincide' },
    { id: 81, CustName: 'OJO DE AGUA SUR', cust_ref: 'B', diferenciaNombre: { soloInput: [], soloCandidato: [] }, celularMatch: 'sin_dato', correoMatch: 'sin_dato' },
  ], 'Elige');
  assert.match(html, /Celular: coincide/);
  assert.match(html, /Correo: no coincide/);
  assert.match(html, /Celular: sin dato/);
  assert.match(html, /Correo: sin dato/);
});

// #210: los letreros son evidencia, JAMAS candado -- ninguna combinacion de
// hechos (nombre distinto, celular sin coincidir) apaga Elegir o Crear nuevo.
test('#210: ninguna combinacion de hechos deshabilita Elegir o Crear nuevo', () => {
  const html = buildCandidatosOperamHtml(5, [
    { id: 81, CustName: 'OJO DE AGUA PUEBLA', cust_ref: 'B', diferenciaNombre: { soloInput: ['sur'], soloCandidato: ['puebla'] }, celularMatch: 'no_coincide', correoMatch: 'no_coincide' },
  ], 'Elige');
  assert.doesNotMatch(html, /disabled/);
  assert.match(html, /elegirCandidatoOperam\(5, 81, this\)/);
  assert.match(html, /crearNuevoClienteOperam\(5, this\)/);
});

// #210: buildCandidatosOperamHtml sigue escapando datos de usuario tambien en
// las palabras de diferencia y en los letreros (mismo criterio que el nombre).
test('#210: buildCandidatosOperamHtml escapa la diferencia de nombre', () => {
  const html = buildCandidatosOperamHtml(5, [
    { id: 9, CustName: 'A & B', cust_ref: 'AB', diferenciaNombre: { soloInput: [], soloCandidato: ['<script>'] }, celularMatch: 'sin_dato', correoMatch: 'sin_dato' },
  ], 'Elige');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

// #211: cada candidato gana una tercera accion, "Es sucursal de este cliente",
// para la empresa multi-plaza (misma razon social, un gerente de compras por
// sucursal). El orden es Elegir / Es sucursal / Crear nuevo -- de la mas
// conservadora (no escribe nada) a la que mas cuentas crea. El handler recibe el
// elemento clickeado (`this`), nunca un id de contenedor: la misma cotizacion
// puede estar pintada en dos paneles a la vez.
test('#211: cada candidato ofrece "Es sucursal de este cliente" entre Elegir y Crear nuevo', () => {
  const html = buildCandidatosOperamHtml(5, [
    { id: 70, CustName: 'OJO DE AGUA PUEBLA', cust_ref: 'OJOAGUA-PUE', diferenciaNombre: { soloInput: ['sur'], soloCandidato: ['puebla'] }, celularMatch: 'no_coincide', correoMatch: 'sin_dato' },
  ], 'Elige');
  assert.match(html, /marcarSucursalOperam\(5, 70, this\)/);
  assert.match(html, /Es sucursal de este cliente/);
  const posElegir = html.indexOf('elegirCandidatoOperam(5, 70, this)');
  const posSucursal = html.indexOf('marcarSucursalOperam(5, 70, this)');
  const posNuevo = html.indexOf('crearNuevoClienteOperam(5, this)');
  assert.ok(posElegir < posSucursal, 'Elegir va antes que Es sucursal');
  assert.ok(posSucursal < posNuevo, 'Es sucursal va antes que Crear nuevo');
  assert.doesNotMatch(html, /disabled/, 'los hechos son evidencia, nunca candado');
});

// #211: la accion de sucursal viaja POR CANDIDATO -- cada uno con su propio id,
// porque la sucursal nace bajo el cliente que el vendedor senalo.
test('#211: la accion de sucursal lleva el id de SU candidato', () => {
  const html = buildCandidatosOperamHtml(7, [
    { id: 11, CustName: 'A', cust_ref: 'A', diferenciaNombre: { soloInput: [], soloCandidato: [] }, celularMatch: 'sin_dato', correoMatch: 'sin_dato' },
    { id: 12, CustName: 'B', cust_ref: 'B', diferenciaNombre: { soloInput: [], soloCandidato: [] }, celularMatch: 'sin_dato', correoMatch: 'sin_dato' },
  ], 'Elige');
  assert.match(html, /marcarSucursalOperam\(7, 11, this\)/);
  assert.match(html, /marcarSucursalOperam\(7, 12, this\)/);
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

// === Issue #156: el item No Asignado en la cola Hoy ===
// Solo llega a quien tiene el permiso (lo filtra GET /api/hoy); su unica accion
// pendiente es asignarle dueno, con el MISMO control de la tarjeta del tablero.
const VENDEDORES_HOY = [{ id: 2, name: 'Alejandro Chavez' }, { id: 3, name: 'Oswaldo Chavez' }];

function itemNoAsignado(extra) {
  return {
    tipo: 'no_asignado', sinDueno: true, id: 42, nombre: 'Mayoreo Web',
    celular: '+52 5512345678', ciudad: 'Toluca', canal: 'Formulario web',
    etapa: 'no_asignado', vendedor: null, horas: 5, color: 'ambar', urgencia: 0.6, ...extra,
  };
}

test('Q24b: el item No Asignado de la cola Hoy trae el control de asignar', () => {
  const html = buildColaHoyHtml([itemNoAsignado({ id: 42 })], { vendedores: VENDEDORES_HOY, puedeAsignar: true });
  assert.match(html, /Mayoreo Web/);
  assert.match(html, /Sin vendedor/i);
  assert.match(html, /asignar-vendedor-hoy-42/);
  assert.match(html, /asignarVendedorTablero\(42, this\)/);
});

test('Q24c: sin catalogo de vendedores el item No Asignado se pinta, pero sin control', () => {
  const html = buildColaHoyHtml([itemNoAsignado({ id: 42 })]);
  assert.match(html, /Mayoreo Web/);
  assert.equal(html.includes('asignarVendedorTablero'), false);
});

test('Q24d: el item No Asignado no ofrece registrar contacto (no hay vendedor que lo trabaje)', () => {
  const html = buildColaHoyHtml([itemNoAsignado({ id: 42 })], { vendedores: VENDEDORES_HOY, puedeAsignar: true });
  assert.equal(html.includes('registrarToqueProspecto'), false);
});

test('Q24e: buildColaHoyHtml preserva el orden del backend con los tres tipos', () => {
  const html = buildColaHoyHtml(
    [itemNoAsignado({ id: 42 }), itemCotizacion({ id: 10 }), itemProspecto({ id: 1 })],
    { vendedores: VENDEDORES_HOY, puedeAsignar: true }
  );
  assert.ok(html.indexOf('Mayoreo Web') < html.indexOf('Hotel Azul'));
  assert.ok(html.indexOf('Hotel Azul') < html.indexOf('Laura'));
});

test('Q24f: buildColaNoAsignadoItemHtml escapa el nombre capturado por el publico', () => {
  const html = buildColaNoAsignadoItemHtml(itemNoAsignado({ nombre: '<img src=x onerror=alert(1)>' }), VENDEDORES_HOY, true);
  assert.equal(html.includes('<img src=x'), false);
  assert.match(html, /&lt;img/);
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
// prospecto"): visible en todos los destinos del bottom-nav. "Nueva cotizacion"
// (la vista de cotizar existente), "Nuevo prospecto" (la captura minima existente)
// y "Nuevo cliente" (#94: abre la vista Clientes con el alta completa). Logica pura
// de presentacion del menu, sin DOM (mismo patron que el resto del modulo).
test('Q25: ACCIONES_NUEVO ofrece Nueva cotizacion, Nuevo prospecto y Nuevo cliente', () => {
  assert.deepEqual(ACCIONES_NUEVO.map(a => a.label), ['Nueva cotizacion', 'Nuevo prospecto', 'Nuevo cliente']);
  assert.deepEqual(ACCIONES_NUEVO.map(a => a.accion), ['nuevaCotizacion', 'nuevoProspecto', 'nuevoCliente']);
});

test('Q26: buildMenuNuevoHtml pinta un boton por accion con su disparador', () => {
  const html = buildMenuNuevoHtml();
  assert.match(html, /Nueva cotizacion/);
  assert.match(html, /Nuevo prospecto/);
  assert.match(html, /Nuevo cliente/);
  assert.match(html, /onclick="nuevaCotizacion\(\)"/);
  assert.match(html, /onclick="nuevoProspecto\(\)"/);
  assert.match(html, /onclick="nuevoCliente\(\)"/);
  // Un boton por accion, ninguno de mas.
  assert.equal((html.match(/<button/g) || []).length, ACCIONES_NUEVO.length);
});

// Captura de expo (issue #267): el "+" es la UNICA entrada de la pantalla de
// captura de expo, y solo con evento activo (CONTEXT.md "Captura de expo").
// Fuera de expo el menu tiene que ser exactamente el de siempre.
test('Q53: con evento activo el menu + ofrece Nuevo prospecto expo; sin evento es el de siempre', () => {
  const sinEvento = buildMenuNuevoHtml(false);
  assert.equal(sinEvento.includes('Nuevo prospecto expo'), false);
  assert.equal(sinEvento, buildMenuNuevoHtml());
  assert.equal((sinEvento.match(/<button/g) || []).length, ACCIONES_NUEVO.length);

  const conEvento = buildMenuNuevoHtml(true);
  assert.match(conEvento, /Nuevo prospecto expo/);
  assert.match(conEvento, /onclick="nuevoProspectoExpo\(\)"/);
  assert.equal((conEvento.match(/<button/g) || []).length, ACCIONES_NUEVO.length + 1);
  // Las tres acciones de siempre siguen ahi, sin cambiar de disparador.
  for (const accion of ACCIONES_NUEVO) {
    assert.match(conEvento, new RegExp(`onclick="${accion.accion}\\(\\)"`));
  }
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

// === Issue #156 (spec #155): el permiso de asignacion deja de ser "ser admin" ===
// El admin lo tiene siempre; un vendedor lo puede tener por checkbox en /admin
// (mismo patron que puedeFijarLista de #153). No existe rol gerente.
test('Q27b: puedeAsignar: el admin siempre puede, sin checkbox', () => {
  assert.equal(puedeAsignar({ role: 'admin' }), true);
  assert.equal(puedeAsignar({ role: 'admin', puedeAsignar: false }), true);
});

test('Q27c: puedeAsignar: el vendedor depende del flag normalizado', () => {
  assert.equal(puedeAsignar({ role: 'vendedor', puedeAsignar: true }), true);
  assert.equal(puedeAsignar({ role: 'vendedor', puedeAsignar: false }), false);
  assert.equal(puedeAsignar({ role: 'vendedor' }), false);
  assert.equal(puedeAsignar(null), false);
});

test('Q27d: normalizarPuedeAsignar: basura o ausencia degradan a sin permiso', () => {
  assert.equal(normalizarPuedeAsignar(true), true);
  assert.equal(normalizarPuedeAsignar('si'), false);
  assert.equal(normalizarPuedeAsignar(1), false);
  assert.equal(normalizarPuedeAsignar(undefined), false);
  assert.equal(normalizarPuedeAsignar(null), false);
});

test('Q28: buildAsignarControlHtml pinta el selector de vendedores y el boton solo para quien tiene el permiso en No Asignado', () => {
  const html = buildAsignarControlHtml(prospecto({ id: 5, etapa: 'no_asignado' }), VENDEDORES, true);
  assert.match(html, /<select/);
  assert.match(html, /Alejandro Chavez/);
  assert.match(html, /Oswaldo Chavez/);
  // el boton pasa `this`: app.js resuelve el select relativo al elemento clickeado
  assert.match(html, /asignarVendedorTablero\(5, this\)/);
  assert.match(html, /asignar-vendedor-tablero-5/);
});

// #156: la MISMA tarjeta puede estar pintada a la vez en la cola Hoy y en el
// tablero (las vistas solo se ocultan con display:none). Dos ids iguales en el
// documento harian que getElementById leyera el select de la vista equivocada:
// por eso el id lleva la superficie y el boton pasa `this`. Sin DOM aqui, lo que
// se puede fijar es que las dos pinturas NO comparten id.
test('Q28b: el control de la cola Hoy y el del tablero no comparten el id del selector', () => {
  const o = prospecto({ id: 5, etapa: 'no_asignado' });
  const tablero = buildAsignarControlHtml(o, VENDEDORES, true, 'tablero');
  const hoy = buildAsignarControlHtml(o, VENDEDORES, true, 'hoy');
  const idDe = html => html.match(/id="(asignar-vendedor-[^"]+)"/)[1];
  assert.notEqual(idDe(tablero), idDe(hoy));
  // ambos siguen disparando la MISMA accion sobre el MISMO prospecto
  assert.match(tablero, /asignarVendedorTablero\(5, this\)/);
  assert.match(hoy, /asignarVendedorTablero\(5, this\)/);
});

test('Q29: buildAsignarControlHtml no pinta control fuera de No Asignado ni sin permiso', () => {
  assert.equal(buildAsignarControlHtml(prospecto({ etapa: 'por_cotizar' }), VENDEDORES, true), '');
  assert.equal(buildAsignarControlHtml(prospecto({ etapa: 'no_asignado' }), VENDEDORES, false), '');
});

test('Q30: el tablero pinta el control de asignar en la tarjeta No Asignado para quien tiene el permiso', () => {
  const html = buildTableroPipelineHtml(
    [prospecto({ id: 7, etapa: 'no_asignado' }), prospecto({ id: 8, etapa: 'por_cotizar' })],
    { vendedores: VENDEDORES, puedeAsignar: true }
  );
  assert.match(html, /asignarVendedorTablero\(7, this\)/);
  // no aparece sobre la tarjeta que ya tiene dueno
  assert.equal(html.includes('asignarVendedorTablero(8'), false);
});

test('Q31: el tablero sin opciones (sin permiso o sin vendedores) no pinta el control de asignar (read-only)', () => {
  const html = buildTableroPipelineHtml([prospecto({ id: 7, etapa: 'no_asignado' })]);
  assert.equal(html.includes('asignarVendedorTablero'), false);
  const sinPermiso = buildTableroPipelineHtml([prospecto({ id: 7, etapa: 'no_asignado' })], { vendedores: VENDEDORES, puedeAsignar: false });
  assert.equal(sinPermiso.includes('asignarVendedorTablero'), false);
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
  assert.match(html, /asignarVendedorTablero\(7, this\)/);
  assert.match(html, /id="asignar-vendedor-tablero-7"/);
  assert.equal(html.includes('asignarVendedorTablero(p7'), false);
  assert.equal(html.includes('asignar-vendedor-tablero-p7'), false);
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

// --- Badge "Pago sin registrar" (issue #77): entregado pero pago no registrado ---

test('#77: badgePagoSinRegistrarHtml pinta el badge en una entregada con pago sin registrar', () => {
  const html = badgePagoSinRegistrarHtml({ etapa: 'producto_entregado', pagoSinRegistrar: true });
  assert.match(html, /Pago sin registrar/);
  assert.match(html, /badge-impago/);
});

test('#77: badgePagoSinRegistrarHtml vacio cuando ya se registro el pago (flag false)', () => {
  assert.equal(badgePagoSinRegistrarHtml({ etapa: 'producto_entregado', pagoSinRegistrar: false }), '');
  assert.equal(badgePagoSinRegistrarHtml({ etapa: 'producto_entregado' }), '');
});

test('#77: badgePagoSinRegistrarHtml vacio si la tarjeta no esta entregada (respeta el gate/etapa)', () => {
  // Un decorado topado por el gate en anticipo_pagado no muestra el badge de entrega
  // aunque el flag venga marcado: el badge es solo de la entregada.
  assert.equal(badgePagoSinRegistrarHtml({ etapa: 'anticipo_pagado', pagoSinRegistrar: true }), '');
  assert.equal(badgePagoSinRegistrarHtml({ etapa: 'seguimiento', pagoSinRegistrar: true }), '');
});

test('#77: la tarjeta del tablero pinta el badge de una cotizacion entregada-impaga', () => {
  const tablero = buildTableroPipelineHtml([cotizacion({ id: 'c10', refId: 10, etapa: 'producto_entregado', pagoSinRegistrar: true })]);
  assert.match(tablero, /Pago sin registrar/);
});

// Post-fix de la vigencia (#106, ADR-0007): la subida corrige el campo nativo
// "Valido hasta" de Operam por la web legacy y reporta el resultado en steps. Si NO
// pego, el vendedor debe enterarse: la cotizacion quedo bien (el PDF y comments
// llevan la vigencia correcta) pero Operam la muestra vencida, y sin este aviso el
// fallo solo vivia en los logs del servidor.
test('Q19c: interpretarSubidaOperam extrae el resultado del post-fix de vigencia', () => {
  const paso = (status) => ({ ok: true, folio: 1, steps: [{ name: 'POST quote', status: 'ok' }, { name: 'post-fix vigencia', status }] });
  assert.equal(interpretarSubidaOperam(paso('ok')).vigencia, 'ok');
  // warn = Operam respondio pero el campo no quedo con la fecha esperada.
  assert.equal(interpretarSubidaOperam(paso('warn')).vigencia, 'revisar');
  assert.equal(interpretarSubidaOperam(paso('error')).vigencia, 'revisar');
  // Sin el paso (respuesta previa a #106, o camino que no sube): no se opina.
  assert.equal(interpretarSubidaOperam({ ok: true, folio: 1, steps: [{ name: 'POST quote', status: 'ok' }] }).vigencia, null);
  assert.equal(interpretarSubidaOperam({ ok: true, folio: 1 }).vigencia, null);
});

test('Q19d: buildOperamStatusHtml avisa solo cuando la vigencia quedo sin corregir', () => {
  const ok = buildOperamStatusHtml(5, { estado: 'folio', folio: 77001, vigencia: 'ok' });
  assert.doesNotMatch(ok, /vigencia/i, 'el caso normal no agrega ruido');

  const revisar = buildOperamStatusHtml(5, { estado: 'folio', folio: 77001, vigencia: 'revisar' });
  assert.match(revisar, /#Operam 77001/, 'la subida sigue siendo un exito');
  assert.match(revisar, /vigencia/i);
  assert.match(revisar, /V(&aacute;|á)lido hasta/i, 'nombra el campo tal como se ve en Operam');

  // Sin dato (respuesta vieja): no se inventa un aviso.
  assert.doesNotMatch(buildOperamStatusHtml(5, { estado: 'folio', folio: 77001 }), /vigencia/i);
});

// Subida en la RUTA CRITICA de la generacion (#111, ADR-0009): al invertirse el
// orden (subir y luego generar), los dos casos que antes eran inofensivos porque
// la subida era secundaria pasan a decidir si el documento sale numerado o como
// PRE. Ninguno puede degradar en silencio: el ADR prohibe explicitamente "un
// documento sin numero silencioso".
test('Q19e: una subida ya en vuelo y un timeout son PRE explicitos con reintento, no un silencio', () => {
  const enVuelo = interpretarSubidaOperam({ enVuelo: true });
  assert.equal(enVuelo.estado, 'pre');
  assert.match(enVuelo.mensaje, /en curso/i, 'dice que la subida sigue corriendo, no que fallo');

  const timeout = interpretarSubidaOperam({ timeout: true });
  assert.equal(timeout.estado, 'pre');
  assert.match(timeout.mensaje, /no respondi/i, 'dice que Operam no respondio a tiempo');
  assert.notEqual(timeout.mensaje, enVuelo.mensaje, 'no se confunde esperar con fallar');

  // Los dos ofrecen el mismo Reintentar idempotente que cualquier otro PRE (#83).
  assert.match(buildOperamStatusHtml(7, enVuelo), /reintentarSubidaOperam\(7, this\)/);
  assert.match(buildOperamStatusHtml(7, timeout), /reintentarSubidaOperam\(7, this\)/);
});

// === Actualizacion del quote conservando el folio (#104, ADR-0008) ===
// La distincion que manda en el aviso al vendedor es `escrito`: si NO se alcanzo a
// confirmar, el quote de Operam quedo INTACTO (fallo reversible por abandono, la
// palanca de robustez del ADR); si SI se confirmo pero la verificacion encontro
// diferencias, alguien tiene que mirar el ERP. Confundirlos seria mentirle al
// vendedor sobre que esta viendo su cliente.

test('A104: interpretarActualizacionOperam distingue exito, no-escrito, escrito-con-diferencias y gate', () => {
  assert.deepEqual(
    interpretarActualizacionOperam({ ok: true, status: 200, folio: '1200' }),
    { estado: 'actualizada', folio: '1200' },
  );
  const intacto = interpretarActualizacionOperam({ ok: false, status: 200, escrito: false, error: 'no se agrego la partida' });
  assert.equal(intacto.estado, 'desactualizado');
  assert.match(intacto.mensaje, /no se agrego la partida/);

  const revisar = interpretarActualizacionOperam({ ok: false, status: 200, escrito: true, verificado: true, discrepancias: [{ campo: 'precio', sku: 'X', esperado: 1, encontrado: 2 }] });
  assert.equal(revisar.estado, 'revisar');
  assert.equal(revisar.discrepancias.length, 1);

  const bloqueada = interpretarActualizacionOperam({ status: 409, error: 'ya tiene un pedido asociado' });
  assert.equal(bloqueada.estado, 'bloqueada');
  assert.match(bloqueada.mensaje, /pedido/);
});

// #114: con la reescritura del quote en la ruta critica de la generacion, "ya hay una
// operacion en curso" deja de ser un detalle interno -- es la razon de que el quote se
// quede con lo viejo mientras el documento ya salio con el folio. Tiene que degradar a
// un estado con motivo y Reintentar (el lock del servidor responde 425), nunca a
// silencio: era un `return` mudo en app.js cuando solo lo disparaba el historial.
test('#114: una operacion de Operam ya en curso degrada a un aviso con reintento, no a silencio', () => {
  const enCurso = interpretarActualizacionOperam({ ok: false, status: 425, escrito: false, error: 'Ya hay una operacion de Operam en curso para esta cotizacion' });
  assert.equal(enCurso.estado, 'desactualizado');
  assert.match(enCurso.mensaje, /en curso/);
  assert.match(buildActualizacionStatusHtml(9, enCurso), /reintentarActualizacionOperam\(9, this\)/);
});

test('A104: una caida de red no se confunde con "quedo mal en Operam"', () => {
  const v = interpretarActualizacionOperam({ ok: false, status: 0, error: 'Failed to fetch' });
  assert.equal(v.estado, 'desactualizado');
});

test('A104: buildActualizacionStatusHtml pinta el folio conservado en el exito', () => {
  const html = buildActualizacionStatusHtml(5, { estado: 'actualizada', folio: '1200' });
  assert.match(html, /#Operam 1200/);
  assert.doesNotMatch(html, /Reintentar/);
});

test('A104: no-escrito dice que el quote quedo intacto y ofrece reintentar', () => {
  const html = buildActualizacionStatusHtml(5, { estado: 'desactualizado', mensaje: 'la sesion caduco' });
  assert.match(html, /sin cambios|intacta|intacto/i);
  assert.match(html, /reintentarActualizacionOperam\(5, this\)/);
});

test('A104: escrito-con-diferencias manda a revisar Operam y NO dice que quedo intacto', () => {
  const html = buildActualizacionStatusHtml(5, { estado: 'revisar', mensaje: 'diferencias', discrepancias: [{ campo: 'precio' }] });
  assert.match(html, /revisa/i);
  assert.doesNotMatch(html, /intacto/i);
  assert.match(html, /reintentarActualizacionOperam\(5, this\)/);
});

test('A104: el gate se explica sin ofrecer un reintento que volveria a fallar', () => {
  const html = buildActualizacionStatusHtml(5, { estado: 'bloqueada', mensaje: 'ya tiene un pedido asociado' });
  assert.match(html, /pedido/);
  assert.doesNotMatch(html, /Reintentar/);
});

// #114: el gate bloquea justo cuando la divergencia es peor -- el documento ya salio
// numerado con el folio y el quote no se puede reescribir porque tiene pedido. Explicar
// el motivo no basta: hay que ofrecer la salida (Copiar cotizacion, #149), que es
// exactamente lo que ya hace el historial. Se reusa cargarCotizacion(id, 'nueva'),
// sin simbolo nuevo en window (trampa de #112).
test('#114: el aviso de bloqueada ofrece Copiar cotizacion', () => {
  const html = buildActualizacionStatusHtml(7, { estado: 'bloqueada', mensaje: 'ya tiene un pedido asociado en Operam' });
  assert.match(html, /pedido/);
  assert.match(html, /cargarCotizacion\(7, 'nueva'\)/);
  assert.match(html, /Copiar cotizaci&oacute;n/);
  assert.doesNotMatch(html, /Reintentar/);
});

test('A104: buildActualizacionStatusHtml escapa el mensaje del servidor', () => {
  const html = buildActualizacionStatusHtml(5, { estado: 'desactualizado', mensaje: '<img src=x onerror=alert(1)>' });
  assert.ok(!html.includes('<img src=x'));
});

test('A104: badgeQuoteDesactualizadoHtml marca la tarjeta solo cuando hay marca viva', () => {
  assert.match(badgeQuoteDesactualizadoHtml({ quoteDesactualizado: { fecha: '2026-07-28T00:00:00Z', escrito: false } }), /Operam desactualizado/i);
  assert.equal(badgeQuoteDesactualizadoHtml({ quoteDesactualizado: null }), '');
  assert.equal(badgeQuoteDesactualizadoHtml({}), '');
  assert.equal(badgeQuoteDesactualizadoHtml(undefined), '');
});

// --- Filtro por evento (issue #261): despues de la expo hay que poder
// responder cuantos prospectos dejo Abastur y cuantos cotizaron. ---
let filtrarPorEvento, eventosDeOportunidades, buildFiltroEventoHtml;
before(async () => {
  ({ filtrarPorEvento, eventosDeOportunidades, buildFiltroEventoHtml } = await import('../pipeline-logica.js'));
});

test('#261: el pipeline filtra las oportunidades por evento', () => {
  const oportunidades = [
    prospecto({ id: 1, evento: 'Abastur 2026' }),
    prospecto({ id: 2, evento: null }),
    cotizacion({ id: 3, evento: 'Abastur 2026' }),
    prospecto({ id: 4, evento: 'Expo Cafe 2025' }),
  ];
  assert.deepEqual(filtrarPorEvento(oportunidades, 'Abastur 2026').map(o => o.id), [1, 3]);
  assert.deepEqual(filtrarPorEvento(oportunidades, '').map(o => o.id), [1, 2, 3, 4]);
  assert.deepEqual(filtrarPorEvento(oportunidades, null).map(o => o.id), [1, 2, 3, 4]);
});

test('#261: el selector ofrece los eventos presentes, sin repetir, y "Todos"', () => {
  const oportunidades = [
    prospecto({ id: 1, evento: 'Abastur 2026' }),
    prospecto({ id: 2, evento: 'Abastur 2026' }),
    prospecto({ id: 3 }),
    prospecto({ id: 4, evento: 'Expo Cafe 2025' }),
  ];
  assert.deepEqual(eventosDeOportunidades(oportunidades), ['Abastur 2026', 'Expo Cafe 2025']);
  assert.equal(eventosDeOportunidades([prospecto({ id: 1 })]).length, 0);
  const html = buildFiltroEventoHtml(oportunidades, 'Abastur 2026');
  assert.match(html, /Todos los eventos/);
  assert.match(html, /<option value="Abastur 2026" selected>/);
  // Sin eventos capturados el filtro no se pinta: fuera de expo la app se ve igual.
  assert.equal(buildFiltroEventoHtml([prospecto({ id: 1 })], ''), '');
});

// --- Buscador del Pipeline y de la cola Hoy (#289): el mismo control del
// Historial (texto + Desde/Hasta), aqui sobre oportunidades y sobre la cola. ---
let filtrarOportunidades, filtrarColaHoy;
before(async () => {
  ({ filtrarOportunidades, filtrarColaHoy } = await import('../pipeline-logica.js'));
});

test('#289: el pipeline filtra por nombre/cliente, ciudad, vendedor, Origen y folio de Operam', () => {
  const oportunidades = [
    prospecto({ id: 1, nombre: 'Mariana López', ciudad: 'Puebla', canal: 'Instagram', vendedor: 'Laura' }),
    cotizacion({ id: 2, nombre: 'Hotel Azul', folioOperam: 1216, vendedor: 'Memo' }),
  ];
  assert.deepEqual(filtrarOportunidades(oportunidades, { texto: 'mariana' }).map(o => o.id), [1]);
  assert.deepEqual(filtrarOportunidades(oportunidades, { texto: 'PUEBLA' }).map(o => o.id), [1]);
  assert.deepEqual(filtrarOportunidades(oportunidades, { texto: 'instagram' }).map(o => o.id), [1]);
  assert.deepEqual(filtrarOportunidades(oportunidades, { texto: 'laura' }).map(o => o.id), [1]);
  assert.deepEqual(filtrarOportunidades(oportunidades, { texto: 'hotel' }).map(o => o.id), [2]);
  assert.deepEqual(filtrarOportunidades(oportunidades, { texto: '1216' }).map(o => o.id), [2]);
  assert.deepEqual(filtrarOportunidades(oportunidades, {}).map(o => o.id), [1, 2]);
});

test('#289: el pipeline matchea el celular por digitos donde la oportunidad lo trae', () => {
  const oportunidades = [
    prospecto({ id: 1, celular: '+52 55 1234 5678' }),
    cotizacion({ id: 2, telefono: '5219981234567' }),
  ];
  assert.deepEqual(filtrarOportunidades(oportunidades, { texto: '5512' }).map(o => o.id), [1]);
  assert.deepEqual(filtrarOportunidades(oportunidades, { texto: '99812' }).map(o => o.id), [2]);
});

test('#289: el pipeline acota por la fecha de creacion de la oportunidad', () => {
  const oportunidades = [
    prospecto({ id: 1, nombre: 'Mariana', fecha: '2026-06-02T15:00:00' }),
    cotizacion({ id: 2, nombre: 'Hotel Azul', fecha: '2026-06-20T15:00:00' }),
  ];
  assert.deepEqual(filtrarOportunidades(oportunidades, { desde: '2026-06-10' }).map(o => o.id), [2]);
  assert.deepEqual(filtrarOportunidades(oportunidades, { hasta: '2026-06-10' }).map(o => o.id), [1]);
  // Texto y fechas con AND: "hotel" fuera del rango no sobrevive.
  assert.deepEqual(filtrarOportunidades(oportunidades, { texto: 'hotel', hasta: '2026-06-10' }), []);
});

test('#289: la cola Hoy se filtra sin alterar su orden por urgencia', () => {
  const cola = [
    { tipo: 'no_asignado', id: 1, nombre: 'Sin dueno', ciudad: 'Puebla', canal: 'Formulario web', celular: '5512345678', fecha: '2026-06-02T15:00:00' },
    { tipo: 'cotizacion', id: 2, cliente: 'Hotel Azul', vendedor: 'Memo', folioOperam: 1216, telefono: '5219981234567', fecha: '2026-06-20T15:00:00' },
    { tipo: 'prospecto', id: 3, nombre: 'Mariana', ciudad: 'Mérida', canal: 'Instagram', celular: '9987654321', fecha: '2026-06-05T15:00:00' },
  ];
  assert.deepEqual(filtrarColaHoy(cola, { texto: 'puebla' }).map(i => i.id), [1]);
  assert.deepEqual(filtrarColaHoy(cola, { texto: 'hotel' }).map(i => i.id), [2]);
  assert.deepEqual(filtrarColaHoy(cola, { texto: '1216' }).map(i => i.id), [2]);
  assert.deepEqual(filtrarColaHoy(cola, { texto: '99876' }).map(i => i.id), [3]);
  assert.deepEqual(filtrarColaHoy(cola, { texto: '99812' }).map(i => i.id), [2]);
  // El orden que llego del servidor es el de urgencia: filtrar no lo reordena.
  assert.deepEqual(filtrarColaHoy(cola, { desde: '2026-06-03' }).map(i => i.id), [2, 3]);
  assert.deepEqual(filtrarColaHoy(cola, {}).map(i => i.id), [1, 2, 3]);
});

// === Issue #287: chip Origen en el pipeline y en la cola Hoy ===
// La cotizacion no guarda origen: llega anotado (`origen`) por quien resolvio la
// herencia -- el navegador en el pipeline, el servidor en Hoy y el Historial.

function metasDe(html) {
  return [...html.matchAll(/<div class="cot-card-meta">(.*?)<\/div>/g)].map(m => m[1]);
}

test('OR5: la tarjeta del tablero pinta el Origen propio, el heredado y el que falta', () => {
  const html = buildTableroPipelineHtml([
    prospecto({ id: 1, canal: 'Instagram', etapa: 'por_cotizar' }),
    cotizacion({ id: 10, cliente: 'Hotel Azul', origen: 'Feria/Expo', etapa: 'seguimiento' }),
    cotizacion({ id: 11, cliente: 'Sin prospecto', etapa: 'seguimiento' }),
  ]);
  assert.match(html, /origen-badge">Origen: Instagram/);
  assert.match(html, /origen-badge">Origen: Feria\/Expo/);
  assert.match(html, /origen-badge-vacio">Origen sin identificar/);
  // el origen sale de la linea gris: no se muestra dos veces
  assert.equal(metasDe(html).some(m => m.includes('Instagram')), false);
});

test('OR6: la lista de cerradas pinta el chip Origen fuera de la linea gris', () => {
  const html = buildCerradasHtml([
    prospecto({ id: 2, nombre: 'Pedro', canal: 'Referido', etapa: 'no_util', motivoNoUtil: 'spam' }),
  ]);
  assert.match(html, /origen-badge">Origen: Referido/);
  assert.equal(metasDe(html).some(m => m.includes('Referido')), false);
});

test('OR7: el item de cotizacion de la cola Hoy pinta el Origen heredado', () => {
  const conOrigen = buildColaCotizacionItemHtml(itemCotizacion({ id: 10, origen: 'Meta Ads' }));
  assert.match(conOrigen, /origen-badge">Origen: Meta Ads/);
  const sinOrigen = buildColaCotizacionItemHtml(itemCotizacion({ id: 11 }));
  assert.match(sinOrigen, /origen-badge-vacio">Origen sin identificar/);
});

// La limitacion que dejo #289: "Instagram" encontraba al prospecto pero no a sus
// cotizaciones, porque la cotizacion no traia origen. Con la herencia anotada, si.
test('OR9: el buscador del pipeline y de Hoy encuentran la cotizacion por su Origen heredado', () => {
  const oportunidades = [
    cotizacion({ id: 2, cliente: 'Hotel Azul', origen: 'Instagram' }),
    cotizacion({ id: 3, cliente: 'Cafe Sol', origen: 'Referido' }),
  ];
  assert.deepEqual(filtrarOportunidades(oportunidades, { texto: 'instagram' }).map(o => o.id), [2]);
  const cola = [
    { tipo: 'cotizacion', id: 2, cliente: 'Hotel Azul', origen: 'Instagram', fecha: '2026-06-20T15:00:00' },
    { tipo: 'cotizacion', id: 3, cliente: 'Cafe Sol', origen: 'Referido', fecha: '2026-06-20T15:00:00' },
  ];
  assert.deepEqual(filtrarColaHoy(cola, { texto: 'instagram' }).map(i => i.id), [2]);
});

test('OR8: el item No Asignado pinta el chip Origen fuera de la linea gris', () => {
  const html = buildColaNoAsignadoItemHtml(itemNoAsignado({ id: 42 }), VENDEDORES_HOY, true);
  assert.match(html, /origen-badge">Origen: Formulario web/);
  assert.equal(metasDe(html).some(m => m.includes('Formulario web')), false);
});
