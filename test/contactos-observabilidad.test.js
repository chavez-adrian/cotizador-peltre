import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clasificarError, siguienteEstado, debeAvisar, mensajeAviso, estadoVacio, UMBRAL_AVISO_MS,
} from '../lib/contactos-observabilidad.js';

// Nucleo puro de la observabilidad de los barridos de sincronizacion de
// contactos a Google (issue #230). Sin red, sin Neon, sin SMTP: solo objetos
// literales y aserciones sobre lo que decide, mismo criterio que
// contactos-logica.test.js.

// --- clasificarError ---

test('clasificarError: un 401/403 de Google People es autorizacion', () => {
  assert.equal(clasificarError('Google People 401: {"error":{}}'), 'autorizacion');
  assert.equal(clasificarError('Google People 403: {"error":{}}'), 'autorizacion');
});

test('clasificarError: un token refresh fallido (autorizacion revocada) es autorizacion', () => {
  assert.equal(clasificarError('Google token refresh 400: {"error":"invalid_grant"}'), 'autorizacion');
});

test('clasificarError: un fallo de red es red', () => {
  assert.equal(clasificarError('fetch failed'), 'red');
  assert.equal(clasificarError('getaddrinfo ENOTFOUND people.googleapis.com'), 'red');
});

test('clasificarError: un 400 de payload malformado (no autorizacion, no red) es datos', () => {
  assert.equal(clasificarError('Google People 400: {"error":{"message":"names is a singleton"}}'), 'datos');
});

test('clasificarError: un motivo irreconocible cae a otro, nunca truena', () => {
  assert.equal(clasificarError('algo raro sin patron conocido'), 'otro');
  assert.equal(clasificarError(undefined), 'otro');
});

// clasificarError es la MISMA funcion para cualquier barrido (issue #257: "Evita
// duplicar logica entre barridos"). El sondeo de pedidos de Shopify
// (lib/shopify-pedidos.js) reporta sus fallos como "Shopify 401: ..." o el
// mensaje nativo de fetch, y ya caen en las mismas categorias sin cambiar nada
// aqui.
test('clasificarError: aplica igual al barrido de pedidos de Shopify (token revocado -> autorizacion, fallo de red -> red)', () => {
  assert.equal(clasificarError('Shopify 401: {"errors":"..."}'), 'autorizacion');
  assert.equal(clasificarError('fetch failed'), 'red');
});

// --- siguienteEstado ---

test('siguienteEstado: una pasada sin errores actualiza ultimaCorrida y ultimaCorridaExitosa', () => {
  const ahora = new Date('2026-08-21T12:00:00Z');
  const resumen = { omitido: null, creados: 2, actualizados: 1, inactivados: 0, errores: [] };
  const estado = siguienteEstado(null, resumen, ahora);
  assert.equal(estado.ultimaCorrida, ahora.toISOString());
  assert.equal(estado.ultimaCorridaExitosa, ahora.toISOString());
  assert.equal(estado.creados, 2);
  assert.equal(estado.actualizados, 1);
  assert.equal(estado.errores.length, 0);
});

test('siguienteEstado: una pasada con errores mueve ultimaCorrida pero NO ultimaCorridaExitosa', () => {
  const previo = { ultimaCorrida: '2026-08-20T00:00:00.000Z', ultimaCorridaExitosa: '2026-08-20T00:00:00.000Z', creados: 0, actualizados: 0, inactivados: 0, errores: [], ultimoAviso: null };
  const ahora = new Date('2026-08-21T12:00:00Z');
  const resumen = { omitido: null, creados: 0, actualizados: 0, inactivados: 0, errores: [{ celular10: '5512345678', motivo: 'Google People 401: expirado' }] };
  const estado = siguienteEstado(previo, resumen, ahora);
  assert.equal(estado.ultimaCorrida, ahora.toISOString());
  assert.equal(estado.ultimaCorridaExitosa, previo.ultimaCorridaExitosa, 'la ultima EXITOSA no avanza si esta pasada tuvo errores');
  assert.equal(estado.errores.length, 1);
  assert.equal(estado.errores[0].categoria, 'autorizacion');
});

test('siguienteEstado: los errores se clasifican al persistirse, para que el panel distinga autorizacion de datos', () => {
  const ahora = new Date('2026-08-21T12:00:00Z');
  const resumen = {
    omitido: null, creados: 0, actualizados: 0, inactivados: 0,
    errores: [
      { celular10: '1', motivo: 'Google People 401: expirado' },
      { celular10: '2', motivo: 'Google People 400: names is a singleton' },
    ],
  };
  const estado = siguienteEstado(null, resumen, ahora);
  assert.deepEqual(estado.errores.map(e => e.categoria), ['autorizacion', 'datos']);
});

test('siguienteEstado: un error que YA viene clasificado conserva su categoria', () => {
  // El tope de inactivacion (#231) no lo produce Google: es el propio plan el
  // que sabe que es un problema de datos, y clasificarlo por el texto de su
  // motivo seria adivinar (no trae codigo HTTP ni nada que la tabla reconozca).
  const resumen = {
    omitido: null, creados: 0, actualizados: 0, inactivados: 0,
    errores: [{ motivo: 'tope de inactivacion: 20 de 20 fichas...', categoria: 'datos' }],
  };
  const estado = siguienteEstado(null, resumen, new Date('2026-08-21T12:00:00Z'));
  assert.equal(estado.errores[0].categoria, 'datos');
});

test('siguienteEstado: un barrido omitido por falta de credenciales no es una corrida real, no hay nada que persistir (aunque ya hubiera estado previo)', () => {
  const previo = { ...estadoVacio(), ultimaCorrida: '2026-08-20T00:00:00.000Z' };
  const resumen = { omitido: 'sin credenciales', creados: 0, actualizados: 0, inactivados: 0, errores: [] };
  const estado = siguienteEstado(previo, resumen, new Date());
  assert.equal(estado, null, 'null le dice al caller que no reescriba el estado ya guardado');
});

test('siguienteEstado: sin estado previo, un barrido omitido devuelve null (nunca corrio con credenciales)', () => {
  const resumen = { omitido: 'sin credenciales', creados: 0, actualizados: 0, inactivados: 0, errores: [] };
  const estado = siguienteEstado(null, resumen, new Date());
  assert.equal(estado, null);
});

test('siguienteEstado: los totales reflejan SOLO la ultima pasada, no un acumulado', () => {
  const previo = { ultimaCorrida: null, ultimaCorridaExitosa: null, creados: 40, actualizados: 12, inactivados: 3, errores: [], ultimoAviso: null };
  const resumen = { omitido: null, creados: 1, actualizados: 0, inactivados: 0, errores: [] };
  const estado = siguienteEstado(previo, resumen, new Date());
  assert.equal(estado.creados, 1, 'no se suma al total previo');
});

// `totales` (issue #257) es un objeto LIBRE por barrido: el barrido de
// contactos no lo usa (creados/actualizados/inactivados le alcanzan), pero el
// sondeo de pedidos de Shopify no tiene esos campos y necesita los suyos
// propios (leidos, filas, descartes por motivo). siguienteEstado los conserva
// tal cual sin saber que forma tienen -- el panel es quien decide como
// pintarlos.
test('siguienteEstado: sin totales en el resumen, el estado los deja en null (barrido de contactos, forma de antes)', () => {
  const resumen = { omitido: null, creados: 1, actualizados: 0, inactivados: 0, errores: [] };
  const estado = siguienteEstado(null, resumen, new Date());
  assert.equal(estado.totales, null);
});

test('siguienteEstado: con totales en el resumen, se conservan TAL CUAL en el estado (forma propia del sondeo de Shopify)', () => {
  const resumen = {
    omitido: null, creados: 0, actualizados: 0, inactivados: 0, errores: [],
    totales: { leidos: 12, filas: 8, descartesPorMotivo: [{ motivo: 'sin codigo de pais', cantidad: 3 }] },
  };
  const estado = siguienteEstado(null, resumen, new Date());
  assert.deepEqual(estado.totales, resumen.totales);
});

// --- debeAvisar ---

test('debeAvisar: sin estado (nunca corrio con credenciales), no avisa', () => {
  assert.equal(debeAvisar(null, new Date()), false);
});

test('debeAvisar: con corrida exitosa reciente, no avisa', () => {
  const ahora = new Date('2026-08-21T12:00:00Z');
  const estado = { ultimaCorridaExitosa: new Date(ahora.getTime() - 60_000).toISOString(), ultimoAviso: null };
  assert.equal(debeAvisar(estado, ahora), false);
});

test('debeAvisar: superado el umbral sin corrida exitosa, avisa', () => {
  const ahora = new Date('2026-08-21T12:00:00Z');
  const estado = { ultimaCorridaExitosa: new Date(ahora.getTime() - UMBRAL_AVISO_MS - 1000).toISOString(), ultimoAviso: null };
  assert.equal(debeAvisar(estado, ahora), true);
});

test('debeAvisar: nunca hubo corrida exitosa (siempre fallo) cuenta como excedido', () => {
  const estado = { ultimaCorridaExitosa: null, ultimoAviso: null };
  assert.equal(debeAvisar(estado, new Date()), true);
});

test('debeAvisar: ya se aviso hoy, no se repite en el mismo dia', () => {
  const ahora = new Date('2026-08-21T12:00:00Z');
  const estado = {
    ultimaCorridaExitosa: new Date(ahora.getTime() - UMBRAL_AVISO_MS - 1000).toISOString(),
    ultimoAviso: new Date(ahora.getTime() - 60_000).toISOString(),
  };
  assert.equal(debeAvisar(estado, ahora), false);
});

test('debeAvisar: paso un dia entero desde el ultimo aviso, se repite', () => {
  const ahora = new Date('2026-08-21T12:00:00Z');
  const estado = {
    ultimaCorridaExitosa: new Date(ahora.getTime() - UMBRAL_AVISO_MS - 1000).toISOString(),
    ultimoAviso: new Date(ahora.getTime() - 25 * 3600 * 1000).toISOString(),
  };
  assert.equal(debeAvisar(estado, ahora), true);
});

test('debeAvisar: en cuanto una corrida completa bien, deja de avisar', () => {
  const ahora = new Date('2026-08-21T12:00:00Z');
  // La corrida exitosa mas reciente es AHORA mismo: el problema se corrigio.
  const estado = { ultimaCorridaExitosa: ahora.toISOString(), ultimoAviso: new Date(ahora.getTime() - 3600 * 1000).toISOString() };
  assert.equal(debeAvisar(estado, ahora), false);
});

// --- mensajeAviso ---

const VENDEDOR_CON_PERMISO = { id: 1, name: 'Vendedor', role: 'admin', puedeAsignar: true, email: 'admin@pppeltre.mx' };
const ESTADO = {
  ultimaCorrida: '2026-08-21T00:00:00.000Z', ultimaCorridaExitosa: '2026-08-19T00:00:00.000Z',
  creados: 0, actualizados: 0, inactivados: 0,
  errores: [{ celular10: '5512345678', motivo: 'Google People 401: expirado', categoria: 'autorizacion' }],
  ultimoAviso: null,
};

test('mensajeAviso: sin destinatarios validos, no arma mensaje', () => {
  const mensaje = mensajeAviso('prospectos', ESTADO, [{ id: 2, role: 'vendedor' }]);
  assert.equal(mensaje, null);
});

test('mensajeAviso: con destinatarios, arma asunto y cuerpo con la ultima corrida exitosa y los errores', () => {
  const mensaje = mensajeAviso('prospectos', ESTADO, [VENDEDOR_CON_PERMISO]);
  assert.deepEqual(mensaje.to, ['admin@pppeltre.mx']);
  assert.match(mensaje.subject, /prospectos/);
  assert.match(mensaje.text, /2026-08-19T00:00:00\.000Z/);
  assert.match(mensaje.text, /autorizacion/);
  assert.match(mensaje.text, /Google People 401: expirado/);
});

test('mensajeAviso: el sondeo de pedidos de Shopify tiene su propia etiqueta legible, no el nombre interno del barrido', () => {
  const mensaje = mensajeAviso('shopify-pedidos', ESTADO, [VENDEDOR_CON_PERMISO]);
  assert.match(mensaje.subject, /pedidos de la tienda en linea/);
  assert.doesNotMatch(mensaje.subject, /shopify-pedidos/);
});
