'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let VERSION_BORRADOR, serializarBorrador, deserializarBorrador;
let RESTAURACION, decidirRestauracion;
let reResolverCarrito, MOTIVOS_LINEA_INVALIDA;
let llaveBorrador, EVENTOS_BORRADOR, borradorMuerePorEvento;
let bloqueaGeneracionPorPartidaSinCatalogo, avisoPartidaSinCatalogo;
let resolverProductoDelCatalogo;

before(async () => {
  ({
    VERSION_BORRADOR, serializarBorrador, deserializarBorrador,
    RESTAURACION, decidirRestauracion,
    reResolverCarrito, MOTIVOS_LINEA_INVALIDA,
    llaveBorrador, EVENTOS_BORRADOR, borradorMuerePorEvento,
    bloqueaGeneracionPorPartidaSinCatalogo, avisoPartidaSinCatalogo,
    resolverProductoDelCatalogo,
  } = await import('../borrador-logica.js'));
});

// Catalogo con la forma real de state.precios (/api/precios): products con los
// precios por lista, skus completos que apuntan a un priceKey, y las calcas en
// su propio catalogo (#91/#131).
const CATALOGO = {
  products: [
    { key: 'CO16', name: 'CO16 Cacerola 16 cm', weight_kg: 0.4, prices: { Menudeo: 150, M100: 110, M350: 99 } },
    { key: 'TA20', name: 'TA20 Taza 20 oz', weight_kg: 0.3, prices: { Menudeo: 90, M100: 70, M350: 62 } },
  ],
  skus: [
    { sku: 'CO16BLR', nombre: 'Cacerola 16 cm blanco riso', priceKey: 'CO16', tipo: 'CO', tamano: '16' },
  ],
  calcas: [
    { code: 'CAL2050S', name: 'Calca vitrificable mediana (50 cm2) 2 tintas', prices: { Menudeo: null, M100: 35.5, M350: 26.1 } },
  ],
};

const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;
const AHORA = 1755400000000;

function borradorConEdad(ms) {
  return serializarBorrador({ carrito: [ENTRADA_CO16], ahora: AHORA - ms });
}

// Partida de calca con la forma real que deja agregarCalca(): producto marcado
// con esCalca y precios donde Menudeo SIEMPRE es null (#91).
const ENTRADA_CALCA = {
  codigo: 'CAL2050S',
  cantidad: 100,
  product: {
    key: 'CAL2050S',
    name: 'Calca vitrificable mediana (50 cm2) 2 tintas',
    model: 'CAL2050S',
    prices: { Menudeo: null, M100: 35.5, M350: 26.1 },
    esCalca: true,
  },
};

// Entrada del carrito con la forma REAL de state.cart en app.js: el `product`
// trae los precios del catalogo vigente al momento de capturar.
const ENTRADA_CO16 = {
  codigo: 'CO16BLR',
  cantidad: 24,
  product: {
    key: 'CO16BLR',
    name: 'CO16 Cacerola 16 cm blanco',
    model: 'CO16',
    weight_kg: 0.4,
    prices: { Menudeo: 120, M100: 96, M350: 88 },
  },
};

// === Serializacion: la intencion del vendedor viaja; los precios NO ===
test('#179-1: el borrador serializado no lleva precios ni el producto del catalogo', () => {
  const borrador = serializarBorrador({ carrito: [ENTRADA_CO16], ahora: 1755400000000 });

  assert.equal(borrador.v, VERSION_BORRADOR);
  assert.equal(borrador.actualizado, 1755400000000);
  assert.deepEqual(borrador.carrito, [{ codigo: 'CO16BLR', cantidad: 24 }]);
});

test('#179-2: lo negociado por linea -- descuento y descripcion editada -- viaja en el borrador', () => {
  const borrador = serializarBorrador({
    carrito: [{ ...ENTRADA_CO16, descuento: 12, descripcion: 'Cacerola 16 cm esmaltada a mano, blanco' }],
    ahora: 1755400000000,
  });

  assert.deepEqual(borrador.carrito, [{
    codigo: 'CO16BLR',
    cantidad: 24,
    descuento: 12,
    descripcion: 'Cacerola 16 cm esmaltada a mano, blanco',
  }]);
});

test('#179-3: la marca de decorado viaja SOLO en true (#91): sin marca no aparece la llave', () => {
  const conMarca = serializarBorrador({ carrito: [ENTRADA_CALCA], decorado: true, ahora: 1 });
  const sinMarca = serializarBorrador({ carrito: [ENTRADA_CO16], decorado: false, ahora: 1 });

  assert.equal(conMarca.decorado, true);
  assert.equal('decorado' in sinMarca, false);
});

// === Deserializacion: lo que no se entiende no se restaura ===
test('#179-4: lo guardado se vuelve a leer tal cual (ida y vuelta por el texto de localStorage)', () => {
  const guardado = JSON.stringify(serializarBorrador({
    carrito: [{ ...ENTRADA_CO16, descuento: 12 }, ENTRADA_CALCA],
    decorado: true,
    ahora: 1755400000000,
  }));

  const leido = deserializarBorrador(guardado);

  assert.equal(leido.actualizado, 1755400000000);
  assert.equal(leido.decorado, true);
  assert.deepEqual(leido.carrito, [
    { codigo: 'CO16BLR', cantidad: 24, descuento: 12 },
    { codigo: 'CAL2050S', cantidad: 100 },
  ]);
});

test('#179-5: una version desconocida se descarta en silencio, nunca se migra a ciegas', () => {
  const deOtraVersion = JSON.stringify({
    v: VERSION_BORRADOR + 1,
    actualizado: 1755400000000,
    carrito: [{ codigo: 'CO16BLR', cantidad: 24 }],
  });

  assert.equal(deserializarBorrador(deOtraVersion), null);
});

test('#179-6: basura, ausencia y borrador sin fecha de actividad no se restauran', () => {
  assert.equal(deserializarBorrador('{no es json'), null);
  assert.equal(deserializarBorrador(null), null);
  assert.equal(deserializarBorrador(''), null);
  assert.equal(deserializarBorrador(JSON.stringify({ v: VERSION_BORRADOR, carrito: [] })), null);
  assert.equal(deserializarBorrador(JSON.stringify({ v: VERSION_BORRADOR, actualizado: 1, carrito: 'CO16BLR' })), null);
});

test('#179-7: una linea sin codigo o sin cantidad util se cae; el resto del carrito sobrevive', () => {
  const conBasura = JSON.stringify({
    v: VERSION_BORRADOR,
    actualizado: 1755400000000,
    carrito: [
      { codigo: 'CO16BLR', cantidad: 24 },
      { codigo: '', cantidad: 5 },
      { codigo: 'CA20BLR', cantidad: 0 },
      { cantidad: 3 },
    ],
  });

  assert.deepEqual(deserializarBorrador(conBasura).carrito, [{ codigo: 'CO16BLR', cantidad: 24 }]);
});

// === Decision de restauracion: el reloj entra como argumento ===
test('#179-8: volver a los pocos minutos restaura en silencio (el caso frecuente: cambiar de app)', () => {
  assert.equal(decidirRestauracion(borradorConEdad(2 * MINUTO), AHORA), RESTAURACION.SILENCIOSA);
  assert.equal(decidirRestauracion(borradorConEdad(29 * MINUTO), AHORA), RESTAURACION.SILENCIOSA);
});

test('#179-9: pasada la media hora la restauracion deja de ser silenciosa y pasa a preguntar', () => {
  assert.equal(decidirRestauracion(borradorConEdad(31 * MINUTO), AHORA), RESTAURACION.PROMPT);
  assert.equal(decidirRestauracion(borradorConEdad(5 * HORA), AHORA), RESTAURACION.PROMPT);
  assert.equal(decidirRestauracion(borradorConEdad(29 * DIA), AHORA), RESTAURACION.PROMPT);
});

test('#179-10: un borrador mas viejo que la vigencia de cualquier cotizacion esta expirado', () => {
  assert.equal(decidirRestauracion(borradorConEdad(31 * DIA), AHORA), RESTAURACION.EXPIRADO);
});

test('#179-11: un reloj del dispositivo atrasado no expira el borrador de nadie', () => {
  assert.equal(decidirRestauracion(borradorConEdad(-2 * HORA), AHORA), RESTAURACION.SILENCIOSA);
});

test('#179-12: sin borrador no hay decision que tomar', () => {
  assert.equal(decidirRestauracion(null, AHORA), null);
  assert.equal(decidirRestauracion(deserializarBorrador('{no es json'), AHORA), null);
});

// === Re-resolucion contra el catalogo vigente ===
test('#179-13: la linea de SKU se rearma con el catalogo de hoy, con la cantidad y el descuento del vendedor', () => {
  // El borrador se escribio cuando CO16 costaba 120 de menudeo; el catalogo de
  // hoy dice 150. El precio que gana es el de hoy.
  const borrador = serializarBorrador({
    carrito: [{ ...ENTRADA_CO16, descuento: 12, descripcion: 'Cacerola blanca, filete rojo' }],
    ahora: AHORA,
  });

  const { lineas } = reResolverCarrito(borrador, CATALOGO);

  assert.equal(lineas.length, 1);
  assert.equal(lineas[0].codigo, 'CO16BLR');
  assert.equal(lineas[0].cantidad, 24);
  assert.equal(lineas[0].descuento, 12);
  assert.equal(lineas[0].descripcion, 'Cacerola blanca, filete rojo');
  assert.equal(lineas[0].motivo, null);
  assert.deepEqual(lineas[0].product.prices, { Menudeo: 150, M100: 110, M350: 99 });
  assert.equal(lineas[0].product.name, 'Cacerola 16 cm blanco riso');
  assert.equal(lineas[0].product.model, 'CO16');
  assert.equal(lineas[0].product.weight_kg, 0.4);
});

test('#179-14: una linea capturada por price key se resuelve contra el producto del catalogo', () => {
  const borrador = serializarBorrador({ carrito: [{ codigo: 'TA20', cantidad: 6 }], ahora: AHORA });

  const { lineas } = reResolverCarrito(borrador, CATALOGO);

  assert.equal(lineas[0].product.key, 'TA20');
  assert.deepEqual(lineas[0].product.prices, { Menudeo: 90, M100: 70, M350: 62 });
});

test('#179-15: la calca vuelve marcada como calca y con sus precios de hoy (Menudeo null, #91)', () => {
  const borrador = serializarBorrador({ carrito: [ENTRADA_CALCA], ahora: AHORA });

  const { lineas } = reResolverCarrito(borrador, CATALOGO);

  assert.equal(lineas[0].codigo, 'CAL2050S');
  assert.equal(lineas[0].cantidad, 100);
  assert.equal(lineas[0].product.esCalca, true);
  assert.equal(lineas[0].product.prices.Menudeo, null);
  assert.equal(lineas[0].product.prices.M100, 35.5);
});

test('#179-16: un SKU que ya no esta en el catalogo vuelve como linea invalida, sin precios inventados', () => {
  const borrador = serializarBorrador({
    carrito: [{ codigo: 'CO16BLR', cantidad: 24 }, { codigo: 'XX99MUERTO', cantidad: 5, descuento: 10 }],
    ahora: AHORA,
  });

  const { lineas, codigosSinCatalogo } = reResolverCarrito(borrador, CATALOGO);

  assert.deepEqual(codigosSinCatalogo, ['XX99MUERTO']);
  assert.equal(lineas.length, 2, 'la partida invalida se conserva para que el vendedor la vea y la corrija');
  const muerta = lineas[1];
  assert.equal(muerta.motivo, MOTIVOS_LINEA_INVALIDA.SIN_CATALOGO);
  assert.equal(muerta.cantidad, 5);
  assert.equal(muerta.descuento, 10);
  assert.deepEqual(muerta.product.prices, {});
  assert.equal(muerta.product.sinCatalogo, true);
});

test('#179-17: una calca que desaparecio del catalogo tampoco se restaura con datos fantasma', () => {
  const borrador = serializarBorrador({ carrito: [{ codigo: 'CAL8200S', cantidad: 100 }], ahora: AHORA });

  const { lineas, codigosSinCatalogo } = reResolverCarrito(borrador, CATALOGO);

  assert.deepEqual(codigosSinCatalogo, ['CAL8200S']);
  assert.equal(lineas[0].motivo, MOTIVOS_LINEA_INVALIDA.SIN_CATALOGO);
  assert.equal(lineas[0].product.esCalca, undefined);
});

test('#179-18: sin borrador y sin catalogo cargado no se restaura nada', () => {
  assert.deepEqual(reResolverCarrito(null, CATALOGO), { lineas: [], codigosSinCatalogo: [] });
  const borrador = serializarBorrador({ carrito: [ENTRADA_CO16], ahora: AHORA });
  assert.deepEqual(reResolverCarrito(borrador, null), { lineas: [], codigosSinCatalogo: [] });
});

// El mismo resolvedor lo consume Cargar del historial (app.js), no solo la
// restauracion del borrador: por eso su contrato se prueba de frente.
test('#179-18b: el resolvedor de catalogo atiende SKU completo, price key, calca y codigo muerto', () => {
  assert.equal(resolverProductoDelCatalogo('CO16BLR', CATALOGO).name, 'Cacerola 16 cm blanco riso');
  assert.equal(resolverProductoDelCatalogo('TA20', CATALOGO).key, 'TA20');
  assert.equal(resolverProductoDelCatalogo('CAL2050S', CATALOGO).esCalca, true);
  assert.equal(resolverProductoDelCatalogo('XX99MUERTO', CATALOGO), null);
  assert.equal(resolverProductoDelCatalogo('CO16BLR', null), null);
});

// === Llave por vendedor: dos vendedores en el mismo telefono no se pisan ===
test('#179-19: cada vendedor tiene su propia llave y ninguna es la de otro', () => {
  assert.notEqual(llaveBorrador(3), llaveBorrador(7));
  assert.equal(llaveBorrador(3), llaveBorrador('3'));
});

test('#179-20: sin vendedor logueado no hay llave que tocar', () => {
  assert.equal(llaveBorrador(null), null);
  assert.equal(llaveBorrador(undefined), null);
  assert.equal(llaveBorrador(''), null);
});

// === Ciclo de vida: que evento mata el borrador ===
test('#179-21: generar con exito y empezar de cero matan el borrador', () => {
  assert.equal(borradorMuerePorEvento(EVENTOS_BORRADOR.GENERACION_EXITOSA), true);
  assert.equal(borradorMuerePorEvento(EVENTOS_BORRADOR.NUEVA_COTIZACION), true);
  assert.equal(borradorMuerePorEvento(EVENTOS_BORRADOR.DESCARTADO), true);
  assert.equal(borradorMuerePorEvento(EVENTOS_BORRADOR.EXPIRADO), true);
});

test('#179-22: salir de la sesion NO mata el borrador (decision explicita del spec #178)', () => {
  assert.equal(borradorMuerePorEvento(EVENTOS_BORRADOR.LOGOUT), false);
  assert.equal(borradorMuerePorEvento(EVENTOS_BORRADOR.SESION_EXPIRADA), false);
  assert.equal(borradorMuerePorEvento('lo-que-sea-que-venga-despues'), false);
});

// === Partida fantasma: nunca se cotiza un SKU muerto ===
test('#179-23: una partida sin catalogo frena la generacion y el aviso dice cual es', () => {
  assert.equal(bloqueaGeneracionPorPartidaSinCatalogo(['XX99MUERTO']), true);
  assert.equal(bloqueaGeneracionPorPartidaSinCatalogo([]), false);
  assert.match(avisoPartidaSinCatalogo(['XX99MUERTO', 'CAL8200S']), /XX99MUERTO/);
  assert.match(avisoPartidaSinCatalogo(['XX99MUERTO', 'CAL8200S']), /CAL8200S/);
});
