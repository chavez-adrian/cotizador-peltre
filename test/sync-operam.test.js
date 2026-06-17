import { test } from 'node:test';
import assert from 'node:assert/strict';

import { etapaPostVenta, hechosDesdeOperam } from '../lib/sync-operam.js';

// Nucleo puro del sync post-venta con Operam (issue #62, AC3; CONTEXT.md
// "Sincronizacion post-venta con Operam"). Estos tests prueban la funcion pura
// hechos -> etapa post-venta destino y la normalizacion provisional de un payload
// crudo de Operam a esos hechos. Sin red, sin IO, sin escritura.
//
// Forma de `hechos` (ya normalizado por el IO layer, fuera de alcance):
//   { pago: { allocated, outstanding, total }, tienePedido, tieneRemision }

// --- Regla: producto_entregado (remision / CustDelivery) ---

test('etapaPostVenta devuelve producto_entregado si hay remision', () => {
  const hechos = {
    pago: { allocated: 0, outstanding: 0, total: 0 },
    tienePedido: true,
    tieneRemision: true,
  };
  assert.equal(etapaPostVenta(hechos), 'producto_entregado');
});

// --- Regla: saldo_pagado (liquidado: outstanding 0 con total > 0) ---

test('etapaPostVenta devuelve saldo_pagado si el pago esta liquidado', () => {
  const hechos = {
    pago: { allocated: 1000, outstanding: 0, total: 1000 },
    tienePedido: true,
    tieneRemision: false,
  };
  assert.equal(etapaPostVenta(hechos), 'saldo_pagado');
});

test('etapaPostVenta NO devuelve saldo_pagado si total es 0 (nada que liquidar)', () => {
  const hechos = {
    pago: { allocated: 0, outstanding: 0, total: 0 },
    tienePedido: false,
    tieneRemision: false,
  };
  assert.equal(etapaPostVenta(hechos), null);
});

// --- Regla: pedido_liberado (existe pedido en Operam; decision de Adrian) ---

test('etapaPostVenta devuelve pedido_liberado si hay pedido y no hay senal mas avanzada', () => {
  const hechos = {
    pago: { allocated: 0, outstanding: 0, total: 0 },
    tienePedido: true,
    tieneRemision: false,
  };
  assert.equal(etapaPostVenta(hechos), 'pedido_liberado');
});

// --- Regla: anticipo_pagado (pago parcial: allocated > 0 y outstanding > 0) ---

test('etapaPostVenta devuelve anticipo_pagado si hay pago parcial', () => {
  const hechos = {
    pago: { allocated: 300, outstanding: 700, total: 1000 },
    tienePedido: false,
    tieneRemision: false,
  };
  assert.equal(etapaPostVenta(hechos), 'anticipo_pagado');
});

// --- Sin hecho post-venta: null (sigue en Seguimiento) ---

test('etapaPostVenta devuelve null si ningun hecho post-venta aplica', () => {
  const hechos = {
    pago: { allocated: 0, outstanding: 0, total: 0 },
    tienePedido: false,
    tieneRemision: false,
  };
  assert.equal(etapaPostVenta(hechos), null);
});

test('etapaPostVenta tolera hechos vacios o sin campo pago', () => {
  assert.equal(etapaPostVenta({}), null);
  assert.equal(etapaPostVenta({ tienePedido: false }), null);
});

// --- Monotonia hacia adelante: gana la etapa mas avanzada ---

test('etapaPostVenta devuelve la etapa MAS avanzada cuando varios hechos aplican', () => {
  // Anticipo parcial + pedido + remision: gana producto_entregado.
  const hechos = {
    pago: { allocated: 300, outstanding: 700, total: 1000 },
    tienePedido: true,
    tieneRemision: true,
  };
  assert.equal(etapaPostVenta(hechos), 'producto_entregado');
});

test('etapaPostVenta: pedido + pago parcial gana pedido_liberado sobre anticipo_pagado', () => {
  const hechos = {
    pago: { allocated: 300, outstanding: 700, total: 1000 },
    tienePedido: true,
    tieneRemision: false,
  };
  assert.equal(etapaPostVenta(hechos), 'pedido_liberado');
});

test('etapaPostVenta: liquidado + remision gana producto_entregado sobre saldo_pagado', () => {
  const hechos = {
    pago: { allocated: 1000, outstanding: 0, total: 1000 },
    tienePedido: true,
    tieneRemision: true,
  };
  assert.equal(etapaPostVenta(hechos), 'producto_entregado');
});

// --- Gate de decorados (#61): no libera con checklist incompleto ---

test('etapaPostVenta topa a anticipo_pagado una oportunidad decorada con checklist incompleto', () => {
  const hechos = {
    pago: { allocated: 300, outstanding: 700, total: 1000 },
    tienePedido: true,
    tieneRemision: false,
  };
  const oportunidad = { decorado: true, data: { calcaChecklist: [] } };
  // Operam dice pedido_liberado, pero el gate la topa: gana el anticipo parcial.
  assert.equal(etapaPostVenta(hechos, oportunidad), 'anticipo_pagado');
});

test('etapaPostVenta deja en null una oportunidad decorada incompleta con pedido pero sin anticipo', () => {
  const hechos = {
    pago: { allocated: 0, outstanding: 0, total: 0 },
    tienePedido: true,
    tieneRemision: false,
  };
  const oportunidad = { decorado: true, data: { calcaChecklist: [] } };
  // Sin pago parcial, el gate impide pedido_liberado y no hay etapa anterior: null.
  assert.equal(etapaPostVenta(hechos, oportunidad), null);
});

test('etapaPostVenta libera una oportunidad decorada con checklist COMPLETO', () => {
  const checklistCompleto = [
    { clave: 'cotizacion_proveedor', completo: true },
    { clave: 'posicion_cliente', completo: true },
    { clave: 'arte_final', completo: true },
    { clave: 'dummy_autorizado', completo: true },
    { clave: 'liberacion_produccion', completo: true },
    { clave: 'archivos_dropbox', completo: true },
  ];
  const hechos = {
    pago: { allocated: 0, outstanding: 0, total: 0 },
    tienePedido: true,
    tieneRemision: false,
  };
  const oportunidad = { decorado: true, data: { calcaChecklist: checklistCompleto } };
  assert.equal(etapaPostVenta(hechos, oportunidad), 'pedido_liberado');
});

test('etapaPostVenta: el gate NO afecta una oportunidad NO decorada', () => {
  const hechos = {
    pago: { allocated: 0, outstanding: 0, total: 0 },
    tienePedido: true,
    tieneRemision: false,
  };
  const oportunidad = { decorado: false };
  assert.equal(etapaPostVenta(hechos, oportunidad), 'pedido_liberado');
});

test('etapaPostVenta: el gate NO topa producto_entregado/saldo_pagado por debajo de pedido_liberado', () => {
  // El gate solo impide pedido_liberado y mas alla; pero saldo_pagado y
  // producto_entregado son MAS avanzadas que pedido_liberado, asi que un
  // decorado incompleto que ya entrego tampoco debe saltarse el gate: se topa
  // en la mayor etapa NO bloqueada por el gate (anticipo, o null).
  const hechos = {
    pago: { allocated: 1000, outstanding: 0, total: 1000 },
    tienePedido: true,
    tieneRemision: true,
  };
  const oportunidad = { decorado: true, data: { calcaChecklist: [] } };
  // saldo liquidado pero sin anticipo parcial (outstanding 0): gate topa en null.
  assert.equal(etapaPostVenta(hechos, oportunidad), null);
});

// --- Idempotencia / monotonia respecto a la etapa actual ---

test('etapaPostVenta devuelve null si la etapa actual ya es la calculada (idempotente)', () => {
  const hechos = {
    pago: { allocated: 0, outstanding: 0, total: 0 },
    tienePedido: true,
    tieneRemision: false,
  };
  const oportunidad = { etapa: 'pedido_liberado' };
  assert.equal(etapaPostVenta(hechos, oportunidad), null);
});

test('etapaPostVenta devuelve null si la etapa actual ya es MAS avanzada que la calculada (no retrocede)', () => {
  const hechos = {
    pago: { allocated: 300, outstanding: 700, total: 1000 },
    tienePedido: false,
    tieneRemision: false,
  };
  const oportunidad = { etapa: 'saldo_pagado' };
  // Operam solo reporta anticipo parcial, pero la tarjeta ya esta en saldo_pagado.
  assert.equal(etapaPostVenta(hechos, oportunidad), null);
});

test('etapaPostVenta devuelve la etapa nueva si avanza respecto a la actual', () => {
  const hechos = {
    pago: { allocated: 1000, outstanding: 0, total: 1000 },
    tienePedido: true,
    tieneRemision: false,
  };
  const oportunidad = { etapa: 'anticipo_pagado' };
  assert.equal(etapaPostVenta(hechos, oportunidad), 'saldo_pagado');
});

test('etapaPostVenta desde una etapa pre-venta (seguimiento) avanza normalmente', () => {
  const hechos = {
    pago: { allocated: 300, outstanding: 700, total: 1000 },
    tienePedido: false,
    tieneRemision: false,
  };
  const oportunidad = { etapa: 'seguimiento' };
  assert.equal(etapaPostVenta(hechos, oportunidad), 'anticipo_pagado');
});

// --- Normalizacion provisional: payload crudo de Operam -> hechos ---
// El IO real (webhooks/polling) es HITL; esta normalizacion es minima y
// provisional para probar el nucleo contra algo parecido a Operam.

test('hechosDesdeOperam normaliza un conjunto de transacciones de Operam a hechos', () => {
  // Forma real (PROGRESS #62): cada transaccion comparte order_; trans_type
  // 10=cotizacion, 11=pedido, 13=factura, 30=remision. allocated/outstanding en
  // la factura. Una oportunidad liquidada con pedido y remision.
  const transacciones = [
    { trans_no: 6782, trans_type: 10, order_: 7139, total_amount: 1000, allocated: 0, outstanding: 0 },
    { trans_no: 7100, trans_type: 11, order_: 7139, total_amount: 1000, allocated: 0, outstanding: 0 },
    { trans_no: 7269, trans_type: 13, order_: 7139, total_amount: 1000, allocated: 1000, outstanding: 0 },
    { trans_no: 7300, trans_type: 30, order_: 7139, total_amount: 0, allocated: 0, outstanding: 0 },
  ];
  const hechos = hechosDesdeOperam(transacciones);
  assert.equal(hechos.tienePedido, true);
  assert.equal(hechos.tieneRemision, true);
  assert.equal(hechos.pago.total, 1000);
  assert.equal(hechos.pago.allocated, 1000);
  assert.equal(hechos.pago.outstanding, 0);
  assert.equal(etapaPostVenta(hechos), 'producto_entregado');
});

test('hechosDesdeOperam: anticipo parcial sin pedido ni remision -> anticipo_pagado', () => {
  const transacciones = [
    { trans_no: 6800, trans_type: 10, order_: 7200, total_amount: 2000, allocated: 0, outstanding: 0 },
    { trans_no: 7280, trans_type: 13, order_: 7200, total_amount: 2000, allocated: 500, outstanding: 1500 },
  ];
  const hechos = hechosDesdeOperam(transacciones);
  assert.equal(hechos.tienePedido, false);
  assert.equal(hechos.tieneRemision, false);
  assert.equal(hechos.pago.allocated, 500);
  assert.equal(hechos.pago.outstanding, 1500);
  assert.equal(etapaPostVenta(hechos), 'anticipo_pagado');
});

test('hechosDesdeOperam: solo cotizacion (sin pago, pedido ni remision) -> hechos sin etapa', () => {
  const transacciones = [
    { trans_no: 6900, trans_type: 10, order_: 7300, total_amount: 1500, allocated: 0, outstanding: 0 },
  ];
  const hechos = hechosDesdeOperam(transacciones);
  assert.equal(hechos.tienePedido, false);
  assert.equal(hechos.tieneRemision, false);
  assert.equal(etapaPostVenta(hechos), null);
});

test('hechosDesdeOperam tolera lista vacia o entrada invalida', () => {
  assert.deepEqual(hechosDesdeOperam([]), {
    pago: { allocated: 0, outstanding: 0, total: 0 },
    tienePedido: false,
    tieneRemision: false,
  });
  assert.deepEqual(hechosDesdeOperam(null), {
    pago: { allocated: 0, outstanding: 0, total: 0 },
    tienePedido: false,
    tieneRemision: false,
  });
});

test('hechosDesdeOperam agrega pagos cuando hay varias facturas/transacciones con saldo', () => {
  const transacciones = [
    { trans_no: 1, trans_type: 13, order_: 50, total_amount: 1000, allocated: 1000, outstanding: 0 },
    { trans_no: 2, trans_type: 13, order_: 50, total_amount: 500, allocated: 200, outstanding: 300 },
  ];
  const hechos = hechosDesdeOperam(transacciones);
  assert.equal(hechos.pago.total, 1500);
  assert.equal(hechos.pago.allocated, 1200);
  assert.equal(hechos.pago.outstanding, 300);
  // Hay saldo pendiente (outstanding > 0) con algo pagado: anticipo parcial.
  assert.equal(etapaPostVenta(hechos), 'anticipo_pagado');
});
