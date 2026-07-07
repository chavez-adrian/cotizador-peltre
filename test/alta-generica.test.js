import { test } from 'node:test';
import assert from 'node:assert/strict';

// Logica pura del alta temprana de cliente generico (issue #81, ADR-0006).
// El comportamiento de punta a punta se prueba por HTTP en operam-generico.test.js;
// aqui solo las decisiones puras del modulo lib/alta-generica.js.

const { rfcGenericoPara, necesitaAltaGenerica, buildClienteGenerico, FUENTE_ALTA_GENERICA } =
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
