import { test } from 'node:test';
import assert from 'node:assert/strict';

import { interpretarAviso, claveEvento, resultadoDelAviso } from '../lib/sync-operam-webhook.js';
import { avisoPedido, avisoPago, avisoRemision } from './helpers/avisos-operam.js';

// #510: que dice cada aviso de Operam y su clave idempotente, con las formas
// reales del log de produccion (test/helpers/avisos-operam.js). Hasta #510 todos
// los pedidos daban `Order:ev:[object Object]` y todas las remisiones
// `CustDelivery:ev:sin-id`.

test('dos avisos de Pedido distintos tienen claves distintas; el mismo reenviado, la misma', () => {
  const a = claveEvento(avisoPedido({ reference: '2606741', transNoFrom: '1141' }));
  const b = claveEvento(avisoPedido({ reference: '2609812', transNoFrom: '1309' }));
  assert.notEqual(a, b);
  assert.equal(a, claveEvento(avisoPedido({ reference: '2606741', transNoFrom: '1141' })));
  assert.doesNotMatch(a, /object Object/);
});

test('dos avisos de Remision distintos tienen claves distintas; el mismo reenviado, la misma', () => {
  const a = claveEvento(avisoRemision(2400));
  const b = claveEvento(avisoRemision(2401));
  assert.notEqual(a, b);
  assert.equal(a, claveEvento(avisoRemision(2400)));
  assert.doesNotMatch(a, /sin-id/);
});

test('la clave del Pago no cambia de criterio: su trans_no', () => {
  assert.notEqual(claveEvento(avisoPago({ transNo: '7694' })), claveEvento(avisoPago({ transNo: '7695' })));
  assert.match(claveEvento(avisoPago({ transNo: '7695' })), /^Payment:ADD:7695$/);
});

test('un aviso sin identificador propio usa la huella del aviso completo, nunca una constante', () => {
  const a = claveEvento({ type: 'ADD', model: 'Otro', data: { x: 1 } });
  const b = claveEvento({ type: 'ADD', model: 'Otro', data: { x: 2 } });
  assert.notEqual(a, b);
  assert.equal(a, claveEvento({ type: 'ADD', model: 'Otro', data: { x: 1 } }));
});

test('el aviso de Pedido trae el documento de origen; el de Pago, el cliente', () => {
  const pedido = interpretarAviso(avisoPedido({ transNoFrom: '1309', customerId: '537' }));
  assert.equal(pedido.tipo, 'pedido');
  assert.equal(pedido.documento, '1309');
  assert.equal(pedido.cliente, null);

  const pago = interpretarAviso(avisoPago({ debtorNo: '537', taxId: 'XAXX010101000' }));
  assert.equal(pago.tipo, 'pago');
  assert.equal(pago.cliente, '537');
  assert.equal(pago.documento, null);

  assert.equal(interpretarAviso(avisoRemision(2400)).tipo, 'remision');
});

test('un Pedido de venta directa (sin documento de origen) no trae documento', () => {
  assert.equal(interpretarAviso(avisoPedido({ transNoFrom: '' })).documento, null);
});

test('un payload vacio o que no es objeto no truena', () => {
  for (const p of [null, undefined, 'x', 3]) {
    const a = interpretarAviso(p);
    assert.equal(a.tipo, null);
    assert.match(a.clave, /^op:ev:h[0-9a-f]{16}$/);
  }
});

test('resultadoDelAviso: con un error, o con una cotizacion que fallo, no queda procesado', () => {
  assert.deepEqual(resultadoDelAviso([{ id: 1, movida: true }], null), { ok: true, resultado: 'reconciliadas:1' });
  assert.deepEqual(resultadoDelAviso([], null), { ok: true, resultado: 'reconciliadas:0' });
  assert.deepEqual(resultadoDelAviso([], 'Operam 429'), { ok: false, resultado: 'error: Operam 429' });
  assert.deepEqual(
    resultadoDelAviso([{ id: 1, movida: true }, { id: 2, error: 'timeout' }], null),
    { ok: false, resultado: 'error: 2: timeout' },
  );
});
