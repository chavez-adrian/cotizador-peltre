import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filasSegmentoPendiente, fuenteSegmento, motivoSegmentoPendiente,
  RESULTADO_SEGMENTO_ESCRITO, RESULTADO_SEGMENTO_PENDIENTE,
} from '../lib/segmento-pendiente.js';

// Nucleo puro del panel "segmento pendiente" (#365, ADR-0017): que ve el
// administrador a partir de clientes_log. Sin DB ni Express -- el endpoint solo
// consulta la tabla y traduce lo que sale de aqui.

function fila({ cliente_id, created_at, resultado = RESULTADO_SEGMENTO_PENDIENTE, segmento = '14', nombre = 'Hotel Azul Centro', rfc = 'XAXX010101000', error_msg = motivoSegmentoPendiente('El segmento no quedo guardado en Operam', 'web legacy: 500') }) {
  return { created_at, rfc, nombre, resultado, cliente_id, fuente: fuenteSegmento(segmento), error_msg };
}

test('una escritura pendiente se lista con el Cliente Operam, el segmento que se intento y sus dos capas', () => {
  const filas = filasSegmentoPendiente([fila({ cliente_id: 900, created_at: '2026-09-09T10:00:00Z' })]);

  assert.equal(filas.length, 1);
  assert.equal(filas[0].cliente_id, 900);
  assert.equal(filas[0].nombre, 'Hotel Azul Centro');
  assert.equal(filas[0].rfc, 'XAXX010101000');
  assert.equal(filas[0].segmento, '14');
  assert.equal(filas[0].motivo, 'El segmento no quedo guardado en Operam');
  assert.equal(filas[0].detalle, 'web legacy: 500');
  assert.equal(filas[0].created_at, new Date('2026-09-09T10:00:00Z').toISOString());
});

test('la fila sale lista para pintar: el segmento por su nombre y la liga a la ficha de Operam', () => {
  const [f] = filasSegmentoPendiente([fila({ cliente_id: 900, created_at: '2026-09-09T10:00:00Z' })], {
    segmentos: [{ id: 14, nombre: 'Distribuidores' }],
    operamUrl: 'https://peltrenacional.operam.pro/',
  });

  assert.equal(f.segmento, 'Distribuidores');
  assert.equal(f.url, 'https://peltrenacional.operam.pro/sales/manage/customers.php?debtor_no=900');
});

test('un segmento que no esta en el catalogo se lista con su id, no con una celda vacia', () => {
  const [f] = filasSegmentoPendiente([fila({ cliente_id: 900, created_at: '2026-09-09T10:00:00Z', segmento: '99' })], {
    segmentos: [{ id: 14, nombre: 'Distribuidores' }],
  });

  assert.equal(f.segmento, '99');
});

test('el segmento escrito despues borra al cliente de la lista', () => {
  const filas = filasSegmentoPendiente([
    fila({ cliente_id: 900, created_at: '2026-09-09T10:00:00Z' }),
    fila({ cliente_id: 900, created_at: '2026-09-09T11:00:00Z', resultado: RESULTADO_SEGMENTO_ESCRITO, error_msg: null }),
  ]);

  assert.deepEqual(filas, []);
});

test('un segmento escrito ANTES del fallo no borra nada: lo que manda es el ultimo hecho', () => {
  const filas = filasSegmentoPendiente([
    fila({ cliente_id: 900, created_at: '2026-09-09T09:00:00Z', resultado: RESULTADO_SEGMENTO_ESCRITO, error_msg: null }),
    fila({ cliente_id: 900, created_at: '2026-09-09T10:00:00Z' }),
  ]);

  assert.deepEqual(filas.map(f => f.cliente_id), [900]);
});

test('el segmento escrito de OTRO cliente no borra el pendiente', () => {
  const filas = filasSegmentoPendiente([
    fila({ cliente_id: 900, created_at: '2026-09-09T10:00:00Z' }),
    fila({ cliente_id: 901, created_at: '2026-09-09T11:00:00Z', resultado: RESULTADO_SEGMENTO_ESCRITO, error_msg: null }),
  ]);

  assert.deepEqual(filas.map(f => f.cliente_id), [900]);
});

test('varios fallos del mismo cliente son UNA fila: la del ultimo intento', () => {
  const filas = filasSegmentoPendiente([
    fila({ cliente_id: 900, created_at: '2026-09-09T10:00:00Z', error_msg: motivoSegmentoPendiente('viejo', 'viejo') }),
    fila({ cliente_id: 900, created_at: '2026-09-09T12:00:00Z', error_msg: motivoSegmentoPendiente('El segmento no quedo guardado en Operam', 'web legacy: sesion caducada') }),
  ]);

  assert.equal(filas.length, 1);
  assert.equal(filas[0].detalle, 'web legacy: sesion caducada');
});

test('los pendientes salen del mas reciente al mas viejo', () => {
  const filas = filasSegmentoPendiente([
    fila({ cliente_id: 900, created_at: '2026-09-08T10:00:00Z' }),
    fila({ cliente_id: 901, created_at: '2026-09-09T10:00:00Z' }),
    fila({ cliente_id: 902, created_at: '2026-09-07T10:00:00Z' }),
  ]);

  assert.deepEqual(filas.map(f => f.cliente_id), [901, 900, 902]);
});

test('las altas normales del log no entran a la lista', () => {
  const filas = filasSegmentoPendiente([
    { created_at: '2026-09-09T10:00:00Z', rfc: 'XAXX010101000', nombre: 'Otro', resultado: 'creado', cliente_id: 700, fuente: 'alta-generica', error_msg: null },
  ]);

  assert.deepEqual(filas, []);
});

test('un motivo sin las dos capas se lista igual: el detalle queda vacio, nunca se pierde la fila', () => {
  const filas = filasSegmentoPendiente([fila({ cliente_id: 900, created_at: '2026-09-09T10:00:00Z', error_msg: 'se cayo la red' })]);

  assert.equal(filas[0].motivo, 'se cayo la red');
  assert.equal(filas[0].detalle, '');
});

test('un log vacio o nulo no truena, devuelve []', () => {
  assert.deepEqual(filasSegmentoPendiente([]), []);
  assert.deepEqual(filasSegmentoPendiente(null), []);
});
