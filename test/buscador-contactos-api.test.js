// El buscador de la vista Clientes devuelve una fila por Contacto (#346, spec
// #337, ADR-0016): la misma persona una sola vez, con sus Clientes Operam
// anidados, y los Clientes Operam de los que no conocemos a nadie como filas
// propias.
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
// #338): una de las seis casillas que ligan (ADR-0016).
const JORGE = {
  customer_id: '514', CustName: 'JORGE OREA', cust_ref: 'Jorge Orea',
  tax_id: 'XAXX010101000', country: 'Mexico',
  contacts: [{ name: 'Jorge Orea', phone: '', phone2: '', fax: '+52 55 1234 5678', email: 'jorge@ejemplo.mx' }],
  branches: [{ branch_code: '546', br_name: 'JORGE OREA', phone: '', email: '' }],
};
// Segunda razon social del MISMO comprador: su celular tambien esta aqui.
const OREA_EVENTOS = {
  customer_id: '780', CustName: 'OREA EVENTOS SA DE CV', cust_ref: 'Orea Eventos',
  tax_id: 'OEV220101QX3', country: 'Mexico',
  contacts: [{ name: 'Jorge Orea', phone: '+52 55 1234 5678', phone2: '', fax: '', email: '' }],
  branches: [{ branch_code: '781', br_name: 'MATRIZ', phone: '' }],
};
// La linea compartida de un restaurante: dos personas con el mismo numero
// (el de Laura) y ademas el de Mario.
const RESTAURANTE = {
  customer_id: '233', CustName: 'HOTELERA DEL SUR SA DE CV', cust_ref: 'Hotelera del Sur',
  tax_id: 'HSU950101AB1', country: 'Mexico',
  contacts: [
    { name: 'Laura', phone: '+52 55 1234 5678', phone2: '', fax: '', email: '' },
    { name: 'Mario', phone: '+52 55 9999 8888', phone2: '', fax: '', email: '' },
  ],
  branches: [{ branch_code: '300', br_name: 'MATRIZ', phone: '' }],
};
// Cliente Operam del historico: alta a mano, ningun Contacto conocido.
const SOLITARIO = {
  customer_id: '910', CustName: 'ABARROTES ZAPATA SA DE CV', cust_ref: 'Abarrotes Zapata',
  tax_id: 'AZA900101QX3', country: 'Mexico',
  contacts: [], branches: [{ branch_code: '911', br_name: 'MATRIZ', phone: '+52 33 1111 2222' }],
};

const LAURA = {
  id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Tester', celular: '+52 55 1234 5678',
  nombre: 'Laura Mendez', ciudad: 'Puebla', canal: 'WhatsApp', etapa: 'seguimiento',
  eventos: [{ tipo: 'cotizacion', cotizacion_id: 50, fecha: '2026-06-02T00:00:00Z', vendedor: 'Tester' }],
  data: {},
};
const MARIO = {
  id: 2, fecha: '2026-06-01T00:00:00Z', vendedor: 'Tester', celular: '+52 55 9999 8888',
  nombre: 'Mario Solis', ciudad: 'CDMX', canal: 'Referido', etapa: 'por_cotizar',
  eventos: [], data: {},
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
  .get('/api/contactos/buscar?q=' + encodeURIComponent(q))
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
  writeJson(PROSPECTOS_PATH, [LAURA, MARIO]);
  writeJson(COTS_PATH, [COT_LAURA]);
  globalThis.fetch = fetchBloqueado;
  resetIndice();
  resetActividad();
  resetSession();
});

// AC1: el celular ligado a dos Clientes Operam. Jorge Orea factura con dos
// razones sociales y el comprador es el mismo Contacto.
test('#346: el Contacto sale UNA vez con sus dos Clientes Operam anidados', async () => {
  mockOperam({ padron: [JORGE, OREA_EVENTOS], pedidos: [] });
  const res = await buscar('Orea');
  assert.equal(res.status, 200);
  const contactos = res.body.filter(f => f.tipo === 'contacto');
  assert.equal(contactos.length, 1, 'la persona aparece una sola vez');
  assert.deepEqual(contactos[0].clientesOperam.map(c => String(c.id)).sort(), ['514', '780']);
  assert.equal(res.body.filter(f => f.tipo === 'operam').length, 0, 'ninguno queda como fila suelta');
});

// AC2, primera mitad.
test('#346: el Cliente Operam del que no conocemos a nadie es su propia fila', async () => {
  mockOperam({ padron: [SOLITARIO], pedidos: [] });
  const res = await buscar('Abarrotes');
  const sueltos = res.body.filter(f => f.tipo === 'operam');
  assert.deepEqual(sueltos.map(f => String(f.id)), ['910']);
  assert.equal(res.body.filter(f => f.tipo === 'contacto').length, 0);
});

// AC2, segunda mitad: la linea compartida del restaurante es de dos personas.
test('#346: el Cliente Operam con dos Contactos aparece bajo los dos y no suelto', async () => {
  mockOperam({ padron: [RESTAURANTE], pedidos: [] });
  const res = await buscar('Hotelera');
  const contactos = res.body.filter(f => f.tipo === 'contacto');
  assert.deepEqual(contactos.map(f => f.nombre).sort(), ['Laura Mendez', 'Mario Solis']);
  for (const c of contactos) assert.deepEqual(c.clientesOperam.map(x => String(x.id)), ['233']);
  assert.equal(res.body.filter(f => f.tipo === 'operam').length, 0);
});

// La fila del Contacto es la que alimenta su ficha: etiquetas, Oportunidades
// con folio y etapa, y los estados de cada Cliente Operam.
test('#346: la fila del Contacto trae etiquetas, Oportunidades y los estados de sus Clientes Operam', async () => {
  mockOperam({ padron: [JORGE], pedidos: [{ order_no: '7269', debtor_no: '514', trans_no_from: '1240' }] });
  const res = await buscar('Laura');
  const fila = res.body.find(f => f.tipo === 'contacto');
  assert.equal(fila.celular, '+52 55 1234 5678');
  assert.equal(fila.origen, 'WhatsApp');
  assert.deepEqual(fila.etiquetas, ['prospecto', 'cotizado', 'con_pedido']);
  const cliente = fila.clientesOperam.find(c => String(c.id) === '514');
  assert.equal(cliente.fiscal, 'sin_datos_fiscales');
  assert.equal(cliente.comercial, 'con_pedido');
  assert.equal(cliente.name, 'JORGE OREA');
  const op = fila.oportunidades.find(o => o.folioOperam === 1240);
  assert.equal(op.etapa, 'seguimiento');
});

test('#346: un query de menos de dos caracteres no consulta nada', async () => {
  const res = await buscar('a');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});

// La segunda razon social que #345 AGREGO a la lista (`data.clientes_operam`)
// tiene que verse en la fila del Contacto aunque el texto no la nombre: es la
// unica forma de que el vendedor sepa a quien mas le puede cotizar.
test('#346: la fila anida tambien el Cliente Operam que solo esta en la lista de ligas', async () => {
  writeJson(PROSPECTOS_PATH, [
    { ...LAURA, data: { clientes_operam: [{ cliente_id: 233, fuente: 'cotizador' }] } },
    MARIO,
  ]);
  mockOperam({ padron: [JORGE, RESTAURANTE], pedidos: [] });
  const res = await buscar('Laura');
  const fila = res.body.find(f => f.tipo === 'contacto' && f.nombre === 'Laura Mendez');
  assert.deepEqual(fila.clientesOperam.map(c => String(c.id)).sort(), ['233', '514']);
});
