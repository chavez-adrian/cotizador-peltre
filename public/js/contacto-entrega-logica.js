// Lo que el Contacto de entrega y el domicilio de entrega exigen para generar o
// actualizar una cotizacion (#558, ADR-0024 regla 1; GLOSSARY.md "Contacto de
// entrega"): sin el telefono de quien recibe, la paqueteria no tiene a quien llamar,
// y sin domicilio de entrega el Contacto de entrega no tiene donde vivir en Operam.
// El correo es opcional.
//
// EL juicio, uno solo para las dos superficies (patron de moneda-cliente-logica.js):
// el navegador no manda la cotizacion y lleva al vendedor al campo que falta, y la
// Subida del quote (lib/subida-quote.js) termina en bloqueo con motivo al crear y al
// actualizar. Vive en public/js porque lib/ importa de aqui y no al reves.

export const MOTIVO_SIN_DOMICILIO_ENTREGA = 'sin-domicilio-entrega';
export const MOTIVO_SIN_TELEFONO_ENTREGA = 'sin-telefono-entrega';

// Codigo estructurado de la respuesta HTTP del bloqueo: quien lo recibe clasifica por
// codigo, nunca parseando el texto (misma disciplina que CLIENTE_MONEDA_EXTRANJERA).
export const CODIGO_ENTREGA_INCOMPLETA = 'CONTACTO_ENTREGA_INCOMPLETO';

// El nombre del paso del Contacto de entrega en los reportes (#561, #566): lo escriben
// el modulo Contactos en Operam, el Alta de cliente y la Subida del quote, y lo leen el
// panel del alta y el reporte de la subida en el navegador. Uno solo para todos.
export const PASO_CONTACTO_ENTREGA = 'contacto de entrega';

const vacio = (v) => !String(v ?? '').trim();

// Un codigo de pais suelto ('+52') no es telefono: es lo que queda de un campo con
// bandera y sin numero.
function tieneTelefono(valor) {
  const sinCodigoSuelto = String(valor ?? '').trim().replace(/^\+\d{1,3}$/, '');
  return /\d/.test(sinCodigoSuelto);
}

// Lo que falta, en el orden del formulario del paso Envio (CP, calle, celular). El
// domicilio de entrega es calle Y CP: el mismo criterio con el que el alta escribe el
// domicilio en el Cliente Operam (buildBranchGenerico, lib/alta-generica.js). Ni el
// envio ni el Cliente Operam entran: el cliente que recoge en planta tambien los
// necesita. Cada `revisar` devuelve los campos vacios como [id del campo, llave].
const FALTANTES = [
  {
    motivo: MOTIVO_SIN_DOMICILIO_ENTREGA,
    texto: 'el domicilio de entrega',
    revisar: (c) => [['cl-cp-entrega', 'cpEntrega'], ['cl-calle', 'calle']].filter(([, llave]) => vacio(c[llave])),
  },
  {
    motivo: MOTIVO_SIN_TELEFONO_ENTREGA,
    texto: 'el tel\u00e9fono del Contacto de entrega',
    revisar: (c) => (tieneTelefono(c.celEntrega) ? [] : [['cl-cel-entrega', 'celEntrega']]),
  },
];

// null = adelante, o { motivo, campo, faltan, mensaje, detalle }: `motivo` y `campo`
// son los del PRIMER dato que falta (a donde va el vendedor) y `faltan` los motivos
// de todos. `cliente` es `data.cliente` de la cotizacion, la misma forma que arma
// leerClienteFormulario (app.js).
export function bloqueoContactoEntrega(cliente) {
  const c = cliente || {};
  const faltantes = FALTANTES
    .map((f) => ({ ...f, vacios: f.revisar(c) }))
    .filter((f) => f.vacios.length);
  if (!faltantes.length) return null;
  const [primero] = faltantes;
  return {
    motivo: primero.motivo,
    campo: primero.vacios[0][0],
    faltan: faltantes.map((f) => f.motivo),
    mensaje: faltantes.length > 1
      ? `Faltan ${faltantes.map((f) => f.texto).join(' y ')}: capt\u00faralos en el paso Env\u00edo para generar o actualizar la cotizaci\u00f3n.`
      : `Falta ${primero.texto}: capt\u00faralo en el paso Env\u00edo para generar o actualizar la cotizaci\u00f3n.`,
    detalle: faltantes.flatMap((f) => f.vacios.map(([, llave]) => `data.cliente.${llave} vacio`)).join('; '),
  };
}

// El telefono que se le propone al Contacto de entrega cuando el vendedor elige a una
// persona de Operam (#559, ADR-0024 regla 2, orden de ADR-0016): SU Cel (el numero
// mas probable de WhatsApp), si no su Telefono principal, si no su Telefono
// Secundario; sin ninguno, vacio, y nunca el de otra persona. Lo comparten el
// selector del paso Envio (contactosEntregaDisponibles, alta-logica.js) y la ruta que
// le manda las personas (server.js), para que los dos digan el mismo numero.
const ORDEN_TELEFONO_PERSONA = ['cel', 'telefono', 'secundario'];

// La persona que el vendedor eligio en el selector (#563, ADR-0024 reglas 5 y 7): la
// cotizacion la guarda por su person_id (data.cliente.contactoEntregaPersonId), la
// identidad de un Contacto en Operam, y la Subida del quote edita a ESA persona en vez
// de crear otra. Se fija al ELEGIR una opcion y no se deduce del <select> al guardar:
// la repintada del selector deja de reconocer la opcion en cuanto el vendedor le cambia
// el celular, que es justo lo que viene a hacer.
//
// La opcion elegida -> su person_id; "+ Nuevo contacto" o una opcion que no es una
// persona de Operam (el Contacto del cotizador) -> null.
export function personIdDeOpcion(contactos, valor) {
  if (valor === 'nuevo') return null;
  const c = (contactos || [])[parseInt(valor, 10)];
  return c?.personId != null && String(c.personId).trim() !== '' ? String(c.personId) : null;
}

// La repintada del selector con la persona ya elegida. `base` es lo que decide la regla
// de siempre (seleccionContactoEntrega o, al cambiar de domicilio,
// contactoAlCambiarDomicilio): `{ indice, aplicar }`. Devuelve `{ indice, aplicar,
// personId }`:
//   - "+ Nuevo contacto": sin persona.
//   - el selector aplica una opcion (pone sus datos en los campos): su persona.
//   - si no, la persona elegida sigue en la lista: el selector se queda en ella SIN
//     aplicar (lo capturado manda) y conserva su person_id. Cambiarle el nombre no la
//     vuelve otra persona: el nombre de la cotizacion es el del documento y el de
//     Operam no se toca (regla 5).
//   - la persona elegida no esta en la lista: al cambiar de domicilio se suelta (las
//     personas son de cada domicilio); en otra repintada se conserva (al Editar, la
//     lista llega despues que la cotizacion).
export function personaContactoEntrega({ contactos, base, personId, capturaManual, cambioDeDomicilio = false }) {
  const lista = contactos || [];
  if (capturaManual) return { ...base, personId: null };
  if (base.aplicar) return { ...base, personId: base.indice == null ? null : personIdDeOpcion(lista, String(base.indice)) };
  if (personId == null || String(personId) === '') return { ...base, personId: null };
  const i = lista.findIndex(c => c?.personId != null && String(c.personId) === String(personId));
  if (i !== -1) return { indice: i, aplicar: false, personId: String(personId) };
  return { ...base, personId: cambioDeDomicilio ? null : String(personId) };
}

export function telefonoDePersona(casillas) {
  for (const llave of ORDEN_TELEFONO_PERSONA) {
    const numero = String(casillas?.[llave] ?? '').trim();
    if (numero) return numero;
  }
  return '';
}
