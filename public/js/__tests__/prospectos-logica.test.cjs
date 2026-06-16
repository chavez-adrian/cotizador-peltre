'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let CANALES, PIEZAS_ESTIMADAS, OPCIONALES, validarProspectoBody, buildProspectoPayload,
  buildProspectoCardHtml, buildProspectoExistenteHtml, MOTIVOS_NO_UTIL, siguienteEtapa,
  validarTransicion, buildWaLink, buildHistorialHtml, contarMotivosNoUtil, buildMotivosNoUtilHtml,
  buildEsperaBadgeHtml, buildColaProspectosHtml, necesitaCanal, validarCanalCotizacion,
  buildCanalModalHtml, reunionFutura, reunionPendienteResultado, buildMotivoNoUtilModalHtml,
  validarEdicionProspecto, buildEdicionProspectoDatos, buildEdicionProspectoFormHtml,
  contarPendientesProspectos;
before(async () => {
  ({ CANALES, PIEZAS_ESTIMADAS, OPCIONALES, validarProspectoBody, buildProspectoPayload,
    buildProspectoCardHtml, buildProspectoExistenteHtml, MOTIVOS_NO_UTIL, siguienteEtapa,
    validarTransicion, buildWaLink, buildHistorialHtml, contarMotivosNoUtil,
    buildMotivosNoUtilHtml, buildEsperaBadgeHtml, buildColaProspectosHtml,
    necesitaCanal, validarCanalCotizacion, buildCanalModalHtml,
    reunionFutura, reunionPendienteResultado, buildMotivoNoUtilModalHtml,
    validarEdicionProspecto, buildEdicionProspectoDatos, buildEdicionProspectoFormHtml,
    contarPendientesProspectos } = await import('../prospectos-logica.js'));
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

test('P3: validarProspectoBody acepta captura completa con celular con codigo de pais', () => {
  assert.equal(validarProspectoBody({
    celular: '+52 5512345678', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp',
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
    'Correo', 'Referido', 'Bazar Sábado', 'Feria/Expo',
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
