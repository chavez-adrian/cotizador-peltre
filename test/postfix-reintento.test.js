import { test } from 'node:test';
import assert from 'node:assert/strict';

import { clasificarPostFix, proximoIntento, vigenciaAnteriorAlDocumento, vigenciaDeComentarios, desfaseQuote, cotizacionesDelBarrido, destinatariosAvisoPostFix, mensajeAvisoPostFix } from '../lib/postfix-reintento.js';

// Nucleo PURO del reintento del post-fix web del quote (#380). Sin red, sin Neon,
// sin SMTP: recibe lo que devolvio corregirVigenciaQuote (lib/operam-web.js) y
// decide si quedo verificado, si se reintenta o si el fallo no es transitorio.

// Las formas de `lista` / `transportista` son las de listaSinEscribir y
// verificarListaEscrita en lib/operam-web.js.
const NO_APLICA = { aplica: false, esperado: null, escrita: false, yaCorrecto: false, ok: true, verificado: false, encontrado: null, motivo: 'la cotizacion no tiene una lista de precios resoluble en el catalogo' };
const ESCRITA_OK = { aplica: true, esperado: '9', escrita: true, yaCorrecto: false, ok: true, verificado: true, encontrado: '9', motivo: null };

test('clasificarPostFix: vigencia, lista y transportista confirmados es verificado', () => {
  const r = { ok: true, verificado: true, esperado: '2026-10-04', encontrado: '2026-10-04', lista: ESCRITA_OK, transportista: NO_APLICA };
  assert.equal(clasificarPostFix(r).estado, 'verificado');
});

test('clasificarPostFix: la vista no trajo la vigencia (verificado false) es transitorio', () => {
  const r = { ok: false, verificado: false, esperado: '2026-10-04', encontrado: null, lista: NO_APLICA, transportista: NO_APLICA };
  assert.equal(clasificarPostFix(r).estado, 'transitorio');
});

test('clasificarPostFix: la vigencia releida es otra fecha (el caso del 1263) es transitorio', () => {
  const r = { ok: false, verificado: true, esperado: '2026-10-04', encontrado: '2026-09-05', lista: NO_APLICA, transportista: NO_APLICA };
  const c = clasificarPostFix(r);
  assert.equal(c.estado, 'transitorio');
  assert.match(c.motivo, /2026-10-04/);
  assert.match(c.motivo, /2026-09-05/);
});

test('clasificarPostFix: la lista escrita que la relectura no confirma es transitorio', () => {
  const lista = { aplica: true, esperado: '9', escrita: true, yaCorrecto: false, ok: false, verificado: false, encontrado: null, motivo: 'no se pudo releer la lista del encabezado en Operam: Operam 503' };
  const r = { ok: true, verificado: true, esperado: '2026-10-04', encontrado: '2026-10-04', lista, transportista: NO_APLICA };
  const c = clasificarPostFix(r);
  assert.equal(c.estado, 'transitorio');
  assert.match(c.motivo, /Operam 503/);
});

test('clasificarPostFix: la lista que el formulario no ofrece (abstencion) NO es transitorio', () => {
  const lista = { aplica: true, esperado: '9', escrita: false, yaCorrecto: false, ok: false, verificado: false, encontrado: null, motivo: 'la lista 9 no esta entre las opciones del formulario de Operam (12, 16)' };
  const r = { ok: true, verificado: true, esperado: '2026-10-04', encontrado: '2026-10-04', lista, transportista: NO_APLICA };
  const c = clasificarPostFix(r);
  assert.equal(c.estado, 'definitivo');
  assert.match(c.motivo, /no esta entre las opciones/);
});

test('clasificarPostFix: el transportista que el formulario no ofrece NO es transitorio', () => {
  const transportista = { aplica: true, esperado: '7', escrita: false, yaCorrecto: false, ok: false, verificado: false, encontrado: null, motivo: 'el transportista 7 no esta entre las opciones del formulario de Operam (1, 2)' };
  const r = { ok: true, verificado: true, esperado: '2026-10-04', encontrado: '2026-10-04', lista: NO_APLICA, transportista };
  assert.equal(clasificarPostFix(r).estado, 'definitivo');
});

// --- proximoIntento: backoff 1 min, 10 min, 1 h, 6 h (decision de Adrian 2026-09-25) ---

test('proximoIntento: tras el fallo del post-fix el primer reintento va al minuto', () => {
  const ahora = new Date('2026-09-25T18:00:00.000Z');
  assert.equal(proximoIntento(0, ahora).toISOString(), '2026-09-25T18:01:00.000Z');
});

test('proximoIntento: los siguientes van a 10 min, 1 h y 6 h', () => {
  const ahora = new Date('2026-09-25T18:00:00.000Z');
  assert.equal(proximoIntento(1, ahora).toISOString(), '2026-09-25T18:10:00.000Z');
  assert.equal(proximoIntento(2, ahora).toISOString(), '2026-09-25T19:00:00.000Z');
  assert.equal(proximoIntento(3, ahora).toISOString(), '2026-09-26T00:00:00.000Z');
});

test('proximoIntento: con los cuatro reintentos hechos se agoto (null)', () => {
  assert.equal(proximoIntento(4, new Date('2026-09-25T18:00:00.000Z')), null);
});

// --- vigenciaAnteriorAlDocumento: la firma de #406 ---

test('vigenciaAnteriorAlDocumento: una vigencia antes de la fecha del documento la rechaza FA', () => {
  // El 1194: cotizado el 27/07 y valido hasta el 26/07 (docs/arquitectura.md, #406).
  assert.equal(vigenciaAnteriorAlDocumento('2026-07-26', '2026-07-27'), true);
});

test('vigenciaAnteriorAlDocumento: compara contra la fecha del documento, no contra hoy', () => {
  assert.equal(vigenciaAnteriorAlDocumento('2026-10-04', '2026-09-02'), false);
  assert.equal(vigenciaAnteriorAlDocumento('2026-09-02', '2026-09-02'), false);
});

test('vigenciaAnteriorAlDocumento: sin alguna de las dos fechas no se juzga', () => {
  assert.equal(vigenciaAnteriorAlDocumento('2026-10-04', null), false);
  assert.equal(vigenciaAnteriorAlDocumento(null, '2026-09-02'), false);
});

// --- vigenciaDeComentarios: la vigencia que el quote LLEVA (armarComentariosQuote) ---

test('vigenciaDeComentarios: lee la linea Valido hasta que el cotizador pone al final de comments', () => {
  assert.equal(vigenciaDeComentarios('- Precios con IVA.\nValido hasta: 2026-10-04'), '2026-10-04');
});

test('vigenciaDeComentarios: sin la linea no inventa una fecha', () => {
  assert.equal(vigenciaDeComentarios('QUOTE DE PRUEBA - BORRAR'), null);
  assert.equal(vigenciaDeComentarios(null), null);
});

// --- desfaseQuote: el quote leido por la API contra lo que el post-fix debia dejar ---

// El 1263 tal como lo encontro #359: el POST dejo delivery_date en la fecha por
// defecto y el comments decia otra cosa.
const QUOTE_1263 = { order_no: '1263', ord_date: '2026-09-02', delivery_date: '2026-09-05', order_type: '9', ship_via: '1', comments: 'Valido hasta: 2026-10-04' };

test('desfaseQuote: el 1263 esta desfasado en la vigencia', () => {
  const d = desfaseQuote(QUOTE_1263, { vigencia: '2026-10-04', lista: '9', transportista: null });
  assert.deepEqual(d, [{ campo: 'vigencia', esperado: '2026-10-04', encontrado: '2026-09-05' }]);
});

test('desfaseQuote: la lista y el transportista se comparan contra order_type y ship_via', () => {
  const quote = { ...QUOTE_1263, delivery_date: '2026-10-04', order_type: '16', ship_via: '1' };
  const d = desfaseQuote(quote, { vigencia: '2026-10-04', lista: '9', transportista: '7' });
  assert.deepEqual(d, [
    { campo: 'lista', esperado: '9', encontrado: '16' },
    { campo: 'transportista', esperado: '7', encontrado: '1' },
  ]);
});

test('desfaseQuote: lo que no hay que escribir (null) no se compara', () => {
  const quote = { ...QUOTE_1263, delivery_date: '2026-10-04', order_type: '16' };
  assert.deepEqual(desfaseQuote(quote, { vigencia: '2026-10-04', lista: null, transportista: null }), []);
});

test('desfaseQuote: compara como texto (la API devuelve numeros como cadenas)', () => {
  const quote = { ...QUOTE_1263, delivery_date: '2026-10-04', order_type: '9', ship_via: '7' };
  assert.deepEqual(desfaseQuote(quote, { vigencia: '2026-10-04', lista: 9, transportista: 7 }), []);
});

// --- cotizacionesDelBarrido: los quotes del cotizador de los ultimos 30 dias ---

const AHORA = new Date('2026-09-25T18:00:00.000Z');
function cot(id, extra = {}) {
  return { id, fecha: '2026-09-20T17:00:00.000Z', vendedor: 'Alejandro Chavez', folioOperam: String(1300 + id), data: {}, ...extra };
}

test('cotizacionesDelBarrido: entra la cotizacion subida en los ultimos 30 dias', () => {
  const r = cotizacionesDelBarrido([cot(1)], { ahora: AHORA });
  assert.deepEqual(r.map(c => c.id), [1]);
});

test('cotizacionesDelBarrido: fuera la PRE (sin folio) y la de hace mas de 30 dias', () => {
  const r = cotizacionesDelBarrido([
    cot(1, { folioOperam: null }),
    cot(2, { fecha: '2026-08-25T17:00:00.000Z' }),
    cot(3, { fecha: '2026-08-26T19:00:00.000Z' }),
  ], { ahora: AHORA });
  assert.deepEqual(r.map(c => c.id), [3]);
});

test('cotizacionesDelBarrido: fuera la que ya tiene pedido y la que quedo desactualizada', () => {
  const r = cotizacionesDelBarrido([
    cot(1, { data: { orderOperam: 7001 } }),
    cot(2, { data: { quoteDesactualizado: { fecha: '2026-09-21T00:00:00.000Z', escrito: false } } }),
    cot(3),
  ], { ahora: AHORA });
  assert.deepEqual(r.map(c => c.id), [3]);
});

test('cotizacionesDelBarrido: fuera el folio que ya esta en la cola, en cualquier estado', () => {
  const r = cotizacionesDelBarrido([cot(1), cot(2)], { ahora: AHORA, foliosEnCola: new Set(['1301']) });
  assert.deepEqual(r.map(c => c.id), [2]);
});

// --- Correo: a Adrian (los admin del registro) y al vendedor del quote ---

const VENDEDORES = [
  { id: 1, name: 'Adrian Chavez', role: 'admin', email: 'adrian@ejemplo.mx' },
  { id: 2, name: 'Alejandro Chavez', role: 'vendedor', email: 'alejandro@ejemplo.mx' },
  { id: 3, name: 'Oswaldo Chavez', role: 'vendedor', email: 'oswaldo@ejemplo.mx' },
  { id: 5, name: 'Jaime Abaroa', role: 'vendedor' },
];

test('destinatariosAvisoPostFix: los admin con correo y el vendedor del quote, nadie mas', () => {
  assert.deepEqual(destinatariosAvisoPostFix(VENDEDORES, 'Alejandro Chavez'), ['adrian@ejemplo.mx', 'alejandro@ejemplo.mx']);
});

test('destinatariosAvisoPostFix: el vendedor sin correo registrado no bloquea el aviso a Adrian', () => {
  assert.deepEqual(destinatariosAvisoPostFix(VENDEDORES, 'Jaime Abaroa'), ['adrian@ejemplo.mx']);
});

test('destinatariosAvisoPostFix: sin admin con correo cae a ALERTA_ADMIN_EMAIL', () => {
  const sinCorreoAdmin = VENDEDORES.map(v => (v.role === 'admin' ? { ...v, email: '' } : v));
  assert.deepEqual(
    destinatariosAvisoPostFix(sinCorreoAdmin, 'Oswaldo Chavez', { adminEmailFallback: 'respaldo@ejemplo.mx' }),
    ['respaldo@ejemplo.mx', 'oswaldo@ejemplo.mx'],
  );
});

test('destinatariosAvisoPostFix: el admin que es el vendedor del quote no se repite', () => {
  assert.deepEqual(destinatariosAvisoPostFix(VENDEDORES, 'Adrian Chavez'), ['adrian@ejemplo.mx']);
});

test('mensajeAvisoPostFix: nombra el folio, lo que no quedo y por que se avisa', () => {
  const pendiente = {
    folio: '1263', cotizacionId: 41, vendedor: 'Alejandro Chavez', intentos: 4,
    vigencia: '2026-10-04', lista: '9', transportista: null,
    motivo: 'vigencia: se esperaba 2026-10-04 y se leyo 2026-09-05',
  };
  const m = mensajeAvisoPostFix(pendiente, { causa: 'agotado' }, ['adrian@ejemplo.mx']);
  assert.deepEqual(m.to, ['adrian@ejemplo.mx']);
  assert.match(m.subject, /1263/);
  assert.match(m.text, /2026-10-04/);
  assert.match(m.text, /se leyo 2026-09-05/);
  assert.match(m.text, /4 reintentos/);
});

test('mensajeAvisoPostFix: el rechazo no transitorio dice que reintentar no lo arregla', () => {
  const pendiente = { folio: '1194', vendedor: 'Alejandro Chavez', intentos: 0, vigencia: '2026-07-26', motivo: 'vigencia 2026-07-26 anterior a la fecha del documento 2026-07-27' };
  const m = mensajeAvisoPostFix(pendiente, { causa: 'definitivo' }, ['adrian@ejemplo.mx']);
  assert.match(m.text, /no se reintenta/i);
  assert.match(m.text, /anterior a la fecha del documento/);
});

test('mensajeAvisoPostFix: sin destinatarios no hay mensaje', () => {
  assert.equal(mensajeAvisoPostFix({ folio: '1263' }, { causa: 'agotado' }, []), null);
});
