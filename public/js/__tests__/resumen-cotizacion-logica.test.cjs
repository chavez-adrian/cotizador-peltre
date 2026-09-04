'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let mensajeCotizacion, motivoSinResumen, LEYENDA_SIN_FOLIO;
before(async () => {
  ({ mensajeCotizacion, motivoSinResumen, LEYENDA_SIN_FOLIO } = await import('../resumen-cotizacion-logica.js'));
});

test('R1: el mensaje nombra al cliente, su total y liga al documento HTML de la cotizacion', () => {
  const msg = mensajeCotizacion({ id: 42, cliente: 'Hotel Azul', total: 12345.5, folioOperam: 928 }, 'https://cotizador.example');
  assert.ok(msg.texto.includes('Hotel Azul'));
  assert.ok(msg.texto.includes('$12,345.50'));
  assert.ok(msg.texto.includes('https://cotizador.example/api/cotizacion/html/42'));
  assert.ok(!msg.texto.includes('/api/cotizacion/pdf/'));
});

// Un registro sin id no tiene documento que citar: no hay nada que compartir.
// #311: tampoco sin folio de Operam, sea cual sea el motivo por el que falta.
test('R2: sin id o sin folio de Operam no hay mensaje', () => {
  assert.equal(mensajeCotizacion({ cliente: 'Hotel Azul', total: 100, folioOperam: 928 }, 'https://cotizador.example'), null);
  assert.equal(mensajeCotizacion({ id: '', cliente: 'Hotel Azul', folioOperam: 928 }, 'https://cotizador.example'), null);
  assert.equal(mensajeCotizacion(null, 'https://cotizador.example'), null);
  assert.equal(mensajeCotizacion({ id: 42, cliente: 'Hotel Azul' }, 'https://cotizador.example'), null);
});

test('R3: waUrl es el texto codificado para wa.me', () => {
  const msg = mensajeCotizacion({ id: 42, cliente: 'Hotel Azul & Mar', total: 12345.5, folioOperam: 928 }, 'https://cotizador.example');
  assert.match(msg.waUrl, /^https:\/\/wa\.me\/\?text=/);
  assert.equal(decodeURIComponent(msg.waUrl.split('text=')[1]), msg.texto);
  assert.ok(!msg.waUrl.includes(' '));
  assert.ok(!msg.waUrl.includes('&'));
});

// Sin cliente el mensaje sigue siendo mandable: el documento manda, no el
// formulario a medio llenar.
test('R4: sin nombre de cliente el mensaje dice "Cliente" y el total ausente sale en 0.00', () => {
  const msg = mensajeCotizacion({ id: 7, folioOperam: 928 }, 'https://cotizador.example');
  assert.ok(msg.texto.includes('Cliente: Cliente'));
  assert.ok(msg.texto.includes('Total: $0.00'));
  assert.ok(msg.texto.includes('https://cotizador.example/api/cotizacion/html/7'));
});

// #311: la regla "sin numero no hay mensaje" vive en un solo lugar, para que el
// historial y la cotizacion recien generada no puedan discrepar.
test('R5: motivoSinResumen exige id y folio de Operam para poder compartir', () => {
  assert.equal(motivoSinResumen({ id: 42, folioOperam: 928 }), null);
  assert.equal(motivoSinResumen({ id: 42, folioOperam: null }), LEYENDA_SIN_FOLIO);
  assert.equal(motivoSinResumen({ id: 42 }), LEYENDA_SIN_FOLIO);
  assert.equal(motivoSinResumen({ folioOperam: 928 }), LEYENDA_SIN_FOLIO);
  assert.equal(motivoSinResumen(null), LEYENDA_SIN_FOLIO);
});
