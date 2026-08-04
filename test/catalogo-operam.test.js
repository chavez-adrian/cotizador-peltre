import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerArchivoSync } from '../lib/fs-reintento.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const { decodificarSku, construirCatalogo, ESTADOS_PARIDAD } = await import('../lib/catalogo-operam.js');

// Las 6 listas que el cotizador cotiza, con el factor REAL de Operam (verificado en
// vivo el 2026-08-03). "Precio de lista" (id 12, factor 1) es la base de todas.
const SALES_TYPES = [
  { id: '12', sales_type: 'Precio de lista', factor: '1', inactive: '0' },
  { id: '15', sales_type: 'M100', factor: '0.7', inactive: '0' },
  { id: '16', sales_type: 'M350', factor: '0.6', inactive: '0' },
  { id: '1', sales_type: 'M550', factor: '0.5', inactive: '0' },
  { id: '6', sales_type: 'M1500', factor: '0.45', inactive: '0' },
  { id: '3', sales_type: 'M6000', factor: '0.4', inactive: '0' },
  { id: '18', sales_type: 'Bazaar', factor: '0.5', inactive: '1' },
];

const COMPLEMENTO = {
  version: '2026.ABRIL',
  letrasPrecio: { '1:1': 'A', '1:2': 'B', '2:1': 'C' },
  productos: {
    PV08A: { name: 'PV08 Portavasos 8 cm un color', nameEn: 'PV08 Coaster 8 cm one color', weight_kg: 0.047 },
  },
  calcas: {},
  aplicacionExtra: null,
  boxMap: [],
  colores: {}, texturas: {}, filetes: {}, colorFiletes: {}, tiposNombre: {},
  skus: {},
};

function fila(stockId, salesTypeId, price) {
  return { stock_id: stockId, sales_type_id: salesTypeId, price: String(price) };
}

// El codigo de articulo de Peltre codifica el producto en posiciones fijas:
// tipo(2) tamano(2) color1(2) color2(2) textura(1) capas(1) filetes(1) colorRiso(1).
// Es el UNICO lugar de donde el catalogo generado puede sacar los atributos que el
// selector guiado necesita -- Operam guarda el codigo y la descripcion, no las partes.
test('decodificarSku: lee las partes del codigo canonico de 12 posiciones', () => {
  assert.deepEqual(decodificarSku('TA14G1B11211'), {
    tipo: 'TA',
    tamano: '14',
    color1: 'G1',
    color2: 'B1',
    textura: 1,
    capas: 2,
    filetes: 1,
    colorRiso: 1,
    paquete: null,
  });
});

// "00" en color2 y "0" en colorRiso son la marca de "no aplica" del codigo; el
// catalogo los expone como null (misma forma que el precios.json vigente).
test('decodificarSku: 00 en color2 y 0 en colorRiso se leen como ausencia', () => {
  const d = decodificarSku('VA05G1001111');
  assert.equal(d.color2, null);
  assert.equal(d.color1, 'G1');
  assert.equal(d.colorRiso, 1);
  const sinRiso = decodificarSku('VA05R2P31220');
  assert.equal(sinRiso.colorRiso, null);
  assert.equal(sinRiso.color2, 'P3');
  assert.equal(sinRiso.filetes, 2);
});

// Un digito 13 marca las piezas del paquete (TA14B1A321124 = paquete de 4).
test('decodificarSku: el digito 13 es el numero de piezas del paquete', () => {
  assert.equal(decodificarSku('TA14B1A321124').paquete, 4);
});

// Los codigos legacy del Excel (TA14P1N1M0, TA14N1C, PL20B1N1M01RA) NO siguen la
// convencion: no se pueden leer y el nucleo debe decirlo en vez de inventar partes.
test('decodificarSku: devuelve null cuando el codigo no sigue la convencion', () => {
  assert.equal(decodificarSku('TA14P1N1M0'), null);
  assert.equal(decodificarSku('TA14N1C'), null);
  assert.equal(decodificarSku('PL20B1N1M01RA'), null);
  assert.equal(decodificarSku('CAL1025'), null);
  assert.equal(decodificarSku(''), null);
  assert.equal(decodificarSku(undefined), null);
});

// Operam guarda UN precio explicito por articulo en "Precio de lista" y las demas
// listas son factores sobre esa base (0 contradicciones en la muestra de 464 filas
// del triage de #120). Sin fila propia, el precio de la lista es base x factor.
test('construirCatalogo: sin fila explicita, cada lista es base x factor', () => {
  const { catalogo } = construirCatalogo({
    salesTypes: SALES_TYPES,
    precios: [fila('PV08B1001111', '12', 100)],
    items: [{ stock_id: 'PV08B1001111', description: 'Portavasos 8 blanco' }],
    complemento: COMPLEMENTO,
  });
  assert.equal(catalogo.products.length, 1);
  assert.deepEqual(catalogo.products[0].prices, {
    Menudeo: 100, M100: 70, M350: 60, M550: 50, M1500: 45, M6000: 40,
  });
});

// Cuando la lista SI tiene fila propia para el articulo, esa manda: el factor es el
// respaldo, no la regla.
test('construirCatalogo: la fila explicita de la lista gana sobre base x factor', () => {
  const { catalogo } = construirCatalogo({
    salesTypes: SALES_TYPES,
    precios: [fila('PV08B1001111', '12', 100), fila('PV08B1001111', '15', 88)],
    items: [{ stock_id: 'PV08B1001111', description: 'Portavasos 8 blanco' }],
    complemento: COMPLEMENTO,
  });
  assert.equal(catalogo.products[0].prices.M100, 88);
  assert.equal(catalogo.products[0].prices.M350, 60, 'las demas listas siguen saliendo del factor');
});

// Las 118 filas en $0 de Operam son herramental y focos: ausencia de precio, no
// precio cero. Una fila en 0 no puede pisar el base x factor ni servir de base.
test('construirCatalogo: las filas en 0 se ignoran (no son precio)', () => {
  const { catalogo } = construirCatalogo({
    salesTypes: SALES_TYPES,
    precios: [fila('PV08B1001111', '12', 100), fila('PV08B1001111', '16', 0)],
    items: [{ stock_id: 'PV08B1001111', description: 'Portavasos 8 blanco' }],
    complemento: COMPLEMENTO,
  });
  assert.equal(catalogo.products[0].prices.M350, 60);

  const soloCero = construirCatalogo({
    salesTypes: SALES_TYPES,
    precios: [fila('PV08B1001111', '12', 0)],
    items: [{ stock_id: 'PV08B1001111', description: 'Portavasos 8 blanco' }],
    complemento: COMPLEMENTO,
  });
  assert.equal(soloCero.catalogo.products.length, 0, 'sin base viva el producto no entra al catalogo');
});

// El catalogo precia por clave (PV08A) pero Operam precia por articulo: hoy hay
// claves donde una variante de color cobra distinto que las demas (hallazgo (a) del
// triage: PV08A tiene 19 SKUs a $60.34 y 8 a $64.66). El catalogo toma el precio de
// la MAYORIA -- inventar un promedio inventaria un precio que nadie cobra -- y la
// divergencia se reporta para corregirla en el ERP.
test('construirCatalogo: con precios distintos entre SKUs de la clave manda el mas frecuente y la divergencia se reporta', () => {
  const items = ['PV08B1001111', 'PV08N1001111', 'PV08R2001111'].map(stock_id => ({ stock_id, description: 'Portavasos ' + stock_id }));
  const { catalogo, paridad } = construirCatalogo({
    salesTypes: SALES_TYPES,
    precios: [
      fila('PV08B1001111', '12', 60), fila('PV08N1001111', '12', 60),
      fila('PV08R2001111', '12', 100),
    ],
    items,
    complemento: COMPLEMENTO,
  });
  assert.equal(catalogo.products[0].prices.Menudeo, 60);
  const div = paridad.divergentes.find(d => d.key === 'PV08A');
  assert.ok(div, 'la clave con precios distintos entre sus SKUs debe reportarse');
  assert.deepEqual(div.precios.map(p => p.base).sort((a, b) => a - b), [60, 100]);
  assert.deepEqual(div.precios.find(p => p.base === 100).skus, ['PV08R2001111']);
});

// La forma de products es contrato con el frontend: mismos campos que
// data/precios.json, ni uno mas.
test('construirCatalogo: products conserva exactamente los campos de precios.json', () => {
  const { catalogo } = construirCatalogo({
    salesTypes: SALES_TYPES,
    precios: [fila('PV08B1001111', '12', 100)],
    items: [{ stock_id: 'PV08B1001111', description: 'Portavasos 8 blanco' }],
    complemento: COMPLEMENTO,
  });
  assert.deepEqual(Object.keys(catalogo.products[0]).sort(), ['key', 'model', 'name', 'nameEn', 'prices', 'weight_kg']);
  assert.equal(catalogo.products[0].name, 'PV08 Portavasos 8 cm un color', 'el nombre presentable lo pone el complementario');
  assert.equal(catalogo.products[0].weight_kg, 0.047);
  assert.equal(catalogo.products[0].model, 'PV08');
});

// skus es la lista que alimenta el selector guiado: un renglon por articulo vendible
// con sus partes y la clave de precio a la que pertenece. El nombre lo pone Operam
// (es el que ve el vendedor en el ERP), las partes salen del codigo.
test('construirCatalogo: skus sale de los articulos de Operam con las partes del codigo', () => {
  const { catalogo } = construirCatalogo({
    salesTypes: SALES_TYPES,
    precios: [fila('PV08B1001111', '12', 100)],
    items: [{ stock_id: 'PV08B1001111', description: 'Portavasos 8 blanco  ' }],
    complemento: COMPLEMENTO,
  });
  assert.deepEqual(catalogo.skus, [{
    sku: 'PV08B1001111',
    tipo: 'PV',
    tamano: '08',
    color1: 'B1',
    textura: 1,
    capas: 1,
    filetes: 1,
    color2: null,
    colorRiso: 1,
    priceKey: 'PV08A',
    nombre: 'Portavasos 8 blanco',
  }]);
});

// El flujo guiado solo cotiza texturas normales (0/8/9 son muestras y decorados a
// mano) y filetes 1 o 2. Mismo criterio que traia el extractor del Excel.
test('construirCatalogo: excluye muestras, decorados y filetes fuera del flujo guiado', () => {
  const comp = { ...COMPLEMENTO, letrasPrecio: { ...COMPLEMENTO.letrasPrecio, '9:1': 'A', '1:1': 'A' } };
  const items = [
    { stock_id: 'PV08B1009111', description: 'decorado' },   // textura 9
    { stock_id: 'PV08B1001131', description: 'filete oreja' }, // filetes 3
    { stock_id: 'PV08B1001111', description: 'normal' },
  ];
  const { catalogo } = construirCatalogo({
    salesTypes: SALES_TYPES,
    precios: items.map(i => fila(i.stock_id, '12', 100)),
    items,
    complemento: comp,
  });
  assert.deepEqual(catalogo.skus.map(s => s.sku), ['PV08B1001111']);
});

// Los paquetes de N piezas tienen precio propio en Operam (4x exacto). Colgarlos de
// la clave de la pieza los cotizaria al precio de UNA pieza -- el bug (b) del triage,
// heredado del Excel. Aqui el paquete es su propia clave de precio.
test('construirCatalogo: un paquete de N no cuelga de la clave de la pieza, tiene la suya', () => {
  const items = [
    { stock_id: 'PV08B1001111', description: 'Portavasos 8 blanco' },
    { stock_id: 'PV08B10011114', description: 'Paquete de 4 portavasos 8 blanco' },
  ];
  const { catalogo } = construirCatalogo({
    salesTypes: SALES_TYPES,
    precios: [fila('PV08B1001111', '12', 100), fila('PV08B10011114', '12', 400)],
    items,
    complemento: COMPLEMENTO,
  });
  assert.equal(catalogo.skus.find(s => s.sku === 'PV08B10011114').priceKey, 'PV08AP4');
  const paquete = catalogo.products.find(p => p.key === 'PV08AP4');
  assert.equal(paquete.prices.Menudeo, 400);
  assert.equal(paquete.prices.M100, 280);
  assert.equal(paquete.name, 'PV08 Portavasos 8 cm un color (paquete de 4)');
  assert.equal(paquete.weight_kg, 0.047 * 4);
  assert.equal(catalogo.products.find(p => p.key === 'PV08A').prices.Menudeo, 100, 'la pieza conserva su precio');
});

// 209 articulos VIVOS en Operam llevan codigos legacy que no codifican sus partes
// (TA14G11211 no dice que el interior es blanco). Sin su lectura congelada en el
// complementario se caerian del catalogo; con ella entran igual que los canonicos.
// Un codigo ilegible que tampoco esta en la tabla NO entra: no se adivina.
test('construirCatalogo: los codigos legacy se leen del complementario, y sin ficha no entran', () => {
  const comp = {
    ...COMPLEMENTO,
    letrasPrecio: { ...COMPLEMENTO.letrasPrecio, '1:2': 'B' },
    productos: { ...COMPLEMENTO.productos, PV08B: { name: 'PV08 Portavasos bicolor', nameEn: null, weight_kg: null } },
    skus: {
      PV08G11211: { tipo: 'PV', tamano: '08', color1: 'G1', color2: 'B1', textura: 1, capas: 2, filetes: 1, colorRiso: 1 },
    },
  };
  const items = [
    { stock_id: 'PV08G11211', description: 'Portavasos granito interior blanco' },
    { stock_id: 'PV08P1N1M0', description: 'Portavasos legacy sin ficha' },
  ];
  const { catalogo } = construirCatalogo({
    salesTypes: SALES_TYPES,
    precios: items.map(i => fila(i.stock_id, '12', 100)),
    items,
    complemento: comp,
  });
  assert.deepEqual(catalogo.skus.map(s => s.sku), ['PV08G11211']);
  assert.equal(catalogo.skus[0].color2, 'B1');
  assert.equal(catalogo.skus[0].priceKey, 'PV08B');
});

// Las calcas vitrificables son la familia CAL10xx (las CAL00xx son calcas de marca y
// de artistas, que el flujo del cotizador no modela). En Operam NO tienen fila de
// "Precio de lista": cada lista trae su precio propio, asi que los tiers que Operam
// no precia quedan en null en vez de inventarse un factor.
test('construirCatalogo: calcas son la familia CAL10xx con el precio que Operam si tiene', () => {
  const { catalogo } = construirCatalogo({
    salesTypes: SALES_TYPES,
    precios: [
      fila('CAL1025', '15', 26.9), fila('CAL1025', '1', 17.96), fila('CAL1025', '3', 13.31),
      fila('CAL0001', '15', 9),
    ],
    items: [
      { stock_id: 'CAL1025', description: 'Calca vitrificable chica (25 cm2) 1 tinta' },
      { stock_id: 'CAL0001', description: 'Calca Lani Blanca 4 x 8 cm' },
    ],
    complemento: { ...COMPLEMENTO, calcas: { CAL1025: { nameEn: 'Small enamel decal (25 cm2) 1 color' } } },
  });
  assert.deepEqual(catalogo.calcas, [{
    code: 'CAL1025',
    name: 'Calca vitrificable chica (25 cm2) 1 tinta',
    nameEn: 'Small enamel decal (25 cm2) 1 color',
    unit: 'ACT',
    prices: { Menudeo: null, M100: 26.9, M350: null, M550: 17.96, M1500: null, M6000: 13.31 },
  }]);
});

// El resto del catalogo es vocabulario del cotizador que Operam no modela (colores,
// texturas, filetes, cajas, aplicacion extra): viaja tal cual desde el complementario.
// tiposProducto si se deriva, de los articulos que Operam tiene vivos.
test('construirCatalogo: el vocabulario viene del complementario y los tipos se derivan de Operam', () => {
  const comp = {
    ...COMPLEMENTO,
    aplicacionExtra: { name: 'Aplicación extra', prices: { M100: 7 } },
    boxMap: [{ modelo: 'PV08', peso_g: 47, caja: 'EMPVA056P', pz_por_caja: 1 }],
    colores: { B1: 'Blanco' },
    texturas: { 1: 'solido' },
    filetes: { 1: '', 2: 's/filetes' },
    colorFiletes: { 1: 'Negro' },
    tiposNombre: { PV08: 'Portavasos 8 cm' },
  };
  const { catalogo } = construirCatalogo({
    salesTypes: SALES_TYPES,
    precios: [fila('PV08B1001111', '12', 100)],
    items: [{ stock_id: 'PV08B1001111', description: 'Portavasos 8 blanco' }],
    complemento: comp,
    extracted: '2026-08-04T00:00:00.000Z',
  });
  assert.deepEqual(Object.keys(catalogo).sort(), [
    'aplicacionExtra', 'boxMap', 'calcas', 'colorFiletes', 'colores', 'extracted', 'filetes',
    'products', 'skus', 'texturas', 'tiers', 'tiposNombre', 'tiposProducto', 'version',
  ]);
  assert.equal(catalogo.version, '2026.ABRIL');
  assert.equal(catalogo.extracted, '2026-08-04T00:00:00.000Z');
  assert.deepEqual(catalogo.aplicacionExtra, comp.aplicacionExtra);
  assert.deepEqual(catalogo.boxMap, comp.boxMap);
  assert.deepEqual(catalogo.colores, comp.colores);
  assert.deepEqual(catalogo.texturas, comp.texturas);
  assert.deepEqual(catalogo.filetes, comp.filetes);
  assert.deepEqual(catalogo.colorFiletes, comp.colorFiletes);
  assert.deepEqual(catalogo.tiposNombre, comp.tiposNombre);
  assert.deepEqual(catalogo.tiposProducto, ['PV']);
  assert.deepEqual(catalogo.tiers.map(t => t.id), ['Menudeo', 'M100', 'M350', 'M550', 'M1500', 'M6000']);
  assert.deepEqual(catalogo.tiers[1], { id: 'M100', label: '100+ pzs', min_qty: 100 });
});

// El reporte de paridad es la red del corte (#131): dice, contra el catalogo vigente,
// que clave cuadra, cual cobra distinto en Operam y cual ya no tiene articulo con
// precio. Se compara SIEMPRE por igualdad contra las constantes de estado.
test('paridad: clasifica MATCH, MISMATCH y SIN_SKU contra el catalogo de referencia', () => {
  const items = [
    { stock_id: 'PV08B1001111', description: 'Portavasos 8 blanco' },
    { stock_id: 'PV08N1001111', description: 'Portavasos 8 negro' },
  ];
  const referencia = {
    products: [
      { key: 'PV08A', name: 'PV08 Portavasos', prices: { Menudeo: 100, M100: 70, M350: 60, M550: 50, M1500: 45, M6000: 40 } },
      { key: 'VT05A', name: 'VT05 Tequilero', prices: { Menudeo: 68, M100: 47.6, M350: 40.8, M550: 34, M1500: 30.6, M6000: 27.2 } },
    ],
  };
  const { paridad } = construirCatalogo({
    salesTypes: SALES_TYPES,
    precios: [fila('PV08B1001111', '12', 100), fila('PV08N1001111', '12', 100)],
    items,
    complemento: COMPLEMENTO,
    referencia,
  });
  const pv = paridad.productos.find(p => p.key === 'PV08A');
  assert.equal(pv.estado, ESTADOS_PARIDAD.MATCH);
  const vt = paridad.productos.find(p => p.key === 'VT05A');
  assert.equal(vt.estado, ESTADOS_PARIDAD.SIN_SKU, 'la clave sin articulo con precio en Operam');
  assert.equal(paridad.resumen.MATCH, 1);
  assert.equal(paridad.resumen.SIN_SKU, 1);
});

test('paridad: un precio distinto en Operam es MISMATCH y dice en que lista difiere', () => {
  const referencia = {
    products: [{ key: 'PV08A', name: 'PV08 Portavasos', prices: { Menudeo: 64.66, M100: 45.26, M350: 38.79, M550: 32.33, M1500: 29.09, M6000: 25.86 } }],
  };
  const { paridad } = construirCatalogo({
    salesTypes: SALES_TYPES,
    precios: [fila('PV08B1001111', '12', 60.34)],
    items: [{ stock_id: 'PV08B1001111', description: 'Portavasos 8 blanco' }],
    complemento: COMPLEMENTO,
    referencia,
  });
  const pv = paridad.productos.find(p => p.key === 'PV08A');
  assert.equal(pv.estado, ESTADOS_PARIDAD.MISMATCH);
  assert.equal(pv.diferencias.length, 6);
  assert.deepEqual(pv.diferencias[0], { tier: 'Menudeo', referencia: 64.66, operam: 60.34 });
  assert.equal(paridad.resumen.MISMATCH, 1);
});

// Una fila de precio cuyo stock_id ya no existe en el maestro de articulos es basura
// del ERP: no se puede cotizar y hay que verla para limpiarla.
test('paridad: una fila de precio sin articulo en el maestro se reporta como huerfana', () => {
  const { paridad } = construirCatalogo({
    salesTypes: SALES_TYPES,
    precios: [fila('PV08B1001111', '12', 100), fila('PV08FANTASMA1', '12', 55)],
    items: [{ stock_id: 'PV08B1001111', description: 'Portavasos 8 blanco' }],
    complemento: COMPLEMENTO,
    referencia: { products: [] },
  });
  assert.deepEqual(paridad.huerfanas, [{ stock_id: 'PV08FANTASMA1', sales_type_id: '12', price: 55 }]);
  assert.equal(paridad.resumen.huerfanas, 1);
});

// Lo que Operam tiene y el catalogo vigente no: claves nuevas (incluidos los paquetes,
// que hasta hoy colgaban de la pieza) y claves con articulos con precio pero sin ficha
// en el complementario -- estas ultimas no entran al catalogo hasta que alguien les
// escriba nombre y nombre en ingles (los pide GS1), y la lista es el pendiente.
test('paridad: reporta las claves nuevas y las que esperan ficha en el complementario', () => {
  const items = [
    { stock_id: 'PV08B1001111', description: 'Portavasos 8 blanco' },
    { stock_id: 'PV08B10011114', description: 'Paquete de 4' },
    { stock_id: 'TA14B1001111', description: 'Tazon 14 blanco' },
  ];
  const { catalogo, paridad } = construirCatalogo({
    salesTypes: SALES_TYPES,
    precios: items.map(i => fila(i.stock_id, '12', 100)),
    items,
    complemento: COMPLEMENTO,
    referencia: { products: [{ key: 'PV08A', name: 'PV08 Portavasos', prices: { Menudeo: 100, M100: 70, M350: 60, M550: 50, M1500: 45, M6000: 40 } }] },
  });
  assert.deepEqual(paridad.productos.filter(p => p.estado === ESTADOS_PARIDAD.NUEVO).map(p => p.key), ['PV08AP4']);
  assert.deepEqual(paridad.sinFicha, [{ key: 'TA14A', skus: 1 }]);
  assert.equal(catalogo.products.find(p => p.key === 'TA14A'), undefined, 'sin ficha no entra al catalogo');
});

// La familia va CAL<tintas><cm2>: CAL1025 es 1 tinta 25 cm2 y llega hasta CAL8200
// (8 tintas). Fuera quedan las CAL00xx (marca y artistas) y los codigos con sufijo.
test('construirCatalogo: la familia de calcas cubre de 1 a 8 tintas, no las CAL00xx', () => {
  const codigos = ['CAL1025', 'CAL8200', 'CAL0009', 'CAL1025S'];
  const { catalogo } = construirCatalogo({
    salesTypes: SALES_TYPES,
    precios: codigos.map(c => fila(c, '15', 30)),
    items: codigos.map(c => ({ stock_id: c, description: 'Calca ' + c })),
    complemento: COMPLEMENTO,
  });
  assert.deepEqual(catalogo.calcas.map(c => c.code), ['CAL1025', 'CAL8200']);
});

// Las calcas tambien se comparan contra el catalogo vigente: es lo que desbloquea #91.
test('paridad: las calcas se clasifican igual que los productos', () => {
  const referencia = {
    products: [],
    calcas: [
      { code: 'CAL1025', name: 'Calca chica', prices: { Menudeo: null, M100: 26.9, M350: null, M550: null, M1500: null, M6000: null } },
      { code: 'CAL9999', name: 'Calca que ya no existe', prices: { M100: 10 } },
    ],
  };
  const { paridad } = construirCatalogo({
    salesTypes: SALES_TYPES,
    precios: [fila('CAL1025', '15', 26.9), fila('CAL2050', '15', 40)],
    items: [
      { stock_id: 'CAL1025', description: 'Calca chica' },
      { stock_id: 'CAL2050', description: 'Calca 2 tintas mediana' },
    ],
    complemento: COMPLEMENTO,
    referencia,
  });
  assert.equal(paridad.calcas.find(c => c.code === 'CAL1025').estado, ESTADOS_PARIDAD.MATCH);
  assert.equal(paridad.calcas.find(c => c.code === 'CAL9999').estado, ESTADOS_PARIDAD.SIN_SKU);
  assert.equal(paridad.calcas.find(c => c.code === 'CAL2050').estado, ESTADOS_PARIDAD.NUEVO);
});

// === Reconstruccion del catalogo vigente desde volcados REALES de Operam ===
// Fixtures: los tres volcados del 2026-08-03 (sales_types, prices_list completo e
// inventory/items completo), recortados a los campos que el nucleo lee. La referencia
// es el data/precios.json vigente (2026.ABRIL, extraido del Excel) y el complementario
// es el que se congelo de el. Es la prueba de que el catalogo se puede generar desde
// Operam sin tocar el Excel -- y de que las diferencias que quedan son las del ERP,
// no del generador.
const dumps = (() => {
  const leer = (...partes) => JSON.parse(leerArchivoSync(join(__dirname, ...partes)));
  return {
    salesTypes: leer('fixtures', 'operam-sales-types.json'),
    precios: leer('fixtures', 'operam-prices-list.json'),
    items: leer('fixtures', 'operam-items.json'),
    complemento: leer('..', 'data', 'catalogo-complemento.json'),
    referencia: leer('..', 'data', 'precios.json'),
  };
})();

function construirDesdeDumps() {
  return construirCatalogo({ ...dumps, extracted: '2026-08-04T00:00:00.000Z' });
}

test('reconstruccion: los SKUs del catalogo vigente se recuperan con las mismas partes', () => {
  const { catalogo } = construirDesdeDumps();
  const vigentes = new Map(dumps.referencia.skus.map(s => [s.sku, s]));
  const compartidos = catalogo.skus.filter(s => vigentes.has(s.sku));
  assert.ok(compartidos.length >= 1040, `se esperaban >=1040 SKUs compartidos, hubo ${compartidos.length}`);

  const distintos = [];
  for (const s of compartidos) {
    const v = vigentes.get(s.sku);
    for (const campo of ['tipo', 'tamano', 'color1', 'color2', 'textura', 'capas', 'filetes', 'colorRiso', 'nombre']) {
      if (campo === 'nombre') continue; // el nombre lo manda Operam, no el Excel
      if (String(v[campo]) !== String(s[campo])) distintos.push({ sku: s.sku, campo, vigente: v[campo], generado: s[campo] });
    }
  }
  assert.deepEqual(distintos, [], 'ningun SKU compartido puede cambiar de partes');

  // La UNICA clave de precio que cambia es la de los paquetes: dejan de colgar de la
  // pieza (bug (b) del triage) y pasan a su propia clave.
  const cambioDeClave = compartidos.filter(s => vigentes.get(s.sku).priceKey !== s.priceKey);
  assert.ok(cambioDeClave.length > 0);
  for (const s of cambioDeClave) {
    assert.match(s.priceKey, /P\d$/, `${s.sku} solo puede cambiar de clave por ser paquete`);
    assert.equal(s.priceKey.replace(/P\d$/, ''), vigentes.get(s.sku).priceKey);
  }

  // Los SKUs del Excel que no se recuperan son codigos legacy que ya NO existen en el
  // maestro de articulos de Operam: no se pueden cotizar.
  const generados = new Set(catalogo.skus.map(s => s.sku));
  const enOperam = new Set(dumps.items.map(i => i.stock_id));
  const perdidos = dumps.referencia.skus.filter(s => !generados.has(s.sku) && enOperam.has(s.sku));
  assert.deepEqual(perdidos, [], 'ningun articulo vivo en Operam puede caerse del catalogo');
});

test('reconstruccion: products y calcas cuadran con el catalogo vigente salvo lo que el ERP tiene distinto', () => {
  const { catalogo, paridad } = construirDesdeDumps();
  assert.equal(catalogo.version, '2026.ABRIL');
  assert.equal(catalogo.extracted, '2026-08-04T00:00:00.000Z');
  assert.deepEqual(catalogo.tiposProducto, dumps.referencia.tiposProducto);
  assert.deepEqual(catalogo.boxMap, dumps.referencia.boxMap);
  assert.deepEqual(catalogo.colores, dumps.referencia.colores);
  assert.deepEqual(catalogo.aplicacionExtra, dumps.referencia.aplicacionExtra);

  // 51 claves cuadran al centavo en las 6 listas. Las 4 MISMATCH son los precios
  // viejos que siguen en el ERP (hallazgo (a) del triage: PV08A y las 3 vajillas p/4)
  // y las 28 SIN_SKU son claves de la lista 2026 que Operam todavia no puede preciar.
  assert.equal(paridad.resumen.MATCH, 51);
  assert.deepEqual(paridad.productos.filter(p => p.estado === ESTADOS_PARIDAD.MISMATCH).map(p => p.key), ['PV08A', 'VJ04A', 'VJ04B', 'VJ04C']);
  assert.equal(paridad.resumen.SIN_SKU, 28);
  assert.equal(paridad.resumen.MATCH + paridad.resumen.MISMATCH + paridad.resumen.SIN_SKU, dumps.referencia.products.length);

  // Lo nuevo son los 6 paquetes, que hasta hoy se cotizaban al precio de una pieza.
  const nuevos = paridad.productos.filter(p => p.estado === ESTADOS_PARIDAD.NUEVO);
  assert.equal(nuevos.length, 6);
  for (const n of nuevos) assert.match(n.key, /P4$/);

  // Las 16 calcas del catalogo vigente existen en Operam (desbloquea #91) y ademas
  // hay 16 mas (5 a 8 tintas). Su unica diferencia son las listas que Operam no precia.
  const codigosVigentes = new Set(dumps.referencia.calcas.map(c => c.code));
  assert.equal(catalogo.calcas.filter(c => codigosVigentes.has(c.code)).length, 16);
  assert.equal(paridad.calcas.filter(c => c.estado === ESTADOS_PARIDAD.SIN_SKU).length, 0);
  const diferenciasCalcas = paridad.calcas.flatMap(c => c.diferencias);
  assert.ok(diferenciasCalcas.length > 0);
  for (const d of diferenciasCalcas) {
    assert.equal(d.operam, null, 'una calca solo puede diferir en la lista que Operam no precia');
  }

  // Filas de precio sin articulo en el maestro: existen y hay que verlas.
  assert.ok(paridad.huerfanas.length > 100);
  assert.equal(paridad.huerfanas.every(h => Number(h.price) > 0), true);
});
