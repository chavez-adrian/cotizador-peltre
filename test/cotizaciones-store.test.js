import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Sin DATABASE_URL el store usa el fallback JSON (data/cotizaciones.json),
// el mismo modo en que corren dev local y esta suite.
import { listar, obtener, crear, registrarSeguimiento, setEstado, setFolioOperam, actualizarDatos, cambiarEtapa } from '../lib/cotizaciones-store.js';

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

// Folio de Operam nullable (issue #63): una cotizacion nace sin folio (es una
// pre-cotizacion); al registrarse en Operam se le guarda el folio. El store
// persiste y expone folioOperam, frontera donde la presentacion decide PRE vs
// #Operam.
test('una cotizacion nace sin folio de Operam (es pre-cotizacion)', async () => {
  writeCots([]);
  const id = await crear({
    fecha: '2026-06-10T00:00:00Z', vendedor: 'Ana', cliente: 'HOTEL AZUL',
    totalPiezas: 100, total: 9000, tier: 'M100', data: {},
  });
  assert.equal((await obtener(id)).folioOperam, null);
});

test('setFolioOperam guarda el folio devuelto por Operam y obtener/listar lo exponen', async () => {
  writeCots([{ id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', cliente: 'A', data: {} }]);
  const ok = await setFolioOperam(1, 7788);
  assert.equal(ok, true);
  // El folio se persiste como identificador (texto), igual en Postgres y en JSON.
  assert.equal((await obtener(1)).folioOperam, '7788');
  assert.equal((await listar())[0].folioOperam, '7788');
});

test('setFolioOperam sobre una cotizacion inexistente no rompe', async () => {
  writeCots([{ id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', cliente: 'A', data: {} }]);
  assert.equal(await setFolioOperam(99, 7788), false);
});

// Mergea campos en data sin reemplazar lo previo (issue #61, decorados): el flag
// decorado y el checklist de calca viven en data.decorado / data.calcaChecklist.
// Mismo patron que actualizarDatos de prospectos-store (merge JSONB + fallback).
test('actualizarDatos mergea en data sin borrar lo previo', async () => {
  writeCots([{ id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', cliente: 'A', data: { cliente: { rfc: 'XAXX010101000' } } }]);
  const ok = await actualizarDatos(1, { decorado: true });
  assert.equal(ok, true);
  const c = await obtener(1);
  assert.equal(c.data.decorado, true);
  // No borra lo que ya estaba en data
  assert.equal(c.data.cliente.rfc, 'XAXX010101000');
});

test('actualizarDatos guarda el checklist de calca y lo expone en listar/obtener', async () => {
  writeCots([{ id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', cliente: 'A', data: {} }]);
  const checklist = [{ clave: 'arte_final', completo: true }];
  await actualizarDatos(1, { decorado: true, calcaChecklist: checklist });
  assert.deepEqual((await obtener(1)).data.calcaChecklist, checklist);
  assert.deepEqual((await listar())[0].data.calcaChecklist, checklist);
});

test('actualizarDatos sobre una cotizacion inexistente no rompe', async () => {
  writeCots([{ id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', cliente: 'A', data: {} }]);
  assert.equal(await actualizarDatos(99, { decorado: true }), false);
});

// cambiarEtapa mueve la oportunidad (cotizacion) por el pipeline post-venta y
// registra el evento (issue #62). Mismo patron que prospectos-store.cambiarEtapa.
// El sync de Operam usa esto para mover la tarjeta cuando lee un hecho post-venta.
test('cambiarEtapa fija la etapa de la cotizacion y obtener/listar la exponen', async () => {
  writeCots([{ id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', cliente: 'A', data: {} }]);
  const ok = await cambiarEtapa(1, 'anticipo_pagado', { tipo: 'sync_operam', fecha: '2026-06-17T00:00:00Z' });
  assert.equal(ok, true);
  assert.equal((await obtener(1)).etapa, 'anticipo_pagado');
  assert.equal((await listar())[0].etapa, 'anticipo_pagado');
});

test('cambiarEtapa registra el evento sin borrar los previos', async () => {
  writeCots([{ id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', cliente: 'A', data: {}, eventos: [{ tipo: 'previo' }] }]);
  await cambiarEtapa(1, 'pedido_liberado', { tipo: 'sync_operam', etapa: 'pedido_liberado' });
  const c = await obtener(1);
  assert.equal(c.eventos.length, 2);
  assert.equal(c.eventos[1].etapa, 'pedido_liberado');
});

test('cambiarEtapa sobre una cotizacion inexistente no rompe', async () => {
  writeCots([{ id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', cliente: 'A', data: {} }]);
  assert.equal(await cambiarEtapa(99, 'anticipo_pagado', { tipo: 'sync_operam' }), false);
});

// La etapa persistida sobrevive la migracion de lectura (migrarCotizacion respeta
// una etapa de pipeline ya presente): una cotizacion movida a post-venta no se
// recalcula a seguimiento.
test('cambiarEtapa: la etapa post-venta persiste por encima del estado', async () => {
  writeCots([{ id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', cliente: 'A', estado: 'abierta', data: {} }]);
  await cambiarEtapa(1, 'saldo_pagado', { tipo: 'sync_operam' });
  assert.equal((await obtener(1)).etapa, 'saldo_pagado');
});

test('listar expone la etapa del pipeline derivada del estado de cada cotizacion (#53)', async () => {
  writeCots([
    { id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', cliente: 'Abierta', data: {} },
    { id: 2, fecha: '2026-06-02T00:00:00Z', vendedor: 'Ana', cliente: 'Ganada', estado: 'ganada', data: {} },
    { id: 3, fecha: '2026-06-03T00:00:00Z', vendedor: 'Ana', cliente: 'Perdida', estado: 'perdida', data: {} },
    { id: 4, fecha: '2026-06-04T00:00:00Z', vendedor: 'Ana', cliente: 'Descartada', estado: 'descartada', data: {} },
  ]);
  const porId = Object.fromEntries((await listar()).map(c => [c.id, c]));
  assert.equal(porId[1].etapa, 'seguimiento');
  assert.equal(porId[2].etapa, 'seguimiento');
  assert.equal(porId[3].etapa, 'perdida');
  assert.equal(porId[4].etapa, 'perdida');
  assert.equal((await obtener(1)).etapa, 'seguimiento');
});
