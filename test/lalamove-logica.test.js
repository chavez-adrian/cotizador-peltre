import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  firmaLalamove, encabezadosLalamove, serviciosDeMexico, vehiculosQueCaben, FACTOR_LLENADO,
  cuerpoCotizacion, tarifaDesdeCotizacion, esFueraDeArea, ORIGEN_FABRICA,
} from '../lib/lalamove-logica.js';

// Forma real de GET /v3/cities (Market: MX), medida en sandbox 2026-09-23, recortada.
const CITIES = {
  data: [{
    locode: 'MX MEX', name: 'Mexico City',
    services: [
      { key: 'CAR', load: { value: '300', unit: 'kg' }, dimensions: { length: { value: '1.3', unit: 'm' }, width: { value: '1.6', unit: 'm' }, height: { value: '0.8', unit: 'm' } } },
      { key: 'MOTORCYCLE', load: { value: '20', unit: 'kg' }, dimensions: { length: { value: '0.4', unit: 'm' }, width: { value: '0.4', unit: 'm' }, height: { value: '0.3', unit: 'm' } } },
      { key: 'VAN', load: { value: '1000', unit: 'kg' }, dimensions: { length: { value: '2', unit: 'm' }, width: { value: '1.2', unit: 'm' }, height: { value: '1.2', unit: 'm' } } },
      { key: 'TRUCK330', load: { value: '1000', unit: 'kg' }, dimensions: { length: { value: '2', unit: 'm' }, width: { value: '2', unit: 'm' }, height: { value: '1.7', unit: 'm' } } },
      { key: 'UV_FIORINO', load: { value: '500', unit: 'kg' }, dimensions: { length: { value: '1.8', unit: 'm' }, width: { value: '1.3', unit: 'm' }, height: { value: '1.1', unit: 'm' } } },
    ],
  }],
};
const caja = (cantidad, l, w, h) => ({ cantidad, medidasCm: [l, w, h] });

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

test('serviciosDeMexico: medidas en cm ordenadas de mayor a menor; sin medidas -> null', () => {
  const s = serviciosDeMexico(CITIES);
  assert.deepEqual(s.find(v => v.key === 'CAR').medidasCm, [160, 130, 80]);
  const sinMedidas = serviciosDeMexico({ data: [{ locode: 'MX MEX', services: [{ key: 'X', load: { value: '5' } }] }] });
  assert.equal(sinMedidas[0].medidasCm, null);
});

test('vehiculosQueCaben: por peso, solo los que cargan al menos el peso del carrito', () => {
  const s = serviciosDeMexico(CITIES);
  assert.deepEqual(vehiculosQueCaben(s, { pesoKg: 350, cajas: [] }).map(v => v.key), ['UV_FIORINO', 'VAN', 'TRUCK330']);
  assert.deepEqual(vehiculosQueCaben(s, { pesoKg: 300, cajas: [] }).map(v => v.key), ['CAR', 'UV_FIORINO', 'VAN', 'TRUCK330']);
  assert.deepEqual(vehiculosQueCaben(s, { pesoKg: 1200, cajas: [] }), []);
});

test('vehiculosQueCaben: sin peso ni cajas ofrece todos', () => {
  const s = serviciosDeMexico(CITIES);
  assert.equal(vehiculosQueCaben(s, { pesoKg: 0, cajas: [] }).length, s.length);
});

// El volumen de las CAJAS solo puede ocupar FACTOR_LLENADO del espacio de carga:
// mejor sobrecotizar que ofrecer un vehiculo donde la carga no cabe.
test('vehiculosQueCaben: por volumen, con margen de llenado', () => {
  const s = serviciosDeMexico(CITIES);
  assert.equal(FACTOR_LLENADO, 0.6);
  // Moto: 40x40x30 = 48 L -> tope 28.8 L. 8 cajas de portavasos = 15.8 L caben.
  assert.ok(vehiculosQueCaben(s, { pesoKg: 11, cajas: [caja(8, 20.7, 15.4, 6.2)] }).some(v => v.key === 'MOTORCYCLE'));
  // 15 de esas cajas = 29.6 L: caben en 48 L pero pasan del margen -> sin moto.
  assert.ok(!vehiculosQueCaben(s, { pesoKg: 11, cajas: [caja(15, 20.7, 15.4, 6.2)] }).some(v => v.key === 'MOTORCYCLE'));
  // CAR: 160x130x80 = 1.664 m3 -> tope 0.998 m3. 60 cajas de 0.018 m3 = 1.08 m3 -> fuera.
  const kilos = vehiculosQueCaben(s, { pesoKg: 100, cajas: [caja(60, 30, 30, 20)] }).map(v => v.key);
  assert.deepEqual(kilos, ['UV_FIORINO', 'VAN', 'TRUCK330']);
});

test('vehiculosQueCaben: la caja mas grande tiene que caber lado contra lado', () => {
  const s = serviciosDeMexico(CITIES);
  // Una sola caja de 66x20x20 cabe por volumen en la moto pero no por largo (66 > 40).
  assert.ok(!vehiculosQueCaben(s, { pesoKg: 5, cajas: [caja(1, 20, 66, 20)] }).some(v => v.key === 'MOTORCYCLE'));
  assert.ok(vehiculosQueCaben(s, { pesoKg: 5, cajas: [caja(1, 20, 66, 20)] }).some(v => v.key === 'CAR'));
});

test('vehiculosQueCaben: vehiculo sin medidas publicadas se juzga solo por peso', () => {
  const s = [{ key: 'X', cargaKg: 500, medidasCm: null }];
  assert.deepEqual(vehiculosQueCaben(s, { pesoKg: 100, cajas: [caja(500, 50, 50, 50)] }).map(v => v.key), ['X']);
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
  assert.equal(t('TRUCK3_5T'), 'Camion 3.5 t');
  assert.equal(t('TRUCK5T'), 'Camion 5 t');
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
