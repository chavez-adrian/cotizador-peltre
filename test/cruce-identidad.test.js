import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  limpiarTelefonoParaGuardar,
  telefonosNormalizados,
  coincidenTelefonos,
  coincidenNombres,
  cruzarIdentidad,
  CATEGORIAS,
  CAMPOS_HEREDADOS_DEL_QUOTE,
  CERRO,
  COMPRO_OTRA_COSA,
  SIN_SENAL,
} from '../lib/cruce-identidad.js';

const LRE = '\u202A';
const PDF_MARK = '\u202C';

// T1: la marca invisible U+202A (LEFT-TO-RIGHT EMBEDDING) que WhatsApp/iOS pegan
// junto al numero se elimina AL GUARDAR, no solo al comparar (#123).
test('T1: limpiarTelefonoParaGuardar quita la marca invisible U+202A', () => {
  const crudo = LRE + '+52 55 1234 5678' + PDF_MARK;
  assert.equal(limpiarTelefonoParaGuardar(crudo), '+52 55 1234 5678');
});

// T2: los prefijos que conviven en el catalogo real (formatos vistos en la
// medicion: "+52 1 614 176 4495", "044 55 ...", "01 55 ...") producen la MISMA
// llave nacional de 10 digitos.
test('T2: telefonosNormalizados tolera +52 / 52 / 521 / 01 / 044 / 045', () => {
  const formatos = [
    '5512345678',
    '55 1234 5678',
    '+52 55 1234 5678',
    '52 55 1234 5678',
    '+52 1 55 1234 5678',
    '521 5512345678',
    '01 55 1234 5678',
    '044 55 1234 5678',
    '045 55 1234 5678',
    '+52 (55) 1234-5678',
  ];
  for (const f of formatos) {
    const tels = telefonosNormalizados(f);
    assert.equal(tels.length, 1, `esperaba 1 numero en "${f}", hubo ${tels.length}`);
    assert.equal(tels[0].llave10, '5512345678', `llave10 incorrecta para "${f}"`);
  }
});

// T3: varios numeros capturados en un mismo campo se separan. La extension
// (",116") NO es un numero: se recorta, igual que en ultimos10.
test('T3: telefonosNormalizados separa varios numeros del mismo campo', () => {
  const casos = [
    ['5551234567 / 5559876543', ['5551234567', '5559876543']],
    ['55 1234 5678, 55 8765 4321', ['5512345678', '5587654321']],
    ['5551234567 5559876543', ['5551234567', '5559876543']],
    ['+52 5551234567 +52 5559876543', ['5551234567', '5559876543']],
    ['5551234567 y 5559876543', ['5551234567', '5559876543']],
    ['+52(55)53952615,116', ['5553952615']],
    ['+52 55 5395 2615 ext.116', ['5553952615']],
  ];
  for (const [campo, esperadas] of casos) {
    const llaves = telefonosNormalizados(campo).map(t => t.llave10);
    assert.deepEqual(llaves, esperadas, `campo "${campo}"`);
  }
});

// T4: comparacion por identidad. La llave de 10 digitos es la senal fuerte; los
// ultimos 8 rescatan las capturas con la LADA distinta (o sin lada), que es como
// llegan varios telefonos del catalogo.
test('T4: coincidenTelefonos distingue llave10 de rescate por sufijo 8', () => {
  assert.equal(coincidenTelefonos('+52 1 55 1234 5678', '5512345678'), 'llave10');
  assert.equal(coincidenTelefonos('9 8317 7005', '+56 9 8317 7005'), 'sufijo8');
  assert.equal(coincidenTelefonos('5395 2615', '55 5395 2615'), 'sufijo8');
  assert.equal(coincidenTelefonos('5551234567', '5559876543'), null);
  assert.equal(coincidenTelefonos('', '5551234567'), null);
  assert.equal(coincidenTelefonos(null, null), null);
});

// T5: identidad por nombre. Dos tokens propios compartidos ligan; un solo token
// liga solo si es distintivo (marca o apellido largo). Las palabras genericas de
// giro comercial NO ligan a nadie -- "Mostrador digital" es el contacto que la
// medicion vio repetido en decenas de cotizaciones sin relacion entre si.
test('T5: coincidenNombres liga por tokens propios, no por palabras de giro', () => {
  assert.equal(coincidenNombres('Cafeteria El Peldano', 'CAFETERIA EL PELDANO'), true);
  assert.equal(coincidenNombres('Daniela Rabago', 'DANIELA RABAGO GONZALEZ LUNA'), true);
  assert.equal(coincidenNombres('Obasan', 'OBASAN LIMITED'), true);
  assert.equal(coincidenNombres('Mostrador digital', 'MOSTRADOR DIGITAL SA DE CV'), false);
  assert.equal(coincidenNombres('Grupo Hotelero Costa', 'GRUPO RESTAURANTERO NORTE'), false);
  assert.equal(coincidenNombres('Ana Lopez', 'ANA MARTINEZ SOLIS'), false);
  assert.equal(coincidenNombres('', 'OBASAN LIMITED'), false);
  assert.equal(coincidenNombres(null, undefined), false);
});

// ---------------------------------------------------------------------------
// Calibracion (medicion #118 del 2026-08-01, 170 quotes de debtors genericos).
// Las 12 filas con `trans_no_from` conservado son la unica verdad conocida del
// lote: se convirtieron de verdad. Los fixtures de abajo son SINTETICOS y
// anonimizados -- conservan la ESTRUCTURA de cada caso real (de que campo sale
// la identidad, con que formato llega el telefono, cuanto se movio el monto),
// nunca los datos personales.
// ---------------------------------------------------------------------------

const RUIDO_CATALOGO = [
  {
    customer_id: 900,
    CustName: 'DISTRIBUIDORA DEL BAJIO SA DE CV',
    cust_ref: 'Bajio',
    contacts: [{ name: 'Roberto Paredes', phone: '4771230000' }],
    branches: [{ phone: '477 123 0001' }],
  },
  {
    customer_id: 901,
    CustName: 'GRUPO HOTELERO COSTA AZUL',
    cust_ref: 'Costa Azul',
    contacts: [{ name: 'Mostrador digital', phone: '' }],
    branches: [],
  },
];

// Cada caso: el quote del debtor generico, el cliente REAL del catalogo (con sus
// contactos y sucursales) y el pedido que salio de ahi.
const CASOS_LIGADOS = [
  {
    caso: 'marca de una palabra: el proyecto del quote es la razon social',
    quote: { folio: '757', total: 952.08, ord_date: '2025-01-02', deliver_to: 'Jean Marchand', contact_phone: '+1 613-555-0174', cust_ref: 'Obelisco' },
    cliente: { customer_id: 101, CustName: 'OBELISCO LIMITED', cust_ref: 'Obelisco', contacts: [], branches: [] },
    pedido: { order_no: '5236', debtor_no: 101, ord_date: '2025-01-08', total: 952.08 },
    esperada: CERRO,
  },
  {
    caso: 'apellido con dedazo en el alta: rescata el telefono, no el nombre',
    quote: { folio: '765', total: 28891.06, ord_date: '2025-01-13', deliver_to: 'Hortensia Barrera', contact_phone: '+52 1 614 555 0195', cust_ref: 'Hortensia Barrera' },
    cliente: { customer_id: 102, CustName: 'Hortencia Barreda', cust_ref: '', contacts: [{ name: 'Hortencia Barreda', phone: '614 555 0195' }], branches: [] },
    pedido: { order_no: '5253', debtor_no: 102, ord_date: '2025-01-20', total: 28891.06 },
    esperada: CERRO,
  },
  {
    caso: 'el cliente factura a otro nombre: liga por el CONTACTO del catalogo',
    quote: { folio: '778', total: 1204.90, ord_date: '2025-01-30', deliver_to: 'Marycarmen Aguilar', contact_phone: '', cust_ref: 'Ensaladas y Alas' },
    cliente: { customer_id: 103, CustName: 'LAURA DANIRA GALINDO FERRER', cust_ref: '', contacts: [{ name: 'Marycarmen Aguilar', phone: '' }], branches: [] },
    pedido: { order_no: '5319', debtor_no: 103, ord_date: '2025-02-04', total: 1204.86 },
    esperada: CERRO,
  },
  {
    caso: 'el telefono vive en la SUCURSAL del cliente, no en el contacto',
    quote: { folio: '805', total: 7465.99, ord_date: '2025-03-31', deliver_to: 'Beatriz Alcazar', contact_phone: '5521555088', cust_ref: 'Grupo Ojo de Aguja' },
    cliente: { customer_id: 104, CustName: 'GODA ALIMENTOS COMISARIATO', cust_ref: '', contacts: [], branches: [{ phone: '55 2155 5088' }] },
    pedido: { order_no: '5562', debtor_no: 104, ord_date: '2025-04-02', total: 7465.99 },
    esperada: CERRO,
  },
  {
    caso: 'razon social sin relacion con el contacto: liga el celular 521',
    quote: { folio: '812', total: 20394.50, ord_date: '2025-04-07', deliver_to: 'Luis Enrique Guerra', contact_phone: '+52 1 55 1731 5503', cust_ref: 'Mezcal Destreza' },
    cliente: { customer_id: 105, CustName: 'FRACTAL WEALTH MANAGEMENT', cust_ref: '', contacts: [{ name: 'Compras', phone: '5517315503' }], branches: [] },
    pedido: { order_no: '5561', debtor_no: 105, ord_date: '2025-04-11', total: 20394.49 },
    esperada: CERRO,
  },
  {
    caso: 'el pedido crecio 5.3%: sigue dentro de la banda',
    quote: { folio: '835', total: 79298.38, ord_date: '2025-05-06', deliver_to: 'Daniela Robles', contact_phone: '+52 1 33 1369 5527', cust_ref: 'Damar' },
    cliente: { customer_id: 106, CustName: 'DANIELA ROBLES GALVAN LUNA', cust_ref: '', contacts: [], branches: [] },
    pedido: { order_no: '5725', debtor_no: 106, ord_date: '2025-05-12', total: 83715.80 },
    esperada: CERRO,
  },
  {
    caso: 'sin contacto ni telefono ("Mostrador digital"): la identidad NO se inventa',
    quote: { folio: '851', total: 1925.00, ord_date: '2025-06-02', deliver_to: 'Mostrador digital', contact_phone: '', cust_ref: '' },
    cliente: { customer_id: 107, CustName: 'JULIO CESAR AIVAR BUSTILLOS', cust_ref: '', contacts: [], branches: [] },
    pedido: { order_no: '5775', debtor_no: 107, ord_date: '2025-06-03', total: 1925.00 },
    esperada: SIN_SENAL,
  },
  {
    caso: 'proyecto = razon social, con telefono fijo de 10 digitos',
    quote: { folio: '854', total: 39050.40, ord_date: '2025-06-03', deliver_to: 'Claudia Gonzalez', contact_phone: '55 5281 5518 ', cust_ref: 'Cafebreria El Pendulo' },
    cliente: { customer_id: 108, CustName: 'CAFEBRERIA EL PENDULO', cust_ref: 'Pendulo', contacts: [{ name: 'Vianey', phone: '5552815518' }], branches: [] },
    pedido: { order_no: '5807', debtor_no: 108, ord_date: '2025-06-09', total: 39045.60 },
    esperada: CERRO,
  },
  {
    caso: 'telefono con lada entre parentesis contra el mismo numero pegado',
    quote: { folio: '866', total: 953.00, ord_date: '2025-06-24', deliver_to: 'Luisa Cabral', contact_phone: '+52(871)1445591', cust_ref: 'Monica Ferrer' },
    cliente: { customer_id: 109, CustName: 'GALERIA JUAREZ 2525', cust_ref: '', contacts: [{ name: 'Recepcion', phone: '8711445591' }], branches: [] },
    pedido: { order_no: '5886', debtor_no: 109, ord_date: '2025-06-26', total: 953.00 },
    esperada: CERRO,
  },
  {
    caso: 'persona fisica con razon social propia: liga por el contacto',
    quote: { folio: '895', total: 24562.54, ord_date: '2025-07-24', deliver_to: 'Thiaren Villalobos', contact_phone: '8115550207', cust_ref: 'La Mananera' },
    cliente: { customer_id: 110, CustName: 'MARTIN ALEJANDRO IBARRA SALDANA', cust_ref: '', contacts: [{ name: 'Thiaren Villalobos', phone: '' }], branches: [] },
    pedido: { order_no: '5991', debtor_no: 110, ord_date: '2025-07-29', total: 24562.54 },
    esperada: CERRO,
  },
  {
    caso: 'la lada se capturo en un lado y no en el otro: rescate por sufijo 8',
    quote: { folio: '900', total: 7415.45, ord_date: '2025-07-31', deliver_to: 'Pablo Quiroz', contact_phone: '81 1555 0443', cust_ref: 'Mr Wasabi' },
    cliente: { customer_id: 111, CustName: 'OPERADORA VALIENTE', cust_ref: '', contacts: [{ name: 'Compras', phone: '1555 0443' }], branches: [] },
    pedido: { order_no: '6021', debtor_no: 111, ord_date: '2025-08-05', total: 7415.45 },
    esperada: CERRO,
  },
  {
    caso: 'celular con lada de 3 digitos y espacios contra el numero pegado',
    quote: { folio: '992', total: 38676.65, ord_date: '2025-10-27', deliver_to: 'Sofia Menge', contact_phone: '+52 984 555 1685', cust_ref: 'Grupo Ballena' },
    cliente: { customer_id: 112, CustName: 'MUUCH HOTEL GROUP', cust_ref: '', contacts: [{ name: 'Reservas', phone: '9845551685' }], branches: [] },
    pedido: { order_no: '6367', debtor_no: 112, ord_date: '2025-11-03', total: 38676.65 },
    esperada: CERRO,
  },
];

// Operam HEREDA estos campos del quote al pedido convertido: copiarlos al pedido
// reproduce el lote real y comprueba que no aportan identidad (ver T7).
function pedidoConHerencia(pedido, quote, ligado) {
  return {
    ...pedido,
    trans_no_from: ligado ? quote.folio : '',
    deliver_to: quote.deliver_to,
    contact_phone: quote.contact_phone,
    contact_email: quote.contact_email || '',
    delivery_address: quote.delivery_address || '',
    customer_ref: quote.cust_ref,
  };
}

function escenario(caso, { ligado }) {
  return {
    quote: caso.quote,
    clientes: [...RUIDO_CATALOGO, caso.cliente],
    pedidos: [pedidoConHerencia(caso.pedido, caso.quote, ligado)],
  };
}

// T6: las 12 cotizaciones con liga conservada se clasifican IGUAL con y sin
// `trans_no_from`: el cruce es por identidad contra el catalogo y la liga no
// participa. La 851 ("Mostrador digital", sin telefono ni proyecto) queda en
// sin-senal a proposito: no hay identidad que cruzar y este modulo NO la
// inventa -- es una de las razones por las que el recall honesto es 67% y no
// 100%. Esa la rescata la liga, que es camino aparte (#124).
test('T6: las 12 ligadas se detectan por identidad ignorando trans_no_from', () => {
  for (const caso of CASOS_LIGADOS) {
    const conLiga = cruzarIdentidad(escenario(caso, { ligado: true }));
    const sinLiga = cruzarIdentidad(escenario(caso, { ligado: false }));
    assert.equal(conLiga.categoria, caso.esperada, `con liga -- ${caso.caso}`);
    assert.equal(sinLiga.categoria, caso.esperada, `sin liga -- ${caso.caso}`);
    assert.deepEqual(sinLiga, conLiga, `la liga cambio el resultado -- ${caso.caso}`);
    if (caso.esperada === CERRO) {
      assert.equal(sinLiga.cliente.customer_id, caso.cliente.customer_id, `cliente -- ${caso.caso}`);
      assert.equal(sinLiga.pedido.order_no, caso.pedido.order_no, `pedido -- ${caso.caso}`);
      assert.ok(sinLiga.senales.length > 0, `sin senales -- ${caso.caso}`);
    } else {
      assert.equal(sinLiga.cliente, null, `no debio ligar cliente -- ${caso.caso}`);
      assert.equal(sinLiga.pedido, null, `no debio ligar pedido -- ${caso.caso}`);
    }
  }
});

// T7: SESGO DE AUTO-CONFIRMACION. Operam copia deliver_to / contact_phone /
// contact_email / delivery_address / customer_ref del quote al pedido: un pedido
// convertido siempre "coincide" con su quote en esos campos. Aqui el pedido los
// trae todos identicos y con el mismo monto, pero su cliente no tiene nada de
// esa identidad en el CATALOGO -> sin-senal. El control (mismo escenario, con la
// identidad tambien en el catalogo) si cierra: la diferencia la hace el catalogo,
// no los campos heredados.
test('T7: los campos que el pedido hereda del quote no son senal de identidad', () => {
  const quote = {
    folio: '1044', total: 18450.00, ord_date: '2026-01-20',
    deliver_to: 'Regina Salcedo', contact_phone: '55 5111 0022',
    contact_email: 'regina@ejemplo.mx', delivery_address: 'Av. Siempre Viva 742',
    cust_ref: 'Panaderia Salcedo',
  };
  const pedidoHeredado = {
    order_no: '7101', debtor_no: 500, ord_date: '2026-01-27', total: 18450.00,
    trans_no_from: '', deliver_to: quote.deliver_to, contact_phone: quote.contact_phone,
    contact_email: quote.contact_email, delivery_address: quote.delivery_address,
    customer_ref: quote.cust_ref,
  };
  const clienteSinIdentidad = {
    customer_id: 500, CustName: 'ABARROTES DEL PONIENTE SA DE CV', cust_ref: 'Poniente',
    contacts: [{ name: 'Jorge Iturbe', phone: '5544332211' }],
    branches: [{ phone: '55 4433 2210' }],
  };

  // El fixture debe reproducir la herencia completa: si dejara de heredar algun
  // campo, el escenario ya no probaria la trampa.
  for (const campo of CAMPOS_HEREDADOS_DEL_QUOTE) {
    const valorQuote = campo === 'customer_ref' ? quote.cust_ref : quote[campo];
    assert.equal(pedidoHeredado[campo], valorQuote, `el pedido debe heredar ${campo}`);
  }

  const ciego = cruzarIdentidad({
    quote, clientes: [...RUIDO_CATALOGO, clienteSinIdentidad], pedidos: [pedidoHeredado],
  });
  assert.equal(ciego.categoria, SIN_SENAL);
  assert.equal(ciego.cliente, null);
  assert.equal(ciego.pedido, null);

  const clienteConIdentidad = {
    ...clienteSinIdentidad,
    contacts: [{ name: 'Jorge Iturbe', phone: '5551110022' }],
  };
  const control = cruzarIdentidad({
    quote, clientes: [...RUIDO_CATALOGO, clienteConIdentidad], pedidos: [pedidoHeredado],
  });
  assert.equal(control.categoria, CERRO);
  assert.equal(control.cliente.customer_id, 500);
  assert.equal(control.pedido.order_no, '7101');
});

// La misma identidad (telefono exacto en el contacto del catalogo) con montos
// distintos: lo unico que cambia el veredicto es la banda.
function escenarioMonto(totalQuote, totalPedido) {
  const quote = {
    folio: '1032', total: totalQuote, ord_date: '2026-02-10',
    deliver_to: 'Maira Montiel', contact_phone: '+52 55 2892 5550', cust_ref: 'Ditecno',
  };
  const cliente = {
    customer_id: 600, CustName: 'COMERCIALIZADORA VIDACA MEXICO', cust_ref: '',
    contacts: [{ name: 'Compras', phone: '5528925550' }], branches: [],
  };
  const pedido = { order_no: '6621', debtor_no: 600, ord_date: '2026-02-18', total: totalPedido };
  return { quote, clientes: [...RUIDO_CATALOGO, cliente], pedidos: [pedido] };
}

// T8: la banda de +-15% separa "cerro" de "compro otra cosa". Los porcentajes
// esperados son los que reporto la medicion para esas mismas filas (dif sobre el
// monto MAYOR entre cotizacion y pedido, igual que la heuristica de variante
// cerrada del backfill #76).
test('T8: la banda de +-15% distingue cerro de compro-otra-cosa', () => {
  const cerroCasiExacto = cruzarIdentidad(escenarioMonto(38676.65, 38676.65));
  assert.equal(cerroCasiExacto.categoria, CERRO);
  assert.equal(cerroCasiExacto.difMontoPct, 0);

  const cerroAlLimite = cruzarIdentidad(escenarioMonto(137.23, 117.64));
  assert.equal(cerroAlLimite.categoria, CERRO);
  assert.equal(cerroAlLimite.difMontoPct, 14.3);

  const fueraDeBanda = cruzarIdentidad(escenarioMonto(43929.08, 55893.92));
  assert.equal(fueraDeBanda.categoria, COMPRO_OTRA_COSA);
  assert.equal(fueraDeBanda.difMontoPct, 21.4);

  // El caso que fija el extremo: el contacto ya es cliente y compro $421, pero
  // la cotizacion de $32,732 no se cerro con eso.
  const comproOtraCosa = cruzarIdentidad(escenarioMonto(32732.00, 421.00));
  assert.equal(comproOtraCosa.categoria, COMPRO_OTRA_COSA);
  assert.equal(comproOtraCosa.cliente.customer_id, 600);
  assert.equal(comproOtraCosa.pedido.order_no, '6621');
  assert.equal(comproOtraCosa.difMontoPct, 98.7);

  // 15% exacto se queda dentro (banda inclusiva).
  assert.equal(cruzarIdentidad(escenarioMonto(1000, 850)).categoria, CERRO);
  assert.equal(cruzarIdentidad(escenarioMonto(1000, 840)).categoria, COMPRO_OTRA_COSA);
});

// T9: las categorias son una lista CERRADA y ninguna es prefijo de otra. En el
// reporte de la medicion, comparar por prefijo ('sin-senal'.startsWith('si'))
// conto cotizaciones vivas como cerradas: quien consuma este modulo compara por
// igualdad contra estas constantes.
test('T9: CATEGORIAS es lista explicita y ninguna es prefijo de otra', () => {
  assert.deepEqual(CATEGORIAS, ['cerro', 'compro-otra-cosa', 'sin-senal']);
  for (const a of CATEGORIAS) {
    for (const b of CATEGORIAS) {
      if (a === b) continue;
      assert.ok(!a.startsWith(b), `"${a}" empieza con "${b}"`);
    }
  }
  assert.ok(CATEGORIAS.includes(cruzarIdentidad(escenarioMonto(1000, 1000)).categoria));
  assert.ok(CATEGORIAS.includes(cruzarIdentidad({ quote: {}, clientes: [], pedidos: [] }).categoria));
});

// T10: aviso de posible duplicado para la bandeja (#122). La identidad de
// prospecto es "1 celular = 1 prospecto" por los ultimos 10 digitos
// (lib/telefono-llave.js): el rescate por sufijo 8, que si vale para reconocer a
// un cliente, NO alcanza para declarar duplicado a un prospecto.
test('T10: senala el prospecto existente con el mismo celular', () => {
  const prospectos = [
    { id: 7, nombre: 'Regina Salcedo', celular: '+52 1 55 5111 0022', celular10: '5551110022' },
    { id: 8, nombre: 'Jorge Iturbe', celular: '5544332211', celular10: '5544332211' },
  ];
  const base = escenarioMonto(1000, 1000);
  const quote = { ...base.quote, contact_phone: '044 55 5111 0022' };

  const conDuplicado = cruzarIdentidad({ ...base, quote, prospectos });
  assert.deepEqual(conDuplicado.duplicadoProspecto, { id: 7, nombre: 'Regina Salcedo', celular10: '5551110022' });

  const sinDuplicado = cruzarIdentidad({ ...base, quote: { ...base.quote, contact_phone: '5599887766' }, prospectos });
  assert.equal(sinDuplicado.duplicadoProspecto, null);

  const soloSufijo = cruzarIdentidad({ ...base, quote: { ...base.quote, contact_phone: '5111 0022' }, prospectos });
  assert.equal(soloSufijo.duplicadoProspecto, null);

  assert.equal(cruzarIdentidad(base).duplicadoProspecto, null);
});

// T11: causalidad. Primero se cotiza y luego se autoriza: un pedido ANTERIOR al
// quote (mas alla de la gracia de captura) no lo cierra, aunque sea del mismo
// cliente y del mismo monto -- es una compra previa del recurrente, justo el
// falso positivo del que advierte #76. Sin pedido atribuible el contacto sigue
// siendo cliente conocido, asi que la cotizacion queda viva (compro-otra-cosa
// con pedido null), nunca en sin-senal: la identidad SI existio.
test('T11: un pedido anterior a la cotizacion no la cierra', () => {
  const base = escenarioMonto(25000, 25000);
  const pedidoViejo = { ...base.pedidos[0], ord_date: '2025-09-15' };
  const pedidoEnGracia = { ...base.pedidos[0], ord_date: '2026-02-08' };
  const pedidoLejano = { ...base.pedidos[0], ord_date: '2026-06-01' };

  const previo = cruzarIdentidad({ ...base, pedidos: [pedidoViejo] });
  assert.equal(previo.categoria, COMPRO_OTRA_COSA);
  assert.equal(previo.cliente.customer_id, 600);
  assert.equal(previo.pedido, null);
  assert.equal(previo.difMontoPct, null);

  // Dentro de la gracia de 3 dias (el pedido se registra el dia que se autorizo
  // por telefono, antes de documentar la cotizacion).
  assert.equal(cruzarIdentidad({ ...base, pedidos: [pedidoEnGracia] }).categoria, CERRO);

  // Sin horizonte por default un cierre tardio sigue siendo cierre; el caller
  // puede acotarlo con ventanaDias.
  assert.equal(cruzarIdentidad({ ...base, pedidos: [pedidoLejano] }).categoria, CERRO);
  assert.equal(cruzarIdentidad({ ...base, pedidos: [pedidoLejano] }, { ventanaDias: 31 }).categoria, COMPRO_OTRA_COSA);
});
