'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let MAX_DESCRIPCION, MENSAJE_LARGA, validarDescripcionLinea, validarDescripcionesCotizacion;
before(async () => {
  ({
    MAX_DESCRIPCION, MENSAJE_LARGA, validarDescripcionLinea, validarDescripcionesCotizacion,
  } = await import('../descripcion-logica.js'));
});

// === Captura del vendedor (#139) ===

test('el texto capturado se queda como descripcion de la partida', () => {
  const r = validarDescripcionLinea('Tazon 14 cm, esmaltado a mano, color mostaza', 'Tazon 14 mostaza filete negro');
  assert.equal(r.ok, true);
  assert.equal(r.descripcion, 'Tazon 14 cm, esmaltado a mano, color mostaza');
  assert.equal(r.editada, true);
});

// La marca "editada" es lo que decide si el robot de la web legacy corre la ronda de
// edicion por linea al actualizar el quote: dejar el texto del catalogo intacto no
// cuesta 2 POSTs de mas por partida.
test('dejar el texto del catalogo tal cual no cuenta como edicion', () => {
  const r = validarDescripcionLinea('Tazon 14 mostaza filete negro', 'Tazon 14 mostaza filete negro');
  assert.equal(r.ok, true);
  assert.equal(r.editada, false);
  assert.equal(r.descripcion, 'Tazon 14 mostaza filete negro');
});

// Vaciar el campo es como el vendedor deshace su edicion: no deja la partida sin
// describir en el documento ni en el ERP, la regresa a la del catalogo.
test('vaciar el campo regresa a la descripcion del catalogo', () => {
  for (const vacio of ['', '   ', null, undefined]) {
    const r = validarDescripcionLinea(vacio, 'Tazon 14 mostaza filete negro');
    assert.equal(r.ok, true, `${JSON.stringify(vacio)} deberia aceptarse`);
    assert.equal(r.descripcion, 'Tazon 14 mostaza filete negro');
    assert.equal(r.editada, false);
  }
});

test('los espacios de sobra no convierten el texto del catalogo en una edicion', () => {
  const r = validarDescripcionLinea('  Tazon 14 mostaza filete negro  ', 'Tazon 14 mostaza filete negro');
  assert.equal(r.editada, false);
});

// 1000 es el maxlength REAL del textarea item_description de Operam (fixture
// quote-1216-form-edit0.html): pasarse no es una preferencia de estilo, es un texto
// que el ERP no puede guardar.
test('el limite es el del textarea de Operam y se frena con su mensaje', () => {
  assert.equal(MAX_DESCRIPCION, 1000);
  const justo = 'a'.repeat(MAX_DESCRIPCION);
  assert.equal(validarDescripcionLinea(justo, 'x').ok, true);
  const larga = 'a'.repeat(MAX_DESCRIPCION + 1);
  const r = validarDescripcionLinea(larga, 'x');
  assert.equal(r.ok, false);
  assert.equal(r.mensaje, MENSAJE_LARGA);
});

// Los saltos de linea del textarea no cuentan distinto: lo que importa es que quepa.
test('un texto multilinea es una descripcion valida', () => {
  const r = validarDescripcionLinea('Tazon 14\nEsmaltado a mano', 'Tazon 14');
  assert.equal(r.ok, true);
  assert.equal(r.descripcion, 'Tazon 14\nEsmaltado a mano');
  assert.equal(r.editada, true);
});

// Los espacios de sobra de la captura no pueden viajar al documento del cliente ni
// al quote de Operam.
test('el texto editado se guarda recortado', () => {
  const r = validarDescripcionLinea('  Tazon 14 cm esmaltado a mano  ', 'Tazon 14 mostaza filete negro');
  assert.equal(r.editada, true);
  assert.equal(r.descripcion, 'Tazon 14 cm esmaltado a mano');
});

// === El servidor no confia en la pantalla (misma regla, dos consumidores) ===

test('una cotizacion con una descripcion mas larga que el limite se rechaza nombrando la partida', () => {
  const items = [
    { codigo: 'TA14Y31111', descripcion: 'ok' },
    { codigo: 'VA05Y4001120', descripcion: 'a'.repeat(MAX_DESCRIPCION + 1) },
  ];
  const r = validarDescripcionesCotizacion(items);
  assert.equal(r.ok, false);
  assert.match(r.mensaje, /VA05Y4001120/);
  assert.match(r.mensaje, new RegExp(String(MAX_DESCRIPCION)));
});

test('una cotizacion con descripciones dentro del limite pasa', () => {
  assert.equal(validarDescripcionesCotizacion([{ codigo: 'X', descripcion: 'corta' }]).ok, true);
  assert.equal(validarDescripcionesCotizacion([]).ok, true);
  assert.equal(validarDescripcionesCotizacion(undefined).ok, true);
});

// === Diseno de calca: la base es el nombre CON su numero (#221, spec #218) ===
// El editor de partida siempre recibe como base nombreVisibleProducto(product.name),
// y en una calca ese nombre ya trae el sufijo "Diseno N" (#220). Vaciar la
// descripcion tiene que regresar ahi y no al nombre pelon del catalogo: una
// partida sin numero es indistinguible de la otra en el documento y en Operam.
test('vaciar la descripcion de un diseno regresa al nombre del catalogo CON su numero', async () => {
  const { productoCalca } = await import('../calcas-logica.js');
  const { nombreVisibleProducto } = await import('../cotizar-logica.js');
  const ficha = {
    code: 'CAL1025S',
    name: 'Calca vitrificable chica (25 cm2) 1 tinta',
    prices: { Menudeo: null, M100: 26.9 },
  };
  const base = nombreVisibleProducto(productoCalca(ficha, 2).name);

  const r = validarDescripcionLinea('   ', base);

  assert.equal(r.ok, true);
  assert.equal(r.editada, false);
  // El rotulo visible lleva enie; va escapada para no romper el ASCII estricto
  // del archivo (CLAUDE.md), que era ASCII puro antes de esta prueba.
  assert.equal(r.descripcion, 'Calca vitrificable chica (25 cm2) 1 tinta - Diseno 2');
});
