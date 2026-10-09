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
import {
  contactosDeClienteOperam, MAX_NOMBRE, ROLES_CONTACTO_ENTREGA, nombreCompletoDe, noAplicadosAlCrear,
  noAplicadosAlEditar, cambioDeNumero, textoQuedaron, pasoEditada, planearContactoEntrega, preguntaDesplazar,
  preguntaEditar, omitida, lineaDeReemplazo, conLinea, rolesDelDesplazado, mismosRoles, planearPersonaDelAlta,
  noAplicadosDelAlta,
} from './contactos-operam-logica.js';
import { abrirDomicilioWeb } from './contactos-operam-web.js';
import { buscar as buscarCopia, guardar as guardarCopia } from './copias-contacto-store.js';
import { PASO_CONTACTO_ENTREGA } from '../public/js/contacto-entrega-logica.js';
import { esDebtorGenerico } from './deduplicacion.js';

const texto = v => String(v ?? '').trim();
// La lograda de una edicion lleva `cambioDeNumero` solo cuando lo hubo (#565).
const conCambio = c => (c ? { cambioDeNumero: c } : {});

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
// esta en el domicilio) la unica identidad es el numero (`ultimos10`): la persona del
// domicilio que ya lo tiene en alguna casilla se edita igual que la elegida, y sin
// coincidencia por numero se crea una persona nueva. El nombre no identifica (revision
// de #557): un homonimo con otro numero es otra persona.
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
// reapunta. Una persona del domicilio que ya tiene el numero capturado gana a la copia:
// es ella y se edita.
//
// Valores (Mensaje en dos capas en cada paso, `name: 'contacto de entrega'`):
//   { tipo: 'lograda', escrito: true, personId, copiaDe?, desplazados?, noAplicados, cambioDeNumero?, pasos }
//       la persona quedo creada, o editada (#563), y los desplazados, `{ personId,
//       nombre, roles }` con los roles que se les dejaron; `copiaDe` = el person_id de
//       origen cuando la persona es la copia de una del Cliente Operam (#564);
//       `noAplicados` = lo que la
//       relectura no confirma ({ campo, etiqueta, esperado, encontrado }: casillas y
//       roles de la persona, roles y nota de cada desplazado, un solo General) y
//       entonces el paso es `warn`. Solo la edicion (#565) puede traer
//       `cambioDeNumero`: `{ personId, viejo, nuevo }` cuando el numero de identidad de
//       la persona (Cel > Telefono > Secundario, `telefonoDePersona`) cambio segun la
//       relectura; no viene si no cambio o si antes no tenia numero.
//   { tipo: 'lograda', escrito: false, motivo, pasos }   (paso `omitido`)
//       motivo: 'cliente-generico' (DEBTORS_GENERICOS: ni se abre la web legacy),
//       'sin-domicilio' o 'sin-cambios' (la persona ya estaba al dia, #563). Con
//       'sin-nombre' el valor es el mismo pero el paso es `warn`: el cotizador deja
//       generar sin nombre y el vendedor tiene que saber que no se escribio.
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
//
// La planeacion -- que escribir, que preguntar, que se omite, los textos y la
// comparacion de la relectura -- es pura y vive en lib/contactos-operam-logica.js
// (`planearContactoEntrega`); aqui solo se abre la web legacy, se lee, se escribe y
// se relee.

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
  // Un Cliente Operam generico (mostrador, bazar, publico en general) lo comparten
  // compradores que no tienen nada que ver entre si: su domicilio no es de quien recibe
  // y escribirle personas lo llenaria de ajenos. Como en #459, el generico se excluye
  // ANTES de mirar el domicilio: sin web legacy, sin copia (#564) y, sin escritura, sin
  // fusion (revision de #557).
  if (esDebtorGenerico(clienteId)) {
    return omitida('cliente-generico',
      'El Cliente Operam es generico (lo comparten clientes distintos): el Contacto de entrega no se escribe en sus contactos de Operam.',
      `cliente ${clienteId} en DEBTORS_GENERICOS: no se abre la web legacy ni se escribe el domicilio ${domicilioId ?? '(sin domicilio)'}`);
  }
  if (domicilioId == null || texto(domicilioId) === '') {
    return omitida('sin-domicilio',
      'La cotizacion no quedo ligada a un domicilio de entrega en Operam: el Contacto de entrega no se escribio ahi.',
      `cliente ${clienteId}: sin domicilio (branch) donde escribir`);
  }
  // El cotizador deja generar sin nombre (#558 solo exige telefono y domicilio), asi que
  // no escribirlo es un aviso al vendedor, no un omitido (revision de #557).
  if (!contacto.nombre) {
    const mensaje = 'El Contacto de entrega no se escribio en Operam porque falta su nombre: capturalo en el paso Envio para que quede en el domicilio de entrega.';
    const detalle = `domicilio ${domicilioId} del cliente ${clienteId}: sin nombre no se crea una persona`;
    return { tipo: 'lograda', escrito: false, motivo: 'sin-nombre', pasos: [{ name: PASO_CONTACTO_ENTREGA, status: 'warn', mensaje, detalle }] };
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
        noAplicados, ...conCambio(cambioDeNumero(persona, leida)),
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
        name: PASO_CONTACTO_ENTREGA, status: 'warn',
        mensaje: nueva
          ? `${nombre} quedo en Operam en el domicilio de entrega, pero revisa su contacto: ${noAplicados.map(n => n.etiqueta).join(', ')} no quedo como se capturo.`
          : `Revisa el contacto del domicilio de entrega en Operam: no se pudo confirmar que ${nombre} quedo registrado.`,
        detalle: `${donde}: ${nueva ? `persona ${nueva.personId}${comoCopia}` : 'ninguna persona nueva en la relectura'}; ` +
          noAplicados.map(n => `${n.campo} se esperaba "${n.esperado}" y se leyo "${n.encontrado}"`).join('; '),
      }
      : {
        name: PASO_CONTACTO_ENTREGA, status: 'ok',
        mensaje: `${nombre} quedo en Operam como contacto General y de Entrega del domicilio de entrega${plan.copiaDe ? ' (su contacto del Cliente Operam no cambia)' : ''}${quedaron ? `; ${quedaron}` : ''}.`,
        detalle: `${donde}: persona ${nueva.personId} creada${comoCopia} con roles ${ROLES_CONTACTO_ENTREGA.join(', ')}; ` +
          (plan.copiaDe
            ? `Cel ${plan.crear.casillas.cel || '(vacio)'}, Telefono ${plan.crear.casillas.telefono || '(vacio)'}, Secundario ${plan.crear.casillas.secundario || '(vacio)'}, correo ${plan.crear.casillas.correo || '(vacio)'}`
            : `Cel y Telefono ${contacto.telefono || '(vacio)'}; correo ${contacto.correo || '(vacio)'}`) +
          desplazados.map(x => `; persona ${x.personId} sin General, roles ${x.roles.join(', ')}, nota agregada`).join(''),
      };
    // La copia quedo en Operam pero el cotizador no guardo de quien es: la siguiente
    // cotizacion con el mismo numero la reconoce por el (no se duplica), pero no como la
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
    return { tipo: 'bloqueo', motivo: 'operam', mensaje, detalle, pasos: [{ name: PASO_CONTACTO_ENTREGA, status: enviado ? 'warn' : 'error', mensaje, detalle }] };
  } finally {
    if (web) await web.cerrar();
  }
}

// --- La persona del Alta de cliente como Contacto de entrega (#566, ADR-0024 regla 8)
// POST /customers crea un domicilio y UNA persona, General del cliente y del domicilio,
// con el nombre corto del Cliente Operam como nombre. El Alta de cliente la deja como
// el Contacto de entrega: su nombre (la excepcion a la regla 5: el que puso Operam es
// el del Cliente Operam, no el de una persona), el numero en Cel y en Telefono
// principal, su correo y Entrega ademas de General. No es un dato de Operam que
// alguien capturo -- sus casillas las lleno la misma alta --, asi que no se pregunta
// por pisarlas ni por desplazarla. Lo vacio no borra: sin nombre (el alta completa no
// captura quien recibe) conserva el suyo, y sin correo el que tenia.
//
// Solicitud: { clienteId, domicilioId, personId, contacto: { nombre, telefono, correo } },
// con `personId` = la persona que creo Operam (la lee el alta del Cliente Operam
// recien creado).
//
// Valores (paso `contacto de entrega`, Mensaje en dos capas):
//   { tipo: 'lograda', escrito: true, personId, noAplicados, pasos }   relee la tabla
//       del domicilio y compara nombre, casillas y roles; con algo no aplicado el paso
//       es `warn`.
//   { tipo: 'lograda', escrito: false, motivo, pasos }   (paso `omitido`)
//       'sin-domicilio', 'sin-contacto' (nada que dejar) o 'sin-cambios'.
//   { tipo: 'bloqueo', motivo: 'persona-ausente' | 'operam', mensaje, detalle, pasos }
//       la persona no esta en el domicilio (no se le escribe a nadie mas; paso `warn`)
//       o la web legacy fallo (antes de escribir, paso `error`; despues, `warn`).
// deps: `abrirDomicilioWeb` (el mismo adaptador de escribirContactoEntrega).

export async function contactoEntregaDelAlta(solicitud, deps = {}) {
  const d = { abrirDomicilioWeb: deps.abrirDomicilioWeb || abrirDomicilioWeb };
  const { clienteId, domicilioId } = solicitud;
  const personId = texto(solicitud.personId);
  const contacto = {
    nombre: texto(solicitud.contacto?.nombre).slice(0, MAX_NOMBRE).trim(),
    telefono: texto(solicitud.contacto?.telefono),
    correo: texto(solicitud.contacto?.correo),
  };
  const donde = `domicilio ${domicilioId} del cliente ${clienteId}`;
  if (domicilioId == null || texto(domicilioId) === '') {
    return omitida('sin-domicilio',
      'El Cliente Operam no tiene domicilio de entrega: el Contacto de entrega no se escribio en Operam.',
      `cliente ${clienteId}: sin domicilio (branch) donde escribir`);
  }
  if (!contacto.nombre && !contacto.telefono && !contacto.correo) {
    return omitida('sin-contacto',
      'No se capturo Contacto de entrega: el contacto que creo Operam se queda como estaba.',
      `${donde}: sin nombre, numero ni correo que dejar en la persona ${personId}`);
  }
  let web = null;
  let enviado = false;
  try {
    web = await d.abrirDomicilioWeb(clienteId, domicilioId);
    const persona = (await web.leer()).find(p => String(p.personId) === personId) || null;
    if (!persona) {
      const mensaje = 'No se encontro en el domicilio de entrega el contacto que creo Operam con el Cliente Operam: revisa sus contactos en Operam y deja ahi al Contacto de entrega.';
      const detalle = `${donde}: la persona ${personId} no esta en la pestana Contactos; no se escribe a nadie`;
      return { tipo: 'bloqueo', motivo: 'persona-ausente', mensaje, detalle, pasos: [{ name: PASO_CONTACTO_ENTREGA, status: 'warn', mensaje, detalle }] };
    }
    const cambios = planearPersonaDelAlta(persona, contacto);
    if (!cambios) {
      return omitida('sin-cambios',
        `${persona.nombreCompleto} ya estaba en Operam como contacto General y de Entrega del domicilio de entrega, con estos datos.`,
        `${donde}: persona ${personId} ya coincide; no se escribe`);
    }
    enviado = true;
    await web.editar(personId, cambios);
    const leida = (await web.leer()).find(p => String(p.personId) === personId) || null;
    const noAplicados = leida
      ? noAplicadosDelAlta(cambios, leida)
      : [{ campo: 'persona', etiqueta: 'la persona', esperado: personId, encontrado: '' }];
    const nombre = cambios.nombre || persona.nombreCompleto;
    const c = { ...persona.casillas, ...(cambios.casillas || {}) };
    const escrito = `persona ${personId} (la que creo Operam con el Cliente Operam, antes "${persona.nombreCompleto}") editada: ` +
      `${cambios.nombre ? `nombre "${cambios.nombre}"` : 'nombre intacto'}; Cel ${c.cel || '(vacio)'}, Telefono ${c.telefono || '(vacio)'}, correo ${c.correo || '(vacio)'}; ` +
      `roles ${(cambios.roles || persona.roles).join(', ')}`;
    const paso = noAplicados.length
      ? {
        name: PASO_CONTACTO_ENTREGA, status: 'warn',
        mensaje: `${nombre} quedo en Operam en el domicilio de entrega, pero revisa su contacto: ${noAplicados.map(n => n.etiqueta).join(', ')} no quedo como se capturo.`,
        detalle: `${donde}: ${escrito}; ` + noAplicados.map(n => `${n.campo} se esperaba "${n.esperado}" y se leyo "${n.encontrado}"`).join('; '),
      }
      : {
        name: PASO_CONTACTO_ENTREGA, status: 'ok',
        mensaje: `${nombre} quedo en Operam como contacto General y de Entrega del domicilio de entrega.`,
        detalle: `${donde}: ${escrito}`,
      };
    return { tipo: 'lograda', escrito: true, personId, noAplicados, pasos: [paso] };
  } catch (err) {
    const mensaje = enviado
      ? 'No se pudo confirmar que el Contacto de entrega quedo escrito en el domicilio de entrega en Operam: revisalo ahi.'
      : 'No se pudo dejar al Contacto de entrega en el domicilio de entrega en Operam: revisa ahi el contacto que creo Operam con el Cliente Operam.';
    const detalle = `${donde}, web legacy${enviado ? ` (tras mandar la edicion de la persona ${personId})` : ''}: ${err?.message}`;
    return { tipo: 'bloqueo', motivo: 'operam', mensaje, detalle, pasos: [{ name: PASO_CONTACTO_ENTREGA, status: enviado ? 'warn' : 'error', mensaje, detalle }] };
  } finally {
    if (web) await web.cerrar();
  }
}
