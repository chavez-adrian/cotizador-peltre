import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Sin DATABASE_URL el store usa el fallback JSON (data/prospectos.json),
// el mismo modo en que corren dev local y esta suite.
import { listar, crear, buscarPorCelular } from '../lib/prospectos-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROSPECTOS_PATH = join(__dirname, '..', 'data', 'prospectos.json');

function readProspectos() {
  if (!existsSync(PROSPECTOS_PATH)) return [];
  return JSON.parse(readFileSync(PROSPECTOS_PATH, 'utf8'));
}
function writeProspectos(data) {
  writeFileSync(PROSPECTOS_PATH, JSON.stringify(data, null, 2));
}

let savedProspectos;
let existia;
before(() => {
  existia = existsSync(PROSPECTOS_PATH);
  savedProspectos = readProspectos();
});
after(() => {
  if (existia) writeProspectos(savedProspectos);
  else if (existsSync(PROSPECTOS_PATH)) unlinkSync(PROSPECTOS_PATH);
});

test('crear asigna id secuencial y persiste el prospecto en etapa nuevo', async () => {
  writeProspectos([{ id: 4, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', celular: '+52 5511111111', celular10: '5511111111', nombre: 'X', etapa: 'nuevo' }]);
  const id = await crear({
    fecha: '2026-06-10T00:00:00Z', vendedor: 'Ana',
    celular: '+52 5512345678', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp',
    data: { empresa: 'Hotel Azul', temperatura: 4 },
  });
  assert.equal(id, 5);
  const guardado = readProspectos().find(p => p.id === 5);
  assert.equal(guardado.nombre, 'Laura');
  assert.equal(guardado.ciudad, 'Puebla');
  assert.equal(guardado.canal, 'WhatsApp');
  assert.equal(guardado.etapa, 'nuevo');
  assert.equal(guardado.celular10, '5512345678');
  assert.equal(guardado.data.empresa, 'Hotel Azul');
});

test('buscarPorCelular encuentra por ultimos 10 digitos sin importar formato', async () => {
  writeProspectos([]);
  await crear({
    fecha: '2026-06-10T00:00:00Z', vendedor: 'Ana',
    celular: '+52 55 1234 5678', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp',
  });
  const conPrefijo = await buscarPorCelular('+52 5512345678');
  assert.equal(conPrefijo.nombre, 'Laura');
  const sinPrefijo = await buscarPorCelular('5512345678');
  assert.equal(sinPrefijo.nombre, 'Laura');
  const otroPais = await buscarPorCelular('+1 5512345678');
  assert.equal(otroPais.nombre, 'Laura');
  assert.equal(await buscarPorCelular('+52 5599999999'), undefined);
  assert.equal(await buscarPorCelular(''), undefined);
});

test('listar devuelve todos los prospectos guardados', async () => {
  writeProspectos([
    { id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', celular: '+52 5511111111', celular10: '5511111111', nombre: 'A', etapa: 'nuevo' },
    { id: 2, fecha: '2026-06-02T00:00:00Z', vendedor: 'Ana', celular: '+52 5522222222', celular10: '5522222222', nombre: 'B', etapa: 'nuevo' },
  ]);
  const todos = await listar();
  assert.equal(todos.length, 2);
  assert.equal(todos[1].nombre, 'B');
});
