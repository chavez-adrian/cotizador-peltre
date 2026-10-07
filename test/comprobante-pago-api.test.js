// #485 (GLOSSARY.md "Comprobante de pago"): el vendedor sube desde la tarjeta el
// comprobante del PRIMER pago y queda archivado en el Dropbox de la empresa por
// el flujo `pago`. A diferencia de la posicion de calca (#61) la subida NO es
// fire-and-forget: el comprobante cuenta como subido solo si Dropbox lo
// confirmo. Lo suben el dueno de la tarjeta o el admin.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync } from '../lib/fs-reintento.js';
import { fotoDatos, fijarDatos } from './helpers/datos-aislados.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COTS_PATH = join(__dirname, '..', 'data', 'cotizaciones.json');
const SUBIDAS_PATH = join(__dirname, '..', 'data', 'dropbox-subidas.json');
const PROSPECTOS_PATH = join(__dirname, '..', 'data', 'prospectos.json');
const OPORTUNIDADES_PATH = join(__dirname, '..', 'data', 'oportunidades.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}
delete process.env.DATABASE_URL;

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');
const store = await import('../lib/dropbox-subidas-store.js');

const MEMO = `Bearer ${jwt.sign({ id: 7, name: 'Memo', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' })}`;
const ANA = `Bearer ${jwt.sign({ id: 8, name: 'Ana', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' })}`;
const ADMIN = `Bearer ${jwt.sign({ id: 99, name: 'Tester', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' })}`;

const readJson = (p) => (existsSync(p) ? JSON.parse(leerArchivoSync(p)) : []);

const COT = {
  id: 30, fecha: new Date().toISOString(), vendedor: 'Memo', cliente: 'RESTAURANTE LA LUPITA', etapa: 'seguimiento',
  estado: 'abierta', totalPiezas: 200, total: 15000, tier: 'M100', folioOperam: 1250, eventos: [], seguimientos: [],
  data: { cliente: { razonSocial: 'RESTAURANTE LA LUPITA' }, items: [] },
};

const VARS = ['DROPBOX_REFRESH_TOKEN', 'DROPBOX_APP_KEY', 'DROPBOX_APP_SECRET', 'DROPBOX_NS_PAGO', 'DROPBOX_PATH_PAGO'];
const envPrevio = {};
const originalFetch = globalThis.fetch;
let restaurar;

before(() => {
  restaurar = fotoDatos([COTS_PATH, SUBIDAS_PATH, PROSPECTOS_PATH, OPORTUNIDADES_PATH]);
  for (const v of VARS) envPrevio[v] = process.env[v];
  process.env.DROPBOX_REFRESH_TOKEN = 'refresh';
  process.env.DROPBOX_APP_KEY = 'key';
  process.env.DROPBOX_APP_SECRET = 'secret';
  process.env.DROPBOX_NS_PAGO = '1111111111';
  process.env.DROPBOX_PATH_PAGO = '/';
});

after(() => {
  globalThis.fetch = originalFetch;
  for (const v of VARS) {
    if (envPrevio[v] === undefined) delete process.env[v]; else process.env[v] = envPrevio[v];
  }
  restaurar();
});

beforeEach(() => {
  globalThis.fetch = originalFetch;
  fijarDatos(COTS_PATH, [structuredClone(COT)]);
  fijarDatos(SUBIDAS_PATH, []);
});

// expires_in 0: lib/dropbox.js cachea el token en una variable de modulo que la
// prueba no puede restaurar (mismo cuidado que test/dropbox-flujos-api.test.js).
// `fallar` = nombres de archivo de Dropbox (ruta pedida) que responden error.
function mockDropbox({ fallar = () => false } = {}) {
  const subidas = [];
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('oauth2/token')) return { ok: true, json: async () => ({ access_token: 'dbx', expires_in: 0 }) };
    if (u.includes('files/upload')) {
      const { path } = JSON.parse(opts.headers['Dropbox-API-Arg']);
      subidas.push({ path, headers: opts.headers });
      if (fallar(path)) return { ok: false, status: 409, text: async () => 'path/insufficient_space/' };
      return { ok: true, json: async () => ({ path_display: path }) };
    }
    throw new Error('Unmocked fetch: ' + u);
  };
  return subidas;
}

const subir = (token, archivos, id = 30) => {
  let req = supertest(app).post(`/api/cotizacion/${id}/comprobante-pago/primer`).set('Authorization', token);
  for (const [nombre, contenido] of archivos) req = req.attach('archivos', Buffer.from(contenido), nombre);
  return req;
};

const comprobanteGuardado = (id = 30) => readJson(COTS_PATH).find(c => c.id === id).data.comprobantesPago?.primer ?? null;

test('CP1: el dueno sube un PDF y una foto, Dropbox confirma: el registro guarda archivos y fecha y la respuesta lo dice', async () => {
  const subidas = mockDropbox();
  const antes = Date.now();
  const res = await subir(MEMO, [['transferencia.pdf', '%PDF-1.4'], ['ticket.JPG', 'jpg']]);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(subidas.length, 2);
  assert.equal(subidas[0].headers['Dropbox-API-Path-Root'], '{".tag":"namespace_id","namespace_id":"1111111111"}');
  assert.equal(subidas[0].path, '/Cotizacion 1250 - RESTAURANTE LA LUPITA - Primer pago - 1.pdf');
  assert.equal(subidas[1].path, '/Cotizacion 1250 - RESTAURANTE LA LUPITA - Primer pago - 2.JPG');
  const guardado = comprobanteGuardado();
  assert.deepEqual(guardado.archivos.map(a => [a.nombre, a.ruta]), [
    ['transferencia.pdf', '/Cotizacion 1250 - RESTAURANTE LA LUPITA - Primer pago - 1.pdf'],
    ['ticket.JPG', '/Cotizacion 1250 - RESTAURANTE LA LUPITA - Primer pago - 2.JPG'],
  ]);
  assert.ok(Date.parse(guardado.fecha) >= antes - 1000, 'fecha del comprobante: ' + guardado.fecha);
  assert.deepEqual(res.body.comprobante, guardado);
  assert.match(res.body.mensaje, /Dropbox confirm/);
});

test('CP2: otro vendedor recibe 403 y nada sale a Dropbox', async () => {
  const subidas = mockDropbox();
  const res = await subir(ANA, [['transferencia.pdf', '%PDF-1.4']]);
  assert.equal(res.status, 403);
  assert.equal(subidas.length, 0);
  assert.equal(comprobanteGuardado(), null);
});

test('CP3: el admin sube el comprobante de una tarjeta ajena', async () => {
  mockDropbox();
  const res = await subir(ADMIN, [['transferencia.pdf', '%PDF-1.4']]);
  assert.equal(res.status, 200);
  assert.deepEqual(comprobanteGuardado().archivos.map(a => a.ruta), ['/Cotizacion 1250 - RESTAURANTE LA LUPITA - Primer pago.pdf']);
});

test('CP4: Dropbox falla: la respuesta lo dice y el comprobante sigue faltando', async () => {
  mockDropbox({ fallar: () => true });
  const res = await subir(MEMO, [['transferencia.pdf', '%PDF-1.4']]);
  assert.notEqual(res.status, 200);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /transferencia\.pdf/);
  assert.match(res.body.error, /sigue faltando/);
  assert.deepEqual(res.body.fallidos.map(f => f.nombre), ['transferencia.pdf']);
  assert.equal(comprobanteGuardado(), null);
});

test('CP5: si Dropbox confirma uno y rechaza otro, solo se guarda el confirmado y la respuesta nombra al que falto', async () => {
  mockDropbox({ fallar: (path) => path.endsWith('- 2.png') });
  const res = await subir(MEMO, [['transferencia.pdf', '%PDF-1.4'], ['captura.png', 'png']]);
  assert.notEqual(res.status, 200);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /captura\.png/);
  assert.match(res.body.error, /vuelve a subir/i);
  assert.deepEqual(res.body.confirmados.map(a => a.nombre), ['transferencia.pdf']);
  assert.deepEqual(comprobanteGuardado().archivos.map(a => a.nombre), ['transferencia.pdf']);
});

test('CP6: un archivo que no es imagen ni PDF se rechaza con texto accionable y nada sale a Dropbox', async () => {
  const subidas = mockDropbox();
  const res = await subir(MEMO, [['transferencia.pdf', '%PDF-1.4'], ['estado de cuenta.docx', 'docx']]);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /estado de cuenta\.docx/);
  assert.match(res.body.error, /PDF/);
  assert.match(res.body.error, /JPG/);
  assert.equal(subidas.length, 0);
  assert.equal(comprobanteGuardado(), null);
});

test('CP7: un archivo de mas de 10 MB se rechaza con texto accionable y nada sale a Dropbox', async () => {
  const subidas = mockDropbox();
  const res = await supertest(app).post('/api/cotizacion/30/comprobante-pago/primer').set('Authorization', MEMO)
    .attach('archivos', Buffer.alloc(10 * 1024 * 1024 + 1, 1), 'foto.jpg');
  assert.equal(res.status, 400);
  assert.match(res.body.error, /10 MB/);
  assert.equal(subidas.length, 0);
  assert.equal(comprobanteGuardado(), null);
});

test('CP8: sin archivos responde 400 pidiendo elegir el comprobante', async () => {
  const subidas = mockDropbox();
  const res = await supertest(app).post('/api/cotizacion/30/comprobante-pago/primer').set('Authorization', MEMO);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /comprobante/);
  assert.equal(subidas.length, 0);
});

test('CP9: cada intento, confirmado o fallido, queda en el registro de subidas de /admin con flujo pago', async () => {
  mockDropbox({ fallar: (path) => path.endsWith('- 2.png') });
  await subir(MEMO, [['transferencia.pdf', '%PDF-1.4'], ['captura.png', 'png']]);
  const res = await supertest(app).get('/api/admin/dropbox-subidas').set('Authorization', ADMIN);
  assert.equal(res.status, 200);
  const filas = res.body.subidas.filter(s => s.flujo === 'pago');
  assert.equal(filas.length, 2);
  assert.deepEqual(filas.map(f => f.ok).sort(), [false, true]);
  assert.ok(filas.every(f => f.lugar?.namespace === '1111111111'), JSON.stringify(filas.map(f => f.lugar)));
  assert.deepEqual(res.body.flujos.find(f => f.flujo === 'pago'), { flujo: 'pago', configurado: true, namespace: '1111111111', base: '/' });
});

test('CP10: subir despues agrega archivos al comprobante (corrige un faltante) y mueve su fecha', async () => {
  const previo = { fecha: '2026-09-29T15:00:00.000Z', archivos: [{ nombre: 'transferencia.pdf', ruta: '/Cotizacion 1250 - RESTAURANTE LA LUPITA - Primer pago.pdf', fecha: '2026-09-29T15:00:00.000Z' }] };
  fijarDatos(COTS_PATH, [{ ...structuredClone(COT), etapa: 'anticipo_pagado', data: { ...COT.data, comprobantesPago: { primer: previo } } }]);
  mockDropbox();
  const res = await subir(MEMO, [['segundo deposito.png', 'png']]);
  assert.equal(res.status, 200);
  const guardado = comprobanteGuardado();
  assert.deepEqual(guardado.archivos.map(a => a.nombre), ['transferencia.pdf', 'segundo deposito.png']);
  assert.notEqual(guardado.fecha, previo.fecha);
});

test('CP11: una cotizacion que no ha llegado a Seguimiento o ya salio del embudo no recibe comprobante', async () => {
  for (const etapa of ['por_cotizar', 'perdida']) {
    fijarDatos(COTS_PATH, [{ ...structuredClone(COT), etapa }]);
    const subidas = mockDropbox();
    const res = await subir(MEMO, [['transferencia.pdf', '%PDF-1.4']]);
    assert.equal(res.status, 409, etapa);
    assert.match(res.body.error, /Seguimiento/);
    assert.equal(subidas.length, 0, etapa);
  }
});

test('CP12: un pago que no admite comprobante responde 404', async () => {
  mockDropbox();
  const res = await supertest(app).post('/api/cotizacion/30/comprobante-pago/tercero').set('Authorization', MEMO)
    .attach('archivos', Buffer.from('%PDF'), 'x.pdf');
  assert.equal(res.status, 404);
});

test('CP13: la tarjeta del tablero trae el comprobante que Dropbox confirmo', async () => {
  fijarDatos(PROSPECTOS_PATH, []);
  fijarDatos(OPORTUNIDADES_PATH, []);
  mockDropbox();
  await subir(MEMO, [['transferencia.pdf', '%PDF-1.4']]);
  const res = await supertest(app).get('/api/oportunidades').set('Authorization', MEMO);
  assert.equal(res.status, 200);
  const lista = Array.isArray(res.body) ? res.body : res.body.oportunidades;
  const card = lista.find(o => o.id === 'c30');
  assert.deepEqual(card.comprobantesPago.primer.archivos.map(a => a.nombre), ['transferencia.pdf']);
  assert.equal(card.comprobantesPago.primer.fecha, comprobanteGuardado().fecha);
});

test('CP14: el nombre del archivo con acentos llega intacto al registro', async () => {
  mockDropbox();
  const res = await subir(MEMO, [['dep\u00f3sito a\u00f1o.png', 'png']]);
  assert.equal(res.status, 200);
  assert.deepEqual(comprobanteGuardado().archivos.map(a => a.nombre), ['dep\u00f3sito a\u00f1o.png']);
});

// #486: el comprobante del SALDO, por la misma ruta, con los mismos permisos y la
// misma confirmacion de Dropbox, solo en una venta con anticipo y desde Pedido
// liberado. Se guarda aparte del primer pago.
const subirSaldo = (token, archivos, id = 30) => {
  let req = supertest(app).post(`/api/cotizacion/${id}/comprobante-pago/saldo`).set('Authorization', token);
  for (const [nombre, contenido] of archivos) req = req.attach('archivos', Buffer.from(contenido), nombre);
  return req;
};
const conAnticipo = (etapa, extra = {}) => ({ ...structuredClone(COT), etapa, data: { ...COT.data, huboAnticipo: true, ...extra } });
const PRIMER_PREVIO = { fecha: '2026-09-29T15:00:00.000Z', archivos: [{ nombre: 'anticipo.pdf', ruta: '/Cotizacion 1250 - RESTAURANTE LA LUPITA - Primer pago.pdf', fecha: '2026-09-29T15:00:00.000Z' }] };

test('CP16: con anticipo, el dueno sube el comprobante del saldo en Pedido liberado y queda aparte del primer pago', async () => {
  fijarDatos(COTS_PATH, [conAnticipo('pedido_liberado', { comprobantesPago: { primer: PRIMER_PREVIO } })]);
  const subidas = mockDropbox();
  const res = await subirSaldo(MEMO, [['liquidacion.pdf', '%PDF-1.4']]);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(subidas[0].path, '/Cotizacion 1250 - RESTAURANTE LA LUPITA - Saldo.pdf');
  assert.equal(subidas[0].headers['Dropbox-API-Path-Root'], '{".tag":"namespace_id","namespace_id":"1111111111"}');
  const pagos = readJson(COTS_PATH).find(c => c.id === 30).data.comprobantesPago;
  assert.deepEqual(pagos.saldo.archivos.map(a => a.nombre), ['liquidacion.pdf']);
  assert.deepEqual(pagos.primer, PRIMER_PREVIO);
  assert.deepEqual(res.body.comprobante, pagos.saldo);
});

test('CP17: sin anticipo (pago unico) el comprobante del saldo no se recibe y nada sale a Dropbox', async () => {
  for (const etapa of ['pedido_liberado', 'saldo_pagado']) {
    fijarDatos(COTS_PATH, [{ ...structuredClone(COT), etapa }]);
    const subidas = mockDropbox();
    const res = await subirSaldo(MEMO, [['liquidacion.pdf', '%PDF-1.4']]);
    assert.equal(res.status, 409, etapa);
    assert.match(res.body.error, /anticipo/);
    assert.equal(subidas.length, 0, etapa);
  }
});

test('CP18: con anticipo, antes de Pedido liberado el comprobante del saldo no se recibe', async () => {
  for (const etapa of ['seguimiento', 'anticipo_pagado']) {
    fijarDatos(COTS_PATH, [conAnticipo(etapa)]);
    const subidas = mockDropbox();
    const res = await subirSaldo(MEMO, [['liquidacion.pdf', '%PDF-1.4']]);
    assert.equal(res.status, 409, etapa);
    assert.match(res.body.error, /Pedido liberado/);
    assert.equal(subidas.length, 0, etapa);
  }
});

test('CP19: el comprobante del saldo tiene los mismos permisos: otro vendedor 403, el admin si', async () => {
  fijarDatos(COTS_PATH, [conAnticipo('producto_entregado')]);
  const subidas = mockDropbox();
  const ajeno = await subirSaldo(ANA, [['liquidacion.pdf', '%PDF-1.4']]);
  assert.equal(ajeno.status, 403);
  assert.equal(subidas.length, 0);
  const admin = await subirSaldo(ADMIN, [['liquidacion.pdf', '%PDF-1.4']]);
  assert.equal(admin.status, 200, JSON.stringify(admin.body));
});

test('CP20: si Dropbox no confirma, el comprobante del saldo sigue faltando', async () => {
  fijarDatos(COTS_PATH, [conAnticipo('saldo_pagado')]);
  mockDropbox({ fallar: () => true });
  const res = await subirSaldo(MEMO, [['liquidacion.pdf', '%PDF-1.4']]);
  assert.equal(res.status, 502);
  assert.equal(readJson(COTS_PATH).find(c => c.id === 30).data.comprobantesPago?.saldo ?? null, null);
});

test('CP21: la tarjeta del tablero trae la marca de anticipo', async () => {
  fijarDatos(PROSPECTOS_PATH, []);
  fijarDatos(OPORTUNIDADES_PATH, []);
  fijarDatos(COTS_PATH, [conAnticipo('saldo_pagado')]);
  const res = await supertest(app).get('/api/oportunidades').set('Authorization', MEMO);
  const lista = Array.isArray(res.body) ? res.body : res.body.oportunidades;
  assert.equal(lista.find(o => o.id === 'c30').huboAnticipo, true);
});

// Subidas simultaneas a la MISMA cotizacion: cada una relee data.comprobantesPago
// despues de su subida y lo vuelve a escribir entero; sin serializar esa
// relectura y escritura, la ultima en escribir pisaba lo que la otra guardo.
// Dropbox retiene las subidas hasta que llegan todas, para que terminen juntas.
function mockDropboxRetenido(esperadas) {
  const pendientes = [];
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('oauth2/token')) return { ok: true, json: async () => ({ access_token: 'dbx', expires_in: 0 }) };
    if (u.includes('files/upload')) {
      const { path } = JSON.parse(opts.headers['Dropbox-API-Arg']);
      await new Promise(soltar => {
        pendientes.push(soltar);
        if (pendientes.length === esperadas) pendientes.forEach(s => s());
      });
      return { ok: true, json: async () => ({ path_display: path }) };
    }
    throw new Error('Unmocked fetch: ' + u);
  };
}

test('CP22: el primer pago y el saldo subidos al mismo tiempo se guardan los dos', async () => {
  fijarDatos(COTS_PATH, [conAnticipo('pedido_liberado')]);
  mockDropboxRetenido(2);
  const [a, b] = await Promise.all([
    subir(MEMO, [['anticipo.pdf', '%PDF-1.4']]),
    subirSaldo(MEMO, [['liquidacion.pdf', '%PDF-1.4']]),
  ]);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(b.status, 200, JSON.stringify(b.body));
  const pagos = readJson(COTS_PATH).find(c => c.id === 30).data.comprobantesPago;
  assert.deepEqual(pagos.primer?.archivos.map(x => x.nombre), ['anticipo.pdf']);
  assert.deepEqual(pagos.saldo?.archivos.map(x => x.nombre), ['liquidacion.pdf']);
});

test('CP23: dos subidas simultaneas del mismo comprobante acumulan los archivos de las dos', async () => {
  mockDropboxRetenido(2);
  const [a, b] = await Promise.all([
    subir(MEMO, [['transferencia.pdf', '%PDF-1.4']]),
    subir(MEMO, [['ticket.jpg', 'jpg']]),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.deepEqual(comprobanteGuardado().archivos.map(x => x.nombre).sort(), ['ticket.jpg', 'transferencia.pdf']);
});

test('CP15: sin DROPBOX_NS_PAGO/DROPBOX_PATH_PAGO el archivo cae al sandbox y la respuesta lo dice en vez de afirmar la carpeta de la empresa', async () => {
  const ns = process.env.DROPBOX_NS_PAGO;
  delete process.env.DROPBOX_NS_PAGO;
  try {
    const subidas = mockDropbox();
    const res = await subir(MEMO, [['transferencia.pdf', '%PDF-1.4']]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(subidas[0].headers['Dropbox-API-Path-Root'], undefined);
    assert.ok(subidas[0].path.startsWith('/cotizador-sandbox/comprobantes-de-pago/'), subidas[0].path);
    assert.match(res.body.mensaje, /sandbox de la app/);
    assert.match(res.body.mensaje, /no en la carpeta de la empresa/);
    assert.doesNotMatch(res.body.mensaje, /^Dropbox confirm/);
  } finally {
    process.env.DROPBOX_NS_PAGO = ns;
  }
});

// #529: el guardado rechaza una cotizacion con pedido, pero el comprobante de pago
// es otro escritor del registro y no cambia: con data.orderOperam responde como sin el.
test('CP-529: con pedido (data.orderOperam) el comprobante se sube y se guarda como sin pedido', async () => {
  fijarDatos(COTS_PATH, [{ ...structuredClone(COT), etapa: 'pedido_liberado', data: { ...COT.data, orderOperam: '7269' } }]);
  const subidas = mockDropbox();
  const res = await subir(MEMO, [['transferencia.pdf', '%PDF-1.4']]);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(subidas.length, 1);
  const guardado = comprobanteGuardado();
  assert.deepEqual(guardado.archivos.map(a => a.nombre), ['transferencia.pdf']);
  assert.deepEqual(res.body.comprobante, guardado);
  assert.match(res.body.mensaje, /Dropbox confirm/);
});
