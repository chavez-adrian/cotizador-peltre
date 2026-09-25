'use strict';
// #447: lineas de transporte administrables en /admin. Nucleo puro compartido por
// el servidor (que carriers consulta envia.com, si Lalamove/Tresguerras cotizan,
// validacion del PUT) y el navegador (opciones del selector de envio).
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let lineasTransporte, carriersEnvia, lineaActiva, opcionesSelectorEnvio, validarLineasTransporte;
let restaurarEnvioDesdeCotizacion;
before(async () => {
  ({ lineasTransporte, carriersEnvia, lineaActiva, opcionesSelectorEnvio, validarLineasTransporte } =
    await import('../lineas-transporte-logica.js'));
  ({ restaurarEnvioDesdeCotizacion } = await import('../cotizar-logica.js'));
});

// Semilla del issue con los ids de ship_via confirmados por Adrian (comentario
// del 2026-09-24): FedEx 2, DHL 6, Estafeta 5, Lalamove 3, Tresguerras 4.
const SEMILLA_ESPERADA = [
  { nombre: 'FedEx', fuente: 'envia', codigo: 'fedex', shipVia: 2, activa: true },
  { nombre: 'DHL', fuente: 'envia', codigo: 'dhl', shipVia: 6, activa: true },
  { nombre: 'Estafeta', fuente: 'envia', codigo: 'estafeta', shipVia: 5, activa: true },
  { nombre: 'Lalamove', fuente: 'lalamove', codigo: null, shipVia: 3, activa: true },
  { nombre: 'Tresguerras', fuente: 'tresguerras', codigo: null, shipVia: 4, activa: true },
];

test('sin configuracion guardada la lista es la semilla (FedEx, DHL, Estafeta, Lalamove, Tresguerras)', () => {
  assert.deepStrictEqual(lineasTransporte(null), SEMILLA_ESPERADA);
  assert.deepStrictEqual(lineasTransporte({ tiposActivos: ['PL'] }), SEMILLA_ESPERADA);
});

test('una lista guardada manda, aunque sea vacia', () => {
  assert.deepStrictEqual(lineasTransporte({ lineasTransporte: [] }), []);
  const guardada = [{ nombre: 'Paquetexpress', fuente: 'envia', codigo: 'paquetexpress', shipVia: null, activa: true }];
  assert.deepStrictEqual(lineasTransporte({ lineasTransporte: guardada }), guardada);
});

test('con la semilla envia.com consulta FedEx, DHL y Estafeta, nunca UPS', () => {
  const carriers = carriersEnvia(lineasTransporte(null));
  assert.deepStrictEqual(carriers.map(c => c.codigo), ['fedex', 'dhl', 'estafeta']);
  assert.deepStrictEqual(carriers.map(c => c.nombre), ['FedEx', 'DHL', 'Estafeta']);
});

test('carriersEnvia ignora las lineas inactivas y las de integracion propia', () => {
  const lineas = [
    { nombre: 'FedEx', fuente: 'envia', codigo: 'fedex', shipVia: 2, activa: false },
    { nombre: 'J&T', fuente: 'envia', codigo: 'jtexpress', shipVia: null, activa: true },
    { nombre: 'Lalamove', fuente: 'lalamove', codigo: null, shipVia: 3, activa: true },
  ];
  assert.deepStrictEqual(carriersEnvia(lineas).map(c => c.codigo), ['jtexpress']);
});

test('lineaActiva: una integracion propia cotiza solo con su linea activa en la lista', () => {
  const semilla = lineasTransporte(null);
  assert.equal(lineaActiva(semilla, 'lalamove'), true);
  assert.equal(lineaActiva(semilla, 'tresguerras'), true);
  const sinLalamove = semilla.map(l => (l.fuente === 'lalamove' ? { ...l, activa: false } : l));
  assert.equal(lineaActiva(sinLalamove, 'lalamove'), false);
  assert.equal(lineaActiva(sinLalamove, 'tresguerras'), true);
  assert.equal(lineaActiva(semilla.filter(l => l.fuente !== 'tresguerras'), 'tresguerras'), false);
});

test('validarLineasTransporte acepta la lista del panel y normaliza el transportista de Operam', () => {
  const r = validarLineasTransporte([
    { nombre: ' Paquetexpress ', fuente: 'envia', codigo: ' paquetexpress ', shipVia: '', activa: true },
    { nombre: 'DHL', fuente: 'envia', codigo: 'dhl', shipVia: '6', activa: false },
    { nombre: 'Lalamove', fuente: 'lalamove', codigo: 'ignorado', shipVia: 3, activa: true },
  ]);
  assert.equal(r.error, undefined);
  assert.deepStrictEqual(r.lineas, [
    { nombre: 'Paquetexpress', fuente: 'envia', codigo: 'paquetexpress', shipVia: null, activa: true },
    { nombre: 'DHL', fuente: 'envia', codigo: 'dhl', shipVia: 6, activa: false },
    { nombre: 'Lalamove', fuente: 'lalamove', codigo: null, shipVia: 3, activa: true },
  ]);
});

test('validarLineasTransporte acepta la lista vacia (quitar todas es una decision)', () => {
  assert.deepStrictEqual(validarLineasTransporte([]), { lineas: [] });
});

test('validarLineasTransporte rechaza lo que no se puede cotizar, con el motivo', () => {
  const casos = [
    [{ lineas: 'x' }, /Formato invalido/],
    [[{ nombre: '', fuente: 'envia', codigo: 'dhl', activa: true }], /nombre/],
    [[{ nombre: 'UPS', fuente: 'fax', codigo: 'ups', activa: true }], /fuente/],
    [[{ nombre: 'UPS', fuente: 'envia', codigo: '  ', activa: true }], /codigo de envia.com/],
    [[{ nombre: 'UPS', fuente: 'envia', codigo: 'ups', shipVia: 'dos', activa: true }], /transportista de Operam/],
    [[{ nombre: 'UPS', fuente: 'envia', codigo: 'ups', shipVia: -1, activa: true }], /transportista de Operam/],
    [[{ nombre: 'UPS', fuente: 'envia', codigo: 'ups', shipVia: 1.5, activa: true }], /transportista de Operam/],
  ];
  for (const [entrada, motivo] of casos) {
    const r = validarLineasTransporte(entrada);
    assert.equal(r.lineas, undefined, JSON.stringify(entrada));
    assert.match(r.error, motivo);
  }
});

test('validarLineasTransporte rechaza el mismo carrier de envia.com dos veces y dos lineas de la misma integracion', () => {
  const dobleEnvia = validarLineasTransporte([
    { nombre: 'FedEx', fuente: 'envia', codigo: 'fedex', activa: true },
    { nombre: 'FedEx 2', fuente: 'envia', codigo: 'FedEx', activa: false },
  ]);
  assert.match(dobleEnvia.error, /fedex/i);
  const dobleLalamove = validarLineasTransporte([
    { nombre: 'Lalamove', fuente: 'lalamove', activa: true },
    { nombre: 'Lalamove bis', fuente: 'lalamove', activa: false },
  ]);
  assert.match(dobleLalamove.error, /lalamove/i);
});

test('con la semilla el selector ofrece paqueteria nombrando FedEx, DHL y Estafeta (sin UPS), Lalamove y Tresguerras', () => {
  assert.deepStrictEqual(opcionesSelectorEnvio(lineasTransporte(null)), [
    { value: 'none', texto: 'Sin envio (cliente recoge o arregla envio)' },
    { value: 'envia', texto: 'Cotizar paqueteria (FedEx, DHL, Estafeta via envia.com)' },
    { value: 'lalamove', texto: 'Cotizar con Lalamove (envio local)' },
    { value: 'tresguerras', texto: 'Cotizar con Tresguerras (carga consolidada)' },
    { value: 'manual', texto: 'Agregar costo manualmente' },
  ]);
});

test('desactivar Lalamove quita "Cotizar con Lalamove" del selector; la paqueteria nombra solo las envia activas', () => {
  const lineas = lineasTransporte(null).map(l => (
    l.fuente === 'lalamove' || l.codigo === 'dhl' ? { ...l, activa: false } : l));
  const valores = opcionesSelectorEnvio(lineas).map(o => o.value);
  assert.deepStrictEqual(valores, ['none', 'envia', 'tresguerras', 'manual']);
  assert.equal(opcionesSelectorEnvio(lineas)[1].texto, 'Cotizar paqueteria (FedEx, Estafeta via envia.com)');
});

test('sin lineas envia activas el selector no ofrece paqueteria', () => {
  const lineas = lineasTransporte(null).map(l => (l.fuente === 'envia' ? { ...l, activa: false } : l));
  assert.deepStrictEqual(opcionesSelectorEnvio(lineas).map(o => o.value), ['none', 'lalamove', 'tresguerras', 'manual']);
});

// AC: Editar o Copiar una cotizacion guardada con una linea que ya no esta en la
// lista la restaura tal como se guardo. La opcion guardada se sigue ofreciendo
// (sin ella el select quedaria en blanco) y la tarifa restaurada conserva su carrier.
test('Editar/Copiar con Lalamove desactivada: el selector conserva la opcion guardada y el envio se restaura tal cual', () => {
  const lineas = lineasTransporte(null).map(l => (l.fuente === 'lalamove' ? { ...l, activa: false } : l));
  const envio = { opcion: 'lalamove', carrier: 'lalamove', servicio: 'Lalamove Hatchback (hasta 100 kg)', precio: 359.9, descripcion: 'Envio Lalamove Hatchback (hasta 100 kg)', descuento: 0 };
  const restaurado = restaurarEnvioDesdeCotizacion(envio);
  assert.equal(restaurado.opcion, 'lalamove');
  assert.deepStrictEqual(restaurado.enviaRateSeleccionado, { carrier: 'lalamove', servicio: 'Lalamove Hatchback (hasta 100 kg)', desc: 'Envio Lalamove Hatchback (hasta 100 kg)', cost: 359.9 });
  const opciones = opcionesSelectorEnvio(lineas, restaurado.opcion);
  assert.deepStrictEqual(opciones.map(o => o.value), ['none', 'envia', 'lalamove', 'tresguerras', 'manual']);
});

test('Editar/Copiar con un envio UPS (ya no esta en la lista) y ninguna envia activa: la paqueteria se sigue ofreciendo', () => {
  const lineas = [{ nombre: 'Lalamove', fuente: 'lalamove', codigo: null, shipVia: 3, activa: true }];
  const envio = { opcion: 'envia', carrier: 'ups', servicio: 'UPS Saver', precio: 314.61, descripcion: 'Envio UPS Saver', descuento: 0 };
  const restaurado = restaurarEnvioDesdeCotizacion(envio);
  assert.equal(restaurado.opcion, 'envia');
  assert.equal(restaurado.enviaRateSeleccionado.carrier, 'ups');
  const opciones = opcionesSelectorEnvio(lineas, restaurado.opcion);
  assert.deepStrictEqual(opciones.map(o => o.value), ['none', 'envia', 'lalamove', 'manual']);
  assert.equal(opciones[1].texto, 'Cotizar paqueteria (via envia.com)');
});
