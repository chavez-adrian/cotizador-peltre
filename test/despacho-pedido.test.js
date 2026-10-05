import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { reconciliarOportunidad, reconciliarAviso, cargarFechasEntrega, construirEspejoOperam, esActivaPostVentaCandidata, candidatasDelBarrido, _setRitmo, _reiniciarRitmo } from '../lib/sync-operam-io.js';
import { fechaDespachoDeRemisiones, entregaCompletaDePedido } from '../lib/sync-operam.js';
import { leerArchivoSync } from '../lib/fs-reintento.js';
import { fotoDatos, fijarDatos } from './helpers/datos-aislados.js';

// #534: la Fecha de despacho (la de la ULTIMA remision del pedido principal) y si
// la entrega esta completa (todas las partidas del pedido con qty_sent >= quantity).
// Medido en Operam el 2026-10-05: las remisiones son transacciones tipo 13 con el
// order_ del pedido y su `tran_date`; el detalle del pedido
// (GET /api/v3/sales/sales_order/{n}) trae `detalles[]` con quantity y qty_sent.

const COTS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'cotizaciones.json');
let restaurarDatos;
before(() => {
  _setRitmo({ intervaloMs: 0 });
  restaurarDatos = fotoDatos([COTS_PATH]);
});
after(() => {
  _reiniciarRitmo();
  restaurarDatos();
});

const HTML_ANULADO = '<div class="err_msg">Este pedido ha sido cancelado</div>';
const HTML_VIVO = '<table><tr><td>Pedido de venta</td></tr></table>';

const COMPLETO = { order_no: '6040', detalles: [
  { stk_code: 'A1', quantity: '7', qty_sent: '7' },
  { stk_code: 'A2', quantity: '12', qty_sent: '12' },
] };
// Como el 6282 de la 965: falta 1 de 7 de un vaso.
const PARCIAL = { order_no: '6282', detalles: [
  { stk_code: 'V1', quantity: '7', qty_sent: '6' },
  { stk_code: 'V2', quantity: '20', qty_sent: '20' },
] };

test('fechaDespachoDeRemisiones: la ULTIMA remision del pedido, solo las tipo 13 de ese order_', () => {
  const trans = [
    { type: '13', order_: '6040', reference: '1905', tran_date: '2025-08-25' },
    { type: '13', order_: '6040', reference: '2115', tran_date: '2026-04-23' },
    { type: '10', order_: '6040', reference: 'A1', tran_date: '2026-05-01' },
    { type: '13', order_: '9999', reference: '3000', tran_date: '2026-06-01' },
  ];
  assert.equal(fechaDespachoDeRemisiones(trans, '6040'), '2026-04-23');
  assert.equal(fechaDespachoDeRemisiones(trans, '9999'), '2026-06-01');
  assert.equal(fechaDespachoDeRemisiones(trans, '7000'), null);
  assert.equal(fechaDespachoDeRemisiones([{ type: '13', order_: '6040', tran_date: '' }], '6040'), null);
  assert.equal(fechaDespachoDeRemisiones([{ trans_type: '13', order_: '6040', tran_date: '2026-09-17 00:00:00' }], '6040'), '2026-09-17');
  assert.equal(fechaDespachoDeRemisiones(null, '6040'), null);
});

test('entregaCompletaDePedido: true con todo enviado, false si falta algo, null sin detalle legible', () => {
  assert.equal(entregaCompletaDePedido(COMPLETO), true);
  assert.equal(entregaCompletaDePedido(PARCIAL), false);
  assert.equal(entregaCompletaDePedido({ detalles: [{ quantity: '5', qty_sent: '6' }] }), true, 'de mas tambien es completa');
  assert.equal(entregaCompletaDePedido({ detalles: [] }), null, 'sin partidas no se afirma nada');
  assert.equal(entregaCompletaDePedido({}), null);
  assert.equal(entregaCompletaDePedido(null), null);
  assert.equal(entregaCompletaDePedido({ detalles: [{ quantity: 'x', qty_sent: '1' }] }), null);
});

test('espejo: pedido completo con dos remisiones guarda la fecha de la ULTIMA y entrega completa', () => {
  const trans = [
    { type: '13', order_: '6040', reference: '1905', tran_date: '2025-08-25' },
    { type: '13', order_: '6040', reference: '2115', tran_date: '2026-04-23' },
  ];
  const espejo = construirEspejoOperam(trans, [{ order_no: '6040', total: '100', delivery_date: '2025-08-23' }], '855', COMPLETO);
  assert.equal(espejo.fechaDespacho, '2026-04-23');
  assert.equal(espejo.entregaCompleta, true);
  assert.equal(espejo.fechaEntrega, '2025-08-23', 'la Fecha compromiso de despacho no cambia');
});

test('espejo: una partida pendiente da entrega incompleta con la fecha de la ultima remision', () => {
  const trans = [{ type: '13', order_: '6282', reference: '1972', tran_date: '2025-11-01' }];
  const espejo = construirEspejoOperam(trans, [{ order_no: '6282', total: '100', delivery_date: '2025-10-20' }], '965', PARCIAL);
  assert.equal(espejo.fechaDespacho, '2025-11-01');
  assert.equal(espejo.entregaCompleta, false);
});

test('espejo: sin remision del pedido principal no hay llave de despacho ni de completitud', () => {
  const sinNada = construirEspejoOperam([], [{ order_no: '6282', total: '100' }], '965', PARCIAL);
  assert.equal(Object.hasOwn(sinNada, 'fechaDespacho'), false);
  assert.equal(Object.hasOwn(sinNada, 'entregaCompleta'), false);
  // La remision de OTRO pedido de la cadena no es despacho del principal.
  const deOtro = construirEspejoOperam(
    [{ type: '13', order_: '7290', reference: '2300', tran_date: '2026-08-01' }],
    [{ order_no: '7282', total: '52000' }, { order_no: '7290', total: '3000' }], '861', COMPLETO);
  assert.equal(Object.hasOwn(deOtro, 'fechaDespacho'), false);
  assert.equal(Object.hasOwn(deOtro, 'entregaCompleta'), false);
});

test('espejo: con remision pero sin detalle legible guarda la fecha y no afirma completitud', () => {
  const trans = [{ type: '13', order_: '6282', reference: '1972', tran_date: '2025-11-01' }];
  const espejo = construirEspejoOperam(trans, [{ order_no: '6282', total: '100' }], '965', null);
  assert.equal(espejo.fechaDespacho, '2025-11-01');
  assert.equal(Object.hasOwn(espejo, 'entregaCompleta'), false);
});

function depsGrabando({ transacciones = [], pedidos = [], detalles = {} } = {}) {
  const deps = { espejos: [], detallesLeidos: [], movimientos: [] };
  deps.listarTransacciones = async () => transacciones;
  deps.listarPedidos = async () => pedidos;
  deps.obtenerPedido = async (n) => { deps.detallesLeidos.push(String(n)); return detalles[String(n)] ?? null; };
  deps.abrirSesionWeb = async () => async (transNo) => (String(transNo) === '5960' ? HTML_ANULADO : HTML_VIVO);
  deps.cambiarEtapa = async (id, etapa) => { deps.movimientos.push({ id, etapa }); return true; };
  deps.setEspejoOperam = async (id, espejo) => { deps.espejos.push({ id, espejo }); return true; };
  deps.actualizarDatos = async () => true;
  return deps;
}

const PEDIDO_965 = { order_no: '6282', debtor_no: '40', trans_no_from: '965', total: '8000', ord_date: '2025-10-15', delivery_date: '2025-10-20' };
const FACTURA_965 = { type: '10', order_: '6282', trans_no: '500', reference: 'A900', total_amount: '8000', allocated: '8000' };
const REMISION_965 = { type: '13', order_: '6282', reference: '1972', tran_date: '2025-11-01' };

test('la reconciliacion lee el detalle del pedido cuando ya hay remision y lo guarda en el espejo', async () => {
  const deps = depsGrabando({ pedidos: [PEDIDO_965], transacciones: [FACTURA_965, REMISION_965], detalles: { 6282: PARCIAL } });
  const op = { id: 81, etapa: 'saldo_pagado', folioOperam: '965', fecha: '2025-10-10T18:00:00.000Z', data: {} };
  const res = await reconciliarOportunidad(op, deps);
  assert.equal(res.etapa, 'producto_entregado', 'la etapa no cambia de regla: la primera remision basta');
  assert.deepEqual(deps.detallesLeidos, ['6282']);
  assert.equal(deps.espejos[0].espejo.fechaDespacho, '2025-11-01');
  assert.equal(deps.espejos[0].espejo.entregaCompleta, false);
});

test('sin remision la reconciliacion no lee el detalle del pedido', async () => {
  const deps = depsGrabando({ pedidos: [PEDIDO_965], transacciones: [FACTURA_965], detalles: { 6282: PARCIAL } });
  const op = { id: 82, etapa: 'pedido_liberado', folioOperam: '965', fecha: '2025-10-10T18:00:00.000Z', data: {} };
  await reconciliarOportunidad(op, deps);
  assert.deepEqual(deps.detallesLeidos, []);
  assert.equal(Object.hasOwn(deps.espejos[0].espejo, 'entregaCompleta'), false);
});

test('si el detalle del pedido no se puede leer la reconciliacion falla antes de escribir', async () => {
  const deps = depsGrabando({ pedidos: [PEDIDO_965], transacciones: [FACTURA_965, REMISION_965] });
  deps.obtenerPedido = async () => { throw new Error('Operam 500'); };
  const op = { id: 83, etapa: 'saldo_pagado', folioOperam: '965', fecha: '2025-10-10T18:00:00.000Z', data: {} };
  await assert.rejects(reconciliarOportunidad(op, deps), /Operam 500/);
  assert.deepEqual(deps.espejos, []);
  assert.deepEqual(deps.movimientos, []);
});

test('Producto entregado pagado con entrega incompleta sigue siendo candidata; completa o sin llave, terminal', () => {
  const pe = (espejoOperam) => ({ etapa: 'producto_entregado', data: { pagoSinRegistrar: false, espejoOperam } });
  assert.equal(esActivaPostVentaCandidata(pe({ pedido: '6282', entregaCompleta: false })), true);
  assert.equal(esActivaPostVentaCandidata(pe({ pedido: '6040', entregaCompleta: true })), false);
  // Espejo anterior a #534: terminal como hoy; la carga es la que pone la llave.
  assert.equal(esActivaPostVentaCandidata(pe({ pedido: '6040' })), false);
  // Con remision pero sin saber si se completo (detalle ilegible): se vuelve a mirar.
  assert.equal(esActivaPostVentaCandidata(pe({ pedido: '6282', fechaDespacho: '2025-11-01' })), true);
  assert.equal(esActivaPostVentaCandidata({ etapa: 'cancelada', data: { espejoOperam: { entregaCompleta: false } } }), false);
});

test('el aviso de Remision alcanza a la entregada parcial y pagada, y no a la completa', async () => {
  const parcial = { id: 84, etapa: 'producto_entregado', folioOperam: '965', fecha: '2025-10-10T18:00:00.000Z',
    data: { pagoSinRegistrar: false, espejoOperam: { cotizacion: '965', pedido: '6282', fechaDespacho: '2025-11-01', entregaCompleta: false } } };
  const completa = { id: 85, etapa: 'producto_entregado', folioOperam: '855', fecha: '2025-08-10T18:00:00.000Z',
    data: { pagoSinRegistrar: false, espejoOperam: { cotizacion: '855', pedido: '6040', fechaDespacho: '2026-04-23', entregaCompleta: true } } };
  assert.deepEqual(candidatasDelBarrido([parcial, completa]).map(o => o.id), [84]);

  // Sale la segunda remision y el pedido queda completo.
  const deps = depsGrabando({
    pedidos: [PEDIDO_965],
    transacciones: [FACTURA_965, REMISION_965, { type: '13', order_: '6282', reference: '2400', tran_date: '2026-10-06' }],
    detalles: { 6282: { detalles: [{ quantity: '7', qty_sent: '7' }, { quantity: '20', qty_sent: '20' }] } },
  });
  const res = await reconciliarAviso({ tipo: 'remision' }, [parcial, completa], deps);
  assert.deepEqual(res.map(r => r.id), [84]);
  assert.equal(deps.espejos[0].espejo.fechaDespacho, '2026-10-06');
  assert.equal(deps.espejos[0].espejo.entregaCompleta, true);
  assert.deepEqual(deps.movimientos, [], 'la etapa no se mueve');
});

// --- La carga de #531 extendida: tambien la fecha de despacho y la completitud ---

const PEDIDOS_CARGA = [
  { order_no: '7650', debtor_no: '50', trans_no_from: '1235', total: '20000', ord_date: '2026-09-01', delivery_date: '2026-10-06' },
  { order_no: '6282', debtor_no: '40', trans_no_from: '965', total: '8000', ord_date: '2025-10-15', delivery_date: '2025-10-20' },
  { order_no: '7801', debtor_no: '33', trans_no_from: '1300', total: '62300', ord_date: '2026-09-25', delivery_date: '2026-10-20' },
];
const TRANS_CARGA = {
  50: [{ type: '13', order_: '7650', reference: '2233', tran_date: '2026-09-17' }],
  40: [REMISION_965],
  33: [],
};

function cotizacionesCarga() {
  return [
    { id: 1, fecha: '2026-08-25T18:00:00.000Z', etapa: 'producto_entregado', folioOperam: '1235', cliente: 'Cafe Uno',
      data: { pagoSinRegistrar: false, espejoOperam: { cotizacion: '1235', pedido: '7650', fechaEntrega: '2026-10-06', remisiones: ['2233'], pago: 'pagado' } } },
    { id: 2, fecha: '2025-10-10T18:00:00.000Z', etapa: 'producto_entregado', folioOperam: '965', cliente: 'Bar Dos',
      data: { pagoSinRegistrar: false, espejoOperam: { cotizacion: '965', pedido: '6282', fechaEntrega: '2025-10-20', remisiones: ['1972'], pago: 'pagado' } } },
    { id: 3, fecha: '2026-09-20T18:00:00.000Z', etapa: 'pedido_liberado', folioOperam: '1300', cliente: 'Hotel Casa Azul',
      data: { espejoOperam: { cotizacion: '1300', pedido: '7801', fechaEntrega: '2026-10-20' } } },
  ];
}

function depsCarga(cotizaciones) {
  const deps = { escrituras: [] };
  deps.listarCotizaciones = async () => cotizaciones;
  deps.listarPedidos = async () => PEDIDOS_CARGA;
  deps.listarTransacciones = async ({ customerId }) => TRANS_CARGA[customerId] || [];
  deps.obtenerPedido = async (n) => (String(n) === '6282' ? PARCIAL : { detalles: [{ quantity: '3', qty_sent: '3' }] });
  deps.abrirSesionWeb = async () => async (transNo) => (String(transNo) === '5960' ? HTML_ANULADO : HTML_VIVO);
  deps.setEntregaPedido = async (id, campos) => { deps.escrituras.push({ id, campos }); return true; };
  deps.cambiarEtapa = async () => { throw new Error('la carga no mueve etapas'); };
  deps.setEspejoOperam = async () => { throw new Error('la carga no reescribe el espejo'); };
  deps.actualizarDatos = async () => { throw new Error('la carga no escribe otros datos'); };
  return deps;
}

test('carga en seco: lista la fecha de despacho y la completitud que escribiria, sin escribir', async () => {
  const deps = depsCarga(cotizacionesCarga());
  const r = await cargarFechasEntrega({ seco: true }, deps);
  assert.deepEqual(deps.escrituras, []);
  const porId = Object.fromEntries(r.plan.map(f => [f.id, f]));
  // La 1235: "Requerido para" 06/oct, su remision 2233 salio el 17/sep.
  assert.deepEqual(
    [porId[1].despachoAntes, porId[1].despachoDespues, porId[1].completaAntes, porId[1].completaDespues, porId[1].accion],
    [null, '2026-09-17', null, true, 'escribir']);
  assert.deepEqual([porId[2].despachoDespues, porId[2].completaDespues, porId[2].accion], ['2025-11-01', false, 'escribir']);
  assert.deepEqual([porId[3].despachoDespues, porId[3].completaDespues, porId[3].accion], [null, null, 'igual']);
  assert.equal(r.resumen.escribir, 2);
});

test('carga aplicada: escribe solo las llaves que cambian', async () => {
  const deps = depsCarga(cotizacionesCarga());
  await cargarFechasEntrega({ seco: false }, deps);
  assert.deepEqual(deps.escrituras, [
    { id: 1, campos: { fechaDespacho: '2026-09-17', entregaCompleta: true } },
    { id: 2, campos: { fechaDespacho: '2025-11-01', entregaCompleta: false } },
  ]);
});

test('carga aplicada sobre el store: solo cambian las llaves de entrega del espejo, ninguna etapa', async () => {
  const antes = cotizacionesCarga();
  fijarDatos(COTS_PATH, antes);
  const deps = depsCarga([]);
  delete deps.listarCotizaciones;
  delete deps.setEntregaPedido;

  await cargarFechasEntrega({ seco: true }, deps);
  assert.deepEqual(JSON.parse(leerArchivoSync(COTS_PATH)), antes, 'en seco el archivo no cambia');

  await cargarFechasEntrega({ seco: false }, deps);
  const despues = JSON.parse(leerArchivoSync(COTS_PATH));
  const esperado = cotizacionesCarga();
  Object.assign(esperado[0].data.espejoOperam, { fechaDespacho: '2026-09-17', entregaCompleta: true });
  Object.assign(esperado[1].data.espejoOperam, { fechaDespacho: '2025-11-01', entregaCompleta: false });
  assert.deepEqual(despues, esperado);
  assert.equal(despues[1].data.espejoOperam.entregaCompleta, false, 'booleano, no texto');
});
