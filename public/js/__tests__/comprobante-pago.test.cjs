'use strict';
// #485 (CONTEXT.md "Comprobante de pago", decision 2026-09-28): la tarjeta
// muestra los archivos y la fecha del comprobante del primer pago, ofrece
// subirlo desde Seguimiento (y despues, para corregir un faltante) y pinta
// "Falta comprobante" en la que ya paso de Seguimiento sin el. Aviso, no
// candado; convive con "Pago sin registrar" (#77).
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let faltaComprobante, errorArchivosComprobante, badgeFaltaComprobanteHtml, buildComprobantePagoHtml, buildTableroPipelineHtml;
before(async () => {
  ({ faltaComprobante, errorArchivosComprobante } = await import('../comprobante-pago-logica.js'));
  ({ badgeFaltaComprobanteHtml, buildComprobantePagoHtml, buildTableroPipelineHtml } = await import('../pipeline-logica.js'));
});

const MEDIODIA = '2026-09-30T18:00:00.000Z';
const COMPROBANTE = {
  primer: {
    fecha: MEDIODIA,
    archivos: [
      { nombre: 'transferencia.pdf', ruta: '/Cotizacion 1250 - LUPITA - Primer pago - 1.pdf', fecha: MEDIODIA },
      { nombre: 'ticket.jpg', ruta: '/Cotizacion 1250 - LUPITA - Primer pago - 2.jpg', fecha: MEDIODIA },
    ],
  },
};
const tarjeta = (etapa, extra = {}) => ({ tipo: 'cotizacion', id: 'c30', refId: 30, nombre: 'LUPITA', vendedor: 'Memo', etapa, total: 15000, ...extra });

test('#485: Falta comprobante en Anticipo pagado o posterior sin comprobante del primer pago', () => {
  for (const etapa of ['anticipo_pagado', 'pedido_liberado', 'saldo_pagado', 'producto_entregado']) {
    assert.equal(faltaComprobante(tarjeta(etapa)), true, etapa);
    assert.match(badgeFaltaComprobanteHtml(tarjeta(etapa)), /Falta comprobante/, etapa);
  }
});

test('#485: no falta en Seguimiento ni con comprobante', () => {
  assert.equal(faltaComprobante(tarjeta('seguimiento')), false);
  assert.equal(badgeFaltaComprobanteHtml(tarjeta('seguimiento')), '');
  for (const etapa of ['anticipo_pagado', 'producto_entregado']) {
    assert.equal(faltaComprobante(tarjeta(etapa, { comprobantesPago: COMPROBANTE })), false, etapa);
    assert.equal(badgeFaltaComprobanteHtml(tarjeta(etapa, { comprobantesPago: COMPROBANTE })), '', etapa);
  }
});

test('#485: un comprobante sin ningun archivo confirmado sigue faltando', () => {
  assert.equal(faltaComprobante(tarjeta('anticipo_pagado', { comprobantesPago: { primer: { fecha: MEDIODIA, archivos: [] } } })), true);
});

test('#485: la tarjeta muestra los archivos y la fecha del comprobante', () => {
  const html = buildComprobantePagoHtml(tarjeta('anticipo_pagado', { comprobantesPago: COMPROBANTE }));
  assert.match(html, /transferencia\.pdf/);
  assert.match(html, /ticket\.jpg/);
  assert.match(html, /30\/09\/2026/);
});

test('#485: la tarjeta ofrece subir el comprobante desde Seguimiento y despues, con el id numerico', () => {
  for (const etapa of ['seguimiento', 'anticipo_pagado', 'producto_entregado']) {
    const html = buildComprobantePagoHtml(tarjeta(etapa));
    assert.match(html, /type="file"/, etapa);
    assert.match(html, /subirComprobantePago\(30\)/, etapa);
    assert.match(html, /accept="[^"]*\.pdf/, etapa);
  }
});

test('#485: antes de Seguimiento, en un prospecto o fuera del embudo no se ofrece comprobante', () => {
  assert.equal(buildComprobantePagoHtml(tarjeta('por_cotizar')), '');
  assert.equal(buildComprobantePagoHtml(tarjeta('perdida')), '');
  assert.equal(buildComprobantePagoHtml({ tipo: 'prospecto', id: 5, etapa: 'seguimiento' }), '');
});

test('#485: el tablero pinta Falta comprobante y convive con Pago sin registrar', () => {
  const html = buildTableroPipelineHtml([
    tarjeta('producto_entregado', { pagoSinRegistrar: true }),
    tarjeta('seguimiento', { id: 'c31', refId: 31 }),
  ], { vendedores: [], puedeAsignar: false });
  const deLaTarjeta = (id) => html.split('<div class="tablero-card"').find(parte => parte.includes('data-id="' + id + '"'));
  assert.match(deLaTarjeta('c30'), /Falta comprobante/);
  assert.match(deLaTarjeta('c30'), /Pago sin registrar/);
  assert.doesNotMatch(deLaTarjeta('c31'), /Falta comprobante/);
});

test('#485: el navegador valida con la misma regla que la ruta (tipo y tamano)', () => {
  assert.equal(errorArchivosComprobante([{ nombre: 'foto.HEIC', tamano: 2_000_000 }]), null);
  assert.match(errorArchivosComprobante([{ nombre: 'nota.txt', tamano: 10 }]), /nota\.txt/);
  assert.match(errorArchivosComprobante([{ nombre: 'escaneo.pdf', tamano: 11 * 1024 * 1024 }]), /10 MB/);
  assert.match(errorArchivosComprobante([]), /comprobante/);
});
