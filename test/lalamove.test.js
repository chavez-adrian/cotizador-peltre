import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tarifasLalamove, _reiniciarLalamove } from '../lib/lalamove.js';

const CITIES = {
  data: [{
    locode: 'MX MEX',
    services: [
      { key: 'CAR', load: { value: '300', unit: 'kg' } },
      { key: 'VAN', load: { value: '1000', unit: 'kg' } },
    ],
  }],
};
const COORDS = { '06700': [19.418, -99.163] };

const cotizacion = (total) => ({ data: { priceBreakdown: { total, currency: 'MXN' }, distance: { value: '33400', unit: 'm' } } });

let fetchOriginal, envOriginal, llamadas;
function mockLalamove(responder) {
  llamadas = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    llamadas.push({ url: u, init });
    const { status, json } = responder(u, init ? JSON.parse(init.body || 'null') : null);
    return { ok: status < 300, status, json: async () => json };
  };
}

beforeEach(() => {
  fetchOriginal = globalThis.fetch;
  envOriginal = { ...process.env };
  process.env.LALAMOVE_API_KEY = 'pk_test_x';
  process.env.LALAMOVE_API_SECRET = 'sk_test_x';
  process.env.LALAMOVE_BASE_URL = 'https://rest.sandbox.lalamove.com';
  _reiniciarLalamove({ coords: COORDS });
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  process.env = envOriginal;
  _reiniciarLalamove();
});

test('tarifasLalamove: cotiza solo los vehiculos que alcanzan el peso y firma cada peticion', async () => {
  mockLalamove((u, body) => u.endsWith('/v3/cities')
    ? { status: 200, json: CITIES }
    : { status: 201, json: cotizacion(body.data.serviceType === 'VAN' ? '629.76' : '229.76') });
  const { rates, warnings } = await tarifasLalamove({ cp: '06700', pesoKg: 400 });
  assert.deepEqual(warnings, []);
  assert.deepEqual(rates.map(r => [r.service, r.totalPrice]), [['Van', 629.76]]);
  const quote = llamadas.find(l => l.url.endsWith('/v3/quotations'));
  assert.equal(quote.url, 'https://rest.sandbox.lalamove.com/v3/quotations');
  assert.match(quote.init.headers.Authorization, /^hmac pk_test_x:\d+:[0-9a-f]{64}$/);
  assert.deepEqual(JSON.parse(quote.init.body).data.stops[1].coordinates, { lat: '19.418', lng: '-99.163' });
});

test('tarifasLalamove: el catalogo de vehiculos se pide una vez y se reusa', async () => {
  mockLalamove((u) => u.endsWith('/v3/cities') ? { status: 200, json: CITIES } : { status: 201, json: cotizacion('1') });
  await tarifasLalamove({ cp: '06700', pesoKg: 10 });
  await tarifasLalamove({ cp: '06700', pesoKg: 10 });
  assert.equal(llamadas.filter(l => l.url.endsWith('/v3/cities')).length, 1);
});

test('tarifasLalamove: fuera del area de servicio no es advertencia', async () => {
  mockLalamove((u) => u.endsWith('/v3/cities')
    ? { status: 200, json: CITIES }
    : { status: 422, json: { errors: [{ id: 'ERR_OUT_OF_SERVICE_AREA', message: 'out of service area' }] } });
  assert.deepEqual(await tarifasLalamove({ cp: '06700', pesoKg: 10 }), { rates: [], warnings: [] });
});

test('tarifasLalamove: un error distinto se reporta como advertencia sin lanzar', async () => {
  mockLalamove((u) => u.endsWith('/v3/cities')
    ? { status: 200, json: CITIES }
    : { status: 401, json: { errors: [{ id: 'ERR_UNAUTHORIZED', message: 'Unauthorized' }] } });
  const { rates, warnings } = await tarifasLalamove({ cp: '06700', pesoKg: 10 });
  assert.deepEqual(rates, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Lalamove no cotizo 2 vehiculo\(s\): Unauthorized/);
});

test('tarifasLalamove: el 429 del limite por minuto sale como texto accionable', async () => {
  mockLalamove((u) => u.endsWith('/v3/cities') ? { status: 200, json: CITIES } : { status: 429, json: null });
  const { warnings } = await tarifasLalamove({ cp: '06700', pesoKg: 10 });
  assert.match(warnings[0], /limite de consultas por minuto, reintenta en un minuto/);
});

test('tarifasLalamove: sin llaves no consulta nada', async () => {
  delete process.env.LALAMOVE_API_KEY;
  mockLalamove(() => { throw new Error('no debia llamar'); });
  assert.deepEqual(await tarifasLalamove({ cp: '06700', pesoKg: 10 }), { rates: [], warnings: [] });
  assert.equal(llamadas.length, 0);
});

test('tarifasLalamove: CP sin coordenadas -> advertencia, sin llamadas', async () => {
  mockLalamove(() => { throw new Error('no debia llamar'); });
  const r = await tarifasLalamove({ cp: '99999', pesoKg: 10 });
  assert.deepEqual(r.rates, []);
  assert.match(r.warnings[0], /no hay coordenadas para el CP 99999/);
  assert.equal(llamadas.length, 0);
});

test('tarifasLalamove: mas pesado que el vehiculo mayor -> advertencia', async () => {
  mockLalamove((u) => ({ status: 200, json: CITIES }));
  const r = await tarifasLalamove({ cp: '06700', pesoKg: 1500 });
  assert.deepEqual(r.rates, []);
  assert.match(r.warnings[0], /1500 kg excede/);
});

test('tarifasLalamove: catalogo caido -> advertencia, nunca lanza', async () => {
  mockLalamove(() => ({ status: 500, json: null }));
  const r = await tarifasLalamove({ cp: '06700', pesoKg: 10 });
  assert.deepEqual(r.rates, []);
  assert.match(r.warnings[0], /Lalamove no disponible/);
});
