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

// Sin `+` por ningun lado: el escalon 1 solo no lo rescata (#255), pero envio
// y facturacion coinciden en MX y el escalon 2 (#256) si lo hace.
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

// S1893 real (#256, escalon 2): sin `+` por ningun lado, pero envio y
// facturacion coinciden en MX, asi que el pais de la direccion completa el
// numero. El mismo numero en las dos direcciones tampoco produce dos filas:
// `resueltos` (por celular10) lo deduplica igual que ya hacia con descartes.
test('un pedido cuyo telefono no trae codigo de pais se rescata con el pais de la direccion', () => {
  const { filas, descartes } = ingerirPedido(S1893);
  assert.deepEqual(descartes, []);
  assert.equal(filas.length, 1);
  assert.deepEqual(filas[0], {
    pedido: 'S1893',
    creadoEn: '2026-08-07T20:21:29.000Z',
    telefono: '+524491112584',
    celular10: '4491112584',
    nombre: 'Alberto Ramirez Herrera',
    correo: 'alberto@ejemplo.mx',
    fuente: 'envio',
  });
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
// implicito -- el escalon 1 lo descarta -- pero el escalon 2 (#256) si lo
// rescata con el pais de la direccion, porque MX SI valida ese numero.
test('un numero nacional de diez digitos se rescata con el pais de la direccion', () => {
  const nodo = {
    ...S1898,
    shippingAddress: { name: 'Ana Lopez', phone: '55 3466 7682', countryCodeV2: 'MX' },
    billingAddress: null,
  };
  const { filas, descartes } = ingerirPedido(nodo);
  assert.deepEqual(descartes, []);
  assert.equal(filas[0].telefono, '+525534667682');
});

// La basura sigue sin ser un telefono ni con el pais de la direccion puesto a
// prueba: '551953,3' no valida en MX (escalon 2) y '+52 999' no valida por si
// solo (escalon 1, la direccion no se consulta con `+` explicito).
test('la basura que no es un telefono se descarta con su propio motivo', () => {
  const nodo = {
    ...S1898,
    shippingAddress: { name: 'Ana Lopez', phone: '551953,3', countryCodeV2: 'MX' },
    billingAddress: { name: 'Ana Lopez', phone: '+52 999', countryCodeV2: 'MX' },
  };
  const { filas, descartes } = ingerirPedido(nodo);
  assert.deepEqual(filas, []);
  assert.deepEqual(descartes.map(d => [d.fuente, d.motivo]), [
    ['envio', MOTIVOS.invalidoParaPais],
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

// A partir de aqui, escalones 2 y 3 (#256): el pais de la direccion completa
// un telefono sin codigo, con veto por invalidez o por contradiccion entre
// envio y facturacion. Casos citados por el ticket, verificados en vivo con
// libphonenumber-js antes de escribirlos (node -e).

test('un formato local de Estados Unidos se completa con el pais de la direccion', () => {
  const nodo = {
    ...S1898,
    shippingAddress: { name: 'Bruce Miller', phone: '(831) 332-0180', countryCodeV2: 'US' },
    billingAddress: null,
  };
  const { filas, descartes } = ingerirPedido(nodo);
  assert.deepEqual(descartes, []);
  assert.equal(filas[0].telefono, '+18313320180');
});

// El `+` explicito manda incluso con una direccion mexicana: el escalon 1 ya
// lo resuelve y la direccion nunca se consulta.
test('el + explicito no consulta la direccion aunque sea de otro pais', () => {
  const nodo = {
    ...S1898,
    shippingAddress: { name: 'Diane Foster', phone: '+1 772-307-5353', countryCodeV2: 'MX' },
    billingAddress: { name: 'Diane Foster', phone: '+1 772-307-5353', countryCodeV2: 'MX' },
  };
  const { filas, descartes } = ingerirPedido(nodo);
  assert.deepEqual(descartes, []);
  assert.equal(filas[0].telefono, '+17723075353');
});

test('el codigo nacional pegado con espacios y parentesis tambien resuelve en escalon 1', () => {
  const nodo = {
    ...S1898,
    shippingAddress: { name: 'Karen White', phone: '1 (618) 979-5815', countryCodeV2: 'US' },
    billingAddress: null,
  };
  const { filas, descartes } = ingerirPedido(nodo);
  assert.deepEqual(descartes, []);
  assert.equal(filas[0].telefono, '+16189795815');
});

// Un numero que solo es valido como NANP (Estados Unidos/Canada) no se admite
// con una direccion mexicana: el pais equivocado nunca se admite (#254). El
// mismo numero repetido en envio y facturacion tambien confirma que un solo
// descarte cubre las dos direcciones cuando el numero es identico.
test('un numero valido solo como NANP con direccion mexicana se descarta', () => {
  const nodo = {
    ...S1898,
    shippingAddress: { name: 'Luis Torres', phone: '(520) 490-5641', countryCodeV2: 'MX' },
    billingAddress: { name: 'Luis Torres', phone: '(520) 490-5641', countryCodeV2: 'MX' },
  };
  const { filas, descartes } = ingerirPedido(nodo);
  assert.deepEqual(filas, []);
  assert.deepEqual(descartes, [{ pedido: 'S1898', fuente: 'envio', motivo: MOTIVOS.invalidoParaPais }]);
});

test('envio y facturacion con paises distintos y sin + se descarta por contradiccion', () => {
  const nodo = {
    ...S1898,
    shippingAddress: { name: 'Monica Reyes', phone: '5534667682', countryCodeV2: 'MX' },
    billingAddress: { name: 'Monica Reyes', phone: '5534667682', countryCodeV2: 'US' },
  };
  const { filas, descartes } = ingerirPedido(nodo);
  assert.deepEqual(filas, []);
  assert.deepEqual(descartes, [{ pedido: 'S1898', fuente: 'envio', motivo: MOTIVOS.paisesContradictorios }]);
});

test('sin facturacion, se usa el pais de envio', () => {
  const nodo = {
    ...S1898,
    shippingAddress: { name: 'Paula Gomez', phone: '4491112584', countryCodeV2: 'MX' },
    billingAddress: null,
  };
  const { filas, descartes } = ingerirPedido(nodo);
  assert.deepEqual(descartes, []);
  assert.equal(filas[0].telefono, '+524491112584');
});

// El ticket cita "9 3135 8538" + CL como descarte, pero ese numero SI es un
// movil chileno valido para libphonenumber-js (+56931358538): verificado con
// node -e antes de escribir este caso. Se ajusta el numero (un digito menos,
// invalido en CL) para fijar el comportamiento real de un pais sin ambiguedad
// MX/US donde el numero de la direccion tampoco valida.
test('un numero invalido en un pais sin regla especial se descarta', () => {
  const nodo = {
    ...S1898,
    shippingAddress: { name: 'Ignacio Soto', phone: '9 3135 853', countryCodeV2: 'CL' },
    billingAddress: null,
  };
  const { filas, descartes } = ingerirPedido(nodo);
  assert.deepEqual(filas, []);
  assert.deepEqual(descartes, [{ pedido: 'S1898', fuente: 'envio', motivo: MOTIVOS.invalidoParaPais }]);
});

test('sin pais en ninguna direccion, se descarta sin consultar nada', () => {
  const nodo = {
    ...S1898,
    shippingAddress: { name: 'Rosa Nunez', phone: '5534667682', countryCodeV2: null },
    billingAddress: null,
  };
  const { filas, descartes } = ingerirPedido(nodo);
  assert.deepEqual(filas, []);
  assert.deepEqual(descartes, [{ pedido: 'S1898', fuente: 'envio', motivo: MOTIVOS.sinCodigo }]);
});
