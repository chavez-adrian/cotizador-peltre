import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  barrerSyncOperam, ultimoBarridoSync, barridoSyncEnCurso,
  barridoDiarioEncendido, msHastaProximoBarrido, programarBarridoSync, VARIABLE_BARRIDO_DIARIO,
  _setRitmo, _reiniciarRitmo,
} from '../lib/sync-operam-io.js';
import { enTurno } from '../lib/turno-barridos.js';

// #509: el barrido del sync post-venta es la red de seguridad que no depende de que
// los avisos de Operam lleguen. Lee los pedidos UNA vez por corrida, liga por
// documento todas las cotizaciones activas y solo relee la cadena de las que tienen
// pedido. Los folios son los del comentario "Evaluacion verificada" de #506.

before(() => _setRitmo({ intervaloMs: 0 }));
after(() => _reiniciarRitmo());

const HTML_ANULADO = '<div class="err_msg">Este pedido ha sido cancelado</div>';
const HTML_VIVO = '<table><tr><td>Pedido de venta</td></tr></table>';

const PEDIDOS = [
  { order_no: '7762', trans_type: '30', debtor_no: '537', trans_no_from: '1309', total: '3675.46', ord_date: '2026-09-30' },
  { order_no: '7626', trans_type: '30', debtor_no: '504', trans_no_from: '1237', total: '41390.02', ord_date: '2026-09-03' },
  { order_no: '7616', trans_type: '30', debtor_no: '256', trans_no_from: '1239', total: '0', ord_date: '2026-08-31' },
  { order_no: '7100', trans_type: '30', debtor_no: '345', trans_no_from: '1050', total: '5000', ord_date: '2026-06-02' },
];
const TRANSACCIONES = {
  537: [
    { type: '10', order_: '7762', trans_no: '6990', reference: 'A2100', total_amount: '3675.46', allocated: '3675.46', outstanding: '0', debtor_no: '537' },
    { type: '13', order_: '7762', trans_no: '7700', reference: '2400', debtor_no: '537' },
  ],
};

// 1309 y 1237 sin RFC (el defecto 3B de #506: la ruta vieja exigia RFC), 1239 con su
// unico pedido anulado, 1197 sin pedido propio, una PRE sin folio y una salida.
const COT = {
  c1309: { id: 132, etapa: 'seguimiento', folioOperam: '1309', fecha: '2026-09-30T17:20:28.903Z', data: { cliente: { customerId: '537' } } },
  c1237: { id: 40, etapa: 'seguimiento', folioOperam: '1237', fecha: '2026-08-28T18:00:00.000Z', data: { cliente: { customerId: '504' } } },
  c1239: { id: 73, etapa: 'seguimiento', folioOperam: '1239', fecha: '2026-08-28T18:00:00.000Z', data: { cliente: { customerId: '499', rfc: 'XAXX010101000' } } },
  c1197: { id: 101, etapa: 'seguimiento', folioOperam: '1197', fecha: '2026-07-20T18:00:00.000Z', data: { cliente: { rfc: 'CPE921211N76' } } },
  pre: { id: 9, etapa: 'seguimiento', fecha: '2025-01-10T18:00:00.000Z', data: { cliente: {} } },
  perdida: { id: 8, etapa: 'perdida', folioOperam: '1100', fecha: '2025-02-10T18:00:00.000Z', data: {} },
};

function deps({ cotizaciones = Object.values(COT), pedidos = PEDIDOS, falla = {} } = {}) {
  const d = { movimientos: [], espejos: [], datos: [], consultasTx: [], consultasPed: [], consultasWeb: [] };
  d.listarCotizaciones = async () => cotizaciones;
  d.listarPedidos = async (q) => { d.consultasPed.push(q); return pedidos; };
  d.listarTransacciones = async (q) => { d.consultasTx.push(q); return TRANSACCIONES[q.customerId] || []; };
  d.abrirSesionWeb = async () => async (transNo) => {
    d.consultasWeb.push(String(transNo));
    if (falla.web) throw new Error('web legacy caida');
    return String(transNo) === '5960' || String(transNo) === '7616' ? HTML_ANULADO : HTML_VIVO;
  };
  d.cambiarEtapa = async (id, etapa, evento) => {
    if (falla.escritura === id) throw new Error('Neon caido');
    d.movimientos.push({ id, etapa, evento });
    return true;
  };
  d.setEspejoOperam = async (id, espejo) => { d.espejos.push({ id, espejo }); return true; };
  d.actualizarDatos = async (id, campos) => { d.datos.push({ id, campos }); return true; };
  return d;
}

const fila = (r, folio) => r.plan.find(f => f.folio === folio);

test('AC1/AC2: los pedidos se leen una vez desde la cotizacion activa mas antigua y la cadena solo de las que tienen pedido', async () => {
  const d = deps();
  const r = await barrerSyncOperam({ seco: true }, d);
  // Una sola barrida (una pagina en este mock) que arranca 60 dias antes de la
  // activa con folio mas antigua (1197, 2026-07-20); ni la PRE ni la salida la estiran.
  assert.equal(d.consultasPed.length, 1);
  assert.equal(d.consultasPed[0].desde, '2026-05-21');
  // Transacciones: solo los clientes de los pedidos vivos (537 y 504); la 1197 y la
  // 1239 (anulado) no cuestan ninguna lectura de cadena.
  assert.deepEqual(d.consultasTx.map(q => q.customerId).sort(), ['504', '537']);
  assert.equal(r.revisadas, 4);
  assert.equal(r.ligadas, 2);
  assert.equal(r.sinPedido, 1);
});

test('candidatas: entra el pedido explicito sin folio; la entregada y pagada no se relee ni estira la barrida', async () => {
  const explicito = { id: 55, etapa: 'seguimiento', fecha: '2026-08-01T18:00:00.000Z', data: { orderOperam: '7100' } };
  const entregada = { id: 7, etapa: 'producto_entregado', folioOperam: '1050', fecha: '2025-03-01T18:00:00.000Z', data: {} };
  const d = deps({ cotizaciones: [COT.c1309, explicito, entregada] });
  const r = await barrerSyncOperam({ seco: true }, d);
  assert.equal(d.consultasPed[0].desde, '2026-06-02', '60 dias antes de la 55, no de la entregada de 2025');
  assert.deepEqual(r.plan.map(f => [f.id, f.pedido]), [[132, '7762'], [55, '7100']]);
  assert.equal(r.revisadas, 2);
});

test('AC6: en seco devuelve el plan (que liga, a que pedido, a que etapa) y no escribe nada', async () => {
  const d = deps();
  const r = await barrerSyncOperam({ seco: true }, d);
  assert.equal(r.seco, true);
  assert.deepEqual(d.movimientos, []);
  assert.deepEqual(d.espejos, []);
  assert.deepEqual(d.datos, []);
  const f1309 = fila(r, '1309');
  assert.equal(f1309.id, 132);
  assert.equal(f1309.pedido, '7762');
  assert.equal(f1309.etapaAntes, 'seguimiento');
  assert.equal(f1309.etapaDespues, 'producto_entregado');
  assert.equal(fila(r, '1237').pedido, '7626');
  assert.equal(fila(r, '1237').etapaDespues, 'pedido_liberado');
  // #512: la 1239 sale con su pedido anulado y sin moverse.
  const f1239 = fila(r, '1239');
  assert.deepEqual(f1239.anulados, ['7616']);
  assert.equal(f1239.motivo, 'pedido-anulado');
  assert.equal(f1239.etapaDespues, 'seguimiento');
  assert.equal(fila(r, '1197'), undefined, 'la que no tiene pedido va en el conteo, no en el plan');
  assert.equal(r.movidas, 2, 'en seco: las que se moverian');
  assert.deepEqual(r.errores, []);
});

test('AC7/AC9: aplicado escribe espejo y etapa con su evento sync_operam fechado, y queda como la ultima corrida', async () => {
  const d = deps();
  const r = await barrerSyncOperam({}, d);
  assert.equal(r.seco, false);
  assert.equal(r.movidas, 2);
  assert.deepEqual(d.movimientos.map(m => [m.id, m.etapa]).sort(), [[132, 'producto_entregado'], [40, 'pedido_liberado']]);
  for (const m of d.movimientos) {
    assert.equal(m.evento.tipo, 'sync_operam');
    assert.equal(m.evento.etapa, m.etapa);
    assert.ok(!Number.isNaN(Date.parse(m.evento.fecha)));
  }
  assert.deepEqual(d.espejos.map(e => e.id).sort(), [132, 40]);
  assert.equal(fila(r, '1309').escrito, true);
  const ultima = ultimoBarridoSync();
  assert.equal(ultima, r);
  assert.ok(ultima.inicio && ultima.fin);
});

test('AC5: el error de una cotizacion no aborta la corrida y no cuenta como revisada', async () => {
  // La web legacy cae: la 1239 (pedido de total 0) no se puede evaluar; las demas si.
  const d = deps({ falla: { web: true } });
  const r = await barrerSyncOperam({}, d);
  assert.equal(r.errores.length, 1);
  assert.equal(r.errores[0].id, 73);
  assert.equal(r.errores[0].folio, '1239');
  assert.match(r.errores[0].error, /web legacy caida/);
  assert.equal(r.revisadas, 3);
  assert.equal(r.movidas, 2);
});

test('AC5: una escritura que falla queda en errores con su id y las demas se escriben', async () => {
  const d = deps({ falla: { escritura: 132 } });
  const r = await barrerSyncOperam({}, d);
  assert.deepEqual(r.errores.map(e => e.id), [132]);
  assert.match(r.errores[0].error, /Neon caido/);
  assert.equal(fila(r, '1309').escrito, false);
  assert.equal(r.movidas, 1);
  assert.deepEqual(d.movimientos.map(m => m.id), [40]);
});

test('si no se pueden leer los pedidos la corrida termina con su error y sin escribir', async () => {
  const d = deps();
  d.listarPedidos = async () => { throw new Error('Operam 429'); };
  const r = await barrerSyncOperam({}, d);
  assert.match(r.error, /Operam 429/);
  assert.equal(r.revisadas, 0);
  assert.deepEqual(d.movimientos, []);
  assert.deepEqual(d.espejos, []);
});

test('AC3: nunca dos barridos del sync a la vez, y espera el turno del barrido de post-fixes', async () => {
  let soltar;
  const postfix = enTurno('postfix-quotes', () => new Promise(res => { soltar = res; }));
  const d = deps();
  const corrida = barrerSyncOperam({ seco: true }, d);
  assert.equal(barridoSyncEnCurso(), true);
  assert.deepEqual(await barrerSyncOperam({ seco: true }, deps()), { omitido: true });
  await new Promise(res => setImmediate(res));
  assert.deepEqual(d.consultasPed, [], 'no lee Operam mientras el barrido de post-fixes tiene el turno');
  soltar();
  await postfix;
  const r = await corrida;
  assert.equal(r.ligadas, 2);
  assert.equal(barridoSyncEnCurso(), false);
});

// --- AC8: nace apagado; encendido corre una vez al dia ---

test('AC8: la variable apagada, vacia o ausente no enciende el barrido', () => {
  for (const v of [undefined, '', '0', 'false', 'no', 'off']) {
    assert.equal(barridoDiarioEncendido({ [VARIABLE_BARRIDO_DIARIO]: v }), false, String(v));
  }
  for (const v of ['1', 'true', 'si', 'on', ' TRUE ']) {
    assert.equal(barridoDiarioEncendido({ [VARIABLE_BARRIDO_DIARIO]: v }), true, v);
  }
});

test('AC8: la corrida diaria cae a las 03:00 de la Ciudad de Mexico (09:00 UTC), no al arrancar', () => {
  assert.equal(msHastaProximoBarrido(new Date('2026-10-02T08:00:00.000Z')), 3600 * 1000);
  assert.equal(msHastaProximoBarrido(new Date('2026-10-02T09:00:00.000Z')), 24 * 3600 * 1000);
  assert.equal(msHastaProximoBarrido(new Date('2026-10-02T15:30:00.000Z')), 17.5 * 3600 * 1000);
});

function relojFalso() {
  const timers = { timeouts: [], intervalos: [] };
  const unref = { unref() {} };
  timers.setTimeout = (fn, ms) => { timers.timeouts.push({ fn, ms }); return unref; };
  timers.setInterval = (fn, ms) => { timers.intervalos.push({ fn, ms }); return unref; };
  return timers;
}

test('AC8: apagado no programa nada', () => {
  const t = relojFalso();
  const programado = programarBarridoSync({ env: {}, setTimeout: t.setTimeout, setInterval: t.setInterval, barrer: () => {} });
  assert.equal(programado, false);
  assert.deepEqual(t.timeouts, []);
  assert.deepEqual(t.intervalos, []);
});

test('AC8: encendido programa la primera corrida a las 03:00 y despues una cada 24 h', () => {
  const t = relojFalso();
  let corridas = 0;
  const programado = programarBarridoSync({
    env: { [VARIABLE_BARRIDO_DIARIO]: '1' },
    ahora: () => new Date('2026-10-02T08:00:00.000Z'),
    setTimeout: t.setTimeout, setInterval: t.setInterval,
    barrer: () => { corridas++; },
  });
  assert.equal(programado, true);
  assert.equal(t.timeouts.length, 1);
  assert.equal(t.timeouts[0].ms, 3600 * 1000);
  assert.deepEqual(t.intervalos, []);
  t.timeouts[0].fn();
  assert.equal(corridas, 1);
  assert.equal(t.intervalos.length, 1);
  assert.equal(t.intervalos[0].ms, 24 * 3600 * 1000);
  t.intervalos[0].fn();
  assert.equal(corridas, 2);
});
