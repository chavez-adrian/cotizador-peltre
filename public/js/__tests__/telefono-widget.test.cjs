'use strict';
// Nucleo compartido del widget de telefono (issue #176). Lo que se prueba aqui
// es lo que NO depende del DOM: el mapeo iso2 -> celCode de la casa, el numero
// que se guarda y el mensaje del aviso. El montaje (montarTelefono y su aviso)
// pide navegador -- ahi manda la verificacion manual, como el resto de app.js.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let MENSAJE_VALIDACION_CEL, celCodeDelWidget, numeroDelWidget, avisoTelefonoWidget;
before(async () => {
  ({ MENSAJE_VALIDACION_CEL, celCodeDelWidget, numeroDelWidget, avisoTelefonoWidget } =
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
  assert.match(generico, /v[aá]lido/i);
});

// El veredicto preciso es SECUNDARIO y opcional: solo lo pide el alta interna
// (preciso:true). Un numero con el largo correcto pero fuera de todo rango
// asignado -- el caso de +297 111 1111 -- solo lo atrapa esta capa.
test('avisoTelefonoWidget avisa del veredicto preciso solo cuando se lo piden', async () => {
  const largoOkRangoMalo = { valido: true, preciso: false };
  assert.strictEqual(await avisoTelefonoWidget(itiFalso(largoOkRangoMalo), '2971111111'), null);
  const msg = await avisoTelefonoWidget(itiFalso(largoOkRangoMalo), '2971111111', { preciso: true });
  assert.match(msg, /rango asignado/i);
  // y dice de cuando es la copia vendoreada, que es lo que lo vuelve una pista
  // y no un veredicto
  assert.match(msg, /2026-08-16/);
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
