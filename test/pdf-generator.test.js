import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateQuotePDF } from '../lib/pdf-generator.js';

// PDFKit encodes strings as hex in TJ operators with kerning splits.
// _compress:false disables FlateDecode so the content stream is human-readable.
// Use toHex() to convert literal strings to searchable hex substrings.
function toHex(s) {
  return Buffer.from(s, 'latin1').toString('hex');
}

test('B1: generateQuotePDF retorna un Buffer', async () => {
  const result = await generateQuotePDF({});
  assert.ok(Buffer.isBuffer(result));
  assert.ok(result.length > 0);
});

test('B2: el buffer es un PDF valido (empieza con %PDF)', async () => {
  const result = await generateQuotePDF({});
  assert.equal(result.slice(0, 4).toString(), '%PDF');
});

test('B3: el PDF contiene el texto COTIZACION', async () => {
  const result = await generateQuotePDF({ _compress: false });
  const text = result.toString('latin1');
  // PDFKit kern-splits COTIZACION; TIZA and CION are reliable contiguous chunks
  const found = text.includes(toHex('TIZA')) || text.includes(toHex('CION'));
  assert.ok(found, 'No encontrado "COTIZACION" en el PDF');
});

test('B4: el PDF contiene RFC de la empresa PNA170810CF1', async () => {
  const result = await generateQuotePDF({ _compress: false, cliente: {} });
  const text = result.toString('latin1');
  // PNA170810CF1 is alphanumeric — stored as one contiguous hex block
  assert.ok(text.includes(toHex('PNA170810CF1')), 'RFC no encontrado en el PDF');
});

test('B5: el PDF contiene datos bancarios de Banorte', async () => {
  const result = await generateQuotePDF({ _compress: false });
  const text = result.toString('latin1');
  // PDFKit kern-splits "Banorte" between 'r' and 't'; "Banor" is a reliable prefix
  assert.ok(text.includes(toHex('Banor')), '"Banorte" no encontrado en el PDF');
});

test('B6: (#71 AC1) el PDF pinta leyendaDomicilio cuando esta presente', async () => {
  const result = await generateQuotePDF({
    _compress: false,
    cliente: { cpEntrega: '06600', leyendaDomicilio: 'Favor de confirmar el domicilio de entrega' },
  });
  const text = result.toString('latin1');
  // PDFKit kern-splittea "confirmar"; "domicilio" es una palabra contigua fiable de la leyenda
  assert.ok(text.includes(toHex('domicilio')), 'leyenda de domicilio no encontrada en el PDF');
});

// === #84 AC4: entrega ausente/parcial/completa, sin secciones vacias ni "undefined" ===

test('B7: (#84) entrega totalmente ausente -> PDF sin "undefined", con la leyenda', async () => {
  const result = await generateQuotePDF({
    _compress: false,
    cliente: { razonSocial: 'Cliente Test', leyendaDomicilio: 'Favor de confirmar el domicilio de entrega' },
  });
  const text = result.toString('latin1');
  assert.ok(!text.includes(toHex('undefined')), 'no debe imprimir "undefined"');
  assert.ok(text.includes(toHex('domicilio')), 'debe traer la leyenda de confirmacion');
});

test('B8: (#84) entrega parcial (solo CP) -> muestra el CP y la leyenda, sin "undefined"', async () => {
  const result = await generateQuotePDF({
    _compress: false,
    cliente: { cpEntrega: '06600', leyendaDomicilio: 'Favor de confirmar el domicilio de entrega' },
  });
  const text = result.toString('latin1');
  assert.ok(text.includes(toHex('06600')), 'debe mostrar el CP capturado');
  assert.ok(text.includes(toHex('domicilio')), 'debe traer la leyenda de confirmacion');
  assert.ok(!text.includes(toHex('undefined')), 'no debe imprimir "undefined"');
});

test('B9: (#84) entrega parcial (solo ciudad/municipio) -> muestra el municipio y la leyenda', async () => {
  const result = await generateQuotePDF({
    _compress: false,
    cliente: { municipio: 'Puebla', leyendaDomicilio: 'Favor de confirmar el domicilio de entrega' },
  });
  const text = result.toString('latin1');
  // PDFKit kern-splits "Puebla" entre 'b' y 'l'; "Pueb" es un prefijo contiguo fiable
  assert.ok(text.includes(toHex('Pueb')), 'debe mostrar el municipio capturado');
  assert.ok(text.includes(toHex('domicilio')), 'debe traer la leyenda de confirmacion');
  assert.ok(!text.includes(toHex('undefined')), 'no debe imprimir "undefined"');
});

test('B10: (#84) entrega completa -> no imprime la leyenda de confirmacion', async () => {
  const result = await generateQuotePDF({
    _compress: false,
    cliente: { calle: 'Reforma 100', cpEntrega: '06600', municipio: 'CDMX', leyendaDomicilio: '' },
  });
  const text = result.toString('latin1');
  assert.ok(!text.includes(toHex('domicilio')), 'no debe traer la leyenda cuando la entrega esta completa');
  assert.ok(!text.includes(toHex('undefined')), 'no debe imprimir "undefined"');
});

// === #70 paridad de diseno PDF vs HTML ===

test('B11: (#70) header muestra el correo de la empresa, no la URL del sitio', async () => {
  const result = await generateQuotePDF({ _compress: false });
  const text = result.toString('latin1');
  assert.ok(text.includes(toHex('contacto')), 'debe mostrar el correo contacto@pppeltre.mx');
});

test('B12: (#70) los totales no llevan signo de pesos (formato HTML)', async () => {
  const result = await generateQuotePDF({ _compress: false, subtotal: 100, iva: 16, total: 116 });
  const text = result.toString('latin1');
  assert.ok(!text.includes(toHex('$ 116')), 'TOTAL no debe llevar "$ " (formato HTML sin simbolo)');
  assert.ok(text.includes(toHex('116.00')), 'debe mostrar el monto del TOTAL');
});

test('B13: (#70) Telefono y Correo aparecen en la misma linea de "Datos de entrega" (formato HTML)', async () => {
  const result = await generateQuotePDF({
    _compress: false,
    cliente: { celEntrega: '5512345678', emailEntrega: 'cliente@test.com' },
  });
  const text = result.toString('latin1');
  // PDFKit kern-splits antes de "Correo"; "5512345678 ," (numero + coma que
  // separa Tel de Correo) es un fragmento contiguo fiable que solo aparece si
  // ambos van en la misma llamada .text() (misma linea, como el HTML)
  assert.ok(text.includes(toHex('5512345678 ,')), 'Tel y Correo deben ir en la misma linea, como el HTML');
  assert.ok(text.includes(toHex('Correo:')), 'debe incluir la etiqueta Correo:');
});

test('B14: (#70) Referencia Cliente prefiere c.referencia sobre c.nombreCorto (igual que el HTML)', async () => {
  const result = await generateQuotePDF({
    _compress: false,
    cliente: { referencia: 'REF-1', nombreCorto: 'Corto' },
  });
  const text = result.toString('latin1');
  // PDFKit kern-splits "Referencia" tras "Ref"; "Ref" es un prefijo contiguo fiable
  assert.ok(text.includes(toHex('Ref')) && text.includes(toHex('REF-1')), 'debe preferir c.referencia cuando ambos estan presentes');
  assert.ok(!text.includes(toHex('Corto')), 'no debe mostrar nombreCorto cuando referencia esta presente');
});

test('B15: (#70) telefonoEntrega (campo muerto) no dispara la linea de telefono (paridad con HTML)', async () => {
  const result = await generateQuotePDF({
    _compress: false,
    cliente: { telefonoEntrega: '9998887777' },
  });
  const text = result.toString('latin1');
  // El HTML solo considera celEntrega/emailEntrega (linea 216); telefonoEntrega
  // no existe en el modelo actual (nada lo produce) y no debe renderizarse
  assert.ok(!text.includes(toHex('9998887777')), 'telefonoEntrega no debe aparecer: el HTML no lo considera');
});

// === #101: pagina fantasma y contador de paginas ===

function countPages(text) {
  const matches = text.match(/\/Type\s*\/Page(?!s)/g) || [];
  return matches.length;
}

test('B16: (#101) una cotizacion que cabe en una hoja genera un PDF de una sola pagina fisica', async () => {
  const result = await generateQuotePDF({ _compress: false });
  const text = result.toString('latin1');
  assert.equal(countPages(text), 1, 'no debe generar una segunda pagina en blanco');
});

test('B17: (#101) el contador "Pagina X de Y" coincide con el numero real de paginas', async () => {
  const result = await generateQuotePDF({ _compress: false });
  const text = result.toString('latin1');
  const paginasReales = countPages(text);
  // PDFKit kern-splits "Pagina"; "1 de N" es el fragmento contiguo fiable
  assert.ok(text.includes(toHex(`1 de ${paginasReales}`)), `debe imprimir "Pagina 1 de ${paginasReales}"`);
});

// === #136: la descripcion literal de la partida ENVIO (servicio + tiempo de
// entrega de envia.com) llega intacta al PDF -- se busca "entrega estimada"
// (ASCII, sin acentos) porque es contiguo y no se ve afectado por el
// kern-split de PDFKit ni por la codificacion WinAnsi de acentos/em-dash.
test('B18: (#136) la partida ENVIO con tiempo de entrega imprime "entrega estimada" en el PDF', async () => {
  const result = await generateQuotePDF({
    _compress: false,
    items: [{
      codigo: 'ENVIO',
      descripcion: 'FedEx Nacional Economico - entrega estimada 1-2 dias habiles',
      cantidad: 1, unidad: 'ACT', precio: 259, descuento: 0,
    }],
  });
  const text = result.toString('latin1');
  assert.ok(text.includes(toHex('estimada')), 'debe imprimir el tiempo de entrega estimado de la partida ENVIO');
});

// === #137: descuento comercial por linea (columna "% Dscto." + total neto) ===
// Se evitan descuentos que terminen en 0 (10%, 50%, etc.): "10%" contiene "0%"
// como subcadena contigua, lo que arruinaria la aseveracion de ausencia del
// descuento en la linea sin descontar. 15% y 75% no tienen ese problema.
// Cantidades > 1 en todas las lineas para que bruto, precio unitario y neto
// sean tres numeros distintos entre si (nada de falsos verdes por coincidencia).

test('B19: (#137) el PDF imprime el porcentaje de descuento por linea y lo omite cuando es 0', async () => {
  const result = await generateQuotePDF({
    _compress: false,
    items: [
      { codigo: 'A001', descripcion: 'Item con descuento', cantidad: 3, unidad: 'pza', precio: 100, descuento: 15 },
      { codigo: 'B002', descripcion: 'Item sin descuento', cantidad: 2, unidad: 'pza', precio: 200, descuento: 0 },
      { codigo: 'ENVIO', descripcion: 'FedEx Nacional', cantidad: 2, unidad: 'ACT', precio: 259, descuento: 75 },
    ],
  });
  const text = result.toString('latin1');
  assert.ok(text.includes(toHex('15%')), 'debe imprimir el 15% de descuento del articulo A001');
  assert.ok(text.includes(toHex('75%')), 'debe imprimir el 75% de descuento de la partida ENVIO');
  assert.ok(!text.includes(toHex('0%')), 'no debe imprimir "0%" en la linea sin descuento (B002)');
});

test('B20: (#137) el total de linea es el neto cantidad*precio*(1-descuento/100), no el bruto', async () => {
  const result = await generateQuotePDF({
    _compress: false,
    items: [
      { codigo: 'A001', descripcion: 'Item con descuento', cantidad: 3, unidad: 'pza', precio: 100, descuento: 15 },
      { codigo: 'ENVIO', descripcion: 'FedEx Nacional', cantidad: 2, unidad: 'ACT', precio: 259, descuento: 75 },
    ],
  });
  const text = result.toString('latin1');
  // A001: 3*100*0.85 = 255.00 (bruto seria 300.00)
  assert.ok(text.includes(toHex('255.00')), 'el total de A001 debe ser el neto 255.00');
  assert.ok(!text.includes(toHex('300.00')), 'no debe imprimir el bruto 300.00 de A001');
  // ENVIO: 2*259*0.25 = 129.50 (bruto seria 518.00; el precio unitario 259.00 si debe seguir apareciendo)
  assert.ok(text.includes(toHex('129.50')), 'el total de ENVIO debe ser el neto 129.50');
  assert.ok(!text.includes(toHex('518.00')), 'no debe imprimir el bruto 518.00 de ENVIO');
  assert.ok(text.includes(toHex('259.00')), 'el precio unitario de ENVIO debe seguir imprimiendose sin descontar');
});

// === #139: la descripcion que escribio el vendedor es la que lee el cliente ===
test('B21: (#139) el PDF imprime la descripcion editada de la partida', async () => {
  const result = await generateQuotePDF({
    _compress: false,
    items: [
      { codigo: 'A001', descripcion: 'Olla 20 cm esmaltada a mano', descripcionEditada: true, cantidad: 2, unidad: 'pza', precio: 100 },
    ],
  });
  const text = result.toString('latin1');
  assert.ok(text.includes(toHex('esmaltada a mano')), 'debe imprimir la descripcion que capturo el vendedor');
});

// #220: el PDF se regenera desde `data` (ADR-0009), asi que los dos disenos de
// calca tienen que llegar como dos partidas distinguibles (spec #218).
test('#220: dos disenos del mismo codigo pintan dos filas con su propio texto', async () => {
  const result = await generateQuotePDF({
    _compress: false,
    items: [
      { codigo: 'VA08B1A321124', descripcion: 'Vaso peltre', cantidad: 200, precio: 50 },
      { codigo: 'CAL1025S', descripcion: 'Calca chica - Diseno 1', cantidad: 100, precio: 26.9, diseno: 1 },
      { codigo: 'CAL1025S', descripcion: 'Calca chica - Diseno 2', cantidad: 120, precio: 26.9, diseno: 2 },
    ],
  });
  const text = result.toString('latin1');
  assert.ok(text.includes(toHex('Calca chica - Diseno 1')), 'falta la fila del primer diseno');
  assert.ok(text.includes(toHex('Calca chica - Diseno 2')), 'falta la fila del segundo diseno');
  // Las dos partidas comparten codigo: si el PDF las fusionara solo habria uno.
  const veces = text.split(toHex('CAL1025S')).length - 1;
  assert.strictEqual(veces, 2);
});
