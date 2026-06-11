import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularColaProspectos, semaforo, UMBRAL_MENSAJERIA, UMBRAL_RESTO,
  UMBRALES_POR_CANAL, SUGERIR_NO_UTIL_TOQUES,
} from '../lib/seguimiento-prospectos.js';
import { CANALES } from '../public/js/prospectos-logica.js';

// Instante inyectado de referencia: miercoles 10 jun 2026, 12:00 CDMX (18:00Z).
const AHORA = new Date('2026-06-10T18:00:00Z');

let nextId = 1;
function prospecto(extra = {}) {
  return {
    id: nextId++, fecha: '2026-06-10T16:00:00Z', vendedor: 'Memo',
    celular: '+52 5512345678', nombre: 'Laura', ciudad: 'Puebla',
    canal: 'WhatsApp', etapa: 'nuevo', eventos: [], data: {},
    ...extra,
  };
}

function toque(fecha) {
  return { tipo: 'toque', fecha, vendedor: 'Memo' };
}

test('S1: solo entran prospectos en etapa nuevo, contactado o calificado', () => {
  const cola = calcularColaProspectos([
    prospecto({ etapa: 'nuevo' }),
    prospecto({ etapa: 'contactado' }),
    prospecto({ etapa: 'calificado' }),
    prospecto({ etapa: 'cotizado' }),
    prospecto({ etapa: 'no_util' }),
  ], AHORA);
  assert.equal(cola.length, 3);
  assert.deepEqual(cola.map(i => i.etapa).sort(), ['calificado', 'contactado', 'nuevo']);
});

test('S2: sin toques las horas corren desde la captura', () => {
  // capturado miercoles 10:00 CDMX, ahora 12:00 CDMX
  const cola = calcularColaProspectos([prospecto()], AHORA);
  assert.equal(cola[0].horas, 2);
  assert.equal(cola[0].toques, 0);
});

test('S3: registrar un toque reinicia el reloj al ultimo toque', () => {
  const p = prospecto({
    fecha: '2026-06-08T16:00:00Z', // lunes 10:00 CDMX
    eventos: [
      toque('2026-06-09T16:00:00Z'), // martes 10:00 CDMX
      toque('2026-06-10T17:00:00Z'), // miercoles 11:00 CDMX
    ],
  });
  const cola = calcularColaProspectos([p], AHORA);
  assert.equal(cola[0].horas, 1);
  assert.equal(cola[0].toques, 2);
});

test('S4: capturado en fin de semana no acumula espera', () => {
  // capturado sabado 15:00 CDMX (tras el cierre), evaluado el domingo
  const p = prospecto({ fecha: '2026-06-13T21:00:00Z' });
  const cola = calcularColaProspectos([p], new Date('2026-06-14T18:00:00Z'));
  assert.equal(cola[0].horas, 0);
  assert.equal(cola[0].color, 'verde');
});

test('S5: semaforo de mensajeria: rojo a las 2 h, ambar a la 1', () => {
  assert.equal(semaforo(0.5, 'WhatsApp'), 'verde');
  assert.equal(semaforo(1, 'WhatsApp'), 'ambar');
  assert.equal(semaforo(1.9, 'Instagram'), 'ambar');
  assert.equal(semaforo(2, 'WhatsApp'), 'rojo');
  assert.equal(semaforo(5, 'Meta Ads'), 'rojo');
  assert.equal(semaforo(2, 'Facebook/Messenger'), 'rojo');
});

test('S6: semaforo del resto de canales: rojo a las 8 h, ambar a las 4', () => {
  assert.equal(semaforo(3.9, 'Correo'), 'verde');
  assert.equal(semaforo(4, 'Formulario web'), 'ambar');
  assert.equal(semaforo(7.9, 'Referido'), 'ambar');
  assert.equal(semaforo(8, 'Correo'), 'rojo');
  assert.equal(semaforo(9, 'Feria/Expo'), 'rojo');
});

test('S7: los umbrales son data exportada y cubren todos los canales del catalogo', () => {
  assert.deepEqual(UMBRAL_MENSAJERIA, { ambar: 1, rojo: 2 });
  assert.deepEqual(UMBRAL_RESTO, { ambar: 4, rojo: 8 });
  for (const canal of CANALES) {
    assert.ok(UMBRALES_POR_CANAL[canal], `canal sin umbral: ${canal}`);
  }
  assert.equal(UMBRALES_POR_CANAL['WhatsApp'], UMBRAL_MENSAJERIA);
  assert.equal(UMBRALES_POR_CANAL['Instagram'], UMBRAL_MENSAJERIA);
  assert.equal(UMBRALES_POR_CANAL['Facebook/Messenger'], UMBRAL_MENSAJERIA);
  assert.equal(UMBRALES_POR_CANAL['Meta Ads'], UMBRAL_MENSAJERIA);
  assert.equal(UMBRALES_POR_CANAL['Correo'], UMBRAL_RESTO);
  assert.equal(UMBRALES_POR_CANAL['Formulario web'], UMBRAL_RESTO);
  // canal desconocido cae al umbral tolerante
  assert.equal(semaforo(2, 'Telegrama'), 'verde');
});

test('S8: a partir del tercer toque la cola sugiere No util; antes no', () => {
  assert.equal(SUGERIR_NO_UTIL_TOQUES, 3);
  const dos = prospecto({ eventos: [toque('2026-06-10T16:30:00Z'), toque('2026-06-10T17:00:00Z')] });
  const tres = prospecto({ eventos: [
    toque('2026-06-10T16:30:00Z'), toque('2026-06-10T17:00:00Z'), toque('2026-06-10T17:30:00Z'),
  ] });
  // otros eventos no cuentan como toque
  tres.eventos.push({ tipo: 'etapa', de: 'nuevo', a: 'contactado', fecha: '2026-06-10T17:40:00Z', vendedor: 'Memo' });
  const cola = calcularColaProspectos([dos, tres], AHORA);
  const itemDos = cola.find(i => i.id === dos.id);
  const itemTres = cola.find(i => i.id === tres.id);
  assert.equal(itemDos.sugerirNoUtil, false);
  assert.equal(itemDos.toques, 2);
  assert.equal(itemTres.sugerirNoUtil, true);
  assert.equal(itemTres.toques, 3);
});

test('S9: la cola ordena por urgencia relativa al umbral del canal, mas urgente primero', () => {
  const a = prospecto({ nombre: 'A', fecha: '2026-06-10T16:30:00Z' }); // WhatsApp 1.5 h (ratio 0.75)
  const b = prospecto({ nombre: 'B', canal: 'Correo', fecha: '2026-06-09T21:00:00Z' }); // 5 h (ratio 0.625)
  const c = prospecto({ nombre: 'C', fecha: '2026-06-09T23:00:00Z' }); // WhatsApp 3 h (ratio 1.5)
  const cola = calcularColaProspectos([a, b, c], AHORA);
  assert.deepEqual(cola.map(i => i.nombre), ['C', 'A', 'B']);
  assert.equal(cola[0].color, 'rojo');
});

test('S10: la cola expone los datos que la UI necesita', () => {
  const p = prospecto({ data: { empresa: 'Hotel Azul' } });
  const [item] = calcularColaProspectos([p], AHORA);
  assert.equal(item.id, p.id);
  assert.equal(item.nombre, 'Laura');
  assert.equal(item.celular, '+52 5512345678');
  assert.equal(item.ciudad, 'Puebla');
  assert.equal(item.canal, 'WhatsApp');
  assert.equal(item.etapa, 'nuevo');
  assert.equal(item.vendedor, 'Memo');
  assert.equal(item.color, 'rojo');
});

test('S12: el prospecto convertido en cliente sigue en la cola con la bandera yaEsCliente (#46)', () => {
  const convertido = prospecto({ etapa: 'contactado', data: { cliente_id: 88 } });
  const normal = prospecto({ data: {} });
  const sinData = prospecto({ data: null });
  const cola = calcularColaProspectos([convertido, normal, sinData], AHORA);
  assert.equal(cola.length, 3);
  assert.equal(cola.find(i => i.id === convertido.id).yaEsCliente, true);
  assert.equal(cola.find(i => i.id === normal.id).yaEsCliente, false);
  assert.equal(cola.find(i => i.id === sinData.id).yaEsCliente, false);
});

test('S11: lista vacia o sin activos devuelve cola vacia', () => {
  assert.deepEqual(calcularColaProspectos([], AHORA), []);
  assert.deepEqual(calcularColaProspectos([prospecto({ etapa: 'cotizado' })], AHORA), []);
});

// === Issue #45: reunion diagnostico (CONTEXT.md, "Captura de prospecto") ===

function reunion(fechaReunion, fecha = '2026-06-10T16:30:00Z') {
  return { tipo: 'reunion', fecha_reunion: fechaReunion, fecha, vendedor: 'Memo' };
}

test('R1: reunion futura suprime al prospecto de la cola; la card normal no se ve afectada', () => {
  const conReunion = prospecto({ eventos: [reunion('2026-06-12T17:00:00Z')] });
  const normal = prospecto();
  const cola = calcularColaProspectos([conReunion, normal], AHORA);
  assert.equal(cola.length, 1);
  assert.equal(cola[0].id, normal.id);
});

test('R2: reunion pasada sin evento posterior reaparece al frente con reunionVencida y fechaReunion', () => {
  const vencida = prospecto({ eventos: [reunion('2026-06-10T17:00:00Z', '2026-06-09T16:00:00Z')] });
  // capturado el lunes: mas urgente por horas, pero la reunion vencida va primero
  const urgente = prospecto({ fecha: '2026-06-08T16:00:00Z' });
  const cola = calcularColaProspectos([urgente, vencida], AHORA);
  assert.equal(cola.length, 2);
  assert.equal(cola[0].id, vencida.id);
  assert.equal(cola[0].reunionVencida, true);
  assert.equal(cola[0].fechaReunion, '2026-06-10T17:00:00Z');
  assert.equal(cola[1].reunionVencida, false);
});

test('R3: cualquier evento posterior a la fecha de la reunion limpia el pendiente de resultado', () => {
  const conToque = prospecto({ eventos: [
    reunion('2026-06-10T16:30:00Z', '2026-06-09T16:00:00Z'),
    toque('2026-06-10T17:00:00Z'),
  ] });
  const conEtapa = prospecto({ eventos: [
    reunion('2026-06-10T16:30:00Z', '2026-06-09T16:00:00Z'),
    { tipo: 'etapa', de: 'nuevo', a: 'contactado', fecha: '2026-06-10T17:00:00Z', vendedor: 'Memo' },
  ], etapa: 'contactado' });
  const cola = calcularColaProspectos([conToque, conEtapa], AHORA);
  assert.equal(cola.length, 2);
  assert.equal(cola.find(i => i.id === conToque.id).reunionVencida, false);
  assert.equal(cola.find(i => i.id === conEtapa.id).reunionVencida, false);
});

test('R4: re-agendar manda la ultima reunion', () => {
  // la primera paso pero se re-agendo al futuro -> suprimido
  const reagendado = prospecto({ eventos: [
    reunion('2026-06-10T16:00:00Z', '2026-06-09T16:00:00Z'),
    reunion('2026-06-12T17:00:00Z', '2026-06-10T17:00:00Z'),
  ] });
  assert.deepEqual(calcularColaProspectos([reagendado], AHORA), []);
  // ambas pasadas: el pendiente se mide contra la ultima
  const dosVencidas = prospecto({ eventos: [
    reunion('2026-06-09T17:00:00Z', '2026-06-09T16:00:00Z'),
    reunion('2026-06-10T17:00:00Z', '2026-06-09T18:00:00Z'),
  ] });
  const cola = calcularColaProspectos([dosVencidas], AHORA);
  assert.equal(cola[0].reunionVencida, true);
  assert.equal(cola[0].fechaReunion, '2026-06-10T17:00:00Z');
});
