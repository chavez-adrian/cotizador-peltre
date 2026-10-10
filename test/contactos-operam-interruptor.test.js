// D6 (decisiones de Adrian 2026-10-09, spec #557): el interruptor de la escritura de
// Contactos en Operam. La variable de entorno CONTACTOS_OPERAM_ESCRITURA vale `apagado`,
// una lista de ids de Cliente Operam separados por coma (`15`) o `todos`; AUSENTE es
// `apagado`. Gobierna toda escritura de Contactos en Operam (la Subida al crear y al
// actualizar, el alta #566, la copia #564) y el paso del numero (D4). Un Cliente Operam
// fuera del interruptor se queda como antes de la spec: sin leer la web legacy, sin
// pregunta y sin paso de contacto en el reporte del vendedor.
//
// El nucleo puro interpreta el valor; el modulo lo lee EN CADA LLAMADA (no al importar)
// por su dependencia `escrituraActiva`, con respaldo en la variable.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  interpretarInterruptorEscritura, escrituraContactosPermitida, avisoInterruptorEscritura,
} from '../lib/contactos-operam-logica.js';
import { escribirContactoEntrega, contactoEntregaDelAlta, escrituraContactosActiva } from '../lib/contactos-operam.js';
import { contactosOperamEnMemoria } from './helpers/contactos-operam-memoria.js';

const VARIABLE = 'CONTACTOS_OPERAM_ESCRITURA';
const previo = process.env[VARIABLE];
after(() => {
  if (previo === undefined) delete process.env[VARIABLE];
  else process.env[VARIABLE] = previo;
});

test('D6 interruptor ausente o vacio = apagado', () => {
  for (const valor of [undefined, null, '', '   ']) {
    const i = interpretarInterruptorEscritura(valor);
    assert.equal(i.modo, 'apagado', String(valor));
    assert.deepEqual(i.clientes, []);
    assert.equal(escrituraContactosPermitida(valor, '15'), false);
  }
});

test('D6 interruptor `apagado` (sin importar mayusculas ni espacios) no deja escribir a nadie', () => {
  for (const valor of ['apagado', ' APAGADO ']) {
    assert.equal(interpretarInterruptorEscritura(valor).modo, 'apagado');
    assert.equal(escrituraContactosPermitida(valor, 15), false);
  }
});

test('D6 interruptor `todos` deja escribir a cualquier Cliente Operam', () => {
  for (const valor of ['todos', ' Todos ']) {
    assert.equal(interpretarInterruptorEscritura(valor).modo, 'todos');
    assert.equal(escrituraContactosPermitida(valor, '15'), true);
    assert.equal(escrituraContactosPermitida(valor, 376), true);
  }
});

test('D6 una lista con espacios deja escribir solo a esos Clientes Operam, con el id en numero o en texto', () => {
  const valor = ' 15 , 376 ';
  const i = interpretarInterruptorEscritura(valor);
  assert.equal(i.modo, 'lista');
  assert.deepEqual(i.clientes, ['15', '376']);
  assert.equal(escrituraContactosPermitida(valor, '15'), true);
  assert.equal(escrituraContactosPermitida(valor, 15), true);
  assert.equal(escrituraContactosPermitida(valor, '376'), true);
  assert.equal(escrituraContactosPermitida(valor, '522'), false);
  assert.equal(escrituraContactosPermitida(valor, null), false);
});

test('D6 los ids no numericos de la lista se ignoran; sin ninguno numerico queda apagado', () => {
  const i = interpretarInterruptorEscritura('15, abc, 3x');
  assert.equal(i.modo, 'lista');
  assert.deepEqual(i.clientes, ['15']);
  assert.deepEqual(i.ignorados, ['abc', '3x']);
  assert.equal(escrituraContactosPermitida('15, abc', 'abc'), false);

  const nada = interpretarInterruptorEscritura('abc, on');
  assert.equal(nada.modo, 'apagado');
  assert.deepEqual(nada.ignorados, ['abc', 'on']);
  assert.equal(escrituraContactosPermitida('on', '15'), false);
  assert.equal(escrituraContactosPermitida('true', '15'), false);
});

test('D6 aviso de /admin: nada con `todos`; con lo demas dice en palabras simples el valor de hoy', () => {
  assert.equal(avisoInterruptorEscritura('todos'), null);

  const ausente = avisoInterruptorEscritura(undefined);
  assert.match(ausente, /no escribe Contactos de entrega en Operam/);
  assert.match(ausente, /CONTACTOS_OPERAM_ESCRITURA no tiene valor/);

  assert.match(avisoInterruptorEscritura('apagado'), /CONTACTOS_OPERAM_ESCRITURA = apagado/);

  const lista = avisoInterruptorEscritura('15, 376');
  assert.match(lista, /solo escribe Contactos de entrega en Operam para los Clientes Operam 15 y 376/);
  assert.match(lista, /CONTACTOS_OPERAM_ESCRITURA = 15, 376/);

  assert.match(avisoInterruptorEscritura('15'), /para el Cliente Operam 15;/);
  assert.match(avisoInterruptorEscritura('15, abc'), /Se ignora abc: no es un n\u00famero de Cliente Operam/);
});

// --- El modulo ---

const CLIENTE_15 = { customer_id: '15', branches: ['564'] };
const PERSONAS = [{ personId: '1501', name: 'La Esquina', ref: 'La Esquina', phone: '5598765432' }];
const RENGLONES = [
  { id: '7001', personId: '1501', tipo: 'customer', entidad: '15', rol: 'general' },
  { id: '7002', personId: '1501', tipo: 'cust_branch', entidad: '564', rol: 'general' },
];
const LUCIA = { nombre: 'Lucia Recibe', telefono: '+52 55 1234 5678', correo: 'lucia@example.com' };

function operam() {
  return contactosOperamEnMemoria({ clientes: [CLIENTE_15], personas: PERSONAS, renglones: RENGLONES });
}

function sinInterruptor(deps) {
  const { escrituraActiva, ...resto } = deps;
  return resto;
}

test('D6 con la variable ausente, escribirContactoEntrega no abre la web legacy, no pregunta y no deja paso', async () => {
  delete process.env[VARIABLE];
  const op = operam();
  const r = await escribirContactoEntrega({ clienteId: '15', domicilioId: '564', contacto: LUCIA }, sinInterruptor(op.deps));
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.escrito, false);
  assert.equal(r.motivo, 'escritura-apagada');
  assert.deepEqual(r.pasos, []);
  assert.deepEqual(op.llamadas.filter(l => l.dep === 'abrirDomicilioWeb'), []);
});

test('D6 la variable se lee en cada llamada: `15` escribe en el 15 y no en otro Cliente Operam', async () => {
  process.env[VARIABLE] = '15';
  const op = operam();
  const r = await escribirContactoEntrega({ clienteId: '15', domicilioId: '564', contacto: LUCIA }, sinInterruptor(op.deps));
  assert.equal(r.tipo, 'pregunta', 'el domicilio 564 ya tiene General: el modulo pregunta');
  assert.equal(escrituraContactosActiva('15'), true);
  assert.equal(escrituraContactosActiva('376'), false);

  process.env[VARIABLE] = '376';
  const otra = await escribirContactoEntrega({ clienteId: '15', domicilioId: '564', contacto: LUCIA }, sinInterruptor(op.deps));
  assert.equal(otra.motivo, 'escritura-apagada');
  assert.deepEqual(otra.pasos, []);
});

test('D6 contactoEntregaDelAlta con el interruptor apagado no abre la web legacy ni deja paso', async () => {
  const op = operam();
  const r = await contactoEntregaDelAlta(
    { clienteId: '15', domicilioId: '564', personId: '1501', contacto: LUCIA },
    { ...op.deps, escrituraActiva: () => false },
  );
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.escrito, false);
  assert.equal(r.motivo, 'escritura-apagada');
  assert.deepEqual(r.pasos, []);
  assert.deepEqual(op.llamadas.filter(l => l.dep === 'abrirDomicilioWeb'), []);
});

test('D6 el interruptor va antes que el cliente generico: apagado, ni siquiera el omitido del generico sale', async () => {
  const op = operam();
  const r = await escribirContactoEntrega({ clienteId: '14', domicilioId: '14', contacto: LUCIA }, { ...op.deps, escrituraActiva: () => false });
  assert.equal(r.motivo, 'escritura-apagada');
  assert.deepEqual(r.pasos, []);
});
