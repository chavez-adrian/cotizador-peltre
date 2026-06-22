import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estaCanceladoHtml } from '../lib/operam-web.js';

// La web legacy de Operam (FrontAccounting) marca un documento anulado con el aviso
// "Este pedido ha sido cancelado" (lee 0_voided). La API v3 NO lo expone (#76/#77), por
// eso el estado se detecta scrapeando view_sales_order.php. Este predicado puro es la
// senal; si Operam cambiara el texto, este test lo evidencia.
test('estaCanceladoHtml: detecta el aviso de cancelacion de la web legacy', () => {
  const html = '<div class="error">Este pedido ha sido cancelado. Fecha y Hora Cancelación Sistema: 2025-07-23 19:10:53 Usuario : a.chavez</div>';
  assert.equal(estaCanceladoHtml(html), true);
});

test('estaCanceladoHtml: un documento normal (o vacio/null) no esta cancelado', () => {
  assert.equal(estaCanceladoHtml('<table><tr><td>Pedido 5662</td></tr></table>'), false);
  assert.equal(estaCanceladoHtml(''), false);
  assert.equal(estaCanceladoHtml(null), false);
});
