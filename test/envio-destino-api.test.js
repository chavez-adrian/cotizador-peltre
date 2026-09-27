// #453: el destino que POST /api/cotizacion/envio manda a envia.com lleva el
// domicilio de entrega capturado (calle y numero, colonia, municipio, estado) en
// vez del destino fijo { city: 'Destino', state: 'DF' }: sin calle DHL responde
// "The first address line (street and number) is required" y Estafeta "Address
// street is required" (HITL de #447, CP 11700). Estafeta no hace envios
// internacionales. envia.com va SIEMPRE simulado: se captura el payload.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
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
delete process.env.DATABASE_URL;

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const configStore = await import('../lib/config-store.js');
const { app } = await import('../server.js');

const VENDEDOR = `Bearer ${jwt.sign({ id: 7, name: 'Memo', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' })}`;
const CONFIG_INICIAL = { tiposActivos: ['PL'], texturasActivas: [1] };
const ITEMS = [{ codigo: 'PV08', cantidad: 1 }];
const AVISO_ESTAFETA = 'Estafeta no hace env\u00edos internacionales';
const SUGERENCIA_CALLE = 'Sin calle y n\u00famero en el domicilio de entrega algunas paqueter\u00edas no cotizan: capt\u00faralos en el paso Env\u00edo y vuelve a cotizar';

const originalFetch = globalThis.fetch;
const envOriginal = { ...process.env };

// envia.com simulado: guarda cada payload por carrier y contesta una tarifa.
function mockEnvia({ rechazaSinCalle = [] } = {}) {
  const payloads = {};
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (!u.includes('api.envia.com/ship/rate')) throw new Error('Unmocked fetch: ' + u);
    const body = JSON.parse(opts.body);
    payloads[body.shipment.carrier] = body;
    if (rechazaSinCalle.includes(body.shipment.carrier) && !body.destination.street) {
      return { ok: false, status: 400, json: async () => ({ meta: 'error', error: { code: 1129, message: 'The first address line (street and number) is required.' } }) };
    }
    return { ok: true, status: 200, json: async () => ({ meta: 'rate', data: [{ carrier: body.shipment.carrier, service: 'ground', totalPrice: 150 }] }) };
  };
  return payloads;
}

function cotizar(cuerpo) {
  return supertest(app).post('/api/cotizacion/envio').set('Authorization', VENDEDOR)
    .send({ items: ITEMS, totalConIVA: 1160, ...cuerpo });
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

test('a CP 11700 con domicilio capturado, el destino a envia.com lleva calle, numero, colonia, municipio y estado reales', async () => {
  const payloads = mockEnvia();
  const res = await cotizar({
    cpDestino: '11700', paisDestino: 'MX',
    calle: 'Av. Paseo de la Reforma 2620', colonia: 'Lomas Altas',
    municipio: 'Miguel Hidalgo', estado: 'Ciudad de M\u00e9xico',
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const destino = payloads.dhl.destination;
  assert.equal(destino.street, 'Av. Paseo de la Reforma');
  assert.equal(destino.number, '2620');
  assert.equal(destino.district, 'Lomas Altas');
  assert.equal(destino.city, 'Miguel Hidalgo');
  assert.equal(destino.state, 'CMX');
  assert.equal(destino.country, 'MX');
  assert.equal(destino.postalCode, '11700');
  assert.deepStrictEqual(payloads.estafeta.destination, destino);
});

test('sin calle capturada no se inventa una: el destino sale sin street y municipio y estado salen del indice de CP', async () => {
  const payloads = mockEnvia();
  const res = await cotizar({ cpDestino: '11700', paisDestino: 'MX' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const destino = payloads.fedex.destination;
  assert.equal(destino.street, undefined);
  assert.equal(destino.number, undefined);
  assert.equal(destino.city, 'Miguel Hidalgo');
  assert.equal(destino.state, 'CMX');
  assert.equal(destino.postalCode, '11700');
  assert.deepStrictEqual([...Object.keys(payloads)].sort(), ['dhl', 'estafeta', 'fedex']);
  assert.ok(res.body.rates.some(r => r.carrier === 'fedex'));
});

test('a un ZIP de EE.UU. con calle, el estado sale del autollenado del ZIP (TX para 78701)', async () => {
  const payloads = mockEnvia();
  const res = await cotizar({ cpDestino: '78701', paisDestino: 'US', calle: '100 Congress Ave', estado: 'Texas' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const destino = payloads.dhl.destination;
  assert.equal(destino.street, '100 Congress Ave');
  assert.equal(destino.city, 'Austin');
  assert.equal(destino.state, 'TX');
  assert.equal(destino.country, 'US');
});

test('Estafeta no hace envios internacionales: con pais US no se consulta y sale un aviso claro', async () => {
  const payloads = mockEnvia();
  const res = await cotizar({ cpDestino: '78701', paisDestino: 'US', calle: '100 Congress Ave' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepStrictEqual([...Object.keys(payloads)].sort(), ['dhl', 'fedex']);
  assert.ok(res.body.warnings.includes(AVISO_ESTAFETA), JSON.stringify(res.body.warnings));
  assert.ok(!res.body.warnings.some(w => /envia\.com no cotizo Estafeta/.test(w)), JSON.stringify(res.body.warnings));
});

test('con solo Estafeta activa y pais US no se consulta envia.com: el aviso es el de Estafeta, no el de "no hay paqueterias activas"', async () => {
  fijarDatos(CONFIG_PATH, { ...CONFIG_INICIAL, lineasTransporte: [
    { nombre: 'Estafeta', fuente: 'envia', codigo: 'estafeta', shipVia: 5, activa: true },
  ] });
  configStore._reiniciar();
  const payloads = mockEnvia();
  const res = await cotizar({ cpDestino: '78701', paisDestino: 'US', calle: '100 Congress Ave' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepStrictEqual(Object.keys(payloads), []);
  assert.deepStrictEqual(res.body.rates, []);
  assert.ok(res.body.warnings.includes(AVISO_ESTAFETA), JSON.stringify(res.body.warnings));
  assert.ok(!res.body.warnings.some(w => /No hay paqueterias de envia.com activas/.test(w)), JSON.stringify(res.body.warnings));
});

test('sin calle, el aviso de la paqueteria que la exige sale como hoy y ademas sugiere capturarla, sin bloquear a FedEx', async () => {
  const payloads = mockEnvia({ rechazaSinCalle: ['dhl', 'estafeta'] });
  const res = await cotizar({ cpDestino: '11700', paisDestino: 'MX' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepStrictEqual([...Object.keys(payloads)].sort(), ['dhl', 'estafeta', 'fedex']);
  assert.deepStrictEqual(res.body.rates.map(r => r.carrier), ['fedex']);
  assert.ok(res.body.warnings.some(w => /DHL/.test(w) && /first address line/.test(w)), JSON.stringify(res.body.warnings));
  assert.ok(res.body.warnings.includes(SUGERENCIA_CALLE), JSON.stringify(res.body.warnings));
});

test('sin calle y sin avisos de las paqueterias no se agrega la sugerencia', async () => {
  mockEnvia();
  const res = await cotizar({ cpDestino: '11700', paisDestino: 'MX' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepStrictEqual(res.body.warnings, []);
});
