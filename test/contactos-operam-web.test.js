// El adaptador real del modulo Contactos en Operam para ESCRIBIR (#561, ADR-0024):
// la pestana Contactos de la pagina de domicilios de la web legacy
// (/sales/manage/customer_branches.php). Esa pagina trae en el MISMO formulario los
// botones que guardan (Update, UPDATE_ITEM), crean (ADD_ITEM) o borran (Delete564)
// el domicilio: el adaptador nunca los manda, cierra su sesion web y relee la tabla.
//
// Se mockea globalThis.fetch con una web legacy de mentiras que sirve las paginas
// REALES medidas el 2026-10-09 sobre el Cliente Operam 15, domicilio 564 (recortadas
// y en ASCII: test/fixtures/operam-domicilios-*.html) y responde segun el boton que
// trae el body, como FrontAccounting. --test-concurrency=1: fetch es global.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { abrirDomicilioWeb, serializarBodyDomicilios, personasDeContactos } from '../lib/contactos-operam-web.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const pagina = (n) => readFileSync(join(DIR, n), 'utf8');
const LISTA = pagina('operam-domicilios-15.html');
const GENERAL_564 = pagina('operam-domicilios-564-general.html');
const CONTACTOS_564 = pagina('operam-domicilios-564-contactos.html');
const NUEVO_564 = pagina('operam-domicilios-564-contacto-nuevo.html');
const ROLES_564 = pagina('operam-domicilios-564-contactos-roles.html');

process.env.OPERAM_URL = 'https://fa.mentira.test';
process.env.OPERAM_USER = 'usuario_de_prueba';
process.env.OPERAM_PASSWORD = 'clave_de_prueba';

// Los botones del formulario que NO son del contacto: guardar, crear o borrar el
// domicilio, y los de editar o borrar un contacto existente.
const PROHIBIDOS = /^(Update|UPDATE_ITEM|ADD_ITEM|Delete\d+|contactsDelete\[\d+\]|contactsEdit\[\d+\]|contactsUPDATE\[\d+\]|contactsRESET|process|delete)$/;
const ETIQUETA_ROL = { 1: 'General', 2: 'Invoices', 3: 'Orders', 4: 'Deliveries' };

let fetchOriginal;
let fa;

function webDeMentiras({ despuesDeEditar = GENERAL_564, errorAlAgregar = null } = {}) {
  const estado = { pedidos: [], agregadas: [] };
  const conAgregadas = () => estado.agregadas.reduce((html, p, i) => {
    const etiquetas = p.getAll('assgn[]').map((c) => ETIQUETA_ROL[c]).join(',');
    const pid = String(1300 + i);
    const fila = `<tr class='oddrow'  >\n<td >${etiquetas}</td>\n<td >${p.get('ref')}</td>\n<td >${[p.get('name'), p.get('name2')].join(' ')}</td>\n` +
      `<td >${p.get('phone')}</td>\n<td >${p.get('phone2')}</td>\n<td >${p.get('fax')}</td>\n<td ><a href='mailto:${p.get('email')}'>${p.get('email')}</a></td>\n` +
      `<td align='center'><button type='submit' class='editbutton' name='contactsEdit[${pid}]' value='1' title='Editar' /></button>\n</td>` +
      `<td align='center'><button type='submit' class='editbutton' name='contactsDelete[${pid}]' value='1' title='Eliminar' /></button>\n</td></tr>\n`;
    return html.replace(/<\/table><\/center>(\s*<br><center><button)/, (_, resto) => fila.repeat(p.getAll('assgn[]').length) + '</table></center>' + resto);
  }, CONTACTOS_564);
  estado.fetch = async (url, init = {}) => {
    const u = String(url);
    const metodo = (init.method || 'GET').toUpperCase();
    const params = new URLSearchParams(init.body ? String(init.body) : '');
    estado.pedidos.push({ url: u, metodo, params });
    if (u.includes('trans_no=1&trans_type=30')) return new Response('<html><body>login de mentira</body></html>');
    if (u.includes('/access/logout.php')) return new Response('<html><body>sesion cerrada</body></html>');
    if (!u.includes('/sales/manage/customer_branches.php')) throw new Error('pagina inesperada ' + u);
    if (metodo === 'GET') return new Response(LISTA);
    if (params.has('Edit564')) return new Response(despuesDeEditar);
    if (params.has('tabs_contacts')) return new Response(conAgregadas());
    if (params.has('contactsNEW')) return new Response(NUEVO_564);
    if (params.has('contactsADD')) {
      if (errorAlAgregar) return new Response(NUEVO_564.replace('<form', `<div class='err_msg'>${errorAlAgregar}</div><form`));
      estado.agregadas.push(params);
      return new Response(conAgregadas());
    }
    throw new Error('submit inesperado: ' + [...params.keys()].join(','));
  };
  return estado;
}

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
