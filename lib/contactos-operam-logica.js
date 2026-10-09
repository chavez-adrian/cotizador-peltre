// Nucleo PURO del modulo Contactos en Operam (#559/#560, ADR-0024): traduce lo que
// Operam devuelve a personas, sin IO ni imports. La puerta con IO es
// lib/contactos-operam.js (`leerContactos`); este archivo es su mitad pura, aparte
// para que los nucleos puros que ya traen al Cliente Operam en la mano (dedup, cruce
// por identidad, Cel del alta) lo lean sin cargar el cliente de Operam ni la cache de
// contact_list -- operam-client.js importa a algunos de ellos.
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
