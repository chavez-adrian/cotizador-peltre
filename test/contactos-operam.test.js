// El modulo Contactos en Operam (#559, ADR-0024) por su interfaz, contra el adaptador
// en memoria (sin fetch). Lee los Contactos en Operam de un Cliente Operam y de cada
// uno de sus domicilios de entrega y los devuelve POR PERSONA (identidad: person_id),
// con sus roles y sus casillas: Telefono principal (`phone`), Secundario (`phone2`),
// Cel (`fax`, GLOSSARY.md "Contacto en Operam") y correo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerContactos } from '../lib/contactos-operam.js';
import { contactosOperamEnMemoria } from './helpers/contactos-operam-memoria.js';

// Cliente Operam 15 con dos domicilios (Pestalozzi 15 y Bosques de Europa 564, los de
// #397). Operam repite a una persona una vez por rol (#424): Gustavo es General y
// Pedidos del cliente; Rosa es General y Entrega de Bosques.
const CLIENTE_15 = {
  customer_id: '15',
  branches: [{ branch_code: '15', br_name: 'Pestalozzi' }, { branch_code: '564', br_name: 'Bosques de Europa' }],
  contacts: [
    { id: '61', action: 'general', name: 'Gustavo Barcia', phone: '55 4860 9144', phone2: '55 1111 0000', fax: '55 3466 7682', email: 'gustavo_barcia@yahoo.com' },
    { id: '61', action: 'order', name: 'Gustavo Barcia', phone: '55 4860 9144', phone2: '55 1111 0000', fax: '55 3466 7682', email: 'gustavo_barcia@yahoo.com' },
    { id: '62', action: 'invoice', name: 'Elisa Betancourt', phone: '', email: 'elisa.betancourt@cliente.mx' },
  ],
};
const CONTACT_LIST = [
  { id: '3460', person_id: '1248', type: 'cust_branch', action: 'delivery', entity_id: '15', name: 'Adrian Pestalozzi Nombre', ref: 'Adrian Pestalozzi Referencia', phone: '', email: '' },
  { id: '3470', person_id: '1300', type: 'cust_branch', action: 'general', entity_id: '564', name: 'Rosa Bodega', ref: 'Rosa', phone: '55 2222 3333', phone2: '', fax: '+52 55 9999 8888', email: 'rosa@cliente.mx' },
  { id: '3471', person_id: '1300', type: 'cust_branch', action: 'delivery', entity_id: '564', name: 'Rosa Bodega', ref: 'Rosa', phone: '55 2222 3333', phone2: '', fax: '+52 55 9999 8888', email: 'rosa@cliente.mx' },
  { id: '100', person_id: '62', type: 'customer', action: 'invoice', entity_id: '15', name: 'Elisa Betancourt', phone: '', email: 'elisa.betancourt@cliente.mx' },
];

test('CO1: devuelve por persona sus roles y sus casillas, incluido el Cel, del Cliente Operam y de cada domicilio', async () => {
  const { deps } = contactosOperamEnMemoria({ clientes: [CLIENTE_15], contactList: CONTACT_LIST });
  const r = await leerContactos('15', deps);
  assert.deepEqual(r.delCliente, [
    { personId: '61', nombre: 'Gustavo Barcia', roles: ['general', 'order'], telefono: '55 4860 9144', secundario: '55 1111 0000', cel: '55 3466 7682', email: 'gustavo_barcia@yahoo.com' },
    { personId: '62', nombre: 'Elisa Betancourt', roles: ['invoice'], telefono: '', secundario: '', cel: '', email: 'elisa.betancourt@cliente.mx' },
  ]);
  assert.deepEqual(r.porDomicilio['564'], [
    { personId: '1300', nombre: 'Rosa Bodega', roles: ['general', 'delivery'], telefono: '55 2222 3333', secundario: '', cel: '+52 55 9999 8888', email: 'rosa@cliente.mx' },
  ]);
  assert.deepEqual(r.porDomicilio['15'], [
    { personId: '1248', nombre: 'Adrian Pestalozzi Nombre', roles: ['delivery'], telefono: '', secundario: '', cel: '', email: '' },
  ]);
});

// AC de #559: "una persona con solo Cel aparece". El padron de #105 descartaba como
// vacio el renglon sin nombre, Telefono ni correo aunque trajera el Cel. El renglon
// realmente vacio (el person_id 0 que deja cada PUT /branches, #466) sigue fuera.
test('CO2: una persona que solo tiene Cel no es un renglon vacio; el renglon sin nada se descarta', async () => {
  const { deps } = contactosOperamEnMemoria({
    clientes: [{ customer_id: '15', branches: [{ branch_code: '15' }], contacts: [] }],
    contactList: [
      { id: '3529', person_id: '0', type: 'cust_branch', action: 'general', entity_id: '15', name: '', phone: '', phone2: '', fax: '', email: '' },
      { id: '3600', person_id: '1400', type: 'cust_branch', action: 'delivery', entity_id: '15', name: '', phone: '', phone2: '', fax: '5534667682', email: '' },
    ],
  });
  const r = await leerContactos('15', deps);
  assert.deepEqual(r.porDomicilio['15'], [
    { personId: '1400', nombre: '', roles: ['delivery'], telefono: '', secundario: '', cel: '5534667682', email: '' },
  ]);
});

// Cache fria u Operam caido (#397): del domicilio no se sabe nada y el modulo lo dice
// con null, nunca con la lista vacia (que afirmaria que no tiene contactos).
test('CO3: sin padron de contact_list cada domicilio sale en null; con padron, el que no tiene contactos sale vacio', async () => {
  const sinPadron = contactosOperamEnMemoria({ clientes: [CLIENTE_15], contactList: CONTACT_LIST, padronCargado: false });
  const frio = await leerContactos('15', sinPadron.deps);
  assert.deepEqual(frio.porDomicilio, { 15: null, 564: null });
  assert.equal(frio.delCliente.length, 2, 'los del Cliente Operam no dependen del padron');

  const conPadron = contactosOperamEnMemoria({ clientes: [CLIENTE_15], contactList: [] });
  assert.deepEqual((await leerContactos('15', conPadron.deps)).porDomicilio, { 15: [], 564: [] });
});

// Renglones que Operam manda SIN identidad (sin `person_id` en contact_list, sin `id`
// en contacts[] del cliente): no se juntan con nadie; cada uno es su propia persona.
test('CO4: un renglon sin identidad es su propia persona, con personId null', async () => {
  const { deps } = contactosOperamEnMemoria({
    clientes: [{
      customer_id: '15', branches: [{ branch_code: '564' }],
      contacts: [
        { action: 'invoice', name: 'Elisa Betancourt', email: 'elisa.betancourt@cliente.mx' },
        { action: 'invoice', name: 'Flor Sosa', email: 'flor.sosa@cliente.mx' },
      ],
    }],
    contactList: [
      { id: '3462', type: 'cust_branch', action: 'delivery', entity_id: '564', name: 'Adrian Bosques Nombre', phone: '', email: '' },
      { id: '3463', type: 'cust_branch', action: 'invoice', entity_id: '564', name: 'Cuentas Bosques', phone: '', email: 'cxp.bosques@cliente.mx' },
    ],
  });
  const r = await leerContactos('15', deps);
  assert.deepEqual(r.delCliente.map(p => [p.personId, p.nombre, p.roles]), [
    [null, 'Elisa Betancourt', ['invoice']],
    [null, 'Flor Sosa', ['invoice']],
  ]);
  assert.deepEqual(r.porDomicilio['564'].map(p => [p.personId, p.nombre, p.roles]), [
    [null, 'Adrian Bosques Nombre', ['delivery']],
    [null, 'Cuentas Bosques', ['invoice']],
  ]);
});
