// El modulo Contactos en Operam escribe el Contacto de entrega en el domicilio de
// entrega (#561, ADR-0024 reglas 4 y 5). Se prueba por su interfaz
// (`escribirContactoEntrega`) contra el adaptador en memoria
// (test/helpers/contactos-operam-memoria.js), sin fetch: lo que queda escrito es lo
// que el adaptador guarda en su estado, que es lo que la web legacy pinta.
//
// Los datos imitan al Cliente Operam 15 medido el 2026-10-09: el domicilio Bosques de
// Europa (564) sin contacto General, con la 1249 de Entrega sin numeros.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escribirContactoEntrega } from '../lib/contactos-operam.js';
import { contactosOperamEnMemoria } from './helpers/contactos-operam-memoria.js';

const CLIENTE_15 = { customer_id: '15', branches: ['564', '15'] };
const PERSONAS = [
  { personId: '61', name: 'Adrian Cliente Nombre', ref: 'Adrian Cliente Referencia', phone: '+52 55 3466 7682' },
  { personId: '1249', name: 'Adrian Bosques Nombre', ref: 'Adrian Bosques Referencia' },
];
const RENGLONES = [
  { id: '3579', personId: '61', tipo: 'customer', entidad: '15', rol: 'general' },
  { id: '3462', personId: '1249', tipo: 'cust_branch', entidad: '564', rol: 'delivery' },
];

function operam(opciones = {}) {
  return contactosOperamEnMemoria({ clientes: [CLIENTE_15], personas: PERSONAS, renglones: RENGLONES, ...opciones });
}

const LUCIA = { nombre: 'Lucia Recibe Almacen', telefono: '+52 55 1234 5678', correo: 'lucia@example.com' };

function solicitud(extra = {}) {
  return { clienteId: '15', domicilioId: '564', contacto: LUCIA, ...extra };
}

// Lo que el estado del adaptador guarda de una persona del domicilio, como lo
// releeria Operam: sus casillas y sus roles en ese domicilio.
function enOperam(op, personId, domicilio = '564') {
  const p = op.estado.personas.get(String(personId));
  const roles = op.estado.renglones
    .filter(r => r.personId === String(personId) && r.tipo === 'cust_branch' && r.entidad === domicilio)
    .map(r => r.rol);
  return { nombre: p.name, cel: p.fax, telefono: p.phone, secundario: p.phone2, correo: p.email, roles };
}

test('CE1: en un domicilio sin General, el Contacto de entrega nuevo queda como persona nueva con General y Entrega, el numero en Cel y Telefono y su correo', async () => {
  const op = operam();
  const r = await escribirContactoEntrega(solicitud(), op.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.escrito, true);
  assert.notEqual(r.personId, '1249');
  assert.deepEqual(enOperam(op, r.personId), {
    nombre: 'Lucia Recibe Almacen', cel: '+52 55 1234 5678', telefono: '+52 55 1234 5678', secundario: '',
    correo: 'lucia@example.com', roles: ['general', 'delivery'],
  });
  assert.deepEqual(enOperam(op, '1249'), { nombre: 'Adrian Bosques Nombre', cel: '', telefono: '', secundario: '', correo: '', roles: ['delivery'] });
});

// Un solo General por domicilio (ADR-0024 regla 4). Desplazar al que ya esta pisa un
// dato de Operam, asi que antes se pregunta al vendedor (#562) y no se escribe nada.
test('CE2: en un domicilio que ya tiene General devuelve la pregunta al vendedor con el nombre del desplazado y no escribe nada', async () => {
  const op = operam({
    personas: [...PERSONAS, { personId: '1294', name: 'Alfa G', name2: 'Prueba', fax: '5500000292' }],
    renglones: [...RENGLONES, { id: '3590', personId: '1294', tipo: 'cust_branch', entidad: '564', rol: 'general' }],
  });
  const r = await escribirContactoEntrega(solicitud(), op.deps);
  assert.equal(r.tipo, 'pregunta');
  assert.equal(r.motivo, 'general-existente');
  assert.deepEqual(r.desplazados, [{ personId: '1294', nombre: 'Alfa G Prueba', roles: ['general'] }]);
  assert.match(r.mensaje, /Alfa G Prueba deja de ser el contacto General de este domicilio y queda como contacto de Entrega/);
  // D1: la pregunta solo se confirma; la salida para no desplazarlo es elegirlo a el.
  assert.match(r.mensaje, /Si no quieres que Alfa G Prueba deje de ser el contacto General, elige a Alfa G Prueba como Contacto de entrega en el paso Env\u00edo\./);
  assert.match(r.detalle, /1294/);
  assert.equal(op.pedidos('crear').length, 0);
  assert.equal(op.pedidos('editar').length, 0);
  assert.deepEqual(op.estado.sesiones.map(s => s.cerrada), [true]);
  assert.equal(r.pasos.length, 1);
  assert.equal(r.pasos[0].name, 'contacto de entrega');
  assert.equal(r.pasos[0].status, 'warn');
  assert.match(r.pasos[0].mensaje, /Alfa G Prueba/);
});

// Sin el person_id de la persona elegida (cotizaciones anteriores a #563 o "+ Nuevo
// contacto") la UNICA identidad de una persona es su numero (ultimos 10 digitos,
// lib/telefono-llave.js): la del domicilio que lo tiene en cualquiera de sus casillas
// ES el Contacto de entrega y se edita como la persona elegida de #563 -- llena lo
// vacio, pregunta si pisa, queda como unico General --; no se crea otra.
// (Revision de #557: hasta ahi se omitia sin escribir.)
test('CE3: si el Contacto de entrega ya esta en el domicilio con ese numero (en cualquier casilla), sin person_id se edita esa persona y no se crea otra', async () => {
  const op = operam({
    personas: [...PERSONAS, { personId: '1295', name: 'Lucy', name2: 'Almacen', phone2: '55 1234 5678' }],
    renglones: [...RENGLONES, { id: '3591', personId: '1295', tipo: 'cust_branch', entidad: '564', rol: 'delivery' }],
  });
  const r = await escribirContactoEntrega(solicitud(), op.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.escrito, true);
  assert.equal(r.personId, '1295');
  assert.equal(op.pedidos('crear').length, 0);
  const lucy = enOperam(op, '1295');
  assert.deepEqual({ ...lucy, roles: [...lucy.roles].sort() }, {
    nombre: 'Lucy', cel: '+52 55 1234 5678', telefono: '+52 55 1234 5678', secundario: '55 1234 5678',
    correo: 'lucia@example.com', roles: ['delivery', 'general'],
  });
  assert.equal(r.pasos[0].status, 'ok');
  assert.match(r.pasos[0].mensaje, /Lucy Almacen/);
});

// El nombre NO identifica: dos personas pueden llamarse igual (revision de #557). Un
// homonimo con otro numero es otra persona y se crea; la del domicilio no se toca.
test('CE4: un homonimo de una persona del domicilio con otro numero (con o sin apellido) es otra persona: se crea y la del domicilio queda igual', async () => {
  const op1 = operam();
  const sinNumeros = await escribirContactoEntrega(solicitud({ contacto: { nombre: 'adrian  bosques nombre', telefono: '5598765432' } }), op1.deps);
  assert.equal(sinNumeros.escrito, true);
  assert.notEqual(sinNumeros.personId, '1249');
  assert.equal(op1.pedidos('crear').length, 1);
  assert.deepEqual(enOperam(op1, '1249'), { nombre: 'Adrian Bosques Nombre', cel: '', telefono: '', secundario: '', correo: '', roles: ['delivery'] });

  const op = operam({
    personas: [...PERSONAS, { personId: '1296', name: 'Zeta DG', name2: 'Prueba', fax: '5500000392' }],
    renglones: [...RENGLONES, { id: '3592', personId: '1296', tipo: 'cust_branch', entidad: '564', rol: 'delivery' }],
  });
  const conApellido = await escribirContactoEntrega(solicitud({ contacto: { nombre: 'Zeta DG', telefono: '5598765432' } }), op.deps);
  assert.equal(conApellido.escrito, true);
  assert.ok(!['1249', '1296'].includes(conApellido.personId));
  assert.equal(op.pedidos('crear').length, 1);
  assert.equal(op.pedidos('editar').length, 0);
  assert.equal(enOperam(op, '1296').cel, '5500000392');
});

// Relee y compara siempre (CODING_STANDARDS.md regla 6): la web legacy guarda y
// responde normal aunque no haya guardado una casilla.
test('CE5: lo que la relectura no confirma sale en noAplicados y el paso avisa nombrando la casilla', async () => {
  const r = await escribirContactoEntrega(solicitud(), operam({ ignoraAlCrear: ['cel'] }).deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.escrito, true);
  assert.deepEqual(r.noAplicados.map(n => [n.campo, n.esperado, n.encontrado]), [['cel', '+52 55 1234 5678', '']]);
  assert.equal(r.pasos[0].status, 'warn');
  assert.match(r.pasos[0].mensaje, /Cel/);
});

test('CE6: escrito y confirmado, el paso dice al vendedor quien quedo y el detalle trae la persona y el domicilio', async () => {
  const r = await escribirContactoEntrega(solicitud(), operam().deps);
  assert.deepEqual(r.noAplicados, []);
  assert.equal(r.pasos[0].name, 'contacto de entrega');
  assert.equal(r.pasos[0].status, 'ok');
  assert.match(r.pasos[0].mensaje, /Lucia Recibe Almacen/);
  assert.match(r.pasos[0].mensaje, /General y de Entrega/);
  assert.match(r.pasos[0].detalle, new RegExp(`persona ${r.personId}`));
  assert.match(r.pasos[0].detalle, /domicilio 564/);
});

test('CE7: si la web legacy falla antes de escribir, devuelve bloqueo de Operam en dos capas y la sesion web queda cerrada', async () => {
  const op = operam({ falla: { leer: 'FA respondio 500' } });
  const r = await escribirContactoEntrega(solicitud(), op.deps);
  assert.equal(r.tipo, 'bloqueo');
  assert.equal(r.motivo, 'operam');
  assert.equal(r.pasos[0].status, 'error');
  assert.doesNotMatch(r.pasos[0].mensaje, /FA respondio 500/);
  assert.match(r.pasos[0].detalle, /FA respondio 500/);
  assert.deepEqual(op.estado.sesiones.map(s => s.cerrada), [true]);

  const sinAbrir = await escribirContactoEntrega(solicitud({ domicilioId: '999' }), operam().deps);
  assert.equal(sinAbrir.tipo, 'bloqueo');
  assert.match(sinAbrir.pasos[0].detalle, /999/);
});

// ADR-0024: cada escritura por la web legacy cierra su sesion (el limite de usuarios
// de Operam), escriba o no.
test('CE8: la sesion web se cierra tambien cuando se escribe y cuando se omite', async () => {
  const escrita = operam();
  await escribirContactoEntrega(solicitud(), escrita.deps);
  const omitida = operam({ renglones: [...RENGLONES, { id: '3593', personId: '61', tipo: 'cust_branch', entidad: '564', rol: 'general' }] });
  await escribirContactoEntrega(solicitud(), omitida.deps);
  assert.deepEqual([...escrita.estado.sesiones, ...omitida.estado.sesiones].map(s => s.cerrada), [true, true]);
});

// Si la escritura ya salio y lo que falla es su respuesta o la relectura, no se sabe
// si quedo: el mensaje no afirma que no se escribio (el vendedor la crearia a mano
// otra vez).
test('CE9: si falla la escritura o la relectura, el aviso dice que no se pudo confirmar, no que no se escribio', async () => {
  for (const falla of [{ crear: 'se cayo la red' }, { releer: 'se cayo la red' }]) {
    const r = await escribirContactoEntrega(solicitud(), operam({ falla }).deps);
    assert.equal(r.tipo, 'bloqueo');
    assert.equal(r.pasos[0].status, 'warn');
    assert.match(r.pasos[0].mensaje, /confirmar/);
    assert.doesNotMatch(r.pasos[0].mensaje, /No se pudo escribir/);
    assert.match(r.pasos[0].detalle, /se cayo la red/);
  }
});

test('CE10: sin domicilio de entrega no abre la web y lo reporta omitido', async () => {
  const op = operam();
  const r = await escribirContactoEntrega(solicitud({ domicilioId: null }), op.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.escrito, false);
  assert.equal(r.motivo, 'sin-domicilio');
  assert.equal(r.pasos[0].status, 'omitido');
  assert.equal(op.pedidos('abrirDomicilioWeb').length, 0);
});

// Los Clientes Operam genericos (DEBTORS_GENERICOS, lib/deduplicacion.js: mostrador,
// bazar, publico en general) los comparten clientes que no tienen nada que ver entre si:
// su domicilio no es de quien recibe. Como en #459, el generico se excluye ANTES de
// mirar el domicilio: no se abre la web legacy, no se busca la copia (#564) y, sin
// escritura, tampoco hay fusion (revision de #557).
test('CE44: en un Cliente Operam generico no se escribe el Contacto de entrega: omitido en dos capas, sin abrir la web ni buscar la copia', async () => {
  const op = operam();
  const r = await escribirContactoEntrega({ clienteId: 14, domicilioId: '14', contacto: { ...LUCIA, personId: '61' } }, op.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.escrito, false);
  assert.equal(r.motivo, 'cliente-generico');
  assert.equal(r.pasos[0].name, 'contacto de entrega');
  assert.equal(r.pasos[0].status, 'omitido');
  assert.match(r.pasos[0].mensaje, /generico/);
  assert.match(r.pasos[0].detalle, /cliente 14/);
  for (const llamada of ['abrirDomicilioWeb', 'buscarCopia', 'obtenerCliente']) assert.equal(op.pedidos(llamada).length, 0, llamada);

  const sinNombre = await escribirContactoEntrega({ clienteId: '417', domicilioId: '900', contacto: { nombre: '', telefono: '5512345678' } }, op.deps);
  assert.equal(sinNombre.motivo, 'cliente-generico');
});

// El formulario de Operam limita el nombre y la Referencia a 40 caracteres (maxlength,
// medido); se manda lo que mandaria el navegador y la relectura compara contra eso.
// La Referencia, que el formulario exige y el cotizador no captura, es el nombre.
test('CE11: un nombre de mas de 40 caracteres se escribe recortado y la relectura no lo marca como no aplicado', async () => {
  const largo = 'Maria Guadalupe Hernandez Gonzalez de la Barrera';
  const op = operam();
  const r = await escribirContactoEntrega(solicitud({ contacto: { ...LUCIA, nombre: largo } }), op.deps);
  const [{ args: [, enviada] }] = op.pedidos('crear');
  assert.equal(enviada.nombre, 'Maria Guadalupe Hernandez Gonzalez de la');
  assert.equal(enviada.referencia, 'Maria Guadalupe Hernandez Gonzalez de la');
  assert.deepEqual(r.noAplicados, []);
});

// El nombre del Contacto de entrega es opcional en el cotizador (solo el telefono es
// obligatorio, #558) y una persona sin nombre no se escribe: ponerle el del Cliente
// Operam es justo el desorden que ADR-0024 corrige. Como el cotizador SI deja generar
// sin nombre, no escribirlo es algo que el vendedor tiene que saber: aviso, no omitido
// (revision de #557).
test('CE12: un Contacto de entrega sin nombre no se escribe y el paso avisa en dos capas que falta el nombre', async () => {
  const op = operam();
  const r = await escribirContactoEntrega(solicitud({ contacto: { nombre: '  ', telefono: '5512345678' } }), op.deps);
  assert.equal(r.escrito, false);
  assert.equal(r.motivo, 'sin-nombre');
  assert.equal(r.pasos[0].name, 'contacto de entrega');
  assert.equal(r.pasos[0].status, 'warn');
  assert.match(r.pasos[0].mensaje, /no se escribi.* en Operam/);
  assert.match(r.pasos[0].mensaje, /falta (el|su) nombre/);
  assert.match(r.pasos[0].detalle, /domicilio 564 del cliente 15/);
  assert.equal(op.pedidos('abrirDomicilioWeb').length, 0);
});

// Si quien recibe es el General, el vendedor elige al General (ADR-0024 regla 2): esa
// persona -- reconocida por su numero -- es el Contacto de entrega, no un General al
// que haya que desplazar: se edita (llena lo vacio y gana Entrega) sin preguntar.
test('CE13: si el Contacto de entrega ES el General del domicilio, se edita esa persona y no se pregunta por desplazarla', async () => {
  const op = operam({
    personas: [...PERSONAS, { personId: '1294', name: 'Alfa G', name2: 'Prueba', fax: '5512345678' }],
    renglones: [...RENGLONES, { id: '3590', personId: '1294', tipo: 'cust_branch', entidad: '564', rol: 'general' }],
  });
  const r = await escribirContactoEntrega(solicitud({ contacto: { nombre: 'Alfa G', telefono: '+52 55 1234 5678' } }), op.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.personId, '1294');
  assert.equal(op.pedidos('crear').length, 0);
  assert.deepEqual(generalesDe(op), ['1294']);
  assert.ok(enOperam(op, '1294').roles.includes('delivery'));
  assert.equal(enOperam(op, '1294').telefono, '+52 55 1234 5678');
});

// --- #562: el vendedor confirma y el General que estaba se desplaza ------------
// La decision viaja en la solicitud con los person_id por los que se le pregunto, y la
// cotizacion de la que sale, para la nota. ADR-0024 regla 4: la persona nueva queda
// como unico General (y Entrega); al desplazado se le quita el General, pasa a Entrega
// si no tenia otro rol, y en sus Notas queda una linea fechada con quien lo reemplazo y
// desde que cotizacion, sin borrar las previas.

// 2026-10-10T03:00Z son las 21:00 del 9 de octubre en la Ciudad de Mexico: la fecha de
// la nota es la de la fabrica, no la de UTC.
const AHORA = () => new Date('2026-10-10T03:00:00.000Z');
const LINEA_1357 = '2026-10-09: deja de ser el contacto General de este domicilio; lo reemplaza Lucia Recibe Almacen desde la Cotizaci\u00f3n 1357.';

function conGeneral(general, extra = {}) {
  return operam({
    personas: [...PERSONAS, { personId: '1294', name: 'Alfa G', name2: 'Prueba', fax: '5500000292', ...general }],
    renglones: [...RENGLONES, ...(general.roles || ['general']).map((rol, i) => ({ id: String(3590 + i), personId: '1294', tipo: 'cust_branch', entidad: '564', rol }))],
    ...extra,
  });
}

const CONFIRMADA = { cotizacion: { id: 21, folio: '1357' }, decision: { desplazar: ['1294'] } };

const generalesDe = (op, domicilio = '564') =>
  op.estado.renglones.filter(r => r.tipo === 'cust_branch' && r.entidad === domicilio && r.rol === 'general').map(r => r.personId);

test('CE14: confirmado, el Contacto de entrega queda como el unico General del domicilio, con Entrega', async () => {
  const op = conGeneral({});
  const r = await escribirContactoEntrega(solicitud(CONFIRMADA), { ...op.deps, ahora: AHORA });
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.escrito, true);
  assert.deepEqual(generalesDe(op), [r.personId]);
  assert.deepEqual(enOperam(op, r.personId).roles, ['general', 'delivery']);
  assert.deepEqual(r.noAplicados, []);
  assert.equal(r.pasos[0].status, 'ok');
  assert.deepEqual(op.estado.sesiones.map(s => s.cerrada), [true]);
});

test('CE15: el desplazado sin otro rol queda como contacto de Entrega; con otros roles solo pierde el General', async () => {
  const solo = conGeneral({});
  await escribirContactoEntrega(solicitud(CONFIRMADA), { ...solo.deps, ahora: AHORA });
  assert.deepEqual(enOperam(solo, '1294').roles, ['delivery']);

  const conOtros = conGeneral({ roles: ['general', 'invoice'] });
  await escribirContactoEntrega(solicitud(CONFIRMADA), { ...conOtros.deps, ahora: AHORA });
  assert.deepEqual(enOperam(conOtros, '1294').roles, ['invoice']);
  // Sus datos no cambian: solo se le quita el rol.
  assert.deepEqual({ ...enOperam(conOtros, '1294'), roles: null }, { nombre: 'Alfa G', cel: '5500000292', telefono: '', secundario: '', correo: '', roles: null });
});

test('CE16: las Notas del desplazado ganan la linea fechada con quien lo reemplazo y desde que cotizacion, sin perder las previas', async () => {
  const conNotas = conGeneral({ notes: 'Compra los lunes' });
  await escribirContactoEntrega(solicitud(CONFIRMADA), { ...conNotas.deps, ahora: AHORA });
  assert.equal(conNotas.estado.personas.get('1294').notes, `Compra los lunes\n${LINEA_1357}`);

  const sinNotas = conGeneral({});
  await escribirContactoEntrega(solicitud(CONFIRMADA), { ...sinNotas.deps, ahora: AHORA });
  assert.equal(sinNotas.estado.personas.get('1294').notes, LINEA_1357);
});

// Revalida al reintentar (patron de #368): la decision vale para los Generales por los
// que se pregunto. Si entre la pregunta y la respuesta el General cambio, se vuelve a
// preguntar y nunca se escribe sobre otro desplazado.
test('CE17: si el General del domicilio ya no es el que el vendedor confirmo, vuelve a preguntar por el nuevo y no escribe nada', async () => {
  const op = operam({
    personas: [...PERSONAS, { personId: '1297', name: 'Beta Nueva', name2: 'General' }],
    renglones: [...RENGLONES, { id: '3595', personId: '1297', tipo: 'cust_branch', entidad: '564', rol: 'general' }],
  });
  const r = await escribirContactoEntrega(solicitud(CONFIRMADA), { ...op.deps, ahora: AHORA });
  assert.equal(r.tipo, 'pregunta');
  assert.deepEqual(r.desplazados.map(d => d.personId), ['1297']);
  assert.match(r.mensaje, /Beta Nueva General/);
  assert.equal(op.pedidos('crear').length, 0);
  assert.equal(op.pedidos('editar').length, 0);
});

test('CE18: si al reintentar el domicilio ya no tiene General, el Contacto de entrega se crea como General sin desplazar a nadie', async () => {
  const op = operam();
  const r = await escribirContactoEntrega(solicitud(CONFIRMADA), { ...op.deps, ahora: AHORA });
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.escrito, true);
  assert.deepEqual(generalesDe(op), [r.personId]);
  assert.equal(op.pedidos('editar').length, 0);
});

// Relee y compara siempre (CODING_STANDARDS.md regla 6): la web puede guardar sin los
// roles o sin la nota y responder normal.
test('CE19: si Operam no guarda los roles o la nota del desplazado, la relectura lo reporta y el paso avisa', async () => {
  const sinRoles = await escribirContactoEntrega(solicitud(CONFIRMADA), { ...conGeneral({}, { ignoraAlEditar: ['roles'] }).deps, ahora: AHORA });
  assert.equal(sinRoles.pasos[0].status, 'warn');
  assert.deepEqual(sinRoles.noAplicados.map(n => n.campo), ['roles-desplazado', 'general-unico']);
  assert.match(sinRoles.pasos[0].mensaje, /unico contacto General/);

  const sinNota = await escribirContactoEntrega(solicitud(CONFIRMADA), { ...conGeneral({}, { ignoraAlEditar: ['notas'] }).deps, ahora: AHORA });
  assert.equal(sinNota.pasos[0].status, 'warn');
  assert.deepEqual(sinNota.noAplicados.map(n => [n.campo, n.esperado]), [['notas-desplazado', LINEA_1357]]);
});

// Creada la persona nueva, una falla al desplazar puede dejar dos Generales: el aviso
// lo dice para que el vendedor lo revise, sin afirmar que nada se escribio.
test('CE20: si falla quitarle el General al desplazado, el aviso dice que puede haber dos contactos General', async () => {
  const op = conGeneral({}, { falla: { editar: 'FA respondio 500' } });
  const r = await escribirContactoEntrega(solicitud(CONFIRMADA), { ...op.deps, ahora: AHORA });
  assert.equal(r.tipo, 'bloqueo');
  assert.equal(r.pasos[0].status, 'warn');
  assert.match(r.pasos[0].mensaje, /Lucia Recibe Almacen/);
  assert.match(r.pasos[0].mensaje, /Alfa G Prueba/);
  assert.match(r.pasos[0].mensaje, /dos contactos General/);
  assert.match(r.pasos[0].detalle, /FA respondio 500/);
  assert.deepEqual(op.estado.sesiones.map(s => s.cerrada), [true]);
});

// --- #563: el vendedor eligio a una persona que ya esta en el domicilio ---------
// La cotizacion trae su person_id (la identidad de un Contacto en Operam, ADR-0024) y
// el modulo EDITA a esa persona en vez de crear otra: el numero capturado va a Cel y a
// Telefono principal, un Telefono distinto que ya estaba pasa a Secundario (si el
// Secundario estaba lleno, ese valor se pierde) y el correo capturado ocupa su casilla.
// Llenar una casilla vacia no pregunta; pisar un valor no vacio si, con el viejo y el
// nuevo a la vista. El nombre de la persona nunca se toca (regla 5).

const ELEGIDA_1249 = { nombre: 'Lucia Recibe Almacen', telefono: '+52 55 1234 5678', correo: 'lucia@example.com', personId: '1249' };

function conPersona(datos, extra = {}) {
  return operam({
    personas: [PERSONAS[0], { personId: '1249', name: 'Adrian Bosques Nombre', ref: 'Adrian Bosques Referencia', ...datos }],
    ...extra,
  });
}

test('CE21: la persona elegida sin numeros queda con el numero en Cel y Telefono, el correo y General y Entrega, sin pregunta y sin crear otra', async () => {
  const op = conPersona({});
  const r = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249 }), op.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.escrito, true);
  assert.equal(r.personId, '1249');
  assert.equal(op.pedidos('crear').length, 0);
  assert.deepEqual(enOperam(op, '1249'), {
    nombre: 'Adrian Bosques Nombre', cel: '+52 55 1234 5678', telefono: '+52 55 1234 5678', secundario: '',
    correo: 'lucia@example.com', roles: ['delivery', 'general'],
  });
  assert.deepEqual(r.noAplicados, []);
  assert.equal(r.pasos[0].status, 'ok');
  assert.deepEqual(op.estado.sesiones.map(s => s.cerrada), [true]);
});

// Pisar el Telefono que ya estaba es un dato de Operam: primero la pregunta, con el
// valor viejo y el nuevo, y nada escrito; la decision lleva lo que se pregunto.
// D4 (decisiones de Adrian 2026-10-09): si la pregunta trae el cambio del numero de
// identidad, la confirmacion lleva ese numero viejo y si lo del cotizador se mueve.
const decisionDe = (pregunta, extra = {}) => ({
  decision: {
    desplazar: pregunta.desplazados.map(d => d.personId),
    pisar: pregunta.pisa.map(p => ({ personId: p.personId, campo: p.campo, viejo: p.viejo })),
    ...(pregunta.cambioDeNumero ? { numero: { viejo: pregunta.cambioDeNumero.viejo, mover: true } } : {}),
  },
  cotizacion: { id: 21, folio: '1357' },
  ...extra,
});

test('CE22: un numero distinto al Telefono que ya tenia pregunta con el viejo y el nuevo; al confirmar el previo queda en Secundario', async () => {
  const op = conPersona({ phone: '55 8888 0000', fax: '55 8888 0000' });
  const r = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249 }), op.deps);
  assert.equal(r.tipo, 'pregunta');
  assert.deepEqual(r.pisa.map(p => [p.personId, p.campo, p.viejo, p.nuevo]), [
    ['1249', 'cel', '55 8888 0000', '+52 55 1234 5678'],
    ['1249', 'telefono', '55 8888 0000', '+52 55 1234 5678'],
  ]);
  assert.match(r.mensaje, /55 8888 0000/);
  assert.match(r.mensaje, /\+52 55 1234 5678/);
  assert.match(r.mensaje, /Secundario/);
  assert.equal(op.pedidos('editar').length, 0);
  assert.equal(op.pedidos('crear').length, 0);
  assert.deepEqual(op.estado.sesiones.map(s => s.cerrada), [true]);

  const confirmada = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249, ...decisionDe(r) }), op.deps);
  assert.equal(confirmada.tipo, 'lograda');
  assert.deepEqual(enOperam(op, '1249'), {
    nombre: 'Adrian Bosques Nombre', cel: '+52 55 1234 5678', telefono: '+52 55 1234 5678', secundario: '55 8888 0000',
    correo: 'lucia@example.com', roles: ['delivery', 'general'],
  });
  assert.deepEqual(confirmada.noAplicados, []);
});

test('CE23: con el Secundario lleno, la pregunta dice que ese valor se pierde y al confirmar queda el Telefono previo en su lugar', async () => {
  const op = conPersona({ phone: '55 8888 0000', phone2: '55 7777 0000' });
  const r = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249 }), op.deps);
  assert.equal(r.tipo, 'pregunta');
  const secundario = r.pisa.find(p => p.campo === 'secundario');
  assert.deepEqual([secundario.viejo, secundario.nuevo, secundario.pierde], ['55 7777 0000', '55 8888 0000', true]);
  assert.match(r.mensaje, /Secundario 55 7777 0000 se pierde/);

  await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249, ...decisionDe(r) }), op.deps);
  assert.deepEqual([enOperam(op, '1249').telefono, enOperam(op, '1249').secundario], ['+52 55 1234 5678', '55 8888 0000']);
});

test('CE24: un correo distinto al que tenia pregunta con el viejo y el nuevo; un correo en casilla vacia no pregunta y un correo vacio no borra', async () => {
  const distinto = conPersona({ fax: '5512345678', phone: '5512345678', email: 'bosques@example.com' });
  const r = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249 }), distinto.deps);
  assert.equal(r.tipo, 'pregunta');
  assert.deepEqual(r.pisa.map(p => [p.campo, p.viejo, p.nuevo]), [['correo', 'bosques@example.com', 'lucia@example.com']]);
  assert.match(r.mensaje, /bosques@example\.com/);

  const vacio = conPersona({ fax: '5512345678', phone: '5512345678' });
  const lleno = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249 }), vacio.deps);
  assert.equal(lleno.tipo, 'lograda');
  assert.equal(enOperam(vacio, '1249').correo, 'lucia@example.com');

  const sinCorreo = conPersona({ fax: '5512345678', phone: '5512345678', email: 'bosques@example.com' });
  const conservado = await escribirContactoEntrega(solicitud({ contacto: { ...ELEGIDA_1249, correo: '' } }), sinCorreo.deps);
  assert.equal(conservado.tipo, 'lograda');
  assert.equal(enOperam(sinCorreo, '1249').correo, 'bosques@example.com');
});

// El nombre que trae la cotizacion es el del documento; el de la persona en Operam no
// se toca (ADR-0024 regla 5), ni al llenar casillas ni al pisarlas.
test('CE25: el nombre de la persona elegida nunca cambia, aunque la cotizacion traiga otro', async () => {
  const op = conPersona({ phone: '55 8888 0000' });
  const pregunta = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249 }), op.deps);
  const r = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249, ...decisionDe(pregunta) }), op.deps);
  assert.equal(r.tipo, 'lograda');
  const p = op.estado.personas.get('1249');
  assert.deepEqual([p.name, p.name2, p.ref], ['Adrian Bosques Nombre', '', 'Adrian Bosques Referencia']);
  for (const { args: [, , cambios] } of op.pedidos('editar')) {
    assert.deepEqual(Object.keys(cambios).sort(), ['casillas', 'roles']);
  }
  assert.match(r.pasos[0].mensaje, /Adrian Bosques Nombre/);
});

// Relee y compara siempre (CODING_STANDARDS.md regla 6).
test('CE26: si Operam no guarda una casilla de la persona editada, la relectura lo reporta como no aplicado y el paso avisa', async () => {
  const op = conPersona({}, { ignoraAlEditar: ['cel'] });
  const r = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249 }), op.deps);
  assert.equal(r.tipo, 'lograda');
  assert.deepEqual(r.noAplicados.map(n => [n.campo, n.esperado, n.encontrado]), [['cel', '+52 55 1234 5678', '']]);
  assert.equal(r.pasos[0].status, 'warn');
  assert.match(r.pasos[0].mensaje, /Cel/);
  assert.match(r.pasos[0].detalle, /1249/);
});

// Revalida al reintentar: si el valor viejo que vio el vendedor ya no es el de Operam,
// la decision no vale y se vuelve a preguntar con el valor de ahora.
test('CE27: si el valor viejo cambio en Operam entre la pregunta y la respuesta, vuelve a preguntar y no escribe nada', async () => {
  const op = conPersona({ phone: '55 8888 0000' });
  const pregunta = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249 }), op.deps);
  op.estado.personas.get('1249').phone = '55 6666 0000';
  const r = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249, ...decisionDe(pregunta) }), op.deps);
  assert.equal(r.tipo, 'pregunta');
  assert.deepEqual(r.pisa.map(p => [p.campo, p.viejo]), [['telefono', '55 6666 0000']]);
  assert.equal(op.pedidos('editar').length, 0);
});

// Una sola pregunta lleva las casillas a pisar y al General que dejaria de serlo.
test('CE28: la persona elegida que no es General pregunta una sola vez por sus datos y por el General; al confirmar queda como unico General', async () => {
  const op = conPersona({ phone: '55 8888 0000' }, {
    personas: [PERSONAS[0], { personId: '1249', name: 'Adrian Bosques Nombre', phone: '55 8888 0000' }, { personId: '1294', name: 'Alfa G', name2: 'Prueba', fax: '5500000292' }],
    renglones: [...RENGLONES, { id: '3590', personId: '1294', tipo: 'cust_branch', entidad: '564', rol: 'general' }],
  });
  const pregunta = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249 }), { ...op.deps, ahora: AHORA });
  assert.equal(pregunta.tipo, 'pregunta');
  assert.deepEqual(pregunta.desplazados.map(d => d.personId), ['1294']);
  assert.deepEqual(pregunta.pisa.map(p => p.campo), ['telefono']);
  assert.match(pregunta.mensaje, /Alfa G Prueba deja de ser el contacto General/);
  assert.match(pregunta.mensaje, /elige a Alfa G Prueba como Contacto de entrega en el paso Env\u00edo/);

  const r = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249, ...decisionDe(pregunta) }), { ...op.deps, ahora: AHORA });
  assert.equal(r.tipo, 'lograda');
  assert.deepEqual(generalesDe(op), ['1249']);
  assert.deepEqual(enOperam(op, '1294').roles, ['delivery']);
  assert.match(op.estado.personas.get('1294').notes, /lo reemplaza Adrian Bosques Nombre desde la Cotizaci\u00f3n 1357/);
  assert.deepEqual(r.desplazados.map(d => [d.personId, d.roles]), [['1294', ['delivery']]]);
  assert.deepEqual(r.noAplicados, []);
});

// La persona del Cliente Operam se copia (#564, CE32 en adelante); la que no esta ni en
// el domicilio ni en el Cliente Operam se escribe como sin person_id.
test('CE29: una persona elegida que no esta ni en el domicilio ni en el Cliente Operam se escribe como antes: persona nueva sin liga', async () => {
  const op = operam();
  const r = await escribirContactoEntrega(solicitud({ contacto: { ...LUCIA, personId: '999' } }), op.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.escrito, true);
  assert.equal(r.copiaDe, undefined);
  assert.deepEqual(enOperam(op, r.personId).nombre, 'Lucia Recibe Almacen');
  assert.equal(op.pedidos('crear').length, 1);
  assert.equal(op.pedidos('editar').length, 0);
  assert.equal(op.estado.copias.size, 0);
  assert.equal(op.estado.personas.get('61').phone, '+52 55 3466 7682');
});

test('CE30: la persona elegida que ya esta al dia (numeros, correo, General y Entrega) no se escribe y se reporta omitida', async () => {
  const op = conPersona({ fax: '5512345678', phone: '55 1234 5678', email: 'LUCIA@example.com' }, {
    renglones: [RENGLONES[0], { id: '3462', personId: '1249', tipo: 'cust_branch', entidad: '564', rol: 'delivery' }, { id: '3463', personId: '1249', tipo: 'cust_branch', entidad: '564', rol: 'general' }],
  });
  const r = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249 }), op.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.escrito, false);
  assert.equal(r.motivo, 'sin-cambios');
  assert.equal(r.pasos[0].status, 'omitido');
  assert.equal(op.pedidos('editar').length, 0);
  assert.deepEqual(op.estado.sesiones.map(s => s.cerrada), [true]);
});

// Al formulario de editar solo viajan las casillas que cambian; las que ya estaban
// (aunque Operam las guarde con otro formato) se repostean como las trae la web.
// D4: quien solo tenia Secundario cambia de numero de identidad, asi que primero se
// confirma (CE46); lo que viaja a la edicion confirmada no cambia.
test('CE31: a la edicion solo viajan las casillas que cambian', async () => {
  const op = conPersona({ phone2: '55 7777 0000', email: 'LUCIA@example.com' });
  const pregunta = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249 }), op.deps);
  await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249, ...decisionDe(pregunta) }), op.deps);
  const [{ args: [, , cambios] }] = op.pedidos('editar');
  assert.deepEqual(cambios.casillas, { cel: '+52 55 1234 5678', telefono: '+52 55 1234 5678' });
  assert.deepEqual([enOperam(op, '1249').secundario, enOperam(op, '1249').correo], ['55 7777 0000', 'LUCIA@example.com']);
});

// --- #565: el cambio de numero de una persona sale de la edicion confirmada --------
// La Subida del quote funde los Contactos del cotizador cuando cambia el NUMERO DE
// IDENTIDAD de un person_id (enmienda a ADR-0016; revision de #557): el que el
// cotizador le propone a la persona, Cel > Telefono > Secundario (`telefonoDePersona`,
// public/js/contacto-entrega-logica.js), antes de editarla y despues, segun la
// relectura. Por eso la lograda de una edicion trae `cambioDeNumero`: `{ personId,
// viejo, nuevo }` cuando ese numero cambio y Operam lo CONFIRMA. No es la casilla Cel:
// llenar un Cel vacio tambien cambia el numero de identidad si antes era el Telefono.
test('CE41: la edicion confirmada trae el cambio del numero de identidad (person_id, viejo y nuevo); lo que la relectura no confirma no cuenta', async () => {
  const op = conPersona({ phone: '55 8888 0000', fax: '55 8888 0000' });
  const pregunta = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249 }), op.deps);
  const r = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249, ...decisionDe(pregunta) }), op.deps);
  assert.equal(r.tipo, 'lograda');
  assert.deepEqual(r.cambioDeNumero, { personId: '1249', viejo: '55 8888 0000', nuevo: '+52 55 1234 5678' });

  // Operam no guardo el Cel: su Cel sigue siendo el numero viejo, que es su numero de
  // identidad. No cambio.
  const ignora = conPersona({ phone: '55 8888 0000', fax: '55 8888 0000' }, { ignoraAlEditar: ['cel'] });
  const pregunta2 = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249 }), ignora.deps);
  const r2 = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249, ...decisionDe(pregunta2) }), ignora.deps);
  assert.equal(r2.tipo, 'lograda');
  assert.equal(r2.cambioDeNumero, undefined);
});

test('CE42: llenar casillas de una persona sin numero, crear una persona nueva o el mismo numero con otro formato no cambian el numero de identidad', async () => {
  const vacia = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249 }), conPersona({}).deps);
  assert.equal(vacia.escrito, true);
  assert.equal(vacia.cambioDeNumero, undefined);
  const nueva = await escribirContactoEntrega(solicitud(), operam().deps);
  assert.equal(nueva.cambioDeNumero, undefined);
  const formato = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249 }), conPersona({ fax: '5512345678' }).deps);
  assert.equal(formato.escrito, true);
  assert.equal(formato.cambioDeNumero, undefined);
});

// El caso que la casilla Cel no veia: Cel vacio y Telefono X. Capturar N LLENA el Cel
// (no lo pisa) y pisa el Telefono; el numero de identidad pasa de X a N.
test('CE43: Cel vacio y Telefono X, se captura N: el numero de identidad cambia de X a N', async () => {
  const op = conPersona({ phone: '55 8888 0000' });
  const pregunta = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249 }), op.deps);
  assert.equal(pregunta.tipo, 'pregunta');
  const r = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249, ...decisionDe(pregunta) }), op.deps);
  assert.equal(r.tipo, 'lograda');
  assert.deepEqual(enOperam(op, '1249').cel, '+52 55 1234 5678');
  assert.deepEqual(r.cambioDeNumero, { personId: '1249', viejo: '55 8888 0000', nuevo: '+52 55 1234 5678' });
});

// --- Copia en el domicilio de la persona del Cliente Operam (#564, ADR-0024 regla 6) ---
// Operam no liga una persona existente a un domicilio (medido: "Clonar" tambien crea
// otra), asi que la persona elegida que solo esta en el Cliente Operam se COPIA al
// domicilio con sus datos y el cotizador guarda la liga copia -> origen. La original
// no se toca; las siguientes cotizaciones al mismo domicilio van a la copia.

const ORIGEN_61 = {
  personId: '61', name: 'Adrian Cliente Nombre', name2: 'Chavez', ref: 'Adrian Cliente Referencia',
  phone: '+52 55 3466 7682', email: 'compras@example.com', notes: 'compradora general',
};
const ELEGIDA_61 = { nombre: 'Adrian Cliente Nombre', telefono: '+52 55 3466 7682', correo: '', personId: '61' };

function conOrigen(extra = {}) {
  return operam({ personas: [ORIGEN_61, PERSONAS[1]], ...extra });
}

const crudo = (op, personId) => ({ ...op.estado.personas.get(String(personId)) });
const renglonesDe = (op, personId) => op.estado.renglones.filter(r => r.personId === String(personId)).map(r => `${r.tipo}:${r.entidad}:${r.rol}`);

test('CE32: la persona elegida que solo esta en el Cliente Operam se copia al domicilio con sus datos, como General y Entrega; la original queda igual', async () => {
  const op = conOrigen();
  const antes61 = { crudo: crudo(op, '61'), renglones: renglonesDe(op, '61') };
  const r = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_61 }), op.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.escrito, true);
  assert.notEqual(r.personId, '61');
  assert.equal(op.pedidos('crear').length, 1);
  assert.equal(op.pedidos('editar').length, 0);
  const copia = crudo(op, r.personId);
  assert.deepEqual(
    { name: copia.name, name2: copia.name2, ref: copia.ref, fax: copia.fax, phone: copia.phone, phone2: copia.phone2, email: copia.email },
    { name: 'Adrian Cliente Nombre', name2: 'Chavez', ref: 'Adrian Cliente Referencia', fax: '+52 55 3466 7682', phone: '+52 55 3466 7682', phone2: '', email: 'compras@example.com' },
  );
  assert.deepEqual(enOperam(op, r.personId).roles, ['general', 'delivery']);
  assert.deepEqual({ crudo: crudo(op, '61'), renglones: renglonesDe(op, '61') }, antes61);
  assert.deepEqual(r.noAplicados, []);
  assert.equal(r.pasos[0].status, 'ok');
  assert.deepEqual(op.estado.sesiones.map(s => s.cerrada), [true]);
});

test('CE33: el cotizador guarda la liga entre la copia y la persona de origen, por domicilio', async () => {
  const op = conOrigen();
  const r = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_61 }), op.deps);
  assert.equal(r.copiaDe, '61');
  assert.deepEqual(op.estado.copias.get('564:61'), { clienteId: '15', domicilioId: '564', origenPersonId: '61', copiaPersonId: r.personId });
  assert.match(r.pasos[0].detalle, new RegExp(`persona ${r.personId} creada como copia de la persona 61 del Cliente Operam`));
});

test('CE34: una segunda cotizacion al mismo domicilio con la misma persona reutiliza la copia y no crea otra', async () => {
  const op = conOrigen();
  const primera = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_61 }), op.deps);
  const segunda = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_61 }), op.deps);
  assert.equal(op.pedidos('crear').length, 1);
  assert.equal(segunda.tipo, 'lograda');
  assert.equal(segunda.motivo, 'sin-cambios');
  const personasEn564 = new Set(op.estado.renglones.filter(r => r.tipo === 'cust_branch' && r.entidad === '564').map(r => r.personId));
  assert.deepEqual([...personasEn564].sort(), ['1249', primera.personId].sort());
});

test('CE35: las siguientes ediciones van a la copia; la persona de origen no se toca', async () => {
  const op = conOrigen();
  const primera = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_61 }), op.deps);
  const antes61 = crudo(op, '61');
  const r = await escribirContactoEntrega(solicitud({ contacto: { ...ELEGIDA_61, correo: 'almacen@example.com' } }), op.deps);
  assert.equal(r.tipo, 'pregunta');
  assert.equal(r.motivo, 'pisa-datos');
  assert.deepEqual(r.persona, { personId: primera.personId, nombre: 'Adrian Cliente Nombre Chavez' });
  const confirmada = await escribirContactoEntrega(solicitud({ contacto: { ...ELEGIDA_61, correo: 'almacen@example.com' }, ...decisionDe(r) }), op.deps);
  assert.equal(confirmada.tipo, 'lograda');
  assert.equal(confirmada.personId, primera.personId);
  assert.equal(confirmada.copiaDe, '61');
  assert.equal(crudo(op, primera.personId).email, 'almacen@example.com');
  assert.deepEqual(op.pedidos('editar').map(l => l.args[1]), [primera.personId]);
  assert.equal(op.pedidos('crear').length, 1);
  assert.deepEqual(crudo(op, '61'), antes61);
});

test('CE36: si la copia ya no esta en el domicilio (la borraron en Operam), se crea otra y la liga apunta a la nueva', async () => {
  const op = conOrigen({ copias: [{ clienteId: '15', domicilioId: '564', origenPersonId: '61', copiaPersonId: '1290' }] });
  const r = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_61 }), op.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.escrito, true);
  assert.equal(op.pedidos('crear').length, 1);
  assert.notEqual(r.personId, '1290');
  assert.equal(op.estado.copias.get('564:61').copiaPersonId, r.personId);
});

test('CE37: la copia con otro numero capturado lleva ese numero en Cel y Telefono y el de la persona de origen en Secundario, sin preguntar', async () => {
  const op = conOrigen();
  const r = await escribirContactoEntrega(solicitud({ contacto: { ...ELEGIDA_61, telefono: '55 1234 5678', correo: 'lucia@example.com' } }), op.deps);
  assert.equal(r.tipo, 'lograda');
  const copia = crudo(op, r.personId);
  assert.deepEqual([copia.fax, copia.phone, copia.phone2, copia.email], ['55 1234 5678', '55 1234 5678', '+52 55 3466 7682', 'lucia@example.com']);
  assert.equal(crudo(op, '61').phone, '+52 55 3466 7682');
  assert.equal(crudo(op, '61').email, 'compras@example.com');
});

test('CE38: con un General en el domicilio la copia pregunta por desplazarlo, nombrando a la persona de origen; al confirmar queda como unico General', async () => {
  const op = conOrigen({
    renglones: [...RENGLONES, { id: '3470', personId: '1249', tipo: 'cust_branch', entidad: '564', rol: 'general' }],
  });
  const r = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_61 }), op.deps);
  assert.equal(r.tipo, 'pregunta');
  assert.equal(r.motivo, 'general-existente');
  assert.deepEqual(r.persona, { personId: '61', nombre: 'Adrian Cliente Nombre Chavez' });
  assert.deepEqual(r.desplazados.map(x => x.personId), ['1249']);
  assert.match(r.mensaje, /^Adrian Cliente Nombre Chavez queda como contacto General/);
  assert.equal(op.pedidos('crear').length, 0);
  const ok = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_61, ...CONFIRMADA, decision: { desplazar: ['1249'] } }), op.deps);
  assert.equal(ok.tipo, 'lograda');
  assert.equal(ok.copiaDe, '61');
  assert.deepEqual(generalesDe(op), [ok.personId]);
  assert.equal(op.estado.copias.get('564:61').copiaPersonId, ok.personId);
});

test('CE39: si no se puede leer la liga, no escribe nada y lo reporta como bloqueo antes de escribir', async () => {
  const op = conOrigen({ falla: { buscarCopia: 'Neon caido' } });
  const r = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_61 }), op.deps);
  assert.equal(r.tipo, 'bloqueo');
  assert.equal(r.pasos[0].status, 'error');
  assert.match(r.detalle, /registro de copias del cotizador: Neon caido/);
  assert.equal(op.pedidos('crear').length, 0);
  assert.deepEqual(op.estado.sesiones.map(s => s.cerrada), [true]);
});

test('CE40: si no se puede guardar la liga, la copia queda creada y el paso avisa', async () => {
  const op = conOrigen({ falla: { guardarCopia: 'Neon caido' } });
  const r = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_61 }), op.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.escrito, true);
  assert.equal(r.pasos[0].status, 'warn');
  assert.match(r.pasos[0].mensaje, /no pudo anotar que es la copia/);
  assert.match(r.pasos[0].detalle, /Neon caido/);
});

// --- D4: el paso del numero (decisiones de Adrian 2026-10-09) ---------------------
// Cambiar el numero de identidad de una persona (Cel > Telefono > Secundario) mueve en
// el cotizador todo lo del numero viejo al nuevo, asi que SIEMPRE se pregunta antes,
// aunque no se pise ninguna casilla (llenar Cel y Telefono vacios de quien solo tenia
// Secundario tambien cambia su numero). La pregunta lo dice primero, con las palabras
// de la decision, y la confirmacion revalida el numero viejo (patron de #368).
test('CE45: cambiar el numero de la persona pregunta primero por el cambio de celular; sin confirmar ese numero no se escribe', async () => {
  const op = conPersona({ phone: '55 8888 0000', fax: '55 8888 0000' });
  const r = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249 }), op.deps);
  assert.equal(r.tipo, 'pregunta');
  assert.deepEqual(r.cambioDeNumero, { personId: '1249', viejo: '55 8888 0000', nuevo: '+52 55 1234 5678' });
  assert.match(r.mensaje, /^El celular de Adrian Bosques Nombre cambia de 55 8888 0000 a \+52 55 1234 5678\./);
  assert.equal(r.partes.numero, 'El celular de Adrian Bosques Nombre cambia de 55 8888 0000 a +52 55 1234 5678.');
  assert.match(r.mensaje, /el 55 8888 0000 queda como su Tel\u00e9fono Secundario/);
  assert.doesNotMatch(r.mensaje, /fund|fusi/i);

  const sinNumero = decisionDe(r);
  delete sinNumero.decision.numero;
  const otraVez = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249, ...sinNumero }), op.deps);
  assert.equal(otraVez.tipo, 'pregunta');
  assert.equal(op.pedidos('editar').length, 0);

  const viejoDistinto = decisionDe(r);
  viejoDistinto.decision.numero.viejo = '55 7777 0000';
  assert.equal((await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249, ...viejoDistinto }), op.deps)).tipo, 'pregunta');
  assert.equal(op.pedidos('editar').length, 0);

  const confirmada = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249, ...decisionDe(r) }), op.deps);
  assert.equal(confirmada.tipo, 'lograda');
  assert.deepEqual(confirmada.cambioDeNumero, { personId: '1249', viejo: '55 8888 0000', nuevo: '+52 55 1234 5678' });
});

test('CE46: quien solo tenia Secundario y recibe el numero en Cel y Telefono (casillas vacias) tambien pregunta por el cambio de celular', async () => {
  const op = conPersona({ phone2: '55 7777 0000' });
  const r = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249 }), op.deps);
  assert.equal(r.tipo, 'pregunta');
  assert.equal(r.motivo, 'pisa-datos');
  assert.deepEqual(r.pisa, []);
  assert.deepEqual(r.cambioDeNumero, { personId: '1249', viejo: '55 7777 0000', nuevo: '+52 55 1234 5678' });
  assert.equal(op.pedidos('editar').length, 0);

  const confirmada = await escribirContactoEntrega(solicitud({ contacto: ELEGIDA_1249, ...decisionDe(r) }), op.deps);
  assert.equal(confirmada.tipo, 'lograda');
  assert.deepEqual([enOperam(op, '1249').cel, enOperam(op, '1249').secundario], ['+52 55 1234 5678', '55 7777 0000']);
});
