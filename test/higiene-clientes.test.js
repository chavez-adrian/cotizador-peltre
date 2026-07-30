import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construirReporteHigiene } from '../lib/higiene-clientes.js';
import { FUENTE_ALTA_GENERICA } from '../lib/alta-generica.js';

const AHORA = new Date('2026-07-07T12:00:00Z');

function altaGenerica({ id, cliente_id, created_at, nombre = 'Cliente Test', rfc = 'XAXX010101000' }) {
  return { id, created_at, rfc, nombre, resultado: 'creado', cliente_id, fuente: FUENTE_ALTA_GENERICA, dropbox_ok: null, error_msg: null };
}

function cotizacion({ id, customerId, fecha, vendedor = 'Memo', etapa = 'seguimiento', telefono = '5512345678' }) {
  return { id, fecha, vendedor, cliente: 'Cliente Test', etapa, data: { cliente: { customerId, telefono } } };
}

test('cliente generico sin cotizaciones: ultima actividad = fecha de alta, sin etapa', () => {
  const altas = [altaGenerica({ id: 1, cliente_id: 500, created_at: '2025-12-01T00:00:00Z' })];
  const filas = construirReporteHigiene(altas, [], AHORA);
  assert.strictEqual(filas.length, 1);
  assert.strictEqual(filas[0].customerId, 500);
  assert.strictEqual(filas[0].ultimaActividad, new Date('2025-12-01T00:00:00Z').toISOString());
  assert.strictEqual(filas[0].fechaAlta, new Date('2025-12-01T00:00:00Z').toISOString());
  assert.strictEqual(filas[0].etapa, null);
  assert.strictEqual(filas[0].candidato, true); // > 6 meses de inactividad
});

test('umbral de 6 meses: justo debajo no es candidato, justo encima si', () => {
  const altas = [
    altaGenerica({ id: 1, cliente_id: 1, created_at: '2026-02-01T00:00:00Z' }),
    altaGenerica({ id: 2, cliente_id: 2, created_at: '2025-12-01T00:00:00Z' }),
  ];
  const cots = [
    cotizacion({ id: 10, customerId: 1, fecha: '2026-02-01T00:00:00Z' }), // 5 meses -> no candidato
    cotizacion({ id: 11, customerId: 2, fecha: '2025-12-01T00:00:00Z' }), // >6 meses -> candidato
  ];
  const filas = construirReporteHigiene(altas, cots, AHORA);
  const f1 = filas.find(f => f.customerId === 1);
  const f2 = filas.find(f => f.customerId === 2);
  assert.strictEqual(f1.candidato, false);
  assert.strictEqual(f2.candidato, true);
});

test('orden por inactividad: los mas viejos sin actividad primero', () => {
  const altas = [
    altaGenerica({ id: 1, cliente_id: 1, created_at: '2026-05-01T00:00:00Z' }),
    altaGenerica({ id: 2, cliente_id: 2, created_at: '2026-01-01T00:00:00Z' }),
    altaGenerica({ id: 3, cliente_id: 3, created_at: '2026-03-01T00:00:00Z' }),
  ];
  const cots = [
    cotizacion({ id: 10, customerId: 1, fecha: '2026-06-01T00:00:00Z' }),
    cotizacion({ id: 11, customerId: 3, fecha: '2026-04-01T00:00:00Z' }),
  ];
  const filas = construirReporteHigiene(altas, cots, AHORA);
  assert.deepEqual(filas.map(f => f.customerId), [2, 3, 1]);
});

test('un generico con log posterior de RFC real (mismo cliente_id) queda excluido', () => {
  const altas = [
    altaGenerica({ id: 1, cliente_id: 700, created_at: '2026-01-01T00:00:00Z' }),
    { id: 2, created_at: '2026-02-01T00:00:00Z', rfc: 'ABC850101XX1', nombre: 'Cliente Real', resultado: 'creado', cliente_id: 700, fuente: 'csf-upload', dropbox_ok: true, error_msg: null },
  ];
  const filas = construirReporteHigiene(altas, [], AHORA);
  assert.strictEqual(filas.length, 0);
});

test('la ultima actividad usa la cotizacion mas reciente, no la primera', () => {
  const altas = [altaGenerica({ id: 1, cliente_id: 900, created_at: '2026-01-01T00:00:00Z' })];
  const cots = [
    cotizacion({ id: 10, customerId: 900, fecha: '2026-01-15T00:00:00Z', etapa: 'por_cotizar' }),
    cotizacion({ id: 11, customerId: 900, fecha: '2026-03-20T00:00:00Z', etapa: 'anticipo_pagado' }),
  ];
  const filas = construirReporteHigiene(altas, cots, AHORA);
  assert.strictEqual(filas[0].ultimaActividad, new Date('2026-03-20T00:00:00Z').toISOString());
  assert.strictEqual(filas[0].etapa, 'anticipo_pagado');
});

test('altasLog y cotizaciones vacios no truena, devuelve []', () => {
  assert.deepEqual(construirReporteHigiene([], [], AHORA), []);
  assert.deepEqual(construirReporteHigiene(null, null, AHORA), []);
});

test('celular y vendedor se toman de la cotizacion mas reciente cuando existe', () => {
  const altas = [altaGenerica({ id: 1, cliente_id: 1000, created_at: '2026-01-01T00:00:00Z' })];
  const cots = [cotizacion({ id: 10, customerId: 1000, fecha: '2026-02-01T00:00:00Z', vendedor: 'Ana', telefono: '5599998888' })];
  const filas = construirReporteHigiene(altas, cots, AHORA);
  assert.strictEqual(filas[0].vendedor, 'Ana');
  assert.strictEqual(filas[0].celular, '5599998888');
});
