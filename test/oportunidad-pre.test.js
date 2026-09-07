// Nucleo puro de la Oportunidad pre-cotizacion (#343, spec #337, ADR-0016,
// CONTEXT.md "Oportunidad"): la fila de prospectos queda como Contacto y la
// intencion de compra pasa a vivir en su propio registro. Aqui se prueban la
// separacion (migracion) y la fusion de lectura, sin IO.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planearSeparacion, oportunidadesDeContactos, principalPorContacto,
  filaNuevaOportunidad, MOTIVO_YA_SEPARADA, MOTIVO_SIN_CAPTURA, MOTIVO_ES_LA_COTIZACION,
} from '../lib/oportunidad-pre.js';

const hace = (dias) => new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

// (1) Contacto capturado que todavia no cotiza: su Oportunidad se separa tal
// cual, con su etapa y sus eventos.
const LAURA = {
  id: 1, fecha: hace(2), vendedor: 'Memo', celular: '+52 55 1234 5678', celular10: '5512345678',
  nombre: 'Laura', ciudad: 'Puebla', canal: 'Instagram', etapa: 'por_cotizar',
  eventos: [{ tipo: 'toque', fecha: hace(1), vendedor: 'Memo' }], data: { empresa: 'Hotel Azul' },
};
// (1 bis) Lead sin dueno: misma regla, otra etapa.
const SIN_DUENO = {
  id: 2, fecha: hace(1), vendedor: null, celular: '+52 5511112222', celular10: '5511112222',
  nombre: 'Mayoreo Web', ciudad: 'Toluca', canal: 'Formulario web', etapa: 'no_asignado',
  eventos: [], data: {},
};
// (2) Contacto en Seguimiento cuya cotizacion existe: la cotizacion ES la
// Oportunidad, no nace ningun registro.
const JORGE = {
  id: 3, fecha: hace(9), vendedor: 'Memo', celular: '+52 5555550001', celular10: '5555550001',
  nombre: 'Jorge Orea', ciudad: 'CDMX', canal: 'Feria/Expo', etapa: 'seguimiento',
  eventos: [{ tipo: 'cotizacion', cotizacion_id: 10, fecha: hace(8), vendedor: 'Memo' }], data: {},
};
// (3) Contacto en Seguimiento con folio capturado a mano (#56): cotizo POR
// FUERA, no hay cotizacion en el sistema, la Oportunidad se separa con su folio.
const ROSA = {
  id: 4, fecha: hace(5), vendedor: 'Memo', celular: '+52 5533334444', celular10: '5533334444',
  nombre: 'Rosa', ciudad: 'Leon', canal: 'WhatsApp', etapa: 'seguimiento',
  eventos: [{ tipo: 'etapa', de: 'por_cotizar', a: 'seguimiento', folio: '1250', fecha: hace(4) }],
  data: { folioOperam: '1250' },
};
// Contacto nacido de la migracion de #342: nadie lo capturo, no hay intencion
// abierta suya que separar.
const HISTORICO = {
  id: 5, fecha: hace(30), vendedor: 'Memo', celular: '+52 5544443333', celular10: '5544443333',
  nombre: 'Cliente Historico', ciudad: '', canal: null, etapa: 'por_cotizar',
  eventos: [], data: { sinCaptura: true },
};

const COT_JORGE = {
  id: 10, fecha: hace(8), vendedor: 'Memo', cliente: 'JORGE OREA', etapa: 'seguimiento',
  contactoCelular: '5555550001', data: { cliente: { telefono: '+52 5555550001' } },
};

const CONTACTOS = [LAURA, SIN_DUENO, JORGE, ROSA, HISTORICO];

function planPorContacto(plan) {
  return Object.fromEntries(plan.map(p => [p.contactoId, p]));
}

test('#343: los tres casos de la separacion -- se separa, ninguna, y la de folio manual', () => {
  const plan = planPorContacto(planearSeparacion(CONTACTOS, [COT_JORGE], []));
  // (1) No Asignado / Por Cotizar -> una Oportunidad con su etapa
  assert.equal(plan[1].crear, true);
  assert.equal(plan[1].fila.etapa, 'por_cotizar');
  assert.equal(plan[1].fila.vendedor, 'Memo');
  assert.deepEqual(plan[1].fila.eventos, LAURA.eventos);
  assert.equal(plan[2].crear, true);
  assert.equal(plan[2].fila.etapa, 'no_asignado');
  // (2) Seguimiento cuya cotizacion existe -> ninguna
  assert.equal(plan[3].crear, false);
  assert.equal(plan[3].motivo, MOTIVO_ES_LA_COTIZACION);
  // (3) Seguimiento con folio capturado a mano y sin cotizacion -> una
  // Oportunidad en Seguimiento con ese folio
  assert.equal(plan[4].crear, true);
  assert.equal(plan[4].fila.etapa, 'seguimiento');
  assert.equal(plan[4].fila.data.folioOperam, '1250');
});

test('#343: el Contacto que nadie capturo no genera Oportunidad', () => {
  const plan = planPorContacto(planearSeparacion(CONTACTOS, [COT_JORGE], []));
  assert.equal(plan[5].crear, false);
  assert.equal(plan[5].motivo, MOTIVO_SIN_CAPTURA);
});

test('#343: la separacion es idempotente -- lo ya separado no se vuelve a crear', () => {
  const primera = planearSeparacion(CONTACTOS, [COT_JORGE], []);
  const creadas = primera.filter(p => p.crear).map((p, i) => ({ id: 100 + i, ...p.fila }));
  const segunda = planPorContacto(planearSeparacion(CONTACTOS, [COT_JORGE], creadas));
  assert.equal(segunda[1].crear, false);
  assert.equal(segunda[1].motivo, MOTIVO_YA_SEPARADA);
  assert.equal(segunda.every === undefined || Object.values(segunda).every(p => !p.crear), true);
});

// La lectura tiene que funcionar ANTES de que la separacion corra: el deploy
// llega antes que el --apply. Un Contacto sin registro propio SIGUE siendo su
// propia Oportunidad, con su mismo id.
test('#343: sin separacion aplicada, el Contacto es su propia Oportunidad', () => {
  const filas = oportunidadesDeContactos([LAURA], []);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].id, 1);
  assert.equal(filas[0].propia, false);
  assert.equal(filas[0].contactoId, 1);
  assert.equal(filas[0].etapa, 'por_cotizar');
  assert.equal(filas[0].nombre, 'Laura');
  assert.equal(filas[0].celular10, '5512345678');
  assert.equal(filas[0].data.empresa, 'Hotel Azul');
});

test('#343: un Contacto con varias Oportunidades da una fila por Oportunidad', () => {
  const separada = { id: 100, fecha: hace(2), contactoId: 1, contacto10: '5512345678', vendedor: 'Memo', etapa: 'por_cotizar', eventos: [], data: {} };
  const nueva = { id: 101, fecha: hace(0), contactoId: 1, contacto10: '5512345678', vendedor: 'Memo', etapa: 'por_cotizar', eventos: [], data: {} };
  const filas = oportunidadesDeContactos([LAURA], [separada, nueva]);
  assert.deepEqual(filas.map(f => f.id), [100, 101]);
  assert.equal(filas.every(f => f.propia && f.contactoId === 1 && f.nombre === 'Laura'), true);
  // Los datos del Contacto viajan en las dos; el dato de la Oportunidad manda.
  assert.equal(filas[0].data.empresa, 'Hotel Azul');
});

// Una fila huerfana (su Contacto ya no existe) no puede producir tarjeta: la
// Oportunidad sin Contacto no existe en el modelo (ADR-0016).
test('#343: una Oportunidad sin su Contacto no produce fila', () => {
  const huerfana = { id: 100, fecha: hace(2), contactoId: 99, contacto10: '5599999999', vendedor: 'Memo', etapa: 'por_cotizar', eventos: [], data: {} };
  assert.deepEqual(oportunidadesDeContactos([LAURA], [huerfana]).map(f => f.id), [1]);
});

// La lista de personas (el buscador, la lista de prospectos) muestra a cada
// Contacto UNA vez: manda su Oportunidad activa mas reciente.
test('#343: principalPorContacto devuelve una fila por Contacto y prefiere la activa mas reciente', () => {
  const vieja = { id: 100, fecha: hace(10), contactoId: 1, contacto10: '5512345678', vendedor: 'Memo', etapa: 'no_util', eventos: [], data: {} };
  const nueva = { id: 101, fecha: hace(1), contactoId: 1, contacto10: '5512345678', vendedor: 'Memo', etapa: 'por_cotizar', eventos: [], data: {} };
  const filas = oportunidadesDeContactos([LAURA, SIN_DUENO], [vieja, nueva]);
  const principales = principalPorContacto(filas);
  assert.deepEqual(principales.map(f => f.id).sort((a, b) => a - b), [2, 101]);
});

// AC1/AC2: la Oportunidad nueva nace en Por Cotizar, asignada a quien la abre,
// con evento de apertura. NO guarda origen: lo hereda del Contacto.
test('#343: la Oportunidad nueva nace en Por Cotizar, asignada y con evento de apertura', () => {
  const ahora = new Date('2026-09-06T15:00:00.000Z');
  const fila = filaNuevaOportunidad(LAURA, 'Ana', ahora);
  assert.equal(fila.etapa, 'por_cotizar');
  assert.equal(fila.vendedor, 'Ana');
  assert.equal(fila.contactoId, 1);
  assert.equal(fila.contacto10, '5512345678');
  assert.equal(fila.fecha, ahora.toISOString());
  assert.deepEqual(fila.eventos, [{ tipo: 'apertura', fecha: ahora.toISOString(), vendedor: 'Ana' }]);
  assert.equal('canal' in fila, false);
  assert.deepEqual(fila.data, {});
});
