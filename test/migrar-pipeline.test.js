import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  etapaProspectoMigrada,
  etapaCotizacionMigrada,
  migrarProspecto,
  migrarCotizacion,
} from '../lib/migrar-pipeline.js';
import { ETAPAS, SALIDAS } from '../lib/pipeline.js';

// Mapeo de migracion del modelo previo al pipeline unificado (ADR-0005,
// "Migracion de datos"). Las etapas intermedias de prospeccion colapsan a
// Por Cotizar; Cotizado se reinterpreta como Seguimiento; No util se conserva.

test('etapa de prospecto: las etapas de prospeccion colapsan a por_cotizar', () => {
  assert.equal(etapaProspectoMigrada('nuevo'), 'por_cotizar');
  assert.equal(etapaProspectoMigrada('contactado'), 'por_cotizar');
  assert.equal(etapaProspectoMigrada('calificado'), 'por_cotizar');
});

test('etapa de prospecto: cotizado migra a seguimiento', () => {
  assert.equal(etapaProspectoMigrada('cotizado'), 'seguimiento');
});

test('etapa de prospecto: no_util se conserva', () => {
  assert.equal(etapaProspectoMigrada('no_util'), 'no_util');
});

test('etapa de prospecto: una etapa ya migrada se devuelve igual (idempotencia)', () => {
  for (const e of ETAPAS) assert.equal(etapaProspectoMigrada(e), e);
  for (const s of SALIDAS) assert.equal(etapaProspectoMigrada(s), s);
});

test('estado de cotizacion: abierta/null/ganada caen en seguimiento (sin dato post-venta en este slice)', () => {
  assert.equal(etapaCotizacionMigrada('abierta'), 'seguimiento');
  assert.equal(etapaCotizacionMigrada(null), 'seguimiento');
  assert.equal(etapaCotizacionMigrada(undefined), 'seguimiento');
  assert.equal(etapaCotizacionMigrada('ganada'), 'seguimiento');
});

test('estado de cotizacion: perdida y descartada salen del tablero a perdida', () => {
  assert.equal(etapaCotizacionMigrada('perdida'), 'perdida');
  assert.equal(etapaCotizacionMigrada('descartada'), 'perdida');
});

test('migrarProspecto pone la etapa nueva y preserva el historial de eventos', () => {
  const original = {
    id: 4, vendedor: 'Ana', celular: '+52 5533333333', nombre: 'Sofia', ciudad: 'Toluca',
    etapa: 'calificado',
    eventos: [
      { tipo: 'etapa', de: 'nuevo', a: 'contactado', fecha: '2026-06-11T22:32:17.991Z', vendedor: 'Ana' },
      { tipo: 'etapa', de: 'contactado', a: 'calificado', fecha: '2026-06-11T22:32:17.994Z', vendedor: 'Ana' },
    ],
  };
  const m = migrarProspecto(original);
  assert.equal(m.etapa, 'por_cotizar');
  assert.deepEqual(m.eventos, original.eventos);
  assert.equal(m.nombre, 'Sofia');
  assert.equal(m.id, 4);
});

test('migrarProspecto es idempotente: aplicado dos veces da el mismo resultado', () => {
  const original = { id: 1, etapa: 'cotizado', eventos: [{ tipo: 'toque', fecha: 'x' }] };
  const una = migrarProspecto(original);
  const dos = migrarProspecto(una);
  assert.deepEqual(dos, una);
  assert.equal(dos.etapa, 'seguimiento');
});

test('migrarCotizacion deriva la etapa del estado y preserva seguimientos', () => {
  const original = {
    id: 10, vendedor: 'Memo', cliente: 'Hotel Azul', total: 5000, estado: 'abierta',
    seguimientos: [{ paso: 'dia2', fecha: '2026-06-12T10:00:00Z', vendedor: 'Memo' }],
  };
  const m = migrarCotizacion(original);
  assert.equal(m.etapa, 'seguimiento');
  assert.deepEqual(m.seguimientos, original.seguimientos);
  assert.equal(m.cliente, 'Hotel Azul');
});

test('migrarCotizacion es idempotente sobre una cotizacion ya migrada', () => {
  const ya = { id: 11, estado: 'perdida', etapa: 'perdida', seguimientos: [] };
  const m = migrarCotizacion(ya);
  assert.equal(m.etapa, 'perdida');
  assert.deepEqual(migrarCotizacion(m), m);
});
