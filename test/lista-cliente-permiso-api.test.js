// #300 (spec #294, ADR-0015): la matriz de listas habilitadas gobierna tambien la
// SEGUNDA superficie -- la lista de precios que se le ASIGNA a un cliente en el alta
// y en la edicion. El servidor lo exige al guardar, no solo la pantalla: el permiso
// se relee del registro de vendedores en cada peticion (nunca del JWT) y la lista que
// el Cliente Operam YA tiene se puede conservar siempre.
//
// Prior art del montaje: test/tier-api.test.js (matriz + registro real restaurado) y
// test/cliente-sin-lista-api.test.js (mockFetchByUrl sobre los endpoints del cliente).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const VENDEDORES_PATH = join(DATA_DIR, 'vendedores.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');
const { resetSession } = await import('../lib/operam-client.js');
const { resetIndice } = await import('../lib/indice-telefonos.js');

// El vendedor 2 del registro (Alejandro Chavez, operam_id 2) es al que se le mueven
// las celdas; el admin no aparece en la matriz y siempre puede todas.
const ID_VENDEDOR = 2;
const tokenVendedor = jwt.sign({ id: ID_VENDEDOR, name: 'Alejandro Chávez', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });
const tokenAdmin = jwt.sign({ id: 1, name: 'Admin Test', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

// Ids REALES de las sales_types de Operam (los mismos de test/tier-api.test.js):
// M550 = 1, Segundas = 9. Segundas es la lista de producto con defecto: la pregunta
// del ticket ("puede cotizar Segundas pero no inscribir clientes en Segundas") en
// numeros.
const LISTA_M550 = '1';
const LISTA_SEGUNDAS = '9';
const SALES_TYPES_OPERAM = [
  { id: LISTA_M550, sales_type: 'M550', inactive: '0' },
  { id: LISTA_SEGUNDAS, sales_type: 'Segundas', inactive: '0' },
];

let registroOriginal;
before(() => { registroOriginal = leerArchivoSync(VENDEDORES_PATH); });
after(() => { escribirArchivoSync(VENDEDORES_PATH, registroOriginal); globalThis.fetch = originalFetch; });

// Celdas del renglon del vendedor. `undefined` deja el registro sin el campo nuevo
// (el caso de la migracion de lectura de #296); el flag viejo se quita siempre para
// que ninguna prueba dependa de el.
function conListas(listasHabilitadas) {
  const registro = JSON.parse(registroOriginal);
  const v = registro.find(x => x.id === ID_VENDEDOR);
  delete v.puedeFijarLista;
  if (listasHabilitadas !== undefined) v.listasHabilitadas = listasHabilitadas;
  escribirArchivoSync(VENDEDORES_PATH, JSON.stringify(registro, null, 2));
}

const originalFetch = globalThis.fetch;
function mockFetchByUrl(handlers) {
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    for (const [pat, fn] of Object.entries(handlers)) {
      if (u.includes(pat)) return fn(u, opts);
    }
    throw new Error('Unmocked fetch: ' + u);
  };
  return () => { globalThis.fetch = originalFetch; };
}
function jsonResponse(data, status = 200) {
  return { ok: status < 400, status, json: async () => data };
}

beforeEach(() => {
  resetSession();
  resetIndice();
});

// Alta completa que llega hasta el final, con el rastro de lo que se escribio en
// Operam: si el permiso detiene el alta, `escrituras` queda vacio.
function mocksAlta(customerId, branchId, escrituras) {
  return {
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/sales_types': () => jsonResponse({ data: SALES_TYPES_OPERAM }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') {
        escrituras.push({ tipo: 'POST customer', body: JSON.parse(opts.body) });
        return jsonResponse({ result: true, customer_id: customerId });
      }
      if (opts?.method === 'PUT') {
        escrituras.push({ tipo: 'PUT customer', body: JSON.parse(opts.body) });
        return jsonResponse({ result: true, ...JSON.parse(opts.body) });
      }
      if (u.includes(`/${customerId}`)) {
        return jsonResponse({ data: [{ customer_id: String(customerId), sales_type: LISTA_M550, branches: [{ branch_code: branchId }] }] });
      }
      return jsonResponse({ total: 0, data: [] });
    },
    [`/api/v3/sales/branches/${branchId}`]: (u, opts) => {
      if (opts?.method === 'PUT') escrituras.push({ tipo: 'PUT branch' });
      return jsonResponse({ result: true, data: [{ br_name: 'ALTA', branch_ref: 'ALTA' }] });
    },
  };
}

function altaCon(token, salesType, rfc) {
  const body = {
    tax_id: rfc, CustName: 'Alta Con Lista SA', cust_ref: rfc,
    entrega: {
      br_name: 'ALTA', br_ref: 'ALTA', addr_street: 'Calle', addr_exterior: '1', addr_interior: '',
      addr_colony: 'Col', addr_city: 'CDMX', addr_state: 'CDMX', addr_zip: '06600',
      addr_reference: '', phone: '', email: '', pais: 'MX',
    },
    salesman: 2,
  };
  if (salesType !== undefined) body.sales_type = salesType;
  return supertest(app).post('/api/crear-cliente').set('Authorization', `Bearer ${token}`).send(body);
}

// === AC2: el alta con una lista no habilitada se rechaza y NO escribe en Operam ===

test('L1: el vendedor sin la celda de Segundas no puede dar de alta un cliente en Segundas', async () => {
  conListas([LISTA_M550]);
  const escrituras = [];
  const restore = mockFetchByUrl(mocksAlta(901, 9010, escrituras));
  try {
    const res = await altaCon(tokenVendedor, LISTA_SEGUNDAS, 'LCP010101AA1');
    assert.strictEqual(res.status, 403);
    assert.match(res.body.error, /Segundas/, 'el mensaje nombra la lista, no su id: ' + res.body.error);
    assert.match(res.body.error, /administrador/i);
    assert.deepStrictEqual(escrituras, [], 'un alta rechazada no escribe nada en Operam');
  } finally {
    restore();
  }
});

test('L2: el vendedor con la celda de Segundas da de alta al cliente en Segundas', async () => {
  conListas([LISTA_M550, LISTA_SEGUNDAS]);
  const escrituras = [];
  const restore = mockFetchByUrl(mocksAlta(902, 9020, escrituras));
  try {
    const res = await altaCon(tokenVendedor, LISTA_SEGUNDAS, 'LCP010101AA2');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    const post = escrituras.find(e => e.tipo === 'POST customer');
    assert.strictEqual(post.body.sales_type, LISTA_SEGUNDAS, 'el cliente nace con la lista que el vendedor eligio');
  } finally {
    restore();
  }
});

test('L3: el alta sin lista de precios no la toca y sigue pasando sin ninguna celda marcada', async () => {
  conListas([]);
  const escrituras = [];
  const restore = mockFetchByUrl(mocksAlta(903, 9030, escrituras));
  try {
    const res = await altaCon(tokenVendedor, undefined, 'LCP010101AA3');
    assert.strictEqual(res.status, 200);
    const post = escrituras.find(e => e.tipo === 'POST customer');
    assert.strictEqual('sales_type' in post.body, false, 'sin lista capturada no viaja la llave');
  } finally {
    restore();
  }
});

test('L4: el rol admin da de alta en cualquier lista sin celdas en la matriz', async () => {
  conListas([]);
  const escrituras = [];
  const restore = mockFetchByUrl(mocksAlta(904, 9040, escrituras));
  try {
    const res = await altaCon(tokenAdmin, LISTA_SEGUNDAS, 'LCP010101AA4');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(escrituras.find(e => e.tipo === 'POST customer').body.sales_type, LISTA_SEGUNDAS);
  } finally {
    restore();
  }
});

// El permiso se relee del registro en CADA peticion, nunca del JWT: quitar la celda
// surte efecto con el mismo token (mismo motivo que #296 en la cotizacion).
test('L5: quitarle la celda al vendedor surte efecto en el siguiente alta, con el mismo token', async () => {
  conListas([LISTA_SEGUNDAS]);
  const escrituras = [];
  let restore = mockFetchByUrl(mocksAlta(905, 9050, escrituras));
  try {
    const antes = await altaCon(tokenVendedor, LISTA_SEGUNDAS, 'LCP010101AA5');
    assert.strictEqual(antes.status, 200);
  } finally {
    restore();
  }
  conListas([]);
  restore = mockFetchByUrl(mocksAlta(906, 9060, escrituras));
  try {
    const despues = await altaCon(tokenVendedor, LISTA_SEGUNDAS, 'LCP010101AA6');
    assert.strictEqual(despues.status, 403);
  } finally {
    restore();
  }
});

// === AC3: en la EDICION, conservar la lista actual siempre es valido ===
//
// El upgrade fiscal es la superficie donde el vendedor ve la configuracion comercial
// que el cliente tiene HOY (precarga de #197) y puede cambiarla. La comparacion la
// hace el SERVIDOR contra lo que dice Operam, no contra lo que mande el navegador.
const CLIENTE_UPGRADE = '517';
const CSF_UPGRADE = {
  rfc: 'UPG010101AB1', razonSocial: 'Upgrade Fiscal SA', nombreCorto: 'Upgrade',
  calle: 'Reforma', numExt: '100', colonia: 'Juarez', cp: '06600',
  municipio: 'CDMX', estado: 'CDMX', regimenFiscal: '601',
};

// El Cliente Operam que se edita, con la lista que ya tiene asignada.
function mocksCliente(salesTypeActual, escrituras) {
  const cliente = {
    customer_id: CLIENTE_UPGRADE, CustName: 'PUBLICO EN GENERAL', cust_ref: 'Publico',
    tax_id: 'XAXX010101000', sales_type: salesTypeActual, notes: '', contacts: [], branches: [{ branch_code: '563' }],
  };
  return {
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/sales_types': () => jsonResponse({ data: SALES_TYPES_OPERAM }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') {
        escrituras.push({ tipo: 'PUT customer', body: JSON.parse(opts.body) });
        return jsonResponse({ result: true, ...JSON.parse(opts.body) });
      }
      if (u.includes('tax_id=')) return jsonResponse({ total: 0, data: [] });
      if (/\/customers\/\d+/.test(u)) return jsonResponse({ data: [cliente] });
      return jsonResponse({ total: 1, data: [cliente] });
    },
  };
}

function upgradeCon(token, salesType) {
  const csfDatos = salesType === undefined ? CSF_UPGRADE : { ...CSF_UPGRADE, salesType };
  return supertest(app).put(`/api/actualizar-cliente-fiscal/${CLIENTE_UPGRADE}`)
    .set('Authorization', `Bearer ${token}`).send({ csfDatos });
}

test('L6: la edicion no puede mover al cliente a una lista no habilitada, y no escribe nada', async () => {
  conListas([LISTA_M550]);
  const escrituras = [];
  const restore = mockFetchByUrl(mocksCliente(LISTA_M550, escrituras));
  try {
    const res = await upgradeCon(tokenVendedor, LISTA_SEGUNDAS);
    assert.strictEqual(res.status, 403);
    assert.match(res.body.error, /Segundas/);
    assert.deepStrictEqual(escrituras, [], 'una edicion rechazada no escribe en Operam');
  } finally {
    restore();
  }
});

test('L7: conservar la lista que el cliente YA tiene es valido aunque quien edita no la tenga habilitada', async () => {
  conListas([LISTA_M550]);
  const escrituras = [];
  const restore = mockFetchByUrl(mocksCliente(LISTA_SEGUNDAS, escrituras));
  try {
    const res = await upgradeCon(tokenVendedor, LISTA_SEGUNDAS);
    assert.strictEqual(res.status, 200);
    assert.ok(escrituras.some(e => e.tipo === 'PUT customer'), 'el upgrade si escribio los datos fiscales');
  } finally {
    restore();
  }
});

test('L8: cambiar la lista hacia una habilitada si se puede, aunque la actual sea ajena', async () => {
  conListas([LISTA_M550]);
  const escrituras = [];
  const restore = mockFetchByUrl(mocksCliente(LISTA_SEGUNDAS, escrituras));
  try {
    const res = await upgradeCon(tokenVendedor, LISTA_M550);
    assert.strictEqual(res.status, 200);
    const put = escrituras.find(e => e.tipo === 'PUT customer');
    assert.strictEqual(put.body.sales_type, LISTA_M550);
  } finally {
    restore();
  }
});

// El PATCH del panel de dedup por RFC es el otro camino de edicion que puede mover
// la lista (#372: una lista CON valor si viaja en ese diff).
test('L9: el PATCH de cliente con una lista no habilitada se rechaza y no escribe', async () => {
  conListas([LISTA_M550]);
  const escrituras = [];
  const restore = mockFetchByUrl(mocksCliente(LISTA_M550, escrituras));
  try {
    const res = await supertest(app).patch(`/api/operam/clientes/${CLIENTE_UPGRADE}`)
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send({ diff: { sales_type: { anterior: LISTA_M550, nuevo: LISTA_SEGUNDAS, label: 'Lista de precios' } } });
    assert.strictEqual(res.status, 403);
    assert.match(res.body.error, /Segundas/);
    assert.deepStrictEqual(escrituras, []);
  } finally {
    restore();
  }
});

test('L10: el PATCH de cliente con una lista habilitada se guarda', async () => {
  conListas([LISTA_M550]);
  const escrituras = [];
  const restore = mockFetchByUrl(mocksCliente(LISTA_SEGUNDAS, escrituras));
  try {
    const res = await supertest(app).patch(`/api/operam/clientes/${CLIENTE_UPGRADE}`)
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send({ diff: { sales_type: { anterior: LISTA_SEGUNDAS, nuevo: LISTA_M550, label: 'Lista de precios' } } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(escrituras.find(e => e.tipo === 'PUT customer').body.sales_type, LISTA_M550);
  } finally {
    restore();
  }
});

// El PUT directo de cliente escribe los mismos campos sin pasar por ningun panel:
// dejarlo fuera seria dejar el permiso en manos de la pantalla.
test('L11: el PUT directo de cliente tampoco puede asignar una lista no habilitada', async () => {
  conListas([LISTA_M550]);
  const escrituras = [];
  const restore = mockFetchByUrl(mocksCliente(LISTA_M550, escrituras));
  try {
    const res = await supertest(app).put(`/api/actualizar-cliente/${CLIENTE_UPGRADE}`)
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send({ sales_type: LISTA_SEGUNDAS });
    assert.strictEqual(res.status, 403);
    assert.deepStrictEqual(escrituras, []);
  } finally {
    restore();
  }
});

// === AC4: el alta generica (la que deriva la lista del TIER cotizado) no cambia ===
//
// Al subir una cotizacion de una oportunidad sin cliente, la lista no la elige nadie:
// sale del tier que ya se cotizo (resolverSalesTypeId, #92). Ese camino no pasa por la
// matriz -- el permiso gobierna lo que el vendedor ELIGE, y ahi no elige --, y un
// vendedor sin ninguna celda marcada tiene que poder seguir subiendo sus cotizaciones.
const COTS_PATH = join(DATA_DIR, 'cotizaciones.json');
const PROSPECTOS_PATH = join(DATA_DIR, 'prospectos.json');
const FORM_QUOTE = readFileSync(join(__dirname, 'fixtures', 'operam-quote-form.html'), 'utf8');
const VISTA_QUOTE = readFileSync(join(__dirname, 'fixtures', 'operam-quote-vista.html'), 'utf8');

const { _esperarPostFixes, _resetSesionWeb } = await import('../lib/operam-web.js');

function leerJson(path) { return existsSync(path) ? JSON.parse(leerArchivoSync(path)) : []; }
function escribirJson(path, data) { escribirArchivoSync(path, JSON.stringify(data, null, 2)); }

function htmlResponse(html) {
  return { ok: true, status: 200, text: async () => html, headers: { getSetCookie: () => ['FA=sesion-de-prueba; path=/'] } };
}
const MOCK_WEB_LEGACY = {
  'sales_order_entry.php': (u, opts) => (opts?.method === 'POST' ? htmlResponse('<html>ok</html>') : htmlResponse(FORM_QUOTE)),
  'view_sales_order.php': () => htmlResponse(VISTA_QUOTE),
};

test('L12: el vendedor sin ninguna celda sube su cotizacion y el cliente generico nace con la lista del tier', async () => {
  conListas([]);
  const cots = leerJson(COTS_PATH);
  const cotsOriginal = JSON.parse(JSON.stringify(cots));
  const prospectosOriginal = leerJson(PROSPECTOS_PATH);
  const id = cots.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  cots.push({
    id, fecha: '2026-07-06T00:00:00Z', vendedor: 'Alejandro Chávez', cliente: 'Hotel Sin Celdas',
    totalPiezas: 100, total: 11600, tier: 'M550',
    data: {
      fecha: '2026-07-06', vigencia: '2026-08-05',
      cliente: { razonSocial: 'Hotel Sin Celdas SA', nombreCorto: 'Sin Celdas', telefono: '+52 5599887766', pais: 'MX' },
      items: [{ codigo: 'PV08', descripcion: 'Plato', cantidad: 100, precio: 100, descuento: 0 }],
    },
  });
  escribirJson(COTS_PATH, cots);
  escribirJson(PROSPECTOS_PATH, []);
  _resetSesionWeb();

  let clienteBody = null;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/sales_types': () => jsonResponse({ data: SALES_TYPES_OPERAM }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { clienteBody = JSON.parse(opts.body); return jsonResponse({ result: true, customer_id: 920 }); }
      if (opts?.method === 'PUT') return jsonResponse({ result: true });
      if (u.includes('/920')) return jsonResponse({ data: [{ sales_type: LISTA_M550, branches: [{ branch_code: 921 }] }] });
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/branches/921': () => jsonResponse({ result: true, data: [{ br_name: 'Sin Celdas' }] }),
    '/api/v3/sales/quote': () => jsonResponse({ result: true, added_trans_no: 1702 }),
    ...MOCK_WEB_LEGACY,
  });
  try {
    const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
      .set('Authorization', `Bearer ${tokenVendedor}`).send({});
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.ok(clienteBody, 'el alta generica si creo al cliente');
    assert.strictEqual(clienteBody.sales_type, LISTA_M550, 'la lista sale del tier cotizado, no de la matriz');
    await _esperarPostFixes();
  } finally {
    restore();
    escribirJson(COTS_PATH, cotsOriginal);
    escribirJson(PROSPECTOS_PATH, prospectosOriginal);
  }
});

// === AC1: la pantalla recibe el permiso con el catalogo de listas ===

test('L13: GET /api/catalogos le manda al vendedor sus listas asignables y al admin todas las activas', async () => {
  conListas([LISTA_SEGUNDAS]);
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/sales_types': () => jsonResponse({ data: SALES_TYPES_OPERAM }),
  });
  try {
    const vendedor = await supertest(app).get('/api/catalogos').set('Authorization', `Bearer ${tokenVendedor}`);
    assert.strictEqual(vendedor.status, 200);
    assert.deepStrictEqual(vendedor.body.listas_precios.map(l => l.id), [LISTA_M550, LISTA_SEGUNDAS],
      'el catalogo completo sigue viajando: de ahi sale el nombre de la lista que el cliente ya tiene');
    assert.deepStrictEqual(vendedor.body.listasHabilitadas, [LISTA_SEGUNDAS]);

    const admin = await supertest(app).get('/api/catalogos').set('Authorization', `Bearer ${tokenAdmin}`);
    assert.deepStrictEqual(admin.body.listasHabilitadas, [LISTA_M550, LISTA_SEGUNDAS], 'el rol admin ve todas');
  } finally {
    restore();
  }
});

test('L14: el vendedor sin celdas no recibe ninguna lista asignable', async () => {
  conListas([]);
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/sales_types': () => jsonResponse({ data: SALES_TYPES_OPERAM }),
  });
  try {
    const res = await supertest(app).get('/api/catalogos').set('Authorization', `Bearer ${tokenVendedor}`);
    assert.deepStrictEqual(res.body.listasHabilitadas, []);
  } finally {
    restore();
  }
});

// La excepcion de "conservar la lista actual" es del cliente que el alta REUTILIZA.
// Un alta que dice "ninguno es el mismo" crea un Cliente Operam NUEVO (lib/alta-cliente.js:
// solo 'usar' y 'otro-domicilio' aplican sobre uno existente), asi que no hay lista
// actual que heredar: mandar el id de un cliente ajeno con esa lista no la vuelve
// asignable. Mismo hallazgo que #154 en la otra superficie -- el registro tiene dueno.
test('L15: "ninguno es el mismo" con el id de un cliente en Segundas no cuela la lista', async () => {
  conListas([LISTA_M550]);
  const escrituras = [];
  const mocks = mocksAlta(907, 9070, escrituras);
  const clientes = mocks['/api/v3/sales/customers'];
  // El cliente 808 (el del id que viaja en la decision) SI existe y SI esta en
  // Segundas: sin esto el test pasaria por una lectura vacia, no por el permiso.
  mocks['/api/v3/sales/customers'] = (u, opts) => (
    u.includes('/customers/808') ? jsonResponse({ data: [{ customer_id: '808', sales_type: LISTA_SEGUNDAS }] }) : clientes(u, opts)
  );
  const restore = mockFetchByUrl(mocks);
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send({
        tax_id: 'LCP010101AA7', CustName: 'Alta Con Lista SA', cust_ref: 'LCP010101AA7',
        sales_type: LISTA_SEGUNDAS, decision: { tipo: 'ninguno', clienteId: 808 },
        entrega: { br_name: 'ALTA', br_ref: 'ALTA', addr_street: 'Calle', addr_exterior: '1', addr_interior: '', addr_colony: 'Col', addr_city: 'CDMX', addr_state: 'CDMX', addr_zip: '06600', addr_reference: '', phone: '', email: '', pais: 'MX' },
        salesman: 2,
      });
    assert.strictEqual(res.status, 403);
    assert.deepStrictEqual(escrituras, []);
  } finally {
    restore();
  }
});

// La otra mitad del par: cuando el alta SI reutiliza al Cliente Operam ("Usar este
// cliente"), conservar la lista que ese cliente ya tiene es valido aunque quien
// captura no la tenga habilitada -- es la misma regla de la edicion.
test('L16: "usar este cliente" conserva la lista que ese cliente ya tiene, sin la celda', async () => {
  conListas([LISTA_M550]);
  const escrituras = [];
  const CON_SEGUNDAS = {
    customer_id: '808', CustName: 'CLIENTE CON SEGUNDAS SA', cust_ref: 'Segundas SA',
    tax_id: 'LCP010101AA8', sales_type: LISTA_SEGUNDAS, branches: [{ branch_code: 8080 }],
  };
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/sales_types': () => jsonResponse({ data: SALES_TYPES_OPERAM }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { escrituras.push({ tipo: 'POST customer', body: JSON.parse(opts.body) }); return jsonResponse({ result: true, customer_id: 999 }); }
      if (opts?.method === 'PUT') { escrituras.push({ tipo: 'PUT customer', body: JSON.parse(opts.body) }); return jsonResponse({ result: true, ...JSON.parse(opts.body) }); }
      if (u.includes('/customers/808')) return jsonResponse({ data: [CON_SEGUNDAS] });
      return jsonResponse({ total: 1, data: [CON_SEGUNDAS] });
    },
    '/api/v3/sales/branches/8080': (u, opts) => {
      if (opts?.method === 'PUT') escrituras.push({ tipo: 'PUT branch' });
      return jsonResponse({ result: true, data: [{ br_name: 'ALTA', branch_ref: 'ALTA' }] });
    },
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send({
        tax_id: 'LCP010101AA8', CustName: 'Cliente Con Segundas SA', cust_ref: 'Segundas SA',
        sales_type: LISTA_SEGUNDAS, decision: { tipo: 'usar', clienteId: 808 },
        entrega: { br_name: 'ALTA', br_ref: 'ALTA', addr_street: 'Calle', addr_exterior: '1', addr_interior: '', addr_colony: 'Col', addr_city: 'CDMX', addr_state: 'CDMX', addr_zip: '06600', addr_reference: '', phone: '', email: '', pais: 'MX' },
        salesman: 2,
      });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.customer_id, 808, 'el alta aplico sobre el cliente que ya existia');
    assert.strictEqual(escrituras.some(e => e.tipo === 'POST customer'), false, 'no se creo ningun cliente nuevo');
  } finally {
    restore();
  }
});
