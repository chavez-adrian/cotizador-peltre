import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  folioMaximoConocido, resolverVendedorPropuestoReal, candidatoCotizacionDesdeQuote,
  planearDescubrimiento, MOTIVOS,
} from '../lib/descubrimiento-operam.mjs';

// Nucleo PURO del descubrimiento recurrente (#126). Companero "hacia adelante"
// del lote historico de #124 (recolector-genericos.mjs): #126 reusa evaluarQuote
// tal cual para el camino generico, asi que estos tests se concentran en lo que
// #126 aporta -- el walk hacia arriba, el ruteo por tipo de debtor y el camino de
// cliente real, que #124 no tenia.

const VENDEDORES = [
  { id: 1, name: 'Adrián Chávez', operam_id: 1 },
  { id: 2, name: 'Alejandro Chávez', operam_id: 2 },
  { id: 3, name: 'Oswaldo Chávez', operam_id: 8 },
];

// --- folioMaximoConocido ---

test('folioMaximoConocido: el mayor entre folioOperam del store y folios de la bandeja', () => {
  const cotizaciones = [{ folioOperam: '1050' }, { folioOperam: '1002' }, { folioOperam: null }];
  const bandeja = [{ folio: '1071' }, { folio: '1003' }];
  assert.equal(folioMaximoConocido(cotizaciones, bandeja), 1071);
});

test('folioMaximoConocido: 0 cuando no hay nada conocido', () => {
  assert.equal(folioMaximoConocido([], []), 0);
  assert.equal(folioMaximoConocido(null, null), 0);
});

// --- resolverVendedorPropuestoReal: orden INVERSO al de recolector-genericos ---
// Aqui el debtor es un cliente nombrado: su `salesman` SI describe quien vendio.

test('resolverVendedorPropuestoReal: el salesman del quote manda', () => {
  const quote = { salesman: '2', user: { real_name: 'Alejandro Chavez' } };
  assert.equal(resolverVendedorPropuestoReal(quote, VENDEDORES), 'Alejandro Chávez');
});

test('resolverVendedorPropuestoReal: cae al creador cuando el salesman no mapea', () => {
  const quote = { salesman: '99', user: { real_name: 'Oswaldo Chavez' } };
  assert.equal(resolverVendedorPropuestoReal(quote, VENDEDORES), 'Oswaldo Chávez');
});

test('resolverVendedorPropuestoReal: null cuando ninguno mapea', () => {
  assert.equal(resolverVendedorPropuestoReal({}, VENDEDORES), null);
});

// --- candidatoCotizacionDesdeQuote: el payload que consume la aceptacion de #125 ---

const QUOTE_REAL = {
  ord_date: '2026-07-21', delivery_date: '2026-08-20', total: '48250.00',
  cust_ref: 'Remodelacion Hotel Valle', deliver_to: 'Mariana Gutierrez Solis',
  contact_phone: '+52 55 2314 8890', contact_email: 'mariana.gs@hotmail.com',
  delivery_address: 'Av. de los Insurgentes 1420, CDMX', debtor_no: '512',
  salesman: '2', user: { real_name: 'Adrian Chavez' },
  detalles: [{ stock_id: '250101001', stock_id_text: 'Taza 8 cm', quantity: 10, unit_price: 85 }],
};
const DEBTOR_512 = { debtor_no: 512, CustName: 'HOTELES DEL VALLE SA DE CV', tax_id: 'HVA160305MX8', curr_code: 'MXN' };

test('candidatoCotizacionDesdeQuote: arma el candidato tipo cotizacion con el quote completo + debtor', () => {
  const c = candidatoCotizacionDesdeQuote({ folio: 951, quote: QUOTE_REAL, debtor: DEBTOR_512, vendedores: VENDEDORES });
  assert.equal(c.folio, '951');
  assert.equal(c.tipo, 'cotizacion');
  assert.equal(c.fecha, '2026-07-21');
  assert.equal(c.contacto, 'Mariana Gutierrez Solis');
  assert.equal(c.celular, '+52 55 2314 8890');
  assert.equal(c.proyecto, 'Remodelacion Hotel Valle');
  assert.equal(c.monto, 48250);
  assert.equal(c.debtorId, 512);
  assert.equal(c.debtorNombre, 'HOTELES DEL VALLE SA DE CV');
  assert.equal(c.vendedor, 'Alejandro Chávez');
  assert.deepEqual(c.marcas, { comproOtraCosa: false, posibleDuplicado: false });
  // El payload COMPLETO del quote viaja en `quote`, con el debtor ya resuelto
  // anexado (#125 construye la oportunidad desde este payload, sin volver a
  // hablar con Operam).
  assert.equal(c.quote.debtor.CustName, 'HOTELES DEL VALLE SA DE CV');
  assert.deepEqual(c.quote.detalles, QUOTE_REAL.detalles);
});

test('candidatoCotizacionDesdeQuote: quote.debtor es null si no se pudo resolver', () => {
  const c = candidatoCotizacionDesdeQuote({ folio: 951, quote: QUOTE_REAL, debtor: null, vendedores: VENDEDORES });
  assert.equal(c.quote.debtor, null);
});

// --- planearDescubrimiento: el walk hacia ARRIBA ---

const GENERICO_184 = { customer_id: 184, CustName: 'GENERICO TIENDAS DIGITALES', contacts: [], branches: [] };

function quoteGenerico(campos) {
  return {
    ord_date: '2026-08-01', debtor_no: '184', total: '1000.00',
    deliver_to: 'Cliente Nuevo', contact_phone: '5551234567',
    user: { real_name: 'Alejandro Chavez' }, ...campos,
  };
}

function quoteReal(campos) {
  return { ...QUOTE_REAL, ...campos };
}

function lector(porFolio) {
  const leidos = [];
  return {
    obtenerQuote: async (folio) => { leidos.push(Number(folio)); return porFolio[String(folio)] || null; },
    leidos,
  };
}

function base(porFolio, extra = {}) {
  const { obtenerQuote, leidos } = lector(porFolio);
  const obtenerCliente = extra.obtenerCliente || (async () => DEBTOR_512);
  return planearDescubrimiento({
    obtenerQuote, obtenerCliente,
    folioDesde: 1001,
    clientes: [GENERICO_184], pedidos: [], prospectos: [], vendedores: VENDEDORES,
    ...extra,
  }).then(plan => ({ plan, leidos }));
}

test('planearDescubrimiento: sin folioDesde no camina nada', async () => {
  const { plan, leidos } = await base({ 1001: quoteGenerico({}) }, { folioDesde: null });
  assert.deepEqual(plan.candidatos, []);
  assert.deepEqual(leidos, []);
});

test('planearDescubrimiento: camina hacia ARRIBA y clasifica generico como prospecto', async () => {
  const { plan, leidos } = await base({
    1001: quoteGenerico({ contact_phone: '5551110000' }),
    1002: quoteGenerico({ contact_phone: '5552220000' }),
  }, { maxRachaVacia: 3 });
  assert.deepEqual(leidos.slice(0, 2), [1001, 1002]);
  assert.equal(plan.candidatos.length, 2);
  assert.deepEqual(plan.candidatos.map(c => c.candidato.tipo), ['prospecto', 'prospecto']);
  assert.equal(plan.folioHasta, 1002);
});

test('planearDescubrimiento: un debtor de cliente REAL se clasifica como cotizacion con debtor resuelto', async () => {
  let pedido = null;
  const { plan } = await base({
    1001: quoteReal({ debtor_no: '512' }),
  }, {
    obtenerCliente: async (id) => { pedido = id; return DEBTOR_512; },
  });
  assert.equal(pedido, '512');
  assert.equal(plan.candidatos.length, 1);
  const [{ candidato, cruce }] = plan.candidatos;
  assert.equal(candidato.tipo, 'cotizacion');
  assert.equal(candidato.debtorId, 512);
  assert.equal(candidato.debtorNombre, 'HOTELES DEL VALLE SA DE CV');
  assert.equal(candidato.quote.debtor.tax_id, 'HVA160305MX8');
  assert.equal(cruce, null, 'un candidato tipo cotizacion no lleva cruce por identidad');
});

test('planearDescubrimiento: obtenerCliente se llama UNA sola vez por debtor aunque haya 2 quotes nuevos', async () => {
  let llamadas = 0;
  const { plan } = await base({
    1001: quoteReal({ debtor_no: '512' }),
    1002: quoteReal({ debtor_no: '512', cust_ref: 'Segundo pedido' }),
  }, {
    obtenerCliente: async () => { llamadas++; return DEBTOR_512; },
  });
  assert.equal(plan.candidatos.length, 2);
  assert.equal(llamadas, 1);
});

test('planearDescubrimiento: folio ya en el store de cotizaciones se salta (ya-existe)', async () => {
  const { plan } = await base({
    1001: quoteReal({ debtor_no: '512' }),
  }, { cotizaciones: [{ folioOperam: '1001' }] });
  assert.equal(plan.candidatos.length, 0);
  assert.equal(plan.skips.yaExiste, 1);
});

test('planearDescubrimiento: folio ya en la bandeja (cualquier estado) se salta', async () => {
  const { plan } = await base({
    1001: quoteGenerico({}),
  }, { bandejaFolios: ['1001'] });
  assert.equal(plan.candidatos.length, 0);
  assert.equal(plan.skips.yaEnBandeja, 1);
});

test('planearDescubrimiento: un quote cancelado en Operam se salta', async () => {
  const { plan } = await base({
    1001: quoteReal({ debtor_no: '512' }),
  }, { cancelados: ['1001'] });
  assert.equal(plan.candidatos.length, 0);
  assert.equal(plan.skips.cancelado, 1);
});

// --- exclusiones REUSADAS de #76 (no se reescriben, se importan) ---

test('planearDescubrimiento: debtor de prueba (1, "venta directa"/mostrador) se salta', async () => {
  const { plan } = await base({ 1001: quoteReal({ debtor_no: '1' }) });
  assert.equal(plan.candidatos.length, 0);
  assert.equal(plan.skips.prueba, 1);
});

// El 14 estuvo en DEBTORS_PRUEBA desde #76; #201 lo reclasifico como cajon
// (factura global de bazar) y ahora entra por la rama de esDebtorGenerico.
test('planearDescubrimiento: el debtor 14 (PUBLICO EN GENERAL) es cajon desde #201 y se propone como prospecto', async () => {
  const { plan } = await base({ 1001: quoteGenerico({ debtor_no: '14' }) });
  assert.equal(plan.candidatos.length, 1);
  assert.equal(plan.candidatos[0].candidato.tipo, 'prospecto');
});

test('planearDescubrimiento: debtor socio (9/15/132) se salta', async () => {
  const { plan } = await base({ 1001: quoteReal({ debtor_no: '15' }) });
  assert.equal(plan.candidatos.length, 0);
  assert.equal(plan.skips.socio, 1);
});

test('planearDescubrimiento: sucursal no-Tlapacoya (Shopify) se salta', async () => {
  const { plan } = await base({ 1001: quoteReal({ debtor_no: '512', user: { real_name: 'Shopify' } }) });
  assert.equal(plan.candidatos.length, 0);
  assert.equal(plan.skips.otraSucursal, 1);
});

test('planearDescubrimiento: folio excluido manualmente (#76) se salta', async () => {
  const { plan } = await base({ 1189: quoteReal({ debtor_no: '512' }) }, { folioDesde: 1189 });
  assert.equal(plan.candidatos.length, 0);
  assert.equal(plan.skips.excluidoManual, 1);
});

// --- camino generico: CERRO/total-cero pasan por evaluarQuote sin reescritura ---

test('planearDescubrimiento: un generico que ya CERRO (identidad+monto en banda) se salta', async () => {
  const CLIENTE_OBASAN = { customer_id: 500, CustName: 'OBASAN LIMITED', contacts: [], branches: [] };
  const PEDIDO_OBASAN = { order_no: 5236, debtor_no: 500, ord_date: '2026-08-04', total: '952.08' };
  const { plan } = await base({
    1001: quoteGenerico({
      debtor_no: '143', total: '952.08', deliver_to: 'Jean Corriveau',
      contact_phone: '+1 613-656-1374', cust_ref: 'Obasan',
    }),
  }, { clientes: [GENERICO_184, CLIENTE_OBASAN], pedidos: [PEDIDO_OBASAN] });
  assert.equal(plan.candidatos.length, 0);
  assert.equal(plan.skips.cerro, 1);
});

test('planearDescubrimiento: un generico de $0 se salta (total-cero)', async () => {
  const { plan } = await base({ 1001: quoteGenerico({ total: '0' }) });
  assert.equal(plan.candidatos.length, 0);
  assert.equal(plan.skips.totalCero, 1);
});

// --- racha vacia: tope de la corrida hacia arriba ---

test('planearDescubrimiento: una racha de 404 seguidos corta el walk', async () => {
  const { plan, leidos } = await base({
    1001: quoteReal({ debtor_no: '512' }),
    // 1002-1004 no existen todavia: con maxRachaVacia=3 el walk corta ahi.
  }, { maxRachaVacia: 3 });
  assert.equal(plan.candidatos.length, 1);
  assert.equal(plan.folioHasta, 1001);
  assert.deepEqual(leidos, [1001, 1002, 1003, 1004]);
});

test('planearDescubrimiento: folioHasta es el ultimo folio EXISTENTE, no el ultimo probado', async () => {
  const { plan } = await base({
    1001: quoteReal({ debtor_no: '512' }),
    1002: quoteReal({ debtor_no: '512', cust_ref: 'Otro' }),
  }, { maxRachaVacia: 2 });
  assert.equal(plan.folioHasta, 1002);
});

// --- reporte de motivos (contrato del endpoint: { nuevos, saltados, folioDesde, folioHasta }) ---

test('planearDescubrimiento: skips trae SIEMPRE todas las llaves de MOTIVOS, aunque esten en cero', () => {
  const claves = Object.values(MOTIVOS).map(m =>
    m.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
  ).sort();
  return base({}, { maxRachaVacia: 1 }).then(({ plan }) => {
    assert.deepEqual(Object.keys(plan.skips).sort(), claves);
  });
});
