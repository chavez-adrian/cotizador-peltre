import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularCola, telefonoWa, telefonoValido } from '../lib/seguimiento.js';

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

test('telefonoValido exige codigo de pais (11-15 digitos)', () => {
  assert.equal(telefonoValido('+52 5512345678'), true);
  assert.equal(telefonoValido('525512345678'), true);
  assert.equal(telefonoValido('+1 5551234567'), true);
  assert.equal(telefonoValido('5512345678'), false);
  assert.equal(telefonoValido(''), false);
  assert.equal(telefonoValido(undefined), false);
  assert.equal(telefonoValido('+52 55 1234'), false);
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
