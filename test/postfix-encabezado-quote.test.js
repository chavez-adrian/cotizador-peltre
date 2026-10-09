// Post-fix del encabezado del quote (#521): la bateria que corre los MISMOS casos
// sobre cada fila `select` de la tabla. Reune los que antes vivian por campo -- lista
// (#403) y domicilio de entrega (#409) en test/operam-web.test.js, transportista (#448)
// en test/operam-web-transportista.test.js -- con sus mismos valores esperados.
//
// Los casos comunes (sin el select no hay opciones; los cinco desenlaces de la
// decision) se corren sobre TODAS las filas; lo propio de cada campo (su formulario
// real, sus opciones, sus motivos) vive en CASOS. Una fila `select` nueva sin sus
// casos hace fallar la primera prueba.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FILAS_ENCABEZADO_QUOTE, FILAS_HUELLA, filaEncabezado, filasSelect, filasCampo, decidirCampoSelect, decidirCampoTexto, pasoEncabezadoQuote } from '../lib/postfix-encabezado-quote.js';
import { opcionesEncabezado } from '../lib/operam-web.js';

const DIR_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const FIXTURE = readFileSync(join(DIR_FIXTURES, 'operam-quote-form.html'), 'utf8');
const FORM_1216 = readFileSync(join(DIR_FIXTURES, 'quote-1216-form-edicion.html'), 'utf8');

const CASOS = {
  // #403: la API v3 ignora la lista en el POST del quote (12 llaves medidas) y la web
  // legacy la escribe sin re-preciar las partidas (quote 1287).
  lista: {
    issue: '#403',
    // Las opciones salen del select REAL del formulario, no de una cadena escrita a
    // mano: eso solo confirmaria el regex contra si mismo (leccion de #36).
    opcionesReales() {
      const opciones = opcionesEncabezado(FIXTURE, filaEncabezado('lista'));
      assert.equal(opciones.length, 14);
      assert.deepEqual(opciones.find(o => o.id === '9'), { id: '9', nombre: 'Segundas' });
      assert.deepEqual(opciones.find(o => o.id === '12'), { id: '12', nombre: 'Precio de lista' });
      assert.ok(opciones.some(o => o.id === '15' && o.nombre === 'M100'));
    },
    opciones: [{ id: '9', nombre: 'Segundas' }, { id: '12', nombre: 'Precio de lista' }],
    escribe: { esperado: '9', actual: '12', valor: '9' },
    yaCorrecto: { esperado: '9', actual: 9 },
    sinValor: { actual: '12', motivo: [/cotizacion/i] },
    sinCampo: { esperado: '9', motivo: [/sales_type/] },
    ajeno: { esperado: '99', actual: '12', motivo: [/99/] },
  },
  // #409: al ACTUALIZAR, cambiar de domicilio movia la direccion de TEXTO (#328) y no
  // el domicilio seleccionado (la 1288: documento en Pestalozzi, quote en Bosques de
  // Europa). Escribir un branch de OTRO cliente hace que FA rechace el ProcessOrder.
  domicilio: {
    issue: '#409',
    opcionesReales() {
      const ops = opcionesEncabezado(FORM_1216, filaEncabezado('domicilio'));
      assert.ok(ops.length >= 2, 'el formulario real ofrece varios domicilios');
      assert.ok(ops.every(o => o.id !== '' && o.nombre !== ''), 'cada opcion trae su branch_code y su nombre');
      assert.ok(ops.some(o => o.id === '31'), 'entre ellos el que el quote tiene seleccionado');
    },
    opciones: [{ id: '564', nombre: 'Bosques de Europa' }, { id: '15', nombre: 'Pestalozzi' }],
    escribe: { esperado: '15', actual: '564', valor: '15' },
    // Se compara por TEXTO: el branch_code llega como numero desde Operam y como
    // cadena desde la cotizacion.
    yaCorrecto: { esperado: '15', actual: 15 },
    sinValor: { actual: '564', motivo: [/cotizacion/i] },
    sinCampo: { esperado: '15', motivo: [/branch_id/] },
    ajeno: { esperado: '999', actual: '564', motivo: [/999/] },
  },
  // #448: el quote heredaba el `default_ship_via` del domicilio (1 = "Default"). El
  // formulario real del quote 1216 ofrece 1 Default, 2 FedEx, 3 LalaMove.
  transportista: {
    issue: '#448',
    opcionesReales() {
      const ops = opcionesEncabezado(FORM_1216, filaEncabezado('transportista'));
      assert.deepEqual(ops.map(o => o.id), ['1', '2', '3']);
      assert.match(ops[1].nombre, /FedEx/);
      assert.match(ops[2].nombre, /LalaMove/);
    },
    opciones: [{ id: '1', nombre: 'Default' }, { id: '2', nombre: 'FedEx' }, { id: '3', nombre: 'LalaMove' }],
    escribe: { esperado: 3, actual: '1', valor: '3' },
    yaCorrecto: { esperado: 2, actual: '2' },
    sinValor: { actual: '1', motivo: [/transportista/] },
    sinCampo: { esperado: 3, motivo: [/ship_via/] },
    // El que importa de verdad: un id que el formulario no ofrece haria que FA
    // rechazara el ProcessOrder ENTERO, con la vigencia adentro.
    ajeno: { esperado: 6, actual: '1', motivo: [/6/, /1, 2, 3/] },
  },
};

test('#521 cada fila select de la tabla tiene sus casos en la bateria', () => {
  assert.deepEqual(filasSelect().map(f => f.campo).sort(), Object.keys(CASOS).sort());
});

for (const fila of filasSelect()) {
  const c = CASOS[fila.campo];
  const nombre = `${c.issue} ${fila.campo}`;

  test(`${nombre}: las opciones salen del formulario real`, () => {
    c.opcionesReales();
  });

  // Un formulario sin el select no es la pagina de edicion que creemos: la lista de
  // opciones vacia es lo que hace que la decision se abstenga de escribir.
  test(`${nombre}: sin el select no hay opciones (y entonces no se escribe nada)`, () => {
    assert.deepEqual(opcionesEncabezado('<form><input name="delivery_date" value="2026-08-26"></form>', fila), []);
    assert.deepEqual(opcionesEncabezado('<html><body>otra pagina</body></html>', fila), []);
    assert.deepEqual(opcionesEncabezado('', fila), []);
    assert.deepEqual(opcionesEncabezado(null, fila), []);
  });

  test(`${nombre}: el valor elegido distinto del del quote SI se escribe`, () => {
    const d = decidirCampoSelect(fila, { esperado: c.escribe.esperado, actual: c.escribe.actual, opciones: c.opciones });
    assert.equal(d.escribir, true);
    assert.equal(d[fila.llaveDecision], c.escribe.valor);
  });

  // Escribir sin necesidad solo agrega riesgo (mismo criterio que la vigencia, #106).
  test(`${nombre}: el quote que ya tiene ese valor no se repostea`, () => {
    const d = decidirCampoSelect(fila, { ...c.yaCorrecto, opciones: c.opciones });
    assert.equal(d.escribir, false);
    assert.equal(d.yaCorrecto, true);
  });

  // Los tres motivos de abstencion. Ninguno tumba la cotizacion: el quote ya existe y
  // lo unico que queda mal es el encabezado, asi que se reporta y se sigue.
  test(`${nombre}: sin valor, sin campo o fuera de las opciones no se escribe y se da el motivo`, () => {
    const sin = decidirCampoSelect(fila, { esperado: null, actual: c.sinValor.actual, opciones: c.opciones });
    assert.equal(sin.escribir, false);
    for (const re of c.sinValor.motivo) assert.match(sin.motivo, re);

    const sinCampo = decidirCampoSelect(fila, { esperado: c.sinCampo.esperado, actual: undefined, opciones: c.opciones });
    assert.equal(sinCampo.escribir, false);
    for (const re of c.sinCampo.motivo) assert.match(sinCampo.motivo, re);

    const ajeno = decidirCampoSelect(fila, { esperado: c.ajeno.esperado, actual: c.ajeno.actual, opciones: c.opciones });
    assert.equal(ajeno.escribir, false);
    for (const re of c.ajeno.motivo) assert.match(ajeno.motivo, re);
  });
}

// La tabla declara la excepcion de la vigencia y el hueco del domicilio, que #521 NO
// cierra: se escribe solo al actualizar y no se relee, no se reporta ni se reintenta.
test('#521 la vigencia es la fila fecha y el domicilio solo se escribe al actualizar', () => {
  assert.deepEqual(FILAS_ENCABEZADO_QUOTE.map(f => [f.campo, f.tipo]), [
    ['vigencia', 'fecha'], ['lista', 'select'], ['domicilio', 'select'], ['transportista', 'select'],
    ['telefonoEntrega', 'texto'], ['correoEntrega', 'texto'],
  ]);
  const domicilio = filaEncabezado('domicilio');
  assert.deepEqual(
    [domicilio.momentos.crear, domicilio.momentos.actualizar, domicilio.momentos.releer, domicilio.momentos.reportar, domicilio.momentos.reintentar],
    [false, true, false, false, false],
  );
  assert.deepEqual(filasSelect('crear').map(f => f.campo), ['lista', 'transportista']);
  assert.deepEqual(filasSelect('veredicto').map(f => f.campo), ['lista']);
});

// El texto que Adrian acepto en la revision de #521: cuando el post-fix fallo antes de
// escribir y la linea de /admin no tiene nombre, el aviso nombra el transportista por
// su id en vez de imprimir "undefined".
test('#521 el aviso del transportista sin nombre de linea dice el id, nunca undefined', () => {
  const r = {
    aplica: true, esperado: '3', escrita: false, yaCorrecto: false, ok: false, verificado: false, encontrado: null,
    motivo: 'el post-fix fallo antes de escribir: sin red',
  };
  const paso = pasoEncabezadoQuote(filaEncabezado('transportista'), '1300', r, { shipVia: 3, linea: undefined, motivo: null });
  assert.equal(paso.mensaje, 'Revisa el transportista de la cotizacion en Operam: pudo quedar con el del domicilio en vez de 3');
  assert.equal(paso.detalle, 'quote 1300: se esperaba el transportista 3 y no se envio -- el post-fix fallo antes de escribir: sin red');
});

// #556: telefono y correo del Contacto de entrega, filas `texto` con los momentos del
// brief (crear, actualizar, releer, reportar, reintentar; no barrido ni veredicto).
test('#556 telefono y correo del Contacto de entrega: filas texto con sus llaves y momentos', () => {
  for (const [campo, llaveFormulario, llaveApi] of [['telefonoEntrega', 'phone', 'contact_phone'], ['correoEntrega', 'email', 'contact_email']]) {
    const f = filaEncabezado(campo);
    assert.equal(f.llaveFormulario, llaveFormulario);
    assert.equal(f.llaveApi, llaveApi);
    assert.deepEqual(f.momentos, { crear: true, actualizar: true, releer: true, reportar: true, reintentar: true, barrido: false, veredicto: false });
  }
  assert.deepEqual(filasCampo('crear').map(f => f.campo), ['lista', 'transportista', 'telefonoEntrega', 'correoEntrega']);
  assert.deepEqual(filasCampo('reintentar').map(f => f.campo), ['lista', 'transportista', 'telefonoEntrega', 'correoEntrega']);
  assert.deepEqual(filasSelect('veredicto').map(f => f.campo), ['lista']);
});

// Verificacion (a) del encargo: su lugar en la huella es el contactPhone/contactEmail
// del objeto base (#329), no un campo tardio. Los tardios y su orden no se mueven.
test('#556 las filas nuevas no entran a los campos tardios de la huella', () => {
  assert.deepEqual(FILAS_HUELLA.map(f => [f.huella.llave, f.huella.posicion]), [
    ['listaId', 1], ['branchId', 2], ['shipVia', 3], ['vigencia', 4],
  ]);
});

test('#556 decidirCampoTexto: el vacio SE escribe y el formulario prellenado no cuenta como ya correcto', () => {
  const fila = filaEncabezado('telefonoEntrega');
  assert.deepEqual(decidirCampoTexto(fila, { esperado: '', actual: '+52 55 3466 7682' }), { escribir: true, contactPhone: '' });
  assert.deepEqual(decidirCampoTexto(fila, { esperado: '+52 55 3466 7682', actual: '+52 55 3466 7682' }), { escribir: true, contactPhone: '+52 55 3466 7682' });
  assert.deepEqual(decidirCampoTexto(fila, { esperado: ' 5512345678 ', actual: '' }), { escribir: true, contactPhone: '5512345678' });
});

test('#556 decidirCampoTexto: sin valor pasado o sin el campo en el formulario no se escribe y se da el motivo', () => {
  const fila = filaEncabezado('correoEntrega');
  const sin = decidirCampoTexto(fila, { esperado: undefined, actual: '' });
  assert.equal(sin.escribir, false);
  assert.match(sin.motivo, /correo/);
  const sinCampo = decidirCampoTexto(fila, { esperado: 'a@b.test', actual: undefined });
  assert.equal(sinCampo.escribir, false);
  assert.match(sinCampo.motivo, /email/);
});

test('#556 el paso del telefono nombra el vacio en vez de dejar un hueco', () => {
  const fila = filaEncabezado('telefonoEntrega');
  const ok = pasoEncabezadoQuote(fila, '1330', { aplica: true, esperado: '', escrita: true, yaCorrecto: false, ok: true, verificado: true, encontrado: '', motivo: null });
  assert.equal(ok.name, 'telefono del Contacto de entrega');
  assert.equal(ok.status, 'ok');
  assert.equal(ok.detalle, 'quote 1330 contact_phone (vacio)');
  const mal = pasoEncabezadoQuote(fila, '1330', { aplica: true, esperado: '', escrita: true, yaCorrecto: false, ok: false, verificado: true, encontrado: '+52 55 3466 7682', motivo: null });
  assert.equal(mal.status, 'warn');
  assert.equal(mal.mensaje, 'Revisa el telefono de contacto de la cotizacion en Operam: pudo quedar con el de otra persona');
  assert.equal(mal.detalle, 'quote 1330: se esperaba el telefono (vacio) y se leyo +52 55 3466 7682');
});
