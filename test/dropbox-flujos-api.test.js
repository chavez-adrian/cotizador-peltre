// #356 (hijo de #354): cada uno de los flujos que suben a Dropbox tiene que
// dejar rastro -- exito y fallo -- sin cambiar en nada su contrato
// fire-and-forget. Aqui se miden los dos que entran por HTTP (la constancia
// fiscal por los dos caminos del alta y los archivos de posicion de calca) y la
// superficie de /admin que los muestra. El tercero (el backup del export de
// Bitrix) no pasa por Express y vive en test/dropbox-observabilidad.test.js.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync, borrarArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COTS_PATH = join(__dirname, '..', 'data', 'cotizaciones.json');
const SUBIDAS_PATH = join(__dirname, '..', 'data', 'dropbox-subidas.json');

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
const store = await import('../lib/dropbox-subidas-store.js');
// Las llaves de flujo viven en lib/dropbox-destinos.js desde #357 (son las
// mismas que deciden el destino); aqui solo se afirman como texto.
const FLUJO_CSF = 'csf';
const FLUJO_CALCA = 'calca';

const ADMIN = jwt.sign({ id: 99, name: 'Tester', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
const VENDEDOR = jwt.sign({ id: 7, name: 'Memo', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });

function readCots() {
  if (!existsSync(COTS_PATH)) return [];
  return JSON.parse(leerArchivoSync(COTS_PATH));
}
function writeCots(data) {
  escribirArchivoSync(COTS_PATH, JSON.stringify(data, null, 2));
}

const originalFetch = globalThis.fetch;
const envPrevio = {
  DROPBOX_REFRESH_TOKEN: process.env.DROPBOX_REFRESH_TOKEN,
  DROPBOX_APP_KEY: process.env.DROPBOX_APP_KEY,
  DROPBOX_APP_SECRET: process.env.DROPBOX_APP_SECRET,
};

let cotsPrevias = null;
let subidasPrevias = null;
let habiaSubidas = false;

before(() => {
  cotsPrevias = readCots();
  habiaSubidas = existsSync(SUBIDAS_PATH);
  if (habiaSubidas) subidasPrevias = leerArchivoSync(SUBIDAS_PATH);
  process.env.DROPBOX_REFRESH_TOKEN = 'refresh';
  process.env.DROPBOX_APP_KEY = 'key';
  process.env.DROPBOX_APP_SECRET = 'secret';
});

after(() => {
  globalThis.fetch = originalFetch;
  writeCots(cotsPrevias);
  for (const [k, v] of Object.entries(envPrevio)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  if (habiaSubidas) escribirArchivoSync(SUBIDAS_PATH, subidasPrevias);
  else if (existsSync(SUBIDAS_PATH)) borrarArchivoSync(SUBIDAS_PATH);
});

beforeEach(() => {
  escribirArchivoSync(SUBIDAS_PATH, '[]');
});

// La subida es fire-and-forget: la respuesta HTTP no la espera (ese es justo el
// contrato que #356 no puede cambiar), asi que el registro se sondea.
async function esperarSubidas(cuantas, ms = 3000) {
  const limite = Date.now() + ms;
  for (;;) {
    const filas = await store.listarRecientes();
    if (filas.length >= cuantas) return filas;
    if (Date.now() > limite) {
      throw new Error(`El registro de la subida nunca llego (${filas.length}/${cuantas})`);
    }
    await new Promise(r => setTimeout(r, 10));
  }
}

// expires_in 0 a proposito: lib/dropbox.js cachea el token en una variable de
// modulo que este test no puede restaurar (mismo cuidado que test/server.test.js).
const TOKEN_DROPBOX = () => ({ ok: true, json: async () => ({ access_token: 'dbx', expires_in: 0 }) });
const SUBIDA_OK = () => ({ ok: true, json: async () => ({ path_display: 'ok' }) });
const SUBIDA_409 = () => ({ ok: false, status: 409, text: async () => 'path/not_found/' });

function mockFetchByUrl(handlers) {
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    for (const [pat, fn] of Object.entries(handlers)) {
      if (u.includes(pat)) return fn(u, opts);
    }
    throw new Error('Unmocked fetch: ' + u);
  };
  return () => { globalThis.fetch = originalFetch; };
}

// === Flujo calca: PATCH /api/cotizacion/:id/calca-paso (paso 6) ===

const PASOS = ['cotizacion_proveedor', 'posicion_cliente', 'arte_final',
  'dummy_autorizado', 'liberacion_produccion', 'archivos_dropbox'];

function cotizacionDecorada() {
  return [{
    id: 1, fecha: new Date().toISOString(), vendedor: 'Memo', cliente: 'RESTAURANTE LA LUPITA',
    totalPiezas: 200, total: 15000, tier: 'M100',
    data: {
      cliente: { razonSocial: 'RESTAURANTE LA LUPITA', referencia: 'La Lupita', rfc: 'RLU200101AAA' },
      items: [], decorado: true,
      calcaChecklist: PASOS.map(clave => ({ clave, completo: false })),
    },
  }];
}

const marcarPasoArchivos = () => supertest(app).patch('/api/cotizacion/1/calca-paso')
  .set('Authorization', `Bearer ${VENDEDOR}`)
  .send({ paso: 'archivos_dropbox', completo: true, archivos: [{ nombre: 'posicion.pdf', contenidoBase64: 'aGVsbG8=' }] });

test('CAL1: la subida de la posicion de calca deja un registro de exito con flujo calca', async () => {
  writeCots(cotizacionDecorada());
  const restore = mockFetchByUrl({ 'oauth2/token': TOKEN_DROPBOX, 'files/upload': SUBIDA_OK });
  try {
    const res = await marcarPasoArchivos();
    assert.equal(res.status, 200);
    const [fila] = await esperarSubidas(1);
    assert.equal(fila.flujo, FLUJO_CALCA);
    assert.equal(fila.ok, true);
    assert.equal(fila.archivo, 'La Lupita - Pedido 1.pdf');
    assert.ok(fila.destino.includes('OT Decorado'), 'el destino pretendido queda registrado: ' + fila.destino);
  } finally {
    restore();
  }
});

test('CAL2: un fallo de Dropbox queda registrado con su error y NO impide marcar el paso', async () => {
  writeCots(cotizacionDecorada());
  const restore = mockFetchByUrl({ 'oauth2/token': TOKEN_DROPBOX, 'files/upload': SUBIDA_409 });
  try {
    const res = await marcarPasoArchivos();
    assert.equal(res.status, 200, 'el contrato fire-and-forget no cambia');
    assert.equal(readCots().find(c => c.id === 1).data.calcaChecklist.find(p => p.clave === 'archivos_dropbox').completo, true);
    const [fila] = await esperarSubidas(1);
    assert.equal(fila.flujo, FLUJO_CALCA);
    assert.equal(fila.ok, false);
    assert.match(fila.error, /Dropbox 409: path\/not_found\//);
  } finally {
    restore();
  }
});

test('CAL3: si el propio registro falla, la respuesta y el paso del checklist no cambian', async () => {
  writeCots(cotizacionDecorada());
  escribirArchivoSync(SUBIDAS_PATH, '{esto no es JSON');
  const restore = mockFetchByUrl({ 'oauth2/token': TOKEN_DROPBOX, 'files/upload': SUBIDA_409 });
  try {
    const res = await marcarPasoArchivos();
    assert.equal(res.status, 200);
    assert.equal(readCots().find(c => c.id === 1).data.calcaChecklist.find(p => p.clave === 'archivos_dropbox').completo, true);
  } finally {
    restore();
  }
});

// === Flujo constancia fiscal, camino 1: POST /api/crear-cliente (alta completa) ===

function mocksAltaClienteOk(customerId, branchId, extra = {}) {
  return {
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return { ok: true, json: async () => ({ result: true, customer_id: customerId }) };
      if (u.includes(`/${customerId}`)) return { ok: true, json: async () => ({ data: [{ sales_type: '12', branches: [{ branch_code: branchId }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    [`/api/v3/sales/branches/${branchId}`]: () => ({ ok: true, json: async () => ({ result: true }) }),
    'oauth2/token': TOKEN_DROPBOX,
    ...extra,
  };
}

const altaCompleta = (rfc, nombre) => supertest(app).post('/api/crear-cliente')
  .set('Authorization', `Bearer ${ADMIN}`)
  .send({
    tax_id: rfc, CustName: nombre, pdf_base64: Buffer.from('%PDF-1.4').toString('base64'),
    entrega: {
      br_name: 'CSF', br_ref: 'CSF', addr_street: 'Calle', addr_exterior: '1', addr_interior: '',
      addr_colony: 'Col', addr_city: 'CDMX', addr_state: 'CDMX', addr_zip: '06600',
      addr_reference: '', phone: '', email: '', pais: 'MX',
    },
    salesman: 47,
  });

test('CSF1: el respaldo de la constancia del alta completa deja un registro de exito con flujo csf', async () => {
  const restore = mockFetchByUrl(mocksAltaClienteOk(881, 1881, { 'files/upload': SUBIDA_OK }));
  try {
    const res = await altaCompleta('DBX010101AA1', 'Dropbox Observable SA');
    assert.equal(res.status, 200);
    const [fila] = await esperarSubidas(1);
    assert.equal(fila.flujo, FLUJO_CSF);
    assert.equal(fila.ok, true);
    assert.equal(fila.archivo, 'DBX010101AA1 - Dropbox Observable SA.pdf');
  } finally {
    restore();
  }
});

test('CSF2: un fallo del respaldo del alta completa queda registrado y la respuesta sigue siendo 200', async () => {
  const restore = mockFetchByUrl(mocksAltaClienteOk(882, 1882, { 'files/upload': SUBIDA_409 }));
  try {
    const res = await altaCompleta('DBX010101AA2', 'Dropbox Fallido SA');
    assert.equal(res.status, 200);
    assert.equal(res.body.customer_id, 882);
    const [fila] = await esperarSubidas(1);
    assert.equal(fila.flujo, FLUJO_CSF);
    assert.equal(fila.ok, false);
    assert.match(fila.error, /Dropbox 409/);
  } finally {
    restore();
  }
});

// === Flujo constancia fiscal, camino 2: PUT /api/actualizar-cliente-fiscal/:id ===

const GENERICO = {
  customer_id: '517', CustName: 'PUBLICO EN GENERAL', cust_ref: 'Publico',
  tax_id: 'XAXX010101000', postal_code: '', contacts: [], branches: [{ branch_code: '563' }],
};
const CSF_UPGRADE = {
  rfc: 'UPG010101AB1', razonSocial: 'Upgrade Fiscal SA', idcif: 'IDCIF1',
  calle: 'Reforma', numExt: '100', numInt: '', colonia: 'Juarez',
  cp: '06600', municipio: 'CDMX', estado: 'CDMX', regimenFiscal: '601',
};

function mocksUpgrade(respuestaUpload) {
  let padron = [GENERICO];
  return mockFetchByUrl({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') {
        padron = [{ ...GENERICO, CustName: 'UPGRADE FISCAL SA', tax_id: CSF_UPGRADE.rfc }];
        return { ok: true, json: async () => ({ version: '3', ...JSON.parse(opts.body) }) };
      }
      if (u.includes('tax_id=')) return { ok: true, json: async () => ({ total: 0, data: [] }) };
      if (/\/customers\/\d+/.test(u)) return { ok: true, json: async () => ({ data: [padron[0]] }) };
      return { ok: true, json: async () => ({ total: padron.length, data: padron }) };
    },
    'oauth2/token': TOKEN_DROPBOX,
    'files/upload': respuestaUpload,
  });
}

const upgradeFiscal = () => supertest(app).put('/api/actualizar-cliente-fiscal/517')
  .set('Authorization', `Bearer ${ADMIN}`)
  .send({ csfDatos: CSF_UPGRADE, pdf_base64: Buffer.from('%PDF-1.4').toString('base64') });

test('CSF3: el respaldo de la constancia del upgrade fiscal deja un registro de exito con flujo csf', async () => {
  const restore = mocksUpgrade(SUBIDA_OK);
  try {
    const res = await upgradeFiscal();
    assert.equal(res.status, 200);
    const [fila] = await esperarSubidas(1);
    assert.equal(fila.flujo, FLUJO_CSF);
    assert.equal(fila.ok, true);
    assert.equal(fila.archivo, 'UPG010101AB1 - Upgrade Fiscal SA.pdf');
  } finally {
    restore();
  }
});

test('CSF4: un fallo del respaldo del upgrade fiscal queda registrado y la respuesta sigue siendo 200', async () => {
  const restore = mocksUpgrade(SUBIDA_409);
  try {
    const res = await upgradeFiscal();
    assert.equal(res.status, 200);
    const [fila] = await esperarSubidas(1);
    assert.equal(fila.flujo, FLUJO_CSF);
    assert.equal(fila.ok, false);
    assert.match(fila.error, /Dropbox 409/);
  } finally {
    restore();
  }
});

// === Superficie en /admin ===

test('ADM1: GET /api/admin/dropbox-subidas lista los intentos, el fallido con su error', async () => {
  await store.registrar({ flujo: FLUJO_CSF, destino: '/CONSTANCIA/AAA010101AA1 - Uno.pdf', ok: true });
  await store.registrar({ flujo: FLUJO_CALCA, destino: '/OT Decorado/Dos - Pedido 9.pdf', ok: false, error: 'Dropbox 409: path/not_found/' });
  const res = await supertest(app).get('/api/admin/dropbox-subidas').set('Authorization', `Bearer ${ADMIN}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.subidas.length, 2);
  const [fallida, exitosa] = res.body.subidas;
  assert.equal(fallida.ok, false);
  assert.equal(fallida.flujo, FLUJO_CALCA);
  assert.equal(fallida.error, 'Dropbox 409: path/not_found/');
  assert.equal(exitosa.ok, true);
  assert.equal(exitosa.archivo, 'AAA010101AA1 - Uno.pdf');
});

test('ADM2: GET /api/admin/dropbox-subidas sin rol admin responde 403', async () => {
  const res = await supertest(app).get('/api/admin/dropbox-subidas').set('Authorization', `Bearer ${VENDEDOR}`);
  assert.equal(res.status, 403);
});
