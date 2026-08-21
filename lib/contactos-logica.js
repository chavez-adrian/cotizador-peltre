// Nucleo PURO de la sincronizacion de contactos a la libreta de Google (spec
// #224, tickets #227 y #228; ADR-0013; CONTEXT.md "Contacto de Google"). Recibe el
// estado de las fuentes y el mapeo persistido, y devuelve un PLAN de escrituras.
// SIN red, SIN IO: no conoce Google ni Operam. La envoltura (lib/contactos-io.js)
// ejecuta el plan y no decide nada. Mismo reparto que sync-operam.js frente a
// sync-operam-io.js y alerta-mayoreo.js frente a alerta-mayoreo-io.js.

import { ultimos10, sinExtension } from './telefono-llave.js';
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
//
// El mismo recorte de extension que ultimos10 (#247), y ANTES de quitar los
// no-digitos: sin el, "55 5395 2615 ext 116" escribia +525553952615116 en
// Google -- la llave del mapeo quedaba bien (ultimos10 ya recortaba) pero el
// numero que WhatsApp tenia que casar era basura.
export function aFormatoWhatsApp(celular) {
  const digitos = sinExtension(celular).replace(/\D/g, '');
  if (!digitos) return '';
  // 521XXXXXXXXXX -> 52XXXXXXXXXX ; XXXXXXXXXX (sin codigo) -> 52XXXXXXXXXX.
  return '+' + digitos.replace(/^521(?=\d{10}$)/, '52').replace(/^(?=\d{10}$)/, '52');
}

function limpio(v) {
  return String(v == null ? '' : v).trim();
}

// Compara dos cadenas ignorando mayusculas, acentos y espacios sobrantes (#247):
// asi "Ajijic Spot" y "AJIJIC SPOT" -- o "Ajijic Spot" y "Ajijic  Spot " -- se
// reconocen como la misma cosa sin que el vendedor haya escrito exactamente
// igual en los dos campos.
function mismaCadena(a, b) {
  if (!a || !b) return false;
  const normalizar = (s) => s.normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();
  return normalizar(a) === normalizar(b);
}

// La parte de PERSONA del nombre visible se normaliza a Titulo SOLO cuando
// viene toda en mayusculas (#247): Operam entrega el nombre del SAT/contacto
// asi, y "BRENDA GARCIA" grita en una lista de chats. Un nombre que ya viene en
// mixto es del vendedor o de una persona real y no se toca. Reusa la MISMA
// normalizacion que referencia-cliente.js aplica a la razon social -- no
// inventa otra --, con la unica diferencia de activar { siglasCortas: true }:
// una persona puede traer una sigla comercial corta que esa lista no conoce
// ("MAG IMPRESIONES"); ver el comentario de esSiglaCorta ahi para el porque no
// es el default.
function normalizarPersonaVisible(persona) {
  if (!persona || !/\p{L}/u.test(persona) || persona !== persona.toUpperCase()) return persona;
  return normalizarNombreFiscal(persona, { siglasCortas: true });
}

// El nombre visible del Contacto de Google: "Persona - Empresa", con la ciudad
// como respaldo cuando no hay empresa declarada (CONTEXT.md "Contacto de
// Google"). La forma la impone el medio: WhatsApp muestra UNICAMENTE el nombre
// -- nunca el campo de organizacion -- y lo corta alrededor de los 25
// caracteres, asi que lo que va primero es lo que sobrevive. Sin persona cae a
// lo que haya (empresa, luego ciudad): un nombre util, jamas una cadena vacia.
//
// Cuando persona y empresa/ciudad son la misma cadena (#247: el contacto
// General de Operam suele llevar como nombre el de la empresa, ct.name ==
// cust_ref) el resultado se colapsa a una sola vez -- "Ajijic Spot", nunca
// "Ajijic Spot - Ajijic Spot". La organizacion NO se normaliza por este
// ticket: solo la persona.
export function nombreVisible({ persona, empresa, ciudad } = {}) {
  const quien = normalizarPersonaVisible(limpio(persona));
  const contexto = limpio(empresa) || limpio(ciudad);
  if (!quien) return contexto;
  if (mismaCadena(quien, contexto)) return quien;
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

// TOPE DE SEGURIDAD de la inactivacion (#231). La pregunta que contesta no es
// "cuantas fichas puede perder el sistema en un dia" sino "cuantas puede perder
// DE GOLPE sin que lo mas probable sea un fallo de fuente". Un cliente que
// cambia de numero o un prospecto que se borra son uno o dos por pasada; que se
// caiga la quinta parte del padron en quince minutos no pasa en la operacion
// real -- pasa cuando Operam responde a medias.
//
// Dos condiciones a la vez, y las dos hacen falta:
//   - PROPORCION: mas del 20% de las fichas propias activas. Sola, en un mapeo
//     de tres fichas cualquier baja normal la superaria y el tope frenaria para
//     siempre lo que existe para permitir.
//   - PISO absoluto: mas de 5 fichas. Solo, un padron de mil fichas se
//     inactivaria entero de a seis por pasada sin que nadie se entere.
export const TOPE_INACTIVACION_PROPORCION = 0.20;
export const TOPE_INACTIVACION_PISO = 5;

// El freno NO es un error de Google: es un error de DATOS, y va etiquetado como
// tal para que el panel de #230 lo pinte junto a los demas sin que la
// clasificacion por texto tenga que adivinarlo.
function frenoDeInactivacion(candidatos, propiasActivas) {
  if (candidatos <= TOPE_INACTIVACION_PISO) return null;
  if (candidatos <= propiasActivas * TOPE_INACTIVACION_PROPORCION) return null;
  return {
    categoria: 'datos',
    motivo: `tope de inactivacion: ${candidatos} de ${propiasActivas} fichas propias activas se quedaron sin respaldo en una sola pasada (mas del ${Math.round(TOPE_INACTIVACION_PROPORCION * 100)}%). No se inactivo ninguna: una desaparicion asi es casi siempre un fallo de la fuente, no una baja real.`,
  };
}

// SIN EVIDENCIA NO HAY DESAPARICION (#231). Una ficha se inactiva porque su
// celular ya NO esta en las fuentes; si una de las dos fuentes no se pudo leer,
// esa ausencia no prueba nada.
//
// La fuente de clientes no avisa cuando falla: clientesCacheados()
// (lib/indice-telefonos.js) atrapa el error de Operam y devuelve [], asi que
// desde aqui "Operam caido" y "no hay clientes" son literalmente el mismo dato.
// Sin poder distinguirlos se toma el lado seguro -- que es tambien el unico
// realista: el padron de Operam nunca esta vacio de verdad.
//
// Es la MISMA garantia que ya protege a las otras dos fuentes, por otro camino:
// prospectosStore.listar() propaga su fallo y tumba la pasada entera antes de
// llegar aqui, y una libreta ilegible la aborta en la envoltura
// (`omitido: 'libreta ilegible'`). Solo los clientes necesitan regla propia,
// porque son la unica fuente que falla en silencio.
//
// El freno es TOTAL y no selectivo por origen: se cae tambien la baja de un
// prospecto que nada tiene que ver con Operam. Es deliberado y tiene precio --
// esa baja legitima espera a la siguiente pasada. Distinguirlas exigiria que el
// mapeo persistiera el origen de cada ficha, y el precio de equivocarse en el
// otro sentido (etiquetar de golpe medio padron por una caida de Operam) es el
// que no se puede deshacer.
function sinEvidenciaDeDesaparicion(clientes) {
  if ((clientes || []).length > 0) return null;
  return {
    categoria: 'datos',
    motivo: 'fuente de clientes vacia: Operam no devolvio ningun telefono en esta pasada, y eso es indistinguible de una caida. No se inactivo ninguna ficha: sin la fuente completa no hay evidencia de que un origen haya desaparecido.',
  };
}

// El plan de escrituras. Entra el estado de las fuentes y el mapeo persistido
// (celular normalizado -> resourceName + etag + clase + huella + inactivoDesde);
// sale que hay que crear, que actualizar (con su mascara) y que marcar inactivo,
// mas los `errores` de lo que el propio plan decidio NO aplicar. Tres listas de
// escritura y NINGUNA de borrado: nada se borra nunca (ADR-0013).
//
// Dos fuentes: los prospectos del cotizador (#227) y los telefonos de los
// clientes de Operam (#228), que GANAN al prospecto cuando comparten celular.
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
    // REACTIVACION (#231): el origen reaparecio. La entrada sale SIEMPRE, aunque
    // la huella coincida -- hay que sacarla del grupo Inactivo y limpiar la
    // marca, y "nada cambio, cero escrituras" la dejaria inactiva para siempre.
    const reactivar = Boolean(existente.inactivoDesde);
    if (!reactivar && existente.huella === huella) continue; // nada cambio: cero escrituras
    actualizar.push({
      celular10, ficha, huella, mascara, clase: existente.clase,
      resourceName: existente.resourceName, etag: existente.etag,
      ...(reactivar ? { reactivar: true } : {}),
    });
  }

  // Lo que perdio respaldo (#231): una ficha PROPIA cuyo celular ya no aparece
  // en ninguna de las dos fuentes. No se borra -- se marca inactiva y deja de
  // actualizarse (ADR-0013, "Bajas").
  const errores = [];
  const inactivar = [];
  let propiasActivas = 0;
  for (const ficha of mapeo || []) {
    // Un ADOPTADO no pasa de aqui, y es la mitad de este ticket: no era nuestro.
    // Que su origen desaparezca del sistema no autoriza a etiquetar el contacto
    // de alguien mas (ADR-0013). Su prueba esta escrita como candado.
    if (ficha.clase !== 'propio') continue;
    if (ficha.inactivoDesde) continue; // ya esta inactiva: no se re-escribe cada quince minutos
    propiasActivas += 1;
    if (deseadas.has(ficha.celular10)) continue;
    inactivar.push({ celular10: ficha.celular10, resourceName: ficha.resourceName });
  }

  // El freno solo se evalua cuando hay algo que frenar: reportarlo en cada
  // pasada sin candidatos dejaria el barrido permanentemente "con errores" ante
  // el panel de #230, y con eso el correo diario de una averia inexistente.
  const freno = inactivar.length > 0 &&
    (sinEvidenciaDeDesaparicion(clientes) || frenoDeInactivacion(inactivar.length, propiasActivas));
  if (freno) {
    errores.push(freno);
    inactivar.length = 0;
  }

  return { crear, actualizar, inactivar, errores };
}
