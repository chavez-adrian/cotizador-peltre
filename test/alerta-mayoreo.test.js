import { test } from 'node:test';
import assert from 'node:assert/strict';

import { destinatariosAlertaMayoreo, mensajeAlertaMayoreo } from '../lib/alerta-mayoreo.js';

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
