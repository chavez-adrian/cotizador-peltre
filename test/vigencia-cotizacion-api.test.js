// #505: la Vigencia es una fecha DERIVADA (fecha de creacion + Tiempo de
// produccion + 14 dias naturales, decision de Adrian 2026-10-01) que decide el
// servidor al guardar, y editar no la mueve salvo Recalcular, cotizacion vencida o
// cambio de Tiempo de produccion. Aqui se prueba la costura HTTP (POST
// /api/cotizacion); la regla vive en public/js/condiciones-logica.js y tiene sus
// propias pruebas con fechas contadas a mano. Sin `condicionesComerciales` en la
// configuracion rige la semilla de #324: 4 semanas, 6 con calca o decorado, asi
// que la vigencia es hoy + 42 dias (28 + 14) o + 56 (42 + 14).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from '../lib/fs-reintento.js';
import { fotoDatos, fijarDatos } from './helpers/datos-aislados.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const CONFIG_PATH = join(DATA_DIR, 'config.json');
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
delete process.env.DATABASE_URL;

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const configStore = await import('../lib/config-store.js');
const { app } = await import('../server.js');
const { huellaContenidoQuote } = await import('../lib/operam-client.js');
const { fechaEmisionHoy, sumarDiasFecha } = await import('../public/js/cotizar-logica.js');
const TOKEN = `Bearer ${jwt.sign({ id: 99, name: 'Tester', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' })}`;

const readCots = () => JSON.parse(leerArchivoSync(COTS_PATH));
const writeCots = (cots) => escribirArchivoSync(COTS_PATH, JSON.stringify(cots, null, 2));
const guardada = (id) => readCots().find(c => c.id === id);

let restaurarDatos;
before(() => { restaurarDatos = fotoDatos([CONFIG_PATH, COTS_PATH, PROSPECTOS_PATH, COLA_POSTFIX_PATH]); });
after(() => {
  restaurarDatos();
  configStore._reiniciar();
});
beforeEach(() => {
  fijarDatos(CONFIG_PATH, { tiposActivos: ['PL'], texturasActivas: [1] });
  fijarDatos(COTS_PATH, []);
  configStore._reiniciar();
});

const HOY = fechaEmisionHoy();

// Lo que manda el navegador. La `vigencia` del cuerpo NO decide nada: la pone el
// servidor, por eso viaja una absurda.
function contenido(extra = {}) {
  return {
    fecha: HOY, vigencia: '2020-01-01', tier: 'Mayoreo',
    cliente: { razonSocial: 'El Pendulo', nombreCorto: 'Pendulo', telefono: '+52 5551234567', cpEntrega: '56530', customerId: 376 },
    items: [{ codigo: 'CR20-PLATO', descripcion: 'Plato', cantidad: 10, unidad: 'pza', precio: 100, descuento: 0 }],
    subtotal: 1000, iva: 160, total: 1160, notas: [],
    ...extra,
  };
}

// Una cotizacion ya subida a Operam, creada `diasAtras` dias antes de hoy (la
// columna `fecha` es el instante de creacion: las 17:00 Z son las 11:00 en CDMX).
function subida({ diasAtras = 3, vigencia, huella, decorado = false } = {}) {
  const creacion = sumarDiasFecha(HOY, -diasAtras);
  const data = contenido({ fecha: creacion, vigencia: vigencia ?? sumarDiasFecha(creacion, decorado ? 56 : 42), ...(decorado ? { decorado: true } : {}) });
  const snap = readCots();
  const id = snap.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  writeCots([...snap, {
    id, fecha: `${creacion}T17:00:00.000Z`, vendedor: 'Tester', cliente: 'Pendulo',
    totalPiezas: 10, total: 1160, tier: 'Mayoreo', folioOperam: '1300',
    data: { ...data, huellaQuote: huella ? huella(data) : huellaContenidoQuote(data) },
  }]);
  return { id, creacion, vigencia: data.vigencia };
}

// La huella como la dejaba la subida ANTES de #505: sin el campo `vigencia` y con
// la linea "Valido hasta" normalizada al plazo en dias.
function huellaAntesDe505(data) {
  const h = JSON.parse(huellaContenidoQuote(data));
  delete h.vigencia;
  h.comments = 'Valido hasta: +30d';
  return JSON.stringify(h);
}

const guardar = (cuerpo) => supertest(app).post('/api/cotizacion').set('Authorization', TOKEN).send(cuerpo);

test('#505: una cotizacion nueva guarda hoy + Tiempo de produccion + 14 dias, no la vigencia del navegador', async () => {
  const res = await guardar(contenido());
  assert.equal(res.status, 200);
  assert.equal(res.body.vigencia, sumarDiasFecha(HOY, 42));
  assert.equal(guardada(res.body.id).data.vigencia, sumarDiasFecha(HOY, 42));
});

test('#505: la marca de decorado usa la tabla de calca (6 semanas + 14 dias)', async () => {
  const res = await guardar(contenido({ decorado: true }));
  assert.equal(guardada(res.body.id).data.vigencia, sumarDiasFecha(HOY, 56));
});

test('#505: editar una cotizacion vigente sin tocar el carrito no cambia la vigencia ni pide actualizar el quote', async () => {
  const { id, vigencia } = subida();
  const res = await guardar({ ...contenido(), cotizacionId: String(id) });
  assert.equal(res.status, 200);
  assert.equal(res.body.requiereActualizacionOperam, false);
  assert.equal(guardada(id).data.vigencia, vigencia);
  assert.equal(res.body.vigencia, vigencia);
});

test('#505: Recalcular vigencia la deriva con base hoy y pide actualizar el quote', async () => {
  const { id } = subida({ diasAtras: 10 });
  const res = await guardar({ ...contenido(), cotizacionId: String(id), recalcularVigencia: true });
  assert.equal(res.body.requiereActualizacionOperam, true);
  assert.equal(guardada(id).data.vigencia, sumarDiasFecha(HOY, 42));
  assert.equal('recalcularVigencia' in guardada(id).data, false, 'es un campo de control, no se persiste');
});

test('#505: un cambio de Tiempo de produccion recalcula con base en la creacion original', async () => {
  const { id, creacion } = subida({ diasAtras: 3 });
  const res = await guardar({ ...contenido({ decorado: true }), cotizacionId: String(id) });
  assert.equal(res.body.requiereActualizacionOperam, true);
  assert.equal(guardada(id).data.vigencia, sumarDiasFecha(creacion, 56));
});

// El navegador manda `decorado` solo en true y el data se mergea por la raiz: sin
// la llave, la marca del registro sobrevive. La vigencia se deriva con ESA marca,
// la que queda guardada; si no, cada edicion veria un cambio de plazo fantasma.
test('#505: editar una cotizacion decorada sin mandar la marca conserva la vigencia de la tabla de calca', async () => {
  const { id, creacion } = subida({ diasAtras: 3, decorado: true });
  for (let vez = 1; vez <= 2; vez++) {
    const res = await guardar({ ...contenido(), cotizacionId: String(id) });
    assert.equal(res.body.requiereActualizacionOperam, false, `edicion ${vez}`);
    assert.equal(guardada(id).data.vigencia, sumarDiasFecha(creacion, 56), `edicion ${vez}`);
    assert.equal(guardada(id).data.decorado, true, `edicion ${vez}`);
  }
});

test('#505: editar una cotizacion vencida la recalcula con base hoy y lo avisa', async () => {
  const { id } = subida({ diasAtras: 50, vigencia: sumarDiasFecha(HOY, -1) });
  const res = await guardar({ ...contenido(), cotizacionId: String(id) });
  assert.equal(res.body.requiereActualizacionOperam, true);
  assert.equal(guardada(id).data.vigencia, sumarDiasFecha(HOY, 42));
  assert.equal(res.body.avisoVigencia, 'Esta cotizaci\u00f3n estaba vencida, la fecha de vigencia se recalcul\u00f3');
});

test('#505: con una huella guardada antes de #505, editar sin cambios no pide actualizar por vigencia', async () => {
  const { id } = subida({ huella: huellaAntesDe505 });
  const res = await guardar({ ...contenido(), cotizacionId: String(id) });
  assert.equal(res.body.requiereActualizacionOperam, false);
});

test('#505: con una huella guardada antes de #505, la vencida recalculada SI pide actualizar el quote', async () => {
  const { id } = subida({ diasAtras: 50, vigencia: sumarDiasFecha(HOY, -1), huella: huellaAntesDe505 });
  const res = await guardar({ ...contenido(), cotizacionId: String(id) });
  assert.equal(res.body.requiereActualizacionOperam, true);
});

// El paso Cotizacion muestra la vigencia que se va a guardar antes de guardar: al
// abrir una cotizacion para Editar necesita su fecha de CREACION (la columna del
// registro, como dia del negocio), que `data.fecha` no es.
test('#505: el detalle de la cotizacion trae su fecha de creacion', async () => {
  const { id, creacion } = subida({ diasAtras: 7 });
  const res = await supertest(app).get(`/api/cotizaciones/${id}`).set('Authorization', TOKEN);
  assert.equal(res.status, 200);
  assert.equal(res.body.fechaCreacion, creacion);
});
