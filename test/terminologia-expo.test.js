import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

// Terminologia del glosario (#325, decision 2026-09-03): el termino es "expo".
// "feria" solo sobrevive dentro del valor del Origen `Feria/Expo`, que es dato
// guardado en prospectos y en el cruce de Bitrix. Este guard recorre el repo
// para que la palabra no vuelva a colarse en glosario, docs, UI, codigo o tests.

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALCANCE = ['CONTEXT.md', 'CLAUDE.md', 'docs', 'public', 'lib', 'scripts', 'server.js', 'test'];
const EXCLUIR = new Set(['vendor', 'node_modules', 'fonts', 'img']);
const EXTENSIONES = new Set(['.md', '.js', '.mjs', '.cjs', '.html', '.css']);

function archivosDe(ruta) {
  const st = statSync(ruta);
  if (st.isFile()) return EXTENSIONES.has(ruta.slice(ruta.lastIndexOf('.'))) ? [ruta] : [];
  return readdirSync(ruta)
    .filter(n => !EXCLUIR.has(n))
    .flatMap(n => archivosDe(join(ruta, n)));
}

function lineasConFeria(archivo) {
  return readFileSync(archivo, 'utf8').split('\n')
    .map((l, i) => ({ n: i + 1, texto: l }))
    // El valor se conserva tambien en su forma escapada dentro de los regex de tests.
    .filter(({ texto }) => /feria/i.test(texto.replace(/Feria\\?\/Expo/g, '')));
}

test('#325: "feria" solo aparece en el valor del Origen Feria/Expo', () => {
  const propio = fileURLToPath(import.meta.url);
  const hallazgos = ALCANCE
    .flatMap(a => archivosDe(join(RAIZ, a)))
    .filter(f => f !== propio)
    .flatMap(f => lineasConFeria(f).map(({ n, texto }) => `${relative(RAIZ, f)}:${n}: ${texto.trim()}`));
  assert.deepEqual(hallazgos, []);
});
