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
// La escritura (#561) entra por la pestana Contactos de la pagina de domicilios de la
// web legacy, la UNICA lectura fresca de un domicilio (contact_list es una cache de
// hasta 1 h): `abrirDomicilioWeb(clienteId, domicilioId)` abre una sesion y devuelve
// `{ leer, crear, cerrar }` sobre ESTE mismo estado.
//   - `leer()`: las personas de la tabla de la pestana, una por person_id, como las
//     pinta la web: `nombreCompleto` (name + name2 juntos), `referencia`, `roles`
//     (vocabulario de la API) y las cuatro casillas. Sin notas: la tabla no las trae.
//   - `crear(persona)`: persona NUEVA con person_id nuevo y un renglon por rol en el
//     domicilio (Operam no liga una persona existente). `ignoraAlCrear` (lista de
//     casillas: 'cel', 'telefono', 'secundario', 'correo') simula a Operam guardando
//     sin ellas: el 200 que no garantiza nada.
//   - `leerPersona(personId)` (#562): el formulario de EDITAR de una persona del
//     domicilio, el unico lugar que trae sus Notas: `{ personId, nombre, apellido,
//     referencia, roles, casillas, notas }`. Una persona que no esta en el domicilio
//     lanza, como la web (no hay boton contactsEdit para ella).
//   - `editar(personId, { roles, notas, casillas, nombre, apellido })` (#562, #563):
//     repostea ese formulario con los roles (assgn[] es REPLACE: los renglones de la
//     persona en el domicilio quedan exactamente esos), las notas y las casillas que
//     vengan (Cel, Telefono, Secundario, correo); lo que no viene no cambia. El nombre
//     y el apellido solo cambian si vienen (#566: la persona que crea el alta).
//     `ignoraAlEditar` (lista: 'roles', 'notas', 'nombre', 'cel', 'telefono',
//     'secundario', 'correo') simula a Operam guardando sin ellos.
//   - `cerrar()`: cierra la sesion web; queda en `sesiones`.
// Un domicilio que no es del Cliente Operam lanza, como la guarda del adaptador real.
// `falla: { abrirDomicilioWeb | leer | crear: 'mensaje' }` hace lanzar a esa llamada;
// `falla.releer` solo a la lectura que sigue a una escritura (crear o editar);
// `falla.leerPersona` y `falla.editar` a esas llamadas.
//
// La liga copia -> origen (#564) es dato del COTIZADOR, no de Operam:
// `buscarCopia(domicilioId, origenPersonId)` -> `{ copiaPersonId, ... }` o null y
// `guardarCopia({ clienteId, domicilioId, origenPersonId, copiaPersonId })` (reemplaza
// la liga anterior del mismo domicilio y origen), sobre `estado.copias` (Map
// `domicilio:origen` -> liga). `copias` siembra ligas previas; `falla.buscarCopia` y
// `falla.guardarCopia` hacen lanzar a esas llamadas.

const CASILLAS = ['name', 'name2', 'ref', 'phone', 'phone2', 'fax', 'email', 'notes'];

// Las casillas del modulo -> las llaves de Operam (Cel viaja como `fax`).
const LLAVE_DE_CASILLA = { cel: 'fax', telefono: 'phone', secundario: 'phone2', correo: 'email' };

export function contactosOperamEnMemoria({
  clientes = [],
  personas = [],
  renglones = [],
  padronDomicilios = true,
  renglonesGeneralVacios = [],
  ignoraAlCrear = [],
  ignoraAlEditar = [],
  copias = [],
  falla = {},
} = {}) {
  const estado = {
    clientes: clientes.map(c => ({ customer_id: String(c.customer_id), branches: (c.branches || []).map(String) })),
    personas: new Map(personas.map(p => [String(p.personId), Object.fromEntries(CASILLAS.map(k => [k, p[k] ?? '']))])),
    renglones: renglones.map((r, i) => ({ id: String(r.id ?? 5000 + i), personId: String(r.personId), tipo: r.tipo, entidad: String(r.entidad), rol: r.rol })),
    padronDomicilios,
    sesiones: [],
    copias: new Map(copias.map(c => [`${c.domicilioId}:${c.origenPersonId}`, { ...c, domicilioId: String(c.domicilioId), origenPersonId: String(c.origenPersonId), copiaPersonId: String(c.copiaPersonId) }])),
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
    // D6: el interruptor de la escritura, encendido para las pruebas del modulo.
    escrituraActiva: () => true,
    async buscarCopia(domicilioId, origenPersonId) {
      registrar('buscarCopia', domicilioId, origenPersonId);
      return estado.copias.get(`${domicilioId}:${origenPersonId}`) || null;
    },
    async guardarCopia(liga) {
      registrar('guardarCopia', liga);
      estado.copias.set(`${liga.domicilioId}:${liga.origenPersonId}`, { ...liga });
    },
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
    async abrirDomicilioWeb(clienteId, domicilioId) {
      registrar('abrirDomicilioWeb', clienteId, domicilioId);
      const c = estado.clientes.find(x => x.customer_id === String(clienteId));
      if (!c || !c.branches.includes(String(domicilioId))) {
        throw new Error(`la pagina de domicilios no abrio el domicilio ${domicilioId} del cliente ${clienteId}`);
      }
      const sesion = { clienteId: String(clienteId), domicilioId: String(domicilioId), cerrada: false };
      estado.sesiones.push(sesion);
      const code = String(domicilioId);
      return {
        async leer() {
          registrar('leer', code);
          if (falla.releer && (op.pedidos('crear').length || op.pedidos('editar').length)) throw new Error(falla.releer);
          const vistas = new Map();
          for (const r of renglonesDe('cust_branch', code)) {
            if (!vistas.has(r.personId)) {
              const p = persona(r.personId);
              vistas.set(r.personId, {
                personId: r.personId,
                nombreCompleto: [p.name, p.name2].filter(Boolean).join(' '),
                referencia: p.ref,
                roles: [],
                casillas: { cel: p.fax, telefono: p.phone, secundario: p.phone2, correo: p.email },
              });
            }
            const v = vistas.get(r.personId);
            if (r.rol && !v.roles.includes(r.rol)) v.roles.push(r.rol);
          }
          return [...vistas.values()];
        },
        async crear(nueva) {
          registrar('crear', code, nueva);
          const personId = String(Math.max(1300, ...[...estado.personas.keys()].map(Number)) + 1);
          const crudo = Object.fromEntries(CASILLAS.map(k => [k, '']));
          crudo.name = nueva.nombre || '';
          crudo.name2 = nueva.apellido || '';
          crudo.ref = nueva.referencia || '';
          crudo.notes = nueva.notas || '';
          for (const [casilla, llave] of Object.entries(LLAVE_DE_CASILLA)) {
            if (!ignoraAlCrear.includes(casilla)) crudo[llave] = nueva.casillas?.[casilla] || '';
          }
          estado.personas.set(personId, crudo);
          for (const rol of nueva.roles || []) {
            estado.renglones.push({ id: String(6000 + estado.renglones.length), personId, tipo: 'cust_branch', entidad: code, rol });
          }
        },
        async leerPersona(personId) {
          registrar('leerPersona', code, personId);
          const id = String(personId);
          const suyos = renglonesDe('cust_branch', code).filter(r => r.personId === id);
          if (!suyos.length) throw new Error(`la persona ${id} no esta en el domicilio ${code}`);
          const p = persona(id);
          return {
            personId: id, nombre: p.name, apellido: p.name2, referencia: p.ref,
            roles: [...new Set(suyos.map(r => r.rol))],
            casillas: { cel: p.fax, telefono: p.phone, secundario: p.phone2, correo: p.email },
            notas: p.notes,
          };
        },
        async editar(personId, cambios) {
          registrar('editar', code, personId, cambios);
          const id = String(personId);
          if (!renglonesDe('cust_branch', code).some(r => r.personId === id)) throw new Error(`la persona ${id} no esta en el domicilio ${code}`);
          const crudo = estado.personas.get(id);
          if (cambios.notas !== undefined && !ignoraAlEditar.includes('notas')) crudo.notes = cambios.notas ?? '';
          if (!ignoraAlEditar.includes('nombre')) {
            if (cambios.nombre !== undefined) crudo.name = cambios.nombre ?? '';
            if (cambios.apellido !== undefined) crudo.name2 = cambios.apellido ?? '';
          }
          for (const [casilla, llave] of Object.entries(LLAVE_DE_CASILLA)) {
            if (cambios.casillas?.[casilla] !== undefined && !ignoraAlEditar.includes(casilla)) crudo[llave] = cambios.casillas[casilla];
          }
          if (cambios.roles !== undefined && !ignoraAlEditar.includes('roles')) {
            estado.renglones = estado.renglones.filter(r => !(r.personId === id && r.tipo === 'cust_branch' && r.entidad === code));
            for (const rol of cambios.roles || []) {
              estado.renglones.push({ id: String(6000 + estado.renglones.length), personId: id, tipo: 'cust_branch', entidad: code, rol });
            }
          }
        },
        async cerrar() {
          sesion.cerrada = true;
        },
      };
    },
  };

  const op = {
    deps,
    estado,
    llamadas,
    pedidos: nombre => llamadas.filter(l => l.dep === nombre),
  };
  return op;
}
