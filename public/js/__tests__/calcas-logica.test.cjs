'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let PIEZAS_MINIMAS_CALCA, TAMANOS_CALCA, TINTAS_CALCA, MOTIVOS_CALCA_INVALIDA;
let esCodigoCalca, buscarCalcaEnCatalogo, precioCalca, productoCalca, tierIdParaCalca;
let precioEfectivoCalca, validarPreciosManualesCalca, aplicarPrecioManualEnPartidas;
let MOTIVOS_PRECIO_MANUAL, MENSAJE_SIN_PERMISO_PRECIO_CALCA;
let normalizarPuedePrecioCalca, puedePrecioCalca;
let piezasDeProducto, hayCalcaEnCarrito, cantidadFacturableCalca, avisoClampCalca;
let motivoCalcaInvalida, bloqueaGeneracionPorCalcaSinPrecio;
let siguienteNumeroDiseno, llaveDiseno, codigoDeLlave, llaveCarrito;
let avisoCalcaInvalida, relacionCalcaProducto, estadoMarcaDecorado;
let MAX_DISENOS_POR_LINEA_PRODUCTO, MOTIVOS_TOPE_DISENOS;
let lineasDeProducto, topeDisenos, puedeAgregarDiseno, avisoTopeDisenos;

before(async () => {
  ({
    PIEZAS_MINIMAS_CALCA, TAMANOS_CALCA, TINTAS_CALCA, MOTIVOS_CALCA_INVALIDA,
    esCodigoCalca, buscarCalcaEnCatalogo, precioCalca, productoCalca, tierIdParaCalca,
    precioEfectivoCalca, validarPreciosManualesCalca, aplicarPrecioManualEnPartidas,
    MOTIVOS_PRECIO_MANUAL, MENSAJE_SIN_PERMISO_PRECIO_CALCA,
    normalizarPuedePrecioCalca, puedePrecioCalca,
    piezasDeProducto, hayCalcaEnCarrito, cantidadFacturableCalca, avisoClampCalca,
    motivoCalcaInvalida, bloqueaGeneracionPorCalcaSinPrecio,
    siguienteNumeroDiseno, llaveDiseno, codigoDeLlave, llaveCarrito,
    avisoCalcaInvalida, relacionCalcaProducto, estadoMarcaDecorado,
    MAX_DISENOS_POR_LINEA_PRODUCTO, MOTIVOS_TOPE_DISENOS,
    lineasDeProducto, topeDisenos, puedeAgregarDiseno, avisoTopeDisenos,
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

// === #279 (spec #278): Precio manual de calca. El precio de lista es un
// estimado; el real lo dicta el proveedor por diseno y puede ser mayor o menor.
// El precio capturado reemplaza al de lista como base de la linea; vaciarlo
// regresa a la lista vigente. Los valores esperados son literales de las fichas
// de arriba (M100 = 29.66) y del precio inventado del proveedor. ===
test('#279-1: con precio manual MAYOR que la lista, la linea vale el manual', () => {
  assert.strictEqual(precioEfectivoCalca(CAL1050, 'M100', 45), 45);
});

test('#279-2: con precio manual MENOR que la lista, la linea vale el manual', () => {
  assert.strictEqual(precioEfectivoCalca(CAL1050, 'M100', 12.5), 12.5);
});

test('#279-3: sin precio manual la linea vale la lista vigente, con salto Menudeo->M100', () => {
  assert.strictEqual(precioEfectivoCalca(CAL1050, tierIdParaCalca('Menudeo')), 29.66);
  assert.strictEqual(precioEfectivoCalca(CAL1050, 'M6000', null), 14.68);
  assert.strictEqual(precioEfectivoCalca(CAL1050, 'M6000', ''), 14.68);
});

test('#279-4: sin manual y sin precio en el tier sigue siendo null, NUNCA 0 (#91)', () => {
  assert.strictEqual(precioEfectivoCalca(CAL1050, 'Menudeo'), null);
  assert.strictEqual(precioEfectivoCalca(CAL1050, 'Menudeo', 0), null, '0 no es captura: vuelve a lista, y en Menudeo no hay precio');
  assert.strictEqual(precioEfectivoCalca(null, 'M100', ''), null);
});

test('#279-5: un manual que no es numero mayor que cero no es captura: la linea vuelve a lista', () => {
  assert.strictEqual(precioEfectivoCalca(CAL1050, 'M100', 0), 29.66);
  assert.strictEqual(precioEfectivoCalca(CAL1050, 'M100', -5), 29.66);
  assert.strictEqual(precioEfectivoCalca(CAL1050, 'M100', 'abc'), 29.66);
});

test('#279-6: el manual llega del input como texto y se lee como numero', () => {
  assert.strictEqual(precioEfectivoCalca(CAL1050, 'M100', '18.75'), 18.75);
});

// === #279: enforcement del servidor, espejo de validarTierCotizacion (#151).
// Las partidas son las que se persisten (codigo del catalogo + precio), no las
// del carrito: "es calca" se decide por el codigo, nunca por una bandera del
// payload que el cliente podria inventar. ===
const PARTIDA_PRODUCTO = { codigo: 'AB12', descripcion: 'Olla', cantidad: 10, precio: 100 };
const PARTIDA_CALCA = { codigo: 'CAL1050', descripcion: 'Calca - Diseño 1', cantidad: 100, precio: 29.66, diseno: 1 };

test('#279-7: partidas sin precio manual pasan siempre, con permiso y sin el', () => {
  const partidas = [PARTIDA_PRODUCTO, PARTIDA_CALCA];
  assert.strictEqual(validarPreciosManualesCalca(partidas, false).ok, true);
  assert.strictEqual(validarPreciosManualesCalca(partidas, true).ok, true);
  assert.strictEqual(validarPreciosManualesCalca([], false).ok, true);
  assert.strictEqual(validarPreciosManualesCalca(undefined, false).ok, true);
});

test('#279-8: con permiso, una calca con precio manual pasa', () => {
  const r = validarPreciosManualesCalca([{ ...PARTIDA_CALCA, precio: 45, precioManual: 45 }], true);
  assert.strictEqual(r.ok, true);
});

test('#279-9: sin permiso, una calca con precio manual se rechaza con el mensaje de permiso', () => {
  const r = validarPreciosManualesCalca([PARTIDA_PRODUCTO, { ...PARTIDA_CALCA, precio: 45, precioManual: 45 }], false);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, MOTIVOS_PRECIO_MANUAL.SIN_PERMISO);
  assert.strictEqual(r.mensaje, MENSAJE_SIN_PERMISO_PRECIO_CALCA);
});

test('#279-10: un precio manual en una partida que NO es calca se rechaza aunque haya permiso', () => {
  const r = validarPreciosManualesCalca([{ ...PARTIDA_PRODUCTO, precioManual: 45 }], true);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, MOTIVOS_PRECIO_MANUAL.NO_CALCA);
  assert.ok(/calca/i.test(r.mensaje), r.mensaje);
});

test('#279-11: un precio manual que no es numero mayor que cero se rechaza como dato mal formado', () => {
  for (const valor of [0, -5, 'abc', {}, true]) {
    const r = validarPreciosManualesCalca([{ ...PARTIDA_CALCA, precioManual: valor }], true);
    assert.strictEqual(r.ok, false, `${JSON.stringify(valor)} deberia rechazarse`);
    assert.strictEqual(r.motivo, MOTIVOS_PRECIO_MANUAL.INVALIDO);
  }
});

test('#279-12: precioManual null o vacio es ausencia de captura, no dato invalido', () => {
  assert.strictEqual(validarPreciosManualesCalca([{ ...PARTIDA_CALCA, precioManual: null }], false).ok, true);
  assert.strictEqual(validarPreciosManualesCalca([{ ...PARTIDA_CALCA, precioManual: '' }], false).ok, true);
});

test('#279-13: los motivos se comparan por igualdad contra constantes explicitas', () => {
  assert.deepStrictEqual(Object.values(MOTIVOS_PRECIO_MANUAL).sort(), ['invalido', 'no-calca', 'sin-permiso']);
});

// El servidor no confia en que el cliente haya mandado precio y precioManual
// iguales: el precio efectivo de la linea lo impone el manual capturado.
test('#279-14: aplicar el precio manual fuerza el precio de la partida de calca', () => {
  const partidas = aplicarPrecioManualEnPartidas([
    PARTIDA_PRODUCTO,
    { ...PARTIDA_CALCA, precio: 29.66, precioManual: 45 },
  ]);
  assert.strictEqual(partidas[0].precio, 100, 'la partida de producto no se toca');
  assert.strictEqual(partidas[1].precio, 45);
  assert.strictEqual(partidas[1].precioManual, 45);
});

test('#279-15: sin captura la partida sale igual y no gana la llave precioManual', () => {
  const partidas = aplicarPrecioManualEnPartidas([PARTIDA_CALCA]);
  assert.strictEqual(partidas[0].precio, 29.66);
  assert.strictEqual('precioManual' in partidas[0], false);
});

test('#279-16: el manual capturado como texto se persiste como numero', () => {
  const partidas = aplicarPrecioManualEnPartidas([{ ...PARTIDA_CALCA, precioManual: '18.75' }]);
  assert.strictEqual(partidas[0].precio, 18.75);
  assert.strictEqual(partidas[0].precioManual, 18.75);
});

// === #280: permiso de precio de calca por vendedor, espejo exacto de
// normalizarPuedeFijarLista/puedeFijarLista (tier-logica.test.cjs, #153) ===

test('#280-1: normalizarPuedePrecioCalca: solo true exacto es permiso; basura, string y ausente degradan a false', () => {
  assert.strictEqual(normalizarPuedePrecioCalca(true), true);
  assert.strictEqual(normalizarPuedePrecioCalca(false), false);
  assert.strictEqual(normalizarPuedePrecioCalca('true'), false);
  assert.strictEqual(normalizarPuedePrecioCalca(1), false);
  assert.strictEqual(normalizarPuedePrecioCalca(null), false);
  assert.strictEqual(normalizarPuedePrecioCalca(undefined), false);
});

test('#280-2: puedePrecioCalca: admin siempre puede, sin checkbox', () => {
  assert.strictEqual(puedePrecioCalca({ role: 'admin' }), true);
  assert.strictEqual(puedePrecioCalca({ role: 'admin', puedePrecioCalca: false }), true);
});

test('#280-3: puedePrecioCalca: vendedor depende del flag normalizado', () => {
  assert.strictEqual(puedePrecioCalca({ role: 'vendedor', puedePrecioCalca: true }), true);
  assert.strictEqual(puedePrecioCalca({ role: 'vendedor', puedePrecioCalca: false }), false);
  assert.strictEqual(puedePrecioCalca({ role: 'vendedor' }), false);
  assert.strictEqual(puedePrecioCalca(null), false);
});

// Sin numero de diseño explicito la partida es el Diseño 1 (#220): es lo que
// vale para una calca guardada antes del cambio, que se lee sin migrarla.
test('#91-11: productoCalca arma la entrada del carrito marcada como calca', () => {
  const p = productoCalca(CAL1050);
  assert.strictEqual(p.key, llaveDiseno('CAL1050', 1));
  assert.strictEqual(p.diseno, 1);
  assert.strictEqual(p.name, 'Calca vitrificable mediana (50 cm2) 1 tinta - Diseño 1');
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

// === #281: una calca sin fila en el tier vigente deja de invalidar el carrito
// si la linea tiene precio manual capturado -- el precio EFECTIVO (manual
// incluido) es lo que decide calcaSinPrecio, no solo la lista. ===
const CAL_SIN_M350 = {
  code: 'CAL1025S',
  name: 'Calca vitrificable chica (25 cm2) 1 tinta',
  unit: 'SER',
  prices: { Menudeo: null, M100: 26.9, M550: 17.96, M1500: 14.19, M6000: 13.31 },
};

test('#281-1: calca sin precio en el tier + manual capturado -> ya no invalida el carrito', () => {
  const sinManual = precioEfectivoCalca(CAL_SIN_M350, 'M350', undefined) === null;
  assert.strictEqual(sinManual, true, 'sin manual, CAL1025S no tiene fila M350');
  assert.strictEqual(motivoCalcaInvalida({ hayCalca: true, calcaSinPrecio: sinManual }), MOTIVOS_CALCA_INVALIDA.SIN_PRECIO);

  const conManual = precioEfectivoCalca(CAL_SIN_M350, 'M350', 137.5) === null;
  assert.strictEqual(conManual, false, 'con manual valido el precio efectivo ya no es null');
  assert.strictEqual(motivoCalcaInvalida({ hayCalca: true, calcaSinPrecio: conManual }), null);
});

test('#281-2: calca sin precio y sin manual sigue bloqueando identico al actual', () => {
  const calcaSinPrecio = precioEfectivoCalca(CAL_SIN_M350, 'M350', null) === null;
  assert.strictEqual(motivoCalcaInvalida({ hayCalca: true, calcaSinPrecio }), MOTIVOS_CALCA_INVALIDA.SIN_PRECIO);
});

test('#281-3: avisoCalcaInvalida sin permiso conserva el texto actual (nadie pierde nada)', () => {
  const sinArgumento = avisoCalcaInvalida();
  const sinPermiso = avisoCalcaInvalida(false);
  assert.strictEqual(sinPermiso, sinArgumento);
  assert.ok(!/manual/i.test(sinPermiso), sinPermiso);
});

test('#281-4: avisoCalcaInvalida con permiso agrega la salida del precio manual', () => {
  const aviso = avisoCalcaInvalida(true);
  assert.ok(/precio manualmente/i.test(aviso), aviso);
  assert.ok(/Operam/.test(aviso), aviso);
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

// === #220: la unidad de una partida de calca es el DISENO, no el tipo (spec
// #218). Dos disenos del mismo codigo son dos partidas con el mismo precio
// unitario, cada una con su piso de 100. ===
test('#220-1: sin calcas en el carrito el primer diseno es el 1', () => {
  assert.strictEqual(siguienteNumeroDiseno([]), 1);
  assert.strictEqual(siguienteNumeroDiseno([{ codigo: 'VA08B1A321124', cantidad: 600 }]), 1);
  assert.strictEqual(siguienteNumeroDiseno(undefined), 1);
});

test('#220-2: el numero de diseno es el maximo historico + 1, no el conteo de lineas vivas', () => {
  const conTres = [
    { codigo: 'CAL1025S', cantidad: 100, diseno: 1 },
    { codigo: 'CAL1050', cantidad: 100, diseno: 2 },
    { codigo: 'CAL1025S', cantidad: 100, diseno: 3 },
  ];
  assert.strictEqual(siguienteNumeroDiseno(conTres), 4);
  // Borrar el Diseno 1 no libera el numero: el siguiente sigue siendo el 4.
  const sinElPrimero = conTres.filter(i => i.diseno !== 1);
  assert.strictEqual(siguienteNumeroDiseno(sinElPrimero), 4);
});

// El caso que el carrito vivo no puede contestar solo: borrar el diseño MAS
// ALTO lo saca de los items, y sin memoria de lo ya asignado el siguiente
// reciclaria su numero.
test('#220-2b: borrar el diseno mas alto tampoco libera su numero', () => {
  const soloElPrimero = [{ codigo: 'CAL1025S', cantidad: 100, diseno: 1 }];
  assert.strictEqual(siguienteNumeroDiseno(soloElPrimero, 2), 3);
  assert.strictEqual(siguienteNumeroDiseno([], 2), 3, 'borrarlos todos tampoco');
  // Lo ya asignado nunca hace retroceder al carrito vivo.
  assert.strictEqual(siguienteNumeroDiseno([{ codigo: 'CAL1025S', cantidad: 100, diseno: 5 }], 2), 6);
});

test('#220-3: una calca sin diseno (cotizacion anterior al cambio) cuenta como Diseno 1', () => {
  assert.strictEqual(siguienteNumeroDiseno([{ codigo: 'CAL1050', cantidad: 100 }]), 2);
});

test('#220-4: la llave del carrito y el codigo del catalogo son ida y vuelta', () => {
  const llave = llaveDiseno('CAL1025S', 2);
  assert.notStrictEqual(llave, 'CAL1025S', 'la identidad de la linea no es el codigo');
  assert.strictEqual(esCodigoCalca(llave), false, 'la llave no se lee como codigo de catalogo');
  assert.strictEqual(codigoDeLlave(llave), 'CAL1025S');
  assert.strictEqual(esCodigoCalca(codigoDeLlave(llave)), true);
});

test('#220-5: codigoDeLlave devuelve tal cual lo que no es llave de diseno', () => {
  assert.strictEqual(codigoDeLlave('VA08B1A321124'), 'VA08B1A321124');
  assert.strictEqual(codigoDeLlave('ENVIO'), 'ENVIO');
  assert.strictEqual(codigoDeLlave('CAL1025S'), 'CAL1025S');
});

// Las lineas del carrito se manipulan por llave desde onclick inline y desde un
// selector [data-key="..."] (trampa #112): una llave con comillas o espacios
// rompe el HTML generado sin que ningun test de logica lo note.
test('#220-6: la llave de diseno sobrevive el viaje por un atributo HTML', () => {
  for (const n of [1, 2, 10]) {
    assert.match(llaveDiseno('CAL1025S', n), /^[A-Za-z0-9-]+$/);
  }
});

test('#220-7: productoCalca numera el diseno en el nombre y conserva el codigo del catalogo', () => {
  const p = productoCalca(CAL1025S, 2);
  assert.strictEqual(p.key, llaveDiseno('CAL1025S', 2));
  assert.strictEqual(p.model, 'CAL1025S', 'el codigo que se serializa es el del catalogo');
  assert.strictEqual(p.diseno, 2);
  assert.strictEqual(p.name, 'Calca vitrificable chica (25 cm2) 1 tinta - Diseño 2');
  assert.strictEqual(p.esCalca, true);
  assert.deepStrictEqual(p.prices, CAL1025S.prices);
  assert.strictEqual(p.weight_kg, undefined);
});

test('#220-8: dos disenos del mismo codigo son dos entradas distintas con el mismo precio', () => {
  const uno = productoCalca(CAL1025S, 1);
  const dos = productoCalca(CAL1025S, 2);
  assert.notStrictEqual(uno.key, dos.key, 'no se pisan en el carrito');
  assert.notStrictEqual(uno.name, dos.name, 'se distinguen en el documento');
  assert.strictEqual(uno.model, dos.model);
  assert.deepStrictEqual(uno.prices, dos.prices);
});

test('#220-9: el piso de 100 es por diseno: 60 + 60 factura 100 + 100, nunca 120', () => {
  const dos = cantidadFacturableCalca(60) + cantidadFacturableCalca(60);
  assert.strictEqual(dos, 200);
  assert.notStrictEqual(dos, cantidadFacturableCalca(120), 'fusionar los disenos subcotizaria');
});

test('#220-10: las piezas de varios disenos siguen fuera del volumen que fija la lista', () => {
  const items = [
    { codigo: 'VA08B1A321124', cantidad: 600 },
    { codigo: 'CAL1025S', cantidad: 100, diseno: 1 },
    { codigo: 'CAL1025S', cantidad: 100, diseno: 2 },
  ];
  assert.strictEqual(piezasDeProducto(items), 600);
  assert.strictEqual(hayCalcaEnCarrito(items), true);
});

// === #221: la llave del carrito se reconstruye al reabrir y al restaurar ===
// app.js no es importable en Node, asi que la regla que rehidrata el carrito
// (que codigo + diseno dan la llave, y que un item sin diseno es el Diseño 1)
// vive aqui, donde si se puede afirmar.

test('#221-1: dos items del mismo codigo con distinto diseno dan llaves distintas', () => {
  const uno = llaveCarrito('CAL1025S', 1);
  const dos = llaveCarrito('CAL1025S', 2);
  assert.notStrictEqual(uno, dos, 'dos disenos guardados no se pueden pisar al reabrir');
  assert.strictEqual(codigoDeLlave(uno), 'CAL1025S');
  assert.strictEqual(codigoDeLlave(dos), 'CAL1025S');
});

test('#221-2: un item de calca sin diseno se rehidrata como Diseño 1, sin migracion', () => {
  assert.strictEqual(llaveCarrito('CAL1025S', undefined), llaveCarrito('CAL1025S', 1));
  assert.strictEqual(llaveCarrito('CAL1025S', null), llaveCarrito('CAL1025S', 1));
  assert.strictEqual(llaveCarrito('CAL1025S', 0), llaveCarrito('CAL1025S', 1));
});

test('#221-3: lo que no es calca conserva su codigo como llave', () => {
  assert.strictEqual(llaveCarrito('VA08B1A321124', undefined), 'VA08B1A321124');
  assert.strictEqual(llaveCarrito('ENVIO', 1), 'ENVIO');
  assert.strictEqual(llaveCarrito('CO16', 2), 'CO16', 'un diseno colado en una linea de producto no inventa llave');
});

test('#221-4: la llave rehidratada es la misma que arma productoCalca al agregar', () => {
  assert.strictEqual(llaveCarrito(CAL1025S.code, 2), productoCalca(CAL1025S, 2).key);
});

// === #222: tope de captura de 2 disenos por linea de producto (spec #218). Es
// un freno contra errores de captura, no una regla del producto -- nunca borra
// ni invalida disenos ya agregados, solo frena al momento de agregar. ===
test('#222-1: la constante del tope es 2, un solo punto de cambio', () => {
  assert.strictEqual(MAX_DISENOS_POR_LINEA_PRODUCTO, 2);
});

test('#222-2: lineasDeProducto cuenta lineas, no piezas, y excluye ENVIO y calcas', () => {
  const items = [
    { codigo: 'VA08B1A321124', cantidad: 600 },
    { codigo: 'CO16', cantidad: 1 },
    { codigo: 'ENVIO', cantidad: 1 },
    { codigo: 'CAL1025S', cantidad: 100, diseno: 1 },
  ];
  assert.strictEqual(lineasDeProducto(items), 2);
});

test('#222-3: un paquete cuenta como una sola linea, sin importar la cantidad', () => {
  assert.strictEqual(lineasDeProducto([{ codigo: 'PQ-100', cantidad: 5000 }]), 1);
});

test('#222-4: lineasDeProducto de un carrito vacio o de solo calca/envio es 0', () => {
  assert.strictEqual(lineasDeProducto([]), 0);
  assert.strictEqual(lineasDeProducto(null), 0);
  assert.strictEqual(lineasDeProducto([{ codigo: 'ENVIO', cantidad: 1 }, { codigo: 'CAL1025S', cantidad: 100 }]), 0);
});

test('#222-5: topeDisenos es la constante por lineas de producto (0 -> 0, 1 -> 2, 3 -> 6)', () => {
  assert.strictEqual(topeDisenos(0), 0);
  assert.strictEqual(topeDisenos(1), 2);
  assert.strictEqual(topeDisenos(3), 6);
});

test('#222-6: sin lineas de producto no se puede agregar calca (no existe la cotizacion de solo calcas)', () => {
  const r = puedeAgregarDiseno({ lineasProducto: 0, disenosActuales: 0 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, MOTIVOS_TOPE_DISENOS.SIN_PRODUCTO);
});

test('#222-7: un paso antes del tope se puede agregar, en el tope exacto no', () => {
  const unPasoAntes = puedeAgregarDiseno({ lineasProducto: 1, disenosActuales: 1 });
  assert.strictEqual(unPasoAntes.ok, true);
  assert.strictEqual(unPasoAntes.motivo, null);

  const enElTope = puedeAgregarDiseno({ lineasProducto: 1, disenosActuales: 2 });
  assert.strictEqual(enElTope.ok, false);
  assert.strictEqual(enElTope.motivo, MOTIVOS_TOPE_DISENOS.TOPE_ALCANZADO);
});

test('#222-8: con 3 lineas de producto el tope es 6: 5 deja agregar, 6 no', () => {
  assert.strictEqual(puedeAgregarDiseno({ lineasProducto: 3, disenosActuales: 5 }).ok, true);
  assert.strictEqual(puedeAgregarDiseno({ lineasProducto: 3, disenosActuales: 6 }).ok, false);
});

test('#222-9: los motivos del tope se comparan por igualdad contra constantes explicitas', () => {
  assert.deepStrictEqual(Object.values(MOTIVOS_TOPE_DISENOS).sort(), ['sin-producto', 'tope-alcanzado']);
});

test('#222-10: avisoTopeDisenos con 0 lineas pide agregar producto primero', () => {
  const aviso = avisoTopeDisenos(0);
  assert.ok(/producto/i.test(aviso), aviso);
});

test('#222-11: avisoTopeDisenos con lineas de producto trae los conteos de lineas y disenos', () => {
  assert.strictEqual(avisoTopeDisenos(1), 'Maximo 2 disenos de calca por linea de producto: 1 linea -> 2 disenos');
  assert.strictEqual(avisoTopeDisenos(3), 'Maximo 2 disenos de calca por linea de producto: 3 lineas -> 6 disenos');
});
