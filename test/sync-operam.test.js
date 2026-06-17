import { test } from 'node:test';
import assert from 'node:assert/strict';

import { etapaPostVenta, hechosDesdeOperam } from '../lib/sync-operam.js';

// Nucleo puro del sync post-venta con Operam (issue #62, AC3; CONTEXT.md
// "Sincronizacion post-venta con Operam"). Estos tests prueban la funcion pura
// hechos -> etapa post-venta destino y la normalizacion de transacciones crudas
// de Operam a esos hechos (mapeo REAL de peltre-operam.md seccion 12). Sin red,
// sin IO, sin escritura.
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

// --- Regla de pago derivada de allocated vs total, NO de outstanding ---
// (el outstanding del listado de Operam no es fiable; sesion HITL #62)

test('etapaPostVenta: factura pagada al 100% (allocated=total) con outstanding espurio -> saldo_pagado', () => {
  // Caso real El Pendulo: allocated == total pero outstanding sale != 0 (127) en el
  // listado. Con la regla por outstanding seria anticipo; por allocated vs total es saldo.
  const hechos = {
    pago: { allocated: 16954, outstanding: 127, total: 16954 },
    tienePedido: false,
    tieneRemision: false,
  };
  assert.equal(etapaPostVenta(hechos), 'saldo_pagado');
});

test('etapaPostVenta: pago de menos hasta 1% se considera liquidado (saldo_pagado)', () => {
  // Cliente paga 0.5% de menos por error humano: dentro de la tolerancia.
  const hechos = {
    pago: { allocated: 995, outstanding: 5, total: 1000 },
    tienePedido: false,
    tieneRemision: false,
  };
  assert.equal(etapaPostVenta(hechos), 'saldo_pagado');
});

test('etapaPostVenta: pago de menos mayor al 1% sigue siendo anticipo_pagado', () => {
  // Paga 2% de menos: fuera de la tolerancia, aun es anticipo.
  const hechos = {
    pago: { allocated: 980, outstanding: 20, total: 1000 },
    tienePedido: false,
    tieneRemision: false,
  };
  assert.equal(etapaPostVenta(hechos), 'anticipo_pagado');
});

test('etapaPostVenta: pago de mas (allocated > total) se considera liquidado (saldo_pagado)', () => {
  const hechos = {
    pago: { allocated: 1010, outstanding: 0, total: 1000 },
    tienePedido: false,
    tieneRemision: false,
  };
  assert.equal(etapaPostVenta(hechos), 'saldo_pagado');
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

// --- Normalizacion: transacciones crudas de Operam -> hechos ---
// Mapeo REAL de Operam (peltre-operam.md seccion 12; FrontAccounting): trans_type
// 10=FACTURA (con CFDI; recibe el `allocated`/`outstanding` del pago), 11=nota de
// credito, 12=pago, 13=REMISION (sin CFDI), 30=PEDIDO (Sales Order). La llave que
// une la cadena es `order_`/`order_no`. Los montos de pago se leen de la FACTURA
// (10), NO del tipo 13. tienePedido = hay Sales Order (30); tieneRemision = hay
// transaccion tipo 13.

test('hechosDesdeOperam normaliza un conjunto de transacciones de Operam a hechos', () => {
  // Forma real (peltre-operam.md 12): cada transaccion comparte order_. Una
  // oportunidad liquidada con pedido (30), factura (10) liquidada y remision (13).
  const transacciones = [
    { type: '30', trans_no: '7300', order_: '7139', total_amount: '1000', allocated: '0', outstanding: '0' },
    { type: '10', trans_no: '6782', order_: '7139', total_amount: '1000', allocated: '1000', outstanding: '0', uuid_sat_manual: '9d5c5142', digital: '1' },
    { type: '13', trans_no: '7269', order_: '7139', total_amount: '1000', allocated: '0', outstanding: '0', uuid_sat_manual: '', digital: '0' },
  ];
  const hechos = hechosDesdeOperam(transacciones);
  assert.equal(hechos.tienePedido, true);
  assert.equal(hechos.tieneRemision, true);
  assert.equal(hechos.pago.total, 1000);
  assert.equal(hechos.pago.allocated, 1000);
  assert.equal(hechos.pago.outstanding, 0);
  assert.equal(etapaPostVenta(hechos), 'producto_entregado');
});

test('hechosDesdeOperam: el pago se lee de la factura (10), no de la remision (13)', () => {
  // Caso real El Pendulo: factura (10) liquidada con allocated=total; remision (13)
  // sin montos de pago (allocated/outstanding 0). Los montos vienen de la factura.
  const transacciones = [
    { type: '10', trans_no: '6735', order_: '7077', total_amount: '16954', allocated: '16954', outstanding: '0' },
    { type: '13', trans_no: '7329', order_: '7077', total_amount: '16954', allocated: '0', outstanding: '0' },
  ];
  const hechos = hechosDesdeOperam(transacciones);
  assert.equal(hechos.pago.total, 16954);
  assert.equal(hechos.pago.allocated, 16954);
  assert.equal(hechos.pago.outstanding, 0);
  assert.equal(hechos.tieneRemision, true);
  assert.equal(hechos.tienePedido, false);
});

test('hechosDesdeOperam: anticipo parcial (factura con saldo) sin pedido ni remision -> anticipo_pagado', () => {
  const transacciones = [
    { type: '10', trans_no: '6800', order_: '7200', total_amount: '2000', allocated: '500', outstanding: '1500' },
  ];
  const hechos = hechosDesdeOperam(transacciones);
  assert.equal(hechos.tienePedido, false);
  assert.equal(hechos.tieneRemision, false);
  assert.equal(hechos.pago.allocated, 500);
  assert.equal(hechos.pago.outstanding, 1500);
  assert.equal(etapaPostVenta(hechos), 'anticipo_pagado');
});

test('hechosDesdeOperam: pedido (30) sin pago ni remision -> pedido_liberado', () => {
  const transacciones = [
    { type: '30', trans_no: '7300', order_: '7400', total_amount: '1500', allocated: '0', outstanding: '0' },
  ];
  const hechos = hechosDesdeOperam(transacciones);
  assert.equal(hechos.tienePedido, true);
  assert.equal(hechos.tieneRemision, false);
  assert.equal(etapaPostVenta(hechos), 'pedido_liberado');
});

test('hechosDesdeOperam: nota de credito (11) y pago suelto (12) no son pedido ni remision', () => {
  // El tipo 11 (nota de credito) y 12 (pago, order_=0) no deben marcar pedido ni
  // remision ni mover montos de la oportunidad (el saldo vive en la factura 10).
  const transacciones = [
    { type: '11', trans_no: '89', order_: '0', total_amount: '6153', allocated: '0', outstanding: '81' },
    { type: '12', trans_no: '6983', order_: '0', total_amount: '8477', allocated: '8477', outstanding: '' },
  ];
  const hechos = hechosDesdeOperam(transacciones);
  assert.equal(hechos.tienePedido, false);
  assert.equal(hechos.tieneRemision, false);
  assert.equal(hechos.pago.total, 0);
  assert.equal(hechos.pago.allocated, 0);
  assert.equal(etapaPostVenta(hechos), null);
});

test('hechosDesdeOperam: solo factura sin pago (allocated 0) -> hechos sin etapa', () => {
  const transacciones = [
    { type: '10', trans_no: '6900', order_: '7300', total_amount: '1500', allocated: '0', outstanding: '1500' },
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

test('hechosDesdeOperam agrega pagos cuando hay varias facturas (10) con saldo', () => {
  const transacciones = [
    { type: '10', trans_no: '1', order_: '50', total_amount: '1000', allocated: '1000', outstanding: '0' },
    { type: '10', trans_no: '2', order_: '51', total_amount: '500', allocated: '200', outstanding: '300' },
  ];
  const hechos = hechosDesdeOperam(transacciones);
  assert.equal(hechos.pago.total, 1500);
  assert.equal(hechos.pago.allocated, 1200);
  assert.equal(hechos.pago.outstanding, 300);
  // Hay saldo pendiente (outstanding > 0) con algo pagado: anticipo parcial.
  assert.equal(etapaPostVenta(hechos), 'anticipo_pagado');
});

test('hechosDesdeOperam acepta tanto `type` (string) como `trans_type` (numero)', () => {
  // listar_transacciones devuelve `type` como string; mantenemos compatibilidad
  // con `trans_type` numerico que ya usaba el nucleo.
  const conType = hechosDesdeOperam([{ type: '30', order_: '1' }]);
  const conTransType = hechosDesdeOperam([{ trans_type: 30, order_: '1' }]);
  assert.equal(conType.tienePedido, true);
  assert.equal(conTransType.tienePedido, true);
});
