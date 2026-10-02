import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// #497: en /admin a 375 px la rejilla de notas de Condiciones comerciales usaba
// `max-content 1fr`: la etiqueta larga de "Sin envio" fijaba la primera columna,
// el input no se encogia y #cond-precios terminaba en x=551, desplazando la pagina
// a los lados. La rejilla tiene que poder encogerse: columnas con minmax/fit-content
// y campos con min-width: 0 y width: 100%. El layout real es HITL; esto fija la regla.

const ADMIN = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'admin.html'), 'utf8');

function aperturaRejilla() {
  const i = ADMIN.indexOf('for="cond-precios"');
  assert.ok(i > 0, 'el panel tiene el campo Precios de Condiciones comerciales');
  const inicio = ADMIN.lastIndexOf('<div', i);
  return ADMIN.slice(inicio, ADMIN.indexOf('>', inicio) + 1);
}

function claseRejilla() {
  const m = aperturaRejilla().match(/class="([^"]+)"/);
  assert.ok(m, 'la rejilla de notas lleva una clase del bloque <style> del panel');
  return m[1].split(/\s+/)[0];
}

function reglas(selector) {
  const estilo = ADMIN.slice(ADMIN.indexOf('<style>'), ADMIN.indexOf('</style>'));
  const re = new RegExp('(^|[\\s,}])' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g');
  return [...estilo.matchAll(re)].map(m => m[2]).join(';');
}

test('la rejilla de notas de Condiciones comerciales ya no usa max-content 1fr en linea', () => {
  assert.doesNotMatch(ADMIN, /grid-template-columns:\s*max-content 1fr/);
  assert.doesNotMatch(aperturaRejilla(), /grid-template-columns/);
});

test('las columnas de la rejilla pueden encogerse a 375 px', () => {
  const clase = claseRejilla();
  const columnas = reglas('.' + clase).match(/grid-template-columns:\s*([^;]+)/);
  assert.ok(columnas, 'la clase define grid-template-columns');
  assert.match(columnas[1], /minmax\(|fit-content\(/);
  assert.doesNotMatch(columnas[1], /^\s*max-content\s+1fr\s*$/);
});

test('los campos de la rejilla llevan min-width: 0 y width: 100%', () => {
  const campos = reglas('.' + claseRejilla() + ' input');
  assert.match(campos, /min-width:\s*0/);
  assert.match(campos, /(^|[;\s])width:\s*100%/);
});
