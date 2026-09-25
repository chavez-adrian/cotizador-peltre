import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encolarPostFix, procesarColaPostFix, barrerQuotesPostFix } from '../lib/postfix-reintento-io.js';

// IO del reintento del post-fix web del quote (#380) con adaptadores EN MEMORIA: la
// cola, Operam (el post-fix y la lectura del quote), el detector de cancelados, el
// registro de vendedores y el SMTP entran como deps. Cero fetch, cero Neon.

const AHORA = new Date('2026-09-25T18:00:00.000Z');

function storeEnMemoria(inicial = []) {
  const filas = new Map(inicial.map(p => [p.folio, { ...p }]));
  return {
    filas,
    listar: async () => [...filas.values()].map(p => ({ ...p })),
    encolar: async (p) => {
      if (filas.has(String(p.folio))) return false;
      filas.set(String(p.folio), { ...p, folio: String(p.folio) });
      return true;
    },
    guardar: async (p) => { filas.set(String(p.folio), { ...p }); return true; },
    borrar: async (folio) => { filas.delete(String(folio)); return true; },
  };
}

const VENDEDORES = [
  { id: 1, name: 'Adrian Chavez', role: 'admin', email: 'adrian@ejemplo.mx' },
  { id: 2, name: 'Alejandro Chavez', role: 'vendedor', email: 'alejandro@ejemplo.mx' },
];

function depsBase(extra = {}) {
  const correos = [];
  const deps = {
    ahora: () => AHORA,
    esperar: async () => {},
    store: storeEnMemoria(),
    listarVendedores: async () => VENDEDORES,
    enviarCorreo: async (m) => { correos.push(m); },
    // El quote tal como esta en Operam ANTES del reintento: el 1263 desfasado.
    obtenerQuote: async (folio) => ({ order_no: String(folio), ord_date: '2026-09-02', delivery_date: '2026-09-05', order_type: '9', ship_via: '1', comments: 'Valido hasta: 2026-10-04' }),
    // El registro del cotizador que el worker relee antes de escribir: sigue diciendo lo
    // que se encolo (lista 9 y transportista null en su huella, vigencia 2026-10-04).
    obtenerCotizacion: async (id) => registro41({ id }),
    ...extra,
  };
  return { deps, correos };
}

function registro41(extra = {}, data = {}) {
  return {
    id: 41, folioOperam: '1263', vendedor: 'Alejandro Chavez', ...extra,
    data: { fecha: '2026-09-02', vigencia: '2026-10-04', huellaQuote: JSON.stringify({ items: [], listaId: '9', branchId: null, shipVia: null }), ...data },
  };
}

const FALLO_1263 = {
  folio: '1263', cotizacionId: 41, vendedor: 'Alejandro Chavez',
  vigencia: '2026-10-04', lista: '9', transportista: null, fechaDocumento: '2026-09-02',
};

// Lo que devolvio corregirVigenciaQuote cuando la vista leyo otra fecha (el 1263).
const R_VIGENCIA_OTRA = {
  ok: false, verificado: true, esperado: '2026-10-04', encontrado: '2026-09-05',
  lista: { aplica: true, esperado: '9', escrita: false, yaCorrecto: true, ok: true, verificado: true, encontrado: '9', motivo: null },
  transportista: { aplica: false, esperado: null, escrita: false, yaCorrecto: false, ok: true, verificado: false, encontrado: null, motivo: null },
};

// --- encolarPostFix: lo que la subida no pudo verificar ---

test('encolarPostFix: un fallo transitorio queda en la cola con el primer reintento al minuto', async () => {
  const { deps, correos } = depsBase();
  await encolarPostFix({ ...FALLO_1263, resultado: R_VIGENCIA_OTRA }, deps);
  const [fila] = await deps.store.listar();
  assert.equal(fila.folio, '1263');
  assert.equal(fila.estado, 'pendiente');
  assert.equal(fila.intentos, 0);
  assert.equal(fila.proximoIntento, '2026-09-25T18:01:00.000Z');
  assert.equal(fila.vigencia, '2026-10-04');
  assert.equal(fila.lista, '9');
  assert.match(fila.motivo, /se leyo 2026-09-05/);
  assert.equal(correos.length, 0, 'un fallo transitorio no avisa: se reintenta');
});

test('encolarPostFix: la excepcion del post-fix (no llego a escribir) tambien se reintenta', async () => {
  const { deps } = depsBase();
  await encolarPostFix({ ...FALLO_1263, error: 'timeout de la web legacy (20 s)' }, deps);
  const [fila] = await deps.store.listar();
  assert.equal(fila.estado, 'pendiente');
  assert.match(fila.motivo, /timeout de la web legacy/);
});

test('encolarPostFix: el rechazo NO transitorio avisa de inmediato a Adrian y al vendedor', async () => {
  const { deps, correos } = depsBase();
  const lista = { aplica: true, esperado: '9', escrita: false, yaCorrecto: false, ok: false, verificado: false, encontrado: null, motivo: 'la lista 9 no esta entre las opciones del formulario de Operam (12, 16)' };
  await encolarPostFix({ ...FALLO_1263, resultado: { ...R_VIGENCIA_OTRA, ok: true, encontrado: '2026-10-04', lista } }, deps);
  assert.equal(correos.length, 1);
  assert.deepEqual(correos[0].to, ['adrian@ejemplo.mx', 'alejandro@ejemplo.mx']);
  assert.match(correos[0].text, /no esta entre las opciones/);
  const [fila] = await deps.store.listar();
  assert.equal(fila.estado, 'avisado', 'se queda en la cola como avisado para que el barrido no lo re-encole');
});

test('encolarPostFix: nunca lanza aunque la cola falle', async () => {
  const { deps } = depsBase({ store: { ...storeEnMemoria(), encolar: async () => { throw new Error('Neon caido'); } } });
  await encolarPostFix({ ...FALLO_1263, resultado: R_VIGENCIA_OTRA }, deps);
});

// --- procesarColaPostFix: el worker ---

const R_VERIFICADO = { ...R_VIGENCIA_OTRA, ok: true, encontrado: '2026-10-04' };

function pendiente(extra = {}) {
  return {
    ...FALLO_1263, origen: 'post-fix', estado: 'pendiente', intentos: 0,
    proximoIntento: '2026-09-25T17:59:00.000Z', motivo: 'vigencia: se esperaba 2026-10-04 y se leyo 2026-09-05',
    ...extra,
  };
}

function corregirFalso(respuestas) {
  const llamadas = [];
  const fn = async (folio, vigencia, opciones) => {
    llamadas.push({ folio, vigencia, opciones });
    const r = typeof respuestas === 'function' ? respuestas(folio) : respuestas;
    if (r instanceof Error) throw r;
    return r;
  };
  fn.llamadas = llamadas;
  return fn;
}

test('procesarColaPostFix: reintenta con la MISMA escritura del post-fix y, verificado, lo saca de la cola', async () => {
  const corregir = corregirFalso(R_VERIFICADO);
  const { deps, correos } = depsBase({ store: storeEnMemoria([pendiente()]), corregirVigenciaQuote: corregir });
  const r = await procesarColaPostFix(deps);
  assert.deepEqual(corregir.llamadas, [{ folio: '1263', vigencia: '2026-10-04', opciones: { lista: '9', transportista: null } }]);
  assert.deepEqual(await deps.store.listar(), []);
  assert.equal(r.verificados, 1);
  assert.equal(correos.length, 0);
});

test('procesarColaPostFix: lo que todavia no toca no se intenta', async () => {
  const corregir = corregirFalso(R_VERIFICADO);
  const { deps } = depsBase({ store: storeEnMemoria([pendiente({ proximoIntento: '2026-09-25T18:10:00.000Z' })]), corregirVigenciaQuote: corregir });
  await procesarColaPostFix(deps);
  assert.equal(corregir.llamadas.length, 0);
  assert.equal((await deps.store.listar()).length, 1);
});

test('procesarColaPostFix: lo avisado no se vuelve a intentar', async () => {
  const corregir = corregirFalso(R_VERIFICADO);
  const { deps } = depsBase({ store: storeEnMemoria([pendiente({ estado: 'avisado', proximoIntento: null })]), corregirVigenciaQuote: corregir });
  await procesarColaPostFix(deps);
  assert.equal(corregir.llamadas.length, 0);
});

test('procesarColaPostFix: el reintento que vuelve a fallar sube un intento y espera 10 min', async () => {
  const { deps, correos } = depsBase({ store: storeEnMemoria([pendiente()]), corregirVigenciaQuote: corregirFalso(R_VIGENCIA_OTRA) });
  await procesarColaPostFix(deps);
  const [fila] = await deps.store.listar();
  assert.equal(fila.intentos, 1);
  assert.equal(fila.estado, 'pendiente');
  assert.equal(fila.proximoIntento, '2026-09-25T18:10:00.000Z');
  assert.equal(correos.length, 0);
});

test('procesarColaPostFix: la excepcion del post-fix (sesion caducada, timeout) cuenta como transitoria', async () => {
  const { deps } = depsBase({ store: storeEnMemoria([pendiente({ intentos: 2 })]), corregirVigenciaQuote: corregirFalso(new Error('La sesion de FA caduco')) });
  await procesarColaPostFix(deps);
  const [fila] = await deps.store.listar();
  assert.equal(fila.intentos, 3);
  assert.equal(fila.proximoIntento, '2026-09-26T00:00:00.000Z');
  assert.match(fila.motivo, /La sesion de FA caduco/);
});

test('procesarColaPostFix: el cuarto reintento fallido agota y avisa por correo', async () => {
  const { deps, correos } = depsBase({ store: storeEnMemoria([pendiente({ intentos: 3 })]), corregirVigenciaQuote: corregirFalso(R_VIGENCIA_OTRA) });
  const r = await procesarColaPostFix(deps);
  assert.equal(correos.length, 1);
  assert.deepEqual(correos[0].to, ['adrian@ejemplo.mx', 'alejandro@ejemplo.mx']);
  assert.match(correos[0].text, /4 reintentos/);
  const [fila] = await deps.store.listar();
  assert.equal(fila.estado, 'avisado');
  assert.equal(r.avisados, 1);
});

test('procesarColaPostFix: la vigencia anterior a la fecha del documento no se escribe, se avisa', async () => {
  const corregir = corregirFalso(R_VERIFICADO);
  const p = pendiente({ origen: 'barrido', vigencia: '2026-07-26', fechaDocumento: '2026-07-27' });
  const { deps, correos } = depsBase({ store: storeEnMemoria([p]), corregirVigenciaQuote: corregir });
  await procesarColaPostFix(deps);
  assert.equal(corregir.llamadas.length, 0, 'FA rechazaria el ProcessOrder entero (#406)');
  assert.equal(correos.length, 1);
  assert.match(correos[0].text, /no se reintenta/);
});

test('procesarColaPostFix: secuencial y a su ritmo -- espera entre un quote y el siguiente', async () => {
  const esperas = [];
  const store = storeEnMemoria([pendiente(), pendiente({ folio: '1270' })]);
  const { deps } = depsBase({ store, corregirVigenciaQuote: corregirFalso(R_VERIFICADO), esperar: async (ms) => { esperas.push(ms); } });
  const r = await procesarColaPostFix(deps);
  assert.equal(r.verificados, 2);
  assert.equal(esperas.length, 1);
  assert.ok(esperas[0] >= 1000);
});

test('procesarColaPostFix: un solo worker a la vez -- la segunda corrida simultanea se omite', async () => {
  let soltar;
  const bloqueo = new Promise(res => { soltar = res; });
  const corregir = async () => { await bloqueo; return R_VERIFICADO; };
  const { deps } = depsBase({ store: storeEnMemoria([pendiente()]), corregirVigenciaQuote: corregir });
  const primera = procesarColaPostFix(deps);
  const segunda = await procesarColaPostFix(deps);
  assert.equal(segunda.omitido, true);
  soltar();
  const r = await primera;
  assert.equal(r.verificados, 1);
});

// --- barrerQuotesPostFix: el barrido diario de los ultimos 30 dias ---

// Registros del cotizador tal como los devuelve cotStore.listar().
function cotizacion(id, folio, extra = {}) {
  return { id, fecha: '2026-09-20T17:00:00.000Z', vendedor: 'Alejandro Chavez', folioOperam: folio, tier: 'M100', data: { fecha: '2026-09-02', huellaQuote: huella({ listaId: '9' }) }, ...extra };
}

// La huella que la subida guardo (#114): lista y transportista que se INTENTARON.
function huella(campos) {
  return JSON.stringify({ items: [], ...campos });
}

// El quote como lo devuelve GET /api/v3/sales/quote/:folio.
const QUOTES = {
  1263: { order_no: '1263', ord_date: '2026-09-02', delivery_date: '2026-09-05', order_type: '9', ship_via: '1', comments: '- Precios con IVA.\nValido hasta: 2026-10-04' },
  1264: { order_no: '1264', ord_date: '2026-09-03', delivery_date: '2026-10-03', order_type: '9', ship_via: '1', comments: 'Valido hasta: 2026-10-03' },
};

function depsBarrido(extra = {}) {
  const lecturas = [];
  const { deps, correos } = depsBase({
    listarCotizaciones: async () => [cotizacion(41, '1263'), cotizacion(42, '1264')],
    obtenerQuote: async (folio) => { lecturas.push(folio); return QUOTES[folio] ?? null; },
    quoteCancelado: async () => false,
    listarPedidos: async () => [],
    corregirVigenciaQuote: async () => { throw new Error('el barrido NO escribe: solo encola'); },
    ...extra,
  });
  return { deps, correos, lecturas };
}

test('barrerQuotesPostFix: encola el quote desfasado (el 1263) con la vigencia que LLEVA en comments', async () => {
  const { deps, lecturas } = depsBarrido();
  const r = await barrerQuotesPostFix(deps);
  assert.deepEqual(lecturas, ['1263', '1264']);
  const cola = await deps.store.listar();
  assert.equal(cola.length, 1);
  assert.equal(cola[0].folio, '1263');
  assert.equal(cola[0].origen, 'barrido');
  assert.equal(cola[0].cotizacionId, 41);
  assert.equal(cola[0].vendedor, 'Alejandro Chavez');
  assert.equal(cola[0].vigencia, '2026-10-04');
  assert.equal(cola[0].lista, '9');
  assert.equal(cola[0].fechaDocumento, '2026-09-02');
  assert.equal(cola[0].proximoIntento, '2026-09-25T18:01:00.000Z');
  assert.match(cola[0].motivo, /2026-09-05/);
  assert.equal(r.encolados, 1);
});

test('barrerQuotesPostFix: la vigencia esperada NO sale de la cotizacion regenerada sino del quote', async () => {
  // Regenerar el documento reemplaza data.vigencia sin reescribir el quote: el 1264
  // esta bien aunque la cotizacion diga hoy otra fecha.
  const { deps } = depsBarrido({
    listarCotizaciones: async () => [cotizacion(42, '1264', { data: { fecha: '2026-09-20', vigencia: '2026-10-20' } })],
  });
  await barrerQuotesPostFix(deps);
  assert.deepEqual(await deps.store.listar(), []);
});

test('barrerQuotesPostFix: el desfasado que esta cancelado en Operam no se encola', async () => {
  const { deps } = depsBarrido({ quoteCancelado: async (folio) => folio === '1263' });
  await barrerQuotesPostFix(deps);
  assert.deepEqual(await deps.store.listar(), []);
});

test('barrerQuotesPostFix: si no se pudo confirmar que no esta cancelado, no se encola', async () => {
  const { deps } = depsBarrido({ quoteCancelado: async () => { throw new Error('login de FA fallo'); } });
  const r = await barrerQuotesPostFix(deps);
  assert.deepEqual(await deps.store.listar(), []);
  assert.equal(r.sinVerificar, 1);
});

test('barrerQuotesPostFix: un quote que no se pudo leer no tumba el barrido', async () => {
  const { deps } = depsBarrido({
    obtenerQuote: async (folio) => { if (folio === '1264') throw new Error('Operam 503'); return QUOTES[folio]; },
    listarCotizaciones: async () => [cotizacion(42, '1264'), cotizacion(41, '1263')],
  });
  const r = await barrerQuotesPostFix(deps);
  assert.deepEqual((await deps.store.listar()).map(p => p.folio), ['1263']);
  assert.equal(r.sinLeer, 1);
});

test('barrerQuotesPostFix: el quote sin linea Valido hasta no se juzga por la vigencia', async () => {
  const { deps } = depsBarrido({
    obtenerQuote: async () => ({ ...QUOTES[1263], comments: 'sin vigencia' }),
    listarCotizaciones: async () => [cotizacion(41, '1263')],
  });
  await barrerQuotesPostFix(deps);
  assert.deepEqual(await deps.store.listar(), []);
});

test('barrerQuotesPostFix: la lista equivocada tambien se encola', async () => {
  const { deps } = depsBarrido({
    listarCotizaciones: async () => [cotizacion(42, '1264', { data: { fecha: '2026-09-03', huellaQuote: huella({ listaId: '12' }) } })],
  });
  await barrerQuotesPostFix(deps);
  const [p] = await deps.store.listar();
  assert.equal(p.folio, '1264');
  assert.equal(p.lista, '12');
  assert.equal(p.vigencia, '2026-10-03', 'la vigencia viaja tal como la lleva el quote');
});

// Lo esperado de lista y transportista es lo que la subida INTENTO (su huella), nunca
// lo que el catalogo y /admin dirian hoy: #448 se fusiono el 2026-09-25 y todo quote
// anterior con FedEx/Lalamove tiene ship_via 1 a proposito.
test('barrerQuotesPostFix: un quote anterior a #448 (huella sin shipVia) con ship_via 1 no se encola', async () => {
  const { deps } = depsBarrido({
    listarCotizaciones: async () => [cotizacion(42, '1264', { data: { fecha: '2026-09-03', envio: { opcion: 'envia', carrier: 'fedex' }, huellaQuote: huella({ listaId: '9', branchId: null }) } })],
    esperadoDeCotizacion: () => ({ lista: '9', transportista: '2' }),
  });
  const r = await barrerQuotesPostFix(deps);
  assert.deepEqual(await deps.store.listar(), []);
  assert.equal(r.desfasados, 0);
});

test('barrerQuotesPostFix: la lista se compara contra la huella, aunque el catalogo de hoy diga otra', async () => {
  const { deps } = depsBarrido({
    listarCotizaciones: async () => [cotizacion(42, '1264', { data: { fecha: '2026-09-03', huellaQuote: huella({ listaId: '9', shipVia: '1' }) } })],
    esperadoDeCotizacion: () => ({ lista: '12', transportista: '3' }),
  });
  await barrerQuotesPostFix(deps);
  assert.deepEqual(await deps.store.listar(), []);
});

test('barrerQuotesPostFix: sin huella no se juzgan lista ni transportista', async () => {
  const { deps } = depsBarrido({
    listarCotizaciones: async () => [cotizacion(42, '1264', { data: { fecha: '2026-09-03' } })],
    obtenerQuote: async () => ({ ...QUOTES[1264], order_type: '5', ship_via: '7' }),
  });
  await barrerQuotesPostFix(deps);
  assert.deepEqual(await deps.store.listar(), []);
});

test('barrerQuotesPostFix: lee a su ritmo, una lectura tras otra', async () => {
  const esperas = [];
  const { deps } = depsBarrido({ esperar: async (ms) => { esperas.push(ms); } });
  await barrerQuotesPostFix(deps);
  // 1263 (lectura), 1264 (lectura), pedidos (una pagina), 1263 (cancelado): cuatro
  // operaciones, tres esperas.
  assert.equal(esperas.length, 3);
});

test('barrerQuotesPostFix: no corre mientras la cola se esta procesando (un solo worker)', async () => {
  let soltar;
  const bloqueo = new Promise(res => { soltar = res; });
  const cola = depsBase({ store: storeEnMemoria([pendiente()]), corregirVigenciaQuote: async () => { await bloqueo; return R_VERIFICADO; } });
  const enCurso = procesarColaPostFix(cola.deps);
  const { deps, lecturas } = depsBarrido();
  const r = await barrerQuotesPostFix(deps);
  assert.equal(r.omitido, true);
  assert.deepEqual(lecturas, []);
  soltar();
  await enCurso;
});

// --- El reintento relee el quote ANTES de escribir ---

test('procesarColaPostFix: si el quote ya tiene lo esperado no se escribe nada y sale de la cola', async () => {
  const corregir = corregirFalso(R_VERIFICADO);
  const { deps } = depsBase({
    store: storeEnMemoria([pendiente()]), corregirVigenciaQuote: corregir,
    obtenerQuote: async () => ({ order_no: '1263', ord_date: '2026-09-02', delivery_date: '2026-10-04', order_type: '9', ship_via: '1', comments: 'Valido hasta: 2026-10-04' }),
  });
  const r = await procesarColaPostFix(deps);
  assert.equal(corregir.llamadas.length, 0, 'un ProcessOrder inutil solo agrega riesgo');
  assert.deepEqual(await deps.store.listar(), []);
  assert.equal(r.verificados, 1);
});

test('procesarColaPostFix: si el quote se reescribio despues de encolar (otra vigencia en comments) no se pisa', async () => {
  // El vendedor actualizo la cotizacion (#104) entre el fallo y el reintento: el
  // reintento traeria la vigencia VIEJA y regresaria el documento.
  const corregir = corregirFalso(R_VERIFICADO);
  const { deps, correos } = depsBase({
    store: storeEnMemoria([pendiente()]), corregirVigenciaQuote: corregir,
    obtenerQuote: async () => ({ order_no: '1263', ord_date: '2026-09-02', delivery_date: '2026-09-05', order_type: '9', ship_via: '1', comments: 'Valido hasta: 2026-10-20' }),
  });
  await procesarColaPostFix(deps);
  assert.equal(corregir.llamadas.length, 0);
  assert.deepEqual(await deps.store.listar(), [], 'sale de la cola: el barrido diario juzga el documento nuevo');
  assert.equal(correos.length, 0);
});

test('procesarColaPostFix: sin poder releer el quote no se escribe a ciegas (transitorio)', async () => {
  const corregir = corregirFalso(R_VERIFICADO);
  const { deps } = depsBase({
    store: storeEnMemoria([pendiente()]), corregirVigenciaQuote: corregir,
    obtenerQuote: async () => { throw new Error('Operam 503'); },
  });
  await procesarColaPostFix(deps);
  assert.equal(corregir.llamadas.length, 0);
  const [fila] = await deps.store.listar();
  assert.equal(fila.intentos, 1);
  assert.equal(fila.estado, 'pendiente');
  assert.match(fila.motivo, /Operam 503/);
});

// --- El barrido no toca un quote que ya se convirtio en pedido ---
// El espejo local (data.orderOperam) es incompleto por diseno: la evidencia es el
// `trans_no_from` de los pedidos que enumera la API (#344, #406). Adrian decidio no
// corregir los quotes con pedido (2026-09-21).

test('barrerQuotesPostFix: el desfasado que ya tiene pedido en Operam no se encola', async () => {
  const consultas = [];
  const { deps } = depsBarrido({
    listarPedidos: async (q) => { consultas.push(q); return [{ order_no: '7001', trans_no_from: '1263', ord_date: '2026-09-10' }]; },
  });
  const r = await barrerQuotesPostFix(deps);
  assert.deepEqual(await deps.store.listar(), []);
  assert.equal(r.conPedido, 1);
  assert.equal(consultas[0].desde, '2026-09-02', 'un pedido nace despues de su quote: se lee desde la fecha del quote mas viejo desfasado');
});

test('barrerQuotesPostFix: los pedidos se leen por paginas hasta la ultima', async () => {
  const consultas = [];
  const llena = Array.from({ length: 100 }, (_, i) => ({ order_no: String(8000 + i), trans_no_from: String(5000 + i) }));
  const { deps } = depsBarrido({
    listarPedidos: async (q) => { consultas.push(q); return q.skip === 0 ? llena : [{ order_no: '9001', trans_no_from: '1263' }]; },
  });
  await barrerQuotesPostFix(deps);
  assert.deepEqual(consultas.map(q => q.skip), [0, 100]);
  assert.deepEqual(await deps.store.listar(), []);
});

test('barrerQuotesPostFix: sin poder leer los pedidos no se encola nada esa pasada', async () => {
  const { deps } = depsBarrido({ listarPedidos: async () => { throw new Error('Operam 429'); } });
  const r = await barrerQuotesPostFix(deps);
  assert.deepEqual(await deps.store.listar(), []);
  assert.equal(r.sinEvidencia, true);
});

test('barrerQuotesPostFix: sin desfasados no se leen los pedidos', async () => {
  let leidos = 0;
  const { deps } = depsBarrido({
    listarCotizaciones: async () => [cotizacion(42, '1264')],
    listarPedidos: async () => { leidos++; return []; },
  });
  await barrerQuotesPostFix(deps);
  assert.equal(leidos, 0);
});

// --- El worker relee el REGISTRO antes de escribir (#380) ---
// /actualizar reescribe lista, transportista y vigencia sin tocar la cola; con la misma
// vigencia el worker veria desfase y repostearia los valores VIEJOS. Y lo que ya tiene
// pedido o quedo desactualizado no se repostea (#406, #104).

test('procesarColaPostFix: si el vendedor cambio el transportista despues de encolar, la fila se descarta sin escribir', async () => {
  const corregir = corregirFalso(R_VERIFICADO);
  const { deps } = depsBase({
    store: storeEnMemoria([pendiente()]), corregirVigenciaQuote: corregir,
    obtenerCotizacion: async () => registro41({}, { huellaQuote: JSON.stringify({ items: [], listaId: '9', branchId: null, shipVia: '3' }) }),
  });
  await procesarColaPostFix(deps);
  assert.equal(corregir.llamadas.length, 0);
  assert.deepEqual(await deps.store.listar(), []);
});

test('procesarColaPostFix: si la lista del registro ya no es la encolada, se descarta sin escribir', async () => {
  const corregir = corregirFalso(R_VERIFICADO);
  const { deps } = depsBase({
    store: storeEnMemoria([pendiente()]), corregirVigenciaQuote: corregir,
    obtenerCotizacion: async () => registro41({}, { huellaQuote: JSON.stringify({ items: [], listaId: '12', branchId: null, shipVia: null }) }),
  });
  await procesarColaPostFix(deps);
  assert.equal(corregir.llamadas.length, 0);
  assert.deepEqual(await deps.store.listar(), []);
});

test('procesarColaPostFix: si la vigencia del registro ya no es la encolada, se descarta sin escribir', async () => {
  const corregir = corregirFalso(R_VERIFICADO);
  const { deps } = depsBase({
    store: storeEnMemoria([pendiente()]), corregirVigenciaQuote: corregir,
    obtenerCotizacion: async () => registro41({}, { vigencia: '2026-10-20' }),
  });
  await procesarColaPostFix(deps);
  assert.equal(corregir.llamadas.length, 0);
  assert.deepEqual(await deps.store.listar(), []);
});

test('procesarColaPostFix: la cotizacion que ya tiene pedido no se repostea', async () => {
  const corregir = corregirFalso(R_VERIFICADO);
  const { deps, correos } = depsBase({
    store: storeEnMemoria([pendiente()]), corregirVigenciaQuote: corregir,
    obtenerCotizacion: async () => registro41({}, { orderOperam: '7001' }),
  });
  await procesarColaPostFix(deps);
  assert.equal(corregir.llamadas.length, 0);
  assert.deepEqual(await deps.store.listar(), []);
  assert.equal(correos.length, 0);
});

test('procesarColaPostFix: la cotizacion con el quote desactualizado no se repostea', async () => {
  const corregir = corregirFalso(R_VERIFICADO);
  const { deps } = depsBase({
    store: storeEnMemoria([pendiente()]), corregirVigenciaQuote: corregir,
    obtenerCotizacion: async () => registro41({}, { quoteDesactualizado: { fecha: '2026-09-25T17:00:00.000Z', escrito: false } }),
  });
  await procesarColaPostFix(deps);
  assert.equal(corregir.llamadas.length, 0);
  assert.deepEqual(await deps.store.listar(), []);
});

test('procesarColaPostFix: sin poder leer el registro no se escribe (transitorio)', async () => {
  const corregir = corregirFalso(R_VERIFICADO);
  const { deps } = depsBase({
    store: storeEnMemoria([pendiente()]), corregirVigenciaQuote: corregir,
    obtenerCotizacion: async () => { throw new Error('Neon caido'); },
  });
  await procesarColaPostFix(deps);
  assert.equal(corregir.llamadas.length, 0);
  const [fila] = await deps.store.listar();
  assert.equal(fila.intentos, 1);
  assert.match(fila.motivo, /Neon caido/);
});
