// El TRANSPORTISTA (`ship_via`) del encabezado del quote (#448).
//
// El POST del quote no mandaba transportista: el quote heredaba el `default_ship_via`
// del domicilio (todos los branches del cotizador nacen con 1 = "Default") y el pedido
// derivado heredaba ese encabezado. Visto en el HITL de #72: quote 1296 con partida
// Lalamove y `ship_via` 1.
//
// Viaja por el MISMO ProcessOrder de la web legacy que ya lleva la vigencia (#106), la
// lista (#403) y el domicilio (#409): el camino que se sabe que escribe los campos del
// encabezado que la API v3 ignora. Como sus gemelos, solo se escribe un valor que el
// formulario OFRECE (escribir uno ajeno hace que FA rechace el ProcessOrder entero) y
// se verifica RELEYENDO el quote por la API v3 (`ship_via` del GET /sales/quote/:folio).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parsearFormularioQuote, serializarBodyQuote,
  opcionesTransportistaQuote, decidirTransportistaQuote,
  corregirVigenciaQuote, actualizarQuoteOperam, _resetSesionWeb,
} from '../lib/operam-web.js';

process.env.OPERAM_URL = 'https://fa.mentira.test';
process.env.OPERAM_USER = 'usuario_de_prueba';
process.env.OPERAM_PASSWORD = 'clave_de_prueba';

const DIR_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const FORM_1216 = readFileSync(join(DIR_FIXTURES, 'quote-1216-form-edicion.html'), 'utf8');

// --- Piezas puras contra el formulario REAL -----------------------------------

// El formulario real de edicion del quote 1216 ofrece "Compania de Transporte" como
// <select name='ship_via'> con los ids de Operam: 1 Default, 2 FedEx, 3 LalaMove.
test('#448 opcionesTransportistaQuote: los transportistas salen del formulario real', () => {
  const ops = opcionesTransportistaQuote(FORM_1216);
  assert.deepEqual(ops.map(o => o.id), ['1', '2', '3']);
  assert.match(ops[1].nombre, /FedEx/);
  assert.match(ops[2].nombre, /LalaMove/);
});

test('#448 opcionesTransportistaQuote: sin el select no hay opciones (y entonces no se escribe nada)', () => {
  assert.deepEqual(opcionesTransportistaQuote('<html><body>otra pagina</body></html>'), []);
  assert.deepEqual(opcionesTransportistaQuote(null), []);
});

const TRANSPORTISTAS = [{ id: '1', nombre: 'Default' }, { id: '2', nombre: 'FedEx' }, { id: '3', nombre: 'LalaMove' }];

test('#448 decidirTransportistaQuote: el de la linea elegida distinto del del quote SI se escribe', () => {
  const d = decidirTransportistaQuote({ esperado: 3, actual: '1', opciones: TRANSPORTISTAS });
  assert.equal(d.escribir, true);
  assert.equal(d.shipVia, '3');
});

test('#448 decidirTransportistaQuote: el quote que ya tiene ese transportista no se repostea', () => {
  const d = decidirTransportistaQuote({ esperado: 2, actual: '2', opciones: TRANSPORTISTAS });
  assert.equal(d.escribir, false);
  assert.equal(d.yaCorrecto, true);
});

// Los motivos de abstencion. El que importa de verdad es el tercero: un id que el
// formulario no ofrece (capturado mal en /admin, o transportista dado de baja en
// Operam) haria que FA rechazara el ProcessOrder ENTERO, con la vigencia adentro.
test('#448 decidirTransportistaQuote: sin transportista, sin campo o ajeno al formulario no se escribe y se da el motivo', () => {
  const sin = decidirTransportistaQuote({ esperado: null, actual: '1', opciones: TRANSPORTISTAS });
  assert.equal(sin.escribir, false);
  assert.match(sin.motivo, /transportista/);

  const sinCampo = decidirTransportistaQuote({ esperado: 3, actual: undefined, opciones: TRANSPORTISTAS });
  assert.equal(sinCampo.escribir, false);
  assert.match(sinCampo.motivo, /ship_via/);

  const ajeno = decidirTransportistaQuote({ esperado: 6, actual: '1', opciones: TRANSPORTISTAS });
  assert.equal(ajeno.escribir, false);
  assert.match(ajeno.motivo, /6/);
  assert.match(ajeno.motivo, /1, 2, 3/);
});

test('#448 serializarBodyQuote: shipVia sustituye ship_via y no toca nada mas', () => {
  const { campos } = parsearFormularioQuote(FORM_1216);
  assert.equal(campos.ship_via, '1');
  const body = serializarBodyQuote(campos, { deliveryDate: '2026-08-26', shipVia: '3' });
  assert.equal(body.get('ship_via'), '3');
  assert.equal(body.get('branch_id'), campos.branch_id);
  assert.equal(body.get('sales_type'), campos.sales_type);
  assert.equal(body.get('Comments'), campos.Comments);
  assert.equal(body.has('CancelOrder'), false);
});

test('#448 serializarBodyQuote: sin shipVia el transportista del formulario no se toca', () => {
  const { campos } = parsearFormularioQuote(FORM_1216);
  const body = serializarBodyQuote(campos, { deliveryDate: '2026-08-26' });
  assert.equal(body.get('ship_via'), campos.ship_via);
});

// --- Orquestacion: crear (post-fix de #106) y actualizar (#104) ----------------

const QUOTE_NO = '1296';
const CUSTOMER_ID = '15';
const OPCIONES_SHIP_VIA = [['1', 'Default'], ['2', 'FedEx'], ['3', 'LalaMove'], ['4', 'Tresguerras'], ['5', 'Estafeta'], ['6', 'DHL']];

// Servidor FA de mentiras: solo ProcessOrder escribe el encabezado (ADR-0008).
// `ignorarShipVia` simula un FA que responde igual pero no guarda el transportista:
// es lo que la relectura existe para atrapar.
function crearServidorFA({ shipViaInicial = '1', deliveryDateInicial = '2026-08-12', lineasIniciales = [], sinSelect = false, ignorarShipVia = false } = {}) {
  const state = {
    shipVia: shipViaInicial, deliveryDate: deliveryDateInicial,
    lineas: lineasIniciales.map(l => ({ ...l })), comments: 'comentario viejo', custRef: 'REF',
    posts: [],
  };
  const selectShipVia = () => (sinSelect ? '' : `<select autocomplete='off' name='ship_via' class='combo'>${OPCIONES_SHIP_VIA
    .map(([id, n]) => `<option groupid='${id}' ${id === state.shipVia ? 'selected' : ''} value='${id}'>10${id}2409121109&nbsp;&nbsp;&nbsp;&nbsp;${n}</option>`).join('\n')}</select>`);
  const formulario = () => `<!DOCTYPE HTML><html><body>
<form method='post' action='/sales/sales_order_entry.php'>
<input type="hidden" name="cart_id" value='CART_${QUOTE_NO}'>
<select name='customer_id'><option value='${CUSTOMER_ID}' selected>Cliente de prueba</option></select>
${selectShipVia()}
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
        if (params.has('ship_via') && !ignorarShipVia) state.shipVia = params.get('ship_via');
        return new Response(formulario(), { status: 200 });
      }
      throw new Error('mock FA: POST sin submit reconocido: ' + String(init.body));
    }
    throw new Error('mock FA: URL no manejada: ' + metodo + ' ' + u);
  }

  // La relectura del transportista va por la API v3 (`ship_via` del GET del quote);
  // aqui se inyecta leyendo lo que quedo escrito en el servidor de mentiras.
  const leerTransportista = async () => state.shipVia;
  return { fetchMock, state, leerTransportista };
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

test('#448 al crear: el ProcessOrder lleva el transportista de la linea y la relectura lo confirma', async () => {
  const fa = crearServidorFA({ shipViaInicial: '1' });
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-20', { transportista: 3, leerTransportista: fa.leerTransportista }));

  assert.equal(procesos(fa.state).length, 1);
  assert.equal(procesos(fa.state)[0].get('ship_via'), '3');
  assert.equal(fa.state.shipVia, '3');
  assert.equal(r.ok, true, 'la vigencia no se ve afectada');
  assert.deepEqual(r.transportista, {
    aplica: true, esperado: '3', escrita: true, yaCorrecto: false,
    ok: true, verificado: true, encontrado: '3', motivo: null,
  });
});

// El corto circuito de #106 (vigencia ya correcta) no puede frenar el transportista.
test('#448 al crear: con la vigencia ya correcta pero otro transportista, SI se escribe', async () => {
  const fa = crearServidorFA({ shipViaInicial: '1', deliveryDateInicial: '2026-10-20' });
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-20', { transportista: 2, leerTransportista: fa.leerTransportista }));

  assert.equal(procesos(fa.state).length, 1);
  assert.equal(fa.state.shipVia, '2');
  assert.equal(r.transportista.ok, true);
});

test('#448 al crear: con vigencia y transportista ya correctos no se repostea nada', async () => {
  const fa = crearServidorFA({ shipViaInicial: '3', deliveryDateInicial: '2026-10-20' });
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-20', { transportista: 3, leerTransportista: fa.leerTransportista }));

  assert.equal(fa.state.posts.length, 0);
  assert.equal(r.transportista.escrita, false);
  assert.equal(r.transportista.yaCorrecto, true);
  assert.equal(r.transportista.ok, true);
});

// AC: sin envio / manual / linea sin id -> no se manda nada y el quote conserva el
// del domicilio. El ProcessOrder de la vigencia sale con el ship_via que ya traia.
test('#448 al crear: sin transportista no se cambia el del quote', async () => {
  const fa = crearServidorFA({ shipViaInicial: '1' });
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-20', { transportista: null, leerTransportista: fa.leerTransportista }));

  assert.equal(procesos(fa.state).length, 1, 'la vigencia si se corrige');
  assert.equal(procesos(fa.state)[0].get('ship_via'), '1');
  assert.equal(fa.state.shipVia, '1');
  assert.equal(r.transportista.aplica, false);
  assert.equal(r.transportista.escrita, false);
  assert.equal(r.transportista.ok, true);
});

test('#448 al crear: un id que el formulario no ofrece no se escribe, la vigencia si, y sale con motivo', async () => {
  const fa = crearServidorFA({ shipViaInicial: '1' });
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-20', { transportista: 99, leerTransportista: fa.leerTransportista }));

  assert.equal(procesos(fa.state).length, 1);
  assert.equal(procesos(fa.state)[0].get('ship_via'), '1');
  assert.equal(fa.state.deliveryDate, '2026-10-20');
  assert.equal(r.ok, true);
  assert.equal(r.transportista.aplica, true);
  assert.equal(r.transportista.escrita, false);
  assert.equal(r.transportista.ok, false);
  assert.match(r.transportista.motivo, /99/);
});

test('#448 al crear: sin el select de transportista no se escribe y sale con motivo', async () => {
  const fa = crearServidorFA({ sinSelect: true });
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-20', { transportista: 3, leerTransportista: fa.leerTransportista }));

  assert.equal(r.ok, true);
  assert.equal(r.transportista.escrita, false);
  assert.equal(r.transportista.ok, false);
  assert.match(r.transportista.motivo, /ship_via/);
});

// 200 no garantiza nada: si FA no guardo el transportista, la relectura lo dice.
test('#448 al crear: escrito y no guardado -> no ok, verificado, con lo que se leyo', async () => {
  const fa = crearServidorFA({ shipViaInicial: '1', ignorarShipVia: true });
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-20', { transportista: 3, leerTransportista: fa.leerTransportista }));

  assert.equal(procesos(fa.state)[0].get('ship_via'), '3');
  assert.equal(r.ok, true, 'la vigencia quedo');
  assert.equal(r.transportista.escrita, true);
  assert.equal(r.transportista.ok, false);
  assert.equal(r.transportista.verificado, true);
  assert.equal(r.transportista.encontrado, '1');
});

test('#448 al crear: si la relectura falla no se afirma nada y el motivo lo dice', async () => {
  const fa = crearServidorFA({ shipViaInicial: '1' });
  const r = await conFA(fa, () => corregirVigenciaQuote(QUOTE_NO, '2026-10-20', {
    transportista: 3, leerTransportista: async () => { throw new Error('Operam 503'); },
  }));

  assert.equal(r.transportista.escrita, true);
  assert.equal(r.transportista.ok, false);
  assert.equal(r.transportista.verificado, false);
  assert.match(r.transportista.motivo, /Operam 503/);
});

const DATA_ACTUALIZAR = {
  fecha: '2026-09-24', vigencia: '2026-10-24',
  cliente: { razonSocial: 'Cliente de prueba', nombreCorto: 'Prueba', customerId: CUSTOMER_ID, cpEntrega: '56530' },
  items: [{ codigo: 'SKU-A', descripcion: 'Plato', cantidad: 2, precio: 100, descuento: 0 }],
};

// AC: actualizar un quote de FedEx a Lalamove (y al reves) mueve el transportista.
test('#448 actualizar: de FedEx (2) a Lalamove (3) el ProcessOrder mueve el transportista', async () => {
  const fa = crearServidorFA({ shipViaInicial: '2', lineasIniciales: [{ stockId: 'SKU-VIEJO', qty: 1, price: 1, disc: 0 }] });
  const r = await conFA(fa, () => actualizarQuoteOperam(QUOTE_NO, DATA_ACTUALIZAR, { transportista: 3, leerTransportista: fa.leerTransportista }));

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(procesos(fa.state).length, 1);
  assert.equal(procesos(fa.state)[0].get('ship_via'), '3');
  assert.equal(fa.state.shipVia, '3');
  assert.equal(r.transportista.ok, true);
  assert.equal(r.transportista.escrita, true);
});

test('#448 actualizar: de Lalamove (3) a FedEx (2) tambien', async () => {
  const fa = crearServidorFA({ shipViaInicial: '3', lineasIniciales: [{ stockId: 'SKU-VIEJO', qty: 1, price: 1, disc: 0 }] });
  const r = await conFA(fa, () => actualizarQuoteOperam(QUOTE_NO, DATA_ACTUALIZAR, { transportista: 2, leerTransportista: fa.leerTransportista }));

  assert.equal(fa.state.shipVia, '2');
  assert.equal(r.transportista.ok, true);
});

// Nunca tumba la actualizacion: las partidas y la vigencia quedaron y el transportista
// sale como paso propio con lo que se leyo.
test('#448 actualizar: un transportista que no pega NO tumba la actualizacion', async () => {
  const fa = crearServidorFA({ shipViaInicial: '1', ignorarShipVia: true, lineasIniciales: [{ stockId: 'SKU-VIEJO', qty: 1, price: 1, disc: 0 }] });
  const r = await conFA(fa, () => actualizarQuoteOperam(QUOTE_NO, DATA_ACTUALIZAR, { transportista: 3, leerTransportista: fa.leerTransportista }));

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.transportista.ok, false);
  assert.equal(r.transportista.verificado, true);
  assert.equal(r.transportista.encontrado, '1');
});

test('#448 actualizar: sin transportista el ProcessOrder conserva el del quote', async () => {
  const fa = crearServidorFA({ shipViaInicial: '2', lineasIniciales: [{ stockId: 'SKU-VIEJO', qty: 1, price: 1, disc: 0 }] });
  const r = await conFA(fa, () => actualizarQuoteOperam(QUOTE_NO, DATA_ACTUALIZAR, { transportista: null, leerTransportista: fa.leerTransportista }));

  assert.equal(r.ok, true);
  assert.equal(procesos(fa.state)[0].get('ship_via'), '2');
  assert.equal(fa.state.shipVia, '2');
  assert.equal(r.transportista.aplica, false);
});

test('#448 actualizar: si falla antes del ProcessOrder el transportista sale no escrito con motivo', async () => {
  const fa = crearServidorFA({ shipViaInicial: '1' });
  const r = await conFA(fa, () => actualizarQuoteOperam(QUOTE_NO, { ...DATA_ACTUALIZAR, items: [] }, { transportista: 3, leerTransportista: fa.leerTransportista }));

  assert.equal(r.ok, false);
  assert.equal(r.transportista.escrita, false);
  assert.equal(r.transportista.ok, false);
  assert.ok(r.transportista.motivo);
});
