// Adaptador de Operam EN MEMORIA para las pruebas de lib/contactos-operam.js (#559,
// ADR-0024). Guarda lo que Operam guarda -- PERSONAS (identidad = person_id, con sus
// casillas) y RENGLONES de rol (uno por persona, entidad y rol) -- y lo sirve con las
// MISMAS dependencias y las MISMAS formas que el adaptador real:
//
//   - `obtenerCliente(id)`: `GET /customers/:id`. `contacts[]` trae una fila por rol
//     del Cliente Operam con `id` = person_id (el id del renglon no viaja), `name2`
//     para el apellido y `notes`; `branches[]` trae el General del domicilio
//     APLANADO (`contact_name`, `phone`, `fax` = Cel, `email`).
//   - `contactosDelDomicilio(code)`: los renglones de `contact_list` de ese domicilio
//     tal como los guarda la cache de lib/contactos-domicilio-io.js: `id` del
//     renglon aparte de `person_id`, `last_name` (no `name2`) y SIN `notes`. `null`
//     = la cache aun no tiene el padron (no se sabe).
//
// Quirk medido (ADR-0024): cada `PUT /branches` deja renglones General VACIOS con
// `person_id: 0` en el domicilio (`renglonesGeneralVacios`, lista de branch codes).
//
// La escritura (#561-#566) extiende ESTE estado: crear o editar una persona y
// asignarle roles muta `personas`/`renglones`, y la relectura sale de las mismas
// dos dependencias de arriba.

const CASILLAS = ['name', 'name2', 'ref', 'phone', 'phone2', 'fax', 'email', 'notes'];

export function contactosOperamEnMemoria({
  clientes = [],
  personas = [],
  renglones = [],
  padronDomicilios = true,
  renglonesGeneralVacios = [],
  falla = {},
} = {}) {
  const estado = {
    clientes: clientes.map(c => ({ customer_id: String(c.customer_id), branches: (c.branches || []).map(String) })),
    personas: new Map(personas.map(p => [String(p.personId), Object.fromEntries(CASILLAS.map(k => [k, p[k] ?? '']))])),
    renglones: renglones.map((r, i) => ({ id: String(r.id ?? 5000 + i), personId: String(r.personId), tipo: r.tipo, entidad: String(r.entidad), rol: r.rol })),
    padronDomicilios,
  };
  const llamadas = [];
  const registrar = (nombre, ...args) => {
    llamadas.push({ dep: nombre, args });
    if (falla[nombre]) throw new Error(falla[nombre]);
  };
  const renglonesDe = (tipo, entidad) => estado.renglones.filter(r => r.tipo === tipo && r.entidad === String(entidad));
  const persona = id => estado.personas.get(id) || Object.fromEntries(CASILLAS.map(k => [k, '']));

  const generalAplanado = code => {
    const r = renglonesDe('cust_branch', code).find(x => x.rol === 'general');
    const p = r ? persona(r.personId) : null;
    return { contact_name: p?.name || '', phone: p?.phone || '', fax: p?.fax || '', email: p?.email || '' };
  };

  const deps = {
    async obtenerCliente(id) {
      registrar('obtenerCliente', id);
      const c = estado.clientes.find(x => x.customer_id === String(id));
      if (!c) return null;
      return {
        customer_id: c.customer_id,
        contacts: renglonesDe('customer', c.customer_id).map(r => {
          const p = persona(r.personId);
          return { id: r.personId, action: r.rol, ref: p.ref, name: p.name, name2: p.name2, address: '', phone: p.phone, phone2: p.phone2, fax: p.fax, email: p.email, lang: '', notes: p.notes };
        }),
        branches: c.branches.map(code => ({ branch_code: code, br_name: `Domicilio ${code}`, ...generalAplanado(code) })),
      };
    },
    contactosDelDomicilio(code) {
      registrar('contactosDelDomicilio', code);
      if (!estado.padronDomicilios) return null;
      const filas = renglonesDe('cust_branch', code).map(r => {
        const p = persona(r.personId);
        return { id: r.id, person_id: r.personId, type: 'cust_branch', action: r.rol, entity_id: String(code), parent: `Domicilio ${code}`, name: p.name, last_name: p.name2, ref: p.ref, phone: p.phone, phone2: p.phone2, fax: p.fax, email: p.email };
      });
      if (renglonesGeneralVacios.map(String).includes(String(code))) {
        filas.unshift({ id: '3425', person_id: '0', type: 'cust_branch', action: 'general', entity_id: String(code), parent: `Domicilio ${code}`, name: '', last_name: '', ref: '', phone: '', phone2: '', fax: '', email: '' });
      }
      return filas;
    },
  };

  return {
    deps,
    estado,
    llamadas,
    pedidos: nombre => llamadas.filter(l => l.dep === nombre),
  };
}
