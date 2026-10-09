// El telefono y el correo del Contacto de entrega en el ENCABEZADO del quote (#556,
// ADR-0024).
//
// Medido el 2026-10-09 (quotes 1333-1356 del Cliente Operam 15): el POST de la API v3
// IGNORA contact_phone / contact_email y los deriva del contacto del domicilio; y el
// formulario web de edicion PRELLENA el campo vacio con el contacto General del
// CLIENTE. La correccion de vigencia que sigue al POST repostea ese formulario, asi que
// sin sustituir `phone` / `email` grababa el telefono del General: asi nacio la 1330
// con "+52 55 3466 7682" aunque su Contacto de entrega no tenia telefono.
//
// Viajan por el MISMO ProcessOrder que la vigencia, la lista y el transportista, se
// escriben SIEMPRE explicitos -- tambien vacios -- y se verifican releyendo el quote
// por la API v3 (`contact_phone` / `contact_email`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { corregirVigenciaQuote, actualizarQuoteOperam, _resetSesionWeb } from '../lib/operam-web.js';

process.env.OPERAM_URL = 'https://fa.mentira.test';
process.env.OPERAM_USER = 'usuario_de_prueba';
process.env.OPERAM_PASSWORD = 'clave_de_prueba';

const QUOTE_NO = '1330';
const CUSTOMER_ID = '15';
const TEL_GENERAL = '+52 55 3466 7682';
const CORREO_GENERAL = 'general@peltre.test';

// Servidor FA de mentiras. Lo que el quote tiene GUARDADO (`state.phone`) no es lo que
// el formulario muestra: con el campo vacio, FA prellena el input con el contacto
// General del cliente (`prellenado`). Solo ProcessOrder escribe el encabezado.
// `ignorarContacto` simula un FA que responde 200 sin guardar telefono ni correo.
function crearServidorFA({ phone = '', email = '', prellenado = { phone: TEL_GENERAL, email: CORREO_GENERAL }, deliveryDateInicial = '2026-10-08', lineasIniciales = [], sinCampos = false, ignorarContacto = false } = {}) {
  const state = { phone, email, deliveryDate: deliveryDateInicial, lineas: lineasIniciales.map(l => ({ ...l })), comments: '', custRef: 'REF', posts: [] };
  const mostrado = (campo) => state[campo] || prellenado[campo] || '';
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
${sinCampos ? '' : `<input type="text" name="phone" value="${mostrado('phone')}">
<input type="text" name="email" value="${mostrado('email')}">`}
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
        if (!ignorarContacto) {
          if (params.has('phone')) state.phone = params.get('phone');
          if (params.has('email')) state.email = params.get('email');
        }
        return new Response(formulario(), { status: 200 });
      }
      throw new Error('mock FA: POST sin submit reconocido: ' + String(init.body));
    }
    throw new Error('mock FA: URL no manejada: ' + metodo + ' ' + u);
  }

  // La relectura va por la API v3 (`contact_phone` / `contact_email` del GET del
  // quote): aqui se inyecta leyendo lo que quedo GUARDADO, no lo que muestra el form.
  const leerTelefonoEntrega = async () => state.phone;
  const leerCorreoEntrega = async () => state.email;
  return { fetchMock, state, lectores: { leerTelefonoEntrega, leerCorreoEntrega } };
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

// --- Crear: la correccion posterior al POST ------------------------------------

test('#556 al crear: sin telefono ni correo de entrega el ProcessOrder los manda VACIOS y no graba los del General', async () => {
  const fa = crearServidorFA();
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-22', {
    telefonoEntrega: '', correoEntrega: '', ...fa.lectores,
  }));

  assert.equal(procesos(fa.state).length, 1);
  assert.equal(procesos(fa.state)[0].get('phone'), '');
  assert.equal(procesos(fa.state)[0].get('email'), '');
  assert.equal(fa.state.phone, '');
  assert.equal(fa.state.email, '');
  assert.equal(r.ok, true, 'la vigencia no se ve afectada');
  assert.deepEqual(r.telefonoEntrega, {
    aplica: true, esperado: '', escrita: true, yaCorrecto: false,
    ok: true, verificado: true, encontrado: '', motivo: null,
  });
  assert.equal(r.correoEntrega.ok, true);
  assert.equal(r.correoEntrega.verificado, true);
});

test('#556 al crear: con telefono y correo propios los escribe en lugar de los prellenados y la relectura los confirma', async () => {
  const fa = crearServidorFA();
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-22', {
    telefonoEntrega: '+52 55 1111 2222', correoEntrega: 'recibe@cliente.test', ...fa.lectores,
  }));

  assert.equal(procesos(fa.state)[0].get('phone'), '+52 55 1111 2222');
  assert.equal(procesos(fa.state)[0].get('email'), 'recibe@cliente.test');
  assert.equal(r.telefonoEntrega.ok, true);
  assert.equal(r.telefonoEntrega.encontrado, '+52 55 1111 2222');
  assert.equal(r.correoEntrega.ok, true);
  assert.equal(r.correoEntrega.encontrado, 'recibe@cliente.test');
});

// El corto circuito de #106 (vigencia ya correcta, nada mas que escribir) no aplica:
// lo que el formulario muestra no es lo guardado, asi que "ya correcto" no se decide
// contra el formulario.
test('#556 al crear: con la vigencia ya correcta y el formulario mostrando el mismo telefono, SI se repostea', async () => {
  const fa = crearServidorFA({ deliveryDateInicial: '2026-10-22' });
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-22', {
    telefonoEntrega: TEL_GENERAL, correoEntrega: CORREO_GENERAL, ...fa.lectores,
  }));

  assert.equal(procesos(fa.state).length, 1);
  assert.equal(fa.state.phone, TEL_GENERAL);
  assert.equal(r.telefonoEntrega.escrita, true);
  assert.equal(r.telefonoEntrega.ok, true);
});

// Sin regresion para quien no los pasa (la correccion de la lista de #406, los
// llamadores anteriores): el formulario sale como venia.
test('#556 al crear: sin pasar telefono ni correo el ProcessOrder lleva lo que traia el formulario', async () => {
  const fa = crearServidorFA();
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-22', { ...fa.lectores }));

  assert.equal(procesos(fa.state)[0].get('phone'), TEL_GENERAL);
  assert.equal(r.telefonoEntrega.aplica, false);
  assert.equal(r.telefonoEntrega.escrita, false);
  assert.equal(r.telefonoEntrega.ok, true);
});

// 200 no garantiza nada: si FA no guardo el telefono, la relectura lo dice.
test('#556 al crear: escrito y no guardado -> no ok, verificado, con lo que se leyo', async () => {
  const fa = crearServidorFA({ phone: TEL_GENERAL, ignorarContacto: true });
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-22', {
    telefonoEntrega: '', correoEntrega: '', ...fa.lectores,
  }));

  assert.equal(r.ok, true, 'la vigencia quedo');
  assert.equal(r.telefonoEntrega.escrita, true);
  assert.equal(r.telefonoEntrega.ok, false);
  assert.equal(r.telefonoEntrega.verificado, true);
  assert.equal(r.telefonoEntrega.encontrado, TEL_GENERAL);
});

test('#556 al crear: si la relectura falla no se afirma nada y el motivo lo dice', async () => {
  const fa = crearServidorFA();
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-22', {
    telefonoEntrega: '', correoEntrega: '', ...fa.lectores,
    leerTelefonoEntrega: async () => { throw new Error('Operam 503'); },
  }));

  assert.equal(r.telefonoEntrega.escrita, true);
  assert.equal(r.telefonoEntrega.ok, false);
  assert.equal(r.telefonoEntrega.verificado, false);
  assert.match(r.telefonoEntrega.motivo, /Operam 503/);
});

// Un formulario sin los campos no es la pagina que creemos: no se escriben, la
// vigencia si, y sale con motivo (igual que un select ausente).
test('#556 al crear: un formulario sin phone/email no los escribe, la vigencia si, y sale con motivo', async () => {
  const fa = crearServidorFA({ sinCampos: true });
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-22', {
    telefonoEntrega: '+52 55 1111 2222', correoEntrega: '', ...fa.lectores,
  }));

  assert.equal(procesos(fa.state).length, 1);
  assert.equal(procesos(fa.state)[0].has('phone'), false);
  assert.equal(fa.state.deliveryDate, '2026-10-22');
  assert.equal(r.ok, true);
  assert.equal(r.telefonoEntrega.aplica, true);
  assert.equal(r.telefonoEntrega.escrita, false);
  assert.equal(r.telefonoEntrega.ok, false);
  assert.match(r.telefonoEntrega.motivo, /phone/);
  assert.match(r.correoEntrega.motivo, /email/);
});

// --- Actualizar (#104): ya los escribia desde #329; desde #556 se releen ----------

const DATA_ACTUALIZAR = {
  fecha: '2026-10-08', vigencia: '2026-11-07',
  cliente: { razonSocial: 'Cliente de prueba', nombreCorto: 'Prueba', customerId: CUSTOMER_ID, cpEntrega: '56530', celEntrega: '', emailEntrega: '' },
  items: [{ codigo: 'SKU-A', descripcion: 'Plato', cantidad: 2, precio: 100, descuento: 0 }],
};

test('#556 actualizar: el ProcessOrder sigue llevando el telefono vacio del Contacto de entrega y la relectura lo confirma', async () => {
  const fa = crearServidorFA({ phone: TEL_GENERAL, lineasIniciales: [{ stockId: 'SKU-VIEJO', qty: 1, price: 1, disc: 0 }] });
  const r = await conFA(fa, () => actualizarQuoteOperam(QUOTE_NO, DATA_ACTUALIZAR, { ...fa.lectores }));

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(procesos(fa.state).length, 1);
  assert.equal(procesos(fa.state)[0].get('phone'), '');
  assert.equal(procesos(fa.state)[0].get('email'), '');
  assert.equal(fa.state.phone, '');
  assert.equal(r.telefonoEntrega.ok, true);
  assert.equal(r.telefonoEntrega.verificado, true);
  assert.equal(r.correoEntrega.ok, true);
});

test('#556 actualizar: con telefono y correo del Contacto de entrega los escribe y los relee', async () => {
  const fa = crearServidorFA({ lineasIniciales: [{ stockId: 'SKU-VIEJO', qty: 1, price: 1, disc: 0 }] });
  const data = { ...DATA_ACTUALIZAR, cliente: { ...DATA_ACTUALIZAR.cliente, celEntrega: '+52 55 1111 2222', emailEntrega: 'recibe@cliente.test' } };
  const r = await conFA(fa, () => actualizarQuoteOperam(QUOTE_NO, data, { ...fa.lectores }));

  assert.equal(procesos(fa.state)[0].get('phone'), '+52 55 1111 2222');
  assert.equal(procesos(fa.state)[0].get('email'), 'recibe@cliente.test');
  assert.equal(r.telefonoEntrega.encontrado, '+52 55 1111 2222');
  assert.equal(r.correoEntrega.encontrado, 'recibe@cliente.test');
});

// Como el transportista (#448): un telefono que no pega NO tumba la actualizacion.
test('#556 actualizar: un telefono que no pega NO tumba la actualizacion y sale con lo que se leyo', async () => {
  const fa = crearServidorFA({ phone: TEL_GENERAL, ignorarContacto: true, lineasIniciales: [{ stockId: 'SKU-VIEJO', qty: 1, price: 1, disc: 0 }] });
  const r = await conFA(fa, () => actualizarQuoteOperam(QUOTE_NO, DATA_ACTUALIZAR, { ...fa.lectores }));

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.telefonoEntrega.ok, false);
  assert.equal(r.telefonoEntrega.verificado, true);
  assert.equal(r.telefonoEntrega.encontrado, TEL_GENERAL);
});

test('#556 actualizar: si se rechaza antes de escribir, telefono y correo salen no escritos con motivo', async () => {
  const fa = crearServidorFA();
  const r = await conFA(fa, () => actualizarQuoteOperam(QUOTE_NO, { ...DATA_ACTUALIZAR, items: [] }, { ...fa.lectores }));

  assert.equal(r.ok, false);
  assert.equal(r.telefonoEntrega.aplica, true);
  assert.equal(r.telefonoEntrega.esperado, '');
  assert.equal(r.telefonoEntrega.escrita, false);
  assert.equal(r.telefonoEntrega.ok, false);
  assert.ok(r.telefonoEntrega.motivo);
});
