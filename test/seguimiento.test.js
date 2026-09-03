import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularCola, pasoCadencia, telefonoWa, telefonoValido } from '../lib/seguimiento.js';

const HOY = new Date('2026-06-10T12:00:00Z');

function cot(overrides = {}) {
  return {
    id: 1,
    fecha: '2026-06-07T12:00:00Z',
    vendedor: 'Memo',
    cliente: 'RESTAURANTE LA LUPITA',
    totalPiezas: 200,
    total: 15000,
    tier: 'M100',
    data: { cliente: { razonSocial: 'RESTAURANTE LA LUPITA', rfc: 'RLU200101AAA', telefono: '5512345678' }, items: [] },
    ...overrides,
  };
}

test('cotizacion de 3 dias sin seguimientos aparece en cola con paso dia2', () => {
  const cola = calcularCola([cot()], HOY);
  assert.equal(cola.length, 1);
  assert.equal(cola[0].id, 1);
  assert.equal(cola[0].paso, 'dia2');
  assert.equal(cola[0].dias, 3);
});

test('a dia 8 sin seguimientos solo aparece el paso mas avanzado pendiente (dia7)', () => {
  const cola = calcularCola([cot({ fecha: '2026-06-02T12:00:00Z' })], HOY);
  assert.equal(cola.length, 1);
  assert.equal(cola[0].paso, 'dia7');
});

test('paso ya registrado no vuelve a aparecer', () => {
  const c = cot({ seguimientos: [{ paso: 'dia2', fecha: '2026-06-09T15:00:00Z' }] });
  const cola = calcularCola([c], HOY);
  assert.equal(cola.length, 0);
});

test('con dia2 registrado y 8 dias transcurridos toca dia7', () => {
  const c = cot({ fecha: '2026-06-02T12:00:00Z', seguimientos: [{ paso: 'dia2', fecha: '2026-06-04T15:00:00Z' }] });
  const cola = calcularCola([c], HOY);
  assert.equal(cola.length, 1);
  assert.equal(cola[0].paso, 'dia7');
});

test('cotizacion de 1 dia no aparece en cola', () => {
  const cola = calcularCola([cot({ fecha: '2026-06-09T12:00:00Z' })], HOY);
  assert.equal(cola.length, 0);
});

// La cola Hoy expone el folio de Operam de cada cotizacion para que la tarjeta
// distinga PRE / #Operam N (issue #63). Sin folio, el item lo trae como null.
test('cada item de la cola expone el folio de Operam (null si es pre-cotizacion)', () => {
  const pre = calcularCola([cot({ id: 1 })], HOY);
  assert.equal(pre[0].folioOperam, null);
  const registrada = calcularCola([cot({ id: 2, folioOperam: '55123' })], HOY);
  assert.equal(registrada[0].folioOperam, '55123');
});

test('cotizaciones ganadas, perdidas o descartadas no aparecen', () => {
  const cola = calcularCola([
    cot({ id: 1, estado: 'ganada' }),
    cot({ id: 2, estado: 'perdida' }),
    cot({ id: 3, estado: 'descartada' }),
  ], HOY);
  assert.equal(cola.length, 0);
});

test('cada item de cola trae cliente, vendedor, total, mensaje y waLink', () => {
  const cola = calcularCola([cot()], HOY);
  const item = cola[0];
  assert.equal(item.cliente, 'RESTAURANTE LA LUPITA');
  assert.equal(item.vendedor, 'Memo');
  assert.equal(item.total, 15000);
  assert.equal(item.totalPiezas, 200);
  assert.equal(item.telefono, '525512345678');
  assert.ok(item.mensaje.length > 20);
  assert.ok(item.waLink.startsWith('https://wa.me/525512345678?text='));
  assert.ok(item.waLink.includes(encodeURIComponent('cotiza').slice(0, 6)));
});

test('el waLink prefiere el celular de entrega sobre el telefono del negocio', () => {
  const c = cot({ data: { cliente: {
    razonSocial: 'MUSEO FRIDA KAHLO', rfc: 'MFK200101AAA',
    telefono: '+52 55 1111 1111', celEntrega: '+52 55 2222 2222',
  }, items: [] } });
  const cola = calcularCola([c], HOY);
  assert.equal(cola[0].telefono, '525522222222');
});

test('el mensaje saluda por nombre, presenta al vendedor y no trae emoji', () => {
  const cola = calcularCola([cot()], HOY);
  const m = cola[0].mensaje;
  assert.ok(m.startsWith('Hola RESTAURANTE LA LUPITA, te escribe Memo de pp.peltre'));
  assert.ok(m.includes('cotización que te enviamos el'));
  assert.equal(m.includes('😊'), false);
  assert.equal(m.includes('�'), false);
});

test('sin telefono el item aparece con waLink null', () => {
  const c = cot({ data: { cliente: { razonSocial: 'RESTAURANTE LA LUPITA', rfc: 'RLU200101AAA' }, items: [] } });
  const cola = calcularCola([c], HOY);
  assert.equal(cola.length, 1);
  assert.equal(cola[0].waLink, null);
});

test('cada paso genera un mensaje distinto', () => {
  const mensajes = ['dia2', 'dia7', 'dia21', 'vencida'].map((paso, i) => {
    const fechas = { dia2: '2026-06-07', dia7: '2026-06-02', dia21: '2026-05-18', vencida: '2026-05-01' };
    const cola = calcularCola([cot({ fecha: `${fechas[paso]}T12:00:00Z` })], HOY);
    assert.equal(cola[0].paso, paso);
    return cola[0].mensaje;
  });
  assert.equal(new Set(mensajes).size, 4);
});

test('telefonoValido exige codigo de pais (8-15 con "+", 11-15 sin el)', () => {
  assert.equal(telefonoValido('+52 5512345678'), true);
  assert.equal(telefonoValido('525512345678'), true);
  assert.equal(telefonoValido('+1 5551234567'), true);
  assert.equal(telefonoValido('5512345678'), false);
  assert.equal(telefonoValido(''), false);
  assert.equal(telefonoValido(undefined), false);
  // '+52 55 1234' (8 digitos) dejo de rechazarse al bajar el piso en #175: por
  // LARGO es indistinguible de un numero legitimo de Aruba, y esta funcion no
  // conoce planes de numeracion. Ese caso lo atrapa la capa estricta (#176).
  assert.equal(telefonoValido('+52 1234'), false);
  assert.equal(telefonoValido('1234567890123456'), false);
});

test('telefonoWa normaliza numeros mexicanos de 10 digitos', () => {
  assert.equal(telefonoWa('5512345678'), '525512345678');
  assert.equal(telefonoWa('55 1234 5678'), '525512345678');
  assert.equal(telefonoWa('+52 55 1234 5678'), '525512345678');
  assert.equal(telefonoWa('525512345678'), '525512345678');
  assert.equal(telefonoWa(''), null);
  assert.equal(telefonoWa(undefined), null);
  assert.equal(telefonoWa('123'), null);
});

// El piso baja a 8 SOLO para el numero que ya viene en formato internacional. Un
// numero pelon de 10 digitos sigue siendo invalido: no se sabe de que pais es, y
// esa es justo la ambiguedad que el bloqueo duro de telefono vino a cerrar.
test('#175: telefonoValido acepta un internacional de 10 digitos totales', () => {
  assert.equal(telefonoValido('+297 563 3917'), true);  // Aruba
  assert.equal(telefonoValido('+507 263 4567'), true);  // fijo de Panama
  assert.equal(telefonoValido('5512345678'), false);    // pelon: sigue invalido
  assert.equal(telefonoValido('2975633917'), false);    // el de Aruba sin "+" tampoco
  assert.equal(telefonoValido('+123 4567'), false);     // 7 digitos: el borde justo debajo
  // 8 digitos: el piso exacto. El fixture cambio en #176 (antes '+1234 5678'):
  // desde que la reja aplica la regla nacional del pais cuando lo conoce, un
  // numero que empieza con el codigo 1 se juzga como NANP y 7 digitos
  // nacionales no son un numero NANP. El piso que este caso cuida es el mismo;
  // solo se mueve a un pais fuera de la tabla (Feroe, +298).
  assert.equal(telefonoValido('+298 12345'), true);
});

// La reja de telefonoValido ya no tiene verdad propia de largo: cuando el
// codigo de pais esta en REGLAS_TELEFONO (alta-logica.js) manda la MISMA regla
// nacional que validarTelefono aplica en el formulario (issue #176).
test('#176: telefonoValido aplica la regla nacional del pais que conoce', () => {
  assert.equal(telefonoValido('+52 55 1234'), false);        // 8 digitos, pero nacional de 6
  assert.equal(telefonoValido('+52 0512345678'), false);     // nacional que empieza con 0
  assert.equal(telefonoValido('+52 5512345678'), true);
  assert.equal(telefonoValido('+52 1 55 1234 5678'), true);  // legacy: el "1" se normaliza
  assert.equal(telefonoValido('+297 563 3917'), true);       // pais fuera de la tabla: solo largo
});

test('#176: telefonoWa normaliza el "1" legacy mexicano', () => {
  assert.equal(telefonoWa('+52 1 55 1234 5678'), '525512345678');
  assert.equal(telefonoWa('5215512345678'), '525512345678');
  assert.equal(telefonoWa('5512345678'), '525512345678');    // legacy pelon de 10: sigue con 52
  assert.equal(telefonoWa('+1 555 123 4567'), '15551234567'); // el 1 de NANP no se toca
});

// Antes de #175 este numero caia en la rama de 10 digitos y salia como
// wa.me/522975633917 -- un numero MEXICANO valido: mensaje a un desconocido.
test('#175: telefonoWa no re-nacionaliza un numero que ya trae codigo de pais', () => {
  assert.equal(telefonoWa('+297 563 3917'), '2975633917');
  assert.equal(telefonoWa('+507 263 4567'), '5072634567');
  assert.equal(telefonoWa('+52 55 1234 5678'), '525512345678');
  // El piso de 8 dentro de la rama del "+" no sobra: sin el, estos dos dejarian
  // de ser null y devolverian sus digitos sueltos como si fueran un numero.
  assert.equal(telefonoWa('+123'), null);
  assert.equal(telefonoWa('+52 1234'), null);
});

test('solo la ultima cotizacion por cliente entra a la cola', () => {
  const vieja = cot({ id: 1, fecha: '2026-06-01T12:00:00Z' });
  const nueva = cot({ id: 2, fecha: '2026-06-05T12:00:00Z' });
  const otroCliente = cot({
    id: 3, fecha: '2026-06-03T12:00:00Z', cliente: 'HOTEL AZUL',
    data: { cliente: { razonSocial: 'HOTEL AZUL', rfc: 'HAZ190101BBB', telefono: '5587654321' }, items: [] },
  });
  const cola = calcularCola([vieja, nueva, otroCliente], HOY);
  const ids = cola.map(i => i.id).sort();
  assert.deepEqual(ids, [2, 3]);
});

// === Issue #65: reunion de diagnostico sobre una COTIZACION en Seguimiento ===
// Las reuniones viven en el array seguimientos como entradas { tipo:'reunion',
// fecha_reunion, fecha }. Una entrada de reunion no tiene `paso`, asi que no
// interfiere con la cadencia (el map de pasos la ignora). HOY = 2026-06-10T12:00Z.

function reunionSeg(fechaReunion, fecha = '2026-06-08T12:00:00Z') {
  return { tipo: 'reunion', fecha_reunion: fechaReunion, fecha, vendedor: 'Memo' };
}

test('REU1: una reunion futura suprime la cotizacion de la cola', () => {
  // cotizacion de 3 dias (tocaria dia2) pero con reunion el 12 -> fuera de la cola
  const c = cot({ seguimientos: [reunionSeg('2026-06-12T17:00:00Z')] });
  assert.deepEqual(calcularCola([c], HOY), []);
});

test('REU2: una reunion vencida reaparece con reunionVencida y fechaReunion', () => {
  const c = cot({ seguimientos: [reunionSeg('2026-06-09T17:00:00Z', '2026-06-07T12:00:00Z')] });
  const cola = calcularCola([c], HOY);
  assert.equal(cola.length, 1);
  assert.equal(cola[0].reunionVencida, true);
  assert.equal(cola[0].fechaReunion, '2026-06-09T17:00:00Z');
});

test('REU3: una reunion vencida reaparece aunque el paso de cadencia ya este hecho', () => {
  // a dia 3 toca dia2; con dia2 hecho normalmente saldria de la cola, pero la
  // reunion vencida la trae de vuelta a registrar el resultado.
  const c = cot({
    seguimientos: [
      { paso: 'dia2', fecha: '2026-06-09T15:00:00Z', vendedor: 'Memo' },
      reunionSeg('2026-06-09T17:00:00Z', '2026-06-09T16:00:00Z'),
    ],
  });
  const cola = calcularCola([c], HOY);
  assert.equal(cola.length, 1);
  assert.equal(cola[0].reunionVencida, true);
  assert.equal(cola[0].fechaReunion, '2026-06-09T17:00:00Z');
});

test('REU4: registrar un seguimiento posterior a la reunion limpia el pendiente', () => {
  const c = cot({
    seguimientos: [
      reunionSeg('2026-06-09T17:00:00Z', '2026-06-07T12:00:00Z'),
      { paso: 'dia2', fecha: '2026-06-10T09:00:00Z', vendedor: 'Memo' },
    ],
  });
  // el avance posterior a la reunion limpia el pendiente; a dia 3 con dia2 hecho
  // no toca otro paso -> sale de la cola.
  assert.deepEqual(calcularCola([c], HOY), []);
});

test('REU5: una cotizacion sin reunion conserva el flujo normal (sin flag de reunion)', () => {
  const cola = calcularCola([cot()], HOY);
  assert.equal(cola.length, 1);
  assert.equal(cola[0].reunionVencida, false);
  assert.equal(cola[0].fechaReunion, null);
  assert.equal(cola[0].paso, 'dia2');
});

// --- #319: paso de cadencia compartido ---
// La cadencia 2/7/21/28 dejo de estar solo dentro de calcularCola: la Tabla de
// prospectos necesita el MISMO paso para decir "Seguimiento a la N, dia X". Se
// afirma por dia con un reloj fijo, contra los dias que declara CONTEXT.md
// "Cola Hoy", no contra el calculo del codigo.

function cotEnviada(fecha) {
  return cot({ fecha });
}

test('#319: al dia 1 todavia no toca ningun paso de cadencia', () => {
  assert.deepEqual(pasoCadencia(cotEnviada('2026-06-09T12:00:00Z'), HOY), { paso: null, dias: 1 });
});

test('#319: al dia 2 toca el primer paso', () => {
  assert.deepEqual(pasoCadencia(cotEnviada('2026-06-08T12:00:00Z'), HOY), { paso: 'dia2', dias: 2 });
});

test('#319: al dia 7 toca el segundo paso', () => {
  assert.deepEqual(pasoCadencia(cotEnviada('2026-06-03T12:00:00Z'), HOY), { paso: 'dia7', dias: 7 });
});

test('#319: al dia 21 toca el tercer paso', () => {
  assert.deepEqual(pasoCadencia(cotEnviada('2026-05-20T12:00:00Z'), HOY), { paso: 'dia21', dias: 21 });
});

test('#319: al dia 28 la cotizacion ya esta vencida', () => {
  assert.deepEqual(pasoCadencia(cotEnviada('2026-05-13T12:00:00Z'), HOY), { paso: 'vencida', dias: 28 });
});
