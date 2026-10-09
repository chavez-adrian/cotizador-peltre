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
// Solicitud: { clienteId, domicilioId, contacto: { nombre, telefono, correo },
//              cotizacion?: { id, folio }, decision?: { desplazar: [personId...] } }.
//
// Escribe a la persona NUEVA en el domicilio. Si el domicilio ya tiene General (#562),
// pisarlo es un dato de Operam: sin decision devuelve la pregunta al vendedor y no
// escribe nada; con la decision -- los person_id por los que se le pregunto -- REVALIDA
// contra lo que lee (si el General cambio, vuelve a preguntar) y, tras crear a la
// persona nueva, desplaza a cada General: le quita el rol (assgn[] es REPLACE), si era
// el unico queda de Entrega, y AGREGA a sus Notas la linea fechada de quien lo reemplazo
// y desde que cotizacion. La persona que ya esta en el domicilio se omite (editarla es
// #563) y la del Cliente Operam se crea como persona nueva sin liga (#564).
//
// Valores (Mensaje en dos capas en cada paso, `name: 'contacto de entrega'`):
//   { tipo: 'lograda', escrito: true, personId, desplazados?, noAplicados, pasos }
//       la persona quedo creada (y los desplazados, `{ personId, nombre, roles }` con
//       los roles que se les dejaron); `noAplicados` = lo que la relectura no confirma
//       ({ campo, etiqueta, esperado, encontrado }: casillas y roles de la nueva, roles
//       y nota de cada desplazado, un solo General) y entonces el paso es `warn`.
//   { tipo: 'lograda', escrito: false, motivo, pasos }   (paso `omitido`)
//       motivo: 'sin-domicilio', 'sin-nombre' o 'persona-existente'.
//   { tipo: 'pregunta', motivo: 'general-existente', desplazados, mensaje, detalle, pasos }
//       nada escrito; `desplazados` = los General del domicilio, `{ personId, nombre,
//       roles }`; el paso `warn` es el aviso del contacto pendiente.
//   { tipo: 'bloqueo', motivo: 'operam', mensaje, detalle, pasos }
//       la web legacy fallo: antes de mandar la escritura (paso `error`, no se
//       escribio nada) o despues (paso `warn`, no se sabe si quedo; si ya se creo a la
//       persona nueva y fallo el desplazamiento, el aviso dice que puede haber dos
//       General).
//
// deps: `abrirDomicilioWeb(clienteId, domicilioId)` -> `{ leer, crear, leerPersona,
// editar, cerrar }` (adaptador real: lib/contactos-operam-web.js; en memoria:
// test/helpers/contactos-operam-memoria.js) y `ahora()` (la fecha de la nota).
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
// desplazar. Devuelve `{ crear: persona }`, `{ omitido: { motivo, mensaje, detalle } }`
// o `{ pregunta: { desplazados } }`: el General que ya estaba es un dato de Operam que
// se pisaria, asi que primero se pregunta al vendedor (#562).
function planearContactoEntrega(personasDomicilio, contacto, decision) {
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
  const crear = {
    nombre: contacto.nombre, apellido: '', referencia: contacto.nombre, roles: ROLES_CONTACTO_ENTREGA,
    casillas: { cel: contacto.telefono, telefono: contacto.telefono, secundario: '', correo: contacto.correo },
    notas: '',
  };
  const desplazados = personasDomicilio.filter(p => p.roles.includes('general'))
    .map(g => ({ personId: g.personId, nombre: g.nombreCompleto, roles: [...g.roles] }));
  // La decision vale solo para los Generales por los que se pregunto (patron de #368):
  // si entre la pregunta y la respuesta el General del domicilio cambio, se vuelve a
  // preguntar y nunca se escribe sobre otro desplazado.
  if (desplazados.length && !mismasPersonas(decision?.desplazar, desplazados.map(d => d.personId))) {
    return { pregunta: { desplazados } };
  }
  return { crear, desplazados };
}

function mismasPersonas(confirmadas, actuales) {
  if (!Array.isArray(confirmadas)) return false;
  const a = new Set(confirmadas.map(String));
  return a.size === actuales.length && actuales.every(id => a.has(String(id)));
}

// Lo que le pasa a cada desplazado, en palabras del vendedor: pierde el General y, si
// era su unico rol, queda de Entrega (ADR-0024 regla 4).
const NOMBRE_ROL = { general: 'General', delivery: 'Entrega', invoice: 'Facturacion', order: 'Pedidos' };
function destinoDelDesplazado(d) {
  const otros = d.roles.filter(r => r !== 'general');
  return otros.length
    ? `${d.nombre} deja de ser el contacto General de este domicilio y conserva sus otros roles (${otros.map(r => NOMBRE_ROL[r] || r).join(', ')})`
    : `${d.nombre} deja de ser el contacto General de este domicilio y queda como contacto de Entrega`;
}

// La pregunta al vendedor (CODING_STANDARDS.md regla 3): nada escrito, a quien se
// desplazaria y lo necesario para reintentar con su decision. Su paso es el aviso que
// queda en el reporte de la subida mientras nadie contesta.
function preguntaDesplazar(desplazados, contacto, donde) {
  const destinos = desplazados.map(destinoDelDesplazado).join('. ');
  return {
    tipo: 'pregunta', motivo: 'general-existente', desplazados,
    mensaje: `${contacto.nombre} queda como contacto General y de Entrega del domicilio de entrega en Operam. ${destinos}.`,
    detalle: `${donde}: General actual ${desplazados.map(d => `persona ${d.personId}`).join(', ')}; un segundo General no se escribe`,
    pasos: [{
      name: PASO_CONTACTO, status: 'warn',
      mensaje: `El Contacto de entrega todavia no se escribio en Operam: falta que confirmes si ${desplazados.map(d => d.nombre).join(' y ')} deja de ser el contacto General del domicilio de entrega.`,
      detalle: `${donde}: pendiente de la decision del vendedor (General actual ${desplazados.map(d => `persona ${d.personId}`).join(', ')})`,
    }],
  };
}

// Nada que escribir, con su motivo: la operacion termina sin tocar Operam.
function omitida(motivo, mensaje, detalle) {
  return { tipo: 'lograda', escrito: false, motivo, pasos: [{ name: PASO_CONTACTO, status: 'omitido', mensaje, detalle }] };
}

// La linea que se AGREGA a las Notas del desplazado (ADR-0024 regla 4): cuando, quien lo
// reemplazo y desde que cotizacion. La fecha es la de la fabrica (Ciudad de Mexico),
// no la de UTC: a las 21:00 del 9 de octubre la nota dice 9 de octubre.
const FECHA_FABRICA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' });

function lineaDeReemplazo(ahora, nombre, cotizacion) {
  const cual = texto(cotizacion?.folio)
    ? `la Cotizaci\u00f3n ${texto(cotizacion.folio)}`
    : `la cotizaci\u00f3n ${texto(cotizacion?.id)} del cotizador`;
  return `${FECHA_FABRICA.format(ahora)}: deja de ser el contacto General de este domicilio; lo reemplaza ${nombre} desde ${cual}.`;
}

const conLinea = (previas, linea) => (texto(previas) ? `${String(previas).replace(/\s+$/, '')}\n${linea}` : linea);

// El desplazado pierde el General; si era su unico rol, queda de Entrega.
function rolesDelDesplazado(roles) {
  const otros = (roles || []).filter(r => r !== 'general');
  return otros.length ? otros : ['delivery'];
}

const mismosRoles = (a, b) => a.length === b.length && a.every(r => b.includes(r));

// Desplaza a los Generales que el vendedor confirmo y relee: sus roles y que el
// domicilio quedo con un solo General por la tabla, y la nota por el formulario de
// editar (la tabla no trae Notas). Devuelve lo no aplicado, como la relectura de crear.
async function desplazarGenerales(web, desplazados, nueva, linea) {
  const escritos = [];
  for (const d of desplazados) {
    const actual = await web.leerPersona(d.personId);
    const cambios = { roles: rolesDelDesplazado(actual.roles), notas: conLinea(actual.notas, linea) };
    await web.editar(d.personId, cambios);
    escritos.push({ ...d, roles: cambios.roles });
  }
  const despues = await web.leer();
  const noAplicados = [];
  for (const e of escritos) {
    const leida = despues.find(p => p.personId === e.personId);
    const roles = leida?.roles || [];
    if (!mismosRoles(roles, e.roles)) {
      noAplicados.push({ campo: 'roles-desplazado', etiqueta: `los roles de ${e.nombre}`, esperado: e.roles.join(', '), encontrado: roles.join(', ') });
    }
  }
  const otros = despues.filter(p => p.roles.includes('general') && p.personId !== nueva.personId);
  if (otros.length) {
    noAplicados.push({ campo: 'general-unico', etiqueta: 'el unico contacto General del domicilio', esperado: nueva.personId, encontrado: [nueva.personId, ...otros.map(p => p.personId)].join(', ') });
  }
  for (const e of escritos) {
    const notas = texto((await web.leerPersona(e.personId)).notas);
    if (!notas.includes(linea)) {
      noAplicados.push({ campo: 'notas-desplazado', etiqueta: `la nota en las Notas de ${e.nombre}`, esperado: linea, encontrado: notas });
    }
  }
  return { escritos, noAplicados };
}

export async function escribirContactoEntrega(solicitud, deps = {}) {
  const d = { abrirDomicilioWeb: deps.abrirDomicilioWeb || abrirDomicilioWeb, ahora: deps.ahora || (() => new Date()) };
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
  let creada = null;
  let desplazando = [];
  try {
    web = await d.abrirDomicilioWeb(clienteId, domicilioId);
    const antes = await web.leer();
    const plan = planearContactoEntrega(antes, contacto, solicitud.decision);
    if (plan.pregunta) return preguntaDesplazar(plan.pregunta.desplazados, contacto, `domicilio ${domicilioId} del cliente ${clienteId}`);
    if (plan.omitido) {
      return omitida(plan.omitido.motivo, plan.omitido.mensaje, `domicilio ${domicilioId} del cliente ${clienteId}: ${plan.omitido.detalle}`);
    }
    enviado = true;
    await web.crear(plan.crear);
    const trasCrear = await web.leer();
    const previos = new Set(antes.map(p => p.personId));
    const nueva = trasCrear.find(p => !previos.has(p.personId)) || null;
    const noAplicados = noAplicadosAlCrear(plan.crear, nueva);
    const donde = `domicilio ${domicilioId} del cliente ${clienteId}`;
    // Al desplazado solo se le quita el General si la persona nueva quedo: si no, el
    // domicilio se quedaria sin General y su nota citaria a alguien que no existe.
    let desplazados = [];
    if (nueva && plan.desplazados.length) {
      creada = nueva;
      desplazando = plan.desplazados;
      const r = await desplazarGenerales(web, plan.desplazados, nueva, lineaDeReemplazo(d.ahora(), contacto.nombre, solicitud.cotizacion));
      desplazados = r.escritos;
      noAplicados.push(...r.noAplicados);
    }
    const quedaron = desplazados.map(x => `${x.nombre} dejo de ser General y ${x.roles.includes('delivery') && x.roles.length === 1 ? 'quedo como contacto de Entrega' : 'conserva sus otros roles'}`).join('; ');
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
        mensaje: `${contacto.nombre} quedo en Operam como contacto General y de Entrega del domicilio de entrega${quedaron ? `; ${quedaron}` : ''}.`,
        detalle: `${donde}: persona ${nueva.personId} creada con roles ${ROLES_CONTACTO_ENTREGA.join(', ')}; Cel y Telefono ${contacto.telefono || '(vacio)'}; correo ${contacto.correo || '(vacio)'}` +
          desplazados.map(x => `; persona ${x.personId} sin General, roles ${x.roles.join(', ')}, nota agregada`).join(''),
      };
    return { tipo: 'lograda', escrito: true, personId: nueva?.personId ?? null, ...(plan.desplazados.length ? { desplazados } : {}), noAplicados, pasos: [paso] };
  } catch (err) {
    // Antes de mandar la escritura no se escribio nada; despues ya no se sabe (la
    // escritura pudo quedar y lo que fallo fue su respuesta o la relectura), y decir
    // "no se escribio" llevaria al vendedor a crearla a mano otra vez.
    // Ya creada la persona nueva, la falla fue al desplazar: el domicilio puede haber
    // quedado con dos General, y eso es lo que el vendedor tiene que ir a revisar.
    const mensaje = creada
      ? `${contacto.nombre} quedo como contacto General del domicilio de entrega en Operam, pero no se pudo confirmar que ${desplazando.map(x => x.nombre).join(' y ')} dejo de serlo: revisa el domicilio en Operam, puede tener dos contactos General.`
      : enviado
        ? 'No se pudo confirmar que el Contacto de entrega quedo escrito en el domicilio de entrega en Operam: revisalo ahi.'
        : 'No se pudo escribir el Contacto de entrega en el domicilio de entrega en Operam.';
    const tras = creada ? ` (tras crear la persona ${creada.personId}, al desplazar ${desplazando.map(x => `persona ${x.personId}`).join(', ')})` : enviado ? ' (tras mandar la escritura)' : '';
    const detalle = `domicilio ${domicilioId} del cliente ${clienteId}, web legacy${tras}: ${err?.message}`;
    return { tipo: 'bloqueo', motivo: 'operam', mensaje, detalle, pasos: [{ name: PASO_CONTACTO, status: enviado ? 'warn' : 'error', mensaje, detalle }] };
  } finally {
    if (web) await web.cerrar();
  }
}
