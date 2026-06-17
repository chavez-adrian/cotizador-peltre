import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const COTS_PATH = join(DATA_DIR, 'cotizaciones.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app, cargarListasPrecios } = await import('../server.js');
const TEST_TOKEN = jwt.sign({ id: 99, name: 'Tester', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

function readCots() {
  if (!existsSync(COTS_PATH)) return [];
  return JSON.parse(readFileSync(COTS_PATH, 'utf8'));
}

function writeCots(data) {
  writeFileSync(COTS_PATH, JSON.stringify(data, null, 2));
}

let savedCots;
before(() => { savedCots = readCots(); });
after(() => { writeCots(savedCots); });

test('B1: POST /api/cotizacion/pdf persiste cliente.pais', async () => {
  const snap = readCots();
  const body = {
    fecha: '2026-01-01', vigencia: '2026-02-01', tier: 'Mayoreo',
    cliente: { razonSocial: 'Test SA', nombreCorto: 'Test', pais: 'US', telefono: '+1 5551234567' },
    items: [{ codigo: 'TEST', descripcion: 'Test', cantidad: 1, unidad: 'pza', precio: 100, descuento: 0 }],
    subtotal: 100, iva: 16, total: 116, notas: [],
  };
  await supertest(app).post('/api/cotizacion/pdf').set('Authorization', `Bearer ${TEST_TOKEN}`).send(body);
  const cots = readCots();
  assert.ok(cots.length > snap.length);
  assert.strictEqual(cots[cots.length - 1].data.cliente.pais, 'US');
});

test('B1b: POST /api/cotizacion/pdf sin telefono retorna 400 (bloqueo duro)', async () => {
  const snap = readCots();
  const body = {
    fecha: '2026-01-01', tier: 'Mayoreo',
    cliente: { razonSocial: 'Test SA' },
    items: [{ codigo: 'TEST', descripcion: 'Test', cantidad: 1, unidad: 'pza', precio: 100, descuento: 0 }],
    subtotal: 100, iva: 16, total: 116, notas: [],
  };
  const res = await supertest(app).post('/api/cotizacion/pdf').set('Authorization', `Bearer ${TEST_TOKEN}`).send(body);
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /tel.fono/i);
  assert.strictEqual(readCots().length, snap.length);
});

test('B1c: POST /api/cotizacion/pdf con telefono sin codigo de pais retorna 400', async () => {
  const body = {
    fecha: '2026-01-01', tier: 'Mayoreo',
    cliente: { razonSocial: 'Test SA', telefono: '5512345678' },
    items: [{ codigo: 'TEST', descripcion: 'Test', cantidad: 1, unidad: 'pza', precio: 100, descuento: 0 }],
    subtotal: 100, iva: 16, total: 116, notas: [],
  };
  const res = await supertest(app).post('/api/cotizacion/pdf').set('Authorization', `Bearer ${TEST_TOKEN}`).send(body);
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /c.digo de pa.s/i);
});

test('B1d: POST /api/cotizacion/html sin telefono valido retorna 400', async () => {
  const body = {
    fecha: '2026-01-01', tier: 'Mayoreo',
    cliente: { razonSocial: 'Test SA', telefono: '123' },
    items: [{ codigo: 'TEST', descripcion: 'Test', cantidad: 1, unidad: 'pza', precio: 100, descuento: 0 }],
    subtotal: 100, iva: 16, total: 116, notas: [],
  };
  const res = await supertest(app).post('/api/cotizacion/html').set('Authorization', `Bearer ${TEST_TOKEN}`).send(body);
  assert.strictEqual(res.status, 400);
});

test('B2: GET /api/cotizaciones/:id sin campo pais no falla', async () => {
  const snap = readCots();
  const id = snap.length + 1;
  writeCots([...snap, { id, fecha: new Date().toISOString(), vendedor: 'Tester', cliente: 'Sin nombre', totalPiezas: 0, total: 0, tier: '', data: { cliente: { razonSocial: 'Sin pais' }, items: [] } }]);
  const res = await supertest(app).get(`/api/cotizaciones/${id}`).set('Authorization', `Bearer ${TEST_TOKEN}`);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.cliente);
});

test('B4: POST /api/cotizacion/envio usa paisDestino en destination.country', async () => {
  let capturedPayload = null;
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.ENVIA_API_KEY;
  process.env.ENVIA_API_KEY = 'test-key';
  globalThis.fetch = async (url, opts) => { capturedPayload = JSON.parse(opts.body); return { ok: true, json: async () => ({ data: [] }) }; };
  try {
    await supertest(app).post('/api/cotizacion/envio').set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ cpDestino: '90210', paisDestino: 'US', items: [{ codigo: 'PV08', cantidad: 1 }], totalConIVA: 100 });
    assert.ok(capturedPayload !== null);
    assert.strictEqual(capturedPayload.destination.country, 'US');
  } finally {
    globalThis.fetch = originalFetch;
    process.env.ENVIA_API_KEY = originalApiKey;
  }
});

function mockOperamFetch(handlers) {
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

// === POST /api/crear-cliente + Dropbox (#24) ===

test('POST /api/crear-cliente con pdf_base64: fallo Dropbox no rompe respuesta 200', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return { ok: true, json: async () => ({ result: true, customer_id: 88 }) };
      if (u.includes('/88')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 188 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/188': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ tax_id: 'DRB010101ABC', CustName: 'Dropbox Test SA', pdf_base64: 'AAAA',
              entrega: { br_name: 'DRB', br_ref: 'DRB', addr_street: 'Calle', addr_exterior: '1', addr_interior: '', addr_colony: 'Col', addr_city: 'CDMX', addr_state: 'CDMX', addr_zip: '06600', addr_reference: '', phone: '', email: '', pais: 'MX' },
              salesman: 47 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.customer_id, 88);
  } finally {
    restore();
  }
});

// === GET /api/log ===

test('GET /api/log retorna 503 cuando no hay DATABASE_URL', async () => {
  const res = await supertest(app).get('/api/log').set('Authorization', `Bearer ${TEST_TOKEN}`);
  assert.strictEqual(res.status, 503);
});

test('GET /api/log sin token retorna 401', async () => {
  const res = await supertest(app).get('/api/log');
  assert.strictEqual(res.status, 401);
});

// === PUT /api/actualizar-cliente/:id ===

test('PUT /api/actualizar-cliente/:id actualiza cliente y retorna { ok:true }', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente/42')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ street: 'Reforma', postal_code: '06600' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
  } finally {
    restore();
  }
});

test('PUT /api/actualizar-cliente/:id sin campos retorna 400', async () => {
  const res = await supertest(app).put('/api/actualizar-cliente/42')
    .set('Authorization', `Bearer ${TEST_TOKEN}`)
    .send({});
  assert.strictEqual(res.status, 400);
  assert.ok(res.body.error);
});

test('PUT /api/actualizar-cliente/:id sin token retorna 401', async () => {
  const res = await supertest(app).put('/api/actualizar-cliente/42').send({ street: 'X' });
  assert.strictEqual(res.status, 401);
});

test('PUT /api/actualizar-cliente/:id Operam error retorna 503', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': () => ({ ok: true, json: async () => ({ result: false, messages: ['RFC invalido'] }) }),
  });
  try {
    const res = await supertest(app).put('/api/actualizar-cliente/42')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ street: 'X' });
    assert.strictEqual(res.status, 503);
  } finally {
    restore();
  }
});

// === POST /api/crear-cliente ===

test('POST /api/crear-cliente sin tax_id retorna 400', async () => {
  const res = await supertest(app).post('/api/crear-cliente')
    .set('Authorization', `Bearer ${TEST_TOKEN}`)
    .send({ CustName: 'Sin RFC' });
  assert.strictEqual(res.status, 400);
  assert.ok(res.body.error);
});

test('POST /api/crear-cliente sin token retorna 401', async () => {
  const res = await supertest(app).post('/api/crear-cliente').send({ tax_id: 'NVO010101ABC' });
  assert.strictEqual(res.status, 401);
});

test('POST /api/crear-cliente crea cliente nuevo y retorna { ok:true, customer_id }', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return { ok: true, json: async () => ({ result: true, customer_id: 77 }) };
      if (u.includes('/77')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 177 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/177': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({
        tax_id: 'NVO010101ABC', CustName: 'Nuevo SA de CV',
        entrega: { br_name: 'Almacen', br_ref: 'ALM', addr_street: 'Calle', addr_exterior: '1', addr_interior: '', addr_colony: 'Col', addr_city: 'CDMX', addr_state: 'CDMX', addr_zip: '06600', addr_reference: '', phone: '', email: '', pais: 'MX' },
        salesman: 47,
      });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.customer_id, 77);
    assert.strictEqual(res.body.duplicado, false);
  } finally {
    restore();
  }
});

test('POST /api/crear-cliente con RFC duplicado retorna duplicado:true con datos', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': () => ({ ok: true, json: async () => ({ total: 1, data: [{ customer_id: 55, CustName: 'Duplicado SA', tax_id: 'DUP010101ABC', street: '', street_number: '', suite_number: '', district: '', postal_code: '', city: '', state: '', cfdi_regimen_fiscal: '601', branches: [] }] }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ tax_id: 'DUP010101ABC', CustName: 'Duplicado SA' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.duplicado, true);
    assert.strictEqual(res.body.customer_id, 55);
  } finally {
    restore();
  }
});

// === GET /api/buscar-cliente ===

test('GET /api/buscar-cliente sin rfc retorna 400', async () => {
  const res = await supertest(app).get('/api/buscar-cliente').set('Authorization', `Bearer ${TEST_TOKEN}`);
  assert.strictEqual(res.status, 400);
  assert.ok(res.body.error);
});

test('GET /api/buscar-cliente sin token retorna 401', async () => {
  const res = await supertest(app).get('/api/buscar-cliente?rfc=ACE010101ABC');
  assert.strictEqual(res.status, 401);
});

test('GET /api/buscar-cliente?rfc=... retorna 200 con datos cuando existe en Operam', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': () => ({ ok: true, json: async () => ({ total: 1, data: [{ customer_id: 55, CustName: 'Aceros SA de CV', tax_id: 'ACE010101ABC', street: 'Reforma', street_number: '1', suite_number: '', district: 'Juarez', postal_code: '06600', city: 'CDMX', state: 'CDMX', cfdi_regimen_fiscal: '601', branches: [{ br_name: 'Aceros', addr_street: 'Reforma', addr_colony: 'Juarez', addr_zip: '06600', addr_city: 'CDMX', addr_state: 'CDMX', phone: '', email: '' }] }] }) }),
  });
  try {
    const res = await supertest(app).get('/api/buscar-cliente?rfc=ACE010101ABC').set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.encontrado, true);
    assert.strictEqual(res.body.cliente_id, 55);
  } finally {
    restore();
  }
});

test('GET /api/buscar-cliente?rfc=... retorna 200 {encontrado:false} cuando no existe', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': () => ({ ok: true, json: async () => ({ total: 0, data: [] }) }),
  });
  try {
    const res = await supertest(app).get('/api/buscar-cliente?rfc=RFC000000000').set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.encontrado, false);
  } finally {
    restore();
  }
});

test('GET /api/buscar-cliente retorna 503 si Operam lanza error', async () => {
  const restore = mockOperamFetch({ '/api/v3/login': () => { throw new Error('timeout'); } });
  try {
    const res = await supertest(app).get('/api/buscar-cliente?rfc=ACE010101ABC').set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 503);
  } finally {
    restore();
  }
});

// === POST /api/csf-from-url (issue #33: reusa parsearCSF) ===

test('POST /api/csf-from-url responde texto crudo y datos parseados de la CSF', async () => {
  const html = '<html><body>R.F.C. : UEGA850312KL5<br>Nombre (s) : ADRIANA<br>Primer Apellido : URENA</body></html>';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes('sat.gob.mx'));
    return { ok: true, text: async () => html };
  };
  try {
    const res = await supertest(app).post('/api/csf-from-url')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ url: 'https://siat.sat.gob.mx/qr?id=123' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.ok(res.body.texto.includes('UEGA850312KL5'));
    assert.strictEqual(res.body.datos.rfc, 'UEGA850312KL5');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('POST /api/csf-from-url sin token retorna 401', async () => {
  const res = await supertest(app).post('/api/csf-from-url').send({ url: 'https://siat.sat.gob.mx/qr?id=123' });
  assert.strictEqual(res.status, 401);
});

// === POST /api/parsear-csf (issue #33) ===

const CSF_PERSONA_FISICA_TXT = `
CONSTANCIA DE SITUACION FISCAL
Nombre (s) : ADRIANA
Primer Apellido : URENA
Segundo Apellido : GARCIA
R.F.C. : UEGA850312KL5
idCIF : 98765432101
Nombre de la Vialidad : INSURGENTES SUR
Número Exterior : 123
Nombre de la Colonia : DEL VALLE
Código Postal : 03100
Nombre del Municipio o Demarcación Territorial : BENITO JUAREZ
Nombre de la Entidad Federativa : CIUDAD DE MEXICO
Régimen Fiscal : 612 Personas Físicas con Actividades Empresariales
`;

test('POST /api/parsear-csf con texto de persona fisica retorna { ok:true, datos }', async () => {
  const res = await supertest(app).post('/api/parsear-csf').send({ texto: CSF_PERSONA_FISICA_TXT });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.datos.rfc, 'UEGA850312KL5');
  assert.ok(res.body.datos.razonSocial.includes('ADRIANA'));
});

const CSF_PERSONA_MORAL_TXT = `
CONSTANCIA DE SITUACION FISCAL
Denominación/Razón Social : BANCO DE MEXICO FIDEICOMISO PARA LOS MUSEOS DIEGO RIVERA Y FRIDA KAHLO
R.F.C. : BMF821130AR3
idCIF : 12345678901
Nombre de la Vialidad : AV 5 DE MAYO
Número Exterior : 2
Nombre de la Colonia : CENTRO DE LA CIUDAD DE MEXICO AREA 1
Código Postal : 06000
Nombre del Municipio o Demarcación Territorial : CUAUHTEMOC
Nombre de la Entidad Federativa : CIUDAD DE MEXICO
Régimen Fiscal : 601 General de Ley Personas Morales
`;

test('POST /api/parsear-csf con texto de persona moral retorna estructura completa con domicilio', async () => {
  const res = await supertest(app).post('/api/parsear-csf').send({ texto: CSF_PERSONA_MORAL_TXT });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.datos.rfc, 'BMF821130AR3');
  assert.ok(res.body.datos.razonSocial.includes('BANCO DE MEXICO'));
  assert.strictEqual(res.body.datos.calle, 'AV 5 DE MAYO');
  assert.strictEqual(res.body.datos.numExt, '2');
  assert.strictEqual(res.body.datos.numInt, '');
  assert.strictEqual(res.body.datos.colonia, 'CENTRO DE LA CIUDAD DE MEXICO AREA 1');
  assert.strictEqual(res.body.datos.regimenFiscal, '601');
});

const CSF_RFC_SUFIJO_ESPURIO_TXT = `
CONSTANCIA DE SITUACION FISCAL
Denominación/Razón Social : SAGO MEDICAL SERVICE
RFC: SMS200716NZ4 Denominación/Razón Social : SAGO MEDICAL SERVICE
idCIF : 20090146505
Nombre de la Vialidad : NAYARIT
Número Exterior : 56
Nombre de la Colonia : ROMA SUR
Código Postal : 06760
Nombre del Municipio o Demarcación Territorial : CUAUHTEMOC
Nombre de la Entidad Federativa : CIUDAD DE MEXICO
Régimen Fiscal : 601 General de Ley Personas Morales
`;

test('POST /api/parsear-csf con RFC seguido de texto en la misma linea no captura sufijo espurio', async () => {
  const res = await supertest(app).post('/api/parsear-csf').send({ texto: CSF_RFC_SUFIJO_ESPURIO_TXT });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.datos.rfc, 'SMS200716NZ4');
});

test('POST /api/parsear-csf con texto sin RFC detectable retorna error claro, no datos vacios', async () => {
  const res = await supertest(app).post('/api/parsear-csf').send({ texto: 'Este documento no es una CSF, es una factura cualquiera.' });
  assert.strictEqual(res.status, 422);
  assert.strictEqual(res.body.ok, false);
  assert.ok(res.body.error);
  assert.strictEqual(res.body.datos, undefined);
});

test('POST /api/parsear-csf sin campo texto retorna 400', async () => {
  const res = await supertest(app).post('/api/parsear-csf').send({});
  assert.strictEqual(res.status, 400);
  assert.ok(res.body.error);
});

test('POST /api/parsear-csf no requiere JWT (mismo patron que /api/csf-from-url y /api/buscar-cliente)', async () => {
  const res = await supertest(app).post('/api/parsear-csf').send({ texto: CSF_PERSONA_FISICA_TXT });
  assert.notStrictEqual(res.status, 401);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.ok, true);
});

test('POST /api/parsear-csf con texto solo de espacios en blanco retorna 422, no datos vacios', async () => {
  const res = await supertest(app).post('/api/parsear-csf').send({ texto: '   \n\n   ' });
  assert.strictEqual(res.status, 422);
  assert.strictEqual(res.body.ok, false);
  assert.ok(res.body.error);
  assert.strictEqual(res.body.datos, undefined);
});

// === GET /api/catalogos (issue #27) ===

const SALES_TYPES_MOCK = [
  { sales_type_id: 'M100',  description: 'Mayoreo 100' },
  { sales_type_id: 'M350',  description: 'Mayoreo 350' },
  { sales_type_id: 'M550',  description: 'Mayoreo 550' },
  { sales_type_id: 'M1500', description: 'Mayoreo 1500' },
  { sales_type_id: 'M6000', description: 'Mayoreo 6000' },
  { sales_type_id: 'M6001', description: 'Mayoreo 6001' },
  { sales_type_id: 'US100', description: 'USA 100' },
  { sales_type_id: 'US350', description: 'USA 350' },
  { sales_type_id: 'US550', description: 'USA 550' },
  { sales_type_id: 'US1500', description: 'USA 1500' },
  { sales_type_id: 'US6000', description: 'USA 6000' },
  { sales_type_id: 'MEN50', description: 'Menudeo 50' },
  { sales_type_id: 'OTRO',  description: 'Otro' },
];

function mockCatalogos() {
  return mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok' }) }),
    '/api/v3/sales/sales_types': () => ({ ok: true, json: async () => ({ data: SALES_TYPES_MOCK }) }),
  });
}

test('C1: GET /api/catalogos retorna 200 con estructura { segmentos, vendedores, listas_precios }', async () => {
  const restore = mockCatalogos();
  try {
    await cargarListasPrecios();
    const res = await supertest(app).get('/api/catalogos').set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.segmentos), 'segmentos debe ser array');
    assert.ok(Array.isArray(res.body.vendedores), 'vendedores debe ser array');
    assert.ok(Array.isArray(res.body.listas_precios), 'listas_precios debe ser array');
  } finally {
    restore();
  }
});

test('C2: GET /api/catalogos segmentos son los 11 reales de Operam con sus ids internos', async () => {
  const restore = mockCatalogos();
  try {
    await cargarListasPrecios();
    const res = await supertest(app).get('/api/catalogos').set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.body.segmentos.length, 11);
    const porNombre = Object.fromEntries(res.body.segmentos.map(s => [s.nombre, s.id]));
    assert.strictEqual(porNombre['Sin segmento'], 1);
    assert.strictEqual(porNombre['Distribuidores'], 14);
    assert.strictEqual(porNombre['Menudistas'], 8);
    assert.strictEqual(porNombre['Restaurantes, hoteles'], 10);
    assert.strictEqual(porNombre['Agencias | Marcas'], 12);
    assert.strictEqual(porNombre['e-commerce'], 11);
    assert.strictEqual(porNombre['Eventos'], 15);
    assert.strictEqual(porNombre['Consumidor final'], 16);
    assert.strictEqual(porNombre['Empleados'], 13);
    assert.strictEqual(porNombre['Familia y Amigos'], 9);
    assert.strictEqual(porNombre['Maquila'], 17);
  } finally {
    restore();
  }
});

test('C3: GET /api/catalogos vendedores excluye entradas con operam_id null', async () => {
  const restore = mockCatalogos();
  try {
    await cargarListasPrecios();
    const res = await supertest(app).get('/api/catalogos').set('Authorization', `Bearer ${TEST_TOKEN}`);
    const conNull = res.body.vendedores.filter(v => v.operam_id === null);
    assert.strictEqual(conNull.length, 0, 'ningun vendedor debe tener operam_id null');
    assert.ok(res.body.vendedores.every(v => v.operam_id != null));
  } finally {
    restore();
  }
});

test('C4: GET /api/catalogos listas_precios contiene solo codigos mayoreo y excluye menudeo', async () => {
  const restore = mockCatalogos();
  try {
    await cargarListasPrecios();
    const res = await supertest(app).get('/api/catalogos').set('Authorization', `Bearer ${TEST_TOKEN}`);
    const ids = res.body.listas_precios.map(l => l.id);
    const MAYOREO = ['M100', 'M350', 'M550', 'M1500', 'M6000', 'M6001', 'US100', 'US350', 'US550', 'US1500', 'US6000'];
    for (const codigo of MAYOREO) {
      assert.ok(ids.includes(codigo), `debe incluir ${codigo}`);
    }
    assert.ok(!ids.includes('MEN50'), 'no debe incluir MEN50 (menudeo)');
    assert.ok(!ids.includes('OTRO'), 'no debe incluir OTRO');
    assert.strictEqual(ids.length, 11);
  } finally {
    restore();
  }
});

test('C5: GET /api/catalogos sin token retorna 401', async () => {
  const res = await supertest(app).get('/api/catalogos');
  assert.strictEqual(res.status, 401);
});

test('C6: GET /api/catalogos listas_precios cada entrada tiene { id, nombre }', async () => {
  const restore = mockCatalogos();
  try {
    await cargarListasPrecios();
    const res = await supertest(app).get('/api/catalogos').set('Authorization', `Bearer ${TEST_TOKEN}`);
    for (const lista of res.body.listas_precios) {
      assert.ok(lista.id, 'cada lista debe tener id');
      assert.ok(lista.nombre !== undefined, 'cada lista debe tener nombre');
    }
  } finally {
    restore();
  }
});

test('C7: GET /api/catalogos vendedores cada entrada tiene { id, name, operam_id }', async () => {
  const restore = mockCatalogos();
  try {
    await cargarListasPrecios();
    const res = await supertest(app).get('/api/catalogos').set('Authorization', `Bearer ${TEST_TOKEN}`);
    for (const v of res.body.vendedores) {
      assert.ok(v.id, 'cada vendedor debe tener id');
      assert.ok(v.name, 'cada vendedor debe tener name');
      assert.ok(v.operam_id != null, 'operam_id no debe ser null');
    }
  } finally {
    restore();
  }
});

// === POST /api/crear-cliente flujo atomico POST+GET+PUT (issue #29) ===

const BASE_CLIENTE = {
  tax_id: 'NUE010101ABC', CustName: 'Nueva SA de CV',
  pais: 'MX', sales_type: 'M350', segmento_id: '3', salesman: 47,
  timbrado_uso_cfdi: 'G03',
  entrega: {
    br_name: 'Almacen Central', br_ref: 'ALMCEN',
    addr_street: 'Reforma', addr_exterior: '1', addr_interior: '',
    addr_colony: 'Juarez', addr_city: 'CDMX', addr_state: 'CDMX',
    addr_zip: '06600', addr_reference: '',
    phone: '5512345678', email: 'entrega@nueva.com', pais: 'MX',
  },
};

test('D1: POST /api/crear-cliente flujo completo retorna customer_id, branch_id y steps', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return { ok: true, json: async () => ({ result: true, customer_id: 500 }) };
      if (u.includes('/500')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 600 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/600': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send(BASE_CLIENTE);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.customer_id, 500, 'debe retornar customer_id');
    assert.strictEqual(res.body.branch_id, 600, 'debe retornar branch_id');
    assert.ok(Array.isArray(res.body.steps), 'debe retornar array steps');
    assert.strictEqual(res.body.steps.length, 3, 'debe tener 3 steps');
    assert.ok(res.body.steps.every(s => s.name && s.status), 'cada step debe tener name y status');
    assert.ok(res.body.steps.every(s => s.status === 'ok'), 'todos los steps deben ser ok');
  } finally {
    restore();
  }
});

test('D1b: POST /api/crear-cliente envia invoice_email/celular_nota en notes y phone/email a nivel cliente (issues #16/#17/#18)', async () => {
  let postBody = null;
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { postBody = JSON.parse(opts.body); return { ok: true, json: async () => ({ result: true, customer_id: 510 }) }; }
      if (u.includes('/510')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 610 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/610': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({
        ...BASE_CLIENTE,
        invoice_email: 'facturacion@nueva.com',
        celular_nota: '5599998888',
        phone: '+52 5512345678',
        email: 'entrega@nueva.com',
      });
    assert.strictEqual(res.status, 200);
    assert.ok(postBody, 'debe haber hecho POST /customers');
    assert.ok(postBody.notes.includes('facturacion@nueva.com'), 'notes debe incluir el email de facturacion');
    assert.ok(postBody.notes.includes('5599998888'), 'notes debe incluir el celular');
    assert.strictEqual(postBody.phone, '+52 5512345678', 'phone a nivel cliente debe ir en el POST a Operam');
    assert.strictEqual(postBody.email, 'entrega@nueva.com', 'email a nivel cliente debe ir en el POST a Operam');
  } finally {
    restore();
  }
});

test('D2: POST /api/crear-cliente fallo en PUT branch retorna steps con error y customer_id/branch_id', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') return { ok: true, json: async () => ({ result: true, customer_id: 501 }) };
      if (u.includes('/501')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 601 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/601': () => ({ ok: true, json: async () => ({ result: false, messages: ['Error en branch'] }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send(BASE_CLIENTE);
    assert.strictEqual(res.status, 200, 'respuesta debe ser 200 incluso con fallo en PUT');
    assert.strictEqual(res.body.ok, false, 'ok debe ser false cuando falla un paso');
    assert.strictEqual(res.body.customer_id, 501, 'debe retornar customer_id aunque falle el PUT');
    assert.strictEqual(res.body.branch_id, 601, 'debe retornar branch_id aunque falle el PUT');
    const putStep = res.body.steps.find(s => s.name === 'PUT branch');
    assert.ok(putStep, 'debe existir step PUT branch');
    assert.strictEqual(putStep.status, 'error', 'el step de PUT branch debe tener status error');
    assert.ok(putStep.error, 'el step de PUT branch debe incluir mensaje de error');
  } finally {
    restore();
  }
});

test('D3: POST /api/crear-cliente con customer_id existente salta POST y no duplica cliente', async () => {
  let postCustomerCalled = false;
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'POST') { postCustomerCalled = true; return { ok: true, json: async () => ({ result: true, customer_id: 999 }) }; }
      if (u.includes('/502')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 602 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/602': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ ...BASE_CLIENTE, customer_id: 502 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.customer_id, 502, 'debe usar el customer_id existente');
    assert.ok(!postCustomerCalled, 'NO debe hacer POST /customers cuando ya se conoce el customer_id');
  } finally {
    restore();
  }
});

test('D4: POST /api/crear-cliente con customer_id existente actualiza sales_type/segmento_id/salesman/timbrado_uso_cfdi via PUT customers/:id (issue #11)', async () => {
  let putCustomerBody = null;
  let putCustomerCalled = false;
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') { putCustomerCalled = true; putCustomerBody = JSON.parse(opts.body); return { ok: true, json: async () => ({ result: true }) }; }
      if (opts?.method === 'POST') return { ok: true, json: async () => ({ result: true, customer_id: 999 }) };
      if (u.includes('/503')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 603 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/603': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ ...BASE_CLIENTE, customer_id: 503 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.ok(putCustomerCalled, 'debe hacer PUT /customers/:id para cliente existente');
    assert.strictEqual(putCustomerBody.sales_type, BASE_CLIENTE.sales_type, 'debe enviar sales_type seleccionado');
    assert.strictEqual(putCustomerBody.segmento_id, BASE_CLIENTE.segmento_id, 'debe enviar segmento_id seleccionado');
    assert.strictEqual(putCustomerBody.salesman, BASE_CLIENTE.salesman, 'debe enviar salesman seleccionado');
    assert.strictEqual(putCustomerBody.timbrado_uso_cfdi, BASE_CLIENTE.timbrado_uso_cfdi, 'debe enviar timbrado_uso_cfdi seleccionado');
    const putCustomerStep = res.body.steps.find(s => s.name === 'PUT customer (config comercial)');
    assert.ok(putCustomerStep, 'debe existir step PUT customer (config comercial)');
    assert.strictEqual(putCustomerStep.status, 'ok');
  } finally {
    restore();
  }
});

test('D5: POST /api/crear-cliente cliente nuevo NO hace PUT customers/:id de config comercial (ya viaja en el POST)', async () => {
  let putCustomerCalled = false;
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') { putCustomerCalled = true; return { ok: true, json: async () => ({ result: true }) }; }
      if (opts?.method === 'POST') return { ok: true, json: async () => ({ result: true, customer_id: 504 }) };
      if (u.includes('/504')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 604 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/604': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send(BASE_CLIENTE);
    assert.strictEqual(res.status, 200);
    assert.ok(!putCustomerCalled, 'NO debe hacer PUT /customers/:id cuando el cliente es nuevo (config ya va en el POST)');
    assert.ok(!res.body.steps.find(s => s.name === 'PUT customer (config comercial)'), 'no debe existir el step para cliente nuevo');
  } finally {
    restore();
  }
});

test('D6: POST /api/crear-cliente fallo en PUT customer (config comercial) retorna step con error sin bloquear PUT branch posterior', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': (u, opts) => {
      if (opts?.method === 'PUT') return { ok: true, json: async () => ({ result: false, messages: ['No se pudo actualizar'] }) };
      if (u.includes('/505')) return { ok: true, json: async () => ({ data: [{ branches: [{ branch_code: 605 }] }] }) };
      return { ok: true, json: async () => ({ total: 0, data: [] }) };
    },
    '/api/v3/sales/branches/605': () => ({ ok: true, json: async () => ({ result: true }) }),
  });
  try {
    const res = await supertest(app).post('/api/crear-cliente')
      .set('Authorization', `Bearer ${TEST_TOKEN}`)
      .send({ ...BASE_CLIENTE, customer_id: 505 });
    assert.strictEqual(res.status, 200);
    const putCustomerStep = res.body.steps.find(s => s.name === 'PUT customer (config comercial)');
    assert.ok(putCustomerStep, 'debe existir el step aunque falle');
    assert.strictEqual(putCustomerStep.status, 'error');
    assert.ok(putCustomerStep.error, 'debe incluir mensaje de error');
    const putBranchStep = res.body.steps.find(s => s.name === 'PUT branch');
    assert.ok(putBranchStep, 'PUT branch debe seguir ejecutandose pese al fallo de config comercial');
    assert.strictEqual(putBranchStep.status, 'ok');
  } finally {
    restore();
  }
});

// === GET /api/buscar-cliente-duplicado (issue #31) ===

test('E1: GET /api/buscar-cliente-duplicado retorna exacto cuando RFC real ya existe en Operam', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': () => ({ ok: true, json: async () => ({
      total: 1,
      data: [{ customer_id: 77, CustName: 'Peltre Nacional SA de CV', cust_ref: 'PELTRE', tax_id: 'PNA010203ABC' }],
    }) }),
  });
  try {
    const res = await supertest(app)
      .get('/api/buscar-cliente-duplicado?rfc=PNA010203ABC&nombre=Peltre+Nacional')
      .set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.tipo, 'exacto');
    assert.ok(res.body.cliente, 'debe incluir cliente');
    assert.strictEqual(res.body.cliente.id, 77);
  } finally {
    restore();
  }
});

test('E2: GET /api/buscar-cliente-duplicado retorna candidatos para RFC generico con nombre similar', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': () => ({ ok: true, json: async () => ({
      total: 2,
      data: [
        { customer_id: 10, CustName: 'Comercio General SA de CV', cust_ref: 'COGEN', tax_id: 'XAXX010101000' },
        { customer_id: 11, CustName: 'Comercializadora Norte SA de CV', cust_ref: 'COGNOR', tax_id: 'XAXX010101000' },
      ],
    }) }),
  });
  try {
    const res = await supertest(app)
      .get('/api/buscar-cliente-duplicado?rfc=XAXX010101000&nombre=Comercio+General+Mayorista')
      .set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.tipo, 'candidatos');
    assert.ok(Array.isArray(res.body.candidatos), 'debe incluir array candidatos');
    assert.ok(res.body.candidatos.length >= 1);
  } finally {
    restore();
  }
});

test('E3: GET /api/buscar-cliente-duplicado sin token retorna 401', async () => {
  const res = await supertest(app).get('/api/buscar-cliente-duplicado?rfc=PNA010203ABC&nombre=Peltre');
  assert.strictEqual(res.status, 401);
});

test('E4: GET /api/buscar-cliente-duplicado retorna libre cuando no hay match', async () => {
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/customers': () => ({ ok: true, json: async () => ({ total: 0, data: [] }) }),
  });
  try {
    const res = await supertest(app)
      .get('/api/buscar-cliente-duplicado?rfc=NUE990101ZZZ&nombre=Nueva+Empresa')
      .set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.tipo, 'libre');
  } finally {
    restore();
  }
});

// === Webhook de Operam (sync post-venta, #62) ===
// Auth por header secreto (NO el JWT del cotizador: Operam no lo tiene). El webhook
// es solo una señal; la reconciliacion lee la verdad por API. Sin DATABASE_URL el
// log es graceful (no rompe). Responde 200 aunque no se ligue a una oportunidad.

const WEBHOOK_SECRET = 'test-webhook-secret';

test('W1: POST /api/webhooks/operam sin header secreto retorna 401', async () => {
  process.env.OPERAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  const res = await supertest(app).post('/api/webhooks/operam').send({ order_: '7077' });
  assert.strictEqual(res.status, 401);
});

test('W2: POST /api/webhooks/operam con header secreto incorrecto retorna 401', async () => {
  process.env.OPERAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  const res = await supertest(app)
    .post('/api/webhooks/operam')
    .set('X-Operam-Webhook-Secret', 'mal')
    .send({ order_: '7077' });
  assert.strictEqual(res.status, 401);
});

test('W3: POST /api/webhooks/operam con secreto correcto pero RFC desconocido responde 200 sin mover nada', async () => {
  process.env.OPERAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  const snap = readCots();
  const res = await supertest(app)
    .post('/api/webhooks/operam')
    .set('X-Operam-Webhook-Secret', WEBHOOK_SECRET)
    .send({ model: 'Payment', event: 'ADD', tax_id: 'ZZZ999999ZZZ', order_: '0' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.ok, true);
  // No se ligo a ninguna oportunidad.
  assert.ok(Array.isArray(res.body.reconciliadas));
  assert.strictEqual(res.body.reconciliadas.length, 0);
  // No toco el store.
  assert.deepEqual(readCots(), snap);
});

test('W4: POST /api/webhooks/operam liga por RFC y mueve la oportunidad leyendo Operam', async () => {
  process.env.OPERAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  // Oportunidad en seguimiento del RFC del webhook.
  writeCots([{ id: 5001, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', cliente: 'EL PENDULO',
    etapa: 'seguimiento', data: { cliente: { rfc: 'CPE921211N76' } } }]);
  // Operam: factura (10) liquidada + remision (13) + pedido (30) -> producto_entregado.
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/transactions': () => ({ ok: true, json: async () => ({ data: [
      { type: '10', order_: '7077', total_amount: '16954', allocated: '16954', outstanding: '0', debtor_no: '345' },
      { type: '13', order_: '7077', total_amount: '16954', allocated: '0', outstanding: '0', debtor_no: '345' },
    ] }) }),
    '/api/v3/sales/sales_orders': () => ({ ok: true, json: async () => ({ data: [
      { order_no: '7077', trans_type: '30', debtor_no: '345' },
    ] }) }),
  });
  try {
    const res = await supertest(app)
      .post('/api/webhooks/operam')
      .set('X-Operam-Webhook-Secret', WEBHOOK_SECRET)
      .send({ model: 'CustDelivery', event: 'ADD', tax_id: 'CPE921211N76', order_: '7077' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.reconciliadas.length, 1);
    assert.strictEqual(res.body.reconciliadas[0].etapa, 'producto_entregado');
    const movida = readCots().find(c => c.id === 5001);
    assert.strictEqual(movida.etapa, 'producto_entregado');
  } finally {
    restore();
  }
});

test('W5: POST /api/webhooks/operam con Operam caido responde 200 (no truena el webhook)', async () => {
  process.env.OPERAM_WEBHOOK_SECRET = WEBHOOK_SECRET;
  writeCots([{ id: 5002, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', cliente: 'X',
    etapa: 'seguimiento', data: { cliente: { rfc: 'CPE921211N76' } } }]);
  const restore = mockOperamFetch({ '/api/v3/login': () => { throw new Error('timeout'); } });
  try {
    const res = await supertest(app)
      .post('/api/webhooks/operam')
      .set('X-Operam-Webhook-Secret', WEBHOOK_SECRET)
      .send({ model: 'Payment', event: 'ADD', tax_id: 'CPE921211N76', order_: '7077' });
    assert.strictEqual(res.status, 200);
  } finally {
    restore();
  }
});

// === Reconciliacion on-demand (#62 F4, red de seguridad) ===
// Ruta autenticada con el JWT del cotizador que reconcilia las oportunidades
// activas no terminadas leyendo Operam. No recorre el historico, solo candidatas.

test('S1: POST /api/sync-operam sin token retorna 401', async () => {
  const res = await supertest(app).post('/api/sync-operam');
  assert.strictEqual(res.status, 401);
});

test('S2: POST /api/sync-operam reconcilia las oportunidades activas y mueve las que avanzan', async () => {
  writeCots([
    { id: 6001, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', cliente: 'EL PENDULO',
      etapa: 'seguimiento', data: { cliente: { rfc: 'CPE921211N76' } } },
    // Sin RFC: no es candidata a Operam, se ignora sin tronar.
    { id: 6002, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', cliente: 'SIN RFC',
      etapa: 'seguimiento', data: { cliente: {} } },
    // Terminada: no se reconcilia.
    { id: 6003, fecha: '2026-06-01T00:00:00Z', vendedor: 'Memo', cliente: 'ENTREGADA',
      etapa: 'producto_entregado', data: { cliente: { rfc: 'OTRO010101AAA' } } },
  ]);
  const restore = mockOperamFetch({
    '/api/v3/login': () => ({ ok: true, json: async () => ({ token: 'tok', result: true }) }),
    '/api/v3/sales/transactions': () => ({ ok: true, json: async () => ({ data: [
      { type: '10', order_: '7400', total_amount: '2000', allocated: '500', outstanding: '1500', debtor_no: '345' },
    ] }) }),
    '/api/v3/sales/sales_orders': () => ({ ok: true, json: async () => ({ data: [] }) }),
  });
  try {
    const res = await supertest(app).post('/api/sync-operam').set('Authorization', `Bearer ${TEST_TOKEN}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    const movida = readCots().find(c => c.id === 6001);
    assert.strictEqual(movida.etapa, 'anticipo_pagado');
    // No movio la terminada.
    assert.strictEqual(readCots().find(c => c.id === 6003).etapa, 'producto_entregado');
  } finally {
    restore();
  }
});
