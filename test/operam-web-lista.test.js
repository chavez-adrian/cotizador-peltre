// La lista de precios del ENCABEZADO del quote (#403).
//
// El quote subia a Operam con la lista del CLIENTE: cada partida viaja con su precio
// explicito y el importe queda bien, pero el encabezado dice otra lista -- y de ese
// encabezado heredan el pedido que se derive, los reportes por lista y lo que Operam
// precia si alguien agrega una partida a mano. La API v3 ignora la lista en el POST
// (12 llaves medidas en vivo); la web legacy SI la escribe y NO re-precia las
// partidas (medido sobre el quote 1287, 2026-09-20).
//
// Aqui se prueba la ORQUESTACION de los dos caminos que ya reposteaban el quote: el
// post-fix de la vigencia (#106) al crear y la actualizacion (#104). Las piezas puras
// (opcionesListaQuote / decidirListaQuote / serializarBodyQuote) estan cubiertas
// contra el HTML real en test/operam-web.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { corregirVigenciaQuote, actualizarQuoteOperam, corregirListaQuote, _resetSesionWeb } from '../lib/operam-web.js';

process.env.OPERAM_URL = 'https://fa.mentira.test';
process.env.OPERAM_USER = 'usuario_de_prueba';
process.env.OPERAM_PASSWORD = 'clave_de_prueba';

const QUOTE_NO = '1287';
const CUSTOMER_ID = '15';

// Las 14 listas activas del formulario real (mismo select, ids reales de Operam).
const LISTAS = [
  ['19', 'Amazon'], ['15', 'M100'], ['6', 'M1500'], ['16', 'M350'], ['1', 'M550'],
  ['3', 'M6000'], ['20', 'M6001'], ['12', 'Precio de lista'], ['9', 'Segundas'],
  ['21', 'US100'], ['24', 'US1500'], ['22', 'US350'], ['23', 'US550'], ['25', 'US6000'],
];

function selectListas(seleccionada, listas = LISTAS) {
  const opciones = listas
    .map(([id, nombre]) => `<option groupid='${id}' ${String(id) === String(seleccionada) ? 'selected' : ''}  value='${id}'>${nombre}</option>`)
    .join('\n');
  return `<select autocomplete='off' name='sales_type' class='combo'>${opciones}</select>`;
}

// Servidor FA de mentiras: mantiene el encabezado y el carrito, y solo ProcessOrder
// los escribe (como FA real, ADR-0008). `sinSelect` quita el select de listas: es la
// pagina inesperada, donde la lista NO se escribe y se reporta.
// `alConfirmar` (#406) deja simular un FA que SI toca las partidas al confirmar: es
// el escenario que la correccion historica tiene que detectar y frenar.
function crearServidorFA({
  listaInicial = '12', deliveryDateInicial = '2026-08-12', lineasIniciales = [],
  sinSelect = false, listas = LISTAS, alConfirmar = null,
} = {}) {
  const state = {
    lista: listaInicial, deliveryDate: deliveryDateInicial,
    lineas: lineasIniciales.map(l => ({ ...l })), comments: 'comentario viejo', custRef: 'REF',
    posts: [], formularios: 0,
  };

  const formulario = () => `<!DOCTYPE HTML><html><body>
<form method='post' action='/sales/sales_order_entry.php'>
<input type="hidden" name="cart_id" value='CART_${QUOTE_NO}'>
<select name='customer_id'><option value='${CUSTOMER_ID}' selected>Cliente de prueba</option></select>
${sinSelect ? '' : selectListas(state.lista, listas)}
${state.lineas.map((l, i) => `<a href='../inventory/inquiry/stock_status.php?stock_id=${l.stockId}'>x</a>
<button type='submit' name='Delete${i}' value='1'>Eliminar</button>`).join('\n')}
<input type="text" name="stock_id" value=''>
<input type="text" name="qty" value="1">
<input type="text" name="price" value="0.00">
<input type="text" name="Disc" value="0.0">
<input type="text" name="delivery_date" value="${state.deliveryDate}">
<input type="text" name="deliver_to" value="Cliente de prueba">
<textarea name='delivery_address'>N/A</textarea>
<input type="text" name="phone" value="">
<input type="text" name="email" value="">
<input type="text" name="cust_ref" value="${state.custRef}">
<textarea name='Comments'>${state.comments}</textarea>
<button type='submit' name='ProcessOrder' value='Confirmar Cambios'>Confirmar</button>
<button type='submit' name='CancelOrder' value='Cancelar'>Cancelar</button>
<input type="hidden" name="_token" value='TOK'>
</form></body></html>`;

  const vista = () => `<table>
<tr><td class='tableheader2'>Valido hasta</td><td id=''>${state.deliveryDate}</td></tr>
<tr><td class='tableheader2'>Comentarios</td><td colspan=3 id=''>${state.comments}</td></tr>
</table>
<table>${state.lineas.map(l => `<tr class='evenrow'>
<td><a href='../../inventory/inquiry/stock_status.php?stock_id=${l.stockId}'>${l.stockId}</a></td><td>Desc catalogo</td>
<td align=right nowrap>${Number(l.qty).toFixed(2)}</td>
<td>pza</td>
<td nowrap align=right>${Number(l.price).toFixed(2)}</td>
<td nowrap align=right>${Number(l.disc).toFixed(2)}</td>
<td nowrap align=right>0.00</td>
<td nowrap align=right>0</td>
</tr>`).join('')}</table>`;

  async function fetchMock(url, init = {}) {
    const metodo = (init.method || 'GET').toUpperCase();
    const u = String(url);
    if (u.includes('trans_no=1&trans_type=30')) return new Response('<html>login de mentira</html>', { status: 200 });
    if (metodo === 'GET' && u.includes('ModifyQuotationNumber=')) { state.formularios++; return new Response(formulario(), { status: 200 }); }
    if (metodo === 'GET' && u.includes(`trans_no=${QUOTE_NO}&trans_type=32`)) return new Response(vista(), { status: 200 });
    if (metodo === 'POST' && u.endsWith('/sales/sales_order_entry.php')) {
      const params = new URLSearchParams(String(init.body || ''));
      state.posts.push(params);
      if (params.has('Delete0')) { state.lineas.shift(); return new Response(formulario(), { status: 200 }); }
      if (params.has('AddItem')) {
        state.lineas.push({ stockId: params.get('stock_id'), qty: params.get('qty'), price: params.get('price'), disc: params.get('Disc') });
        return new Response(formulario(), { status: 200 });
      }
      if (params.has('ProcessOrder')) {
        state.deliveryDate = params.get('delivery_date');
        state.comments = params.get('Comments');
        state.custRef = params.get('cust_ref');
        // FA escribe la lista del encabezado y NO re-precia las partidas.
        if (params.has('sales_type')) state.lista = params.get('sales_type');
        if (alConfirmar) alConfirmar(state, params);
        return new Response(formulario(), { status: 200 });
      }
      throw new Error('mock FA: POST sin submit reconocido: ' + String(init.body));
    }
    throw new Error('mock FA: URL no manejada: ' + metodo + ' ' + u);
  }

  // La relectura del encabezado va por la API v3 (order_type), no por la web: releer
  // el formulario abriria otra sesion de captura en FA. Aqui se inyecta leyendo el
  // estado del servidor de mentiras, que es lo que quedo escrito.
  const leerLista = async () => state.lista;

  // La cabecera del quote como la devuelve GET /api/v3/sales/quote/:folio, que es por
  // donde la correccion historica (#406) mira el encabezado Y las partidas.
  const leerQuote = async () => ({
    order_no: QUOTE_NO,
    order_type: state.lista,
    delivery_date: state.deliveryDate,
    detalles: state.lineas.map(l => ({
      stk_code: l.stockId, quantity: String(l.qty), unit_price: String(l.price), discount_percent: String(l.disc ?? 0),
    })),
  });

  return { fetchMock, state, leerLista, leerQuote };
}

async function conFA(servidor, fn) {
  _resetSesionWeb();
  const original = globalThis.fetch;
  globalThis.fetch = servidor.fetchMock;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
    _resetSesionWeb();
  }
}

const procesos = (state) => state.posts.filter(p => p.has('ProcessOrder'));

// --- Post-fix al crear (#106 + #403) -----------------------------------------

test('#403 al crear: el ProcessOrder lleva la lista cotizada y el encabezado queda con ella', async () => {
  const fa = crearServidorFA({ listaInicial: '12' });
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-20', { lista: '9', leerLista: fa.leerLista }));

  assert.equal(procesos(fa.state).length, 1);
  assert.equal(procesos(fa.state)[0].get('sales_type'), '9');
  assert.equal(procesos(fa.state)[0].get('delivery_date'), '2026-10-20');
  assert.equal(fa.state.lista, '9');
  assert.equal(r.ok, true);
  assert.equal(r.lista.escrita, true);
  assert.equal(r.lista.ok, true);
  assert.equal(r.lista.verificado, true);
  assert.equal(r.lista.esperado, '9');
  assert.equal(r.lista.encontrado, '9');
});

// El corto circuito de #106 (la vigencia ya esta bien, no se repostea) no puede
// frenar la lista: son dos campos del mismo encabezado y solo uno estaba bien.
test('#403 al crear: con la vigencia ya correcta pero otra lista, SI se escribe', async () => {
  const fa = crearServidorFA({ listaInicial: '12', deliveryDateInicial: '2026-10-20' });
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-20', { lista: '9', leerLista: fa.leerLista }));

  assert.equal(procesos(fa.state).length, 1);
  assert.equal(fa.state.lista, '9');
  assert.equal(r.ok, true);
  assert.equal(r.lista.ok, true);
});

test('#403 al crear: con la vigencia y la lista ya correctas no se repostea nada', async () => {
  const fa = crearServidorFA({ listaInicial: '9', deliveryDateInicial: '2026-10-20' });
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-20', { lista: '9', leerLista: fa.leerLista }));

  assert.equal(fa.state.posts.length, 0);
  assert.equal(r.yaCorrecto, true);
  assert.equal(r.lista.escrita, false);
  assert.equal(r.lista.yaCorrecto, true);
  assert.equal(r.lista.ok, true);
});

// Los tres motivos de abstencion. Ninguno tumba la subida ni la vigencia: el quote ya
// existe con sus precios correctos y lo unico que queda mal es el encabezado.
test('#403 al crear: sin el select de listas no se escribe la lista y la vigencia si se corrige', async () => {
  const fa = crearServidorFA({ sinSelect: true });
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-20', { lista: '9', leerLista: fa.leerLista }));

  assert.equal(procesos(fa.state).length, 1);
  assert.equal(procesos(fa.state)[0].has('sales_type'), false);
  assert.equal(r.ok, true, 'la vigencia si quedo');
  assert.equal(r.lista.escrita, false);
  assert.equal(r.lista.ok, false);
  assert.match(r.lista.motivo, /sales_type/);
});

test('#403 al crear: una lista que el formulario no ofrece no se escribe y se reporta', async () => {
  const fa = crearServidorFA({ listaInicial: '12' });
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-20', { lista: '99', leerLista: fa.leerLista }));

  assert.equal(procesos(fa.state)[0].get('sales_type'), '12', 'la que el formulario ya traia');
  assert.equal(fa.state.lista, '12');
  assert.equal(r.lista.escrita, false);
  assert.equal(r.lista.ok, false);
  assert.match(r.lista.motivo, /99/);
});

// Sin lista resoluble (tier fuera del catalogo) no hay nada que escribir: no es un
// fallo del post-fix, es que no se sabe que lista poner.
test('#403 al crear: sin lista resuelta el post-fix se comporta como antes de #403', async () => {
  const fa = crearServidorFA({ listaInicial: '12' });
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-20', { lista: null, leerLista: fa.leerLista }));

  assert.equal(procesos(fa.state)[0].get('sales_type'), '12');
  assert.equal(r.ok, true);
  assert.equal(r.lista.aplica, false);
  assert.equal(r.lista.escrita, false);
});

// Operam responde 200 aunque ignore campos (el quirk de siempre): sin releer, una
// lista que no pego se reportaria como exito.
test('#403 al crear: si el encabezado releido trae otra lista, se reporta sin inventar', async () => {
  const fa = crearServidorFA({ listaInicial: '12' });
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-20', { lista: '9', leerLista: async () => '12' }));

  assert.equal(r.lista.escrita, true);
  assert.equal(r.lista.ok, false);
  assert.equal(r.lista.verificado, true);
  assert.equal(r.lista.encontrado, '12');
});

// "No se pudo verificar" no es "quedo mal": si la relectura falla, el paso lo dice en
// vez de afirmar una discrepancia que nadie comprobo (mismo criterio que la vigencia).
test('#403 al crear: si la relectura falla, verificado false y la subida no se cae', async () => {
  const fa = crearServidorFA({ listaInicial: '12' });
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-20', {
    lista: '9', leerLista: async () => { throw new Error('Operam 503'); },
  }));

  assert.equal(r.ok, true, 'la vigencia se verifico igual');
  assert.equal(r.lista.escrita, true);
  assert.equal(r.lista.verificado, false);
  assert.equal(r.lista.ok, false);
  assert.equal(r.lista.encontrado, null);
});

// --- Actualizar el quote conservando el folio (#104 + #403) -------------------

function dataDe(items) {
  return {
    cliente: { customerId: CUSTOMER_ID, razonSocial: 'Cliente de prueba' },
    items, vigencia: '2026-10-20', fecha: '2026-09-20', notas: [],
  };
}

test('#403 al actualizar: el ProcessOrder final lleva la lista cotizada', async () => {
  const fa = crearServidorFA({ listaInicial: '12', lineasIniciales: [{ stockId: 'SKU-VIEJO', qty: 1, price: 1, disc: 0 }] });
  const r = await conFA(fa, () => actualizarQuoteOperam(QUOTE_NO, dataDe([
    { codigo: 'VA08B11111', descripcion: 'Vaso', cantidad: 500, precio: 14.224138, descuento: 0 },
  ]), { lista: '9', leerLista: fa.leerLista }));

  assert.equal(r.ok, true, r.error || JSON.stringify(r.discrepancias));
  assert.equal(procesos(fa.state).length, 1);
  assert.equal(procesos(fa.state)[0].get('sales_type'), '9');
  assert.equal(fa.state.lista, '9');
  assert.equal(r.lista.ok, true);
});

// El criterio duro del ticket: corregir el encabezado NO puede mover un precio. La
// linea se agrega con su precio explicito (AddItem) y el ProcessOrder que lleva la
// lista no toca ninguna llave de partida.
test('#403 al actualizar: escribir la lista no cambia el precio de ninguna partida', async () => {
  const fa = crearServidorFA({ listaInicial: '12', lineasIniciales: [{ stockId: 'SKU-VIEJO', qty: 1, price: 1, disc: 0 }] });
  await conFA(fa, () => actualizarQuoteOperam(QUOTE_NO, dataDe([
    { codigo: 'VA08B11111', descripcion: 'Vaso', cantidad: 500, precio: 14.224138, descuento: 0 },
  ]), { lista: '9', leerLista: fa.leerLista }));

  assert.deepEqual(fa.state.lineas.map(l => [l.stockId, l.qty, l.price]), [['VA08B11111', '500', '14.224138']]);
  const final = procesos(fa.state)[0];
  assert.equal(final.get('price'), '0.00', 'la fila de captura viaja como la devolvio el formulario');
  assert.equal(final.get('qty'), '1');
  assert.equal(final.get('stock_id'), '');
});

test('#403 al actualizar: sin el select de listas la actualizacion se completa y lo reporta', async () => {
  const fa = crearServidorFA({ sinSelect: true, lineasIniciales: [{ stockId: 'SKU-VIEJO', qty: 1, price: 1, disc: 0 }] });
  const r = await conFA(fa, () => actualizarQuoteOperam(QUOTE_NO, dataDe([
    { codigo: 'VA08B11111', descripcion: 'Vaso', cantidad: 500, precio: 14.224138, descuento: 0 },
  ]), { lista: '9', leerLista: fa.leerLista }));

  assert.equal(r.ok, true);
  assert.equal(r.lista.escrita, false);
  assert.match(r.lista.motivo, /sales_type/);
});

// Una lista escrita que NO quedo es una divergencia del documento en Operam, igual
// que una partida que no pego: entra a discrepancias y marca la cotizacion.
test('#403 al actualizar: la lista que no quedo escrita sale como discrepancia', async () => {
  const fa = crearServidorFA({ listaInicial: '12', lineasIniciales: [{ stockId: 'SKU-VIEJO', qty: 1, price: 1, disc: 0 }] });
  const r = await conFA(fa, () => actualizarQuoteOperam(QUOTE_NO, dataDe([
    { codigo: 'VA08B11111', descripcion: 'Vaso', cantidad: 500, precio: 14.224138, descuento: 0 },
  ]), { lista: '9', leerLista: async () => '12' }));

  assert.equal(r.ok, false);
  assert.ok(r.discrepancias.some(d => d.campo === 'lista' && String(d.esperado) === '9' && String(d.encontrado) === '12'));
});

// --- Corregir la lista de un quote HISTORICO (#406) --------------------------
// Los quotes anteriores a #403 quedaron registrados con la lista del CLIENTE. Aqui
// solo se corrige ESE campo: ni la vigencia (el "Valido hasta" que el vendedor ya
// acordo con el cliente) ni una sola partida se pueden mover.

const LINEAS = [
  { stockId: 'VA08B11111', qty: 500, price: 14.224138, disc: 0 },
  { stockId: 'TA14Y31111', qty: 12, price: 107.76, disc: 0 },
];

test('#406 corrige la lista del encabezado sin mover la vigencia ni las partidas', async () => {
  const fa = crearServidorFA({ listaInicial: '12', deliveryDateInicial: '2026-08-12', lineasIniciales: LINEAS });
  const r = await conFA(fa, () => corregirListaQuote(QUOTE_NO, '16', { leerQuote: fa.leerQuote }));

  assert.equal(procesos(fa.state).length, 1);
  assert.equal(procesos(fa.state)[0].get('sales_type'), '16');
  assert.equal(procesos(fa.state)[0].get('delivery_date'), '2026-08-12', 'la vigencia viaja como estaba');
  assert.equal(fa.state.deliveryDate, '2026-08-12');
  assert.equal(fa.state.lista, '16');
  assert.deepEqual(fa.state.lineas.map(l => [l.stockId, l.qty, l.price]), LINEAS.map(l => [l.stockId, l.qty, l.price]));

  assert.equal(r.ok, true);
  assert.equal(r.escrito, true);
  assert.equal(r.lista.ok, true);
  assert.equal(r.lista.encontrado, '16');
  assert.equal(r.partidas.ok, true);
  assert.equal(r.partidas.verificado, true);
});

// El criterio duro del ticket: la relectura compara CADA partida y una alterada
// detiene la correccion (el script no sigue con el siguiente quote).
test('#406 si FA reprecia una partida al confirmar, la relectura lo reporta', async () => {
  const fa = crearServidorFA({
    listaInicial: '12', lineasIniciales: LINEAS,
    alConfirmar: (state) => { state.lineas[0].price = 11.5; },
  });
  const r = await conFA(fa, () => corregirListaQuote(QUOTE_NO, '16', { leerQuote: fa.leerQuote }));

  assert.equal(r.escrito, true);
  assert.equal(r.ok, false);
  assert.equal(r.partidas.ok, false);
  assert.equal(r.partidas.discrepancias[0].campo, 'precio');
  assert.equal(r.partidas.discrepancias[0].sku, 'VA08B11111');
});

test('#406 el quote que ya esta en la lista cotizada no se repostea', async () => {
  const fa = crearServidorFA({ listaInicial: '16', lineasIniciales: LINEAS });
  const r = await conFA(fa, () => corregirListaQuote(QUOTE_NO, '16', { leerQuote: fa.leerQuote }));

  assert.equal(fa.state.posts.length, 0);
  assert.equal(r.escrito, false);
  assert.equal(r.ok, true);
  assert.equal(r.lista.yaCorrecto, true);
});

// Sin partidas legibles no habria contra que verificar despues de escribir: se
// abstiene ANTES de tocar nada, que es la direccion segura.
test('#406 un quote sin partidas legibles no se escribe', async () => {
  const fa = crearServidorFA({ listaInicial: '12', lineasIniciales: [] });
  const r = await conFA(fa, () => corregirListaQuote(QUOTE_NO, '16', { leerQuote: fa.leerQuote }));

  assert.equal(fa.state.posts.length, 0);
  assert.equal(r.escrito, false);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /partidas/i);
});

test('#406 si el quote no se puede leer, ni siquiera se abre el formulario de FA', async () => {
  const fa = crearServidorFA({ listaInicial: '12', lineasIniciales: LINEAS });
  const r = await conFA(fa, () => corregirListaQuote(QUOTE_NO, '16', {
    leerQuote: async () => { throw new Error('Operam 503'); },
  }));

  assert.equal(fa.state.formularios, 0);
  assert.equal(fa.state.posts.length, 0);
  assert.equal(r.escrito, false);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /503/);
});

test('#406 una lista que el formulario no ofrece no se escribe y se reporta', async () => {
  const fa = crearServidorFA({ listaInicial: '12', lineasIniciales: LINEAS });
  const r = await conFA(fa, () => corregirListaQuote(QUOTE_NO, '99', { leerQuote: fa.leerQuote }));

  assert.equal(fa.state.posts.length, 0);
  assert.equal(r.escrito, false);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /99/);
});

// Operam responde 200 aunque ignore campos: sin relectura, una lista que no pego se
// reportaria como exito (el quirk de siempre).
test('#406 la lista que no quedo escrita se reporta, no se da por exitosa', async () => {
  const fa = crearServidorFA({ listaInicial: '12', lineasIniciales: LINEAS });
  const r = await conFA(fa, () => corregirListaQuote(QUOTE_NO, '16', {
    leerQuote: async () => ({ order_type: '12', detalles: (await fa.leerQuote()).detalles }),
  }));

  assert.equal(r.escrito, true);
  assert.equal(r.ok, false);
  assert.equal(r.lista.ok, false);
  assert.equal(r.lista.encontrado, '12');
});

test('#406 si la relectura falla despues de escribir, no se afirma nada', async () => {
  const fa = crearServidorFA({ listaInicial: '12', lineasIniciales: LINEAS });
  let vuelta = 0;
  const r = await conFA(fa, () => corregirListaQuote(QUOTE_NO, '16', {
    leerQuote: async () => {
      if (vuelta++ === 0) return fa.leerQuote();
      throw new Error('Operam 503');
    },
  }));

  assert.equal(r.escrito, true);
  assert.equal(r.ok, false);
  assert.equal(r.lista.verificado, false);
  assert.equal(r.partidas.verificado, false);
});
