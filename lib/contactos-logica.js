// Nucleo PURO de la sincronizacion de contactos a la libreta de Google (spec
// #224, ticket #227; ADR-0013; CONTEXT.md "Contacto de Google"). Recibe el
// estado de las fuentes y el mapeo persistido, y devuelve un PLAN de escrituras.
// SIN red, SIN IO: no conoce Google ni Operam. La envoltura (lib/contactos-io.js)
// ejecuta el plan y no decide nada. Mismo reparto que sync-operam.js frente a
// sync-operam-io.js y alerta-mayoreo.js frente a alerta-mayoreo-io.js.

import { ultimos10 } from './telefono-llave.js';

// EL formato del telefono, en un solo punto. MEDIDO en el Android real (#226,
// 2026-08-21): E.164 limpio -- "+52" y los diez digitos, SIN el "1" que la
// documentacion de WhatsApp sigue pidiendo. El comportamiento observado manda
// sobre la documentacion; quien quiera "corregirlo" que lea antes el resultado
// de #226. Si algun dia WhatsApp cambia, cambia esta funcion y su prueba, nada mas.
//
// La llave del mapeo NO es esta cadena, sino ultimos10 (ver mapaPorCelular): si
// fueran la misma, cambiar el formato huerfanaria las fichas ya creadas y la
// siguiente pasada las duplicaria en lugar de corregirlas.
export function aFormatoWhatsApp(celular) {
  const digitos = String(celular || '').replace(/\D/g, '');
  if (!digitos) return '';
  // 521XXXXXXXXXX -> 52XXXXXXXXXX ; XXXXXXXXXX (sin codigo) -> 52XXXXXXXXXX.
  return '+' + digitos.replace(/^521(?=\d{10}$)/, '52').replace(/^(?=\d{10}$)/, '52');
}

function limpio(v) {
  return String(v == null ? '' : v).trim();
}

// El nombre visible del Contacto de Google: "Persona - Empresa", con la ciudad
// como respaldo cuando no hay empresa declarada (CONTEXT.md "Contacto de
// Google"). La forma la impone el medio: WhatsApp muestra UNICAMENTE el nombre
// -- nunca el campo de organizacion -- y lo corta alrededor de los 25
// caracteres, asi que lo que va primero es lo que sobrevive. Sin persona cae a
// lo que haya (empresa, luego ciudad): un nombre util, jamas una cadena vacia.
export function nombreVisible({ persona, empresa, ciudad } = {}) {
  const quien = limpio(persona);
  const contexto = limpio(empresa) || limpio(ciudad);
  if (!quien) return contexto;
  return contexto ? `${quien} - ${contexto}` : quien;
}

// Los campos de la ficha que la sincronizacion escribe. La mascara de una
// entrada del plan NOMBRA CUALES de estos se reemplazan, y es explicita por
// entrada porque difiere segun la clase del Contacto de Google (ADR-0013): el
// PROPIO se reescribe entero; el ADOPTADO (#229) solo cambia de nombre y
// organizacion, y deja intactos telefonos, correos y direcciones. La razon es
// mecanica y no de gusto: la actualizacion de Google REEMPLAZA los campos de la
// mascara en vez de fusionarlos, asi que meter el telefono en la mascara de un
// adoptado borraria los demas numeros que una persona guardo a mano, cada
// quince minutos, indefinidamente. Unificar las dos mascaras reintroduce ese
// borrado silencioso.
export const MASCARA_PROPIO = ['nombreVisible', 'telefono', 'correo', 'organizacion', 'origen'];

// Mascara por clase de Contacto de Google. Solo esta la propia: la adoptada la
// registra #229 junto con la logica que la produce. Una clase que no aparezca
// aqui NO se escribe -- cae del lado seguro a proposito, porque el fallo caro es
// pisar un contacto ajeno con la mascara ancha, no dejar de corregir un nombre.
const MASCARAS = { propio: MASCARA_PROPIO };

// Huella de la ficha: lo que permite que la SEGUNDA pasada sobre el mismo
// estado no escriba nada. Se compara contra la huella persistida en el mapeo, no
// contra lo que Google devuelve (releer Google para saber que existe produce
// duplicados: su busqueda corre sobre un cache perezoso y las escrituras tardan
// minutos en verse). Se calcula SOBRE LA MASCARA: un campo que esa clase no
// escribe no puede provocar una escritura cada quince minutos.
export function huellaFicha(ficha, mascara = MASCARA_PROPIO) {
  return mascara.map(campo => `${campo}=${ficha[campo]}`).join('|');
}

function fichaDeProspecto(prospecto) {
  const data = prospecto.data || {};
  const empresa = limpio(data.empresa);
  return {
    celular10: ultimos10(prospecto.celular),
    nombreVisible: nombreVisible({ persona: prospecto.nombre, empresa, ciudad: prospecto.ciudad }),
    telefono: aFormatoWhatsApp(prospecto.celular),
    correo: limpio(data.correo),
    organizacion: empresa,
    origen: `cotizador:prospecto:${prospecto.id}`,
  };
}

// El plan de escrituras. Entra el estado de las fuentes y el mapeo persistido
// (celular normalizado -> resourceName + etag + clase + huella); sale que hay
// que crear, que actualizar (con su mascara) y que marcar inactivo. Tres listas
// y NINGUNA de borrado: nada se borra nunca (ADR-0013).
//
// Alcance de #227: solo prospectos, y solo la clase propia. Los clientes de
// Operam (#228, que GANAN al prospecto cuando comparten celular), la adopcion
// de contactos ajenos (#229) y el marcado de inactivos (#231) entran por esta
// misma forma sin cambiarla: los clientes se aplican DESPUES de los prospectos
// sobre el mismo mapa por celular, y `inactivar` ya existe vacia.
export function planificarContactos({ prospectos = [], mapeo = [] } = {}) {
  const conocidos = new Map((mapeo || []).map(m => [m.celular10, m]));
  const deseadas = new Map();
  for (const prospecto of prospectos || []) {
    const ficha = fichaDeProspecto(prospecto);
    if (!ficha.celular10 || !ficha.telefono) continue;
    deseadas.set(ficha.celular10, ficha);
  }

  const crear = [];
  const actualizar = [];
  for (const [celular10, ficha] of deseadas) {
    const existente = conocidos.get(celular10);
    if (!existente) {
      // Al crear no hay nada ajeno que preservar: la ficha nace entera.
      crear.push({ celular10, ficha, huella: huellaFicha(ficha), clase: 'propio', mascara: MASCARA_PROPIO });
      continue;
    }
    const mascara = MASCARAS[existente.clase];
    if (!mascara) continue; // clase sin mascara registrada: no se toca (ver MASCARAS)
    const huella = huellaFicha(ficha, mascara);
    if (existente.huella === huella) continue; // nada cambio: cero escrituras
    actualizar.push({
      celular10, ficha, huella, mascara, clase: existente.clase,
      resourceName: existente.resourceName, etag: existente.etag,
    });
  }

  // Vacia en #227: el marcado de inactivos es #231. La lista existe para que el
  // contrato del plan no cambie cuando llegue.
  return { crear, actualizar, inactivar: [] };
}
