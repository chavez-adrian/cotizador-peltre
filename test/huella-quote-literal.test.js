import { test } from 'node:test';
import assert from 'node:assert/strict';

// #522: la huella del quote fijada como LITERAL antes de que huella y reintento lean
// la tabla del Post-fix del encabezado del quote. contenidoQuoteCambio compara cadenas:
// si la forma de la huella se mueve un byte, toda cotizacion ya subida se lee como
// "cambio" y su primera regeneracion reescribe el quote en Operam.
const { huellaContenidoQuote, contenidoQuoteCambio } = await import('../lib/operam-client.js');

function cotizacion() {
  return {
    fecha: '2026-07-29',
    vigencia: '2026-08-28',
    cliente: { rfc: 'CPE921211N76', razonSocial: 'El Pendulo', nombreCorto: 'Pendulo', calle: 'Av. Juarez 45', cpEntrega: '56530', customerId: 376, branchId: 412 },
    items: [{ codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 10, precio: 100, descuento: 0 }],
    notas: ['Precio sujeto a cambio'],
    subtotal: 1000, iva: 160, total: 1160,
  };
}

// Capturada con el codigo de 9aa56f0 (antes de #522) para cotizacion() con lista 9 y
// transportista 3: los cuatro campos del encabezado al FINAL, en ese orden.
// D3b (decisiones de Adrian 2026-10-09): cotizacion() gano calle -- sin calle el
// domicilio de entrega ahora dice "Por definir" (prueba aparte, abajo) -- y con calle
// el delivery_address es la misma cadena que armaba aquel codigo (calle, CP).
const HUELLA_COMPLETA = '{"items":[{"stock_id":"CR20-PLATO","qty":10,"price":100,"Disc":0,"text":"Plato","editarDescripcion":false}],"custRef":"Pendulo","customerId":376,"deliverTo":"El Pendulo","deliveryAddress":"Av. Juarez 45, 56530","contactPhone":"","contactEmail":"","comments":"- Precio sujeto a cambio","subtotal":1000,"iva":160,"total":1160,"listaId":"9","branchId":"412","shipVia":"3","vigencia":"2026-08-28"}';

// Misma captura con lista y transportista null explicito (se escriben como null).
const HUELLA_NULLS = '{"items":[{"stock_id":"CR20-PLATO","qty":10,"price":100,"Disc":0,"text":"Plato","editarDescripcion":false}],"custRef":"Pendulo","customerId":376,"deliverTo":"El Pendulo","deliveryAddress":"Av. Juarez 45, 56530","contactPhone":"","contactEmail":"","comments":"- Precio sujeto a cambio","subtotal":1000,"iva":160,"total":1160,"listaId":null,"branchId":"412","shipVia":null,"vigencia":"2026-08-28"}';

// Misma captura sin opciones (lista y transportista undefined: se omiten).
const HUELLA_SIN_OPCIONES = '{"items":[{"stock_id":"CR20-PLATO","qty":10,"price":100,"Disc":0,"text":"Plato","editarDescripcion":false}],"custRef":"Pendulo","customerId":376,"deliverTo":"El Pendulo","deliveryAddress":"Av. Juarez 45, 56530","contactPhone":"","contactEmail":"","comments":"- Precio sujeto a cambio","subtotal":1000,"iva":160,"total":1160,"branchId":"412","vigencia":"2026-08-28"}';

// La forma que guardaba la subida ANTES de #403: sin ninguno de los cuatro campos
// tardios y con la vigencia como linea "Valido hasta: +30d" de comments (antes de #505).
const HUELLA_ANTES_DE_403 = '{"items":[{"stock_id":"CR20-PLATO","qty":10,"price":100,"Disc":0,"text":"Plato","editarDescripcion":false}],"custRef":"Pendulo","customerId":376,"deliverTo":"El Pendulo","deliveryAddress":"Av. Juarez 45, 56530","contactPhone":"","contactEmail":"","comments":"- Precio sujeto a cambio\\nValido hasta: +30d","subtotal":1000,"iva":160,"total":1160}';

test('#522 huellaContenidoQuote: con lista, domicilio, transportista y vigencia sale byte-identica', () => {
  assert.equal(huellaContenidoQuote(cotizacion(), { listaId: 9, shipVia: 3 }), HUELLA_COMPLETA);
  assert.equal(contenidoQuoteCambio(cotizacion(), HUELLA_COMPLETA, { listaId: 9, shipVia: 3 }), false);
});

test('#522 huellaContenidoQuote: null explicito se escribe y undefined se omite', () => {
  assert.equal(huellaContenidoQuote(cotizacion(), { listaId: null, shipVia: null }), HUELLA_NULLS);
  assert.equal(huellaContenidoQuote(cotizacion()), HUELLA_SIN_OPCIONES);
});

test('#522 contenidoQuoteCambio: una huella anterior a #403 sin los campos tardios no declara cambio', () => {
  assert.equal(contenidoQuoteCambio(cotizacion(), HUELLA_ANTES_DE_403, { listaId: 9, shipVia: 3 }), false);
  assert.equal(contenidoQuoteCambio({ ...cotizacion(), total: 99 }, HUELLA_ANTES_DE_403, { listaId: 9, shipVia: 3 }), true);
});

// #556: telefono y correo del Contacto de entrega entran al post-fix como filas de la
// tabla, pero su lugar en la huella sigue siendo el contactPhone/contactEmail del
// objeto base (#329). Capturada con el codigo de 532d3f83 (antes de #556) para una
// cotizacion con telefono y correo del Contacto de entrega: la de hoy sale identica y
// una cotizacion ya subida no se lee como cambiada.
const HUELLA_CON_CONTACTO_ENTREGA = '{"items":[{"stock_id":"CR20-PLATO","qty":10,"price":100,"Disc":0,"text":"Plato","editarDescripcion":false}],"custRef":"Pendulo","customerId":376,"deliverTo":"El Pendulo","deliveryAddress":"Av. Juarez 45, 56530","contactPhone":"+52 55 1111 2222","contactEmail":"recibe@cliente.test","comments":"- Precio sujeto a cambio","subtotal":1000,"iva":160,"total":1160,"listaId":"9","branchId":"412","shipVia":"3","vigencia":"2026-08-28"}';

test('#556 huellaContenidoQuote: con telefono y correo del Contacto de entrega sale byte-identica a la de antes de #556', () => {
  const c = cotizacion();
  c.cliente = { ...c.cliente, telefono: '5512345678', celEntrega: '+52 55 1111 2222', emailEntrega: 'recibe@cliente.test' };
  assert.equal(huellaContenidoQuote(c, { listaId: 9, shipVia: 3 }), HUELLA_CON_CONTACTO_ENTREGA);
  assert.equal(contenidoQuoteCambio(c, HUELLA_CON_CONTACTO_ENTREGA, { listaId: 9, shipVia: 3 }), false);
});

// D3b: sin calle el delivery_address del quote ahora empieza con "Por definir". Para una
// cotizacion ya subida SIN calle, su huella guardada (con el domicilio sin "Por
// definir") ya no coincide: es un cambio legitimo del quote, y la siguiente
// regeneracion lo reescribe. Con calle no cambia nada (las pruebas de arriba).
test('#557 D3b una cotizacion ya subida sin calle declara cambio: su domicilio en el quote pasa a "Por definir"', () => {
  const c = cotizacion();
  c.cliente = { ...c.cliente, calle: '' };
  const huellaAntesDeD3b = HUELLA_COMPLETA.replace('"deliveryAddress":"Av. Juarez 45, 56530"', '"deliveryAddress":"56530"');
  assert.equal(contenidoQuoteCambio(c, huellaAntesDeD3b, { listaId: 9, shipVia: 3 }), true);
  assert.match(huellaContenidoQuote(c, { listaId: 9, shipVia: 3 }), /"deliveryAddress":"Por definir, 56530"/);
});
