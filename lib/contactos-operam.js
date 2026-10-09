// EL modulo Contactos en Operam (#559, ADR-0024): la unica puerta para leer (y, desde
// #561, escribir) las personas que Operam registra bajo un Cliente Operam y bajo sus
// domicilios de entrega. Reglas de modulo de dominio en CODING_STANDARDS.md.
//
// Esta es la mitad con IO. La traduccion de lo que Operam devuelve a personas (por
// person_id, con roles y casillas, el Cel incluido) y al General aplanado de cada
// domicilio vive en su nucleo puro, lib/contactos-operam-logica.js
// (`contactosDeClienteOperam`), que tambien leen sin IO los que ya traen al Cliente
// Operam en la mano (#560). La escritura (#561, `escribirContactoEntrega`) va por la
// web legacy con su adaptador, lib/contactos-operam-web.js.

import { obtenerCliente } from './operam-client.js';
import { contactosDelDomicilio } from './contactos-domicilio-io.js';
import { contactosDeClienteOperam } from './contactos-operam-logica.js';
import { abrirDomicilioWeb } from './contactos-operam-web.js';
import { ultimos10 } from './telefono-llave.js';

// Las personas de un Cliente Operam y de cada domicilio de entrega suyo, y el General
// aplanado de cada domicilio. `null` si el Cliente Operam no existe. Lee el cliente
// de Operam (un GET) y los domicilios del padron cacheado, que nunca espera a Operam.
// Un fallo al leer el cliente rechaza: quien pregunta decide (no se puede afirmar que
// no tiene contactos).
export async function leerContactos(clienteId, deps = {}) {
  const d = {
    obtenerCliente: deps.obtenerCliente || obtenerCliente,
    contactosDelDomicilio: deps.contactosDelDomicilio || contactosDelDomicilio,
  };
  const cliente = await d.obtenerCliente(clienteId);
  if (!cliente) return null;
  let filas = [];
  for (const b of cliente.branches || []) {
    const delDomicilio = await d.contactosDelDomicilio(b.branch_code);
    if (!Array.isArray(delDomicilio)) { filas = null; break; }
    filas = filas.concat(delDomicilio);
  }
  return contactosDeClienteOperam(cliente, filas);
}

// --- Escritura del Contacto de entrega (#561, ADR-0024 reglas 4 y 5) ---------
// Deja a quien recibe la mercancia como Contacto en Operam del domicilio de entrega,
// con rol General y Entrega, su numero en Cel y en Telefono principal y su correo.
// La API v3 no escribe contactos (501): se escribe por la pestana Contactos de la
// pagina de domicilios de la web legacy, que es tambien la unica lectura FRESCA de un
// domicilio (contact_list es una cache de hasta 1 h). Una sola sesion web por
// llamada para leer, escribir y releer, y se cierra siempre.
//
// Solicitud: { clienteId, domicilioId, contacto: { nombre, telefono, correo } }.
//
// Hoy (#561) escribe UN caso: el domicilio sin contacto General y una persona que no
// esta en el. Lo demas se omite con su motivo y sin tocar Operam -- nunca se deja un
// segundo General ni se duplica a una persona --: desplazar al General con la
// pregunta al vendedor es #562, editar a la persona del domicilio #563 y copiar a la
// del Cliente Operam #564.
//
// Valores (Mensaje en dos capas en cada paso, `name: 'contacto de entrega'`):
//   { tipo: 'lograda', escrito: true, personId, noAplicados, pasos }
//       la persona quedo creada; `noAplicados` = lo que la relectura no confirma
//       ({ campo, etiqueta, esperado, encontrado }) y entonces el paso es `warn`.
//   { tipo: 'lograda', escrito: false, motivo, pasos }   (paso `omitido`)
//       motivo: 'sin-domicilio', 'sin-nombre', 'general-existente' o
//       'persona-existente'.
//   { tipo: 'bloqueo', motivo: 'operam', mensaje, detalle, pasos }
//       la web legacy fallo: antes de mandar la escritura (paso `error`, no se
//       escribio nada) o despues (paso `warn`, no se sabe si quedo).
//
// deps: `abrirDomicilioWeb(clienteId, domicilioId)` -> `{ leer, crear, cerrar }`
// (adaptador real: lib/contactos-operam-web.js; en memoria:
// test/helpers/contactos-operam-memoria.js).
const PASO_CONTACTO = 'contacto de entrega';
const texto = v => String(v ?? '').trim();
// maxlength del nombre y de la Referencia en el formulario de contactos (medido): se
// manda lo que mandaria el navegador.
const MAX_NOMBRE = 40;
const ROLES_CONTACTO_ENTREGA = ['general', 'delivery'];

// La cotizacion no guarda a QUIEN eligio el vendedor en el selector, solo su nombre y
// sus datos, asi que una persona del domicilio se reconoce por ellos: el mismo numero
// (ultimos 10 digitos) en cualquiera de sus tres casillas, o el mismo nombre -- el
// selector pone el nombre sin el apellido y la web pinta los dos juntos, de ahi el
// prefijo --. En la duda no se crea: duplicar a una persona en Operam no tiene vuelta.
const normalizarPersona = v => texto(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');

function esLaMismaPersona(persona, contacto) {
  const numero = ultimos10(contacto.telefono);
  const casillas = persona.casillas || {};
  if (numero.length === 10 && [casillas.cel, casillas.telefono, casillas.secundario].some(n => ultimos10(n) === numero)) return true;
  const nombre = normalizarPersona(contacto.nombre);
  const completo = normalizarPersona(persona.nombreCompleto);
  return !!nombre && (completo === nombre || completo.startsWith(nombre + ' '));
}

// La relectura contra lo que se mando a crear: lo que no quedo, campo por campo, con
// lo esperado y lo leido. Los numeros se comparan por sus ultimos 10 digitos (la web
// los guarda como texto libre) y el nombre contra el "Nombre Completo" de la tabla.
const COMPARACIONES_AL_CREAR = [
  { campo: 'nombre', etiqueta: 'el nombre', esperado: c => c.nombre, leido: p => p.nombreCompleto, igual: (a, b) => normalizarPersona(a) === normalizarPersona(b) },
  { campo: 'cel', etiqueta: 'el Cel', esperado: c => c.casillas.cel, leido: p => p.casillas.cel, igual: (a, b) => ultimos10(a) === ultimos10(b) },
  { campo: 'telefono', etiqueta: 'el Telefono', esperado: c => c.casillas.telefono, leido: p => p.casillas.telefono, igual: (a, b) => ultimos10(a) === ultimos10(b) },
  { campo: 'correo', etiqueta: 'el correo', esperado: c => c.casillas.correo, leido: p => p.casillas.correo, igual: (a, b) => texto(a).toLowerCase() === texto(b).toLowerCase() },
  { campo: 'roles', etiqueta: 'los roles General y Entrega', esperado: c => c.roles.join(', '), leido: p => p.roles.join(', '), igual: (_a, _b, c, p) => c.roles.every(r => p.roles.includes(r)) },
];

function noAplicadosAlCrear(creada, leida) {
  if (!leida) return [{ campo: 'persona', etiqueta: 'la persona', esperado: creada.nombre, encontrado: '' }];
  return COMPARACIONES_AL_CREAR
    .filter(k => !k.igual(texto(k.esperado(creada)), texto(k.leido(leida)), creada, leida))
    .map(k => ({ campo: k.campo, etiqueta: k.etiqueta, esperado: texto(k.esperado(creada)), encontrado: texto(k.leido(leida)) }));
}

// Nucleo PURO: las personas del domicilio tal como las acaba de leer la web y el
// Contacto de entrega -> que escribir. La persona va antes que el General: si quien
// recibe ES el General, el vendedor lo eligio a el (ADR-0024 regla 2) y no hay a quien
// desplazar. `{ crear: persona }` o `{ omitido: { motivo,
// mensaje, detalle } }`: lo que este modulo todavia no escribe se omite con su motivo,
// nunca se escribe a medias.
function planearContactoEntrega(personasDomicilio, contacto) {
  const misma = personasDomicilio.find(p => esLaMismaPersona(p, contacto));
  if (misma) {
    return {
      omitido: {
        motivo: 'persona-existente',
        mensaje: `${misma.nombreCompleto} ya esta en el domicilio de entrega en Operam; sus datos no se cambiaron desde aqui.`,
        detalle: `el Contacto de entrega coincide con la persona ${misma.personId} del domicilio; no se crea otra`,
      },
    };
  }
  const general = personasDomicilio.find(p => p.roles.includes('general'));
  if (general) {
    return {
      omitido: {
        motivo: 'general-existente',
        mensaje: `El domicilio de entrega ya tiene un contacto General en Operam (${general.nombreCompleto}); el Contacto de entrega no se escribio ahi.`,
        detalle: `ya hay General (persona ${general.personId}); un segundo General no se escribe`,
      },
    };
  }
  return {
    crear: {
      nombre: contacto.nombre, apellido: '', referencia: contacto.nombre, roles: ROLES_CONTACTO_ENTREGA,
      casillas: { cel: contacto.telefono, telefono: contacto.telefono, secundario: '', correo: contacto.correo },
      notas: '',
    },
  };
}

// Nada que escribir, con su motivo: la operacion termina sin tocar Operam.
function omitida(motivo, mensaje, detalle) {
  return { tipo: 'lograda', escrito: false, motivo, pasos: [{ name: PASO_CONTACTO, status: 'omitido', mensaje, detalle }] };
}

export async function escribirContactoEntrega(solicitud, deps = {}) {
  const d = { abrirDomicilioWeb: deps.abrirDomicilioWeb || abrirDomicilioWeb };
  const { clienteId, domicilioId } = solicitud;
  const contacto = {
    nombre: texto(solicitud.contacto?.nombre).slice(0, MAX_NOMBRE).trim(),
    telefono: texto(solicitud.contacto?.telefono),
    correo: texto(solicitud.contacto?.correo),
  };
  if (domicilioId == null || texto(domicilioId) === '') {
    return omitida('sin-domicilio',
      'La cotizacion no quedo ligada a un domicilio de entrega en Operam: el Contacto de entrega no se escribio ahi.',
      `cliente ${clienteId}: sin domicilio (branch) donde escribir`);
  }
  if (!contacto.nombre) {
    return omitida('sin-nombre',
      'El Contacto de entrega no tiene nombre: no se escribio en el domicilio de entrega en Operam.',
      `domicilio ${domicilioId} del cliente ${clienteId}: sin nombre no se crea una persona`);
  }
  let web = null;
  let enviado = false;
  try {
    web = await d.abrirDomicilioWeb(clienteId, domicilioId);
    const antes = await web.leer();
    const plan = planearContactoEntrega(antes, contacto);
    if (plan.omitido) {
      return omitida(plan.omitido.motivo, plan.omitido.mensaje, `domicilio ${domicilioId} del cliente ${clienteId}: ${plan.omitido.detalle}`);
    }
    enviado = true;
    await web.crear(plan.crear);
    const despues = await web.leer();
    const previos = new Set(antes.map(p => p.personId));
    const nueva = despues.find(p => !previos.has(p.personId)) || null;
    const noAplicados = noAplicadosAlCrear(plan.crear, nueva);
    const donde = `domicilio ${domicilioId} del cliente ${clienteId}`;
    const paso = noAplicados.length
      ? {
        name: PASO_CONTACTO, status: 'warn',
        mensaje: nueva
          ? `${contacto.nombre} quedo en Operam en el domicilio de entrega, pero revisa su contacto: ${noAplicados.map(n => n.etiqueta).join(', ')} no quedo como se capturo.`
          : `Revisa el contacto del domicilio de entrega en Operam: no se pudo confirmar que ${contacto.nombre} quedo registrado.`,
        detalle: `${donde}: ${nueva ? `persona ${nueva.personId}` : 'ninguna persona nueva en la relectura'}; ` +
          noAplicados.map(n => `${n.campo} se esperaba "${n.esperado}" y se leyo "${n.encontrado}"`).join('; '),
      }
      : {
        name: PASO_CONTACTO, status: 'ok',
        mensaje: `${contacto.nombre} quedo en Operam como contacto General y de Entrega del domicilio de entrega.`,
        detalle: `${donde}: persona ${nueva.personId} creada con roles ${ROLES_CONTACTO_ENTREGA.join(', ')}; Cel y Telefono ${contacto.telefono || '(vacio)'}; correo ${contacto.correo || '(vacio)'}`,
      };
    return { tipo: 'lograda', escrito: true, personId: nueva?.personId ?? null, noAplicados, pasos: [paso] };
  } catch (err) {
    // Antes de mandar la escritura no se escribio nada; despues ya no se sabe (la
    // escritura pudo quedar y lo que fallo fue su respuesta o la relectura), y decir
    // "no se escribio" llevaria al vendedor a crearla a mano otra vez.
    const mensaje = enviado
      ? 'No se pudo confirmar que el Contacto de entrega quedo escrito en el domicilio de entrega en Operam: revisalo ahi.'
      : 'No se pudo escribir el Contacto de entrega en el domicilio de entrega en Operam.';
    const detalle = `domicilio ${domicilioId} del cliente ${clienteId}, web legacy${enviado ? ' (tras mandar la escritura)' : ''}: ${err?.message}`;
    return { tipo: 'bloqueo', motivo: 'operam', mensaje, detalle, pasos: [{ name: PASO_CONTACTO, status: enviado ? 'warn' : 'error', mensaje, detalle }] };
  } finally {
    if (web) await web.cerrar();
  }
}
