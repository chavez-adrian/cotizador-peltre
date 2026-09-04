'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let mensajeCotizacion;
before(async () => {
  ({ mensajeCotizacion } = await import('../resumen-cotizacion-logica.js'));
});

test('R1: el mensaje nombra al cliente, su total y liga al documento HTML de la cotizacion', () => {
  const msg = mensajeCotizacion({ id: 42, cliente: 'Hotel Azul', total: 12345.5 }, 'https://cotizador.example');
  assert.ok(msg.texto.includes('Hotel Azul'));
  assert.ok(msg.texto.includes('$12,345.50'));
  assert.ok(msg.texto.includes('https://cotizador.example/api/cotizacion/html/42'));
  assert.ok(!msg.texto.includes('/api/cotizacion/pdf/'));
});

// Un registro sin id no tiene documento que citar: no hay nada que compartir.
test('R2: sin id no hay mensaje', () => {
  assert.equal(mensajeCotizacion({ cliente: 'Hotel Azul', total: 100 }, 'https://cotizador.example'), null);
  assert.equal(mensajeCotizacion({ id: '', cliente: 'Hotel Azul' }, 'https://cotizador.example'), null);
  assert.equal(mensajeCotizacion(null, 'https://cotizador.example'), null);
});

test('R3: waUrl es el texto codificado para wa.me', () => {
  const msg = mensajeCotizacion({ id: 42, cliente: 'Hotel Azul & Mar', total: 12345.5 }, 'https://cotizador.example');
  assert.match(msg.waUrl, /^https:\/\/wa\.me\/\?text=/);
  assert.equal(decodeURIComponent(msg.waUrl.split('text=')[1]), msg.texto);
  assert.ok(!msg.waUrl.includes(' '));
  assert.ok(!msg.waUrl.includes('&'));
});

// Sin cliente el mensaje sigue siendo mandable: el documento manda, no el
// formulario a medio llenar.
test('R4: sin nombre de cliente el mensaje dice "Cliente" y el total ausente sale en 0.00', () => {
  const msg = mensajeCotizacion({ id: 7 }, 'https://cotizador.example');
  assert.ok(msg.texto.includes('Cliente: Cliente'));
  assert.ok(msg.texto.includes('Total: $0.00'));
  assert.ok(msg.texto.includes('https://cotizador.example/api/cotizacion/html/7'));
});
