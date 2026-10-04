import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actualizarQuote, conCandadoSubida, OCUPADO } from '../lib/subida-quote.js';
import {
  subidaQuoteEnMemoria, RESULTADOS_ACTUALIZAR, LISTA_ESCRITA, TRANSPORTISTA_ESCRITO,
} from './helpers/subida-quote-memoria.js';

// Modulo Subida del quote (#524, ADR-0022), operacion actualizar. Una regla por
// test, contra adaptadores en memoria: ningun test de este archivo sobreescribe
// globalThis.fetch ni levanta el servidor. La cotizacion de ejemplo es la de las
// pruebas HTTP de /actualizar (test/server.test.js, A104): folio 1200, El Pendulo.

function cotizacion(extra = {}, raiz = {}) {
  return {
    id: 7, fecha: '2026-07-28T00:00:00Z', vendedor: 'Tester', cliente: 'EL PENDULO',
    totalPiezas: 3, total: 300, tier: 'M100', folioOperam: '1200',
    data: {
      fecha: '2026-07-28', vigencia: '2026-08-27',
      cliente: { rfc: 'CPE921211N76', razonSocial: 'El Pendulo', nombreCorto: 'Pendulo', cpEntrega: '56530' },
      items: [{ codigo: 'SKU-NUEVO', descripcion: 'Plato', cantidad: 3, precio: 99.5, descuento: 0 }],
      huellaQuote: 'huella-previa',
      ...extra,
    },
    ...raiz,
  };
}

test('ocupado: con otra operacion en vuelo sobre la misma cotizacion devuelve ocupado sin leer el registro', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [cotizacion()] });
  const colgada = m.colgarActualizar();
  const primera = actualizarQuote(7, m.deps);
  await new Promise((r) => setImmediate(r));
  const segunda = await actualizarQuote(7, m.deps);
  assert.equal(segunda, OCUPADO);
  assert.equal(segunda.tipo, 'ocupado');
  assert.equal(m.llamadas.obtener.length, 1, 'la segunda no lee el registro');
  colgada.soltar(RESULTADOS_ACTUALIZAR.exito());
  assert.equal((await primera).tipo, 'actualizada');
});

test('ocupado: una subida (crear) en vuelo bloquea la actualizacion de la misma cotizacion', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [cotizacion()] });
  let soltar;
  const subida = conCandadoSubida(7, () => new Promise((r) => { soltar = r; }));
  const r = await actualizarQuote(7, m.deps);
  assert.equal(r, OCUPADO);
  assert.equal(m.llamadas.actualizarQuoteOperam.length, 0);
  soltar('subida lista');
  assert.equal(await subida, 'subida lista');
});

test('candado: no es reentrante -- tomarlo otra vez dentro de la misma operacion devuelve ocupado', async () => {
  const r = await conCandadoSubida(9, () => conCandadoSubida(9, () => 'nunca'));
  assert.equal(r, OCUPADO);
});

test('candado: es por cotizacion -- otra cotizacion no espera', async () => {
  let soltar;
  const una = conCandadoSubida(10, () => new Promise((r) => { soltar = r; }));
  assert.equal(await conCandadoSubida(11, () => 'libre'), 'libre');
  soltar('ok');
  await una;
});

test('candado: se libera aunque la operacion lance', async () => {
  const m = subidaQuoteEnMemoria({
    cotizaciones: [cotizacion()],
    actualizar: () => { throw new Error('se cayo la sesion web'); },
  });
  await assert.rejects(actualizarQuote(7, m.deps), /se cayo la sesion web/);
  const otra = await conCandadoSubida(7, () => 'libre');
  assert.equal(otra, 'libre');
});

test('no-encontrada: una cotizacion inexistente no llama a Operam', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [] });
  const r = await actualizarQuote(999999, m.deps);
  assert.deepEqual(r, { tipo: 'no-encontrada' });
  assert.equal(m.llamadas.actualizarQuoteOperam.length, 0);
});

test('bloqueo: sin folio (PRE) no se actualiza y no se llama a Operam', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [cotizacion({}, { folioOperam: null })] });
  const r = await actualizarQuote(7, m.deps);
  assert.equal(r.tipo, 'bloqueo');
  assert.equal(r.motivo, 'no-actualizable');
  assert.match(r.mensaje, /Operam/);
  assert.match(r.mensaje, /primero completa la subida/);
  assert.equal(m.llamadas.actualizarQuoteOperam.length, 0);
});

test('bloqueo: con pedido asociado no se actualiza y no se llama a Operam', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [cotizacion({ orderOperam: '7077' })] });
  const r = await actualizarQuote(7, m.deps);
  assert.equal(r.tipo, 'bloqueo');
  assert.equal(r.motivo, 'no-actualizable');
  assert.match(r.mensaje, /pedido/);
  assert.equal(m.llamadas.actualizarQuoteOperam.length, 0);
});

test('bloqueo: con el pedido solo en el espejo de Operam (#502) tampoco', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [cotizacion({ espejoOperam: { cotizacion: '1200', pedido: '7722' } })] });
  const r = await actualizarQuote(7, m.deps);
  assert.equal(r.tipo, 'bloqueo');
  assert.match(r.mensaje, /pedido/);
  assert.equal(m.llamadas.actualizarQuoteOperam.length, 0);
});

test('actualizar: el ProcessOrder lleva el folio, el data del registro y la lista y el transportista resueltos', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [cotizacion()], lista: '15', transportista: { shipVia: 3, linea: 'Lalamove', motivo: null } });
  await actualizarQuote(7, m.deps);
  const [folio, data, opciones] = m.llamadas.actualizarQuoteOperam[0];
  assert.equal(folio, '1200');
  assert.equal(data.items[0].codigo, 'SKU-NUEVO');
  assert.deepEqual(opciones, { lista: '15', transportista: 3 });
});

test('exito: devuelve actualizada con el folio y guarda la huella con la lista y el transportista', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [cotizacion()], lista: '15', transportista: { shipVia: 3, linea: 'Lalamove', motivo: null } });
  const r = await actualizarQuote(7, m.deps);
  assert.equal(r.tipo, 'actualizada');
  assert.equal(r.folio, '1200');
  const guardada = m.registro(7).data.huellaQuote;
  assert.notEqual(guardada, 'huella-previa');
  // Literal (como #522): la lista 15 y el transportista 3 de los resolutores entran a la huella.
  assert.equal(guardada, '{"items":[{"stock_id":"SKU-NUEVO","qty":3,"price":99.5,"Disc":0,"text":"Plato","editarDescripcion":false}],"custRef":"Pendulo","customerId":null,"deliverTo":"El Pendulo","deliveryAddress":"56530","contactPhone":"","contactEmail":"","comments":"","subtotal":0,"iva":0,"total":0,"listaId":"15","branchId":null,"shipVia":"3","vigencia":"2026-08-27"}');
});

test('exito: limpia la marca quoteDesactualizado', async () => {
  const m = subidaQuoteEnMemoria({
    cotizaciones: [cotizacion({ quoteDesactualizado: { fecha: '2026-07-01T00:00:00Z', escrito: false, error: 'previo', discrepancias: [] } })],
  });
  await actualizarQuote(7, m.deps);
  assert.equal(m.registro(7).data.quoteDesactualizado, null);
});

test('exito: saca el folio de la cola de reintentos del post-fix (#380)', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [cotizacion()], cola: ['1200'] });
  await actualizarQuote(7, m.deps);
  assert.deepEqual(m.llamadas.sacarDeLaColaPostFix, ['1200']);
  assert.equal(m.enCola('1200'), false);
});

test('exito: los pasos salen en orden -- actualizar quote, lista, transportista, almacen', async () => {
  const m = subidaQuoteEnMemoria({
    cotizaciones: [cotizacion()],
    actualizar: {
      ...RESULTADOS_ACTUALIZAR.exito(), lista: LISTA_ESCRITA, transportista: TRANSPORTISTA_ESCRITO,
      almacen: { cambio: true, de: 'PT', a: 'Almacen MP' },
    },
  });
  const r = await actualizarQuote(7, m.deps);
  assert.deepEqual(r.pasos.map((p) => p.name), ['actualizar quote', 'lista del quote', 'transportista del quote', 'almacen de entrega']);
  assert.deepEqual(r.pasos[0], { name: 'actualizar quote', status: 'ok' });
  assert.equal(r.pasos[1].status, 'ok');
  assert.equal(r.pasos[2].status, 'ok');
});

test('almacen: sin cambio de almacen no hay paso de almacen', async () => {
  const m = subidaQuoteEnMemoria({
    cotizaciones: [cotizacion()],
    actualizar: { ...RESULTADOS_ACTUALIZAR.exito(), almacen: { cambio: false, de: 'PT', a: 'PT' } },
  });
  const r = await actualizarQuote(7, m.deps);
  assert.deepEqual(r.pasos.map((p) => p.name), ['actualizar quote']);
});

test('almacen: cuando el domicilio movio el almacen sale un warn que nombra el almacen nuevo (#409)', async () => {
  const m = subidaQuoteEnMemoria({
    cotizaciones: [cotizacion()],
    actualizar: { ...RESULTADOS_ACTUALIZAR.exito(), almacen: { cambio: true, de: 'PT', a: 'Almacen MP' } },
  });
  const r = await actualizarQuote(7, m.deps);
  const paso = r.pasos.find((p) => p.name === 'almacen de entrega');
  assert.equal(paso.status, 'warn');
  assert.match(paso.mensaje, /"Almacen MP"/);
  assert.match(paso.detalle, /quote 1200: el almacen paso de PT a Almacen MP/);
});

test('fallo: devuelve no-actualizada con escrito, verificado, error y discrepancias', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [cotizacion()], actualizar: RESULTADOS_ACTUALIZAR.escritoSinVerificar() });
  const r = await actualizarQuote(7, m.deps);
  assert.equal(r.tipo, 'no-actualizada');
  assert.equal(r.folio, '1200');
  assert.equal(r.escrito, true);
  assert.equal(r.verificado, false);
  assert.equal(r.error, 'El quote quedo distinto de lo esperado');
  assert.deepEqual(r.discrepancias, ['partida SKU-NUEVO: cantidad 2 en Operam, se esperaba 3']);
  assert.deepEqual(r.pasos[0], {
    name: 'actualizar quote', status: 'error',
    error: 'El quote quedo distinto de lo esperado',
    discrepancias: ['partida SKU-NUEVO: cantidad 2 en Operam, se esperaba 3'],
  });
});

test('fallo: guarda la marca quoteDesactualizado con fecha, escrito, error y discrepancias', async () => {
  const m = subidaQuoteEnMemoria({
    cotizaciones: [cotizacion()], actualizar: RESULTADOS_ACTUALIZAR.falloAntesDeEscribir(), ahora: '2026-10-03T12:00:00.000Z',
  });
  await actualizarQuote(7, m.deps);
  assert.deepEqual(m.registro(7).data.quoteDesactualizado, {
    fecha: '2026-10-03T12:00:00.000Z',
    escrito: false,
    error: 'FA no agrego la partida SKU-NUEVO: se abandona la edicion sin confirmar',
    discrepancias: [],
  });
});

test('fallo: NO saca el folio de la cola y NO cambia la huella', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [cotizacion()], actualizar: RESULTADOS_ACTUALIZAR.escritoSinVerificar(), cola: ['1200'] });
  await actualizarQuote(7, m.deps);
  assert.deepEqual(m.llamadas.sacarDeLaColaPostFix, []);
  assert.equal(m.enCola('1200'), true);
  assert.equal(m.registro(7).data.huellaQuote, 'huella-previa');
});

test('fallo: los pasos de lista, transportista y almacen tambien salen, en orden, tras el error', async () => {
  const m = subidaQuoteEnMemoria({
    cotizaciones: [cotizacion()],
    actualizar: {
      ...RESULTADOS_ACTUALIZAR.escritoSinVerificar(), lista: LISTA_ESCRITA, transportista: TRANSPORTISTA_ESCRITO,
      almacen: { cambio: true, de: 'PT', a: 'Almacen MP' },
    },
  });
  const r = await actualizarQuote(7, m.deps);
  assert.deepEqual(r.pasos.map((p) => p.name), ['actualizar quote', 'lista del quote', 'transportista del quote', 'almacen de entrega']);
});

test('fallo: sin error, discrepancias, escrito ni verificado en la respuesta, salen normalizados en el valor, el paso y la marca', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [cotizacion()], actualizar: RESULTADOS_ACTUALIZAR.sinCampos() });
  const r = await actualizarQuote(7, m.deps);
  assert.equal(r.escrito, false);
  assert.equal(r.verificado, false);
  assert.equal(r.error, null);
  assert.deepEqual(r.discrepancias, []);
  assert.deepEqual(r.pasos[0], { name: 'actualizar quote', status: 'error', error: null, discrepancias: [] });
  const marca = m.registro(7).data.quoteDesactualizado;
  assert.equal(marca.escrito, false);
  assert.equal(marca.error, null);
  assert.deepEqual(marca.discrepancias, []);
});

test('deps: sin listaDelQuote o transportistaDelQuote lanza al entrar, sin tomar el candado ni leer el registro', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [cotizacion()] });
  const { listaDelQuote, ...sinLista } = m.deps;
  await assert.rejects(actualizarQuote(7, sinLista), /listaDelQuote/);
  const { transportistaDelQuote, ...sinTransportista } = m.deps;
  await assert.rejects(actualizarQuote(7, sinTransportista), /transportistaDelQuote/);
  assert.equal(m.llamadas.obtener.length, 0);
  assert.equal(await conCandadoSubida(7, () => 'libre'), 'libre');
});
