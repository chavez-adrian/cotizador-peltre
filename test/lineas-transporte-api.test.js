// #447: lineas de transporte administrables en /admin. La regla vive en el nucleo
// puro (public/js/__tests__/lineas-transporte-logica.test.cjs); aqui se prueba la
// costura HTTP: el panel administra la lista (solo admin), envia.com consulta solo
// los carriers de las lineas `envia` activas y Lalamove/Tresguerras solo cotizan
// con su linea activa. La lista vive en la configuracion del panel (#276).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync } from '../lib/fs-reintento.js';
import { fotoDatos, fijarDatos } from './helpers/datos-aislados.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '..', 'data', 'config.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}
// Aqui se escribe via el store de configuracion: con pool real el guardado le
// pegaria a Neon (mismo motivo que test/config-store.test.js).
delete process.env.DATABASE_URL;

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const configStore = await import('../lib/config-store.js');
const { app } = await import('../server.js');

const ADMIN = `Bearer ${jwt.sign({ id: 1, name: 'Jefa Test', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' })}`;
const VENDEDOR = `Bearer ${jwt.sign({ id: 7, name: 'Memo', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' })}`;

const CONFIG_INICIAL = { tiposActivos: ['PL'], texturasActivas: [1] };
const CARRITO = { cpDestino: '06700', paisDestino: 'MX', items: [{ codigo: 'PV08', cantidad: 1 }], totalConIVA: 1160 };

const originalFetch = globalThis.fetch;
const envOriginal = { ...process.env };

// envia.com: un rate por carrier conocido; el codigo que no existe responde como
// responde envia.com a un carrier invalido (meta error con su descripcion).
function mockEnvia({ invalidos = [] } = {}) {
  const consultas = [];
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('api.envia.com/ship/rate')) {
      const carrier = JSON.parse(opts.body).shipment.carrier;
      consultas.push(carrier);
      if (invalidos.includes(carrier)) {
        return { ok: false, status: 400, json: async () => ({ meta: 'error', error: { code: 1125, description: 'Invalid Option', message: `The carrier ${carrier} is not valid` } }) };
      }
      return { ok: true, status: 200, json: async () => ({ meta: 'rate', data: [{ carrier, service: 'ground', totalPrice: 100 + consultas.length }] }) };
    }
    throw new Error('Unmocked fetch: ' + u);
  };
  return consultas;
}

function configGuardada() {
  return JSON.parse(leerArchivoSync(CONFIG_PATH));
}

let restaurarDatos;
before(() => { restaurarDatos = fotoDatos([CONFIG_PATH]); });
after(() => {
  restaurarDatos();
  configStore._reiniciar();
  globalThis.fetch = originalFetch;
  process.env = envOriginal;
});

beforeEach(() => {
  fijarDatos(CONFIG_PATH, CONFIG_INICIAL);
  configStore._reiniciar();
  globalThis.fetch = originalFetch;
  process.env = { ...envOriginal, ENVIA_API_KEY: 'test-key' };
});

test('con la semilla, cotizar paqueteria consulta envia.com con FedEx, DHL y Estafeta, nunca UPS', async () => {
  const consultas = mockEnvia();
  const res = await supertest(app).post('/api/cotizacion/envio').set('Authorization', VENDEDOR).send(CARRITO);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepStrictEqual([...consultas].sort(), ['dhl', 'estafeta', 'fedex']);
  assert.ok(!consultas.includes('ups'));
});

test('una linea envia con un codigo que envia.com no reconoce sale como aviso y las demas cotizan', async () => {
  fijarDatos(CONFIG_PATH, { ...CONFIG_INICIAL, lineasTransporte: [
    { nombre: 'FedEx', fuente: 'envia', codigo: 'fedex', shipVia: 2, activa: true },
    { nombre: 'Paqueteria Fantasma', fuente: 'envia', codigo: 'fantasma', shipVia: null, activa: true },
  ] });
  configStore._reiniciar();
  const consultas = mockEnvia({ invalidos: ['fantasma'] });
  const res = await supertest(app).post('/api/cotizacion/envio').set('Authorization', VENDEDOR).send(CARRITO);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepStrictEqual([...consultas].sort(), ['fantasma', 'fedex']);
  assert.deepStrictEqual(res.body.rates.map(r => r.carrier), ['fedex']);
  const aviso = res.body.warnings.find(w => /Paqueteria Fantasma/.test(w));
  assert.ok(aviso, JSON.stringify(res.body.warnings));
  assert.match(aviso, /fantasma/);
  assert.match(aviso, /The carrier fantasma is not valid/);
});

test('envia.com que truena para un carrier (red, respuesta no JSON) tambien sale como aviso, nunca 500', async () => {
  fijarDatos(CONFIG_PATH, { ...CONFIG_INICIAL, lineasTransporte: [
    { nombre: 'FedEx', fuente: 'envia', codigo: 'fedex', shipVia: 2, activa: true },
    { nombre: 'DHL', fuente: 'envia', codigo: 'dhl', shipVia: 6, activa: true },
  ] });
  configStore._reiniciar();
  globalThis.fetch = async (url, opts) => {
    const carrier = JSON.parse(opts.body).shipment.carrier;
    if (carrier === 'dhl') throw new Error('socket hang up');
    return { ok: true, status: 200, json: async () => ({ data: [{ carrier, service: 'ground', totalPrice: 259 }] }) };
  };
  const res = await supertest(app).post('/api/cotizacion/envio').set('Authorization', VENDEDOR).send(CARRITO);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepStrictEqual(res.body.rates.map(r => r.carrier), ['fedex']);
  assert.ok(res.body.warnings.some(w => /DHL/.test(w) && /socket hang up/.test(w)), JSON.stringify(res.body.warnings));
});

test('una paqueteria dada de alta en la lista (Paquetexpress) se consulta sin tocar codigo; la inactiva no', async () => {
  fijarDatos(CONFIG_PATH, { ...CONFIG_INICIAL, lineasTransporte: [
    { nombre: 'FedEx', fuente: 'envia', codigo: 'fedex', shipVia: 2, activa: false },
    { nombre: 'Paquetexpress', fuente: 'envia', codigo: 'paquetexpress', shipVia: null, activa: true },
  ] });
  configStore._reiniciar();
  const consultas = mockEnvia();
  const res = await supertest(app).post('/api/cotizacion/envio').set('Authorization', VENDEDOR).send(CARRITO);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepStrictEqual(consultas, ['paquetexpress']);
});

test('sin ninguna linea envia activa no se consulta envia.com: aviso, nunca 500', async () => {
  fijarDatos(CONFIG_PATH, { ...CONFIG_INICIAL, lineasTransporte: [
    { nombre: 'FedEx', fuente: 'envia', codigo: 'fedex', shipVia: 2, activa: false },
  ] });
  configStore._reiniciar();
  const consultas = mockEnvia();
  const res = await supertest(app).post('/api/cotizacion/envio').set('Authorization', VENDEDOR).send(CARRITO);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepStrictEqual(consultas, []);
  assert.deepStrictEqual(res.body.rates, []);
  assert.ok(res.body.warnings.some(w => /No hay paqueterias de envia.com activas/.test(w)), JSON.stringify(res.body.warnings));
});

// Con la linea de una integracion propia desactivada, su endpoint avisa y no
// consulta a nadie (ni la API de Lalamove ni el cotizador de Tresguerras).
for (const [fuente, ruta, nombre] of [
  ['lalamove', '/api/cotizacion/envio/lalamove', 'Lalamove'],
  ['tresguerras', '/api/cotizacion/envio/tresguerras', 'Tresguerras'],
]) {
  test(`${nombre} desactivada en /admin: su endpoint responde con aviso en vez de cotizar`, async () => {
    fijarDatos(CONFIG_PATH, { ...CONFIG_INICIAL, lineasTransporte: [
      { nombre: 'FedEx', fuente: 'envia', codigo: 'fedex', shipVia: 2, activa: true },
      { nombre, fuente, codigo: null, shipVia: 3, activa: false },
    ] });
    configStore._reiniciar();
    process.env.LALAMOVE_API_KEY = 'pk_test_x';
    process.env.LALAMOVE_API_SECRET = 'sk_test_x';
    const consultas = [];
    globalThis.fetch = async (url) => { consultas.push(String(url)); throw new Error('no deberia consultar: ' + url); };
    const res = await supertest(app).post(ruta).set('Authorization', VENDEDOR).send(CARRITO);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepStrictEqual(res.body.rates, []);
    assert.ok(res.body.warnings.some(w => w.includes(`${nombre} no esta activa`)), JSON.stringify(res.body.warnings));
    assert.deepStrictEqual(consultas, []);
  });

  test(`${nombre} ausente de la lista guardada tambien avisa sin cotizar`, async () => {
    fijarDatos(CONFIG_PATH, { ...CONFIG_INICIAL, lineasTransporte: [
      { nombre: 'FedEx', fuente: 'envia', codigo: 'fedex', shipVia: 2, activa: true },
    ] });
    configStore._reiniciar();
    const consultas = [];
    globalThis.fetch = async (url) => { consultas.push(String(url)); throw new Error('no deberia consultar: ' + url); };
    const res = await supertest(app).post(ruta).set('Authorization', VENDEDOR).send(CARRITO);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepStrictEqual(res.body.rates, []);
    assert.ok(res.body.warnings.some(w => w.includes('no esta activa')), JSON.stringify(res.body.warnings));
    assert.deepStrictEqual(consultas, []);
  });
}

const SEMILLA = [
  { nombre: 'FedEx', fuente: 'envia', codigo: 'fedex', shipVia: 2, activa: true },
  { nombre: 'DHL', fuente: 'envia', codigo: 'dhl', shipVia: 6, activa: true },
  { nombre: 'Estafeta', fuente: 'envia', codigo: 'estafeta', shipVia: 5, activa: true },
  { nombre: 'Lalamove', fuente: 'lalamove', codigo: null, shipVia: 3, activa: true },
  { nombre: 'Tresguerras', fuente: 'tresguerras', codigo: null, shipVia: 4, activa: true },
];

test('las rutas de lineas de transporte exigen admin: vendedor 403, sin token 401', async () => {
  for (const [metodo, ruta] of [['get', '/api/admin/lineas-transporte'], ['put', '/api/admin/lineas-transporte']]) {
    const vendedor = await supertest(app)[metodo](ruta).set('Authorization', VENDEDOR).send([]);
    assert.equal(vendedor.status, 403, `${metodo} ${ruta}`);
    const sinToken = await supertest(app)[metodo](ruta).send([]);
    assert.equal(sinToken.status, 401, `${metodo} ${ruta}`);
  }
  assert.equal(configGuardada().lineasTransporte, undefined, 'el vendedor no guardo nada');
});

test('GET sin configuracion guardada devuelve la semilla', async () => {
  const res = await supertest(app).get('/api/admin/lineas-transporte').set('Authorization', ADMIN);
  assert.equal(res.status, 200);
  assert.deepStrictEqual(res.body.lineas, SEMILLA);
});

test('PUT reemplaza la lista, conserva el resto de la configuracion y la cotizacion la usa', async () => {
  const nueva = [
    { nombre: 'FedEx', fuente: 'envia', codigo: 'fedex', shipVia: 2, activa: true },
    { nombre: 'Paquetexpress', fuente: 'envia', codigo: 'paquetexpress', shipVia: '', activa: true },
    { nombre: 'Lalamove', fuente: 'lalamove', codigo: null, shipVia: 3, activa: false },
  ];
  const put = await supertest(app).put('/api/admin/lineas-transporte').set('Authorization', ADMIN).send(nueva);
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const esperada = [
    { nombre: 'FedEx', fuente: 'envia', codigo: 'fedex', shipVia: 2, activa: true },
    { nombre: 'Paquetexpress', fuente: 'envia', codigo: 'paquetexpress', shipVia: null, activa: true },
    { nombre: 'Lalamove', fuente: 'lalamove', codigo: null, shipVia: 3, activa: false },
  ];
  assert.deepStrictEqual(put.body.lineas, esperada);
  const guardada = configGuardada();
  assert.deepStrictEqual(guardada.lineasTransporte, esperada);
  assert.deepStrictEqual(guardada.tiposActivos, ['PL'], 'el resto de la configuracion se conserva');

  const get = await supertest(app).get('/api/admin/lineas-transporte').set('Authorization', ADMIN);
  assert.deepStrictEqual(get.body.lineas, esperada);

  const consultas = mockEnvia();
  await supertest(app).post('/api/cotizacion/envio').set('Authorization', VENDEDOR).send(CARRITO);
  assert.deepStrictEqual([...consultas].sort(), ['fedex', 'paquetexpress']);
});

test('PUT con una linea invalida responde 400 y no toca lo guardado', async () => {
  const res = await supertest(app).put('/api/admin/lineas-transporte').set('Authorization', ADMIN)
    .send([{ nombre: 'UPS', fuente: 'envia', codigo: '', activa: true }]);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /codigo de envia.com/);
  assert.equal(configGuardada().lineasTransporte, undefined);
});

test('GET /api/precios le entrega al vendedor las lineas de transporte vigentes (semilla sin configuracion)', async () => {
  const res = await supertest(app).get('/api/precios').set('Authorization', VENDEDOR);
  assert.equal(res.status, 200);
  assert.deepStrictEqual(res.body.lineasTransporte, SEMILLA);
});
