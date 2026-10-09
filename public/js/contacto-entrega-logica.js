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
