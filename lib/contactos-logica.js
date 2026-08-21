// Nucleo PURO de la sincronizacion de contactos a la libreta de Google (spec
// #224, tickets #227 y #228; ADR-0013; CONTEXT.md "Contacto de Google"). Recibe el
// estado de las fuentes y el mapeo persistido, y devuelve un PLAN de escrituras.
// SIN red, SIN IO: no conoce Google ni Operam. La envoltura (lib/contactos-io.js)
// ejecuta el plan y no decide nada. Mismo reparto que sync-operam.js frente a
// sync-operam-io.js y alerta-mayoreo.js frente a alerta-mayoreo-io.js.

import { ultimos10 } from './telefono-llave.js';
import { normalizarNombreFiscal } from './referencia-cliente.js';

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

// CANDADO (ADR-0013, #229). Esta mascara corta es la unica razon de ser de la
// adopcion: el contacto ya existia en la libreta, lo escribio una persona a
// mano, y lo unico que se le corrige es como se lee. NUNCA lleva `telefono`,
// `correo` ni direcciones. Meterlos "para que quede consistente" no agrega un
// campo: BORRA el fijo de la oficina, el segundo celular y el correo personal
// que esa persona guardo, en cada pasada, cada quince minutos, para siempre y
// sin dejar rastro -- porque la actualizacion de Google REEMPLAZA los campos de
// la mascara en vez de fusionarlos. Unificarla con MASCARA_PROPIO reintroduce
// ese borrado silencioso; su prueba esta escrita como candado por eso mismo.
//
// Son TRES campos y no dos: #224 ("Propio y adoptado") lo fija como "nombre,
// organizacion y la marca de origen". El texto de #229 menciona solo el nombre y
// la marca, y por eso `organizacion` parece de mas -- no lo es.
//
// Los tres campos que SI lleva reemplazan lo que hubiera: el nombre (que es el
// punto del ticket), la organizacion, y los campos definidos por el usuario, que
// pasan a ser solo la marca de origen. Si alguien hubiera guardado un campo
// personalizado propio en ese contacto, se pierde. Es el limite de lo que
// #229 pide escribir y esta asumido; los datos de contacto -- telefonos,
// correos, direcciones -- son los que no se tocan jamas.
export const MASCARA_ADOPTADO = ['nombreVisible', 'organizacion', 'origen'];

// Mascara por clase de Contacto de Google. Una clase que no aparezca aqui NO se
// escribe -- cae del lado seguro a proposito, porque el fallo caro es pisar un
// contacto ajeno con la mascara ancha, no dejar de corregir un nombre.
export const MASCARAS = { propio: MASCARA_PROPIO, adoptado: MASCARA_ADOPTADO };

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

// Como se llama un telefono de cliente que no trae persona. El rol solo entra
// aqui, NUNCA junto a un nombre de persona: WhatsApp corta el nombre visible
// alrededor de los 25 caracteres y "Laura Mendez - Facturacion - Cocinas..."
// perderia justo lo que importa. El contacto General sin nombre no recibe
// etiqueta a proposito -- "General" no le dice nada a quien contesta, y sin
// persona el nombre visible cae limpiamente a la empresa sola.
const ROL_SIN_PERSONA = { invoice: 'Facturacion', delivery: 'Entregas' };

// Un telefono de domicilio de entrega sin persona ni nombre de lugar. Es
// deliberadamente distinto de la empresa sola: quien contesta el WhatsApp tiene
// que poder distinguir el numero al que se ENTREGA del numero de quien compra.
const ETIQUETA_DOMICILIO = 'Entregas';

// Ficha de un TELEFONO de cliente de Operam (#228). La entrada la produce
// enumerarTelefonosClientes (lib/indice-telefonos.js), que es quien conoce la
// forma de Operam: aqui no se sabe que existen CustName, br_name ni action.
function fichaDeCliente(entrada) {
  // Nombre corto y NO nombre fiscal (CONTEXT.md): "COCINAS DEL VALLE SA DE CV"
  // en mayusculas del SAT es ilegible en una lista de chats. Cuando el cliente
  // no tiene nombre corto la razon social es lo unico que queda, y entra
  // normalizada a forma legible por el mismo escalon que usa la Referencia del
  // cliente -- nunca una cadena vacia.
  const nombreCorto = limpio(entrada.nombreCorto);
  const empresa = nombreCorto || normalizarNombreFiscal(limpio(entrada.razonSocial));
  const persona = limpio(entrada.persona) || (entrada.fuente === 'domicilio'
    ? (limpio(entrada.domicilio) || ETIQUETA_DOMICILIO)
    : (ROL_SIN_PERSONA[entrada.rol] || ''));
  return {
    celular10: ultimos10(entrada.telefono),
    // Ultimo respaldo: un cliente sin ningun nombre y un contacto sin persona
    // dejarian el nombre visible VACIO, que es exactamente lo que no puede pasar
    // (la ficha sin nombre no distingue nada de un numero pelado). El id del
    // cliente al menos se puede buscar en el ERP.
    nombreVisible: nombreVisible({ persona, empresa }) || `Cliente ${entrada.customerId}`,
    telefono: aFormatoWhatsApp(entrada.telefono),
    correo: limpio(entrada.correo),
    organizacion: empresa,
    origen: `cotizador:cliente:${entrada.customerId}`,
  };
}

// El plan de escrituras. Entra el estado de las fuentes y el mapeo persistido
// (celular normalizado -> resourceName + etag + clase + huella); sale que hay
// que crear, que actualizar (con su mascara) y que marcar inactivo. Tres listas
// y NINGUNA de borrado: nada se borra nunca (ADR-0013).
//
// Dos fuentes: los prospectos del cotizador (#227) y los telefonos de los
// clientes de Operam (#228), que GANAN al prospecto cuando comparten celular. El
// marcado de inactivos (#231) entra por esta misma forma sin cambiarla, y
// `inactivar` ya existe vacia.
//
// `libreta` (#229) es lo que Google tiene HOY, leido por la envoltura de forma
// paginada: `[{ resourceName, etag, telefonos: [<crudos>] }]`. Sirve para UNA
// sola pregunta -- este celular ya tiene contacto hecho a mano? -- y de ahi sale
// la adopcion. NO es autoridad de identidad: la autoridad es el mapeo persistido
// (lib/contactos-store.js). Sin `libreta` el plan se comporta como antes de
// #229, que es tambien lo que hace la envoltura si no logra leerla... salvo que
// la envoltura ni siquiera planifica en ese caso: crear a ciegas duplicaria los
// contactos ajenos, que es justo el bug que este ticket cierra.
export function planificarContactos({ prospectos = [], clientes = [], mapeo = [], libreta = [] } = {}) {
  const conocidos = new Map((mapeo || []).map(m => [m.celular10, m]));
  // Primero gana: si dos contactos de la libreta comparten celular (duplicados
  // que alguien dejo ahi), se adopta uno solo y el otro se deja en paz. Fusionar
  // o borrar duplicados preexistentes esta explicitamente fuera de alcance.
  const enLibreta = new Map();
  for (const contacto of libreta || []) {
    for (const telefono of contacto.telefonos || []) {
      const llave = ultimos10(telefono);
      if (llave.length === 10 && !enLibreta.has(llave)) enLibreta.set(llave, contacto);
    }
  }
  const deseadas = new Map();
  // Diez digitos exactos es lo que pide la llave de identidad
  // (lib/telefono-llave.js) y el mismo limite documentado del indice de
  // telefonos. Los telefonos de Operam traen basura ("1234", extensiones
  // sueltas): con menos de diez digitos no hay a quien escribirle, y una ficha
  // con un numero inservible ensucia la libreta para siempre, porque nada se
  // borra.
  const anotar = (ficha) => {
    if (ficha.celular10.length !== 10 || !ficha.telefono) return;
    deseadas.set(ficha.celular10, ficha);
  };
  for (const prospecto of prospectos || []) anotar(fichaDeProspecto(prospecto));
  // Los clientes se anotan DESPUES de los prospectos y sobre el mismo mapa: por
  // eso el cliente gana cuando el celular esta en las dos fuentes (ADR-0013). No
  // es un efecto lateral del orden -- es la regla, y moverlos arriba la invierte.
  for (const entrada of clientes || []) anotar(fichaDeCliente(entrada));

  const crear = [];
  const actualizar = [];
  for (const [celular10, ficha] of deseadas) {
    // La clase PERSISTIDA manda sobre lo que diga la libreta: un adoptado sigue
    // adoptado aunque la libreta se relea entera en cada pasada, y un propio
    // sigue propio aunque se lo encuentre ahi (que es lo normal -- lo creamos
    // nosotros). Recalcular la clase mirando Google convertiria a todo propio en
    // adoptado en la segunda pasada, y dejaria de corregir su telefono.
    const existente = conocidos.get(celular10);
    if (!existente) {
      const ajeno = enLibreta.get(celular10);
      if (ajeno) {
        // ADOPCION: el numero ya tenia contacto hecho a mano. No se crea otro
        // (dos fichas del mismo numero y WhatsApp elige una sin criterio
        // visible): se corrige lo que se lee y se deja intacto lo demas.
        actualizar.push({
          celular10, ficha, huella: huellaFicha(ficha, MASCARA_ADOPTADO),
          mascara: MASCARA_ADOPTADO, clase: 'adoptado',
          resourceName: ajeno.resourceName, etag: ajeno.etag,
        });
        continue;
      }
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
