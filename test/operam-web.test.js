import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  estaCanceladoHtml, esLoginHtml,
  parsearFormularioQuote, serializarBodyQuote, leerValidoHastaVista,
} from '../lib/operam-web.js';

const FIXTURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'operam-quote-form.html'),
  'utf8',
);

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

// Si la sesion expira a mitad de una corrida larga, FA devuelve el form de login en vez
// de la pagina del pedido; sin detectarlo, estaCanceladoHtml daria falso negativo y se
// perderian cancelaciones (#76, caso 5632). esLoginHtml permite re-loguear y reintentar.
test('esLoginHtml: distingue el form de login de una pagina de pedido', () => {
  assert.equal(esLoginHtml('<input name="user_name_entry_field"><input type="password" name="password">'), true);
  assert.equal(esLoginHtml('<table><tr><td>Pedido 5662 — Don Asado</td></tr></table>'), false);
  assert.equal(esLoginHtml(''), false);
  assert.equal(esLoginHtml(null), false);
});

// --- Post-fix de la vigencia (#106, ADR-0007) --------------------------------
// La API v3 ignora valid_until y deja el campo nativo "Valido hasta" en ord_date-1,
// dejando cotizaciones vivas marcadas como vencidas en Operam. El post-fix corrige
// delivery_date reposteando el formulario de la web legacy. La estrategia segura es
// devolver el formulario IDENTICO salvo ese campo: el post-fix no decide el contenido
// del documento. Estos tests cubren el parseo/serializacion contra el HTML real.

test('parsearFormularioQuote: extrae inputs, selects y textareas del formulario', () => {
  const { campos } = parsearFormularioQuote(FIXTURE);
  assert.equal(campos.delivery_date, '2026-07-26');
  assert.equal(campos.OrderDate, '2026-07-27');
  assert.equal(campos.cart_id, 'CARTID_PRUEBA');
  assert.equal(campos._token, 'TOKEN_DE_PRUEBA_0123456789abcdef');
  assert.equal(campos._modified, '0');
  assert.equal(campos.deliver_to, 'Cliente Demo');
  // select -> la opcion marcada como selected, no la primera
  assert.equal(campos.customer_id, '376');
  assert.equal(campos.branch_id, '406');
  assert.equal(campos.payment, '9');
  assert.equal(campos.sales_type, '16');
  assert.equal(campos.Location, '40');
  assert.equal(campos.ship_via, '1');
  // textarea -> su contenido
  assert.match(campos.Comments, /Valido hasta: 2026-08-26/);
  assert.match(campos.delivery_address, /Calle Demo 100/);
});

// El input "search" del chrome vive FUERA del <form>: un navegador no lo enviaria.
// Incluirlo mandaria basura a FA en cada post-fix.
test('parsearFormularioQuote: ignora los campos que estan fuera del <form>', () => {
  const { campos } = parsearFormularioQuote(FIXTURE);
  assert.equal('search' in campos, false);
});

// Lo mas peligroso del formulario: CancelOrder ANULA la cotizacion, Delete0/Delete1
// borran partidas y update ("Recalculate") recalcula precios. Un navegador solo envia
// el submit que se presiono; el parser no debe recogerlos como si fueran datos.
test('parsearFormularioQuote: NO recoge botones ni submits (CancelOrder, Delete0, update)', () => {
  const { campos } = parsearFormularioQuote(FIXTURE);
  for (const peligroso of [
    'CancelOrder', 'ProcessOrder', 'Delete0', 'Delete1', 'Edit0', 'Edit1',
    'AddItem', 'update', 'addshippingcost',
    '_customer_id_update', '_branch_id_update', '_sucursal_id_update',
    '_payment_update', '_sales_type_update', '_stock_id_update', '_stock_id_button',
    '_Location_update',
  ]) {
    assert.equal(peligroso in campos, false, `${peligroso} no debe ir en el body`);
  }
});

// Si Operam cambia la pagina y deja de haber formulario, el post-fix debe fallar
// ruidosamente: reposterar un formulario a medias es peor que no hacer nada.
test('parsearFormularioQuote: lanza si el HTML no trae formulario', () => {
  assert.throws(() => parsearFormularioQuote('<html><body>sesion expirada</body></html>'), /formulario/i);
  assert.throws(() => parsearFormularioQuote(''), /formulario/i);
});

// El HTML escapa entidades; sin decodificarlas, un Comments con "&" se guardaria
// literalmente como "&amp;" y cada post-fix corromperia un poco mas el texto.
test('parsearFormularioQuote: decodifica entidades HTML de valores y textareas', () => {
  const html = `<form method='post' action='/sales/sales_order_entry.php'>
    <input type="text" name="deliver_to" value="Aceros &amp; Peltre &quot;SA&quot;">
    <textarea name="Comments">Env&iacute;o &amp; entrega &lt;urgente&gt;</textarea>
    </form>`;
  const { campos } = parsearFormularioQuote(html);
  assert.equal(campos.deliver_to, 'Aceros & Peltre "SA"');
  assert.equal(campos.Comments, 'Envío & entrega <urgente>');
});

test('serializarBodyQuote: sustituye delivery_date y conserva todo lo demas', () => {
  const { campos } = parsearFormularioQuote(FIXTURE);
  const body = serializarBodyQuote(campos, { deliveryDate: '2026-08-26' });
  assert.equal(body.get('delivery_date'), '2026-08-26');
  assert.equal(body.get('OrderDate'), campos.OrderDate);
  assert.equal(body.get('cart_id'), campos.cart_id);
  assert.equal(body.get('_token'), campos._token);
  assert.equal(body.get('customer_id'), campos.customer_id);
  assert.equal(body.get('sales_type'), campos.sales_type);
  assert.equal(body.get('Comments'), campos.Comments);
});

// El body lleva EXACTAMENTE un submit: el que confirma. Si por un error de
// serializacion viajara CancelOrder, el post-fix anularia la cotizacion.
test('serializarBodyQuote: manda ProcessOrder y NUNCA CancelOrder ni update', () => {
  const { campos } = parsearFormularioQuote(FIXTURE);
  const body = serializarBodyQuote(campos, { deliveryDate: '2026-08-26' });
  assert.equal(body.has('ProcessOrder'), true);
  assert.equal(body.has('CancelOrder'), false);
  assert.equal(body.has('update'), false);
  assert.equal(body.has('AddItem'), false);
  assert.equal(body.has('Delete0'), false);
});

// Un formulario sin delivery_date significa que la pagina no es la que creemos.
// Mejor abortar que postear un documento con un campo inventado.
test('serializarBodyQuote: lanza si el formulario no traia delivery_date', () => {
  assert.throws(
    () => serializarBodyQuote({ OrderDate: '2026-07-27' }, { deliveryDate: '2026-08-26' }),
    /delivery_date/,
  );
});

test('serializarBodyQuote: exige una fecha YYYY-MM-DD', () => {
  const { campos } = parsearFormularioQuote(FIXTURE);
  for (const mala of ['26-08-2026', '2026/08/26', '', null, undefined, 'manana']) {
    assert.throws(() => serializarBodyQuote(campos, { deliveryDate: mala }), /fecha/i);
  }
});

// Verificacion post-escritura: se relee la vista read-only (no la de edicion, que
// abriria otra sesion de captura) y se compara contra la vigencia esperada. Operam
// responde 200 aunque ignore campos -- mismo quirk ya documentado del PUT de clientes.
test('leerValidoHastaVista: extrae la fecha del campo nativo de la vista', () => {
  const html = "<tr><td class='label'>Valido hasta</td>\n<td  id=''>2026-08-26</td></tr>";
  assert.equal(leerValidoHastaVista(html), '2026-08-26');
});

test('leerValidoHastaVista: null cuando la vista no trae el campo', () => {
  assert.equal(leerValidoHastaVista('<table><tr><td>Cotizacion 1193</td></tr></table>'), null);
  assert.equal(leerValidoHastaVista(''), null);
  assert.equal(leerValidoHastaVista(null), null);
});

// El destino del POST sale del formulario, no de una constante: si Operam mueve la
// pagina, el post-fix la sigue en vez de escribir en una URL muerta.
test('parsearFormularioQuote: devuelve el action del formulario', () => {
  const { action } = parsearFormularioQuote(FIXTURE);
  assert.equal(action, '/sales/sales_order_entry.php');
});
