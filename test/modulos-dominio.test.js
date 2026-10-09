// La regla mecanica de CODING_STANDARDS.md (ADR-0017, ADR-0022, ADR-0024): un modulo
// de dominio devuelve valores y no sabe de HTTP, asi que ni el ni nada de lo que
// importa llega a Express ni a server.js. Se lee el TEXTO de los imports con fs y
// se sigue el grafo de imports relativos; la prueba no importa ningun modulo (importar
// server.js arrancaria sus warms y stores).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVIDOR = join(RAIZ, 'server.js');

// La lista de CODING_STANDARDS.md: un modulo de dominio nuevo se agrega aqui.
const MODULOS_DE_DOMINIO = [
  'lib/alta-cliente.js',
  'lib/subida-quote.js',
  'lib/contactos-operam.js',
  'public/js/modo-alta-logica.js',
];

const PATRONES_IMPORT = [
  /\b(?:import|export)\s[^;]*?\bfrom\s*['"]([^'"]+)['"]/gs,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function especificadores(texto) {
  const salida = new Set();
  for (const patron of PATRONES_IMPORT) {
    for (const m of texto.matchAll(patron)) salida.add(m[1]);
  }
  return [...salida];
}

const esExpress = esp => esp === 'express' || esp.startsWith('express/');

// Devuelve la cadena de imports que lleva de `archivo` a Express o al servidor, o
// null. Solo se siguen los imports relativos: los paquetes de node_modules no son
// codigo de la casa.
function cadenaHaciaHttp(archivo, servidor = SERVIDOR) {
  const vistos = new Set();
  const pila = [[resolve(archivo), [resolve(archivo)]]];
  while (pila.length) {
    const [actual, camino] = pila.pop();
    if (vistos.has(actual)) continue;
    vistos.add(actual);
    if (actual === resolve(servidor)) return camino;
    if (!existsSync(actual)) continue;
    for (const esp of especificadores(readFileSync(actual, 'utf8'))) {
      if (esExpress(esp)) return [...camino, esp];
      if (!esp.startsWith('.')) continue;
      const destino = resolve(dirname(actual), esp);
      pila.push([destino, [...camino, destino]]);
    }
  }
  return null;
}

for (const modulo of MODULOS_DE_DOMINIO) {
  test(`${modulo} no llega a Express ni a server.js`, () => {
    const ruta = join(RAIZ, modulo);
    assert.ok(existsSync(ruta), `${modulo} no existe: la lista de CODING_STANDARDS.md esta desactualizada`);
    const cadena = cadenaHaciaHttp(ruta);
    assert.equal(cadena, null, `cadena de imports: ${(cadena || []).join(' -> ')}`);
  });
}

// La prueba de arriba solo vale si el detector ve un import de verdad: un modulo de
// prueba que llega a Express por un intermedio, y otro que importa el servidor.
test('el detector encuentra Express a traves de un intermedio y el servidor directo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'modulos-dominio-'));
  try {
    writeFileSync(join(dir, 'dominio.js'), "import { a } from './intermedio.js';\nexport const b = a;\n");
    writeFileSync(join(dir, 'intermedio.js'), "import express from 'express';\nexport const a = express;\n");
    writeFileSync(join(dir, 'usa-servidor.js'), "import {\n  app,\n} from './server.js';\nexport default app;\n");
    writeFileSync(join(dir, 'server.js'), 'export const app = 1;\n');
    writeFileSync(join(dir, 'limpio.js'), "import { x } from './hoja.js';\nimport fs from 'fs';\nexport { x, fs };\n");
    writeFileSync(join(dir, 'hoja.js'), 'export const x = 1;\n');
    const servidor = join(dir, 'server.js');

    assert.deepEqual(cadenaHaciaHttp(join(dir, 'dominio.js'), servidor), [join(dir, 'dominio.js'), join(dir, 'intermedio.js'), 'express']);
    assert.deepEqual(cadenaHaciaHttp(join(dir, 'usa-servidor.js'), servidor), [join(dir, 'usa-servidor.js'), servidor]);
    assert.equal(cadenaHaciaHttp(join(dir, 'limpio.js'), servidor), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
