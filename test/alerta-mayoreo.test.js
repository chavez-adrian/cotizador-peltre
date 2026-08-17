import { test } from 'node:test';
import assert from 'node:assert/strict';

import { destinatariosAlertaMayoreo, mensajeAlertaMayoreo, vcardDeProspecto } from '../lib/alerta-mayoreo.js';

// Nucleo puro de la alerta por correo de captura publica de mayoreo (issue #163,
// ADR-0012; CONTEXT.md "Captura publica": "Cada captura publica avisa por correo a
// quienes tienen el permiso de asignacion"). Sin red, sin IO -- solo el armado de
// destinatarios y del mensaje. Mismo patron que test/sync-operam.test.js.

test('destinatariosAlertaMayoreo: incluye vendedores con permiso de asignacion y admins con correo', () => {
  const vendedores = [
    { id: 1, name: 'Admin Uno', role: 'admin', email: 'admin@pppeltre.mx' },
    { id: 2, name: 'Vendedor Con Permiso', role: 'vendedor', puedeAsignar: true, email: 'conpermiso@pppeltre.mx' },
    { id: 3, name: 'Vendedor Sin Permiso', role: 'vendedor', email: 'sinpermiso@pppeltre.mx' },
  ];
  const destinatarios = destinatariosAlertaMayoreo(vendedores);
  assert.deepEqual(destinatarios.sort(), ['admin@pppeltre.mx', 'conpermiso@pppeltre.mx']);
});

test('destinatariosAlertaMayoreo: deduplica el mismo correo (case-insensitive), un admin que ademas tiene el permiso', () => {
  const vendedores = [
    { id: 1, name: 'Admin y Asigna', role: 'admin', email: 'Admin@pppeltre.mx' },
    { id: 2, name: 'Admin y Asigna Otra Vez', role: 'admin', email: 'admin@PPPELTRE.MX' },
  ];
  const destinatarios = destinatariosAlertaMayoreo(vendedores);
  assert.deepEqual(destinatarios, ['Admin@pppeltre.mx']);
});

test('destinatariosAlertaMayoreo: sin destinatarios validos devuelve arreglo vacio', () => {
  const vendedores = [
    { id: 1, name: 'Vendedor Sin Permiso', role: 'vendedor', email: 'sinpermiso@pppeltre.mx' },
    { id: 2, name: 'Vendedor Con Permiso Sin Correo', role: 'vendedor', puedeAsignar: true },
  ];
  assert.deepEqual(destinatariosAlertaMayoreo(vendedores), []);
});

test('destinatariosAlertaMayoreo: sin admin con correo, cae al fallback ALERTA_ADMIN_EMAIL', () => {
  const vendedores = [
    { id: 1, name: 'Admin Sin Correo', role: 'admin' },
    { id: 2, name: 'Vendedor Con Permiso', role: 'vendedor', puedeAsignar: true, email: 'conpermiso@pppeltre.mx' },
  ];
  const destinatarios = destinatariosAlertaMayoreo(vendedores, { adminEmailFallback: 'fallback@pppeltre.mx' });
  assert.deepEqual(destinatarios.sort(), ['conpermiso@pppeltre.mx', 'fallback@pppeltre.mx']);
});

// --- mensajeAlertaMayoreo: asunto y cuerpo con los datos del prospecto ---

test('mensajeAlertaMayoreo: arma asunto y cuerpo con nombre, celular, ciudad, tipo de proyecto y cantidad', () => {
  const vendedores = [
    { id: 1, name: 'Vendedor Con Permiso', role: 'vendedor', puedeAsignar: true, email: 'conpermiso@pppeltre.mx' },
  ];
  const prospecto = {
    nombre: 'Juan Perez', celular: '+525512345678', ciudad: 'Ixtapaluca',
    tipoProyecto: 'Restaurantes', cantidadEstimada: '+350',
  };
  const mensaje = mensajeAlertaMayoreo(prospecto, vendedores);
  assert.deepEqual(mensaje.to, ['conpermiso@pppeltre.mx']);
  assert.equal(mensaje.subject, 'Nuevo prospecto de mayoreo');
  assert.match(mensaje.text, /Juan Perez/);
  assert.match(mensaje.text, /\+525512345678/);
  assert.match(mensaje.text, /Ixtapaluca/);
  assert.match(mensaje.text, /Restaurantes/);
  assert.match(mensaje.text, /\+350/);
});

test('mensajeAlertaMayoreo: sin destinatarios validos devuelve null (no arma mensaje)', () => {
  const vendedores = [{ id: 1, name: 'Vendedor Sin Permiso', role: 'vendedor' }];
  const prospecto = { nombre: 'Juan Perez', celular: '+525512345678', ciudad: 'Ixtapaluca' };
  assert.equal(mensajeAlertaMayoreo(prospecto, vendedores), null);
});

// --- #165: informacion completa, celular con link de WhatsApp, vCard adjunta ---

const VENDEDORES_165 = [
  { id: 1, name: 'Vendedor Con Permiso', role: 'vendedor', puedeAsignar: true, email: 'conpermiso@pppeltre.mx' },
];

const PROSPECTO_COMPLETO = {
  nombre: 'Juan Perez', celular: '+525512345678', ciudad: 'Ixtapaluca', cp: '56530',
  tipoProyecto: 'Otro', tipoProyectoOtro: 'Panaderia', cantidadEstimada: '+350',
  empresa: 'Hotel Azul', cargo: 'Compras', correo: 'juan@hotelazul.mx',
  cuando: 'En los próximos 3 meses', web: '@hotelazul',
  promos: { acepta: true, fecha: '2026-08-17T10:00:00.000Z' },
};

const FRAGMENTOS_PROSPECTO_COMPLETO = [
  'Juan Perez', '+525512345678', 'Ixtapaluca', 'CP 56530',
  'Otro (Panaderia)', '+350', 'Hotel Azul', 'Compras', 'juan@hotelazul.mx',
  'En los próximos 3 meses', '@hotelazul', '2026-08-17T10:00:00.000Z',
];

test('mensajeAlertaMayoreo: el texto plano trae TODOS los campos capturados', () => {
  const mensaje = mensajeAlertaMayoreo(PROSPECTO_COMPLETO, VENDEDORES_165);
  for (const fragmento of FRAGMENTOS_PROSPECTO_COMPLETO) {
    assert.ok(mensaje.text.includes(fragmento), `texto sin "${fragmento}"`);
  }
});

test('mensajeAlertaMayoreo: el html trae los mismos campos que el texto plano (fallback equivalente)', () => {
  const mensaje = mensajeAlertaMayoreo(PROSPECTO_COMPLETO, VENDEDORES_165);
  for (const fragmento of FRAGMENTOS_PROSPECTO_COMPLETO) {
    assert.ok(mensaje.html.includes(fragmento), `html sin "${fragmento}"`);
  }
});

test('mensajeAlertaMayoreo: los campos opcionales vacios NO se imprimen', () => {
  const prospecto = {
    nombre: 'Juan Perez', celular: '+525512345678', ciudad: 'Ixtapaluca',
    tipoProyecto: 'Restaurantes', cantidadEstimada: '+350',
  };
  const mensaje = mensajeAlertaMayoreo(prospecto, VENDEDORES_165);
  for (const etiqueta of ['Empresa', 'Cargo', 'Correo', 'Para cuando', 'Sitio web', 'Promociones', 'CP ']) {
    assert.ok(!mensaje.text.includes(etiqueta), `no debia imprimir "${etiqueta}"`);
  }
});

test('mensajeAlertaMayoreo: promos solo se imprime cuando acepto (con fecha); si no acepto, se omite', () => {
  const base = { nombre: 'Juan Perez', celular: '+525512345678', ciudad: 'Ixtapaluca', tipoProyecto: 'Restaurantes', cantidadEstimada: '+350' };
  const rechazo = mensajeAlertaMayoreo({ ...base, promos: { acepta: false } }, VENDEDORES_165);
  assert.ok(!rechazo.text.includes('Promociones'));
  const aceptado = mensajeAlertaMayoreo({ ...base, promos: { acepta: true, fecha: '2026-08-17' } }, VENDEDORES_165);
  assert.match(aceptado.text, /Promociones: Si \(2026-08-17\)/);
});

test('mensajeAlertaMayoreo: el html envuelve el celular en un link de wa.me (un clic abre WhatsApp)', () => {
  const mensaje = mensajeAlertaMayoreo(PROSPECTO_COMPLETO, VENDEDORES_165);
  assert.match(mensaje.html, /<a href="https:\/\/wa\.me\/525512345678">\+525512345678<\/a>/);
});

test('mensajeAlertaMayoreo: wa.me correcto tambien para un celular no-MX', () => {
  const prospecto = { ...PROSPECTO_COMPLETO, celular: '+1 (555) 123-4567' };
  const mensaje = mensajeAlertaMayoreo(prospecto, VENDEDORES_165);
  assert.match(mensaje.html, /https:\/\/wa\.me\/15551234567/);
});

test('mensajeAlertaMayoreo: el html escapa datos de usuario (sin XSS via nombre/empresa)', () => {
  const prospecto = { ...PROSPECTO_COMPLETO, nombre: '<script>alert(1)</script>' };
  const mensaje = mensajeAlertaMayoreo(prospecto, VENDEDORES_165);
  assert.ok(!mensaje.html.includes('<script>alert(1)</script>'));
  assert.ok(mensaje.html.includes('&lt;script&gt;'));
});

test('vcardDeProspecto: arma un vcf valido con FN, TEL, EMAIL y ORG', () => {
  const vcf = vcardDeProspecto(PROSPECTO_COMPLETO);
  assert.match(vcf, /^BEGIN:VCARD/);
  assert.match(vcf, /END:VCARD$/);
  assert.match(vcf, /FN:Juan Perez/);
  assert.match(vcf, /TEL;TYPE=CELL:\+525512345678/);
  assert.match(vcf, /EMAIL:juan@hotelazul\.mx/);
  assert.match(vcf, /ORG:Hotel Azul/);
});

test('vcardDeProspecto: sin correo ni empresa, omite EMAIL y ORG pero sigue siendo un vcf valido', () => {
  const vcf = vcardDeProspecto({ nombre: 'Juan Perez', celular: '+525512345678' });
  assert.match(vcf, /BEGIN:VCARD/);
  assert.match(vcf, /FN:Juan Perez/);
  assert.match(vcf, /TEL;TYPE=CELL:\+525512345678/);
  assert.ok(!vcf.includes('EMAIL:'));
  assert.ok(!vcf.includes('ORG:'));
  assert.match(vcf, /END:VCARD/);
});
