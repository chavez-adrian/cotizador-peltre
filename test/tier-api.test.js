// #151 (spec #98): la lista fijada la hace valer el SERVIDOR, no la pantalla.
// Prior art: test/descuentos-api.test.js (#137), mismo patron de permiso.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const COTS_PATH = join(DATA_DIR, 'cotizaciones.json');
const VENDEDORES_PATH = join(DATA_DIR, 'vendedores.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');

const tokenVendedor = jwt.sign({ id: 2, name: 'Vendedor Test', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });
const tokenAdmin = jwt.sign({ id: 1, name: 'Admin Test', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

function readJson(path) {
  return JSON.parse(leerArchivoSync(path));
}
function writeJson(path, data) {
  escribirArchivoSync(path, JSON.stringify(data, null, 2));
}
function readCots() {
  if (!existsSync(COTS_PATH)) return [];
  return readJson(COTS_PATH);
}

// 10 piezas de producto: el tabulador vigente en data/precios.json las resuelve
// a Menudeo (min_qty 1 es el unico umbral que cabe).
const ITEM_BASE = { codigo: 'AB12', descripcion: 'Olla', cantidad: 10, unidad: 'pza', precio: 100 };

function cotizacionCon(tier) {
  return {
    fecha: '2026-01-01', vigencia: '2026-02-01', tier,
    cliente: { razonSocial: 'Tier SA', nombreCorto: 'Tier', telefono: '+52 55 1234 5678' },
    items: [ITEM_BASE],
    subtotal: 1000, iva: 160, total: 1160, notas: [],
  };
}

let cotsOriginal;
before(() => { cotsOriginal = readCots(); });
after(() => { writeJson(COTS_PATH, cotsOriginal); });

test('vendedor: tier que coincide con el tabulador se guarda sin permiso especial', async () => {
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenVendedor}`)
    .send(cotizacionCon('Menudeo'));
  assert.strictEqual(res.status, 200);
});

test('vendedor: tier ajeno al tabulador -> rechazo y nada guardado', async () => {
  const antes = readCots().length;
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenVendedor}`)
    .send(cotizacionCon('M1500'));
  assert.strictEqual(res.status, 403);
  assert.match(res.body.error, /permiso/i);
  assert.strictEqual(readCots().length, antes);
});

test('admin: cualquier tier fijado se guarda, incluso ajeno al tabulador', async () => {
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send(cotizacionCon('M1500'));
  assert.strictEqual(res.status, 200);
  const guardada = readCots().find(c => c.id === res.body.id);
  assert.strictEqual(guardada.tier, 'M1500');
});

test('admin: fijar Menudeo tambien pasa (#98: incluye Menudeo)', async () => {
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send(cotizacionCon('Menudeo'));
  assert.strictEqual(res.status, 200);
});

test('vendedor: tier vacio (ausente) no cuenta como override', async () => {
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenVendedor}`)
    .send(cotizacionCon(''));
  assert.strictEqual(res.status, 200);
});

// #153: el checkbox de admin en el registro de vendedores extendia el permiso
// mas alla de rol admin. Desde #296 ese flag ya no decide: lo que hace pasar
// este guardado es la MIGRACION de lectura (flag encendido y sin campo nuevo =
// los 6 escalones de volumen habilitados). Se modifica el registro real y se
// restaura al final (mismo cuidado que test/vendedores-store-api.test.js).
test('vendedor con el flag viejo de #153 y sin campo nuevo: tier ajeno al tabulador se guarda (migracion)', async () => {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    const registro = JSON.parse(original);
    registro.find(v => v.id === 2).puedeFijarLista = true;
    escribirArchivoSync(VENDEDORES_PATH, JSON.stringify(registro, null, 2));
    const res = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send(cotizacionCon('M1500'));
    assert.strictEqual(res.status, 200);
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
});

// === #296 (ADR-0015): el permiso es la matriz (vendedor, lista de Operam) ===
//
// Los ids son los REALES de las sales_types de Operam (verificados en vivo):
// Precio de lista 12, M100 15, M350 16, M550 1, M1500 6, M6000 3.
const LISTA_M1500 = '6';
const LISTA_M6000 = '3';
const LISTAS_VOLUMEN = ['12', '15', '16', '1', '6', '3'];

function conListas(registro, listasHabilitadas) {
  const copia = JSON.parse(registro);
  const v = copia.find(x => x.id === 2);
  delete v.puedeFijarLista;
  if (listasHabilitadas !== undefined) v.listasHabilitadas = listasHabilitadas;
  escribirArchivoSync(VENDEDORES_PATH, JSON.stringify(copia, null, 2));
}

test('vendedor con M1500 habilitada: fijar M1500 se guarda y fijar M6000 se rechaza nombrando la lista', async () => {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    conListas(original, [LISTA_M1500]);
    const propia = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send(cotizacionCon('M1500'));
    assert.strictEqual(propia.status, 200);

    const antes = readCots().length;
    const ajena = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send(cotizacionCon('M6000'));
    assert.strictEqual(ajena.status, 403);
    assert.match(ajena.body.error, /M6000/);
    assert.match(ajena.body.error, /permiso/i);
    assert.strictEqual(readCots().length, antes);
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
});

// El permiso se relee del registro en CADA guardado, nunca del JWT (el token no
// se re-emite cuando el admin mueve una celda).
test('quitar la celda surte efecto en el siguiente guardado, con el mismo token', async () => {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    conListas(original, [LISTA_M6000]);
    const antes = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send(cotizacionCon('M6000'));
    assert.strictEqual(antes.status, 200);

    conListas(original, []);
    const despues = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send(cotizacionCon('M6000'));
    assert.strictEqual(despues.status, 403);
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
});

// #154 con la matriz: la excepcion del tier previo sigue siendo del MISMO
// registro, y no se contagia a otra lista.
test('vendedor que perdio la celda, editando SU registro: el tier ya guardado pasa y otro distinto no', async () => {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    conListas(original, [LISTA_M1500]);
    const creado = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send(cotizacionCon('M1500'));
    assert.strictEqual(creado.status, 200);
    const id = creado.body.id;

    conListas(original, []);
    const editado = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send({ ...cotizacionCon('M1500'), cotizacionId: id });
    assert.strictEqual(editado.status, 200);
    assert.strictEqual(editado.body.id, id);

    const otro = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send({ ...cotizacionCon('M6000'), cotizacionId: id });
    assert.strictEqual(otro.status, 403);
    assert.strictEqual(readCots().find(c => c.id === id).tier, 'M1500');
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
});

// #296 AC3: el endpoint de sesion que exponia el flag expone ahora las listas
// habilitadas (prior art: "la pantalla recibe su tope vigente en /api/precios",
// test/descuentos-api.test.js).
test('la pantalla recibe sus listas habilitadas vigentes en /api/precios', async () => {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    conListas(original, [LISTA_M1500]);
    const conCelda = await supertest(app).get('/api/precios').set('Authorization', `Bearer ${tokenVendedor}`);
    assert.deepStrictEqual(conCelda.body.listasHabilitadas, [LISTA_M1500]);
    assert.strictEqual(conCelda.body.puedeFijarLista, undefined, 'el flag viejo ya no viaja');

    conListas(original, []);
    const sinCeldas = await supertest(app).get('/api/precios').set('Authorization', `Bearer ${tokenVendedor}`);
    assert.deepStrictEqual(sinCeldas.body.listasHabilitadas, []);
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
});

test('/api/precios: el rol admin recibe todas las listas del catalogo, sin celdas en la matriz', async () => {
  const res = await supertest(app).get('/api/precios').set('Authorization', `Bearer ${tokenAdmin}`);
  assert.deepStrictEqual(res.body.listasHabilitadas, res.body.tiers.map(t => t.listaId));
  // Todas las del catalogo = los escalones de volumen MAS las listas sin escalon
  // (#298/#299): las 14 listas activas de Operam, que el admin puede fijar todas.
  assert.deepStrictEqual(
    [...res.body.listasHabilitadas].sort(),
    [...LISTAS_VOLUMEN, LISTA_SEGUNDAS, '19', '20', '21', '22', '23', '24', '25'].sort(),
  );
});

test('/api/precios: el vendedor con el flag viejo y sin campo nuevo recibe los 6 escalones de volumen', async () => {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    const registro = JSON.parse(original);
    registro.find(v => v.id === 2).puedeFijarLista = true;
    escribirArchivoSync(VENDEDORES_PATH, JSON.stringify(registro, null, 2));
    const res = await supertest(app).get('/api/precios').set('Authorization', `Bearer ${tokenVendedor}`);
    assert.deepStrictEqual([...res.body.listasHabilitadas].sort(), [...LISTAS_VOLUMEN].sort());
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
});

// === #298 (ADR-0015): Segundas, la primera lista SIN escalon de volumen ===
//
// La migracion de lectura de #296 reparte "los escalones de volumen" a quien traia el
// flag binario de #153. Una lista sin escalon NO es uno de ellos: heredarla seria dar
// un permiso que nadie marco en la matriz, justo lo que el permiso existe para
// impedir. El id es el REAL de Operam (Segundas = 9).
const LISTA_SEGUNDAS = '9';

test('el vendedor migrado del flag viejo NO hereda Segundas, solo los escalones de volumen', async () => {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    const registro = JSON.parse(original);
    registro.find(v => v.id === 2).puedeFijarLista = true;
    escribirArchivoSync(VENDEDORES_PATH, JSON.stringify(registro, null, 2));

    const precios = await supertest(app).get('/api/precios').set('Authorization', `Bearer ${tokenVendedor}`);
    assert.strictEqual(precios.body.listasHabilitadas.includes(LISTA_SEGUNDAS), false);
    const admin = await supertest(app).get('/api/admin/vendedores').set('Authorization', `Bearer ${tokenAdmin}`);
    assert.strictEqual(admin.body.find(v => v.id === 2).listasHabilitadas.includes(LISTA_SEGUNDAS), false);

    const guardar = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send(cotizacionCon('Segundas'));
    assert.strictEqual(guardar.status, 403);
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
});

test('vendedor con Segundas marcada en su renglon: la cotizacion en Segundas se guarda', async () => {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    conListas(original, [LISTA_SEGUNDAS]);
    const res = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send(cotizacionCon('Segundas'));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(readCots().find(c => c.id === res.body.id).tier, 'Segundas');

    const precios = await supertest(app).get('/api/precios').set('Authorization', `Bearer ${tokenVendedor}`);
    assert.deepStrictEqual(precios.body.listasHabilitadas, [LISTA_SEGUNDAS]);
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
});

test('vendedor sin Segundas marcada: el guardado en Segundas se rechaza nombrando la lista y no guarda nada', async () => {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    conListas(original, [LISTA_M1500]);
    const antes = readCots().length;
    const res = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send(cotizacionCon('Segundas'));
    assert.strictEqual(res.status, 403);
    assert.match(res.body.error, /Segundas/);
    assert.strictEqual(readCots().length, antes);
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
});

// Editar/Copiar con una lista sin escalon siguen las reglas por lista del tracer
// (#154/#296): la lista ya guardada en ESE registro pasa aunque a quien edita le
// hayan quitado la celda -- y una lista sin escalon nunca coincide con el tabulador,
// asi que la excepcion del registro es lo unico que la deja pasar.
test('vendedor que perdio la celda de Segundas, editando SU registro: Segundas pasa y otra lista no', async () => {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    conListas(original, [LISTA_SEGUNDAS]);
    const creado = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send(cotizacionCon('Segundas'));
    assert.strictEqual(creado.status, 200);
    const id = creado.body.id;

    conListas(original, []);
    const editado = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send({ ...cotizacionCon('Segundas'), cotizacionId: id });
    assert.strictEqual(editado.status, 200);
    assert.strictEqual(editado.body.id, id);

    const otra = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send({ ...cotizacionCon('M6000'), cotizacionId: id });
    assert.strictEqual(otra.status, 403);
    assert.strictEqual(readCots().find(c => c.id === id).tier, 'Segundas');

    // Copiar es un registro nuevo (sin cotizacionId): sin la celda no hereda nada.
    const copia = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send(cotizacionCon('Segundas'));
    assert.strictEqual(copia.status, 403);
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
});

// El catalogo que la pantalla recibe trae Segundas preciada y sin min_qty: por eso el
// selector la puede ofrecer y el tabulador nunca la elige.
test('/api/precios: Segundas viaja en el catalogo sin min_qty y preciada por factor', async () => {
  const res = await supertest(app).get('/api/precios').set('Authorization', `Bearer ${tokenAdmin}`);
  const segundas = res.body.tiers.find(t => t.id === 'Segundas');
  assert.deepStrictEqual(segundas, { id: 'Segundas', label: 'Segundas', listaId: LISTA_SEGUNDAS });
  const producto = res.body.products.find(p => p.prices.Menudeo != null);
  assert.ok(Math.abs(producto.prices.Segundas - producto.prices.Menudeo * 0.165) < 1e-9,
    'el precio en Segundas es el precio base por el factor 0.165 de Operam');
  assert.deepStrictEqual([...new Set(res.body.calcas.map(c => c.prices.Segundas))], [null],
    'las calcas no tienen precio base: en Segundas quedan en null, nunca en 0');
});

// === #299 (ADR-0015): Amazon, M6001 y las cinco US en el catalogo vigente ===
//
// Ids REALES de las sales_types de Operam. Lo que se verifica aqui es el catalogo que
// la PANTALLA recibe (data/precios.json regenerado), no lo que el nucleo sabe
// calcular: de ahi salen el selector del vendedor y el precio del carrito.
const LISTA_AMAZON = '19';
const LISTA_M6001 = '20';
const LISTAS_US = { US100: '21', US350: '22', US550: '23', US1500: '24', US6000: '25' };
const FACTORES_US = { US100: 0.84, US350: 0.72, US550: 0.6, US1500: 0.54, US6000: 0.48 };

test('/api/precios: las ocho listas sin escalon viajan en el catalogo y ninguna tabula', async () => {
  const res = await supertest(app).get('/api/precios').set('Authorization', `Bearer ${tokenAdmin}`);
  assert.deepStrictEqual(res.body.tiers.map(t => t.id), [
    'Menudeo', 'M100', 'M350', 'M550', 'M1500', 'M6000',
    'Segundas', 'Amazon', 'M6001', 'US100', 'US350', 'US550', 'US1500', 'US6000',
  ]);
  assert.deepStrictEqual(
    res.body.tiers.filter(t => t.min_qty !== undefined).map(t => t.id),
    ['Menudeo', 'M100', 'M350', 'M550', 'M1500', 'M6000'],
    'Auto sigue tabulando solo sobre los escalones de volumen',
  );
  assert.deepStrictEqual(res.body.tiers.find(t => t.id === 'Amazon'), { id: 'Amazon', label: 'Amazon', listaId: LISTA_AMAZON });
  assert.deepStrictEqual(res.body.tiers.find(t => t.id === 'M6001'), { id: 'M6001', label: 'M6001', listaId: LISTA_M6001 });
  for (const [id, listaId] of Object.entries(LISTAS_US)) {
    assert.deepStrictEqual(res.body.tiers.find(t => t.id === id), { id, label: id, listaId });
  }
});

test('/api/precios: Amazon es la unica lista POR ENCIMA del precio base', async () => {
  const res = await supertest(app).get('/api/precios').set('Authorization', `Bearer ${tokenAdmin}`);
  const caros = res.body.products.filter(p => p.prices.Amazon <= p.prices.Menudeo);
  assert.deepStrictEqual(caros.map(p => p.key), [], 'Amazon (factor 1.1) siempre sube sobre el base');
  const producto = res.body.products.find(p => p.prices.Menudeo != null);
  assert.ok(Math.abs(producto.prices.Amazon - producto.prices.Menudeo * 1.1) < 1e-9);
  for (const [id, factor] of Object.entries(FACTORES_US)) {
    assert.ok(Math.abs(producto.prices[id] - producto.prices.Menudeo * factor) < 1e-9,
      `${id} es el factor ${factor} sobre el precio base EN PESOS (la moneda la manda el cliente)`);
  }
  assert.ok(Math.abs(producto.prices.M6001 - producto.prices.Menudeo * 0.39) < 1e-9);
});

// La diferencia de M6001 con las otras siete: Operam SI tiene filas de calca ahi, y
// esas ganan al factor. La calca no tiene precio base, asi que en Amazon y en las US
// queda en null (partida sin precio, #91) y en M6001 sale preciada.
test('/api/precios: en M6001 las calcas traen su precio y en Amazon y las US quedan en null', async () => {
  const res = await supertest(app).get('/api/precios').set('Authorization', `Bearer ${tokenAdmin}`);
  assert.deepStrictEqual(res.body.calcas.filter(c => c.prices.M6001 == null).map(c => c.code), [],
    'las 32 calcas del catalogo tienen fila explicita en M6001');
  for (const id of ['Amazon', ...Object.keys(LISTAS_US)]) {
    assert.deepStrictEqual([...new Set(res.body.calcas.map(c => c.prices[id]))], [null],
      `sin precio base y sin fila propia, la calca queda en null en ${id}, nunca en 0`);
  }
});

// Cero regresion de precios (AC de #299): el catalogo regenerado no puede mover ni un
// precio de los escalones de volumen. Los seis numeros son los que data/precios.json
// ya traia para VA08B antes de que entraran las listas nuevas.
test('/api/precios: los escalones de volumen del catalogo vigente no se movieron', async () => {
  const res = await supertest(app).get('/api/precios').set('Authorization', `Bearer ${tokenAdmin}`);
  const va08b = res.body.products.find(p => p.key === 'VA08B');
  assert.deepStrictEqual(
    ['Menudeo', 'M100', 'M350', 'M550', 'M1500', 'M6000'].map(t => va08b.prices[t]),
    [116.37931, 81.46551699999999, 69.827586, 58.189655, 52.370689500000005, 46.55172400000001],
  );
  const cal1025s = res.body.calcas.find(c => c.code === 'CAL1025S');
  assert.deepStrictEqual(
    ['Menudeo', 'M100', 'M350', 'M550', 'M1500', 'M6000'].map(t => cal1025s.prices[t]),
    [null, 26.9, 20.11, 17.96, 14.19, 13.31],
  );
});

// Cotizar en cada una de las tres naturalezas nuevas (AC1 de #299, la parte que no
// necesita navegador ni Operam en vivo): con la celda marcada la cotizacion se guarda
// en esa lista, y sin ella el servidor la rechaza nombrandola. El mecanismo es el de
// #296/#298; lo que #299 agrega es que estas tres listas ya existen en el catalogo.
test('vendedor con la celda de Amazon, de M6001 o de una US: la cotizacion se guarda en esa lista', async () => {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    for (const [tier, listaId] of [['Amazon', LISTA_AMAZON], ['M6001', LISTA_M6001], ['US1500', LISTAS_US.US1500]]) {
      conListas(original, [listaId]);
      const res = await supertest(app).post('/api/cotizacion')
        .set('Authorization', `Bearer ${tokenVendedor}`)
        .send(cotizacionCon(tier));
      assert.strictEqual(res.status, 200, `${tier} con su celda marcada`);
      assert.strictEqual(readCots().find(c => c.id === res.body.id).tier, tier);

      const antes = readCots().length;
      const otra = await supertest(app).post('/api/cotizacion')
        .set('Authorization', `Bearer ${tokenVendedor}`)
        .send(cotizacionCon(tier === 'Amazon' ? 'M6001' : 'Amazon'));
      assert.strictEqual(otra.status, 403, `${tier} marcada no habilita ninguna otra lista`);
      assert.strictEqual(readCots().length, antes);
    }
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
});

test('vendedor sin la celda de Amazon: el guardado se rechaza nombrando la lista y no guarda nada', async () => {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    conListas(original, [LISTA_M1500]);
    const antes = readCots().length;
    const res = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send(cotizacionCon('Amazon'));
    assert.strictEqual(res.status, 403);
    assert.match(res.body.error, /Amazon/);
    assert.strictEqual(readCots().length, antes);
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
});

// El precio de la lista fijada llega al documento que el cliente recibe. Amazon es el
// caso que nadie habia ejercitado: la partida vale MAS que en Menudeo y ningun
// formato ni calculo del documento lo trata distinto.
test('el documento regenerado imprime el precio de Amazon, por encima del precio base', async () => {
  const precios = await supertest(app).get('/api/precios').set('Authorization', `Bearer ${tokenAdmin}`);
  const va08b = precios.body.products.find(p => p.key === 'VA08B');
  const creada = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({
      ...cotizacionCon('Amazon'),
      items: [{ ...ITEM_BASE, codigo: 'VA08B', descripcion: 'Taza de mesa 8 cm bicolor', precio: va08b.prices.Amazon }],
    });
  assert.strictEqual(creada.status, 200);

  const html = await supertest(app).get(`/api/cotizacion/html/${creada.body.id}`);
  assert.strictEqual(html.status, 200);
  assert.ok(html.text.includes('128.02'), 'el HTML imprime el precio de Amazon (128.017241)');
  assert.ok(!html.text.includes('116.38'), 'y no el precio base de Menudeo');
});

// === La matriz se guarda con el PUT existente del registro (AC1) ===

test('PUT /api/admin/vendedores: las celdas de la matriz hacen roundtrip por el GET', async () => {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    const registro = JSON.parse(original);
    const nuevo = registro.map(v => (v.id === 2 ? { ...v, listasHabilitadas: ['1', LISTA_M6000] } : v));
    const put = await supertest(app).put('/api/admin/vendedores')
      .set('Authorization', `Bearer ${tokenAdmin}`).send(nuevo);
    assert.strictEqual(put.status, 200);

    const res = await supertest(app).get('/api/admin/vendedores').set('Authorization', `Bearer ${tokenAdmin}`);
    assert.deepStrictEqual(res.body.find(v => v.id === 2).listasHabilitadas, ['1', LISTA_M6000]);
    assert.deepStrictEqual(res.body.find(v => v.id === 3).listasHabilitadas, [], 'los demas quedan sin celdas');
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
});

test('PUT /api/admin/vendedores: destildar todas las celdas se guarda como sin permiso, no como "sin configurar"', async () => {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    const registro = JSON.parse(original);
    // El vendedor trae el flag viejo encendido: si la lista vacia no se
    // guardara, la migracion le devolveria los 6 escalones en la siguiente
    // lectura y destildar no serviria de nada.
    const nuevo = registro.map(v => (v.id === 2 ? { ...v, puedeFijarLista: true, listasHabilitadas: [] } : v));
    const put = await supertest(app).put('/api/admin/vendedores')
      .set('Authorization', `Bearer ${tokenAdmin}`).send(nuevo);
    assert.strictEqual(put.status, 200);

    const res = await supertest(app).get('/api/admin/vendedores').set('Authorization', `Bearer ${tokenAdmin}`);
    assert.deepStrictEqual(res.body.find(v => v.id === 2).listasHabilitadas, []);

    const guardar = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send(cotizacionCon('M1500'));
    assert.strictEqual(guardar.status, 403);
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
});

test('PUT /api/admin/vendedores: un valor basura en listasHabilitadas se normaliza a sin permiso', async () => {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    const registro = JSON.parse(original);
    const nuevo = registro.map(v => (v.id === 2 ? { ...v, listasHabilitadas: 'todas' } : v));
    const put = await supertest(app).put('/api/admin/vendedores')
      .set('Authorization', `Bearer ${tokenAdmin}`).send(nuevo);
    assert.strictEqual(put.status, 200);

    const res = await supertest(app).get('/api/admin/vendedores').set('Authorization', `Bearer ${tokenAdmin}`);
    assert.deepStrictEqual(res.body.find(v => v.id === 2).listasHabilitadas, []);
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
});

// La matriz de /admin se pinta con lo que el GET devuelve: si el vendedor
// migrado apareciera sin celdas, el primer guardado le borraria el permiso que
// #153 le dio.
test('GET /api/admin/vendedores: el vendedor con el flag viejo se lee ya migrado a los 6 escalones', async () => {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    const registro = JSON.parse(original);
    registro.find(v => v.id === 2).puedeFijarLista = true;
    escribirArchivoSync(VENDEDORES_PATH, JSON.stringify(registro, null, 2));
    const res = await supertest(app).get('/api/admin/vendedores').set('Authorization', `Bearer ${tokenAdmin}`);
    const v2 = res.body.find(v => v.id === 2);
    assert.deepStrictEqual([...v2.listasHabilitadas].sort(), [...LISTAS_VOLUMEN].sort());
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
});

// #154: editar (mismo registro) conserva un tier ya fijado aunque quien edita
// no tenga permiso -- corregir cantidades/notas no debe tumbar una
// autorizacion que ya ocurrio. La excepcion compara contra el tier YA
// GUARDADO en ese registro, nunca contra el tabulador del volumen actual, y
// SOLO cuando quien edita es dueno del registro (o admin): sin ese chequeo,
// un cotizacionId AJENO con lista fijada seria una via para colarse el
// permiso -- el riesgo que el propio ticket #154 senala.
test('vendedor sin permiso, editando SU PROPIO registro: el tier identico al ya guardado se acepta', async () => {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    // El registro nace CON el checkbox (autorizacion real de #153) y despues
    // se le quita: queda una cotizacion con lista fijada de un vendedor que
    // ya no tiene permiso -- exactamente el caso que #154 describe.
    const registro = JSON.parse(original);
    registro.find(v => v.id === 2).puedeFijarLista = true;
    escribirArchivoSync(VENDEDORES_PATH, JSON.stringify(registro, null, 2));
    const creado = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send(cotizacionCon('M1500'));
    assert.strictEqual(creado.status, 200);
    const id = creado.body.id;

    registro.find(v => v.id === 2).puedeFijarLista = false;
    escribirArchivoSync(VENDEDORES_PATH, JSON.stringify(registro, null, 2));
    const editado = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send({ ...cotizacionCon('M1500'), cotizacionId: id });
    assert.strictEqual(editado.status, 200);
    assert.strictEqual(editado.body.id, id);
    assert.strictEqual(readCots().find(c => c.id === id).tier, 'M1500');
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
});

test('vendedor sin permiso, editando SU PROPIO registro: un tier DISTINTO al ya guardado se sigue rechazando', async () => {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    const registro = JSON.parse(original);
    registro.find(v => v.id === 2).puedeFijarLista = true;
    escribirArchivoSync(VENDEDORES_PATH, JSON.stringify(registro, null, 2));
    const creado = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send(cotizacionCon('M1500'));
    assert.strictEqual(creado.status, 200);
    const id = creado.body.id;

    registro.find(v => v.id === 2).puedeFijarLista = false;
    escribirArchivoSync(VENDEDORES_PATH, JSON.stringify(registro, null, 2));
    const tierAntes = readCots().find(c => c.id === id).tier;
    const res = await supertest(app).post('/api/cotizacion')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send({ ...cotizacionCon('M6000'), cotizacionId: id });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(readCots().find(c => c.id === id).tier, tierAntes);
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
});

// El hallazgo central del riesgo de seguridad del ticket: el tier identico NO
// basta si el registro es ajeno -- sin este chequeo, cualquier vendedor sin
// permiso podria tomar el cotizacionId de una cotizacion AJENA con lista
// fijada (de un admin, por ejemplo) y colarse la excepcion.
test('vendedor sin permiso, editando un registro AJENO con el MISMO tier ya guardado: se rechaza (el dueno importa, no solo el tier)', async () => {
  const creado = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send(cotizacionCon('M1500'));
  assert.strictEqual(creado.status, 200);
  const id = creado.body.id;
  const tierAntes = readCots().find(c => c.id === id).tier;

  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenVendedor}`)
    .send({ ...cotizacionCon('M1500'), cotizacionId: id });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(readCots().find(c => c.id === id).tier, tierAntes);
});

test('vendedor sin permiso, Copiar (sin cotizacionId): el mismo tier de una cotizacion ajena se rechaza igual que antes', async () => {
  const creado = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send(cotizacionCon('M1500'));
  assert.strictEqual(creado.status, 200);

  const antes = readCots().length;
  const res = await supertest(app).post('/api/cotizacion')
    .set('Authorization', `Bearer ${tokenVendedor}`)
    .send(cotizacionCon('M1500'));
  assert.strictEqual(res.status, 403);
  assert.strictEqual(readCots().length, antes);
});

// #153: un valor basura capturado en /admin nunca se guarda como permiso.
test('PUT /api/admin/vendedores: un valor basura en puedeFijarLista se normaliza a false', async () => {
  const original = leerArchivoSync(VENDEDORES_PATH);
  try {
    const registro = JSON.parse(original);
    const conBasura = registro.map(v => (v.id === 2 ? { ...v, puedeFijarLista: 'si' } : v));
    const res = await supertest(app).put('/api/admin/vendedores')
      .set('Authorization', `Bearer ${tokenAdmin}`).send(conBasura);
    assert.strictEqual(res.status, 200);
    const guardado = JSON.parse(leerArchivoSync(VENDEDORES_PATH)).find(v => v.id === 2);
    assert.strictEqual(guardado.puedeFijarLista, false);
  } finally {
    escribirArchivoSync(VENDEDORES_PATH, original);
  }
});
