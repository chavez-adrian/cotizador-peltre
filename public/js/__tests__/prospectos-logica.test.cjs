'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let CANALES, PIEZAS_ESTIMADAS, validarProspectoBody, buildProspectoPayload,
  buildProspectoCardHtml, buildProspectoExistenteHtml;
before(async () => {
  ({ CANALES, PIEZAS_ESTIMADAS, validarProspectoBody, buildProspectoPayload,
    buildProspectoCardHtml, buildProspectoExistenteHtml } = await import('../prospectos-logica.js'));
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
});
