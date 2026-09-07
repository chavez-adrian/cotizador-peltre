// Endpoint unico de Oportunidades (#340, spec #337, ADR-0016): el tablero deja
// de fusionar dos respuestas en el navegador y pide UNA sola lista de tarjetas.
// Toda tarjeta es una Oportunidad (CONTEXT.md "Oportunidad"): el prospecto cuya
// Oportunidad ya es una cotizacion no genera tarjeta propia -- por eso Jorge
// Orea aparecia dos veces.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync, borrarArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROSPECTOS_PATH = join(__dirname, '..', 'data', 'prospectos.json');
const COTS_PATH = join(__dirname, '..', 'data', 'cotizaciones.json');
const VENDEDORES_PATH = join(__dirname, '..', 'data', 'vendedores.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');
const ADMIN_TOKEN = jwt.sign({ id: 99, name: 'Tester', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
const MEMO_TOKEN = jwt.sign({ id: 7, name: 'Memo', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });
const GERENTE_TOKEN = jwt.sign({ id: 2, name: 'Alejandro Chávez', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });

function readJson(p) { return existsSync(p) ? JSON.parse(leerArchivoSync(p)) : []; }
function writeJson(p, data) { escribirArchivoSync(p, JSON.stringify(data, null, 2)); }
const hace = (dias) => new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

// Laura: capturada y todavia sin cotizar. Su Oportunidad es la tarjeta de Por
// Cotizar.
const LAURA = {
  id: 1, fecha: hace(2), vendedor: 'Memo', celular: '+52 55 1234 5678',
  nombre: 'Laura', ciudad: 'Puebla', canal: 'Instagram', etapa: 'por_cotizar',
  eventos: [], data: {},
};
// Jorge Orea: su Oportunidad YA es la cotizacion 10. No debe tener tarjeta
// propia (el caso que motiva el ticket).
const JORGE = {
  id: 2, fecha: hace(9), vendedor: 'Memo', celular: '+52 5555550001',
  nombre: 'Jorge Orea', ciudad: 'CDMX', canal: 'Feria/Expo', etapa: 'seguimiento',
  eventos: [{ tipo: 'cotizacion', cotizacion_id: 10, fecha: hace(8), vendedor: 'Memo' }],
  data: {},
};
// Lead sin dueno: solo lo ve el admin y quien tiene el permiso de asignacion.
const SIN_DUENO = {
  id: 3, fecha: hace(1), vendedor: null, celular: '+52 5511112222',
  nombre: 'Mayoreo Web', ciudad: 'Toluca', canal: 'Formulario web',
  etapa: 'no_asignado', eventos: [], data: {},
};
// Prospecto de otra vendedora que se quedo en Por Cotizar aunque su cotizacion
// ya avanzo: la tarjeta inerte que el ticket viene a quitar. Aqui la liga no es
// por evento sino por el celular del cliente de la cotizacion.
const PEDRO = {
  id: 4, fecha: hace(3), vendedor: 'Ana', celular: '+52 5599999999',
  nombre: 'Pedro', ciudad: 'CDMX', canal: 'Instagram', etapa: 'por_cotizar',
  eventos: [], data: {},
};

const COT_JORGE = {
  id: 10, fecha: hace(8), vendedor: 'Memo', cliente: 'JORGE OREA', etapa: 'seguimiento',
  totalPiezas: 200, total: 15000, tier: 'M100', folioOperam: 1240,
  data: { cliente: { razonSocial: 'JORGE OREA', telefono: '+52 5555550001', customerId: 514 }, items: [] },
};
const COT_ANA = {
  id: 11, fecha: hace(3), vendedor: 'Ana', cliente: 'PEDRO SA', etapa: 'seguimiento',
  totalPiezas: 50, total: 4000, tier: 'M100', folioOperam: null,
  data: { cliente: { razonSocial: 'PEDRO SA', telefono: '+52 5599999999', customerId: 520 }, items: [] },
};

// Cotizacion sin Contacto conocido: no hay Origen que heredar.
const COT_HUERFANA = {
  id: 12, fecha: hace(4), vendedor: 'Memo', cliente: 'CLIENTE HISTORICO', etapa: 'seguimiento',
  totalPiezas: 50, total: 4000, tier: 'M100', folioOperam: 1200,
  data: { cliente: { razonSocial: 'CLIENTE HISTORICO', telefono: '+52 5544443333' }, items: [] },
};

// Cotizacion de Memo sobre el celular del prospecto de Ana: Memo no ve ese
// Contacto, asi que no puede heredar su Origen.
const COT_CRUZADA = {
  id: 13, fecha: hace(5), vendedor: 'Memo', cliente: 'PEDRO OTRA RAZON', etapa: 'seguimiento',
  totalPiezas: 30, total: 2500, tier: 'M100', folioOperam: 1210,
  data: { cliente: { razonSocial: 'PEDRO OTRA RAZON', telefono: '+52 5599999999' }, items: [] },
};

function fixtures() {
  writeJson(PROSPECTOS_PATH, [LAURA, JORGE, SIN_DUENO, PEDRO]);
  writeJson(COTS_PATH, [COT_JORGE, COT_ANA, COT_HUERFANA, COT_CRUZADA]);
}

async function conPermisoDeAsignacion(idVendedor, fn) {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    const registro = JSON.parse(original);
    registro.find(v => v.id === idVendedor).puedeAsignar = true;
    escribirArchivoSync(VENDEDORES_PATH, JSON.stringify(registro, null, 2));
    await fn();
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
}

const pedir = (token) => supertest(app).get('/api/oportunidades').set('Authorization', `Bearer ${token}`);

// Desde #344 la ruta consulta el padron de Operam y la barrida de pedidos para
// derivar los estados del Cliente Operam: ningun test pega a Operam real --
// fetch bloqueado por defecto, y el que necesita Operam instala sus handlers.
const { resetIndice } = await import('../lib/indice-telefonos.js');
const { resetActividad } = await import('../lib/actividad-operam.js');
const { resetSession } = await import('../lib/operam-client.js');

const originalFetch = globalThis.fetch;
const fetchBloqueado = async (url) => { throw new Error('fetch sin mock en tests: ' + url); };

function mockFetchByUrl(handlers) {
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    for (const [pat, fn] of Object.entries(handlers)) {
      if (u.includes(pat)) return fn(u, opts);
    }
    throw new Error('Unmocked fetch: ' + u);
  };
}
const jsonResponse = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });

function mockOperam({ clientes = [], pedidos = [] } = {}) {
  mockFetchByUrl({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/sales_orders': (u) => jsonResponse({ data: /skip=0/.test(u) ? pedidos : [] }),
    '/api/v3/sales/customers': () => jsonResponse({ total: clientes.length, data: clientes }),
  });
}

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
  fixtures();
  globalThis.fetch = fetchBloqueado;
  resetIndice();
  resetActividad();
  resetSession();
});

test('#340: sin token responde 401', async () => {
  const res = await supertest(app).get('/api/oportunidades');
  assert.equal(res.status, 401);
});

test('#340: una tarjeta por Oportunidad -- el prospecto cuya Oportunidad ya es cotizacion no tiene tarjeta propia', async () => {
  const res = await pedir(ADMIN_TOKEN);
  assert.equal(res.status, 200);
  const ids = res.body.map(o => o.id).sort();
  assert.deepEqual(ids, ['c10', 'c11', 'c12', 'c13', 'p1', 'p3']);
  assert.equal(res.body.some(o => o.id === 'p2'), false, 'Jorge Orea no puede tener dos tarjetas');
});

test('#340: la tarjeta inerte en Por Cotizar de un prospecto ya cotizado tampoco sale', async () => {
  const res = await pedir(ADMIN_TOKEN);
  assert.equal(res.body.some(o => o.id === 'p4'), false);
  // La Oportunidad sigue en el tablero: es la cotizacion, con su etapa.
  const cot = res.body.find(o => o.id === 'c11');
  assert.equal(cot.tipo, 'cotizacion');
  assert.equal(cot.etapa, 'seguimiento');
});

// AC2: la visibilidad es la misma de hoy (CONTEXT.md "Visibilidad"), por las
// mismas puertas que /api/prospectos y /api/cotizaciones.
test('#340: el vendedor ve lo suyo y nada mas', async () => {
  const res = await pedir(MEMO_TOKEN);
  assert.equal(res.status, 200);
  const ids = res.body.map(o => o.id).sort();
  assert.deepEqual(ids, ['c10', 'c12', 'c13', 'p1']);
});

test('#340: el vendedor sin permiso de asignacion no recibe tarjetas No Asignado', async () => {
  const res = await pedir(GERENTE_TOKEN);
  assert.deepEqual(res.body.map(o => o.id), []);
});

test('#340: el vendedor con permiso de asignacion recibe ademas las No Asignado', async () => {
  await conPermisoDeAsignacion(2, async () => {
    const res = await pedir(GERENTE_TOKEN);
    assert.deepEqual(res.body.map(o => o.id), ['p3']);
    assert.equal(res.body[0].etapa, 'no_asignado');
  });
});

test('#340: cada tarjeta viaja con la forma que el tablero pinta', async () => {
  const res = await pedir(ADMIN_TOKEN);
  const prospecto = res.body.find(o => o.id === 'p1');
  assert.equal(prospecto.tipo, 'prospecto');
  assert.equal(prospecto.refId, 1);
  assert.equal(prospecto.nombre, 'Laura');
  assert.equal(prospecto.etapa, 'por_cotizar');
  assert.equal(prospecto.vendedor, 'Memo');
  assert.equal(prospecto.ciudad, 'Puebla');
  const cot = res.body.find(o => o.id === 'c10');
  assert.equal(cot.refId, 10);
  assert.equal(cot.nombre, 'JORGE OREA');
  assert.equal(cot.folioOperam, 1240);
  assert.equal(cot.total, 15000);
  assert.equal(cot.totalPiezas, 200);
});

// AC5: el chip de Origen se muestra en TODA tarjeta, heredado del Contacto
// (CONTEXT.md "Origen"): la Oportunidad no tiene origen propio.
test('#340: toda tarjeta trae su Origen, el propio del prospecto o el heredado del Contacto', async () => {
  const res = await pedir(ADMIN_TOKEN);
  const porId = Object.fromEntries(res.body.map(o => [o.id, o.origen]));
  assert.equal(porId['p1'], 'Instagram');
  assert.equal(porId['p3'], 'Formulario web');
  // La cotizacion de Jorge Orea hereda el Origen de su Contacto, que ya no
  // tiene tarjeta propia.
  assert.equal(porId['c10'], 'Feria/Expo');
  // Sin Contacto conocido el chip dice "Origen sin identificar": campo vacio.
  assert.equal(porId['c12'], '');
  assert.equal(res.body.every(o => typeof o.origen === 'string'), true);
});

// La herencia usa el indice de los prospectos VISIBLES, la misma puerta que el
// Historial y la cola Hoy: un vendedor no hereda de un Contacto que no ve. La
// cotizacion 13 es de Memo pero su celular es el del prospecto de Ana.
test('#340: no se hereda el Origen de un prospecto que el vendedor no ve', async () => {
  const res = await pedir(MEMO_TOKEN);
  assert.equal(res.body.find(o => o.id === 'c13').origen, '');
  const admin = await pedir(ADMIN_TOKEN);
  assert.equal(admin.body.find(o => o.id === 'c13').origen, 'Instagram');
});

// La supresion la disparan las cotizaciones VIVAS: una salida (Perdida o No
// util) ya no es la Oportunidad que reemplaza a la tarjeta del prospecto, y sin
// esta regla el prospecto activo desapareceria del tablero entero.
test('#340: una cotizacion Perdida no calla la tarjeta del prospecto que sigue activo', async () => {
  writeJson(PROSPECTOS_PATH, [LAURA]);
  writeJson(COTS_PATH, [{ ...COT_JORGE, id: 20, etapa: 'perdida', cliente: 'LAURA MENDEZ',
    data: { cliente: { razonSocial: 'LAURA MENDEZ', telefono: '+52 5512345678' }, items: [] } }]);
  const res = await pedir(ADMIN_TOKEN);
  const ids = res.body.map(o => o.id).sort();
  assert.deepEqual(ids, ['c20', 'p1']);
  assert.equal(res.body.find(o => o.id === 'p1').etapa, 'por_cotizar');
});

// === #344: los dos estados del Cliente Operam y las etiquetas del Contacto ===
// Se DERIVAN en el servidor desde lo que Operam registra (ADR-0016) y viajan en
// cada tarjeta. Ninguno se captura, y lo que no se puede saber no se inventa.

const PADRON = [
  // Jorge Orea: RFC generico (Sin datos fiscales) y con pedido en Operam.
  { customer_id: 514, CustName: 'JORGE OREA', cust_ref: 'JORGE', tax_id: 'XAXX010101000', contacts: [], branches: [] },
  // Pedro SA: RFC real y ningun movimiento registrado.
  { customer_id: 520, CustName: 'PEDRO SA DE CV', cust_ref: 'PEDRO', tax_id: 'PSA950101AB1', contacts: [], branches: [] },
];

const PEDIDO_DE_JORGE = { order_no: 7269, debtor_no: '514', trans_no_from: '1240' };

test('#344: la tarjeta trae el estado fiscal y el comercial de su Cliente Operam', async () => {
  mockOperam({ clientes: PADRON, pedidos: [PEDIDO_DE_JORGE] });
  const res = await pedir(ADMIN_TOKEN);
  assert.equal(res.status, 200);
  const jorge = res.body.find(o => o.id === 'c10');
  assert.deepEqual(jorge.clienteOperam, {
    id: 514, fiscal: 'sin_datos_fiscales', comercial: 'con_pedido', fuenteIncompleta: false,
  });
});

test('#344: un Cliente Operam sin movimientos declara la fuente incompleta en vez de adivinar', async () => {
  mockOperam({ clientes: PADRON, pedidos: [] });
  const res = await pedir(ADMIN_TOKEN);
  const pedro = res.body.find(o => o.id === 'c11');
  assert.deepEqual(pedro.clienteOperam, {
    id: 520, fiscal: 'con_datos_fiscales', comercial: 'sin_actividad', fuenteIncompleta: true,
  });
});

test('#344: las etiquetas del Contacto viajan en su tarjeta', async () => {
  mockOperam({ clientes: PADRON, pedidos: [PEDIDO_DE_JORGE] });
  const res = await pedir(ADMIN_TOKEN);
  // Jorge Orea fue capturado, cotizo con folio y su Cliente Operam tiene pedido.
  assert.deepEqual(res.body.find(o => o.id === 'c10').etiquetas, ['prospecto', 'cotizado', 'con_pedido']);
  // Laura fue capturada y nada mas.
  assert.deepEqual(res.body.find(o => o.id === 'p1').etiquetas, ['prospecto']);
});

// El Contacto ES el celular (ADR-0016): un numero del que no hay ficha sigue
// siendo un Contacto y sus etiquetas se derivan igual -- lo que NO puede tener
// es la de prospecto, porque nadie lo capturo. Y sin Cliente Operam anotado la
// tarjeta no inventa ninguno.
test('#344: el Contacto sin ficha se etiqueta por su historia, nunca como prospecto', async () => {
  mockOperam({ clientes: PADRON, pedidos: [] });
  const res = await pedir(ADMIN_TOKEN);
  const huerfana = res.body.find(o => o.id === 'c12');
  assert.deepEqual(huerfana.etiquetas, ['cotizado']);
  assert.equal(huerfana.clienteOperam, null);
});

// Best effort, igual que el indice de telefonos: sin Operam la tarjeta sale sin
// Cliente Operam, jamas con una etiqueta que no se pudo verificar.
test('#344: con Operam caido la tarjeta viaja sin Cliente Operam, no con uno inventado', async () => {
  const res = await pedir(ADMIN_TOKEN);
  assert.equal(res.status, 200);
  assert.equal(res.body.find(o => o.id === 'c10').clienteOperam, null);
  assert.deepEqual(res.body.find(o => o.id === 'c10').etiquetas, ['prospecto', 'cotizado']);
});
