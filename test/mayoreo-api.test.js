import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync, borrarArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROSPECTOS_PATH = join(__dirname, '..', 'data', 'prospectos.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const { app } = await import('../server.js');
const { resetIndice } = await import('../lib/indice-telefonos.js');
const { resetSession } = await import('../lib/operam-client.js');
const { resetRateLimitPublico, MAX_CAPTURAS_POR_IP } = await import('../lib/rate-limit-publico.js');

function readProspectos() {
  if (!existsSync(PROSPECTOS_PATH)) return [];
  return JSON.parse(leerArchivoSync(PROSPECTOS_PATH));
}
function writeProspectos(data) {
  escribirArchivoSync(PROSPECTOS_PATH, JSON.stringify(data, null, 2));
}

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

const CLIENTE_OPERAM = { debtor_no: 501, cust_name: 'Hotel Azul SA', phone: '5512345678' };
function mockListadoClientes(clientes) {
  resetSession();
  resetIndice();
  mockOperamFetch({
    '/api/v3/login': () => jsonResponse({ token: 'tok', result: true }),
    '/api/v3/sales/customers': () => jsonResponse({ total: clientes.length, data: clientes }),
  });
}

// Formulario valido de referencia. Cada test cambia solo lo que le importa.
function formulario(extra = {}) {
  return {
    tipo: 'Restaurantes', otro: '', empresa: 'Hotel Azul',
    cant: '+350', cp: '56530', ciudad: 'Ixtapaluca',
    cuando: 'En los próximos 3 meses',
    nombre: 'Laura', apellido: 'Mendoza', cargo: 'Compras',
    celCode: '+52', cel: '5512345678', correo: 'laura@gmail.com',
    web: '@hotelazul', promos: false,
    ...extra,
  };
}

function enviar(body) {
  return supertest(app).post('/api/prospectos/publico').send(body);
}

let savedProspectos;
let existia;
before(() => {
  existia = existsSync(PROSPECTOS_PATH);
  savedProspectos = readProspectos();
  globalThis.fetch = fetchBloqueado;
});
after(() => {
  if (existia) writeProspectos(savedProspectos);
  else if (existsSync(PROSPECTOS_PATH)) borrarArchivoSync(PROSPECTOS_PATH);
  globalThis.fetch = originalFetch;
});
beforeEach(() => {
  globalThis.fetch = fetchBloqueado;
  resetIndice();
  resetSession();
  resetRateLimitPublico();
  writeProspectos([]);
});

function prospectoExistente(extra = {}) {
  return {
    id: 1, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', celular: '+52 5512345678',
    celular10: '5512345678', nombre: 'Laura Mendoza', ciudad: 'Ixtapaluca',
    canal: 'WhatsApp', etapa: 'por_cotizar', data: {}, eventos: [],
    ...extra,
  };
}

// --- Rama 1: captura nueva ---

test('W1: la captura publica crea la tarjeta en No Asignado, sin dueno y con canal Formulario web', async () => {
  const res = await enviar(formulario());
  assert.equal(res.status, 200);
  const p = readProspectos()[0];
  assert.equal(p.etapa, 'no_asignado');
  assert.equal(p.vendedor, null);
  assert.equal(p.canal, 'Formulario web');
  assert.equal(p.nombre, 'Laura Mendoza');
  assert.equal(p.ciudad, 'Ixtapaluca');
  assert.equal(p.celular, '+52 5512345678');
});

test('W2: la captura publica guarda segmento, piezas, cp, cuando y web en data', async () => {
  await enviar(formulario());
  const d = readProspectos()[0].data;
  assert.equal(d.segmento_id, 10);
  assert.equal(d.piezas_estimadas, '+350');
  assert.equal(d.cp, '56530');
  assert.equal(d.cuando, 'En los próximos 3 meses');
  assert.equal(d.web, '@hotelazul');
  assert.equal(d.empresa, 'Hotel Azul');
  assert.equal(d.correo, 'laura@gmail.com');
  assert.equal(d.notas, 'Tipo de proyecto: Restaurantes\nCargo: Compras');
});

test('W3: promos marcado guarda el consentimiento con fecha ISO; sin marcar guarda la negativa', async () => {
  await enviar(formulario({ promos: true }));
  const conPromos = readProspectos()[0].data.promos;
  assert.equal(conPromos.acepta, true);
  assert.ok(!Number.isNaN(Date.parse(conPromos.fecha)), 'la fecha del consentimiento es ISO');

  writeProspectos([]);
  resetRateLimitPublico();
  await enviar(formulario({ cel: '5598765432' }));
  assert.deepEqual(readProspectos()[0].data.promos, { acepta: false });
});

test('W4: el envio sin correo y sin promos funciona', async () => {
  const res = await enviar(formulario({ correo: '', promos: false }));
  assert.equal(res.status, 200);
  const d = readProspectos()[0].data;
  assert.equal('correo' in d, false);
  assert.deepEqual(d.promos, { acepta: false });
});

// --- Rama 2: el celular ya es prospecto (dedup silencioso) ---

test('W5: un celular que ya es prospecto no duplica la tarjeta y registra el evento en la existente', async () => {
  writeProspectos([prospectoExistente()]);
  const res = await enviar(formulario());
  assert.equal(res.status, 200);
  const todos = readProspectos();
  assert.equal(todos.length, 1);
  assert.equal(todos[0].vendedor, 'Memo', 'la tarjeta existente no cambia de dueno');
  assert.equal(todos[0].etapa, 'por_cotizar', 'ni de etapa');
  const evento = todos[0].eventos.at(-1);
  assert.equal(evento.tipo, 'captura_publica');
  assert.ok(!Number.isNaN(Date.parse(evento.fecha)));
});

// --- Rama 3: el celular es de un cliente de Operam ---

test('W6: un celular de cliente Operam no crea prospecto', async () => {
  mockListadoClientes([CLIENTE_OPERAM]);
  const res = await enviar(formulario());
  assert.equal(res.status, 200);
  assert.equal(readProspectos().length, 0);
});

// --- Rama 4: honeypot ---

test('W7: el honeypot lleno descarta la captura sin crear nada', async () => {
  const res = await enviar(formulario({ fax: 'http://spam.example' }));
  assert.equal(res.status, 200);
  assert.equal(readProspectos().length, 0);
});

// --- Rama 5: rate limit por IP ---

test('W8: pasado el tope por IP la captura se descarta', async () => {
  for (let i = 0; i < MAX_CAPTURAS_POR_IP; i++) {
    const ok = await enviar(formulario({ cel: `551234000${i}` }));
    assert.equal(ok.status, 200);
  }
  const creados = readProspectos().length;
  const res = await enviar(formulario({ cel: '5599887766' }));
  assert.equal(res.status, 200);
  assert.equal(readProspectos().length, creados, 'la captura pasada del tope no crea tarjeta');
});

// --- El invariante de ADR-0012: la respuesta es OPACA ---

test('W9: la respuesta 200 es identica en las 5 ramas (nuevo / duplicado / cliente / honeypot / tope)', async () => {
  const huella = res => JSON.stringify({
    status: res.status,
    tipo: res.headers['content-type'],
    cuerpo: res.text,
  });

  const nuevo = await enviar(formulario());

  resetRateLimitPublico();
  writeProspectos([prospectoExistente()]);
  const duplicado = await enviar(formulario());

  resetRateLimitPublico();
  writeProspectos([]);
  mockListadoClientes([CLIENTE_OPERAM]);
  const cliente = await enviar(formulario());

  resetRateLimitPublico();
  globalThis.fetch = fetchBloqueado;
  const honeypot = await enviar(formulario({ fax: 'spam' }));

  resetRateLimitPublico();
  for (let i = 0; i < MAX_CAPTURAS_POR_IP; i++) await enviar(formulario({ cel: `551234000${i}` }));
  const tope = await enviar(formulario({ cel: '5599887766' }));

  const ramas = { nuevo, duplicado, cliente, honeypot, tope };
  const referencia = huella(nuevo);
  for (const [nombre, res] of Object.entries(ramas)) {
    assert.equal(huella(res), referencia, `la rama "${nombre}" delata informacion`);
  }
  // Y ademas es un 200 afirmativo, no un error disfrazado.
  assert.equal(nuevo.status, 200);
});

// --- Validacion del lado del servidor (el endpoint no confia en el cliente) ---

test('W10: la captura invalida se rechaza en el servidor', async () => {
  for (const invalido of [
    formulario({ nombre: '' }),
    formulario({ apellido: '' }),
    formulario({ cel: '55123' }),
    formulario({ cp: '' }),
    formulario({ ciudad: '' }),
    formulario({ cant: '+6,000' }),
    formulario({ tipo: 'Ferreterías' }),
  ]) {
    resetRateLimitPublico();
    const res = await enviar(invalido);
    assert.equal(res.status, 400, JSON.stringify(invalido));
  }
  assert.equal(readProspectos().length, 0);
});

test('W11: "Otro" sin especificar no pasa en el servidor', async () => {
  const res = await enviar(formulario({ tipo: 'Otro', otro: '   ' }));
  assert.equal(res.status, 400);
  assert.equal(readProspectos().length, 0);

  resetRateLimitPublico();
  const ok = await enviar(formulario({ tipo: 'Otro', otro: 'Bazar de artesanías', cargo: '' }));
  assert.equal(ok.status, 200);
  const p = readProspectos()[0];
  assert.equal(p.data.segmento_id, 1);
  assert.equal(p.data.notas, 'Tipo de proyecto: Otro\nEspecificó: Bazar de artesanías');
});

// La pagina publica se sirve sin token: es la unica superficie sin auth.
test('W12: GET /mayoreo entrega el formulario sin autenticacion', async () => {
  const res = await supertest(app).get('/mayoreo');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /html/);
  assert.match(res.text, /Peltre de mayoreo/i);
});
