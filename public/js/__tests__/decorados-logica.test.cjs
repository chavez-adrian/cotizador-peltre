'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

// El modulo de decorados (issue #61, CONTEXT.md "Producto decorado (calca)") es
// puro y browser-safe: lo consumen server.js (el gate a Pedido liberado), app.js
// (el checklist en la tarjeta) y este test via import() dinamico. Mismo patron
// que prospectos-logica.js / pipeline-logica.js: una sola implementacion.

let PASOS_DECORADO, checklistInicial, marcarPaso, revertirPaso, progresoDecorado,
  puedeLiberar, esDecorada;
before(async () => {
  ({ PASOS_DECORADO, checklistInicial, marcarPaso, revertirPaso, progresoDecorado,
    puedeLiberar, esDecorada } = await import('../decorados-logica.js'));
});

test('DC1: PASOS_DECORADO son los 6 pasos de la calca en orden, con clave y label', () => {
  assert.equal(PASOS_DECORADO.length, 6);
  assert.deepEqual(PASOS_DECORADO.map(p => p.clave), [
    'cotizacion_proveedor',
    'posicion_cliente',
    'arte_final',
    'dummy_autorizado',
    'liberacion_produccion',
    'archivos_dropbox',
  ]);
  for (const p of PASOS_DECORADO) {
    assert.equal(typeof p.label, 'string');
    assert.ok(p.label.length > 0);
  }
});

test('DC2: checklistInicial arranca los 6 pasos sin completar', () => {
  const ch = checklistInicial();
  assert.equal(ch.length, 6);
  assert.ok(ch.every(p => p.completo === false));
  assert.deepEqual(ch.map(p => p.clave), PASOS_DECORADO.map(p => p.clave));
});

test('DC3: marcarPaso completa un paso y devuelve un checklist nuevo (no muta)', () => {
  const ch = checklistInicial();
  const ch2 = marcarPaso(ch, 'arte_final');
  assert.equal(ch2.find(p => p.clave === 'arte_final').completo, true);
  // No muta el original
  assert.equal(ch.find(p => p.clave === 'arte_final').completo, false);
  assert.notEqual(ch, ch2);
});

test('DC4: revertirPaso descompleta un paso y devuelve un checklist nuevo (no muta)', () => {
  const ch = marcarPaso(checklistInicial(), 'arte_final');
  const ch2 = revertirPaso(ch, 'arte_final');
  assert.equal(ch2.find(p => p.clave === 'arte_final').completo, false);
  assert.equal(ch.find(p => p.clave === 'arte_final').completo, true);
});

test('DC5: marcar/revertir cada paso es idempotente y no toca los demas', () => {
  let ch = checklistInicial();
  for (const p of PASOS_DECORADO) {
    ch = marcarPaso(ch, p.clave);
    assert.equal(ch.find(x => x.clave === p.clave).completo, true);
  }
  assert.ok(ch.every(p => p.completo));
  // Marcar dos veces no cambia nada
  const ch2 = marcarPaso(ch, 'arte_final');
  assert.ok(ch2.every(p => p.completo));
  // Revertir uno solo afecta a ese
  const ch3 = revertirPaso(ch, 'dummy_autorizado');
  assert.equal(ch3.find(p => p.clave === 'dummy_autorizado').completo, false);
  assert.equal(ch3.filter(p => p.completo).length, 5);
});

test('DC6: marcar/revertir un paso inexistente devuelve el checklist sin cambios', () => {
  const ch = checklistInicial();
  assert.deepEqual(marcarPaso(ch, 'no_existe'), ch);
  assert.deepEqual(revertirPaso(ch, 'no_existe'), ch);
});

test('DC7: progresoDecorado cuenta completos/total (p. ej. 3/6)', () => {
  let ch = checklistInicial();
  assert.deepEqual(progresoDecorado(ch), { completos: 0, total: 6 });
  ch = marcarPaso(ch, 'cotizacion_proveedor');
  ch = marcarPaso(ch, 'posicion_cliente');
  ch = marcarPaso(ch, 'arte_final');
  assert.deepEqual(progresoDecorado(ch), { completos: 3, total: 6 });
});

test('DC8: progresoDecorado tolera un checklist ausente como 0/6', () => {
  assert.deepEqual(progresoDecorado(null), { completos: 0, total: 6 });
  assert.deepEqual(progresoDecorado(undefined), { completos: 0, total: 6 });
});

test('DC9: esDecorada lee la marca decorada de una oportunidad/cotizacion', () => {
  assert.equal(esDecorada({ data: { decorado: true } }), true);
  assert.equal(esDecorada({ data: { decorado: false } }), false);
  assert.equal(esDecorada({ data: {} }), false);
  assert.equal(esDecorada({}), false);
  assert.equal(esDecorada(null), false);
  // Acepta el flag tambien al tope (forma de oportunidad de frontend)
  assert.equal(esDecorada({ decorado: true }), true);
});

test('DC10: puedeLiberar es true para una oportunidad NO decorada', () => {
  assert.equal(puedeLiberar({ data: { decorado: false } }), true);
  assert.equal(puedeLiberar({ data: {} }), true);
  assert.equal(puedeLiberar({}), true);
});

test('DC11: puedeLiberar es false para una decorada con checklist parcial', () => {
  const ch = marcarPaso(marcarPaso(checklistInicial(), 'arte_final'), 'dummy_autorizado');
  assert.equal(puedeLiberar({ data: { decorado: true, calcaChecklist: ch } }), false);
  // Decorada sin checklist (recien marcada) tampoco puede liberar
  assert.equal(puedeLiberar({ data: { decorado: true } }), false);
});

test('DC12: puedeLiberar es true para una decorada con los 6 pasos completos', () => {
  let ch = checklistInicial();
  for (const p of PASOS_DECORADO) ch = marcarPaso(ch, p.clave);
  assert.equal(puedeLiberar({ data: { decorado: true, calcaChecklist: ch } }), true);
});

test('DC13: puedeLiberar acepta tambien un checklist crudo (array de pasos)', () => {
  let ch = checklistInicial();
  assert.equal(puedeLiberar(ch), false);
  for (const p of PASOS_DECORADO) ch = marcarPaso(ch, p.clave);
  assert.equal(puedeLiberar(ch), true);
});
