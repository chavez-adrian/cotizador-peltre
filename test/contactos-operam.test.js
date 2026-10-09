// El modulo Contactos en Operam (#559, ADR-0024): la lectura de las personas de un
// Cliente Operam y de cada uno de sus domicilios de entrega, por person_id, con sus
// roles y sus casillas. Se prueba por su interfaz contra el adaptador en memoria
// (test/helpers/contactos-operam-memoria.js), sin fetch.
//
// Los datos imitan al Cliente Operam 15 medido el 2026-10-09 (ADR-0024): el General
// 61 del Cliente Operam con Telefono, la 1287 de Entrega con solo Cel, y en el
// domicilio Bosques de Europa (564) la 1288 con solo Cel y la 1249 sin numeros.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerContactos } from '../lib/contactos-operam.js';
import { contactosOperamEnMemoria } from './helpers/contactos-operam-memoria.js';

const PERSONAS = [
  { personId: '61', name: 'Adrian Cliente Nombre', ref: 'Adrian Cliente Referencia', phone: '+52 55 3466 7682', notes: 'compradora' },
  { personId: '1287', name: 'MEDICION556 Entrega', name2: 'Prueba', ref: 'MEDICION556', fax: '5500000021', email: 'entrega556@example.com' },
  { personId: '1288', name: 'MEDICION556 Domicilio', name2: 'Prueba', ref: 'MEDICION556B', fax: '5500000031', email: 'domicilio556@example.com' },
  { personId: '1249', name: 'Adrian Bosques Nombre', ref: 'Adrian Bosques Referencia' },
];
const RENGLONES = [
  { id: '3579', personId: '61', tipo: 'customer', entidad: '15', rol: 'general' },
  { id: '3580', personId: '1287', tipo: 'customer', entidad: '15', rol: 'delivery' },
  { id: '3462', personId: '1249', tipo: 'cust_branch', entidad: '564', rol: 'delivery' },
  { id: '3581', personId: '1288', tipo: 'cust_branch', entidad: '564', rol: 'delivery' },
];
const CLIENTE_15 = { customer_id: '15', branches: ['564', '15'] };

function operam(opciones = {}) {
  return contactosOperamEnMemoria({ clientes: [CLIENTE_15], personas: PERSONAS, renglones: RENGLONES, ...opciones });
}

test('CO1: cada persona del domicilio sale con su person_id, sus roles y sus cuatro casillas, el Cel incluido', async () => {
  const r = await leerContactos('15', operam().deps);
  assert.deepEqual(r.domicilios['564'], [
    {
      personId: '1249', nombre: 'Adrian Bosques Nombre', apellido: '', referencia: 'Adrian Bosques Referencia',
      roles: ['delivery'], casillas: { cel: '', telefono: '', secundario: '', correo: '' }, notas: null,
    },
    {
      personId: '1288', nombre: 'MEDICION556 Domicilio', apellido: 'Prueba', referencia: 'MEDICION556B',
      roles: ['delivery'], casillas: { cel: '5500000031', telefono: '', secundario: '', correo: 'domicilio556@example.com' }, notas: null,
    },
  ]);
});

test('CO2: las personas del Cliente Operam salen con su Cel (fax), su Telefono y sus notas', async () => {
  const r = await leerContactos('15', operam().deps);
  assert.deepEqual(r.cliente, [
    {
      personId: '61', nombre: 'Adrian Cliente Nombre', apellido: '', referencia: 'Adrian Cliente Referencia',
      roles: ['general'], casillas: { cel: '', telefono: '+52 55 3466 7682', secundario: '', correo: '' }, notas: 'compradora',
    },
    {
      personId: '1287', nombre: 'MEDICION556 Entrega', apellido: 'Prueba', referencia: 'MEDICION556',
      roles: ['delivery'], casillas: { cel: '5500000021', telefono: '', secundario: '', correo: 'entrega556@example.com' }, notas: '',
    },
  ]);
});

// Operam repite a una persona una vez por rol (165 de 578 personas tienen dos o mas,
// GLOSSARY.md): son UNA persona con todos sus roles, no varias.
test('CO3: una persona con varios renglones de rol es una sola persona con todos sus roles', async () => {
  const op = operam({
    personas: [...PERSONAS, { personId: '1300', name: 'Lucia Almacen', phone: '55 1111 2222', phone2: '55 3333 4444', fax: '55 5555 6666' }],
    renglones: [
      ...RENGLONES,
      { id: '3600', personId: '1300', tipo: 'cust_branch', entidad: '15', rol: 'general' },
      { id: '3601', personId: '1300', tipo: 'cust_branch', entidad: '15', rol: 'invoice' },
      { id: '3602', personId: '1300', tipo: 'cust_branch', entidad: '15', rol: 'delivery' },
    ],
  });
  const r = await leerContactos('15', op.deps);
  assert.equal(r.domicilios['15'].length, 1);
  assert.deepEqual(r.domicilios['15'][0].roles, ['general', 'invoice', 'delivery']);
  assert.deepEqual(r.domicilios['15'][0].casillas, { cel: '55 5555 6666', telefono: '55 1111 2222', secundario: '55 3333 4444', correo: '' });
});

// La persona que crea POST /customers es General del cliente Y de su domicilio
// (ADR-0024): la misma persona, visible en los dos niveles con el mismo personId.
test('CO4: la misma persona ligada al cliente y al domicilio sale en los dos niveles con el mismo personId', async () => {
  const op = operam({
    renglones: [...RENGLONES, { id: '3700', personId: '61', tipo: 'cust_branch', entidad: '15', rol: 'general' }],
  });
  const r = await leerContactos('15', op.deps);
  assert.deepEqual(r.cliente.map(p => p.personId), ['61', '1287']);
  assert.deepEqual(r.domicilios['15'].map(p => [p.personId, p.roles]), [['61', ['general']]]);
  assert.equal(r.domicilios['15'][0].casillas.telefono, '+52 55 3466 7682');
});

test('CO5: el renglon General vacio que deja PUT /branches (person_id 0) no es una persona', async () => {
  const r = await leerContactos('15', operam({ renglonesGeneralVacios: ['564', '15'] }).deps);
  assert.deepEqual(r.domicilios['564'].map(p => p.personId), ['1249', '1288']);
  assert.deepEqual(r.domicilios['15'], [], 'con padron, el domicilio sin personas es la lista vacia');
});

// Sin padron de contact_list (cache fria u Operam caido) no se sabe quien esta en los
// domicilios: null, nunca la lista vacia. El Cliente Operam si se leyo.
test('CO6: sin padron de los domicilios, domicilios es null y las personas del cliente salen igual', async () => {
  const r = await leerContactos('15', operam({ padronDomicilios: false }).deps);
  assert.equal(r.domicilios, null);
  assert.deepEqual(r.cliente.map(p => p.personId), ['61', '1287']);
});

test('CO7: un Cliente Operam que no existe devuelve null', async () => {
  assert.equal(await leerContactos('999', operam().deps), null);
});

test('CO8: si Operam falla al leer el cliente, la lectura rechaza (no afirma que no hay contactos)', async () => {
  await assert.rejects(leerContactos('15', operam({ falla: { obtenerCliente: 'Operam 503' } }).deps), /Operam 503/);
});

// El rol es `action`. `ref` es la Referencia, texto libre en las dos lecturas
// ("Adrian Cliente Referencia"), y nunca dice el rol (antes de #559 el lector del
// cliente lo tomaba de respaldo).
test('CO9: el rol sale de action y nunca de ref', async () => {
  const op = operam({
    personas: [...PERSONAS, { personId: '1400', name: 'Sin rol', ref: 'invoice', email: 'x@y.mx' }],
    renglones: [
      ...RENGLONES,
      { id: '3800', personId: '1400', tipo: 'customer', entidad: '15', rol: '' },
      { id: '3801', personId: '1400', tipo: 'cust_branch', entidad: '564', rol: '' },
    ],
  });
  const r = await leerContactos('15', op.deps);
  assert.deepEqual(r.cliente.find(p => p.personId === '1400').roles, []);
  assert.deepEqual(r.domicilios['564'].find(p => p.personId === '1400').roles, []);
});
