// La regla mecanica de CODING_STANDARDS.md (regla 2, ADR-0017 y ADR-0022): un modulo
// de dominio devuelve valores y no sabe de HTTP, asi que no importa Express ni el
// servidor -- ni directo ni a traves de otro modulo del repo que importe. Un modulo
// de dominio nuevo se agrega a MODULOS_DE_DOMINIO.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'fs';
import { join, dirname, resolve, basename } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MODULOS_DE_DOMINIO = [
  'lib/alta-cliente.js',
  'lib/subida-quote.js',
  'lib/contactos-operam.js',
  'public/js/modo-alta-logica.js',
];

const RE_IMPORTS = [
  /\bexport\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function especificadores(texto) {
  const salida = [];
  for (const re of RE_IMPORTS) {
    for (const m of texto.matchAll(re)) salida.push(m[1]);
  }
  return salida;
}

function prohibido(especificador, rutaResuelta) {
  if (especificador === 'express' || especificador.startsWith('express/')) return 'Express';
  if (rutaResuelta && basename(rutaResuelta) === 'server.js') return 'server.js';
  return null;
}

// Recorre los imports relativos (los paquetes de npm no se abren) y devuelve la
// cadena que llega a Express o a server.js, o null.
function importProhibido(archivo, visto = new Set()) {
  const ruta = resolve(archivo);
  if (visto.has(ruta) || !existsSync(ruta)) return null;
  visto.add(ruta);
  for (const esp of especificadores(readFileSync(ruta, 'utf8'))) {
    const relativo = esp.startsWith('.');
    const destino = relativo ? resolve(dirname(ruta), esp) : null;
    const motivo = prohibido(esp, destino);
    if (motivo) return [ruta, motivo];
    if (relativo) {
      const cadena = importProhibido(destino, visto);
      if (cadena) return [ruta, ...cadena];
    }
  }
  return null;
}

for (const modulo of MODULOS_DE_DOMINIO) {
  test(`${modulo} no importa Express ni server.js`, () => {
    assert.ok(existsSync(join(RAIZ, modulo)), `${modulo} no existe`);
    const cadena = importProhibido(join(RAIZ, modulo));
    assert.equal(cadena, null, cadena && cadena.map(p => p.replace(RAIZ, '.')).join(' -> '));
  });
}

test('la guarda detecta Express y server.js, directos y a traves de otro modulo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'modulos-dominio-'));
  try {
    writeFileSync(join(dir, 'server.js'), 'export const app = 1;\n');
    writeFileSync(join(dir, 'con-express.js'), "import express from 'express';\nexport const x = express;\n");
    writeFileSync(join(dir, 'con-servidor.js'), "import { app } from './server.js';\nexport const y = app;\n");
    writeFileSync(join(dir, 'puente.js'), "export { y } from './otro.js';\nimport { y } from './con-servidor.js';\nexport const z = y;\n");
    writeFileSync(join(dir, 'dinamico.js'), "export async function f() { return import('express'); }\n");
    writeFileSync(join(dir, 'limpio.js'), "import { readFileSync } from 'fs';\nexport const w = readFileSync;\n");

    assert.equal(importProhibido(join(dir, 'con-express.js')).at(-1), 'Express');
    assert.equal(importProhibido(join(dir, 'con-servidor.js')).at(-1), 'server.js');
    assert.deepEqual(importProhibido(join(dir, 'puente.js')).slice(-1), ['server.js']);
    assert.equal(importProhibido(join(dir, 'dinamico.js')).at(-1), 'Express');
    assert.equal(importProhibido(join(dir, 'limpio.js')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CODING_STANDARDS.md cita los ADR de sus reglas y CLAUDE.md apunta a el', () => {
  const estandar = readFileSync(join(RAIZ, 'CODING_STANDARDS.md'), 'utf8');
  for (const adr of ['ADR-0017', 'ADR-0022', 'ADR-0023']) assert.ok(estandar.includes(adr), `falta ${adr}`);
  for (const modulo of MODULOS_DE_DOMINIO) assert.ok(estandar.includes(modulo), `CODING_STANDARDS.md no nombra ${modulo}`);
  assert.ok(readFileSync(join(RAIZ, 'CLAUDE.md'), 'utf8').includes('CODING_STANDARDS.md'));
});
