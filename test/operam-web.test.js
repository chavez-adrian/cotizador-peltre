import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  esLoginHtml, estaCanceladoHtml,
  parsearFormularioQuote, serializarBodyQuote, leerValidoHastaVista,
  parsearLineasQuote, serializarBodyBorrarLinea, serializarBodyAgregarLinea,
  leerLineasVista, leerComentariosVista, compararQuoteVista,
} from '../lib/operam-web.js';

const DIR_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const FIXTURE = readFileSync(join(DIR_FIXTURES, 'operam-quote-form.html'), 'utf8');
// La VISTA read-only es otra pagina que la de edicion y rotula el campo distinto
// ("Valido hasta" sin dos puntos). Se prueba contra su HTML real, no contra una cadena
// escrita a mano: eso solo confirmaria el regex contra si mismo.
const FIXTURE_VISTA = readFileSync(join(DIR_FIXTURES, 'operam-quote-vista.html'), 'utf8');

// Si la sesion expira a mitad de una corrida larga, FA devuelve el form de login en vez de la
// pagina pedida; sin detectarlo se tomaria ese formulario por una respuesta valida y la
// lectura saldria mal en silencio (#76, caso 5632). Permite re-loguear y reintentar.
test('esLoginHtml: distingue el form de login de una pagina de pedido', () => {
  assert.equal(esLoginHtml('<input name="user_name_entry_field"><input type="password" name="password">'), true);
  assert.equal(esLoginHtml('<table><tr><td>Pedido 5662 - Cliente Demo</td></tr></table>'), false);
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

// #107: comments ahora es multilinea (una nota por linea + "Valido hasta" en la suya).
// El regex del textarea usa [\s\S]*?, que deberia capturar los '\n' sin problema, pero
// esto no estaba probado con un fixture multilinea real. El round-trip completo
// (parsear -> serializar) es lo que garantiza que el post-fix de vigencia (#106) no
// mutile el texto al repostear el formulario.
test('parsearFormularioQuote + serializarBodyQuote: comments multilinea sobrevive el round-trip', () => {
  const comentariosMultilinea = '- Precios EXW Ixtapaluca, Estado de Mexico. No incluye envio.\n- Envio a costo y riesgo del cliente.\nValido hasta: 2026-08-26';
  const html = `<form method='post' action='/sales/sales_order_entry.php'>
    <input type="text" name="delivery_date" value="2026-07-26">
    <textarea name="Comments">${comentariosMultilinea}</textarea>
    </form>`;
  const { campos } = parsearFormularioQuote(html);
  assert.equal(campos.Comments, comentariosMultilinea);
  const body = serializarBodyQuote(campos, { deliveryDate: '2026-08-26' });
  assert.equal(body.get('Comments'), comentariosMultilinea);
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
test('leerValidoHastaVista: extrae la fecha del campo nativo de la vista REAL', () => {
  assert.equal(leerValidoHastaVista(FIXTURE_VISTA), '2026-08-26');
});

// La pagina de EDICION rotula el mismo campo con dos puntos y dentro de un <input>, no de
// una celda: son fuentes distintas a proposito y este regex NO la lee. El test lo fija
// para que nadie "arregle" el regex apuntandolo a la pagina equivocada.
test('leerValidoHastaVista: null sobre la pagina de edicion (no es su fuente)', () => {
  assert.equal(leerValidoHastaVista(FIXTURE), null);
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

// --- Actualizacion del quote conservando el folio (#104, ADR-0008) ------------
// Reescritura completa por la web legacy: borrar todas las lineas (Delete0 iterado)
// + un AddItem por partida + un unico ProcessOrder con el header actualizado. Las
// reglas de seguridad de ADR-0007 valen igual: el submit se agrega explicito y
// constante, y CancelOrder (que vive en el mismo formulario) jamas viaja en el body.

const VISTA_CONCEPTOS = readFileSync(join(DIR_FIXTURES, 'operam-quote-vista-conceptos.html'), 'utf8');

test('parsearLineasQuote: lee las partidas del formulario de edicion REAL', () => {
  const lineas = parsearLineasQuote(FIXTURE);
  assert.equal(lineas.length, 2);
  assert.deepEqual(lineas.map(l => l.indice), [0, 1]);
  assert.deepEqual(lineas.map(l => l.stockId), ['TA14Y31111', '251021001']);
});

// La fila de captura de linea nueva (stock_id/qty/price/Disc + AddItem) NO es una
// partida: no tiene boton Delete. Contarla haria que el borrado nunca terminara.
test('parsearLineasQuote: no cuenta la fila de captura ni el selector de articulo', () => {
  const sinPartidas = FIXTURE.replace(/name='Delete\d+'/g, "name='OtraCosa'");
  assert.deepEqual(parsearLineasQuote(sinPartidas), []);
  assert.deepEqual(parsearLineasQuote(''), []);
  assert.deepEqual(parsearLineasQuote(null), []);
});

test('serializarBodyBorrarLinea: manda Delete0 y conserva el resto del formulario', () => {
  const { campos } = parsearFormularioQuote(FIXTURE);
  const body = serializarBodyBorrarLinea(campos);
  assert.equal(body.get('Delete0'), '1');
  assert.equal(body.get('cart_id'), campos.cart_id);
  assert.equal(body.get('_token'), campos._token);
  assert.equal(body.get('Comments'), campos.Comments);
});

// Delete0 siempre: tras cada borrado FA renumera las lineas, asi que iterar el
// indice 0 N veces evita depender de la numeracion (ADR-0008, paso 3).
test('serializarBodyBorrarLinea: NUNCA manda ProcessOrder, CancelOrder, AddItem ni update', () => {
  const { campos } = parsearFormularioQuote(FIXTURE);
  const body = serializarBodyBorrarLinea(campos);
  for (const peligroso of ['ProcessOrder', 'CancelOrder', 'AddItem', 'update', 'Delete1']) {
    assert.equal(body.has(peligroso), false, `${peligroso} no debe ir en el body de borrado`);
  }
});

test('serializarBodyAgregarLinea: fija stock_id, qty, price y Disc y manda AddItem', () => {
  const { campos } = parsearFormularioQuote(FIXTURE);
  const body = serializarBodyAgregarLinea(campos, { stock_id: 'TA14Y31111', qty: 12, price: 107.76, Disc: 5 });
  assert.equal(body.get('stock_id'), 'TA14Y31111');
  assert.equal(body.get('qty'), '12');
  assert.equal(body.get('price'), '107.76');
  assert.equal(body.get('Disc'), '5');
  assert.equal(body.get('AddItem'), 'Agregar');
  assert.equal(body.get('cart_id'), campos.cart_id);
});

test('serializarBodyAgregarLinea: NUNCA manda ProcessOrder, CancelOrder, Delete0 ni update', () => {
  const { campos } = parsearFormularioQuote(FIXTURE);
  const body = serializarBodyAgregarLinea(campos, { stock_id: 'TA14Y31111', qty: 1, price: 10 });
  for (const peligroso of ['ProcessOrder', 'CancelOrder', 'Delete0', 'update']) {
    assert.equal(body.has(peligroso), false, `${peligroso} no debe ir en el body de alta de linea`);
  }
});

// Una partida invalida se detecta ANTES de mandarla: FA la rechazaria renderizando
// la pagina con un error y el conteo de lineas dejaria de cuadrar a mitad de la
// reescritura. Fallar aqui deja el documento intacto (aun no hubo ProcessOrder).
test('serializarBodyAgregarLinea: lanza con SKU vacio, cantidad no positiva o precio invalido', () => {
  const { campos } = parsearFormularioQuote(FIXTURE);
  assert.throws(() => serializarBodyAgregarLinea(campos, { stock_id: '', qty: 1, price: 10 }), /SKU/i);
  assert.throws(() => serializarBodyAgregarLinea(campos, { stock_id: 'X', qty: 0, price: 10 }), /cantidad/i);
  assert.throws(() => serializarBodyAgregarLinea(campos, { stock_id: 'X', qty: -3, price: 10 }), /cantidad/i);
  assert.throws(() => serializarBodyAgregarLinea(campos, { stock_id: 'X', qty: 1, price: -1 }), /precio/i);
  assert.throws(() => serializarBodyAgregarLinea(campos, { stock_id: 'X', qty: 1, price: 'gratis' }), /precio/i);
});

// Defensa en profundidad: aunque parsearFormularioQuote ya excluye submits, ningun
// body debe poder arrastrar CancelOrder si el HTML de Operam cambiara y colara un
// campo con ese nombre. El submit lo pone SIEMPRE el serializador, nunca el form.
test('los tres bodies descartan cualquier submit que venga contaminado en los campos', () => {
  const sucios = { delivery_date: '2026-07-26', Comments: 'x', cust_ref: 'y', CancelOrder: 'Cancelar Cotización', Delete3: '1', update: 'Recalculate', AddItem: 'Agregar' };
  const bodies = [
    serializarBodyQuote(sucios, { deliveryDate: '2026-08-26' }),
    serializarBodyBorrarLinea(sucios),
    serializarBodyAgregarLinea(sucios, { stock_id: 'X', qty: 1, price: 1 }),
  ];
  for (const body of bodies) {
    assert.equal(body.has('CancelOrder'), false);
    assert.equal(body.has('Delete3'), false);
    assert.equal(body.has('update'), false);
  }
  assert.equal(bodies[0].has('AddItem'), false);
  assert.equal(bodies[1].has('AddItem'), false);
});

// En este camino la vigencia NO necesita el post-fix separado de #106: viaja en el
// mismo ProcessOrder junto con Comments y cust_ref (ADR-0008, paso 5).
test('serializarBodyQuote: sustituye Comments y cust_ref junto con delivery_date', () => {
  const { campos } = parsearFormularioQuote(FIXTURE);
  const body = serializarBodyQuote(campos, {
    deliveryDate: '2026-09-01', comments: '- Nota nueva.\nValido hasta: 2026-09-01', custRef: 'Ferreteria Demo',
  });
  assert.equal(body.get('delivery_date'), '2026-09-01');
  assert.equal(body.get('Comments'), '- Nota nueva.\nValido hasta: 2026-09-01');
  assert.equal(body.get('cust_ref'), 'Ferreteria Demo');
  assert.equal(body.get('ProcessOrder'), 'Confirmar Cambios');
  assert.equal(body.has('CancelOrder'), false);
  assert.equal(body.get('customer_id'), campos.customer_id);
  assert.equal(body.get('OrderDate'), campos.OrderDate);
});

// Sin comments/custRef el post-fix de vigencia (#106) se comporta EXACTAMENTE como
// antes: solo cambia delivery_date. Este test fija que la extension no lo toco.
test('serializarBodyQuote: sin comments ni custRef deja el formulario como estaba (#106)', () => {
  const { campos } = parsearFormularioQuote(FIXTURE);
  const body = serializarBodyQuote(campos, { deliveryDate: '2026-08-26' });
  assert.equal(body.get('Comments'), campos.Comments);
  assert.equal(body.get('cust_ref'), campos.cust_ref);
});

test('serializarBodyQuote: lanza si se pide cambiar Comments y el formulario no lo trae', () => {
  assert.throws(
    () => serializarBodyQuote({ delivery_date: '2026-07-26' }, { deliveryDate: '2026-08-26', comments: 'x' }),
    /Comments/,
  );
});

// --- Verificacion post-escritura (obligatoria, ADR-0008 paso 6) --------------

test('leerLineasVista: extrae SKU, cantidad, precio y descuento de la vista REAL', () => {
  const lineas = leerLineasVista(VISTA_CONCEPTOS);
  assert.equal(lineas.length, 3);
  assert.deepEqual(lineas[0], { stockId: 'TA14Y31111', cantidad: 7, precio: 33.33, descuento: 0 });
  assert.deepEqual(lineas[1], { stockId: 'VA05Y4001120', cantidad: 2, precio: 111.11, descuento: 10 });
  assert.deepEqual(lineas[2], { stockId: '251021001', cantidad: 1, precio: 123.45, descuento: 0 });
});

test('leerLineasVista: [] cuando la pagina no trae la tabla de conceptos', () => {
  assert.deepEqual(leerLineasVista('<table><tr><td>Cotizacion 1199</td></tr></table>'), []);
  assert.deepEqual(leerLineasVista(''), []);
  assert.deepEqual(leerLineasVista(null), []);
});

// La vista renderiza los saltos de linea de Comments como <br />: sin reconvertirlos
// la comparacion daria discrepancia siempre y el aviso al vendedor seria ruido.
test('leerComentariosVista: reconstruye el texto multilinea desde los <br />', () => {
  assert.equal(
    leerComentariosVista(VISTA_CONCEPTOS),
    '- Cotizacion de PRUEBA del ciclo de #104 - no es una oferta real.\n' +
    '- Segunda nota de prueba.\n' +
    'Valido hasta: 2026-09-30',
  );
});

test('leerComentariosVista: null cuando la vista no trae el campo', () => {
  assert.equal(leerComentariosVista('<table><tr><td>Cotizacion</td></tr></table>'), null);
  assert.equal(leerComentariosVista(''), null);
});

// Los datos esperados son los que se mandaron en la verificacion en vivo del ciclo
// completo (quote de prueba 1200, 2026-07-28) y el HTML es la vista resultante: este
// test es el contrato real de la verificacion post-escritura, no una simulacion.
const ESPERADO_1200 = [
  { stock_id: 'TA14Y31111', stock_id_text: 'Tazon 14 mostaza filete negro', qty: 7, price: 33.33, Disc: 0 },
  { stock_id: 'VA05Y4001120', stock_id_text: 'Taza 5 crema s/filetes', qty: 2, price: 111.11, Disc: 10 },
  { stock_id: '251021001', stock_id_text: 'FedEx Ground', qty: 1, price: 123.45, Disc: 0 },
];
const COMMENTS_1200 = '- Cotizacion de PRUEBA del ciclo de #104 - no es una oferta real.\n- Segunda nota de prueba.\nValido hasta: 2026-09-30';

test('compararQuoteVista: sin discrepancias cuando el quote quedo como se esperaba', () => {
  const r = compararQuoteVista({ items: ESPERADO_1200, comments: COMMENTS_1200, vigencia: '2026-09-30' }, VISTA_CONCEPTOS);
  assert.equal(r.verificado, true);
  assert.equal(r.ok, true);
  assert.deepEqual(r.discrepancias, []);
});

// La descripcion de la partida la pone el CATALOGO de Operam, no el stock_id_text que
// manda la cotizacion (verificado en vivo: "FedEx Ground" quedo como "Envio Economico
// FedEx Ground(R)"). Compararla haria fallar toda actualizacion correcta.
test('compararQuoteVista: la descripcion del catalogo de Operam no cuenta como discrepancia', () => {
  const r = compararQuoteVista({ items: ESPERADO_1200, comments: COMMENTS_1200, vigencia: '2026-09-30' }, VISTA_CONCEPTOS);
  assert.equal(r.discrepancias.filter(d => d.campo === 'descripcion').length, 0);
  assert.equal(r.ok, true);
});

// Con el SKU cruzado en una linea, su cantidad/precio ya no informan nada (se
// estarian comparando dos articulos distintos): solo se reporta el SKU de esa linea.
test('compararQuoteVista: detecta SKU, cantidad, precio y descuento distintos', () => {
  const esperado = {
    items: [
      { stock_id: 'TA14Y31111', qty: 60, price: 999, Disc: 5 },
      { stock_id: 'OTRO-SKU', qty: 2, price: 111.11, Disc: 10 },
      ESPERADO_1200[2],
    ],
    comments: COMMENTS_1200,
    vigencia: '2026-09-30',
  };
  const r = compararQuoteVista(esperado, VISTA_CONCEPTOS);
  assert.equal(r.ok, false);
  const campos = r.discrepancias.map(d => d.campo);
  assert.ok(campos.includes('cantidad'));
  assert.ok(campos.includes('precio'));
  assert.ok(campos.includes('descuento'));
  assert.ok(campos.includes('sku'));
  // la linea del SKU cruzado no reporta cantidad/precio: seria comparar peras con manzanas
  assert.equal(r.discrepancias.filter(d => d.linea === 1).length, 1);
});

test('compararQuoteVista: detecta que sobran o faltan partidas', () => {
  const base = { comments: COMMENTS_1200, vigencia: '2026-09-30' };
  const faltan = compararQuoteVista({ ...base, items: ESPERADO_1200.slice(0, 2) }, VISTA_CONCEPTOS);
  assert.equal(faltan.ok, false);
  assert.ok(faltan.discrepancias.some(d => d.campo === 'partidas' && d.esperado === 2 && d.encontrado === 3));
});

test('compararQuoteVista: detecta comentarios y vigencia distintos', () => {
  const r = compararQuoteVista({ items: ESPERADO_1200, comments: 'otra cosa', vigencia: '2026-12-31' }, VISTA_CONCEPTOS);
  assert.equal(r.ok, false);
  const campos = r.discrepancias.map(d => d.campo);
  assert.ok(campos.includes('comentarios'));
  assert.ok(campos.includes('vigencia'));
});

// Una vista que no se pudo leer NO es "quedo mal": es que no se comprobo nada. Se
// distingue para no afirmar en el reporte al vendedor algo que no se sabe (#106).
test('compararQuoteVista: pagina ilegible -> verificado false, nunca ok true', () => {
  const r = compararQuoteVista({ items: [{ stock_id: 'X', qty: 1, price: 1, Disc: 0 }], comments: 'x', vigencia: '2026-08-27' }, '<html>sesion expirada</html>');
  assert.equal(r.verificado, false);
  assert.equal(r.ok, false);
});

// --- Deteccion de cancelacion (#76) ---
// La web legacy marca un documento anulado con el aviso "Este pedido ha sido cancelado"
// (lee 0_voided). La API v3 NO lo expone, por eso el estado se scrapea. Este predicado
// puro es la senal; si Operam cambiara el texto, este test lo evidencia.
test('estaCanceladoHtml: detecta el aviso de cancelacion de la web legacy', () => {
  const html = '<div class="error">Este pedido ha sido cancelado. Fecha y Hora Cancelacion Sistema: 2025-07-23 19:10:53 Usuario : a.chavez</div>';
  assert.equal(estaCanceladoHtml(html), true);
  assert.equal(estaCanceladoHtml('<div>Esta cotizacion ha sido cancelada</div>'), true);
});

test('estaCanceladoHtml: un documento normal (o vacio/null) no esta cancelado', () => {
  assert.equal(estaCanceladoHtml('<table><tr><td>Pedido 5662</td></tr></table>'), false);
  assert.equal(estaCanceladoHtml(''), false);
  assert.equal(estaCanceladoHtml(null), false);
});
