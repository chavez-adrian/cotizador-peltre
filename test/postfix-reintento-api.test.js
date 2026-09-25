// #380: la subida del quote encola el post-fix web que no quedo verificado. Costura
// HTTP: POST /api/cotizacion/operam/:id con un Operam de mentiras (API v3 + web
// legacy) cuya vista read-only puede devolver otra fecha. La cola se lee del fallback
// JSON (sin DATABASE_URL); el reintento y el barrido se prueban en
// postfix-reintento-io.test.js.
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
const DATA_DIR = join(__dirname, '..', 'data');
const COTS_PATH = join(DATA_DIR, 'cotizaciones.json');
const COLA_PATH = join(DATA_DIR, 'postfix-pendientes.json');

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
const { _resetSesionWeb } = await import('../lib/operam-web.js');
const { _esperarEncolados } = await import('../lib/postfix-reintento-io.js');
const TOKEN = `Bearer ${jwt.sign({ id: 99, name: 'Tester', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' })}`;

const originalFetch = globalThis.fetch;
const originalError = console.error;

let restaurarDatos;
before(() => { restaurarDatos = fotoDatos([COTS_PATH, COLA_PATH]); });
after(() => {
  restaurarDatos();
  globalThis.fetch = originalFetch;
  console.error = originalError;
  _resetSesionWeb();
});
beforeEach(() => {
  fijarDatos(COTS_PATH, []);
  fijarDatos(COLA_PATH, []);
  globalThis.fetch = originalFetch;
  console.error = originalError;
  _resetSesionWeb();
});

const leerCola = () => JSON.parse(leerArchivoSync(COLA_PATH));

const DATA = {
  fecha: '2026-09-24', vigencia: '2026-10-24',
  cliente: { rfc: 'CPE921211N76', razonSocial: 'El Pendulo', nombreCorto: 'Pendulo', cpEntrega: '56530', telefono: '+52 5551234567' },
  items: [{ codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 10, precio: 100, descuento: 0 }],
  subtotal: 1000, iva: 160, total: 1160, notas: [],
};

function guardarCotizacion() {
  const id = 7100;
  fijarDatos(COTS_PATH, [{ id, fecha: '2026-09-24T00:00:00Z', vendedor: 'Alejandro Chavez', cliente: 'Pendulo', totalPiezas: 10, total: 1160, tier: 'Mayoreo', data: DATA }]);
  return id;
}

// Operam de mentiras. `vistaLee`: la fecha que devuelve la vista read-only despues del
// ProcessOrder (null = la del documento; otra = el caso del 1263). `webCaida`: el
// formulario no llega y el post-fix lanza antes de escribir.
function mockOperam({ vistaLee = null, webCaida = false } = {}) {
  const doc = { vigencia: '2026-09-23' };
  const texto = (html) => ({ headers: {}, text: async () => html });
  const json = (data) => ({ ok: true, status: 200, json: async () => data });
  const form = () => `<form method='post' action='/sales/sales_order_entry.php'>
<input type="hidden" name="cart_id" value='CART1'>
<input type="hidden" name="customer_id" value='314'>
<input type="text" name="delivery_date" value="${doc.vigencia}">
<textarea name="Comments">Valido hasta: 2026-10-24</textarea>
<button type='submit' name='ProcessOrder' value='Confirmar Cambios'></button>
<button type='submit' name='CancelOrder' value='Cancelar'></button>
</form>`;
  const vista = () => `<table><tr><td class='tableheader2'>Valido hasta</td><td id=''>${vistaLee ?? doc.vigencia}</td></tr></table>`;
  const handlers = [
    ['/api/v3/login', () => json({ token: 'tok', result: true })],
    ['/api/v3/sales/customers', () => json({ total: 1, data: [{ customer_id: 314, tax_id: 'CPE921211N76', CustName: 'El Pendulo', sales_type: '12', curr_code: 'MXN', branches: [{ branch_code: 88 }] }] })],
    ['/api/v3/sales/quote/', () => json({ data: [{ order_no: '1296', order_type: '12' }] })],
    ['/api/v3/sales/quote', () => json({ result: true, added_trans_no: 1296 })],
    ['trans_type=30', () => texto('<html>login ok</html>')],
    ['ModifyQuotationNumber', () => {
      if (webCaida) throw new Error('timeout de la web legacy');
      return texto(form());
    }],
    ['trans_type=32', () => texto(vista())],
    ['sales_order_entry.php', (u, opts) => {
      const p = new URLSearchParams(opts.body || '');
      if (p.has('CancelOrder')) throw new Error('JAMAS debe mandarse CancelOrder');
      if (p.has('ProcessOrder')) doc.vigencia = p.get('delivery_date');
      return texto(form());
    }],
  ];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    for (const [pat, fn] of handlers) if (u.includes(pat)) return fn(u, opts);
    throw new Error('Unmocked fetch: ' + u);
  };
  return doc;
}

function capturarConsoleError() {
  const lineas = [];
  console.error = (...args) => { lineas.push(args.map(String).join(' ')); };
  return lineas;
}

const pasoVigencia = (res) => (res.body.steps || []).find(s => s.name === 'post-fix vigencia');

test('#380 el post-fix verificado no deja nada en la cola', async () => {
  const id = guardarCotizacion();
  const doc = mockOperam();
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN);
  await _esperarEncolados();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(pasoVigencia(res).status, 'ok');
  assert.equal(doc.vigencia, '2026-10-24');
  assert.deepEqual(leerCola(), []);
});

test('#380 la vigencia que la relectura no confirma se encola persistida y deja rastro en los logs', async () => {
  const id = guardarCotizacion();
  mockOperam({ vistaLee: '2026-09-25' });
  const errores = capturarConsoleError();
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN);
  await _esperarEncolados();
  console.error = originalError;

  assert.equal(res.status, 200, 'la subida sigue siendo exitosa: el quote ya existe');
  assert.equal(pasoVigencia(res).status, 'warn');
  assert.ok(errores.some(l => l.includes('[post-fix vigencia]') && l.includes('1296')), 'la rama warn escribe en los logs de Render: ' + JSON.stringify(errores));
  const [p] = leerCola();
  assert.equal(p.folio, '1296');
  assert.equal(p.cotizacionId, id);
  assert.equal(p.vendedor, 'Alejandro Chavez');
  assert.equal(p.origen, 'post-fix');
  assert.equal(p.estado, 'pendiente');
  assert.equal(p.vigencia, '2026-10-24');
  assert.equal(p.fechaDocumento, '2026-09-24');
  assert.equal(p.intentos, 0);
  assert.match(p.motivo, /2026-09-25/);
});

test('#380 el post-fix que falla antes de escribir tambien se encola', async () => {
  const id = guardarCotizacion();
  mockOperam({ webCaida: true });
  capturarConsoleError();
  const res = await supertest(app).post(`/api/cotizacion/operam/${id}`).set('Authorization', TOKEN);
  await _esperarEncolados();
  console.error = originalError;

  assert.equal(res.status, 200);
  assert.equal(pasoVigencia(res).status, 'error');
  const [p] = leerCola();
  assert.equal(p.folio, '1296');
  assert.equal(p.vigencia, '2026-10-24');
  assert.match(p.motivo, /timeout de la web legacy/);
});
