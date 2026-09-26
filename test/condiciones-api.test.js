// #324: condiciones comerciales por omision y tablas de Tiempo de produccion
// administrables en /admin. La regla vive en el nucleo puro
// (public/js/__tests__/condiciones-logica.test.cjs); aqui se prueba la costura
// HTTP: el panel las administra (solo admin), viven en la configuracion del panel
// (#276, prior art lineas de transporte #447), el vendedor las recibe en
// /api/precios y una cotizacion ya generada conserva su texto.
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
const COTS_PATH = join(__dirname, '..', 'data', 'cotizaciones.json');

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
const { app } = await import('../server.js');

const ADMIN = `Bearer ${jwt.sign({ id: 1, name: 'Jefa Test', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' })}`;
const VENDEDOR = `Bearer ${jwt.sign({ id: 7, name: 'Memo', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' })}`;

const CONFIG_INICIAL = { tiposActivos: ['PL'], texturasActivas: [1] };

// El texto que el formulario traia clavado antes de #324 y el plazo de hoy.
const SEMILLA = {
  precios: 'Precios EXW Ixtapaluca, Estado de Mexico.',
  sinEnvio: 'No incluye envio.',
  flete: 'Envio a costo y riesgo del cliente.',
  anticipo: 'Se requiere 50% de anticipo para comenzar la produccion.',
  saldo: 'Pago del saldo previo a la entrega.',
  tiempoProduccion: [{ desde: 0, cantidad: 4, unidad: 'semanas' }],
  tiempoProduccionCalca: [{ desde: 0, cantidad: 6, unidad: 'semanas' }],
};

// La tabla del ejemplo del issue y la de calca con +2 semanas.
const NUEVAS = {
  ...SEMILLA,
  anticipo: 'Se requiere 30% de anticipo para comenzar la produccion.',
  tiempoProduccion: [
    { desde: 0, cantidad: 3, unidad: 'semanas' },
    { desde: 100, cantidad: 4, unidad: 'semanas' },
    { desde: 1500, cantidad: 5, unidad: 'semanas' },
    { desde: 3000, cantidad: 6, unidad: 'semanas' },
  ],
  tiempoProduccionCalca: [
    { desde: 0, cantidad: 5, unidad: 'semanas' },
    { desde: 100, cantidad: 6, unidad: 'semanas' },
    { desde: 1500, cantidad: 7, unidad: 'semanas' },
    { desde: 3000, cantidad: 8, unidad: 'semanas' },
  ],
};

function configGuardada() {
  return JSON.parse(leerArchivoSync(CONFIG_PATH));
}

let restaurarDatos;
before(() => { restaurarDatos = fotoDatos([CONFIG_PATH, COTS_PATH]); });
after(() => {
  restaurarDatos();
  configStore._reiniciar();
});

beforeEach(() => {
  fijarDatos(CONFIG_PATH, CONFIG_INICIAL);
  configStore._reiniciar();
});

test('las rutas de condiciones exigen admin: vendedor 403, sin token 401', async () => {
  for (const [metodo, ruta] of [['get', '/api/admin/condiciones'], ['put', '/api/admin/condiciones']]) {
    const vendedor = await supertest(app)[metodo](ruta).set('Authorization', VENDEDOR).send(NUEVAS);
    assert.equal(vendedor.status, 403, `${metodo} ${ruta}`);
    const sinToken = await supertest(app)[metodo](ruta).send(NUEVAS);
    assert.equal(sinToken.status, 401, `${metodo} ${ruta}`);
  }
  assert.equal(configGuardada().condicionesComerciales, undefined, 'el vendedor no guardo nada');
});

test('GET sin configuracion guardada devuelve la semilla', async () => {
  const res = await supertest(app).get('/api/admin/condiciones').set('Authorization', ADMIN);
  assert.equal(res.status, 200);
  assert.deepStrictEqual(res.body.condiciones, SEMILLA);
});

test('PUT guarda en la configuracion del panel, conserva el resto y la siguiente cotizacion las recibe', async () => {
  const put = await supertest(app).put('/api/admin/condiciones').set('Authorization', ADMIN)
    .send({ ...NUEVAS, tiempoProduccion: NUEVAS.tiempoProduccion.map(e => ({ ...e, desde: String(e.desde) })) });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.deepStrictEqual(put.body.condiciones, NUEVAS);
  const guardada = configGuardada();
  assert.deepStrictEqual(guardada.condicionesComerciales, NUEVAS);
  assert.deepStrictEqual(guardada.tiposActivos, ['PL'], 'el resto de la configuracion se conserva');

  const get = await supertest(app).get('/api/admin/condiciones').set('Authorization', ADMIN);
  assert.deepStrictEqual(get.body.condiciones, NUEVAS);
  const precios = await supertest(app).get('/api/precios').set('Authorization', VENDEDOR);
  assert.equal(precios.status, 200);
  assert.deepStrictEqual(precios.body.condicionesComerciales, NUEVAS);
});

test('PUT con una unidad fuera del catalogo responde 400 y no toca lo guardado', async () => {
  const res = await supertest(app).put('/api/admin/condiciones').set('Authorization', ADMIN)
    .send({ ...NUEVAS, tiempoProduccionCalca: [{ desde: 0, cantidad: 2, unidad: 'meses' }] });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /dias o semanas/);
  assert.equal(configGuardada().condicionesComerciales, undefined);
});

test('PUT sin escalones responde 400: no existe la cotizacion sin tiempo de produccion', async () => {
  const res = await supertest(app).put('/api/admin/condiciones').set('Authorization', ADMIN)
    .send({ ...NUEVAS, tiempoProduccion: [] });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /al menos un escalon/);
});

test('GET /api/precios le entrega al vendedor las condiciones vigentes (semilla sin configuracion)', async () => {
  const res = await supertest(app).get('/api/precios').set('Authorization', VENDEDOR);
  assert.equal(res.status, 200);
  assert.deepStrictEqual(res.body.condicionesComerciales, SEMILLA);
});

test('una cotizacion ya generada conserva el texto con el que se genero al cambiar las condiciones', async () => {
  const notas = [
    'Precios EXW Ixtapaluca, Estado de Mexico. No incluye envio.',
    'Tiempo de produccion: 4 semanas contadas a partir del pago del anticipo.',
    'Se requiere 50% de anticipo para comenzar la produccion.',
  ];
  const guardar = await supertest(app).post('/api/cotizacion').set('Authorization', ADMIN).send({
    fecha: '2026-09-25', vigencia: '2026-10-25', tier: 'Mayoreo',
    cliente: { razonSocial: 'Condiciones Viejas SA', nombreCorto: 'Condiciones Viejas', telefono: '+52 5512345678' },
    items: [{ codigo: 'TEST324', descripcion: 'Producto 324', cantidad: 40, unidad: 'pza', precio: 100, descuento: 0 }],
    subtotal: 4000, iva: 640, total: 4640, notas,
  });
  assert.equal(guardar.status, 200, JSON.stringify(guardar.body));
  const id = guardar.body.id;
  assert.ok(id, JSON.stringify(guardar.body));

  const put = await supertest(app).put('/api/admin/condiciones').set('Authorization', ADMIN).send(NUEVAS);
  assert.equal(put.status, 200);

  const html = await supertest(app).get(`/api/cotizacion/html/${id}`);
  assert.equal(html.status, 200);
  assert.ok(html.text.includes('Tiempo de produccion: 4 semanas contadas a partir del pago del anticipo.'), 'conserva el plazo con el que se genero');
  assert.ok(html.text.includes('Se requiere 50% de anticipo'), 'conserva el anticipo con el que se genero');
  assert.ok(!html.text.includes('30% de anticipo'), 'no toma las condiciones nuevas');
});
