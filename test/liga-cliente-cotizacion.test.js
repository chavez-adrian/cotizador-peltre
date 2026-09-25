import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from '../lib/fs-reintento.js';
import { fotoDatos } from './helpers/datos-aislados.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

// La liga de una cotizacion con su Cliente Operam es FIJA (#394, ADR-0006 /
// ADR-0016, CONTEXT.md "Oportunidad": en Operam la cotizacion nunca se
// reasigna). Editar un registro ya ligado no puede cambiarle el Cliente Operam:
// en produccion (cotizacion 1280, id 105) el navegador mando el customerId del
// cliente de la sesion ANTERIOR -- 529, Gerardo Cardenas -- sobre la cotizacion
// de Sofia Rodriguez (527), y el registro quedo cruzado: nombre y domicilio de
// Sofia en el documento, identidad de Gerardo en lo que viaja a Operam.

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const COTS_PATH = join(DATA_DIR, 'cotizaciones.json');
// #380: la subida encola en la cola persistida el post-fix que no quedo verificado.
const COLA_POSTFIX_PATH = join(dirname(COTS_PATH), 'postfix-pendientes.json');
const PROSPECTOS_PATH = join(DATA_DIR, 'prospectos.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');
const { huellaContenidoQuote } = await import('../lib/operam-client.js');
const { _resetSesionWeb } = await import('../lib/operam-web.js');
// Los dos nucleos puros del navegador que deciden que identidad viaja en el
// cuerpo (app.js no es importable en Node): asi el caso de Copiar se prueba de
// punta a punta -- lo que cargarCotizacion repone es lo que sube el quote.
const { clienteAlCargarCotizacion } = await import('../public/js/cotizaciones-logica.js');
const { customerIdFiscal } = await import('../public/js/alta-logica.js');
const TEST_TOKEN = jwt.sign({ id: 99, name: 'Tester', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

function readCots() {
  if (!existsSync(COTS_PATH)) return [];
  return JSON.parse(leerArchivoSync(COTS_PATH));
}

function writeCots(data) {
  escribirArchivoSync(COTS_PATH, JSON.stringify(data, null, 2));
}

// Guardar una cotizacion NUEVA mueve el embudo (hook de prospectos): el archivo
// se restaura igual que el de cotizaciones.
// #411: los data/*.json de la suite quedan como se los encontro, el ausente
// incluido: restaurar una re-serializacion CREA el archivo donde no habia uno.
let restaurarDatos;
before(() => { restaurarDatos = fotoDatos([COTS_PATH, PROSPECTOS_PATH, COLA_POSTFIX_PATH]); });
after(() => { restaurarDatos(); });

function mockOperam(handlers) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    for (const [pat, fn] of Object.entries(handlers)) {
      if (u.includes(pat)) return fn(u, opts);
    }
    throw new Error('Unmocked fetch: ' + u);
  };
  return () => { globalThis.fetch = original; };
}

// El contenido de la cotizacion de Sofia. `cliente` se sobreescribe en cada
// caso para simular lo que manda el navegador.
function contenido(cliente) {
  return {
    fecha: '2026-09-18', vigencia: '2026-10-18', tier: 'Mayoreo',
    cliente: {
      razonSocial: 'Sofia Rodriguez', nombreCorto: 'Sofia Rodriguez',
      telefono: '+52 5551234567', cpEntrega: '56530', pais: 'MX',
      ...cliente,
    },
    items: [{ codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 10, unidad: 'pza', precio: 100, descuento: 0 }],
    subtotal: 1000, iva: 160, total: 1160, notas: [],
  };
}

// Registro ya subido a Operam y ligado al Cliente Operam de Sofia.
function cotizacionLigada({ customerId = 527, branchId = 576 } = {}) {
  const snap = readCots();
  const id = (snap.reduce((m, c) => Math.max(m, c.id), 0)) + 1;
  const data = contenido(customerId == null ? {} : { customerId, branchId });
  writeCots([...snap, {
    id, fecha: '2026-09-18T00:00:00Z', vendedor: 'Tester', cliente: 'Sofia Rodriguez',
    totalPiezas: 10, total: 1160, tier: 'Mayoreo', folioOperam: '1280',
    data: { ...data, huellaQuote: huellaContenidoQuote(data) },
  }]);
  return id;
}

function guardada(id) {
  return readCots().find(c => c.id === id);
}

test('#394-1: Editar con el customerId de otro Cliente Operam NO pisa el del registro', async () => {
  const id = cotizacionLigada();
  const res = await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TEST_TOKEN}`)
    .send({ ...contenido({ customerId: 529 }), cotizacionId: String(id) });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.id, id);
  assert.strictEqual(guardada(id).data.cliente.customerId, 527);
  assert.strictEqual(guardada(id).data.cliente.branchId, 576);
});

// Sin regresion del comportamiento de #81: el formulario no manda la liga, asi
// que una regeneracion normal llega con customerId null y la del registro es la
// que la repone (si no, la cotizacion perderia su Cliente Operam al regenerar).
test('#394-2: Editar sin customerId sigue reponiendo el del registro', async () => {
  const id = cotizacionLigada();
  await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TEST_TOKEN}`)
    .send({ ...contenido({ customerId: null }), cotizacionId: String(id) });
  assert.strictEqual(guardada(id).data.cliente.customerId, 527);
  assert.strictEqual(guardada(id).data.cliente.branchId, 576);
});

// Un registro sin liga no tiene nada que proteger: el Cliente Operam que el
// vendedor acaba de elegir en el paso Cliente SI entra (es la via por la que la
// cotizacion estrena liga antes de subirse).
test('#394-3: un registro sin Cliente Operam ligado si acepta el que llega', async () => {
  const id = cotizacionLigada({ customerId: null });
  await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TEST_TOKEN}`)
    .send({ ...contenido({ customerId: 529 }), cotizacionId: String(id) });
  assert.strictEqual(guardada(id).data.cliente.customerId, 529);
});

// El customerId entra en la huella del quote (#114): con el id ajeno pisando el
// registro, regenerar sin tocar nada pedia reescribir el quote -- y el gate de
// "mismo cliente" (#104) lo frenaba con el aviso que quedo en la 1280.
// Copiar (cargarCotizacion(id, 'nueva')) crea un registro NUEVO: ahi no hay liga
// previa que proteja al registro, asi que la identidad que manda el navegador es
// la que se lleva el quote. Con el cliente de la sesion anterior en el cuerpo, el
// quote nuevo nacia a nombre del otro Cliente Operam: ninguna guarda de la subida
// lo detiene -- la de #345 solo pregunta cuando el Contacto YA tiene ligas, y la
// liga fija de #208 solo existe sobre un registro ya ligado.
test('#394-5: Copiar sube el quote nuevo al Cliente Operam de la cotizacion copiada', async () => {
  _resetSesionWeb();
  let quoteBody = null;
  const restore = mockOperam({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': () => ({
      ok: true,
      json: async () => ({ total: 1, data: [{ customer_id: 527, tax_id: 'ROMS900101AA1', CustName: 'SOFIA RODRIGUEZ', sales_type: '12', curr_code: 'MXN', branches: [{ branch_code: 576 }] }] }),
    }),
    '/api/v3/sales/quote': (u, opts) => { quoteBody = JSON.parse(opts.body); return { ok: true, json: async () => ({ result: true, added_trans_no: 1301 }) }; },
    // La web legacy del post-fix de vigencia (#106): sin estos handlers el GET
    // real se va al retry con backoff antes de rendirse.
    'trans_type=30': () => ({ headers: {}, text: async () => '<html>login ok</html>' }),
    'trans_type=32': () => ({ headers: {}, text: async () => '<html></html>' }),
    'sales_order_entry.php': () => ({ headers: {}, text: async () => '<html></html>' }),
  });
  try {
    // Lo que Copiar manda: los campos de la cotizacion cargada con la identidad
    // que repone cargarCotizacion, no la del Cliente Operam 529 de la sesion.
    const cargado = contenido({ customerId: 527, branchId: 576 });
    const enSesion = { tipo: 'operam', id: 529, name: 'GERARDO CARDENAS', rfc: 'XAXX010101000' };
    const customerId = customerIdFiscal(clienteAlCargarCotizacion(cargado.cliente, enSesion));
    const guardar = await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ ...cargado, cliente: { ...cargado.cliente, customerId, branchId: null } });
    assert.strictEqual(guardar.status, 200);
    const res = await supertest(app).post(`/api/cotizacion/operam/${guardar.body.id}`).set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.body.ok, true, JSON.stringify(res.body));
    assert.strictEqual(quoteBody.customer_id, 527);
    assert.strictEqual(quoteBody.branch_id, 576);
  } finally {
    restore();
  }
});

test('#394-4: regenerar sin cambios no pide reescribir el quote por el id ajeno', async () => {
  const id = cotizacionLigada();
  const res = await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TEST_TOKEN}`)
    .send({ ...contenido({ customerId: 529 }), cotizacionId: String(id) });
  assert.strictEqual(res.body.requiereActualizacionOperam, false);
});

// El domicilio de entrega SELECCIONADO (`branch_id`) entra a la huella desde #415.
// Dos domicilios del mismo cliente que se leen IGUAL en texto (#330 midio 33 branches
// sin calle en el ERP; los vacios caen al respaldo del cliente, #409) producian la
// misma huella, asi que cambiar de uno a otro respondia "no cambio": el registro y la
// pantalla decian el domicilio nuevo y el quote se quedaba con el viejo, que es el
// encabezado que hereda el pedido (#252). Aqui se mide en la costura real: el branch
// que manda el navegador sobrevive a la liga fija de #394 y llega a la comparacion.
test('#415: cambiar el domicilio de entrega pide reescribir el quote', async () => {
  const id = cotizacionLigada({ customerId: 527, branchId: 576 });
  const res = await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TEST_TOKEN}`)
    .send({ ...contenido({ customerId: 527, branchId: 577 }), cotizacionId: String(id) });
  assert.strictEqual(res.body.requiereActualizacionOperam, true);
  assert.strictEqual(guardada(id).data.cliente.branchId, 577);
});

test('#415: regenerar con el mismo domicilio no pide reescribir nada', async () => {
  const id = cotizacionLigada({ customerId: 527, branchId: 576 });
  const res = await supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TEST_TOKEN}`)
    .send({ ...contenido({ customerId: 527, branchId: 576 }), cotizacionId: String(id) });
  assert.strictEqual(res.body.requiereActualizacionOperam, false);
});
