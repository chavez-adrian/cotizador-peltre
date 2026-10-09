'use strict';
// #562: el domicilio de entrega ya tenia un contacto General. La subida queda lograda
// con su folio y trae la pregunta al vendedor con los dos cuerpos de reintento que
// dicta el servidor (`reintentar.confirmar` y `reintentar.conservar`). La vista la
// pinta junto al folio y cada boton reenvia SU cuerpo tal cual, como la pregunta de la
// otra razon social (#345). Sin DOM: se lee el HTML que arman las funciones puras.
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
    conservar: { contactoEntrega: { conservar: true } },
  },
};
const PASO_PENDIENTE = { name: 'contacto de entrega', status: 'warn', mensaje: 'El Contacto de entrega todavia no se escribio en Operam: falta que confirmes si Alfa G Prueba deja de ser el contacto General del domicilio de entrega.', detalle: 'pendiente' };

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

test('PCE2: el estado pinta el folio, la pregunta con el nombre del desplazado y un boton por salida con el cuerpo que dicto el servidor', () => {
  const html = buildOperamStatusHtml(21, interpretarSubidaOperam({ ok: true, status: 200, folio: '1330', steps: [PASO_PENDIENTE], preguntaContacto: PREGUNTA }));
  assert.match(html, /Cotizaci/);
  assert.match(html, /1330/);
  assert.match(html, /Alfa G Prueba deja de ser el contacto General de este domicilio y queda como contacto de Entrega/);
  assert.deepEqual(cuerposDeLosBotones(html), [PREGUNTA.reintentar.confirmar, PREGUNTA.reintentar.conservar]);
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
