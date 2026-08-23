import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ingerirPedido, MOTIVOS } from '../lib/pedidos-shopify-logica.js';

// Los nodos de esta suite estan CALCADOS de la respuesta real de la GraphQL
// Admin API (medida read-only el 2026-08-22 sobre los 10 pedidos que el token
// alcanza a ver: S1889..S1898). Nada aqui es inventado: si un campo llega null
// en produccion, llega null aqui.
//
// Lo que la medicion confirmo y esta suite fija:
//   - `phone` del pedido y `customer.defaultPhoneNumber` vienen NULOS siempre;
//     el telefono vive en las direcciones. Por eso los candidatos de checkout y
//     perfil casi nunca producen fila, y el orden de precedencia se mide igual.
//   - envio y facturacion suelen traer el MISMO numero, a veces uno con `+` y
//     el otro sin el (S1894).
//   - dos pedidos seguidos del mismo comprador comparten telefono (S1897/S1898).

const S1898 = {
  name: 'S1898',
  createdAt: '2026-08-21T23:31:03Z',
  updatedAt: '2026-08-21T23:31:06Z',
  email: 'gerardo@ejemplo.mx',
  phone: null,
  customer: { defaultPhoneNumber: null },
  shippingAddress: { name: 'Gerardo Cardenas Guillermo', phone: '+529991632568', countryCodeV2: 'MX' },
  billingAddress: { name: 'Gerardo Jose Cardenas Guillermo', phone: '+529991632568', countryCodeV2: 'MX' },
};

// El caso que el ticket cita como descarte, tal como esta en la tienda: el
// telefono de ENVIO viene sin `+`, pero el de FACTURACION es el mismo numero
// CON `+52`. Ver la prueba de mas abajo.
const S1894 = {
  name: 'S1894',
  createdAt: '2026-08-11T01:17:33Z',
  updatedAt: '2026-08-19T20:07:10Z',
  email: 'carolina@ejemplo.mx',
  phone: null,
  customer: { defaultPhoneNumber: null },
  shippingAddress: { name: 'Carolina Muci Fernandez', phone: '5554052474', countryCodeV2: 'MX' },
  billingAddress: { name: 'carolina muci', phone: '+525554052474', countryCodeV2: 'MX' },
};

// Sin `+` por ningun lado: el pedido entero se queda fuera hasta #256.
const S1893 = {
  name: 'S1893',
  createdAt: '2026-08-07T20:21:29Z',
  updatedAt: '2026-08-19T21:16:04Z',
  email: 'alberto@ejemplo.mx',
  phone: null,
  customer: { defaultPhoneNumber: null },
  shippingAddress: { name: 'Alberto Ramirez Herrera', phone: '4491112584', countryCodeV2: 'MX' },
  billingAddress: { name: 'Alberto Ramirez Herrera', phone: '4491112584', countryCodeV2: 'MX' },
};

const S1892 = {
  name: 'S1892',
  createdAt: '2026-08-06T03:07:05Z',
  updatedAt: '2026-08-19T05:25:19Z',
  email: 'sara@ejemplo.com',
  phone: null,
  customer: { defaultPhoneNumber: null },
  shippingAddress: { name: 'sara dickerman', phone: '+12063553198', countryCodeV2: 'US' },
  billingAddress: { name: 'sara dickerman', phone: '+12063553198', countryCodeV2: 'US' },
};

test('un pedido con el telefono en +E.164 produce su fila', () => {
  const { filas, descartes } = ingerirPedido(S1898);
  assert.deepEqual(descartes, []);
  assert.equal(filas.length, 1);
  assert.deepEqual(filas[0], {
    pedido: 'S1898',
    creadoEn: '2026-08-21T23:31:03.000Z',
    telefono: '+529991632568',
    celular10: '9991632568',
    nombre: 'Gerardo Cardenas Guillermo',
    correo: 'gerardo@ejemplo.mx',
    fuente: 'envio',
  });
});

test('el telefono de otro pais conserva su codigo: no se mexicaniza', () => {
  const { filas } = ingerirPedido(S1892);
  assert.equal(filas[0].telefono, '+12063553198');
  assert.equal(filas[0].celular10, '2063553198');
});

test('un pedido cuyo telefono no trae codigo de pais queda en descartes, sin fila', () => {
  const { filas, descartes } = ingerirPedido(S1893);
  assert.deepEqual(filas, []);
  assert.deepEqual(descartes, [{ pedido: 'S1893', fuente: 'envio', motivo: MOTIVOS.sinCodigo }]);
});

// El mismo numero en las dos direcciones no es dos descartes: es uno. Sin esto,
// el panel de #257 contaria el doble de telefonos perdidos que los que hay.
test('el mismo numero repetido en dos direcciones produce UN solo descarte', () => {
  const { descartes } = ingerirPedido(S1893);
  assert.equal(descartes.length, 1);
});

// El caso de S1894, medido: envio sin `+` y facturacion CON `+52`, mismo
// numero. El pedido NO se pierde -- el escalon 1 lo resuelve por facturacion --
// y el candidato de envio no se reporta como descarte, porque ese numero SI
// entro a la libreta. Reportarlo diria que se perdio un telefono que no se
// perdio.
test('un numero sin codigo se rescata si otra direccion lo trae con codigo', () => {
  const { filas, descartes } = ingerirPedido(S1894);
  assert.deepEqual(descartes, []);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].telefono, '+525554052474');
  assert.equal(filas[0].fuente, 'facturacion');
  assert.equal(filas[0].nombre, 'carolina muci', 'el nombre es el de la direccion de la que salio');
});

test('un pedido sin ningun telefono produce un descarte con motivo propio', () => {
  const nodo = {
    ...S1898,
    phone: null,
    customer: null,
    shippingAddress: { name: 'Quien Sea', phone: null, countryCodeV2: 'MX' },
    billingAddress: null,
  };
  const { filas, descartes } = ingerirPedido(nodo);
  assert.deepEqual(filas, []);
  assert.deepEqual(descartes, [{ pedido: 'S1898', fuente: null, motivo: MOTIVOS.sinTelefono }]);
});

test('dos telefonos distintos en un pedido producen dos filas con el mismo S', () => {
  const nodo = {
    ...S1898,
    shippingAddress: { name: 'Quien Recibe', phone: '+529991632568', countryCodeV2: 'MX' },
    billingAddress: { name: 'Quien Paga', phone: '+525512345678', countryCodeV2: 'MX' },
  };
  const { filas } = ingerirPedido(nodo);
  assert.deepEqual(filas.map(f => [f.pedido, f.telefono, f.nombre, f.fuente]), [
    ['S1898', '+529991632568', 'Quien Recibe', 'envio'],
    ['S1898', '+525512345678', 'Quien Paga', 'facturacion'],
  ]);
});

// "Codigo nacional pegado": el comprador escribe su numero completo pero sin el
// `+`. libphonenumber lo reconoce y el escalon 1 lo acepta -- es la otra mitad
// de la regla, la que hace que no todo lo que no empieza con `+` se pierda.
test('un numero con el codigo de pais pegado, sin +, tambien resuelve', () => {
  const nodo = {
    ...S1898,
    shippingAddress: { name: 'Ana Lopez', phone: '16512712562', countryCodeV2: 'US' },
    billingAddress: null,
  };
  const { filas, descartes } = ingerirPedido(nodo);
  assert.deepEqual(descartes, []);
  assert.equal(filas[0].telefono, '+16512712562');
});

// El caso de miedo del ADR-0014 al reves: un numero nacional mexicano de diez
// digitos NO puede colarse como si fuera de otro pais por llevar el `+`
// implicito. Se descarta y lo resolvera #256 con el pais de la direccion.
test('un numero nacional de diez digitos no se reinterpreta como extranjero', () => {
  const nodo = {
    ...S1898,
    shippingAddress: { name: 'Ana Lopez', phone: '55 3466 7682', countryCodeV2: 'MX' },
    billingAddress: null,
  };
  const { filas, descartes } = ingerirPedido(nodo);
  assert.deepEqual(filas, []);
  assert.equal(descartes[0].motivo, MOTIVOS.sinCodigo);
});

test('la basura que no es un telefono se descarta con su propio motivo', () => {
  const nodo = {
    ...S1898,
    shippingAddress: { name: 'Ana Lopez', phone: '551953,3', countryCodeV2: 'MX' },
    billingAddress: { name: 'Ana Lopez', phone: '+52 999', countryCodeV2: 'MX' },
  };
  const { filas, descartes } = ingerirPedido(nodo);
  assert.deepEqual(filas, []);
  assert.deepEqual(descartes.map(d => [d.fuente, d.motivo]), [
    ['envio', MOTIVOS.sinCodigo],
    ['facturacion', MOTIVOS.noReconocido],
  ]);
});

// Orden de candidatos: checkout -> envio -> perfil -> facturacion. Con el
// telefono del checkout presente (que en el padron de hoy nunca lo esta), ese
// gana la fila y el de envio -- si es el mismo numero -- no produce una segunda.
test('el telefono del checkout manda sobre el de envio cuando es el mismo numero', () => {
  const nodo = { ...S1898, phone: '+529991632568' };
  const { filas } = ingerirPedido(nodo);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].fuente, 'checkout');
  assert.equal(filas[0].nombre, 'Gerardo Jose Cardenas Guillermo',
    'sin nombre de cuenta en la respuesta, el del titular es el de facturacion');
});

test('el telefono del perfil del cliente tambien es candidato', () => {
  const nodo = {
    ...S1898,
    customer: { defaultPhoneNumber: { phoneNumber: '+525512345678' } },
  };
  const { filas } = ingerirPedido(nodo);
  assert.deepEqual(filas.map(f => [f.fuente, f.telefono]), [
    ['envio', '+529991632568'],
    ['perfil', '+525512345678'],
  ]);
});

// Un pedido sin nombre en ninguna direccion sigue produciendo fila: el nombre
// visible cae al numero de pedido (lo arma el nucleo de contactos), que es
// exactamente el dato que quien contesta necesita.
test('un pedido sin nombre en las direcciones produce fila igual', () => {
  const nodo = {
    ...S1898,
    shippingAddress: { name: null, phone: '+529991632568', countryCodeV2: 'MX' },
    billingAddress: null,
  };
  const { filas } = ingerirPedido(nodo);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].nombre, '');
});
