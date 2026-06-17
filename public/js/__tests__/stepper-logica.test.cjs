'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let PASOS_STEPPER, PASO_LABELS, indicePaso, esPasoValido, siguientePaso, pasoAnterior,
  pasoCompleto, pasosCompletos, progresoStepper, textoProgreso, estadoStepper;
before(async () => {
  ({ PASOS_STEPPER, PASO_LABELS, indicePaso, esPasoValido, siguientePaso, pasoAnterior,
    pasoCompleto, pasosCompletos, progresoStepper, textoProgreso, estadoStepper } =
    await import('../stepper-logica.js'));
});

// El stepper del flujo de cotizar son 4 pasos en orden fijo. La completitud de
// cada paso se deriva de un estado plano ({clienteListo, productosListos,
// envioListo}) con los MISMOS criterios que hoy calcula updateTabIndicators en
// app.js. El stepper GUIA y MUESTRA progreso pero NO bloquea (AC2: se llega a
// Cotizacion sin alta; el clic libre se preserva).

test('S1: PASOS_STEPPER son los 4 pasos del flujo de cotizar en orden', () => {
  assert.deepEqual(PASOS_STEPPER, ['cliente', 'productos', 'envio', 'resumen']);
});

test('S2: PASO_LABELS tiene etiqueta legible para cada paso (el 4o es Cotizacion)', () => {
  assert.equal(PASO_LABELS.cliente, 'Cliente');
  assert.equal(PASO_LABELS.productos, 'Productos');
  assert.equal(PASO_LABELS.envio, 'Envio');
  assert.equal(PASO_LABELS.resumen, 'Cotizacion');
});

test('S3: indicePaso devuelve la posicion 0..3 del paso (-1 si no existe)', () => {
  assert.equal(indicePaso('cliente'), 0);
  assert.equal(indicePaso('productos'), 1);
  assert.equal(indicePaso('envio'), 2);
  assert.equal(indicePaso('resumen'), 3);
  assert.equal(indicePaso('inexistente'), -1);
});

test('S4: esPasoValido reconoce solo los 4 pasos', () => {
  assert.equal(esPasoValido('cliente'), true);
  assert.equal(esPasoValido('resumen'), true);
  assert.equal(esPasoValido('alta'), false);
  assert.equal(esPasoValido(null), false);
});

test('S5: siguientePaso avanza en orden y se queda en el ultimo', () => {
  assert.equal(siguientePaso('cliente'), 'productos');
  assert.equal(siguientePaso('productos'), 'envio');
  assert.equal(siguientePaso('envio'), 'resumen');
  assert.equal(siguientePaso('resumen'), 'resumen');
});

test('S6: pasoAnterior retrocede en orden y se queda en el primero', () => {
  assert.equal(pasoAnterior('resumen'), 'envio');
  assert.equal(pasoAnterior('envio'), 'productos');
  assert.equal(pasoAnterior('productos'), 'cliente');
  assert.equal(pasoAnterior('cliente'), 'cliente');
});

test('S7: siguientePaso/pasoAnterior con paso invalido devuelven el primero', () => {
  assert.equal(siguientePaso('xxx'), 'cliente');
  assert.equal(pasoAnterior('xxx'), 'cliente');
});

test('S8: pasoCompleto deriva la completitud de cada paso del estado plano', () => {
  const estado = { clienteListo: true, productosListos: false, envioListo: true };
  assert.equal(pasoCompleto('cliente', estado), true);
  assert.equal(pasoCompleto('productos', estado), false);
  assert.equal(pasoCompleto('envio', estado), true);
});

test('S9: el paso resumen (Cotizacion) no tiene criterio propio de completitud', () => {
  const estado = { clienteListo: true, productosListos: true, envioListo: true };
  assert.equal(pasoCompleto('resumen', estado), false);
});

test('S10: pasoCompleto trata estado ausente como no completo', () => {
  assert.equal(pasoCompleto('cliente', {}), false);
  assert.equal(pasoCompleto('cliente', undefined), false);
});

test('S11: pasosCompletos devuelve el set de pasos completos segun el estado', () => {
  const estado = { clienteListo: true, productosListos: true, envioListo: false };
  assert.deepEqual(pasosCompletos(estado), ['cliente', 'productos']);
});

test('S12: progresoStepper reporta indice (1-based), total y fraccion del paso actual', () => {
  assert.deepEqual(progresoStepper('cliente'), { actual: 1, total: 4, fraccion: 0.25 });
  assert.deepEqual(progresoStepper('envio'), { actual: 3, total: 4, fraccion: 0.75 });
  assert.deepEqual(progresoStepper('resumen'), { actual: 4, total: 4, fraccion: 1 });
});

test('S13: progresoStepper con paso invalido cae al primer paso', () => {
  assert.deepEqual(progresoStepper('xxx'), { actual: 1, total: 4, fraccion: 0.25 });
});

test('S14: textoProgreso dice en que paso voy y cuantos faltan', () => {
  assert.equal(textoProgreso('cliente'), 'Paso 1 de 4');
  assert.equal(textoProgreso('resumen'), 'Paso 4 de 4');
});

test('S15: estadoStepper marca cada paso como actual / completo / pendiente sin bloquear', () => {
  // En productos, con cliente ya listo: cliente=completo, productos=actual,
  // envio/resumen=pendientes. El stepper guia, no bloquea (todos navegables).
  const estado = { clienteListo: true, productosListos: false, envioListo: false };
  const vista = estadoStepper('productos', estado);
  assert.equal(vista.actual, 'productos');
  assert.deepEqual(vista.progreso, { actual: 2, total: 4, fraccion: 0.5 });
  const porPaso = Object.fromEntries(vista.pasos.map(p => [p.paso, p]));
  assert.equal(porPaso.cliente.completo, true);
  assert.equal(porPaso.cliente.esActual, false);
  assert.equal(porPaso.productos.esActual, true);
  assert.equal(porPaso.productos.completo, false);
  assert.equal(porPaso.envio.completo, false);
  assert.equal(porPaso.envio.esActual, false);
  // Etiqueta y posicion (1-based) presentes para pintar el riel.
  assert.equal(porPaso.cliente.label, 'Cliente');
  assert.equal(porPaso.resumen.numero, 4);
});

test('S16: estadoStepper no expone ninguna nocion de "bloqueado" (clic libre, AC2)', () => {
  const vista = estadoStepper('cliente', {});
  for (const p of vista.pasos) {
    assert.equal('bloqueado' in p, false);
  }
});
