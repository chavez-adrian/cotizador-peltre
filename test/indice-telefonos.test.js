import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  normalizarTelefono, construirIndice, matchCliente, refrescarIndice, resetIndice,
} from '../lib/indice-telefonos.js';
import { resetSession } from '../lib/operam-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

function mockFetchByUrl(urlHandlers) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    for (const [pattern, handler] of Object.entries(urlHandlers)) {
      if (urlStr.includes(pattern)) return handler(url, opts);
    }
    throw new Error('Unmocked fetch: ' + urlStr);
  };
  return () => { globalThis.fetch = original; };
}

function jsonResponse(data, status = 200) {
  return { ok: status < 400, status, json: async () => data };
}

let restore = null;
beforeEach(() => {
  resetIndice();
  resetSession();
});
afterEach(() => {
  if (restore) { restore(); restore = null; }
  resetIndice();
  resetSession();
});

// === normalizarTelefono: formatos reales verificados contra produccion (probe 2026-06-10) ===

test('normalizarTelefono: ultimos 10 digitos en formatos inconsistentes reales', () => {
  assert.equal(normalizarTelefono('5553868744'), '5553868744');
  assert.equal(normalizarTelefono('55 5502 0735'), '5555020735');
  assert.equal(normalizarTelefono('444 165 8765'), '4441658765');
  assert.equal(normalizarTelefono('+52 55 6361 5145'), '5563615145');
  assert.equal(normalizarTelefono('+52 1 55 6207 1948'), '5562071948');
  assert.equal(normalizarTelefono('(204) 250-7656'), '2042507656');
  assert.equal(normalizarTelefono('+1 (915) 726-5519'), '9157265519');
  assert.equal(normalizarTelefono('+52 .55 9108 7203'), '5591087203');
  assert.equal(normalizarTelefono('+52(55)54145976\t'), '5554145976');
});

test('normalizarTelefono: extensiones no contaminan los ultimos 10 digitos', () => {
  assert.equal(normalizarTelefono('+52(55)53952615,116'), '5553952615');
  assert.equal(normalizarTelefono('+52(55)53952615 ext.123'), '5553952615');
  assert.equal(normalizarTelefono('+52(55)53952615 ext 116'), '5553952615');
  assert.equal(normalizarTelefono('+52(55)53952615 EXT 4'), '5553952615');
});

test('normalizarTelefono: menos de 10 digitos, vacio o nulo no producen llave', () => {
  assert.equal(normalizarTelefono('12097255'), null);
  assert.equal(normalizarTelefono('56612363'), null);
  assert.equal(normalizarTelefono(''), null);
  assert.equal(normalizarTelefono(null), null);
  assert.equal(normalizarTelefono(undefined), null);
});

// === construirIndice ===

const CLIENTES = [
  {
    customer_id: '101', CustName: 'UTILITARIO MEXICANO SA DE CV',
    contacts: [
      { phone: '', phone2: '', email: 'facturas@x.com' },
      { phone: '+52 1 55 6207 1948', phone2: '55 4039 4937' },
    ],
    branches: [{ branch_code: '1', phone: '' }],
  },
  {
    customer_id: '202', CustName: 'HOTELERA DEL SUR',
    contacts: [],
    branches: [{ branch_code: '7', phone: '+52(55)53952615 ext.123' }],
  },
  {
    customer_id: '303', CustName: 'SIN TELEFONOS',
    contacts: [{ phone: '1234' }],
    branches: [],
  },
];

test('construirIndice: indexa contacts.phone, contacts.phone2 y branches.phone por ultimos 10', () => {
  const idx = construirIndice(CLIENTES);
  assert.deepEqual(idx.get('5562071948'), { customer_id: '101', cust_name: 'UTILITARIO MEXICANO SA DE CV' });
  assert.deepEqual(idx.get('5540394937'), { customer_id: '101', cust_name: 'UTILITARIO MEXICANO SA DE CV' });
  assert.deepEqual(idx.get('5553952615'), { customer_id: '202', cust_name: 'HOTELERA DEL SUR' });
  assert.equal(idx.size, 3);
});

test('construirIndice: ante el mismo telefono en dos clientes gana el primero', () => {
  const idx = construirIndice([
    { customer_id: '1', CustName: 'PRIMERO', contacts: [{ phone: '5511111111' }], branches: [] },
    { customer_id: '2', CustName: 'SEGUNDO', contacts: [{ phone: '+52 55 1111 1111' }], branches: [] },
  ]);
  assert.equal(idx.get('5511111111').customer_id, '1');
});

// === matchCliente: cache, refresh y best effort ===

function mockListado(clientes, contadores) {
  return mockFetchByUrl({
    '/api/v3/login': () => {
      contadores.login++;
      return jsonResponse({ token: 'tok', result: true });
    },
    '/api/v3/sales/customers': (url) => {
      contadores.paginas++;
      const skip = parseInt(String(url).match(/skip=(\d+)/)[1], 10);
      return jsonResponse({ total: clientes.length, data: clientes.slice(skip, skip + 100) });
    },
  });
}

test('matchCliente: pagina el listado, matchea por ultimos 10 en cualquier formato y cachea', async () => {
  const muchos = [...CLIENTES];
  for (let i = 0; i < 120; i++) {
    muchos.push({ customer_id: String(1000 + i), CustName: `RELLENO ${i}`, contacts: [], branches: [] });
  }
  const contadores = { login: 0, paginas: 0 };
  restore = mockListado(muchos, contadores);

  const m1 = await matchCliente('+52 5562071948');
  assert.deepEqual(m1, { customer_id: '101', cust_name: 'UTILITARIO MEXICANO SA DE CV' });
  assert.equal(contadores.paginas, 2);

  const m2 = await matchCliente('55-3952-615 oops');
  assert.equal(m2, null);
  const m3 = await matchCliente('+52(55)53952615');
  assert.equal(m3.customer_id, '202');
  assert.equal(contadores.paginas, 2, 'segundo match usa el cache, sin refetch');
});

test('matchCliente: sin llave de 10 digitos no consulta Operam', async () => {
  restore = mockFetchByUrl({});
  assert.equal(await matchCliente('123'), null);
  assert.equal(await matchCliente(''), null);
});

test('refrescarIndice: reconstruye el indice bajo demanda', async () => {
  const contadores = { login: 0, paginas: 0 };
  restore = mockListado([CLIENTES[0]], contadores);
  assert.equal((await matchCliente('5562071948')).customer_id, '101');
  restore();
  restore = mockListado([{ customer_id: '9', CustName: 'NUEVO', contacts: [{ phone: '5599999999' }], branches: [] }], contadores);
  await refrescarIndice();
  assert.equal(await matchCliente('5562071948'), null);
  assert.equal((await matchCliente('+52 5599999999')).customer_id, '9');
});

test('matchCliente: si Operam falla devuelve null sin lanzar (best effort)', async () => {
  restore = mockFetchByUrl({
    '/api/v3/login': () => { throw new Error('ECONNREFUSED'); },
  });
  assert.equal(await matchCliente('+52 5512345678'), null);
});

test('matchCliente: si Operam no responde, el timeout devuelve null sin bloquear', async () => {
  restore = mockFetchByUrl({
    '/api/v3/login': () => new Promise(() => {}),
  });
  const inicio = Date.now();
  const m = await matchCliente('+52 5512345678', { timeoutMs: 50 });
  assert.equal(m, null);
  assert.ok(Date.now() - inicio < 2000);
});

test('matchCliente: si el refresh falla pero hay indice previo, usa el indice viejo', async () => {
  const contadores = { login: 0, paginas: 0 };
  restore = mockListado([CLIENTES[1]], contadores);
  assert.equal((await matchCliente('5553952615')).customer_id, '202');
  restore();
  restore = mockFetchByUrl({
    '/api/v3/login': () => { throw new Error('Operam caido'); },
  });
  await assert.rejects(refrescarIndice());
  assert.equal((await matchCliente('5553952615')).customer_id, '202');
  const stale = await matchCliente('5553952615', { ttlMs: 0 });
  assert.equal(stale.customer_id, '202', 'indice expirado con Operam caido sigue sirviendo el viejo');
});
