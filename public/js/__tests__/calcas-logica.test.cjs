'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let PIEZAS_MINIMAS_CALCA, TAMANOS_CALCA, TINTAS_CALCA, MOTIVOS_CALCA_INVALIDA;
let esCodigoCalca, buscarCalcaEnCatalogo, precioCalca, productoCalca;
let piezasDeProducto, hayCalcaEnCarrito, puedeAgregarCalca;
let motivoCalcaInvalida, carritoInvalidoPorCalca, bloqueaGeneracionPorCalcaSinVolumen;
let avisoCalcaInvalida, avisoNoPuedeAgregarCalca, relacionCalcaProducto, estadoMarcaDecorado;

before(async () => {
  ({
    PIEZAS_MINIMAS_CALCA, TAMANOS_CALCA, TINTAS_CALCA, MOTIVOS_CALCA_INVALIDA,
    esCodigoCalca, buscarCalcaEnCatalogo, precioCalca, productoCalca,
    piezasDeProducto, hayCalcaEnCarrito, puedeAgregarCalca,
    motivoCalcaInvalida, carritoInvalidoPorCalca, bloqueaGeneracionPorCalcaSinVolumen,
    avisoCalcaInvalida, avisoNoPuedeAgregarCalca, relacionCalcaProducto, estadoMarcaDecorado,
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

// === Decision 1: umbral duro de 100 piezas de PRODUCTO para agregar calca ===
test('#91-16: el umbral son 100 piezas de producto', () => {
  assert.strictEqual(PIEZAS_MINIMAS_CALCA, 100);
});

test('#91-17: puedeAgregarCalca exige llegar al umbral', () => {
  assert.strictEqual(puedeAgregarCalca(99), false);
  assert.strictEqual(puedeAgregarCalca(100), true, 'el umbral es inclusivo: con 100 ya hay tier M100');
  assert.strictEqual(puedeAgregarCalca(600), true);
  assert.strictEqual(puedeAgregarCalca(0), false);
});

// === Decision 2: el umbral es un INVARIANTE, no una validacion de captura ===
// El agujero por la puerta de atras: agregar 150 tazas -> agregar calcas ->
// bajar a 60 tazas. Nada se revierte solo; se marca el estado y se bloquea.
test('#91-18: carrito con calca que cae bajo el umbral -> invalido', () => {
  assert.strictEqual(carritoInvalidoPorCalca({ piezasProducto: 60, hayCalca: true }), true);
});

test('#91-19: sin calca en el carrito, caer bajo 100 piezas es legitimo', () => {
  assert.strictEqual(carritoInvalidoPorCalca({ piezasProducto: 60, hayCalca: false }), false);
});

test('#91-20: con calca y volumen suficiente el carrito es valido', () => {
  assert.strictEqual(carritoInvalidoPorCalca({ piezasProducto: 600, hayCalca: true }), false);
  assert.strictEqual(carritoInvalidoPorCalca({ piezasProducto: 100, hayCalca: true }), false);
});

test('#91-21: bloqueaGeneracionPorCalcaSinVolumen es la compuerta (espejo de #89)', () => {
  assert.strictEqual(bloqueaGeneracionPorCalcaSinVolumen(true), true);
  assert.strictEqual(bloqueaGeneracionPorCalcaSinVolumen(false), false);
  assert.strictEqual(bloqueaGeneracionPorCalcaSinVolumen(undefined), false);
});

test('#91-22: los avisos dicen el umbral Y lo que lleva el vendedor', () => {
  const aviso = avisoCalcaInvalida(MOTIVOS_CALCA_INVALIDA.SIN_VOLUMEN, 60);
  assert.ok(aviso.includes('100'), 'nombra el umbral');
  assert.ok(aviso.includes('60'), 'nombra lo que lleva ahora');
  const previo = avisoNoPuedeAgregarCalca(60);
  assert.ok(previo.includes('100'));
  assert.ok(previo.includes('60'));
});

// === El invariante tiene DOS motivos, no uno. El umbral de 100 piezas evita el
// tier Menudeo, pero no es lo unico que puede dejar una calca sin precio: una
// calca sin fila en un tier PAGADO (a CAL1025S le faltaba la M350 en Operam, ver
// la investigacion del issue) caeria en el `?? 0` de getPrice y viajaria a $0 al
// documento y al quote. Volumen suficiente NO implica precio. ===
test('#91-27: calca sin precio en un tier pagado invalida el carrito aunque sobre volumen', () => {
  const invalido = carritoInvalidoPorCalca({ piezasProducto: 150, hayCalca: true, calcaSinPrecio: true });
  assert.strictEqual(invalido, true, '150 piezas alcanzan el umbral, pero la calca no tiene precio ahi');
});

test('#91-28: el motivo distingue falta de volumen de falta de precio', () => {
  assert.strictEqual(
    motivoCalcaInvalida({ piezasProducto: 60, hayCalca: true, calcaSinPrecio: true }),
    MOTIVOS_CALCA_INVALIDA.SIN_VOLUMEN,
    'con las dos causas manda el volumen: es la que el vendedor puede resolver subiendo producto'
  );
  assert.strictEqual(
    motivoCalcaInvalida({ piezasProducto: 150, hayCalca: true, calcaSinPrecio: true }),
    MOTIVOS_CALCA_INVALIDA.SIN_PRECIO
  );
  assert.strictEqual(motivoCalcaInvalida({ piezasProducto: 150, hayCalca: true, calcaSinPrecio: false }), null);
  assert.strictEqual(motivoCalcaInvalida({ piezasProducto: 10, hayCalca: false, calcaSinPrecio: true }), null,
    'sin calca en el carrito no hay nada que invalidar');
});

test('#91-29: el aviso de calca sin precio no habla del umbral (no es el problema)', () => {
  const aviso = avisoCalcaInvalida(MOTIVOS_CALCA_INVALIDA.SIN_PRECIO, 150);
  assert.ok(/precio/i.test(aviso), aviso);
  assert.ok(!aviso.includes('100 piezas'), 'confundiria: con 150 piezas el umbral ya se cumplio');
});

test('#91-30: los motivos se comparan por igualdad contra constantes explicitas', () => {
  assert.deepStrictEqual(Object.values(MOTIVOS_CALCA_INVALIDA).sort(), ['sin-precio', 'sin-volumen']);
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
