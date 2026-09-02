import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateQuoteHTML } from '../lib/html-generator.js';
import { referenciaDelCliente } from '../lib/referencia-cliente.js';

test('1. generateQuoteHTML({}) returns a string containing "COTIZACION"', () => {
  const html = generateQuoteHTML({});
  assert.ok(typeof html === 'string', 'should return a string');
  assert.ok(html.includes('COTIZACION'), 'should contain "COTIZACION"');
});

test('2. HTML includes company RFC "PNA170810CF1" and phone number', () => {
  const html = generateQuoteHTML({});
  assert.ok(html.includes('PNA170810CF1'), 'should contain RFC PNA170810CF1');
  assert.ok(html.includes('(55)43976785') || html.includes('(55) 4397 6785') || html.includes('5543976785'), 'should contain phone (55)43976785');
});

test('3. Tabla comercial includes all 5 headers', () => {
  const html = generateQuoteHTML({});
  assert.ok(html.includes('Referencia del Cliente'), 'should contain "Referencia del Cliente"');
  assert.ok(html.includes('Representante de Ventas'), 'should contain "Representante de Ventas"');
  assert.ok(html.includes('R.F.C.'), 'should contain "R.F.C."');
  assert.ok(html.includes('Cotizaci'), 'should contain "Nº Cotización"');
  assert.ok(html.includes('Valido hasta'), 'should contain "Valido hasta"');
});

// #241: misma cadena que el quote de Operam (lib/referencia-cliente.js). Las
// aserciones se anclan a la CELDA de la tabla comercial: el nombre de entrega y la
// razon social tambien salen en otros bloques del documento, asi que un
// includes() suelto pasaria aunque la celda quedara vacia (leccion de #36).
function celdaReferenciaComercial(html) {
  const tbody = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
  const celda = tbody.match(/<td>([^<]*)<\/td>/);
  return celda ? celda[1] : null;
}

test('3b. (#241) sin referencia ni nombreCorto la Referencia del Cliente cae a nombreEntrega', () => {
  const html = generateQuoteHTML({
    cliente: { nombreEntrega: 'Almacen Roma', razonSocial: 'EL PENDULO SA DE CV' },
  });
  assert.equal(celdaReferenciaComercial(html), 'Almacen Roma');
  assert.ok(html.includes('Referencia Cliente:</span>Almacen Roma'), 'tambien en el bloque del cliente');
});

test('3c. (#241) razonSocial es el ultimo escalon de la Referencia del Cliente', () => {
  const html = generateQuoteHTML({ cliente: { razonSocial: 'EL PENDULO SA DE CV' } });
  assert.equal(celdaReferenciaComercial(html), 'El Pendulo SA de CV');
});

test('3d. (#241) sin ningun dato del cliente la celda de Referencia queda vacia', () => {
  assert.equal(celdaReferenciaComercial(generateQuoteHTML({ cliente: {} })), '');
});

// Paridad exacta con el quote (#241): el documento corta donde corta Operam. Con
// el truncado solo del lado del quote, una razon social mexicana tipica (>60) salia
// completa en el documento y cortada en el ERP.
test('3e. (#241) el documento trunca a 60 igual que el cust_ref del quote', () => {
  const cliente = { razonSocial: 'COMERCIALIZADORA DE PRODUCTOS ALIMENTICIOS DEL BAJIO SA DE CV' };
  const celda = celdaReferenciaComercial(generateQuoteHTML({ cliente }));
  assert.equal(celda.length, 60);
  assert.equal(celda, referenciaDelCliente(cliente), 'documento y quote salen del mismo nucleo');
});


test('4. "Terminos de Pago" appears as text outside the products table', () => {
  const html = generateQuoteHTML({ condicionesPago: '30 dias' });
  assert.ok(html.includes('rminos de Pago'), 'should contain "Terminos de Pago"');
  assert.ok(html.includes('30 dias'), 'should contain the payment condition value');
});

test('5. Product table quantity header is "Ctdad" not "Cant."', () => {
  const html = generateQuoteHTML({});
  assert.ok(html.includes('Ctdad'), 'should contain "Ctdad"');
  assert.ok(!html.includes('Cant.'), 'should NOT contain "Cant."');
});

test('6. Sub-Total [N] uses sum of quantities, not item count', () => {
  const html = generateQuoteHTML({
    items: [
      { codigo: 'A001', descripcion: 'Item A', cantidad: 3, precio: 100 },
      { codigo: 'B002', descripcion: 'Item B', cantidad: 2, precio: 200 },
    ],
  });
  assert.ok(html.includes('Sub-Total [5]'), 'should contain "Sub-Total [5]" (3+2=5)');
  assert.ok(!html.includes('Sub-Total [2]'), 'should NOT contain "Sub-Total [2]" (item count)');
});

test('7. Footer contains bank info: "Banco: Banorte" and CLABE', () => {
  const html = generateQuoteHTML({});
  assert.ok(html.includes('Banco: Banorte'), 'should contain "Banco: Banorte"');
  assert.ok(html.includes('002180700947054340'), 'should contain CLABE 002180700947054340');
});

test('8. Header shows company email, not website URL', () => {
  const html = generateQuoteHTML({});
  assert.ok(html.includes('contacto@pppeltre.mx'), 'should show email contacto@pppeltre.mx');
  assert.ok(!html.includes('e-Mail: www.'), 'should NOT show website URL as e-Mail');
});

// #136: la descripcion literal de la partida ENVIO (servicio + "entrega
// estimada" + tiempo, literales de envia.com) llega intacta al HTML -- string
// crudo, sin conversion a bytes, por eso se compara tal cual (acentos y
// em-dash incluidos).
test('9. (#136) la partida ENVIO imprime la descripcion literal con tiempo de entrega', () => {
  const html = generateQuoteHTML({
    items: [{
      codigo: 'ENVIO',
      descripcion: 'FedEx Nacional Económico — entrega estimada 1-2 días hábiles',
      cantidad: 1, unidad: 'ACT', precio: 259,
    }],
  });
  assert.ok(html.includes('FedEx Nacional Económico — entrega estimada 1-2 días hábiles'));
});

test('9. Logo img tag is embedded as data URL (works in blob context)', () => {
  const html = generateQuoteHTML({});
  assert.ok(html.includes('data:image/png;base64,'), 'logo should be embedded as base64 data URL');
});

test('10. Datos de Facturacion shows cpFiscal when provided', () => {
  const html = generateQuoteHTML({ cliente: { razonSocial: 'Test SA', rfc: 'TST010101AAA', cpFiscal: '06600' } });
  assert.ok(html.includes('06600'), 'cpFiscal should appear in billing section');
});

test('11. Datos de entrega shows celEntrega and emailEntrega on same line (formato Operam)', () => {
  const html = generateQuoteHTML({
    cliente: { celEntrega: '55 1234 5678', emailEntrega: 'cliente@test.com' },
  });
  assert.ok(html.includes('55 1234 5678'), 'celEntrega should appear');
  assert.ok(html.includes('cliente@test.com'), 'emailEntrega should appear');
  // Telefono y Correo deben aparecer en el mismo bloque de linea (formato Operam)
  assert.ok(html.includes('fono:'), 'should have Telefono/Teléfono label');
  assert.ok(html.includes('Correo:'), 'should have Correo label');
});

test('12. Numeric product columns use class="num" for right-alignment', () => {
  const html = generateQuoteHTML({
    items: [{ codigo: 'A001', descripcion: 'Item', cantidad: 5, unidad: 'pza', precio: 100, descuento: 0 }],
  });
  assert.ok(html.includes('class="num"'), 'numeric cells should have class="num"');
  assert.ok(html.includes('td-code'), 'codigo column should have class td-code');
});

test('13. Total row has class total-row for bold styling', () => {
  const html = generateQuoteHTML({ subtotal: 100, iva: 16, total: 116 });
  assert.ok(html.includes('class="total-row"'), 'TOTAL row should have class total-row');
  assert.ok(html.includes('>TOTAL<'), 'TOTAL label should be present');
});

test('14. (#71 AC1) leyendaDomicilio se pinta en datos de entrega cuando esta presente', () => {
  const html = generateQuoteHTML({ cliente: { cpEntrega: '06600', leyendaDomicilio: 'Favor de confirmar el domicilio de entrega' } });
  assert.ok(html.includes('Favor de confirmar el domicilio de entrega'), 'should contain la leyenda de domicilio');
});

test('15. (#71 AC1) sin leyendaDomicilio no se inventa la leyenda', () => {
  const html = generateQuoteHTML({ cliente: { calle: 'Reforma 100', cpEntrega: '06600' } });
  assert.ok(!html.includes('Favor de confirmar el domicilio de entrega'), 'should NOT contain la leyenda cuando hay calle');
});

// === #84 AC4: entrega ausente/parcial/completa, sin secciones vacias ni "undefined" ===

test('16. (#84) entrega totalmente ausente -> HTML sin "undefined", con la leyenda', () => {
  const html = generateQuoteHTML({ cliente: { razonSocial: 'Cliente Test', leyendaDomicilio: 'Favor de confirmar el domicilio de entrega' } });
  assert.ok(!html.includes('undefined'), 'no debe imprimir "undefined"');
  assert.ok(html.includes('Favor de confirmar el domicilio de entrega'), 'debe traer la leyenda de confirmacion');
});

test('17. (#84) entrega parcial (solo CP) -> muestra el CP y la leyenda, sin "undefined"', () => {
  const html = generateQuoteHTML({ cliente: { cpEntrega: '06600', leyendaDomicilio: 'Favor de confirmar el domicilio de entrega' } });
  assert.ok(html.includes('06600'), 'debe mostrar el CP capturado');
  assert.ok(html.includes('Favor de confirmar el domicilio de entrega'), 'debe traer la leyenda de confirmacion');
  assert.ok(!html.includes('undefined'), 'no debe imprimir "undefined"');
});

test('18. (#84) entrega parcial (solo ciudad/municipio) -> muestra el municipio y la leyenda', () => {
  const html = generateQuoteHTML({ cliente: { municipio: 'Puebla', leyendaDomicilio: 'Favor de confirmar el domicilio de entrega' } });
  assert.ok(html.includes('Puebla'), 'debe mostrar el municipio capturado');
  assert.ok(html.includes('Favor de confirmar el domicilio de entrega'), 'debe traer la leyenda de confirmacion');
  assert.ok(!html.includes('undefined'), 'no debe imprimir "undefined"');
});

test('19. (#84) entrega completa -> no imprime la leyenda de confirmacion', () => {
  const html = generateQuoteHTML({ cliente: { calle: 'Reforma 100', cpEntrega: '06600', municipio: 'CDMX', leyendaDomicilio: '' } });
  assert.ok(!html.includes('Favor de confirmar el domicilio de entrega'), 'no debe traer la leyenda cuando la entrega esta completa');
  assert.ok(!html.includes('undefined'), 'no debe imprimir "undefined"');
});

// === #137: descuento comercial por linea (columna "% Dscto." + total neto) ===
// Se evitan descuentos que terminen en 0 (10%, 50%, etc.): "10%" contiene "0%"
// como subcadena, lo que arruinaria la aseveracion de ausencia de descuento en
// la linea sin descontar (y ">0%<" tambien evita el falso positivo de
// "width: 100%;" en el CSS embebido). 15% y 75% no tienen ese problema.
// Cantidades > 1 en todas las lineas para que bruto, precio unitario y neto
// sean tres numeros distintos entre si.

test('20. (#137) el HTML imprime el % Dscto. por linea y lo omite (celda vacia) cuando es 0', () => {
  const html = generateQuoteHTML({
    items: [
      { codigo: 'A001', descripcion: 'Item con descuento', cantidad: 3, unidad: 'pza', precio: 100, descuento: 15 },
      { codigo: 'B002', descripcion: 'Item sin descuento', cantidad: 2, unidad: 'pza', precio: 200, descuento: 0 },
      { codigo: 'ENVIO', descripcion: 'FedEx Nacional', cantidad: 2, unidad: 'ACT', precio: 259, descuento: 75 },
    ],
  });
  assert.ok(html.includes('>15%<'), 'debe imprimir el 15% de descuento del articulo A001');
  assert.ok(html.includes('>75%<'), 'debe imprimir el 75% de descuento de la partida ENVIO');
  assert.ok(!html.includes('>0%<'), 'no debe imprimir "0%" en la linea sin descuento (B002); la celda va vacia');
});

test('21. (#137) el total de linea es el neto cantidad*precio*(1-descuento/100), no el bruto', () => {
  const html = generateQuoteHTML({
    items: [
      { codigo: 'A001', descripcion: 'Item con descuento', cantidad: 3, unidad: 'pza', precio: 100, descuento: 15 },
      { codigo: 'ENVIO', descripcion: 'FedEx Nacional', cantidad: 2, unidad: 'ACT', precio: 259, descuento: 75 },
    ],
  });
  // A001: 3*100*0.85 = 255.00 (bruto seria 300.00)
  assert.ok(html.includes('<strong>255.00</strong>'), 'el total de A001 debe ser el neto 255.00');
  assert.ok(!html.includes('<strong>300.00</strong>'), 'no debe imprimir el bruto 300.00 de A001');
  // ENVIO: 2*259*0.25 = 129.50 (bruto seria 518.00; el precio unitario 259.00 si debe seguir apareciendo)
  assert.ok(html.includes('<strong>129.50</strong>'), 'el total de ENVIO debe ser el neto 129.50');
  assert.ok(!html.includes('<strong>518.00</strong>'), 'no debe imprimir el bruto 518.00 de ENVIO');
  assert.ok(html.includes('259.00'), 'el precio unitario de ENVIO debe seguir imprimiendose sin descontar');
});

// === #139: la descripcion que escribio el vendedor es la que lee el cliente ===
// El documento imprime lo capturado, no el nombre del catalogo: es el punto entero
// del ticket (el texto del catalogo a veces no le dice nada al cliente).
test('22. (#139) el HTML imprime la descripcion editada de la partida', () => {
  const html = generateQuoteHTML({
    items: [
      { codigo: 'A001', descripcion: 'Olla 20 cm esmaltada a mano, borde reforzado', descripcionEditada: true, cantidad: 2, unidad: 'pza', precio: 100 },
    ],
  });
  assert.ok(html.includes('Olla 20 cm esmaltada a mano, borde reforzado'));
});

// #220: el documento regenerado desde `data` tiene que distinguir dos diseños de
// calca del mismo codigo (spec #218). Una fila por partida, cada una con su texto.
test('#220: dos disenos del mismo codigo pintan dos filas con su propio texto', () => {
  const html = generateQuoteHTML({
    items: [
      { codigo: 'VA08B1A321124', descripcion: 'Vaso peltre', cantidad: 200, precio: 50 },
      { codigo: 'CAL1025S', descripcion: 'Calca chica - Diseño 1', cantidad: 100, precio: 26.9, diseno: 1 },
      { codigo: 'CAL1025S', descripcion: 'Calca chica - Diseño 2', cantidad: 120, precio: 26.9, diseno: 2 },
    ],
  });
  assert.ok(html.includes('Diseño 1'), 'falta el texto del primer diseno');
  assert.ok(html.includes('Diseño 2'), 'falta el texto del segundo diseno');
  const filasCalca = html.split('CAL1025S').length - 1;
  assert.strictEqual(filasCalca, 2, 'las dos partidas del mismo codigo no pueden fusionarse en una fila');
  assert.ok(html.includes('Sub-Total [420]'), '200 + 100 + 120 piezas');
});

// #284: el fallback de la fecha del documento tenia el mismo defecto UTC que el
// del quote. De 18:00 a 23:59 hora del centro el documento imprimia la fecha de
// manana. Instante de la evidencia del issue: 2026-09-01 19:07 GMT-0600.
test('#284: sin data.fecha el documento imprime la fecha del centro de Mexico, no la de UTC', () => {
  const DateReal = globalThis.Date;
  const fijo = new DateReal('2026-09-02T01:07:48Z').getTime();
  globalThis.Date = class extends DateReal {
    constructor(...args) { if (args.length === 0) super(fijo); else super(...args); }
    static now() { return fijo; }
  };
  let html;
  try { html = generateQuoteHTML({}); } finally { globalThis.Date = DateReal; }
  assert.ok(html.includes('>2026-09-01<'), 'la celda Fecha lleva la fecha local del vendedor');
  assert.ok(!html.includes('>2026-09-02<'), 'nunca la fecha UTC de manana');
});
