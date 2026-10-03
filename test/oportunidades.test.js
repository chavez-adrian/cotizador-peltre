// Nucleo puro de las tarjetas del tablero (lib/oportunidades.js): los campos que
// #519 agrega para los accesos de WhatsApp y Correo de la Oportunidad.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tarjetasOportunidades } from '../lib/oportunidades.js';
import { calcularCola } from '../lib/seguimiento.js';

const AHORA = new Date('2026-06-20T12:00:00Z');

function contacto(extra) {
  return {
    id: 7, celular: '+52 55 1234 5678', nombre: 'Laura', vendedor: 'Memo', etapa: 'seguimiento',
    fecha: '2026-06-01T00:00:00Z', eventos: [], data: {}, ...extra,
  };
}

function cotizacion(extra) {
  return {
    id: 51, cliente: 'Hotel Azul', vendedor: 'Memo', total: 5000, totalPiezas: 50,
    etapa: 'seguimiento', estado: 'abierta', fecha: '2026-06-10T00:00:00Z',
    contactoCelular: '+525512345678', seguimientos: [], eventos: [],
    data: { cliente: { nombreCorto: 'Hotel Azul', celEntrega: '5598765432' } },
    ...extra,
  };
}

function tarjetaDe(tarjetas, tipo) {
  return tarjetas.find(t => t.tipo === tipo);
}

test('#519 correo: la cotizacion toma el correo del Contacto', () => {
  const t = tarjetasOportunidades([], [cotizacion({ data: { cliente: { emailEntrega: 'compras@hotel.mx' } } })], {
    contactos: [contacto({ data: { correo: 'laura@hotel.mx' } })], ahora: AHORA,
  });
  assert.equal(tarjetaDe(t, 'cotizacion').correo, 'laura@hotel.mx');
});

test('#519 correo: sin correo del Contacto, el de entrega de la cotizacion', () => {
  const t = tarjetasOportunidades([], [cotizacion({ data: { cliente: { emailEntrega: 'compras@hotel.mx' } } })], {
    contactos: [contacto()], ahora: AHORA,
  });
  assert.equal(tarjetaDe(t, 'cotizacion').correo, 'compras@hotel.mx');
});

test('#519 correo: sin ninguno, null', () => {
  const t = tarjetasOportunidades([], [cotizacion({ contactoCelular: null })], { contactos: [contacto()], ahora: AHORA });
  assert.equal(tarjetaDe(t, 'cotizacion').correo, null);
});

test('#519 correo: el prospecto lleva el correo de su ficha', () => {
  const t = tarjetasOportunidades([contacto({ etapa: 'por_cotizar', data: { correo: 'laura@hotel.mx' } })], [], { ahora: AHORA });
  assert.equal(tarjetaDe(t, 'prospecto').correo, 'laura@hotel.mx');
  const sin = tarjetasOportunidades([contacto({ etapa: 'por_cotizar' })], [], { ahora: AHORA });
  assert.equal(tarjetaDe(sin, 'prospecto').correo, null);
});

test('#519 correo: sin la lista de contactos, el de las filas de prospecto basta para la cotizacion', () => {
  const t = tarjetasOportunidades([contacto({ etapa: 'por_cotizar', data: { correo: 'laura@hotel.mx' } })], [cotizacion()], { ahora: AHORA });
  assert.equal(tarjetaDe(t, 'cotizacion').correo, 'laura@hotel.mx');
});

test('#519 mensaje: cotizacion en Seguimiento con paso pendiente lleva el MISMO mensaje que la cola Hoy', () => {
  const c = cotizacion();
  const [item] = calcularCola([c], AHORA);
  assert.ok(item && item.paso, 'la cotizacion de prueba tiene paso pendiente en Hoy');
  const t = tarjetasOportunidades([], [c], { ahora: AHORA });
  assert.equal(tarjetaDe(t, 'cotizacion').mensajeSeguimiento, item.mensaje);
});

test('#519 mensaje: sin paso pendiente (ya hecho o antes del dia 2) no hay mensaje', () => {
  const hecho = cotizacion({ seguimientos: [{ paso: 'dia7', fecha: '2026-06-18T00:00:00Z' }] });
  assert.equal(tarjetaDe(tarjetasOportunidades([], [hecho], { ahora: AHORA }), 'cotizacion').mensajeSeguimiento, null);
  const reciente = cotizacion({ fecha: '2026-06-19T12:00:00Z' });
  assert.equal(tarjetaDe(tarjetasOportunidades([], [reciente], { ahora: AHORA }), 'cotizacion').mensajeSeguimiento, null);
});

test('#519 mensaje: con reunion futura (Hoy suprime la cadencia) no hay mensaje', () => {
  const c = cotizacion({ seguimientos: [{ tipo: 'reunion', fecha_reunion: '2026-06-25T17:00:00Z', fecha: '2026-06-19T00:00:00Z' }] });
  assert.equal(calcularCola([c], AHORA).length, 0);
  assert.equal(tarjetaDe(tarjetasOportunidades([], [c], { ahora: AHORA }), 'cotizacion').mensajeSeguimiento, null);
});

test('#519 mensaje: una ganada que sigue en Seguimiento no lleva mensaje (Hoy tampoco la trabaja)', () => {
  const c = cotizacion({ estado: 'ganada' });
  assert.equal(calcularCola([c], AHORA).length, 0);
  assert.equal(tarjetaDe(tarjetasOportunidades([], [c], { ahora: AHORA }), 'cotizacion').mensajeSeguimiento, null);
});

test('#519 mensaje: post-venta y prospecto no llevan mensaje', () => {
  const t = tarjetasOportunidades([contacto({ etapa: 'por_cotizar', celular: '+52 33 1111 2222' })], [cotizacion({ etapa: 'anticipo_pagado' })], { ahora: AHORA });
  assert.equal(tarjetaDe(t, 'cotizacion').mensajeSeguimiento, null);
  assert.equal(tarjetaDe(t, 'prospecto').mensajeSeguimiento ?? null, null);
});
