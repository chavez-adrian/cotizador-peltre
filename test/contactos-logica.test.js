import { test } from 'node:test';
import assert from 'node:assert/strict';

import { aFormatoWhatsApp, nombreVisible, planificarContactos } from '../lib/contactos-logica.js';

// El formato MEDIDO en el dispositivo (#226, 2026-08-21): E.164 limpio, +52 y
// los diez digitos, SIN el "1". Contradice la documentacion de WhatsApp y el
// comportamiento observado manda. Estas pruebas son el punto unico de cambio si
// algun dia WhatsApp cambia: si cambia, cambia esta funcion y estas lineas.
test('el celular mexicano se escribe +52 y diez digitos, sin el "1"', () => {
  assert.equal(aFormatoWhatsApp('+52 5512345678'), '+525512345678');
});

test('un celular guardado con el "1" de WhatsApp pierde ese "1"', () => {
  assert.equal(aFormatoWhatsApp('+52 1 55 1234 5678'), '+525512345678');
});

test('un celular de otro pais conserva su codigo tal cual', () => {
  assert.equal(aFormatoWhatsApp('+1 212 555 0134'), '+12125550134');
});

test('un celular sin codigo de pais se asume mexicano', () => {
  assert.equal(aFormatoWhatsApp('5512345678'), '+525512345678');
});

test('sin celular no hay nada que escribir', () => {
  assert.equal(aFormatoWhatsApp(''), '');
  assert.equal(aFormatoWhatsApp(null), '');
});

// El nombre visible se lee "Persona - Empresa" (CONTEXT.md "Contacto de
// Google"): WhatsApp muestra SOLO el nombre, nunca la organizacion, y lo corta
// alrededor de los 25 caracteres, asi que la persona va primero.
test('el nombre visible pone la persona primero y la empresa despues', () => {
  assert.equal(
    nombreVisible({ persona: 'Laura Mendez', empresa: 'Cocinas del Valle' }),
    'Laura Mendez - Cocinas del Valle'
  );
});

test('sin empresa declarada, la ciudad da el contexto', () => {
  assert.equal(
    nombreVisible({ persona: 'Laura Mendez', ciudad: 'Puebla' }),
    'Laura Mendez - Puebla'
  );
});

test('la empresa gana a la ciudad cuando existen las dos', () => {
  assert.equal(
    nombreVisible({ persona: 'Laura Mendez', empresa: 'Cocinas del Valle', ciudad: 'Puebla' }),
    'Laura Mendez - Cocinas del Valle'
  );
});

test('sin empresa ni ciudad queda el nombre de la persona solo', () => {
  assert.equal(nombreVisible({ persona: 'Laura Mendez' }), 'Laura Mendez');
});

test('sin persona el nombre cae a la empresa, nunca a una cadena vacia', () => {
  assert.equal(nombreVisible({ empresa: 'Cocinas del Valle', ciudad: 'Puebla' }), 'Cocinas del Valle');
  assert.equal(nombreVisible({ ciudad: 'Puebla' }), 'Puebla');
});

// --- El plan de escrituras (nucleo puro, objetos literales, sin red) ---

const PROSPECTO = {
  id: 12, celular: '+52 5512345678', nombre: 'Laura Mendez', ciudad: 'Puebla',
  etapa: 'por_cotizar', data: { empresa: 'Cocinas del Valle', correo: 'laura@cocinas.mx' },
};

function fichaCreada(plan) {
  assert.equal(plan.crear.length, 1);
  return plan.crear[0].ficha;
}

test('un prospecto que la libreta no conoce entra en la lista de crear', () => {
  const plan = planificarContactos({ prospectos: [PROSPECTO], mapeo: [] });
  const ficha = fichaCreada(plan);
  assert.equal(ficha.nombreVisible, 'Laura Mendez - Cocinas del Valle');
  assert.equal(ficha.telefono, '+525512345678');
  assert.equal(ficha.correo, 'laura@cocinas.mx');
  assert.equal(plan.actualizar.length, 0);
});

test('la ficha se identifica por el celular normalizado, no por lo que se escribe en Google', () => {
  const ficha = fichaCreada(planificarContactos({ prospectos: [PROSPECTO], mapeo: [] }));
  assert.equal(ficha.celular10, '5512345678');
});

test('el prospecto sin correo produce ficha igual, sin correo', () => {
  const sinCorreo = { ...PROSPECTO, data: { empresa: 'Cocinas del Valle' } };
  const ficha = fichaCreada(planificarContactos({ prospectos: [sinCorreo], mapeo: [] }));
  assert.equal(ficha.correo, '');
});

test('un prospecto descartado (No util) o perdido tambien produce contacto', () => {
  for (const etapa of ['no_util', 'perdida']) {
    const plan = planificarContactos({ prospectos: [{ ...PROSPECTO, etapa }], mapeo: [] });
    assert.equal(plan.crear.length, 1, `etapa ${etapa}`);
  }
});

test('un prospecto sin celular utilizable no produce escritura', () => {
  const plan = planificarContactos({ prospectos: [{ ...PROSPECTO, celular: '' }], mapeo: [] });
  assert.equal(plan.crear.length, 0);
  assert.equal(plan.actualizar.length, 0);
});

test('la segunda pasada sobre el mismo estado no escribe nada', () => {
  const primera = planificarContactos({ prospectos: [PROSPECTO], mapeo: [] });
  // El mapeo que la envoltura habria persistido tras aplicar la primera pasada.
  const mapeo = [{
    celular10: '5512345678', resourceName: 'people/c1', etag: 'e1',
    clase: 'propio', huella: primera.crear[0].huella,
  }];
  const segunda = planificarContactos({ prospectos: [PROSPECTO], mapeo });
  assert.equal(segunda.crear.length, 0);
  assert.equal(segunda.actualizar.length, 0);
});

test('cambiar el formato del telefono ACTUALIZA la ficha existente, no la duplica', () => {
  // Ficha creada con un formato viejo (con el "1"): misma llave, otra huella.
  const mapeo = [{
    celular10: '5512345678', resourceName: 'people/c1', etag: 'e1',
    clase: 'propio', huella: 'huella-del-formato-viejo',
  }];
  const plan = planificarContactos({ prospectos: [PROSPECTO], mapeo });
  assert.equal(plan.crear.length, 0, 'no se crea una segunda ficha para el mismo celular');
  assert.equal(plan.actualizar.length, 1);
  assert.equal(plan.actualizar[0].resourceName, 'people/c1');
  assert.equal(plan.actualizar[0].etag, 'e1');
  assert.equal(plan.actualizar[0].ficha.telefono, '+525512345678');
});

test('la ficha propia se reescribe entera: su mascara nombra todos los campos', () => {
  const mapeo = [{ celular10: '5512345678', resourceName: 'people/c1', etag: 'e1', clase: 'propio', huella: 'vieja' }];
  const plan = planificarContactos({ prospectos: [PROSPECTO], mapeo });
  assert.deepEqual(
    [...plan.actualizar[0].mascara].sort(),
    ['correo', 'nombreVisible', 'organizacion', 'origen', 'telefono']
  );
});

test('un celular que desaparece del origen no produce borrado: el plan no tiene por donde borrar', () => {
  const mapeo = [{ celular10: '5512345678', resourceName: 'people/c1', etag: 'e1', clase: 'propio', huella: 'x' }];
  const plan = planificarContactos({ prospectos: [], mapeo });
  assert.deepEqual(Object.keys(plan).sort(), ['actualizar', 'crear', 'inactivar']);
  assert.equal(plan.crear.length, 0);
  assert.equal(plan.actualizar.length, 0);
});

test('una ficha de clase que aun no sabemos escribir no se toca (ADR-0013)', () => {
  // El fallo caro es pisar un contacto ajeno con la mascara ancha del propio.
  const mapeo = [{ celular10: '5512345678', resourceName: 'people/c1', etag: 'e1', clase: 'adoptado', huella: 'vieja' }];
  const plan = planificarContactos({ prospectos: [PROSPECTO], mapeo });
  assert.equal(plan.crear.length, 0);
  assert.equal(plan.actualizar.length, 0);
});
