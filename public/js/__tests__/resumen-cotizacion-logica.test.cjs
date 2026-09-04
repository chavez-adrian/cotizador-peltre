'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// Las dos cotizaciones reales de la sesion de diseno de #312, convertidas una
// sola vez desde el volcado de Operam. El indice de familias sale del maestro de
// articulos versionado (data/modelos.json), no de una copia en el test: si la
// familia de un modelo cambia ahi, esta suite lo ve.
const q928 = require('./fixtures/cotizacion-928.json');
const q1263 = require('./fixtures/cotizacion-1263.json');

const MODELOS = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'data', 'modelos.json'), 'utf8'));
const FAMILIAS = Object.fromEntries(MODELOS.map(m => [m.modelo, m.familia]));

const ORIGIN = 'https://cotizador.example';

let mensajeCotizacion, motivoSinResumen, LEYENDA_SIN_FOLIO;
before(async () => {
  ({ mensajeCotizacion, motivoSinResumen, LEYENDA_SIN_FOLIO } = await import('../resumen-cotizacion-logica.js'));
});

// El texto que recibe el cliente, linea por linea: es la fuente de verdad del
// ticket #312 y lo que se afirma aqui, no como se agrupo por dentro.
test('R1: la 928 (42 partidas) se lee como seis renglones de familia, sin envio y con el dinero una sola vez', () => {
  const msg = mensajeCotizacion(q928, ORIGIN, FAMILIAS);
  assert.equal(msg.texto, [
    '*pp.peltre - Peltre Nacional*',
    '*Cotización 928*',
    'Para: Hotel Ejemplo',
    '',
    'Platos · 5 modelos · 1,640 pzs',
    'Tazas · 2 modelos · 1,080 pzs',
    'Tazones · 1 modelo · 480 pzs',
    'Salseras · 1 modelo · 576 pzs',
    'Portavasos · 1 modelo · 144 pzs',
    'Pocillos · 1 modelo · 48 pzs',
    'No incluye envío',
    '',
    '*3,968 piezas · TOTAL $266,595.31 IVA incluido*',
    'Válido hasta el 3 de octubre de 2026',
    '',
    'Por favor revisa a detalle los modelos, colores y condiciones en el siguiente link.',
    '',
    'Avísame si tienes alguna duda.',
    '',
    `${ORIGIN}/api/cotizacion/html/4821`,
  ].join('\n'));
});

// La 1263 lleva partida de envio: el renglon dice el servicio y el tiempo tal
// como los reporta la paqueteria, y cierra el bloque.
test('R2: la 1263 (8 partidas) cabe en cinco renglones: cuatro familias y el envio', () => {
  const msg = mensajeCotizacion(q1263, ORIGIN, FAMILIAS);
  assert.equal(msg.texto, [
    '*pp.peltre - Peltre Nacional*',
    '*Cotización 1263*',
    'Para: Hotel Ejemplo',
    '',
    'Platos · 2 modelos · 12 pzs',
    'Tazas · 1 modelo · 8 pzs',
    'Tazones · 1 modelo · 4 pzs',
    'Salseras · 1 modelo · 4 pzs',
    'Envío · Envio mismo día',
    '',
    '*28 piezas · TOTAL $6,439.21 IVA incluido*',
    'Válido hasta el 3 de octubre de 2026',
    '',
    'Por favor revisa a detalle los modelos, colores y condiciones en el siguiente link.',
    '',
    'Avísame si tienes alguna duda.',
    '',
    `${ORIGIN}/api/cotizacion/html/5104`,
  ].join('\n'));
});

function registro(items, extra = {}) {
  return { id: 7, folioOperam: 500, cliente: 'Hotel Ejemplo', vigencia: '2026-10-03', total: 100, items, ...extra };
}

function bloque(msg) {
  return msg.texto.split('\n\n')[1].split('\n');
}

// Un registro sin id no tiene documento que citar: no hay nada que compartir.
// #311: tampoco sin folio de Operam, sea cual sea el motivo por el que falta.
test('R3: sin id o sin folio de Operam no hay mensaje', () => {
  assert.equal(mensajeCotizacion({ cliente: 'Hotel Azul', total: 100, folioOperam: 928 }, ORIGIN, FAMILIAS), null);
  assert.equal(mensajeCotizacion({ id: '', cliente: 'Hotel Azul', folioOperam: 928 }, ORIGIN, FAMILIAS), null);
  assert.equal(mensajeCotizacion(null, ORIGIN, FAMILIAS), null);
  assert.equal(mensajeCotizacion({ id: 42, cliente: 'Hotel Azul' }, ORIGIN, FAMILIAS), null);
});

test('R4: waUrl es el texto codificado para wa.me', () => {
  const msg = mensajeCotizacion(q1263, ORIGIN, FAMILIAS);
  assert.match(msg.waUrl, /^https:\/\/wa\.me\/\?text=/);
  assert.equal(decodeURIComponent(msg.waUrl.split('text=')[1]), msg.texto);
  assert.ok(!msg.waUrl.includes(' '));
  assert.ok(!msg.waUrl.includes('&'));
});

// La razon social llega en MAYUSCULAS fiscales del SAT: al chat va por el
// titulador del repo. El nombre corto, cuando existe, gana.
test('R5: el destinatario es el nombre corto, y a falta de el la razon social titulada', () => {
  const items = [{ codigo: 'VA05B1001112', descripcion: 'Taza 5', cantidad: 12, precio: 30, descuento: 0 }];
  const conCorto = mensajeCotizacion(registro(items, { cliente: 'HOTELES DE LA COSTA SA DE CV', nombreCorto: 'Hotel Azul' }), ORIGIN, FAMILIAS);
  assert.ok(conCorto.texto.includes('Para: Hotel Azul'));

  const sinCorto = mensajeCotizacion(registro(items, { cliente: 'HOTELES DE LA COSTA SA DE CV' }), ORIGIN, FAMILIAS);
  assert.ok(sinCorto.texto.includes('Para: Hoteles de la Costa SA de CV'));
});

// ADR-0010: la calca no es producto. Lleva renglon propio en piezas decoradas y
// sus piezas NO se suman al conteo de producto, la misma separacion que ya hace
// la lista de precios.
test('R6: la calca lleva renglon propio y sus piezas no entran al conteo de producto', () => {
  const msg = mensajeCotizacion(registro([
    { codigo: 'VA05B1001112', descripcion: 'Taza 5', cantidad: 144, precio: 30, descuento: 0 },
    { codigo: 'CAL2050', descripcion: 'Calca 2 tintas 50 cm2', cantidad: 144, precio: 8, descuento: 0 },
  ]), ORIGIN, FAMILIAS);
  assert.deepEqual(bloque(msg), [
    'Tazas · 1 modelo · 144 pzs',
    'Calcas · 144 piezas decoradas',
    'No incluye envío',
  ]);
  assert.ok(msg.texto.includes('*144 piezas · TOTAL'));
});

// Un modelo que el indice no conoce no puede desaparecer del resumen: cae en
// "Otros", al final de las familias. El pendiente se resuelve en /admin/catalogo
// (ADR-0016), donde SI tiene que ser visible.
test('R7: los modelos sin familia en el indice caen en Otros, despues de las familias', () => {
  const msg = mensajeCotizacion(registro([
    { codigo: 'ZZ99XXXX', descripcion: 'Pieza nueva', cantidad: 5, precio: 10, descuento: 0 },
    { codigo: 'VA05B1001112', descripcion: 'Taza 5', cantidad: 144, precio: 30, descuento: 0 },
  ]), ORIGIN, FAMILIAS);
  assert.deepEqual(bloque(msg), [
    'Tazas · 1 modelo · 144 pzs',
    'Otros · 1 modelo · 5 pzs',
    'No incluye envío',
  ]);
});

// "modelos" cuenta modelos distintos, no partidas: dos colores de la misma taza
// son un modelo. El singular es el de cada magnitud por separado.
test('R8: singular y plural de modelos, piezas y calca', () => {
  const msg = mensajeCotizacion(registro([
    { codigo: 'VA05B1001112', descripcion: 'Taza 5 blanca', cantidad: 1, precio: 30, descuento: 0 },
    { codigo: 'CAL1025', descripcion: 'Calca 1 tinta', cantidad: 1, precio: 8, descuento: 0 },
  ]), ORIGIN, FAMILIAS);
  assert.deepEqual(bloque(msg), [
    'Tazas · 1 modelo · 1 pza',
    'Calcas · 1 pieza decorada',
    'No incluye envío',
  ]);
  assert.ok(msg.texto.includes('*1 pieza · TOTAL'));
});

// La familia se captura en minuscula singular y el renglon la imprime
// capitalizada y en plural, con las tres terminaciones del espanol que aparecen
// en el maestro: -on, vocal y consonante, mas la que ya viene en plural.
test('R9: dos partidas del mismo modelo son un solo modelo, y cada familia se pluraliza', () => {
  const msg = mensajeCotizacion(registro([
    { codigo: 'TA14B1A32112', descripcion: 'Tazón 14 blanco', cantidad: 10, precio: 100, descuento: 0 },
    { codigo: 'TA14A3001112', descripcion: 'Tazón 14 azul', cantidad: 10, precio: 90, descuento: 0 },
    { codigo: 'CL28B1001112', descripcion: 'Comal 28', cantidad: 4, precio: 150, descuento: 0 },
    { codigo: 'PV08B1001112', descripcion: 'Portavasos', cantidad: 6, precio: 40, descuento: 0 },
  ]), ORIGIN, FAMILIAS);
  assert.deepEqual(bloque(msg), [
    'Tazones · 1 modelo · 20 pzs',
    'Comales · 1 modelo · 4 pzs',
    'Portavasos · 1 modelo · 6 pzs',
    'No incluye envío',
  ]);
});

// El descuento vive por partida (ADR-0011) y ordena el bloque aunque no se
// imprima: bonificar la familia mas cara la puede mandar hacia abajo.
test('R10: los renglones se ordenan por importe neto descendente, sin imprimir ningun importe', () => {
  const msg = mensajeCotizacion(registro([
    { codigo: 'PL27B1A32112', descripcion: 'Plato 27', cantidad: 10, precio: 300, descuento: 90 },
    { codigo: 'VA05B1001112', descripcion: 'Taza 5', cantidad: 10, precio: 50, descuento: 0 },
  ]), ORIGIN, FAMILIAS);
  assert.deepEqual(bloque(msg), [
    'Tazas · 1 modelo · 10 pzs',
    'Platos · 1 modelo · 10 pzs',
    'No incluye envío',
  ]);
  assert.ok(!msg.texto.includes('$300'));
  assert.ok(!/\$/.test(bloque(msg).join('\n')));
});

// #311: la regla "sin numero no hay mensaje" vive en un solo lugar, para que el
// historial y la cotizacion recien generada no puedan discrepar.
test('R11: motivoSinResumen exige id y folio de Operam para poder compartir', () => {
  assert.equal(motivoSinResumen({ id: 42, folioOperam: 928 }), null);
  assert.equal(motivoSinResumen({ id: 42, folioOperam: null }), LEYENDA_SIN_FOLIO);
  assert.equal(motivoSinResumen({ id: 42 }), LEYENDA_SIN_FOLIO);
  assert.equal(motivoSinResumen({ folioOperam: 928 }), LEYENDA_SIN_FOLIO);
  assert.equal(motivoSinResumen(null), LEYENDA_SIN_FOLIO);
});
