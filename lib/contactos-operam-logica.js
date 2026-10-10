// Nucleo PURO del modulo Contactos en Operam (#559/#560, ADR-0024): traduce lo que
// Operam devuelve a personas, sin IO. La puerta con IO es lib/contactos-operam.js
// (`leerContactos`, `escribirContactoEntrega`, `contactoEntregaDelAlta`); este
// archivo es su mitad pura, aparte para que los nucleos puros que ya traen al Cliente
// Operam en la mano (dedup, cruce por identidad, Cel del alta) lo lean sin cargar el
// cliente de Operam ni la cache de contact_list -- operam-client.js importa a algunos
// de ellos, y por eso aqui solo entran imports PUROS (la llave del telefono y el
// vocabulario del Contacto de entrega), nunca operam-client.js ni un store.
//
// Desde la revision de #557 tambien vive aqui la PLANEACION de la escritura del
// Contacto de entrega (que escribir, que preguntar, que se omite y como se compara la
// relectura): la mitad con IO solo abre la web legacy, lee, escribe y relee.
//
// Una persona se identifica por su `person_id` (editarla no lo cambia; el id del
// renglon de rol si, y no sirve de llave). Operam la repite una vez por rol, asi que
// aqui se junta: una persona, sus roles en ESE nivel (cliente o domicilio) y sus
// cuatro casillas -- Cel (`fax` en la API), Telefono principal (`phone`),
// Secundario (`phone2`) y correo --. El modulo devuelve las casillas tal cual: que
// numero se propone para una persona lo decide quien la usa (el selector del paso
// Envio, `telefonoDePersona` en public/js/contacto-entrega-logica.js, ADR-0016).
//
// De donde sale cada nivel (medido en ADR-0024):
//   - Cliente Operam: `contacts[]` de `GET /customers/:id` (y del listado paginado
//     y el de `?tax_id=`, que traen el mismo objeto inline), una fila por rol con
//     `id` = person_id, `name2` (apellido) y `notes`.
//   - Domicilio de entrega: SOLO `contact_list` (padron cacheado en
//     lib/contactos-domicilio-io.js), con el id del renglon aparte de `person_id`,
//     `last_name` (el mismo dato que `name2`) y sin `notes` (`notas: null` = no se
//     sabe, no "vacias"). Los renglones con `person_id` 0 son los General vacios que
//     deja cada `PUT /branches`: no son personas.
//   - El General APLANADO de cada domicilio: `branches[]` del Cliente Operam trae
//     copiados nombre (`contact_name`), Telefono, Cel (`fax`) y correo del General del
//     domicilio, sin `person_id` (#560: lo leian por su cuenta el indice de
//     telefonos, la dedup, el cruce por identidad y la ruta de domicilios).
// Una misma persona puede estar en los dos niveles (la que crea `POST /customers` es
// General del cliente y de su domicilio): sale en ambos con el mismo personId.

import { ultimos10 } from './telefono-llave.js';
import { PASO_CONTACTO_ENTREGA, telefonoDePersona } from '../public/js/contacto-entrega-logica.js';
import { textoCambioDeNumero } from '../public/js/cambio-numero-logica.js';

const texto = v => String(v ?? '').trim();
const esPersonId = v => /^[1-9]\d*$/.test(texto(v));

// Renglones ya traducidos -> una persona por personId, en el orden en que aparecio
// su primer renglon y con sus roles en el orden de sus renglones.
function juntarPorPersona(renglones) {
  const personas = new Map();
  for (const r of renglones) {
    if (!esPersonId(r.personId)) continue;
    const id = texto(r.personId);
    if (!personas.has(id)) {
      personas.set(id, {
        personId: id,
        nombre: r.nombre,
        apellido: r.apellido,
        referencia: r.referencia,
        roles: [],
        casillas: r.casillas,
        notas: r.notas,
      });
    }
    const rol = texto(r.rol);
    const persona = personas.get(id);
    if (rol && !persona.roles.includes(rol)) persona.roles.push(rol);
  }
  return [...personas.values()];
}

const casillasDe = f => ({ cel: texto(f.fax), telefono: texto(f.phone), secundario: texto(f.phone2), correo: texto(f.email) });

function renglonDeCliente(ct) {
  return {
    personId: ct.id, rol: ct.action, nombre: texto(ct.name), apellido: texto(ct.name2),
    referencia: texto(ct.ref), casillas: casillasDe(ct), notas: texto(ct.notes),
  };
}

function renglonDeDomicilio(f) {
  return {
    personId: f.person_id, rol: f.action, nombre: texto(f.name), apellido: texto(f.last_name),
    referencia: texto(f.ref), casillas: casillasDe(f), notas: null,
  };
}

// El General aplanado de un domicilio (`branches[]`): no es una persona -- no trae
// person_id ni rol -- sino la copia que Operam guarda en el domicilio. El domicilio
// no tiene Telefono Secundario.
function generalAplanado(b) {
  return {
    branchCode: texto(b?.branch_code),
    domicilio: { nombre: texto(b?.br_name), referencia: texto(b?.branch_ref) },
    nombre: texto(b?.contact_name),
    casillas: { ...casillasDe(b || {}), secundario: '' },
  };
}

// El Cliente Operam tal como lo devuelve `GET /customers/:id` (o el listado) y los
// renglones de `contact_list` de sus domicilios (`null`, o sin pasarlos = el padron no
// se conoce). Devuelve `{ cliente, domicilios, generales }`: `domicilios` es `null`
// sin padron y, con padron, un objeto branch_code -> personas para CADA domicilio del
// Cliente Operam (la lista vacia = ese domicilio no tiene personas); `generales` es el
// General aplanado de cada domicilio, en el orden de `branches[]`.
export function contactosDeClienteOperam(cliente, filasDomicilios = null) {
  const branches = (cliente?.branches || []).filter(Boolean);
  const codigos = branches.map(b => texto(b.branch_code)).filter(Boolean);
  const personasCliente = juntarPorPersona((cliente?.contacts || []).filter(Boolean).map(renglonDeCliente));
  const generales = branches.map(generalAplanado);
  if (!Array.isArray(filasDomicilios)) return { cliente: personasCliente, domicilios: null, generales };
  const domicilios = {};
  for (const codigo of codigos) {
    const filas = filasDomicilios.filter(f => f?.type === 'cust_branch' && texto(f.entity_id) === codigo);
    domicilios[codigo] = juntarPorPersona(filas.map(renglonDeDomicilio));
  }
  return { cliente: personasCliente, domicilios, generales };
}

// maxlength del nombre y de la Referencia en el formulario de contactos (medido): se
// manda lo que mandaria el navegador.
export const MAX_NOMBRE = 40;
export const ROLES_CONTACTO_ENTREGA = ['general', 'delivery'];

const normalizarPersona = v => texto(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');

// Sin el person_id de la persona elegida (cotizaciones anteriores a #563, "+ Nuevo
// contacto" o una persona que no esta en el domicilio) la UNICA identidad de una
// persona del domicilio es su numero: el mismo `ultimos10` (lib/telefono-llave.js) en
// cualquiera de sus tres casillas. El nombre no identifica (revision de #557): dos
// personas pueden llamarse igual, y un homonimo con otro numero es otra persona.
function tieneElNumero(persona, contacto) {
  const numero = ultimos10(contacto.telefono);
  const casillas = persona.casillas || {};
  return numero.length === 10 && [casillas.cel, casillas.telefono, casillas.secundario].some(n => ultimos10(n) === numero);
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

export function nombreCompletoDe(c) {
  return [texto(c.nombre), texto(c.apellido)].filter(Boolean).join(' ');
}

export function noAplicadosAlCrear(creada, leida) {
  if (!leida) return [{ campo: 'persona', etiqueta: 'la persona', esperado: nombreCompletoDe(creada), encontrado: '' }];
  return COMPARACIONES_AL_CREAR
    .filter(k => !k.igual(texto(k.esperado(creada)), texto(k.leido(leida)), creada, leida))
    .map(k => ({ campo: k.campo, etiqueta: k.etiqueta, esperado: texto(k.esperado(creada)), encontrado: texto(k.leido(leida)) }));
}

// La relectura de la persona editada (#563): sus cuatro casillas como se mandaron y
// General y Entrega entre sus roles. El nombre no se manda y no se compara.
export function noAplicadosAlEditar(editar, leida) {
  if (!leida) return [{ campo: 'persona', etiqueta: 'la persona', esperado: editar.persona.nombreCompleto, encontrado: '' }];
  const fuera = Object.keys(ETIQUETA_CASILLA)
    .filter(campo => !IGUAL_CASILLA[campo](editar.casillas[campo], leida.casillas?.[campo]))
    .map(campo => ({ campo, etiqueta: ETIQUETA_CASILLA[campo], esperado: texto(editar.casillas[campo]), encontrado: texto(leida.casillas?.[campo]) }));
  if (!ROLES_CONTACTO_ENTREGA.every(r => leida.roles.includes(r))) {
    fuera.push({ campo: 'roles', etiqueta: 'los roles General y Entrega', esperado: editar.roles.join(', '), encontrado: leida.roles.join(', ') });
  }
  return fuera;
}

// #565 (revision de #557): el NUMERO DE IDENTIDAD de la persona -- el que el cotizador
// le propone, Cel > Telefono > Secundario (`telefonoDePersona`) -- antes de editarla y
// despues segun la RELECTURA. Si cambio (por `ultimos10`), la Subida del quote funde el
// Contacto del numero viejo en el del nuevo (enmienda a ADR-0016): `{ personId, viejo,
// nuevo }`, o null. Sin relectura de la persona, o sin numero antes (no habia Contacto
// que fundir), no hay cambio. No es la casilla Cel: llenar un Cel vacio cambia el numero
// de identidad si antes era el Telefono.
export function cambioDeNumero(antes, leida) {
  if (!leida) return null;
  const viejo = telefonoDePersona(antes.casillas);
  const nuevo = telefonoDePersona(leida.casillas);
  if (!viejo || !nuevo || ultimos10(viejo) === ultimos10(nuevo)) return null;
  return { personId: antes.personId, viejo, nuevo };
}

// Lo que le quedo a cada desplazado, para el paso del vendedor.
export const textoQuedaron = desplazados => desplazados.map(x => `${x.nombre} dejo de ser General y ${x.roles.includes('delivery') && x.roles.length === 1 ? 'quedo como contacto de Entrega' : 'conserva sus otros roles'}`).join('; ');

export function pasoEditada(editar, noAplicados, donde, desplazados = []) {
  const nombre = editar.persona.nombreCompleto;
  if (noAplicados.length) {
    return {
      name: PASO_CONTACTO_ENTREGA, status: 'warn',
      mensaje: `${nombre} sigue en Operam en el domicilio de entrega, pero revisa su contacto: ${noAplicados.map(n => n.etiqueta).join(', ')} no quedo como se capturo.`,
      detalle: `${donde}: persona ${editar.persona.personId} editada; ` +
        noAplicados.map(n => `${n.campo} se esperaba "${n.esperado}" y se leyo "${n.encontrado}"`).join('; '),
    };
  }
  const c = editar.casillas;
  const quedaron = textoQuedaron(desplazados);
  return {
    name: PASO_CONTACTO_ENTREGA, status: 'ok',
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
export function planearContactoEntrega(personasDomicilio, contacto, decision, { copia = null, origen = null } = {}) {
  // #563: el vendedor eligio a una persona en el selector y la cotizacion trae su
  // person_id. Si esta en el domicilio, ESA es la persona y se edita. Si no esta y el
  // cotizador ya la copio a este domicilio (#564), la copia es la persona elegida.
  const elegida = contacto.personId ? personasDomicilio.find(p => String(p.personId) === contacto.personId) : null;
  if (elegida) return planearEdicion(personasDomicilio, elegida, contacto, decision);
  const suCopia = copia ? personasDomicilio.find(p => String(p.personId) === String(copia)) : null;
  if (suCopia) return { ...planearEdicion(personasDomicilio, suCopia, contacto, decision), copiaDe: contacto.personId };
  // Sin persona elegida en el domicilio, la que tiene el numero capturado ES el
  // Contacto de entrega y se edita igual que la elegida (#563): llena lo vacio, pregunta
  // si pisa y queda como unico General. Sin coincidencia por numero se crea.
  const misma = personasDomicilio.find(p => tieneElNumero(p, contacto));
  if (misma) return planearEdicion(personasDomicilio, misma, contacto, decision);
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
  // D4 (decisiones de Adrian 2026-10-09): si la edicion cambia el numero de identidad de
  // la persona (el mismo juicio que la relectura, `cambioDeNumero`, sobre lo que se va a
  // escribir), en el cotizador todo lo del numero viejo pasa al nuevo: eso SIEMPRE se
  // pregunta, aunque no se pise ninguna casilla (quien solo tenia Secundario).
  const numero = cambioDeNumero(elegida, { casillas });
  if (!cambia && !desplazados.length) {
    return {
      omitido: {
        motivo: 'sin-cambios',
        mensaje: `${elegida.nombreCompleto} ya estaba en Operam como contacto General y de Entrega del domicilio de entrega, con estos datos.`,
        detalle: `persona ${elegida.personId}: casillas y roles ya coinciden; no se escribe`,
      },
    };
  }
  if ((desplazados.length || pisa.length || numero) && !confirmada(decision, desplazados, pisa, numero)) {
    const conNumero = numero ? { cambioDeNumero: numero, quedaEnSecundario: igualNumero(casillas.secundario, numero.viejo) } : {};
    return { pregunta: { persona: { personId: elegida.personId, nombre: elegida.nombreCompleto }, desplazados, pisa, ...conNumero } };
  }
  // Al formulario solo viajan las casillas que cambian: las demas se repostean como
  // las trae Operam, sin pasar por la lectura de la tabla.
  const cambios = Object.fromEntries(Object.keys(casillas).filter(k => casillas[k] !== texto(antes[k])).map(k => [k, casillas[k]]));
  return { editar: { persona: elegida, casillas, cambios, roles, pisa }, desplazados };
}

// Cada casilla con su igualdad: los numeros por sus ultimos 10 digitos (la web los
// guarda como texto libre) y el correo sin mayusculas.
const igualNumero = (a, b) => ultimos10(a) === ultimos10(b) && (!!texto(a) === !!texto(b));
const IGUAL_CASILLA = {
  cel: igualNumero,
  telefono: igualNumero,
  secundario: igualNumero,
  correo: (a, b) => texto(a).toLowerCase() === texto(b).toLowerCase(),
};

// La decision vale para lo que se pregunto (patron de #368): los mismos General a
// desplazar y las mismas casillas a pisar CON el valor viejo que se le mostro al
// vendedor y, con cambio de numero (D4), ese mismo numero viejo. Si algo cambio en
// Operam entre la pregunta y la respuesta, se vuelve a preguntar.
function confirmada(decision, desplazados, pisa, numero = null) {
  if (!decision) return false;
  if (!mismasPersonas(decision.desplazar || [], desplazados.map(d => d.personId))) return false;
  if (numero && !(decision.numero && igualNumero(decision.numero.viejo, numero.viejo))) return false;
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
// D1 (decisiones de Adrian 2026-10-09): no hay "no"; la salida para quien no quiere
// desplazar al General es elegir al General como Contacto de entrega (ADR-0024 regla 2).
function salidaSinDesplazar(desplazados) {
  const nombres = desplazados.map(d => d.nombre).join(' y ');
  return `Si no quieres que ${nombres} ${desplazados.length > 1 ? 'dejen' : 'deje'} de ser el contacto General, elige a ${nombres} como Contacto de entrega en el paso Env\u00edo.`;
}

export function preguntaDesplazar(desplazados, contacto, donde) {
  const destinos = desplazados.map(destinoDelDesplazado).join('. ');
  return {
    tipo: 'pregunta', motivo: 'general-existente', desplazados,
    mensaje: `${contacto.nombre} queda como contacto General y de Entrega del domicilio de entrega en Operam. ${destinos}. ${salidaSinDesplazar(desplazados)}`,
    detalle: `${donde}: General actual ${desplazados.map(d => `persona ${d.personId}`).join(', ')}; un segundo General no se escribe`,
    pasos: [{
      name: PASO_CONTACTO_ENTREGA, status: 'warn',
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

// D4: con cambio del numero de identidad (`cambioDeNumero`) la pregunta empieza por el
// cambio de celular con las palabras de la decision ("El celular de X cambia de A a B.")
// y sigue con lo demas que cambia en Operam. `partes` = `{ numero, resto }`: la Subida
// del quote mete entre las dos lo que pasa en el cotizador (cuantas oportunidades y
// cotizaciones se mueven), que este modulo no lee.
export function preguntaEditar({ persona, desplazados, pisa, cambioDeNumero: numero = null, quedaEnSecundario = false }, donde) {
  if (!pisa.length && !numero) return { ...preguntaDesplazar(desplazados, { nombre: persona.nombre }, donde), persona };
  const generales = desplazados.length ? `${persona.nombre} queda como contacto General y de Entrega del domicilio de entrega. ${desplazados.map(destinoDelDesplazado).join('. ')}. ${salidaSinDesplazar(desplazados)}` : '';
  const pendiente = [
    ...(pisa.length ? [`persona ${persona.personId}: ${pisa.map(p => `${LLAVE_OPERAM[p.campo]} "${p.viejo}" -> "${p.nuevo}"`).join(', ')}`] : []),
    ...(numero ? [`numero de identidad de la persona ${persona.personId} "${numero.viejo}" -> "${numero.nuevo}"`] : []),
    ...(desplazados.length ? [`General actual ${desplazados.map(d => `persona ${d.personId}`).join(', ')}`] : []),
  ].join('; ');
  let partes;
  if (numero) {
    // Las casillas que solo llevan el numero nuevo ya las dice la primera oracion.
    const otras = pisa.filter(p => p.campo !== 'cel' && !(p.campo === 'telefono' && igualNumero(p.viejo, numero.viejo)));
    const resto = [
      ...(quedaEnSecundario ? [`En Operam, el ${numero.viejo} queda como su Tel\u00e9fono Secundario.`] : []),
      ...(otras.length ? [`Adem\u00e1s, en Operam: ${otras.map(textoPisada).join('; ')}.`] : []),
      ...(generales ? [generales] : []),
    ].join(' ');
    partes = { numero: textoCambioDeNumero(persona.nombre, numero.viejo, numero.nuevo), resto };
  } else {
    partes = { numero: '', resto: [`Se cambian datos que ${persona.nombre} ya ten\u00eda en Operam: ${pisa.map(textoPisada).join('; ')}.`, ...(generales ? [generales] : [])].join(' ') };
  }
  return {
    tipo: 'pregunta', motivo: 'pisa-datos', persona, desplazados, pisa, ...(numero ? { cambioDeNumero: numero } : {}),
    partes, mensaje: [partes.numero, partes.resto].filter(Boolean).join(' '),
    detalle: `${donde}: ${pendiente}`,
    pasos: [{
      name: PASO_CONTACTO_ENTREGA, status: 'warn',
      mensaje: numero
        ? `El Contacto de entrega todavia no se escribio en Operam: falta que confirmes el cambio de celular de ${persona.nombre}.`
        : `El Contacto de entrega todavia no se escribio en Operam: falta que confirmes los cambios a los datos de ${persona.nombre}.`,
      detalle: `${donde}: pendiente de la decision del vendedor (${pendiente})`,
    }],
  };
}

// Nada que escribir, con su motivo: la operacion termina sin tocar Operam.
export function omitida(motivo, mensaje, detalle) {
  return { tipo: 'lograda', escrito: false, motivo, pasos: [{ name: PASO_CONTACTO_ENTREGA, status: 'omitido', mensaje, detalle }] };
}

// La linea que se AGREGA a las Notas del desplazado (ADR-0024 regla 4): cuando, quien lo
// reemplazo y desde que cotizacion. La fecha es la de la fabrica (Ciudad de Mexico),
// no la de UTC: a las 21:00 del 9 de octubre la nota dice 9 de octubre.
const FECHA_FABRICA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' });

export function lineaDeReemplazo(ahora, nombre, cotizacion) {
  const cual = texto(cotizacion?.folio)
    ? `la Cotizaci\u00f3n ${texto(cotizacion.folio)}`
    : `la cotizaci\u00f3n ${texto(cotizacion?.id)} del cotizador`;
  return `${FECHA_FABRICA.format(ahora)}: deja de ser el contacto General de este domicilio; lo reemplaza ${nombre} desde ${cual}.`;
}

export const conLinea = (previas, linea) => (texto(previas) ? `${String(previas).replace(/\s+$/, '')}\n${linea}` : linea);

// El desplazado pierde el General; si era su unico rol, queda de Entrega.
export function rolesDelDesplazado(roles) {
  const otros = (roles || []).filter(r => r !== 'general');
  return otros.length ? otros : ['delivery'];
}

export const mismosRoles = (a, b) => a.length === b.length && a.every(r => b.includes(r));

const COMPARACIONES_DEL_ALTA = [
  { campo: 'nombre', etiqueta: 'el nombre', esperado: c => c.nombre, leido: p => p.nombreCompleto, igual: (a, b) => normalizarPersona(a) === normalizarPersona(b) },
  ...Object.keys(ETIQUETA_CASILLA).map(campo => ({
    campo, etiqueta: ETIQUETA_CASILLA[campo], esperado: c => c.casillas?.[campo], leido: p => p.casillas?.[campo], igual: IGUAL_CASILLA[campo],
  })),
];

export function planearPersonaDelAlta(persona, contacto) {
  const antes = persona.casillas || {};
  const casillas = {};
  const poner = (campo, nuevo) => {
    if (nuevo && !IGUAL_CASILLA[campo](antes[campo], nuevo)) casillas[campo] = nuevo;
  };
  poner('cel', contacto.telefono);
  poner('telefono', contacto.telefono);
  poner('correo', contacto.correo);
  const roles = [...persona.roles, ...ROLES_CONTACTO_ENTREGA.filter(r => !persona.roles.includes(r))];
  const renombrar = !!contacto.nombre && normalizarPersona(contacto.nombre) !== normalizarPersona(persona.nombreCompleto);
  const cambios = {
    ...(renombrar ? { nombre: contacto.nombre, apellido: '' } : {}),
    ...(Object.keys(casillas).length ? { casillas } : {}),
    ...(roles.length !== persona.roles.length ? { roles } : {}),
  };
  return Object.keys(cambios).length ? cambios : null;
}

export function noAplicadosDelAlta(cambios, leida) {
  const fuera = COMPARACIONES_DEL_ALTA
    .filter(k => texto(k.esperado(cambios)) && !k.igual(texto(k.esperado(cambios)), texto(k.leido(leida))))
    .map(k => ({ campo: k.campo, etiqueta: k.etiqueta, esperado: texto(k.esperado(cambios)), encontrado: texto(k.leido(leida)) }));
  if (!ROLES_CONTACTO_ENTREGA.every(r => leida.roles.includes(r))) {
    fuera.push({ campo: 'roles', etiqueta: 'los roles General y Entrega', esperado: ROLES_CONTACTO_ENTREGA.join(', '), encontrado: leida.roles.join(', ') });
  }
  return fuera;
}

// --- Lo que los consumidores del modulo traducen (revision de #557) -------------

// La respuesta del vendedor a la pregunta del Contacto de entrega (#562, #563), como la
// dicta el servidor en `reintentar`: `{ desplazar: [personId...] }` (que deje de ser
// General) y `pisar`, las casillas de la persona elegida con el valor viejo que vio el
// vendedor (`[{ personId, campo, viejo }]`), para que el modulo revalide contra lo que
// hay ahora en Operam. Cualquier otra cosa no es una decision: null. D1 (decisiones de
// Adrian 2026-10-09): la pregunta solo se resuelve CONFIRMANDO; la salida "conservar"
// que tuvo #562 se quito, y el `{ conservar: true }` de una pestana con el app.js
// anterior es null: la marca se queda y la pregunta vuelve.
const CASILLAS_PISABLES = ['cel', 'telefono', 'secundario', 'correo'];
const esId = (v) => (typeof v === 'string' || typeof v === 'number') && String(v).trim() !== '';

export function decisionContactoEntrega(cuerpo) {
  const ids = cuerpo?.desplazar ?? [];
  const pisar = cuerpo?.pisar ?? [];
  // D4: `numero: { viejo, mover }` confirma el cambio del numero de identidad; `mover`
  // dice si lo del numero viejo pasa al nuevo en el cotizador (false = telefono
  // compartido: solo se actualiza Operam). Lo lee la Subida del quote, no este modulo.
  const numero = cuerpo?.numero;
  const conNumero = numero !== undefined && numero !== null;
  if (conNumero && !(typeof numero.viejo === 'string' && typeof numero.mover === 'boolean')) return null;
  if (!Array.isArray(ids) || !Array.isArray(pisar) || !(ids.length + pisar.length + (conNumero ? 1 : 0))) return null;
  if (!ids.every(esId)) return null;
  if (!pisar.every((p) => esId(p?.personId) && CASILLAS_PISABLES.includes(p.campo) && typeof p.viejo === 'string')) return null;
  return {
    desplazar: ids.map(String),
    ...(pisar.length ? { pisar: pisar.map((p) => ({ personId: String(p.personId), campo: p.campo, viejo: p.viejo })) } : {}),
    ...(conNumero ? { numero: { viejo: numero.viejo, mover: numero.mover } } : {}),
  };
}

// La persona que crea `POST /customers` en el Cliente Operam recien dado de alta (#566):
// la UNICA General de sus personas (`cliente` = el Cliente Operam releido). Devuelve
// `{ personId }` o, con cero o varias General, `{ personId: null, paso }` con el aviso
// en dos capas: no se le escribe a ninguna.
export function personaDelAlta(cliente, clienteId) {
  const generales = contactosDeClienteOperam(cliente || {}).cliente.filter(p => p.roles.includes('general'));
  if (generales.length === 1) return { personId: generales[0].personId };
  return {
    personId: null,
    paso: {
      name: PASO_CONTACTO_ENTREGA, status: 'warn',
      mensaje: 'No se pudo identificar el contacto que creo Operam con el Cliente Operam: revisa sus contactos en Operam y deja ahi al Contacto de entrega.',
      detalle: `GET /customers/${clienteId}: ${generales.length} personas General (${generales.map(p => p.personId).join(', ') || 'ninguna'}); no se escribe a ninguna`,
    },
  };
}

// D6 (decisiones de Adrian 2026-10-09): el interruptor de la escritura de Contactos en
// Operam, la variable de entorno CONTACTOS_OPERAM_ESCRITURA. Vale `apagado`, una lista
// de ids de Cliente Operam separados por coma (`15`) o `todos`; AUSENTE (o vacia) es
// `apagado`. Falla cerrado: una palabra que no es `todos` ni un id cuenta como
// apagado, y los ids que no son numeros se ignoran (y el aviso de /admin lo dice).
// `todos` y `apagado` no distinguen mayusculas. Puro: quien lo usa le pasa el valor.
export const VARIABLE_INTERRUPTOR_ESCRITURA = 'CONTACTOS_OPERAM_ESCRITURA';

const idDeCliente = v => {
  const t = String(v ?? '').trim();
  return /^\d+$/.test(t) ? String(Number(t)) : null;
};

export function interpretarInterruptorEscritura(valor) {
  const crudo = String(valor ?? '').trim();
  const v = crudo.toLowerCase();
  if (v === 'todos') return { valor: crudo, modo: 'todos', clientes: [], ignorados: [] };
  if (v === '' || v === 'apagado') return { valor: crudo, modo: 'apagado', clientes: [], ignorados: [] };
  const clientes = [];
  const ignorados = [];
  for (const parte of crudo.split(',').map(p => p.trim()).filter(Boolean)) {
    const id = idDeCliente(parte);
    if (id === null) ignorados.push(parte);
    else if (!clientes.includes(id)) clientes.push(id);
  }
  return { valor: crudo, modo: clientes.length ? 'lista' : 'apagado', clientes, ignorados };
}

export function escrituraContactosPermitida(valor, clienteId) {
  const i = interpretarInterruptorEscritura(valor);
  if (i.modo === 'todos') return true;
  const id = idDeCliente(clienteId);
  return i.modo === 'lista' && id !== null && i.clientes.includes(id);
}

const enumerar = xs => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}` : xs[0] || '');

// El aviso del panel /admin mientras la escritura no este en `todos` (null con
// `todos`): que hace hoy el cotizador con los Contactos en Operam y el valor tal cual.
export function avisoInterruptorEscritura(valor) {
  const i = interpretarInterruptorEscritura(valor);
  if (i.modo === 'todos') return null;
  const variable = VARIABLE_INTERRUPTOR_ESCRITURA;
  const valorHoy = i.valor ? `${variable} = ${i.valor}` : `${variable} no tiene valor`;
  const ignorados = i.ignorados.length
    ? ` Se ignora ${enumerar(i.ignorados)}: no es un n\u00famero de Cliente Operam.`
    : '';
  const encender = `Para que escriba en todos, pon ${variable} = todos en Render.`;
  if (i.modo === 'lista') {
    const quienes = i.clientes.length > 1 ? `los Clientes Operam ${enumerar(i.clientes)}` : `el Cliente Operam ${i.clientes[0]}`;
    return `El cotizador solo escribe Contactos de entrega en Operam para ${quienes}; en los dem\u00e1s no los toca ni pregunta por ellos (${valorHoy}).${ignorados} ${encender}`;
  }
  return `El cotizador no escribe Contactos de entrega en Operam: la escritura est\u00e1 apagada (${valorHoy}).${ignorados} ${encender}`;
}
