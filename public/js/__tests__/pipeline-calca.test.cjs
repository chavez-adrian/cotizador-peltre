// #532: la calca del Pipeline nace plegada con su avance en el resumen y, al
// abrirse, cada paso es una casilla en linea con su texto. Marcar o desmarcar
// llama al mismo PATCH de paso de calca que Marcar / Revertir (toggleCalcaPaso).
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let L;
before(async () => {
  L = await import('../pipeline-logica.js');
});

function cotizacion(extra) {
  return {
    tipo: 'cotizacion', id: 'c41', refId: 41, hasData: true, nombre: 'Hotel Azul', vendedor: 'Memo',
    total: 5000, etapa: 'seguimiento', folioOperam: '1300', contactoCelular: '+52 5598765432',
    fecha: '2026-09-20T15:00:00Z', ...extra,
  };
}

const TRES_DE_SEIS = [
  { clave: 'cotizacion_proveedor', completo: true },
  { clave: 'posicion_cliente', completo: true },
  { clave: 'arte_final', completo: true },
  { clave: 'dummy_autorizado', completo: false },
  { clave: 'liberacion_produccion', completo: false },
  { clave: 'archivos_dropbox', completo: false },
];

const decorada = extra => cotizacion({ decorado: true, calcaChecklist: TRES_DE_SEIS, ...extra });

function detalles(html) {
  return [...html.matchAll(/<details[^>]*>/g)].map(m => m[0]);
}

function casillas(html) {
  return [...html.matchAll(/<input type="checkbox"([^>]*)>/g)].map(m => m[1]);
}

test('#532 tablero: la calca nace plegada con "Calca 3/6" en el resumen', () => {
  const html = L.buildTableroPipelineHtml([decorada()]);
  const calca = detalles(html).filter(d => d.includes('c41:calca'));
  assert.equal(calca.length, 1);
  assert.equal(/\sopen[\s>]/.test(calca[0]), false);
  assert.match(html, /<summary[^>]*>[^]*?Calca[^]*?3\/6[^]*?<\/summary>/);
});

test('#532 lista: la fila abierta pinta la calca plegada con el avance 3 de 6', () => {
  const html = L.buildFilaListaPipelineHtml(decorada(), { abierta: true });
  const calca = detalles(html).find(d => d.includes('c41:calca'));
  assert.ok(calca);
  assert.equal(/\sopen[\s>]/.test(calca), false);
  assert.match(html, /<summary>[^]*?Calca[^]*?3 de 6[^]*?<\/summary>/);
});

test('#532 tablero: lo que el vendedor abrio sigue abierto tras repintar', () => {
  const html = L.buildTableroPipelineHtml([decorada()], { plegables: { 'c41:calca': true } });
  const calca = detalles(html).find(d => d.includes('c41:calca'));
  assert.ok(calca);
  assert.match(calca, /\sopen[\s>]/);
});

test('#532 cada paso es una casilla con su etiqueta; los hechos salen marcados', () => {
  for (const html of [
    L.buildTableroPipelineHtml([decorada()]),
    L.buildFilaListaPipelineHtml(decorada(), { abierta: true }),
  ]) {
    const cs = casillas(html);
    assert.equal(cs.length, 6);
    assert.equal(cs.filter(c => /\schecked\b/.test(c)).length, 3);
    assert.match(html, /<label[^>]*>\s*<input type="checkbox"[^>]*>\s*<span>Arte final enviado al proveedor<\/span>\s*<\/label>/);
    assert.equal(/>Marcar<|>Revertir</.test(html), false);
  }
});

test('#532 la casilla llama al PATCH de paso de calca con el paso y el valor de la casilla', () => {
  const html = L.buildTableroPipelineHtml([decorada()]);
  const cs = casillas(html);
  assert.match(cs[2], /onchange="toggleCalcaPaso\(41, 'arte_final', this\.checked\)"/);
  assert.match(cs[2], /\schecked\b/);
  assert.match(cs[3], /onchange="toggleCalcaPaso\(41, 'dummy_autorizado', this\.checked\)"/);
  assert.equal(/\schecked\b/.test(cs[3]), false);
});

test('#532 Archivos en Dropbox conserva el selector de archivos y la subida', () => {
  const html = L.buildTableroPipelineHtml([decorada()]);
  assert.match(html, /<input type="file" id="calca-archivos-41"[^>]*multiple/);
  assert.ok(html.includes('onclick="subirCalcaArchivos(41)"'));
});

test('#532 la decorada ofrece Quitar decorada y la no decorada Marcar decorada', () => {
  const tablero = L.buildTableroPipelineHtml([decorada()]);
  const fila = L.buildFilaListaPipelineHtml(decorada(), { abierta: true });
  for (const html of [tablero, fila]) assert.ok(html.includes('onclick="marcarDecorada(41, false)"'));
  const sin = cotizacion({ decorado: false });
  for (const html of [L.buildTableroPipelineHtml([sin]), L.buildFilaListaPipelineHtml(sin, { abierta: true })]) {
    assert.ok(html.includes('onclick="marcarDecorada(41, true)"'));
    assert.equal(casillas(html).length, 0);
  }
});
