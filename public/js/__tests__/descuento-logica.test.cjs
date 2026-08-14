'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let normalizarTope, topeDescuentoVendedor, puedeDescontar, validarDescuentoLinea,
  validarDescuentosCotizacion, mensajeTopeExcedido, MENSAJE_SIN_TOPE, TOPE_ADMIN, partidasConDescuento;
before(async () => {
  ({
    normalizarTope, topeDescuentoVendedor, puedeDescontar, validarDescuentoLinea,
    validarDescuentosCotizacion, mensajeTopeExcedido, MENSAJE_SIN_TOPE, TOPE_ADMIN, partidasConDescuento,
  } = await import('../descuento-logica.js'));
});

// === Tope del vendedor (#137): descontar es permiso explicito ===

test('vendedor sin tope asignado -> 0 (no puede descontar)', () => {
  assert.strictEqual(topeDescuentoVendedor({ role: 'vendedor' }), 0);
  assert.strictEqual(puedeDescontar(0), false);
});

test('vendedor con tope asignado -> ese tope', () => {
  assert.strictEqual(topeDescuentoVendedor({ role: 'vendedor', topeDescuento: 15 }), 15);
  assert.strictEqual(puedeDescontar(15), true);
});

test('el admin no tiene tope', () => {
  assert.strictEqual(topeDescuentoVendedor({ role: 'admin' }), TOPE_ADMIN);
  assert.strictEqual(TOPE_ADMIN, 100);
});

test('un tope basura del registro degrada a 0, no a permiso ilimitado', () => {
  assert.strictEqual(topeDescuentoVendedor({ role: 'vendedor', topeDescuento: 'mucho' }), 0);
  assert.strictEqual(topeDescuentoVendedor({ role: 'vendedor', topeDescuento: -5 }), 0);
  assert.strictEqual(topeDescuentoVendedor(null), 0);
});

test('normalizarTope acota al rango 0-100 y acepta el numero en texto', () => {
  assert.strictEqual(normalizarTope('20'), 20);
  assert.strictEqual(normalizarTope(150), 100);
  assert.strictEqual(normalizarTope(''), 0);
  assert.strictEqual(normalizarTope(7.5), 7.5);
});

// === Captura por linea ===

test('vacio cuenta como 0% y es valido aun sin tope', () => {
  const r = validarDescuentoLinea('', 0);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.valor, 0);
});

test('descuento dentro del tope -> ok con el valor numerico', () => {
  const r = validarDescuentoLinea('10', 15);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.valor, 10);
});

test('el tope exacto es valido', () => {
  assert.strictEqual(validarDescuentoLinea(15, 15).ok, true);
});

test('descuento por encima del tope -> rechazo que dice cual es el tope', () => {
  const r = validarDescuentoLinea(20, 15);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.mensaje, mensajeTopeExcedido(15));
  assert.ok(r.mensaje.includes('15%'));
});

test('sin tope, cualquier descuento se rechaza con el mensaje de permiso', () => {
  const r = validarDescuentoLinea(1, 0);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.mensaje, MENSAJE_SIN_TOPE);
});

test('valores no numericos o fuera de 0-100 se rechazan', () => {
  for (const malo of ['abc', -1, 101, NaN]) {
    const r = validarDescuentoLinea(malo, 100);
    assert.strictEqual(r.ok, false, `deberia rechazar ${malo}`);
    assert.ok(r.mensaje);
  }
});

// === Validacion de la cotizacion completa (la que hace valer el servidor) ===

test('cotizacion con todas las partidas dentro del tope -> ok', () => {
  const items = [
    { codigo: 'AB12', descuento: 10 },
    { codigo: 'CD34' },
    { codigo: 'ENVIO', descuento: 15 },
  ];
  assert.strictEqual(validarDescuentosCotizacion(items, 15).ok, true);
});

test('una sola partida por encima del tope tumba la cotizacion y se nombra', () => {
  const items = [
    { codigo: 'AB12', descuento: 10 },
    { codigo: 'ENVIO', descuento: 40 },
  ];
  const r = validarDescuentosCotizacion(items, 15);
  assert.strictEqual(r.ok, false);
  assert.ok(r.mensaje.includes('ENVIO'));
  assert.ok(r.mensaje.includes(mensajeTopeExcedido(15)));
});

test('sin tope, una cotizacion sin descuentos sigue siendo valida', () => {
  const items = [{ codigo: 'AB12', descuento: 0 }, { codigo: 'CD34' }];
  assert.strictEqual(validarDescuentosCotizacion(items, 0).ok, true);
});

test('items ausentes o vacios -> ok', () => {
  assert.strictEqual(validarDescuentosCotizacion(undefined, 0).ok, true);
  assert.strictEqual(validarDescuentosCotizacion([], 0).ok, true);
});

test('partidasConDescuento suma el envio estructurado a las partidas', () => {
  const r = partidasConDescuento({
    items: [{ codigo: 'AB12', descuento: 10 }],
    envio: { opcion: 'manual', precio: 500, descuento: 60 },
  });
  assert.strictEqual(r.length, 2);
  assert.deepStrictEqual(r[1], { codigo: 'ENVIO', descuento: 60 });
});

test('partidasConDescuento ignora un envio sin descuento o ausente', () => {
  assert.strictEqual(partidasConDescuento({ items: [{ codigo: 'AB12' }], envio: { precio: 500 } }).length, 1);
  assert.strictEqual(partidasConDescuento({ items: [{ codigo: 'AB12' }] }).length, 1);
  assert.strictEqual(partidasConDescuento(undefined).length, 0);
});
