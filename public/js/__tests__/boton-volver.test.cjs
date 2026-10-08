'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Boton Volver unico (#200, especificacion aprobada por Adrian 2026-10-08): los
// 6 de la barra de vista y los 7 que estaban abajo de un paso (.pc-back) son UN
// componente -- pastilla con flecha + texto, a la izquierda, ANTES del titulo.
// Sin DOM en Node: el helper se prueba directo y el resto se lee del fuente.

let VOLVER;
before(async () => {
  VOLVER = await import('../volver-logica.js');
});

const leer = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n');
const html = leer('..', 'index.html');
const css = leer('..', 'css', 'style.css');
const app = leer('app.js');

function cuerpoDeFuncionApp(nombre) {
  const inicio = app.indexOf(nombre);
  assert.ok(inicio > 0, `${nombre} debe existir en app.js`);
  const fin = app.indexOf('\n}\n', inicio);
  assert.ok(fin > inicio, `no se pudo delimitar el cuerpo de ${nombre}`);
  return app.slice(inicio, fin);
}

function reglaCss(selector) {
  const limpio = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const esc = selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&');
  const bloques = [...limpio.matchAll(new RegExp('(?:^|[}\\s])' + esc + '\\s*\\{([^}]*)\\}', 'gm'))];
  return bloques.length ? bloques.map(m => m[1]).join(';').replace(/\s+/g, ' ') : null;
}

test('V1: el helper arma la pastilla del paso con flecha SVG, texto y onclick', () => {
  const b = VOLVER.botonVolverHtml({ texto: 'Volver', onclick: 'pcRenderInicio()' });
  assert.match(b, /^<button type="button" class="volver volver-paso" onclick="pcRenderInicio\(\)">/);
  assert.match(b, /<svg[^>]*aria-hidden="true"/);
  assert.match(b, /<\/svg>Volver<\/button>$/);
  assert.ok(!b.includes('&lsaquo;'), 'la flecha es el SVG, ya no el caracter');
});

test('V2: el texto se escapa', () => {
  const b = VOLVER.botonVolverHtml({ texto: 'A & <b>', onclick: 'x()' });
  assert.ok(b.includes('A &amp; &lt;b&gt;</button>'));
});

const BARRA = ['btn-volver-hoy', 'btn-volver-prospectos', 'btn-volver-app', 'btn-volver-clientes', 'btn-volver-bandeja', 'btn-volver-expo'];

test('V3: los 6 botones de barra van primero en su header, antes del h1, como pastilla', () => {
  for (const id of BARRA) {
    const re = new RegExp('<header class="historial-header con-volver">\\s*<button type="button" class="volver volver-barra" id="' + id + '">Volver</button>\\s*<h1[ >]');
    assert.match(html, re, `${id}: pastilla antes del titulo`);
  }
  assert.ok(!/btn-volver-[a-z]+"[^>]*>[^<]*<\/button>\s*<\/header>/.test(html), 'ningun Volver queda a la derecha del h1');
});

const PASOS = [
  ['async function pcCaminoBuscar(', 'Volver', 'pcRenderInicio()'],
  ['function pcCaminoNuevo(', 'Volver', 'pcRenderInicio()'],
  ['function pcRenderTarjeta(', 'Cambiar de cliente', 'pcRenderInicio()'],
  ['function cvRenderTarjeta(', 'Buscar otro', 'cvRenderBusqueda()'],
  ['function cvUpgradeClienteOperam(', 'Volver al contacto', 'cvVolverATarjeta()'],
  ['function cvCaminoAlta(', 'Cancelar', 'cvRenderBusqueda()'],
  ['function cvAbrirUpgrade(', 'Volver al cliente', 'cvVolverATarjeta()'],
];

test('V4: los 7 botones de paso usan el helper con su texto y destino, ARRIBA del titulo', () => {
  for (const [fn, texto, onclick] of PASOS) {
    const cuerpo = cuerpoDeFuncionApp(fn);
    const llamada = `botonVolverHtml({ texto: '${texto}', onclick: '${onclick}' })`;
    assert.ok(cuerpo.includes(llamada), `${fn} debe armar ${llamada}`);
    assert.ok(/root\.innerHTML =\s*botonVolverHtml\(/.test(cuerpo),
      `${fn}: la pastilla es lo primero del paso, antes de .pc-pregunta (y del aviso, si lo hay)`);
  }
});

test('V5: no queda rastro del boton viejo', () => {
  assert.ok(!app.includes('pc-back'), 'app.js sin .pc-back');
  assert.ok(!app.includes('&lsaquo;'), 'app.js sin la flecha de caracter');
  assert.equal(reglaCss('.pc-back'), null, 'style.css sin .pc-back');
  assert.ok(!css.includes('.historial-header .btn-secondary'), 'el estilo del boton viejo de barra se retira');
  assert.ok(css.includes('.app-header .btn-secondary'), 'el del header de la app se conserva');
});

test('V6: el icono de los botones estaticos sale del mismo modulo al arrancar', () => {
  assert.match(app, /querySelectorAll\('button\.volver'\)[\s\S]{0,120}insertAdjacentHTML\('afterbegin', ICONO_VOLVER\)/);
});

test('V7: pastilla de 30 px con area tactil de 44 y barra que no crece', () => {
  const v = reglaCss('.volver');
  assert.ok(v && v.includes('height: 30px') && v.includes('padding: 0 10px 0 5px') && v.includes('border-radius: var(--radius-input)'));
  assert.ok(v.includes('font-size: 13px') && v.includes('font-weight: 600'));
  assert.ok((reglaCss('.volver::before') || '').includes('inset: -7px -4px'));
  const h1 = reglaCss('.historial-header.con-volver h1');
  for (const d of ['flex: 1', 'min-width: 0', 'white-space: nowrap', 'overflow: hidden', 'text-overflow: ellipsis']) {
    assert.ok(h1 && h1.includes(d), `titulo: ${d}`);
  }
  assert.ok((reglaCss('.historial-header.con-volver') || '').includes('padding: 9px 16px 9px 10px'), '9 + 30 + 9 = 48 px');
  assert.ok((reglaCss('.volver-barra') || '').includes('background: rgba(255,255,255,0.15)'));
  assert.ok((reglaCss('.volver-paso') || '').includes('background: var(--white)'));
});

test('V8: a 320 px los filtros Desde/Hasta se encogen en vez de desbordar la vista (#200)', () => {
  // El verificador en produccion (2026-10-08) midio Hoy, Prospectos, Rescatados e
  // Historial en 334-338 px a 320: el label es flex:1 pero sin min-width:0, asi
  // que el input de fecha no bajaba de su ancho natural (~155 px).
  assert.ok((reglaCss('.historial-fechas label') || '').includes('min-width: 0'));
  assert.ok((reglaCss('.historial-fechas input[type="date"]') || '').includes('min-width: 0'));
});
