import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync } from '../lib/fs-reintento.js';
import { fotoDatos, fijarDatos } from './helpers/datos-aislados.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

// Con pedido, el guardado rechaza CUALQUIER guardado sobre esa cotizacion (#529,
// decision de Adrian 2026-10-04): el quote ya se convirtio y reescribir el
// registro lo dejaba diciendo algo que el pedido no dice. La salida es Copiar.

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const COTS_PATH = join(DATA_DIR, 'cotizaciones.json');
const PROSPECTOS_PATH = join(DATA_DIR, 'prospectos.json');
const COLA_POSTFIX_PATH = join(DATA_DIR, 'postfix-pendientes.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');
const { MOTIVO_CON_PEDIDO } = await import('../public/js/editar-cotizacion-logica.js');

const VENDEDOR = 'Alejandro Chavez';
const TOKEN = jwt.sign({ id: 2, name: VENDEDOR, role: 'vendedor' }, JWT_SECRET, { expiresIn: '1h' });

// El espejo tal como lo escribe el sync (#67): el fixture de
// `setEspejoOperam persiste el espejo de la cadena en data sin borrar lo previo`
// (test/cotizaciones-store.test.js).
const ESPEJO_DEL_SYNC = {
  cotizacion: '1141', pedido: '7269',
  factura: { numero: '6735', ref: 'A1907' },
  remisiones: ['2142'], pago: 'pagado',
};

let restaurarDatos;
before(() => {
  restaurarDatos = fotoDatos([COTS_PATH, PROSPECTOS_PATH, COLA_POSTFIX_PATH]);
  fijarDatos(PROSPECTOS_PATH, []);
  fijarDatos(COLA_POSTFIX_PATH, []);
});
after(() => { restaurarDatos(); });

let fetchOriginal;
let llamadasFetch;
beforeEach(() => {
  fetchOriginal = globalThis.fetch;
  llamadasFetch = [];
  globalThis.fetch = async (url) => { llamadasFetch.push(String(url)); throw new Error(`fetch inesperado: ${url}`); };
});
afterEach(() => { globalThis.fetch = fetchOriginal; });

function contenido(extra = {}) {
  return {
    fecha: '2026-10-04', vigencia: '2026-12-31', tier: 'M350',
    cliente: {
      razonSocial: 'Restaurante La Mesa', nombreCorto: 'La Mesa',
      telefono: '+52 5551234567', cpEntrega: '56530', pais: 'MX',
    },
    items: [{ codigo: 'CR20-PLATO', descripcion: 'Plato grande', cantidad: 500, unidad: 'pza', precio: 90, descuento: 0 }],
    subtotal: 81000, iva: 12960, total: 93960, notas: ['Cambio despues del pedido'],
    ...extra,
  };
}

function registro(id, dataExtra = {}, { folioOperam = '1141' } = {}) {
  return {
    id, fecha: '2026-09-01T00:00:00.000Z', vendedor: VENDEDOR, cliente: 'La Mesa',
    totalPiezas: 500, total: 58000, tier: 'Mayoreo', folioOperam,
    data: {
      fecha: '2026-09-01', vigencia: '2026-09-30', vendedor: VENDEDOR,
      cliente: { razonSocial: 'Restaurante La Mesa', nombreCorto: 'La Mesa', telefono: '+52 5551234567', cpEntrega: '56530', pais: 'MX' },
      items: [{ codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 500, unidad: 'pza', precio: 100, descuento: 0 }],
      subtotal: 50000, iva: 8000, total: 58000, notas: [],
      ...dataExtra,
    },
  };
}

function sembrar(...cots) { fijarDatos(COTS_PATH, cots); }
function leerCrudo() { return leerArchivoSync(COTS_PATH); }
function leerCots() { return JSON.parse(leerCrudo()); }

function guardar(body) {
  return supertest(app).post('/api/cotizacion').set('Authorization', `Bearer ${TOKEN}`).send(body);
}

test('#529-1: con data.orderOperam el guardado responde 409 con el motivo del gate y no escribe nada', async () => {
  sembrar(registro(70, { orderOperam: '7269' }));
  const antes = leerCrudo();
  const res = await guardar({ ...contenido(), cotizacionId: '70' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'La cotizaci\u00f3n ya tiene un pedido asociado en Operam: copia la cotizaci\u00f3n');
  assert.equal(res.body.error, MOTIVO_CON_PEDIDO);
  assert.equal(leerCrudo(), antes);
  assert.deepEqual(llamadasFetch, []);
});

test('#529-2: con el pedido solo en data.espejoOperam (lo que anota el sync) tambien rechaza', async () => {
  sembrar(registro(71, { espejoOperam: ESPEJO_DEL_SYNC }));
  const antes = leerCrudo();
  const res = await guardar({ ...contenido(), cotizacionId: '71' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, MOTIVO_CON_PEDIDO);
  assert.equal(leerCrudo(), antes);
  assert.deepEqual(llamadasFetch, []);
});

test('#529-3: el rechazo va antes de la regla de vigencia: ni Recalcular mueve data.vigencia ni data.fecha', async () => {
  sembrar(registro(72, { orderOperam: '7269' }));
  const res = await guardar({ ...contenido(), cotizacionId: '72', recalcularVigencia: true });
  assert.equal(res.status, 409);
  const [c] = leerCots();
  assert.equal(c.data.vigencia, '2026-09-30');
  assert.equal(c.data.fecha, '2026-09-01');
  assert.equal(c.fecha, '2026-09-01T00:00:00.000Z');
  assert.equal(c.total, 58000);
});

test('#529-4: una PRE (sin folio) sin pedido sigue guardando con cotizacionId y no pide actualizar el quote', async () => {
  sembrar(registro(73, {}, { folioOperam: null }));
  const res = await guardar({ ...contenido(), cotizacionId: '73' });
  assert.equal(res.status, 200);
  assert.equal(res.body.id, 73);
  assert.equal(res.body.requiereActualizacionOperam, false);
  const [c] = leerCots();
  assert.equal(c.total, 93960);
});

test('#529-5: Copiar una cotizacion con pedido (sin cotizacionId) crea una nueva', async () => {
  const conPedido = registro(74, { orderOperam: '7269', espejoOperam: ESPEJO_DEL_SYNC });
  sembrar(conPedido);
  const res = await guardar(contenido());
  assert.equal(res.status, 200);
  assert.notEqual(res.body.id, 74);
  const cots = leerCots();
  assert.equal(cots.length, 2);
  assert.deepEqual(cots.find(c => c.id === 74), conPedido);
});

test('#529-6: el 409 gana a la validacion del precio manual de calca (uno fuera de una calca daria 400)', async () => {
  sembrar(registro(75, { orderOperam: '7269' }));
  const antes = leerCrudo();
  const items = [{ codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 500, unidad: 'pza', precio: 100, descuento: 0, precioManual: 12 }];
  const res = await guardar({ ...contenido({ items }), cotizacionId: '75' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, MOTIVO_CON_PEDIDO);
  assert.equal(leerCrudo(), antes);
});
