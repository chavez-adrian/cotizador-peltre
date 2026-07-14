'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

// Logica pura de la vista Clientes (issue #94): mantenimiento de clientes desde
// el cotizador (alta completa + upgrade CSF sin cotizacion). La decision de si un
// RFC es generico, contra que customer_id se hace el upgrade y si procede el boton
// de CSF vive en alta-logica.js (extiende el paso Cliente, no lo copia); el HTML de
// las filas de resultado, la tarjeta, los chips y el banner de upgrade vive en
// pipeline-logica.js (mismo patron de funciones puras testeables). Sin DOM en Node.

let esRfcGenerico, customerIdFiscal, mostrarBotonCsf;
let tagResultadoClienteHtml, filaResultadoClienteHtml, filaCrearClienteHtml,
  bannerUpgradeHtml, chipsClienteViewHtml, cardClienteHtml;

before(async () => {
  ({ esRfcGenerico, customerIdFiscal, mostrarBotonCsf } = await import('../alta-logica.js'));
  ({
    tagResultadoClienteHtml, filaResultadoClienteHtml, filaCrearClienteHtml,
    bannerUpgradeHtml, chipsClienteViewHtml, cardClienteHtml,
  } = await import('../pipeline-logica.js'));
});

// === esRfcGenerico ===

test('G1: XAXX010101000 y XEXX010101000 son genericos (case/espacios ignorados)', () => {
  assert.equal(esRfcGenerico('XAXX010101000'), true);
  assert.equal(esRfcGenerico('xexx010101000'), true);
  assert.equal(esRfcGenerico('  XAXX010101000 '), true);
});

test('G2: un RFC real no es generico; vacio/nulo tampoco', () => {
  assert.equal(esRfcGenerico('VAZ990101QX3'), false);
  assert.equal(esRfcGenerico(''), false);
  assert.equal(esRfcGenerico(null), false);
});

// === customerIdFiscal: contra que cliente de Operam se puede hacer el upgrade ===

test('C1: cliente Operam -> su id', () => {
  assert.equal(customerIdFiscal({ tipo: 'operam', id: 479 }), 479);
});

test('C2: prospecto ya ligado a un generico -> clienteOperamId', () => {
  assert.equal(customerIdFiscal({ tipo: 'prospecto', clienteOperamId: 51 }), 51);
});

test('C3: prospecto sin cotizar / contacto nuevo -> null', () => {
  assert.equal(customerIdFiscal({ tipo: 'prospecto', clienteOperamId: null }), null);
  assert.equal(customerIdFiscal({ tipo: 'nuevo' }), null);
  assert.equal(customerIdFiscal(null), null);
});

// === mostrarBotonCsf: RFC generico + cliente en Operam contra el que actualizar ===

test('B1: Operam con RFC generico -> muestra el boton de CSF', () => {
  assert.equal(mostrarBotonCsf({ tipo: 'operam', id: 479, rfc: 'XAXX010101000' }), true);
});

test('B2: Operam con RFC real -> no muestra el boton', () => {
  assert.equal(mostrarBotonCsf({ tipo: 'operam', id: 10, rfc: 'VAZ990101QX3' }), false);
});

test('B3: prospecto sin cliente en Operam -> no muestra el boton (no hay contra que actualizar)', () => {
  assert.equal(mostrarBotonCsf({ tipo: 'prospecto', clienteOperamId: null, rfc: '' }), false);
});

test('B4: prospecto ligado a un generico -> muestra el boton', () => {
  assert.equal(mostrarBotonCsf({ tipo: 'prospecto', clienteOperamId: 51, rfc: '' }), true);
});

// === tagResultadoClienteHtml ===

test('T1: Operam con RFC generico -> tag rojo "RFC generico"', () => {
  const html = tagResultadoClienteHtml({ tipo: 'operam', rfc: 'XAXX010101000' });
  assert.match(html, /pc-tag generico/);
  assert.match(html, /RFC gen/);
});

test('T2: Operam con RFC real -> tag "Operam"', () => {
  const html = tagResultadoClienteHtml({ tipo: 'operam', rfc: 'VAZ990101QX3' });
  assert.match(html, /pc-tag operam/);
  assert.doesNotMatch(html, /generico/);
});

test('T3: prospecto -> tag "Prospecto"', () => {
  const html = tagResultadoClienteHtml({ tipo: 'prospecto' });
  assert.match(html, /pc-tag prospecto/);
});

// === filaResultadoClienteHtml / filaCrearClienteHtml ===

test('F1: la fila de resultado enlaza a cvElegirResultado por indice e incluye el tag', () => {
  const html = filaResultadoClienteHtml({ tipo: 'operam', nombre: 'Yazmin Vazquez', sub: 'XAXX010101000', rfc: 'XAXX010101000' }, 3);
  assert.match(html, /cvElegirResultado\(3\)/);
  assert.match(html, /pc-res-row/);
  assert.match(html, /Yazmin Vazquez/);
  assert.match(html, /pc-tag generico/);
});

test('F2: la fila de crear abre el alta completa con el query (no un prospecto minimo)', () => {
  const html = filaCrearClienteHtml('yazmin');
  assert.match(html, /pc-crear/);
  assert.match(html, /cvCaminoAlta/);
  assert.match(html, /yazmin/);
  assert.match(html, /alta cliente completo/i);
});

test('F3: filaResultado escapa el nombre (sin XSS)', () => {
  const html = filaResultadoClienteHtml({ tipo: 'prospecto', nombre: '<img src=x>', sub: '' }, 0);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /&lt;img/);
});

// === bannerUpgradeHtml ===

test('N1: el banner nombra al cliente, su id y el RFC generico que se sustituye', () => {
  const html = bannerUpgradeHtml({ nombre: 'Yazmin Vazquez', id: 479, rfc: 'XAXX010101000' });
  assert.match(html, /banner-upgrade/);
  assert.match(html, /Yazmin Vazquez/);
  assert.match(html, /479/);
  assert.match(html, /XAXX010101000/);
  assert.match(html, /No se crea un cliente nuevo/);
});

test('N2: el banner escapa el nombre del cliente', () => {
  const html = bannerUpgradeHtml({ nombre: '<b>x</b>', id: 1, rfc: 'XAXX010101000' });
  assert.doesNotMatch(html, /<b>x<\/b>/);
});

// === chipsClienteViewHtml ===

test('H1: chip Fiscal pendiente con cliente en Operam es accionable (abre el upgrade)', () => {
  const html = chipsClienteViewHtml({ contacto: true, entrega: 'cp', fiscal: false }, 479);
  assert.match(html, /cvAbrirUpgrade\(\)/);
  assert.match(html, /Entrega &middot; CP/);
});

test('H2: chip Fiscal en verde cuando el RFC ya es real (sin boton)', () => {
  const html = chipsClienteViewHtml({ contacto: true, entrega: 'completo', fiscal: true }, 10);
  assert.doesNotMatch(html, /cvAbrirUpgrade/);
  assert.match(html, /Fiscal/);
});

test('H3: sin cliente en Operam el chip Fiscal es estatico (no abre upgrade)', () => {
  const html = chipsClienteViewHtml({ contacto: true, entrega: 'pendiente', fiscal: false }, null);
  assert.doesNotMatch(html, /cvAbrirUpgrade/);
});

// === cardClienteHtml ===

test('D1: Operam generico -> boton CSF + boton Cotizar + ID en el subtitulo', () => {
  const html = cardClienteHtml({ tipo: 'operam', id: 479, name: 'Yazmin Vazquez', rfc: 'XAXX010101000', telefono: '+52 55 1111 2222', cp: '31000', pais: 'MX' });
  assert.match(html, /Completar datos fiscales \(CSF\)/);
  assert.match(html, /cvCotizar\(\)/);
  assert.match(html, /ID 479/);
  assert.match(html, /Cliente en Operam/);
});

test('D2: Operam con RFC real -> sin boton CSF, chips en verde', () => {
  const html = cardClienteHtml({ tipo: 'operam', id: 10, name: 'La Vasija', rfc: 'VAZ990101QX3', telefono: '+52 55 1111 2222', cp: '44100', calle: 'Reforma 10', pais: 'MX' });
  assert.doesNotMatch(html, /Completar datos fiscales/);
  assert.match(html, /cvCotizar\(\)/);
});

test('D3: escapa el nombre del cliente', () => {
  const html = cardClienteHtml({ tipo: 'operam', id: 1, name: '<script>x</script>', rfc: 'XAXX010101000' });
  assert.doesNotMatch(html, /<script>x<\/script>/);
});
