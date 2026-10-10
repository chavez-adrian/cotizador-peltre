'use strict';
// #562: el domicilio de entrega ya tenia un contacto General. La subida queda lograda
// con su folio y trae la pregunta al vendedor con el cuerpo de reintento que dicta el
// servidor (`reintentar.confirmar`). La vista la pinta junto al folio y el boton reenvia
// ese cuerpo tal cual, como la pregunta de la otra razon social (#345). D1 (decisiones de
// Adrian 2026-10-09): un solo boton, "Confirmar"; la salida "conservar" se quito. Sin DOM:
// se lee el HTML que arman las funciones puras.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let interpretarSubidaOperam, buildOperamStatusHtml;
before(async () => {
  ({ interpretarSubidaOperam, buildOperamStatusHtml } = await import('../pipeline-logica.js'));
});

const PREGUNTA = {
  codigo: 'CONFIRMAR_DESPLAZAR_GENERAL',
  mensaje: 'Lucia Recibe queda como contacto General y de Entrega del domicilio de entrega en Operam. Alfa G Prueba deja de ser el contacto General de este domicilio y queda como contacto de Entrega.',
  detalle: 'domicilio 564 del cliente 15: General actual persona 1294',
  nuevo: 'Lucia Recibe',
  desplazados: [{ nombre: 'Alfa G Prueba', roles: ['general'] }],
  reintentar: {
    confirmar: { contactoEntrega: { desplazar: ['1294'] } },
  },
};
const PASO_PENDIENTE = { name: 'contacto de entrega', status: 'warn', mensaje: 'El Contacto de entrega todavia no se escribio en Operam: falta que confirmes si Alfa G Prueba deja de ser el contacto General del domicilio de entrega.', detalle: 'pendiente' };

// El texto de cada boton de la pregunta.
function textosDeLosBotones(html) {
  return [...html.matchAll(/responderContactoEntregaOperam\(21, [^)]*\)">([^<]*)<\/button>/g)].map((m) => m[1]);
}

// Lo que el navegador reenviaria al apretar cada boton: el objeto serializado en su onclick.
function cuerposDeLosBotones(html) {
  return [...html.matchAll(/responderContactoEntregaOperam\(21, (\{[^)]*\}), this\)/g)]
    .map((m) => JSON.parse(m[1].replace(/&quot;/g, '"')));
}

test('PCE1: la subida lograda con la pregunta conserva el folio y lleva la pregunta; el aviso pendiente no se repite como paso', () => {
  const vista = interpretarSubidaOperam({ ok: true, status: 200, folio: '1330', steps: [PASO_PENDIENTE], preguntaContacto: PREGUNTA });
  assert.equal(vista.estado, 'folio');
  assert.equal(vista.folio, '1330');
  assert.deepEqual(vista.preguntaContacto, PREGUNTA);
  assert.deepEqual(vista.pasos, []);
});

test('PCE2: el estado pinta el folio, la pregunta con el nombre del desplazado y un solo boton, Confirmar, con el cuerpo que dicto el servidor', () => {
  const html = buildOperamStatusHtml(21, interpretarSubidaOperam({ ok: true, status: 200, folio: '1330', steps: [PASO_PENDIENTE], preguntaContacto: PREGUNTA }));
  assert.match(html, /Cotizaci/);
  assert.match(html, /1330/);
  assert.match(html, /Alfa G Prueba deja de ser el contacto General de este domicilio y queda como contacto de Entrega/);
  assert.deepEqual(cuerposDeLosBotones(html), [PREGUNTA.reintentar.confirmar]);
  assert.deepEqual(textosDeLosBotones(html), ['Confirmar']);
  assert.match(html, /hasta que confirmes/);
  assert.match(html, /Ver detalle t&eacute;cnico/);
});

test('PCE3: los nombres que vienen de Operam se escapan', () => {
  const html = buildOperamStatusHtml(21, interpretarSubidaOperam({
    ok: true, folio: '1330', preguntaContacto: { ...PREGUNTA, mensaje: '<img src=x onerror=alert(1)>', nuevo: '<b>Lucia</b>', desplazados: [{ nombre: '<i>Alfa</i>', roles: ['general'] }] },
  }));
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<b>Lucia<\/b>/);
  assert.doesNotMatch(html, /<i>Alfa<\/i>/);
});

// La respuesta a la decision (contactoEntrega: true) dice que paso con el contacto,
// tambien cuando salio bien: es lo que el vendedor acaba de pedir.
test('PCE4: la respuesta a la decision muestra el paso del contacto aunque haya salido bien', () => {
  const paso = { name: 'contacto de entrega', status: 'ok', mensaje: 'Lucia Recibe quedo en Operam como contacto General y de Entrega del domicilio de entrega; Alfa G Prueba dejo de ser General y quedo como contacto de Entrega.', detalle: 'persona 1301' };
  const vista = interpretarSubidaOperam({ ok: true, folio: '1330', contactoEntrega: true, steps: [paso] });
  assert.deepEqual(vista.pasos.map((p) => p.mensaje), [paso.mensaje]);
  assert.match(buildOperamStatusHtml(21, vista), /Alfa G Prueba dejo de ser General/);
});

test('PCE5: una subida lograda sin pregunta no pinta botones del contacto', () => {
  const html = buildOperamStatusHtml(21, interpretarSubidaOperam({ ok: true, folio: '1330', steps: [] }));
  assert.deepEqual(cuerposDeLosBotones(html), []);
});

// #563: la persona elegida ya tenia datos en Operam que se pisarian. La pregunta llega
// por el MISMO canal, tambien al Editar (la actualizacion del quote), y sus botones no
// hablan de un General cuando no hay a quien desplazar.
const PREGUNTA_PISA = {
  codigo: 'CONFIRMAR_PISAR_CONTACTO',
  mensaje: 'Se cambian datos que Adrian Bosques Nombre ya tenia en Operam: el Telefono pasa de 55 8888 0000 a 5512345678 (55 8888 0000 queda en Telefono Secundario).',
  detalle: 'persona 1249', nuevo: 'Adrian Bosques Nombre', desplazados: [],
  pisa: [{ campo: 'telefono', viejo: '55 8888 0000', nuevo: '5512345678' }],
  reintentar: {
    confirmar: { contactoEntrega: { desplazar: [], pisar: [{ personId: '1249', campo: 'telefono', viejo: '55 8888 0000' }] } },
  },
};
const PASO_PISA = { name: 'contacto de entrega', status: 'warn', mensaje: 'El Contacto de entrega todavia no se escribio en Operam: falta que confirmes los cambios a los datos de Adrian Bosques Nombre.', detalle: 'pendiente' };

test('PCE6: con casillas que se pisarian hay un solo boton, Confirmar, que reenvia el cuerpo del servidor', () => {
  const html = buildOperamStatusHtml(21, interpretarSubidaOperam({ ok: true, folio: '1330', yaSubida: true, steps: [], preguntaContacto: PREGUNTA_PISA }));
  assert.match(html, /el Telefono pasa de 55 8888 0000 a 5512345678/);
  assert.deepEqual(cuerposDeLosBotones(html), [PREGUNTA_PISA.reintentar.confirmar]);
  assert.deepEqual(textosDeLosBotones(html), ['Confirmar']);
});

let interpretarActualizacionOperam, buildActualizacionStatusHtml;
before(async () => {
  ({ interpretarActualizacionOperam, buildActualizacionStatusHtml } = await import('../pipeline-logica.js'));
});

test('PCE7: la actualizacion lograda trae la pregunta del contacto junto al folio y el aviso pendiente no se repite como paso', () => {
  const vista = interpretarActualizacionOperam({ ok: true, status: 200, folio: '1330', steps: [{ name: 'actualizar quote', status: 'ok' }, PASO_PISA], preguntaContacto: PREGUNTA_PISA });
  assert.equal(vista.estado, 'actualizada');
  assert.deepEqual(vista.preguntaContacto, PREGUNTA_PISA);
  assert.deepEqual(vista.pasos, []);
  const html = buildActualizacionStatusHtml(21, vista);
  assert.match(html, /actualizada en Operam/);
  assert.deepEqual(cuerposDeLosBotones(html), [PREGUNTA_PISA.reintentar.confirmar]);
});

// D4 (decisiones de Adrian 2026-10-09): la pregunta del cambio de celular. En el caso
// simple, un solo boton "Confirmar"; con telefono compartido, dos botones, y cada uno
// reenvia SU cuerpo (el segundo no mueve nada en el cotizador). Los botones son cortos
// y lo que hace cada uno lo explica el mensaje de arriba (Adrian 2026-10-10: en el
// navegador los textos largos ocupaban varias lineas y la barra del total tapaba el
// segundo).
const PREGUNTA_NUMERO = {
  codigo: 'CONFIRMAR_PISAR_CONTACTO',
  mensaje: 'El celular de Adrian Bosques Nombre cambia de 55 8888 0000 a 5512345678.',
  detalle: 'persona 1249', nuevo: 'Adrian Bosques Nombre', desplazados: [],
  pisa: [{ campo: 'cel', viejo: '55 8888 0000', nuevo: '5512345678' }],
  numero: { viejo: '55 8888 0000', nuevo: '5512345678', contactoViejo: true, oportunidades: 3, cotizaciones: 1, otrasPersonas: ['Pedro Lopez'], compartido: true, mover: true },
  reintentar: {
    confirmar: { contactoEntrega: { desplazar: [], pisar: [{ personId: '1249', campo: 'cel', viejo: '55 8888 0000' }], numero: { viejo: '55 8888 0000', mover: true } } },
    soloOperam: { contactoEntrega: { desplazar: [], pisar: [{ personId: '1249', campo: 'cel', viejo: '55 8888 0000' }], numero: { viejo: '55 8888 0000', mover: false } } },
  },
};

test('PCE8: telefono compartido: dos botones con las palabras de la decision, cada uno con su cuerpo', () => {
  const html = buildOperamStatusHtml(21, interpretarSubidaOperam({ ok: true, folio: '1330', yaSubida: true, steps: [], preguntaContacto: PREGUNTA_NUMERO }));
  assert.deepEqual(cuerposDeLosBotones(html), [PREGUNTA_NUMERO.reintentar.confirmar, PREGUNTA_NUMERO.reintentar.soloOperam]);
  assert.deepEqual(textosDeLosBotones(html), [
    'Era solo suyo: pasar todo al n\u00famero nuevo',
    'Es compartido: dejarlo como est\u00e1',
  ]);
  assert.doesNotMatch(html, /fund|fusi/i);
});

test('PCE9: cambio de celular sin telefono compartido: un solo boton, Confirmar', () => {
  const simple = { ...PREGUNTA_NUMERO, numero: { ...PREGUNTA_NUMERO.numero, otrasPersonas: [], compartido: false }, reintentar: { confirmar: PREGUNTA_NUMERO.reintentar.confirmar } };
  const html = buildOperamStatusHtml(21, interpretarSubidaOperam({ ok: true, folio: '1330', yaSubida: true, steps: [], preguntaContacto: simple }));
  assert.deepEqual(cuerposDeLosBotones(html), [simple.reintentar.confirmar]);
  assert.deepEqual(textosDeLosBotones(html), ['Confirmar']);
});

// D4 (Adrian 2026-10-10, prueba en produccion): la respuesta a la confirmacion del
// cambio de numero dice que paso en el cotizador, salga bien (`ok`) o se haya quedado
// como estaba porque el vendedor lo decidio (`omitido`). Antes solo se veia el paso del
// contacto y el del numero viajaba en `steps` sin pintarse.
test('PCE10: la respuesta a la confirmacion muestra el paso del numero, en ok y en omitido', () => {
  const contacto = { name: 'contacto de entrega', status: 'ok', mensaje: 'El celular de Adrian Bosques Nombre quedo en 5512345678 en Operam.', detalle: 'persona 1249' };
  const movido = { name: 'Contacto movido al número nuevo', status: 'ok', mensaje: 'Lo del 55 8888 0000 paso al 5512345678: 3 oportunidades y 1 cotizacion.', detalle: 'contacto 276' };
  const soloOperam = { name: 'Contacto movido al número nuevo', status: 'omitido', mensaje: 'Solo se actualizó el celular de Adrian Bosques Nombre en Operam: el 55 8888 0000 se queda como está en el cotizador, como lo decidiste.', detalle: 'persona 1249' };
  const otroOmitido = { name: 'segmento', status: 'omitido', mensaje: 'No aplica.', detalle: '' };
  for (const paso of [movido, soloOperam]) {
    const vista = interpretarSubidaOperam({ ok: true, folio: '1330', contactoEntrega: true, steps: [contacto, paso, otroOmitido] });
    assert.deepEqual(vista.pasos.map((p) => p.mensaje), [contacto.mensaje, paso.mensaje]);
    assert.equal(vista.pasos[1].estado, paso.status);
  }
});

// Prueba en produccion 2026-10-10: con el Contacto movido al numero nuevo, la pestana que
// confirmo conservaba el numero viejo en el telefono del paso Cliente, y un nuevo
// guardado lo habria regresado al registro. La respuesta trae `numeroCambiado` y el
// telefono pasa al nuevo solo si era el viejo (en cualquier formato); otro numero, o
// sin cambio, se queda.
// La confirmacion tambien puede llegar con la forma de la actualizacion (la cotizacion
// tenia el quote desactualizado): el paso del numero se lee igual.
test('PCE12: la actualizacion lograda muestra el paso del numero', async () => {
  const { interpretarActualizacionOperam } = await import('../pipeline-logica.js');
  const movido = { name: 'Contacto movido al número nuevo', status: 'ok', mensaje: 'Lucia cambio de numero.', detalle: 'contacto 276' };
  const vista = interpretarActualizacionOperam({ ok: true, folio: '1330', steps: [{ name: 'actualizar quote', status: 'ok' }, movido] });
  assert.deepEqual(vista.pasos.map((p) => p.mensaje), [movido.mensaje]);
});

test('PCE11: el telefono del paso Cliente pasa al numero nuevo solo si era el viejo', async () => {
  const { telefonoTrasCambioDeNumero } = await import('../cambio-numero-logica.js');
  const cambio = { viejo: '+525515570005', nuevo: '+525515570006' };
  assert.equal(telefonoTrasCambioDeNumero('+52 55 1557 0005', cambio), '+525515570006');
  assert.equal(telefonoTrasCambioDeNumero('5515570005', cambio), '+525515570006');
  assert.equal(telefonoTrasCambioDeNumero('+52 55 7777 0000', cambio), '+52 55 7777 0000');
  assert.equal(telefonoTrasCambioDeNumero('', cambio), '');
  assert.equal(telefonoTrasCambioDeNumero('+52 55 1557 0005', null), '+52 55 1557 0005');
});
