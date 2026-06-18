'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let buildClienteDesdeAlta, mensajeBusquedaCelular;
before(async () => {
  ({ buildClienteDesdeAlta, mensajeBusquedaCelular } = await import('../alta-logica.js'));
});

// === AC1/AC2 (#69): el estado capturado en el alta se comparte con el cotizador ===
// buildClienteDesdeAlta mapea altaState (datos fiscales + domicilio de entrega +
// customer_id) al MISMO objeto cliente que consume seleccionarClienteOperam, para
// prellenar la pestana de cliente del cotizador sin re-pedir datos ni round-trip a Operam.

const ALTA_STATE = {
  customer_id: 502,
  datos: {
    rfc: 'TST010101ABC', razonSocial: 'ACAI CON FRUTA SA DE CV', nombreCorto: 'Acai',
    cp: '06600',
  },
  domicilio: {
    br_name: 'Sucursal Centro', addr_street: 'Reforma', addr_exterior: '10', addr_interior: '3',
    addr_colony: 'Juarez', addr_zip: '06700', addr_city: 'Cuauhtemoc', addr_state: 'CDMX',
    phone: '+52 5512345678', email: 'pedidos@acai.com',
  },
};

test('C1: buildClienteDesdeAlta mapea razon social, nombre corto, rfc y customer_id', () => {
  const c = buildClienteDesdeAlta(ALTA_STATE);
  assert.strictEqual(c.id, 502);
  assert.strictEqual(c.name, 'ACAI CON FRUTA SA DE CV');
  assert.strictEqual(c.ref, 'Acai');
  assert.strictEqual(c.rfc, 'TST010101ABC');
});

test('C2: buildClienteDesdeAlta toma el domicilio de entrega (calle, colonia, municipio, estado, CP)', () => {
  const c = buildClienteDesdeAlta(ALTA_STATE);
  assert.strictEqual(c.calle, 'Reforma 10');
  assert.strictEqual(c.numInt, '3');
  assert.strictEqual(c.colonia, 'Juarez');
  assert.strictEqual(c.cp, '06700');
  assert.strictEqual(c.municipio, 'Cuauhtemoc');
  assert.strictEqual(c.estado, 'CDMX');
  assert.strictEqual(c.nombreEntrega, 'Sucursal Centro');
  assert.strictEqual(c.email, 'pedidos@acai.com');
});

test('C3: buildClienteDesdeAlta lleva el telefono ya combinado con codigo de pais (AC2: no se re-pide)', () => {
  const c = buildClienteDesdeAlta(ALTA_STATE);
  assert.strictEqual(c.telefono, '+52 5512345678');
});

test('C4: buildClienteDesdeAlta usa el CP fiscal (datos.cp) cuando el domicilio no tiene CP', () => {
  const sinCpEntrega = { ...ALTA_STATE, domicilio: { ...ALTA_STATE.domicilio, addr_zip: '' } };
  const c = buildClienteDesdeAlta(sinCpEntrega);
  assert.strictEqual(c.cp, '06600');
});

test('C5: buildClienteDesdeAlta no truena con altaState minimo o vacio', () => {
  assert.doesNotThrow(() => buildClienteDesdeAlta({}));
  const c = buildClienteDesdeAlta({});
  assert.strictEqual(c.name, '');
  assert.strictEqual(c.telefono, '');
});

// === AC3 (#69): busqueda por celular en el primer formulario ===
// mensajeBusquedaCelular traduce la clasificacion ({tipo}) de /api/prospectos/clasificar
// a una decision para la UI: prospecto/cliente existente -> avisar; libre -> sin aviso.

test('B1: mensajeBusquedaCelular reconoce un cliente existente', () => {
  const r = mensajeBusquedaCelular({ tipo: 'cliente', cust_name: 'ACAI CON FRUTA SA DE CV' });
  assert.strictEqual(r.encontrado, true);
  assert.strictEqual(r.tipo, 'cliente');
  assert.match(r.mensaje, /ACAI CON FRUTA SA DE CV/);
  assert.match(r.mensaje, /cliente/i);
});

test('B2: mensajeBusquedaCelular reconoce un prospecto existente y muestra nombre y vendedor (#69)', () => {
  const r = mensajeBusquedaCelular({ tipo: 'prospecto', prospecto: { nombre: 'Juan', vendedor: 'Ana' } });
  assert.strictEqual(r.encontrado, true);
  assert.strictEqual(r.tipo, 'prospecto');
  assert.match(r.mensaje, /prospecto/i);
  assert.match(r.mensaje, /Juan/);
  assert.match(r.mensaje, /Ana/);
});

test('B3: mensajeBusquedaCelular en celular libre no marca encontrado', () => {
  const r = mensajeBusquedaCelular({ tipo: 'libre' });
  assert.strictEqual(r.encontrado, false);
  assert.strictEqual(r.mensaje, '');
});

test('B4: mensajeBusquedaCelular tolera respuesta nula/invalida (best effort)', () => {
  assert.strictEqual(mensajeBusquedaCelular(null).encontrado, false);
  assert.strictEqual(mensajeBusquedaCelular(undefined).encontrado, false);
  assert.strictEqual(mensajeBusquedaCelular({}).encontrado, false);
});
