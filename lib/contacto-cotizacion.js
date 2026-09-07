// De que Contacto es una cotizacion (#342, spec #337, ADR-0016, CONTEXT.md
// "Oportunidad"): nucleo PURO, sin IO.
//
// La liga es FIJA. El celular del Contacto se anota al nacer la cotizacion en un
// campo propio y no se recalcula nunca del telefono ni del celular de entrega
// que se tecleen despues: esos son datos del DOCUMENTO, no identidad. Corregir
// un telefono mal tecleado ya no mueve la Oportunidad a otra persona.
//
// Para lo ya existente (84 cotizaciones anteriores al campo) la liga se resuelve
// una sola vez con las cuatro fuentes del ticket, en orden, y el script de
// migracion la escribe. Riesgo aceptado por el dueno (ADR-0016): una sucursal
// con telefono compartido puede colgar una Oportunidad vieja a otra persona.

import { ultimos10 } from './telefono-llave.js';

export const FUENTES = {
  // Ya tenia campo propio: no se toca (idempotencia del script).
  ANOTADO: 'anotado',
  // (1) el telefono anotado en la cotizacion es de un Contacto que ya existe.
  CRUCE: 'cruce',
  // (2) el telefono anotado no es de nadie todavia: nace un Contacto sin
  // etiqueta prospecto, ligado al Cliente Operam de la cotizacion.
  TELEFONO: 'telefono',
  // (3) la cotizacion no anoto telefono: respaldo por el indice de Operam bajo
  // su customer_id.
  OPERAM: 'operam',
};

// (4) nada de lo anterior dio numero: la Oportunidad queda "sin Contacto" a la
// vista, para capturarle el celular a mano desde la tarjeta.
export const MOTIVO_SIN_CONTACTO = 'sin_telefono';

// El orden del respaldo de Operam (spec #337, user story 28): el Cel primero
// porque es el numero mas probable de WhatsApp, y el Telefono Secundario al
// final porque es el menos personal. La casilla la etiqueta el enumerador del
// indice de telefonos (lib/indice-telefonos.js); aqui solo se ordena.
export const ORDEN_CASILLA = ['cel', 'telefono', 'telefono_secundario'];

// La identidad del Contacto ES el numero (CONTEXT.md "Contacto"): 10 digitos
// exactos, la misma llave del store de prospectos y del indice de Operam. Un
// numero mas corto no identifica a nadie y no produce llave. Exportada porque la
// captura a mano del Contacto (POST /api/cotizacion/:id/contacto) valida con
// ESTA regla y no con una propia.
export function llaveContacto(telefono) {
  const diez = ultimos10(telefono);
  return diez.length === 10 ? diez : null;
}

// El celular que se ANOTA al nacer la cotizacion. Manda el telefono de los datos
// del cliente de la cotizacion (es el obligatorio del formulario y el que mueve
// el embudo en el hook de cotizacion); el celular de entrega es el respaldo.
export function celularAlNacer(cliente) {
  const c = cliente || {};
  return llaveContacto(c.telefono) || llaveContacto(c.celEntrega);
}

// El campo propio ya anotado, o null si la cotizacion es anterior a #342.
export function celularAnotado(cotizacion) {
  return llaveContacto(cotizacion && cotizacion.contactoCelular);
}

// Los celulares con los que la cotizacion cruza contra un Contacto. Con campo
// propio es UNO y solo uno -- esa es la liga fija. Sin el (historica sin migrar)
// se conserva el cruce de siempre por lo tecleado, telefono y celular de
// entrega, para no perder ligas mientras la migracion no ha corrido.
export function celularesDeCruce(cotizacion) {
  const anotado = celularAnotado(cotizacion);
  if (anotado) return [anotado];
  const cli = (cotizacion && cotizacion.data && cotizacion.data.cliente) || {};
  return [llaveContacto(cli.telefono), llaveContacto(cli.celEntrega)].filter(Boolean);
}

// El Cliente Operam de la cotizacion: el que ella misma anoto al subirse
// (`data.cliente.customerId`), o el que el caller ya resolvio por otra via.
//
// El respaldo del caller no es un lujo: las 40 cotizaciones sin telefono son las
// que dejo el backfill (#76) y su `data.cliente` solo trae rfc, customer_ref y
// contacto de entrega -- NO el customer_id. El que si lo tiene es su pedido de
// Operam (`data.orderOperam`), donde viaja como `debtor_no`. Esa lectura es IO y
// por eso vive en el script; aqui solo se acepta el resultado.
function clienteOperamDe(cotizacion) {
  const cli = (cotizacion && cotizacion.data && cotizacion.data.cliente) || {};
  const resuelto = cotizacion ? cotizacion.clienteOperam : null;
  return resuelto ?? cli.customerId ?? null;
}

// El primer telefono del Cliente Operam por orden de casilla. Dentro de la misma
// casilla gana el primero enumerado (el orden en que Operam entrega contactos y
// sucursales).
function celularDeOperam(clienteOperam, telefonosOperam) {
  if (clienteOperam == null || !telefonosOperam) return null;
  const candidatos = telefonosOperam.get(String(clienteOperam)) || [];
  for (const casilla of ORDEN_CASILLA) {
    for (const c of candidatos) {
      if (c.casilla !== casilla) continue;
      const k = llaveContacto(c.telefono);
      if (k) return { contacto: k, casilla, telefono: c.telefono };
    }
  }
  return null;
}

// El plan completo de la migracion: un renglon por cotizacion con su Contacto,
// su fuente y si hay que crear la ficha del Contacto. Puro: el script lo imprime
// tal cual en el dry-run y lo ejecuta con --apply.
//
// La `fuente` se decide SIEMPRE contra los Contactos que existian ANTES de la
// migracion -- si un Contacto recien creado contara como cruce, el conteo del
// log dejaria de ser comparable con lo medido (30 cruzan / 14 con telefono / 40
// sin telefono). Lo unico que la creacion cambia es `crear`, para que dos
// cotizaciones del mismo celular nuevo no intenten dar de alta dos veces al
// mismo Contacto.
export function planearMigracion(cotizaciones, { contactos, telefonosOperam } = {}) {
  const porCrear = new Set();
  return (cotizaciones || []).map(c => {
    const r = contactoDeCotizacion(c, { contactos, telefonosOperam });
    const nuevo = r.crear && !porCrear.has(r.contacto);
    if (r.crear) porCrear.add(r.contacto);
    return { id: c.id, ...r, crear: nuevo };
  });
}

// Marca del Contacto que NADIE capturo (#342, AC5): el que nace de la migracion
// porque una cotizacion historica necesitaba de quien ser. No lleva etiqueta
// prospecto (nunca hubo captura) y por eso la ficha lo muestra como venido de
// Operam. Un solo predicado para que el tablero, la ficha y las etiquetas de
// #344 no puedan discrepar sobre que significa.
export function esContactoSinCaptura(contacto) {
  return !!(contacto && contacto.data && contacto.data.sinCaptura === true);
}

// La cotizacion, el mapa de Contactos por celular (Set de llaves de 10 digitos)
// y el indice de Operam (Map customer_id -> [{telefono, casilla}]) -> el
// Contacto con su fuente, o "sin Contacto" con motivo.
export function contactoDeCotizacion(cotizacion, { contactos, telefonosOperam } = {}) {
  const conocidos = contactos || new Set();
  const anotado = celularAnotado(cotizacion);
  if (anotado) return { contacto: anotado, fuente: FUENTES.ANOTADO, crear: false };

  const clienteOperam = clienteOperamDe(cotizacion);
  const cli = (cotizacion && cotizacion.data && cotizacion.data.cliente) || {};
  // `telefono` es el numero TAL COMO estaba escrito, para que la ficha del
  // Contacto que se cree guarde lo mismo que guarda una captura (con lada
  // internacional si la traia) y no diez digitos pelados, que un numero
  // extranjero no puede reconstruir.
  const tecleado = llaveContacto(cli.telefono) ? cli.telefono : (llaveContacto(cli.celEntrega) ? cli.celEntrega : null);
  if (tecleado) {
    const llave = llaveContacto(tecleado);
    if (conocidos.has(llave)) return { contacto: llave, fuente: FUENTES.CRUCE, crear: false };
    return { contacto: llave, telefono: tecleado, fuente: FUENTES.TELEFONO, crear: true, clienteOperam };
  }

  const deOperam = celularDeOperam(clienteOperam, telefonosOperam);
  if (deOperam) {
    return {
      contacto: deOperam.contacto,
      telefono: deOperam.telefono,
      fuente: FUENTES.OPERAM,
      casilla: deOperam.casilla,
      crear: !conocidos.has(deOperam.contacto),
      clienteOperam,
    };
  }

  return { contacto: null, motivo: MOTIVO_SIN_CONTACTO, crear: false };
}
