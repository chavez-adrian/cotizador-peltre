// EL modulo Contactos en Operam (#559, ADR-0024): la unica puerta para leer (y, desde
// #561, escribir) las personas que Operam registra bajo un Cliente Operam y bajo sus
// domicilios de entrega. Reglas de modulo de dominio en CODING_STANDARDS.md.
//
// Esta es la mitad con IO. La traduccion de lo que Operam devuelve a personas (por
// person_id, con roles y casillas, el Cel incluido) y al General aplanado de cada
// domicilio vive en su nucleo puro, lib/contactos-operam-logica.js
// (`contactosDeClienteOperam`), que tambien leen sin IO los que ya traen al Cliente
// Operam en la mano (#560).

import { obtenerCliente } from './operam-client.js';
import { contactosDelDomicilio } from './contactos-domicilio-io.js';
import { contactosDeClienteOperam } from './contactos-operam-logica.js';

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
