'use strict';
// Nucleo compartido del widget de telefono (issue #176). Lo que se prueba aqui
// es lo que NO depende del DOM: el mapeo iso2 -> celCode de la casa, el numero
// que se guarda y el mensaje del aviso. El montaje (montarTelefono y su aviso)
// pide navegador -- ahi manda la verificacion manual, como el resto de app.js.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let MENSAJE_VALIDACION_CEL, MENSAJE_UNO_LIDER, celCodeDelWidget, numeroDelWidget, avisoTelefonoWidget, normalizarCapturaMx, unoLiderDescartado, opcionesWidget;
before(async () => {
  ({ MENSAJE_VALIDACION_CEL, MENSAJE_UNO_LIDER, celCodeDelWidget, numeroDelWidget, avisoTelefonoWidget, normalizarCapturaMx, unoLiderDescartado, opcionesWidget } =
    await import('../telefono-widget.js'));
});

// Doble del widget: solo los metodos que el modulo consume.
function itiFalso({ iso2 = 'mx', numero = '', valido = true, preciso = true, error = null, promesa = Promise.resolve() } = {}) {
  return {
    promise: promesa,
    getSelectedCountry: () => (iso2 ? { iso2 } : null),
    getNumber: () => { if (numero instanceof Error) throw numero; return numero; },
    isValidNumber: () => valido,
    isValidNumberPrecise: () => preciso,
    getValidationError: () => error,
  };
}

test('celCodeDelWidget traduce el iso2 del widget al celCode de la casa', () => {
  assert.strictEqual(celCodeDelWidget(itiFalso({ iso2: 'mx' })), '+52');
  assert.strictEqual(celCodeDelWidget(itiFalso({ iso2: 'us' })), '+1');
  assert.strictEqual(celCodeDelWidget(itiFalso({ iso2: 'ca' })), '+1-CA');
  // cualquier otro pais cae al generico
  assert.strictEqual(celCodeDelWidget(itiFalso({ iso2: 'aw' })), '+');
  assert.strictEqual(celCodeDelWidget(itiFalso({ iso2: '' })), '+');
  assert.strictEqual(celCodeDelWidget(null), '+');
});

test('numeroDelWidget entrega el E.164 del widget y normaliza el "1" legacy mexicano', () => {
  assert.strictEqual(numeroDelWidget(itiFalso({ numero: '+525512345678' }), '55 1234 5678'), '+525512345678');
  assert.strictEqual(numeroDelWidget(itiFalso({ numero: '+5215512345678' }), ''), '+525512345678');
  assert.strictEqual(numeroDelWidget(itiFalso({ numero: '+15551234567' }), ''), '+15551234567');
});

test('numeroDelWidget cae al valor crudo si utils.js todavia no carga', () => {
  const iti = itiFalso({ numero: new Error('utils no cargado') });
  assert.strictEqual(numeroDelWidget(iti, '55 1234 5678'), '55 1234 5678');
  assert.strictEqual(numeroDelWidget(itiFalso({ numero: '' }), '55 1234 5678'), '55 1234 5678');
  assert.strictEqual(numeroDelWidget(null, '55 1234 5678'), '55 1234 5678');
});

test('avisoTelefonoWidget calla con numero vacio o valido', async () => {
  assert.strictEqual(await avisoTelefonoWidget(itiFalso({ valido: false, error: 'TOO_SHORT' }), ''), null);
  assert.strictEqual(await avisoTelefonoWidget(itiFalso({ valido: true }), '5512345678'), null);
});

test('avisoTelefonoWidget traduce el motivo de intl-tel-input', async () => {
  const msg = await avisoTelefonoWidget(itiFalso({ valido: false, error: 'TOO_SHORT' }), '551234');
  assert.strictEqual(msg, MENSAJE_VALIDACION_CEL.TOO_SHORT);
  assert.ok(msg);
  const generico = await avisoTelefonoWidget(itiFalso({ valido: false, error: 'LO_QUE_SEA' }), '551234');
  assert.match(generico, /no se ve/i);
});

// Reporte de Adrian en produccion: con +52 y "532 590 00" (8 digitos) el aviso
// decia "Falta el codigo de pais". El motivo real que devuelve el utils para ese
// numero es IS_POSSIBLE_LOCAL_ONLY -- 8 digitos es un largo LOCAL valido en la
// metadata mexicana -- y el codigo de pais nunca falta: lo pone el widget
// (separateDialCode). Lo que le falta al numero es la lada.
test('IS_POSSIBLE_LOCAL_ONLY avisa que el numero esta incompleto, no que falte el codigo de pais', async () => {
  const msg = await avisoTelefonoWidget(itiFalso({ valido: false, error: 'IS_POSSIBLE_LOCAL_ONLY' }), '532 590 00');
  assert.strictEqual(msg, MENSAJE_VALIDACION_CEL.IS_POSSIBLE_LOCAL_ONLY);
  assert.match(msg, /incompleto/i);
  assert.match(msg, /lada/i);
  // el punto cubre la vocal acentuada sin meter acentos en el archivo de test
  assert.doesNotMatch(msg, /c.digo de pa.s/i);
});

// El veredicto preciso es SECUNDARIO y opcional: solo lo pide el alta interna
// (preciso:true). Un numero con el largo correcto pero fuera de todo rango
// asignado -- el caso de +297 111 1111 -- solo lo atrapa esta capa.
test('avisoTelefonoWidget avisa del veredicto preciso solo cuando se lo piden', async () => {
  const largoOkRangoMalo = { valido: true, preciso: false };
  assert.strictEqual(await avisoTelefonoWidget(itiFalso(largoOkRangoMalo), '2971111111'), null);
  const msg = await avisoTelefonoWidget(itiFalso(largoOkRangoMalo), '2971111111', { preciso: true });
  // El mensaje lo lee un vendedor con el cliente enfrente: espanol llano, sin
  // jerga ("metadata", "rango asignado") ni fechas tecnicas -- Adrian reporto en
  // produccion que el texto anterior "no se entiende". La fecha de la copia
  // vendoreada vive en el comentario de MENSAJE_PRECISO, no en su cara.
  assert.match(msg, /no parece un n.mero real/i);
  assert.match(msg, /puedes guardarlo/i);
  assert.doesNotMatch(msg, /metadata|rango asignado|\d{4}-\d{2}-\d{2}/i);
  // numero bueno: ni con preciso:true
  assert.strictEqual(await avisoTelefonoWidget(itiFalso({ valido: true, preciso: true }), '2975633917', { preciso: true }), null);
  // el motivo por largo sigue mandando sobre el preciso
  const corto = await avisoTelefonoWidget(itiFalso({ valido: false, preciso: false, error: 'TOO_SHORT' }), '297', { preciso: true });
  assert.strictEqual(corto, MENSAJE_VALIDACION_CEL.TOO_SHORT);
});

test('avisoTelefonoWidget calla si utils.js no llego a cargar', async () => {
  const iti = itiFalso({ valido: false, error: 'TOO_SHORT', promesa: Promise.reject(new Error('sin utils')) });
  assert.strictEqual(await avisoTelefonoWidget(iti, '551234'), null);
});

// Una sola config para los dos consumidores (mayoreo publico y los seis campos
// del alta interna): si el buscador de pais se traduce, se traduce en los dos.
// La llave que el intl-tel-input vendoreado acepta es uiTranslations -- con
// cualquier otro nombre la opcion se ignora en silencio y el placeholder se
// queda en ingles.
test('opcionesWidget es la config compartida y trae el buscador en espanol', () => {
  const op = opcionesWidget();
  assert.strictEqual(op.initialCountry, 'mx');
  assert.strictEqual(op.strictMode, true);
  assert.strictEqual(typeof op.loadUtils, 'function');
  assert.ok(op.uiTranslations, 'la traduccion va bajo uiTranslations');
  assert.notStrictEqual(op.uiTranslations.searchPlaceholder, 'Search');
  assert.match(op.uiTranslations.searchPlaceholder, /buscar/i);
});

// Formato legacy mexicano en la CAPTURA (issue #176, reporte de Adrian del
// 2026-08-19): con strictMode el widget corta el nacional de Mexico en 10
// digitos, asi que tecleando "1 55 3466 7689" el digito 11 nunca entraba y el
// vendedor se quedaba con "1553466768" -- un numero equivocado. La normalizacion
// tiene que quitar el "1" EN CUANTO se teclea, no al final: ningun nacional
// mexicano real empieza con 1 (metadata oficial [2-9] + 9 digitos).
test('normalizarCapturaMx quita el "1" legacy desde el primer digito', () => {
  assert.strictEqual(normalizarCapturaMx('1'), '');
  assert.strictEqual(normalizarCapturaMx('1 55 3466 7689'), '55 3466 7689');
  assert.strictEqual(normalizarCapturaMx('15534667689'), '5534667689');
  assert.strictEqual(normalizarCapturaMx('1553466768'), '553466768');
});

test('normalizarCapturaMx deja intacto lo que ya es un nacional mexicano', () => {
  assert.strictEqual(normalizarCapturaMx('55 3466 7689'), '55 3466 7689');
  assert.strictEqual(normalizarCapturaMx('5534667689'), '5534667689');
  assert.strictEqual(normalizarCapturaMx(''), '');
  assert.strictEqual(normalizarCapturaMx(null), '');
});

// Pegar el numero completo (el caso del export de Bitrix y del copiar/pegar de
// WhatsApp) entra en formato internacional: ahi manda la normalizacion espejo
// de alta-logica, que solo toca el "1" cuando sobra despues del +52.
test('normalizarCapturaMx normaliza tambien el internacional pegado', () => {
  assert.strictEqual(normalizarCapturaMx('+52 1 55 3466 7689'), '+52 55 3466 7689');
  assert.strictEqual(normalizarCapturaMx('+5215534667689'), '+525534667689');
  assert.strictEqual(normalizarCapturaMx('+525534667689'), '+525534667689');
  // en +1 el "1" ES el codigo de pais: no se toca
  assert.strictEqual(normalizarCapturaMx('+15551234567'), '+15551234567');
});

// Issue #202: cablearCapturaMx solo debe avisar cuando el "1" que se descarta
// es el de un nacional mexicano tecleado a mano -- nunca el del espejo
// internacional (paste del formato legacy completo, que normaliza en
// silencio). unoLiderDescartado es el predicado puro que separa ambos casos;
// quien decide CUANDO llamarlo (solo en eventos de teclado) es DOM y pide
// verificacion en navegador.
test('unoLiderDescartado marca el "1" lider tecleado de un nacional mexicano', () => {
  assert.strictEqual(unoLiderDescartado('1'), true);
  assert.strictEqual(unoLiderDescartado('1 55 3466 7689'), true);
  assert.strictEqual(unoLiderDescartado('15534667689'), true);
  assert.strictEqual(unoLiderDescartado('1553466768'), true);
});

test('unoLiderDescartado calla con un nacional ya limpio o vacio', () => {
  assert.strictEqual(unoLiderDescartado('55 3466 7689'), false);
  assert.strictEqual(unoLiderDescartado('5534667689'), false);
  assert.strictEqual(unoLiderDescartado(''), false);
  assert.strictEqual(unoLiderDescartado(null), false);
});

test('unoLiderDescartado nunca dispara para el espejo internacional (paste)', () => {
  assert.strictEqual(unoLiderDescartado('+52 1 55 3466 7689'), false);
  assert.strictEqual(unoLiderDescartado('+5215534667689'), false);
  assert.strictEqual(unoLiderDescartado('+15551234567'), false);
});

test('MENSAJE_UNO_LIDER sigue el estilo de MENSAJE_VALIDACION_CEL: acentuado, sin bloquear', () => {
  assert.match(MENSAJE_UNO_LIDER, /ningún teléfono empieza con 1/);
  assert.match(MENSAJE_UNO_LIDER, /10 dígitos/);
});
