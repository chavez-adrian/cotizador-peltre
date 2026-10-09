// Adaptador REAL del modulo Contactos en Operam (lib/contactos-operam.js) para ESCRIBIR
// y releer los contactos de un domicilio de entrega (#561, ADR-0024). La API v3 no
// escribe contactos (501); la web legacy si, en la pestana Contactos de la pagina de
// domicilios del Cliente Operam (/sales/manage/customer_branches.php). La secuencia
// esta medida en vivo (2026-10-09, Cliente Operam 15, domicilio 564):
//
//   GET  customer_branches.php?debtor_no=<cliente>     lista de domicilios
//   POST Edit<domicilio>=1                              abre el domicilio
//   POST tabs_contacts                                  pestana Contactos (la tabla)
//   POST contactsNEW                                    formulario de contacto nuevo
//   POST contactsADD + campos + assgn[] por rol          crea la persona
//
// Esa pagina trae en el MISMO formulario los botones que guardan (Update,
// UPDATE_ITEM), crean (ADD_ITEM) o borran (Delete<domicilio>) el DOMICILIO, y los de
// editar o borrar cada contacto. Ninguno sale de los campos parseados: cada POST lleva
// exactamente el boton de su paso, que pone el serializador (como ProcessOrder en el
// quote, operam-web.js). Antes de cada escritura se comprueba que la pagina es la del
// cliente y el domicilio pedidos.
//
// Una sesion web propia por `abrirDomicilioWeb`, que `cerrar()` cierra (ADR-0024: cada
// sesion cuenta contra el limite de usuarios de Operam). El modulo la cierra siempre.

import { crearSesionFA, parsearFormularioDomicilios, leerErrorWeb, sinEtiquetas } from './operam-web.js';

// Rol del modulo (el `action` de la API) <-> codigo del select `assgn[]` del formulario
// <-> etiqueta de la columna Asignaciones de la tabla. Medido en el formulario.
const ROLES = [
  { rol: 'general', codigo: '1', etiqueta: 'General' },
  { rol: 'invoice', codigo: '2', etiqueta: 'Invoices' },
  { rol: 'order', codigo: '3', etiqueta: 'Orders' },
  { rol: 'delivery', codigo: '4', etiqueta: 'Deliveries' },
];

// Lo que NUNCA sale de los campos parseados hacia un body: los botones del domicilio
// (guardar, crear, borrar, abrir otro, paginar, exportar, buscar), los de cada contacto
// y las pestanas. parsearFormularioDomicilios ya no recoge <button>; esta es la segunda
// linea por si Operam pintara alguno como <input>.
const ES_BOTON = (k) => /^(Update|UPDATE_ITEM|ADD_ITEM|RESET|process|delete|Delete.*|Edit.*|contacts(NEW|ADD|UPDATE|RESET|CLONE|Edit|Delete).*|tabs_.*|branch_tbl_.*|Imprimir|SearchCustomerAddress|_.*_update)$/i.test(k);

// Body de un POST de la pagina: los campos del formulario sin ningun boton, `extra`
// sustituye o agrega campos (los del contacto) y `boton` = [nombre, valor] es el UNICO
// submit que viaja. `multiple` agrega valores repetidos (assgn[]).
export function serializarBodyDomicilios(campos, boton, { extra = {}, multiple = {} } = {}) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...(campos || {}), ...extra })) {
    if (ES_BOTON(k) || k in multiple) continue;
    body.set(k, v);
  }
  for (const [k, valores] of Object.entries(multiple)) {
    for (const v of valores) body.append(k, v);
  }
  body.set(boton[0], boton[1]);
  return body;
}

// La tabla de la pestana Contactos -> una persona por person_id (el de su boton
// contactsEdit[N]). La web repite la fila una vez por rol con TODOS los roles en
// Asignaciones ("General,Deliveries"); "Nombre Completo" es nombre y apellido juntos.
// Columnas medidas: Asignaciones, Referencia, Nombre Completo, Telefono, Telefono
// Secundario, Cel, email.
export function personasDeContactos(html) {
  const texto = String(html ?? '');
  const ini = texto.indexOf("id='contacts_div'");
  if (ini === -1) throw new Error('La pagina de domicilios de Operam no muestra la pestana Contactos');
  const personas = new Map();
  for (const m of texto.slice(ini).matchAll(/<tr class='(?:evenrow|oddrow)'[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const personId = (m[1].match(/name='contactsEdit\[(\d+)\]'/) || [])[1];
    if (!personId || personas.has(personId)) continue;
    const [asignaciones, referencia, nombreCompleto, telefono, secundario, cel, correo] =
      [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => sinEtiquetas(c[1]));
    const roles = String(asignaciones).split(',').map((e) => e.trim()).filter(Boolean)
      .map((e) => ROLES.find((r) => r.etiqueta === e)?.rol ?? e.toLowerCase());
    personas.set(personId, { personId, nombreCompleto, referencia, roles, casillas: { cel, telefono, secundario, correo } });
  }
  return [...personas.values()];
}

function exigirPagina(campos, clienteId, domicilioId, pestana) {
  const esperado = { customer_id: String(clienteId), selected_id: String(domicilioId), ...(pestana ? { _tabs_sel: pestana } : {}) };
  for (const [k, v] of Object.entries(esperado)) {
    if (String(campos[k] ?? '') !== v) {
      throw new Error(`la pagina de domicilios trae ${k}=${campos[k] ?? '(nada)'} y se esperaba ${v} (cliente ${clienteId}, domicilio ${domicilioId}); no se escribe`);
    }
  }
}

export async function abrirDomicilioWeb(clienteId, domicilioId, { crearSesion = crearSesionFA } = {}) {
  const s = await crearSesion();
  const url = `${s.base}/sales/manage/customer_branches.php?debtor_no=${encodeURIComponent(clienteId)}`;
  const postear = (body) => s.pedir(url, { method: 'POST', body: body.toString() });

  async function pestanaContactos() {
    const lista = parsearFormularioDomicilios(await s.pedir(url)).campos;
    exigirPagina({ ...lista, selected_id: String(domicilioId) }, clienteId, domicilioId);
    const general = parsearFormularioDomicilios(await postear(serializarBodyDomicilios(lista, [`Edit${domicilioId}`, '1']))).campos;
    exigirPagina(general, clienteId, domicilioId);
    const html = await postear(serializarBodyDomicilios(general, ['tabs_contacts', '']));
    exigirPagina(parsearFormularioDomicilios(html).campos, clienteId, domicilioId, 'contacts');
    return html;
  }

  return {
    async leer() {
      return personasDeContactos(await pestanaContactos());
    },
    async crear(persona) {
      const contactos = parsearFormularioDomicilios(await pestanaContactos()).campos;
      const nuevo = parsearFormularioDomicilios(await postear(serializarBodyDomicilios(contactos, ['contactsNEW', 'Agregar nuevo']))).campos;
      exigirPagina(nuevo, clienteId, domicilioId, 'contacts');
      if (nuevo['contactsMode[]'] !== 'NEW' || !('name' in nuevo)) {
        throw new Error('la web legacy no abrio el formulario de contacto nuevo; no se escribe');
      }
      const codigos = (persona.roles || []).map((rol) => {
        const r = ROLES.find((x) => x.rol === rol);
        if (!r) throw new Error(`rol de contacto desconocido: ${rol}`);
        return r.codigo;
      });
      const c = persona.casillas || {};
      const respuesta = await postear(serializarBodyDomicilios(nuevo, ['contactsADD', 'Agregar'], {
        extra: {
          name: persona.nombre || '', name2: persona.apellido || '', ref: persona.referencia || '',
          phone: c.telefono || '', phone2: c.secundario || '', fax: c.cel || '', email: c.correo || '',
          address: '', notes: persona.notas || '',
        },
        multiple: { 'assgn[]': codigos },
      }));
      const error = leerErrorWeb(respuesta);
      if (error) throw new Error(`la web legacy rechazo el contacto: ${error}`);
    },
    cerrar: () => s.cerrar(),
  };
}
