import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parsearCsv, indexarClientes, paisDeDireccionLibre, resolverPaisPedido,
  pedidoOperamANodo, planearCargaDesdeOperam, pedidoCsvANodo, planearCargaDesdePedidosCsv,
} from '../lib/pedidos-shopify-historico.js';

test('parsearCsv respeta comillas y comas dentro de un campo', () => {
  const csv = 'Email,Default Address Company,Default Address Country Code\n' +
    'a@ejemplo.mx,"Empresa, S.A. de C.V.",MX\n';
  const filas = parsearCsv(csv);
  assert.deepEqual(filas, [
    { Email: 'a@ejemplo.mx', 'Default Address Company': 'Empresa, S.A. de C.V.', 'Default Address Country Code': 'MX' },
  ]);
});

test('parsearCsv quita el apostrofo inicial de Excel al leer el telefono', () => {
  const csv = 'Email,Default Address Phone\na@ejemplo.mx,\'+52 81 8686 2090\n';
  const filas = parsearCsv(csv);
  assert.equal(filas[0]['Default Address Phone'], "'+52 81 8686 2090");
});

const FILAS_CLIENTES = [
  { Email: 'gerardo@ejemplo.mx', 'Default Address Phone': "'+52 99 9163 2568", Phone: '', 'Default Address Country Code': 'MX', 'Total Orders': 3 },
  { Email: 'sara@ejemplo.com', 'Default Address Phone': '(206) 355-3198', Phone: '', 'Default Address Country Code': 'US', 'Total Orders': 1 },
  { Email: 'sinpais@ejemplo.mx', 'Default Address Phone': '55 1234 5678', Phone: '', 'Default Address Country Code': '', 'Total Orders': 1 },
  { Email: 'nuncacompro@ejemplo.mx', 'Default Address Phone': '', Phone: '', 'Default Address Country Code': 'MX', 'Total Orders': 0 },
  { Email: 'huerfano@ejemplo.mx', 'Default Address Phone': '55 5555 5555', Phone: '', 'Default Address Country Code': 'MX', 'Total Orders': 2 },
];

test('indexarClientes indexa por correo y por ultimos10 de cualquiera de los dos telefonos', () => {
  const { porCorreo, porTelefono } = indexarClientes(FILAS_CLIENTES);
  assert.equal(porCorreo.get('gerardo@ejemplo.mx').pais, 'MX');
  assert.equal(porTelefono.get('9991632568').pais, 'MX');
  assert.equal(porTelefono.get('2063553198').pais, 'US');
});

test('paisDeDireccionLibre reconoce el token de 2 letras antes del CP', () => {
  assert.equal(paisDeDireccionLibre('Calle 1, Colonia X, Guadalajara JAL MX 44100'), 'MX');
  assert.equal(paisDeDireccionLibre('123 Main St, Austin TX US'), 'US');
  assert.equal(paisDeDireccionLibre('sin nada reconocible'), null);
  assert.equal(paisDeDireccionLibre(''), null);
});

test('resolverPaisPedido cruza primero por correo', () => {
  const indices = indexarClientes(FILAS_CLIENTES);
  const r = resolverPaisPedido({ contact_email: 'Gerardo@Ejemplo.mx', contact_phone: '0000000000' }, indices);
  assert.deepEqual(r, { pais: 'MX', metodo: 'correo', clienteIdx: 0 });
});

test('resolverPaisPedido cruza por telefono cuando el correo no aparece en el padron', () => {
  const indices = indexarClientes(FILAS_CLIENTES);
  const r = resolverPaisPedido({ contact_email: 'otro@ejemplo.mx', contact_phone: '2063553198' }, indices);
  assert.deepEqual(r, { pais: 'US', metodo: 'telefono', clienteIdx: 1 });
});

test('resolverPaisPedido cae a la direccion cuando el cliente cruzo pero sin pais en el padron', () => {
  const indices = indexarClientes(FILAS_CLIENTES);
  const r = resolverPaisPedido(
    { contact_email: 'sinpais@ejemplo.mx', contact_phone: '5512345678', delivery_address: 'Calle Z, Toluca EDOMEX MX 50000' },
    indices
  );
  assert.deepEqual(r, { pais: 'MX', metodo: 'direccion', clienteIdx: 2 });
});

test('resolverPaisPedido sin cruce ni direccion reconocible deja el pais nulo', () => {
  const indices = indexarClientes(FILAS_CLIENTES);
  const r = resolverPaisPedido({ contact_email: 'desconocido@ejemplo.mx', contact_phone: '5500000000', delivery_address: 'nada reconocible' }, indices);
  assert.deepEqual(r, { pais: null, metodo: null, clienteIdx: null });
});

test('pedidoOperamANodo arma el nodo con un solo candidato, el de envio', () => {
  const nodo = pedidoOperamANodo({
    reference: 'S1900', ord_date: '2026-06-01', contact_email: 'gerardo@ejemplo.mx',
    contact_phone: '+529991632568', deliver_to: 'Gerardo Cardenas',
  }, 'MX');
  assert.deepEqual(nodo, {
    name: 'S1900',
    createdAt: '2026-06-01',
    email: 'gerardo@ejemplo.mx',
    phone: null,
    customer: null,
    shippingAddress: { name: 'Gerardo Cardenas', phone: '+529991632568', countryCodeV2: 'MX' },
    billingAddress: null,
  });
});

test('planearCargaDesdeOperam resuelve, cruza y clasifica en un solo plan', () => {
  const pedidosOperam = [
    { reference: 'S1900', ord_date: '2026-06-01', contact_email: 'gerardo@ejemplo.mx', contact_phone: '+529991632568', deliver_to: 'Gerardo Cardenas' },
    { reference: 'S1901', ord_date: '2026-06-02', contact_email: 'otro@ejemplo.mx', contact_phone: '2063553198', deliver_to: 'Sara Dickerman' },
    { reference: 'S1902', ord_date: '2026-06-03', contact_email: 'nadie@ejemplo.mx', contact_phone: '5511122233', deliver_to: 'Nadie', delivery_address: 'Calle Z MX 50000' },
    { reference: 'S1903', ord_date: '2026-06-04', contact_email: 'perdido@ejemplo.mx', contact_phone: '', deliver_to: 'Sin telefono' },
  ];
  const plan = planearCargaDesdeOperam({ pedidosOperam, filasClientes: FILAS_CLIENTES });

  assert.equal(plan.leidos, 4);
  assert.equal(plan.filas.length, 3);
  assert.equal(plan.descartes.length, 1);
  assert.equal(plan.descartes[0].pedido, 'S1903');

  // S1900: correo cruzo con codigo explicito (+52...) -> conCodigo.
  // S1901: telefono cruzo, US valido sin +, pero 10 digitos NANP se completan
  //   por pais -> porPais (el veto de isValid([US]) resuelve el numero
  //   norteamericano, que no trae codigo explicito en el texto).
  // S1902: sin cruce, resuelto por direccion (10 digitos MX) -> porPais.
  assert.equal(plan.conCodigo, 1);
  assert.equal(plan.porPais, 2);

  assert.deepEqual(plan.cruce, { correo: 1, telefono: 1, direccion: 1, sinPais: 1 });

  // sinpais@ejemplo.mx (Total Orders=1) y huerfano@ejemplo.mx (Total Orders=2)
  // no cruzaron con ningun pedido de la lista (ni por correo ni por telefono)
  // -> cuentan como compradores sin pedido S encontrado.
  assert.equal(plan.compradoresSinPedido, 2);
});

test('pedidoCsvANodo trae las dos direcciones sin necesitar cruce', () => {
  const nodo = pedidoCsvANodo({
    Name: 'S1950', 'Created at': '2026-07-01', Email: 'x@ejemplo.mx', Phone: '',
    'Shipping Name': 'Juan Perez', 'Shipping Phone': "'+525512345678", 'Shipping Country': 'Mexico',
    'Billing Name': 'Juan Perez', 'Billing Phone': "'+525512345678", 'Billing Country': 'MX',
  });
  assert.deepEqual(nodo, {
    name: 'S1950',
    createdAt: '2026-07-01',
    email: 'x@ejemplo.mx',
    phone: null,
    customer: null,
    shippingAddress: { name: 'Juan Perez', phone: '+525512345678', countryCodeV2: 'MX' },
    billingAddress: { name: 'Juan Perez', phone: '+525512345678', countryCodeV2: 'MX' },
  });
});

test('planearCargaDesdePedidosCsv deduplica los renglones repetidos del mismo pedido', () => {
  const filasPedidos = [
    { Name: 'S1950', 'Created at': '2026-07-01', Email: 'x@ejemplo.mx', Phone: '', 'Shipping Name': 'Juan Perez', 'Shipping Phone': '5512345678', 'Shipping Country': 'MX', 'Billing Name': 'Juan Perez', 'Billing Phone': '5512345678', 'Billing Country': 'MX' },
    { Name: 'S1950', 'Created at': '2026-07-01', Email: 'x@ejemplo.mx', Phone: '', 'Shipping Name': 'Juan Perez', 'Shipping Phone': '5512345678', 'Shipping Country': 'MX', 'Billing Name': 'Juan Perez', 'Billing Phone': '5512345678', 'Billing Country': 'MX' },
    { Name: 'S1951', 'Created at': '2026-07-02', Email: 'y@ejemplo.mx', Phone: '', 'Shipping Name': 'Ana Lopez', 'Shipping Phone': '', 'Shipping Country': '', 'Billing Name': '', 'Billing Phone': '', 'Billing Country': '' },
  ];
  const plan = planearCargaDesdePedidosCsv({ filasPedidos });
  assert.equal(plan.leidos, 2);
  assert.equal(plan.filas.length, 1);
  assert.equal(plan.filas[0].pedido, 'S1950');
  assert.equal(plan.descartes.length, 1);
  assert.equal(plan.descartes[0].pedido, 'S1951');
});

test('pedidoCsvANodo reconoce el nombre completo del pais ademas del codigo', () => {
  const nodo = pedidoCsvANodo({
    Name: 'S1960', 'Created at': '2026-07-05', Email: '', Phone: '',
    'Shipping Name': 'Bruce Miller', 'Shipping Phone': '(831) 332-0180', 'Shipping Country': 'United States',
    'Billing Name': '', 'Billing Phone': '', 'Billing Country': '',
  });
  assert.equal(nodo.shippingAddress.countryCodeV2, 'US');
});

test('pedidoCsvANodo deja pasar CUALQUIER codigo ISO de 2 letras, no solo MX/US/CA', () => {
  const nodo = pedidoCsvANodo({
    Name: 'S1961', 'Created at': '2026-07-06', Email: '', Phone: '',
    'Shipping Name': 'Ignacio Soto', 'Shipping Phone': '931358538', 'Shipping Country': 'AR',
    'Billing Name': '', 'Billing Phone': '', 'Billing Country': '',
  });
  assert.equal(nodo.shippingAddress.countryCodeV2, 'AR');
});

test('un pedido cancelado (Cancelled at con fecha) entra igual que cualquier otro', () => {
  const filasPedidos = [
    { Name: 'S1970', 'Created at': '2026-07-10', Email: '', Phone: '', 'Cancelled at': '2026-07-11 10:00:00 -0600',
      'Shipping Name': 'Cliente Cancelado', 'Shipping Phone': '+525512345678', 'Shipping Country': 'MX',
      'Billing Name': '', 'Billing Phone': '', 'Billing Country': '' },
  ];
  const plan = planearCargaDesdePedidosCsv({ filasPedidos });
  assert.equal(plan.filas.length, 1);
  assert.equal(plan.filas[0].pedido, 'S1970');
});

test('planearCargaDesdePedidosCsv clasifica con-codigo vs por-pais y cuenta telefonos distintos', () => {
  const filasPedidos = [
    // con codigo explicito (+52...)
    { Name: 'S1', 'Created at': '2026-07-01', Email: '', Phone: '',
      'Shipping Name': 'Uno', 'Shipping Phone': '+525512345678', 'Shipping Country': 'MX',
      'Billing Name': '', 'Billing Phone': '', 'Billing Country': '' },
    // sin codigo, se completa con el pais (10 digitos)
    { Name: 'S2', 'Created at': '2026-07-02', Email: '', Phone: '',
      'Shipping Name': 'Dos', 'Shipping Phone': '5534667682', 'Shipping Country': 'MX',
      'Billing Name': '', 'Billing Phone': '', 'Billing Country': '' },
    // el mismo telefono que S1 en otro pedido: no debe contarse dos veces en telefonosDistintos
    { Name: 'S3', 'Created at': '2026-07-03', Email: '', Phone: '',
      'Shipping Name': 'Uno de nuevo', 'Shipping Phone': '+525512345678', 'Shipping Country': 'MX',
      'Billing Name': '', 'Billing Phone': '', 'Billing Country': '' },
  ];
  const plan = planearCargaDesdePedidosCsv({ filasPedidos });
  assert.equal(plan.filas.length, 3);
  assert.equal(plan.conCodigo, 2);
  assert.equal(plan.porPais, 1);
  assert.equal(plan.telefonosDistintos, 2);
});

test('parsearCsv respeta un salto de linea dentro de un campo entrecomillado', () => {
  const csv = 'Name,Shipping Street\nS1,"Calle 1\nColonia X"\n';
  const filas = parsearCsv(csv);
  assert.equal(filas.length, 1);
  assert.equal(filas[0]['Shipping Street'], 'Calle 1\nColonia X');
});
