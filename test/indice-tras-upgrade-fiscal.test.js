// #327: tras un upgrade fiscal exitoso, el buscador de la vista Clientes seguia
// devolviendo al cliente con su nombre y su RFC GENERICO viejos, porque el PUT no
// tocaba el cache del padron de lib/indice-telefonos.js (TTL 1 h). Caso real: cliente
// 517, LUIS EMILIO ZARABOZO / XAXX010101000 -> ROYAL TABLE / RTA910503989.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}
delete process.env.DATABASE_URL;

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');
const TOKEN = jwt.sign({ id: 99, name: 'Tester', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

// Forma del LISTADO paginado (lo que consume listarTodosClientes para armar el cache).
const VIEJO = {
  customer_id: '517', CustName: 'LUIS EMILIO ZARABOZO', cust_ref: 'Luis Emilio Zarabozo',
  tax_id: 'XAXX010101000', postal_code: '',
  contacts: [{ name: 'Luis Emilio Zarabozo', phone: '+525554368426' }],
  branches: [{ branch_code: '563', br_name: 'LUIS EMILIO ZARABOZO', phone: '+525554368426' }],
};
const NUEVO = {
  ...VIEJO, CustName: 'ROYAL TABLE', cust_ref: 'Royal Table',
  tax_id: 'RTA910503989', postal_code: '11700',
  street: 'BOSQUES DE DURAZNOS', street_number: '187', district: 'BOSQUE DE LAS LOMAS',
  city: 'MIGUEL HIDALGO', state: 'CIUDAD DE MEXICO',
};

// El DETALLE (GET /customers/:id) es un SUPERCONJUNTO del listado: trae ademas
// sales_type, segmento y regimen (sondeo del 517, 2026-09-04). Se modela distinto a
// proposito -- usar el mismo objeto para las dos formas es el error de #194: el mock
// contestaria lo que el codigo espera y el test no podria detectar que meter el detalle
// al cache le quite a esa entrada algo que el listado si traia.
const detalleDe = c => ({ ...c, sales_type: '12', regimen: '601', segmento: { id: '15', clave: '600' } });

const CSF = {
  rfc: 'RTA910503989', razonSocial: 'ROYAL TABLE', idcif: 'IDCIF1',
  calle: 'BOSQUES DE DURAZNOS', numExt: '187', numInt: '27', colonia: 'BOSQUE DE LAS LOMAS',
  cp: '11700', municipio: 'MIGUEL HIDALGO', estado: 'CIUDAD DE MEXICO', regimenFiscal: '601',
};

function mockOperam({ relecturaFalla = false } = {}) {
  const original = globalThis.fetch;
  let padron = [VIEJO];
  let listados = 0;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/api/v3/login')) return { ok: true, json: async () => ({ token: 'tok', result: true }) };
    if (u.includes('/api/v3/sales/customers')) {
      if (opts?.method === 'PUT') {
        padron = [NUEVO];
        return { ok: true, json: async () => ({ version: '3', ...JSON.parse(opts.body) }) };
      }
      if (u.includes('tax_id=')) return { ok: true, json: async () => ({ total: 0, data: [] }) };
      if (/\/customers\/\d+/.test(u)) {
        if (relecturaFalla) return { ok: false, status: 503, text: async () => 'boom' };
        return { ok: true, json: async () => ({ data: [detalleDe(padron[0])] }) };
      }
      if (u.includes('limit=100')) {
        listados++;
        return { ok: true, json: async () => ({ total: padron.length, data: padron }) };
      }
      // El ?search= de Operam busca por NOMBRE (#194): con el CustName ya cambiado,
      // "Luis Emilio" no matchea nada. Medido en vivo contra el 517.
      const search = decodeURIComponent((u.match(/[?&]search=([^&]*)/) || [])[1] || '');
      const hit = padron.filter(c => c.CustName.toLowerCase().includes(search.toLowerCase()));
      return { ok: true, json: async () => ({ total: hit.length, data: hit }) };
    }
    throw new Error('Unmocked fetch: ' + u);
  };
  return { restore: () => { globalThis.fetch = original; }, listados: () => listados };
}

const buscar = q => supertest(app)
  .get('/api/operam/clientes?q=' + encodeURIComponent(q))
  .set('Authorization', `Bearer ${TOKEN}`);

const upgrade = () => supertest(app).put('/api/actualizar-cliente-fiscal/517')
  .set('Authorization', `Bearer ${TOKEN}`)
  .send({ csfDatos: CSF });

test('#327: tras el upgrade fiscal el buscador ya no devuelve el RFC generico viejo', async () => {
  const m = mockOperam();
  try {
    // 1. El vendedor busca por el nombre viejo: calienta el cache del padron.
    const antes = await buscar('Luis Emilio Zarabozo');
    assert.strictEqual(antes.status, 200);
    assert.strictEqual(antes.body.length, 1, 'precondicion: se encuentra por su nombre viejo');
    assert.strictEqual(antes.body[0].rfc, 'XAXX010101000');

    // 2. Carga la CSF y confirma.
    const put = await upgrade();
    assert.strictEqual(put.status, 200);
    assert.strictEqual(put.body.ok, true);

    // 3. El nombre viejo ya no lo trae NADIE: ni Operam (cambio el CustName) ni el
    // cache. Antes del fix la fila salia del cache con el RFC generico y armaba el
    // banner "RFC generico XAXX010101000 se sustituira...".
    const porNombreViejo = await buscar('Luis Emilio Zarabozo');
    assert.strictEqual(porNombreViejo.body.find(c => c.rfc === 'XAXX010101000'), undefined,
      'el cache ya no sirve la fila vieja');

    // 4. Y por el nombre NUEVO sale con sus datos nuevos.
    const porNombreNuevo = await buscar('Royal Table');
    assert.strictEqual(porNombreNuevo.body.length, 1);
    assert.strictEqual(porNombreNuevo.body[0].rfc, 'RTA910503989');
    assert.strictEqual(porNombreNuevo.body[0].name, 'ROYAL TABLE');
  } finally {
    m.restore();
  }
});

test('#327: la actualizacion puntual NO relee el padron entero', async () => {
  const m = mockOperam();
  try {
    await buscar('Luis Emilio Zarabozo');
    const trasCalentar = m.listados();
    await upgrade();
    assert.strictEqual(m.listados(), trasCalentar,
      'el upgrade no debe disparar listarTodosClientes: la entrada fresca sale de la relectura que ya se hacia');
  } finally {
    m.restore();
  }
});

test('#327: el telefono del cliente sigue resolviendo despues del upgrade', async () => {
  const m = mockOperam();
  try {
    await buscar('Luis Emilio Zarabozo');
    await upgrade();
    // El indice de telefonos (#42) vive del MISMO cache: meterle el detalle no debe
    // dejar al cliente sin sus telefonos (si pasara, el barrido de contactos veria sus
    // fichas sin respaldo y las inactivaria en Google).
    const porTelefono = await buscar('5554368426');
    assert.strictEqual(porTelefono.body.length, 1, 'se sigue encontrando por telefono');
    assert.strictEqual(porTelefono.body[0].rfc, 'RTA910503989', 'y con los datos nuevos');
  } finally {
    m.restore();
  }
});

test('#327: si la relectura falla, el upgrade responde ok y el cache se refresca igual', async () => {
  const m = mockOperam({ relecturaFalla: true });
  try {
    await buscar('Luis Emilio Zarabozo');
    const trasCalentar = m.listados();
    const put = await upgrade();
    // El PUT si se aplico: la verificacion es un paso aparte y su fallo no es un error.
    assert.strictEqual(put.status, 200);
    assert.strictEqual(put.body.verificacionFallida, true);
    // Sin entrada fresca que insertar, el unico camino honesto es releer el padron.
    assert.ok(m.listados() > trasCalentar,
      'sin relectura del cliente, el cache se refresca entero en vez de quedarse viejo 1 h');
  } finally {
    m.restore();
  }
});
