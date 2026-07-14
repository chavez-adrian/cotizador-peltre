import { test } from 'node:test';
import assert from 'node:assert/strict';

// Logica pura del alta temprana de cliente generico (issue #81, ADR-0006).
// El comportamiento de punta a punta se prueba por HTTP en operam-generico.test.js;
// aqui solo las decisiones puras del modulo lib/alta-generica.js.

const { rfcGenericoPara, necesitaAltaGenerica, buildClienteGenerico, resolverSalesTypeId, FUENTE_ALTA_GENERICA, buildBranchGenerico, diffBranchDomicilio } =
  await import('../lib/alta-generica.js');

test('rfcGenericoPara: MX o ausente -> XAXX; extranjero -> XEXX', () => {
  assert.equal(rfcGenericoPara('MX'), 'XAXX010101000');
  assert.equal(rfcGenericoPara(''), 'XAXX010101000');
  assert.equal(rfcGenericoPara(undefined), 'XAXX010101000');
  assert.equal(rfcGenericoPara('US'), 'XEXX010101000');
  assert.equal(rfcGenericoPara('CA'), 'XEXX010101000');
});

// necesitaAltaGenerica opera sobre la ENTRADA del store (no solo data.cliente):
// el nombre resoluble puede venir del registro (entry.cliente).
function entryCon(cliente) {
  return { cliente: 'Hotel Azul', data: { cliente: { razonSocial: 'Hotel Azul Centro', telefono: '+52 5588776655', ...cliente } } };
}

test('necesitaAltaGenerica: sin customerId y sin RFC, con datos minimos -> true', () => {
  assert.equal(necesitaAltaGenerica(entryCon({})), true);
  assert.equal(necesitaAltaGenerica(entryCon({ rfc: '' })), true);
  assert.equal(necesitaAltaGenerica(entryCon({ rfc: '   ' })), true);
});

test('necesitaAltaGenerica: RFC generico capturado NO identifica (ADR-0001) -> true', () => {
  assert.equal(necesitaAltaGenerica(entryCon({ rfc: 'XAXX010101000' })), true);
  assert.equal(necesitaAltaGenerica(entryCon({ rfc: 'xexx010101000 ' })), true);
});

test('necesitaAltaGenerica: con customerId o RFC real -> false (camino actual sin cambios)', () => {
  assert.equal(necesitaAltaGenerica(entryCon({ customerId: 42 })), false);
  assert.equal(necesitaAltaGenerica(entryCon({ operamId: 42 })), false);
  assert.equal(necesitaAltaGenerica(entryCon({ rfc: 'PNA010203ABC' })), false);
  assert.equal(necesitaAltaGenerica(entryCon({ customerId: 42, rfc: 'XAXX010101000' })), false);
});

test('F1: sin datos minimos del contacto -> false (camino viejo con su 422, sin cliente fantasma)', () => {
  assert.equal(necesitaAltaGenerica(undefined), false);
  assert.equal(necesitaAltaGenerica({}), false);
  assert.equal(necesitaAltaGenerica({ cliente: '', data: { cliente: {} } }), false);
  // Sin telefono no hay llave de dedup de capa 1 (celular).
  assert.equal(necesitaAltaGenerica({ cliente: 'Hotel Azul', data: { cliente: { razonSocial: 'Hotel Azul' } } }), false);
  // Sin nombre resoluble, detectarDuplicados con tokens vacios siempre da 'libre'.
  assert.equal(necesitaAltaGenerica({ cliente: '', data: { cliente: { telefono: '+52 5588776655' } } }), false);
  assert.equal(necesitaAltaGenerica({ cliente: '  ', data: { cliente: { razonSocial: ' ', telefono: '+52 5588776655' } } }), false);
  // El nombre del registro (entry.cliente) SI resuelve.
  assert.equal(necesitaAltaGenerica({ cliente: 'Hotel Azul', data: { cliente: { telefono: '+52 5588776655' } } }), true);
});

test('buildClienteGenerico: nombre real, RFC por pais, vendedor y lista de precios', () => {
  const entry = {
    cliente: 'Hotel Azul', vendedor: 'Alejandro Chavez', tier: 'M100',
    data: { cliente: {
      razonSocial: 'Hotel Azul Centro', nombreCorto: 'Hotel Azul',
      telefono: '+52 5588776655', pais: 'MX', emailEntrega: 'compras@hotelazul.mx',
    } },
  };
  const c = buildClienteGenerico(entry, { salesman: 2, salesTypeId: '15' });
  assert.equal(c.tax_id, 'XAXX010101000');
  assert.equal(c.CustName, 'Hotel Azul Centro');
  assert.equal(c.cust_ref, 'Hotel Azul');
  assert.equal(c.salesman, 2);
  assert.equal(c.sales_type, '15');
  assert.equal(c.phone, '+52 5588776655');
  assert.equal(c.celular_nota, '+52 5588776655');
  assert.equal(c.email, 'compras@hotelazul.mx');
  assert.equal(c.pais, 'MX');
});

// Regla 3 (issue #95): el email de facturacion capturado en cl-email-factura
// (leerClienteFormulario -> data.cliente.emailFactura) debe persistirse en
// invoice_email -- antes buildClienteGenerico no lo leia en absoluto (regresion
// detectada en #39, gap #14 de MAPEO_CAMPOS_CLIENTE.md).
test('buildClienteGenerico: email de facturacion capturado -> invoice_email (issue #95 regla 3)', () => {
  const entry = { data: { cliente: {
    razonSocial: 'Hotel Azul Centro', telefono: '+52 5588776655',
    emailFactura: 'facturacion@hotelazul.mx',
  } } };
  const c = buildClienteGenerico(entry, {});
  assert.equal(c.invoice_email, 'facturacion@hotelazul.mx');
});

test('buildClienteGenerico: sin email de facturacion capturado no manda invoice_email', () => {
  const entry = { data: { cliente: { razonSocial: 'Hotel Azul Centro', telefono: '+52 5588776655' } } };
  const c = buildClienteGenerico(entry, {});
  assert.ok(!('invoice_email' in c));
});

test('buildClienteGenerico: extranjero -> XEXX; sin vendedor/lista mapeables no manda los campos', () => {
  const entry = { data: { cliente: { razonSocial: 'Blue Hotel LLC', pais: 'US' } } };
  const c = buildClienteGenerico(entry, {});
  assert.equal(c.tax_id, 'XEXX010101000');
  assert.equal(c.pais, 'US');
  assert.ok(!('salesman' in c), 'sin operam_id mapeado no debe mandar salesman');
  assert.ok(!('sales_type' in c), 'sin lista mapeada no debe mandar sales_type');
});

test('buildClienteGenerico: sin razon social cae al nombre corto y al cliente del registro', () => {
  assert.equal(buildClienteGenerico({ data: { cliente: { nombreCorto: 'Azul' } } }, {}).CustName, 'Azul');
  assert.equal(buildClienteGenerico({ cliente: 'Hotel Azul', data: { cliente: {} } }, {}).CustName, 'Hotel Azul');
});

test('FUENTE_ALTA_GENERICA distingue el alta generica en clientes_log de las fuentes del alta manual', () => {
  assert.equal(FUENTE_ALTA_GENERICA, 'cotizador-generico');
  assert.ok(!['csf-upload', 'cotizador'].includes(FUENTE_ALTA_GENERICA));
});

// issue #92: el tier Menudeo (y cualquier tier sin lista homonima en Operam) no
// debe omitir sales_type -- eso delega el default de Operam (M550), el peor caso
// para un cliente de menudeo. Cae a "Precio de lista", resuelta por NOMBRE.
const LISTAS = [
  { id: 1, nombre: 'M550' }, { id: 3, nombre: 'M6000' }, { id: 6, nombre: 'M1500' },
  { id: 9, nombre: 'Segundas' }, { id: 12, nombre: 'Precio de lista' },
  { id: 15, nombre: 'M100' }, { id: 16, nombre: 'M350' }, { id: 19, nombre: 'Amazon' },
  { id: 20, nombre: 'M6001' }, { id: 21, nombre: 'US100' },
];

test('resolverSalesTypeId: tier con lista homonima -> su id (sin cambios)', () => {
  assert.equal(resolverSalesTypeId('M100', LISTAS), 15);
  assert.equal(resolverSalesTypeId('M350', LISTAS), 16);
  assert.equal(resolverSalesTypeId('M550', LISTAS), 1);
  assert.equal(resolverSalesTypeId('M1500', LISTAS), 6);
  assert.equal(resolverSalesTypeId('M6000', LISTAS), 3);
});

test('resolverSalesTypeId: tier Menudeo (sin lista homonima) -> "Precio de lista"', () => {
  assert.equal(resolverSalesTypeId('Menudeo', LISTAS), 12);
});

test('resolverSalesTypeId: tier desconocido sin lista homonima -> mismo fallback', () => {
  assert.equal(resolverSalesTypeId('TierInventado', LISTAS), 12);
});

test('resolverSalesTypeId: ni el tier ni "Precio de lista" existen en el catalogo -> undefined', () => {
  const sinPrecioDeLista = LISTAS.filter(l => l.nombre !== 'Precio de lista');
  assert.equal(resolverSalesTypeId('Menudeo', sinPrecioDeLista), undefined);
});

test('resolverSalesTypeId: catalogo vacio -> undefined', () => {
  assert.equal(resolverSalesTypeId('Menudeo', []), undefined);
  assert.equal(resolverSalesTypeId('M100', undefined), undefined);
});

// issue #96: el domicilio de entrega del paso Envio -> body del PUT de branch. El
// paso Envio captura MENOS campos que el alta completa (no hay br_name/br_ref/
// numero exterior separado: la calle carga calle+numero); se mapea SOLO lo que
// /api/crear-cliente ya lleva al branch. addr_reference viene de `referencias`
// (indicaciones de entrega), NO de `referencia` (que es el cust_ref del quote).
const CLIENTE_ENTREGA = {
  razonSocial: 'Hotel Azul Centro', telefono: '+52 5588776655',
  nombreEntrega: 'Recepcion', calle: 'Av Reforma 100', numInt: 'Piso 3',
  colonia: 'Juarez', cpEntrega: '06600', municipio: 'Cuauhtemoc', estado: 'CDMX',
  celEntrega: '+52 5511223344', emailEntrega: 'entrega@hotelazul.mx',
  referencias: 'Entre calle A y B, porton negro', referencia: 'REF-QUOTE', pais: 'MX',
};

test('buildBranchGenerico: mapea el domicilio de entrega a los campos del branch', () => {
  const d = buildBranchGenerico(CLIENTE_ENTREGA, { salesman: 2 });
  assert.equal(d.addr_street, 'Av Reforma 100');
  assert.equal(d.addr_interior, 'Piso 3');
  assert.equal(d.addr_colony, 'Juarez');
  assert.equal(d.addr_zip, '06600');
  assert.equal(d.addr_city, 'Cuauhtemoc');
  assert.equal(d.addr_state, 'CDMX');
  assert.equal(d.addr_reference, 'Entre calle A y B, porton negro');
  assert.equal(d.phone, '+52 5511223344');
  assert.equal(d.email, 'entrega@hotelazul.mx');
  assert.equal(d.pais, 'MX');
  assert.equal(d.salesman, 2);
});

test('buildBranchGenerico: sin celular de entrega cae al telefono del contacto', () => {
  const d = buildBranchGenerico({ ...CLIENTE_ENTREGA, celEntrega: '' }, {});
  assert.equal(d.phone, '+52 5588776655');
  assert.ok(!('salesman' in d), 'sin salesman no lo manda');
});

test('buildBranchGenerico: sin calle o sin CP no hay domicilio util -> null (el caller omite el PUT)', () => {
  assert.equal(buildBranchGenerico({ ...CLIENTE_ENTREGA, calle: '' }, {}), null);
  assert.equal(buildBranchGenerico({ ...CLIENTE_ENTREGA, cpEntrega: '  ' }, {}), null);
  assert.equal(buildBranchGenerico({}, {}), null);
  assert.equal(buildBranchGenerico(null, {}), null);
});

test('buildBranchGenerico: NO emite br_name/br_ref (no los captura el paso Envio; Operam conserva el auto-creado)', () => {
  const d = buildBranchGenerico(CLIENTE_ENTREGA, {});
  assert.ok(!('br_name' in d));
  assert.ok(!('br_ref' in d));
});

// Verificacion post-PUT (#96, quirk #74): Operam responde result:true aunque
// ignore campos. Se relee el branch y se reportan SOLO los que intentamos escribir
// y no coinciden (los vacios no se verifican).
test('diffBranchDomicilio: branch que persistio todo -> sin discrepancias', () => {
  const enviado = buildBranchGenerico(CLIENTE_ENTREGA, {});
  const fresco = { addr_street: 'Av Reforma 100', addr_interior: 'Piso 3', addr_colony: 'Juarez',
    addr_city: 'Cuauhtemoc', addr_state: 'CDMX', addr_zip: '06600',
    addr_reference: 'Entre calle A y B, porton negro', phone: '+52 5511223344', email: 'entrega@hotelazul.mx' };
  assert.deepEqual(diffBranchDomicilio(fresco, enviado), []);
});

test('diffBranchDomicilio: campo ignorado por Operam se reporta como no actualizado', () => {
  const enviado = buildBranchGenerico(CLIENTE_ENTREGA, {});
  const fresco = { addr_street: 'Av Reforma 100', addr_zip: '' };
  const diff = diffBranchDomicilio(fresco, enviado);
  const zip = diff.find(x => x.campo === 'addr_zip');
  assert.ok(zip, 'reporta el CP no persistido');
  assert.equal(zip.nuevo, '06600');
  assert.ok(!diff.some(x => x.campo === 'addr_street'), 'el que si persistio no se reporta');
});
