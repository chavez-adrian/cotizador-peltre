import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateQuoteHTML } from '../lib/html-generator.js';
import { generateQuotePDF } from '../lib/pdf-generator.js';
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
// === #302: layout movil (tarjetas por partida) en viewports de celular ===

test('#302.1: el HTML incluye el bloque @media screen and (max-width: 480px)', () => {
  const html = generateQuoteHTML({});
  assert.ok(html.includes('@media screen and (max-width: 480px)'), 'debe traer el bloque movil fijado por el spec');
});

test('#302.2: las partidas traen las etiquetas/clases que usa la tarjeta movil (con folio)', () => {
  const html = generateQuoteHTML({
    folio: '12345',
    items: [{ codigo: 'A001', descripcion: 'Item A', cantidad: 3, unidad: 'pza', precio: 100, descuento: 15 }],
  });
  assert.ok(html.includes('class="td-desc"'), 'la descripcion debe tener la clase que usa la tarjeta');
  assert.ok(html.includes('data-field="cant"'), 'falta el hook de cantidad');
  assert.ok(html.includes('data-field="precio"'), 'falta el hook de precio');
  assert.ok(html.includes('data-field="dscto"'), 'falta el hook de descuento');
  assert.ok(html.includes('data-field="total"'), 'falta el hook de total de linea');
});

test('#302.3: la pre-cotizacion (sin folio) recibe las mismas etiquetas/clases de tarjeta', () => {
  const html = generateQuoteHTML({
    items: [{ codigo: 'B002', descripcion: 'Item B', cantidad: 1, unidad: 'pza', precio: 200 }],
  });
  assert.ok(html.includes('class="td-desc"'), 'la descripcion debe tener la clase que usa la tarjeta');
  assert.ok(html.includes('data-field="cant"'), 'falta el hook de cantidad');
  assert.ok(html.includes('data-field="precio"'), 'falta el hook de precio');
  assert.ok(html.includes('data-field="total"'), 'falta el hook de total de linea');
});

test('#302.4: la variante con incluirFotos integra la imagen a la tarjeta sin perder las etiquetas', () => {
  const html = generateQuoteHTML({
    items: [{ codigo: 'PH20A3P32112', descripcion: 'Plato hondo 20', cantidad: 2, unidad: 'pza', precio: 150 }],
  }, { incluirFotos: true });
  assert.ok(html.includes('class="td-img"'), 'la celda de imagen debe estar presente en la variante con fotos');
  assert.ok(html.includes('class="product-img"'), 'la imagen del producto debe imprimirse');
  assert.ok(html.includes('data-field="cant"') && html.includes('data-field="total"'), 'la tarjeta sigue trayendo sus hooks con fotos');
});

// #326 reescribio el bloque print (geometria A4 del PDF), asi que la asercion
// ya no puede fijar su texto: lo que este test cuida es que la vista movil no
// se cuele en la impresion y viva despues y fuera de ella.
test('#302.5: @media print no hereda nada de la vista movil y las reglas moviles viven solo bajo @media screen', () => {
  const html = generateQuoteHTML({});
  const printBlock = bloqueCssPrint(html);
  assert.ok(printBlock.includes('.print-bar { display: none !important; }'), 'el bloque print debe seguir apagando la barra');
  assert.ok(!printBlock.includes('480px'), 'el bloque print no debe traer la guarda movil');
  assert.ok(!printBlock.includes('data-field'), 'el bloque print no debe traer selectores de la tarjeta movil');
  const idxPrint = html.indexOf(printBlock);
  const idxScreen = html.indexOf('@media screen and (max-width: 480px)');
  assert.ok(idxScreen > idxPrint + printBlock.length, 'el bloque movil vive despues y fuera del bloque print, no anidado');
});

// === #308: el boton de impresion del navegador se sustituye por un enlace al
// PDF real del servidor (el HTML y el PDF ya no pueden ser dos documentos
// distintos). El enlace usa el id interno (clave tecnica de URL, no el folio).

test('#308.1: con opts.id el HTML enlaza al PDF del server y ya no llama a la impresion del navegador', () => {
  const html = generateQuoteHTML({ folio: '12345' }, { id: 77 });
  assert.ok(html.includes('href="/api/cotizacion/pdf/77"'), 'debe enlazar al PDF regenerable del server con el id interno');
  assert.ok(html.includes('target="_blank"'), 'el PDF debe abrirse en pestana nueva');
  assert.ok(!html.includes('window.print'), 'ya no debe llamar a la impresion del navegador');
  assert.ok(!html.includes('Imprimir'), 'ya no debe existir el texto del boton de impresion');
});

test('#308.2: la pre-cotizacion (sin folio) tambien recibe el enlace al PDF con opts.id', () => {
  const html = generateQuoteHTML({}, { id: 88 });
  assert.ok(html.includes('href="/api/cotizacion/pdf/88"'), 'la pre-cotizacion tambien debe enlazar su PDF');
  assert.ok(html.includes('target="_blank"'));
});

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

// === #326: paridad del documento HTML con el formato oficial de Operam, en tres
// capas (contenido exacto / escritorio e impresion fieles / movil legible). La
// especificacion de referencia es lib/pdf-generator.js, ya calcado del PDF de
// Operam: las etiquetas, los colores y el esquema de bordes de abajo salen de
// ahi, no de lo que el HTML construya.

// Lo que el cliente LEE: sin CSS, sin etiquetas de marcado y con las entidades
// resueltas. Los tags se borran sin meter espacio a proposito, para que un
// <br> dentro de una etiqueta ("Codigo de<br>Articulo") no pase por buena.
function textoDelDocumento(html) {
  const ENTIDADES = {
    '&oacute;': '\u00f3', '&eacute;': '\u00e9', '&iacute;': '\u00ed',
    '&aacute;': '\u00e1', '&uacute;': '\u00fa', '&ntilde;': '\u00f1',
    '&ordm;': '\u00ba', '&quot;': '"', '&lt;': '<', '&gt;': '>', '&amp;': '&',
  };
  let texto = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]*>/g, '');
  for (const [entidad, caracter] of Object.entries(ENTIDADES)) {
    texto = texto.split(entidad).join(caracter);
  }
  return texto;
}

const CLIENTE_REALISTA = {
  razonSocial: 'DISTRIBUIDORA LA ANTIGUA SA DE CV',
  rfc: 'DAN150220QX3',
  cpFiscal: '56577',
  nombreEntrega: 'Almacen Centro',
  calle: 'Av. Insurgentes Sur 1234',
  colonia: 'Del Valle',
  cpEntrega: '03100',
  municipio: 'Benito Juarez',
  estado: 'CDMX',
  celEntrega: '55 1234 5678',
  emailEntrega: 'compras@laantigua.mx',
};

function documentoRealista(extra = {}) {
  return generateQuoteHTML({
    folio: '1210',
    fecha: '2026-09-04',
    vigencia: '2026-10-04',
    vendedor: 'Adrian Chavez',
    condicionesPago: 'Pago de contado',
    cliente: CLIENTE_REALISTA,
    items: [
      { codigo: 'PH20A3P32112', descripcion: 'Plato hondo 20 cm', cantidad: 12, unidad: 'pza', precio: 78.5 },
    ],
    notas: ['Precios sujetos a cambio sin previo aviso'],
    subtotal: 942, iva: 150.72, total: 1092.72,
    ...extra,
  });
}

test('#326.1: las etiquetas del documento son las del formato oficial de Operam, con su ortografia medida', () => {
  const texto = textoDelDocumento(documentoRealista());
  const etiquetas = [
    'N\u00ba Cotizaci\u00f3n:',
    'Datos de Facturaci\u00f3n:',
    'Direcci\u00f3n:',
    'Tel\u00e9fono:',
    'Correo:',
    'Entregar a:',
    'Referencia Cliente:',
    'T\u00e9rminos de Pago:',
    'C\u00f3digo de Art\u00edculo',
    'Descripci\u00f3n del Art\u00edculo',
    'Referencia del Cliente',
    'Representante de Ventas',
    'I.V.A. 16% (16%)',
    'Todas las cantidades se indican en - MXN',
  ];
  for (const etiqueta of etiquetas) {
    assert.ok(texto.includes(etiqueta), `falta la etiqueta exacta "${etiqueta}"`);
  }
});

test('#326.2: las etiquetas que Operam trae SIN acento tampoco lo llevan en el HTML', () => {
  const texto = textoDelDocumento(documentoRealista());
  assert.ok(texto.includes('COTIZACION'), 'el titulo va sin acento, como Operam');
  assert.ok(texto.includes('Valido hasta'), '"Valido hasta" va sin acento');
  assert.ok(texto.includes('Datos de entrega'), '"Datos de entrega" va sin acento y sin dos puntos');
  assert.ok(!texto.includes('COTIZACI\u00d3N'), 'el titulo acentuado no es el del formato oficial');
  assert.ok(!texto.includes('V\u00e1lido hasta'), '"Valido hasta" acentuado no es el del formato oficial');
});

// El CSS embebido es parte de la cadena que el generador entrega: el color y el
// borde con que sale el documento son comportamiento externo, no un interno.
// Los valores esperados son los medidos del formato oficial (lib/pdf-generator.js:
// GRIS_TITULO #CCCCCC, ROJO_FOLIO #FF0000, GRIS_LINEA #808080, GRIS_CAJA #DDDDDD).
function reglaCss(html, selector) {
  const estilos = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const inicio = estilos.indexOf(`\n${selector} {`);
  assert.notEqual(inicio, -1, `no existe la regla CSS "${selector}"`);
  const abre = estilos.indexOf('{', inicio);
  return estilos.slice(abre + 1, estilos.indexOf('}', abre)).trim();
}

test('#326.3: el titulo y el folio usan los colores medidos del formato oficial', () => {
  const html = documentoRealista();
  assert.match(reglaCss(html, '.quote-block h2'), /color: #CCCCCC/, 'el titulo va en el gris medido, no en un gris a ojo');
  assert.match(reglaCss(html, '.quote-num'), /color: #FF0000/, 'el folio va en rojo puro, como Operam');
  assert.ok(!html.includes('#CC0000'), 'el rojo aproximado anterior ya no se usa en ninguna capa');
  assert.ok(!html.includes('color: #aaa'), 'el gris aproximado anterior ya no se usa');
});

test('#326.4: las tablas no llevan lineas verticales: regla negra bajo los encabezados y separadores grises entre filas', () => {
  const html = documentoRealista();
  for (const selector of ['.comercial-table th', 'table.products th']) {
    const regla = reglaCss(html, selector);
    assert.match(regla, /border-bottom: 1px solid #000000/, `${selector} debe cerrar con la regla negra del formato oficial`);
    assert.ok(!/border-left|border-right|border: /.test(regla), `${selector} no puede dibujar lineas verticales`);
    assert.ok(!regla.includes('background'), `${selector} no lleva fondo gris: el formato oficial no lo tiene`);
  }
  for (const selector of ['.comercial-table td', 'table.products td']) {
    const regla = reglaCss(html, selector);
    assert.match(regla, /border-bottom: 1px solid #808080/, `${selector} separa filas con el gris medido`);
    assert.ok(!/border-left|border-right|border: /.test(regla), `${selector} no puede dibujar lineas verticales`);
  }
});

test('#326.5: la tabla de referencia y la de partidas van en cajas de solo trazo gris', () => {
  const html = documentoRealista();
  assert.match(reglaCss(html, '.ref-box'), /border: 1px solid #DDDDDD/, 'la tabla de referencia vive dentro de su caja gris');
  assert.match(reglaCss(html, '.products-box'), /border: 1px solid #DDDDDD/, 'la caja de partidas usa el gris medido, no un gris a ojo');
  const caja = html.indexOf('<div class="ref-box">');
  const tabla = html.indexOf('<table class="comercial-table">');
  assert.ok(caja !== -1 && caja < tabla, 'la caja abre antes de la tabla de referencia');
  const cierre = html.indexOf('</table>', tabla);
  assert.ok(html.indexOf('</div>', cierre) !== -1, 'la caja cierra despues de la tabla de referencia');
  // La caja de partidas envuelve tambien notas y totales, como en el PDF.
  const cajaItems = html.indexOf('<div class="products-box">');
  assert.ok(cajaItems < html.indexOf('class="bottom-section"'), 'las notas y los totales quedan dentro de la caja de partidas');
});

function reglaCssMovil(html, selector) {
  const movil = html.slice(html.indexOf('@media screen and (max-width: 480px)'), html.indexOf('</style>'));
  const inicio = movil.indexOf(`\n  ${selector} {`);
  assert.notEqual(inicio, -1, `no existe la regla movil "${selector}"`);
  const abre = movil.indexOf('{', inicio);
  return movil.slice(abre + 1, movil.indexOf('}', abre)).trim();
}

// Capa 3 (<=480px): manda la legibilidad. El reflow de tarjetas de #302 se
// conserva; lo que se alinea es el lenguaje visual (la caja de trazo no aporta
// nada cuando la tabla ya es una lista, y el centrado del formato oficial
// estorba en una columna angosta).
test('#326.6: en telefono el reflow existente se conserva y el texto vuelve a la izquierda', () => {
  const html = documentoRealista();
  assert.ok(html.includes('@media screen and (max-width: 480px)'), 'el bloque movil sigue existiendo');
  assert.match(reglaCssMovil(html, '.ref-box'), /border: none/, 'la caja de la tabla de referencia no se dibuja en telefono');
  assert.match(reglaCssMovil(html, '.products-box'), /border: none/, 'la caja de partidas sigue sin dibujarse en telefono');
  assert.match(reglaCssMovil(html, '.comercial-table td'), /text-align: left/, 'los pares etiqueta:valor se leen alineados a la izquierda');
  assert.match(reglaCssMovil(html, 'table.products td'), /text-align: left/, 'la tarjeta de la partida se lee alineada a la izquierda');
  assert.ok(html.includes('data-field="total"'), 'los hooks de la tarjeta movil siguen intactos');
});

// El formato oficial esta tipografiado en Helvetica a 20pt (titulo), 7.5pt
// (cuerpo y tablas), 7.3pt (empresa y datos del cliente) y 6pt (paginacion).
// A 96 dpi un punto son 4/3 de pixel, asi que la traduccion fluida de esas
// medidas es 26.7px / 10px / 9.7px / 8px.
test('#326.7: la tipografia del documento traduce las medidas del formato oficial', () => {
  const html = documentoRealista();
  const body = reglaCss(html, 'body');
  assert.match(body, /font-family: Helvetica, Arial, sans-serif/, 'Helvetica es la primera familia, como el formato oficial');
  assert.match(body, /font-size: 10px/, '7.5pt de cuerpo = 10px');
  assert.match(reglaCss(html, '.quote-block h2'), /font-size: 26.7px/, '20pt de titulo = 26.7px');
  assert.match(reglaCss(html, '.page-num'), /font-size: 8px/, '6pt de paginacion = 8px');
  assert.match(reglaCss(html, '.company-info'), /font-size: 9.7px/, '7.3pt de los datos de la empresa = 9.7px');
  assert.match(reglaCss(html, '.footer'), /font-size: 10px/, 'el pie va al mismo cuerpo que las tablas');
  assert.ok(!html.includes('font-family: monospace'), 'el codigo de articulo va en la tipografia del documento, no en monoespaciada');
});

test('#326.8: el texto del documento va en negro, como el formato oficial', () => {
  const html = documentoRealista();
  for (const selector of ['body', '.company-info', '.section-title', '.client-block p', '.notes-block li', '.footer', '.page-num']) {
    assert.match(reglaCss(html, selector), /color: #000000/, `${selector} debe ir en negro`);
  }
});

test('#326.9: las secciones se separan con la regla negra y no se inventan bordes que el formato oficial no trae', () => {
  const html = documentoRealista();
  assert.match(reglaCss(html, '.header'), /border-bottom: 1px solid #000000/, 'la regla bajo el encabezado es negra');
  assert.match(reglaCss(html, '.client-section'), /border-bottom: 1px solid #000000/, 'la regla bajo los domicilios es negra');
  assert.ok(!reglaCss(html, '.footer').includes('border-top'), 'el formato oficial no traza ninguna regla sobre el pie');
  assert.ok(!reglaCss(html, '.totals-table td').includes('border'), 'los totales no llevan lineas propias');
  assert.ok(!reglaCss(html, '.totals-table tr.total-row td').includes('border'), 'el TOTAL se distingue por el texto en negritas, no por un borde');
  assert.match(reglaCss(html, '.totals-table tr.total-row td'), /font-weight: 700/, 'el TOTAL sigue en negritas, como en el PDF');
});

test('#326.10: las notas se marcan con el guion del formato oficial, no con vinetas', () => {
  const html = documentoRealista({ notas: ['Precios sujetos a cambio sin previo aviso', 'Entrega en 10 dias habiles'] });
  assert.match(reglaCss(html, '.notes-block ul'), /list-style: none/, 'sin vinetas de disco');
  assert.match(reglaCss(html, '.notes-block li::before'), /content: "- "/, 'cada nota abre con el guion que imprime el PDF');
  const texto = textoDelDocumento(html);
  assert.ok(texto.includes('Entrega en 10 dias habiles'), 'el texto de la nota se conserva intacto');
});

// Redondeo COMERCIAL de presentacion (decision de producto 2026-09-04): la
// linea se lee a 2 decimales, pero el total sigue saliendo de la matematica a
// precision completa. Con tres partidas de 33.333333 la suma de lo IMPRESO
// (99.99) y el subtotal real (99.999999 -> 100.00) no coinciden: el documento
// tiene que imprimir el segundo, que es el que cobra la factura.
const DATOS_TERCIOS = {
  items: [
    { codigo: 'A001', descripcion: 'Tercio A', cantidad: 1, unidad: 'pza', precio: 33.333333 },
    { codigo: 'A002', descripcion: 'Tercio B', cantidad: 1, unidad: 'pza', precio: 33.333333 },
    { codigo: 'A003', descripcion: 'Tercio C', cantidad: 1, unidad: 'pza', precio: 33.333333 },
  ],
  subtotal: 99.999999, iva: 16, total: 115.999999,
};

test('#326.11: precio y total de linea salen a 2 decimales y el total del documento sigue a precision completa', () => {
  const html = generateQuoteHTML(DATOS_TERCIOS);
  assert.ok(html.includes('>33.33<'), 'el precio unitario se lee a 2 decimales');
  assert.ok(!html.includes('33.333333'), 'el documento no le muestra al cliente la precision interna');
  assert.ok(html.includes('<strong>33.33</strong>'), 'el total de linea se lee a 2 decimales');
  assert.ok(html.includes('100.00'), 'el subtotal es el de precision completa redondeado al centavo');
  assert.ok(!html.includes('99.99'), 'nunca la suma de los importes ya redondeados');
  assert.ok(html.includes('116.00'), 'el TOTAL tambien sale del importe a precision completa');
});

test('#326.12: el HTML y el PDF del mismo carrito imprimen el mismo importe al centavo', async () => {
  const html = generateQuoteHTML(DATOS_TERCIOS);
  const pdf = (await generateQuotePDF({ ...DATOS_TERCIOS, _compress: false })).toString('latin1');
  const hex = (s) => Buffer.from(s, 'latin1').toString('hex');
  for (const importe of ['33.33', '100.00', '116.00']) {
    assert.ok(html.includes(importe), `el HTML debe imprimir ${importe}`);
    assert.ok(pdf.includes(hex(importe)), `el PDF debe imprimir el mismo ${importe}`);
  }
  assert.ok(!pdf.includes(hex('99.99')), 'el PDF tampoco suma los importes redondeados');
});

function bloqueCssPrint(html) {
  const estilos = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const inicio = estilos.indexOf('@media print {');
  assert.notEqual(inicio, -1, 'no existe el bloque @media print');
  let nivel = 0;
  for (let i = estilos.indexOf('{', inicio); i < estilos.length; i++) {
    if (estilos[i] === '{') nivel++;
    else if (estilos[i] === '}' && --nivel === 0) return estilos.slice(inicio, i + 1);
  }
  throw new Error('el bloque @media print no cierra');
}

// La hoja del formato oficial es A4 (595.28 x 841.89 pt) con margen 22.7pt: a
// 96 dpi son 794px de ancho y 30px de margen. En impresion la geometria la fija
// @page, que es lo unico que puede acercar la liga al PDF de verdad.
test('#326.13: la hoja del documento tiene el tamano y los margenes del formato oficial', () => {
  const html = documentoRealista();
  const pagina = reglaCss(html, '.page');
  assert.match(pagina, /max-width: 794px/, 'el ancho de la hoja es el de A4, no un contenedor a ojo');
  assert.match(pagina, /padding: 30px/, 'el margen interior es el 22.7pt del formato oficial');
  const print = bloqueCssPrint(html);
  assert.match(print, /@page \{ size: A4; margin: 8mm; \}/, 'al imprimir manda la geometria A4 del PDF');
  assert.ok(print.includes('.print-bar { display: none !important; }'), 'la barra de la liga no se imprime');
  assert.ok(!print.includes('480px') && !print.includes('data-field'), 'el bloque print no hereda nada de la vista movil');
});

// Anchos de columna del formato oficial, sobre los 545.8pt utiles de la caja:
// referencia = cinco columnas iguales (110pt); partidas = 54.6pt por columna y
// 218.3pt para Descripcion, es decir 10% y 40%. Con la columna Foto (54.6pt
// tambien) la que cede es Descripcion, que baja a 163.7pt = 30%.
function colgroupDe(html, desde) {
  const inicio = html.indexOf('<colgroup>', html.indexOf(desde));
  assert.notEqual(inicio, -1, `no hay colgroup tras "${desde}"`);
  const bloque = html.slice(inicio, html.indexOf('</colgroup>', inicio));
  return [...bloque.matchAll(/width:\s*([\d.]+)%/g)].map((m) => Number(m[1]));
}

test('#326.14: las columnas de las dos tablas guardan la proporcion del formato oficial', () => {
  const html = documentoRealista();
  assert.deepEqual(colgroupDe(html, '<table class="comercial-table">'), [20, 20, 20, 20, 20], 'la tabla de referencia son cinco columnas iguales');
  assert.deepEqual(colgroupDe(html, '<table class="products">'), [10, 40, 10, 10, 10, 10, 10], 'en partidas solo Descripcion es ancha');
  const conFotos = generateQuoteHTML({
    items: [{ codigo: 'PH20A3P32112', descripcion: 'Plato hondo 20', cantidad: 2, unidad: 'pza', precio: 150 }],
  }, { incluirFotos: true });
  assert.deepEqual(colgroupDe(conFotos, '<table class="products">'), [10, 10, 30, 10, 10, 10, 10, 10], 'la columna Foto le quita ancho a Descripcion, no al resto');
});
