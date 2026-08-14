'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let PIEZAS_MINIMAS_CALCA, TAMANOS_CALCA, TINTAS_CALCA, MOTIVOS_CALCA_INVALIDA;
let esCodigoCalca, buscarCalcaEnCatalogo, precioCalca, productoCalca, tierIdParaCalca;
let piezasDeProducto, hayCalcaEnCarrito, cantidadFacturableCalca, avisoClampCalca;
let motivoCalcaInvalida, bloqueaGeneracionPorCalcaSinPrecio;
let avisoCalcaInvalida, relacionCalcaProducto, estadoMarcaDecorado;

before(async () => {
  ({
    PIEZAS_MINIMAS_CALCA, TAMANOS_CALCA, TINTAS_CALCA, MOTIVOS_CALCA_INVALIDA,
    esCodigoCalca, buscarCalcaEnCatalogo, precioCalca, productoCalca, tierIdParaCalca,
    piezasDeProducto, hayCalcaEnCarrito, cantidadFacturableCalca, avisoClampCalca,
    motivoCalcaInvalida, bloqueaGeneracionPorCalcaSinPrecio,
    avisoCalcaInvalida, relacionCalcaProducto, estadoMarcaDecorado,
  } = await import('../calcas-logica.js'));
});

// Fichas con la forma REAL de data/precios.json.calcas (verificada contra el
// catalogo generado desde Operam en #120/#131): Menudeo SIEMPRE null.
const CAL1050 = {
  code: 'CAL1050',
  name: 'Calca vitrificable mediana (50 cm2) 1 tinta',
  unit: 'ACT',
  prices: { Menudeo: null, M100: 29.66, M350: 18.59, M550: 18.59, M1500: 17.01, M6000: 14.68 },
};
const CAL1025S = {
  code: 'CAL1025S',
  name: 'Calca vitrificable chica (25 cm2) 1 tinta',
  unit: 'SER',
  prices: { Menudeo: null, M100: 26.9, M350: 20.11, M550: 17.96, M1500: 14.19, M6000: 13.31 },
};
const CAL2100 = {
  code: 'CAL2100',
  name: 'Calca vitrificable grande (100 cm2) 2 tintas',
  unit: 'ACT',
  prices: { Menudeo: null, M100: 39.24, M350: 29.32, M550: 29.32, M1500: 20.09, M6000: 17.65 },
};
const CATALOGO = [CAL1025S, CAL1050, CAL2100];

// === Familia de codigos: CAL[1-9]\d{3} con S opcional (#120). Las CAL00xx de
// marca/artistas NO son calcas genericas del selector. ===
test('#91-1: esCodigoCalca reconoce la familia generica, con y sin sufijo S', () => {
  assert.strictEqual(esCodigoCalca('CAL1050'), true);
  assert.strictEqual(esCodigoCalca('CAL1025S'), true);
  assert.strictEqual(esCodigoCalca('CAL8200'), true);
});

test('#91-2: esCodigoCalca rechaza lo que no es calca generica', () => {
  assert.strictEqual(esCodigoCalca('CAL0012'), false, 'las CAL00xx son de marca/artistas, no del selector');
  assert.strictEqual(esCodigoCalca('VA08B1A321124'), false);
  assert.strictEqual(esCodigoCalca('ENVIO'), false);
  assert.strictEqual(esCodigoCalca(''), false);
  assert.strictEqual(esCodigoCalca(null), false);
  assert.strictEqual(esCodigoCalca(undefined), false);
});

// === Selector tamano x tintas -> codigo (decision 7) ===
test('#91-3: el selector ofrece los 4 tamanos y las 8 tintas', () => {
  assert.deepStrictEqual(TAMANOS_CALCA.map(t => t.valor), ['025', '050', '100', '200']);
  assert.deepStrictEqual(TINTAS_CALCA, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('#91-4: buscarCalcaEnCatalogo resuelve tamano + tintas al codigo del catalogo', () => {
  assert.strictEqual(buscarCalcaEnCatalogo(CATALOGO, { tamano: '050', tintas: 1 })?.code, 'CAL1050');
  assert.strictEqual(buscarCalcaEnCatalogo(CATALOGO, { tamano: '100', tintas: 2 })?.code, 'CAL2100');
});

test('#91-5: buscarCalcaEnCatalogo encuentra la variante S (migracion de unidad ACT->SER, decision 6)', () => {
  const ficha = buscarCalcaEnCatalogo(CATALOGO, { tamano: '025', tintas: 1 });
  assert.strictEqual(ficha?.code, 'CAL1025S');
  assert.strictEqual(ficha?.unit, 'SER');
});

test('#91-6: combinacion ausente del catalogo -> null (nunca un codigo inventado)', () => {
  assert.strictEqual(buscarCalcaEnCatalogo(CATALOGO, { tamano: '200', tintas: 7 }), null);
  assert.strictEqual(buscarCalcaEnCatalogo([], { tamano: '050', tintas: 1 }), null);
  assert.strictEqual(buscarCalcaEnCatalogo(null, { tamano: '050', tintas: 1 }), null);
});

test('#91-7: las tintas llegan como string desde el <select> y resuelven igual', () => {
  assert.strictEqual(buscarCalcaEnCatalogo(CATALOGO, { tamano: '050', tintas: '1' })?.code, 'CAL1050');
});

// === Precio por tier: la calca NO tiene Menudeo (causa raiz del grilling) ===
// getPrice() de app.js cae a prices['Menudeo'] ?? 0 -> una calca en Menudeo se
// cotizaria en $0. Aqui la ausencia de precio es null EXPLICITO, nunca 0.
test('#91-8: precioCalca devuelve el precio del tier vigente', () => {
  assert.strictEqual(precioCalca(CAL1050, 'M100'), 29.66);
  assert.strictEqual(precioCalca(CAL1050, 'M6000'), 14.68);
});

test('#91-9: precioCalca en Menudeo -> null, NUNCA 0 (la calca no tiene menudeo)', () => {
  assert.strictEqual(precioCalca(CAL1050, 'Menudeo'), null);
  assert.strictEqual(precioCalca(CAL1025S, 'Menudeo'), null);
});

// === #152: con lista vigente Menudeo la calca se cobra a M100 (la primera
// lista donde existe); con lista pagada hereda la vigente tal cual. ===
test('#152-1: tierIdParaCalca cae a M100 cuando la lista vigente es Menudeo', () => {
  assert.strictEqual(tierIdParaCalca('Menudeo'), 'M100');
});

test('#152-2: tierIdParaCalca hereda cualquier lista pagada sin tocarla', () => {
  assert.strictEqual(tierIdParaCalca('M350'), 'M350');
  assert.strictEqual(tierIdParaCalca('M6000'), 'M6000');
});

test('#152-3: precioCalca resuelto vía tierIdParaCalca da el precio de M100 en Menudeo', () => {
  assert.strictEqual(precioCalca(CAL1050, tierIdParaCalca('Menudeo')), 29.66);
});

test('#91-10: precioCalca tolera ficha o tier ausente -> null', () => {
  assert.strictEqual(precioCalca(null, 'M100'), null);
  assert.strictEqual(precioCalca(CAL1050, 'TierQueNoExiste'), null);
  assert.strictEqual(precioCalca(CAL1050, undefined), null);
});

test('#91-11: productoCalca arma la entrada del carrito marcada como calca', () => {
  const p = productoCalca(CAL1050);
  assert.strictEqual(p.key, 'CAL1050');
  assert.strictEqual(p.name, 'Calca vitrificable mediana (50 cm2) 1 tinta');
  assert.strictEqual(p.esCalca, true);
  assert.deepStrictEqual(p.prices, CAL1050.prices);
  assert.strictEqual(p.weight_kg, undefined, 'la calca va aplicada sobre la pieza: no pesa aparte');
});

// === Volumen: las piezas de calca NO cuentan para el tier (decision 4 del
// 2026-07-30). El tier lo fijan las piezas de PRODUCTO; la calca lo hereda. ===
test('#91-12: piezasDeProducto suma solo el producto, no las calcas', () => {
  const items = [
    { codigo: 'VA08B1A321124', cantidad: 600 },
    { codigo: 'CAL1050', cantidad: 600 },
  ];
  assert.strictEqual(piezasDeProducto(items), 600);
});

test('#91-13: piezasDeProducto excluye tambien la partida de envio', () => {
  const items = [
    { codigo: 'VA08B1A321124', cantidad: 150 },
    { codigo: 'ENVIO', cantidad: 1 },
  ];
  assert.strictEqual(piezasDeProducto(items), 150);
});

test('#91-14: carrito de solo calcas -> 0 piezas de producto (decision 9: ese caso no se modela)', () => {
  assert.strictEqual(piezasDeProducto([{ codigo: 'CAL1050', cantidad: 200 }]), 0);
  assert.strictEqual(piezasDeProducto([]), 0);
  assert.strictEqual(piezasDeProducto(null), 0);
});

test('#91-15: hayCalcaEnCarrito distingue el carrito con calca del que no la tiene', () => {
  assert.strictEqual(hayCalcaEnCarrito([{ codigo: 'CAL1050', cantidad: 1 }]), true);
  assert.strictEqual(hayCalcaEnCarrito([{ codigo: 'VA08B1A321124', cantidad: 600 }]), false);
  assert.strictEqual(hayCalcaEnCarrito([]), false);
  assert.strictEqual(hayCalcaEnCarrito(null), false);
});

// === #152: piso de 100 piezas POR PARTIDA (diseno), supersede el umbral de
// #91 atado al volumen de producto. Es correccion de captura, no invariante
// sostenido: con 100 o mas manda lo capturado; abajo de 100 se sube sola. ===
test('#152-4: el piso son 100 piezas', () => {
  assert.strictEqual(PIEZAS_MINIMAS_CALCA, 100);
});

test('#152-5: cantidadFacturableCalca sube al piso lo capturado abajo de 100', () => {
  assert.strictEqual(cantidadFacturableCalca(60), 100);
  assert.strictEqual(cantidadFacturableCalca(1), 100);
});

test('#152-6: cantidadFacturableCalca con 100 o mas deja mandar lo capturado', () => {
  assert.strictEqual(cantidadFacturableCalca(100), 100);
  assert.strictEqual(cantidadFacturableCalca(600), 600);
});

test('#152-7: cantidadFacturableCalca de 0 sigue siendo 0 (sin partida, el piso no la crea)', () => {
  assert.strictEqual(cantidadFacturableCalca(0), 0);
  assert.strictEqual(cantidadFacturableCalca(undefined), 0);
  assert.strictEqual(cantidadFacturableCalca(null), 0);
});

test('#152-8: el piso es por partida -- dos disenos de 60 facturan 100 + 100, no se suman entre si', () => {
  assert.strictEqual(cantidadFacturableCalca(60) + cantidadFacturableCalca(60), 200);
});

test('#152-9: avisoClampCalca nombra el piso de 100', () => {
  const aviso = avisoClampCalca();
  assert.ok(aviso.includes('100'));
  assert.ok(/minimo/i.test(aviso));
});

// === El unico motivo que invalida el carrito con calca ahora es la falta de
// precio: el estado invalido "calca bajo 100 piezas de producto" desaparecio
// (#152). Una calca sin fila en un tier PAGADO (a CAL1025S le faltaba la M350
// en Operam, ver la investigacion de #91) caeria en el `?? 0` de getPrice y
// viajaria a $0 al documento y al quote. ===
test('#152-10: motivoCalcaInvalida solo mira si la calca tiene precio', () => {
  assert.strictEqual(motivoCalcaInvalida({ hayCalca: true, calcaSinPrecio: true }), MOTIVOS_CALCA_INVALIDA.SIN_PRECIO);
  assert.strictEqual(motivoCalcaInvalida({ hayCalca: true, calcaSinPrecio: false }), null);
  assert.strictEqual(motivoCalcaInvalida({ hayCalca: false, calcaSinPrecio: true }), null,
    'sin calca en el carrito no hay nada que invalidar');
});

test('#152-11: una cotizacion bajo 100 piezas de producto con calca ya no es invalida por eso', () => {
  assert.strictEqual(motivoCalcaInvalida({ hayCalca: true, calcaSinPrecio: false }), null,
    '80 piezas de producto con calca a precio genera documento y quote (#152)');
});

test('#152-12: bloqueaGeneracionPorCalcaSinPrecio es la compuerta (espejo de #89)', () => {
  assert.strictEqual(bloqueaGeneracionPorCalcaSinPrecio(true), true);
  assert.strictEqual(bloqueaGeneracionPorCalcaSinPrecio(false), false);
  assert.strictEqual(bloqueaGeneracionPorCalcaSinPrecio(undefined), false);
});

test('#152-13: los motivos se comparan por igualdad contra constantes explicitas', () => {
  assert.deepStrictEqual(Object.values(MOTIVOS_CALCA_INVALIDA), ['sin-precio']);
});

test('#152-14: avisoCalcaInvalida habla de precio, no del piso de piezas', () => {
  const aviso = avisoCalcaInvalida();
  assert.ok(/precio/i.test(aviso), aviso);
});

// === Decision 8: la linea muestra la relacion, sin juzgarla (el pedido mixto y
// la doble calca por pieza son ambos legitimos) ===
test('#91-23: relacionCalcaProducto describe cuantas piezas llevan calca', () => {
  assert.strictEqual(relacionCalcaProducto(200, 600), '200 de 600 piezas');
  assert.strictEqual(relacionCalcaProducto(600, 600), '600 de 600 piezas');
  assert.strictEqual(relacionCalcaProducto(1200, 600), '1200 de 600 piezas', 'doble calca por pieza: legitimo');
});

// === Decision 4 + ADR-0010: la calca enciende el decorado y lo FIJA ===
test('#91-24: con calca en el carrito la marca es true y no editable', () => {
  const e = estadoMarcaDecorado({ hayCalca: true, marcaActual: false });
  assert.strictEqual(e.valor, true);
  assert.strictEqual(e.editable, false);
  assert.ok(e.motivo.includes('calca'));
});

// === Decision 5: quitar la calca NO destruye nada -- la marca conserva su valor
// y vuelve a ser editable (los pasos del checklist son gestiones reales) ===
test('#91-25: sin calca, la marca conserva su valor y vuelve a ser editable', () => {
  const e = estadoMarcaDecorado({ hayCalca: false, marcaActual: true });
  assert.strictEqual(e.valor, true, 'quitar la calca no apaga la marca');
  assert.strictEqual(e.editable, true, 'apagarla es acto explicito del vendedor');
});

test('#91-26: sin calca y sin marca previa -> apagada y editable (decorado a mano, #90)', () => {
  const e = estadoMarcaDecorado({ hayCalca: false, marcaActual: false });
  assert.strictEqual(e.valor, false);
  assert.strictEqual(e.editable, true);
});
