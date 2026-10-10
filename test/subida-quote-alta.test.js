import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subirQuote, conCandadoSubida, OCUPADO } from '../lib/subida-quote.js';
import { darDeAlta } from '../lib/alta-cliente.js';
import { subidaQuoteEnMemoria } from './helpers/subida-quote-memoria.js';
import { operamEnMemoria } from './helpers/operam-memoria.js';
import { ErrorClienteSinLista } from '../lib/lista-precios-cliente.js';
import { ErrorClienteMonedaExtranjera } from '../public/js/moneda-cliente-logica.js';

// Modulo Subida del quote (#526, ADR-0022): crear con ALTA DE CLIENTE. Una regla
// por test, contra adaptadores en memoria (ningun fetch ni supertest). La
// cotizacion de ejemplo no tiene Cliente Operam ni RFC real: necesita el alta.
// El alta es un resultado fijo (`alta`) salvo donde la prueba compone el alta
// REAL sobre test/helpers/operam-memoria.js.

function sinCliente(cliente = {}, raiz = {}) {
  return {
    id: 31, fecha: '2026-10-03T00:00:00Z', vendedor: 'Alejandro Chavez', cliente: 'Cafe La Esquina',
    totalPiezas: 3, total: 300, tier: 'M100', folioOperam: null,
    data: {
      fecha: '2026-10-03', vigencia: '2026-11-14',
      cliente: { rfc: '', razonSocial: 'Cafe La Esquina', nombreCorto: 'La Esquina', telefono: '5598765432', cpEntrega: '56530', ...cliente },
      items: [{ codigo: 'SKU-NUEVO', descripcion: 'Plato', cantidad: 3, precio: 99.5, descuento: 0 }],
    },
    ...raiz,
  };
}

const PASO_ALTA = { name: 'crear cliente', status: 'ok', mensaje: 'Cliente Operam creado', detalle: 'POST customer -> 900' };
const lograda = (extra = {}) => ({ tipo: 'lograda', clienteId: 900, domicilioId: 800, creadoNuevo: true, pasos: [{ ...PASO_ALTA }], ...extra });
const nombres = (secuencia) => secuencia.map(([n]) => n);
const escriturasDeCliente = (m) => m.llamadas.actualizarDatos.filter(([, campos]) => 'cliente' in campos);

// --- Decidir el camino y armar la Solicitud de alta ----------------------------

test('camino: sin Cliente Operam ni RFC real va por el alta, con la lista del tier ya resuelta y el segmento diferido', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [sinCliente()] });
  await subirQuote(31, {}, m.deps);
  const [solicitud] = m.llamadas.darDeAlta[0];
  assert.equal(solicitud.comercial.salesTypeId, 15);
  assert.equal(solicitud.comercial.vendedor, 'Alejandro Chavez');
  assert.equal(solicitud.identidad.razonSocial, 'Cafe La Esquina');
  assert.equal(solicitud.contacto.celular, '5598765432');
  assert.equal(solicitud.datosFiscales, null);
  assert.equal(solicitud.decision, null);
  assert.deepEqual(solicitud.segmento, { preferencia: 'diferido' });
  assert.equal(m.llamadas.resolverClienteDeCotizacion.length, 0);
});

test('camino: un tier sin lista homonima cae a "Precio de lista"', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [sinCliente({}, { tier: 'M6000' })] });
  await subirQuote(31, {}, m.deps);
  assert.equal(m.llamadas.darDeAlta[0][0].comercial.salesTypeId, 12);
});

test('camino: la decision del vendedor viaja a la Solicitud; con varios en el body manda el elegido', async () => {
  const casos = [
    [{ customerIdElegido: 15 }, { tipo: 'usar', clienteId: 15 }],
    [{ sucursalDe: 16 }, { tipo: 'otro-domicilio', clienteId: 16 }],
    [{ crearNuevo: true }, { tipo: 'ninguno' }],
    [{ customerIdElegido: 15, sucursalDe: 16, crearNuevo: true }, { tipo: 'usar', clienteId: 15 }],
  ];
  for (const [solicitud, decision] of casos) {
    const m = subidaQuoteEnMemoria({ cotizaciones: [sinCliente()] });
    await subirQuote(31, solicitud, m.deps);
    assert.deepEqual(m.llamadas.darDeAlta[0][0].decision, decision);
  }
});

test('camino: un customerId elegido lleva al alta aunque la cotizacion traiga RFC real', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [sinCliente({ rfc: 'CPE921211N76' })] });
  await subirQuote(31, { customerIdElegido: 15 }, m.deps);
  assert.equal(m.llamadas.darDeAlta.length, 1);
});

test('camino: otraRazonSocial confirmada viaja en el Contacto de la Solicitud', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [sinCliente()] });
  await subirQuote(31, { otraRazonSocial: true }, m.deps);
  assert.equal(m.llamadas.darDeAlta[0][0].contacto.otraRazonSocialConfirmada, true);
});

test('candado: el alta corre DENTRO del candado (una sola toma por peticion)', async () => {
  let dentro;
  const m = subidaQuoteEnMemoria({
    cotizaciones: [sinCliente()],
    alta: async () => { dentro = await conCandadoSubida(31, () => 'libre'); return lograda(); },
  });
  await subirQuote(31, {}, m.deps);
  assert.equal(dentro, OCUPADO);
});

// --- Anotar el Cliente Operam (idempotencia) -----------------------------------

test('lograda: el cliente se anota en la cotizacion ANTES del POST del quote', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [sinCliente()] });
  await subirQuote(31, {}, m.deps);
  const iAnotar = m.secuencia.findIndex(([n, a]) => n === 'actualizarDatos' && 'cliente' in a[1]);
  assert.ok(iAnotar >= 0);
  assert.ok(iAnotar < nombres(m.secuencia).indexOf('subirCotizacionOperam'));
  const { cliente } = m.registro(31).data;
  assert.equal(cliente.customerId, 900);
  assert.equal(cliente.branchId, 800);
  assert.equal(cliente.razonSocial, 'Cafe La Esquina', 'conserva el resto del cliente');
});

test('lograda: el paso "persistir customer_id" va con sus dos capas', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [sinCliente()] });
  const r = await subirQuote(31, {}, m.deps);
  assert.deepEqual(r.pasos.find((p) => p.name === 'persistir customer_id'), {
    name: 'persistir customer_id', status: 'ok',
    mensaje: 'La cotizacion quedo ligada a este Cliente Operam',
    detalle: 'cotizacion 31 -> cliente 900, branch 800',
  });
});

test('lograda sin domicilio resuelto: anota branchId null y el detalle lo dice', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [sinCliente()], alta: lograda({ domicilioId: undefined }) });
  const r = await subirQuote(31, {}, m.deps);
  assert.equal(m.registro(31).data.cliente.branchId, null);
  assert.match(r.pasos.find((p) => p.name === 'persistir customer_id').detalle, /branch \(sin resolver\)$/);
});

test('bloqueo del alta con clienteId: lo anota igual y un segundo intento no vuelve a dar de alta', async () => {
  const m = subidaQuoteEnMemoria({
    cotizaciones: [sinCliente()],
    alta: { tipo: 'bloqueo', motivo: 'operam', mensaje: 'No se pudo escribir el domicilio', detalle: 'PUT branch: 500', pasos: [], clienteId: 900 },
    resolver: { customerId: 900, branchId: 800 },
  });
  const r = await subirQuote(31, {}, m.deps);
  assert.equal(r.tipo, 'bloqueo');
  assert.equal(m.registro(31).data.cliente.customerId, 900);
  assert.equal(r.pasos.at(-1).name, 'persistir customer_id');
  await subirQuote(31, {}, m.deps);
  assert.equal(m.llamadas.darDeAlta.length, 1, 'el reintento entra por el camino normal');
  assert.equal(m.llamadas.resolverClienteDeCotizacion.length, 1);
});

test('bloqueo del alta sin clienteId: no anota nada', async () => {
  const m = subidaQuoteEnMemoria({
    cotizaciones: [sinCliente()],
    alta: { tipo: 'bloqueo', motivo: 'operam', mensaje: 'Operam no respondio', detalle: 'POST customer: 503', pasos: [] },
  });
  const r = await subirQuote(31, {}, m.deps);
  assert.equal(escriturasDeCliente(m).length, 0);
  assert.equal(r.pasos.length, 0);
});

test('alta REAL: el quote que falla tras crear el cliente no deja un segundo Cliente Operam al reintentar', async () => {
  const operam = operamEnMemoria();
  let intentos = 0;
  const m = subidaQuoteEnMemoria({
    cotizaciones: [sinCliente()],
    alta: (s) => darDeAlta(s, operam.deps),
    subir: () => { if (++intentos === 1) throw new Error('Operam 500: timeout'); return { folio: '1331', customerId: 900 }; },
    resolver: (data) => ({ customerId: data.cliente.customerId, branchId: data.cliente.branchId }),
  });
  const r1 = await subirQuote(31, {}, m.deps);
  assert.equal(r1.tipo, 'bloqueo');
  assert.equal(r1.clienteId, 900);
  const r2 = await subirQuote(31, {}, m.deps);
  assert.equal(r2.tipo, 'lograda');
  assert.equal(r2.folio, '1331');
  assert.equal(operam.pedidos('crearClienteDirecto').length, 1);
});

// --- Preguntas -----------------------------------------------------------------

test('pregunta de candidatos: no anota el cliente, marca dedup y devuelve candidatos y opciones', async () => {
  const candidatos = [{ customerId: 15, nombre: 'Adrian Chavez Rosete' }];
  const m = subidaQuoteEnMemoria({
    cotizaciones: [sinCliente()],
    alta: { tipo: 'pregunta', motivo: 'candidatos', mensaje: 'Encontramos clientes parecidos', opciones: ['usar', 'otro-domicilio', 'ninguno'], candidatos, pasos: [] },
  });
  const r = await subirQuote(31, {}, m.deps);
  assert.deepEqual(r, {
    tipo: 'pregunta', motivo: 'candidatos', mensaje: 'Encontramos clientes parecidos',
    candidatos, opciones: ['usar', 'otro-domicilio', 'ninguno'],
  });
  assert.equal(escriturasDeCliente(m).length, 0);
  assert.equal(m.registro(31).data.motivoPre, 'dedup');
  assert.equal(m.llamadas.subirCotizacionOperam.length, 0);
});

test('pregunta de otra razon social: no anota ni marca nada y sale por el camino del alta', async () => {
  const contacto = { id: 300, celular: '5598765432', nombre: 'Compradora' };
  const ligadas = [{ cliente_id: 88, fuente: 'cotizador' }];
  const m = subidaQuoteEnMemoria({
    cotizaciones: [sinCliente()],
    alta: { tipo: 'pregunta', motivo: 'otra-razon-social', mensaje: 'x', opciones: [], candidatos: [], pasos: [], contacto, ligadas, clienteId: 15 },
  });
  const r = await subirQuote(31, { customerIdElegido: 15 }, m.deps);
  assert.deepEqual(r, { tipo: 'pregunta', motivo: 'otra-razon-social', camino: 'alta', contacto, ligadas, clienteId: 15 });
  assert.equal(m.llamadas.actualizarDatos.length, 0);
});

// --- Bloqueos del alta y su motivo de PRE --------------------------------------

test('bloqueo del alta: cada motivo marca su motivo de PRE segun la tabla y liga-fija no marca', async () => {
  const casos = [
    ['fusion', 'dedup'],
    ['sin-lista-precios', 'sin-lista'],
    ['sin-vendedor-operam', 'sin-vendedor'],
    ['operam', 'operam'],
    ['cust-ref-duplicado', 'operam'],
    ['inesperado', 'operam'],
    ['liga-fija', undefined],
  ];
  for (const [motivo, motivoPre] of casos) {
    const m = subidaQuoteEnMemoria({
      cotizaciones: [sinCliente()],
      alta: { tipo: 'bloqueo', motivo, mensaje: 'm', detalle: 'd', pasos: [] },
    });
    const r = await subirQuote(31, {}, m.deps);
    assert.equal(r.tipo, 'bloqueo', motivo);
    assert.equal(r.etapa, 'alta', motivo);
    assert.equal(m.registro(31).data.motivoPre, motivoPre, motivo);
    assert.equal(m.llamadas.subirCotizacionOperam.length, 0, motivo);
  }
});

test('bloqueo del alta: devuelve lo que el alta trajo (motivo, mensaje, detalle, nombreCorto) mas la etapa', async () => {
  const m = subidaQuoteEnMemoria({
    cotizaciones: [sinCliente()],
    alta: { tipo: 'bloqueo', motivo: 'cust-ref-duplicado', mensaje: 'El nombre corto ya lo usa otro', detalle: '406', nombreCorto: 'La Esquina', pasos: [] },
  });
  const r = await subirQuote(31, {}, m.deps);
  assert.deepEqual(r, {
    tipo: 'bloqueo', etapa: 'alta', motivo: 'cust-ref-duplicado', mensaje: 'El nombre corto ya lo usa otro',
    detalle: '406', nombreCorto: 'La Esquina', pasos: [],
  });
});

// --- El quote sobre el cliente que dejo el alta --------------------------------

test('lista de precios: el cliente recien creado por esta alta no se verifica', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [sinCliente()], alta: lograda({ creadoNuevo: true }) });
  await subirQuote(31, {}, m.deps);
  assert.deepEqual(m.llamadas.subirCotizacionOperam[0][1], { verificarListaPrecios: false });
});

test('lista de precios: el cliente reutilizado si se verifica', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [sinCliente()], alta: lograda({ creadoNuevo: false }) });
  await subirQuote(31, {}, m.deps);
  assert.deepEqual(m.llamadas.subirCotizacionOperam[0][1], { verificarListaPrecios: true });
});

test('subir: el POST lleva el cliente recien ligado', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [sinCliente()] });
  await subirQuote(31, {}, m.deps);
  const [data] = m.llamadas.subirCotizacionOperam[0];
  assert.equal(data.cliente.customerId, 900);
  assert.equal(data.cliente.branchId, 800);
});

test('huella: en este camino lleva el Cliente Operam recien ligado', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [sinCliente()] });
  await subirQuote(31, {}, m.deps);
  const h = JSON.parse(m.registro(31).data.huellaQuote);
  assert.equal(h.customerId, 900);
  assert.equal(h.branchId, '800');
  assert.equal(h.listaId, '15');
  assert.equal(h.shipVia, '3');
});

test('con folio: folio, huella y motivo null se guardan ANTES del post-fix', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [sinCliente()], subir: { folio: '1331', customerId: 900 } });
  await subirQuote(31, {}, m.deps);
  const n = nombres(m.secuencia);
  const iPostFix = n.indexOf('corregirVigenciaQuote');
  assert.ok(n.indexOf('setFolioOperam') < iPostFix);
  const iMotivo = m.secuencia.findIndex(([nombre, a]) => nombre === 'actualizarDatos' && 'motivoPre' in a[1]);
  const iHuella = m.secuencia.findIndex(([nombre, a]) => nombre === 'actualizarDatos' && 'huellaQuote' in a[1]);
  assert.ok(iHuella < iMotivo && iMotivo < iPostFix);
  assert.equal(m.registro(31).folioOperam, '1331');
  assert.equal(m.registro(31).data.motivoPre, null);
});

test('lograda: los pasos del alta preceden a los del quote, y el valor trae el cliente', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [sinCliente()], alta: lograda(), subir: { folio: '1331', customerId: 900 } });
  const r = await subirQuote(31, {}, m.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.camino, 'alta');
  assert.equal(r.folio, '1331');
  assert.equal(r.clienteId, 900);
  assert.deepEqual(r.pasos.map((p) => p.name), [
    'crear cliente', 'persistir customer_id', 'POST quote', 'post-fix vigencia', 'lista del quote', 'transportista del quote',
    'telefono del Contacto de entrega', 'correo del Contacto de entrega',
  ]);
  assert.deepEqual(r.pasos[2], {
    name: 'POST quote', status: 'ok', mensaje: 'La cotizacion quedo registrada en Operam', detalle: 'POST quote -> folio 1331',
  });
});

test('sin folio: lograda con el paso POST quote en ok "volvio sin numero", sin huella ni motivo null', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [sinCliente()], subir: { folio: '', customerId: 900 } });
  const r = await subirQuote(31, {}, m.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.folio, '');
  assert.deepEqual(r.pasos.at(-1), {
    name: 'POST quote', status: 'ok',
    mensaje: 'La cotizacion se envio a Operam pero volvio sin numero',
    detalle: 'POST quote -> folio (ninguno)',
  });
  assert.equal(m.llamadas.setFolioOperam.length, 0);
  assert.equal(m.llamadas.corregirVigenciaQuote.length, 0);
  assert.ok(m.llamadas.actualizarDatos.every(([, campos]) => !('huellaQuote' in campos) && !('motivoPre' in campos)));
});

// --- Errores del quote en este camino ------------------------------------------

test('quote falla: paso POST quote en error con sus dos capas, bloqueo operam con el cliente y los pasos, motivo operam', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [sinCliente()], subir: () => { throw new Error('Operam 500: timeout'); } });
  const r = await subirQuote(31, {}, m.deps);
  assert.equal(r.tipo, 'bloqueo');
  assert.equal(r.etapa, 'quote');
  assert.equal(r.camino, 'alta');
  assert.equal(r.motivo, 'operam');
  assert.equal(r.mensaje, 'No se pudo subir a Operam: Operam 500: timeout');
  assert.equal(r.clienteId, 900);
  assert.deepEqual(r.pasos.at(-1), {
    name: 'POST quote', status: 'error',
    mensaje: 'La cotizacion no se pudo registrar en Operam',
    detalle: 'POST quote: Operam 500: timeout',
  });
  assert.equal(m.registro(31).data.motivoPre, 'operam');
});

test('quote falla por cliente sin lista: bloqueo sin-lista-precios con el cliente, marca sin-lista', async () => {
  const m = subidaQuoteEnMemoria({
    cotizaciones: [sinCliente()], alta: lograda({ creadoNuevo: false }),
    subir: () => { throw new ErrorClienteSinLista('Cafe La Esquina'); },
  });
  const r = await subirQuote(31, {}, m.deps);
  assert.equal(r.motivo, 'sin-lista-precios');
  assert.equal(r.clienteId, 900);
  assert.equal(m.registro(31).data.motivoPre, 'sin-lista');
});

test('quote falla por moneda extranjera: bloqueo con la moneda y el cliente, sin marcar motivo de PRE', async () => {
  const m = subidaQuoteEnMemoria({
    cotizaciones: [sinCliente()], alta: lograda({ creadoNuevo: false }),
    subir: () => { throw new ErrorClienteMonedaExtranjera('Cafe La Esquina', 'USD'); },
  });
  const r = await subirQuote(31, {}, m.deps);
  assert.equal(r.motivo, 'moneda-extranjera');
  assert.equal(r.moneda, 'USD');
  assert.equal(r.clienteId, 900);
  assert.equal(m.registro(31).data.motivoPre, undefined);
});

test('quote falla con "identificar el cliente": en este camino es un fallo de Operam, como hoy', async () => {
  const m = subidaQuoteEnMemoria({
    cotizaciones: [sinCliente()],
    subir: () => { throw new Error('No se pudo identificar el cliente en Operam'); },
  });
  const r = await subirQuote(31, {}, m.deps);
  assert.equal(r.motivo, 'operam');
  assert.equal(r.mensaje, 'No se pudo subir a Operam: No se pudo identificar el cliente en Operam');
  assert.equal(m.registro(31).data.motivoPre, 'operam');
});

// --- Segmento diferido ---------------------------------------------------------

function conSegmento(opciones) {
  let m;
  const disparos = [];
  m = subidaQuoteEnMemoria({
    ...opciones,
    alta: lograda({ segmentoDiferido: () => { disparos.push(1); m.secuencia.push(['segmentoDiferido']); } }),
  });
  return { m, disparos };
}

test('segmento diferido: se dispara una vez, DESPUES del post-fix, cuando el quote sube', async () => {
  const { m, disparos } = conSegmento({ cotizaciones: [sinCliente()] });
  await subirQuote(31, {}, m.deps);
  assert.equal(disparos.length, 1);
  const n = nombres(m.secuencia);
  assert.ok(n.indexOf('corregirVigenciaQuote') < n.indexOf('segmentoDiferido'));
});

// S6 (desde la prueba HTTP, #527): la subida NO espera la escritura del segmento,
// que paga la latencia de la web legacy. La promesa la suelta la prueba DESPUES de
// mirar el valor; si la subida la esperara, la carrera la reporta en vez de colgar
// la suite.
test('segmento diferido: la subida devuelve lograda sin esperar la escritura del segmento', async () => {
  let soltarSegmento;
  let segmentoPendiente = false;
  const m = subidaQuoteEnMemoria({
    cotizaciones: [sinCliente()],
    alta: lograda({
      segmentoDiferido: () => {
        segmentoPendiente = true;
        return new Promise((r) => { soltarSegmento = () => { segmentoPendiente = false; r(); }; });
      },
    }),
  });
  const subida = subirQuote(31, {}, m.deps);
  const r = await Promise.race([subida, new Promise((res) => setTimeout(() => res('esperando al segmento'), 1000))]);
  const pendienteAlDevolver = segmentoPendiente;
  soltarSegmento?.();
  await subida;
  assert.equal(r.tipo, 'lograda');
  assert.equal(pendienteAlDevolver, true, 'el valor llego con el segmento todavia sin escribir');
});

test('segmento diferido: tambien se dispara una vez cuando el quote falla', async () => {
  const { m, disparos } = conSegmento({ cotizaciones: [sinCliente()], subir: () => { throw new Error('Operam 500'); } });
  const r = await subirQuote(31, {}, m.deps);
  assert.equal(r.tipo, 'bloqueo');
  assert.equal(disparos.length, 1);
});

test('segmento diferido: cuando el quote falla, se dispara DESPUES de guardar el motivo de PRE', async () => {
  const { m } = conSegmento({ cotizaciones: [sinCliente()], subir: () => { throw new Error('Operam 500'); } });
  const escribir = m.deps.actualizarDatos;
  m.deps.actualizarDatos = async (id, campos) => {
    await new Promise((r) => setImmediate(r));
    return escribir(id, campos);
  };
  await subirQuote(31, {}, m.deps);
  const iMotivo = m.secuencia.findIndex(([n, a]) => n === 'actualizarDatos' && a[1].motivoPre === 'operam');
  assert.ok(iMotivo >= 0);
  assert.ok(iMotivo < nombres(m.secuencia).indexOf('segmentoDiferido'));
});

test('segmento diferido: nunca en una pregunta ni en un bloqueo del alta', async () => {
  for (const tipo of ['pregunta', 'bloqueo']) {
    const disparos = [];
    const m = subidaQuoteEnMemoria({
      cotizaciones: [sinCliente()],
      alta: { tipo, motivo: tipo === 'pregunta' ? 'candidatos' : 'operam', mensaje: 'm', candidatos: [], opciones: [], pasos: [], clienteId: tipo === 'bloqueo' ? 900 : undefined, segmentoDiferido: () => disparos.push(1) },
    });
    await subirQuote(31, {}, m.deps);
    assert.equal(disparos.length, 0, tipo);
  }
});

// --- Lo que lanza fuera de la etapa del quote ----------------------------------

test('contacto: el fallo del store de prospectos se propaga sin marcar motivo ni llamar al alta', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [sinCliente()] });
  m.deps.buscarPorCelular = async () => { throw new Error('store roto'); };
  await assert.rejects(subirQuote(31, {}, m.deps), /store roto/);
  assert.equal(m.llamadas.darDeAlta.length, 0);
  assert.equal(m.llamadas.actualizarDatos.length, 0);
});

test('alta que lanza: se propaga sin marcar motivo, sin anotar y sin convertirse en bloqueo', async () => {
  const m = subidaQuoteEnMemoria({ cotizaciones: [sinCliente()], alta: () => { throw new Error('alta rota'); } });
  await assert.rejects(subirQuote(31, {}, m.deps), /alta rota/);
  assert.equal(m.llamadas.actualizarDatos.length, 0);
  assert.equal(m.llamadas.subirCotizacionOperam.length, 0);
});
