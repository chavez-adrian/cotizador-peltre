// Nucleo puro de "de que Contacto es esta cotizacion" (#342, spec #337,
// ADR-0016, CONTEXT.md "Oportunidad"): la liga es FIJA -- el celular se anota
// al nacer y no se recalcula del telefono que se teclee despues -- y para lo ya
// existente se resuelve con las cuatro fuentes del ticket, en orden.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FUENTES,
  celularAnotado,
  celularAlNacer,
  celularesDeCruce,
  contactoDeCotizacion,
  esContactoSinCaptura,
  planearMigracion,
} from '../lib/contacto-cotizacion.js';

const cot = (over = {}) => ({
  id: 1,
  data: { cliente: { telefono: '', celEntrega: '', customerId: null } },
  ...over,
});

// --- el campo propio: lo que se anota al nacer y lo que cruza despues ---

test('#342: al nacer se anota el telefono del cliente, normalizado a los 10 digitos', () => {
  assert.equal(celularAlNacer({ telefono: '+52 55 1234 5678' }), '5512345678');
});

test('#342: sin telefono al nacer manda el celular de entrega', () => {
  assert.equal(celularAlNacer({ telefono: '', celEntrega: '+52 55 9999 0000' }), '5599990000');
});

test('#342: un numero que no alcanza 10 digitos no es identidad de Contacto', () => {
  assert.equal(celularAlNacer({ telefono: '55 1234' }), null);
  assert.equal(celularAlNacer({}), null);
});

test('#342: el campo propio manda sobre el telefono tecleado -- corregirlo no mueve la Oportunidad', () => {
  const c = cot({ contactoCelular: '5512345678', data: { cliente: { telefono: '+52 55 0000 1111' } } });
  assert.equal(celularAnotado(c), '5512345678');
  assert.deepEqual(celularesDeCruce(c), ['5512345678']);
});

test('#342: sin campo propio (historica) el cruce sigue siendo por lo tecleado, telefono y celular de entrega', () => {
  const c = cot({ data: { cliente: { telefono: '+52 55 1111 2222', celEntrega: '+52 55 3333 4444' } } });
  assert.equal(celularAnotado(c), null);
  assert.deepEqual(celularesDeCruce(c), ['5511112222', '5533334444']);
});

// --- las cuatro fuentes de la migracion ---

const CONTACTOS = new Set(['5511112222']);
const TELEFONOS_OPERAM = new Map([
  ['514', [
    { telefono: '55-7777-8888', casilla: 'telefono' },
    { telefono: '(55) 6666 5555', casilla: 'telefono_secundario' },
    { telefono: '+52 55 4444 3333', casilla: 'cel' },
  ]],
]);
const indice = () => ({ contactos: new Set(CONTACTOS), telefonosOperam: TELEFONOS_OPERAM });

test('#342 fuente 1: el telefono anotado cruza con un Contacto existente', () => {
  const r = contactoDeCotizacion(cot({ data: { cliente: { telefono: '+52 55 1111 2222' } } }), indice());
  assert.equal(r.contacto, '5511112222');
  assert.equal(r.fuente, FUENTES.CRUCE);
  assert.equal(r.crear, false);
});

test('#342 fuente 2: telefono anotado sin Contacto -> nace un Contacto ligado al Cliente Operam de la cotizacion', () => {
  const r = contactoDeCotizacion(cot({ data: { cliente: { telefono: '+52 55 8888 7777', customerId: 514 } } }), indice());
  assert.equal(r.contacto, '5588887777');
  assert.equal(r.fuente, FUENTES.TELEFONO);
  assert.equal(r.crear, true);
  assert.equal(r.clienteOperam, 514);
  // El numero TAL COMO estaba escrito, para que la ficha del Contacto nuevo
  // guarde lo mismo que guardaria una captura y no diez digitos pelados.
  assert.equal(r.telefono, '+52 55 8888 7777');
});

test('#342 fuente 3: sin telefono se cae al indice de Operam bajo su customer_id', () => {
  const r = contactoDeCotizacion(cot({ data: { cliente: { customerId: 514 } } }), indice());
  assert.equal(r.fuente, FUENTES.OPERAM);
  assert.equal(r.clienteOperam, 514);
  assert.equal(r.crear, true);
});

test('#342 fuente 3: el orden de las casillas es Cel > Telefono > Telefono Secundario', () => {
  // Con las tres casillas presentes gana el Cel: es el numero mas probable de
  // WhatsApp (spec #337, user story 28).
  const conTres = contactoDeCotizacion(cot({ data: { cliente: { customerId: 514 } } }), indice());
  assert.equal(conTres.contacto, '5544443333');
  assert.equal(conTres.casilla, 'cel');
  assert.equal(conTres.telefono, '+52 55 4444 3333', 'el numero como lo tiene Operam');
  // Sin Cel gana el Telefono.
  const sinCel = new Map([['514', TELEFONOS_OPERAM.get('514').filter(t => t.casilla !== 'cel')]]);
  const conDos = contactoDeCotizacion(cot({ data: { cliente: { customerId: 514 } } }), { contactos: new Set(), telefonosOperam: sinCel });
  assert.equal(conDos.contacto, '5577778888');
  assert.equal(conDos.casilla, 'telefono');
  // Solo el Secundario: es el ultimo recurso, pero es un Contacto.
  const soloSec = new Map([['514', TELEFONOS_OPERAM.get('514').filter(t => t.casilla === 'telefono_secundario')]]);
  const conUno = contactoDeCotizacion(cot({ data: { cliente: { customerId: 514 } } }), { contactos: new Set(), telefonosOperam: soloSec });
  assert.equal(conUno.contacto, '5566665555');
  assert.equal(conUno.casilla, 'telefono_secundario');
});

test('#342 fuente 3: si el numero de Operam ya es un Contacto no se crea otro', () => {
  const telefonos = new Map([['514', [{ telefono: '5511112222', casilla: 'cel' }]]]);
  const r = contactoDeCotizacion(cot({ data: { cliente: { customerId: 514 } } }), { contactos: new Set(CONTACTOS), telefonosOperam: telefonos });
  assert.equal(r.contacto, '5511112222');
  assert.equal(r.fuente, FUENTES.OPERAM);
  assert.equal(r.crear, false);
});

// Las 40 sin telefono son las del backfill (#76) y no guardaron customer_id:
// solo su pedido lo sabe. El script lo resuelve por ahi y lo entrega resuelto.
test('#342 fuente 3: sirve el Cliente Operam que el caller resolvio, no solo el anotado en la cotizacion', () => {
  const c = cot({ clienteOperam: 514, data: { cliente: { customer_ref: 'Casa Cervecera' } } });
  const r = contactoDeCotizacion(c, indice());
  assert.equal(r.fuente, FUENTES.OPERAM);
  assert.equal(r.contacto, '5544443333');
  assert.equal(r.clienteOperam, 514);
});

test('#342 fuente 4: sin telefono y sin nada en Operam la cotizacion queda sin Contacto, con motivo', () => {
  const r = contactoDeCotizacion(cot({ data: { cliente: { customerId: 999 } } }), indice());
  assert.equal(r.contacto, null);
  assert.equal(r.motivo, 'sin_telefono');
  assert.equal(r.crear, false);
});

test('#342 fuente 4: sin customer_id tampoco hay a quien preguntarle', () => {
  const r = contactoDeCotizacion(cot(), indice());
  assert.equal(r.contacto, null);
  assert.equal(r.motivo, 'sin_telefono');
});

// --- el plan completo que ejecuta el script ---

test('#342: el plan es un renglon por cotizacion con su Contacto y su fuente', () => {
  const plan = planearMigracion([
    cot({ id: 1, data: { cliente: { telefono: '+52 55 1111 2222' } } }),
    cot({ id: 2, data: { cliente: { telefono: '+52 55 8888 7777', customerId: 514 } } }),
    cot({ id: 3, data: { cliente: { customerId: 514 } } }),
    cot({ id: 4, data: { cliente: {} } }),
  ], indice());
  assert.deepEqual(plan.map(p => [p.id, p.contacto, p.fuente ?? p.motivo]), [
    [1, '5511112222', FUENTES.CRUCE],
    [2, '5588887777', FUENTES.TELEFONO],
    [3, '5544443333', FUENTES.OPERAM],
    [4, null, 'sin_telefono'],
  ]);
});

test('#342: dos cotizaciones del mismo celular nuevo crean UN solo Contacto', () => {
  const plan = planearMigracion([
    cot({ id: 1, data: { cliente: { telefono: '+52 55 8888 7777', customerId: 514 } } }),
    cot({ id: 2, data: { cliente: { telefono: '55 8888 7777', customerId: 700 } } }),
  ], indice());
  assert.deepEqual(plan.map(p => p.crear), [true, false]);
  // La fuente sigue diciendo la verdad de cada una: las dos llegaron por su
  // telefono anotado, no por un cruce con un Contacto que existiera antes.
  assert.deepEqual(plan.map(p => p.fuente), [FUENTES.TELEFONO, FUENTES.TELEFONO]);
});

test('#342: correr el plan sobre lo ya migrado no propone escribir nada (idempotencia)', () => {
  const plan = planearMigracion([
    cot({ id: 1, contactoCelular: '5511112222', data: { cliente: { telefono: '+52 55 1111 2222' } } }),
  ], indice());
  assert.deepEqual(plan.map(p => [p.fuente, p.crear]), [[FUENTES.ANOTADO, false]]);
});

// --- el Contacto que nadie capturo ---

test('#342: el Contacto nacido de la migracion se reconoce como no capturado', () => {
  assert.equal(esContactoSinCaptura({ data: { sinCaptura: true } }), true);
  assert.equal(esContactoSinCaptura({ data: {} }), false);
  assert.equal(esContactoSinCaptura(null), false);
});

test('#342: una cotizacion que ya trae su campo propio se devuelve tal cual (idempotencia del script)', () => {
  const c = cot({ contactoCelular: '5500001111', data: { cliente: { telefono: '+52 55 1111 2222', customerId: 514 } } });
  const r = contactoDeCotizacion(c, indice());
  assert.equal(r.contacto, '5500001111');
  assert.equal(r.fuente, FUENTES.ANOTADO);
  assert.equal(r.crear, false);
});
