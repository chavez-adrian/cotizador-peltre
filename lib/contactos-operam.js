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
import { buscar as buscarCopia, guardar as guardarCopia } from './copias-contacto-store.js';
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
// Solicitud: { clienteId, domicilioId, contacto: { nombre, telefono, correo, personId? },
//              cotizacion?: { id, folio },
//              decision?: { desplazar: [personId...], pisar?: [{ personId, campo, viejo }] } }.
//
// Escribe a la persona NUEVA en el domicilio. Si el domicilio ya tiene General (#562),
// pisarlo es un dato de Operam: sin decision devuelve la pregunta al vendedor y no
// escribe nada; con la decision -- los person_id por los que se le pregunto -- REVALIDA
// contra lo que lee (si el General cambio, vuelve a preguntar) y, tras crear a la
// persona nueva, desplaza a cada General: le quita el rol (assgn[] es REPLACE), si era
// el unico queda de Entrega, y AGREGA a sus Notas la linea fechada de quien lo reemplazo
// y desde que cotizacion. La del Cliente Operam se copia al domicilio (#564, abajo).
//
// La persona ELEGIDA (#563, `contacto.personId`, la que el vendedor escogio en el
// selector) que ya esta en el domicilio se EDITA (regla 5): el numero va a Cel y a
// Telefono principal, un Telefono distinto que ya estaba pasa a Secundario (el
// Secundario que no queda en ningun lado se pierde) y el correo capturado a su casilla;
// llenar una casilla vacia no pregunta, pisar un valor no vacio si (con el viejo y el
// nuevo), y un correo capturado vacio no borra el que habia. El nombre nunca se toca.
// Queda con General y Entrega ademas de sus roles, y los demas General se desplazan
// como al crear, en la MISMA pregunta. La decision lleva las casillas con su valor
// viejo: si cambio en Operam, se vuelve a preguntar. Sin person_id (o con uno que no
// esta en el domicilio) una persona del domicilio que coincide por numero o nombre se
// omite: editar sin identidad le escribiria a quien casa por nombre.
//
// La persona elegida que solo esta en el Cliente Operam (#564, regla 6) se COPIA al
// domicilio: Operam no liga una persona existente (medido: "Clonar" tambien crea otra).
// La copia lleva su nombre, apellido y Referencia, sus numeros con el capturado puesto
// como al editar (Cel y Telefono; su Telefono distinto a Secundario), su correo o el
// capturado, y solo General y Entrega (sus roles del cliente, Facturacion o Pedidos, no
// viajan: cambiarian a quien llegan las facturas o que contacto deriva el quote). No hay
// pregunta por datos pisados -- nadie en Operam se sobrescribe y la original queda
// igual --; la del General si aplica. El cotizador guarda la liga copia -> origen
// (`guardarCopia`) y la siguiente vez que se elige a la misma persona para el mismo
// domicilio la copia es la persona elegida y se edita como cualquier otra (#563). Si la
// copia ya no esta en el domicilio (la borraron en Operam), se crea otra y la liga se
// reapunta. Una persona del domicilio que coincide por numero o nombre sigue ganando
// a la copia: en la duda no se crea.
//
// Valores (Mensaje en dos capas en cada paso, `name: 'contacto de entrega'`):
//   { tipo: 'lograda', escrito: true, personId, copiaDe?, desplazados?, noAplicados, cambios?, pasos }
//       la persona quedo creada, o editada (#563), y los desplazados, `{ personId,
//       nombre, roles }` con los roles que se les dejaron; `copiaDe` = el person_id de
//       origen cuando la persona es la copia de una del Cliente Operam (#564);
//       `noAplicados` = lo que la
//       relectura no confirma ({ campo, etiqueta, esperado, encontrado }: casillas y
//       roles de la persona, roles y nota de cada desplazado, un solo General) y
//       entonces el paso es `warn`. Solo la edicion (#565) trae `cambios`: `[{ personId,
//       campo, viejo, nuevo }]`, los datos no vacios que se pisaron y la relectura
//       confirma (llenar una casilla vacia no es un cambio).
//   { tipo: 'lograda', escrito: false, motivo, pasos }   (paso `omitido`)
//       motivo: 'sin-domicilio', 'sin-nombre', 'persona-existente' (sin person_id) o
//       'sin-cambios' (la persona elegida ya estaba al dia, #563).
//   { tipo: 'pregunta', motivo: 'general-existente', desplazados, mensaje, detalle, pasos }
//       nada escrito; `desplazados` = los General del domicilio, `{ personId, nombre,
//       roles }`; el paso `warn` es el aviso del contacto pendiente.
//   { tipo: 'pregunta', motivo: 'pisa-datos', persona, desplazados, pisa, mensaje, detalle, pasos }
//       (#563) nada escrito; `persona` = `{ personId, nombre }` de la elegida, `pisa` =
//       `[{ personId, campo, viejo, nuevo, pierde? }]` (campo cel, telefono, secundario
//       o correo; `pierde` = el valor viejo del Secundario no queda en ningun lado).
//       Sin casillas que pisar y con General a desplazar es 'general-existente' con
//       `persona`.
//   { tipo: 'bloqueo', motivo: 'operam', mensaje, detalle, pasos }
//       la web legacy fallo: antes de mandar la escritura (paso `error`, no se
//       escribio nada) o despues (paso `warn`, no se sabe si quedo; si ya se creo a la
//       persona nueva y fallo el desplazamiento, el aviso dice que puede haber dos
//       General).
//
// deps: `abrirDomicilioWeb(clienteId, domicilioId)` -> `{ leer, crear, leerPersona,
// editar, cerrar }` (adaptador real: lib/contactos-operam-web.js; en memoria:
// test/helpers/contactos-operam-memoria.js), `ahora()` (la fecha de la nota) y, para
// la copia (#564), `obtenerCliente(id)` (la persona de origen, por la API) y
// `buscarCopia(domicilioId, origenPersonId)` / `guardarCopia(liga)` (la liga, que es
// dato del cotizador: lib/copias-contacto-store.js).
const PASO_CONTACTO = 'contacto de entrega';
const texto = v => String(v ?? '').trim();
// maxlength del nombre y de la Referencia en el formulario de contactos (medido): se
// manda lo que mandaria el navegador.
const MAX_NOMBRE = 40;
const ROLES_CONTACTO_ENTREGA = ['general', 'delivery'];

// Sin el person_id de la persona elegida (cotizaciones anteriores a #563, "+ Nuevo
// contacto" o una persona que no esta en el domicilio) una persona del domicilio se
// reconoce por sus datos: el mismo numero
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
  { campo: 'nombre', etiqueta: 'el nombre', esperado: c => nombreCompletoDe(c), leido: p => p.nombreCompleto, igual: (a, b) => normalizarPersona(a) === normalizarPersona(b) },
  { campo: 'cel', etiqueta: 'el Cel', esperado: c => c.casillas.cel, leido: p => p.casillas.cel, igual: (a, b) => ultimos10(a) === ultimos10(b) },
  { campo: 'telefono', etiqueta: 'el Telefono', esperado: c => c.casillas.telefono, leido: p => p.casillas.telefono, igual: (a, b) => ultimos10(a) === ultimos10(b) },
  { campo: 'correo', etiqueta: 'el correo', esperado: c => c.casillas.correo, leido: p => p.casillas.correo, igual: (a, b) => texto(a).toLowerCase() === texto(b).toLowerCase() },
  { campo: 'roles', etiqueta: 'los roles General y Entrega', esperado: c => c.roles.join(', '), leido: p => p.roles.join(', '), igual: (_a, _b, c, p) => c.roles.every(r => p.roles.includes(r)) },
];

function nombreCompletoDe(c) {
  return [texto(c.nombre), texto(c.apellido)].filter(Boolean).join(' ');
}

function noAplicadosAlCrear(creada, leida) {
  if (!leida) return [{ campo: 'persona', etiqueta: 'la persona', esperado: nombreCompletoDe(creada), encontrado: '' }];
  return COMPARACIONES_AL_CREAR
    .filter(k => !k.igual(texto(k.esperado(creada)), texto(k.leido(leida)), creada, leida))
    .map(k => ({ campo: k.campo, etiqueta: k.etiqueta, esperado: texto(k.esperado(creada)), encontrado: texto(k.leido(leida)) }));
}

// La relectura de la persona editada (#563): sus cuatro casillas como se mandaron y
// General y Entrega entre sus roles. El nombre no se manda y no se compara.
function noAplicadosAlEditar(editar, leida) {
  if (!leida) return [{ campo: 'persona', etiqueta: 'la persona', esperado: editar.persona.nombreCompleto, encontrado: '' }];
  const fuera = Object.keys(ETIQUETA_CASILLA)
    .filter(campo => !IGUAL_CASILLA[campo](editar.casillas[campo], leida.casillas?.[campo]))
    .map(campo => ({ campo, etiqueta: ETIQUETA_CASILLA[campo], esperado: texto(editar.casillas[campo]), encontrado: texto(leida.casillas?.[campo]) }));
  if (!ROLES_CONTACTO_ENTREGA.every(r => leida.roles.includes(r))) {
    fuera.push({ campo: 'roles', etiqueta: 'los roles General y Entrega', esperado: editar.roles.join(', '), encontrado: leida.roles.join(', ') });
  }
  return fuera;
}

// #565: los datos no vacios que la edicion piso Y la relectura confirma, con el valor
// viejo y el nuevo. La Subida del quote los lee para fundir los Contactos del
// cotizador cuando el Cel de la persona cambio (enmienda a ADR-0016): lo que no quedo
// en Operam no es un cambio, y sin relectura de la persona no hay ninguno.
function cambiosConfirmados(pisa, noAplicados) {
  if (noAplicados.some(n => n.campo === 'persona')) return [];
  return pisa
    .filter(p => !noAplicados.some(n => n.campo === p.campo))
    .map(({ personId, campo, viejo, nuevo }) => ({ personId, campo, viejo, nuevo }));
}

// Lo que le quedo a cada desplazado, para el paso del vendedor.
const textoQuedaron = desplazados => desplazados.map(x => `${x.nombre} dejo de ser General y ${x.roles.includes('delivery') && x.roles.length === 1 ? 'quedo como contacto de Entrega' : 'conserva sus otros roles'}`).join('; ');

function pasoEditada(editar, noAplicados, donde, desplazados = []) {
  const nombre = editar.persona.nombreCompleto;
  if (noAplicados.length) {
    return {
      name: PASO_CONTACTO, status: 'warn',
      mensaje: `${nombre} sigue en Operam en el domicilio de entrega, pero revisa su contacto: ${noAplicados.map(n => n.etiqueta).join(', ')} no quedo como se capturo.`,
      detalle: `${donde}: persona ${editar.persona.personId} editada; ` +
        noAplicados.map(n => `${n.campo} se esperaba "${n.esperado}" y se leyo "${n.encontrado}"`).join('; '),
    };
  }
  const c = editar.casillas;
  const quedaron = textoQuedaron(desplazados);
  return {
    name: PASO_CONTACTO, status: 'ok',
    mensaje: `${nombre} quedo en Operam como contacto General y de Entrega del domicilio de entrega, con sus datos al d\u00eda${quedaron ? `; ${quedaron}` : ''}.`,
    detalle: `${donde}: persona ${editar.persona.personId} editada con roles ${editar.roles.join(', ')}; ` +
      `Cel ${c.cel || '(vacio)'}, Telefono ${c.telefono || '(vacio)'}, Secundario ${c.secundario || '(vacio)'}, correo ${c.correo || '(vacio)'}; el nombre no se toca` +
      desplazados.map(x => `; persona ${x.personId} sin General, roles ${x.roles.join(', ')}, nota agregada`).join(''),
  };
}

// Nucleo PURO: las personas del domicilio tal como las acaba de leer la web y el
// Contacto de entrega -> que escribir. La persona va antes que el General: si quien
// recibe ES el General, el vendedor lo eligio a el (ADR-0024 regla 2) y no hay a quien
// desplazar. Devuelve `{ crear: persona }`, `{ omitido: { motivo, mensaje, detalle } }`
// o `{ pregunta: { desplazados } }`: el General que ya estaba es un dato de Operam que
// se pisaria, asi que primero se pregunta al vendedor (#562).
// `copia` y `origen` (#564) los resuelve quien llama (son IO): el person_id de la copia
// que el cotizador ligo a la persona elegida en ESTE domicilio, y la persona elegida
// tal como esta en el Cliente Operam.
function planearContactoEntrega(personasDomicilio, contacto, decision, { copia = null, origen = null } = {}) {
  // #563: el vendedor eligio a una persona en el selector y la cotizacion trae su
  // person_id. Si esta en el domicilio, ESA es la persona y se edita. Si no esta y el
  // cotizador ya la copio a este domicilio (#564), la copia es la persona elegida.
  const elegida = contacto.personId ? personasDomicilio.find(p => String(p.personId) === contacto.personId) : null;
  if (elegida) return planearEdicion(personasDomicilio, elegida, contacto, decision);
  const suCopia = copia ? personasDomicilio.find(p => String(p.personId) === String(copia)) : null;
  if (suCopia) return { ...planearEdicion(personasDomicilio, suCopia, contacto, decision), copiaDe: contacto.personId };
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
  const crear = origen
    ? {
      nombre: recortar(origen.nombre), apellido: recortar(origen.apellido), referencia: recortar(origen.referencia || origen.nombre),
      roles: ROLES_CONTACTO_ENTREGA, casillas: conElNumeroCapturado(origen.casillas, contacto).casillas, notas: '',
    }
    : {
      nombre: contacto.nombre, apellido: '', referencia: contacto.nombre, roles: ROLES_CONTACTO_ENTREGA,
      casillas: { cel: contacto.telefono, telefono: contacto.telefono, secundario: '', correo: contacto.correo },
      notas: '',
    };
  const desplazados = personasDomicilio.filter(p => p.roles.includes('general'))
    .map(g => ({ personId: g.personId, nombre: g.nombreCompleto, roles: [...g.roles] }));
  // La decision vale solo para los Generales por los que se pregunto (patron de #368):
  // si entre la pregunta y la respuesta el General del domicilio cambio, se vuelve a
  // preguntar y nunca se escribe sobre otro desplazado.
  const deOrigen = origen ? { copiaDe: origen.personId } : {};
  if (desplazados.length && !mismasPersonas(decision?.desplazar, desplazados.map(d => d.personId))) {
    const persona = origen ? { persona: { personId: origen.personId, nombre: nombreCompletoDe(crear) }, pisa: [] } : {};
    return { pregunta: { desplazados, ...persona }, ...deOrigen };
  }
  return { crear, desplazados, ...deOrigen };
}

function recortar(v) {
  return texto(v).slice(0, MAX_NOMBRE).trim();
}

// Las casillas de una persona con el numero y el correo capturados puestos como dice la
// regla 5: el numero a Cel y a Telefono principal, un Telefono distinto que ya estaba a
// Secundario (lo que hubiera en Secundario se pierde, salvo que sea el numero que acaba
// de subir a Telefono), el correo capturado a su casilla y uno vacio no borra. `pisa` =
// los valores no vacios que cambian. Lo comparten la edicion (#563) y la copia (#564).
function conElNumeroCapturado(antes, contacto, personId = null) {
  const de = antes || {};
  const casillas = { cel: texto(de.cel), telefono: texto(de.telefono), secundario: texto(de.secundario), correo: texto(de.correo) };
  const pisa = [];
  const poner = (campo, nuevo) => {
    if (!nuevo || IGUAL_CASILLA[campo](casillas[campo], nuevo)) return;
    if (casillas[campo]) pisa.push({ personId, campo, viejo: casillas[campo], nuevo });
    casillas[campo] = nuevo;
  };
  const telefonoPrevio = casillas.telefono;
  poner('cel', contacto.telefono);
  poner('telefono', contacto.telefono);
  if (telefonoPrevio && casillas.telefono !== telefonoPrevio) {
    const secundarioPrevio = casillas.secundario;
    poner('secundario', telefonoPrevio);
    const pisada = pisa.find(p => p.campo === 'secundario');
    if (pisada) pisada.pierde = !IGUAL_CASILLA.secundario(secundarioPrevio, contacto.telefono);
  }
  poner('correo', contacto.correo);
  return { casillas, pisa };
}

// La persona elegida que ya esta en el domicilio (#563, ADR-0024 regla 5): el numero
// capturado va a Cel y a Telefono principal y el correo capturado a su casilla. Una
// casilla vacia se llena sin preguntar; un correo capturado vacio no borra el que habia.
// El nombre no se toca. Queda con General y Entrega, ademas de los roles que ya tenia
// (assgn[] es REPLACE: viajan todos), y los demas General del domicilio se desplazan
// como al crear.
function planearEdicion(personasDomicilio, elegida, contacto, decision) {
  const antes = elegida.casillas || {};
  const { casillas, pisa } = conElNumeroCapturado(antes, contacto, elegida.personId);
  const roles = [...elegida.roles, ...ROLES_CONTACTO_ENTREGA.filter(r => !elegida.roles.includes(r))];
  const desplazados = personasDomicilio.filter(p => p.personId !== elegida.personId && p.roles.includes('general'))
    .map(g => ({ personId: g.personId, nombre: g.nombreCompleto, roles: [...g.roles] }));
  const cambia = roles.length !== elegida.roles.length || Object.keys(casillas).some(k => casillas[k] !== texto(antes[k]));
  if (!cambia && !desplazados.length) {
    return {
      omitido: {
        motivo: 'sin-cambios',
        mensaje: `${elegida.nombreCompleto} ya estaba en Operam como contacto General y de Entrega del domicilio de entrega, con estos datos.`,
        detalle: `persona ${elegida.personId}: casillas y roles ya coinciden; no se escribe`,
      },
    };
  }
  if ((desplazados.length || pisa.length) && !confirmada(decision, desplazados, pisa)) {
    return { pregunta: { persona: { personId: elegida.personId, nombre: elegida.nombreCompleto }, desplazados, pisa } };
  }
  // Al formulario solo viajan las casillas que cambian: las demas se repostean como
  // las trae Operam, sin pasar por la lectura de la tabla.
  const cambios = Object.fromEntries(Object.keys(casillas).filter(k => casillas[k] !== texto(antes[k])).map(k => [k, casillas[k]]));
  return { editar: { persona: elegida, casillas, cambios, roles, pisa }, desplazados };
}

// Cada casilla con su igualdad: los numeros por sus ultimos 10 digitos (la web los
// guarda como texto libre) y el correo sin mayusculas.
const IGUAL_CASILLA = {
  cel: (a, b) => ultimos10(a) === ultimos10(b) && (!!texto(a) === !!texto(b)),
  telefono: (a, b) => ultimos10(a) === ultimos10(b) && (!!texto(a) === !!texto(b)),
  secundario: (a, b) => ultimos10(a) === ultimos10(b) && (!!texto(a) === !!texto(b)),
  correo: (a, b) => texto(a).toLowerCase() === texto(b).toLowerCase(),
};

// La decision vale para lo que se pregunto (patron de #368): los mismos General a
// desplazar y las mismas casillas a pisar CON el valor viejo que se le mostro al
// vendedor. Si algo cambio en Operam entre la pregunta y la respuesta, se vuelve a
// preguntar.
function confirmada(decision, desplazados, pisa) {
  if (!decision) return false;
  if (!mismasPersonas(decision.desplazar || [], desplazados.map(d => d.personId))) return false;
  const pisar = Array.isArray(decision.pisar) ? decision.pisar : [];
  return pisar.length === pisa.length && pisa.every(p => pisar.some(d =>
    String(d.personId) === String(p.personId) && d.campo === p.campo && IGUAL_CASILLA[p.campo](d.viejo, p.viejo)));
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

// La pregunta cuando se editaria a la persona elegida (#563): las casillas que se
// pisarian, cada una con su valor viejo y el nuevo (el Telefono previo pasa a
// Secundario; un Secundario que no queda en ningun lado se pierde), y en la MISMA
// pregunta los General que dejarian de serlo. Sin casillas que pisar es la pregunta
// del General de #562, con el nombre de la persona.
const ETIQUETA_CASILLA = { cel: 'el Cel', telefono: 'el Tel\u00e9fono', secundario: 'el Tel\u00e9fono Secundario', correo: 'el correo' };
const LLAVE_OPERAM = { cel: 'fax', telefono: 'phone', secundario: 'phone2', correo: 'email' };

function textoPisada(p) {
  if (p.campo === 'telefono') return `${ETIQUETA_CASILLA.telefono} pasa de ${p.viejo} a ${p.nuevo} (${p.viejo} queda en Tel\u00e9fono Secundario)`;
  if (p.campo === 'secundario' && p.pierde) return `${ETIQUETA_CASILLA.secundario} ${p.viejo} se pierde`;
  return `${ETIQUETA_CASILLA[p.campo]} pasa de ${p.viejo} a ${p.nuevo}`;
}

function preguntaEditar({ persona, desplazados, pisa }, donde) {
  if (!pisa.length) return { ...preguntaDesplazar(desplazados, { nombre: persona.nombre }, donde), persona };
  const generales = desplazados.length ? ` ${persona.nombre} queda como contacto General y de Entrega del domicilio de entrega. ${desplazados.map(destinoDelDesplazado).join('. ')}.` : '';
  const pendiente = `persona ${persona.personId}: ${pisa.map(p => `${LLAVE_OPERAM[p.campo]} "${p.viejo}" -> "${p.nuevo}"`).join(', ')}` +
    (desplazados.length ? `; General actual ${desplazados.map(d => `persona ${d.personId}`).join(', ')}` : '');
  return {
    tipo: 'pregunta', motivo: 'pisa-datos', persona, desplazados, pisa,
    mensaje: `Se cambian datos que ${persona.nombre} ya ten\u00eda en Operam: ${pisa.map(textoPisada).join('; ')}.${generales}`,
    detalle: `${donde}: ${pendiente}`,
    pasos: [{
      name: PASO_CONTACTO, status: 'warn',
      mensaje: `El Contacto de entrega todavia no se escribio en Operam: falta que confirmes los cambios a los datos de ${persona.nombre}.`,
      detalle: `${donde}: pendiente de la decision del vendedor (${pendiente})`,
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

// La persona elegida que no esta en el domicilio (#564): su copia en ESTE domicilio,
// si el cotizador ya la habia hecho y sigue ahi, y si no, la persona tal como esta en
// el Cliente Operam (un GET por la API). Sin person_id, o con uno que esta en el
// domicilio, no lee nada. Un fallo al leer la liga o el cliente rechaza antes de
// escribir: sin saber si ya hay copia, crear otra la duplicaria.
async function copiaYOrigen(d, clienteId, domicilioId, contacto, personasDomicilio) {
  const id = contacto.personId;
  if (!id || personasDomicilio.some(p => String(p.personId) === id)) return {};
  const liga = await conFuente('registro de copias del cotizador', () => d.buscarCopia(String(domicilioId), id));
  const copia = liga?.copiaPersonId ? String(liga.copiaPersonId) : null;
  if (copia && personasDomicilio.some(p => String(p.personId) === copia)) return { copia };
  const cliente = await conFuente('API de Operam (cliente)', () => d.obtenerCliente(clienteId));
  const origen = cliente ? contactosDeClienteOperam(cliente).cliente.find(p => p.personId === id) || null : null;
  return { origen };
}

async function conFuente(fuente, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err && typeof err === 'object' && !err.fuente) err.fuente = fuente;
    throw err;
  }
}

export async function escribirContactoEntrega(solicitud, deps = {}) {
  const d = {
    abrirDomicilioWeb: deps.abrirDomicilioWeb || abrirDomicilioWeb,
    ahora: deps.ahora || (() => new Date()),
    obtenerCliente: deps.obtenerCliente || obtenerCliente,
    buscarCopia: deps.buscarCopia || buscarCopia,
    guardarCopia: deps.guardarCopia || guardarCopia,
  };
  const { clienteId, domicilioId } = solicitud;
  const contacto = {
    nombre: texto(solicitud.contacto?.nombre).slice(0, MAX_NOMBRE).trim(),
    telefono: texto(solicitud.contacto?.telefono),
    correo: texto(solicitud.contacto?.correo),
    personId: texto(solicitud.contacto?.personId) || null,
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
  let nombreEscrito = contacto.nombre;
  let desplazando = [];
  try {
    web = await d.abrirDomicilioWeb(clienteId, domicilioId);
    const antes = await web.leer();
    const deCopia = await copiaYOrigen(d, clienteId, domicilioId, contacto, antes);
    const plan = planearContactoEntrega(antes, contacto, solicitud.decision, deCopia);
    if (plan.pregunta?.persona) return preguntaEditar(plan.pregunta, `domicilio ${domicilioId} del cliente ${clienteId}`);
    if (plan.pregunta) return preguntaDesplazar(plan.pregunta.desplazados, contacto, `domicilio ${domicilioId} del cliente ${clienteId}`);
    if (plan.omitido) {
      return omitida(plan.omitido.motivo, plan.omitido.mensaje, `domicilio ${domicilioId} del cliente ${clienteId}: ${plan.omitido.detalle}`);
    }
    enviado = true;
    const donde = `domicilio ${domicilioId} del cliente ${clienteId}`;
    if (plan.editar) {
      // #563: la persona elegida se edita PRIMERO y despues se desplaza a los demas
      // General, igual que al crear: si la relectura no la encuentra, nadie pierde el rol.
      const persona = plan.editar.persona;
      nombreEscrito = persona.nombreCompleto;
      await web.editar(persona.personId, { roles: plan.editar.roles, casillas: plan.editar.cambios });
      const leida = (await web.leer()).find(p => p.personId === persona.personId) || null;
      const noAplicados = noAplicadosAlEditar(plan.editar, leida);
      let desplazados = [];
      if (leida && plan.desplazados.length) {
        creada = leida;
        desplazando = plan.desplazados;
        const r = await desplazarGenerales(web, plan.desplazados, leida, lineaDeReemplazo(d.ahora(), persona.nombreCompleto, solicitud.cotizacion));
        desplazados = r.escritos;
        noAplicados.push(...r.noAplicados);
      }
      return {
        tipo: 'lograda', escrito: true, personId: persona.personId, ...(plan.copiaDe ? { copiaDe: plan.copiaDe } : {}),
        ...(plan.desplazados.length ? { desplazados } : {}),
        noAplicados, cambios: cambiosConfirmados(plan.editar.pisa, noAplicados),
        pasos: [pasoEditada(plan.editar, noAplicados, donde, desplazados)],
      };
    }
    nombreEscrito = nombreCompletoDe(plan.crear);
    await web.crear(plan.crear);
    const trasCrear = await web.leer();
    const previos = new Set(antes.map(p => p.personId));
    const nueva = trasCrear.find(p => !previos.has(p.personId)) || null;
    const noAplicados = noAplicadosAlCrear(plan.crear, nueva);
    // La liga copia -> origen solo con la copia releida: sin su person_id no hay que ligar.
    let ligaFallida = null;
    if (nueva && plan.copiaDe) {
      try {
        await d.guardarCopia({ clienteId: String(clienteId), domicilioId: String(domicilioId), origenPersonId: plan.copiaDe, copiaPersonId: nueva.personId });
      } catch (err) {
        ligaFallida = err;
      }
    }
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
    const quedaron = textoQuedaron(desplazados);
    const nombre = nombreEscrito;
    const comoCopia = plan.copiaDe ? ` como copia de la persona ${plan.copiaDe} del Cliente Operam` : '';
    let paso = noAplicados.length
      ? {
        name: PASO_CONTACTO, status: 'warn',
        mensaje: nueva
          ? `${nombre} quedo en Operam en el domicilio de entrega, pero revisa su contacto: ${noAplicados.map(n => n.etiqueta).join(', ')} no quedo como se capturo.`
          : `Revisa el contacto del domicilio de entrega en Operam: no se pudo confirmar que ${nombre} quedo registrado.`,
        detalle: `${donde}: ${nueva ? `persona ${nueva.personId}${comoCopia}` : 'ninguna persona nueva en la relectura'}; ` +
          noAplicados.map(n => `${n.campo} se esperaba "${n.esperado}" y se leyo "${n.encontrado}"`).join('; '),
      }
      : {
        name: PASO_CONTACTO, status: 'ok',
        mensaje: `${nombre} quedo en Operam como contacto General y de Entrega del domicilio de entrega${plan.copiaDe ? ' (su contacto del Cliente Operam no cambia)' : ''}${quedaron ? `; ${quedaron}` : ''}.`,
        detalle: `${donde}: persona ${nueva.personId} creada${comoCopia} con roles ${ROLES_CONTACTO_ENTREGA.join(', ')}; ` +
          (plan.copiaDe
            ? `Cel ${plan.crear.casillas.cel || '(vacio)'}, Telefono ${plan.crear.casillas.telefono || '(vacio)'}, Secundario ${plan.crear.casillas.secundario || '(vacio)'}, correo ${plan.crear.casillas.correo || '(vacio)'}`
            : `Cel y Telefono ${contacto.telefono || '(vacio)'}; correo ${contacto.correo || '(vacio)'}`) +
          desplazados.map(x => `; persona ${x.personId} sin General, roles ${x.roles.join(', ')}, nota agregada`).join(''),
      };
    // La copia quedo en Operam pero el cotizador no guardo de quien es: la siguiente
    // cotizacion la reconoce por su nombre o su numero (no se duplica), pero no como la
    // persona elegida. Es un aviso, no un bloqueo (regla 3).
    if (ligaFallida) {
      paso = {
        ...paso, status: 'warn',
        mensaje: `${paso.mensaje} El cotizador no pudo anotar que es la copia de su contacto del Cliente Operam.`,
        detalle: `${paso.detalle}; liga copia ${nueva.personId} -> origen ${plan.copiaDe} no guardada: ${ligaFallida?.message}`,
      };
    }
    return {
      tipo: 'lograda', escrito: true, personId: nueva?.personId ?? null, ...(plan.copiaDe ? { copiaDe: plan.copiaDe } : {}),
      ...(plan.desplazados.length ? { desplazados } : {}), noAplicados, pasos: [paso],
    };
  } catch (err) {
    // Antes de mandar la escritura no se escribio nada; despues ya no se sabe (la
    // escritura pudo quedar y lo que fallo fue su respuesta o la relectura), y decir
    // "no se escribio" llevaria al vendedor a crearla a mano otra vez.
    // Ya creada la persona nueva, la falla fue al desplazar: el domicilio puede haber
    // quedado con dos General, y eso es lo que el vendedor tiene que ir a revisar.
    const mensaje = creada
      ? `${nombreEscrito} quedo como contacto General del domicilio de entrega en Operam, pero no se pudo confirmar que ${desplazando.map(x => x.nombre).join(' y ')} dejo de serlo: revisa el domicilio en Operam, puede tener dos contactos General.`
      : enviado
        ? 'No se pudo confirmar que el Contacto de entrega quedo escrito en el domicilio de entrega en Operam: revisalo ahi.'
        : 'No se pudo escribir el Contacto de entrega en el domicilio de entrega en Operam.';
    const tras = creada ? ` (tras crear la persona ${creada.personId}, al desplazar ${desplazando.map(x => `persona ${x.personId}`).join(', ')})` : enviado ? ' (tras mandar la escritura)' : '';
    const detalle = `domicilio ${domicilioId} del cliente ${clienteId}, ${err?.fuente || 'web legacy'}${tras}: ${err?.message}`;
    return { tipo: 'bloqueo', motivo: 'operam', mensaje, detalle, pasos: [{ name: PASO_CONTACTO, status: enviado ? 'warn' : 'error', mensaje, detalle }] };
  } finally {
    if (web) await web.cerrar();
  }
}
