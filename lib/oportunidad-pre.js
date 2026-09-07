// La Oportunidad pre-cotizacion vive aparte del Contacto (#343, spec #337,
// ADR-0016, CONTEXT.md "Contacto" / "Oportunidad"). Nucleo PURO, sin IO.
//
// Hasta este ticket la fila de `prospectos` guardaba dos cosas juntas: la
// PERSONA (celular, nombre, ciudad, origen, correo, empresa, tipo, ligas) y su
// primera INTENCION DE COMPRA (vendedor, etapa, eventos, toques, reunion,
// siguiente contacto). Por eso quien ya habia cotizado no podia volver a
// preguntar: su celular ya era prospecto y no habia donde anotar el interes
// nuevo. Aqui la intencion se separa: un Contacto, varias Oportunidades.
//
// Dos estados conviven a proposito, porque el deploy llega antes que el
// `--apply` de la migracion:
//
//   - Oportunidad PROPIA: tiene su registro en la tabla `oportunidades`. Nace
//     asi la "Nueva oportunidad" y ahi deja la migracion lo ya existente.
//   - Oportunidad SINTETIZADA: el Contacto todavia no se separa, asi que su
//     propia fila ES su Oportunidad, con su mismo id. Es exactamente el
//     comportamiento anterior a este ticket.
//
// La lectura fusiona las dos formas en UNA sola fila con la forma que ya
// consumian el tablero, la cola Hoy y la Tabla de prospectos; la escritura va a
// donde la Oportunidad vive (lib/oportunidad-pre-io.js).

import { ultimos10 } from './telefono-llave.js';
import { esSalida } from './pipeline.js';
import { esContactoSinCaptura } from './contacto-cotizacion.js';
import { cotizacionesDelProspecto, cotizacionesVivas } from './tabla-prospectos.js';

// Motivos por los que un Contacto no genera registro de Oportunidad. Viajan al
// log del script para que la migracion sea auditable (spec #337, user story 27).
export const MOTIVO_YA_SEPARADA = 'ya_separada';
export const MOTIVO_SIN_CAPTURA = 'sin_captura';
export const MOTIVO_ES_LA_COTIZACION = 'la_cotizacion_es_la_oportunidad';

function llaveDe(contacto) {
  return (contacto && contacto.celular10) || ultimos10(contacto && contacto.celular);
}

// La fila que consumen el tablero, la cola Hoy y la Tabla de prospectos: los
// datos de la PERSONA salen del Contacto y los de la INTENCION de la
// Oportunidad. `data` se mezcla en ese orden porque el folio capturado a mano
// (#56) es de la Oportunidad y el resto (empresa, correo, tipo, cliente_id, el
// evento de expo) es del Contacto.
function fusionar(contacto, oportunidad) {
  const propia = !!oportunidad;
  const o = oportunidad || contacto;
  return {
    id: o.id,
    propia,
    contactoId: contacto.id,
    fecha: o.fecha,
    vendedor: o.vendedor ?? null,
    etapa: o.etapa,
    eventos: o.eventos || [],
    celular: contacto.celular,
    celular10: llaveDe(contacto),
    nombre: contacto.nombre,
    ciudad: contacto.ciudad,
    canal: contacto.canal,
    data: { ...(contacto.data || {}), ...(propia ? (o.data || {}) : {}) },
  };
}

// Todas las Oportunidades de los Contactos dados. Una fila de `oportunidades`
// cuyo Contacto no esta en la lista NO produce fila: sin Contacto no hay
// Oportunidad (ADR-0016), y asi la visibilidad del Contacto sigue acotando lo
// que se ve, igual que antes de la separacion.
export function oportunidadesDeContactos(contactos, oportunidades) {
  const porContacto = new Map();
  for (const o of oportunidades || []) {
    if (!porContacto.has(o.contactoId)) porContacto.set(o.contactoId, []);
    porContacto.get(o.contactoId).push(o);
  }
  const filas = [];
  for (const c of contactos || []) {
    const propias = (porContacto.get(c.id) || []).filter(o => o.contacto10 === llaveDe(c));
    if (!propias.length) {
      filas.push(fusionar(c, null));
      continue;
    }
    for (const o of propias.slice().sort((a, b) => a.id - b.id)) filas.push(fusionar(c, o));
  }
  return filas;
}

// Una fila por Contacto para las vistas que hablan de PERSONAS (el buscador del
// paso Cliente y la lista de prospectos): manda la Oportunidad activa mas
// reciente, y si todas salieron del embudo, la mas reciente. Sin esto la misma
// persona volveria a salir dos veces en el buscador, que es justo lo que
// ADR-0016 viene a quitar.
export function principalPorContacto(filas) {
  const mejor = new Map();
  for (const f of filas || []) {
    const previa = mejor.get(f.contactoId);
    if (!previa || ganaComoPrincipal(f, previa)) mejor.set(f.contactoId, f);
  }
  return [...mejor.values()];
}

function ganaComoPrincipal(a, b) {
  const activaA = esSalida(a.etapa) ? 0 : 1;
  const activaB = esSalida(b.etapa) ? 0 : 1;
  if (activaA !== activaB) return activaA > activaB;
  const fa = new Date(a.fecha || 0).getTime();
  const fb = new Date(b.fecha || 0).getTime();
  if (fa !== fb) return fa > fb;
  return a.id > b.id;
}

// La Oportunidad que una cotizacion nueva hace avanzar (#343). Con una sola por
// Contacto -- lo de siempre -- es esa y no hay nada que decidir. Con varias, la
// "mas reciente" seria una eleccion arbitraria que dejaria a la otra sin
// cotizacion para siempre (a una Oportunidad propia solo la representa la
// cotizacion que nacio de ELLA, por evento). Manda entonces la que TODAVIA puede
// avanzar por cotizar -- las de Seguimiento en adelante ya avanzaron -- y entre
// esas, la del mismo vendedor que cotiza; si ninguna puede, la principal, que es
// donde queda el evento como rastro.
const ETAPAS_QUE_AVANZAN_AL_COTIZAR = new Set(['por_cotizar', 'no_asignado']);

export function oportunidadQueCotiza(filas, vendedor) {
  const candidatas = (filas || []).filter(f => ETAPAS_QUE_AVANZAN_AL_COTIZAR.has(f.etapa));
  const propias = candidatas.filter(f => f.vendedor === vendedor);
  const pool = propias.length ? propias : candidatas;
  if (!pool.length) return principalPorContacto(filas)[0];
  return pool.reduce((mejor, f) => (mejor && !ganaComoPrincipal(f, mejor) ? mejor : f), null);
}

// El registro que nace con "Nueva oportunidad" (AC1/AC2): Por Cotizar, del
// vendedor que la abre, con evento de apertura. NO guarda origen -- el Origen es
// del Contacto y solo de el (#287, ADR-0016), y la tarjeta lo hereda.
export function filaNuevaOportunidad(contacto, vendedor, ahora = new Date()) {
  const fecha = ahora.toISOString();
  return {
    fecha,
    contactoId: contacto.id,
    contacto10: llaveDe(contacto),
    vendedor,
    etapa: 'por_cotizar',
    eventos: [{ tipo: 'apertura', fecha, vendedor }],
    data: {},
  };
}

// El registro que la migracion escribe por un Contacto todavia sin separar: su
// intencion tal cual estaba, con su etapa, sus eventos y el folio capturado a
// mano (#56). Lo que se queda en el Contacto son los datos de la persona.
function filaSeparada(contacto) {
  const data = {};
  const folio = contacto.data && contacto.data.folioOperam;
  if (folio != null && folio !== '') data.folioOperam = folio;
  return {
    // Conserva el id del Contacto (ver lib/oportunidades-store.js, espacio de
    // ids compartido): esta Oportunidad ya se identificaba asi en las rutas
    // mientras vivia en la fila del Contacto, y la separacion no tiene por que
    // renombrarla.
    id: contacto.id,
    fecha: contacto.fecha,
    contactoId: contacto.id,
    contacto10: llaveDe(contacto),
    vendedor: contacto.vendedor ?? null,
    etapa: contacto.etapa,
    eventos: contacto.eventos || [],
    data,
  };
}

// El plan de la separacion: un renglon por Contacto con lo que se va a crear y,
// cuando no se crea nada, por que. Puro -- el script lo imprime tal cual en el
// dry-run y lo ejecuta con --apply.
//
// Tres casos (ticket #343):
//   - Contacto en No Asignado / Por Cotizar (o en cualquier etapa sin cotizacion
//     que lo represente) -> una Oportunidad con su etapa y sus eventos.
//   - Contacto cuya cotizacion VIVA ya es su Oportunidad -> ninguna. Es la misma
//     regla que decide las tarjetas del tablero desde #340: crear un registro
//     aqui devolveria la tarjeta inerte que ese ticket quito.
//   - Contacto en Seguimiento con folio capturado a mano y sin cotizacion en el
//     sistema -> una Oportunidad en Seguimiento con ese folio.
//
// Idempotente: un Contacto que ya tiene registro propio no genera ninguno.
export function planearSeparacion(contactos, cotizaciones, oportunidades) {
  const yaSeparados = new Set((oportunidades || []).map(o => o.contactoId));
  return (contactos || []).map(c => {
    if (yaSeparados.has(c.id)) return { contactoId: c.id, crear: false, motivo: MOTIVO_YA_SEPARADA };
    // Nadie lo capturo: el Contacto nacio de la migracion de #342 para que una
    // cotizacion historica tuviera de quien ser. No hay intencion que separar.
    if (esContactoSinCaptura(c)) return { contactoId: c.id, crear: false, motivo: MOTIVO_SIN_CAPTURA };
    if (cotizacionesVivas(cotizacionesDelProspecto(c, cotizaciones || [])).length) {
      return { contactoId: c.id, crear: false, motivo: MOTIVO_ES_LA_COTIZACION };
    }
    return { contactoId: c.id, crear: true, fila: filaSeparada(c) };
  });
}
