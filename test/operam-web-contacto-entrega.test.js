// El telefono y el correo del Contacto de entrega en el encabezado del quote (#556,
// ADR-0024).
//
// Medido el 2026-10-09 (quotes 1333-1356 del Cliente Operam 15): el POST de la API v3
// IGNORA contact_phone / contact_email, y el formulario web de edicion prellena el
// campo vacio con el contacto General del Cliente Operam. El post-fix de la vigencia
// reposteaba ese formulario sin sustituirlos y asi lo grababa: la 1330 nacio con el
// "+52 55 3466 7682" del contacto 61 aunque su Contacto de entrega no tenia telefono.
// La actualizacion si los mandaba (#329). Aqui: los dos caminos los escriben
// explicitos -- tambien vacios --, los releen por la API (`contact_phone` /
// `contact_email` del GET del quote) y dicen si casan.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { corregirVigenciaQuote, actualizarQuoteOperam, _resetSesionWeb } from '../lib/operam-web.js';

process.env.OPERAM_URL = 'https://fa.mentira.test';
process.env.OPERAM_USER = 'usuario_de_prueba';
process.env.OPERAM_PASSWORD = 'clave_de_prueba';

const QUOTE_NO = '1330';
const CUSTOMER_ID = '15';
const TEL_GENERAL = '+52 55 3466 7682';
const CORREO_GENERAL = 'general@cliente.mx';

// Servidor FA de mentiras: solo ProcessOrder escribe el encabezado (ADR-0008). El
// formulario trae en `phone` / `email` lo que FA prellena (el contacto General del
// Cliente Operam); `ignorarContacto` simula un FA que responde igual pero no guarda
// los dos campos, que es lo que la relectura existe para atrapar.
function crearServidorFA({ phone = TEL_GENERAL, email = CORREO_GENERAL, deliveryDateInicial = '2026-08-12', lineasIniciales = [], ignorarContacto = false, sinCampos = false } = {}) {
  const state = {
    phone, email, deliveryDate: deliveryDateInicial,
    lineas: lineasIniciales.map(l => ({ ...l })), comments: 'comentario viejo', custRef: 'REF',
    posts: [],
  };
  const formulario = () => `<!DOCTYPE HTML><html><body>
<form method='post' action='/sales/sales_order_entry.php'>
<input type="hidden" name="cart_id" value='CART_${QUOTE_NO}'>
<select name='customer_id'><option value='${CUSTOMER_ID}' selected>Cliente de prueba</option></select>
${state.lineas.map((l, i) => `<a href='../inventory/inquiry/stock_status.php?stock_id=${l.stockId}'>x</a>
<button type='submit' name='Delete${i}' value='1'>Eliminar</button>`).join('\n')}
<input type="text" name="stock_id" value=''>
<input type="text" name="qty" value="1">
<input type="text" name="price" value="0.00">
<input type="text" name="Disc" value="0.0">
<input type="text" name="delivery_date" value="${state.deliveryDate}">
<input type="text" name="deliver_to" value="Cliente de prueba">
<textarea name='delivery_address'>N/A</textarea>
${sinCampos ? '' : `<input type="text" name="phone" value="${state.phone}">
<input type="text" name="email" value="${state.email}">`}
<input type="text" name="cust_ref" value="${state.custRef}">
<textarea name='Comments'>${state.comments}</textarea>
<button type='submit' name='ProcessOrder' value='Confirmar Cambios'>Confirmar</button>
<button type='submit' name='CancelOrder' value='Cancelar'>Cancelar</button>
</form></body></html>`;
  const vista = () => `<table>
<tr><td class='tableheader2'>Valido hasta</td><td id=''>${state.deliveryDate}</td></tr>
<tr><td class='tableheader2'>Comentarios</td><td colspan=3 id=''>${state.comments}</td></tr>
</table>
<table>${state.lineas.map(l => `<tr class='evenrow'>
<td><a href='../../inventory/inquiry/stock_status.php?stock_id=${l.stockId}'>${l.stockId}</a></td><td>Desc catalogo</td>
<td align=right nowrap>${Number(l.qty).toFixed(2)}</td><td>pza</td>
<td nowrap align=right>${Number(l.price).toFixed(2)}</td><td nowrap align=right>${Number(l.disc).toFixed(2)}</td>
<td nowrap align=right>0.00</td><td nowrap align=right>0</td></tr>`).join('')}</table>`;

  async function fetchMock(url, init = {}) {
    const metodo = (init.method || 'GET').toUpperCase();
    const u = String(url);
    if (u.includes('trans_no=1&trans_type=30')) return new Response('<html>login de mentira</html>', { status: 200 });
    if (metodo === 'GET' && u.includes('ModifyQuotationNumber=')) return new Response(formulario(), { status: 200 });
    if (metodo === 'GET' && u.includes(`trans_no=${QUOTE_NO}&trans_type=32`)) return new Response(vista(), { status: 200 });
    if (metodo === 'POST' && u.endsWith('/sales/sales_order_entry.php')) {
      const params = new URLSearchParams(String(init.body || ''));
      if (params.has('CancelOrder')) throw new Error('JAMAS debe mandarse CancelOrder');
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
        if (!ignorarContacto && params.has('phone')) state.phone = params.get('phone');
        if (!ignorarContacto && params.has('email')) state.email = params.get('email');
        return new Response(formulario(), { status: 200 });
      }
      throw new Error('mock FA: POST sin submit reconocido: ' + String(init.body));
    }
    throw new Error('mock FA: URL no manejada: ' + metodo + ' ' + u);
  }

  // La relectura va por la API v3 (`contact_phone` / `contact_email` del GET del
  // quote); aqui se inyecta leyendo lo que quedo escrito en el servidor de mentiras.
  const lectores = { leerTelefono: async () => state.phone, leerCorreo: async () => state.email };
  return { fetchMock, state, lectores };
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

// --- Crear: el post-fix que sigue al POST de la API ----------------------------

// La reproduccion de la 1330: Contacto de entrega sin telefono ni correo, formulario
// prellenado con los del contacto General.
test('#556 al crear: sin telefono ni correo de entrega el ProcessOrder los manda VACIOS y la relectura lo confirma', async () => {
  const fa = crearServidorFA();
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-20', { telefono: '', correo: '', ...fa.lectores }));

  assert.equal(procesos(fa.state).length, 1);
  assert.equal(procesos(fa.state)[0].get('phone'), '');
  assert.equal(procesos(fa.state)[0].get('email'), '');
  assert.equal(fa.state.phone, '');
  assert.equal(r.ok, true, 'la vigencia no se ve afectada');
  assert.deepEqual(r.telefono, {
    aplica: true, esperado: '', escrita: true, yaCorrecto: false,
    ok: true, verificado: true, encontrado: '', motivo: null,
  });
  assert.deepEqual(r.correo, {
    aplica: true, esperado: '', escrita: true, yaCorrecto: false,
    ok: true, verificado: true, encontrado: '', motivo: null,
  });
});

test('#556 al crear: el telefono y el correo del Contacto de entrega sustituyen los del General', async () => {
  const fa = crearServidorFA();
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-20', { telefono: '+52 55 1111 2222', correo: 'recibe@cliente.mx', ...fa.lectores }));

  assert.equal(procesos(fa.state)[0].get('phone'), '+52 55 1111 2222');
  assert.equal(procesos(fa.state)[0].get('email'), 'recibe@cliente.mx');
  assert.equal(r.telefono.ok, true);
  assert.equal(r.telefono.encontrado, '+52 55 1111 2222');
  assert.equal(r.correo.ok, true);
  assert.equal(r.correo.encontrado, 'recibe@cliente.mx');
});

// El formulario NO es evidencia de lo que el quote tiene: prellena el vacio con el
// General. Con la vigencia ya correcta y el formulario mostrando el mismo numero, se
// escribe igual (el corto circuito de #106 no aplica a estos dos campos).
test('#556 al crear: con la vigencia ya correcta y el formulario mostrando el mismo telefono, SI se escribe', async () => {
  const fa = crearServidorFA({ deliveryDateInicial: '2026-10-20' });
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-20', { telefono: TEL_GENERAL, correo: CORREO_GENERAL, ...fa.lectores }));

  assert.equal(procesos(fa.state).length, 1);
  assert.equal(procesos(fa.state)[0].get('phone'), TEL_GENERAL);
  assert.equal(r.telefono.escrita, true);
  assert.equal(r.telefono.ok, true);
});

// 200 no garantiza nada: si FA no guardo los dos campos, la relectura lo dice.
test('#556 al crear: escrito y no guardado -> no ok, verificado, con lo que se leyo', async () => {
  const fa = crearServidorFA({ ignorarContacto: true });
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-20', { telefono: '', correo: 'recibe@cliente.mx', ...fa.lectores }));

  assert.equal(r.ok, true, 'la vigencia quedo');
  assert.equal(r.telefono.escrita, true);
  assert.equal(r.telefono.ok, false);
  assert.equal(r.telefono.verificado, true);
  assert.equal(r.telefono.encontrado, TEL_GENERAL);
  assert.equal(r.correo.ok, false);
  assert.equal(r.correo.encontrado, CORREO_GENERAL);
});

test('#556 al crear: si la relectura falla no se afirma nada y el motivo lo dice', async () => {
  const fa = crearServidorFA();
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-20', {
    telefono: '', correo: '',
    leerTelefono: async () => { throw new Error('Operam 503'); }, leerCorreo: fa.lectores.leerCorreo,
  }));

  assert.equal(r.telefono.escrita, true);
  assert.equal(r.telefono.ok, false);
  assert.equal(r.telefono.verificado, false);
  assert.match(r.telefono.motivo, /Operam 503/);
  assert.equal(r.correo.ok, true);
});

// Lo que llega sin telefono ni correo (una fila de la cola encolada antes de #556) no
// los toca: el ProcessOrder sale con lo que traia el formulario, como antes.
test('#556 al crear: sin telefono ni correo pedidos no se sustituyen y no aplican', async () => {
  const fa = crearServidorFA();
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-20', { ...fa.lectores }));

  assert.equal(procesos(fa.state)[0].get('phone'), TEL_GENERAL);
  assert.equal(r.telefono.aplica, false);
  assert.equal(r.telefono.escrita, false);
  assert.equal(r.telefono.ok, true);
});

test('#556 al crear: un formulario sin phone ni email no se postea con campos inventados y sale con motivo', async () => {
  const fa = crearServidorFA({ sinCampos: true });
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-20', { telefono: '', correo: '', ...fa.lectores }));

  assert.equal(r.ok, true, 'la vigencia si se corrige');
  assert.equal(procesos(fa.state)[0].has('phone'), false);
  assert.equal(r.telefono.aplica, true);
  assert.equal(r.telefono.escrita, false);
  assert.equal(r.telefono.ok, false);
  assert.match(r.telefono.motivo, /phone/);
  assert.match(r.correo.motivo, /email/);
});

// --- Actualizar (#104): ya los mandaba (#329); ahora se releen y se reportan ------

const DATA_ACTUALIZAR = {
  fecha: '2026-09-24', vigencia: '2026-10-24',
  cliente: { razonSocial: 'Cliente de prueba', nombreCorto: 'Prueba', customerId: CUSTOMER_ID, cpEntrega: '56530', celEntrega: '+52 55 1111 2222', emailEntrega: 'recibe@cliente.mx' },
  items: [{ codigo: 'SKU-A', descripcion: 'Plato', cantidad: 2, precio: 100, descuento: 0 }],
};

test('#556 actualizar: el ProcessOrder lleva el telefono y el correo del Contacto de entrega y la relectura los confirma', async () => {
  const fa = crearServidorFA({ lineasIniciales: [{ stockId: 'SKU-VIEJO', qty: 1, price: 1, disc: 0 }] });
  const r = await conFA(fa, () => actualizarQuoteOperam(QUOTE_NO, DATA_ACTUALIZAR, fa.lectores));

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(procesos(fa.state)[0].get('phone'), '+52 55 1111 2222');
  assert.equal(procesos(fa.state)[0].get('email'), 'recibe@cliente.mx');
  assert.equal(r.telefono.ok, true);
  assert.equal(r.telefono.escrita, true);
  assert.equal(r.correo.ok, true);
});

test('#556 actualizar: sin telefono de entrega viaja vacio, aunque el formulario traiga el del General', async () => {
  const fa = crearServidorFA({ lineasIniciales: [{ stockId: 'SKU-VIEJO', qty: 1, price: 1, disc: 0 }] });
  const data = { ...DATA_ACTUALIZAR, cliente: { ...DATA_ACTUALIZAR.cliente, celEntrega: '', emailEntrega: '' } };
  const r = await conFA(fa, () => actualizarQuoteOperam(QUOTE_NO, data, fa.lectores));

  assert.equal(procesos(fa.state)[0].get('phone'), '');
  assert.equal(procesos(fa.state)[0].get('email'), '');
  assert.equal(r.telefono.ok, true);
  assert.equal(r.telefono.esperado, '');
});

// Como el transportista: uno que no pega sale como paso propio y no tumba la
// actualizacion -- las partidas y la vigencia si quedaron.
test('#556 actualizar: un telefono que no pega NO tumba la actualizacion y dice lo que se leyo', async () => {
  const fa = crearServidorFA({ ignorarContacto: true, lineasIniciales: [{ stockId: 'SKU-VIEJO', qty: 1, price: 1, disc: 0 }] });
  const r = await conFA(fa, () => actualizarQuoteOperam(QUOTE_NO, DATA_ACTUALIZAR, fa.lectores));

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.telefono.ok, false);
  assert.equal(r.telefono.verificado, true);
  assert.equal(r.telefono.encontrado, TEL_GENERAL);
});

test('#556 actualizar: si falla antes del ProcessOrder el telefono y el correo salen no escritos con motivo', async () => {
  const fa = crearServidorFA();
  const r = await conFA(fa, () => actualizarQuoteOperam(QUOTE_NO, { ...DATA_ACTUALIZAR, items: [] }, fa.lectores));

  assert.equal(r.ok, false);
  assert.equal(r.telefono.escrita, false);
  assert.equal(r.telefono.ok, false);
  assert.ok(r.telefono.motivo);
  assert.equal(r.correo.escrita, false);
  assert.ok(r.correo.motivo);
});
