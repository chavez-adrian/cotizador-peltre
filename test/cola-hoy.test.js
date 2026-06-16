import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularColaHoy } from '../lib/cola-hoy.js';

// Instante de referencia: miercoles 10 jun 2026, 12:00 CDMX (18:00Z). El mismo
// que usan los dos motores en sus propios tests, para que las horas habiles y
// los dias naturales caigan donde se espera.
const AHORA = new Date('2026-06-10T18:00:00Z');

let nextPid = 1;
function prospecto(extra = {}) {
  return {
    id: nextPid++, fecha: '2026-06-10T16:00:00Z', vendedor: 'Memo',
    celular: '+52 5512345678', nombre: 'Laura', ciudad: 'Puebla',
    canal: 'WhatsApp', etapa: 'por_cotizar', eventos: [], data: {},
    ...extra,
  };
}

let nextCid = 100;
function cotizacion(extra = {}) {
  return {
    id: nextCid++, fecha: '2026-06-07T18:00:00Z', vendedor: 'Memo',
    cliente: 'RESTAURANTE LA LUPITA', totalPiezas: 200, total: 15000, tier: 'M100',
    data: { cliente: { razonSocial: 'RESTAURANTE LA LUPITA', rfc: 'RLU200101AAA', telefono: '5512345678' }, items: [] },
    ...extra,
  };
}

test('H1: la cola fusionada mezcla prospectos y cotizaciones en un solo listado, cada uno etiquetado con su tipo', () => {
  const cola = calcularColaHoy(
    [prospecto()],
    [cotizacion()],
    AHORA
  );
  const tipos = cola.map(i => i.tipo).sort();
  assert.deepEqual(tipos, ['cotizacion', 'prospecto']);
  assert.equal(cola.length, 2);
});

test('H2: cada tipo conserva su reloj (prospecto en horas habiles, cotizacion en dias naturales)', () => {
  const cola = calcularColaHoy(
    [prospecto()],            // capturado 10:00 CDMX, ahora 12:00 -> 2 horas habiles
    [cotizacion()],           // cotizada hace 3 dias naturales
    AHORA
  );
  const prosp = cola.find(i => i.tipo === 'prospecto');
  const cot = cola.find(i => i.tipo === 'cotizacion');
  assert.equal(prosp.horas, 2);
  assert.equal(prosp.dias, undefined);
  assert.equal(cot.dias, 3);
  assert.equal(cot.horas, undefined);
});
