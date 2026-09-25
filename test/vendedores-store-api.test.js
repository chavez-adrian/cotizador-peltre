// #141: el registro de vendedores vive en el store (Neon con fallback al JSON).
// Sin DATABASE_URL el comportamiento por HTTP tiene que ser el de siempre: login,
// catalogos y el GET/PUT de administracion, con el array completo como contrato.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VENDEDORES_PATH = join(__dirname, '..', 'data', 'vendedores.json');

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}
// Esta suite ESCRIBE via el store (el PUT hace DELETE en Neon si hay pool). El
// borrado es efectivo porque el pool de lib/db.js nace durante el import
// dinamico de abajo, que corre despues de esta linea.
delete process.env.DATABASE_URL;

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const { app } = await import('../server.js');
const { resetLimiteLogin } = await import('../lib/limite-login.js');

const tokenAdmin = jwt.sign({ id: 1, name: 'Jefa Test', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

// Registro controlado: los PIN reales no deben decidir si esta suite pasa.
const REGISTRO = [
  { id: 1, name: 'Jefa Test', pin: '9001', role: 'admin', operam_id: 1 },
  { id: 2, name: 'Vendedor Test', pin: '9002', role: 'vendedor', operam_id: 2, topeDescuento: 15 },
  { id: 3, name: 'Sin Operam Test', pin: '9003', role: 'vendedor', operam_id: null },
];

function escribirRegistro(registro) {
  escribirArchivoSync(VENDEDORES_PATH, JSON.stringify(registro, null, 2));
}

// El registro esta versionado: se restaura el TEXTO original, no una
// re-serializacion, para no dejar el archivo del repo reformateado.
let original;
before(() => {
  original = leerArchivoSync(VENDEDORES_PATH);
  escribirRegistro(REGISTRO);
});
after(() => {
  escribirArchivoSync(VENDEDORES_PATH, original);
});
// #450: todas las peticiones de esta suite salen de la misma IP y varias pruebas
// fallan el PIN a proposito; sin reiniciar el limite, la quinta ya responde 429.
beforeEach(() => { resetLimiteLogin(); });

test('login: el PIN del registro autentica y el equivocado no', async () => {
  escribirRegistro(REGISTRO);
  const ok = await supertest(app).post('/api/login').send({ vendedorId: 2, pin: '9002' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body.user.name, 'Vendedor Test');
  assert.strictEqual(ok.body.user.role, 'vendedor');

  const mal = await supertest(app).post('/api/login').send({ vendedorId: 2, pin: '0001' });
  assert.strictEqual(mal.status, 401);
});

// #440: el login de /admin mandaba siempre vendedorId 1, asi que ningun otro
// admin entraba. Con `soloAdmin` la ruta autentica al vendedor ELEGIDO y solo
// si su rol es admin; un PIN correcto de un no-admin responde igual que un PIN
// equivocado, para no confirmar el PIN de nadie desde el login de /admin.
const REGISTRO_DOS_ADMINS = [
  ...REGISTRO,
  { id: 7, name: 'Agente Test', pin: '9007', role: 'admin', operam_id: null },
];

test('#440 login de /admin: entra cada admin con su PIN, no solo el vendedor 1', async () => {
  escribirRegistro(REGISTRO_DOS_ADMINS);
  const jefa = await supertest(app).post('/api/login').send({ vendedorId: 1, pin: '9001', soloAdmin: true });
  assert.strictEqual(jefa.status, 200);
  assert.strictEqual(jefa.body.user.name, 'Jefa Test');

  const agente = await supertest(app).post('/api/login').send({ vendedorId: 7, pin: '9007', soloAdmin: true });
  assert.strictEqual(agente.status, 200);
  assert.deepStrictEqual(agente.body.user, { id: 7, name: 'Agente Test', role: 'admin' });
  const token = jwt.verify(agente.body.token, JWT_SECRET);
  assert.strictEqual(token.id, 7);
  assert.strictEqual(token.role, 'admin');

  const cruzado = await supertest(app).post('/api/login').send({ vendedorId: 7, pin: '9001', soloAdmin: true });
  assert.strictEqual(cruzado.status, 401, 'el PIN de otro admin no abre la cuenta elegida');
});

test('#440 login de /admin: un vendedor sin rol admin no entra aunque su PIN sea correcto', async () => {
  escribirRegistro(REGISTRO_DOS_ADMINS);
  const noAdmin = await supertest(app).post('/api/login').send({ vendedorId: 2, pin: '9002', soloAdmin: true });
  assert.strictEqual(noAdmin.status, 401);
  assert.strictEqual(noAdmin.body.token, undefined);
  assert.strictEqual(noAdmin.body.user, undefined);

  const pinMalo = await supertest(app).post('/api/login').send({ vendedorId: 2, pin: '0001', soloAdmin: true });
  assert.deepStrictEqual(noAdmin.body, pinMalo.body, 'no distingue PIN correcto de PIN equivocado');

  const enCotizador = await supertest(app).post('/api/login').send({ vendedorId: 2, pin: '9002' });
  assert.strictEqual(enCotizador.status, 200, 'el login de / sigue aceptando al vendedor');
});

// #449: el login del Maestro de articulos (/admin/catalogo) mandaba siempre el
// vendedor 1, como /admin antes de #440. Los dos paneles entran ahora por el
// MISMO modulo del navegador (public/js/login-admin.js), que llama a
// POST /api/login con `soloAdmin`: la regla del rol vive una sola vez, en el
// servidor. Estas pruebas corren ese modulo contra la app real con un fetch que
// traduce a supertest.
async function fetchContraApp(url, opts = {}) {
  let peticion = supertest(app)[(opts.method || 'GET').toLowerCase()](url);
  for (const [llave, valor] of Object.entries(opts.headers || {})) peticion = peticion.set(llave, valor);
  if (opts.body !== undefined) peticion = peticion.send(opts.body);
  const res = await peticion;
  return { ok: res.status >= 200 && res.status < 300, status: res.status, json: async () => res.body };
}

test('#449 login de /admin/catalogo: entra un admin distinto del 1 con su PIN', async () => {
  escribirRegistro(REGISTRO_DOS_ADMINS);
  const { entrarComoAdmin } = await import('../public/js/login-admin.js');
  // El value del <select> llega como texto.
  const agente = await entrarComoAdmin(fetchContraApp, '7', '9007');
  assert.strictEqual(agente.error, undefined);
  assert.deepStrictEqual(agente.user, { id: 7, name: 'Agente Test', role: 'admin' });
  const token = jwt.verify(agente.token, JWT_SECRET);
  assert.strictEqual(token.id, 7);
  assert.strictEqual(token.role, 'admin');
});

test('#449 login de /admin/catalogo: el no-admin con su PIN correcto ve lo mismo que con un PIN equivocado', async () => {
  escribirRegistro(REGISTRO_DOS_ADMINS);
  const { entrarComoAdmin } = await import('../public/js/login-admin.js');
  // El rechazo tiene que venir del SERVIDOR: sin `soloAdmin` la ruta aceptaria
  // al vendedor (200 con token) y solo el filtro del navegador lo taparia.
  const logins = [];
  const fetchEspia = async (url, opts = {}) => {
    const res = await fetchContraApp(url, opts);
    if (url === '/api/login') logins.push({ body: JSON.parse(opts.body), status: res.status });
    return res;
  };
  const noAdmin = await entrarComoAdmin(fetchEspia, '2', '9002');
  assert.strictEqual(logins.length, 1);
  assert.strictEqual(logins[0].body.soloAdmin, true, 'el modulo pide login de administrador');
  assert.strictEqual(logins[0].status, 401, 'el servidor rechaza al no-admin con PIN correcto');
  assert.deepStrictEqual(noAdmin, { error: 'PIN incorrecto o no es administrador' });
  const pinMalo = await entrarComoAdmin(fetchContraApp, '2', '0001');
  assert.deepStrictEqual(pinMalo, noAdmin, 'no distingue PIN correcto de PIN equivocado');
});

// #450: el modulo mostraba su mensaje fijo ante cualquier no-ok, asi que el
// bloqueo por intentos se leia como otro PIN equivocado. El 429 trae su propio
// texto (con los minutos que faltan) y ese es el que llega a la pantalla.
test('#450 login de administrador: el bloqueo por intentos muestra su propio mensaje con los minutos', async () => {
  escribirRegistro(REGISTRO_DOS_ADMINS);
  const { entrarComoAdmin, MENSAJE_LOGIN_ADMIN } = await import('../public/js/login-admin.js');
  for (let i = 0; i < 4; i++) {
    assert.deepStrictEqual(await entrarComoAdmin(fetchContraApp, '7', '0000'), { error: MENSAJE_LOGIN_ADMIN });
  }
  const quinto = await entrarComoAdmin(fetchContraApp, '7', '0000');
  assert.deepStrictEqual(quinto, { error: 'Demasiados intentos, espera 15 min' });
  const correcto = await entrarComoAdmin(fetchContraApp, '7', '9007');
  assert.deepStrictEqual(correcto, { error: 'Demasiados intentos, espera 15 min' }, 'bloqueado, ni el PIN correcto entra');
});

test('#449 el selector "Administrador" ofrece a todo el registro por id y nombre, sin PIN ni rol', async () => {
  escribirRegistro(REGISTRO_DOS_ADMINS);
  const { vendedoresLoginAdmin } = await import('../public/js/login-admin.js');
  assert.deepStrictEqual(await vendedoresLoginAdmin(fetchContraApp), [
    { id: 1, name: 'Jefa Test' },
    { id: 2, name: 'Vendedor Test' },
    { id: 3, name: 'Sin Operam Test' },
    { id: 7, name: 'Agente Test' },
  ]);
});

// Sin DOM en las pruebas: lo que se afirma del HTML es que los dos paneles montan
// el modulo compartido y que ninguno conserva su propia llamada al login.
test('#449 /admin y /admin/catalogo montan el mismo login de administrador', async () => {
  for (const ruta of ['/admin', '/admin/catalogo']) {
    const res = await supertest(app).get(ruta);
    assert.strictEqual(res.status, 200, ruta);
    assert.match(res.text, /<select id="admin-vendedor"><\/select>/, `${ruta} muestra el selector Administrador`);
    assert.match(res.text, /import\('\/js\/login-admin\.js'\)/, `${ruta} usa el modulo compartido`);
    assert.doesNotMatch(res.text, /\/api\/login/, `${ruta} no tiene una segunda copia del login`);
    assert.doesNotMatch(res.text, /vendedorId: 1\b/, `${ruta} ya no fija al vendedor 1`);
  }
});

test('GET /api/vendedores lista el registro sin exponer el PIN', async () => {
  escribirRegistro(REGISTRO);
  const res = await supertest(app).get('/api/vendedores');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body.map(v => v.id), [1, 2, 3]);
  assert.ok(res.body.every(v => v.pin === undefined));
});

test('GET /api/admin/vendedores devuelve el registro completo', async () => {
  escribirRegistro(REGISTRO);
  const res = await supertest(app).get('/api/admin/vendedores').set('Authorization', `Bearer ${tokenAdmin}`);
  assert.strictEqual(res.status, 200);
  const v = res.body.find(x => x.id === 2);
  assert.strictEqual(v.pin, '9002');
  assert.strictEqual(v.topeDescuento, 15);
  assert.strictEqual(v.operam_id, 2);
});

// #153: checkbox por vendedor, mismo contrato de reemplazo total que el tope.
test('PUT /api/admin/vendedores persiste el checkbox de fijar lista; vendedores sin flag quedan sin permiso', async () => {
  escribirRegistro(REGISTRO);
  const nuevo = REGISTRO.map(v => (v.id === 2 ? { ...v, puedeFijarLista: true } : v));
  const put = await supertest(app).put('/api/admin/vendedores')
    .set('Authorization', `Bearer ${tokenAdmin}`).send(nuevo);
  assert.strictEqual(put.status, 200);

  const res = await supertest(app).get('/api/admin/vendedores').set('Authorization', `Bearer ${tokenAdmin}`);
  assert.strictEqual(res.body.find(v => v.id === 2).puedeFijarLista, true);
  assert.ok(!res.body.find(v => v.id === 3).puedeFijarLista);
});

// #156: segundo checkbox por vendedor (permiso de asignacion), independiente del
// de fijar lista y con el mismo contrato de reemplazo total.
test('PUT /api/admin/vendedores persiste el checkbox de asignacion, independiente del de fijar lista', async () => {
  escribirRegistro(REGISTRO);
  const nuevo = REGISTRO.map(v => (v.id === 2 ? { ...v, puedeAsignar: true } : v));
  const put = await supertest(app).put('/api/admin/vendedores')
    .set('Authorization', `Bearer ${tokenAdmin}`).send(nuevo);
  assert.strictEqual(put.status, 200);

  const res = await supertest(app).get('/api/admin/vendedores').set('Authorization', `Bearer ${tokenAdmin}`);
  const v2 = res.body.find(v => v.id === 2);
  assert.strictEqual(v2.puedeAsignar, true);
  assert.ok(!v2.puedeFijarLista, 'el permiso de asignacion no arrastra el de fijar lista');
  assert.ok(!res.body.find(v => v.id === 3).puedeAsignar);
});

test('PUT /api/admin/vendedores: un valor basura en puedeAsignar se normaliza a sin permiso', async () => {
  escribirRegistro(REGISTRO);
  const nuevo = REGISTRO.map(v => (v.id === 2 ? { ...v, puedeAsignar: 'si' } : v));
  const put = await supertest(app).put('/api/admin/vendedores')
    .set('Authorization', `Bearer ${tokenAdmin}`).send(nuevo);
  assert.strictEqual(put.status, 200);

  const res = await supertest(app).get('/api/admin/vendedores').set('Authorization', `Bearer ${tokenAdmin}`);
  assert.ok(!res.body.find(v => v.id === 2).puedeAsignar);
});

// #280: tercer checkbox por vendedor (permiso de precio de calca), independiente
// de los otros dos y con el mismo contrato de reemplazo total.
test('PUT /api/admin/vendedores persiste el checkbox de precio de calca, independiente de los otros dos', async () => {
  escribirRegistro(REGISTRO);
  const nuevo = REGISTRO.map(v => (v.id === 2 ? { ...v, puedePrecioCalca: true } : v));
  const put = await supertest(app).put('/api/admin/vendedores')
    .set('Authorization', `Bearer ${tokenAdmin}`).send(nuevo);
  assert.strictEqual(put.status, 200);

  const res = await supertest(app).get('/api/admin/vendedores').set('Authorization', `Bearer ${tokenAdmin}`);
  const v2 = res.body.find(v => v.id === 2);
  assert.strictEqual(v2.puedePrecioCalca, true);
  assert.ok(!v2.puedeFijarLista, 'el permiso de precio de calca no arrastra el de fijar lista');
  assert.ok(!v2.puedeAsignar, 'el permiso de precio de calca no arrastra el de asignar');
  assert.ok(!res.body.find(v => v.id === 3).puedePrecioCalca);
});

test('PUT /api/admin/vendedores: un valor basura en puedePrecioCalca se normaliza a sin permiso', async () => {
  escribirRegistro(REGISTRO);
  const nuevo = REGISTRO.map(v => (v.id === 2 ? { ...v, puedePrecioCalca: 'si' } : v));
  const put = await supertest(app).put('/api/admin/vendedores')
    .set('Authorization', `Bearer ${tokenAdmin}`).send(nuevo);
  assert.strictEqual(put.status, 200);

  const res = await supertest(app).get('/api/admin/vendedores').set('Authorization', `Bearer ${tokenAdmin}`);
  assert.ok(!res.body.find(v => v.id === 2).puedePrecioCalca);
});

// #163: la alerta de mayoreo deriva destinatarios del correo del vendedor -- el
// registro no lo tenia antes de este issue.
test('PUT /api/admin/vendedores persiste el correo del vendedor', async () => {
  escribirRegistro(REGISTRO);
  const nuevo = REGISTRO.map(v => (v.id === 2 ? { ...v, email: 'vendedor@pppeltre.mx' } : v));
  const put = await supertest(app).put('/api/admin/vendedores')
    .set('Authorization', `Bearer ${tokenAdmin}`).send(nuevo);
  assert.strictEqual(put.status, 200);

  const res = await supertest(app).get('/api/admin/vendedores').set('Authorization', `Bearer ${tokenAdmin}`);
  assert.strictEqual(res.body.find(v => v.id === 2).email, 'vendedor@pppeltre.mx');
  assert.ok(!res.body.find(v => v.id === 3).email);
});

test('PUT /api/admin/vendedores: el array completo reemplaza el registro (alta y baja)', async () => {
  escribirRegistro(REGISTRO);
  const nuevo = [
    { id: 1, name: 'Jefa Test', pin: '9001', role: 'admin', operam_id: 1 },
    { id: 4, name: 'Recien Llegado', pin: '9004', role: 'vendedor', operam_id: 9 },
  ];
  const put = await supertest(app).put('/api/admin/vendedores')
    .set('Authorization', `Bearer ${tokenAdmin}`).send(nuevo);
  assert.strictEqual(put.status, 200);

  const res = await supertest(app).get('/api/admin/vendedores').set('Authorization', `Bearer ${tokenAdmin}`);
  assert.deepStrictEqual(res.body.map(v => v.id), [1, 4]);

  const alta = await supertest(app).post('/api/login').send({ vendedorId: 4, pin: '9004' });
  assert.strictEqual(alta.status, 200);
  const baja = await supertest(app).post('/api/login').send({ vendedorId: 2, pin: '9002' });
  assert.strictEqual(baja.status, 401);
});

test('GET /api/catalogos toma los vendedores del registro y omite los que no estan en Operam', async () => {
  escribirRegistro(REGISTRO);
  const res = await supertest(app).get('/api/catalogos').set('Authorization', `Bearer ${tokenAdmin}`);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body.vendedores, [
    { id: 1, name: 'Jefa Test', operam_id: 1 },
    { id: 2, name: 'Vendedor Test', operam_id: 2 },
  ]);
});

// #434: el operam_id (el `salesman` del vendedor en Operam) se captura en el
// panel. Un texto basura tumbaria el INSERT entero en Neon (`::int`), asi que el
// servidor lo rechaza ANTES de reemplazar el registro.
test('PUT /api/admin/vendedores rechaza un operam_id que no es entero positivo y no toca el registro', async () => {
  // 2147483647 es el tope de int en Postgres: arriba (un celular pegado por error)
  // Neon truena en `(v->>'operam_id')::int` con 500.
  for (const basura of ['abc', 1.5, 0, -3, '7x', '5512345678', 2147483648]) {
    escribirRegistro(REGISTRO);
    const nuevo = REGISTRO.map(v => (v.id === 3 ? { ...v, operam_id: basura } : v));
    const put = await supertest(app).put('/api/admin/vendedores')
      .set('Authorization', `Bearer ${tokenAdmin}`).send(nuevo);
    assert.strictEqual(put.status, 400, `operam_id ${JSON.stringify(basura)} deberia ser 400`);
    assert.match(put.body.error, /Sin Operam Test/);
    assert.match(put.body.error, /entero positivo/);

    const res = await supertest(app).get('/api/admin/vendedores').set('Authorization', `Bearer ${tokenAdmin}`);
    assert.strictEqual(res.body.find(v => v.id === 3).operam_id, null);
  }
});

test('PUT /api/admin/vendedores rechaza dos vendedores con el mismo operam_id y no toca el registro', async () => {
  escribirRegistro(REGISTRO);
  // "2" es el texto que manda el panel: repite el 2 de Vendedor Test.
  const nuevo = REGISTRO.map(v => (v.id === 3 ? { ...v, operam_id: '2' } : v));
  const put = await supertest(app).put('/api/admin/vendedores')
    .set('Authorization', `Bearer ${tokenAdmin}`).send(nuevo);
  assert.strictEqual(put.status, 400);
  assert.match(put.body.error, /Vendedor Test/);
  assert.match(put.body.error, /Sin Operam Test/);
  assert.match(put.body.error, /\b2\b/);

  const res = await supertest(app).get('/api/admin/vendedores').set('Authorization', `Bearer ${tokenAdmin}`);
  assert.strictEqual(res.body.find(v => v.id === 3).operam_id, null);
});

// El panel manda lo que se tecleo: un vendedor nuevo nace con su operam_id como
// entero, y el campo vacio guarda null (quien solo captura formatos no necesita
// id; decision del issue).
test('PUT /api/admin/vendedores guarda el operam_id capturado como entero y el vacio como null', async () => {
  escribirRegistro(REGISTRO);
  const nuevo = [
    ...REGISTRO.map(v => (v.id === 2 ? { ...v, operam_id: '' } : v)),
    { id: 4, name: 'Recien Llegado', pin: '9004', role: 'vendedor', operam_id: ' 10 ' },
  ];
  const put = await supertest(app).put('/api/admin/vendedores')
    .set('Authorization', `Bearer ${tokenAdmin}`).send(nuevo);
  assert.strictEqual(put.status, 200);

  const res = await supertest(app).get('/api/admin/vendedores').set('Authorization', `Bearer ${tokenAdmin}`);
  assert.strictEqual(res.body.find(v => v.id === 4).operam_id, 10);
  assert.strictEqual(res.body.find(v => v.id === 2).operam_id, null);

  const cat = await supertest(app).get('/api/catalogos').set('Authorization', `Bearer ${tokenAdmin}`);
  assert.deepStrictEqual(cat.body.vendedores.map(v => v.id), [1, 4]);
});
