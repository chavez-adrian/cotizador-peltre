import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// CLAUDE.md se carga completo en cada turno de cada agente: una oracion por modulo y por
// trampa, y el detalle en docs/arquitectura.md (2026-10-10 llego a 108 KB por filas de la
// tabla que crecian con cada ticket). Si esta prueba falla, mueve el detalle alla.
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOPE_BYTES = 50000;
const TOPE_LINEA = 700;
const leer = (archivo) => readFileSync(join(RAIZ, archivo), 'utf8');

test('CLAUDE.md cabe en su tope', () => {
  const bytes = Buffer.byteLength(leer('CLAUDE.md'));
  assert.ok(bytes <= TOPE_BYTES, `CLAUDE.md pesa ${bytes} bytes (tope ${TOPE_BYTES}): mueve el detalle a docs/arquitectura.md`);
});

test('ninguna linea de CLAUDE.md pasa de una oracion larga', () => {
  const largas = leer('CLAUDE.md').split('\r\n')
    .map((l, i) => ({ linea: i + 1, largo: l.length }))
    .filter((x) => x.largo > TOPE_LINEA);
  assert.deepEqual(largas, [], `lineas de mas de ${TOPE_LINEA} caracteres: deja una oracion y mueve el resto a docs/arquitectura.md`);
});

test('CLAUDE.md y docs/arquitectura.md son CRLF en disco', () => {
  for (const archivo of ['CLAUDE.md', 'docs/arquitectura.md']) {
    const texto = leer(archivo);
    assert.equal(/(^|[^\r])\n/.test(texto), false, `${archivo} tiene finales LF: normaliza a CRLF`);
  }
});
