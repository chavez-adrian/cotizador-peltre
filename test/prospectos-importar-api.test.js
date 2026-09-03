import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync, borrarArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import XLSX from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROSPECTOS_PATH = join(__dirname, '..', 'data', 'prospectos.json');
const VENDEDORES_PATH = join(__dirname, '..', 'data', 'vendedores.json');
const CONFIG_PATH = join(__dirname, '..', 'data', 'config.json');

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

const EVENTO = 'Abastur 2026';

function readProspectos() {
  if (!existsSync(PROSPECTOS_PATH)) return [];
  return JSON.parse(leerArchivoSync(PROSPECTOS_PATH));
}
function writeProspectos(data) {
  escribirArchivoSync(PROSPECTOS_PATH, JSON.stringify(data, null, 2));
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

// vendedores.json controlado: el match por "Exhibitor member" no debe depender
// de la nomina real. Se restaura integro al final.
const VENDEDORES_TEST = [
  { id: 1, name: 'Tester', pin: '0000', role: 'admin', operam_id: 1 },
  { id: 2, name: 'Oswaldo Chávez', pin: '1111', role: 'vendedor', operam_id: 8 },
  { id: 3, name: 'Jaime Abaroa', pin: '2222', role: 'vendedor', operam_id: null },
];

let savedProspectos, existiaProspectos, savedVendedores, savedConfig;
before(() => {
  existiaProspectos = existsSync(PROSPECTOS_PATH);
  savedProspectos = readProspectos();
  savedVendedores = leerArchivoSync(VENDEDORES_PATH);
  savedConfig = leerArchivoSync(CONFIG_PATH);
  escribirArchivoSync(VENDEDORES_PATH, JSON.stringify(VENDEDORES_TEST, null, 2));
  // El evento activo (issue #261) etiqueta todo lo que entra por la feria: la
  // importacion lo lee de config.json igual que la captura de expo.
  escribirArchivoSync(CONFIG_PATH, JSON.stringify({
    ...JSON.parse(savedConfig), eventoActivo: { nombre: EVENTO, fin: '2026-09-18' },
  }, null, 2));
  globalThis.fetch = fetchBloqueado;
});
after(() => {
  if (existiaProspectos) writeProspectos(savedProspectos);
  else if (existsSync(PROSPECTOS_PATH)) borrarArchivoSync(PROSPECTOS_PATH);
  escribirArchivoSync(VENDEDORES_PATH, savedVendedores);
  escribirArchivoSync(CONFIG_PATH, savedConfig);
  globalThis.fetch = originalFetch;
});
beforeEach(() => {
  globalThis.fetch = fetchBloqueado;
  resetIndice();
  resetSession();
});

// Columnas EXACTAS del export real de Abastur (hoja "Contacts"), datos
// anonimizados.
const HEADERS = ['First name', 'Last name', 'Job title', 'Company', 'Email', 'Mobile phone',
  'City', 'State', 'Country', 'Actividad principal de la empresa (es)', 'Puesto (es)',
  'Tamaño de la empresa (es)', 'Decisión de compra (es)', 'Scoring', 'Note',
  'Exhibitor member (first connection)', 'First connection date'];

// 45916.48055555556 = 16/09/2025 11:32:00 en el serial de Excel.
const SERIAL = 45916.48055555556;

function fila(o = {}) {
  return [
    o.nombre ?? 'OMAR', o.apellido ?? 'OLVERA', o.jobTitle ?? '', o.empresa ?? 'VIANDA CONSULTORES',
    o.correo ?? 'omar@vianda.mx', o.celular ?? '+52 55 1242 1575', o.ciudad ?? 'HUIXQUILUCAN',
    'MEXICO', 'Mexico', o.actividad ?? '', o.puesto ?? '', o.tamano ?? '', o.decision ?? '',
    o.scoring ?? '', o.nota ?? '', o.expositor ?? '', o.fecha ?? SERIAL,
  ];
}

function xlsxBuffer(filas) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADERS, ...filas]), 'Contacts');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADERS, ...filas]), 'incl. duplicates');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function importar(token, buffer, vendedor) {
  const req = supertest(app).post('/api/admin/prospectos/importar')
    .set('Authorization', `Bearer ${token}`);
  if (buffer) req.attach('archivo', buffer, 'contacts.xlsx');
  if (vendedor) req.field('vendedor', vendedor);
  return req;
}

function prospectoDeStand(extra = {}) {
  return {
    id: 1, fecha: '2026-09-16T18:00:00Z', vendedor: 'Oswaldo Chávez', celular: '+52 5512421575',
    celular10: '5512421575', nombre: 'Omar O.', ciudad: '', canal: 'Feria/Expo',
    etapa: 'por_cotizar', eventos: [],
    data: { evento: EVENTO, tipo_cliente: 'Hoteles', segmento_id: 10, temperatura: 5, notas: 'Pidio tazas', ...extra },
  };
}

test('una fila nueva nace como prospecto del "Exhibitor member", con evento, tipo de cliente, temperatura y notas', async () => {
  writeProspectos([]);
  const antes = new Date();
  const res = await importar(ADMIN_TOKEN, xlsxBuffer([
    fila({
      expositor: 'Oswaldo', actividad: 'Restaurante', scoring: 4, nota: 'Quiere catalogo',
      puesto: 'Dueño / Socio', tamano: 'De 11 a 50 empleados', decision: 'Decido',
    }),
  ]), 'Jaime Abaroa');
  assert.equal(res.status, 200);
  assert.equal(res.body.importados, 1);
  assert.equal(res.body.enriquecidos, 0);
  assert.deepEqual(res.body.porVendedor, { 'Oswaldo Chávez': 1 });
  const guardados = readProspectos();
  assert.equal(guardados.length, 1);
  const p = guardados[0];
  assert.equal(p.vendedor, 'Oswaldo Chávez');
  assert.equal(p.nombre, 'Omar Olvera');
  assert.equal(p.celular, '+52 5512421575');
  assert.equal(p.ciudad, 'Huixquilucan');
  assert.equal(p.canal, 'Feria/Expo');
  assert.equal(p.etapa, 'por_cotizar');
  assert.equal(p.data.evento, EVENTO);
  assert.equal(p.data.tipo_cliente, 'Restaurantes');
  assert.equal(p.data.segmento_id, 10);
  assert.equal(p.data.temperatura, 4);
  assert.equal(p.data.correo, 'omar@vianda.mx');
  assert.equal(p.data.empresa, 'Vianda Consultores');
  assert.equal(p.data.escaneado, '2025-09-16T11:32:00.000Z');
  assert.equal(p.data.notas,
    'Quiere catalogo\nPuesto: Dueño / Socio | Tamaño de empresa: De 11 a 50 empleados | Decisión de compra: Decido');
  // fecha = momento de la importacion, no la del escaneo (2025)
  assert.ok(new Date(p.fecha) >= new Date(antes.toISOString()));
});

test('un celular que ya es prospecto se enriquece: rellena vacios, no pisa el stand y agrega la nota', async () => {
  writeProspectos([prospectoDeStand()]);
  const res = await importar(ADMIN_TOKEN, xlsxBuffer([
    fila({ actividad: 'Hotel', scoring: 1, nota: 'Pidio precio de jarros', ciudad: 'PUEBLA' }),
  ]), 'Jaime Abaroa');
  assert.equal(res.status, 200);
  assert.equal(res.body.importados, 0);
  assert.equal(res.body.enriquecidos, 1);
  const guardados = readProspectos();
  assert.equal(guardados.length, 1);
  const p = guardados[0];
  // Lo capturado en el stand queda intacto
  assert.equal(p.nombre, 'Omar O.');
  assert.equal(p.vendedor, 'Oswaldo Chávez');
  assert.equal(p.data.temperatura, 5);
  assert.equal(p.data.tipo_cliente, 'Hoteles');
  assert.equal(p.data.segmento_id, 10);
  // Lo vacio se rellena, con el texto YA normalizado (#293)
  assert.equal(p.ciudad, 'Puebla');
  assert.equal(p.data.correo, 'omar@vianda.mx');
  assert.equal(p.data.empresa, 'Vianda Consultores');
  // La nota se agrega, no reemplaza
  assert.equal(p.data.notas, 'Pidio tazas\nPidio precio de jarros');
  // La importacion queda en el historial
  const importado = p.eventos.find(e => e.tipo === 'importado');
  assert.ok(importado);
  assert.equal(importado.evento, EVENTO);
});

// Issue #293: el enriquecimiento escribia la empresa CRUDA del export. Es el
// camino por el que 8 de los 14 prospectos capturados en el stand de Abastur
// terminaron con la empresa gritando.
test('el enriquecimiento guarda la empresa del export titulada y no altera la que ya viene en mezcla', async () => {
  writeProspectos([prospectoDeStand()]);
  await importar(ADMIN_TOKEN, xlsxBuffer([
    fila({ empresa: 'DORADOS CONVENTION & RESORT' }),
  ]), 'Jaime Abaroa');
  assert.equal(readProspectos()[0].data.empresa, 'Dorados Convention & Resort');

  writeProspectos([prospectoDeStand()]);
  await importar(ADMIN_TOKEN, xlsxBuffer([
    fila({ empresa: "McDonald's Insurgentes" }),
  ]), 'Jaime Abaroa');
  assert.equal(readProspectos()[0].data.empresa, "McDonald's Insurgentes");
});

test('re-importar el mismo archivo no duplica la nota que el prospecto ya tiene (issue #277)', async () => {
  writeProspectos([prospectoDeStand()]);
  const buffer = xlsxBuffer([fila({ actividad: 'Hotel', scoring: 1, nota: 'Pidio precio de jarros' })]);
  const res1 = await importar(ADMIN_TOKEN, buffer, 'Jaime Abaroa');
  assert.equal(res1.body.enriquecidos, 1);
  const res2 = await importar(ADMIN_TOKEN, buffer, 'Jaime Abaroa');
  assert.equal(res2.status, 200);
  assert.equal(res2.body.enriquecidos, 1);
  const p = readProspectos()[0];
  assert.equal(p.data.notas, 'Pidio tazas\nPidio precio de jarros');
});

test('el cruce por correo de un gafete sin celular tampoco duplica la nota en una segunda pasada', async () => {
  writeProspectos([prospectoDeStand({ correo: 'omar@vianda.mx', notas: undefined })]);
  const buffer = xlsxBuffer([fila({ celular: '', correo: 'omar@vianda.mx', nota: 'Dejo tarjeta' })]);
  await importar(ADMIN_TOKEN, buffer, 'Jaime Abaroa');
  await importar(ADMIN_TOKEN, buffer, 'Jaime Abaroa');
  const p = readProspectos()[0];
  assert.equal(p.data.notas, 'Dejo tarjeta');
});

test('el prospecto sin tipo de cliente ni temperatura si los toma del export', async () => {
  writeProspectos([prospectoDeStand({ tipo_cliente: undefined, segmento_id: undefined, temperatura: undefined })]);
  const res = await importar(ADMIN_TOKEN, xlsxBuffer([
    fila({ actividad: 'Cafetería', scoring: 3 }),
  ]), 'Jaime Abaroa');
  assert.equal(res.status, 200);
  assert.equal(res.body.enriquecidos, 1);
  const p = readProspectos()[0];
  assert.equal(p.data.tipo_cliente, 'Cafeterías');
  assert.equal(p.data.segmento_id, 10);
  assert.equal(p.data.temperatura, 3);
});

test('un celular que ya es cliente de Operam se descarta con motivo', async () => {
  writeProspectos([]);
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': () => jsonResponse({
      total: 1,
      data: [{ customer_id: '77', CustName: 'HOTELERA DEL SUR SA DE CV', contacts: [{ phone: '+52 5512421575' }], branches: [] }],
    }),
  });
  const res = await importar(ADMIN_TOKEN, xlsxBuffer([
    fila(),
    fila({ nombre: 'NUEVA', celular: '5511112222' }),
  ]), 'Jaime Abaroa');
  assert.equal(res.status, 200);
  assert.equal(res.body.importados, 1);
  assert.deepEqual(res.body.descartados, [{ fila: 2, nombre: 'Omar Olvera', motivo: 'ya es cliente' }]);
  assert.equal(readProspectos().length, 1);
});

test('el gafete sin celular cruza por correo contra los prospectos del evento; el que no cruza sale en el reporte', async () => {
  writeProspectos([
    prospectoDeStand({ correo: 'omar@vianda.mx' }),
    {
      id: 2, fecha: '2026-01-02T00:00:00Z', vendedor: 'Memo', celular: '+52 5599887766',
      celular10: '5599887766', nombre: 'Luz Vieja', ciudad: 'CDMX', canal: 'WhatsApp',
      etapa: 'por_cotizar', eventos: [], data: { correo: 'luz@hotelb.mx' },
    },
  ]);
  const res = await importar(ADMIN_TOKEN, xlsxBuffer([
    fila({ celular: '', correo: 'omar@vianda.mx', nota: 'Dejo tarjeta' }),
    fila({ celular: '', correo: 'luz@hotelb.mx', nombre: 'LUZ', apellido: 'RAMOS' }),
    fila({ celular: '', correo: 'nadie@ajeno.mx', nombre: 'RAUL', apellido: 'DIAZ', empresa: 'ABARROTES RD', scoring: 2 }),
  ]), 'Jaime Abaroa');
  assert.equal(res.status, 200);
  assert.equal(res.body.importados, 0);
  assert.equal(res.body.enriquecidos, 1);
  assert.deepEqual(res.body.sinCelular, [
    { fila: 3, nombre: 'Luz Ramos', empresa: 'Vianda Consultores', correo: 'luz@hotelb.mx', scoring: '' },
    { fila: 4, nombre: 'Raul Diaz', empresa: 'Abarrotes Rd', correo: 'nadie@ajeno.mx', scoring: 2 },
  ]);
  const guardados = readProspectos();
  assert.equal(guardados.length, 2);
  assert.equal(guardados[0].data.correo, 'omar@vianda.mx');
  assert.match(guardados[0].data.notas, /Dejo tarjeta/);
  // El prospecto de otro evento (o sin evento) no se toca aunque el correo coincida
  assert.equal(guardados[1].data.notas, undefined);
});

test('el reporte acumula los descartes del parser y suma por vendedor', async () => {
  writeProspectos([]);
  const res = await importar(ADMIN_TOKEN, xlsxBuffer([
    fila({ expositor: 'Oswaldo' }),
    fila({ nombre: 'ILEGIBLE', celular: '12345' }),
    fila({ nombre: 'REPETIDA', celular: '5512421575' }),
    fila({ nombre: 'ROSA', celular: '5533334444' }),
  ]), 'Jaime Abaroa');
  assert.equal(res.status, 200);
  assert.equal(res.body.importados, 2);
  assert.deepEqual(res.body.porVendedor, { 'Oswaldo Chávez': 1, 'Jaime Abaroa': 1 });
  assert.deepEqual(res.body.descartados, [
    { fila: 3, nombre: 'Ilegible Olvera', motivo: 'telefono invalido' },
    { fila: 4, nombre: 'Repetida Olvera', motivo: 'duplicado en archivo' },
  ]);
});

test('sin vendedor en el body, el default es quien importa', async () => {
  writeProspectos([]);
  const res = await importar(ADMIN_TOKEN, xlsxBuffer([fila()]));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.porVendedor, { Tester: 1 });
  assert.equal(readProspectos()[0].vendedor, 'Tester');
});

test('si el indice de Operam falla, las filas se importan igual (best effort)', async () => {
  writeProspectos([]);
  const res = await importar(ADMIN_TOKEN, xlsxBuffer([fila()]), 'Jaime Abaroa');
  assert.equal(res.status, 200);
  assert.equal(res.body.importados, 1);
  assert.equal(readProspectos().length, 1);
});

test('sin archivo responde 400; archivo sin hoja Contacts responde 400', async () => {
  writeProspectos([]);
  const sinArchivo = await importar(ADMIN_TOKEN, null, 'Jaime Abaroa');
  assert.equal(sinArchivo.status, 400);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), 'Otra');
  const malo = await importar(ADMIN_TOKEN, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), 'Jaime Abaroa');
  assert.equal(malo.status, 400);
  assert.match(malo.body.error, /Contacts/);
  assert.equal(readProspectos().length, 0);
});

test('la respuesta propaga los avisos de forma del archivo (issue #277)', async () => {
  writeProspectos([]);
  const res = await importar(ADMIN_TOKEN, xlsxBuffer([
    fila({ actividad: 'Tienda de autoservicio' }),
  ]), 'Jaime Abaroa');
  assert.equal(res.status, 200);
  assert.ok(res.body.avisos);
  assert.deepEqual(res.body.avisos.actividadesSinMapeo, [{ actividad: 'Tienda de autoservicio', filas: 1 }]);
  assert.ok(Array.isArray(res.body.avisos.columnasNoEncontradas));
});

test('la importacion es solo admin: vendedor 403, sin token 401', async () => {
  writeProspectos([]);
  const vendedor = await importar(MEMO_TOKEN, xlsxBuffer([fila()]), 'Memo');
  assert.equal(vendedor.status, 403);
  const sinToken = await supertest(app).post('/api/admin/prospectos/importar');
  assert.equal(sinToken.status, 401);
  assert.equal(readProspectos().length, 0);
});

// Los textos que este importador guardo ANTES de aplicar la regla de la casa
// quedaron como venian del gafete (MAYUSCULAS) y de ahi pasaron a la libreta de
// Google. Volver a subir el export los corrige: capitalizar no cambia el dato,
// solo como esta escrito, y la regla es la misma "venga de donde venga la
// captura". Sin esto, los 99 nombres de empresa ya importados se quedan en
// mayusculas para siempre, porque el enriquecimiento solo escribe sobre vacio.
test('re-importar corrige las MAYUSCULAS que el importador viejo dejo guardadas', async () => {
  writeProspectos([prospectoDeStand({ empresa: 'LOS ANTOJOS DEL GORDO', correo: 'Omar@VIANDA.MX' })]);
  const guardadoAntes = readProspectos()[0];
  guardadoAntes.nombre = 'OMAR OLVERA';
  guardadoAntes.ciudad = 'TLALNEPANTLA DE BAZ';
  writeProspectos([guardadoAntes]);

  const res = await importar(ADMIN_TOKEN, xlsxBuffer([fila({ actividad: 'Hotel' })]), 'Jaime Abaroa');
  assert.equal(res.status, 200);
  assert.equal(res.body.enriquecidos, 1);
  const p = readProspectos()[0];
  assert.equal(p.data.empresa, 'Los Antojos del Gordo');
  assert.equal(p.ciudad, 'Tlalnepantla de Baz');
  assert.equal(p.nombre, 'Omar Olvera');
  assert.equal(p.data.correo, 'omar@vianda.mx');
  // Las notas del vendedor NO se tocan: son texto suyo, no un campo de identidad.
  assert.equal(p.data.notas, 'Pidio tazas');
});

test('la correccion de mayusculas es idempotente y no toca lo que ya esta bien escrito', async () => {
  writeProspectos([prospectoDeStand({ empresa: 'Casa Maguey' })]);
  const buffer = xlsxBuffer([fila({ actividad: 'Hotel' })]);
  await importar(ADMIN_TOKEN, buffer, 'Jaime Abaroa');
  const primera = readProspectos()[0];
  await importar(ADMIN_TOKEN, buffer, 'Jaime Abaroa');
  const segunda = readProspectos()[0];
  assert.equal(primera.data.empresa, 'Casa Maguey');
  assert.equal(segunda.data.empresa, 'Casa Maguey');
  assert.equal(segunda.nombre, primera.nombre);
});
