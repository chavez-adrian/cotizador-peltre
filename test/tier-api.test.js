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
  assert.deepStrictEqual([...res.body.listasHabilitadas].sort(), [...LISTAS_VOLUMEN].sort());
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
