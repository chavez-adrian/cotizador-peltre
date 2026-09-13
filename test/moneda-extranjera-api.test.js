// #297 (ADR-0015, CONTEXT.md "Moneda del cliente"): cotizarle a un cliente cuya
// moneda en Operam no es MXN se detiene con un mensaje accionable.
//
// El cotizador calcula, imprime y sube PESOS pelones, y Operam los etiqueta con
// la moneda del cliente: un quote a un cliente USD registraria pesos como
// dolares (error de 17x) sin ningun aviso. Aqui se prueba la defensa del
// SERVIDOR -- independiente de la pantalla, por si el cliente llego por otro
// camino o cambio de moneda despues de seleccionado -- y la moneda que el paso
// Cliente necesita para avisar antes de cotizar.
//
// Prior art del montaje: test/cliente-sin-lista-api.test.js (#285) y
// test/estados-cliente-api.test.js (#344).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COTS_PATH = join(__dirname, '..', 'data', 'cotizaciones.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}
delete process.env.DATABASE_URL;

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');
const { CODIGO_MONEDA_EXTRANJERA, bloqueoMonedaCliente } = await import('../public/js/moneda-cliente-logica.js');
const { resetIndice } = await import('../lib/indice-telefonos.js');
const { resetActividad } = await import('../lib/actividad-operam.js');
const { resetSession } = await import('../lib/operam-client.js');

const token = jwt.sign({ id: 1, name: 'Admin Test', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

function readCots() {
  if (!existsSync(COTS_PATH)) return [];
  return JSON.parse(leerArchivoSync(COTS_PATH));
}
function writeCots(data) {
  escribirArchivoSync(COTS_PATH, JSON.stringify(data, null, 2));
}
function registro(id) {
  return readCots().find(c => c.id === id);
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

// Cliente con RFC real: la subida entra por el camino normal
// (subirCotizacionOperam), no por el alta generica.
const RFC = 'WSI010101AAA';
function cotizacion() {
  return {
    fecha: '2026-01-01', vigencia: '2026-02-01', tier: 'Menudeo', _compress: false,
    cliente: { razonSocial: 'WILLIAMS SONOMA INC', nombreCorto: 'Williams Sonoma', telefono: '+52 55 1234 5678', rfc: RFC },
    items: [{ codigo: 'AB12', descripcion: 'Olla', cantidad: 10, unidad: 'pza', precio: 100, descuento: 0 }],
    subtotal: 1000, iva: 160, total: 1160, notas: [],
  };
}

// El cliente tal como lo devuelve Operam: el listado por ?tax_id= y el GET de
// detalle salen del mismo endpoint, asi que un solo handler sirve para los dos.
// Con lista de precios asignada: lo que se prueba aqui es la moneda, no #285.
function clienteOperam(currCode) {
  return {
    total: 1,
    data: [{
      customer_id: '88', tax_id: RFC, CustName: 'WILLIAMS SONOMA INC', sales_type: '12',
      curr_code: currCode, branches: [{ branch_code: '1' }],
    }],
  };
}

async function crearCotizacion() {
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${token}`).send(cotizacion());
  assert.strictEqual(res.status, 200);
  return res.body.id;
}

let cotsOriginal;
before(() => { cotsOriginal = readCots(); });
after(() => { writeCots(cotsOriginal); globalThis.fetch = originalFetch; });

test('MX1: cliente en USD -> 422 accionable y el quote NUNCA se sube', async () => {
  const id = await crearCotizacion();
  let postsQuote = 0;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': () => jsonResponse(clienteOperam('USD')),
    '/api/v3/sales/quote': () => { postsQuote++; return jsonResponse({ result: true, added_trans_no: 1300 }); },
  });
  try {
    const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
      .set('Authorization', `Bearer ${token}`).send({});
    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.codigo, CODIGO_MONEDA_EXTRANJERA);
    assert.match(res.body.error, /USD/, 'el mensaje nombra la moneda del cliente');
    assert.match(res.body.error, /WILLIAMS SONOMA INC/);
    assert.match(res.body.error, /Operam/, 'y dice que hacer');
    assert.strictEqual(postsQuote, 0, 'pesos etiquetados como dolares: el quote no se intenta');
  } finally {
    restore();
  }
  const guardada = registro(id);
  assert.ok(guardada.folioOperam == null || guardada.folioOperam === '', 'sigue siendo PRE');
});

test('MX2: cliente en MXN sube exactamente como hoy', async () => {
  const id = await crearCotizacion();
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': () => jsonResponse(clienteOperam('MXN')),
    '/api/v3/sales/quote': () => jsonResponse({ result: true, added_trans_no: 1301 }),
  });
  try {
    const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
      .set('Authorization', `Bearer ${token}`).send({});
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.folio, 1301);
  } finally {
    restore();
  }
  assert.strictEqual(String(registro(id).folioOperam), '1301');
});

// La otra puerta a la subida (#204/#345): la cotizacion sin cliente en Operam en
// la que el vendedor eligio un candidato EXISTENTE. Ese cliente no paso por la
// fila del paso Cliente, asi que es justo el camino por el que un cliente en otra
// moneda podria colarse -- y tiene su propia traduccion a HTTP (subirQuoteTrasAlta).
test('MX4: el candidato elegido en la dedup tambien se detiene por su moneda, sin crear ni subir nada', async () => {
  const cots = readCots();
  const id = cots.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  cots.push({
    id, fecha: '2026-01-01T00:00:00Z', vendedor: 'Admin Test', cliente: 'Acme Export',
    totalPiezas: 100, total: 11600, tier: 'M100',
    data: {
      fecha: '2026-01-01', vigencia: '2026-02-01',
      cliente: { razonSocial: 'Acme Export', nombreCorto: 'Acme Export', telefono: '+52 55 8877 6655', pais: 'MX' },
      items: [{ codigo: 'PV08', descripcion: 'Plato', cantidad: 100, precio: 100, descuento: 0 }],
    },
  });
  writeCots(cots);
  resetIndice(); resetSession();
  let postCustomer = false;
  let postsQuote = 0;
  const restore = mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    // La lista de precios del tier, que el alta resuelve antes de decidir nada.
    '/api/v3/sales/sales_types': () => jsonResponse({ data: [{ id: '15', sales_type: 'M100', inactive: '0' }] }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { postCustomer = true; return jsonResponse({ result: true, customer_id: 999 }); }
      // El detalle del elegido: con lista de precios (no es #285) y en dolares.
      if (u.includes('/10')) {
        return jsonResponse({ data: [{
          customer_id: '10', CustName: 'ACME EXPORT LLC', sales_type: '12', curr_code: 'USD',
          branches: [{ branch_code: '20' }],
        }] });
      }
      // El pool por RFC generico con el que se revalida al elegido (#208).
      if (u.includes('tax_id=')) {
        return jsonResponse({ total: 1, data: [
          { customer_id: 10, CustName: 'ACME EXPORT LLC', cust_ref: 'Acme Export', tax_id: 'XAXX010101000' },
        ] });
      }
      return jsonResponse({ total: 0, data: [] });
    },
    '/api/v3/sales/quote': () => { postsQuote++; return jsonResponse({ result: true, added_trans_no: 1302 }); },
  });
  try {
    const res = await supertest(app).post(`/api/cotizacion/operam/${id}`)
      .set('Authorization', `Bearer ${token}`).send({ customerId: 10 });
    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.codigo, CODIGO_MONEDA_EXTRANJERA);
    assert.match(res.body.error, /USD/);
    assert.strictEqual(postCustomer, false, 'elegir candidato nunca crea');
    assert.strictEqual(postsQuote, 0, 'y aqui tampoco se sube');
  } finally {
    restore();
    resetIndice(); resetSession();
  }
  assert.ok(!registro(id).folioOperam, 'la cotizacion sigue PRE');
});

// La otra mitad del bloqueo: el aviso INMEDIATO al seleccionar al cliente en el
// paso Cliente. El navegador no consulta a Operam -- pinta la fila que le dio el
// buscador --, asi que la moneda tiene que venir en esa fila para que el mismo
// nucleo puro decida antes de cotizar. El render en app.js no se prueba (sin DOM
// en Node): lo que se afirma aqui es el dato que lo alimenta y el veredicto.
const PADRON = [
  {
    customer_id: '88', CustName: 'WILLIAMS SONOMA INC', cust_ref: 'Williams Sonoma',
    tax_id: RFC, country: 'United States', curr_code: 'USD', sales_type: '12',
    contacts: [], branches: [{ branch_code: '1', br_name: 'MATRIZ', phone: '' }],
  },
  {
    customer_id: '89', CustName: 'HOTEL AZUL SA DE CV', cust_ref: 'Hotel Azul',
    tax_id: 'HAZ010101AB1', country: 'Mexico', curr_code: 'MXN', sales_type: '12',
    contacts: [], branches: [{ branch_code: '2', br_name: 'MATRIZ', phone: '' }],
  },
];

function mockPadron() {
  return mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/sales_orders': () => jsonResponse({ data: [] }),
    '/api/v3/sales/customers': (u) => {
      if (u.includes('limit=100')) return jsonResponse({ total: PADRON.length, data: PADRON });
      const search = decodeURIComponent((u.match(/[?&]search=([^&]*)/) || [])[1] || '');
      const hit = PADRON.filter(c => c.CustName.toLowerCase().includes(search.toLowerCase()));
      return jsonResponse({ total: hit.length, data: hit });
    },
  });
}

test('MX3: la fila del paso Cliente trae la moneda del cliente, y con ella el nucleo bloquea antes de cotizar', async () => {
  resetIndice(); resetActividad(); resetSession();
  const restore = mockPadron();
  let extranjero, nacional;
  try {
    const res = await supertest(app).get('/api/operam/clientes?q=' + encodeURIComponent('SONOMA'))
      .set('Authorization', `Bearer ${token}`);
    assert.strictEqual(res.status, 200);
    extranjero = res.body.find(c => c.id === '88');
    const res2 = await supertest(app).get('/api/operam/clientes?q=' + encodeURIComponent('HOTEL AZUL'))
      .set('Authorization', `Bearer ${token}`);
    assert.strictEqual(res2.status, 200);
    nacional = res2.body.find(c => c.id === '89');
  } finally {
    restore();
    resetIndice(); resetActividad(); resetSession();
  }
  assert.ok(extranjero, 'el cliente en USD aparece en el buscador como siempre');
  assert.strictEqual(extranjero.moneda, 'USD');
  assert.strictEqual(nacional.moneda, 'MXN');
  // Lo que hara el paso Cliente con esa fila: aviso para el USD, nada para el MXN.
  const bloqueo = bloqueoMonedaCliente(extranjero, extranjero.name);
  assert.ok(bloqueo);
  assert.match(bloqueo.mensaje, /USD/);
  assert.strictEqual(bloqueoMonedaCliente(nacional, nacional.name), null);
});
