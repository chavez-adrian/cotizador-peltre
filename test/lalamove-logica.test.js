import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  firmaLalamove, encabezadosLalamove, serviciosDeMexico, vehiculosQueAlcanzan,
  cuerpoCotizacion, tarifaDesdeCotizacion, esFueraDeArea, ORIGEN_FABRICA,
} from '../lib/lalamove-logica.js';

// Forma real de GET /v3/cities (Market: MX), medida en sandbox 2026-09-23, recortada.
const CITIES = {
  data: [{
    locode: 'MX MEX', name: 'Mexico City',
    services: [
      { key: 'CAR', load: { value: '300', unit: 'kg' } },
      { key: 'MOTORCYCLE', load: { value: '20', unit: 'kg' } },
      { key: 'VAN', load: { value: '1000', unit: 'kg' } },
      { key: 'TRUCK330', load: { value: '1000', unit: 'kg' } },
      { key: 'UV_FIORINO', load: { value: '500', unit: 'kg' } },
    ],
  }],
};

test('firmaLalamove: HMAC-SHA256 hex de ts\\r\\nMETODO\\r\\nPATH\\r\\n\\r\\nBODY', () => {
  const esperada = crypto.createHmac('sha256', 'sk_x')
    .update('1700000000000\r\nPOST\r\n/v3/quotations\r\n\r\n{"a":1}').digest('hex');
  assert.equal(firmaLalamove({ secret: 'sk_x', ts: '1700000000000', metodo: 'POST', path: '/v3/quotations', body: '{"a":1}' }), esperada);
});

test('firmaLalamove: un GET firma con cuerpo vacio', () => {
  const esperada = crypto.createHmac('sha256', 'sk_x')
    .update('1\r\nGET\r\n/v3/cities\r\n\r\n').digest('hex');
  assert.equal(firmaLalamove({ secret: 'sk_x', ts: '1', metodo: 'GET', path: '/v3/cities' }), esperada);
});

test('encabezadosLalamove: Authorization hmac key:ts:firma, Market MX y Request-ID', () => {
  const h = encabezadosLalamove({ key: 'pk_x', secret: 'sk_x', ts: '5', metodo: 'GET', path: '/v3/cities', requestId: 'r-1' });
  const firma = firmaLalamove({ secret: 'sk_x', ts: '5', metodo: 'GET', path: '/v3/cities' });
  assert.equal(h.Authorization, `hmac pk_x:5:${firma}`);
  assert.equal(h.Market, 'MX');
  assert.equal(h['Request-ID'], 'r-1');
  assert.equal(h['Content-Type'], 'application/json');
});

test('serviciosDeMexico: vehiculos con su carga numerica, del mas chico al mas grande', () => {
  assert.deepEqual(serviciosDeMexico(CITIES).map(s => [s.key, s.cargaKg]), [
    ['MOTORCYCLE', 20], ['CAR', 300], ['UV_FIORINO', 500], ['VAN', 1000], ['TRUCK330', 1000],
  ]);
});

test('serviciosDeMexico: respuesta sin ciudades -> lista vacia', () => {
  assert.deepEqual(serviciosDeMexico({}), []);
  assert.deepEqual(serviciosDeMexico(null), []);
});

test('vehiculosQueAlcanzan: solo los que cargan al menos el peso del carrito', () => {
  const s = serviciosDeMexico(CITIES);
  assert.deepEqual(vehiculosQueAlcanzan(s, 350).map(v => v.key), ['UV_FIORINO', 'VAN', 'TRUCK330']);
  assert.deepEqual(vehiculosQueAlcanzan(s, 300).map(v => v.key), ['CAR', 'UV_FIORINO', 'VAN', 'TRUCK330']);
});

test('vehiculosQueAlcanzan: sin peso conocido ofrece todos', () => {
  const s = serviciosDeMexico(CITIES);
  assert.equal(vehiculosQueAlcanzan(s, 0).length, s.length);
});

test('vehiculosQueAlcanzan: mas pesado que el vehiculo mayor -> ninguno', () => {
  assert.deepEqual(vehiculosQueAlcanzan(serviciosDeMexico(CITIES), 1200), []);
});

test('cuerpoCotizacion: origen fabrica, destino por coordenadas del CP, coordenadas como texto', () => {
  const body = cuerpoCotizacion({ serviceType: 'VAN', destino: { lat: 19.418, lng: -99.163, direccion: 'CP 06700, Cuauhtemoc' } });
  assert.deepEqual(body, {
    data: {
      serviceType: 'VAN',
      language: 'es_MX',
      stops: [
        { coordinates: { lat: String(ORIGEN_FABRICA.lat), lng: String(ORIGEN_FABRICA.lng) }, address: ORIGEN_FABRICA.direccion },
        { coordinates: { lat: '19.418', lng: '-99.163' }, address: 'CP 06700, Cuauhtemoc' },
      ],
    },
  });
});

test('tarifaDesdeCotizacion: tarjeta con la forma de envia.com y el vehiculo en espanol', () => {
  const resp = { data: { serviceType: 'VAN', priceBreakdown: { total: '629.76', currency: 'MXN' }, distance: { value: '33400', unit: 'm' } } };
  assert.deepEqual(tarifaDesdeCotizacion({ key: 'VAN', cargaKg: 1000 }, resp), {
    carrier: 'lalamove',
    service: 'Van',
    serviceDescription: 'Lalamove Van (hasta 1000 kg)',
    totalPrice: 629.76,
    currency: 'MXN',
    distanciaKm: 33.4,
  });
});

test('tarifaDesdeCotizacion: nombres de los vehiculos de MX y fallback a la clave', () => {
  const t = (key) => tarifaDesdeCotizacion({ key, cargaKg: 1 }, { data: { priceBreakdown: { total: '1' } } }).service;
  assert.equal(t('CAR'), 'SUV');
  assert.equal(t('MPV'), 'Auto');
  assert.equal(t('UV_FIORINO'), 'Camioneta');
  assert.equal(t('PICKUP_MX'), 'Pick up');
  assert.equal(t('TRUCK330'), 'Camion');
  assert.equal(t('NUEVO_X'), 'NUEVO_X');
});

test('tarifaDesdeCotizacion: sin total numerico -> null (nunca una tarifa de $0)', () => {
  assert.equal(tarifaDesdeCotizacion({ key: 'VAN', cargaKg: 1000 }, { data: { priceBreakdown: {} } }), null);
  assert.equal(tarifaDesdeCotizacion({ key: 'VAN', cargaKg: 1000 }, {}), null);
});

test('esFueraDeArea: reconoce ERR_OUT_OF_SERVICE_AREA', () => {
  assert.equal(esFueraDeArea({ errors: [{ id: 'ERR_OUT_OF_SERVICE_AREA' }] }), true);
  assert.equal(esFueraDeArea({ errors: [{ id: 'ERR_INVALID_FIELD' }] }), false);
  assert.equal(esFueraDeArea(null), false);
});
