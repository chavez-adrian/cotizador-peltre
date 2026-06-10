import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Sin DATABASE_URL el store usa el fallback JSON (data/cotizaciones.json),
// el mismo modo en que corren dev local y esta suite.
import { listar, obtener, crear, registrarSeguimiento, setEstado } from '../lib/cotizaciones-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COTS_PATH = join(__dirname, '..', 'data', 'cotizaciones.json');

function readCots() {
  if (!existsSync(COTS_PATH)) return [];
  return JSON.parse(readFileSync(COTS_PATH, 'utf8'));
}
function writeCots(data) {
  writeFileSync(COTS_PATH, JSON.stringify(data, null, 2));
}

let savedCots;
before(() => { savedCots = readCots(); });
after(() => { writeCots(savedCots); });

test('crear asigna id secuencial y persiste la entrada completa', async () => {
  writeCots([{ id: 7, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', cliente: 'X', data: {} }]);
  const id = await crear({
    fecha: '2026-06-10T00:00:00Z', vendedor: 'Ana', cliente: 'HOTEL AZUL',
    totalPiezas: 100, total: 9000, tier: 'M100', data: { cliente: { telefono: '+52 5512345678' } },
  });
  assert.equal(id, 8);
  const guardada = readCots().find(c => c.id === 8);
  assert.equal(guardada.cliente, 'HOTEL AZUL');
  assert.equal(guardada.data.cliente.telefono, '+52 5512345678');
});

test('listar devuelve todas las entradas y obtener una por id', async () => {
  writeCots([
    { id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', cliente: 'A', data: {} },
    { id: 2, fecha: '2026-06-02T00:00:00Z', vendedor: 'Ana', cliente: 'B', data: {} },
  ]);
  const todas = await listar();
  assert.equal(todas.length, 2);
  const una = await obtener(2);
  assert.equal(una.cliente, 'B');
  assert.equal(await obtener(99), undefined);
});

test('registrarSeguimiento agrega al historial sin borrar los previos', async () => {
  writeCots([{ id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', cliente: 'A', data: {}, seguimientos: [{ paso: 'dia2', fecha: '2026-06-03T00:00:00Z', vendedor: 'Memo' }] }]);
  await registrarSeguimiento(1, { paso: 'dia7', fecha: '2026-06-08T00:00:00Z', vendedor: 'Memo' });
  const c = (await listar())[0];
  assert.equal(c.seguimientos.length, 2);
  assert.equal(c.seguimientos[1].paso, 'dia7');
});

test('setEstado actualiza el estado y persiste', async () => {
  writeCots([{ id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', cliente: 'A', data: {} }]);
  await setEstado(1, 'ganada');
  assert.equal((await obtener(1)).estado, 'ganada');
});
