// Orquestacion de actualizarQuoteOperam (lib/operam-web.js) con foco en la ronda de
// descripcion por partida (#139). test/operam-web.test.js ya cubre las piezas puras
// (parsers/serializadores/comparador) contra HTML real; este archivo cubre el
// COMPORTAMIENTO EXTERNO del orquestador completo: el orden de los POSTs, que solo
// las partidas marcadas entren a la ronda, y que un fallo a mitad de camino deje el
// quote intacto (nunca ProcessOrder sin verificar antes que la linea correcta quedo
// en edicion).
//
// Se mockea globalThis.fetch con un servidor FA de mentiras que mantiene su propio
// estado (lineas del carrito, linea en edicion, header) y responde a cada submit
// segun el nombre del boton que trae el body -- igual que FA real distinguiria
// Delete0 de AddItem de ProcessOrder. Dos de los tests usan el HTML REAL de la vista
// del quote 1216 (quote-1216-vista-2.html) para la verificacion final, tal como pide
// el issue: la comparacion contra una vista real es la unica forma de saber si la
// ronda de edicion por linea de verdad quedo escrita en Operam.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { actualizarQuoteOperam, _resetSesionWeb } from '../lib/operam-web.js';

const DIR_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const VISTA_1216_DESC = readFileSync(join(DIR_FIXTURES, 'quote-1216-vista-2.html'), 'utf8');

// crearSesionFA() sin argumentos toma base/user/pass de process.env; se fijan aqui
// para que new URL(action, base) resuelva a una URL absoluta valida sin depender de
// que el entorno de CI tenga OPERAM_URL cargado (server.js es quien carga .env, y
// este archivo no lo importa).
process.env.OPERAM_URL = 'https://fa.mentira.test';
process.env.OPERAM_USER = 'usuario_de_prueba';
process.env.OPERAM_PASSWORD = 'clave_de_prueba';

const QUOTE_NO = '1216';
const CUSTOMER_ID = '14';

// --- Servidor FA de mentiras --------------------------------------------------
// Mantiene el carrito en memoria (como $_SESSION en FA real) y responde el mismo
// formulario que existe en ese momento; solo cambia cuando llega el submit que lo
// modifica. Al re-agregar una linea le pone la descripcion del CATALOGO (igual que
// FA real, verificado en vivo con el quote 1216): eso es justo lo que obliga a la
// ronda de edicion por linea a existir.
const DESCRIPCION_CATALOGO = 'Descripcion de catalogo Operam';

function filaNormal(indice, { stockId, desc, qty, price, disc }) {
  return `<tr class='evenrow'>
<td><a target='_blank' href='../inventory/inquiry/stock_status.php?stock_id=${stockId}'>${stockId}</a></td><td>${desc}</td>
<td nowrap align=right>${qty}</td>
<td nowrap align=right>0.00</td>
<td>pza</td>
<td style='text-align:right;'>${price}</td>
<td nowrap align=right>${disc}</td>
<td nowrap align=right>${price}</td>
<td align='center'><button type='submit' class='editbutton' name='Edit${indice}' value='1'>Editar</button></td>
<td align='center'><button type='submit' class='editbutton' name='Delete${indice}' value='1'>Eliminar</button></td>
</tr>`;
}

// Fila de una partida EN EDICION: sin boton Delete (como en quote-1216-form-edit0.html
// real), con item_description, LineNo y stock_id -- los tres campos que el orquestador
// necesita para confirmar que aterrizo en la partida correcta antes de escribir nada.
function filaEnEdicion(indice, { stockId, desc, qty, price, disc }) {
  return `<tr class='evenrow'>
<input type="hidden" name="stock_id" value='${stockId}'>
<td>${stockId}</td>
<td><textarea name='item_description' maxlength='1000'>${desc}</textarea></td>
<td align='right'><input class='amount' type="text" name="qty" value="${qty}"></td>
<td nowrap align=right>0.00</td>
<td id='units'>pza</td>
<td align='right'><input class='amount' type="text" name="price" value="${price}"></td>
<td align='right'><input class='amount' type="text" name="Disc" value="${disc}"></td>
<td nowrap align=right>${price}</td>
<td align='center'><button type='submit' class='editbutton' name='UpdateItem' value='1'>Confirmar</button></td>
<td align='center'><button type='submit' class='editbutton' name='CancelItemChanges' value='1'>Cancelar</button></td>
<input type="hidden" name="LineNo" value='${indice}'>
</tr>`;
}

// Fila de captura de linea nueva: NO cuenta como partida (parsearLineasQuote la
// ignora porque no trae Delete{n}). No aparece mientras hay una linea en edicion
// (tampoco en el HTML real: quote-1216-form-edit0.html no la trae).
function filaCaptura() {
  return `<tr class='oddrow'>
<td><select name='stock_id'><option value=''></option></select></td>
<td align='right'><input class='amount' type="text" name="qty" value="1"></td>
<td nowrap align=right>0</td>
<td>pza</td>
<td align='right'><input class='amount' type="text" name="price" value="0.00"></td>
<td align='right'><input class='amount' type="text" name="Disc" value="0.0"></td>
<td nowrap align=right>0.00</td>
<td colspan=2 align='center'><button type='submit' name='AddItem' id='AddItem' value='Agregar'>Agregar</button></td>
</tr>`;
}

function formularioEdicion({ lineas, editando, deliveryDate, comments, custRef, customerId }) {
  const filas = lineas.map((l, i) => (i === editando ? filaEnEdicion(i, l) : filaNormal(i, l))).join('\n');
  const captura = editando == null ? filaCaptura() : '';
  return `<!DOCTYPE HTML><html><body><div id='msgbox'></div>
<form method='post' action='/sales/sales_order_entry.php'>
<input type="hidden" name="cart_id" value='CART_TEST_${QUOTE_NO}'>
<select name='customer_id'><option value='${customerId}' selected>Cliente de prueba</option></select>
<input type="text" name="OrderDate" value="2026-08-13">
<table>
${filas}
${captura}
</table>
<input type="text" name="delivery_date" value="${deliveryDate}">
<input type="text" name="deliver_to" value="Cliente de prueba">
<textarea name='delivery_address'>N/A - quote de prueba</textarea>
<input type="text" name="cust_ref" value="${custRef}">
<textarea name='Comments'>${comments}</textarea>
<select name='ship_via'><option value='1' selected>Default</option></select>
<button type='submit' name='ProcessOrder' value='Confirmar Cambios'>Confirmar</button>
<button type='submit' name='CancelOrder' value='Cancelar Cotizacion'>Cancelar</button>
<input type="hidden" name="_token" value='TOKEN_DE_PRUEBA'>
</form>
</body></html>`;
}

// Vista read-only sintetica: mismo formato de celdas que leerLineasVista espera
// (Codigo | Descripcion | Cantidad | Unidad | Precio | Descuento | Total | Cantidad
// de Pedido), mas "Valido hasta" y "Comentarios". Se autogenera del ESTADO del
// servidor de mentiras despues del ProcessOrder, asi que un ciclo correcto siempre
// produce una vista consistente sin tener que duplicar los valores a mano.
function vistaDesdeEstado({ lineas, deliveryDate, comments }) {
  const filas = lineas.map((l) => `<tr class='evenrow'>
<td><a href='../../inventory/inquiry/stock_status.php?stock_id=${l.stockId}'>${l.stockId}</a></td><td>${l.desc}</td>
<td align=right nowrap>${Number(l.qty).toFixed(2)}</td>
<td>pza</td>
<td nowrap align=right>${Number(l.price).toFixed(2)}</td>
<td nowrap align=right>${Number(l.disc).toFixed(2)}</td>
<td nowrap align=right>${Number(l.price).toFixed(2)}</td>
<td nowrap align=right>0.00</td>
</tr>`).join('\n');
  return `<!DOCTYPE HTML><html><body>
<table>
<tr><td class='tableheader2'>Valido hasta</td><td id=''>${deliveryDate}</td></tr>
</table>
<table>${filas}</table>
<table>
<tr><td class='tableheader2'>Comentarios</td><td colspan=3 id=''>${comments}</td></tr>
</table>
</body></html>`;
}

// Arma un servidor FA de mentiras con su propio estado y devuelve el fetch mock mas
// el estado (para afirmar sobre los POSTs posteados). romperEdicion simula un Edit{n}
// que FA ignorara (el formulario vuelve normal, sin LineNo): es el escenario del test
// mas importante, el que verifica que un fallo a mitad de camino no llega a
// ProcessOrder. vistaFinalHtml, cuando se da, sustituye la vista sintetica por HTML
// real (usado en los tests que verifican contra quote-1216-vista-2.html).
function crearServidorFA({
  quoteNo = QUOTE_NO,
  customerId = CUSTOMER_ID,
  lineasIniciales = [],
  deliveryDateInicial = '2026-08-12',
  commentsInicial = 'comentario viejo del quote',
  custRefInicial = 'REF-VIEJA',
  romperEdicion = false,
  vistaFinalHtml = null,
} = {}) {
  const state = {
    lineas: lineasIniciales.map((l) => ({ ...l })),
    editando: null,
    deliveryDate: deliveryDateInicial,
    comments: commentsInicial,
    custRef: custRefInicial,
    customerId,
    posts: [],
  };

  const formularioActual = () => formularioEdicion({
    lineas: state.lineas, editando: state.editando, deliveryDate: state.deliveryDate,
    comments: state.comments, custRef: state.custRef, customerId: state.customerId,
  });
  const vistaActual = () => vistaFinalHtml ?? vistaDesdeEstado(state);

  async function fetchMock(url, init = {}) {
    const method = (init.method || 'GET').toUpperCase();
    const u = String(url);
    const bodyStr = init.body != null ? String(init.body) : '';

    // Login FA (crearSesionFA usa vistaUrl(base,1,30) como pagina semilla).
    if (u.includes('trans_no=1&trans_type=30')) {
      return new Response('<html><body>Bienvenido (login de mentira, FA de pruebas)</body></html>', { status: 200 });
    }
    if (method === 'GET' && u.includes('ModifyQuotationNumber=')) {
      return new Response(formularioActual(), { status: 200 });
    }
    if (method === 'GET' && u.includes(`trans_no=${quoteNo}&trans_type=32`)) {
      return new Response(vistaActual(), { status: 200 });
    }
    if (method === 'POST' && u.endsWith('/sales/sales_order_entry.php')) {
      const params = new URLSearchParams(bodyStr);
      state.posts.push({ url: u, body: bodyStr, params });

      if (params.has('Delete0')) {
        state.lineas.shift();
        return new Response(formularioActual(), { status: 200 });
      }
      if (params.has('AddItem')) {
        state.lineas.push({
          stockId: params.get('stock_id'),
          desc: DESCRIPCION_CATALOGO,
          qty: params.get('qty'),
          price: params.get('price'),
          disc: params.get('Disc'),
        });
        return new Response(formularioActual(), { status: 200 });
      }
      const editKey = [...params.keys()].find((k) => /^Edit\d+$/.test(k));
      if (editKey) {
        const indice = Number(editKey.slice(4));
        // romperEdicion simula que FA NO entro en modo edicion (bug/pagina inesperada):
        // el formulario vuelve identico, normal, sin LineNo.
        if (!romperEdicion) state.editando = indice;
        return new Response(formularioActual(), { status: 200 });
      }
      if (params.has('UpdateItem')) {
        if (state.editando != null) state.lineas[state.editando].desc = params.get('item_description');
        state.editando = null;
        return new Response(formularioActual(), { status: 200 });
      }
      if (params.has('ProcessOrder')) {
        state.deliveryDate = params.get('delivery_date');
        state.comments = params.get('Comments');
        state.custRef = params.get('cust_ref');
        return new Response(formularioActual(), { status: 200 });
      }
      throw new Error('mock FA: POST sin submit reconocido: ' + bodyStr);
    }

    throw new Error('mock FA: URL no manejada por el mock: ' + method + ' ' + u);
  }

  return { fetchMock, state };
}

// data minima para armarContenidoQuote: vigencia y fecha fijas para que el quote
// esperado sea determinista (sin depender de "hoy").
function dataDe(items) {
  return {
    cliente: { customerId: CUSTOMER_ID, razonSocial: 'Cliente de prueba' },
    items,
    vigencia: '2026-09-12',
    fecha: '2026-08-13',
    notas: [],
  };
}

const ITEM_EDITADO = {
  codigo: 'TA14Y31111', descripcion: 'SONDA DESC WEB 888', cantidad: 1, precio: 107.76, descuento: 0,
  descripcionEditada: true,
};

// --- Tests ---------------------------------------------------------------------

// El corazon de #139: la partida con descripcion editada dispara Edit0 -> (texto del
// vendedor + UpdateItem) -> y solo DESPUES el ProcessOrder que confirma todo el
// documento. Si el orden se invirtiera, ProcessOrder confirmaria la descripcion vieja
// del catalogo (la que puso el AddItem) y la ronda de edicion no serviria de nada.
test('actualizarQuoteOperam: partida con descripcion editada emite Edit0, luego item_description+UpdateItem, y UN solo ProcessOrder despues', async () => {
  _resetSesionWeb();
  const fetchOriginal = globalThis.fetch;
  const { fetchMock, state } = crearServidorFA({
    lineasIniciales: [{ stockId: 'TA14Y31111', desc: 'descripcion vieja del quote', qty: 1, price: 100, disc: 0 }],
  });
  globalThis.fetch = fetchMock;
  try {
    const r = await actualizarQuoteOperam(QUOTE_NO, dataDe([ITEM_EDITADO]));

    const submits = state.posts.map((p) => [...p.params.keys()].find((k) => /^(Edit\d+|UpdateItem|ProcessOrder|Delete0|AddItem)$/.test(k)));
    const iEdit = submits.indexOf('Edit0');
    const iUpdate = submits.indexOf('UpdateItem');
    const iProcess = submits.indexOf('ProcessOrder');
    assert.ok(iEdit !== -1 && iUpdate !== -1 && iProcess !== -1, 'Edit0, UpdateItem y ProcessOrder deben estar presentes');
    assert.ok(iEdit < iUpdate, 'Edit0 debe ir antes que UpdateItem');
    assert.ok(iUpdate < iProcess, 'UpdateItem debe ir antes que ProcessOrder');
    assert.equal(submits.filter((k) => k === 'ProcessOrder').length, 1, 'un solo ProcessOrder en todo el ciclo');

    const postUpdate = state.posts.find((p) => p.params.has('UpdateItem'));
    assert.equal(postUpdate.params.get('item_description'), 'SONDA DESC WEB 888');

    // El servidor de mentiras refleja su propio estado en la vista: un ciclo correcto
    // debe quedar sin discrepancias contra si mismo.
    assert.equal(r.escrito, true);
    assert.equal(r.ok, true);
    assert.deepEqual(r.discrepancias, []);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

// Sin descripciones editadas la ronda de #139 no debe gastar ni un POST: el
// comportamiento tiene que ser IDENTICO al de antes de la feature (solo borrar,
// agregar y un ProcessOrder).
test('actualizarQuoteOperam: sin descripciones editadas no emite ni un solo Edit ni UpdateItem', async () => {
  _resetSesionWeb();
  const fetchOriginal = globalThis.fetch;
  const { fetchMock, state } = crearServidorFA({
    lineasIniciales: [{ stockId: 'VIEJO1', desc: 'x', qty: 1, price: 1, disc: 0 }],
  });
  globalThis.fetch = fetchMock;
  try {
    const items = [
      { codigo: 'TA14Y31111', descripcion: 'Tazon 14 mostaza filete negro', cantidad: 1, precio: 107.76, descuento: 0 },
      { codigo: '251021001', descripcion: 'FedEx Ground', cantidad: 1, precio: 50, descuento: 0 },
    ];
    const r = await actualizarQuoteOperam(QUOTE_NO, dataDe(items));

    for (const p of state.posts) {
      for (const k of p.params.keys()) {
        assert.equal(/^(Edit\d+|UpdateItem)$/.test(k), false, `no debe emitirse ${k} sin descripciones editadas`);
      }
    }
    // El resto del ciclo (borrar la linea vieja, agregar las dos nuevas, un solo
    // ProcessOrder) debe seguir intacto: la feature no debio tocar ese camino.
    assert.equal(state.posts.filter((p) => p.params.has('Delete0')).length, 1);
    assert.equal(state.posts.filter((p) => p.params.has('AddItem')).length, 2);
    assert.equal(state.posts.filter((p) => p.params.has('ProcessOrder')).length, 1);
    assert.equal(r.escrito, true);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

// Con dos partidas y solo una marcada, la ronda debe entrar a la linea correcta
// (Edit1, no Edit0): un indice equivocado escribiria la descripcion del vendedor
// sobre la partida de OTRO articulo.
test('actualizarQuoteOperam: con dos partidas y una sola editada, se edita esa y no la otra', async () => {
  _resetSesionWeb();
  const fetchOriginal = globalThis.fetch;
  const { fetchMock, state } = crearServidorFA({ lineasIniciales: [] });
  globalThis.fetch = fetchMock;
  try {
    const itemA = { codigo: 'AAA111', descripcion: 'Articulo A (queda con la del catalogo)', cantidad: 2, precio: 50, descuento: 0 };
    const itemB = { ...ITEM_EDITADO };
    const r = await actualizarQuoteOperam(QUOTE_NO, dataDe([itemA, itemB]));

    const editKeys = state.posts.flatMap((p) => [...p.params.keys()].filter((k) => /^Edit\d+$/.test(k)));
    assert.deepEqual(editKeys, ['Edit1']);

    const postUpdate = state.posts.find((p) => p.params.has('UpdateItem'));
    assert.equal(postUpdate.params.get('stock_id'), 'TA14Y31111');
    assert.equal(postUpdate.params.get('item_description'), 'SONDA DESC WEB 888');

    assert.equal(r.escrito, true);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

// Regla de seguridad de la casa (ADR-0007/0008): CancelOrder anula la cotizacion y
// CancelItemChanges descarta la edicion de la linea. Ninguno de los dos puede viajar
// en NINGUN body de todo el ciclo, ronda de descripcion incluida.
test('actualizarQuoteOperam: ningun body del ciclo completo lleva CancelOrder ni CancelItemChanges', async () => {
  _resetSesionWeb();
  const fetchOriginal = globalThis.fetch;
  const { fetchMock, state } = crearServidorFA({
    lineasIniciales: [{ stockId: 'TA14Y31111', desc: 'vieja', qty: 1, price: 100, disc: 0 }],
  });
  globalThis.fetch = fetchMock;
  try {
    await actualizarQuoteOperam(QUOTE_NO, dataDe([ITEM_EDITADO]));
    assert.ok(state.posts.length > 0, 'la corrida debio postear algo');
    for (const p of state.posts) {
      assert.equal(p.params.has('CancelOrder'), false, `CancelOrder no debe ir en: ${p.body}`);
      assert.equal(p.params.has('CancelItemChanges'), false, `CancelItemChanges no debe ir en: ${p.body}`);
    }
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

// El caso mas importante: si Edit{n} no dejo el formulario en la partida pedida (bug
// de Operam, pagina inesperada), el orquestador debe abortar ANTES de ProcessOrder.
// El contrato de ADR-0008 es que un fallo antes de ProcessOrder deja el quote
// INTACTO -- por eso lo que se verifica aqui no es solo el resultado, sino que NINGUN
// POST de la corrida llevo ProcessOrder.
test('actualizarQuoteOperam: si el form no queda en la linea a editar, aborta antes del ProcessOrder y el quote queda intacto', async () => {
  _resetSesionWeb();
  const fetchOriginal = globalThis.fetch;
  const { fetchMock, state } = crearServidorFA({ lineasIniciales: [], romperEdicion: true });
  globalThis.fetch = fetchMock;
  try {
    const r = await actualizarQuoteOperam(QUOTE_NO, dataDe([ITEM_EDITADO]));
    assert.equal(r.escrito, false);
    assert.equal(r.ok, false);
    assert.match(r.error, /partida/i);
    assert.equal(state.posts.some((p) => p.params.has('ProcessOrder')), false, 'no debe haber ProcessOrder si la edicion de la linea fallo');
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

// Verificacion final contra HTML REAL (quote-1216-vista-2.html, la vista que la sonda
// en vivo trajo con "SONDA DESC WEB 888" ya escrita): cuando la descripcion esperada
// coincide con la que quedo en Operam, no hay discrepancia de descripcion. (Los
// comentarios de esa vista los escribio a mano la sonda del 2026-08-13 y no siguen el
// formato de armarComentariosQuote, asi que este test no exige el `ok` global -- solo
// que la pieza que #139 vino a arreglar, la descripcion, quedo correcta.)
test('actualizarQuoteOperam: la descripcion editada que SI quedo escrita no aparece como discrepancia (vista real del quote 1216)', async () => {
  _resetSesionWeb();
  const fetchOriginal = globalThis.fetch;
  const { fetchMock } = crearServidorFA({ lineasIniciales: [], vistaFinalHtml: VISTA_1216_DESC });
  globalThis.fetch = fetchMock;
  try {
    const item = { codigo: 'TA14Y31111', descripcion: 'SONDA DESC WEB 888', cantidad: 1, precio: 107.76, descuento: 0, descripcionEditada: true };
    const r = await actualizarQuoteOperam(QUOTE_NO, dataDe([item]));
    assert.equal(r.escrito, true);
    assert.equal(r.verificado, true);
    assert.equal(r.discrepancias.some((d) => d.campo === 'descripcion'), false);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

// Mismo HTML real, pero se le pide al orquestador otra descripcion (una que NO quedo
// escrita en Operam): debe reportarse como discrepancia SI, con escrito:true (el
// ProcessOrder se mando y se confirmo) y ok:false. Es la unica forma de que el
// vendedor se entere de que la ronda de edicion no aterrizo -- el ProcessOrder de la
// web legacy no trae marcador de exito (verificado con el quote 1216).
test('actualizarQuoteOperam: la descripcion editada que NO quedo escrita se reporta como discrepancia (ok:false, escrito:true)', async () => {
  _resetSesionWeb();
  const fetchOriginal = globalThis.fetch;
  const { fetchMock } = crearServidorFA({ lineasIniciales: [], vistaFinalHtml: VISTA_1216_DESC });
  globalThis.fetch = fetchMock;
  try {
    const item = { codigo: 'TA14Y31111', descripcion: 'Tazon esmaltado a mano, mostaza', cantidad: 1, precio: 107.76, descuento: 0, descripcionEditada: true };
    const r = await actualizarQuoteOperam(QUOTE_NO, dataDe([item]));
    assert.equal(r.escrito, true);
    assert.equal(r.ok, false);
    const d = r.discrepancias.find((x) => x.campo === 'descripcion');
    assert.ok(d, 'debe reportar la discrepancia de descripcion');
    assert.equal(d.esperado, 'Tazon esmaltado a mano, mostaza');
    assert.equal(d.encontrado, 'SONDA DESC WEB 888');
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});
