import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diffSkus, productosSinCaja, formatearReporte } from '../scripts/sync-catalogo.mjs';
import { ESTADOS_PARIDAD } from '../lib/catalogo-operam.js';

// diffSkus compara los SKUs del catalogo generado contra los del data/precios.json
// vigente: lo que Operam ya tiene y el vigente no (nuevos) y lo que el vigente tiene
// y Operam ya no puede preciar (quitados). Comparacion por codigo de sku, no por
// objeto completo (el nombre puede cambiar en Operam sin que el sku sea "distinto").
test('diffSkus: sin diferencias entre generado y referencia, ambas listas vacias', () => {
  const generados = [{ sku: 'PV08B1001111' }, { sku: 'PV08N1001111' }];
  const referencia = [{ sku: 'PV08B1001111' }, { sku: 'PV08N1001111' }];
  assert.deepEqual(diffSkus(generados, referencia), { nuevos: [], quitados: [] });
});

test('diffSkus: un sku solo en el generado es nuevo, uno solo en la referencia es quitado', () => {
  const generados = [{ sku: 'PV08B1001111' }, { sku: 'PV08N1001111' }];
  const referencia = [{ sku: 'PV08B1001111' }, { sku: 'PV08R2001111' }];
  assert.deepEqual(diffSkus(generados, referencia), {
    nuevos: ['PV08N1001111'],
    quitados: ['PV08R2001111'],
  });
});

test('diffSkus: el orden de salida es alfabetico, no el de llegada', () => {
  const generados = [{ sku: 'PV08N1001111' }, { sku: 'PV08B1001111' }];
  const referencia = [];
  assert.deepEqual(diffSkus(generados, referencia).nuevos, ['PV08B1001111', 'PV08N1001111']);
});

// productosSinCaja avisa de un pendiente que calcular-envio.js necesita para no fallar
// en runtime: un producto con ficha en el complementario pero cuyo modelo no tiene
// entrada en boxMap (data/cajas.json no sabe en que caja va).
test('productosSinCaja: vacio cuando todos los modelos tienen caja', () => {
  const catalogo = {
    products: [{ key: 'PV08A', model: 'PV08' }],
    boxMap: [{ modelo: 'PV08', caja: 'EMPVA056P' }],
  };
  assert.deepEqual(productosSinCaja(catalogo), []);
});

test('productosSinCaja: reporta la clave y el modelo sin entrada en boxMap', () => {
  const catalogo = {
    products: [
      { key: 'PV08A', model: 'PV08' },
      { key: 'XY99A', model: 'XY99' },
    ],
    boxMap: [{ modelo: 'PV08', caja: 'EMPVA056P' }],
  };
  assert.deepEqual(productosSinCaja(catalogo), [{ key: 'XY99A', model: 'XY99' }]);
});

// formatearReporte es la unica funcion de presentacion: arma el texto imprimible del
// dry-run a partir de la salida pura de construirCatalogo (#128) mas el diff de SKUs y
// los pendientes de caja. No hace IO -- el script solo hace console.log(el resultado).
function paridadBase(overrides = {}) {
  return {
    resumen: { MATCH: 0, MISMATCH: 0, SIN_SKU: 0, NUEVO: 0, huerfanas: 0, divergentes: 0, ilegibles: 0 },
    productos: [],
    calcas: [],
    huerfanas: [],
    divergentes: [],
    ilegibles: [],
    sinFicha: [],
    ...overrides,
  };
}

test('formatearReporte: resume conteos de productos, calcas, huerfanas, divergentes e ilegibles', () => {
  const paridad = paridadBase({
    resumen: { MATCH: 51, MISMATCH: 4, SIN_SKU: 28, NUEVO: 6, huerfanas: 123, divergentes: 2, ilegibles: 1 },
    calcas: [
      { code: 'CAL1025', estado: ESTADOS_PARIDAD.MATCH, diferencias: [] },
      { code: 'CAL2050', estado: ESTADOS_PARIDAD.NUEVO, diferencias: [] },
    ],
  });
  const texto = formatearReporte({ catalogo: { products: [], boxMap: [] }, paridad, skusDiff: { nuevos: [], quitados: [] }, sinCaja: [] });
  assert.match(texto, /MATCH: 51.*MISMATCH: 4.*SIN_SKU: 28.*NUEVO: 6/s);
  assert.match(texto, /MATCH: 1.*MISMATCH: 0.*SIN_SKU: 0.*NUEVO: 1/, 'calcas se cuentan aparte de productos');
  assert.match(texto, /Huerfanas: 123/);
  assert.match(texto, /Divergentes: 2/);
  assert.match(texto, /Ilegibles: 1/);
});

test('formatearReporte: detalla MISMATCH con la lista y el precio de referencia vs Operam', () => {
  const paridad = paridadBase({
    resumen: { MATCH: 0, MISMATCH: 1, SIN_SKU: 0, NUEVO: 0, huerfanas: 0, divergentes: 0, ilegibles: 0 },
    productos: [{
      key: 'PV08A', name: 'PV08 Portavasos', estado: ESTADOS_PARIDAD.MISMATCH,
      diferencias: [{ tier: 'Menudeo', referencia: 64.66, operam: 60.34 }],
    }],
  });
  const texto = formatearReporte({ catalogo: { products: [], boxMap: [] }, paridad, skusDiff: { nuevos: [], quitados: [] }, sinCaja: [] });
  assert.match(texto, /MISMATCH \(1\)/);
  assert.match(texto, /PV08A/);
  assert.match(texto, /Menudeo/);
  assert.match(texto, /64\.66/);
  assert.match(texto, /60\.34/);
});

test('formatearReporte: lista claves SIN_SKU y NUEVO', () => {
  const paridad = paridadBase({
    resumen: { MATCH: 0, MISMATCH: 0, SIN_SKU: 1, NUEVO: 1, huerfanas: 0, divergentes: 0, ilegibles: 0 },
    productos: [
      { key: 'VT05A', name: 'VT05', estado: ESTADOS_PARIDAD.SIN_SKU, diferencias: [] },
      { key: 'PV08AP4', name: 'PV08 paquete', estado: ESTADOS_PARIDAD.NUEVO, diferencias: [] },
    ],
  });
  const texto = formatearReporte({ catalogo: { products: [], boxMap: [] }, paridad, skusDiff: { nuevos: [], quitados: [] }, sinCaja: [] });
  assert.match(texto, /SIN_SKU \(1\).*VT05A/s);
  assert.match(texto, /NUEVO \(1\).*PV08AP4/s);
});

test('formatearReporte: avisa sinFicha y sin-caja como pendientes, no como fallo silencioso', () => {
  const paridad = paridadBase({ sinFicha: [{ key: 'TA14A', articulos: 3 }] });
  const texto = formatearReporte({
    catalogo: { products: [], boxMap: [] },
    paridad,
    skusDiff: { nuevos: [], quitados: [] },
    sinCaja: [{ key: 'XY99A', model: 'XY99' }],
  });
  assert.match(texto, /PENDIENTE.*sin ficha/i);
  assert.match(texto, /TA14A/);
  assert.match(texto, /3 articulo/);
  assert.match(texto, /PENDIENTE.*sin caja/i);
  assert.match(texto, /XY99A/);
  assert.match(texto, /modelo XY99/);
});

// Contar "Huerfanas: 123" sin listar cuales no es accionable -- un humano no puede
// limpiar el ERP con un numero. Mismo nivel de detalle que sinFicha/sinCaja.
test('formatearReporte: lista huerfanas, divergentes e ilegibles, no solo el conteo', () => {
  const paridad = paridadBase({
    resumen: { MATCH: 0, MISMATCH: 0, SIN_SKU: 0, NUEVO: 0, huerfanas: 1, divergentes: 1, ilegibles: 1 },
    huerfanas: [{ stock_id: 'PV08FANTASMA1', sales_type_id: '12', price: 55 }],
    divergentes: [{
      key: 'PV08A',
      precios: [
        { base: 60.34, skus: ['PV08B1001111', 'PV08N1001111'] },
        { base: 64.66, skus: ['PV08R2001111'] },
      ],
    }],
    ilegibles: [{ stock_id: 'PV08P1N1M0', nombre: 'Portavasos legacy con precio' }],
  });
  const texto = formatearReporte({ catalogo: { products: [], boxMap: [] }, paridad, skusDiff: { nuevos: [], quitados: [] }, sinCaja: [] });
  assert.match(texto, /HUERFANAS \(1\)/);
  assert.match(texto, /PV08FANTASMA1/);
  assert.match(texto, /DIVERGENTES \(1\)/);
  assert.match(texto, /PV08A/);
  assert.match(texto, /60\.34/);
  assert.match(texto, /64\.66/);
  assert.match(texto, /ILEGIBLES \(1\)/);
  assert.match(texto, /PV08P1N1M0/);
  assert.match(texto, /Portavasos legacy con precio/);
});

test('formatearReporte: reporta el diff de SKUs nuevos y quitados', () => {
  const texto = formatearReporte({
    catalogo: { products: [], boxMap: [] },
    paridad: paridadBase(),
    skusDiff: { nuevos: ['PV08B10011114'], quitados: ['TA14P1N1M0'] },
    sinCaja: [],
  });
  assert.match(texto, /DIFF DE SKUS.*nuevos: 1.*quitados: 1/s);
  assert.match(texto, /PV08B10011114/);
  assert.match(texto, /TA14P1N1M0/);
});

test('formatearReporte: sin MISMATCH/SIN_SKU/NUEVO/pendientes no imprime esas secciones', () => {
  const texto = formatearReporte({
    catalogo: { products: [], boxMap: [] },
    paridad: paridadBase(),
    skusDiff: { nuevos: [], quitados: [] },
    sinCaja: [],
  });
  assert.doesNotMatch(texto, /MISMATCH \(/);
  assert.doesNotMatch(texto, /SIN_SKU \(/);
  assert.doesNotMatch(texto, /NUEVO \(/);
  assert.doesNotMatch(texto, /PENDIENTE/);
  assert.doesNotMatch(texto, /HUERFANAS \(/);
  assert.doesNotMatch(texto, /DIVERGENTES \(/);
  assert.doesNotMatch(texto, /ILEGIBLES \(/);
});
