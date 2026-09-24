// #416: el barrido de domicilios con almacen mal configurado, en el panel /admin.
// La regla vive en el nucleo puro (test/almacen-domicilios.test.js); aqui se
// prueba la costura: el barrido lee Operam (padron, detalle de cada domicilio,
// catalogo de ubicaciones), el GET sirve el ultimo barrido sin volver a leer, y
// la lista "asi va bien" se administra desde el panel y se guarda en la
// configuracion del panel (config-store, #276).
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
const CONFIG_PATH = join(__dirname, '..', 'data', 'config.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}
// Aqui se escribe via el store de configuracion: con pool real el guardado le
// pegaria a Neon (mismo motivo que test/config-store.test.js).
delete process.env.DATABASE_URL;

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const configStore = await import('../lib/config-store.js');
const barridoIo = await import('../lib/almacen-domicilios-io.js');
const { resetSession } = await import('../lib/operam-client.js');
const { app } = await import('../server.js');

const ADMIN = `Bearer ${jwt.sign({ id: 1, name: 'Jefa Test', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' })}`;
const VENDEDOR = `Bearer ${jwt.sign({ id: 7, name: 'Memo', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' })}`;
const OPERAM = String(process.env.OPERAM_URL || '').replace(/\/+$/, '');

const CONFIG_INICIAL = { tiposActivos: ['PL'], texturasActivas: [1] };

const originalFetch = globalThis.fetch;
function jsonResponse(data, status = 200) {
  return { ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) };
}

// El padron tal como lo lee el barrido. El caso real del ticket (Pestalozzi del
// Cliente Operam 15 en Almacen MP), la excepcion sembrada (Cliente Operam 8,
// domicilio 8 en PT2) y el Bazaar Sabado del Cliente Operam 14, que sigue
// pendiente de decidir y por eso SI sale. El loc_code de Bazaar es ilustrativo.
const CLIENTES = [
  { customer_id: '15', CustName: 'CLIENTE DE PRUEBA', branches: [{ branch_code: '20', br_name: 'Pestalozzi' }, { branch_code: '21', br_name: 'Matriz' }] },
  { customer_id: '8', CustName: 'CLIENTE OCHO', branches: [{ branch_code: '8', br_name: 'Lagunilla' }] },
  { customer_id: '14', CustName: 'PUBLICO EN GENERAL', branches: [{ branch_code: '90', br_name: 'Bazaar Sabado' }] },
];
const ALMACEN_DE = { 20: '10', 21: '40', 8: '41', 90: '60' };
const LOCATIONS = [
  { loc_code: '10', location_name: 'Almacen MP' },
  { loc_code: '40', location_name: 'Almacen PT' },
  { loc_code: '41', location_name: 'PT2' },
  { loc_code: '60', location_name: 'Bazaar' },
];

function mockOperam({ branchFalla = null, detener = null } = {}) {
  const lecturas = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    lecturas.push(u);
    if (detener && u.endsWith('/api/v3/sales/branches/' + detener.codigo)) await detener.hasta;
    if (u.includes('/api/v3/login')) return jsonResponse({ token: 'tok', result: true });
    if (u.includes('/api/v3/sales/customers?')) return jsonResponse({ total: CLIENTES.length, data: CLIENTES });
    if (u.includes('/api/v3/sales/branches/')) {
      const codigo = u.split('/api/v3/sales/branches/')[1];
      if (codigo === branchFalla) return jsonResponse({ message: 'error interno' }, 500);
      const cliente = CLIENTES.find(c => c.branches.some(b => b.branch_code === codigo));
      const listado = cliente.branches.find(b => b.branch_code === codigo);
      return jsonResponse({ data: [{ branch_code: codigo, br_name: listado.br_name, debtor_no: cliente.customer_id, default_location: ALMACEN_DE[codigo] }] });
    }
    if (u.includes('/api/v3/inventory/locations')) return jsonResponse({ data: LOCATIONS });
    throw new Error('Unmocked fetch: ' + u);
  };
  return lecturas;
}

// #438: el POST solo ARRANCA el barrido; el reporte se lee con el GET cuando termina.
async function barrerYEsperar() {
  const res = await supertest(app).post('/api/admin/almacen-domicilios/barrer').set('Authorization', ADMIN);
  assert.equal(res.status, 202, JSON.stringify(res.body));
  await barridoIo._esperarBarrido();
  return supertest(app).get('/api/admin/almacen-domicilios').set('Authorization', ADMIN);
}

function sinOperam() {
  globalThis.fetch = async (url) => { throw new Error('No deberia leer Operam: ' + url); };
}

function configGuardada() {
  return JSON.parse(leerArchivoSync(CONFIG_PATH));
}

let restaurarDatos;
before(() => { restaurarDatos = fotoDatos([CONFIG_PATH]); });
after(() => {
  restaurarDatos();
  configStore._reiniciar();
  barridoIo._reiniciar();
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  fijarDatos(CONFIG_PATH, CONFIG_INICIAL);
  configStore._reiniciar();
  barridoIo._reiniciar();
  // Sin ritmo en las pruebas de la costura HTTP: el intervalo se mide con reloj
  // falso en test/almacen-domicilios-io.test.js.
  barridoIo._setRitmo({ intervaloMs: 0 });
  globalThis.fetch = originalFetch;
});

test('las rutas del barrido exigen admin: vendedor 403, sin token 401', async () => {
  for (const [metodo, ruta] of [
    ['get', '/api/admin/almacen-domicilios'],
    ['post', '/api/admin/almacen-domicilios/barrer'],
    ['post', '/api/admin/almacen-domicilios/asi-va-bien'],
    ['delete', '/api/admin/almacen-domicilios/asi-va-bien/8'],
  ]) {
    const vendedor = await supertest(app)[metodo](ruta).set('Authorization', VENDEDOR);
    assert.equal(vendedor.status, 403, `${metodo} ${ruta}`);
    const sinToken = await supertest(app)[metodo](ruta);
    assert.equal(sinToken.status, 401, `${metodo} ${ruta}`);
  }
});

test('sin barrido todavia: nada que reportar, sin leer Operam, y la excepcion sembrada ya esta', async () => {
  sinOperam();
  const res = await supertest(app).get('/api/admin/almacen-domicilios').set('Authorization', ADMIN);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.barrido, null);
  assert.equal(res.body.avance, null);
  assert.equal(res.body.esperado, '40');
  assert.deepEqual(res.body.filas, []);
  assert.deepEqual(res.body.asiVaBien.map(e => [e.clienteId, e.branchCode, e.almacen]), [['8', '8', '41']]);
});

test('el barrido lee el padron y reporta los domicilios fuera de PT, sin la excepcion sembrada', async () => {
  mockOperam();
  const res = await barrerYEsperar();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.filas, [
    {
      clienteId: '15', cliente: 'CLIENTE DE PRUEBA', branchCode: '20', domicilio: 'Pestalozzi',
      almacen: '10', almacenNombre: 'Almacen MP', url: `${OPERAM}/sales/manage/customers.php?debtor_no=15`,
    },
    {
      clienteId: '14', cliente: 'PUBLICO EN GENERAL', branchCode: '90', domicilio: 'Bazaar Sabado',
      almacen: '60', almacenNombre: 'Bazaar', url: `${OPERAM}/sales/manage/customers.php?debtor_no=14`,
    },
  ]);
  assert.deepEqual(res.body.asiVaBien.map(e => [e.clienteId, e.domicilio, e.almacenNombre]), [['8', 'Lagunilla', 'PT2']]);
  assert.deepEqual(res.body.sinLeer, []);
  assert.equal(res.body.esperadoNombre, 'Almacen PT');
  assert.equal(res.body.revisados, 4);
  assert.equal(res.body.barrido.clientes, 3);
  assert.ok(!Number.isNaN(Date.parse(res.body.barrido.fecha)));
  assert.equal(res.body.avance.estado, 'terminado');
  assert.equal(res.body.avance.revisados, 4);

  // El GET sirve el ultimo barrido sin volver a leer Operam.
  sinOperam();
  const otra = await supertest(app).get('/api/admin/almacen-domicilios').set('Authorization', ADMIN);
  assert.equal(otra.status, 200);
  assert.deepEqual(otra.body.filas.map(f => f.branchCode), ['20', '90']);
});

test('el domicilio que Operam no entrego sale en sinLeer con el detalle, no desaparece', async () => {
  mockOperam({ branchFalla: '21' });
  const res = await barrerYEsperar();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.sinLeer.map(s => [s.clienteId, s.branchCode, s.motivo]), [
    ['15', '21', 'No se pudo leer de que almacen entrega este domicilio'],
  ]);
  assert.match(res.body.sinLeer[0].detalle, /Operam 500/);
  assert.deepEqual(res.body.filas.map(f => f.branchCode), ['20', '90']);
});

test('Operam no disponible: el avance del barrido dice que no se pudo leer el padron', async (t) => {
  t.mock.method(console, 'error', () => {});
  resetSession();
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/v3/login')) throw new Error('timeout');
    throw new Error('Unmocked fetch: ' + url);
  };
  const res = await barrerYEsperar();
  assert.equal(res.status, 200);
  assert.equal(res.body.avance.estado, 'fallo');
  assert.match(res.body.avance.error, /No se pudo leer el padron de Operam: timeout/);
  assert.equal(res.body.barrido, null);
});

// #438: en produccion el POST se quedaba 6 y 21 minutos sin responder. Ahora
// arranca el barrido y responde de inmediato; el panel consulta el avance.
test('el POST arranca el barrido y responde en menos de 2 s con estado en curso; el GET da el avance y al final el reporte', async () => {
  let soltar;
  const hasta = new Promise(res => { soltar = res; });
  const lecturas = mockOperam({ detener: { codigo: '21', hasta } });

  const antes = Date.now();
  const res = await supertest(app).post('/api/admin/almacen-domicilios/barrer').set('Authorization', ADMIN);
  assert.ok(Date.now() - antes < 2000, `el POST tardo ${Date.now() - antes} ms`);
  assert.equal(res.status, 202, JSON.stringify(res.body));
  assert.equal(res.body.avance.estado, 'en curso');
  assert.equal(res.body.barrido, null);

  while (!lecturas.some(u => u.endsWith('/branches/21'))) await new Promise(r => setImmediate(r));
  const enCurso = await supertest(app).get('/api/admin/almacen-domicilios').set('Authorization', ADMIN);
  assert.equal(enCurso.status, 200);
  assert.equal(enCurso.body.avance.estado, 'en curso');
  assert.equal(enCurso.body.avance.total, 4);
  assert.equal(enCurso.body.avance.revisados, 1);

  // Un segundo clic mientras corre no lanza otro barrido.
  const otro = await supertest(app).post('/api/admin/almacen-domicilios/barrer').set('Authorization', ADMIN);
  assert.equal(otro.status, 202);
  assert.equal(otro.body.avance.estado, 'en curso');

  soltar();
  await barridoIo._esperarBarrido();
  const fin = await supertest(app).get('/api/admin/almacen-domicilios').set('Authorization', ADMIN);
  assert.equal(fin.body.avance.estado, 'terminado');
  assert.equal(fin.body.avance.revisados, 4);
  assert.deepEqual(fin.body.filas.map(f => f.branchCode), ['20', '90']);
  assert.equal(lecturas.filter(u => u.includes('/api/v3/sales/customers?')).length, 1, 'el padron se leyo una sola vez');
});

test('marcar "asi va bien" desde el panel lo saca del reporte y queda guardado en la configuracion', async () => {
  mockOperam();
  await barrerYEsperar();
  sinOperam();

  const res = await supertest(app).post('/api/admin/almacen-domicilios/asi-va-bien')
    .set('Authorization', ADMIN).send({ clienteId: '14', branchCode: '90', almacen: '60' });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.filas.map(f => f.branchCode), ['20']);
  assert.deepEqual(res.body.asiVaBien.map(e => [e.clienteId, e.branchCode, e.almacen]), [['8', '8', '41'], ['14', '90', '60']]);

  const guardada = configGuardada();
  assert.deepEqual(guardada.excepcionesAlmacen, [
    { clienteId: '8', branchCode: '8', almacen: '41' },
    { clienteId: '14', branchCode: '90', almacen: '60' },
  ]);
  assert.deepEqual(guardada.tiposActivos, ['PL'], 'el resto de la configuracion se conserva');

  // Guardar el catalogo cotizable desde el panel no borra la lista.
  const config = await supertest(app).post('/api/admin/config')
    .set('Authorization', ADMIN).send({ tiposActivos: ['VT'], texturasActivas: [7] });
  assert.equal(config.status, 200);
  assert.equal(configGuardada().excepcionesAlmacen.length, 2);
});

test('desmarcar desde el panel lo devuelve al reporte; desmarcar la sembrada tambien se guarda', async () => {
  mockOperam();
  await barrerYEsperar();
  sinOperam();

  const res = await supertest(app).delete('/api/admin/almacen-domicilios/asi-va-bien/8').set('Authorization', ADMIN);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.filas.map(f => f.branchCode), ['20', '8', '90']);
  assert.deepEqual(res.body.asiVaBien, []);
  assert.deepEqual(configGuardada().excepcionesAlmacen, []);

  configStore._reiniciar();
  const otra = await supertest(app).get('/api/admin/almacen-domicilios').set('Authorization', ADMIN);
  assert.deepEqual(otra.body.asiVaBien, [], 'la semilla no regresa: la lista guardada manda');
});

test('marcar sin domicilio o sin almacen responde 400 y no guarda nada', async () => {
  const res = await supertest(app).post('/api/admin/almacen-domicilios/asi-va-bien')
    .set('Authorization', ADMIN).send({ clienteId: '14', almacen: '60' });

  assert.equal(res.status, 400);
  assert.equal(configGuardada().excepcionesAlmacen, undefined);
});
