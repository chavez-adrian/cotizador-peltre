// El Alta de cliente deja a la persona que crea Operam como Contacto de entrega (#566,
// ADR-0024 regla 8). Se prueba por la interfaz del modulo Contactos en Operam
// (`contactoEntregaDelAlta`) contra el adaptador en memoria
// (test/helpers/contactos-operam-memoria.js), sin fetch.
//
// POST /customers crea un domicilio y UNA persona, General del cliente y del
// domicilio, con el nombre corto del Cliente Operam como nombre (medido 2026-10-09).
// Aqui esa persona es la 1501 del Cliente Operam 900, domicilio 800: el nombre corto
// "La Esquina", el Telefono que el alta le puso y el celular del Contacto en Cel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactoEntregaDelAlta } from '../lib/contactos-operam.js';
import { contactosOperamEnMemoria } from './helpers/contactos-operam-memoria.js';
import { webDeMentiras, CONTACTOS_GENERAL_564 } from './helpers/domicilios-web-mentira.js';

const CLIENTE_900 = { customer_id: '900', branches: ['800'] };
const PERSONA_DEL_ALTA = { personId: '1501', name: 'La Esquina', ref: 'La Esquina', phone: '5598765432', fax: '5511112222' };
const RENGLONES = [
  { id: '7001', personId: '1501', tipo: 'customer', entidad: '900', rol: 'general' },
  { id: '7002', personId: '1501', tipo: 'cust_branch', entidad: '800', rol: 'general' },
];

function operam(opciones = {}) {
  return contactosOperamEnMemoria({ clientes: [CLIENTE_900], personas: [PERSONA_DEL_ALTA], renglones: RENGLONES, ...opciones });
}

const LUCIA = { nombre: 'Lucia Recibe', telefono: '5544332211', correo: 'lucia@example.com' };

function solicitud(extra = {}) {
  return { clienteId: '900', domicilioId: '800', personId: '1501', contacto: LUCIA, ...extra };
}

function enOperam(op, personId = '1501') {
  const p = op.estado.personas.get(String(personId));
  const roles = entidad => op.estado.renglones.filter(r => r.personId === String(personId) && r.entidad === entidad).map(r => r.rol);
  return { nombre: p.name, apellido: p.name2, referencia: p.ref, cel: p.fax, telefono: p.phone, correo: p.email, roles: roles('800'), rolesCliente: roles('900') };
}

test('CA1: la persona que creo Operam queda como el Contacto de entrega: su nombre, el numero en Cel y Telefono, su correo y los roles General y Entrega', async () => {
  const op = operam();
  const r = await contactoEntregaDelAlta(solicitud(), op.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.escrito, true);
  assert.equal(r.personId, '1501');
  assert.deepEqual(r.noAplicados, []);
  assert.deepEqual(enOperam(op), {
    nombre: 'Lucia Recibe', apellido: '', referencia: 'La Esquina', cel: '5544332211', telefono: '5544332211',
    correo: 'lucia@example.com', roles: ['general', 'delivery'], rolesCliente: ['general'],
  });
  assert.equal(op.pedidos('crear').length, 0, 'no nace otra persona');
  assert.equal(op.estado.personas.size, 1);
  assert.deepEqual(op.estado.sesiones.map(s => s.cerrada), [true]);
  assert.equal(r.pasos.length, 1);
  assert.equal(r.pasos[0].name, 'contacto de entrega');
  assert.equal(r.pasos[0].status, 'ok');
  assert.match(r.pasos[0].mensaje, /Lucia Recibe quedo en Operam como contacto General y de Entrega del domicilio de entrega/);
  assert.match(r.pasos[0].detalle, /persona 1501/);
  assert.match(r.pasos[0].detalle, /La Esquina/);
});

// Es la persona del alta, no un dato de Operam que alguien capturo: no se pregunta por
// desplazarla ni por pisar sus casillas, aunque sea el General y traiga otros numeros.
test('CA2: no pregunta al vendedor ni desplaza a nadie aunque la persona sea el General y traiga otros numeros', async () => {
  const op = operam();
  const r = await contactoEntregaDelAlta(solicitud(), op.deps);
  assert.notEqual(r.tipo, 'pregunta');
  assert.equal(r.desplazados, undefined);
  assert.equal(op.pedidos('leerPersona').length, 0, 'no lee Notas: no hay desplazado');
  assert.equal(op.pedidos('editar').length, 1);
});

test('CA3: lo que Operam no guardo sale como no aplicado, con el paso en aviso y sus dos capas', async () => {
  const op = operam({ ignoraAlEditar: ['nombre', 'cel'] });
  const r = await contactoEntregaDelAlta(solicitud(), op.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.escrito, true);
  assert.deepEqual(r.noAplicados.map(n => [n.campo, n.esperado, n.encontrado]), [
    ['nombre', 'Lucia Recibe', 'La Esquina'],
    ['cel', '5544332211', '5511112222'],
  ]);
  const [paso] = r.pasos;
  assert.equal(paso.status, 'warn');
  assert.match(paso.mensaje, /el nombre/);
  assert.match(paso.mensaje, /el Cel/);
  assert.doesNotMatch(paso.mensaje, /fax|persona \d/);
  assert.match(paso.detalle, /cel se esperaba "5544332211" y se leyo "5511112222"/);
});

test('CA4: si la web legacy falla al escribir, no se sabe si quedo: bloqueo con el paso en aviso', async () => {
  const op = operam({ falla: { editar: 'la web legacy rechazo la edicion' } });
  const r = await contactoEntregaDelAlta(solicitud(), op.deps);
  assert.equal(r.tipo, 'bloqueo');
  assert.equal(r.motivo, 'operam');
  assert.equal(r.pasos[0].status, 'warn');
  assert.match(r.pasos[0].mensaje, /No se pudo confirmar/);
  assert.match(r.pasos[0].detalle, /la web legacy rechazo la edicion/);
  assert.deepEqual(op.estado.sesiones.map(s => s.cerrada), [true]);
});

test('CA5: si la web legacy no abre, no se escribio nada: bloqueo con el paso en error', async () => {
  const op = operam({ falla: { abrirDomicilioWeb: 'Operam 503' } });
  const r = await contactoEntregaDelAlta(solicitud(), op.deps);
  assert.equal(r.tipo, 'bloqueo');
  assert.equal(r.motivo, 'operam');
  assert.equal(r.pasos[0].status, 'error');
  assert.match(r.pasos[0].mensaje, /No se pudo dejar/);
  assert.match(r.pasos[0].detalle, /Operam 503/);
});

// Escribirle a otra persona del domicilio seria pisar a alguien que el vendedor no
// eligio: sin la persona del alta en la tabla no se escribe nada.
test('CA6: si la persona del alta no esta en el domicilio, no se escribe a nadie y el paso avisa', async () => {
  const op = operam();
  const r = await contactoEntregaDelAlta(solicitud({ personId: '1777' }), op.deps);
  assert.equal(r.tipo, 'bloqueo');
  assert.equal(r.motivo, 'persona-ausente');
  assert.equal(op.pedidos('editar').length, 0);
  assert.equal(r.pasos[0].status, 'warn');
  assert.match(r.pasos[0].mensaje, /revisa/i);
  assert.match(r.pasos[0].detalle, /1777/);
});

// El alta completa de la vista Clientes no captura el nombre de quien recibe (su
// "Nombre del domicilio" es un lugar): la persona conserva su nombre y recibe los
// numeros, el correo y los roles. Un correo vacio no borra el que habia.
test('CA7: sin nombre capturado la persona conserva el suyo y queda con los numeros, los roles y el correo que ya tenia', async () => {
  const op = operam({ personas: [{ ...PERSONA_DEL_ALTA, email: 'previo@example.com' }] });
  const r = await contactoEntregaDelAlta(solicitud({ contacto: { nombre: '', telefono: '5544332211', correo: '' } }), op.deps);
  assert.equal(r.tipo, 'lograda');
  assert.deepEqual(r.noAplicados, []);
  const p = enOperam(op);
  assert.deepEqual([p.nombre, p.cel, p.telefono, p.correo, p.roles], ['La Esquina', '5544332211', '5544332211', 'previo@example.com', ['general', 'delivery']]);
  assert.match(r.pasos[0].mensaje, /La Esquina quedo en Operam como contacto General y de Entrega/);
});

test('CA8: sin nada que dejar en la persona (sin nombre, numero ni correo) no abre la web legacy y el paso sale omitido', async () => {
  const op = operam();
  const r = await contactoEntregaDelAlta(solicitud({ contacto: { nombre: '', telefono: '', correo: '' } }), op.deps);
  assert.equal(r.tipo, 'lograda');
  assert.equal(r.escrito, false);
  assert.equal(r.motivo, 'sin-contacto');
  assert.equal(r.pasos[0].status, 'omitido');
  assert.equal(op.pedidos('abrirDomicilioWeb').length, 0);
});

// Por el adaptador REAL contra la web legacy de mentiras (paginas medidas del Cliente
// Operam 15, domicilio 564, con la 1289 de General): el formulario de editar es el
// unico que cambia el nombre, y solo viaja lo que la persona del alta necesita. Una
// sola sesion: login (2), navegar a la tabla (3), formulario de editar, actualizar (su
// respuesta ya es la tabla releida) y salida = 8 peticiones.
test('CA9: por la web legacy el formulario de editar lleva el nombre nuevo, el apellido vacio, la Referencia intacta, los numeros, el correo y General y Entrega', async () => {
  process.env.OPERAM_URL = 'https://fa.mentira.test';
  process.env.OPERAM_USER = 'usuario_de_prueba';
  process.env.OPERAM_PASSWORD = 'clave_de_prueba';
  const fa = webDeMentiras({ tabla: CONTACTOS_GENERAL_564 });
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (url, init) => fa.fetch(url, init);
  try {
    const r = await contactoEntregaDelAlta({ clienteId: '15', domicilioId: '564', personId: '1289', contacto: LUCIA });
    assert.equal(r.tipo, 'lograda');
    assert.deepEqual(r.noAplicados, []);
    const update = fa.pedidos.find(p => p.params.has('contactsUPDATE[1289]'));
    assert.deepEqual(
      ['name', 'name2', 'ref', 'fax', 'phone', 'email'].map(k => update.params.get(k)),
      ['Lucia Recibe', '', 'MEDICION556BG', '5544332211', '5544332211', 'lucia@example.com'],
    );
    assert.deepEqual(update.params.getAll('assgn[]'), ['1', '4']);
    assert.equal(fa.pedidos.length, 8);
    assert.match(fa.pedidos.at(-1).url, /\/access\/logout\.php$/);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});
