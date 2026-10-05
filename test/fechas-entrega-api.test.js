// #531: la carga de la fecha de entrega de las cotizaciones que ya tenian pedido,
// a pedido de un admin. La regla (que se escribe y que no) vive en
// test/fecha-entrega-pedido.test.js; aqui la costura HTTP: permisos, el modo
// expreso de #510, el seco que responde el plan sin escribir y el aplicado en
// segundo plano con su resultado consultable.
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

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}
// La carga escribe via el store de cotizaciones: con pool real le pegaria a Neon.
delete process.env.DATABASE_URL;

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const syncIo = await import('../lib/sync-operam-io.js');
const { resetSession } = await import('../lib/operam-client.js');
const { enTurno, TURNO_FECHAS_ENTREGA } = await import('../lib/turno-barridos.js');
const { app } = await import('../server.js');

const ADMIN = `Bearer ${jwt.sign({ id: 1, name: 'Jefa Test', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' })}`;
const VENDEDOR = `Bearer ${jwt.sign({ id: 7, name: 'Memo', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' })}`;
const RUTA = '/api/admin/sync-operam/fechas-entrega';

const originalFetch = globalThis.fetch;
function jsonResponse(data, status = 200) {
  return { ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) };
}

// La 1251 entregada y pagada (el barrido la salta) con su pedido 7702.
const COT_1251 = { id: 61, fecha: '2026-08-10T18:00:00.000Z', vendedor: 'Memo', cliente: 'HACIENDA LOS ARCOS',
  etapa: 'producto_entregado', folioOperam: '1251',
  data: { pagoSinRegistrar: false, espejoOperam: { cotizacion: '1251', pedido: '7702', remisiones: ['2400'], pago: 'pagado' } } };
const PEDIDOS = [
  { order_no: '7702', trans_type: '30', debtor_no: '30', trans_no_from: '1251', total: '33100', ord_date: '2026-08-20', delivery_date: '2026-09-28' },
];

function operam() {
  const lecturas = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    lecturas.push(u);
    if (u.includes('/api/v3/login')) return jsonResponse({ token: 'tok', result: true });
    if (u.includes('/api/v3/sales/sales_orders')) return jsonResponse({ data: PEDIDOS });
    throw new Error('Unmocked fetch: ' + u);
  };
  return lecturas;
}

const cotizaciones = () => JSON.parse(leerArchivoSync(COTS_PATH));

let restaurarDatos;
before(() => {
  restaurarDatos = fotoDatos([COTS_PATH]);
  syncIo._setRitmo({ intervaloMs: 0 });
});
after(() => {
  restaurarDatos();
  syncIo._reiniciarRitmo();
  globalThis.fetch = originalFetch;
});
beforeEach(() => {
  fijarDatos(COTS_PATH, [COT_1251]);
  resetSession();
  globalThis.fetch = originalFetch;
});

test('solo admin: vendedor 403 y sin token 401, en el POST y en el GET', async () => {
  operam();
  assert.equal((await supertest(app).post(RUTA).set('Authorization', VENDEDOR).send({ seco: true })).status, 403);
  assert.equal((await supertest(app).post(RUTA).send({ seco: true })).status, 401);
  assert.equal((await supertest(app).get(RUTA).set('Authorization', VENDEDOR)).status, 403);
  assert.equal((await supertest(app).get(RUTA)).status, 401);
  assert.deepEqual(cotizaciones(), [COT_1251]);
});

for (const [caso, cuerpo] of [['sin cuerpo', undefined], ['seco en false', { seco: false }], ['los dos a la vez', { seco: true, aplicar: true }]]) {
  test(`${caso}: 400 sin leer Operam ni escribir`, async () => {
    const lecturas = operam();
    const peticion = supertest(app).post(RUTA).set('Authorization', ADMIN);
    const res = cuerpo === undefined ? await peticion : await peticion.send(cuerpo);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /aplicar/);
    assert.equal(lecturas.length, 0);
    assert.deepEqual(cotizaciones(), [COT_1251]);
  });
}

test('en seco responde lo que escribiria y no escribe nada', async () => {
  operam();
  const res = await supertest(app).post(RUTA).set('Authorization', ADMIN).send({ seco: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.seco, true);
  assert.deepEqual(res.body.plan, [{ id: 61, folio: '1251', etapa: 'producto_entregado', pedido: '7702', fechaAntes: null, fechaDespues: '2026-09-28', accion: 'escribir' }]);
  assert.deepEqual(cotizaciones(), [COT_1251]);
});

test('aplicada responde 202 y el GET da el resultado; solo cambia la fecha de entrega', async () => {
  operam();
  const res = await supertest(app).post(RUTA).set('Authorization', ADMIN).send({ aplicar: true });
  assert.equal(res.status, 202);
  await syncIo._esperarCargaFechasEntrega();
  const consulta = await supertest(app).get(RUTA).set('Authorization', ADMIN);
  assert.equal(consulta.body.enCurso, false);
  assert.equal(consulta.body.ultima.seco, false);
  assert.equal(consulta.body.ultima.escritas, 1);
  const esperado = structuredClone(COT_1251);
  esperado.data.espejoOperam.fechaEntrega = '2026-09-28';
  assert.deepEqual(cotizaciones(), [esperado]);
});

test('con otra carga en curso responde 409 sin leer Operam, y el GET dice enCurso', async () => {
  const lecturas = operam();
  let soltar;
  const ocupada = enTurno(TURNO_FECHAS_ENTREGA, () => new Promise(r => { soltar = r; }));
  try {
    const res = await supertest(app).post(RUTA).set('Authorization', ADMIN).send({ seco: true });
    assert.equal(res.status, 409);
    assert.equal((await supertest(app).get(RUTA).set('Authorization', ADMIN)).body.enCurso, true);
    assert.equal(lecturas.length, 0);
    assert.deepEqual(cotizaciones(), [COT_1251]);
  } finally {
    soltar();
    await ocupada;
  }
});
