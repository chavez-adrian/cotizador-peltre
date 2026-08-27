'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let CANALES, PIEZAS_ESTIMADAS, OPCIONALES, validarProspectoBody, buildProspectoPayload,
  buildProspectoCardHtml, buildProspectoExistenteHtml, MOTIVOS_NO_UTIL, siguienteEtapa,
  validarTransicion, buildWaLink, buildHistorialHtml, contarMotivosNoUtil, buildMotivosNoUtilHtml,
  buildEsperaBadgeHtml, buildColaProspectosHtml, necesitaCanal, validarCanalCotizacion,
  buildCanalModalHtml, reunionFutura, reunionPendienteResultado, buildMotivoNoUtilModalHtml,
  validarEdicionProspecto, buildEdicionProspectoDatos, buildEdicionProspectoFormHtml,
  contarPendientesProspectos,
  ultimaReunionDe, reunionFuturaDe, reunionPendienteResultadoDe,
  CANALES_SIGUIENTE_CONTACTO, siguienteContactoFuturo, siguienteContactoVencido,
  validarSiguienteContacto, buildEventoSiguienteContacto, normalizarTextosProspecto;
before(async () => {
  ({ CANALES, PIEZAS_ESTIMADAS, OPCIONALES, validarProspectoBody, buildProspectoPayload,
    buildProspectoCardHtml, buildProspectoExistenteHtml, MOTIVOS_NO_UTIL, siguienteEtapa,
    validarTransicion, buildWaLink, buildHistorialHtml, contarMotivosNoUtil,
    buildMotivosNoUtilHtml, buildEsperaBadgeHtml, buildColaProspectosHtml,
    necesitaCanal, validarCanalCotizacion, buildCanalModalHtml,
    reunionFutura, reunionPendienteResultado, buildMotivoNoUtilModalHtml,
    validarEdicionProspecto, buildEdicionProspectoDatos, buildEdicionProspectoFormHtml,
    contarPendientesProspectos,
    ultimaReunionDe, reunionFuturaDe, reunionPendienteResultadoDe,
    CANALES_SIGUIENTE_CONTACTO, siguienteContactoFuturo, siguienteContactoVencido,
    validarSiguienteContacto, buildEventoSiguienteContacto, normalizarTextosProspecto } = await import('../prospectos-logica.js'));
});

test('P1: buildProspectoPayload combina codigo de pais y limpia obligatorios', () => {
  const payload = buildProspectoPayload({
    celularCode: '+52', celular: '55 1234 5678',
    nombre: '  Laura ', ciudad: ' Puebla ', canal: 'WhatsApp',
  });
  assert.equal(payload.celular, '+52 55 1234 5678');
  assert.equal(payload.nombre, 'Laura');
  assert.equal(payload.ciudad, 'Puebla');
  assert.equal(payload.canal, 'WhatsApp');
});

test('P2: buildProspectoPayload incluye opcionales solo si tienen valor', () => {
  const payload = buildProspectoPayload({
    celularCode: '+52', celular: '5512345678', nombre: 'Laura', ciudad: 'Puebla', canal: 'Referido',
    empresa: ' Hotel Azul ', temperatura: 4, correo: '', notas: '   ',
  });
  assert.equal(payload.empresa, 'Hotel Azul');
  assert.equal(payload.temperatura, 4);
  assert.equal('correo' in payload, false);
  assert.equal('notas' in payload, false);
  assert.equal('piezas_estimadas' in payload, false);
});

test('P2b: "Cliente Actual" es un canal valido del catalogo (issue #73)', () => {
  // Un cliente que ya nos compro abre una operacion nueva (a veces bajo otra razon
  // social): el canal "Cliente Actual" debe estar disponible al capturar el prospecto.
  assert.ok(CANALES.includes('Cliente Actual'));
  assert.equal(validarProspectoBody({
    celular: '+52 5512345678', nombre: 'Laura', ciudad: 'Puebla', canal: 'Cliente Actual',
  }), null);
});

test('P3: validarProspectoBody acepta captura completa con celular con codigo de pais', () => {
  assert.equal(validarProspectoBody({
    celular: '+52 5512345678', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp',
  }), null);
});

// Mismo nucleo compartido que el alta: un prospecto con nacional de 7 digitos
// (Aruba, fijos de Panama) quedaba fuera por el piso de 11 (issue #175).
test('P3b: validarProspectoBody acepta un celular internacional de 10 digitos totales', () => {
  assert.equal(validarProspectoBody({
    celular: '+297 563 3917', nombre: 'Francys', ciudad: 'Panama', canal: 'WhatsApp',
  }), null);
});

test('P4: validarProspectoBody rechaza celular sin codigo de pais o vacio', () => {
  assert.match(validarProspectoBody({ celular: '5512345678', nombre: 'L', ciudad: 'P', canal: 'WhatsApp' }), /codigo de pais/i);
  assert.match(validarProspectoBody({ celular: '', nombre: 'L', ciudad: 'P', canal: 'WhatsApp' }), /obligatorio/i);
});

test('P5: validarProspectoBody exige nombre y ciudad', () => {
  assert.match(validarProspectoBody({ celular: '+52 5512345678', nombre: '  ', ciudad: 'P', canal: 'WhatsApp' }), /nombre/i);
  assert.match(validarProspectoBody({ celular: '+52 5512345678', nombre: 'L', ciudad: '', canal: 'WhatsApp' }), /ciudad/i);
});

test('P6: validarProspectoBody rechaza canal fuera del catalogo cerrado', () => {
  assert.match(validarProspectoBody({ celular: '+52 5512345678', nombre: 'L', ciudad: 'P', canal: 'TikTok' }), /canal/i);
  assert.match(validarProspectoBody({ celular: '+52 5512345678', nombre: 'L', ciudad: 'P' }), /canal/i);
});

const PROSPECTO = {
  id: 3, fecha: '2026-06-10T12:00:00.000Z', vendedor: 'Memo',
  celular: '+52 5512345678', nombre: 'Laura', ciudad: 'Puebla',
  canal: 'WhatsApp', etapa: 'por_cotizar', data: {},
};

test('P8: buildProspectoCardHtml muestra nombre, etapa Por Cotizar, vendedor, ciudad, canal y celular', () => {
  const html = buildProspectoCardHtml(PROSPECTO);
  assert.match(html, /Laura/);
  assert.match(html, /Por Cotizar/);
  assert.match(html, /Memo/);
  assert.match(html, /Puebla/);
  assert.match(html, /WhatsApp/);
  assert.match(html, /\+52 5512345678/);
});

test('P9: buildProspectoCardHtml incluye empresa cuando existe y tolera data ausente', () => {
  const conEmpresa = buildProspectoCardHtml({ ...PROSPECTO, data: { empresa: 'Hotel Azul' } });
  assert.match(conEmpresa, /Hotel Azul/);
  const sinData = buildProspectoCardHtml({ ...PROSPECTO, data: null });
  assert.match(sinData, /Laura/);
});

test('P10: buildProspectoExistenteHtml muestra el prospecto propio del 409 y nada sin prospecto', () => {
  const html = buildProspectoExistenteHtml({ error: 'Este celular ya es un prospecto', prospecto: PROSPECTO });
  assert.match(html, /Laura/);
  assert.match(html, /\+52 5512345678/);
  assert.equal(buildProspectoExistenteHtml({ error: 'Este celular ya es un prospecto' }), '');
  assert.equal(buildProspectoExistenteHtml(null), '');
});

test('P7: catalogos cerrados con los valores canonicos de CONTEXT.md', () => {
  assert.deepEqual(CANALES, [
    'WhatsApp', 'Instagram', 'Facebook/Messenger', 'Meta Ads', 'Formulario web',
    'Correo', 'Referido', 'Bazar Sábado', 'Feria/Expo', 'Cliente Actual',
  ]);
  assert.deepEqual(PIEZAS_ESTIMADAS, ['+100', '+350', '+550', '+1,500', '+6,000']);
  assert.deepEqual(OPCIONALES, ['empresa', 'segmento_id', 'piezas_estimadas', 'correo', 'temperatura', 'notas']);
});

test('P11: buildProspectoCardHtml escapa HTML en los datos del prospecto', () => {
  const html = buildProspectoCardHtml({
    ...PROSPECTO,
    nombre: '<img src=x onerror=alert(1)>',
    ciudad: 'Puebla & "Cholula"',
    data: { empresa: '<b>Hotel</b>' },
  });
  assert.equal(html.includes('<img'), false);
  assert.match(html, /&lt;img/);
  assert.equal(html.includes('<b>Hotel</b>'), false);
  assert.match(html, /Puebla &amp; &quot;Cholula&quot;/);
});

// === Issue #66: editar/complementar el prospecto desde su tarjeta ===

test('ED1: validarEdicionProspecto rechaza vaciar nombre o ciudad pero acepta ediciones parciales', () => {
  assert.match(validarEdicionProspecto({ nombre: '   ' }), /nombre/i);
  assert.match(validarEdicionProspecto({ ciudad: '' }), /ciudad/i);
  // editar solo opcionales (sin tocar obligatorios) es valido
  assert.equal(validarEdicionProspecto({ notas: 'algo', temperatura: 5 }), null);
  assert.equal(validarEdicionProspecto({ nombre: 'Laura', ciudad: 'CDMX' }), null);
  assert.equal(validarEdicionProspecto({}), null);
});

test('ED2: buildEdicionProspectoDatos separa columnas (nombre/ciudad) y data, recorta y omite ausentes', () => {
  const datos = buildEdicionProspectoDatos({
    nombre: '  Laura Perez ', ciudad: ' CDMX ',
    empresa: ' Hotel Verde ', temperatura: 5, correo: 'laura@hotel.mx', notas: '',
  });
  assert.equal(datos.nombre, 'Laura Perez');
  assert.equal(datos.ciudad, 'CDMX');
  assert.equal(datos.data.empresa, 'Hotel Verde');
  assert.equal(datos.data.temperatura, 5);
  assert.equal(datos.data.correo, 'laura@hotel.mx');
  // un opcional vaciado a proposito viaja como '' (para borrar), pero un ausente no
  assert.equal(datos.data.notas, '');
  assert.equal('piezas_estimadas' in datos.data, false);
  // sin opcionales no se crea la clave data
  const soloNombre = buildEdicionProspectoDatos({ nombre: 'X' });
  assert.equal('data' in soloNombre, false);
});

test('ED3: buildEdicionProspectoFormHtml prellena los datos actuales y guarda contra el id del prospecto', () => {
  const html = buildEdicionProspectoFormHtml({
    id: 3, nombre: 'Laura', ciudad: 'Puebla',
    data: { empresa: 'Hotel Azul', temperatura: 4, notas: 'pidio catalogo' },
  });
  assert.match(html, /value="Laura"/);
  assert.match(html, /value="Puebla"/);
  assert.match(html, /value="Hotel Azul"/);
  assert.match(html, /pidio catalogo/);
  // los campos del catalogo de la captura (tipo cliente, piezas) estan presentes
  assert.match(html, /ed-empresa-3/);
  assert.match(html, /ed-correo-3/);
  assert.match(html, /ed-temperatura-3/);
  assert.match(html, /ed-notas-3/);
  assert.match(html, /guardarEdicionProspecto\(3\)/);
});

test('ED4: la card de un prospecto en cualquier etapa activa ofrece Editar; en una salida no', () => {
  for (const etapa of ['por_cotizar', 'seguimiento', 'anticipo_pagado', 'producto_entregado']) {
    const html = buildProspectoCardHtml({ ...PROSPECTO, etapa }, null, new Date(), { compacta: true });
    assert.match(html, /abrirEdicionProspecto\(3\)/, `etapa activa ${etapa} debe ofrecer Editar`);
  }
  for (const etapa of ['no_util', 'perdida']) {
    const html = buildProspectoCardHtml({ ...PROSPECTO, etapa });
    assert.equal(html.includes('abrirEdicionProspecto'), false, `salida ${etapa} no edita`);
  }
});

// === Issue #43: etapas, toques, No util e historial ===

test('T1: MOTIVOS_NO_UTIL es el catalogo cerrado canonico de CONTEXT.md', () => {
  assert.deepEqual(MOTIVOS_NO_UTIL, ['menudeo', 'fuera de zona', 'sin presupuesto', 'spam', 'sin respuesta']);
});

test('T2: en el pipeline unificado no hay avance manual de etapa antes de cotizar', () => {
  assert.equal(siguienteEtapa('por_cotizar'), null);
  assert.equal(siguienteEtapa('seguimiento'), null);
  assert.equal(siguienteEtapa('no_util'), null);
});

test('T3: validarTransicion permite Por Cotizar -> Seguimiento solo con folio; sin folio se rechaza', () => {
  assert.equal(validarTransicion('por_cotizar', 'seguimiento', null, '55123'), null);
  assert.match(validarTransicion('por_cotizar', 'seguimiento', null, ''), /folio/i);
  assert.match(validarTransicion('por_cotizar', 'seguimiento', null), /folio/i);
  assert.match(validarTransicion('por_cotizar', 'seguimiento', null, '   '), /folio/i);
  // El resto de avances del embudo siguen siendo invalidos aun con folio.
  assert.ok(validarTransicion('seguimiento', 'anticipo_pagado', null, '55123'));
  assert.ok(validarTransicion('no_asignado', 'seguimiento', null, '55123'));
  assert.ok(validarTransicion('seguimiento', 'seguimiento', null, '55123'));
});

test('T4: validarTransicion rechaza saltos, etapas inventadas y avances sin No util', () => {
  assert.ok(validarTransicion('por_cotizar', 'producto_entregado'));
  assert.ok(validarTransicion('por_cotizar', 'por_cotizar'));
  assert.ok(validarTransicion('por_cotizar', 'inventada'));
  assert.ok(validarTransicion('por_cotizar', undefined));
});

test('T5: validarTransicion permite No util desde cualquier etapa activa con motivo del catalogo', () => {
  for (const etapa of ['por_cotizar', 'seguimiento', 'anticipo_pagado']) {
    assert.equal(validarTransicion(etapa, 'no_util', 'spam'), null);
  }
});

test('T6: validarTransicion rechaza No util sin motivo o con motivo fuera de catalogo', () => {
  assert.match(validarTransicion('por_cotizar', 'no_util'), /motivo/i);
  assert.match(validarTransicion('por_cotizar', 'no_util', ''), /motivo/i);
  assert.match(validarTransicion('por_cotizar', 'no_util', 'no me cayo bien'), /motivo/i);
  assert.ok(validarTransicion('no_util', 'no_util', 'spam'));
  assert.ok(validarTransicion('no_util', 'seguimiento'));
});

test('T6b: validarTransicion permite Perdida desde cualquier etapa activa sin motivo (#59)', () => {
  for (const etapa of ['no_asignado', 'por_cotizar', 'seguimiento', 'anticipo_pagado', 'pedido_liberado', 'saldo_pagado', 'producto_entregado']) {
    assert.equal(validarTransicion(etapa, 'perdida'), null, `Perdida debio permitirse desde ${etapa}`);
  }
});

test('T6c: validarTransicion rechaza Perdida desde una salida (ya salio del embudo) (#59)', () => {
  assert.ok(validarTransicion('no_util', 'perdida'));
  assert.ok(validarTransicion('perdida', 'perdida'));
});

test('T7: buildWaLink arma el link wa.me con solo digitos del celular', () => {
  assert.equal(buildWaLink('+52 55 1234 5678'), 'https://wa.me/525512345678');
  assert.equal(buildWaLink('+1 (555) 123-4567'), 'https://wa.me/15551234567');
  assert.equal(buildWaLink(''), null);
  assert.equal(buildWaLink(null), null);
});

const EVENTOS = [
  { tipo: 'cotizacion', cotizacion_id: 42, de: 'por_cotizar', fecha: '2026-06-11T10:00:00.000Z', vendedor: 'Memo' },
  { tipo: 'toque', fecha: '2026-06-12T10:00:00.000Z', vendedor: 'Ana' },
  { tipo: 'no_util', motivo: 'sin respuesta', fecha: '2026-06-13T10:00:00.000Z', vendedor: 'Memo' },
];

test('T8: buildHistorialHtml lista captura y eventos en orden cronologico', () => {
  const html = buildHistorialHtml({ ...PROSPECTO, eventos: EVENTOS });
  const iCaptura = html.indexOf('Capturado');
  const iCot = html.indexOf('Cotización');
  const iToque = html.indexOf('Toque');
  const iSalida = html.indexOf('sin respuesta');
  assert.ok(iCaptura >= 0 && iCot > iCaptura && iToque > iCot && iSalida > iToque);
  assert.match(html, /Memo/);
  assert.match(html, /Ana/);
});

test('T9: buildHistorialHtml ordena por fecha aunque los eventos lleguen desordenados', () => {
  const html = buildHistorialHtml({ ...PROSPECTO, eventos: [EVENTOS[2], EVENTOS[0], EVENTOS[1]] });
  const iCot = html.indexOf('Cotización');
  const iToque = html.indexOf('Toque');
  const iSalida = html.indexOf('sin respuesta');
  assert.ok(iCot >= 0 && iToque > iCot && iSalida > iToque);
});

test('T10: buildHistorialHtml tolera prospecto sin eventos y escapa datos de usuario', () => {
  const html = buildHistorialHtml(PROSPECTO);
  assert.match(html, /Capturado/);
  const conXss = buildHistorialHtml({
    ...PROSPECTO,
    vendedor: '<script>x</script>',
    eventos: [{ tipo: 'toque', fecha: '2026-06-12T10:00:00.000Z', vendedor: '<b>Ana</b>' }],
  });
  assert.equal(conXss.includes('<script>'), false);
  assert.equal(conXss.includes('<b>Ana</b>'), false);
});

test('T10b: buildHistorialHtml muestra la conversion a cliente con nombre e id, escapados', () => {
  const html = buildHistorialHtml({
    ...PROSPECTO,
    eventos: [{ tipo: 'cliente', cliente_id: 88, nombre: 'LAURA SA <DE> CV', fecha: '2026-06-12T10:00:00.000Z', vendedor: 'Memo' }],
  });
  assert.match(html, /Convertido en cliente/);
  assert.match(html, /LAURA SA &lt;DE&gt; CV/);
  assert.match(html, /#88/);
  const sinNombre = buildHistorialHtml({
    ...PROSPECTO,
    eventos: [{ tipo: 'cliente', cliente_id: 88, fecha: '2026-06-12T10:00:00.000Z', vendedor: 'Memo' }],
  });
  assert.match(sinNombre, /Convertido en cliente #88/);
});

test('T10c: buildHistorialHtml muestra el evento de cotizacion con id y quien la genero (#46)', () => {
  const html = buildHistorialHtml({
    ...PROSPECTO,
    eventos: [{ tipo: 'cotizacion', cotizacion_id: 42, de: 'nuevo', fecha: '2026-06-12T10:00:00.000Z', vendedor: 'Memo' }],
  });
  assert.match(html, /Cotización #42/);
  assert.match(html, /Memo/);
  const xss = buildHistorialHtml({
    ...PROSPECTO,
    eventos: [{ tipo: 'cotizacion', cotizacion_id: 42, fecha: '2026-06-12T10:00:00.000Z', vendedor: '<b>Memo</b>' }],
  });
  assert.equal(xss.includes('<b>Memo</b>'), false);
});

test('T11: la card de un prospecto en Por Cotizar trae wa.me, toque, No util, reunion e historial', () => {
  const html = buildProspectoCardHtml(PROSPECTO);
  assert.match(html, /href="https:\/\/wa\.me\/525512345678"/);
  // En el pipeline unificado ya no hay boton de avance manual de etapa.
  assert.equal(html.includes('avanzarEtapaProspecto'), false);
  assert.match(html, /registrarToqueProspecto\(3\)/);
  assert.match(html, /marcarNoUtilProspecto\(3\)/);
  assert.match(html, /pr-motivo-3/);
  assert.match(html, /sin presupuesto/);
  assert.match(html, /toggleHistorialProspecto\(3\)/);
  assert.match(html, /pr-historial-3/);
});

test('T12: la card en Seguimiento ya no ofrece acciones de prospecto; la oportunidad la lleva la cotizacion', () => {
  const seguimiento = buildProspectoCardHtml({ ...PROSPECTO, etapa: 'seguimiento' });
  assert.equal(seguimiento.includes('avanzarEtapaProspecto'), false);
  assert.equal(seguimiento.includes('registrarToqueProspecto'), false);
  assert.match(seguimiento, /Seguimiento/);
  assert.match(seguimiento, /toggleHistorialProspecto\(3\)/);
});

test('T13: la card de un prospecto No util no ofrece acciones de trabajo pero si historial', () => {
  const html = buildProspectoCardHtml({ ...PROSPECTO, etapa: 'no_util' });
  assert.equal(html.includes('avanzarEtapaProspecto'), false);
  assert.equal(html.includes('registrarToqueProspecto'), false);
  assert.equal(html.includes('marcarNoUtilProspecto'), false);
  assert.match(html, /toggleHistorialProspecto\(3\)/);
  assert.match(html, /No útil/);
});

test('T14: contarMotivosNoUtil acumula los motivos de todos los prospectos', () => {
  const conteo = contarMotivosNoUtil([
    { ...PROSPECTO, etapa: 'no_util', eventos: [{ tipo: 'no_util', motivo: 'spam', fecha: '2026-06-11T10:00:00.000Z', vendedor: 'Memo' }] },
    { ...PROSPECTO, id: 4, etapa: 'no_util', eventos: [{ tipo: 'no_util', motivo: 'spam', fecha: '2026-06-12T10:00:00.000Z', vendedor: 'Ana' }] },
    { ...PROSPECTO, id: 5, etapa: 'no_util', eventos: [
      { tipo: 'toque', fecha: '2026-06-12T10:00:00.000Z', vendedor: 'Ana' },
      { tipo: 'no_util', motivo: 'menudeo', fecha: '2026-06-13T10:00:00.000Z', vendedor: 'Ana' },
    ] },
    { ...PROSPECTO, id: 6 },
  ]);
  assert.deepEqual(conteo, { spam: 2, menudeo: 1 });
});

test('T15: buildMotivosNoUtilHtml pinta el conteo ordenado de mayor a menor y tolera vacio', () => {
  const html = buildMotivosNoUtilHtml({ menudeo: 1, spam: 3 });
  assert.ok(html.indexOf('spam') < html.indexOf('menudeo'));
  assert.match(html, /3/);
  assert.match(html, /1/);
  assert.match(buildMotivosNoUtilHtml({}), /Sin salidas/i);
  assert.match(buildMotivosNoUtilHtml(null), /Sin salidas/i);
});

// === Issue #44: cola de seguimiento y etiqueta de espera ===

const ITEM_COLA = {
  id: 3, nombre: 'Laura', celular: '+52 5512345678', ciudad: 'Puebla',
  canal: 'WhatsApp', etapa: 'por_cotizar', vendedor: 'Memo',
  horas: 2, toques: 0, color: 'rojo', sugerirNoUtil: false,
};

test('C1: buildEsperaBadgeHtml pinta horas habiles sin respuesta con el color del semaforo', () => {
  const html = buildEsperaBadgeHtml(ITEM_COLA);
  assert.match(html, /2 h hábiles sin respuesta/);
  assert.match(html, /espera-rojo/);
  assert.match(buildEsperaBadgeHtml({ ...ITEM_COLA, horas: 0.5, color: 'verde' }), /espera-verde/);
  assert.match(buildEsperaBadgeHtml({ ...ITEM_COLA, horas: 1.25, color: 'ambar' }), /1\.3 h/);
  assert.match(buildEsperaBadgeHtml({ ...ITEM_COLA, horas: 1.25, color: 'ambar' }), /espera-ambar/);
});

test('C2: buildProspectoCardHtml incluye la etiqueta de espera cuando recibe el item de la cola', () => {
  const con = buildProspectoCardHtml(PROSPECTO, ITEM_COLA);
  assert.match(con, /espera-rojo/);
  assert.match(con, /sin respuesta/);
  const sin = buildProspectoCardHtml(PROSPECTO);
  assert.equal(sin.includes('espera-'), false);
});

test('C3: buildColaProspectosHtml pinta los items en el orden recibido con badge, wa.me y toque', () => {
  const html = buildColaProspectosHtml([
    ITEM_COLA,
    { ...ITEM_COLA, id: 4, nombre: 'Pedro', celular: '+52 5599999999', canal: 'Correo', etapa: 'por_cotizar', horas: 5, color: 'ambar' },
  ]);
  assert.ok(html.indexOf('Laura') < html.indexOf('Pedro'));
  assert.match(html, /espera-rojo/);
  assert.match(html, /espera-ambar/);
  assert.match(html, /https:\/\/wa\.me\/525512345678/);
  assert.match(html, /registrarToqueProspecto\(3\)/);
  assert.match(html, /Por Cotizar/);
});

test('C4: buildColaProspectosHtml sugiere No util tras 3 toques con confirmacion del vendedor', () => {
  const html = buildColaProspectosHtml([{ ...ITEM_COLA, toques: 3, sugerirNoUtil: true }]);
  assert.match(html, /sugerirNoUtilProspecto\(3\)/);
  assert.match(html, /3 toques/);
  const sinSugerencia = buildColaProspectosHtml([{ ...ITEM_COLA, toques: 2 }]);
  assert.equal(sinSugerencia.includes('sugerirNoUtilProspecto'), false);
});

// === Issue #46: modal de canal antes de generar cotizacion ===

test('M1: necesitaCanal solo cuando la clasificacion es libre', () => {
  assert.equal(necesitaCanal({ tipo: 'libre' }), true);
  assert.equal(necesitaCanal({ tipo: 'prospecto' }), false);
  assert.equal(necesitaCanal({ tipo: 'cliente', cust_name: 'X' }), false);
  assert.equal(necesitaCanal(null), false);
  assert.equal(necesitaCanal(undefined), false);
});

test('M2: validarCanalCotizacion acepta el catalogo cerrado y rechaza lo demas', () => {
  for (const canal of CANALES) {
    assert.equal(validarCanalCotizacion(canal), null);
  }
  assert.match(validarCanalCotizacion(''), /canal/i);
  assert.match(validarCanalCotizacion('TikTok'), /canal/i);
  assert.match(validarCanalCotizacion(undefined), /canal/i);
});

test('M3: buildCanalModalHtml trae el select obligatorio con todos los canales y Confirmar/Cancelar', () => {
  const html = buildCanalModalHtml();
  assert.match(html, /id="canal-cot-select"/);
  for (const canal of CANALES) {
    assert.ok(html.includes(`>${canal}<`) || html.includes(canal), `falta canal ${canal}`);
  }
  assert.match(html, /option value=""/);
  assert.match(html, /id="canal-cot-confirmar"/);
  assert.match(html, /id="canal-cot-cancelar"/);
  assert.match(html, /id="canal-cot-error"/);
  assert.match(html, /Cancelar/);
  assert.match(html, /Confirmar/);
});

// === Issue #46: etiqueta de prospecto convertido en cliente ===

test('C6: la card muestra la etiqueta "Ya es cliente" cuando el prospecto esta ligado a un cliente', () => {
  const html = buildProspectoCardHtml({ ...PROSPECTO, data: { cliente_id: 88 } });
  assert.match(html, /Ya es cliente — falta cotizar/);
  const sin = buildProspectoCardHtml(PROSPECTO);
  assert.equal(sin.includes('Ya es cliente'), false);
});

test('C7: la cola muestra la etiqueta "Ya es cliente" cuando el item trae yaEsCliente', () => {
  const html = buildColaProspectosHtml([{ ...ITEM_COLA, yaEsCliente: true }]);
  assert.match(html, /Ya es cliente — falta cotizar/);
  const sin = buildColaProspectosHtml([ITEM_COLA]);
  assert.equal(sin.includes('Ya es cliente'), false);
});

// === Issue #45: reunion diagnostico ===

const AHORA = new Date('2026-06-10T18:00:00.000Z');
const REUNION_FUTURA = { tipo: 'reunion', fecha_reunion: '2026-06-15T17:00:00.000Z', fecha: '2026-06-10T12:00:00.000Z', vendedor: 'Memo' };
const REUNION_PASADA = { tipo: 'reunion', fecha_reunion: '2026-06-09T17:00:00.000Z', fecha: '2026-06-08T12:00:00.000Z', vendedor: 'Memo' };

test('RU1: el historial muestra el evento reunion con fecha agendada y vendedor, escapados', () => {
  const html = buildHistorialHtml({ ...PROSPECTO, eventos: [REUNION_FUTURA] });
  assert.match(html, /Reunión agendada para/);
  assert.match(html, /2026/);
  assert.match(html, /Memo/);
  const xss = buildHistorialHtml({ ...PROSPECTO, eventos: [{ ...REUNION_FUTURA, vendedor: '<b>Memo</b>' }] });
  assert.equal(xss.includes('<b>Memo</b>'), false);
});

test('RU2: la card activa ofrece agendar reunion con input datetime-local', () => {
  const html = buildProspectoCardHtml(PROSPECTO);
  assert.match(html, /type="datetime-local"/);
  assert.match(html, /id="pr-reunion-3"/);
  assert.match(html, /agendarReunionProspecto\(3\)/);
  const noUtil = buildProspectoCardHtml({ ...PROSPECTO, etapa: 'no_util' });
  assert.equal(noUtil.includes('agendarReunionProspecto'), false);
});

test('RU3: la card muestra la etiqueta de reunion futura y convive con la de cliente', () => {
  const p = { ...PROSPECTO, eventos: [REUNION_FUTURA], data: { cliente_id: 88 } };
  const html = buildProspectoCardHtml(p, undefined, AHORA);
  assert.match(html, /reunion-badge/);
  assert.match(html, /Reunión el/);
  assert.match(html, /Ya es cliente — falta cotizar/);
  // pasada la fecha, la etiqueta de reunion futura desaparece de la card
  const pasada = buildProspectoCardHtml({ ...PROSPECTO, eventos: [REUNION_PASADA] }, undefined, AHORA);
  assert.equal(pasada.includes('Reunión el'), false);
});

test('RU4: el item de cola con reunion vencida pide registrar el resultado (salida a No util)', () => {
  const html = buildColaProspectosHtml([{
    ...ITEM_COLA, reunionVencida: true, fechaReunion: '2026-06-09T17:00:00.000Z',
  }]);
  assert.match(html, /Reunión del/);
  assert.match(html, /registrar resultado/);
  // El avance a Calificado se elimino (ADR-0005): la card ya no lo ofrece.
  assert.equal(html.includes("'calificado'"), false);
  assert.match(html, /id="cola-motivo-3"/);
  assert.match(html, /resultadoReunionNoUtilProspecto\(3\)/);
  for (const m of MOTIVOS_NO_UTIL) assert.ok(html.includes(m), `falta motivo ${m}`);
  // el flujo normal de toque se sustituye por el registro del resultado
  assert.equal(html.includes('registrarToqueProspecto'), false);
});

test('RU5: el item de cola sin reunion vencida conserva el flujo normal y los badges conviven', () => {
  const normal = buildColaProspectosHtml([ITEM_COLA]);
  assert.equal(normal.includes('resultadoReunionProspecto'), false);
  assert.equal(normal.includes('Reunión del'), false);
  assert.match(normal, /registrarToqueProspecto\(3\)/);
  const conTodo = buildColaProspectosHtml([{
    ...ITEM_COLA, yaEsCliente: true, reunionVencida: true, fechaReunion: '2026-06-09T17:00:00.000Z',
  }]);
  assert.match(conTodo, /Ya es cliente — falta cotizar/);
  assert.match(conTodo, /Reunión del/);
});

test('RU6: reunionFutura y reunionPendienteResultado obedecen a la ultima reunion', () => {
  assert.equal(reunionFutura({ ...PROSPECTO, eventos: [REUNION_FUTURA] }, AHORA), REUNION_FUTURA.fecha_reunion);
  assert.equal(reunionFutura({ ...PROSPECTO, eventos: [REUNION_PASADA] }, AHORA), null);
  assert.equal(reunionFutura(PROSPECTO, AHORA), null);
  assert.equal(reunionPendienteResultado({ ...PROSPECTO, eventos: [REUNION_PASADA] }, AHORA), REUNION_PASADA.fecha_reunion);
  assert.equal(reunionPendienteResultado({ ...PROSPECTO, eventos: [REUNION_FUTURA] }, AHORA), null);
  assert.equal(reunionPendienteResultado({ ...PROSPECTO, eventos: [
    REUNION_PASADA,
    { tipo: 'toque', fecha: '2026-06-10T12:00:00.000Z', vendedor: 'Memo' },
  ] }, AHORA), null);
  // re-agendada: la ultima manda
  assert.equal(reunionFutura({ ...PROSPECTO, eventos: [REUNION_PASADA, REUNION_FUTURA] }, AHORA), REUNION_FUTURA.fecha_reunion);
  assert.equal(reunionPendienteResultado({ ...PROSPECTO, eventos: [REUNION_PASADA, REUNION_FUTURA] }, AHORA), null);
});

// === Issue #65: nucleo de predicados de reunion sobre un ARRAY de eventos ===
// La reunion ya no es solo del prospecto: una COTIZACION en Seguimiento tambien la
// agenda (su array de eventos vive en c.seguimientos). El nucleo opera sobre el
// array directamente para que prospecto y cotizacion compartan la misma logica.

test('RU7: el nucleo sobre el array obedece a la ultima reunion (futura/pendiente)', () => {
  // sin eventos -> nada
  assert.equal(ultimaReunionDe([]), null);
  assert.equal(reunionFuturaDe([], AHORA), null);
  assert.equal(reunionPendienteResultadoDe([], AHORA), null);
  // ultima reunion = la ultima registrada (REUNION_FUTURA se registro despues)
  assert.equal(ultimaReunionDe([REUNION_PASADA, REUNION_FUTURA]), REUNION_FUTURA);
  // futura suprime
  assert.equal(reunionFuturaDe([REUNION_FUTURA], AHORA), REUNION_FUTURA.fecha_reunion);
  assert.equal(reunionFuturaDe([REUNION_PASADA], AHORA), null);
  // pasada sin evento posterior -> pendiente
  assert.equal(reunionPendienteResultadoDe([REUNION_PASADA], AHORA), REUNION_PASADA.fecha_reunion);
  assert.equal(reunionPendienteResultadoDe([REUNION_FUTURA], AHORA), null);
  // un evento posterior a la reunion (p.ej. un paso de cadencia con fecha) limpia el pendiente
  assert.equal(reunionPendienteResultadoDe([
    REUNION_PASADA,
    { paso: 'dia7', fecha: '2026-06-10T12:00:00.000Z', vendedor: 'Memo' },
  ], AHORA), null);
  // re-agendar al futuro suprime aunque haya una pasada antes
  assert.equal(reunionFuturaDe([REUNION_PASADA, REUNION_FUTURA], AHORA), REUNION_FUTURA.fecha_reunion);
});

test('RU8: los wrappers de prospecto delegan en el nucleo del array (no rompe #45)', () => {
  // reunionFutura(p)/reunionPendienteResultado(p) === nucleo(p.eventos)
  assert.equal(
    reunionFutura({ ...PROSPECTO, eventos: [REUNION_FUTURA] }, AHORA),
    reunionFuturaDe([REUNION_FUTURA], AHORA)
  );
  assert.equal(
    reunionPendienteResultado({ ...PROSPECTO, eventos: [REUNION_PASADA] }, AHORA),
    reunionPendienteResultadoDe([REUNION_PASADA], AHORA)
  );
});

test('RU9: re-agendar a una fecha mas temprana: manda la ultima reunion REGISTRADA, no la de cita mas lejana', () => {
  // CONTEXT.md "Reunion de diagnostico": re-agendar registra otro evento y la
  // ultima manda (la ultima accion del vendedor). Si re-agenda de 06-20 a 06-13
  // (cita mas cercana) registrando despues, la activa es la de 06-13, aunque
  // 06-20 sea una fecha de cita posterior.
  const lejana = { tipo: 'reunion', fecha_reunion: '2026-06-20T17:00:00.000Z', fecha: '2026-06-10T08:00:00.000Z', vendedor: 'Memo' };
  const reagendada = { tipo: 'reunion', fecha_reunion: '2026-06-13T17:00:00.000Z', fecha: '2026-06-10T12:00:00.000Z', vendedor: 'Memo' };
  assert.equal(ultimaReunionDe([lejana, reagendada]), reagendada);
  assert.equal(reunionFuturaDe([lejana, reagendada], AHORA), reagendada.fecha_reunion);
});

// === Issue #53: el tablero unico del pipeline reemplaza el kanban de
// prospectos del modelo previo; su logica vive en pipeline-logica.js. Aqui se
// conservan el modal de motivo (reusable), la card compacta y el boton Cotizar.

test('K9: buildMotivoNoUtilModalHtml trae el select con el catalogo cerrado y Confirmar/Cancelar', () => {
  const html = buildMotivoNoUtilModalHtml();
  assert.match(html, /id="motivo-tablero-select"/);
  for (const m of MOTIVOS_NO_UTIL) assert.ok(html.includes(m), `falta motivo ${m}`);
  assert.match(html, /option value=""/);
  assert.match(html, /id="motivo-tablero-confirmar"/);
  assert.match(html, /id="motivo-tablero-cancelar"/);
  assert.match(html, /id="motivo-tablero-error"/);
  assert.match(html, /Confirmar/);
  assert.match(html, /Cancelar/);
});

test('C5: buildColaProspectosHtml tolera cola vacia y escapa datos de usuario', () => {
  assert.match(buildColaProspectosHtml([]), /Nada pendiente/i);
  assert.match(buildColaProspectosHtml(null), /Nada pendiente/i);
  const html = buildColaProspectosHtml([{ ...ITEM_COLA, nombre: '<img src=x>' }]);
  assert.equal(html.includes('<img'), false);
  assert.match(html, /&lt;img/);
});

// === Issue #58: el badge de Hoy cuenta los pendientes de prospectos ===

test('H1: contarPendientesProspectos cuenta los items de la cola de prospectos', () => {
  assert.equal(contarPendientesProspectos([ITEM_COLA, { ...ITEM_COLA, id: 4 }]), 2);
  assert.equal(contarPendientesProspectos([ITEM_COLA]), 1);
});

test('H2: contarPendientesProspectos es 0 con cola vacia o nula', () => {
  assert.equal(contarPendientesProspectos([]), 0);
  assert.equal(contarPendientesProspectos(null), 0);
  assert.equal(contarPendientesProspectos(undefined), 0);
});

test('K12: la card compacta del tablero guarda las acciones pesadas tras un toggle', () => {
  const compacta = buildProspectoCardHtml(PROSPECTO, null, new Date(), { compacta: true });
  assert.match(compacta, /toggleAccionesProspecto\(3\)/);
  assert.match(compacta, new RegExp('id="pr-acciones-3" style="display:none'));
  assert.match(compacta, /Agendar reunión/);
  assert.match(compacta, /wa\.me/);
  assert.match(compacta, />Más</);
  const normal = buildProspectoCardHtml(PROSPECTO);
  assert.equal(normal.includes('toggleAccionesProspecto'), false);
});

test('K12b: en la card compacta del prospecto el Cotizar queda visible, no tras el toggle', () => {
  const compacta = buildProspectoCardHtml(PROSPECTO, null, new Date(), { compacta: true });
  const cotizar = compacta.indexOf('cotizarProspecto');
  const ocultas = compacta.indexOf('id="pr-acciones-3"');
  assert.ok(cotizar > -1 && cotizar < ocultas);
});

test('K15: la card de un prospecto activo trae el boton Cotizar', () => {
  const html = buildProspectoCardHtml(PROSPECTO, null, new Date(), { compacta: true });
  assert.match(html, /cotizarProspecto\(3\)/);
  const noUtil = buildProspectoCardHtml({ ...PROSPECTO, etapa: 'no_util' });
  assert.equal(noUtil.includes('cotizarProspecto'), false);
});

// --- Captura de expo (#261, spec #260) ---
// Bloque propio (declaraciones + before) para no tocar el encabezado del archivo.
let TIPOS_CLIENTE, segmentoDeTipo, NIVELES_INTERES;
let segmentoDeTipoMayoreo, TIPOS_PROYECTO;
before(async () => {
  ({ TIPOS_CLIENTE, segmentoDeTipo, NIVELES_INTERES } = await import('../prospectos-logica.js'));
  ({ segmentoDeTipo: segmentoDeTipoMayoreo, TIPOS_PROYECTO } = await import('../mayoreo-logica.js'));
});

test('E1: el catalogo Tipo de cliente vive en el nucleo de prospectos con sus 8 opciones', () => {
  assert.deepEqual(TIPOS_CLIENTE, [
    'Distribuidores', 'Menudistas', 'Restaurantes', 'Hoteles',
    'Cafeterías', 'Catering | Eventos', 'Agencias | Marcas', 'Otro',
  ]);
  assert.equal(segmentoDeTipo('Distribuidores'), 14);
  assert.equal(segmentoDeTipo('Cafeterías'), 10);
  assert.equal(segmentoDeTipo('Otro'), 1);
  assert.equal(segmentoDeTipo('Ferreterías'), null);
});

test('E2: la captura publica y la captura de expo comparten UN solo mapeo tipo -> segmento', () => {
  assert.equal(segmentoDeTipoMayoreo, segmentoDeTipo);
  assert.deepEqual(TIPOS_PROYECTO, TIPOS_CLIENTE);
});

test('E3: el nivel de interes de la expo se traduce a temperatura 1/3/5', () => {
  assert.deepEqual(NIVELES_INTERES, { Bajo: 1, Medio: 3, Alto: 5 });
});

const LIGA = 'https://pppeltre.mx/catalogo';
const LIGAS = { sitioUrl: '', catalogoUrl: LIGA };

test('E4: mensajeWhatsAppExpo devuelve el texto aprobado con el catalogo en bloque propio y sin esquema', async () => {
  const { mensajeWhatsAppExpo } = await import('../prospectos-logica.js');
  const texto = mensajeWhatsAppExpo(
    { nombre: 'Laura Mendoza', empresa: 'Hotel Azul', tipo_cliente: 'Hoteles', evento: 'Abastur 2026' },
    'Alejandro Chávez', LIGAS
  );
  assert.equal(texto, [
    'Hola Laura, soy Alejandro Chávez de pp.peltre. Un gusto haberte conocido en Abastur 2026.',
    '',
    'También puedes descargar nuestro catálogo desde:',
    'pppeltre.mx/catalogo',
    '',
    'Si te sirve, con gusto te preparo una cotización para Hotel Azul. ¿Qué piezas te llamaron la atención?',
  ].join('\n'));
});

test('E4b: el vendedor se presenta con el nombre integro del registro, incluido uno de tres palabras', async () => {
  const { mensajeWhatsAppExpo } = await import('../prospectos-logica.js');
  const texto = mensajeWhatsAppExpo(
    { nombre: 'Laura Mendoza', empresa: 'Hotel Azul', tipo_cliente: 'Hoteles', evento: 'Abastur 2026' },
    'Ana Maria Lopez', LIGAS
  );
  assert.match(texto, /^Hola Laura, soy Ana Maria Lopez de pp\.peltre\. /);
});

test('E4c: la liga se muestra sin esquema y sin diagonal final; el www. se respeta', async () => {
  const { mensajeWhatsAppExpo } = await import('../prospectos-logica.js');
  const prospecto = { nombre: 'Laura', tipo_cliente: 'Hoteles', evento: 'Abastur 2026' };
  const conDiagonal = mensajeWhatsAppExpo(prospecto, 'Pilar', { catalogoUrl: 'https://pppeltre.mx/catalogo/' });
  assert.match(conDiagonal, /^pppeltre\.mx\/catalogo$/m);
  const http = mensajeWhatsAppExpo(prospecto, 'Pilar', { catalogoUrl: 'http://www.pppeltre.mx/catalogo' });
  assert.match(http, /^www\.pppeltre\.mx\/catalogo$/m);
});

test('E4d: sin liga de catalogo desaparece el bloque entero, sin renglon en blanco huerfano', async () => {
  const { mensajeWhatsAppExpo } = await import('../prospectos-logica.js');
  const texto = mensajeWhatsAppExpo(
    { nombre: 'Laura Mendoza', empresa: 'Hotel Azul', tipo_cliente: 'Hoteles', evento: 'Abastur 2026' },
    'Alejandro Chávez', { sitioUrl: '', catalogoUrl: '' }
  );
  assert.equal(texto, [
    'Hola Laura, soy Alejandro Chávez de pp.peltre. Un gusto haberte conocido en Abastur 2026.',
    '',
    'Si te sirve, con gusto te preparo una cotización para Hotel Azul. ¿Qué piezas te llamaron la atención?',
  ].join('\n'));
  // sin ningun dato de ligas el mensaje sigue completo (llamador que no lo pasa),
  // y `null` se absorbe igual que el resto de los campos del nucleo
  const sinLigas = [
    'Hola Laura, soy Pilar de pp.peltre. Un gusto haberte conocido en Abastur 2026.',
    '',
    'Si te sirve, con gusto te preparo una cotización a tu medida. ¿Qué piezas te llamaron la atención?',
  ].join('\n');
  assert.equal(mensajeWhatsAppExpo({ nombre: 'Laura', evento: 'Abastur 2026' }, 'Pilar'), sinLigas);
  assert.equal(mensajeWhatsAppExpo({ nombre: 'Laura', evento: 'Abastur 2026' }, 'Pilar', null), sinLigas);
});

test('E4e: con liga del sitio su bloque va antes del catalogo; vacia se omite sin dejar hueco', async () => {
  const { mensajeWhatsAppExpo } = await import('../prospectos-logica.js');
  const texto = mensajeWhatsAppExpo(
    { nombre: 'Laura Mendoza', empresa: 'Hotel Azul', tipo_cliente: 'Hoteles', evento: 'Abastur 2026' },
    'Alejandro Chávez', { sitioUrl: 'https://pppeltre.mx/', catalogoUrl: LIGA }
  );
  assert.equal(texto, [
    'Hola Laura, soy Alejandro Chávez de pp.peltre. Un gusto haberte conocido en Abastur 2026.',
    '',
    'Te dejo una liga a nuestra página web:',
    'pppeltre.mx',
    '',
    'También puedes descargar nuestro catálogo desde:',
    'pppeltre.mx/catalogo',
    '',
    'Si te sirve, con gusto te preparo una cotización para Hotel Azul. ¿Qué piezas te llamaron la atención?',
  ].join('\n'));
  assert.equal(mensajeWhatsAppExpo(
    { nombre: 'Laura', evento: 'Abastur 2026' }, 'Pilar', { sitioUrl: '   ', catalogoUrl: LIGA }
  ).includes('página web'), false);
});

test('E5: sin empresa el mensaje ofrece una cotizacion a tu medida', async () => {
  const { mensajeWhatsAppExpo } = await import('../prospectos-logica.js');
  const texto = mensajeWhatsAppExpo(
    { nombre: 'Laura', tipo_cliente: 'Hoteles', evento: 'Abastur 2026' }, 'Pilar Rosete', LIGAS
  );
  assert.match(texto, /con gusto te preparo una cotización a tu medida\. ¿Qué piezas te llamaron la atención\?$/);
  assert.equal(texto.includes('para '), false);
});

test('E6: los tipos mayoristas cambian la oferta a una propuesta de mayoreo', async () => {
  const { mensajeWhatsAppExpo } = await import('../prospectos-logica.js');
  for (const tipo of ['Distribuidores', 'Menudistas', 'Agencias | Marcas']) {
    const texto = mensajeWhatsAppExpo(
      { nombre: 'Laura', empresa: 'Casa Azul', tipo_cliente: tipo, evento: 'Abastur 2026' }, 'Pilar', LIGAS
    );
    assert.match(texto, /con gusto te preparo una propuesta de mayoreo para Casa Azul\./);
  }
  const restaurante = mensajeWhatsAppExpo(
    { nombre: 'Laura', empresa: 'Casa Azul', tipo_cliente: 'Restaurantes', evento: 'Abastur 2026' }, 'Pilar', LIGAS
  );
  assert.match(restaurante, /una cotización para Casa Azul\./);
});

test('E7: un tipo mayorista sin empresa cae en la variante a tu medida', async () => {
  const { mensajeWhatsAppExpo } = await import('../prospectos-logica.js');
  const texto = mensajeWhatsAppExpo(
    { nombre: 'Laura', tipo_cliente: 'Distribuidores', evento: 'Abastur 2026' }, 'Pilar', LIGAS
  );
  assert.match(texto, /una cotización a tu medida\./);
});

const CAPTURA_EXPO = {
  celular: '+52 5512345678', nombre: 'Laura', ciudad: 'CDMX', canal: 'Feria/Expo',
  evento: 'Abastur 2026', tipo_cliente: 'Hoteles', interes: 'Alto',
};

test('E8: la variante de expo exige lo de la captura normal MAS el tipo de cliente', async () => {
  const { validarProspectoExpoBody } = await import('../prospectos-logica.js');
  assert.equal(validarProspectoExpoBody(CAPTURA_EXPO), null);
  assert.match(validarProspectoExpoBody({ ...CAPTURA_EXPO, tipo_cliente: '' }), /tipo de cliente/i);
  assert.match(validarProspectoExpoBody({ ...CAPTURA_EXPO, tipo_cliente: 'Ferreterías' }), /tipo de cliente/i);
  assert.match(validarProspectoExpoBody({ ...CAPTURA_EXPO, ciudad: '' }), /ciudad/i);
  assert.match(validarProspectoExpoBody({ ...CAPTURA_EXPO, celular: '5512345678' }), /[Cc]elular/);
});

test('E9: "Otro" en tipo de cliente exige decir cual', async () => {
  const { validarProspectoExpoBody } = await import('../prospectos-logica.js');
  assert.match(validarProspectoExpoBody({ ...CAPTURA_EXPO, tipo_cliente: 'Otro' }), /cuál/i);
  assert.equal(validarProspectoExpoBody({
    ...CAPTURA_EXPO, tipo_cliente: 'Otro', tipo_cliente_otro: 'Tienda de museo',
  }), null);
});

test('E10: el nivel de interes fuera del catalogo se rechaza; ausente se acepta', async () => {
  const { validarProspectoExpoBody } = await import('../prospectos-logica.js');
  assert.match(validarProspectoExpoBody({ ...CAPTURA_EXPO, interes: 'Tibio' }), /interés/i);
  assert.equal(validarProspectoExpoBody({ ...CAPTURA_EXPO, interes: '' }), null);
});

test('E11: buildDatosExpo arma evento, tipo textual, segmento y temperatura', async () => {
  const { buildDatosExpo } = await import('../prospectos-logica.js');
  assert.deepEqual(buildDatosExpo(CAPTURA_EXPO), {
    evento: 'Abastur 2026', tipo_cliente: 'Hoteles', segmento_id: 10, temperatura: 5,
  });
  assert.deepEqual(buildDatosExpo({ ...CAPTURA_EXPO, tipo_cliente: 'Otro', tipo_cliente_otro: ' Tienda de museo ', interes: 'Bajo' }), {
    evento: 'Abastur 2026', tipo_cliente: 'Otro', tipo_cliente_otro: 'Tienda de museo',
    segmento_id: 1, temperatura: 1,
  });
  assert.deepEqual(buildDatosExpo({ celular: '+52 5512345678', nombre: 'Laura' }), {});
});

const PROSPECTO_EXPO = {
  id: 7, fecha: '2026-08-26T18:00:00Z', vendedor: 'Alejandro Chávez', celular: '+52 5544332211',
  nombre: 'Laura Mendoza', ciudad: 'CDMX', canal: 'Feria/Expo', etapa: 'por_cotizar', eventos: [],
  data: { evento: 'Abastur 2026', tipo_cliente: 'Hoteles', empresa: 'Hotel Azul', temperatura: 5 },
};

test('E12: el WhatsApp de la tarjeta lleva el mensaje del evento solo cuando el prospecto tiene evento', async () => {
  const { buildProspectoCardHtml, mensajeWhatsAppExpo } = await import('../prospectos-logica.js');
  const conEvento = buildProspectoCardHtml(PROSPECTO_EXPO, null, new Date(), { ligas: LIGAS });
  const esperado = encodeURIComponent(mensajeWhatsAppExpo(
    { nombre: 'Laura Mendoza', empresa: 'Hotel Azul', tipo_cliente: 'Hoteles', evento: 'Abastur 2026' },
    'Alejandro Chávez', LIGAS
  ));
  assert.ok(conEvento.includes(`https://wa.me/525544332211?text=${esperado}`));
  // el objeto de ligas llega de verdad hasta el mensaje: la liga corta va dentro
  assert.ok(conEvento.includes(encodeURIComponent('pppeltre.mx/catalogo')));

  const sinEvento = buildProspectoCardHtml({ ...PROSPECTO_EXPO, data: {} }, null, new Date(), { ligas: LIGAS });
  assert.ok(sinEvento.includes('href="https://wa.me/525544332211"'));
  assert.equal(sinEvento.includes('?text='), false);
});

test('E13: la tarjeta de un prospecto de feria muestra el evento', async () => {
  const { buildProspectoCardHtml } = await import('../prospectos-logica.js');
  assert.match(buildProspectoCardHtml(PROSPECTO_EXPO), /Abastur 2026/);
  assert.equal(buildProspectoCardHtml({ ...PROSPECTO_EXPO, data: {} }).includes('Abastur'), false);
});

test('E14: el historial nombra la captura de expo con su evento y quien la hizo', async () => {
  const { buildHistorialHtml } = await import('../prospectos-logica.js');
  const html = buildHistorialHtml({
    ...PROSPECTO_EXPO,
    eventos: [{ tipo: 'captura_expo', fecha: '2026-08-26T18:00:00Z', evento: 'Abastur 2026', vendedor: 'Memo' }],
  });
  assert.match(html, /Abastur 2026/);
  assert.match(html, /Memo/);
  assert.equal(html.includes('captura_expo ·'), false);
});

test('E15: la ciudad de la expo sale del codigo postal, no de un catalogo de ciudades frecuentes', async () => {
  const mod = await import('../prospectos-logica.js');
  assert.equal('CIUDADES_FRECUENTES' in mod, false);
});

test('E15b: en la pantalla de expo el CP es obligatorio salvo con "No sabe su CP", y la ciudad tiene que quedar', async () => {
  const { validarCpCiudadExpo } = await import('../prospectos-logica.js');
  // CP resuelto: la ciudad la puso el indice y no hay nada que reclamar.
  assert.equal(validarCpCiudadExpo({ cp: '72000', ciudad: 'Puebla' }), null);
  // Sin CP y sin la excepcion del stand: no se guarda.
  assert.match(validarCpCiudadExpo({ cp: '', ciudad: 'Puebla' }), /postal/i);
  // "No sabe su CP": la ciudad tecleada basta.
  assert.equal(validarCpCiudadExpo({ cp: '', ciudad: 'Puebla', sinCp: true }), null);
  // CP que no resuelve y nadie tecleo la ciudad: tampoco se guarda.
  assert.match(validarCpCiudadExpo({ cp: '99999', ciudad: '' }), /ciudad/i);
  assert.match(validarCpCiudadExpo({ cp: '', ciudad: '   ', sinCp: true }), /ciudad/i);
});

test('E16: buildChipsHtml marca el chip elegido y no usa onclick inline (#112)', async () => {
  const { buildChipsHtml } = await import('../prospectos-logica.js');
  const html = buildChipsHtml('tipo', ['Hoteles', 'Otro'], 'Hoteles');
  assert.match(html, /data-chip="tipo"/);
  assert.match(html, /data-valor="Hoteles"[^>]*class="chip chip-activo"|class="chip chip-activo"[^>]*data-valor="Hoteles"/);
  assert.match(html, /data-valor="Otro"/);
  assert.equal(html.includes('chip-activo"  data-valor="Otro"'), false);
  assert.equal(html.includes('onclick'), false);
  assert.equal(buildChipsHtml('tipo', ['Hoteles'], '').includes('chip-activo'), false);
});

// === Issue #262 (spec #260, CONTEXT.md "Siguiente contacto"): compromiso de
// contacto (canal + fecha) sobre cualquier prospecto. Hermano de la reunion:
// mientras la fecha es futura suprime la cadencia; pasada la fecha sin toque
// posterior la tarjeta pide cumplirlo. No tiene resultado que registrar.

const SC_FUTURO = { tipo: 'siguiente_contacto', canales: ['WhatsApp'], fecha_contacto: '2026-06-15T15:00:00.000Z', fecha: '2026-06-10T12:00:00.000Z', vendedor: 'Memo' };
const SC_VENCIDO = { tipo: 'siguiente_contacto', canales: ['Llamada'], fecha_contacto: '2026-06-09T15:00:00.000Z', fecha: '2026-06-08T12:00:00.000Z', vendedor: 'Memo' };
const toqueEl = fecha => ({ tipo: 'toque', fecha, vendedor: 'Memo' });

test('SC1: el catalogo del canal del siguiente contacto es WhatsApp, Llamada y Correo', () => {
  assert.deepEqual(CANALES_SIGUIENTE_CONTACTO, ['WhatsApp', 'Llamada', 'Correo']);
});

test('SC2: siguienteContactoFuturo devuelve canales y fecha mientras la fecha no llega', () => {
  assert.deepEqual(
    siguienteContactoFuturo({ ...PROSPECTO, eventos: [SC_FUTURO] }, AHORA),
    { canales: ['WhatsApp'], fecha: '2026-06-15T15:00:00.000Z' }
  );
  assert.equal(siguienteContactoFuturo({ ...PROSPECTO, eventos: [SC_VENCIDO] }, AHORA), null);
  assert.equal(siguienteContactoFuturo(PROSPECTO, AHORA), null);
});

test('SC3: siguienteContactoVencido aparece pasada la fecha; un toque posterior lo cierra', () => {
  assert.deepEqual(
    siguienteContactoVencido({ ...PROSPECTO, eventos: [SC_VENCIDO] }, AHORA),
    { canales: ['Llamada'], fecha: '2026-06-09T15:00:00.000Z' }
  );
  assert.equal(siguienteContactoVencido({ ...PROSPECTO, eventos: [SC_FUTURO] }, AHORA), null);
  // un toque ANTERIOR a la fecha del compromiso no lo cierra: el compromiso sigue vivo
  assert.deepEqual(
    siguienteContactoVencido({ ...PROSPECTO, eventos: [SC_VENCIDO, toqueEl('2026-06-09T13:00:00.000Z')] }, AHORA),
    { canales: ['Llamada'], fecha: '2026-06-09T15:00:00.000Z' }
  );
  assert.equal(
    siguienteContactoVencido({ ...PROSPECTO, eventos: [SC_VENCIDO, toqueEl('2026-06-10T13:00:00.000Z')] }, AHORA),
    null
  );
});

test('SC4: manda el ultimo siguiente contacto REGISTRADO, aunque su fecha sea mas temprana', () => {
  const lejano = { tipo: 'siguiente_contacto', canales: ['Correo'], fecha_contacto: '2026-06-20T15:00:00.000Z', fecha: '2026-06-10T08:00:00.000Z', vendedor: 'Memo' };
  const reagendado = { tipo: 'siguiente_contacto', canales: ['WhatsApp'], fecha_contacto: '2026-06-13T15:00:00.000Z', fecha: '2026-06-10T12:00:00.000Z', vendedor: 'Memo' };
  assert.deepEqual(
    siguienteContactoFuturo({ ...PROSPECTO, eventos: [lejano, reagendado] }, AHORA),
    { canales: ['WhatsApp'], fecha: '2026-06-13T15:00:00.000Z' }
  );
  // el ultimo registrado ya vencio: el anterior, todavia futuro, no revive
  assert.deepEqual(
    siguienteContactoVencido({ ...PROSPECTO, eventos: [SC_FUTURO, { ...SC_VENCIDO, fecha: '2026-06-10T14:00:00.000Z' }] }, AHORA),
    { canales: ['Llamada'], fecha: '2026-06-09T15:00:00.000Z' }
  );
  assert.equal(
    siguienteContactoFuturo({ ...PROSPECTO, eventos: [SC_FUTURO, { ...SC_VENCIDO, fecha: '2026-06-10T14:00:00.000Z' }] }, AHORA),
    null
  );
});

test('SC5: la card activa ofrece registrar el siguiente contacto con varios canales y fecha', () => {
  const html = buildProspectoCardHtml(PROSPECTO);
  // grupo de chips multi, con nombre propio por tarjeta (varias cards a la vez)
  assert.match(html, /data-grupo="sc-canal-3" data-multi="1"/);
  assert.match(html, /id="pr-sc-fecha-3"/);
  assert.match(html, /type="date"/);
  assert.match(html, /registrarSiguienteContactoProspecto\(3\)/);
  for (const c of CANALES_SIGUIENTE_CONTACTO) assert.ok(html.includes(`>${c}<`), `falta canal ${c}`);
  const noUtil = buildProspectoCardHtml({ ...PROSPECTO, etapa: 'no_util' });
  assert.equal(noUtil.includes('registrarSiguienteContactoProspecto'), false);
  assert.equal(noUtil.includes('data-grupo="sc-canal-3"'), false);
});

test('SC6: la card muestra el chip del compromiso vivo (futuro o vencido) y nada sin compromiso', () => {
  const futuro = buildProspectoCardHtml({ ...PROSPECTO, eventos: [SC_FUTURO] }, undefined, AHORA);
  assert.match(futuro, /siguiente-contacto-badge/);
  assert.match(futuro, /WhatsApp/);
  assert.match(futuro, /15/);
  assert.match(futuro, /jun/);
  // vencido y sin cerrar sigue visible: es el pendiente del dia
  const vencido = buildProspectoCardHtml({ ...PROSPECTO, eventos: [SC_VENCIDO] }, undefined, AHORA);
  assert.match(vencido, /siguiente-contacto-badge/);
  // cerrado por un toque posterior: el chip desaparece
  const cerrado = buildProspectoCardHtml(
    { ...PROSPECTO, eventos: [SC_VENCIDO, toqueEl('2026-06-10T13:00:00.000Z')] }, undefined, AHORA
  );
  assert.equal(cerrado.includes('siguiente-contacto-badge'), false);
  assert.equal(buildProspectoCardHtml(PROSPECTO).includes('siguiente-contacto-badge'), false);
});

test('SC7: el item de cola con el compromiso vencido trae la instruccion del dia', () => {
  const html = buildColaProspectosHtml([{
    ...ITEM_COLA, siguienteContacto: { canales: ['WhatsApp'], fecha: '2026-08-31T15:00:00.000Z' },
  }]);
  assert.match(html, /siguiente-contacto-badge/);
  assert.match(html, /WhatsApp a Laura/);
  assert.match(html, /31/);
  // el toque sigue disponible: es lo que cierra el compromiso (no hay resultado)
  assert.match(html, /registrarToqueProspecto\(3\)/);
  const sin = buildColaProspectosHtml([ITEM_COLA]);
  assert.equal(sin.includes('siguiente-contacto-badge'), false);
});

test('SC8: la instruccion suma el evento del prospecto cuando la cola lo trae, escapado', () => {
  const html = buildColaProspectosHtml([{
    ...ITEM_COLA, siguienteContacto: { canales: ['Llamada'], fecha: '2026-08-31T15:00:00.000Z' },
    evento: 'Abastur 2026',
  }]);
  assert.match(html, /Llamada a Laura — Abastur 2026/);
  const xss = buildColaProspectosHtml([{
    ...ITEM_COLA, siguienteContacto: { canales: ['Llamada'], fecha: '2026-08-31T15:00:00.000Z' },
    evento: '<b>x</b>',
  }]);
  assert.equal(xss.includes('<b>x</b>'), false);
});

test('SC9: el historial nombra el evento del siguiente contacto con su canal y fecha', () => {
  const html = buildHistorialHtml({ ...PROSPECTO, eventos: [SC_FUTURO] });
  assert.match(html, /Siguiente contacto/);
  assert.match(html, /WhatsApp/);
  assert.match(html, /Memo/);
  const xss = buildHistorialHtml({ ...PROSPECTO, eventos: [{ ...SC_FUTURO, vendedor: '<b>Memo</b>' }] });
  assert.equal(xss.includes('<b>Memo</b>'), false);
});

// === Issue #270 (CONTEXT.md "Siguiente contacto"): el compromiso es multicanal.
// "Te escribo por WhatsApp y te mando el catalogo por correo" es UN compromiso
// con dos canales y una sola fecha; el orden es el que se marco.

test('SC10: la validacion exige canales no vacio de catalogo y fecha futura', () => {
  const ahora = new Date('2026-06-10T12:00:00.000Z');
  const futura = '2026-06-15T15:00:00.000Z';
  assert.equal(validarSiguienteContacto({ canales: ['WhatsApp', 'Correo'], fecha: futura }, ahora), null);
  for (const sc of [
    { canales: [], fecha: futura },
    { canales: ['Paloma mensajera'], fecha: futura },
    { canales: ['WhatsApp', 'Paloma mensajera'], fecha: futura },
    { canales: 'WhatsApp', fecha: futura },
    { canal: 'WhatsApp', fecha: futura },
    { canales: ['WhatsApp'] },
    { canales: ['WhatsApp'], fecha: 'no-es-fecha' },
    { canales: ['WhatsApp'], fecha: '2026-06-09T15:00:00.000Z' },
  ]) {
    assert.ok(validarSiguienteContacto(sc, ahora), `${JSON.stringify(sc)} debio rechazarse`);
  }
});

test('SC11: el evento guarda los canales en el orden en que se marcaron', () => {
  const ev = buildEventoSiguienteContacto(
    { canales: ['Correo', 'WhatsApp'], fecha: '2026-06-15T15:00:00.000Z' },
    'Memo', new Date('2026-06-10T12:00:00.000Z')
  );
  assert.equal(ev.tipo, 'siguiente_contacto');
  assert.deepEqual(ev.canales, ['Correo', 'WhatsApp']);
  assert.equal(ev.canal, undefined);
  assert.equal(ev.fecha_contacto, '2026-06-15T15:00:00.000Z');
  assert.equal(ev.fecha, '2026-06-10T12:00:00.000Z');
  assert.equal(ev.vendedor, 'Memo');
});

test('SC12: el chip de la tarjeta, la instruccion de la cola Hoy y el historial unen los canales con " + "', () => {
  const multi = { ...SC_FUTURO, canales: ['WhatsApp', 'Correo'] };
  assert.match(buildProspectoCardHtml({ ...PROSPECTO, eventos: [multi] }, undefined, AHORA), /WhatsApp \+ Correo/);
  assert.match(
    buildColaProspectosHtml([{
      ...ITEM_COLA, siguienteContacto: { canales: ['WhatsApp', 'Correo'], fecha: '2026-08-31T15:00:00.000Z' },
      evento: 'Abastur 2026',
    }]),
    /WhatsApp \+ Correo a Laura — Abastur 2026/
  );
  assert.match(
    buildHistorialHtml({ ...PROSPECTO, eventos: [multi] }),
    /Siguiente contacto: WhatsApp \+ Correo el/
  );
});

// === Issue #263 (spec #260, CONTEXT.md "Captura de expo"): paso 2, la
// calificacion. Catalogos de chips con CLAVES ESTABLES (la etiqueta humana solo
// vive en la UI), validacion, orden de `valora` y lectura en la tarjeta.

let ANIOS_OPERANDO, SUCURSALES, VALORA, etiquetaValora;
before(async () => {
  ({ ANIOS_OPERANDO, SUCURSALES, VALORA, etiquetaValora } = await import('../prospectos-logica.js'));
});

test('C1: los catalogos del paso 2 son cerrados y valora lleva claves estables', () => {
  assert.deepEqual(ANIOS_OPERANDO, ['Apertura', '1-5 años', '6-10 años', '+10 años']);
  assert.deepEqual(SUCURSALES, ['1 unidad', '2-5 unidades', '6-10 unidades', '+10 unidades']);
  assert.deepEqual(VALORA.map(v => v.clave), [
    'durabilidad', 'precio', 'estetica', 'no_se_rompe', 'resurtido',
    'variedad', 'logo', 'lavavajillas', 'fuego_horno', 'mexicano',
  ]);
  assert.equal(etiquetaValora('no_se_rompe'), 'No se rompe');
  assert.equal(etiquetaValora('fuego_horno'), 'Resiste fuego/horno');
  assert.equal(etiquetaValora('estetica'), 'Estética');
  // una clave que no existe se muestra tal cual, nunca "undefined"
  assert.equal(etiquetaValora('barato'), 'barato');
});

let validarCalificacion, buildCalificacion, calificacionVacia;
before(async () => {
  ({ validarCalificacion, buildCalificacion, calificacionVacia } = await import('../prospectos-logica.js'));
});

const CALIFICACION = {
  concepto: 'Cafetería de especialidad', tipo_clientes: 'Oficinistas',
  anios: '6-10 años', sucursales: '2-5 unidades', usa_peltre: true, proveedor_peltre: 'Cinsa',
  valora: ['no_se_rompe', 'precio'], otro_valora: 'Que sea apilable',
};

test('C2: la calificacion completa pasa y todo el paso 2 es opcional', () => {
  assert.equal(validarCalificacion(CALIFICACION), null);
  // el paso 2 se puede cerrar vacio: ausente, vacio o con los chips sin elegir
  assert.equal(validarCalificacion(undefined), null);
  assert.equal(validarCalificacion({}), null);
  assert.equal(validarCalificacion({ anios: '', sucursales: '', valora: [] }), null);
});

test('C3: un valor fuera del catalogo se rechaza con su mensaje', () => {
  // el catalogo anterior (#271) tambien se rechaza: no hay compatibilidad
  assert.match(validarCalificacion({ anios: '4-10' }), /años/i);
  assert.match(validarCalificacion({ sucursales: '3-5' }), /sucursales/i);
  assert.match(validarCalificacion({ valora: ['durabilidad', 'barato'] }), /importante/i);
  assert.match(validarCalificacion({ valora: 'durabilidad' }), /importante/i);
  assert.match(validarCalificacion({ usa_peltre: 'quiza' }), /peltre/i);
  assert.match(validarCalificacion('mucho'), /calificación/i);
});

test('C4: buildCalificacion conserva el orden de valora y suelta lo que viene vacio', () => {
  assert.deepEqual(buildCalificacion(CALIFICACION), CALIFICACION);
  // el orden es el que marco el vendedor, no el del catalogo
  assert.deepEqual(
    buildCalificacion({ valora: ['mexicano', 'durabilidad', 'logo'] }).valora,
    ['mexicano', 'durabilidad', 'logo']
  );
  // los textos se recortan y los vacios no se guardan
  assert.deepEqual(buildCalificacion({ concepto: '  Fonda  ', tipo_clientes: '   ', valora: [] }), { concepto: 'Fonda' });
  assert.deepEqual(buildCalificacion({}), {});
  assert.deepEqual(buildCalificacion({ usa_peltre: false }), { usa_peltre: false });
});

test('C5: "Calificacion pendiente" es la calificacion ausente o sin ningun valor', () => {
  assert.equal(calificacionVacia(undefined), true);
  assert.equal(calificacionVacia({}), true);
  assert.equal(calificacionVacia({ concepto: '', valora: [] }), true);
  assert.equal(calificacionVacia({ valora: ['precio'] }), false);
  assert.equal(calificacionVacia({ usa_peltre: false }), false);
  assert.equal(calificacionVacia(CALIFICACION), false);
});

let buildCalificacionChipsHtml;
before(async () => {
  ({ buildCalificacionChipsHtml } = await import('../prospectos-logica.js'));
});

test('C6: la calificacion se lee en la tarjeta como chips en el orden en que se marco', () => {
  const html = buildCalificacionChipsHtml(CALIFICACION);
  assert.match(html, /6-10 años/);
  assert.match(html, /2-5 unidades/);
  assert.match(html, /Ya usa peltre: Cinsa/);
  // la etiqueta humana solo vive aqui: la clave estable no se le muestra al vendedor
  assert.equal(html.includes('no_se_rompe'), false);
  assert.ok(html.indexOf('No se rompe') < html.indexOf('Precio'), 'valora conserva el orden capturado');
  assert.match(html, /Que sea apilable/);
  assert.match(html, /Cafetería de especialidad/);
  assert.match(html, /Oficinistas/);
  // el chip pinta la etiqueta guardada tal cual, sin componer texto (#271)
  assert.match(buildCalificacionChipsHtml({ sucursales: '1 unidad' }), />1 unidad</);
  assert.match(buildCalificacionChipsHtml({ anios: 'Apertura' }), />Apertura</);
  assert.match(buildCalificacionChipsHtml({ usa_peltre: false }), /No usa peltre/);
  assert.equal(buildCalificacionChipsHtml({}), '');
  // lo que teclea el vendedor sale escapado
  assert.equal(buildCalificacionChipsHtml({ proveedor_peltre: '<b>x</b>', usa_peltre: true }).includes('<b>x</b>'), false);
});

test('C7: la tarjeta del prospecto de feria avisa "Calificacion pendiente" hasta que hay un valor', () => {
  const pendiente = buildProspectoCardHtml(PROSPECTO_EXPO, null, new Date(), { ligas: LIGAS });
  assert.match(pendiente, /Calificación pendiente/);
  const calificado = buildProspectoCardHtml(
    { ...PROSPECTO_EXPO, data: { ...PROSPECTO_EXPO.data, calificacion: CALIFICACION } },
    null, new Date(), { ligas: LIGAS }
  );
  assert.equal(calificado.includes('Calificación pendiente'), false);
  assert.match(calificado, /Ya usa peltre: Cinsa/);
  // un prospecto que no vino de una feria no tiene paso 2 que reclamar
  assert.equal(buildProspectoCardHtml(PROSPECTO).includes('Calificación pendiente'), false);
});

let buildGrupoChipsHtml, buildCalificacionCamposHtml, buildMicHtml;
before(async () => {
  ({ buildGrupoChipsHtml, buildCalificacionCamposHtml, buildMicHtml } = await import('../prospectos-logica.js'));
});

test('C8: un grupo de chips guarda su seleccion en el DOM, y el multi ademas el orden', () => {
  const uno = buildGrupoChipsHtml('anios', ANIOS_OPERANDO, '6-10 años');
  assert.match(uno, /data-grupo="anios"/);
  assert.match(uno, /data-valor="6-10 años" data-orden="1" class="chip chip-activo"|class="chip chip-activo"[^>]*data-valor="6-10 años"/);
  assert.equal(uno.includes('onclick'), false);
  assert.equal(uno.includes('data-multi'), false);

  const multi = buildGrupoChipsHtml('valora', VALORA, ['precio', 'durabilidad'], true);
  assert.match(multi, /data-multi="1"/);
  // el orden capturado viaja en el DOM para poder releerlo al guardar
  assert.match(multi, /data-valor="precio" data-orden="1"/);
  assert.match(multi, /data-valor="durabilidad" data-orden="2"/);
  assert.equal(/data-valor="logo"[^>]*chip-activo/.test(multi), false);
  // la etiqueta humana se pinta, la clave estable es la que se guarda
  assert.match(multi, />Resiste fuego\/horno</);
});

test('C9: los campos de la calificacion se comparten entre la pantalla de captura y la edicion, con microfono en los textos libres', () => {
  const html = buildCalificacionCamposHtml('ex', CALIFICACION);
  assert.match(html, /id="ex-calificacion"/);
  assert.match(html, /id="ex-concepto"/);
  assert.match(html, /id="ex-tipo_clientes"/);
  assert.match(html, /id="ex-proveedor_peltre"/);
  assert.match(html, /id="ex-otro_valora"/);
  // prellenado con lo capturado
  assert.match(html, /Cafetería de especialidad/);
  assert.match(html, /value="Cinsa"/);
  assert.match(html, /data-grupo="anios"/);
  assert.match(html, /data-grupo="sucursales"/);
  assert.match(html, /data-grupo="usa_peltre"/);
  assert.match(html, /data-grupo="valora"/);
  // el microfono va SOLO en los campos de texto largo, no en los chips ni en "Otro"
  for (const campo of ['concepto', 'tipo_clientes', 'proveedor_peltre']) {
    assert.match(html, new RegExp(`data-mic="ex-${campo}"`), `falta microfono en ${campo}`);
  }
  assert.equal(html.includes('data-mic="ex-otro_valora"'), false);
  assert.equal(html.includes('onclick'), false);
  // otro prefijo (la edicion de la tarjeta) no colisiona con la pantalla de expo
  assert.match(buildCalificacionCamposHtml('ed2-7', {}), /id="ed2-7-concepto"/);
  assert.match(buildMicHtml('ed2-7-notas'), /data-mic="ed2-7-notas"/);
});

// Orden acordado de la calificacion (issue #267, spec #266): los chips primero
// -- se contestan de un toque con el prospecto enfrente -- y los textos libres
// despues. Lo comparten la pantalla de captura y la edicion inline de la
// tarjeta, asi que el orden se verifica una sola vez, aqui.
test('C9b: los campos de calificacion salen en el orden acordado: chips antes que texto libre', () => {
  const html = buildCalificacionCamposHtml('ex', {});
  const posicion = marca => {
    const i = html.indexOf(marca);
    assert.notEqual(i, -1, `falta ${marca}`);
    return i;
  };
  const orden = [
    'data-grupo="anios"', 'data-grupo="sucursales"', 'data-grupo="usa_peltre"',
    'id="ex-proveedor_peltre"', 'data-grupo="valora"', 'id="ex-otro_valora"',
    'id="ex-concepto"', 'id="ex-tipo_clientes"',
  ].map(posicion);
  assert.deepEqual(orden, [...orden].sort((a, b) => a - b), 'el orden de los campos cambio');
});

test('C10: la edicion inline de la tarjeta incorpora el paso 2 y dicta las notas', () => {
  const html = buildEdicionProspectoFormHtml({
    id: 3, nombre: 'Laura', ciudad: 'Puebla',
    data: { notas: 'pidio catalogo', calificacion: { anios: '1-5 años', valora: ['logo'] } },
  });
  assert.match(html, /id="ed2-3-calificacion"/);
  assert.match(html, /data-mic="ed-notas-3"/);
  // lo ya capturado llega prellenado para corregirlo
  assert.match(html, /data-valor="1-5 años" data-orden="1" class="chip chip-activo"|class="chip chip-activo"[^>]*data-valor="1-5 años"/);
  assert.match(html, /data-valor="logo" data-orden="1"/);
});

// === Normalizacion de textos de toda captura de prospecto (issue #269,
// CONTEXT.md "Prospecto", decision 2026-08-25) ===
// Un solo punto: lo que se teclea al capturar o al editar se guarda con las
// mayusculas corregidas y el correo en minusculas. La regla de mayusculas es la
// de capitalizarCampo (#235), que aqui NO se redefine.

test('NT1: normalizarTextosProspecto titula nombre, empresa y ciudad en mayusculas y baja el correo', () => {
  const datos = normalizarTextosProspecto({
    nombre: 'MARIANA LÓPEZ',
    ciudad: 'SAN LUIS POTOSÍ',
    data: { empresa: 'HOTEL LA JOYA', correo: '  Mariana.Lopez @GMAIL.COM ' },
  });
  assert.equal(datos.nombre, 'Mariana López');
  assert.equal(datos.ciudad, 'San Luis Potosí');
  // "la" es particula: la regla de #235 la deja en minuscula dentro del campo.
  assert.equal(datos.data.empresa, 'Hotel la Joya');
  assert.equal(datos.data.correo, 'mariana.lopez@gmail.com');
});

test('NT2: normalizarTextosProspecto respeta una mezcla ya escrita y las siglas', () => {
  const datos = normalizarTextosProspecto({
    nombre: "McDonald's", ciudad: 'CDMX', data: { empresa: 'Grupo GNP' },
  });
  assert.equal(datos.nombre, "McDonald's");
  assert.equal(datos.ciudad, 'CDMX');
  assert.equal(datos.data.empresa, 'Grupo GNP');
});

test('NT3: normalizarTextosProspecto solo toca las llaves presentes y deja el resto intacto', () => {
  const datos = normalizarTextosProspecto({
    ciudad: 'PUEBLA',
    data: { notas: 'PIDIO CATALOGO', temperatura: 4, piezas_estimadas: '+550' },
  });
  assert.equal(datos.ciudad, 'Puebla');
  assert.equal('nombre' in datos, false);
  // las notas son texto del vendedor, no un campo de identidad: no se tocan
  assert.equal(datos.data.notas, 'PIDIO CATALOGO');
  assert.equal(datos.data.temperatura, 4);
  assert.equal(datos.data.piezas_estimadas, '+550');
});

test('NT4: normalizarTextosProspecto no inventa data cuando la captura no trae opcionales', () => {
  const datos = normalizarTextosProspecto({ nombre: 'LAURA', ciudad: 'PUEBLA' });
  assert.equal(datos.nombre, 'Laura');
  assert.equal('data' in datos, false);
});

test('NT5: la tarjeta muestra el correo capturado, y no deja rastro cuando no hay', () => {
  const base = {
    id: 4, nombre: 'Mariana López', ciudad: 'Puebla', canal: 'Feria/Expo',
    celular: '+52 5512345678', vendedor: 'Memo', fecha: '2026-08-25T10:00:00Z',
    etapa: 'por_cotizar',
  };
  const con = buildProspectoCardHtml({ ...base, data: { correo: 'mariana.lopez@gmail.com' } }, null);
  // a la vista, no solo prellenado en el formulario de edicion que la tarjeta trae
  assert.match(con, /<div class="cot-card-meta">mariana\.lopez@gmail\.com<\/div>/);
  // sin correo no queda una linea vacia en su lugar
  const sin = buildProspectoCardHtml({ ...base, data: {} }, null);
  assert.equal(sin.includes('<div class="cot-card-meta"></div>'), false);
  assert.equal(sin.includes('mariana.lopez@gmail.com'), false);
});
