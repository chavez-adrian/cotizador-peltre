import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import XLSX from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROSPECTOS_PATH = join(__dirname, '..', 'data', 'prospectos.json');
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
const { resetIndice } = await import('../lib/indice-telefonos.js');
const { resetSession } = await import('../lib/operam-client.js');
const ADMIN_TOKEN = jwt.sign({ id: 99, name: 'Tester', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
const MEMO_TOKEN = jwt.sign({ id: 7, name: 'Memo', role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });

function readProspectos() {
  if (!existsSync(PROSPECTOS_PATH)) return [];
  return JSON.parse(readFileSync(PROSPECTOS_PATH, 'utf8'));
}
function writeProspectos(data) {
  writeFileSync(PROSPECTOS_PATH, JSON.stringify(data, null, 2));
}

// Mismo patron de aislamiento que prospectos-api.test.js: fetch bloqueado por
// defecto (el indice de Operam es best effort), Operam mockeado por test.
const originalFetch = globalThis.fetch;
const fetchBloqueado = async (url) => { throw new Error('fetch sin mock en tests: ' + url); };

function mockOperamFetch(handlers) {
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    for (const [pat, fn] of Object.entries(handlers)) {
      if (u.includes(pat)) return fn(u, opts);
    }
    throw new Error('Unmocked fetch: ' + u);
  };
}

function jsonResponse(data, status = 200) {
  return { ok: status < 400, status, json: async () => data };
}

// vendedores.json controlado: el match por Dispositivo no debe depender de la
// nomina real. Se restaura integro al final.
const VENDEDORES_TEST = [
  { id: 1, name: 'Tester', pin: '0000', role: 'admin', operam_id: 1 },
  { id: 2, name: 'Oswaldo Chávez', pin: '1111', role: 'vendedor', operam_id: 8 },
  { id: 3, name: 'Jaime Abaroa', pin: '2222', role: 'vendedor', operam_id: null },
];

let savedProspectos, existiaProspectos, savedVendedores;
before(() => {
  existiaProspectos = existsSync(PROSPECTOS_PATH);
  savedProspectos = readProspectos();
  savedVendedores = readFileSync(VENDEDORES_PATH, 'utf8');
  writeFileSync(VENDEDORES_PATH, JSON.stringify(VENDEDORES_TEST, null, 2));
  globalThis.fetch = fetchBloqueado;
});
after(() => {
  if (existiaProspectos) writeProspectos(savedProspectos);
  else if (existsSync(PROSPECTOS_PATH)) unlinkSync(PROSPECTOS_PATH);
  writeFileSync(VENDEDORES_PATH, savedVendedores);
  globalThis.fetch = originalFetch;
});
beforeEach(() => {
  globalThis.fetch = fetchBloqueado;
  resetIndice();
  resetSession();
});

const HEADERS = ['Usuario', 'Dispositivo', 'Fecha/Hora', 'Nombre', 'Apellido Paterno',
  'Apellido Materno', 'Empresa', 'Puesto', 'Correo electronico', 'Telefono', 'Rankings',
  'Tipo de lectora', 'Codigo postal', 'Ciudad', 'Estado', 'País', 'Tags', 'Comentarios'];

function fila(o = {}) {
  return ['#1 Licencia 1', o.dispositivo ?? 'Caseta 1', o.fechaHora ?? '2024-08-28 01:04:58',
    o.nombre ?? 'OMAR', o.apellidoP ?? 'OLVERA', 'MUNOZ', o.empresa ?? 'VIANDA',
    'Sin definir por el usuario', o.correo ?? 'omar@x.com', o.telefono ?? 525512952080,
    o.rankings ?? 'Hot', 'App', 52784, o.ciudad ?? 'HUIXQUILUCAN', 'MEXICO', 'MEXICO', '', ''];
}

function xlsxBuffer(filas) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADERS, ...filas]), 'Contactos');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function importar(token, buffer, vendedor) {
  const req = supertest(app).post('/api/admin/prospectos/importar')
    .set('Authorization', `Bearer ${token}`);
  if (buffer) req.attach('archivo', buffer, 'feria.xlsx');
  if (vendedor) req.field('vendedor', vendedor);
  return req;
}

test('importar el XLSX crea prospectos en Por Cotizar, canal Feria/Expo, con fecha de importacion', async () => {
  writeProspectos([]);
  const antes = new Date();
  const res = await importar(ADMIN_TOKEN, xlsxBuffer([
    fila(),
    fila({ nombre: 'ROSA', telefono: 525511112222, dispositivo: 'Oswaldo' }),
  ]), 'Jaime Abaroa');
  assert.equal(res.status, 200);
  assert.equal(res.body.importados, 2);
  assert.deepEqual(res.body.descartados, []);
  assert.deepEqual(res.body.porVendedor, { 'Jaime Abaroa': 1, 'Oswaldo Chávez': 1 });
  const guardados = readProspectos();
  assert.equal(guardados.length, 2);
  const p = guardados[0];
  assert.equal(p.etapa, 'por_cotizar');
  assert.equal(p.canal, 'Feria/Expo');
  assert.equal(p.celular, '+52 5512952080');
  assert.equal(p.vendedor, 'Jaime Abaroa');
  assert.equal(p.data.escaneado, '2024-08-28 01:04:58');
  assert.equal(p.data.temperatura, 5);
  // fecha = momento de la importacion, no la del escaneo (2024)
  assert.ok(new Date(p.fecha) >= new Date(antes.toISOString()));
  assert.equal(guardados[1].vendedor, 'Oswaldo Chávez');
});

test('celulares ya existentes como prospecto no se duplican y se reportan', async () => {
  writeProspectos([{
    id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', celular: '+52 5512952080',
    celular10: '5512952080', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp',
    etapa: 'por_cotizar', eventos: [], data: {},
  }]);
  const res = await importar(ADMIN_TOKEN, xlsxBuffer([
    fila(),
    fila({ nombre: 'NUEVA', telefono: 525511112222 }),
  ]), 'Jaime Abaroa');
  assert.equal(res.status, 200);
  assert.equal(res.body.importados, 1);
  assert.deepEqual(res.body.descartados, [{ fila: 2, nombre: 'OMAR OLVERA', motivo: 'ya es prospecto' }]);
  assert.equal(readProspectos().length, 2);
});

test('celular de cliente Operam se descarta con motivo "ya es cliente"', async () => {
  writeProspectos([]);
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': () => jsonResponse({
      total: 1,
      data: [{ customer_id: '77', CustName: 'HOTELERA DEL SUR SA DE CV', contacts: [{ phone: '+52 5512952080' }], branches: [] }],
    }),
  });
  const res = await importar(ADMIN_TOKEN, xlsxBuffer([
    fila(),
    fila({ nombre: 'NUEVA', telefono: 525511112222 }),
  ]), 'Jaime Abaroa');
  assert.equal(res.status, 200);
  assert.equal(res.body.importados, 1);
  assert.deepEqual(res.body.descartados, [{ fila: 2, nombre: 'OMAR OLVERA', motivo: 'ya es cliente' }]);
  assert.equal(readProspectos().length, 1);
});

test('si el indice de Operam falla, las filas se importan igual (best effort)', async () => {
  writeProspectos([]);
  const res = await importar(ADMIN_TOKEN, xlsxBuffer([fila()]), 'Jaime Abaroa');
  assert.equal(res.status, 200);
  assert.equal(res.body.importados, 1);
  assert.equal(readProspectos().length, 1);
});

test('el reporte acumula los descartes del parser (telefono invalido, duplicado interno)', async () => {
  writeProspectos([]);
  const res = await importar(ADMIN_TOKEN, xlsxBuffer([
    fila(),
    fila({ nombre: 'SINTEL', telefono: '' }),
    fila({ nombre: 'REPETIDA', telefono: 5512952080 }),
  ]), 'Jaime Abaroa');
  assert.equal(res.status, 200);
  assert.equal(res.body.importados, 1);
  assert.deepEqual(res.body.descartados, [
    { fila: 3, nombre: 'SINTEL OLVERA', motivo: 'telefono invalido' },
    { fila: 4, nombre: 'REPETIDA OLVERA', motivo: 'duplicado en archivo' },
  ]);
});

test('sin vendedor en el body, el default es quien importa', async () => {
  writeProspectos([]);
  const res = await importar(ADMIN_TOKEN, xlsxBuffer([fila()]));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.porVendedor, { Tester: 1 });
  assert.equal(readProspectos()[0].vendedor, 'Tester');
});

test('sin archivo responde 400; archivo sin hoja Contactos responde 400', async () => {
  writeProspectos([]);
  const sinArchivo = await importar(ADMIN_TOKEN, null, 'Jaime Abaroa');
  assert.equal(sinArchivo.status, 400);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), 'Otra');
  const malo = await importar(ADMIN_TOKEN, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), 'Jaime Abaroa');
  assert.equal(malo.status, 400);
  assert.match(malo.body.error, /Contactos/);
  assert.equal(readProspectos().length, 0);
});

test('la importacion es solo admin: vendedor 403, sin token 401', async () => {
  writeProspectos([]);
  const vendedor = await importar(MEMO_TOKEN, xlsxBuffer([fila()]), 'Memo');
  assert.equal(vendedor.status, 403);
  const sinToken = await supertest(app).post('/api/admin/prospectos/importar');
  assert.equal(sinToken.status, 401);
  assert.equal(readProspectos().length, 0);
});
