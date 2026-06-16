import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Sin DATABASE_URL el store usa el fallback JSON (data/prospectos.json),
// el mismo modo en que corren dev local y esta suite.
import { listar, crear, buscarPorCelular, obtener, registrarEvento, cambiarEtapa, actualizarDatos, asignarVendedor, moverASeguimientoConFolio, ultimos10 } from '../lib/prospectos-store.js';
import { ETAPAS, SALIDAS } from '../lib/pipeline.js';

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

test('crear asigna id secuencial y un prospecto a mano nace en por_cotizar', async () => {
  writeProspectos([{ id: 4, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', celular: '+52 5511111111', celular10: '5511111111', nombre: 'X', etapa: 'por_cotizar' }]);
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
  assert.equal(guardado.etapa, 'por_cotizar');
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

test('crear rechaza un celular duplicado aunque la verificacion previa no lo viera (carrera)', async () => {
  writeProspectos([]);
  await crear({
    fecha: '2026-06-10T00:00:00Z', vendedor: 'Ana',
    celular: '+52 55 1234 5678', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp',
  });
  await assert.rejects(
    crear({
      fecha: '2026-06-10T00:00:01Z', vendedor: 'Memo',
      celular: '5512345678', nombre: 'Laura Dos', ciudad: 'CDMX', canal: 'Referido',
    }),
    err => err.code === '23505'
  );
  assert.equal(readProspectos().length, 1);
});

test('obtener devuelve el prospecto por id y undefined si no existe', async () => {
  writeProspectos([
    { id: 7, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', celular: '+52 5511111111', celular10: '5511111111', nombre: 'A', etapa: 'nuevo', eventos: [] },
  ]);
  const p = await obtener(7);
  assert.equal(p.nombre, 'A');
  assert.equal(await obtener(99), undefined);
});

test('registrarEvento appendea al historial y devuelve los eventos; null si no existe', async () => {
  writeProspectos([
    { id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', celular: '+52 5511111111', celular10: '5511111111', nombre: 'A', etapa: 'nuevo' },
  ]);
  const toque = { tipo: 'toque', fecha: '2026-06-11T10:00:00Z', vendedor: 'Memo' };
  const eventos = await registrarEvento(1, toque);
  assert.deepEqual(eventos, [toque]);
  const segundo = { tipo: 'toque', fecha: '2026-06-12T10:00:00Z', vendedor: 'Ana' };
  const dos = await registrarEvento(1, segundo);
  assert.deepEqual(dos, [toque, segundo]);
  assert.deepEqual(readProspectos()[0].eventos, [toque, segundo]);
  assert.equal(await registrarEvento(99, toque), null);
});

test('cambiarEtapa actualiza la etapa y appendea el evento en una sola operacion', async () => {
  writeProspectos([
    { id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', celular: '+52 5511111111', celular10: '5511111111', nombre: 'A', etapa: 'nuevo', eventos: [] },
  ]);
  const evento = { tipo: 'etapa', de: 'nuevo', a: 'contactado', fecha: '2026-06-11T10:00:00Z', vendedor: 'Memo' };
  const ok = await cambiarEtapa(1, 'contactado', evento);
  assert.equal(ok, true);
  const guardado = readProspectos()[0];
  assert.equal(guardado.etapa, 'contactado');
  assert.deepEqual(guardado.eventos, [evento]);
  assert.equal(await cambiarEtapa(99, 'contactado', evento), false);
});

test('actualizarDatos edita nombre/ciudad y mergea campos en data sin tocar etapa ni eventos (#66)', async () => {
  writeProspectos([
    { id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', celular: '+52 5511111111', celular10: '5511111111', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp', etapa: 'seguimiento', eventos: [{ tipo: 'toque', fecha: '2026-06-10T10:00:00Z', vendedor: 'Memo' }], data: { empresa: 'Hotel Azul', temperatura: 3 } },
  ]);
  const ok = await actualizarDatos(1, {
    nombre: 'Laura Perez', ciudad: 'CDMX',
    data: { empresa: 'Hotel Verde', temperatura: 5, notas: 'pidio catalogo' },
  });
  assert.equal(ok, true);
  const guardado = readProspectos()[0];
  // columnas propias actualizadas
  assert.equal(guardado.nombre, 'Laura Perez');
  assert.equal(guardado.ciudad, 'CDMX');
  // data se mergea (no se reemplaza): empresa cambia, temperatura cambia, notas se agrega
  assert.equal(guardado.data.empresa, 'Hotel Verde');
  assert.equal(guardado.data.temperatura, 5);
  assert.equal(guardado.data.notas, 'pidio catalogo');
  // etapa y eventos intactos
  assert.equal(guardado.etapa, 'seguimiento');
  assert.equal(guardado.eventos.length, 1);
  assert.equal(guardado.eventos[0].tipo, 'toque');
});

test('actualizarDatos preserva campos de data no incluidos en la edicion y devuelve false si no existe (#66)', async () => {
  writeProspectos([
    { id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', celular: '+52 5511111111', celular10: '5511111111', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp', etapa: 'por_cotizar', eventos: [], data: { empresa: 'Hotel Azul', cliente_id: 88 } },
  ]);
  // editar solo correo: empresa y cliente_id (ligado al cliente Operam) deben sobrevivir
  const ok = await actualizarDatos(1, { data: { correo: 'laura@hotel.mx' } });
  assert.equal(ok, true);
  const guardado = readProspectos()[0];
  assert.equal(guardado.data.empresa, 'Hotel Azul');
  assert.equal(guardado.data.cliente_id, 88);
  assert.equal(guardado.data.correo, 'laura@hotel.mx');
  assert.equal(await actualizarDatos(99, { nombre: 'X' }), false);
});

test('asignarVendedor fija el vendedor, mueve a por_cotizar y appendea el evento (#57)', async () => {
  writeProspectos([
    { id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: null, celular: '+52 5511111111', celular10: '5511111111', nombre: 'Sin dueno', ciudad: 'CDMX', canal: 'Formulario web', etapa: 'no_asignado', eventos: [] },
  ]);
  const evento = { tipo: 'asignacion', a: 'Memo', de: 'no_asignado', fecha: '2026-06-11T10:00:00Z', vendedor: 'Adrián Chávez' };
  const ok = await asignarVendedor(1, 'Memo', 'por_cotizar', evento);
  assert.equal(ok, true);
  const guardado = readProspectos()[0];
  assert.equal(guardado.vendedor, 'Memo');
  assert.equal(guardado.etapa, 'por_cotizar');
  assert.deepEqual(guardado.eventos, [evento]);
  assert.equal(await asignarVendedor(99, 'Memo', 'por_cotizar', evento), false);
});

test('moverASeguimientoConFolio fija etapa seguimiento, guarda data.folioOperam y appendea el evento (#56)', async () => {
  writeProspectos([
    { id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', celular: '+52 5511111111', celular10: '5511111111', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp', etapa: 'por_cotizar', eventos: [{ tipo: 'toque', fecha: '2026-06-10T10:00:00Z', vendedor: 'Memo' }], data: { empresa: 'Hotel Azul' } },
  ]);
  const evento = { tipo: 'etapa', de: 'por_cotizar', a: 'seguimiento', folio: '55123', fecha: '2026-06-11T10:00:00Z', vendedor: 'Memo' };
  const ok = await moverASeguimientoConFolio(1, '55123', evento);
  assert.equal(ok, true);
  const guardado = readProspectos()[0];
  assert.equal(guardado.etapa, 'seguimiento');
  assert.equal(guardado.data.folioOperam, '55123');
  // el merge conserva lo no editado (empresa)
  assert.equal(guardado.data.empresa, 'Hotel Azul');
  // appendea el evento sin perder el historial previo
  assert.deepEqual(guardado.eventos, [{ tipo: 'toque', fecha: '2026-06-10T10:00:00Z', vendedor: 'Memo' }, evento]);
  assert.equal(await moverASeguimientoConFolio(99, '55123', evento), false);
});

test('ultimos10 recorta extension y coma igual que el indice de telefonos', async () => {
  assert.equal(ultimos10('+52(55)53952615,116'), '5553952615');
  assert.equal(ultimos10('+52 55 5395 2615 ext.116'), '5553952615');
  assert.equal(ultimos10('+52 55 5395 2615 EXT 9'), '5553952615');
  assert.equal(ultimos10('+52 5512345678'), '5512345678');
});

test('buscarPorCelular encuentra al prospecto aunque el telefono buscado traiga extension', async () => {
  writeProspectos([]);
  await crear({
    fecha: '2026-06-10T00:00:00Z', vendedor: 'Ana',
    celular: '+52 55 5395 2615', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp',
  });
  const conExt = await buscarPorCelular('+52(55)53952615,116');
  assert.equal(conExt && conExt.nombre, 'Laura');
});

test('listar devuelve todos los prospectos guardados', async () => {
  writeProspectos([
    { id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', celular: '+52 5511111111', celular10: '5511111111', nombre: 'A', etapa: 'por_cotizar' },
    { id: 2, fecha: '2026-06-02T00:00:00Z', vendedor: 'Ana', celular: '+52 5522222222', celular10: '5522222222', nombre: 'B', etapa: 'por_cotizar' },
  ]);
  const todos = await listar();
  assert.equal(todos.length, 2);
  assert.equal(todos[1].nombre, 'B');
});

test('listar migra etapas viejas al vocabulario del pipeline y conserva eventos', async () => {
  const eventos = [{ tipo: 'etapa', de: 'nuevo', a: 'contactado', fecha: '2026-06-11T22:32:47.054Z', vendedor: 'Memo' }];
  writeProspectos([
    { id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', celular: '+52 5511111111', celular10: '5511111111', nombre: 'Nuevo', etapa: 'nuevo', eventos },
    { id: 2, fecha: '2026-06-02T00:00:00Z', vendedor: 'Ana', celular: '+52 5522222222', celular10: '5522222222', nombre: 'Contactado', etapa: 'contactado', eventos: [] },
    { id: 3, fecha: '2026-06-03T00:00:00Z', vendedor: 'Ana', celular: '+52 5533333333', celular10: '5533333333', nombre: 'Calificado', etapa: 'calificado', eventos: [] },
    { id: 4, fecha: '2026-06-04T00:00:00Z', vendedor: 'Ana', celular: '+52 5544444444', celular10: '5544444444', nombre: 'Cotizado', etapa: 'cotizado', eventos: [] },
    { id: 5, fecha: '2026-06-05T00:00:00Z', vendedor: 'Ana', celular: '+52 5555555555', celular10: '5555555555', nombre: 'NoUtil', etapa: 'no_util', eventos: [] },
  ]);
  const todos = await listar();
  const porId = Object.fromEntries(todos.map(p => [p.id, p]));
  assert.equal(porId[1].etapa, 'por_cotizar');
  assert.equal(porId[2].etapa, 'por_cotizar');
  assert.equal(porId[3].etapa, 'por_cotizar');
  assert.equal(porId[4].etapa, 'seguimiento');
  assert.equal(porId[5].etapa, 'no_util');
  for (const p of todos) assert.ok(ETAPAS.includes(p.etapa) || SALIDAS.includes(p.etapa));
  assert.deepEqual(porId[1].eventos, eventos);
});

test('obtener migra la etapa vieja del prospecto recuperado', async () => {
  writeProspectos([
    { id: 7, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', celular: '+52 5511111111', celular10: '5511111111', nombre: 'A', etapa: 'calificado', eventos: [] },
  ]);
  const p = await obtener(7);
  assert.equal(p.etapa, 'por_cotizar');
});
