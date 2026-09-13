'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

// Moneda del cliente (#297, ADR-0015; CONTEXT.md "Moneda del cliente").
//
// El cotizador calcula, imprime y sube PESOS, y Operam etiqueta esos numeros con
// la moneda del CLIENTE (curr_code): cotizarle a un cliente en USD registraria
// pesos como dolares, un error de 17x sin ningun aviso. Mientras no exista el
// soporte de moneda extranjera, el juicio de bloqueo vive aqui -- lo comparten el
// paso Cliente (navegador) y la subida del quote (servidor), para que la pantalla
// y el ERP no puedan opinar distinto.

let MONEDA_BASE, CODIGO_MONEDA_EXTRANJERA, monedaDelCliente, bloqueoMonedaCliente,
  MENSAJE_MONEDA_EXTRANJERA, ErrorClienteMonedaExtranjera;

before(async () => {
  ({
    MONEDA_BASE, CODIGO_MONEDA_EXTRANJERA, monedaDelCliente, bloqueoMonedaCliente,
    MENSAJE_MONEDA_EXTRANJERA, ErrorClienteMonedaExtranjera,
  } = await import('../moneda-cliente-logica.js'));
});

test('M1: un cliente de Operam en USD queda bloqueado, con la moneda nombrada en el mensaje', () => {
  const b = bloqueoMonedaCliente({ curr_code: 'USD' }, 'WILLIAMS SONOMA INC');
  assert.ok(b, 'un cliente en moneda extranjera se bloquea');
  assert.equal(b.moneda, 'USD');
  assert.match(b.mensaje, /USD/, 'el mensaje nombra la moneda del cliente');
  assert.match(b.mensaje, /WILLIAMS SONOMA INC/, 'y a quien se le estaba cotizando');
  assert.match(b.mensaje, /Operam/, 'y que hacer: cotizar por Operam');
});

test('M2: un cliente en pesos no se bloquea (cero friccion para el 96% del padron)', () => {
  assert.equal(bloqueoMonedaCliente({ curr_code: 'MXN' }, 'HOTEL AZUL SA DE CV'), null);
  assert.equal(MONEDA_BASE, 'MXN');
});

test('M3: la moneda se compara normalizada (Operam la devuelve como texto libre)', () => {
  assert.equal(bloqueoMonedaCliente({ curr_code: ' mxn ' }, 'Hotel Azul'), null);
  assert.equal(bloqueoMonedaCliente({ curr_code: ' usd ' }, 'Acme').moneda, 'USD');
  assert.equal(monedaDelCliente({ curr_code: ' eur ' }), 'EUR');
});

test('M4: sin senal de moneda no se bloquea: un campo ausente no es una moneda extranjera', () => {
  assert.equal(bloqueoMonedaCliente({}, 'Hotel Azul'), null);
  assert.equal(bloqueoMonedaCliente({ curr_code: '' }, 'Hotel Azul'), null);
  assert.equal(bloqueoMonedaCliente({ curr_code: null }, 'Hotel Azul'), null);
  assert.equal(bloqueoMonedaCliente(null, 'Hotel Azul'), null);
  assert.equal(monedaDelCliente({}), '');
});

test('M5: la fila del cotizador trae la moneda en `moneda` y da el mismo veredicto', () => {
  const fila = { id: '514', name: 'ACME EXPORT LLC', moneda: 'CAD' };
  const b = bloqueoMonedaCliente(fila, fila.name);
  assert.ok(b);
  assert.equal(b.moneda, 'CAD');
  assert.equal(bloqueoMonedaCliente({ id: '1', moneda: 'MXN' }, 'Hotel Azul'), null);
});

test('M6: sin nombre a la mano el mensaje sigue diciendo la moneda y que hacer, sin huecos', () => {
  const msg = MENSAJE_MONEDA_EXTRANJERA('', 'EUR');
  assert.match(msg, /^El Cliente Operam /);
  assert.match(msg, /EUR/);
  assert.match(msg, /Operam/);
  assert.doesNotMatch(msg, /undefined|null/);
});

test('M7: el error tipado de la subida lleva el codigo estructurado y el mismo texto', () => {
  const err = new ErrorClienteMonedaExtranjera('WILLIAMS SONOMA INC', 'USD');
  assert.equal(err.codigo, CODIGO_MONEDA_EXTRANJERA);
  assert.equal(CODIGO_MONEDA_EXTRANJERA, 'CLIENTE_MONEDA_EXTRANJERA');
  assert.equal(err.moneda, 'USD');
  assert.equal(err.message, MENSAJE_MONEDA_EXTRANJERA('WILLIAMS SONOMA INC', 'USD'));
  assert.ok(err instanceof Error);
});
