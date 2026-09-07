// Nucleo puro de los dos estados del Cliente Operam (#344, spec #337, ADR-0016,
// CONTEXT.md "Cliente Operam"): el fiscal sale del RFC, el comercial sale de lo
// que Operam registra -- nunca de una captura -- y el hueco conocido de los
// quotes web no enumerables se DECLARA, no se adivina.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CON_DATOS_FISCALES,
  CON_PEDIDO,
  COTIZADO,
  SIN_ACTIVIDAD,
  SIN_DATOS_FISCALES,
  construirActividad,
  estadoComercialDe,
  estadoFiscalDe,
  estadosDeClienteOperam,
} from '../lib/estado-cliente-operam.js';

// --- estado fiscal ---

test('#344: el RFC generico nacional deja al Cliente Operam Sin datos fiscales', () => {
  assert.equal(estadoFiscalDe({ tax_id: 'XAXX010101000' }), SIN_DATOS_FISCALES);
});

test('#344: el RFC generico extranjero tambien es Sin datos fiscales', () => {
  assert.equal(estadoFiscalDe({ tax_id: 'xexx010101000' }), SIN_DATOS_FISCALES);
});

test('#344: un RFC real deja al Cliente Operam Con datos fiscales', () => {
  assert.equal(estadoFiscalDe({ tax_id: 'PNA950101AB1' }), CON_DATOS_FISCALES);
});

test('#344: sin RFC capturado no hay datos fiscales que presumir', () => {
  assert.equal(estadoFiscalDe({}), SIN_DATOS_FISCALES);
  assert.equal(estadoFiscalDe(null), SIN_DATOS_FISCALES);
});

// --- estado comercial ---

test('#344: un pedido vivo deja al Cliente Operam con pedido', () => {
  const estado = estadoComercialDe({ pedidos: [{ folio: '7269' }], quotes: [{ folio: '1141' }] });
  assert.equal(estado, CON_PEDIDO);
});

test('#344: sin pedido pero con quote el Cliente Operam esta cotizado', () => {
  assert.equal(estadoComercialDe({ pedidos: [], quotes: [{ folio: '1141' }] }), COTIZADO);
});

test('#344: sin nada registrado el Cliente Operam no tiene actividad', () => {
  assert.equal(estadoComercialDe({ pedidos: [], quotes: [] }), SIN_ACTIVIDAD);
  assert.equal(estadoComercialDe(), SIN_ACTIVIDAD);
});

test('#344: un pedido CANCELADO no vuelve con pedido a nadie', () => {
  const estado = estadoComercialDe({
    pedidos: [{ folio: '5960', cancelado: true }],
    quotes: [{ folio: '1141' }],
  });
  assert.equal(estado, COTIZADO);
});

test('#344: cancelados el pedido y el quote, el Cliente Operam queda sin actividad', () => {
  const estado = estadoComercialDe({
    pedidos: [{ folio: '5960', cancelado: true }],
    quotes: [{ folio: '1195', cancelado: true }],
  });
  assert.equal(estado, SIN_ACTIVIDAD);
});

// --- fuente incompleta: el hueco de los quotes web ---

test('#344: sin actividad la respuesta declara que la fuente esta incompleta', () => {
  const r = estadosDeClienteOperam({ customer_id: 500, tax_id: 'XAXX010101000' }, null);
  assert.equal(r.fiscal, SIN_DATOS_FISCALES);
  assert.equal(r.comercial, SIN_ACTIVIDAD);
  assert.equal(r.fuenteIncompleta, true);
});

test('#344: con pedido la fuente ya no puede cambiar el veredicto y no se declara incompleta', () => {
  const r = estadosDeClienteOperam(
    { customer_id: 500, tax_id: 'PNA950101AB1' },
    { pedidos: [{ folio: '7269' }], quotes: [] }
  );
  assert.equal(r.fiscal, CON_DATOS_FISCALES);
  assert.equal(r.comercial, CON_PEDIDO);
  assert.equal(r.fuenteIncompleta, false);
});

// --- construirActividad: de lo que hay a lo que el estado necesita ---

test('#344: un pedido de Operam cuenta para su debtor, con el quote del que nacio', () => {
  const mapa = construirActividad({
    pedidos: [{ order_no: 7269, debtor_no: '514', trans_no_from: '1141' }],
  });
  assert.deepEqual(mapa.get('514').pedidos, [{ folio: '7269', cancelado: false }]);
  assert.deepEqual(mapa.get('514').quotes, [{ folio: '1141', cancelado: false }]);
});

test('#344: un pedido de la lista de cancelados entra marcado y no cuenta', () => {
  const mapa = construirActividad({
    pedidos: [{ order_no: 5960, debtor_no: '514' }],
    cancelados: { orders: ['5960'] },
  });
  assert.equal(estadoComercialDe(mapa.get('514')), SIN_ACTIVIDAD);
});

test('#344: el espejo local aporta el quote y el pedido de una cotizacion del cotizador', () => {
  const mapa = construirActividad({
    cotizaciones: [{
      id: 51, folioOperam: '1240',
      data: { cliente: { customerId: 517 }, espejoOperam: { pedido: '7301' } },
    }],
  });
  assert.equal(estadoComercialDe(mapa.get('517')), CON_PEDIDO);
});

test('#344: una cotizacion sin folio todavia no cotizo a nadie', () => {
  const mapa = construirActividad({
    cotizaciones: [{ id: 52, folioOperam: null, data: { cliente: { customerId: 518 } } }],
  });
  assert.equal(estadoComercialDe(mapa.get('518')), SIN_ACTIVIDAD);
});

test('#344: el historico de Operam de un Cliente que nunca paso por el cotizador aparece con pedido', () => {
  const mapa = construirActividad({
    pedidos: [{ order_no: 6100, debtor_no: 233, trans_no_from: '' }],
    cotizaciones: [],
  });
  const r = estadosDeClienteOperam({ customer_id: 233, tax_id: 'AAA010101AAA' }, mapa.get('233'));
  assert.equal(r.comercial, CON_PEDIDO);
});
