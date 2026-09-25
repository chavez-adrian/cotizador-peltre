// #448: el transportista (`ship_via`) del quote sigue a la linea de transporte
// elegida en el paso Envio, al crear y al actualizar. Aqui se prueba la costura HTTP:
// la subida y la actualizacion resuelven el id con la lista de lineas de /admin, lo
// escriben por el ProcessOrder de la web legacy, lo reportan como paso propio y lo
// meten a la huella del quote. El mapeo vive en public/js/lineas-transporte-logica.js
// y la escritura/verificacion en lib/operam-web.js (sus propias pruebas).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from '../lib/fs-reintento.js';
import { fotoDatos, fijarDatos } from './helpers/datos-aislados.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const CONFIG_PATH = join(DATA_DIR, 'config.json');
const COTS_PATH = join(DATA_DIR, 'cotizaciones.json');
// #380: la subida encola en la cola persistida el post-fix que no quedo verificado.
const COLA_POSTFIX_PATH = join(dirname(COTS_PATH), 'postfix-pendientes.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}
delete process.env.DATABASE_URL;

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const configStore = await import('../lib/config-store.js');
const { app } = await import('../server.js');
const { _resetSesionWeb } = await import('../lib/operam-web.js');
const { huellaContenidoQuote } = await import('../lib/operam-client.js');
const TOKEN = `Bearer ${jwt.sign({ id: 99, name: 'Tester', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' })}`;

const originalFetch = globalThis.fetch;

const readCots = () => JSON.parse(leerArchivoSync(COTS_PATH));
const writeCots = (cots) => escribirArchivoSync(COTS_PATH, JSON.stringify(cots, null, 2));

let restaurarDatos;
before(() => { restaurarDatos = fotoDatos([CONFIG_PATH, COTS_PATH, COLA_POSTFIX_PATH]); });
after(() => {
  restaurarDatos();
  configStore._reiniciar();
  globalThis.fetch = originalFetch;
  _resetSesionWeb();
});
beforeEach(() => {
  // Sin llave `lineasTransporte`: rige la semilla (FedEx 2, Lalamove 3, ...).
  fijarDatos(CONFIG_PATH, { tiposActivos: ['PL'], texturasActivas: [1] });
  fijarDatos(COTS_PATH, []);
  configStore._reiniciar();
  globalThis.fetch = originalFetch;
  _resetSesionWeb();
});

const ENVIO_LALAMOVE = { opcion: 'lalamove', carrier: 'lalamove', servicio: 'Lalamove Hatchback (hasta 100 kg)', precio: 359.9, descripcion: 'Envio Lalamove Hatchback (hasta 100 kg)', descuento: 0 };
const ENVIO_FEDEX = { opcion: 'envia', carrier: 'fedex', servicio: 'FedEx Ground', precio: 250, descripcion: 'Envio FedEx Ground', descuento: 0 };

function dataCotizacion(envio, extra = {}) {
  return {
    fecha: '2026-09-24', vigencia: '2026-10-24',
    cliente: { rfc: 'CPE921211N76', razonSocial: 'El Pendulo', nombreCorto: 'Pendulo', cpEntrega: '56530', telefono: '+52 5551234567' },
    items: [
      { codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 10, precio: 100, descuento: 0 },
      ...(envio ? [{ codigo: 'ENVIO', descripcion: envio.descripcion, cantidad: 1, precio: envio.precio, descuento: 0 }] : []),
    ],
    subtotal: 1000, iva: 160, total: 1160, notas: [],
    ...(envio ? { envio } : {}),
    ...extra,
  };
}

// Para ACTUALIZAR: sin la partida del flete, que al reescribirse por la web legacy
// pide la ronda de descripcion (#139) que este Operam de mentiras no simula. El
// transportista sale del envio guardado, no de la partida.
function dataActualizable(envio) {
  const data = dataCotizacion(envio, { cliente: { ...dataCotizacion(null).cliente, customerId: 314 } });
  return { ...data, items: data.items.filter(i => i.codigo !== 'ENVIO') };
}

function guardarCotizacion(data, extra = {}) {
  const id = 7000 + readCots().length;
  writeCots([...readCots(), { id, fecha: '2026-09-24T00:00:00Z', vendedor: 'Tester', cliente: 'Pendulo', totalPiezas: 10, total: 1160, tier: 'Mayoreo', data, ...extra }]);
  return id;
}

// Operam de mentiras: API v3 (cliente por RFC, POST del quote y su relectura) y la
// web legacy (formulario de edicion con el select `ship_via` real, vista read-only).
// Solo ProcessOrder escribe el encabezado; la relectura del quote devuelve lo que
// quedo. `webCaida` devuelve una pagina sin formulario: el post-fix no llega a escribir.
function mockOperam({ shipVia = '1', lineas = [], webCaida = false } = {}) {
  const doc = { shipVia, vigencia: '2026-01-01', comments: 'viejo', lineas: lineas.map(s => ({ stockId: s, qty: 1, price: 1, disc: 0 })) };
  const sesion = { carrito: doc.lineas.map(l => ({ ...l })) };
  const procesos = [];
  const OPCIONES = [['1', 'Default'], ['2', 'FedEx'], ['3', 'LalaMove'], ['4', 'Tresguerras'], ['5', 'Estafeta'], ['6', 'DHL']];
  const form = () => `<form method='post' action='/sales/sales_order_entry.php'>
<input type="hidden" name="cart_id" value='CART1'>
<input type="hidden" name="customer_id" value='314'>
<select autocomplete='off' name='ship_via' class='combo'>${OPCIONES.map(([id, n]) => `<option ${id === doc.shipVia ? 'selected' : ''} value='${id}'>10${id}2409121109&nbsp;&nbsp;&nbsp;&nbsp;${n}</option>`).join('')}</select>
${sesion.carrito.map((l, i) => `<a href='../inventory/inquiry/stock_status.php?stock_id=${l.stockId}'>x</a><button type='submit' name='Delete${i}' value='1'></button>`).join('\n')}
<input type="text" name="stock_id" value=''>
<input type="text" name="qty" value="1">
<input type="text" name="price" value="0.00">
<input type="text" name="Disc" value="0.0">
<input type="text" name="delivery_date" value="${doc.vigencia}">
<input type="text" name="cust_ref" value="">
<input type="text" name="deliver_to" value="">
<textarea name='delivery_address'></textarea>
<input type="text" name="phone" value="">
<input type="text" name="email" value="">
<textarea name="Comments">${doc.comments}</textarea>
<button type='submit' name='ProcessOrder' value='Confirmar Cambios'></button>
<button type='submit' name='CancelOrder' value='Cancelar'></button>
</form>`;
  const vista = () => `<table>
<tr><td class='tableheader2'>Valido hasta</td><td id=''>${doc.vigencia}</td></tr>
<tr><td class='tableheader2'>Comentarios</td><td colspan=3 id=''>${doc.comments.split('\n').join('<br />\n')}</td></tr></table>
<table>${doc.lineas.map(l => `<tr class='evenrow'>
<td><a href='../../inventory/inquiry/stock_status.php?stock_id=${l.stockId}'>${l.stockId}</a></td><td>Desc</td>
<td align=right nowrap>${l.qty}</td><td>pza</td><td nowrap align=right>${Number(l.price).toFixed(2)}</td>
<td nowrap align=right>${Number(l.disc).toFixed(2)}</td><td nowrap align=right>0.00</td><td nowrap align=right>0</td></tr>`).join('')}</table>`;
  const texto = (html) => ({ headers: {}, text: async () => html });
  const json = (data) => ({ ok: true, status: 200, json: async () => data });
  const handlers = [
    ['/api/v3/login', () => json({ token: 'tok', result: true })],
    ['/api/v3/sales/customers', () => json({ total: 1, data: [{ customer_id: 314, tax_id: 'CPE921211N76', CustName: 'El Pendulo', sales_type: '12', curr_code: 'MXN', branches: [{ branch_code: 88 }] }] })],
    ['/api/v3/sales/quote/', () => json({ data: [{ order_no: '1296', ship_via: doc.shipVia, order_type: '12' }] })],
    ['/api/v3/sales/quote', () => json({ result: true, added_trans_no: 1296 })],
    ['trans_type=30', () => texto('<html>login ok</html>')],
    ['ModifyQuotationNumber', () => texto(webCaida ? '<html><body>Error interno</body></html>' : form())],
    ['trans_type=32', () => texto(vista())],
    ['sales_order_entry.php', (u, opts) => {
      const p = new URLSearchParams(opts.body || '');
      if (p.has('CancelOrder')) throw new Error('JAMAS debe mandarse CancelOrder');
      if (p.has('Delete0')) sesion.carrito.shift();
      else if (p.has('AddItem')) sesion.carrito.push({ stockId: p.get('stock_id'), qty: Number(p.get('qty')), price: Number(p.get('price')), disc: Number(p.get('Disc')) });
      else if (p.has('ProcessOrder')) {
        procesos.push(p);
        doc.lineas = sesion.carrito.map(l => ({ ...l }));
        doc.vigencia = p.get('delivery_date');
        doc.comments = p.get('Comments');
        if (p.has('ship_via')) doc.shipVia = p.get('ship_via');
      }
      return texto(form());
    }],
  ];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    for (const [pat, fn] of handlers) if (u.includes(pat)) return fn(u, opts);
    throw new Error('Unmocked fetch: ' + u);
  };
  return { doc, procesos };
}

const pasoTransportista = (res) => (res.body.steps || []).find(s => s.name === 'transportista del quote');

// --- Crear -------------------------------------------------------------------

test('#448 subir: un quote nuevo con Lalamove queda con ship_via 3 y el paso lo confirma', async () => {
  const id = guardarCotizacion(dataCotizacion(ENVIO_LALAMOVE));
  const { doc, procesos } = mockOperam({ shipVia: '1' });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  assert.equal(procesos.length, 1);
  assert.equal(procesos[0].get('ship_via'), '3');
  assert.equal(doc.shipVia, '3');
  const paso = pasoTransportista(res);
  assert.equal(paso.status, 'ok', JSON.stringify(paso));
  assert.match(paso.mensaje, /Lalamove/);
});

test('#448 subir: con FedEx queda con ship_via 2', async () => {
  const id = guardarCotizacion(dataCotizacion(ENVIO_FEDEX));
  const { doc } = mockOperam({ shipVia: '1' });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN);

  assert.equal(res.body.ok, true);
  assert.equal(doc.shipVia, '2');
  assert.equal(pasoTransportista(res).status, 'ok');
});

// La huella guarda el transportista con el que quedo el quote (y null sin envio).
test('#448 subir: la huella guardada lleva el transportista', async () => {
  const data = dataCotizacion(ENVIO_LALAMOVE);
  const id = guardarCotizacion(data);
  mockOperam({ shipVia: '1' });
  await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN);

  const guardada = readCots().find(c => c.id === id);
  assert.equal(JSON.parse(guardada.data.huellaQuote).shipVia, '3');
});

// AC: sin envio / envio manual / linea sin id -> el quote no cambia de transportista.
test('#448 subir: sin envio el quote conserva el transportista del domicilio', async () => {
  const id = guardarCotizacion(dataCotizacion(null));
  const { doc, procesos } = mockOperam({ shipVia: '1' });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN);

  assert.equal(res.body.ok, true);
  assert.equal(procesos[0].get('ship_via'), '1');
  assert.equal(doc.shipVia, '1');
  assert.equal(pasoTransportista(res).status, 'omitido');
  assert.equal(JSON.parse(readCots().find(c => c.id === id).data.huellaQuote).shipVia, null);
});

test('#448 subir: con envio manual el quote conserva el transportista del domicilio', async () => {
  const manual = { opcion: 'manual', carrier: null, servicio: null, precio: 500, descripcion: 'Flete propio', descuento: 0 };
  const id = guardarCotizacion(dataCotizacion(manual));
  const { doc } = mockOperam({ shipVia: '1' });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN);

  assert.equal(res.body.ok, true);
  assert.equal(doc.shipVia, '1');
  const paso = pasoTransportista(res);
  assert.equal(paso.status, 'omitido');
  assert.match(paso.detalle, /envio manual/);
});

test('#448 subir: con una linea sin transportista capturado no se manda nada y el paso lo dice', async () => {
  fijarDatos(CONFIG_PATH, {
    tiposActivos: ['PL'], texturasActivas: [1],
    lineasTransporte: [{ nombre: 'Lalamove', fuente: 'lalamove', codigo: null, shipVia: null, activa: true }],
  });
  configStore._reiniciar();
  const id = guardarCotizacion(dataCotizacion(ENVIO_LALAMOVE));
  const { doc } = mockOperam({ shipVia: '1' });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN);

  assert.equal(res.body.ok, true);
  assert.equal(doc.shipVia, '1');
  const paso = pasoTransportista(res);
  assert.equal(paso.status, 'omitido');
  assert.match(paso.detalle, /no tiene transportista de Operam/);
});

// AC: fallo al escribir o al confirmar -> aviso con motivo, la subida sigue.
test('#448 subir: si la web legacy falla, el transportista sale como aviso con motivo y la subida sigue', async () => {
  const id = guardarCotizacion(dataCotizacion(ENVIO_LALAMOVE));
  mockOperam({ shipVia: '1', webCaida: true });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN);

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.folio, 1296);
  const paso = pasoTransportista(res);
  assert.equal(paso.status, 'warn');
  assert.match(paso.mensaje, /transportista/);
  assert.match(paso.detalle, /no trae formulario/);
});

// --- Actualizar --------------------------------------------------------------

test('#448 actualizar: de FedEx a Lalamove mueve el transportista y guarda la huella con el', async () => {
  const id = guardarCotizacion(dataActualizable(ENVIO_LALAMOVE), { folioOperam: '1296' });
  const { doc, procesos } = mockOperam({ shipVia: '2', lineas: ['CR20-PLATO', '251021002'] });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}/actualizar`).set('Authorization', TOKEN);

  assert.equal(res.body.ok, true, JSON.stringify(res.body));
  assert.equal(procesos.length, 1);
  assert.equal(procesos[0].get('ship_via'), '3');
  assert.equal(doc.shipVia, '3');
  assert.equal(pasoTransportista(res).status, 'ok');
  assert.equal(JSON.parse(readCots().find(c => c.id === id).data.huellaQuote).shipVia, '3');
});

test('#448 actualizar: de Lalamove a FedEx tambien', async () => {
  const id = guardarCotizacion(dataActualizable(ENVIO_FEDEX), { folioOperam: '1296' });
  const { doc } = mockOperam({ shipVia: '3', lineas: ['CR20-PLATO'] });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}/actualizar`).set('Authorization', TOKEN);

  assert.equal(res.body.ok, true, JSON.stringify(res.body));
  assert.equal(doc.shipVia, '2');
  assert.equal(pasoTransportista(res).status, 'ok');
});

test('#380 actualizar: una actualizacion lograda saca el folio de la cola de reintentos del post-fix', async () => {
  // El vendedor edito el mismo dia: el reintento encolado traeria la lista y el
  // transportista VIEJOS y revertiria la edicion.
  fijarDatos(COLA_POSTFIX_PATH, [{ folio: '1296', cotizacionId: 1, origen: 'post-fix', vigencia: '2026-10-24', lista: null, transportista: '2', estado: 'pendiente', intentos: 0, proximoIntento: '2026-09-24T00:01:00.000Z' }]);
  const id = guardarCotizacion(dataActualizable(ENVIO_LALAMOVE), { folioOperam: '1296' });
  mockOperam({ shipVia: '2', lineas: ['CR20-PLATO', '251021002'] });
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}/actualizar`).set('Authorization', TOKEN);

  assert.equal(res.body.ok, true, JSON.stringify(res.body));
  assert.deepEqual(JSON.parse(leerArchivoSync(COLA_POSTFIX_PATH)), []);
});

// --- Huella al regenerar -------------------------------------------------------

// El transportista cuenta como cambio aunque nada mas se mueva: si el admin corrige
// el id de la linea, la siguiente regeneracion reescribe el quote.
test('#448 regenerar: el mismo contenido con otro transportista pide actualizar el quote', async () => {
  const data = dataCotizacion(ENVIO_FEDEX);
  const id = guardarCotizacion({ ...data, huellaQuote: huellaContenidoQuote(data, { listaId: null, shipVia: 7 }) }, { folioOperam: '1296' });
  const res = await supertest(app).post('/api/cotizacion').set('Authorization', TOKEN).send({ ...data, cotizacionId: String(id) });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.requiereActualizacionOperam, true);
});

test('#448 regenerar: con el mismo transportista no pide nada', async () => {
  const data = dataCotizacion(ENVIO_FEDEX);
  const id = guardarCotizacion({ ...data, huellaQuote: huellaContenidoQuote(data, { listaId: null, shipVia: 2 }) }, { folioOperam: '1296' });
  const res = await supertest(app).post('/api/cotizacion').set('Authorization', TOKEN).send({ ...data, cotizacionId: String(id) });

  assert.equal(res.body.requiereActualizacionOperam, false);
});

// AC: una huella previa sin el campo no provoca reescritura.
test('#448 regenerar: una huella guardada antes de #448 (sin transportista) no pide reescribir', async () => {
  const data = dataCotizacion(ENVIO_LALAMOVE);
  const id = guardarCotizacion({ ...data, huellaQuote: huellaContenidoQuote(data, { listaId: null }) }, { folioOperam: '1296' });
  const res = await supertest(app).post('/api/cotizacion').set('Authorization', TOKEN).send({ ...data, cotizacionId: String(id) });

  assert.equal(res.body.requiereActualizacionOperam, false);
});
