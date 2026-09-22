// Destinos de Dropbox por flujo (#357, padre #354). La suite NO toca red ni
// credenciales reales: las tres DROPBOX_* se montan con valores de mentira y
// todo el trafico lo intercepta el mock por URL (mismo patron que
// test/contactos-io.test.js). Las variables de destino (DROPBOX_NS_* /
// DROPBOX_PATH_*) se ponen y se quitan por test: el caso "sin configurar" es
// justo el que hay que poder medir.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { leerArchivoSync, escribirArchivoSync } from '../lib/fs-reintento.js';
import { fotoDatos } from './helpers/datos-aislados.js';

process.env.DROPBOX_REFRESH_TOKEN = 'refresh-de-prueba';
process.env.DROPBOX_APP_KEY = 'key-de-prueba';
process.env.DROPBOX_APP_SECRET = 'secreto-de-prueba';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COTS_PATH = join(__dirname, '..', 'data', 'cotizaciones.json');
const DROPBOX_SUBIDAS_PATH = join(__dirname, '..', 'data', 'dropbox-subidas.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const { upload, subirCsfDropbox } = await import('../lib/dropbox.js');
const { app } = await import('../server.js');
const ADMIN_TOKEN = jwt.sign({ id: 99, name: 'Tester', role: 'admin' }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '1h' });

const VARS_DESTINO = [
  'DROPBOX_NS_CSF', 'DROPBOX_PATH_CSF',
  'DROPBOX_NS_CALCA', 'DROPBOX_PATH_CALCA',
  'DROPBOX_NS_BITRIX', 'DROPBOX_PATH_BITRIX',
  'BITRIX_EXPORT_DROPBOX_PATH',
];

const originalFetch = globalThis.fetch;
const guardado = {};
let subidas = [];

before(() => { for (const v of VARS_DESTINO) guardado[v] = process.env[v]; });
beforeEach(() => { for (const v of VARS_DESTINO) delete process.env[v]; });
after(() => {
  globalThis.fetch = originalFetch;
  for (const v of VARS_DESTINO) {
    if (guardado[v] === undefined) delete process.env[v];
    else process.env[v] = guardado[v];
  }
});

function respuesta(data, status = 200) {
  return {
    ok: status < 400, status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

// Mock por URL: el refresh del token y la subida son endpoints distintos, asi
// que `subidas` cuenta SOLO las subidas -- es lo que permite afirmar que ante
// un fallo no sale una segunda peticion.
function mockDropbox({ status = 200, cuerpo = { path_display: '/subido.pdf' } } = {}) {
  subidas = [];
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('oauth2/token')) return respuesta({ access_token: 'token-de-prueba', expires_in: 14400 });
    if (u.includes('/files/upload')) {
      subidas.push({ url: u, headers: opts.headers, body: opts.body });
      return respuesta(cuerpo, status);
    }
    throw new Error('Unmocked fetch: ' + u);
  };
}

const argDe = (subida) => JSON.parse(subida.headers['Dropbox-API-Arg']);

// La peticion de hoy, medida en el codigo anterior a #357: ruta absoluta dentro
// del sandbox de la app. Se escribe con \u porque el repo es ASCII estricto y
// la cadena tiene que viajar identica (con acento) para que la subida caiga
// donde caia.
const CSF_SANDBOX = '/PELTRE NACIONAL/3.0 ADMINISTRACI\u00d3N/CONTABILIDAD/PNA170810CF1/CONSTANCIA SITUACION FISCAL CLIENTES';
const CALCA_SANDBOX = '/1.0 Comercializaci\u00f3n/DISE\u00d1O/CALCAS/OT Decorado';

function capturarAvisos() {
  const original = console.warn;
  const avisos = [];
  console.warn = (...args) => { avisos.push(args.join(' ')); };
  return { avisos, restaurar: () => { console.warn = original; } };
}

test('CSF con las dos variables: la peticion lleva el namespace en el header y la ruta relativa', async () => {
  process.env.DROPBOX_NS_CSF = '9876543210';
  process.env.DROPBOX_PATH_CSF = '/CONSTANCIA SITUACION FISCAL CLIENTES';
  mockDropbox();
  await subirCsfDropbox(Buffer.from('pdf de mentira').toString('base64'), 'XAXX010101000', 'Cocinas del Valle');
  assert.equal(subidas.length, 1);
  assert.equal(
    subidas[0].headers['Dropbox-API-Path-Root'],
    '{".tag":"namespace_id","namespace_id":"9876543210"}'
  );
  assert.equal(argDe(subidas[0]).path, '/CONSTANCIA SITUACION FISCAL CLIENTES/XAXX010101000 - Cocinas del Valle.pdf');
});

test('CSF sin ninguna variable nueva: misma ruta absoluta de hoy y sin header Dropbox-API-Path-Root', async () => {
  mockDropbox();
  const { avisos, restaurar } = capturarAvisos();
  try {
    await subirCsfDropbox(Buffer.from('pdf de mentira').toString('base64'), 'XAXX010101000', 'Cocinas del Valle');
  } finally { restaurar(); }
  assert.equal(subidas.length, 1);
  assert.equal(subidas[0].headers['Dropbox-API-Path-Root'], undefined);
  assert.equal(
    subidas[0].headers['Dropbox-API-Arg'],
    JSON.stringify({ path: `${CSF_SANDBOX}/XAXX010101000 - Cocinas del Valle.pdf`, mode: 'add', autorename: true })
  );
  // La advertencia es la superficie de observabilidad mientras #356 no existe.
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /csf/);
  assert.match(avisos[0], /sandbox/);
});

test('CSF con una sola de las dos variables se trata como no configurado', async () => {
  process.env.DROPBOX_NS_CSF = '9876543210';
  mockDropbox();
  await subirCsfDropbox(Buffer.from('pdf').toString('base64'), 'XAXX010101000', 'Cocinas del Valle');
  assert.equal(subidas[0].headers['Dropbox-API-Path-Root'], undefined);
  assert.equal(argDe(subidas[0]).path, `${CSF_SANDBOX}/XAXX010101000 - Cocinas del Valle.pdf`);

  delete process.env.DROPBOX_NS_CSF;
  process.env.DROPBOX_PATH_CSF = '/CONSTANCIA SITUACION FISCAL CLIENTES';
  mockDropbox();
  await subirCsfDropbox(Buffer.from('pdf').toString('base64'), 'XAXX010101000', 'Cocinas del Valle');
  assert.equal(subidas[0].headers['Dropbox-API-Path-Root'], undefined);
  assert.equal(argDe(subidas[0]).path, `${CSF_SANDBOX}/XAXX010101000 - Cocinas del Valle.pdf`);
});

test('CSF configurado y Dropbox responde error: la promesa rechaza y no sale una segunda peticion', async () => {
  process.env.DROPBOX_NS_CSF = '9876543210';
  process.env.DROPBOX_PATH_CSF = '/CONSTANCIA SITUACION FISCAL CLIENTES';
  mockDropbox({ status: 409, cuerpo: { error_summary: 'path/not_found/' } });
  await assert.rejects(
    () => subirCsfDropbox(Buffer.from('pdf').toString('base64'), 'XAXX010101000', 'Cocinas del Valle'),
    /Dropbox 409/
  );
  assert.equal(subidas.length, 1);
});

// --- Flujo de calca, en su costura HTTP: el paso 6 del checklist de decorado
// dispara la subida FIRE-AND-FORGET (#61). Se mide ahi para probar de paso que
// el rechazo se traga arriba y no altera la respuesta.

function leerCots() {
  if (!existsSync(COTS_PATH)) return [];
  return JSON.parse(leerArchivoSync(COTS_PATH));
}
function escribirCots(datos) {
  escribirArchivoSync(COTS_PATH, JSON.stringify(datos, null, 2));
}

// #411: los data/*.json que esta suite escribe quedan como se los encontro, el
// ausente incluido. El registro de subidas a Dropbox (#356) entra aqui porque
// cada subida le agrega su fila sin que nadie se lo pida, y el archivo esta en
// .gitignore: el residuo no sale en git status.
let restaurarDatos;
before(() => { restaurarDatos = fotoDatos([COTS_PATH, DROPBOX_SUBIDAS_PATH]); });
after(() => { restaurarDatos(); });

function cotizacionDecorada() {
  return [{
    id: 1, fecha: new Date().toISOString(), vendedor: 'Memo', cliente: 'RESTAURANTE LA LUPITA',
    totalPiezas: 200, total: 15000, tier: 'M100', items: [],
    data: { decorado: true, cliente: { referencia: 'Cocinas del Valle' } },
  }];
}

async function esperarSubidas(minimo) {
  for (let i = 0; i < 50 && subidas.length < minimo; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('calca configurada: la subida lleva el header y el fallo de Dropbox no altera la respuesta HTTP', async () => {
  process.env.DROPBOX_NS_CALCA = '1122334455';
  process.env.DROPBOX_PATH_CALCA = '/OT Decorado';
  escribirCots(cotizacionDecorada());
  mockDropbox({ status: 500, cuerpo: { error_summary: 'internal_error' } });
  const res = await supertest(app).patch('/api/cotizacion/1/calca-paso')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
    .send({ paso: 'archivos_dropbox', completo: true, archivos: [{ nombre: 'posicion.pdf', contenidoBase64: 'aGVsbG8=' }] });
  assert.equal(res.status, 200);
  await esperarSubidas(1);
  assert.equal(subidas.length, 1);
  assert.equal(subidas[0].headers['Dropbox-API-Path-Root'], '{".tag":"namespace_id","namespace_id":"1122334455"}');
  assert.equal(argDe(subidas[0]).path, '/OT Decorado/Cocinas del Valle - Pedido 1.pdf');
  // El fallo NO reintenta contra la ruta de texto: eso seria el bug de #354.
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(subidas.length, 1);
  assert.equal(leerCots().find(c => c.id === 1).data.calcaChecklist.find(p => p.clave === 'archivos_dropbox').completo, true);
});

test('calca sin configurar: misma ruta absoluta de hoy y sin header', async () => {
  escribirCots(cotizacionDecorada());
  mockDropbox();
  const res = await supertest(app).patch('/api/cotizacion/1/calca-paso')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
    .send({ paso: 'archivos_dropbox', completo: true, archivos: [{ nombre: 'posicion.pdf', contenidoBase64: 'aGVsbG8=' }] });
  assert.equal(res.status, 200);
  await esperarSubidas(1);
  assert.equal(subidas.length, 1);
  assert.equal(subidas[0].headers['Dropbox-API-Path-Root'], undefined);
  assert.equal(argDe(subidas[0]).path, `${CALCA_SANDBOX}/Cocinas del Valle - Pedido 1.pdf`);
});

// --- Flujo del backup de Bitrix (scripts/export-bitrix.mjs). El script no es
// importable (no exporta nada y su main() descarga el CRM entero), asi que se
// mide su destino en la costura generica que usa.

test('bitrix configurado: header con namespace y ruta relativa; sin configurar, la heredada', async () => {
  process.env.DROPBOX_NS_BITRIX = '6677889900';
  process.env.DROPBOX_PATH_BITRIX = '/BACKUP BITRIX24';
  mockDropbox();
  await upload({ flujo: 'bitrix', archivo: '2026-08-16/leads.json' }, '[]', 'overwrite');
  assert.equal(subidas[0].headers['Dropbox-API-Path-Root'], '{".tag":"namespace_id","namespace_id":"6677889900"}');
  assert.equal(
    subidas[0].headers['Dropbox-API-Arg'],
    JSON.stringify({ path: '/BACKUP BITRIX24/2026-08-16/leads.json', mode: 'overwrite', autorename: false })
  );

  delete process.env.DROPBOX_NS_BITRIX;
  delete process.env.DROPBOX_PATH_BITRIX;
  mockDropbox();
  await upload({ flujo: 'bitrix', archivo: '2026-08-16/leads.json' }, '[]', 'overwrite');
  assert.equal(subidas[0].headers['Dropbox-API-Path-Root'], undefined);
  assert.equal(argDe(subidas[0]).path, '/PELTRE NACIONAL/3.0 ADMINISTRACION/CRM/BACKUP BITRIX24/2026-08-16/leads.json');
});

test('bitrix sin variables nuevas sigue respetando BITRIX_EXPORT_DROPBOX_PATH, como hoy', async () => {
  process.env.BITRIX_EXPORT_DROPBOX_PATH = '/OTRO DESTINO/BITRIX/';
  mockDropbox();
  await upload({ flujo: 'bitrix', archivo: '2026-08-16/leads.json' }, '[]', 'overwrite');
  assert.equal(subidas[0].headers['Dropbox-API-Path-Root'], undefined);
  assert.equal(argDe(subidas[0]).path, '/OTRO DESTINO/BITRIX/2026-08-16/leads.json');
});

// AC "ninguna ruta absoluta de destino queda incrustada en el codigo": las
// rutas heredadas viven SOLO en lib/dropbox-destinos.js, que es quien las
// declara como respaldo por ausencia de configuracion.
test('ningun flujo lleva su ruta de destino incrustada', () => {
  const fragmentos = ['PELTRE NACIONAL/3.0', 'OT Decorado', 'BACKUP BITRIX24', 'CONSTANCIA SITUACION FISCAL CLIENTES'];
  for (const archivo of ['server.js', 'lib/dropbox.js', 'scripts/export-bitrix.mjs']) {
    const fuente = readFileSync(join(__dirname, '..', archivo), 'utf8');
    for (const fragmento of fragmentos) {
      assert.equal(fuente.includes(fragmento), false, `${archivo} incrusta el destino "${fragmento}"`);
    }
  }
});
