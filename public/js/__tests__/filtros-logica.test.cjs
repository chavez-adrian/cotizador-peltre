'use strict';
// #456 (spec #398): el constructor del bloque etiqueta+selector. Molde: el
// filtro de Evento del pipeline (#261) y los botones de Rescatados. Sin DOM: se
// afirma sobre el HTML que se va a pintar.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let buildFiltrosSelectorHtml, opcionesDeFiltro;
before(async () => {
  ({ buildFiltrosSelectorHtml, opcionesDeFiltro } = await import('../filtros-logica.js'));
});

const VENDEDOR = { vendedor: { etiqueta: 'Vendedor', lee: x => x?.vendedor, procedencia: 'datos' } };

function opcionesDe(html) {
  return [...html.matchAll(/<option value="([^"]*)"( selected)?>([^<]*)<\/option>/g)]
    .map(m => ({ valor: m[1], texto: m[3], selected: !!m[2] }));
}

test('FL1: pinta una opcion por valor presente en los datos, sin repetir y ordenadas, mas "Todos"', () => {
  const items = [{ vendedor: 'Marco' }, { vendedor: 'Laura' }, { vendedor: 'Marco' }, {}];
  const html = buildFiltrosSelectorHtml(items, VENDEDOR, {}, 'historial');
  assert.deepEqual(opcionesDe(html).map(o => [o.valor, o.texto]), [
    ['', 'Todos'], ['Laura', 'Laura'], ['Marco', 'Marco'],
  ]);
  assert.match(html, /<label for="historial-filtro-vendedor">Vendedor<\/label>/);
  assert.match(html, /<select id="historial-filtro-vendedor" data-filtro="vendedor">/);
});

test('FL2: marca la opcion seleccionada, y sin seleccion marca "Todos"', () => {
  const items = [{ vendedor: 'Marco' }, { vendedor: 'Laura' }];
  const conLaura = opcionesDe(buildFiltrosSelectorHtml(items, VENDEDOR, { vendedor: 'Laura' }, 'historial'));
  assert.deepEqual(conLaura.filter(o => o.selected).map(o => o.valor), ['Laura']);
  const sinSeleccion = opcionesDe(buildFiltrosSelectorHtml(items, VENDEDOR, {}, 'historial'));
  assert.deepEqual(sinSeleccion.filter(o => o.selected).map(o => o.valor), ['']);
});

test('FL3: escapa el texto de las opciones, del valor y de la etiqueta', () => {
  const items = [{ vendedor: '<b>"Ana" & Co</b>' }, { vendedor: "O'Hara" }];
  const filtros = { vendedor: { ...VENDEDOR.vendedor, etiqueta: 'Vendedor <x>' } };
  const html = buildFiltrosSelectorHtml(items, filtros, { vendedor: "O'Hara" }, 'historial');
  assert.ok(!html.includes('<b>'), 'el valor no se pinta como HTML');
  assert.ok(html.includes('&lt;b&gt;&quot;Ana&quot; &amp; Co&lt;/b&gt;'));
  assert.ok(html.includes('<option value="O&#39;Hara" selected>O&#39;Hara</option>'));
  assert.ok(html.includes('Vendedor &lt;x&gt;'));
});

test('FL4: un filtro derivado de los datos con una sola opcion no se pinta', () => {
  // el vendedor que solo ve sus registros no necesita un selector de una persona
  assert.equal(buildFiltrosSelectorHtml([{ vendedor: 'Laura' }, { vendedor: 'Laura' }], VENDEDOR, {}, 'historial'), '');
  assert.equal(buildFiltrosSelectorHtml([], VENDEDOR, {}, 'historial'), '');
  assert.equal(buildFiltrosSelectorHtml([{}], VENDEDOR, {}, 'historial'), '');
});

test('FL5: el catalogo cerrado y las constantes de la vista se ofrecen completos aunque ningun registro los use', () => {
  const filtros = {
    origen: { etiqueta: 'Origen', lee: x => x.origen, procedencia: 'catalogo', valores: ['WhatsApp', 'Instagram'] },
    estado: { etiqueta: 'Estado', lee: x => x.estado, procedencia: 'vista',
      valores: [{ valor: 'abierta', texto: 'Abierta' }] },
  };
  const html = buildFiltrosSelectorHtml([], filtros, { estado: 'abierta' }, 'historial');
  const origen = html.slice(html.indexOf('data-filtro="origen"'), html.indexOf('data-filtro="estado"'));
  assert.deepEqual(opcionesDe(origen).map(o => o.valor), ['', 'WhatsApp', 'Instagram']);
  const estado = html.slice(html.indexOf('data-filtro="estado"'));
  assert.deepEqual(opcionesDe(estado).map(o => [o.valor, o.texto, o.selected]),
    [['', 'Todos', false], ['abierta', 'Abierta', true]]);
  // un solo valor en un catalogo SI se pinta: la regla de ocultar es de los derivados
  assert.match(html, /<label for="historial-filtro-estado">Estado<\/label>/);
});

test('FL6: un campo multi-valor aporta cada uno de sus valores como opcion', () => {
  const filtros = { area: { etiqueta: 'Area de interes', lee: x => x.areas, procedencia: 'datos' } };
  const items = [{ areas: ['Hoteleria', 'Alimentos'] }, { areas: ['Alimentos'] }, { areas: [] }];
  assert.deepEqual(opcionesDeFiltro(filtros.area, items), [
    { valor: 'Alimentos', texto: 'Alimentos' }, { valor: 'Hoteleria', texto: 'Hoteleria' },
  ]);
});

test('FL7: los bloques salen en el orden declarado, dentro de una sola rejilla', () => {
  const filtros = {
    vendedor: VENDEDOR.vendedor,
    estado: { etiqueta: 'Estado', lee: x => x.estado, procedencia: 'vista', valores: ['abierta'] },
  };
  const html = buildFiltrosSelectorHtml([{ vendedor: 'A' }, { vendedor: 'B' }], filtros, {}, 'hoy');
  assert.ok(html.startsWith('<div class="filtros-selector">'));
  assert.equal(html.match(/class="filtro-selector"/g).length, 2);
  assert.ok(html.indexOf('hoy-filtro-vendedor') < html.indexOf('hoy-filtro-estado'));
});

// El contador tras filtrar: "cuantos registros quedan" (US 12 de la spec).
let buildContadorHtml;
before(async () => {
  ({ buildContadorHtml } = await import('../filtros-logica.js'));
});

const COTIZACION = { uno: 'cotizaci&oacute;n', varios: 'cotizaciones' };

test('FL8: el contador dice cuantos quedan y, si el filtro recorto, de cuantos', () => {
  assert.equal(buildContadorHtml(101, 101, COTIZACION), '<strong>101</strong> cotizaciones');
  assert.equal(buildContadorHtml(3, 101, COTIZACION), '<strong>3</strong> de 101 cotizaciones');
  assert.equal(buildContadorHtml(0, 101, COTIZACION), '<strong>0</strong> de 101 cotizaciones');
  assert.equal(buildContadorHtml(1, 1, COTIZACION), '<strong>1</strong> cotizaci&oacute;n');
  assert.equal(buildContadorHtml(0, 0, COTIZACION), '<strong>0</strong> cotizaciones');
});

// --- La rejilla del Historial: su declaracion pasada por el constructor ---
let BUSCABLES_COTIZACION, CANALES;
before(async () => {
  ({ BUSCABLES_COTIZACION } = await import('../cotizaciones-logica.js'));
  ({ CANALES } = await import('../prospectos-logica.js'));
});

function selectDe(html, campo) {
  const inicio = html.indexOf(`data-filtro="${campo}"`);
  if (inicio < 0) return null;
  return opcionesDe(html.slice(inicio, html.indexOf('</select>', inicio)));
}

test('FH1: el Historial ofrece Vendedor, Origen y Estado, en ese orden', () => {
  const cots = [
    { vendedor: 'Laura', origen: 'Instagram', estado: 'abierta' },
    { vendedor: 'Adri00e1n Ch00e1vez', origen: '', estado: 'ganada' },
  ];
  const html = buildFiltrosSelectorHtml(cots, BUSCABLES_COTIZACION.filtros, {}, 'historial');
  const etiquetas = [...html.matchAll(/<label [^>]*>([^<]*)<\/label>/g)].map(m => m[1]);
  assert.deepEqual(etiquetas, ['Vendedor', 'Origen', 'Estado']);
  assert.deepEqual(selectDe(html, 'vendedor').map(o => o.valor), ['', 'Adri00e1n Ch00e1vez', 'Laura']);
  // el Origen es el catalogo cerrado completo, no solo el que trae el listado
  assert.deepEqual(selectDe(html, 'origen').map(o => o.valor).slice(1), CANALES);
  assert.deepEqual(selectDe(html, 'estado').map(o => [o.valor, o.texto]),
    [['', 'Todos'], ['abierta', 'Abierta'], ['ganada', 'Ganada'], ['perdida', 'Perdida']]);
});

test('FH2: el vendedor que solo ve sus cotizaciones no recibe selector de Vendedor', () => {
  const cots = [{ vendedor: 'Laura', estado: 'abierta' }, { vendedor: 'Laura', estado: 'ganada' }];
  const html = buildFiltrosSelectorHtml(cots, BUSCABLES_COTIZACION.filtros, {}, 'historial');
  assert.equal(selectDe(html, 'vendedor'), null);
  assert.ok(selectDe(html, 'origen'));
  assert.ok(selectDe(html, 'estado'));
});
