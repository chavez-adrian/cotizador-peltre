import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { reconciliarOportunidad, cargarFechasEntrega, _setRitmo, _reiniciarRitmo } from '../lib/sync-operam-io.js';
import { fechaEntregaDePedido } from '../lib/sync-operam.js';
import { leerArchivoSync } from '../lib/fs-reintento.js';
import { fotoDatos, fijarDatos } from './helpers/datos-aislados.js';

// #531: la fecha de entrega del pedido. Operam la trae en el listado de pedidos
// (`delivery_date`, medido el 2026-10-05: AAAA-MM-DD en los 100 pedidos de
// septiembre) y el sync la guarda en el espejo, la del pedido PRINCIPAL de la
// cotizacion (ADR-0021).

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

function depsGrabando({ transacciones = [], pedidos = [] } = {}) {
  const deps = { movimientos: [], espejos: [], datos: [] };
  deps.listarTransacciones = async () => transacciones;
  deps.listarPedidos = async () => pedidos;
  deps.abrirSesionWeb = async () => async (transNo) => (String(transNo) === '5960' ? HTML_ANULADO : HTML_VIVO);
  deps.cambiarEtapa = async (id, etapa, evento) => { deps.movimientos.push({ id, etapa, evento }); return true; };
  deps.setEspejoOperam = async (id, espejo) => { deps.espejos.push({ id, espejo }); return true; };
  deps.actualizarDatos = async (id, campos) => { deps.datos.push({ id, campos }); return true; };
  return deps;
}

test('fechaEntregaDePedido: el dia AAAA-MM-DD del pedido, o null si no hay uno legible', () => {
  assert.equal(fechaEntregaDePedido({ delivery_date: '2026-11-03' }), '2026-11-03');
  assert.equal(fechaEntregaDePedido({ delivery_date: '2026-11-03 00:00:00' }), '2026-11-03');
  assert.equal(fechaEntregaDePedido({ delivery_date: '' }), null);
  assert.equal(fechaEntregaDePedido({ delivery_date: null }), null);
  assert.equal(fechaEntregaDePedido({}), null);
  assert.equal(fechaEntregaDePedido({ delivery_date: '0000-00-00' }), null);
  assert.equal(fechaEntregaDePedido({ delivery_date: '2026-02-31' }), null);
  assert.equal(fechaEntregaDePedido(null), null);
});

test('una reconciliacion con pedido guarda la fecha de entrega del pedido en el espejo', async () => {
  // La 1293 (registro real) y su pedido 7722, con delivery_date 2026-11-03.
  const deps = depsGrabando({
    pedidos: [{ order_no: '7722', debtor_no: '228', trans_no_from: '1293', total: '18951', ord_date: '2026-09-23', delivery_date: '2026-11-03' }],
  });
  const op = { id: 70, etapa: 'seguimiento', folioOperam: '1293', fecha: '2026-09-20T18:00:00.000Z', data: {} };
  const res = await reconciliarOportunidad(op, deps);
  assert.equal(res.etapa, 'pedido_liberado');
  assert.equal(deps.espejos[0].espejo.pedido, '7722');
  assert.equal(deps.espejos[0].espejo.fechaEntrega, '2026-11-03');
});

test('con varios pedidos del mismo folio gana la fecha del principal, no la del primero del listado', async () => {
  // Como la 861: el 7321 de total cero viene primero, el principal es el 7282 con total.
  const deps = depsGrabando({
    pedidos: [
      { order_no: '7321', debtor_no: '13', trans_no_from: '861', total: '0', ord_date: '2026-06-01', delivery_date: '2026-06-30' },
      { order_no: '7282', debtor_no: '13', trans_no_from: '861', total: '52000', ord_date: '2026-05-20', delivery_date: '2026-07-15' },
      { order_no: '7290', debtor_no: '13', trans_no_from: '861', total: '3000', ord_date: '2026-05-25', delivery_date: '2026-08-01' },
    ],
  });
  const op = { id: 71, etapa: 'seguimiento', folioOperam: '861', fecha: '2026-05-10T18:00:00.000Z', data: {} };
  await reconciliarOportunidad(op, deps);
  assert.equal(deps.espejos[0].espejo.pedido, '7282');
  assert.equal(deps.espejos[0].espejo.fechaEntrega, '2026-07-15');
});

test('un pedido sin fecha no guarda la llave y no rompe la reconciliacion', async () => {
  const deps = depsGrabando({
    pedidos: [{ order_no: '7626', debtor_no: '504', trans_no_from: '1237', total: '41390.02', ord_date: '2026-09-03', delivery_date: '' }],
  });
  const op = { id: 72, etapa: 'seguimiento', folioOperam: '1237', fecha: '2026-08-28T18:00:00.000Z', data: {} };
  const res = await reconciliarOportunidad(op, deps);
  assert.equal(res.etapa, 'pedido_liberado');
  assert.equal(deps.espejos[0].espejo.pedido, '7626');
  assert.equal(Object.hasOwn(deps.espejos[0].espejo, 'fechaEntrega'), false);
});

// --- La carga de las cotizaciones que YA tenian pedido (#531) ---
//
// El barrido del sync salta Producto entregado ya pagado, asi que esas no
// recibirian nunca la fecha. La carga lee los pedidos UNA vez, liga cada
// cotizacion por documento (la misma regla del sync, ADR-0021) y escribe SOLO
// `data.espejoOperam.fechaEntrega`: ni etapa, ni el resto del espejo, ni banderas.

const PEDIDOS_CARGA = [
  // 1251 entregada y pagada: el barrido la salta, la carga no.
  { order_no: '7702', debtor_no: '30', trans_no_from: '1251', total: '33100', ord_date: '2026-08-20', delivery_date: '2026-09-28' },
  // 1288 ya tiene la fecha correcta.
  { order_no: '7772', debtor_no: '31', trans_no_from: '1288', total: '41200', ord_date: '2026-09-10', delivery_date: '2026-10-05' },
  // 1279: el pedido no trae fecha.
  { order_no: '7750', debtor_no: '32', trans_no_from: '1279', total: '9870', ord_date: '2026-09-05', delivery_date: '' },
  // 1300: cambio la fecha en Operam.
  { order_no: '7801', debtor_no: '33', trans_no_from: '1300', total: '62300', ord_date: '2026-09-25', delivery_date: '2026-10-20' },
];

function cotizacionesCarga() {
  return [
    { id: 1, fecha: '2026-08-10T18:00:00.000Z', etapa: 'producto_entregado', folioOperam: '1251', cliente: 'Hacienda Los Arcos',
      data: { pagoSinRegistrar: false, espejoOperam: { cotizacion: '1251', pedido: '7702', remisiones: ['R1'], pago: 'pagado' } } },
    { id: 2, fecha: '2026-09-01T18:00:00.000Z', etapa: 'pedido_liberado', folioOperam: '1288', cliente: 'Grupo Mesa Larga',
      data: { espejoOperam: { cotizacion: '1288', pedido: '7772', fechaEntrega: '2026-10-05' } } },
    { id: 3, fecha: '2026-09-01T18:00:00.000Z', etapa: 'pedido_liberado', folioOperam: '1279', cliente: 'Cocina Economica',
      data: { espejoOperam: { cotizacion: '1279', pedido: '7750' } } },
    { id: 4, fecha: '2026-09-20T18:00:00.000Z', etapa: 'anticipo_pagado', folioOperam: '1300', cliente: 'Hotel Casa Azul',
      data: { huboAnticipo: true, espejoOperam: { cotizacion: '1300', pedido: '7801', pago: 'anticipo', fechaEntrega: '2026-10-15' } } },
    // Seguimiento sin pedido en Operam: se revisa y no se escribe nada.
    { id: 5, fecha: '2026-09-28T18:00:00.000Z', etapa: 'seguimiento', folioOperam: '1310', cliente: 'Restaurante', data: {} },
    // Una salida no es candidata aunque su folio tenga pedido.
    { id: 6, fecha: '2026-08-10T18:00:00.000Z', etapa: 'perdida', folioOperam: '1251', cliente: 'Otra', data: {} },
  ];
}

function depsCarga(cotizaciones) {
  const deps = { escrituras: [] };
  deps.listarCotizaciones = async () => cotizaciones;
  deps.listarPedidos = async () => PEDIDOS_CARGA;
  deps.listarTransacciones = async () => { throw new Error('la carga no lee transacciones'); };
  deps.abrirSesionWeb = async () => async (transNo) => (String(transNo) === '5960' ? HTML_ANULADO : HTML_VIVO);
  deps.setFechaEntregaPedido = async (id, fecha) => { deps.escrituras.push({ id, fecha }); return true; };
  deps.cambiarEtapa = async () => { throw new Error('la carga no mueve etapas'); };
  deps.setEspejoOperam = async () => { throw new Error('la carga no reescribe el espejo'); };
  deps.actualizarDatos = async () => { throw new Error('la carga no escribe otros datos'); };
  return deps;
}

test('carga en seco: lista que escribiria, por cotizacion, y no escribe nada', async () => {
  const deps = depsCarga(cotizacionesCarga());
  const r = await cargarFechasEntrega({ seco: true }, deps);
  assert.equal(r.seco, true);
  assert.deepEqual(deps.escrituras, []);
  const porId = Object.fromEntries(r.plan.map(f => [f.id, f]));
  assert.deepEqual(porId[1], { id: 1, folio: '1251', etapa: 'producto_entregado', pedido: '7702', fechaAntes: null, fechaDespues: '2026-09-28', accion: 'escribir' });
  assert.equal(porId[2].accion, 'igual');
  assert.equal(porId[3].accion, 'sin-fecha');
  assert.deepEqual([porId[4].fechaAntes, porId[4].fechaDespues, porId[4].accion], ['2026-10-15', '2026-10-20', 'escribir']);
  assert.equal(porId[5], undefined, 'sin pedido no sale en el plan');
  assert.equal(porId[6], undefined, 'una salida no es candidata');
  assert.deepEqual(r.resumen, { revisadas: 5, escribir: 2, igual: 1, sinFecha: 1, sinPedido: 1 });
  assert.equal(r.escritas, 0);
});

test('carga aplicada: escribe solo las de accion escribir', async () => {
  const deps = depsCarga(cotizacionesCarga());
  const r = await cargarFechasEntrega({ seco: false }, deps);
  assert.deepEqual(deps.escrituras, [{ id: 1, fecha: '2026-09-28' }, { id: 4, fecha: '2026-10-20' }]);
  assert.equal(r.escritas, 2);
  assert.equal(r.plan.find(f => f.id === 1).escrito, true);
});

test('carga: un pedido anulado no da fecha; si la consulta de anulacion falla la cotizacion sale en errores', async () => {
  const cots = [{ id: 9, fecha: '2026-09-01T18:00:00.000Z', etapa: 'pedido_liberado', folioOperam: '1400', data: {} }];
  const anulado = depsCarga(cots);
  anulado.listarPedidos = async () => [{ order_no: '7900', trans_no_from: '1400', total: '0', ord_date: '2026-09-02', delivery_date: '2026-10-30' }];
  anulado.abrirSesionWeb = async () => async () => HTML_ANULADO;
  const r1 = await cargarFechasEntrega({ seco: false }, anulado);
  assert.deepEqual(anulado.escrituras, []);
  assert.equal(r1.resumen.sinPedido, 1);

  const caida = depsCarga(cots);
  caida.listarPedidos = anulado.listarPedidos;
  caida.abrirSesionWeb = async () => { throw new Error('web caida'); };
  const r2 = await cargarFechasEntrega({ seco: false }, caida);
  assert.deepEqual(caida.escrituras, []);
  assert.equal(r2.errores.length, 1);
  assert.equal(r2.errores[0].id, 9);
});

// Contra el store REAL (fallback JSON): la carga aplicada deja cada registro
// identico salvo `data.espejoOperam.fechaEntrega`; ninguna etapa cambia.
test('carga aplicada sobre el store: solo cambia la fecha de entrega, ninguna etapa', async () => {
  const ruta = COTS_PATH;
  const antes = cotizacionesCarga();
  fijarDatos(ruta, antes);
  const deps = depsCarga([]);
  delete deps.listarCotizaciones;
  delete deps.setFechaEntregaPedido;

  const seco = await cargarFechasEntrega({ seco: true }, deps);
  assert.equal(seco.resumen.escribir, 2);
  assert.deepEqual(JSON.parse(leerArchivoSync(ruta)), antes, 'en seco el archivo no cambia');

  await cargarFechasEntrega({ seco: false }, deps);
  const despues = JSON.parse(leerArchivoSync(ruta));
  const esperado = cotizacionesCarga();
  esperado[0].data.espejoOperam.fechaEntrega = '2026-09-28';
  esperado[3].data.espejoOperam.fechaEntrega = '2026-10-20';
  assert.deepEqual(despues, esperado);
  assert.deepEqual(despues.map(c => c.etapa), antes.map(c => c.etapa));
});
