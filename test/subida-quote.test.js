import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actualizarQuote, subirQuote, clasificarErrorQuote, marcarMotivoPre, conCandadoSubida, OCUPADO,
} from '../lib/subida-quote.js';
import {
  subidaQuoteEnMemoria, RESULTADOS_ACTUALIZAR, LISTA_ESCRITA, TRANSPORTISTA_ESCRITO,
  POSTFIX_VERIFICADO, CORREO_ENTREGA_ESCRITO, TELEFONO_ENTREGA_ESCRITO,
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
      cliente: { rfc: 'CPE921211N76', razonSocial: 'El Pendulo', nombreCorto: 'Pendulo', cpEntrega: '56530', calle: 'Av. Reforma 123', nombreEntrega: 'El Pendulo', celEntrega: '+52 55 1234 5678' },
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

// #556 / US16 de #557 (revision): el telefono y el correo del Contacto de entrega que la
// relectura de ACTUALIZAR no confirma entran a la cola de reintentos (#380), igual que
// al crear. Va DESPUES de sacar el folio de la cola: si no, la salida de lo viejo se
// llevaria tambien lo recien encolado. Solo telefono y correo: el transportista tiene
// el mismo hueco desde #448 y queda fuera de esta spec.
const TELEFONO_AJENO = {
  aplica: true, esperado: '+52 55 1234 5678', escrita: true, yaCorrecto: false, ok: false, verificado: true, encontrado: '+52 55 3466 7682', motivo: null,
};

test('#557 actualizar: un telefono del Contacto de entrega que la relectura no confirma se encola despues de sacar el folio de la cola', async () => {
  const m = subidaQuoteEnMemoria({
    cotizaciones: [cotizacion()], cola: ['1200'],
    actualizar: { ...RESULTADOS_ACTUALIZAR.exito(), telefonoEntrega: TELEFONO_AJENO, correoEntrega: CORREO_ENTREGA_ESCRITO, transportista: TRANSPORTISTA_ESCRITO },
  });
  const r = await actualizarQuote(7, m.deps);
  assert.equal(r.tipo, 'actualizada');
  assert.equal(r.pasos.find((p) => p.name === 'telefono del Contacto de entrega').status, 'warn');
  assert.equal(m.llamadas.encolarPostFix.length, 1);
  const nombres = m.secuencia.map(([n]) => n);
  assert.ok(nombres.indexOf('sacarDeLaColaPostFix') < nombres.indexOf('encolarPostFix'), nombres.join(', '));
  const [fila] = m.llamadas.encolarPostFix[0];
  assert.equal(fila.folio, '1200');
  assert.equal(fila.cotizacionId, 7);
  assert.equal(fila.vendedor, 'Tester');
  assert.equal(fila.vigencia, '2026-08-27');
  assert.equal(fila.lista, '15');
  assert.equal(fila.transportista, 3);
  assert.equal(fila.telefonoEntrega, '+52 55 1234 5678');
  assert.equal(fila.correoEntrega, '');
  assert.equal(fila.fechaDocumento, '2026-07-28');
  // La cola juzga SOLO telefono y correo: el contenido y la vigencia ya los verifico
  // la actualizacion (r.ok), y lista y transportista no entran.
  assert.deepEqual(fila.resultado, { ok: true, telefonoEntrega: TELEFONO_AJENO, correoEntrega: CORREO_ENTREGA_ESCRITO });
});

test('#557 actualizar: con telefono y correo confirmados no se encola nada, aunque el transportista no haya quedado', async () => {
  const transportistaAjeno = { ...TRANSPORTISTA_ESCRITO, ok: false, encontrado: '1' };
  const m = subidaQuoteEnMemoria({
    cotizaciones: [cotizacion()],
    actualizar: { ...RESULTADOS_ACTUALIZAR.exito(), telefonoEntrega: TELEFONO_ENTREGA_ESCRITO, correoEntrega: CORREO_ENTREGA_ESCRITO, transportista: transportistaAjeno },
  });
  await actualizarQuote(7, m.deps);
  assert.equal(m.llamadas.encolarPostFix.length, 0);
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
      cliente: { rfc: 'CPE921211N76', razonSocial: 'El Pendulo', nombreCorto: 'Pendulo', telefono: '5512345678', cpEntrega: '56530', calle: 'Av. Reforma 123', nombreEntrega: 'El Pendulo', celEntrega: '5512345678', ...cliente },
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
  const m = subidaQuoteEnMemoria({ cotizaciones: [cotizacion({ cliente: { rfc: 'CPE921211N76', calle: 'Av. Reforma 123', cpEntrega: '56530', nombreEntrega: 'El Pendulo', celEntrega: '' } })] });
  const r = await actualizarQuote(7, m.deps);
  assert.equal(r.tipo, 'bloqueo');
  assert.equal(r.motivo, 'sin-telefono-entrega');
  assert.match(r.mensaje, /tel\u00e9fono del Contacto de entrega/);
  assert.equal(m.llamadas.actualizarQuoteOperam.length, 0);
  assert.equal(m.llamadas.actualizarDatos.length, 0);
  assert.equal(m.llamadas.sacarDeLaColaPostFix.length, 0);
});

test('#558 crear por el camino del alta sin domicilio de entrega (sin CP): bloqueo sin dar de alta ningun Cliente Operam', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva({ rfc: '', cpEntrega: '' })] });
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
  const vieja = cotizacion({ quoteDesactualizado: MARCA_PENDIENTE, cliente: { rfc: 'CPE921211N76', calle: 'Av. Reforma 123', cpEntrega: '56530', nombreEntrega: 'El Pendulo' } });
  const m = subidaQuoteEnMemoria({ cotizaciones: [vieja] });
  const r = await subirQuote(7, {}, m.deps);
  assert.equal(r.tipo, 'bloqueo');
  assert.equal(r.operacion, 'actualizar');
  assert.equal(r.motivo, 'sin-telefono-entrega');
  assert.equal(m.llamadas.actualizarQuoteOperam.length, 0);
  assert.equal(m.llamadas.actualizarDatos.length, 0);
  assert.deepEqual(m.registro(7).data.quoteDesactualizado, MARCA_PENDIENTE);
});

test('#558 actualizar sin domicilio de entrega (sin CP): bloqueo con motivo sin reescribir el quote', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [cotizacion({ cliente: { rfc: 'CPE921211N76', calle: 'Av. Reforma 123', nombreEntrega: 'El Pendulo', celEntrega: '5512345678' } })] });
  const r = await actualizarQuote(7, m.deps);
  assert.equal(r.tipo, 'bloqueo');
  assert.equal(r.motivo, 'sin-domicilio-entrega');
  assert.equal(m.llamadas.actualizarQuoteOperam.length, 0);
});

// D3 (decisiones de Adrian 2026-10-09): de quien recibe se exige lo del Registro minimo
// de un prospecto -- celular, nombre y CP --; la calle ya no.
test('#557 D3 crear sin el nombre del Contacto de entrega: bloqueo con motivo sin escribir en Operam ni en el registro', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva({ nombreEntrega: '' })] });
  const r = await subirQuote(21, {}, m.deps);
  assert.equal(r.tipo, 'bloqueo');
  assert.equal(r.motivo, 'sin-nombre-entrega');
  assert.equal(r.campo, 'cl-nombre-entrega');
  assert.match(r.mensaje, /nombre del Contacto de entrega/);
  assert.deepEqual(nombres(m.secuencia), ['obtener']);
});

test('#557 D3 actualizar sin el nombre del Contacto de entrega: bloqueo sin reescribir el quote', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [cotizacion({ cliente: { ...cotizacion().data.cliente, nombreEntrega: '' } })] });
  const r = await actualizarQuote(7, m.deps);
  assert.equal(r.tipo, 'bloqueo');
  assert.equal(r.motivo, 'sin-nombre-entrega');
  assert.equal(m.llamadas.actualizarQuoteOperam.length, 0);
});

test('#557 D3 crear sin calle (con CP, nombre y celular) sube el quote', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva({ calle: '' })] });
  const r = await subirQuote(21, {}, m.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.folio, '1330');
});

// --- #561: el Contacto de entrega queda en el domicilio de entrega en Operam ---
// La escritura es del modulo Contactos en Operam (ADR-0024), aqui sustituido: la
// subida le pide escribirlo DESPUES del quote, sobre el Cliente Operam y el domicilio
// a los que se subio, y reporta su paso. Si falla, la subida sigue lograda con aviso.

const LUCIA = { nombreEntrega: 'Lucia Recibe', celEntrega: '+52 55 1234 5678', emailEntrega: 'lucia@example.com' };
const CONTACTO_ESCRITO = {
  tipo: 'lograda', escrito: true, personId: '1301', noAplicados: [],
  pasos: [{ name: 'contacto de entrega', status: 'ok', mensaje: 'Lucia Recibe quedo en Operam como contacto General y de Entrega del domicilio de entrega.', detalle: 'domicilio 564 del cliente 15: persona 1301 creada' }],
};

test('#561 crear: despues del quote pide escribir el Contacto de entrega en el domicilio al que se subio', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva(LUCIA)], subir: { folio: '1330', customerId: 15, branchId: 564 }, contactoEntrega: CONTACTO_ESCRITO });
  await subirQuote(21, {}, m.deps);
  assert.deepEqual(m.llamadas.escribirContactoEntrega, [[{
    clienteId: 15, domicilioId: 564,
    contacto: { nombre: 'Lucia Recibe', telefono: '+52 55 1234 5678', correo: 'lucia@example.com' },
  }]]);
  assert.ok(nombres(m.secuencia).indexOf('corregirVigenciaQuote') < nombres(m.secuencia).indexOf('escribirContactoEntrega'));
});

test('#561 crear: el paso del Contacto de entrega sale en el reporte de la subida, despues del post-fix y antes de la liga', async () => {
  const m = subidaQuoteEnMemoria({
    cotizaciones: [nueva(LUCIA)], subir: { folio: '1330', customerId: 15, branchId: 564 },
    contactoEntrega: CONTACTO_ESCRITO, prospectos: [CONTACTO_SIN_LIGAS],
  });
  const r = await subirQuote(21, {}, m.deps);
  assert.deepEqual(r.pasos.map((p) => p.name), [
    'post-fix vigencia', 'lista del quote', 'transportista del quote',
    'telefono del Contacto de entrega', 'correo del Contacto de entrega',
    'contacto de entrega', 'ligar prospecto',
  ]);
  assert.deepEqual(r.pasos[5], CONTACTO_ESCRITO.pasos[0]);
});

test('#561 crear: si el modulo falla, la subida queda lograda con aviso y el folio se conserva', async () => {
  const m = subidaQuoteEnMemoria({
    cotizaciones: [nueva(LUCIA)], subir: { folio: '1330', customerId: 15, branchId: 564 },
    contactoEntrega: () => { throw new Error('la sesion web no abrio'); },
  });
  const r = await subirQuote(21, {}, m.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.folio, '1330');
  assert.equal(m.registro(21).folioOperam, '1330');
  const paso = r.pasos.find((p) => p.name === 'contacto de entrega');
  assert.equal(paso.status, 'warn');
  assert.doesNotMatch(paso.mensaje, /sesion web/);
  assert.match(paso.detalle, /la sesion web no abrio/);
});

test('#561 crear: el bloqueo que devuelve el modulo sale como su paso y la subida sigue lograda', async () => {
  const bloqueo = {
    tipo: 'bloqueo', motivo: 'operam', mensaje: 'No se pudo escribir el Contacto de entrega en el domicilio de entrega en Operam.', detalle: 'FA 500',
    pasos: [{ name: 'contacto de entrega', status: 'error', mensaje: 'No se pudo escribir el Contacto de entrega en el domicilio de entrega en Operam.', detalle: 'FA 500' }],
  };
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva(LUCIA)], subir: { folio: '1330', customerId: 15, branchId: 564 }, contactoEntrega: bloqueo });
  const r = await subirQuote(21, {}, m.deps);
  assert.equal(r.tipo, 'lograda');
  assert.deepEqual(r.pasos.at(-1), bloqueo.pasos[0]);
});

test('#561 crear: sin folio no hay quote, y el Contacto de entrega no se escribe', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva(LUCIA)], subir: { folio: '', customerId: 15, branchId: 564 }, contactoEntrega: CONTACTO_ESCRITO });
  await subirQuote(21, {}, m.deps);
  assert.equal(m.llamadas.escribirContactoEntrega.length, 0);
});

// --- #562: el General que ya estaba es una pregunta al vendedor -----------------
// El modulo Contactos en Operam (sustituido) devuelve la pregunta sin escribir nada.
// El quote ya esta en Operam, asi que la pregunta viaja en la subida LOGRADA (nunca en
// un desenlace sin folio) y el registro guarda la marca "Contacto de entrega
// pendiente" con lo que se pregunto: por ahi entra el reintento con la decision.

const PREGUNTA_ALFA = {
  tipo: 'pregunta', motivo: 'general-existente',
  desplazados: [{ personId: '1294', nombre: 'Alfa G Prueba', roles: ['general'] }],
  mensaje: 'Lucia Recibe queda como contacto General y de Entrega del domicilio de entrega en Operam. Alfa G Prueba deja de ser el contacto General de este domicilio y queda como contacto de Entrega.',
  detalle: 'domicilio 564 del cliente 15: General actual persona 1294; un segundo General no se escribe',
  pasos: [{ name: 'contacto de entrega', status: 'warn', mensaje: 'El Contacto de entrega todavia no se escribio en Operam: falta que confirmes si Alfa G Prueba deja de ser el contacto General del domicilio de entrega.', detalle: 'domicilio 564 del cliente 15: pendiente' }],
};

const MARCA_ALFA = {
  fecha: '2026-10-03T12:00:00.000Z', clienteId: 15, domicilioId: 564, motivo: 'general-existente',
  contacto: { nombre: 'Lucia Recibe' },
  desplazados: PREGUNTA_ALFA.desplazados, mensaje: PREGUNTA_ALFA.mensaje, detalle: PREGUNTA_ALFA.detalle,
};

const PREGUNTA_DE_LA_MARCA = {
  motivo: 'general-existente', contacto: { nombre: 'Lucia Recibe' },
  desplazados: PREGUNTA_ALFA.desplazados, mensaje: PREGUNTA_ALFA.mensaje, detalle: PREGUNTA_ALFA.detalle,
};

test('#562 crear con un General previo: la subida queda lograda con folio, la pregunta y el aviso, y el registro guarda el contacto pendiente', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva(LUCIA)], subir: { folio: '1330', customerId: 15, branchId: 564 }, contactoEntrega: PREGUNTA_ALFA });
  const r = await subirQuote(21, {}, m.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.folio, '1330');
  assert.deepEqual(r.preguntaContacto, PREGUNTA_DE_LA_MARCA);
  assert.deepEqual(r.pasos.find((p) => p.name === 'contacto de entrega'), PREGUNTA_ALFA.pasos[0]);
  assert.equal(m.registro(21).folioOperam, '1330');
  assert.deepEqual(m.registro(21).data.contactoEntregaPendiente, MARCA_ALFA);
});

// El reintento con la decision entra por la ENTRADA UNICA (#528): con folio y la marca
// "Contacto de entrega pendiente" la subida no vuelve a subir nada, solo atiende al
// contacto, en el Cliente Operam y el domicilio de la marca.
const subida = (marca = MARCA_ALFA, extra = {}) => nueva(LUCIA, { folioOperam: '1330', data: { ...nueva(LUCIA).data, contactoEntregaPendiente: marca, ...extra } });
const DESPLAZAR_ALFA = { contactoEntrega: { desplazar: ['1294'] } };
const DESPLAZADO = {
  tipo: 'lograda', escrito: true, personId: '1301', desplazados: [{ personId: '1294', nombre: 'Alfa G Prueba', roles: ['delivery'] }], noAplicados: [],
  pasos: [{ name: 'contacto de entrega', status: 'ok', mensaje: 'Lucia Recibe quedo en Operam como contacto General y de Entrega del domicilio de entrega; Alfa G Prueba dejo de ser General y quedo como contacto de Entrega.', detalle: 'domicilio 564 del cliente 15: persona 1301' }],
};

test('#562 reintento confirmado: escribe el Contacto de entrega con la decision en el domicilio de la marca, sin volver a subir el quote, y quita la marca', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [subida()], contactoEntrega: DESPLAZADO });
  const r = await subirQuote(21, DESPLAZAR_ALFA, m.deps);
  assert.deepEqual(m.llamadas.escribirContactoEntrega, [[{
    clienteId: 15, domicilioId: 564,
    contacto: { nombre: 'Lucia Recibe', telefono: '+52 55 1234 5678', correo: 'lucia@example.com' },
    cotizacion: { id: 21, folio: '1330' },
    decision: { desplazar: ['1294'] },
  }]]);
  assert.equal(r.tipo, 'contacto-entrega');
  assert.equal(r.folio, '1330');
  assert.deepEqual(r.pasos, DESPLAZADO.pasos);
  assert.equal(r.preguntaContacto, undefined);
  assert.equal(m.llamadas.subirCotizacionOperam.length, 0);
  assert.equal(m.llamadas.corregirVigenciaQuote.length, 0);
  assert.equal(m.registro(21).data.contactoEntregaPendiente, null);
});

// Sin contestar, el contacto sigue pendiente: regenerar sin cambios (ya-subida) vuelve a
// traer la pregunta de la marca, sin leer Operam.
test('#562 con folio, sin cambios y sin decision: ya-subida trae otra vez la pregunta pendiente sin tocar Operam', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [subida()] });
  const r = await subirQuote(21, {}, m.deps);
  assert.equal(r.tipo, 'ya-subida');
  assert.deepEqual(r.preguntaContacto, PREGUNTA_DE_LA_MARCA);
  assert.equal(m.llamadas.escribirContactoEntrega.length, 0);
});

// D1 (decisiones de Adrian 2026-10-09): la pregunta solo se resuelve confirmando. Un
// cuerpo con `conservar` (la salida que se quito, de una pestana con el app.js anterior)
// no es una decision: la marca se queda y la pregunta vuelve, sin tocar Operam.
test('#557 D1 un cuerpo con "conservar" se ignora: ya-subida con la pregunta, la marca sigue y no toca Operam', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [subida()] });
  const r = await subirQuote(21, { contactoEntrega: { conservar: true } }, m.deps);
  assert.equal(r.tipo, 'ya-subida');
  assert.deepEqual(r.preguntaContacto, PREGUNTA_DE_LA_MARCA);
  assert.equal(m.llamadas.escribirContactoEntrega.length, 0);
  assert.deepEqual(m.registro(21).data.contactoEntregaPendiente, MARCA_ALFA);
});

// Revalida (patron de #368): si el General cambio, el modulo vuelve a preguntar y la
// marca se reemplaza con la pregunta nueva.
test('#562 reintento cuando el General cambio: la marca se reemplaza con la pregunta nueva y viaja en la respuesta', async () => {
  const otra = { ...PREGUNTA_ALFA, desplazados: [{ personId: '1297', nombre: 'Beta Nueva General', roles: ['general'] }], mensaje: 'Beta Nueva General deja de ser el contacto General', detalle: 'persona 1297' };
  const m = subidaQuoteEnMemoria({ cotizaciones: [subida()], contactoEntrega: otra });
  const r = await subirQuote(21, DESPLAZAR_ALFA, m.deps);
  assert.equal(r.tipo, 'contacto-entrega');
  assert.deepEqual(r.preguntaContacto.desplazados, otra.desplazados);
  assert.deepEqual(m.registro(21).data.contactoEntregaPendiente.desplazados, otra.desplazados);
  assert.deepEqual([m.registro(21).data.contactoEntregaPendiente.clienteId, m.registro(21).data.contactoEntregaPendiente.domicilioId], [15, 564]);
});

// Si la web legacy falla, la decision no se pierde: la marca se queda y el vendedor
// puede volver a contestar.
test('#562 reintento con la web legacy caida: la marca se queda y el paso avisa', async () => {
  const bloqueo = { tipo: 'bloqueo', motivo: 'operam', mensaje: 'No se pudo escribir', detalle: 'FA 500', pasos: [{ name: 'contacto de entrega', status: 'error', mensaje: 'No se pudo escribir el Contacto de entrega en el domicilio de entrega en Operam.', detalle: 'FA 500' }] };
  const m = subidaQuoteEnMemoria({ cotizaciones: [subida()], contactoEntrega: bloqueo });
  const r = await subirQuote(21, DESPLAZAR_ALFA, m.deps);
  assert.equal(r.tipo, 'contacto-entrega');
  assert.deepEqual(r.pasos, bloqueo.pasos);
  assert.deepEqual(m.registro(21).data.contactoEntregaPendiente, MARCA_ALFA);
  assert.deepEqual(r.preguntaContacto, PREGUNTA_DE_LA_MARCA);
});

test('#562 una decision sin contacto pendiente no escribe nada: es ya-subida', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva(LUCIA, { folioOperam: '1330' })] });
  const r = await subirQuote(21, DESPLAZAR_ALFA, m.deps);
  assert.equal(r.tipo, 'ya-subida');
  assert.equal(r.preguntaContacto, undefined);
  assert.equal(m.llamadas.escribirContactoEntrega.length, 0);
});

// --- #563: la persona elegida y la actualizacion -------------------------------
// La cotizacion guarda el person_id de la persona que el vendedor eligio en el
// selector (data.cliente.contactoEntregaPersonId) y viaja al modulo, que la edita en
// vez de crear otra. La Subida del quote cubre crear Y actualizar (ADR-0022): al
// reescribir el quote el Contacto de entrega tambien se escribe, en el Cliente Operam
// y el domicilio a los que quedo el quote, con la misma pregunta, marca y reintento.

const PREGUNTA_PISA = {
  tipo: 'pregunta', motivo: 'pisa-datos',
  persona: { personId: '1249', nombre: 'Adrian Bosques Nombre' }, desplazados: [],
  pisa: [{ personId: '1249', campo: 'telefono', viejo: '55 8888 0000', nuevo: '+52 55 1234 5678' }],
  mensaje: 'Se cambian datos que Adrian Bosques Nombre ya tenia en Operam: el Telefono pasa de 55 8888 0000 a +52 55 1234 5678 (55 8888 0000 queda en Telefono Secundario).',
  detalle: 'domicilio 564 del cliente 15: persona 1249: phone "55 8888 0000" -> "+52 55 1234 5678"',
  pasos: [{ name: 'contacto de entrega', status: 'warn', mensaje: 'El Contacto de entrega todavia no se escribio en Operam: falta que confirmes los cambios a los datos de Adrian Bosques Nombre.', detalle: 'pendiente' }],
};

test('#563 crear: el person_id de la persona elegida viaja al modulo con el Contacto de entrega', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva({ ...LUCIA, contactoEntregaPersonId: '1249' })], subir: { folio: '1330', customerId: 15, branchId: 564 }, contactoEntrega: CONTACTO_ESCRITO });
  await subirQuote(21, {}, m.deps);
  assert.deepEqual(m.llamadas.escribirContactoEntrega[0][0].contacto, { nombre: 'Lucia Recibe', telefono: '+52 55 1234 5678', correo: 'lucia@example.com', personId: '1249' });
});

const ACTUALIZADO_EN_564 = () => ({ ...RESULTADOS_ACTUALIZAR.exito(), customerId: '15', branchId: '564' });

test('#563 actualizar: despues de reescribir el quote escribe el Contacto de entrega en el Cliente Operam y el domicilio del quote', async () => {
  const m = subidaQuoteEnMemoria({
    cotizaciones: [cotizacion({ cliente: { ...cotizacion().data.cliente, ...LUCIA, contactoEntregaPersonId: '1249' } })],
    actualizar: ACTUALIZADO_EN_564(), contactoEntrega: CONTACTO_ESCRITO,
  });
  const r = await actualizarQuote(7, m.deps);
  assert.equal(r.tipo, 'actualizada');
  assert.deepEqual(m.llamadas.escribirContactoEntrega, [[{
    clienteId: '15', domicilioId: '564',
    contacto: { nombre: 'Lucia Recibe', telefono: '+52 55 1234 5678', correo: 'lucia@example.com', personId: '1249' },
  }]]);
  assert.deepEqual(r.pasos.at(-1), CONTACTO_ESCRITO.pasos[0]);
  assert.equal(r.preguntaContacto, undefined);
});

test('#563 actualizar: si el quote no se reescribio, el Contacto de entrega no se escribe', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [cotizacion()], actualizar: RESULTADOS_ACTUALIZAR.escritoSinVerificar(), contactoEntrega: CONTACTO_ESCRITO });
  const r = await actualizarQuote(7, m.deps);
  assert.equal(r.tipo, 'no-actualizada');
  assert.equal(m.llamadas.escribirContactoEntrega.length, 0);
});

test('#563 actualizar con datos que se pisarian: actualizada con la pregunta junto al folio y la marca del contacto pendiente', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [cotizacion()], actualizar: ACTUALIZADO_EN_564(), contactoEntrega: PREGUNTA_PISA });
  const r = await actualizarQuote(7, m.deps);
  assert.equal(r.tipo, 'actualizada');
  assert.deepEqual(r.preguntaContacto, {
    motivo: 'pisa-datos', contacto: { nombre: 'El Pendulo' }, desplazados: [], persona: PREGUNTA_PISA.persona, pisa: PREGUNTA_PISA.pisa,
    mensaje: PREGUNTA_PISA.mensaje, detalle: PREGUNTA_PISA.detalle,
  });
  const marca = m.registro(7).data.contactoEntregaPendiente;
  assert.deepEqual([marca.clienteId, marca.domicilioId, marca.motivo, marca.pisa], ['15', '564', 'pisa-datos', PREGUNTA_PISA.pisa]);
  assert.equal(m.registro(7).data.quoteDesactualizado, null);
});

test('#563 la entrada unica con la marca del guardado actualiza y trae la pregunta del contacto con operacion actualizar', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [cotizacion({ quoteDesactualizado: { fecha: '2026-10-04T10:00:00.000Z', pendiente: true } })], actualizar: ACTUALIZADO_EN_564(), contactoEntrega: PREGUNTA_PISA });
  const r = await subirQuote(7, {}, m.deps);
  assert.equal(r.operacion, 'actualizar');
  assert.equal(r.tipo, 'actualizada');
  assert.deepEqual(r.preguntaContacto.pisa, PREGUNTA_PISA.pisa);
});

// Revision de #557: la respuesta del vendedor sobrevive a la marca quoteDesactualizado
// (#528). Si el vendedor cambio la cotizacion y ademas contesto la pregunta del
// contacto, la entrada unica actualiza el quote y el contacto se escribe CON su
// decision: sin ella el modulo volvia a preguntar lo mismo.
const pendienteYDesactualizada = (marca) => cotizacion({
  cliente: { ...cotizacion().data.cliente, ...LUCIA },
  quoteDesactualizado: { fecha: '2026-10-04T10:00:00.000Z', pendiente: true },
  contactoEntregaPendiente: marca,
});

test('#557 con quote desactualizado y contacto pendiente, la decision del vendedor llega al modulo al actualizar', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [pendienteYDesactualizada(MARCA_ALFA)], actualizar: ACTUALIZADO_EN_564(), contactoEntrega: DESPLAZADO });
  const r = await subirQuote(7, DESPLAZAR_ALFA, m.deps);
  assert.equal(r.operacion, 'actualizar');
  assert.equal(r.tipo, 'actualizada');
  assert.equal(m.llamadas.actualizarQuoteOperam.length, 1);
  const [[solicitud]] = m.llamadas.escribirContactoEntrega;
  assert.deepEqual(solicitud.decision, { desplazar: ['1294'] });
  assert.deepEqual(solicitud.cotizacion, { id: 7, folio: cotizacion().folioOperam });
  assert.equal(r.preguntaContacto, undefined);
  assert.equal(m.registro(7).data.contactoEntregaPendiente, null);
  assert.deepEqual(r.pasos.at(-1), DESPLAZADO.pasos[0]);
});

test('#557 D1 con quote desactualizado, "conservar" no es decision: actualiza el quote y el contacto se escribe sin decision', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [pendienteYDesactualizada(MARCA_ALFA)], actualizar: ACTUALIZADO_EN_564(), contactoEntrega: PREGUNTA_ALFA });
  const r = await subirQuote(7, { contactoEntrega: { conservar: true } }, m.deps);
  assert.equal(r.tipo, 'actualizada');
  assert.equal(m.llamadas.actualizarQuoteOperam.length, 1);
  const [[solicitud]] = m.llamadas.escribirContactoEntrega;
  assert.equal(solicitud.decision, undefined);
  assert.equal(r.preguntaContacto.motivo, 'general-existente');
  assert.equal(m.registro(7).data.contactoEntregaPendiente.motivo, 'general-existente');
});

test('#557 con quote desactualizado y una decision sin contacto pendiente, el contacto se escribe sin decision', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [pendienteYDesactualizada(undefined)], actualizar: ACTUALIZADO_EN_564(), contactoEntrega: CONTACTO_ESCRITO });
  await subirQuote(7, DESPLAZAR_ALFA, m.deps);
  const [[solicitud]] = m.llamadas.escribirContactoEntrega;
  assert.equal(solicitud.decision, undefined);
});

test('#563 actualizar: el contacto escrito quita la marca pendiente que quedaba; si la web legacy falla, la marca se queda', async () => {
  const escrito = subidaQuoteEnMemoria({ cotizaciones: [cotizacion({ contactoEntregaPendiente: MARCA_ALFA })], actualizar: ACTUALIZADO_EN_564(), contactoEntrega: CONTACTO_ESCRITO });
  await actualizarQuote(7, escrito.deps);
  assert.equal(escrito.registro(7).data.contactoEntregaPendiente, null);

  const bloqueo = { tipo: 'bloqueo', motivo: 'operam', mensaje: 'No se pudo', detalle: 'FA 500', pasos: [{ name: 'contacto de entrega', status: 'error', mensaje: 'No se pudo escribir el Contacto de entrega en el domicilio de entrega en Operam.', detalle: 'FA 500' }] };
  const caida = subidaQuoteEnMemoria({ cotizaciones: [cotizacion({ contactoEntregaPendiente: MARCA_ALFA })], actualizar: ACTUALIZADO_EN_564(), contactoEntrega: bloqueo });
  const r = await actualizarQuote(7, caida.deps);
  assert.equal(r.tipo, 'actualizada');
  assert.deepEqual(caida.registro(7).data.contactoEntregaPendiente, MARCA_ALFA);
  assert.deepEqual(r.pasos.at(-1), bloqueo.pasos[0]);
});

// El reintento con la decision del vendedor: el cuerpo que dicta el servidor lleva lo
// que se pregunto (las casillas con su valor viejo), y el modulo revalida contra Operam.
const MARCA_PISA = {
  fecha: '2026-10-03T12:00:00.000Z', clienteId: '15', domicilioId: '564', motivo: 'pisa-datos',
  contacto: { nombre: 'Lucia Recibe' }, desplazados: [], persona: PREGUNTA_PISA.persona, pisa: PREGUNTA_PISA.pisa,
  mensaje: PREGUNTA_PISA.mensaje, detalle: PREGUNTA_PISA.detalle,
};

test('#563 reintento confirmado con casillas a pisar: la decision llega al modulo con lo que se pregunto', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [subida(MARCA_PISA)], contactoEntrega: CONTACTO_ESCRITO });
  const r = await subirQuote(21, { contactoEntrega: { desplazar: [], pisar: [{ personId: '1249', campo: 'telefono', viejo: '55 8888 0000' }] } }, m.deps);
  assert.equal(r.tipo, 'contacto-entrega');
  const [[solicitud]] = m.llamadas.escribirContactoEntrega;
  assert.deepEqual(solicitud.decision, { desplazar: [], pisar: [{ personId: '1249', campo: 'telefono', viejo: '55 8888 0000' }] });
  assert.deepEqual([solicitud.clienteId, solicitud.domicilioId], ['15', '564']);
  assert.equal(m.registro(21).data.contactoEntregaPendiente, null);
});

test('#557 D1 con casillas a pisar, "conservar" tampoco es decision: la pregunta de los datos vuelve y la marca sigue', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [subida(MARCA_PISA)] });
  const r = await subirQuote(21, { contactoEntrega: { conservar: true } }, m.deps);
  assert.equal(r.tipo, 'ya-subida');
  assert.deepEqual(r.preguntaContacto.pisa, MARCA_PISA.pisa);
  assert.equal(m.llamadas.escribirContactoEntrega.length, 0);
  assert.deepEqual(m.registro(21).data.contactoEntregaPendiente, MARCA_PISA);
});

// --- #565: cambiar el numero de un Contacto en Operam funde los Contactos ------
// Cuando el modulo Contactos en Operam CONFIRMA (relectura) que el numero de identidad
// de un person_id cambio (`cambioDeNumero`: Cel > Telefono > Secundario, revision de
// #557), la Subida del quote pide a la Fusion de Contactos (aqui sustituida) fundir el
// Contacto del numero viejo en el del nuevo. Su paso entra al reporte; una falla de la
// fusion no tumba la subida.

const MARCA_PISA_CEL = {
  ...MARCA_PISA,
  pisa: [{ personId: '1249', campo: 'cel', viejo: '55 8888 0000', nuevo: '+52 55 1234 5678' }],
};
const DECISION_CEL = { contactoEntrega: { desplazar: [], pisar: [{ personId: '1249', campo: 'cel', viejo: '55 8888 0000' }], numero: { viejo: '55 8888 0000', mover: true } } };
const EDITADO_CEL = {
  tipo: 'lograda', escrito: true, personId: '1249', noAplicados: [],
  cambioDeNumero: { personId: '1249', viejo: '55 8888 0000', nuevo: '+52 55 1234 5678' },
  pasos: [{ name: 'contacto de entrega', status: 'ok', mensaje: 'Adrian Bosques Nombre quedo en Operam como contacto General y de Entrega del domicilio de entrega, con sus datos al dia.', detalle: 'persona 1249 editada' }],
};
const FUNDIDO = {
  tipo: 'lograda', fundido: true, forma: 'fundido', contactoId: 20, contactoFundido: 10, oportunidades: [30], cotizaciones: [21],
  pasos: [{ name: 'Contacto movido al n\u00famero nuevo', status: 'ok', mensaje: 'Lucia Recibe cambio de numero', detalle: 'persona 1249: Contacto 10 fundido en 20' }],
};

test('#565 el cambio confirmado del numero de un person_id funde los Contactos: viejo, nuevo, person_id y cotizacion, con su paso tras el del contacto', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [subida(MARCA_PISA_CEL)], contactoEntrega: EDITADO_CEL, fusion: FUNDIDO });
  const r = await subirQuote(21, DECISION_CEL, m.deps);
  assert.equal(r.tipo, 'contacto-entrega');
  assert.deepEqual(m.llamadas.fundirContactos, [[{
    celularViejo: '55 8888 0000', celularNuevo: '+52 55 1234 5678', personId: '1249',
    cotizacion: { id: 21, folio: '1330' }, vendedor: 'Tester',
  }]]);
  assert.deepEqual(r.pasos, [...EDITADO_CEL.pasos, ...FUNDIDO.pasos]);
  assert.equal(m.registro(21).data.contactoEntregaPendiente, null);
});

test('#565 una persona nueva o una edicion que no cambia el numero de identidad no funde nada', async () => {
  const nuevo = subidaQuoteEnMemoria({ cotizaciones: [nueva(LUCIA)], subir: { folio: '1330', customerId: 15, branchId: 564 }, contactoEntrega: CONTACTO_ESCRITO, fusion: FUNDIDO });
  const r = await subirQuote(21, {}, nuevo.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(nuevo.llamadas.fundirContactos.length, 0);
  assert.equal(r.pasos.some(p => p.name === 'Contacto movido al n\u00famero nuevo'), false);

  const { cambioDeNumero: _sinCambio, ...soloTelefono } = EDITADO_CEL;
  const m = subidaQuoteEnMemoria({ cotizaciones: [subida(MARCA_PISA)], contactoEntrega: soloTelefono, fusion: FUNDIDO });
  await subirQuote(21, { contactoEntrega: { desplazar: [], pisar: [{ personId: '1249', campo: 'telefono', viejo: '55 8888 0000' }] } }, m.deps);
  assert.equal(m.llamadas.fundirContactos.length, 0);
});

test('#565 si la fusion falla, el contacto queda escrito y el paso avisa en dos capas', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [subida(MARCA_PISA_CEL)], contactoEntrega: EDITADO_CEL, fusion: () => { throw new Error('Neon caido'); } });
  const r = await subirQuote(21, DECISION_CEL, m.deps);
  assert.equal(r.tipo, 'contacto-entrega');
  const paso = r.pasos.find(p => p.name === 'Contacto movido al n\u00famero nuevo');
  assert.equal(paso.status, 'warn');
  assert.doesNotMatch(paso.mensaje, /Neon/);
  assert.doesNotMatch(paso.mensaje, /fund|fusi/i);
  assert.match(paso.detalle, /Neon caido/);
  assert.match(paso.detalle, /1249/);
  assert.equal(m.registro(21).data.contactoEntregaPendiente, null);
});

// D4 (decisiones de Adrian 2026-10-09): nada se mueve en el cotizador sin que el
// vendedor confirme el cambio de numero. Una edicion que llega con el numero cambiado
// pero sin esa confirmacion no funde.
test('#557 D4 al actualizar, un cambio de numero sin la confirmacion del vendedor no mueve nada en el cotizador', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [cotizacion({ cliente: { ...cotizacion().data.cliente, ...LUCIA, contactoEntregaPersonId: '1249' } })], actualizar: ACTUALIZADO_EN_564(), contactoEntrega: EDITADO_CEL, fusion: FUNDIDO });
  const r = await actualizarQuote(7, m.deps);
  assert.equal(r.tipo, 'actualizada');
  assert.equal(m.llamadas.fundirContactos.length, 0);
  assert.deepEqual(r.pasos.at(-1), EDITADO_CEL.pasos[0]);
});

test('#565 al actualizar con el cambio de numero confirmado (quote desactualizado), lo del numero viejo pasa al nuevo', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [pendienteYDesactualizada(MARCA_PISA_CEL)], actualizar: ACTUALIZADO_EN_564(), contactoEntrega: EDITADO_CEL, fusion: FUNDIDO });
  const r = await subirQuote(7, DECISION_CEL, m.deps);
  assert.equal(r.tipo, 'actualizada');
  assert.deepEqual(m.llamadas.fundirContactos.map(([s]) => [s.celularViejo, s.celularNuevo, s.personId, s.cotizacion]), [['55 8888 0000', '+52 55 1234 5678', '1249', { id: 7, folio: cotizacion().folioOperam }]]);
  assert.deepEqual(r.pasos.at(-1), FUNDIDO.pasos[0]);
});

// --- D4: la pregunta del cambio de numero (decisiones de Adrian 2026-10-09) ---------
// El modulo Contactos en Operam pregunta por el cambio de celular sin saber que hay en el
// cotizador; la Subida del quote le pide a la Fusion de Contactos el resumen (cuantas
// oportunidades y cotizaciones se mueven y si el numero viejo tiene las de OTRAS
// personas) y arma la pregunta con las palabras de la decision. La marca guarda lo mismo.
const PREGUNTA_NUMERO = {
  tipo: 'pregunta', motivo: 'pisa-datos',
  persona: { personId: '1249', nombre: 'Adrian Bosques Nombre' }, desplazados: [],
  pisa: [{ personId: '1249', campo: 'cel', viejo: '55 8888 0000', nuevo: '+52 55 1234 5678' }],
  cambioDeNumero: { personId: '1249', viejo: '55 8888 0000', nuevo: '+52 55 1234 5678' },
  partes: { numero: 'El celular de Adrian Bosques Nombre cambia de 55 8888 0000 a +52 55 1234 5678.', resto: '' },
  mensaje: 'El celular de Adrian Bosques Nombre cambia de 55 8888 0000 a +52 55 1234 5678.',
  detalle: 'domicilio 564 del cliente 15: numero de identidad de la persona 1249 "55 8888 0000" -> "+52 55 1234 5678"',
  pasos: [{ name: 'contacto de entrega', status: 'warn', mensaje: 'El Contacto de entrega todavia no se escribio en Operam: falta que confirmes el cambio de celular de Adrian Bosques Nombre.', detalle: 'pendiente' }],
};
const CON_PERSONA = { ...LUCIA, contactoEntregaPersonId: '1249' };

test('#557 D4 caso simple: la pregunta dice el cambio de celular y cuantas oportunidades y cotizaciones pasan al numero nuevo', async () => {
  const m = subidaQuoteEnMemoria({
    cotizaciones: [nueva(CON_PERSONA)], subir: { folio: '1330', customerId: 15, branchId: 564 }, contactoEntrega: PREGUNTA_NUMERO,
    resumenNumero: { contactoViejo: true, oportunidades: 2, cotizaciones: 1, otrasPersonas: [] },
  });
  const r = await subirQuote(21, {}, m.deps);
  assert.equal(r.tipo, 'lograda');
  assert.deepEqual(m.llamadas.resumenDelCambioDeNumero, [[{ celularViejo: '55 8888 0000', nombres: ['Adrian Bosques Nombre', 'Lucia Recibe'] }]]);
  assert.equal(r.preguntaContacto.mensaje,
    'El celular de Adrian Bosques Nombre cambia de 55 8888 0000 a +52 55 1234 5678. En el cotizador, todo lo del 55 8888 0000 pasa al n\u00famero nuevo: 2 oportunidades y 1 cotizaci\u00f3n. El 55 8888 0000 deja de aparecer como Contacto.');
  assert.deepEqual(r.preguntaContacto.numero, {
    viejo: '55 8888 0000', nuevo: '+52 55 1234 5678', contactoViejo: true, oportunidades: 2, cotizaciones: 1, otrasPersonas: [], compartido: false, mover: true,
  });
  const marca = m.registro(21).data.contactoEntregaPendiente;
  assert.deepEqual([marca.mensaje, marca.numero], [r.preguntaContacto.mensaje, r.preguntaContacto.numero]);
  assert.equal(m.llamadas.fundirContactos.length, 0);
});

test('#557 D4 telefono compartido: la pregunta nombra a las otras personas del numero viejo y avisa que puede ser una oficina', async () => {
  const m = subidaQuoteEnMemoria({
    cotizaciones: [nueva(CON_PERSONA)], subir: { folio: '1330', customerId: 15, branchId: 564 }, contactoEntrega: PREGUNTA_NUMERO,
    resumenNumero: { contactoViejo: true, oportunidades: 3, cotizaciones: 2, otrasPersonas: ['Pedro Lopez', 'Maria Ruiz'] },
  });
  const r = await subirQuote(21, {}, m.deps);
  assert.match(r.preguntaContacto.mensaje, /cambia de 55 8888 0000 a \+52 55 1234 5678\. En el cotizador, el 55 8888 0000 tiene 3 oportunidades y 2 cotizaciones, y tambi\u00e9n hay oportunidades de Pedro Lopez y Maria Ruiz: puede ser el tel\u00e9fono de una oficina que comparten varias personas\. Si era solo de Adrian Bosques Nombre, todo pasa al n\u00famero nuevo y el 55 8888 0000 deja de aparecer como Contacto\. Si es compartido, en el cotizador se queda como est\u00e1\. En los dos casos se actualiza Operam\.$/);
  assert.equal(r.preguntaContacto.numero.compartido, true);
});

test('#557 D4 si no se puede leer que tiene el numero viejo en el cotizador, confirmar solo actualiza Operam y lo dice', async () => {
  const m = subidaQuoteEnMemoria({
    cotizaciones: [nueva(CON_PERSONA)], subir: { folio: '1330', customerId: 15, branchId: 564 }, contactoEntrega: PREGUNTA_NUMERO,
    resumenNumero: () => { throw new Error('Neon caido'); },
  });
  const r = await subirQuote(21, {}, m.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.preguntaContacto.numero.mover, false);
  assert.equal(r.preguntaContacto.numero.compartido, false);
  assert.match(r.preguntaContacto.mensaje, /^El celular de Adrian Bosques Nombre cambia de 55 8888 0000 a \+52 55 1234 5678\. No se pudo revisar/);
  assert.doesNotMatch(r.preguntaContacto.mensaje, /Neon/);
});

test('#557 D4 "es un telefono compartido": se escribe en Operam con la decision y no se mueve nada en el cotizador', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [subida(MARCA_PISA_CEL)], contactoEntrega: EDITADO_CEL, fusion: FUNDIDO });
  const decision = { contactoEntrega: { ...DECISION_CEL.contactoEntrega, numero: { viejo: '55 8888 0000', mover: false } } };
  const r = await subirQuote(21, decision, m.deps);
  assert.equal(r.tipo, 'contacto-entrega');
  const [[solicitud]] = m.llamadas.escribirContactoEntrega;
  assert.deepEqual(solicitud.decision.numero, { viejo: '55 8888 0000', mover: false });
  assert.equal(m.llamadas.fundirContactos.length, 0);
  const paso = r.pasos.at(-1);
  assert.deepEqual([paso.name, paso.status], ['Contacto movido al n\u00famero nuevo', 'omitido']);
  assert.match(paso.mensaje, /^Solo se actualiz\u00f3 el celular de Adrian Bosques Nombre en Operam: el 55 8888 0000 se queda como est\u00e1 en el cotizador/);
  assert.equal(m.registro(21).data.contactoEntregaPendiente, null);
});

// D6 (decisiones de Adrian 2026-10-09): con el interruptor de la escritura de Contactos
// en Operam apagado para el Cliente Operam de la marca, la Subida no sirve la pregunta
// pendiente ni la atiende (la decision del vendedor se ignora) y la marca se queda tal
// cual: al encender el interruptor la pregunta vuelve. El modulo Contactos en Operam
// tampoco escribe (test/contactos-operam-interruptor.test.js).
const ESCRITURA_APAGADA = { tipo: 'lograda', escrito: false, motivo: 'escritura-apagada', pasos: [] };

test('#557 D6 interruptor apagado: ya-subida sin la pregunta pendiente y sin tocar Operam; la marca se queda', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [subida()], escrituraContactos: () => false });
  const r = await subirQuote(21, {}, m.deps);
  assert.equal(r.tipo, 'ya-subida');
  assert.equal(r.preguntaContacto, undefined);
  assert.equal(m.llamadas.escribirContactoEntrega.length, 0);
  assert.deepEqual(m.registro(21).data.contactoEntregaPendiente, MARCA_ALFA);
});

test('#557 D6 interruptor apagado: la decision del vendedor se ignora (ya-subida, sin escribir) y la marca se queda', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [subida()], contactoEntrega: DESPLAZADO, escrituraContactos: () => false });
  const r = await subirQuote(21, DESPLAZAR_ALFA, m.deps);
  assert.equal(r.tipo, 'ya-subida');
  assert.equal(r.preguntaContacto, undefined);
  assert.equal(m.llamadas.escribirContactoEntrega.length, 0);
  assert.deepEqual(m.registro(21).data.contactoEntregaPendiente, MARCA_ALFA);
});

test('#557 D6 el interruptor se consulta con el Cliente Operam de la marca', async () => {
  const consultados = [];
  const m = subidaQuoteEnMemoria({ cotizaciones: [subida()], escrituraContactos: (id) => { consultados.push(id); return String(id) === '15'; } });
  const r = await subirQuote(21, {}, m.deps);
  assert.deepEqual(consultados, [15]);
  assert.deepEqual(r.preguntaContacto, PREGUNTA_DE_LA_MARCA);
});

test('#557 D6 interruptor apagado con quote desactualizado: actualiza el quote, el contacto va sin decision y la marca no se borra', async () => {
  const m = subidaQuoteEnMemoria({
    cotizaciones: [pendienteYDesactualizada(MARCA_ALFA)], actualizar: ACTUALIZADO_EN_564(),
    contactoEntrega: ESCRITURA_APAGADA, escrituraContactos: () => false,
  });
  const r = await subirQuote(7, DESPLAZAR_ALFA, m.deps);
  assert.equal(r.tipo, 'actualizada');
  const [[solicitud]] = m.llamadas.escribirContactoEntrega;
  assert.equal(solicitud.decision, undefined);
  assert.equal(r.preguntaContacto, undefined);
  assert.equal(r.pasos.some((p) => p.name === 'contacto de entrega'), false);
  assert.deepEqual(m.registro(7).data.contactoEntregaPendiente, MARCA_ALFA);
});

test('#557 D6 al crear con el interruptor apagado: lograda sin paso de contacto, sin pregunta y sin marca', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [nueva(LUCIA)], subir: { folio: '1330', customerId: 15, branchId: 564 }, contactoEntrega: ESCRITURA_APAGADA });
  const r = await subirQuote(21, {}, m.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.preguntaContacto, undefined);
  assert.equal(r.pasos.some((p) => p.name === 'contacto de entrega'), false);
  assert.equal(m.registro(21).data.contactoEntregaPendiente, undefined);
});
