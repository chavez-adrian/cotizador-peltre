// Nucleo puro de la lista de precios del cliente (#285). Las tres reglas que
// convierten "Operam 406: Debe haber al menos un rate de moneda" en algo que el
// vendedor pueda arreglar: quien esta sin lista, que decirle y como reconocer el
// 406 cuando llega de todos modos.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clienteSinListaPrecios,
  MENSAJE_CLIENTE_SIN_LISTA,
  esErrorRateMoneda,
  ErrorClienteSinLista,
  CODIGO_CLIENTE_SIN_LISTA,
} from '../lib/lista-precios-cliente.js';

// Los cinco valores que significan "sin lista". El GET de Operam devuelve
// sales_type como STRING ("0", "12"), pero el 0 numerico y la ausencia del campo
// entran igual: en los tres casos el cliente no puede valuar un documento.
test('L1: clienteSinListaPrecios reconoce 0, "0", "", null y undefined como sin lista', () => {
  assert.equal(clienteSinListaPrecios({ sales_type: 0 }), true);
  assert.equal(clienteSinListaPrecios({ sales_type: '0' }), true);
  assert.equal(clienteSinListaPrecios({ sales_type: '' }), true);
  assert.equal(clienteSinListaPrecios({ sales_type: null }), true);
  assert.equal(clienteSinListaPrecios({}), true);
  assert.equal(clienteSinListaPrecios(null), true);
});

// Cualquier id de lista cuenta como lista asignada: este nucleo no valida que el
// id exista en Operam, solo que el cliente tenga uno. "12" es Precio de lista y
// "15" M100 (las que Operam usa hoy).
test('L2: clienteSinListaPrecios deja pasar al cliente con lista asignada', () => {
  assert.equal(clienteSinListaPrecios({ sales_type: '12' }), false);
  assert.equal(clienteSinListaPrecios({ sales_type: '15' }), false);
  assert.equal(clienteSinListaPrecios({ sales_type: 12 }), false);
});

test('L3: el mensaje nombra al cliente, la lista que falta y que hacer', () => {
  const msg = MENSAJE_CLIENTE_SIN_LISTA('Hotel Azul');
  assert.match(msg, /Hotel Azul/);
  assert.match(msg, /lista de precios en Operam/);
  assert.match(msg, /Precio de lista/);
  assert.match(msg, /M100/);
  assert.match(msg, /vuelve a subir/);
});

// El fallback (el 406 que igual llega) no siempre tiene el nombre a mano: el
// mensaje sigue siendo accionable sin el, y nunca dice "undefined".
test('L4: sin nombre el mensaje sigue siendo accionable y no imprime un hueco', () => {
  const msg = MENSAJE_CLIENTE_SIN_LISTA();
  assert.match(msg, /lista de precios en Operam/);
  assert.match(msg, /vuelve a subir/);
  assert.ok(!/undefined|null/.test(msg), msg);
});

// El 406 real, medido en vivo el 2026-09-01 con el cliente 15 (sales_type "0"):
// el cuerpo del error viaja dentro del mensaje que arma apiCall.
test('L5: esErrorRateMoneda reconoce el 406 de Operam, con y sin acentos', () => {
  assert.equal(esErrorRateMoneda('Operam 406: Debe haber al menos un rate de moneda'), true);
  assert.equal(esErrorRateMoneda('Operam 406: DEBE HABER AL MENOS UN RATE DE MONEDA'), true);
  // La "o" acentuada se compone en runtime para no romper el ASCII estricto del repo.
  const conAcento = 'Operam 406: Debe haber al menos un rate de m' + String.fromCharCode(0xF3) + 'neda';
  assert.equal(esErrorRateMoneda(conAcento), true);
});

test('L6: esErrorRateMoneda no confunde otros fallos de Operam', () => {
  assert.equal(esErrorRateMoneda('Operam 406: Already exists customer with same cust_ref'), false);
  assert.equal(esErrorRateMoneda('Operam 503'), false);
  assert.equal(esErrorRateMoneda(''), false);
  assert.equal(esErrorRateMoneda(null), false);
});

// El error tipado es lo que separa "el cliente esta mal configurado" (422, el
// reintento no sirve hasta arreglarlo) de "Operam fallo" (503 + Reintentar).
test('L7: ErrorClienteSinLista lleva el codigo estructurado y el mensaje accionable', () => {
  const err = new ErrorClienteSinLista('Hotel Azul');
  assert.ok(err instanceof Error);
  assert.equal(err.codigo, CODIGO_CLIENTE_SIN_LISTA);
  assert.equal(CODIGO_CLIENTE_SIN_LISTA, 'CLIENTE_SIN_LISTA_PRECIOS');
  assert.equal(err.message, MENSAJE_CLIENTE_SIN_LISTA('Hotel Azul'));
});
