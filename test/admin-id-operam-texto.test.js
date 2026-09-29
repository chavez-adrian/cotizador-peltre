import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// #466: el texto junto al campo "ID Operam" del panel /admin prometia que sin ID
// "sus clientes nacen con el vendedor por defecto de Operam", y no era cierto: el
// PUT del domicilio de entrega los dejaba sin vendedor. Desde #466 el alta se
// bloquea, y el texto tiene que decir eso, que es lo que el administrador decide.

const ADMIN = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'admin.html'), 'utf8');

function parrafoIdOperam() {
  const p = ADMIN.split(/<\/p>/).find(trozo => trozo.includes('<strong>ID Operam</strong>'));
  assert.ok(p, 'el panel explica el campo ID Operam');
  return p;
}

test('el texto de ID Operam ya no promete el vendedor por defecto de Operam', () => {
  assert.doesNotMatch(parrafoIdOperam(), /vendedor por defecto/);
});

test('el texto de ID Operam dice que sin ID esa persona no puede dar de alta clientes', () => {
  const p = parrafoIdOperam();
  assert.match(p, /no puede dar de alta clientes/);
  assert.match(p, /alta completa sin elegir vendedor/);
  assert.match(p, /al subir cotizaciones de clientes nuevos/);
});
