'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { resolveClienteId } = require('./helpers.cjs');

let buildAltaDarDeAltaPayload, interpretarRespuestaAlta, errorAltaSinConfirmar, ALTA_PASO_FILA, usoCfdiParaPayload, usoCfdiCuentaComoElegido;
before(async () => {
  ({ buildAltaDarDeAltaPayload, interpretarRespuestaAlta, errorAltaSinConfirmar, ALTA_PASO_FILA, usoCfdiParaPayload, usoCfdiCuentaComoElegido } = await import('../alta-logica.js'));
});

test('F1: buildAltaDarDeAltaPayload incluye campos comerciales y domicilio', () => {
  const csfDatos = {
    rfc: 'TST010101ABC', razonSocial: 'Test SA de CV', nombreCorto: 'Test SA',
    idcif: '12345', regimenFiscal: '601', cp: '06600', municipio: 'Cuauhtemoc', estado: 'CDMX',
  };
  const comercial = { sales_type: 'M350', segmento_id: '3', salesman: '47', uso_cfdi: 'G03', invoice_email: 'fact@test.com', celular_nota: '5599998888' };
  const domicilio = {
    br_name: 'Almacen', br_ref: 'ALM', pais: 'MX',
    addr_street: 'Reforma', addr_exterior: '1', addr_interior: '',
    addr_colony: 'Juarez', addr_city: 'CDMX', addr_state: 'CDMX',
    addr_zip: '06600', addr_reference: '', phone: '5512345678', email: 'x@x.com',
  };
  const payload = buildAltaDarDeAltaPayload(csfDatos, comercial, domicilio, null, null);
  assert.strictEqual(payload.tax_id, 'TST010101ABC');
  assert.strictEqual(payload.sales_type, 'M350');
  assert.strictEqual(payload.segmento_id, '3');
  assert.strictEqual(payload.salesman, '47');
  assert.strictEqual(payload.timbrado_uso_cfdi, 'G03');
  assert.strictEqual(payload.pais, 'MX');
  assert.ok(payload.entrega, 'debe incluir entrega');
  assert.strictEqual(payload.entrega.br_name, 'Almacen');
  assert.strictEqual(payload.customer_id, null, 'customer_id null cuando no hay reintento');
  assert.strictEqual(payload.branch_id, null, 'branch_id null cuando no hay reintento');
});

test('F1b: buildAltaDarDeAltaPayload incluye invoice_email y celular_nota (issues #17/#18)', () => {
  const comercial = { sales_type: 'M350', segmento_id: '3', salesman: '47', uso_cfdi: 'G03', invoice_email: 'fact@test.com', celular_nota: '5599998888' };
  const payload = buildAltaDarDeAltaPayload({}, comercial, {}, null, null);
  assert.strictEqual(payload.invoice_email, 'fact@test.com');
  assert.strictEqual(payload.celular_nota, '5599998888');
});

test('F1c: buildAltaDarDeAltaPayload reusa phone/email del domicilio de entrega como contacto principal (issue #16)', () => {
  const domicilio = { phone: '+52 5512345678', email: 'entrega@test.com' };
  const payload = buildAltaDarDeAltaPayload({}, {}, domicilio, null, null);
  assert.strictEqual(payload.phone, '+52 5512345678', 'phone a nivel cliente debe reusar el del domicilio de entrega');
  assert.strictEqual(payload.email, 'entrega@test.com', 'email a nivel cliente debe reusar el del domicilio de entrega');
});

test('F1d: buildAltaDarDeAltaPayload propaga actividades y csf_fecha de la CSF (issue #171)', () => {
  const csfDatos = { rfc: 'TST010101ABC', razonSocial: 'Test SA de CV', actividades: ['Comercio al por menor'], csf_fecha: '8 DE MAYO DE 2026' };
  const payload = buildAltaDarDeAltaPayload(csfDatos, {}, {}, null, null);
  assert.deepEqual(payload.actividades, ['Comercio al por menor']);
  assert.strictEqual(payload.csf_fecha, '8 DE MAYO DE 2026');
});

test('F1e: buildAltaDarDeAltaPayload sin actividades en la CSF envia lista vacia (no undefined)', () => {
  const payload = buildAltaDarDeAltaPayload({}, {}, {}, null, null);
  assert.deepEqual(payload.actividades, []);
  assert.strictEqual(payload.csf_fecha, '');
});

test('F2: buildAltaDarDeAltaPayload pasa customer_id y branch_id para reintento', () => {
  const payload = buildAltaDarDeAltaPayload({}, {}, {}, 502, 602);
  assert.strictEqual(payload.customer_id, 502);
  assert.strictEqual(payload.branch_id, 602);
});

// === resolveClienteId (issue #31) ===

test('G1: resolveClienteId retorna clienteExistente.id cuando esta definido', () => {
  const state = { clienteExistente: { id: 77, branchIdx: 0 }, customer_id: null };
  assert.strictEqual(resolveClienteId(state), 77);
});

test('G2: resolveClienteId retorna customer_id cuando no hay clienteExistente', () => {
  const state = { clienteExistente: null, customer_id: 502 };
  assert.strictEqual(resolveClienteId(state), 502);
});

test('G3: resolveClienteId retorna null cuando no hay ninguno', () => {
  const state = { clienteExistente: null, customer_id: null };
  assert.strictEqual(resolveClienteId(state), null);
});

test('G4: resolveClienteId prefiere clienteExistente.id sobre customer_id en reintento', () => {
  const state = { clienteExistente: { id: 88 }, customer_id: 502 };
  assert.strictEqual(resolveClienteId(state), 88);
});

// === interpretarRespuestaAlta / errorAltaSinConfirmar (issue #213) ===
//
// El panel de la Seccion 4 se comia en silencio cualquier respuesta SIN `steps`
// (el 400 de "Falta el RFC"): las filas volvian a pending, `data.error` no se leia
// y el vendedor veia exactamente cero cambio. Estos tests existen porque esa
// decision ahora vive en un nucleo puro; dentro de app.js no habia forma de probarla.

test('H1: respuesta 400 sin steps expone el motivo del servidor (regresion #213)', () => {
  const r = interpretarRespuestaAlta({ error: 'Falta el RFC (tax_id)' });
  assert.strictEqual(r.exito, false);
  assert.strictEqual(r.mensajeError, 'Falta el RFC (tax_id)', 'el motivo del server NO se descarta');
  assert.strictEqual(r.mostrarReintentar, true);
  assert.ok(r.filas.every(f => f.status === 'pending'), 'sin steps ninguna fila queda girando');
});

test('H2: respuesta sin steps NI error igual dice algo (nunca silencio)', () => {
  for (const vacia of [null, undefined, {}, { ok: false }]) {
    const r = interpretarRespuestaAlta(vacia);
    assert.strictEqual(r.exito, false);
    assert.ok(r.mensajeError && r.mensajeError.trim(), `respuesta ${JSON.stringify(vacia)} debe dejar mensaje`);
  }
});

test('H3: ok:false con steps pinta la fila que fallo y sube su motivo al banner', () => {
  const r = interpretarRespuestaAlta({
    ok: false,
    steps: [
      { name: 'POST customer', status: 'ok' },
      { name: 'GET branch_id', status: 'error', error: 'Operam 404' },
    ],
  });
  assert.strictEqual(r.exito, false);
  assert.strictEqual(r.mostrarReintentar, true);
  const branch = r.filas.find(f => f.fila === ALTA_PASO_FILA['GET branch_id']);
  assert.strictEqual(branch.status, 'error');
  assert.strictEqual(branch.msg, 'Operam 404');
  assert.strictEqual(r.mensajeError, 'Operam 404', 'el motivo tambien va al banner visible');
});

test('H4: ok:true no muestra error ni reintentar', () => {
  const r = interpretarRespuestaAlta({
    ok: true,
    steps: [{ name: 'POST customer', status: 'ok' }, { name: 'PUT branch', status: 'ok' }],
  });
  assert.strictEqual(r.exito, true);
  assert.strictEqual(r.mensajeError, null);
  assert.strictEqual(r.mostrarReintentar, false);
});

test('H5: los steps se mapean por NOMBRE, nunca por posicion (#112)', () => {
  const r = interpretarRespuestaAlta({
    ok: false,
    steps: [
      { name: 'PUT customer (config comercial)', status: 'ok' },
      { name: 'paso que el panel no pinta', status: 'ok' },
      { name: 'PUT branch', status: 'error', error: 'boom' },
    ],
  });
  const branch = r.filas.find(f => f.fila === ALTA_PASO_FILA['PUT branch']);
  assert.strictEqual(branch.status, 'error', 'PUT branch cae en SU fila, no en la tercera');
  assert.strictEqual(branch.msg, 'boom');
});

test('H6: un step que no corrio vuelve a pending, no se queda girando', () => {
  const r = interpretarRespuestaAlta({ ok: false, steps: [{ name: 'POST customer', status: 'error', error: 'x' }] });
  const branch = r.filas.find(f => f.fila === ALTA_PASO_FILA['PUT branch']);
  assert.strictEqual(branch.status, 'pending');
});

test('H7: errorAltaSinConfirmar corta el alta cuando la Seccion 1 no dejo RFC (#213)', () => {
  for (const sinRfc of [null, undefined, {}, { rfc: '' }, { rfc: '   ' }]) {
    const msg = errorAltaSinConfirmar(sinRfc);
    assert.ok(msg, `debe cortar con ${JSON.stringify(sinRfc)}`);
    assert.match(msg, /Seccion 1/, 'el mensaje dice QUE hacer, no solo que fallo');
  }
});

test('H8: errorAltaSinConfirmar deja pasar cuando la Seccion 1 si quedo confirmada', () => {
  assert.strictEqual(errorAltaSinConfirmar({ rfc: 'XEXX010101000' }), null);
});

// === Cliente existente elegido por dedup (issue #250) ===
//
// El alta corria los PUT del camino de creacion sobre el cliente que el vendedor
// eligio con "Usar este cliente" y le piso su configuracion. El servidor ya no lo
// hace, pero solo puede distinguir ese caso del reintento si el payload lo dice.

test('I1: con cliente existente el payload lleva la marca cliente_existente', () => {
  const payload = buildAltaDarDeAltaPayload({}, {}, {}, 15, null, { clienteExistente: true });
  assert.strictEqual(payload.cliente_existente, true);
  assert.strictEqual(payload.customer_id, 15);
});

test('I2: el reintento de un alta NUEVA no manda la marca (su sucursal si se configura)', () => {
  const payload = buildAltaDarDeAltaPayload({}, {}, {}, 502, 602);
  assert.notStrictEqual(payload.cliente_existente, true, 'sin marca, el customer_id significa reintento');
});

test('I3: sobre un cliente existente el default G03 del formulario NO viaja como si lo hubiera elegido el vendedor', () => {
  const payload = buildAltaDarDeAltaPayload({}, { uso_cfdi: 'G03' }, {}, 15, null, { clienteExistente: true });
  assert.strictEqual(payload.timbrado_uso_cfdi, '', 'un default no es una eleccion: no se le escribe encima al cliente');
});

test('I4: sobre un cliente existente el uso de CFDI que el vendedor SI eligio viaja', () => {
  const payload = buildAltaDarDeAltaPayload({}, { uso_cfdi: 'S01' }, {}, 15, null, { clienteExistente: true, usoCfdiElegido: true });
  assert.strictEqual(payload.timbrado_uso_cfdi, 'S01');
});

test('I5: en un alta NUEVA el uso de CFDI viaja siempre (el cliente nace con el)', () => {
  const payload = buildAltaDarDeAltaPayload({}, { uso_cfdi: 'G03' }, {}, null, null);
  assert.strictEqual(payload.timbrado_uso_cfdi, 'G03');
});

test('I6: usoCfdiParaPayload decide por cliente existente + eleccion explicita', () => {
  assert.strictEqual(usoCfdiParaPayload({ clienteExistente: true, usoCfdiElegido: false, valor: 'G03' }), '');
  assert.strictEqual(usoCfdiParaPayload({ clienteExistente: true, usoCfdiElegido: true, valor: 'S01' }), 'S01');
  assert.strictEqual(usoCfdiParaPayload({ clienteExistente: false, usoCfdiElegido: false, valor: 'G03' }), 'G03');
});

// === El panel deja de dar paloma muda (issue #250, criterio 5) ===

test('I7: el segmento conservado se ve en su fila, no como exito mudo', () => {
  const r = interpretarRespuestaAlta({
    ok: true,
    steps: [
      { name: 'POST customer', status: 'ok', info: 'reintento' },
      { name: 'post-fix segmento (web)', status: 'ok', info: 'conservado', actual: '9', actualNombre: 'Familia y Amigos' },
    ],
  });
  const seg = r.filas.find(f => f.fila === ALTA_PASO_FILA['post-fix segmento (web)']);
  assert.strictEqual(seg.status, 'ok');
  assert.ok(seg.msg && seg.msg.trim(), 'una escritura omitida a proposito tiene que decirse');
  assert.ok(seg.msg.includes('Familia y Amigos'), 'con el segmento que se conservo');
  assert.strictEqual(r.exito, true);
});

test('I8: un paso omitido se pinta omitido, con su motivo, y no es un fallo del alta', () => {
  const r = interpretarRespuestaAlta({
    ok: true,
    steps: [
      { name: 'POST customer', status: 'ok', info: 'reintento' },
      { name: 'PUT customer (config comercial)', status: 'omitido', info: 'Sin cambios de configuracion comercial' },
      { name: 'GET branch_id', status: 'ok' },
      { name: 'PUT branch', status: 'omitido', info: 'Cliente existente: se conserva su domicilio en Operam' },
    ],
  });
  const branch = r.filas.find(f => f.fila === ALTA_PASO_FILA['PUT branch']);
  assert.strictEqual(branch.status, 'omitido');
  assert.strictEqual(branch.msg, 'Cliente existente: se conserva su domicilio en Operam');
  const comercial = r.filas.find(f => f.fila === ALTA_PASO_FILA['PUT customer (config comercial)']);
  assert.strictEqual(comercial.status, 'omitido');
  assert.strictEqual(comercial.msg, 'Sin cambios de configuracion comercial');
  assert.strictEqual(r.exito, true);
  assert.strictEqual(r.mensajeError, null, 'omitido no es error');
  assert.strictEqual(r.mostrarReintentar, false);
});

test('I9: un status desconocido sigue siendo error (solo ok y omitido son buenos)', () => {
  const r = interpretarRespuestaAlta({ ok: false, steps: [{ name: 'PUT branch', status: 'warn', error: 'algo raro' }] });
  const branch = r.filas.find(f => f.fila === ALTA_PASO_FILA['PUT branch']);
  assert.strictEqual(branch.status, 'error');
  assert.strictEqual(r.mensajeError, 'algo raro');
});

// #251: el borrador (#185) repone el select sin disparar `change`; lo que decide si el
// valor restaurado cuenta como eleccion es que difiera del default vigente.
test('I10: un uso de CFDI restaurado distinto del default cuenta como eleccion; el default o vacio no', () => {
  assert.strictEqual(usoCfdiCuentaComoElegido({ valor: 'S01', defaultVigente: 'G03' }), true, 'S01 restaurado sobre default G03 = el vendedor lo cambio');
  assert.strictEqual(usoCfdiCuentaComoElegido({ valor: 'G03', defaultVigente: 'G03' }), false, 'sigue en su default = no eligio');
  assert.strictEqual(usoCfdiCuentaComoElegido({ valor: '', defaultVigente: 'G03' }), false, 'vacio nunca es eleccion');
  assert.strictEqual(usoCfdiCuentaComoElegido(), false, 'sin datos no es eleccion');
});
