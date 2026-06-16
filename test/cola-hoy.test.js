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

test('H3: se ordena por urgencia relativa al umbral de cada tipo, sin importar el reloj', () => {
  // Cotizacion vencida: 30 dias naturales / umbral 28 -> urgencia ~1.07.
  const cotVencida = cotizacion({ fecha: '2026-05-11T18:00:00Z' });
  // Prospecto WhatsApp en ambar: 1.5 horas habiles / umbral rojo 2 -> urgencia 0.75.
  // (capturado miercoles 10:30 CDMX, ahora 12:00 CDMX)
  const prospAmbar = prospecto({ fecha: '2026-06-10T16:30:00Z' });
  const cola = calcularColaHoy([prospAmbar], [cotVencida], AHORA);
  assert.deepEqual(cola.map(i => i.tipo), ['cotizacion', 'prospecto']);
  // La urgencia es comparable entre tipos y descendente.
  assert.ok(cola[0].urgencia > cola[1].urgencia);
  assert.ok(cola[0].urgencia >= 1);     // cotizacion vencida supero su umbral
  assert.ok(cola[1].urgencia < 1);      // prospecto en ambar aun no llega a rojo
});

test('H4: un prospecto rojo gana a una cotizacion apenas en dia 2', () => {
  // Prospecto WhatsApp rojo: 3 horas habiles / umbral rojo 2 -> urgencia 1.5.
  // (capturado miercoles 09:00 CDMX, antes de abrir; cuenta desde las 10:00)
  const prospRojo = prospecto({ fecha: '2026-06-10T15:00:00Z' });
  // Cotizacion recien en dia 2: 2 dias / 28 -> urgencia ~0.07.
  const cotDia2 = cotizacion({ fecha: '2026-06-08T18:00:00Z' });
  const cola = calcularColaHoy([prospRojo], [cotDia2], AHORA);
  assert.deepEqual(cola.map(i => i.tipo), ['prospecto', 'cotizacion']);
  assert.ok(cola[0].urgencia >= 1);
  assert.ok(cola[1].urgencia < cola[0].urgencia);
});

test('H5: una reunion de prospecto vencida encabeza la cola por encima de cualquier urgencia', () => {
  const prospReunion = prospecto({
    eventos: [{ tipo: 'reunion', fecha: '2026-06-05T18:00:00Z', fecha_reunion: '2026-06-09T18:00:00Z', vendedor: 'Memo' }],
  });
  const cotVencida = cotizacion({ fecha: '2026-04-01T18:00:00Z' }); // muy vencida
  const cola = calcularColaHoy([prospReunion], [cotVencida], AHORA);
  assert.equal(cola[0].tipo, 'prospecto');
  assert.equal(cola[0].reunionVencida, true);
});
