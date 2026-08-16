'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let TIPOS_PROYECTO, CANTIDADES, CUANDO_OPCIONES, DOMINIOS_CORREO,
  segmentoDeTipo, unirNombre, sugerirDominioCorreo, validarMayoreo, buildCapturaMayoreo;
before(async () => {
  ({ TIPOS_PROYECTO, CANTIDADES, CUANDO_OPCIONES, DOMINIOS_CORREO,
    segmentoDeTipo, unirNombre, sugerirDominioCorreo, validarMayoreo,
    buildCapturaMayoreo } = await import('../mayoreo-logica.js'));
});

// M1: el mapeo tipo -> segmento de Operam es el del ticket #157 (tabla de campos).
// Varias opciones caen en el mismo segmento a proposito (Restaurantes, Hoteles y
// Cafeterias son 10): por eso la opcion textual se conserva ademas en las notas.
test('M1: cada tipo de proyecto mapea al segmento de Operam del catalogo', () => {
  assert.equal(segmentoDeTipo('Distribuidores'), 14);
  assert.equal(segmentoDeTipo('Menudistas'), 8);
  assert.equal(segmentoDeTipo('Restaurantes'), 10);
  assert.equal(segmentoDeTipo('Hoteles'), 10);
  assert.equal(segmentoDeTipo('Cafeterías'), 10);
  assert.equal(segmentoDeTipo('Catering | Eventos'), 15);
  assert.equal(segmentoDeTipo('Agencias | Marcas'), 12);
  assert.equal(segmentoDeTipo('Otro'), 1);
});

test('M2: un tipo fuera del catalogo cerrado no tiene segmento', () => {
  assert.equal(segmentoDeTipo('Ferreterías'), null);
  assert.equal(segmentoDeTipo(''), null);
  assert.equal(segmentoDeTipo(undefined), null);
});

test('M3: TIPOS_PROYECTO es el catalogo cerrado en el orden del formulario', () => {
  assert.deepEqual(TIPOS_PROYECTO, [
    'Distribuidores', 'Menudistas', 'Restaurantes', 'Hoteles', 'Cafeterías',
    'Catering | Eventos', 'Agencias | Marcas', 'Otro',
  ]);
});

// M4: nombre y apellido se piden por separado (dos campos obligatorios inducen
// datos mas completos) pero el prospecto guarda UN solo nombre.
test('M4: unirNombre junta nombre y apellido en un solo nombre recortado', () => {
  assert.equal(unirNombre('  Laura ', ' Mendoza  '), 'Laura Mendoza');
  assert.equal(unirNombre('Laura', ''), 'Laura');
  assert.equal(unirNombre('', 'Mendoza'), 'Mendoza');
  assert.equal(unirNombre('', ''), '');
  assert.equal(unirNombre(undefined, undefined), '');
});

// M5: +6,000 NO esta en el formulario publico a proposito (ese nivel exige
// negociacion humana y no debe entrar por autoservicio, CONTEXT.md).
test('M5: CANTIDADES omite +6,000 deliberadamente', () => {
  assert.deepEqual(CANTIDADES, ['+100', '+350', '+550', '+1,500']);
  assert.equal(CANTIDADES.includes('+6,000'), false);
});

test('M6: CUANDO_OPCIONES es el catalogo cerrado de rangos, sin texto libre', () => {
  assert.deepEqual(CUANDO_OPCIONES, [
    'En las próximas 4 semanas', 'En los próximos 3 meses',
    'En los próximos 6 meses', 'Aún no tengo fecha',
  ]);
});

test('M7: sugerirDominioCorreo propone el dominio cercano de la lista mexicana', () => {
  assert.equal(sugerirDominioCorreo('laura@gmial.com'), 'gmail.com');
  assert.equal(sugerirDominioCorreo('laura@hotmial.com'), 'hotmail.com');
  assert.equal(sugerirDominioCorreo('laura@prodigy.net.m'), 'prodigy.net.mx');
});

test('M8: sugerirDominioCorreo calla ante dominios validos o ajenos a la lista', () => {
  for (const d of DOMINIOS_CORREO) {
    assert.equal(sugerirDominioCorreo(`laura@${d}`), null, d);
  }
  assert.equal(sugerirDominioCorreo('compras@hotelazul.mx'), null);
  assert.equal(sugerirDominioCorreo('laura'), null);
  assert.equal(sugerirDominioCorreo(''), null);
});

test('M9: sugerirDominioCorreo ignora mayusculas y espacios del dominio', () => {
  assert.equal(sugerirDominioCorreo('  Laura@GMIAL.COM  '), 'gmail.com');
});

// --- validarMayoreo: la MISMA validacion corre en el navegador (errores inline)
// y en el servidor (el endpoint publico no confia en el cliente).

function formValido(extra) {
  return Object.assign({
    tipo: 'Restaurantes', otro: '', empresa: 'Hotel Azul',
    cant: '+350', cp: '56530', ciudad: 'Ixtapaluca', cuando: 'En los próximos 3 meses',
    nombre: 'Laura', apellido: 'Mendoza', cargo: 'Compras',
    celCode: '+52', cel: '5512345678', correo: 'laura@gmail.com',
    web: '@hotelazul', promos: false,
  }, extra || {});
}

test('M10: validarMayoreo acepta la captura completa', () => {
  assert.deepEqual(validarMayoreo(formValido()), []);
});

test('M11: validarMayoreo acepta sin opcionales (empresa, cuando, cargo, correo, web, promos)', () => {
  assert.deepEqual(validarMayoreo(formValido({
    empresa: '', cuando: '', cargo: '', correo: '', web: '', promos: false,
  })), []);
});

test('M12: validarMayoreo reporta los obligatorios vacios en el orden del formulario', () => {
  const errores = validarMayoreo({});
  assert.deepEqual(errores.map(e => e.campo), ['tipo', 'cant', 'cp', 'ciudad', 'nombre', 'apellido', 'cel']);
  assert.deepEqual(errores.map(e => e.mensaje), [
    'Selecciona una opción.',
    'Selecciona una cantidad.',
    'Escribe tu código postal.',
    'Escribe tu ciudad.',
    'Escribe tu nombre.',
    'Escribe tu apellido.',
    'Escribe tu celular a 10 dígitos.',
  ]);
});

test('M13: "Otro" sin especificar no pasa; con texto si', () => {
  const errores = validarMayoreo(formValido({ tipo: 'Otro', otro: '   ' }));
  assert.deepEqual(errores, [{ campo: 'otro', mensaje: 'Cuéntanos qué tienes en mente.' }]);
  assert.deepEqual(validarMayoreo(formValido({ tipo: 'Otro', otro: 'Bazar de artesanías' })), []);
});

test('M14: "otro" solo se exige cuando el tipo es Otro', () => {
  assert.deepEqual(validarMayoreo(formValido({ tipo: 'Hoteles', otro: '' })), []);
});

test('M15: validarMayoreo rechaza un tipo o una cantidad fuera del catalogo cerrado', () => {
  assert.deepEqual(validarMayoreo(formValido({ tipo: 'Ferreterías' })),
    [{ campo: 'tipo', mensaje: 'Selecciona una opción.' }]);
  assert.deepEqual(validarMayoreo(formValido({ cant: '+6,000' })),
    [{ campo: 'cant', mensaje: 'Selecciona una cantidad.' }]);
});

test('M16: validarMayoreo rechaza un "cuando" fuera del catalogo cerrado', () => {
  assert.deepEqual(validarMayoreo(formValido({ cuando: 'la semana que entra' })),
    [{ campo: 'cuando', mensaje: 'Selecciona una opción.' }]);
});

// El celular es LA llave de identidad: la validacion es la del resto del sistema
// (alta-logica.validarTelefono), no una regex propia del formulario.
test('M17: validarMayoreo exige 10 digitos en el celular (validacion de la casa)', () => {
  assert.deepEqual(validarMayoreo(formValido({ cel: '551234567' })),
    [{ campo: 'cel', mensaje: 'Escribe tu celular a 10 dígitos.' }]);
  assert.deepEqual(validarMayoreo(formValido({ cel: '55 1234 5678' })), []);
  assert.deepEqual(validarMayoreo(formValido({ celCode: '+1', cel: '2125550123' })), []);
});

test('M18: validarMayoreo solo valida el formato del correo si viene', () => {
  assert.deepEqual(validarMayoreo(formValido({ correo: 'laura(arroba)gmail.com' })),
    [{ campo: 'correo', mensaje: 'Ese correo no se ve válido.' }]);
  assert.deepEqual(validarMayoreo(formValido({ correo: '' })), []);
});

// --- buildCapturaMayoreo: el formulario -> la captura de prospecto de #57.

const AHORA = '2026-08-15T18:30:00.000Z';

test('M19: buildCapturaMayoreo arma la captura completa del prospecto', () => {
  const c = buildCapturaMayoreo(formValido({ promos: true }), AHORA);
  assert.equal(c.celular, '+52 5512345678');
  assert.equal(c.nombre, 'Laura Mendoza');
  assert.equal(c.ciudad, 'Ixtapaluca');
  assert.equal(c.canal, 'Formulario web');
  assert.equal(c.data.segmento_id, 10);
  assert.equal(c.data.piezas_estimadas, '+350');
  assert.equal(c.data.correo, 'laura@gmail.com');
  assert.equal(c.data.empresa, 'Hotel Azul');
  assert.equal(c.data.cp, '56530');
  assert.equal(c.data.cuando, 'En los próximos 3 meses');
  assert.equal(c.data.web, '@hotelazul');
  assert.deepEqual(c.data.promos, { acepta: true, fecha: AHORA });
});

// El segmento pre-asignado no basta: Restaurantes, Hoteles y Cafeterias comparten
// el 10, asi que la opcion textual se conserva en las notas para el vendedor.
test('M20: las notas conservan la opcion textual del tipo y el cargo', () => {
  const c = buildCapturaMayoreo(formValido({ tipo: 'Hoteles', cargo: 'Chef' }), AHORA);
  assert.equal(c.data.notas, 'Tipo de proyecto: Hoteles\nCargo: Chef');
});

test('M21: con tipo Otro las notas llevan lo que el prospecto escribio', () => {
  const c = buildCapturaMayoreo(
    formValido({ tipo: 'Otro', otro: '  Bazar de artesanías  ', cargo: '' }), AHORA);
  assert.equal(c.data.segmento_id, 1);
  assert.equal(c.data.notas, 'Tipo de proyecto: Otro\nEspecificó: Bazar de artesanías');
});

test('M22: los opcionales vacios no viajan en data', () => {
  const c = buildCapturaMayoreo(formValido({
    empresa: '  ', cuando: '', cargo: '', correo: '   ', web: '',
  }), AHORA);
  for (const k of ['empresa', 'cuando', 'correo', 'web']) {
    assert.equal(k in c.data, false, k);
  }
  assert.equal(c.data.notas, 'Tipo de proyecto: Restaurantes');
});

// LFPDPPP: la prueba del consentimiento vale tanto como el consentimiento. Sin
// marcar no hay fecha que guardar, pero el "no" queda registrado igual.
test('M23: promos desmarcado se guarda como negativa sin fecha', () => {
  const c = buildCapturaMayoreo(formValido({ promos: false }), AHORA);
  assert.deepEqual(c.data.promos, { acepta: false });
});

test('M24: buildCapturaMayoreo recorta los espacios de todo lo que guarda', () => {
  const c = buildCapturaMayoreo(formValido({
    nombre: '  Laura ', apellido: ' Mendoza ', ciudad: '  Ixtapaluca ',
    cp: ' 56530 ', correo: ' laura@gmail.com ', empresa: ' Hotel Azul ', web: ' @hotelazul ',
  }), AHORA);
  assert.equal(c.nombre, 'Laura Mendoza');
  assert.equal(c.ciudad, 'Ixtapaluca');
  assert.equal(c.data.cp, '56530');
  assert.equal(c.data.correo, 'laura@gmail.com');
  assert.equal(c.data.empresa, 'Hotel Azul');
  assert.equal(c.data.web, '@hotelazul');
});
