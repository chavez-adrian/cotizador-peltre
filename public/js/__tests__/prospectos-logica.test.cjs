'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let CANALES, PIEZAS_ESTIMADAS, OPCIONALES, validarProspectoBody, buildProspectoPayload,
  buildProspectoCardHtml, buildProspectoExistenteHtml, MOTIVOS_NO_UTIL, siguienteEtapa,
  validarTransicion, buildWaLink, buildHistorialHtml, contarMotivosNoUtil, buildMotivosNoUtilHtml;
before(async () => {
  ({ CANALES, PIEZAS_ESTIMADAS, OPCIONALES, validarProspectoBody, buildProspectoPayload,
    buildProspectoCardHtml, buildProspectoExistenteHtml, MOTIVOS_NO_UTIL, siguienteEtapa,
    validarTransicion, buildWaLink, buildHistorialHtml, contarMotivosNoUtil,
    buildMotivosNoUtilHtml } = await import('../prospectos-logica.js'));
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
  canal: 'WhatsApp', etapa: 'nuevo', data: {},
};

test('P8: buildProspectoCardHtml muestra nombre, etapa Nuevo, vendedor, ciudad, canal y celular', () => {
  const html = buildProspectoCardHtml(PROSPECTO);
  assert.match(html, /Laura/);
  assert.match(html, /Nuevo/);
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

// === Issue #43: etapas, toques, No util e historial ===

test('T1: MOTIVOS_NO_UTIL es el catalogo cerrado canonico de CONTEXT.md', () => {
  assert.deepEqual(MOTIVOS_NO_UTIL, ['menudeo', 'fuera de zona', 'sin presupuesto', 'spam', 'sin respuesta']);
});

test('T2: siguienteEtapa avanza un paso y se detiene en calificado', () => {
  assert.equal(siguienteEtapa('nuevo'), 'contactado');
  assert.equal(siguienteEtapa('contactado'), 'calificado');
  assert.equal(siguienteEtapa('calificado'), null);
  assert.equal(siguienteEtapa('cotizado'), null);
  assert.equal(siguienteEtapa('no_util'), null);
});

test('T3: validarTransicion acepta los avances manuales validos', () => {
  assert.equal(validarTransicion('nuevo', 'contactado'), null);
  assert.equal(validarTransicion('contactado', 'calificado'), null);
});

test('T4: validarTransicion rechaza retrocesos, saltos y cotizado manual', () => {
  assert.ok(validarTransicion('contactado', 'nuevo'));
  assert.ok(validarTransicion('calificado', 'contactado'));
  assert.ok(validarTransicion('nuevo', 'calificado'));
  assert.ok(validarTransicion('nuevo', 'nuevo'));
  assert.ok(validarTransicion('calificado', 'cotizado'));
  assert.ok(validarTransicion('nuevo', 'inventada'));
  assert.ok(validarTransicion('nuevo', undefined));
});

test('T5: validarTransicion permite No util desde cualquier etapa con motivo del catalogo', () => {
  for (const etapa of ['nuevo', 'contactado', 'calificado', 'cotizado']) {
    assert.equal(validarTransicion(etapa, 'no_util', 'spam'), null);
  }
});

test('T6: validarTransicion rechaza No util sin motivo o con motivo fuera de catalogo', () => {
  assert.match(validarTransicion('nuevo', 'no_util'), /motivo/i);
  assert.match(validarTransicion('nuevo', 'no_util', ''), /motivo/i);
  assert.match(validarTransicion('nuevo', 'no_util', 'no me cayo bien'), /motivo/i);
  assert.ok(validarTransicion('no_util', 'no_util', 'spam'));
  assert.ok(validarTransicion('no_util', 'contactado'));
});

test('T7: buildWaLink arma el link wa.me con solo digitos del celular', () => {
  assert.equal(buildWaLink('+52 55 1234 5678'), 'https://wa.me/525512345678');
  assert.equal(buildWaLink('+1 (555) 123-4567'), 'https://wa.me/15551234567');
  assert.equal(buildWaLink(''), null);
  assert.equal(buildWaLink(null), null);
});

const EVENTOS = [
  { tipo: 'etapa', de: 'nuevo', a: 'contactado', fecha: '2026-06-11T10:00:00.000Z', vendedor: 'Memo' },
  { tipo: 'toque', fecha: '2026-06-12T10:00:00.000Z', vendedor: 'Ana' },
  { tipo: 'no_util', motivo: 'sin respuesta', fecha: '2026-06-13T10:00:00.000Z', vendedor: 'Memo' },
];

test('T8: buildHistorialHtml lista captura y eventos en orden cronologico', () => {
  const html = buildHistorialHtml({ ...PROSPECTO, eventos: EVENTOS });
  const iCaptura = html.indexOf('Capturado');
  const iEtapa = html.indexOf('Contactado');
  const iToque = html.indexOf('Toque');
  const iSalida = html.indexOf('sin respuesta');
  assert.ok(iCaptura >= 0 && iEtapa > iCaptura && iToque > iEtapa && iSalida > iToque);
  assert.match(html, /Memo/);
  assert.match(html, /Ana/);
});

test('T9: buildHistorialHtml ordena por fecha aunque los eventos lleguen desordenados', () => {
  const html = buildHistorialHtml({ ...PROSPECTO, eventos: [EVENTOS[2], EVENTOS[0], EVENTOS[1]] });
  const iEtapa = html.indexOf('Contactado');
  const iToque = html.indexOf('Toque');
  const iSalida = html.indexOf('sin respuesta');
  assert.ok(iEtapa >= 0 && iToque > iEtapa && iSalida > iToque);
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

test('T11: la card de un prospecto activo trae wa.me, avanzar etapa, toque, No util e historial', () => {
  const html = buildProspectoCardHtml(PROSPECTO);
  assert.match(html, /href="https:\/\/wa\.me\/525512345678"/);
  assert.match(html, /avanzarEtapaProspecto\(3, 'contactado'\)/);
  assert.match(html, /Contactado/);
  assert.match(html, /registrarToqueProspecto\(3\)/);
  assert.match(html, /marcarNoUtilProspecto\(3\)/);
  assert.match(html, /pr-motivo-3/);
  assert.match(html, /sin presupuesto/);
  assert.match(html, /toggleHistorialProspecto\(3\)/);
  assert.match(html, /pr-historial-3/);
});

test('T12: la card de contactado avanza a calificado y la de calificado ya no ofrece avance manual', () => {
  const contactado = buildProspectoCardHtml({ ...PROSPECTO, etapa: 'contactado' });
  assert.match(contactado, /avanzarEtapaProspecto\(3, 'calificado'\)/);
  const calificado = buildProspectoCardHtml({ ...PROSPECTO, etapa: 'calificado' });
  assert.equal(calificado.includes('avanzarEtapaProspecto'), false);
  assert.match(calificado, /registrarToqueProspecto\(3\)/);
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
