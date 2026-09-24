import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import { EventEmitter } from 'node:events';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerArchivoSync } from '../lib/fs-reintento.js';
import { tarifasTresguerras, opcionesTlsPara, postHttps } from '../lib/tresguerras.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Texto CRUDO de las respuestas reales capturadas 2026-09-23 (ver tresguerras-logica.test.js).
const crudo = (nombre) => leerArchivoSync(join(__dirname, 'fixtures', `tresguerras-${nombre}.json`));

const LIGA = 'https://www.tresguerras.com.mx/3G/cotizadorcp.php';
const CAJAS_REF = [{ cantidad: 8, medidasCm: [50, 40, 40], pesoKg: 25 }];

let fetchOriginal, llamadas;
function mockTresguerras(responder) {
  llamadas = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    llamadas.push({ url: u, init });
    const { status = 200, texto } = responder(u, new URLSearchParams(init?.body || ''));
    return { ok: status < 300, status, text: async () => texto };
  };
}
const esPoblaciones = (u) => u.endsWith('/3G/assets/Ajax/cotizadorcp_Ajax.php');
const esCotizar = (u) => u.endsWith('/3G/assets/Ajax/cotizador_Ajax.php');

beforeEach(() => { fetchOriginal = globalThis.fetch; });
afterEach(() => { globalThis.fetch = fetchOriginal; });

test('tarifasTresguerras: Poblaciones y luego CotizarNew -> una tarjeta puerta a puerta con el total con IVA', async () => {
  mockTresguerras((u) => ({ texto: crudo(esPoblaciones(u) ? 'poblaciones-64000' : 'cotizar-con-precio') }));
  const { rates, warnings } = await tarifasTresguerras({ cp: '64000', cajas: CAJAS_REF, valorDeclarado: 10000 });
  assert.deepEqual(warnings, []);
  assert.deepEqual(rates.map(r => [r.carrier, r.service, r.totalPrice, r.days]), [['tresguerras', 'Puerta a puerta', 3930.95, 1]]);

  assert.equal(llamadas.length, 2);
  assert.ok(esPoblaciones(llamadas[0].url));
  assert.equal(llamadas[0].init.method, 'POST');
  assert.match(llamadas[0].init.headers['Content-Type'], /^application\/x-www-form-urlencoded/);
  assert.equal(llamadas[0].init.body, 'action=Poblaciones&origenCP=56577&destinoCP=64000');

  assert.ok(esCotizar(llamadas[1].url));
  const form = new URLSearchParams(llamadas[1].init.body);
  assert.equal(form.get('action'), 'CotizarNew');
  const df = new URLSearchParams(form.get('datosForm'));
  assert.deepEqual([df.get('origen2'), df.get('ColOriCp'), df.get('destino2'), df.get('ColDesCp'), df.get('valorDec')],
    ['0000001632', '0000050499', '0000000053', '0000113951', '10000']);
});

test('tarifasTresguerras: CP que Tresguerras no encuentra -> aviso, sin cotizar', async () => {
  mockTresguerras((u) => ({ texto: esPoblaciones(u) ? crudo('poblaciones-sin-destino') : 'no debia cotizar' }));
  const r = await tarifasTresguerras({ cp: '99999', cajas: CAJAS_REF, valorDeclarado: 1000 });
  assert.deepEqual(r.rates, []);
  assert.match(r.warnings[0], /^Tresguerras no da servicio al CP 99999/);
  assert.equal(llamadas.length, 1);
});

for (const [fixture, esperado] of [
  ['cotizar-sin-servicio', /^Tresguerras no da servicio puerta a puerta al CP 64000 \(Sin servicio\)$/],
  ['cotizar-ruta-no-autorizada', /^Tresguerras no da servicio puerta a puerta al CP 64000 \(Ruta no autorizada\)$/],
  ['cotizar-peso-no-autorizado', /^Tresguerras rechazo la carga \(Peso no autorizado\)/],
]) {
  test(`tarifasTresguerras: ${fixture} -> aviso, sin tarjeta`, async () => {
    mockTresguerras((u) => ({ texto: crudo(esPoblaciones(u) ? 'poblaciones-64000' : fixture) }));
    const r = await tarifasTresguerras({ cp: '64000', cajas: CAJAS_REF, valorDeclarado: 1000 });
    assert.deepEqual(r.rates, []);
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], esperado);
  });
}

test('tarifasTresguerras: red o TLS caidos -> aviso con el motivo y la liga, nunca lanza', async () => {
  globalThis.fetch = async () => { throw new Error('unable to verify the first certificate'); };
  const r = await tarifasTresguerras({ cp: '64000', cajas: CAJAS_REF, valorDeclarado: 1000 });
  assert.deepEqual(r, { rates: [], warnings: [`Tresguerras no disponible (unable to verify the first certificate); cotiza a mano en ${LIGA}`] });
});

test('tarifasTresguerras: un status distinto de 200 -> aviso con el status', async () => {
  mockTresguerras(() => ({ status: 503, texto: '' }));
  const r = await tarifasTresguerras({ cp: '64000', cajas: CAJAS_REF, valorDeclarado: 1000 });
  assert.deepEqual(r.rates, []);
  assert.match(r.warnings[0], /^Tresguerras no disponible \(respondio 503\)/);
});

test('tarifasTresguerras: respuesta que no es JSON (movieron la pagina) -> aviso de que el cotizador cambio', async () => {
  mockTresguerras((u) => ({ texto: esPoblaciones(u) ? '<html>Pagina no encontrada</html>' : '' }));
  const r = await tarifasTresguerras({ cp: '64000', cajas: CAJAS_REF, valorDeclarado: 1000 });
  assert.deepEqual(r, { rates: [], warnings: [`Tresguerras cambio su cotizador; cotiza a mano en ${LIGA}`] });

  mockTresguerras((u) => ({ texto: esPoblaciones(u) ? crudo('poblaciones-64000') : 'Fatal error' }));
  const r2 = await tarifasTresguerras({ cp: '64000', cajas: CAJAS_REF, valorDeclarado: 1000 });
  assert.deepEqual(r2, { rates: [], warnings: [`Tresguerras cambio su cotizador; cotiza a mano en ${LIGA}`] });
});

test('tarifasTresguerras: sin mock de fetch NO sale a la red; lo dice como aviso y no lanza', async () => {
  const r = await tarifasTresguerras({ cp: '64000', cajas: CAJAS_REF, valorDeclarado: 1000 });
  assert.deepEqual(r.rates, []);
  assert.match(r.warnings[0], /Prueba sin mock de fetch/);
});

// El dominio no manda el certificado intermedio (unable to verify the first
// certificate). La salida es darle ESE intermedio, solo a ese host: la
// verificacion sigue completa y el resto del proceso no cambia.
test('opcionesTlsPara: agrega el intermedio de Sectigo a las raices SOLO para www.tresguerras.com.mx', () => {
  const o = opcionesTlsPara('https://www.tresguerras.com.mx/3G/assets/Ajax/cotizador_Ajax.php');
  assert.equal(o.ca.length, tls.rootCertificates.length + 1);
  assert.ok(tls.rootCertificates.every(c => o.ca.includes(c)));
  const intermedio = o.ca.find(c => !tls.rootCertificates.includes(c));
  assert.match(intermedio, /^-----BEGIN CERTIFICATE-----/);
  assert.equal(o.rejectUnauthorized, undefined);
});

test('opcionesTlsPara: ningun otro host recibe opciones de TLS', () => {
  assert.deepEqual(opcionesTlsPara('https://api.envia.com/ship/rate/'), {});
  assert.deepEqual(opcionesTlsPara('https://www.tresguerras.com.mx.evil.com/x'), {});
  assert.deepEqual(opcionesTlsPara('https://tresguerras.com.mx/x'), {});
  assert.deepEqual(opcionesTlsPara('no-es-url'), {});
});

function requestFalso(registro, status, texto) {
  return (url, opciones, cb) => {
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.end = (cuerpo) => {
      registro.push({ url, opciones, cuerpo });
      const res = new EventEmitter();
      res.statusCode = status;
      res.setEncoding = () => {};
      cb(res);
      res.emit('data', texto);
      res.emit('end');
    };
    return req;
  };
}

test('postHttps: POST form-urlencoded por node:https con el TLS acotado del host', async () => {
  const registro = [];
  const r = await postHttps('https://www.tresguerras.com.mx/3G/assets/Ajax/cotizadorcp_Ajax.php', 'action=Poblaciones&destinoCP=64000',
    { request: requestFalso(registro, 200, '{"Origen":{}}') });
  assert.deepEqual(r, { status: 200, texto: '{"Origen":{}}' });
  const { opciones, cuerpo } = registro[0];
  assert.equal(opciones.method, 'POST');
  assert.match(opciones.headers['Content-Type'], /^application\/x-www-form-urlencoded/);
  assert.equal(opciones.headers['Content-Length'], Buffer.byteLength(cuerpo));
  assert.equal(cuerpo, 'action=Poblaciones&destinoCP=64000');
  assert.equal(opciones.ca.length, tls.rootCertificates.length + 1);
});
