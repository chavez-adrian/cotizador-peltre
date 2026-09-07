// El buscador de la vista Clientes expone los dos estados del Cliente Operam y
// las etiquetas del Contacto (#344, spec #337, ADR-0016). Los dos se DERIVAN de
// lo que Operam registra: el vendedor lee "Sin datos fiscales" y "con pedido"
// sin capturar nada, y el Cliente Operam del historico -- alta hecha a mano, con
// pedidos que nunca pasaron por el cotizador -- aparece con pedido.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { leerArchivoSync, escribirArchivoSync, borrarArchivoSync } from '../lib/fs-reintento.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROSPECTOS_PATH = join(__dirname, '..', 'data', 'prospectos.json');
const COTS_PATH = join(__dirname, '..', 'data', 'cotizaciones.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}
delete process.env.DATABASE_URL;

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');
const { resetIndice } = await import('../lib/indice-telefonos.js');
const { resetActividad } = await import('../lib/actividad-operam.js');
const { resetSession } = await import('../lib/operam-client.js');
const TOKEN = jwt.sign({ id: 99, name: 'Tester', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

function readJson(p) { return existsSync(p) ? JSON.parse(leerArchivoSync(p)) : []; }
function writeJson(p, data) { escribirArchivoSync(p, JSON.stringify(data, null, 2)); }

// El celular de Laura vive UNICAMENTE en la casilla Cel (`fax` en la API,
// #338/ADR-0016) del Contacto en Operam: es una de las seis casillas que ligan,
// y la unica que ninguna lectura anterior a #338 veia.
const JORGE = {
  customer_id: '514', CustName: 'JORGE OREA', cust_ref: 'Jorge Orea',
  tax_id: 'XAXX010101000', country: 'Mexico',
  contacts: [{ name: 'Jorge Orea', phone: '', phone2: '', fax: '+52 55 1234 5678', email: 'jorge@ejemplo.mx' }],
  branches: [{ branch_code: '546', br_name: 'JORGE OREA', phone: '', email: '' }],
};
const HISTORICO = {
  customer_id: '233', CustName: 'HOTELERA DEL SUR SA DE CV', cust_ref: 'Hotelera del Sur',
  tax_id: 'HSU950101AB1', country: 'Mexico',
  contacts: [], branches: [{ branch_code: '300', br_name: 'MATRIZ', phone: '' }],
};

const CONTACTO_LAURA = {
  id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Tester', celular: '+52 55 1234 5678',
  nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp', etapa: 'seguimiento',
  eventos: [{ tipo: 'cotizacion', cotizacion_id: 50, fecha: '2026-06-02T00:00:00Z', vendedor: 'Tester' }],
  data: {},
};
const COT_LAURA = {
  id: 50, fecha: '2026-06-02T00:00:00Z', vendedor: 'Tester', cliente: 'JORGE OREA',
  etapa: 'seguimiento', totalPiezas: 100, total: 9000, tier: 'M100', folioOperam: 1240,
  contactoCelular: '5512345678',
  data: { cliente: { razonSocial: 'JORGE OREA', telefono: '+52 55 1234 5678', customerId: 514 }, items: [] },
};

const originalFetch = globalThis.fetch;
const fetchBloqueado = async (url) => { throw new Error('fetch sin mock en tests: ' + url); };

function mockOperam({ padron, pedidos = [] } = {}) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/api/v3/login')) return { ok: true, json: async () => ({ token: 'tok', result: true }) };
    if (u.includes('/api/v3/sales/sales_orders')) {
      return { ok: true, json: async () => ({ data: /skip=0/.test(u) ? pedidos : [] }) };
    }
    if (u.includes('/api/v3/sales/customers')) {
      if (u.includes('limit=100')) return { ok: true, json: async () => ({ total: padron.length, data: padron }) };
      const search = decodeURIComponent((u.match(/[?&]search=([^&]*)/) || [])[1] || '');
      const hit = padron.filter(c => c.CustName.toLowerCase().includes(search.toLowerCase()));
      return { ok: true, json: async () => ({ total: hit.length, data: hit }) };
    }
    throw new Error('Unmocked fetch: ' + u);
  };
}

const buscar = q => supertest(app)
  .get('/api/operam/clientes?q=' + encodeURIComponent(q))
  .set('Authorization', `Bearer ${TOKEN}`);

let savedProspectos, savedCots, existiaProspectos, existiaCots;
before(() => {
  existiaProspectos = existsSync(PROSPECTOS_PATH);
  existiaCots = existsSync(COTS_PATH);
  savedProspectos = readJson(PROSPECTOS_PATH);
  savedCots = readJson(COTS_PATH);
  globalThis.fetch = fetchBloqueado;
});
after(() => {
  if (existiaProspectos) writeJson(PROSPECTOS_PATH, savedProspectos);
  else if (existsSync(PROSPECTOS_PATH)) borrarArchivoSync(PROSPECTOS_PATH);
  if (existiaCots) writeJson(COTS_PATH, savedCots);
  else if (existsSync(COTS_PATH)) borrarArchivoSync(COTS_PATH);
  globalThis.fetch = originalFetch;
});
beforeEach(() => {
  writeJson(PROSPECTOS_PATH, [CONTACTO_LAURA]);
  writeJson(COTS_PATH, [COT_LAURA]);
  globalThis.fetch = fetchBloqueado;
  resetIndice();
  resetActividad();
  resetSession();
});

test('#344: la fila del Cliente Operam trae su estado fiscal y su estado comercial', async () => {
  mockOperam({ padron: [JORGE], pedidos: [{ order_no: '7269', debtor_no: '514', trans_no_from: '1240' }] });
  const res = await buscar('Jorge Orea');
  assert.equal(res.status, 200);
  const fila = res.body.find(c => c.id === '514');
  assert.equal(fila.fiscal, 'sin_datos_fiscales');
  assert.equal(fila.comercial, 'con_pedido');
  assert.equal(fila.fuenteIncompleta, false);
});

test('#344: la fila trae las etiquetas del Contacto que comparte su celular', async () => {
  mockOperam({ padron: [JORGE], pedidos: [{ order_no: '7269', debtor_no: '514', trans_no_from: '1240' }] });
  const res = await buscar('Jorge Orea');
  const fila = res.body.find(c => c.id === '514');
  assert.deepEqual(fila.etiquetas, ['prospecto', 'cotizado', 'con_pedido']);
});

// User story 12: el Cliente Operam dado de alta a mano, con pedidos que jamas
// pasaron por el cotizador, no puede parecer que nunca compro.
test('#344: el Cliente Operam del historico aparece con pedido aunque nada suyo pasara por el cotizador', async () => {
  mockOperam({ padron: [HISTORICO], pedidos: [{ order_no: '6100', debtor_no: '233', trans_no_from: '' }] });
  const res = await buscar('Hotelera del Sur');
  const fila = res.body.find(c => c.id === '233');
  assert.equal(fila.comercial, 'con_pedido');
  assert.equal(fila.fiscal, 'con_datos_fiscales');
  assert.deepEqual(fila.etiquetas, [], 'ningun Contacto conocido comparte su celular');
});

// El hueco de los quotes web se DECLARA, no se adivina (ADR-0016).
test('#344: sin movimientos registrados la fila declara la fuente incompleta', async () => {
  mockOperam({ padron: [HISTORICO], pedidos: [] });
  const res = await buscar('Hotelera del Sur');
  const fila = res.body.find(c => c.id === '233');
  assert.equal(fila.comercial, 'sin_actividad');
  assert.equal(fila.fuenteIncompleta, true);
});

// Un pedido cancelado no vuelve con pedido a nadie: la cancelacion no esta en la
// API v3 y sale de data/cancelados.json, que este test no monta -- por eso el
// caso cancelado se prueba en el nucleo puro (test/estado-cliente-operam.test.js)
// y aqui se prueba lo que la ruta hace con un pedido vivo.
test('#344: un Cliente Operam solo cotizado se distingue del que ya tiene pedido', async () => {
  mockOperam({ padron: [JORGE], pedidos: [] });
  const res = await buscar('Jorge Orea');
  const fila = res.body.find(c => c.id === '514');
  // El espejo local aporta el folio 1240 de la cotizacion del cotizador.
  assert.equal(fila.comercial, 'cotizado');
  assert.deepEqual(fila.etiquetas, ['prospecto', 'cotizado']);
});
