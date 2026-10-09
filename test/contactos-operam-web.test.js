// El adaptador real del modulo Contactos en Operam para ESCRIBIR (#561, ADR-0024):
// la pestana Contactos de la pagina de domicilios de la web legacy
// (/sales/manage/customer_branches.php). Esa pagina trae en el MISMO formulario los
// botones que guardan (Update, UPDATE_ITEM), crean (ADD_ITEM) o borran (Delete564)
// el domicilio: el adaptador nunca los manda, cierra su sesion web y relee la tabla.
//
// Se mockea globalThis.fetch con la web legacy de mentiras de
// test/helpers/domicilios-web-mentira.js, que sirve las paginas REALES medidas el
// 2026-10-09 sobre el Cliente Operam 15, domicilio 564, y responde segun el boton que
// trae el body, como FrontAccounting. --test-concurrency=1: fetch es global.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { abrirDomicilioWeb, serializarBodyDomicilios, personasDeContactos } from '../lib/contactos-operam-web.js';
import { webDeMentiras, GENERAL_564, ROLES_564, CONTACTOS_GENERAL_564 } from './helpers/domicilios-web-mentira.js';

// Las credenciales de la web de mentiras solo mientras corre este archivo: al terminar,
// process.env queda como estaba (lo que no existia se borra).
const CREDENCIALES = { OPERAM_URL: 'https://fa.mentira.test', OPERAM_USER: 'usuario_de_prueba', OPERAM_PASSWORD: 'clave_de_prueba' };
let envOriginal;

before(() => {
  envOriginal = Object.fromEntries(Object.keys(CREDENCIALES).map((k) => [k, process.env[k]]));
  Object.assign(process.env, CREDENCIALES);
});

after(() => {
  for (const [k, v] of Object.entries(envOriginal)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// Los botones del formulario que NO son del contacto: guardar, crear o borrar el
// domicilio, y los de editar o borrar un contacto existente.
const PROHIBIDOS = /^(Update|UPDATE_ITEM|ADD_ITEM|Delete\d+|contactsDelete\[\d+\]|contactsEdit\[\d+\]|contactsUPDATE\[\d+\]|contactsRESET|process|delete)$/;

let fetchOriginal;
let fa;

beforeEach(() => {
  fetchOriginal = globalThis.fetch;
  fa = webDeMentiras();
  globalThis.fetch = (url, init) => fa.fetch(url, init);
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

const LUCIA = {
  nombre: 'Lucia Recibe Almacen', apellido: '', referencia: 'Lucia Recibe Almacen', roles: ['general', 'delivery'],
  casillas: { cel: '+52 55 1234 5678', telefono: '+52 55 1234 5678', secundario: '', correo: 'lucia@example.com' },
  notas: '',
};

const posts = () => fa.pedidos.filter((p) => p.metodo === 'POST' && p.url.includes('customer_branches.php'));

test('W1: ninguna peticion del adaptador lleva los botones que guardan, crean o borran el domicilio; el alta del contacto lleva un solo boton, el suyo', async () => {
  const web = await abrirDomicilioWeb('15', '564');
  await web.leer();
  await web.crear(LUCIA);
  await web.leer();
  await web.cerrar();
  for (const p of posts()) {
    const prohibidas = [...p.params.keys()].filter((k) => PROHIBIDOS.test(k));
    assert.deepEqual(prohibidas, [], `POST con ${[...p.params.keys()].join(',')}`);
  }
  const alta = posts().find((p) => p.params.has('contactsADD'));
  const botones = [...alta.params.keys()].filter((k) => /^(contacts(NEW|ADD|UPDATE|RESET|CLONE|Edit|Delete)|tabs_|Edit|Delete|Update|UPDATE|ADD_ITEM)/.test(k));
  assert.deepEqual(botones, ['contactsADD']);
  assert.deepEqual(alta.params.getAll('assgn[]'), ['1', '4']);
  assert.deepEqual(
    ['name', 'name2', 'ref', 'phone', 'phone2', 'fax', 'email', 'customer_id', 'selected_id', 'branch_code', 'contactsMode[]'].map((k) => alta.params.get(k)),
    ['Lucia Recibe Almacen', '', 'Lucia Recibe Almacen', '+52 55 1234 5678', '', '+52 55 1234 5678', 'lucia@example.com', '15', '564', '564', 'NEW'],
  );
});

// Si manana FA pintara el guardar o el borrar del domicilio como <input>, el
// serializador tampoco los mandaria: solo agrega el boton que se le pide.
test('W2: el serializador descarta los botones del domicilio aunque lleguen como campos del formulario', () => {
  const campos = { customer_id: '15', selected_id: '564', Update: 'Actualizar', UPDATE_ITEM: 'Actualizar', ADD_ITEM: 'Agregar', Delete564: '1', 'contactsDelete[1249]': '1', process: 'x', name: 'Lucia' };
  const body = serializarBodyDomicilios(campos, ['contactsADD', 'Agregar']);
  assert.deepEqual([...body.keys()], ['customer_id', 'selected_id', 'name', 'contactsADD']);
});

test('W3: el adaptador cierra la sesion web al terminar: la ultima peticion es la salida de la web legacy', async () => {
  const web = await abrirDomicilioWeb('15', '564');
  await web.leer();
  await web.crear(LUCIA);
  await web.cerrar();
  assert.match(fa.pedidos.at(-1).url, /\/access\/logout\.php$/);
  assert.equal(fa.pedidos.at(-1).metodo, 'GET');
});

test('W4: la tabla de la pestana da una persona por person_id con sus roles, sus casillas y su nombre completo', () => {
  assert.deepEqual(personasDeContactos(ROLES_564), [
    { personId: '1249', nombreCompleto: 'Adrian Bosques Nombre', referencia: 'Adrian Bosques Referencia', roles: ['delivery'], casillas: { cel: '', telefono: '', secundario: '', correo: '' } },
    { personId: '1293', nombreCompleto: 'Zeta GD Prueba', referencia: 'MED556C-B1', roles: ['general', 'delivery'], casillas: { cel: '5500000291', telefono: '55 0000 0201', secundario: '', correo: 'b1@example.com' } },
  ]);
});

test('W5: si la web legacy no abre el domicilio pedido, no se manda ninguna escritura', async () => {
  fa = webDeMentiras({ despuesDeEditar: GENERAL_564.replaceAll("'564'", "'15'") });
  const web = await abrirDomicilioWeb('15', '564');
  await assert.rejects(web.crear(LUCIA), /564/);
  await web.cerrar();
  assert.equal(posts().filter((p) => p.params.has('contactsNEW') || p.params.has('contactsADD')).length, 0);
});

test('W6: si la web legacy rechaza el contacto, crear lanza con su motivo', async () => {
  fa = webDeMentiras({ errorAlAgregar: 'La referencia del contacto no puede estar vacia.' });
  const web = await abrirDomicilioWeb('15', '564');
  await assert.rejects(web.crear(LUCIA), /La referencia del contacto no puede estar vacia/);
  await web.cerrar();
});

test('W7: la relectura despues de crear trae a la persona nueva con General y Entrega', async () => {
  const web = await abrirDomicilioWeb('15', '564');
  await web.crear(LUCIA);
  const despues = await web.leer();
  await web.cerrar();
  assert.deepEqual(despues.at(-1), {
    personId: '1300', nombreCompleto: 'Lucia Recibe Almacen', referencia: 'Lucia Recibe Almacen', roles: ['general', 'delivery'],
    casillas: { cel: '+52 55 1234 5678', telefono: '+52 55 1234 5678', secundario: '', correo: 'lucia@example.com' },
  });
});

// --- #562: editar al General desplazado -----------------------------------------
// Las Notas y los roles marcados solo existen en el formulario de EDITAR
// (contactsEdit[N]); se guarda con contactsUPDATE[N] y assgn[] es REPLACE. Medido el
// 2026-10-09 sobre la 1289 del domicilio 564 (medicion-556b, editar-contacto564).

test('W8: leerPersona trae del formulario de editar las Notas, los roles marcados y las casillas de la persona', async () => {
  fa = webDeMentiras({ tabla: CONTACTOS_GENERAL_564 });
  const web = await abrirDomicilioWeb('15', '564');
  const persona = await web.leerPersona('1289');
  await web.cerrar();
  assert.deepEqual(persona, {
    personId: '1289', nombre: 'MEDICION556b General', apellido: 'Prueba', referencia: 'MEDICION556BG', roles: ['general'],
    casillas: { cel: '5500000022', telefono: '55 0000 0021', secundario: '', correo: 'g564@example.com' },
    notas: 'medicion 556b, borrar',
  });
});

test('W9: editar manda solo el boton de actualizar ESA persona, los roles como assgn[] y las notas, y deja intactos sus demas datos', async () => {
  fa = webDeMentiras({ tabla: CONTACTOS_GENERAL_564 });
  const web = await abrirDomicilioWeb('15', '564');
  await web.leerPersona('1289');
  await web.editar('1289', { roles: ['delivery'], notas: 'medicion 556b, borrar\nlinea nueva' });
  const despues = await web.leer();
  await web.cerrar();
  const update = posts().find((p) => p.params.has('contactsUPDATE[1289]'));
  const botones = [...update.params.keys()].filter((k) => /^(contacts(NEW|ADD|UPDATE|RESET|CLONE|Edit|Delete)|tabs_|Edit|Delete|Update|UPDATE|ADD_ITEM)/.test(k));
  assert.deepEqual(botones, ['contactsUPDATE[1289]']);
  for (const p of posts()) {
    const prohibidas = [...p.params.keys()].filter((k) => PROHIBIDOS.test(k) && !/^contacts(Edit|UPDATE)\[1289\]$/.test(k));
    assert.deepEqual(prohibidas, [], `POST con ${[...p.params.keys()].join(',')}`);
  }
  assert.deepEqual(update.params.getAll('assgn[]'), ['4']);
  assert.deepEqual(
    ['name', 'name2', 'ref', 'phone', 'phone2', 'fax', 'email', 'notes', 'contactsMode[1289]', 'customer_id', 'selected_id', 'branch_code'].map((k) => update.params.get(k)),
    ['MEDICION556b General', 'Prueba', 'MEDICION556BG', '55 0000 0021', '', '5500000022', 'g564@example.com', 'medicion 556b, borrar\nlinea nueva', 'Edit', '15', '564', '564'],
  );
  assert.deepEqual(despues.find((p) => p.personId === '1289').roles, ['delivery']);
});

test('W10: si la web legacy rechaza la edicion, editar lanza con su motivo', async () => {
  fa = webDeMentiras({ tabla: CONTACTOS_GENERAL_564, errorAlActualizar: 'El nombre del contacto no puede estar vacio.' });
  const web = await abrirDomicilioWeb('15', '564');
  await assert.rejects(web.editar('1289', { roles: ['delivery'], notas: '' }), /El nombre del contacto no puede estar vacio/);
  await web.cerrar();
});

// Cada pagina que devuelve una escritura YA es la pestana Contactos con la tabla
// releida (medido: la respuesta de contactsADD y de contactsUPDATE trae la tabla con el
// cambio), asi que la sesion navega al domicilio UNA vez y cada paso sigue desde la
// pagina en la que quedo: la subida cabe en el tiempo que el navegador espera.
test('W11: desplazar al General navega al domicilio una sola vez y relee desde la pagina que devolvio cada escritura', async () => {
  fa = webDeMentiras({ tabla: CONTACTOS_GENERAL_564 });
  const web = await abrirDomicilioWeb('15', '564');
  await web.leer();
  await web.crear(LUCIA);
  const trasCrear = await web.leer();
  await web.leerPersona('1289');
  await web.editar('1289', { roles: ['delivery'], notas: 'nota' });
  const trasEditar = await web.leer();
  await web.leerPersona('1289');
  await web.cerrar();
  assert.ok(trasCrear.some((p) => p.nombreCompleto === 'Lucia Recibe Almacen'));
  assert.deepEqual(trasEditar.find((p) => p.personId === '1289').roles, ['delivery']);
  const boton = (p) => [...p.params.keys()].find((k) => /^(Edit\d+|tabs_contacts|contacts(NEW|ADD|Edit|UPDATE))/.test(k));
  assert.deepEqual(posts().map(boton), ['Edit564', 'tabs_contacts', 'contactsNEW', 'contactsADD', 'contactsEdit[1289]', 'contactsUPDATE[1289]', 'contactsEdit[1289]']);
  assert.equal(fa.pedidos.filter((p) => p.metodo === 'GET' && p.url.includes('customer_branches.php')).length, 1);
});

// #563: editar tambien escribe las casillas de la persona (Cel, Telefono, Secundario,
// correo) en el MISMO formulario medido (contactsUPDATE), y nunca su nombre, apellido
// ni Referencia; sin notas ni roles en la llamada, se repostean los del formulario.
test('W12: editar con casillas manda phone, phone2, fax y email y deja nombre, apellido, Referencia, notas y roles como venian', async () => {
  fa = webDeMentiras({ tabla: CONTACTOS_GENERAL_564 });
  const web = await abrirDomicilioWeb('15', '564');
  await web.editar('1289', { casillas: { cel: '5512345678', telefono: '5512345678', secundario: '55 0000 0021', correo: 'lucia@example.com' } });
  const despues = await web.leer();
  await web.cerrar();
  const update = posts().find((p) => p.params.has('contactsUPDATE[1289]'));
  assert.deepEqual(
    ['name', 'name2', 'ref', 'phone', 'phone2', 'fax', 'email', 'notes'].map((k) => update.params.get(k)),
    ['MEDICION556b General', 'Prueba', 'MEDICION556BG', '5512345678', '55 0000 0021', '5512345678', 'lucia@example.com', 'medicion 556b, borrar'],
  );
  assert.deepEqual(update.params.getAll('assgn[]'), ['1']);
  assert.deepEqual(despues.find((p) => p.personId === '1289').casillas, { cel: '5512345678', telefono: '5512345678', secundario: '55 0000 0021', correo: 'lucia@example.com' });
});

// #563, de punta a punta con el modulo: editar a la persona elegida del domicilio es la
// pregunta (una sesion: navegar y leer la tabla) y, con la decision, la misma navegacion
// mas el formulario de editar y su actualizacion, cuya respuesta YA es la tabla releida.
// Es el paso del contacto que agrega la actualizacion del quote: 6 peticiones a la web
// legacy si pregunta, 8 si escribe (con el login y la salida).
test('W13: editar a la persona elegida por la web legacy: la pregunta son 6 peticiones y la escritura confirmada 8, y la relectura trae las casillas nuevas', async () => {
  const { escribirContactoEntrega } = await import('../lib/contactos-operam.js');
  fa = webDeMentiras({ tabla: CONTACTOS_GENERAL_564 });
  const solicitud = { clienteId: '15', domicilioId: '564', contacto: { nombre: 'MEDICION556b General', telefono: '5512345678', correo: '', personId: '1289' } };
  const pregunta = await escribirContactoEntrega(solicitud);
  assert.equal(pregunta.tipo, 'pregunta');
  assert.deepEqual(pregunta.pisa.map((p) => [p.campo, p.viejo, p.nuevo]), [['cel', '5500000022', '5512345678']]);
  assert.equal(fa.pedidos.length, 6);

  fa = webDeMentiras({ tabla: CONTACTOS_GENERAL_564 });
  const decision = { desplazar: [], pisar: pregunta.pisa.map((p) => ({ personId: p.personId, campo: p.campo, viejo: p.viejo })) };
  const r = await escribirContactoEntrega({ ...solicitud, decision });
  assert.equal(r.tipo, 'lograda');
  assert.deepEqual(r.noAplicados, []);
  assert.equal(fa.pedidos.length, 8);
  const update = posts().find((p) => p.params.has('contactsUPDATE[1289]'));
  assert.deepEqual(['name', 'fax', 'phone', 'email'].map((k) => update.params.get(k)), ['MEDICION556b General', '5512345678', '5512345678', 'g564@example.com']);
  assert.match(fa.pedidos.at(-1).url, /\/access\/logout\.php$/);
});

// #566 (antes CA9 de test/contactos-operam-alta.test.js): la persona del alta como
// Contacto de entrega por el adaptador REAL contra la web legacy de mentiras (paginas
// medidas del Cliente Operam 15, domicilio 564, con la 1289 de General). El formulario
// de editar es el unico que cambia el nombre, y solo viaja lo que la persona del alta
// necesita. Una sola sesion: login (2), navegar a la tabla (3), formulario de editar,
// actualizar (su respuesta ya es la tabla releida) y salida = 8 peticiones.
test('W14: la persona del alta por la web legacy: el formulario de editar lleva el nombre nuevo, el apellido vacio, la Referencia intacta, los numeros, el correo y General y Entrega', async () => {
  const { contactoEntregaDelAlta } = await import('../lib/contactos-operam.js');
  fa = webDeMentiras({ tabla: CONTACTOS_GENERAL_564 });
  const lucia = { nombre: 'Lucia Recibe', telefono: '5544332211', correo: 'lucia@example.com' };
  const r = await contactoEntregaDelAlta({ clienteId: '15', domicilioId: '564', personId: '1289', contacto: lucia });
  assert.equal(r.tipo, 'lograda');
  assert.deepEqual(r.noAplicados, []);
  const update = fa.pedidos.find((p) => p.params.has('contactsUPDATE[1289]'));
  assert.deepEqual(
    ['name', 'name2', 'ref', 'fax', 'phone', 'email'].map((k) => update.params.get(k)),
    ['Lucia Recibe', '', 'MEDICION556BG', '5544332211', '5544332211', 'lucia@example.com'],
  );
  assert.deepEqual(update.params.getAll('assgn[]'), ['1', '4']);
  assert.equal(fa.pedidos.length, 8);
  assert.match(fa.pedidos.at(-1).url, /\/access\/logout\.php$/);
});
