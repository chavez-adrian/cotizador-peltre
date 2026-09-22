import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from '../lib/fs-reintento.js';
import { fotoDatos } from './helpers/datos-aislados.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

// El Representante de Ventas de una cotizacion es el vendedor que la CREO, y
// editarla no lo cambia (#405, decision de Adrian 2026-09-20). En produccion la
// cotizacion 1284 la creo Alejandro Chavez; Adrian (admin) la edito desde el
// Historial y el documento paso a decir "Representante de Ventas: Adrian
// Chavez": la columna `vendedor` del registro no se toca al actualizar, pero
// `data.vendedor` -- que es lo que imprime el PDF/HTML -- se pisaba en CADA
// guardado con quien guardaba.

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const COTS_PATH = join(DATA_DIR, 'cotizaciones.json');
const PROSPECTOS_PATH = join(DATA_DIR, 'prospectos.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app, cargarListasPrecios } = await import('../server.js');
const { huellaContenidoQuote, resetSession } = await import('../lib/operam-client.js');
const { _resetSesionWeb } = await import('../lib/operam-web.js');
const { resetIndice } = await import('../lib/indice-telefonos.js');

const VENDEDOR = 'Alejandro Chavez';
const ADMIN = 'Adrian Chavez';
// El admin que edita (rol admin: alcanza la cotizacion de otro vendedor) y el
// vendedor dueno del registro.
const TOKEN_ADMIN = jwt.sign({ id: 1, name: ADMIN, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

function readCots() {
  if (!existsSync(COTS_PATH)) return [];
  return JSON.parse(leerArchivoSync(COTS_PATH));
}

function writeCots(data) {
  escribirArchivoSync(COTS_PATH, JSON.stringify(data, null, 2));
}

// Guardar una cotizacion NUEVA mueve el embudo (hook de prospectos): ese archivo
// se restaura igual que el de cotizaciones, y si no existia se borra.
// #411: los data/*.json de la suite quedan como se los encontro, el ausente
// incluido: restaurar una re-serializacion CREA el archivo donde no habia uno.
let restaurarDatos;
before(() => { restaurarDatos = fotoDatos([COTS_PATH, PROSPECTOS_PATH]); });
after(() => { restaurarDatos(); });

// Lo que el navegador manda al guardar: el carrito y el cliente, nunca el
// vendedor (lo pone el servidor con quien esta autenticado).
function contenido(extra = {}) {
  return {
    fecha: '2026-09-19', vigencia: '2026-10-19', tier: 'Mayoreo',
    cliente: {
      razonSocial: 'Restaurante La Mesa', nombreCorto: 'La Mesa',
      telefono: '+52 5551234567', cpEntrega: '56530', pais: 'MX',
    },
    items: [{ codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 500, unidad: 'pza', precio: 100, descuento: 0 }],
    subtotal: 50000, iva: 8000, total: 58000, notas: [],
    ...extra,
  };
}

// La 1284 tal como quedo antes de que el admin la editara: creada por Alejandro
// y ya registrada en Operam.
function cotizacionDe(vendedor, { vendedorEnData = vendedor, folioOperam = '1284' } = {}) {
  const snap = readCots();
  const id = snap.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  const data = { ...contenido(), vendedor: vendedorEnData };
  writeCots([...snap, {
    id, fecha: '2026-09-19T00:00:00Z', vendedor, cliente: 'La Mesa',
    totalPiezas: 500, total: 58000, tier: 'Mayoreo', folioOperam,
    data: { ...data, huellaQuote: huellaContenidoQuote(data) },
  }]);
  return id;
}

function guardada(id) {
  return readCots().find(c => c.id === id);
}

test('#405-1: editar como admin la cotizacion de otro vendedor conserva al vendedor original', async () => {
  const id = cotizacionDe(VENDEDOR);
  const res = await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TOKEN_ADMIN}`)
    .send({ ...contenido(), cotizacionId: String(id) });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.id, id);
  assert.strictEqual(guardada(id).data.vendedor, VENDEDOR, 'el documento sigue siendo del vendedor original');
  assert.strictEqual(guardada(id).vendedor, VENDEDOR, 'la columna del registro tampoco cambia');
});

// Lo que el cliente ve. El HTML es el documento que se comparte por WhatsApp y
// se REGENERA desde data (ADR-0009): ahi es donde aparecio el sintoma.
test('#405-2: el documento regenerado tras la edicion del admin imprime al vendedor original', async () => {
  const id = cotizacionDe(VENDEDOR);
  await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TOKEN_ADMIN}`)
    .send({ ...contenido(), cotizacionId: String(id) });
  const res = await supertest(app).get(`/api/cotizacion/html/${id}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.text.includes('Representante de Ventas'), 'el documento trae la etiqueta');
  assert.ok(res.text.includes(VENDEDOR), 'imprime al vendedor original');
  assert.ok(!res.text.includes(ADMIN), 'no imprime a quien edito');
});

// La otra mitad de la regla: sin registro previo el vendedor SI es quien guarda.
// El `vendedor` del cuerpo no decide nada (el formulario nunca lo manda): lo
// pone el servidor con el usuario autenticado, como siempre.
test('#405-3: una cotizacion nueva es de quien la crea', async () => {
  const res = await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TOKEN_ADMIN}`)
    .send({ ...contenido({ vendedor: VENDEDOR }) });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(guardada(res.body.id).vendedor, ADMIN);
  assert.strictEqual(guardada(res.body.id).data.vendedor, ADMIN);
});

// Copiar (cargarCotizacion(id, 'nueva')) manda el carrito de la cotizacion
// cargada SIN cotizacionId: nace un registro nuevo, y ese es de quien copia --
// la cotizacion copiada no le cede su Representante de Ventas ni pierde el suyo.
test('#405-4: Copiar la cotizacion de otro vendedor crea un registro del que copia', async () => {
  const id = cotizacionDe(VENDEDOR);
  const copia = await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TOKEN_ADMIN}`)
    .send({ ...contenido() });
  assert.strictEqual(copia.status, 200);
  assert.notStrictEqual(copia.body.id, id);
  assert.strictEqual(guardada(copia.body.id).vendedor, ADMIN);
  assert.strictEqual(guardada(copia.body.id).data.vendedor, ADMIN);
  assert.strictEqual(guardada(id).data.vendedor, VENDEDOR, 'la cotizacion copiada no cambia');
});

// El `salesman` que viaja a Operam. Los nombres van con acento porque tienen que
// coincidir EXACTOS con el registro de vendedores (data/vendedores.json), que es
// de donde sale el operam_id: Alejandro Chavez -> 2, Adrian Chavez -> 1.
const VENDEDOR_REGISTRO = 'Alejandro Ch\u00e1vez';
const ADMIN_REGISTRO = 'Adri\u00e1n Ch\u00e1vez';
const TOKEN_ADMIN_REGISTRO = jwt.sign({ id: 1, name: ADMIN_REGISTRO, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

function jsonResponse(data, status = 200) {
  return { ok: status < 400, status, json: async () => data };
}

function htmlResponse(html) {
  return { ok: true, status: 200, text: async () => html, headers: { getSetCookie: () => ['FA=sesion-de-prueba; path=/'] } };
}

function mockOperam(handlers) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    for (const [pat, fn] of Object.entries(handlers)) {
      if (u.includes(pat)) return fn(u, opts);
    }
    throw new Error('Unmocked fetch: ' + u);
  };
  return () => { globalThis.fetch = original; };
}

// El `salesman` del quote lo fija Operam desde el Cliente Operam y su domicilio
// de entrega, y el unico punto donde el cotizador lo decide es el alta que
// dispara la subida (#81): sale de la COLUMNA `vendedor` del registro
// (solicitudDeLaSubida), nunca de quien pide la subida. Editada por el admin, la
// cotizacion sigue subiendo con el salesman de Alejandro.
test('#405-5: el salesman que viaja a Operam es el del vendedor original, no el del admin que edito', async () => {
  resetSession();
  _resetSesionWeb();
  resetIndice();
  const id = cotizacionDe(VENDEDOR_REGISTRO, { folioOperam: null });
  let clienteBody = null;
  let branchBody = null;
  const restore = mockOperam({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/sales_types': () => jsonResponse({ data: [{ id: '12', sales_type: 'Precio de lista', inactive: '0' }] }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { clienteBody = JSON.parse(opts.body); return jsonResponse({ result: true, customer_id: 910 }); }
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      if (u.includes('/910')) return jsonResponse({ data: [{ sales_type: '12', curr_code: 'MXN', branches: [{ branch_code: 911 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/branches/911': (u, opts) => {
      if (opts?.method === 'PUT') { branchBody = JSON.parse(opts.body); return jsonResponse({ result: true }); }
      return jsonResponse({ data: [{ br_name: 'La Mesa' }] });
    },
    '/api/v3/sales/quote': () => jsonResponse({ result: true, added_trans_no: 1305 }),
    'sales_order_entry.php': () => htmlResponse('<html>ok</html>'),
    'view_sales_order.php': () => htmlResponse('<table><tr><td>Cotizacion</td></tr></table>'),
  });
  try {
    await cargarListasPrecios();
    const edicion = await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TOKEN_ADMIN_REGISTRO}`)
      .send({ ...contenido(), cotizacionId: String(id) });
    assert.strictEqual(edicion.status, 200);
    const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
      .set('Authorization', `Bearer ${TOKEN_ADMIN_REGISTRO}`).send({});
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.ok(clienteBody, 'la subida dio de alta el Cliente Operam');
    assert.strictEqual(clienteBody.salesman, 2, 'operam_id de Alejandro Chavez en data/vendedores.json');
    assert.strictEqual(branchBody?.salesman, 2, 'el domicilio de entrega -- donde Operam guarda el vendedor -- tambien');
  } finally {
    restore();
  }
});
