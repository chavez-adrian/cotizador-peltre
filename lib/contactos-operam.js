// EL modulo Contactos en Operam (#559, ADR-0024): la unica puerta para leer los
// Contactos en Operam de un Cliente Operam y de sus domicilios de entrega. Sigue
// CODING_STANDARDS.md: devuelve valores (nunca HTTP, no importa Express ni
// server.js) y Operam entra por `deps = {}` con las funciones reales por omision;
// las pruebas pasan el adaptador en memoria (test/helpers/contactos-operam-memoria.js).
//
// Aqui, y solo aqui, se traduce la forma cruda de Operam: un renglon POR ROL
// (`action`), la identidad de la persona (`id` en `contacts[]` del cliente,
// `person_id` en contact_list; el id del renglon de rol NO sirve de llave) y sus
// casillas -- Telefono principal (`phone`), Secundario (`phone2`), Cel (`fax`, ver
// cel-operam.js) y correo --. Que numero se propone para cada persona NO se decide
// aqui: lo decide el paso Envio con estas casillas (alta-logica.js).
//
// Limites (ADR-0024): este corte solo LEE. Planear y ejecutar la escritura del
// Contacto de entrega en el domicilio entran despues, por la web legacy.

import { obtenerCliente } from './operam-client.js';
import { CAMPO_CEL } from './cel-operam.js';
import { contactosDelDomicilio } from './contactos-domicilio-io.js';

const DEPS_REALES = Object.freeze({
  leerCliente: obtenerCliente,
  filasDelDomicilio: contactosDelDomicilio,
});

const texto = v => String(v ?? '').trim();

// En `contacts[]` del cliente la marca puede venir en `ref` cuando falta `action`
// (#99); en contact_list `ref` es texto libre y NUNCA es marca (#397).
const rolDeContacto = ct => texto(ct.action) || texto(ct.ref);
const rolDeRenglon = f => texto(f.action);

// Renglones de rol -> personas. Los renglones de la misma persona se juntan en el
// lugar del primero, con sus roles en el orden en que aparecieron y cada casilla
// con el primer valor no vacio. Un renglon sin identidad (o con el person_id 0 que
// deja cada PUT /branches, #466) es su propia persona. La persona sin nombre ni
// ninguna casilla se descarta; una que solo tiene Cel NO esta vacia.
function personasDe(renglones, idDe, rolDe) {
  const personas = [];
  const porId = new Map();
  for (const r of renglones || []) {
    if (!r) continue;
    const id = texto(idDe(r));
    const llave = id && id !== '0' ? id : null;
    let p = llave ? porId.get(llave) : null;
    if (!p) {
      p = { personId: llave, nombre: '', roles: [], telefono: '', secundario: '', cel: '', email: '' };
      personas.push(p);
      if (llave) porId.set(llave, p);
    }
    const rol = rolDe(r);
    if (rol && !p.roles.includes(rol)) p.roles.push(rol);
    if (!p.nombre) p.nombre = texto(r.name);
    if (!p.telefono) p.telefono = texto(r.phone);
    if (!p.secundario) p.secundario = texto(r.phone2);
    if (!p.cel) p.cel = texto(r[CAMPO_CEL]);
    if (!p.email) p.email = texto(r.email);
  }
  return personas.filter(p => p.nombre || p.telefono || p.secundario || p.cel || p.email);
}

// Los Contactos en Operam de un Cliente Operam y de cada uno de sus domicilios de
// entrega, por persona: `{ delCliente, porDomicilio: { <branch_code>: personas | null } }`.
// `null` en un domicilio = el padron de contact_list todavia no se leyo (no se sabe);
// la lista vacia = se sabe que no tiene. Un fallo al leer el cliente se propaga: no
// hay nada que devolver sin el.
export async function leerContactos(clienteId, deps = {}) {
  const d = { ...DEPS_REALES, ...deps };
  const cliente = await d.leerCliente(clienteId);
  const delCliente = personasDe(cliente?.contacts, ct => ct.id, rolDeContacto);
  const porDomicilio = {};
  for (const b of cliente?.branches || []) {
    const codigo = texto(b?.branch_code);
    if (!codigo) continue;
    const filas = d.filasDelDomicilio(codigo);
    porDomicilio[codigo] = filas == null ? null : personasDe(filas, f => f.person_id, rolDeRenglon);
  }
  return { delCliente, porDomicilio };
}
