// EL modulo Contactos en Operam (#559, ADR-0024): la unica puerta para leer (y, desde
// #561, escribir) las personas que Operam registra bajo un Cliente Operam y bajo sus
// domicilios de entrega. Reglas de modulo de dominio en CODING_STANDARDS.md.
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
//   - Cliente Operam: `contacts[]` de `GET /customers/:id`, una fila por rol con
//     `id` = person_id, `name2` (apellido) y `notes`.
//   - Domicilio de entrega: SOLO `contact_list` (padron cacheado en
//     lib/contactos-domicilio-io.js), con el id del renglon aparte de `person_id`,
//     `last_name` (el mismo dato que `name2`) y sin `notes` (`notas: null` = no se
//     sabe, no "vacias"). Los renglones con `person_id` 0 son los General vacios que
//     deja cada `PUT /branches`: no son personas.
// Una misma persona puede estar en los dos niveles (la que crea `POST /customers` es
// General del cliente y de su domicilio): sale en ambos con el mismo personId.

import { obtenerCliente } from './operam-client.js';
import { contactosDelDomicilio } from './contactos-domicilio-io.js';

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

// Nucleo PURO: el Cliente Operam tal como lo devuelve `GET /customers/:id` y los
// renglones de `contact_list` de sus domicilios (`null` = el padron aun no se
// conoce). Devuelve `{ cliente, domicilios }`: `domicilios` es `null` sin padron y,
// con padron, un objeto branch_code -> personas para CADA domicilio del Cliente
// Operam (la lista vacia = ese domicilio no tiene personas).
function contactosDeClienteOperam(cliente, filasDomicilios) {
  const codigos = (cliente?.branches || []).map(b => texto(b.branch_code)).filter(Boolean);
  const personasCliente = juntarPorPersona((cliente?.contacts || []).map(renglonDeCliente));
  if (!Array.isArray(filasDomicilios)) return { cliente: personasCliente, domicilios: null };
  const domicilios = {};
  for (const codigo of codigos) {
    const filas = filasDomicilios.filter(f => f?.type === 'cust_branch' && texto(f.entity_id) === codigo);
    domicilios[codigo] = juntarPorPersona(filas.map(renglonDeDomicilio));
  }
  return { cliente: personasCliente, domicilios };
}

// Las personas de un Cliente Operam y de cada domicilio de entrega suyo. `null` si el
// Cliente Operam no existe. Lee el cliente de Operam (un GET) y los domicilios del
// padron cacheado, que nunca espera a Operam. Un fallo al leer el cliente rechaza:
// quien pregunta decide (no se puede afirmar que no tiene contactos).
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
