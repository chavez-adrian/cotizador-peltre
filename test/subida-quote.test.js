import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actualizarQuote, subirQuote, clasificarErrorQuote, marcarMotivoPre, conCandadoSubida, OCUPADO,
} from '../lib/subida-quote.js';
import {
  subidaQuoteEnMemoria, RESULTADOS_ACTUALIZAR, LISTA_ESCRITA, TRANSPORTISTA_ESCRITO,
  POSTFIX_VERIFICADO, CORREO_ENTREGA_ESCRITO,
} from './helpers/subida-quote-memoria.js';
import { ErrorClienteSinLista } from '../lib/lista-precios-cliente.js';
import { ErrorClienteMonedaExtranjera } from '../public/js/moneda-cliente-logica.js';

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
      cliente: { rfc: 'CPE921211N76', razonSocial: 'El Pendulo', nombreCorto: 'Pendulo', cpEntrega: '56530', calle: 'Av. Reforma 123', celEntrega: '+52 55 1234 5678' },
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
  assert.equal(guardada, '{"items":[{"stock_id":"SKU-NUEVO","qty":3,"price":99.5,"Disc":0,"text":"Plato","editarDescripcion":false}],"custRef":"Pendulo","customerId":null,"deliverTo":"El Pendulo","deliveryAddress":"Av. Reforma 123, 56530","contactPhone":"+52 55 1234 5678","contactEmail":"","comments":"","subtotal":0,"iva":0,"total":0,"listaId":"15","branchId":null,"shipVia":"3","vigencia":"2026-08-27"}');
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

test('#556 actualizar: el telefono y el correo del Contacto de entrega salen como pasos tras el transportista', async () => {
  const telefonoAjeno = {
    aplica: true, esperado: '', escrita: true, yaCorrecto: false, ok: false, verificado: true, encontrado: '+52 55 3466 7682', motivo: null,
  };
  const m = subidaQuoteEnMemoria({
    cotizaciones: [cotizacion()],
    actualizar: {
      ...RESULTADOS_ACTUALIZAR.exito(), lista: LISTA_ESCRITA, transportista: TRANSPORTISTA_ESCRITO,
      telefonoEntrega: telefonoAjeno, correoEntrega: CORREO_ENTREGA_ESCRITO,
    },
  });
  const r = await actualizarQuote(7, m.deps);
  assert.equal(r.tipo, 'actualizada');
  assert.deepEqual(r.pasos.map((p) => [p.name, p.status]), [
    ['actualizar quote', 'ok'], ['lista del quote', 'ok'], ['transportista del quote', 'ok'],
    ['telefono del Contacto de entrega', 'warn'], ['correo del Contacto de entrega', 'ok'],
  ]);
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

// --- Crear por el camino normal (#525) ----------------------------------------
// La cotizacion de ejemplo trae RFC real y celular: no necesita alta de cliente y
// el Cliente Operam sale del RFC (resolverClienteDeCotizacion). Todavia sin folio.

function nueva(cliente = {}, raiz = {}) {
  return {
    id: 21, fecha: '2026-10-03T00:00:00Z', vendedor: 'Tester', cliente: 'EL PENDULO',
    totalPiezas: 3, total: 300, tier: 'M100', folioOperam: null,
    data: {
      fecha: '2026-10-03', vigencia: '2026-11-14',
      cliente: { rfc: 'CPE921211N76', razonSocial: 'El Pendulo', nombreCorto: 'Pendulo', telefono: '5512345678', cpEntrega: '56530', calle: 'Av. Reforma 123', celEntrega: '5512345678', ...cliente },
      items: [{ codigo: 'SKU-NUEVO', descripcion: 'Plato', cantidad: 3, precio: 99.5, descuento: 0 }],
    },
    ...raiz,
  };
}

const CONTACTO_LIGADO_A_OTRO = { id: 300, celular: '5512345678', nombre: 'Compradora', data: { cliente_id: 88 } };
const CONTACTO_SIN_LIGAS = { id: 301, celular: '5512345678', nombre: 'Compradora', data: {} };

const nombres = (secuencia) => secuencia.map(([n]) => n);

test('crear deps: sin obtenerListasPrecios lanza al entrar, nombrandola, sin tomar el candado ni leer el registro', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva()] });
  const { obtenerListasPrecios, ...sinListas } = m.deps;
  await assert.rejects(subirQuote(21, {}, sinListas), /obtenerListasPrecios/);
  assert.equal(m.llamadas.obtener.length, 0);
  assert.equal(await conCandadoSubida(21, () => 'libre'), 'libre');
});

test('crear ocupado: con otra operacion en vuelo devuelve ocupado sin leer el registro', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva()] });
  let soltar;
  const otra = conCandadoSubida(21, () => new Promise((r) => { soltar = r; }));
  assert.equal(await subirQuote(21, {}, m.deps), OCUPADO);
  assert.equal(m.llamadas.obtener.length, 0);
  soltar();
  await otra;
});

test('crear no-encontrada: una cotizacion inexistente no toca Operam', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [] });
  assert.deepEqual(await subirQuote(999, {}, m.deps), { tipo: 'no-encontrada' });
  assert.equal(m.llamadas.subirCotizacionOperam.length, 0);
});

test('ya subida: con folio devuelve el folio y el Cliente Operam ligado sin tocar Operam ni escribir', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva({ customerId: 15 }, { folioOperam: '1325' })] });
  const r = await subirQuote(21, {}, m.deps);
  assert.deepEqual(r, { tipo: 'ya-subida', folio: '1325', clienteId: 15 });
  assert.deepEqual(nombres(m.secuencia), ['obtener']);
});

test('ya subida: sin customer_id en la cotizacion el clienteId sale null', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva({}, { folioOperam: '1325' })] });
  assert.equal((await subirQuote(21, {}, m.deps)).clienteId, null);
});

test('ya subida va ANTES de decidir el camino: con folio y datos de alta generica no se llama al alta', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva({ rfc: '' }, { folioOperam: '1325' })] });
  const r = await subirQuote(21, { customerIdElegido: 15, sucursalDe: 15 }, m.deps);
  assert.equal(r.tipo, 'ya-subida');
  assert.equal(m.llamadas.darDeAlta.length, 0);
});

test('pregunta: el Contacto ligado a otro Cliente Operam sale como pregunta sin quote escrito ni escrituras en el registro', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva()], prospectos: [CONTACTO_LIGADO_A_OTRO] });
  const r = await subirQuote(21, {}, m.deps);
  assert.equal(r.tipo, 'pregunta');
  assert.equal(r.motivo, 'otra-razon-social');
  assert.equal(r.camino, 'normal');
  assert.equal(r.clienteId, 15);
  assert.equal(r.contacto.id, 300);
  assert.deepEqual(r.ligadas.map((l) => l.cliente_id), [88]);
  assert.equal(m.llamadas.subirCotizacionOperam.length, 0);
  assert.equal(m.llamadas.setFolioOperam.length, 0);
  assert.equal(m.llamadas.actualizarDatos.length, 0);
  assert.equal(m.llamadas.ligarCliente.length, 0);
});

test('confirmada: con otraRazonSocial sube y AGREGA la liga al Contacto con el Cliente Operam que devolvio la subida', async () => {
  const m = subidaQuoteEnMemoria({
    cotizaciones: [nueva()], prospectos: [CONTACTO_LIGADO_A_OTRO], subir: { folio: '1330', customerId: 16 },
  });
  const r = await subirQuote(21, { otraRazonSocial: true }, m.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.folio, '1330');
  const [contactoId, clienteId, evento] = m.llamadas.ligarCliente[0];
  assert.equal(contactoId, 300);
  assert.equal(clienteId, 16);
  assert.equal(evento.cliente_id, 16);
  assert.equal(evento.tipo, 'cliente');
  assert.equal(evento.nombre, 'El Pendulo');
  assert.equal(evento.vendedor, 'Tester');
  assert.equal(evento.fecha, '2026-10-03T12:00:00.000Z');
  assert.deepEqual(r.pasos.at(-1), { name: 'ligar prospecto', status: 'ok' });
});

test('subir: el POST lleva el Cliente Operam resuelto del RFC, sin opciones extra', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva()], resolver: { customerId: 15, branchId: 40 } });
  await subirQuote(21, {}, m.deps);
  const args = m.llamadas.subirCotizacionOperam[0];
  assert.equal(args.length, 1);
  assert.equal(args[0].cliente.customerId, 15);
  assert.equal(args[0].cliente.branchId, 40);
});

test('sin folio: lograda con el folio tal como vino y sin pasos; sin huella, sin motivo, sin post-fix y sin liga', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva()], prospectos: [CONTACTO_SIN_LIGAS], subir: { folio: '', customerId: 15 } });
  const r = await subirQuote(21, {}, m.deps);
  assert.deepEqual(r, { tipo: 'lograda', camino: 'normal', folio: '', pasos: [] });
  assert.equal(m.llamadas.setFolioOperam.length, 0);
  assert.equal(m.llamadas.actualizarDatos.length, 0);
  assert.equal(m.llamadas.corregirVigenciaQuote.length, 0);
  assert.equal(m.llamadas.encolarPostFix.length, 0);
  assert.equal(m.llamadas.ligarCliente.length, 0);
});

test('con folio: folio, huella y motivo null se guardan ANTES del post-fix', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva()] });
  await subirQuote(21, {}, m.deps);
  const escrituras = m.secuencia.filter(([n]) => n === 'setFolioOperam' || n === 'actualizarDatos');
  assert.deepEqual(escrituras.map(([n, a]) => [n, n === 'setFolioOperam' ? a : Object.keys(a[1])]), [
    ['setFolioOperam', [21, '1330']],
    ['actualizarDatos', ['huellaQuote']],
    ['actualizarDatos', ['motivoPre', 'motivoPreDesde']],
  ]);
  const iUltimaEscritura = m.secuencia.indexOf(escrituras.at(-1));
  assert.ok(iUltimaEscritura < nombres(m.secuencia).indexOf('corregirVigenciaQuote'), 'el motivo se levanta antes del post-fix');
  assert.equal(m.registro(21).data.motivoPre, null);
  assert.equal(m.registro(21).data.motivoPreDesde, null);
});

test('con folio: la huella sale de entry.data (sin el Cliente Operam resuelto) con la lista y el transportista', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva()], resolver: { customerId: 15, branchId: 40 } });
  await subirQuote(21, {}, m.deps);
  const h = JSON.parse(m.registro(21).data.huellaQuote);
  assert.equal(h.customerId, null);
  assert.equal(h.branchId, null);
  assert.equal(h.listaId, '15');
  assert.equal(h.shipVia, '3');
});

// #114-6 (desde la prueba HTTP, #527): sin lista resoluble y sin transportista que
// mandar, la huella guarda los dos campos en null EXPLICITO (#403, #448). Ausentes
// significarian "huella anterior al campo", que la comparacion exenta.
test('con folio: la huella guardada es literal, con listaId y shipVia en null presentes cuando no hay lista ni transportista', async () => {
  const m = subidaQuoteEnMemoria({
    cotizaciones: [nueva()], resolver: { customerId: 15, branchId: 40 },
    lista: null, transportista: { shipVia: null, linea: null, motivo: 'sin envio' },
  });
  await subirQuote(21, {}, m.deps);
  assert.equal(m.registro(21).data.huellaQuote, '{"items":[{"stock_id":"SKU-NUEVO","qty":3,"price":99.5,"Disc":0,"text":"Plato","editarDescripcion":false}],"custRef":"Pendulo","customerId":null,"deliverTo":"El Pendulo","deliveryAddress":"Av. Reforma 123, 56530","contactPhone":"5512345678","contactEmail":"","comments":"","subtotal":0,"iva":0,"total":0,"listaId":null,"branchId":null,"shipVia":null,"vigencia":"2026-11-14"}');
});

// #556: el post-fix manda el telefono y el correo del Contacto de entrega EXPLICITOS
// -- el correo de la cotizacion de ejemplo va vacio (es opcional, #558) y se manda
// vacio -- y nunca deja que Operam los deduzca.
test('post-fix: escribe vigencia, lista, transportista y el telefono y correo del Contacto de entrega, el vacio incluido', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva()] });
  await subirQuote(21, {}, m.deps);
  assert.deepEqual(m.llamadas.corregirVigenciaQuote[0], ['1330', '2026-11-14', {
    lista: '15', transportista: 3, telefonoEntrega: '5512345678', correoEntrega: '',
  }]);
});

test('#556 post-fix: con telefono y correo del Contacto de entrega los manda tal cual, no los del cliente', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva({ celEntrega: '+52 55 1111 2222', emailEntrega: 'recibe@cliente.test' })] });
  await subirQuote(21, {}, m.deps);
  const [, , opciones] = m.llamadas.corregirVigenciaQuote[0];
  assert.equal(opciones.telefonoEntrega, '+52 55 1111 2222');
  assert.equal(opciones.correoEntrega, 'recibe@cliente.test');
});

test('post-fix verificado: lograda con los pasos de vigencia, lista y transportista en ok', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva()] });
  const r = await subirQuote(21, {}, m.deps);
  assert.deepEqual(r.pasos.map((p) => [p.name, p.status]), [
    ['post-fix vigencia', 'ok'], ['lista del quote', 'ok'], ['transportista del quote', 'ok'],
    ['telefono del Contacto de entrega', 'ok'], ['correo del Contacto de entrega', 'ok'],
  ]);
});

test('#556 post-fix: un telefono que la relectura no confirma sale como warn sin tumbar la subida y se encola con los dos valores', async () => {
  const telefonoAjeno = {
    aplica: true, esperado: '5512345678', escrita: true, yaCorrecto: false, ok: false, verificado: true, encontrado: '+52 55 3466 7682', motivo: null,
  };
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva()], corregir: { ...POSTFIX_VERIFICADO, telefonoEntrega: telefonoAjeno } });
  const r = await subirQuote(21, {}, m.deps);
  assert.equal(r.tipo, 'lograda');
  const paso = r.pasos.find((p) => p.name === 'telefono del Contacto de entrega');
  assert.equal(paso.status, 'warn');
  assert.equal(paso.detalle, 'quote 1330: se esperaba el telefono 5512345678 y se leyo +52 55 3466 7682');
  const [fila] = m.llamadas.encolarPostFix[0];
  assert.equal(fila.telefonoEntrega, '5512345678');
  assert.equal(fila.correoEntrega, '');
  assert.deepEqual(fila.resultado.telefonoEntrega, telefonoAjeno);
});

test('post-fix sin verificar: se encola con lo esperado y sale como paso warn sin tumbar la subida', async () => {
  const sinVerificar = { ok: false, verificado: false, esperado: '2026-11-14', encontrado: null };
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva()], corregir: sinVerificar });
  const r = await subirQuote(21, {}, m.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.pasos[0].name, 'post-fix vigencia');
  assert.equal(r.pasos[0].status, 'warn');
  const [fila] = m.llamadas.encolarPostFix[0];
  assert.equal(fila.folio, '1330');
  assert.equal(fila.cotizacionId, 21);
  assert.equal(fila.vendedor, 'Tester');
  assert.equal(fila.vigencia, '2026-11-14');
  assert.equal(fila.lista, '15');
  assert.equal(fila.transportista, 3);
  assert.equal(fila.telefonoEntrega, '5512345678');
  assert.equal(fila.correoEntrega, '');
  assert.equal(fila.fechaDocumento, '2026-10-03');
  assert.deepEqual(fila.resultado, sinVerificar);
});

test('post-fix que lanza: paso error y la lista y el transportista "no enviado", encolado con el error', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva()], corregir: () => { throw new Error('sesion web caida'); } });
  const r = await subirQuote(21, {}, m.deps);
  assert.equal(r.tipo, 'lograda');
  assert.deepEqual(r.pasos.map((p) => p.name), [
    'post-fix vigencia', 'lista del quote', 'transportista del quote',
    'telefono del Contacto de entrega', 'correo del Contacto de entrega',
  ]);
  assert.equal(r.pasos[0].status, 'error');
  for (const paso of r.pasos.slice(1)) {
    assert.equal(paso.status, 'warn');
    assert.match(JSON.stringify(paso), /el post-fix fallo antes de escribir: sesion web caida/);
  }
  assert.equal(m.llamadas.encolarPostFix[0][0].error, 'sesion web caida');
});

test('post-fix que lanza sin transportista que mandar: no se pinta el paso del transportista', async () => {
  const m = subidaQuoteEnMemoria({
    cotizaciones: [nueva()], corregir: () => { throw new Error('x'); },
    transportista: { shipVia: null, linea: null, motivo: 'sin envio' },
  });
  const r = await subirQuote(21, {}, m.deps);
  assert.deepEqual(r.pasos.map((p) => p.name), [
    'post-fix vigencia', 'lista del quote', 'telefono del Contacto de entrega', 'correo del Contacto de entrega',
  ]);
});

test('liga: un Contacto sin ligas recibe la liga despues del post-fix', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva()], prospectos: [CONTACTO_SIN_LIGAS] });
  const r = await subirQuote(21, {}, m.deps);
  assert.equal(m.llamadas.ligarCliente.length, 1);
  assert.ok(nombres(m.secuencia).indexOf('corregirVigenciaQuote') < nombres(m.secuencia).indexOf('ligarCliente'));
  assert.equal(r.pasos.at(-1).name, 'ligar prospecto');
});

test('liga: el Contacto ya ligado a ese mismo Cliente Operam no se vuelve a ligar', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva()], prospectos: [{ ...CONTACTO_SIN_LIGAS, data: { cliente_id: 15 } }] });
  const r = await subirQuote(21, {}, m.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(m.llamadas.ligarCliente.length, 0);
});

test('liga: el fallo al ligar el Contacto sale como paso error y la subida sigue lograda', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva()], prospectos: [CONTACTO_SIN_LIGAS], ligarFalla: new Error('Neon no responde') });
  const r = await subirQuote(21, {}, m.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.folio, '1330');
  assert.deepEqual(r.pasos.at(-1), { name: 'ligar prospecto', status: 'error', error: 'Neon no responde' });
});

test('contacto: el fallo del store de prospectos se propaga (no es un bloqueo de Operam ni marca motivo)', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva()] });
  m.deps.buscarPorCelular = async () => { throw new Error('store roto'); };
  await assert.rejects(subirQuote(21, {}, m.deps), /store roto/);
  assert.equal(m.llamadas.actualizarDatos.length, 0);
});

test('bloqueo cliente-no-identificado: sin subir y sin marcar motivo de PRE', async () => {
  const texto = 'No se pudo identificar el cliente en Operam por el RFC CPE921211N76. Verifica el RFC o da de alta el cliente antes de subir.';
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva()], resolver: () => { throw new Error(texto); } });
  const r = await subirQuote(21, {}, m.deps);
  assert.deepEqual(r, { tipo: 'bloqueo', etapa: 'quote', camino: 'normal', motivo: 'cliente-no-identificado', mensaje: texto });
  assert.equal(m.llamadas.subirCotizacionOperam.length, 0);
  assert.equal(m.llamadas.actualizarDatos.length, 0);
});

test('bloqueo sin-lista-precios: marca MOTIVO_PRE_SIN_LISTA antes de devolver', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva()], subir: () => { throw new ErrorClienteSinLista('El Pendulo'); } });
  const r = await subirQuote(21, {}, m.deps);
  assert.equal(r.tipo, 'bloqueo');
  assert.equal(r.motivo, 'sin-lista-precios');
  assert.equal(r.mensaje, new ErrorClienteSinLista('El Pendulo').message);
  assert.equal(m.registro(21).data.motivoPre, 'sin-lista');
  assert.equal(m.registro(21).data.motivoPreDesde, '2026-10-03T12:00:00.000Z');
});

test('bloqueo sin-lista-precios: el 406 "rate de moneda" de Operam es el mismo bloqueo, con el mensaje generico', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva()], subir: () => { throw new Error('Operam 406: Debe haber al menos un rate de moneda'); } });
  const r = await subirQuote(21, {}, m.deps);
  assert.equal(r.motivo, 'sin-lista-precios');
  assert.match(r.mensaje, /lista de precios/);
  assert.equal(m.registro(21).data.motivoPre, 'sin-lista');
});

test('bloqueo moneda-extranjera: lleva la moneda y NO marca motivo de PRE', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva()], subir: () => { throw new ErrorClienteMonedaExtranjera('El Pendulo', 'USD'); } });
  const r = await subirQuote(21, {}, m.deps);
  assert.equal(r.tipo, 'bloqueo');
  assert.equal(r.motivo, 'moneda-extranjera');
  assert.equal(r.moneda, 'USD');
  assert.equal(r.mensaje, new ErrorClienteMonedaExtranjera('El Pendulo', 'USD').message);
  assert.equal(m.llamadas.actualizarDatos.length, 0);
});

test('bloqueo operam: marca MOTIVO_PRE_OPERAM y el mensaje dice que no se pudo subir', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva()], subir: () => { throw new Error('Operam 500: timeout'); } });
  const r = await subirQuote(21, {}, m.deps);
  assert.deepEqual(r, { tipo: 'bloqueo', etapa: 'quote', camino: 'normal', motivo: 'operam', mensaje: 'No se pudo subir a Operam: Operam 500: timeout' });
  assert.equal(m.registro(21).data.motivoPre, 'operam');
});

test('bloqueo operam: un fallo al guardar el folio tambien es bloqueo de Operam', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva()] });
  m.deps.setFolioOperam = async () => { throw new Error('disco lleno'); };
  const r = await subirQuote(21, {}, m.deps);
  assert.equal(r.motivo, 'operam');
  assert.equal(r.mensaje, 'No se pudo subir a Operam: disco lleno');
});

test('clasificarErrorQuote: cada error del quote con su motivo', () => {
  assert.equal(clasificarErrorQuote(new Error('No se pudo identificar el cliente en Operam: la cotizacion no tiene RFC.')).motivo, 'cliente-no-identificado');
  assert.equal(clasificarErrorQuote(new ErrorClienteSinLista('X')).motivo, 'sin-lista-precios');
  assert.equal(clasificarErrorQuote(new Error('Debe haber al menos un rate de moneda')).motivo, 'sin-lista-precios');
  assert.equal(clasificarErrorQuote(new ErrorClienteMonedaExtranjera('X', 'USD')).moneda, 'USD');
  assert.deepEqual(clasificarErrorQuote(new Error('boom')), { motivo: 'operam', mensaje: 'No se pudo subir a Operam: boom' });
});

test('marcarMotivoPre: un store que falla no lanza', async () => {
  await marcarMotivoPre(21, 'operam', { actualizarDatos: async () => { throw new Error('caido'); } });
});

// --- Entrada unica (#528): subirQuote decide crear, actualizar o nada -------
// Con folio la decision la toma la MARCA que dejo el guardado
// (data.quoteDesactualizado): con marca recorre la secuencia de actualizar dentro
// del MISMO candado, sin marca es "ya subida". Sin folio, crear (las pruebas de
// arriba no cambian).

const MARCA_PENDIENTE = { fecha: '2026-10-04T10:00:00.000Z', pendiente: true };

test('#528 con folio y marca: actualiza con una sola lectura para decidir y devuelve operacion actualizar', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [cotizacion({ quoteDesactualizado: MARCA_PENDIENTE })], cola: ['1200'] });
  const r = await subirQuote(7, {}, m.deps);
  assert.equal(r.tipo, 'actualizada');
  assert.equal(r.operacion, 'actualizar');
  assert.equal(r.folio, '1200');
  assert.deepEqual(r.pasos[0], { name: 'actualizar quote', status: 'ok' });
  assert.equal(m.llamadas.actualizarQuoteOperam.length, 1);
  assert.deepEqual(m.llamadas.actualizarQuoteOperam[0][2], { lista: '15', transportista: 3 });
  assert.equal(m.llamadas.subirCotizacionOperam.length, 0);
  assert.equal(m.llamadas.darDeAlta.length, 0);
  assert.equal(nombres(m.secuencia)[0], 'obtener');
  assert.equal(nombres(m.secuencia).filter((n) => n === 'obtener').length, 2, 'una lectura decide y la otra es la relectura al lograrse');
  const reg = m.registro(7);
  assert.equal(reg.data.quoteDesactualizado, null, 'la lograda quita la marca');
  assert.notEqual(reg.data.huellaQuote, 'huella-previa');
  assert.deepEqual(m.llamadas.sacarDeLaColaPostFix, ['1200']);
});

test('#528 con folio y marca: la no actualizada sale con operacion y la marca de fallo', async () => {
  const m = subidaQuoteEnMemoria({
    cotizaciones: [cotizacion({ quoteDesactualizado: MARCA_PENDIENTE })], actualizar: RESULTADOS_ACTUALIZAR.escritoSinVerificar(),
  });
  const r = await subirQuote(7, {}, m.deps);
  assert.equal(r.tipo, 'no-actualizada');
  assert.equal(r.operacion, 'actualizar');
  assert.equal(r.escrito, true);
  assert.deepEqual(m.registro(7).data.quoteDesactualizado, {
    fecha: '2026-10-03T12:00:00.000Z', escrito: true, error: 'El quote quedo distinto de lo esperado',
    discrepancias: ['partida SKU-NUEVO: cantidad 2 en Operam, se esperaba 3'],
  });
});

test('#528 con folio y marca de fallo previa: tambien cae en actualizar', async () => {
  const m = subidaQuoteEnMemoria({
    cotizaciones: [cotizacion({ quoteDesactualizado: { fecha: '2026-07-01T00:00:00Z', escrito: false, error: 'previo', discrepancias: [] } })],
  });
  const r = await subirQuote(7, {}, m.deps);
  assert.equal(r.tipo, 'actualizada');
  assert.equal(r.operacion, 'actualizar');
});

test('#528 con folio, marca y pedido: bloqueo no-actualizable sin tocar Operam y la marca se conserva', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [cotizacion({ quoteDesactualizado: MARCA_PENDIENTE, orderOperam: '7077' })] });
  const r = await subirQuote(7, {}, m.deps);
  assert.deepEqual(r, {
    tipo: 'bloqueo', operacion: 'actualizar', motivo: 'no-actualizable',
    mensaje: 'La cotizaci\u00f3n ya tiene un pedido asociado en Operam: copia la cotizaci\u00f3n',
  });
  assert.equal(m.llamadas.actualizarQuoteOperam.length, 0);
  assert.equal(m.llamadas.actualizarDatos.length, 0);
  assert.deepEqual(m.registro(7).data.quoteDesactualizado, MARCA_PENDIENTE);
});

test('#528 con folio y sin marca: ya subida sin llamar a ningun doble de Operam', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [cotizacion({ quoteDesactualizado: null })] });
  const r = await subirQuote(7, {}, m.deps);
  assert.deepEqual(r, { tipo: 'ya-subida', folio: '1200', clienteId: null });
  assert.deepEqual(nombres(m.secuencia), ['obtener']);
  assert.equal(m.llamadas.actualizarQuoteOperam.length, 0);
  assert.equal(m.llamadas.sacarDeLaColaPostFix.length, 0);
});

test('#528 un solo candado: con la actualizacion en vuelo una segunda llamada recibe ocupado', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [cotizacion({ quoteDesactualizado: MARCA_PENDIENTE })] });
  const colgada = m.colgarActualizar();
  const primera = subirQuote(7, {}, m.deps);
  await new Promise((r) => setImmediate(r));
  assert.equal(await subirQuote(7, {}, m.deps), OCUPADO);
  assert.equal(await actualizarQuote(7, m.deps), OCUPADO);
  colgada.soltar(RESULTADOS_ACTUALIZAR.exito());
  assert.equal((await primera).tipo, 'actualizada');
});

// La carrera guardado / actualizacion en vuelo: guardar B mientras la
// actualizacion de A esta en vuelo deja el registro en B y el quote en A. Al
// lograrse se relee el registro: solo si su huella es la que se acaba de escribir
// se quita la marca.
test('#528 lograda con el registro cambiado durante la escritura: guarda la huella de lo escrito y conserva la marca', async () => {
  let m;
  m = subidaQuoteEnMemoria({
    cotizaciones: [cotizacion({ quoteDesactualizado: MARCA_PENDIENTE })],
    actualizar: async () => {
      await m.deps.actualizarDatos(7, { items: [{ codigo: 'SKU-NUEVO', descripcion: 'Plato', cantidad: 5, precio: 99.5, descuento: 0 }] });
      return RESULTADOS_ACTUALIZAR.exito();
    },
  });
  const r = await subirQuote(7, {}, m.deps);
  assert.equal(r.tipo, 'actualizada', 'lo escrito se escribio');
  const reg = m.registro(7);
  assert.deepEqual(reg.data.quoteDesactualizado, MARCA_PENDIENTE, 'la marca se conserva');
  assert.match(reg.data.huellaQuote, /"qty":3/, 'la huella es la de lo escrito, no la del registro actual');
  const siguiente = await subirQuote(7, {}, m.deps);
  assert.equal(siguiente.operacion, 'actualizar', 'la siguiente llamada vuelve a actualizar');
  assert.equal(m.llamadas.actualizarQuoteOperam[1][1].items[0].cantidad, 5);
});

test('#528 lograda con el registro cambiado y sin marca: pone la pendiente', async () => {
  let m;
  m = subidaQuoteEnMemoria({
    cotizaciones: [cotizacion()],
    actualizar: async () => {
      await m.deps.actualizarDatos(7, { items: [{ codigo: 'SKU-OTRO', descripcion: 'Taza', cantidad: 1, precio: 50, descuento: 0 }] });
      return RESULTADOS_ACTUALIZAR.exito();
    },
  });
  await actualizarQuote(7, m.deps);
  assert.deepEqual(m.registro(7).data.quoteDesactualizado, { fecha: '2026-10-03T12:00:00.000Z', pendiente: true });
});

test('#528 lograda con el registro sin cambio: la relectura confirma y quita la marca', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [cotizacion({ quoteDesactualizado: MARCA_PENDIENTE })] });
  await subirQuote(7, {}, m.deps);
  assert.equal(nombres(m.secuencia).filter((n) => n === 'obtener').length, 2, 'decidir y releer al lograrse');
  assert.equal(m.registro(7).data.quoteDesactualizado, null);
  assert.equal((await subirQuote(7, {}, m.deps)).tipo, 'ya-subida');
});

// --- Contacto de entrega y domicilio de entrega obligatorios (#558, ADR-0024) ---
// Sin el telefono del Contacto de entrega o sin domicilio de entrega la subida
// termina en bloqueo con motivo, al crear y al actualizar, ANTES de escribir nada en
// Operam ni en el registro.

test('#558 crear sin telefono del Contacto de entrega: bloqueo con motivo sin escribir en Operam ni en el registro', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva({ celEntrega: '' })] });
  const r = await subirQuote(21, {}, m.deps);
  assert.equal(r.tipo, 'bloqueo');
  assert.equal(r.motivo, 'sin-telefono-entrega');
  assert.match(r.mensaje, /tel\u00e9fono del Contacto de entrega/);
  assert.match(r.detalle, /celEntrega/);
  assert.deepEqual(nombres(m.secuencia), ['obtener']);
  assert.equal(m.llamadas.subirCotizacionOperam.length, 0);
  assert.equal(m.llamadas.actualizarDatos.length, 0);
});

test('#558 actualizar sin telefono del Contacto de entrega: bloqueo con motivo sin reescribir el quote ni tocar la marca', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [cotizacion({ cliente: { rfc: 'CPE921211N76', calle: 'Av. Reforma 123', cpEntrega: '56530', celEntrega: '' } })] });
  const r = await actualizarQuote(7, m.deps);
  assert.equal(r.tipo, 'bloqueo');
  assert.equal(r.motivo, 'sin-telefono-entrega');
  assert.match(r.mensaje, /tel\u00e9fono del Contacto de entrega/);
  assert.equal(m.llamadas.actualizarQuoteOperam.length, 0);
  assert.equal(m.llamadas.actualizarDatos.length, 0);
  assert.equal(m.llamadas.sacarDeLaColaPostFix.length, 0);
});

test('#558 crear por el camino del alta sin domicilio de entrega: bloqueo sin dar de alta ningun Cliente Operam', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva({ rfc: '', calle: '' })] });
  const r = await subirQuote(21, {}, m.deps);
  assert.equal(r.tipo, 'bloqueo');
  assert.equal(r.motivo, 'sin-domicilio-entrega');
  assert.match(r.mensaje, /domicilio de entrega/);
  assert.equal(m.llamadas.darDeAlta.length, 0);
  assert.equal(m.llamadas.subirCotizacionOperam.length, 0);
  assert.equal(m.llamadas.actualizarDatos.length, 0);
});

test('#558 el cliente que recoge en planta (sin envio) tambien necesita el telefono del Contacto de entrega', async () => {
  const sinEnvio = nueva({ celEntrega: '' });
  sinEnvio.data.envio = { carrier: '', servicio: '', precio: 0 };
  const m = subidaQuoteEnMemoria({ cotizaciones: [sinEnvio], transportista: { shipVia: null, linea: null, motivo: 'sin envio' } });
  const r = await subirQuote(21, {}, m.deps);
  assert.equal(r.tipo, 'bloqueo');
  assert.equal(r.motivo, 'sin-telefono-entrega');
  assert.equal(m.llamadas.subirCotizacionOperam.length, 0);
});

test('#558 sin correo del Contacto de entrega la subida procede', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva({ emailEntrega: '' })] });
  const r = await subirQuote(21, {}, m.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.folio, '1330');
});

test('#558 Editar una cotizacion vieja sin telefono de entrega: la entrada unica no actualiza y la marca se queda para el siguiente intento', async () => {
  const vieja = cotizacion({ quoteDesactualizado: MARCA_PENDIENTE, cliente: { rfc: 'CPE921211N76', calle: 'Av. Reforma 123', cpEntrega: '56530' } });
  const m = subidaQuoteEnMemoria({ cotizaciones: [vieja] });
  const r = await subirQuote(7, {}, m.deps);
  assert.equal(r.tipo, 'bloqueo');
  assert.equal(r.operacion, 'actualizar');
  assert.equal(r.motivo, 'sin-telefono-entrega');
  assert.equal(m.llamadas.actualizarQuoteOperam.length, 0);
  assert.equal(m.llamadas.actualizarDatos.length, 0);
  assert.deepEqual(m.registro(7).data.quoteDesactualizado, MARCA_PENDIENTE);
});

test('#558 actualizar sin domicilio de entrega: bloqueo con motivo sin reescribir el quote', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [cotizacion({ cliente: { rfc: 'CPE921211N76', calle: '', celEntrega: '5512345678' } })] });
  const r = await actualizarQuote(7, m.deps);
  assert.equal(r.tipo, 'bloqueo');
  assert.equal(r.motivo, 'sin-domicilio-entrega');
  assert.equal(m.llamadas.actualizarQuoteOperam.length, 0);
});
