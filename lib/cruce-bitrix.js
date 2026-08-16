// Nucleo PURO del cruce del export de Bitrix24 contra el cotizador y Operam
// (issue #159, padre #155). Sin IO: recibe el export ya parseado y los conjuntos
// de identidades de nuestros sistemas, y clasifica cada identidad de Bitrix en
// (a) ya existe, (b) prospecto vivo sin presencia, (c) resto historico.
// Mismo patron que lib/cruce-identidad.js (#123) y lib/backfill-operam.mjs (#76):
// el nucleo decide, el script one-off hace el IO.
import { ultimos10 } from './telefono-llave.js';
// Misma normalizacion de nombre que la deduplicacion de clientes (ADR-0001):
// minusculas, sin acentos, sin articulos/preposiciones/sufijos corporativos.
import { normalizarNombre } from './deduplicacion.js';

// Los telefonos de Bitrix son campos MULTIPLES: PHONE es un array de
// {VALUE, VALUE_TYPE}. La llave de identidad es la MISMA del resto del sistema
// (ultimos10, lib/telefono-llave.js): un numero de menos de 10 digitos no
// produce llave -- limite documentado, no se adivina la LADA faltante.
export function llavesTelefono(registro) {
  const llaves = [];
  for (const campo of registro && registro.PHONE ? registro.PHONE : []) {
    const llave = ultimos10(campo && campo.VALUE);
    if (llave.length === 10) llaves.push(llave);
  }
  return llaves;
}

// Distingue un numero nacional de uno extranjero. NO afecta la clasificacion:
// es un aviso para el reporte, porque una taqueria en Monterrey y un
// restaurante en Canada no son la misma venta y conviene que se vea.
// Regla: 10 digitos = nacional (Bitrix le pega un "+" a muchos numeros
// mexicanos capturados sin lada de pais, "+2225592022"); con mas digitos manda
// la lada de pais, y solo 52 es Mexico.
export function esTelefonoMexicano(raw) {
  const sinExt = String(raw == null ? '' : raw).split(/ext/i)[0].split(',')[0];
  const digitos = sinExt.replace(/\D/g, '');
  if (digitos.length <= 10) return true;
  return digitos.startsWith('52');
}

// Llave SECUNDARIA: el correo, normalizado a minusculas y sin espacios. Solo
// sirve para cruzar contra nuestros sistemas; NO fusiona identidades dentro de
// Bitrix, porque un buzon compartido ("ventas@", "info@") juntaria a personas
// distintas de la misma empresa en un solo candidato.
export function normalizarCorreo(raw) {
  const limpio = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpio)) return null;
  return limpio;
}

// Normalizacion de nombres para la importacion (#159, pedido explicito de
// Adrian: los datos de Bitrix vienen en mayusculas sostenidas o todo minusculas
// segun quien los capturo). Particulas en minuscula salvo al inicio.
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'di', 'van', 'von']);

function capitalizar(palabra) {
  const bajo = palabra.toLocaleLowerCase('es-MX');
  return bajo.charAt(0).toLocaleUpperCase('es-MX') + bajo.slice(1);
}

export function nombrePropio(raw) {
  const limpio = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
  if (!limpio) return limpio;
  return limpio.split(' ').map((palabra, i) => {
    const bajo = palabra.toLocaleLowerCase('es-MX');
    if (i > 0 && PARTICULAS.has(bajo)) return bajo;
    return capitalizar(palabra);
  }).join(' ');
}

// Empresas: misma regla pero conservadora — una palabra en mayusculas de hasta 3
// letras se respeta como sigla (BGE, IHG) y una palabra ya mixta se deja intacta
// (Big Green Egg, iPhone); solo se corrige lo que viene TODO en mayusculas o
// todo en minusculas.
export function empresaPropia(raw) {
  const limpio = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
  if (!limpio) return limpio;
  return limpio.split(' ').map((palabra, i) => {
    const bajo = palabra.toLocaleLowerCase('es-MX');
    const esMayusculas = palabra === palabra.toLocaleUpperCase('es-MX');
    const esMinusculas = palabra === bajo;
    if (esMayusculas && esMinusculas) return palabra; // numeros, signos
    if (i > 0 && PARTICULAS.has(bajo)) return bajo; // DE/LA/... antes que sigla
    if (esMayusculas && palabra.length <= 3) return palabra; // sigla
    if (!esMayusculas && !esMinusculas) return palabra; // ya viene mixta
    return capitalizar(palabra);
  }).join(' ');
}

export function llavesCorreo(registro) {
  const llaves = [];
  for (const campo of registro && registro.EMAIL ? registro.EMAIL : []) {
    const llave = normalizarCorreo(campo && campo.VALUE);
    if (llave) llaves.push(llave);
  }
  return llaves;
}

// Una compania NO es un prospecto: es el contexto de una persona (un prospecto
// del cotizador es alguien con celular). Las companias entran como identidad
// SOLO si estan huerfanas -- ningun lead ni contacto las refiere -- para que
// nada del export quede fuera de la clasificacion sin decirlo. Fusionarlas con
// sus contactos seria peor: dos personas de la misma empresa colapsarian en un
// solo candidato. En el export real 289 de 294 companias tienen contacto.
function companiasHuerfanas(e) {
  const referidas = new Set();
  for (const registro of [...(e.leads || []), ...(e.contactos || [])]) {
    if (registro.COMPANY_ID && registro.COMPANY_ID !== '0') referidas.add(registro.COMPANY_ID);
  }
  return (e.companias || []).filter(c => !referidas.has(c.ID));
}

function tipoYRegistros(exportBitrix) {
  const e = exportBitrix || {};
  return [
    ['lead', e.leads || []],
    ['contacto', e.contactos || []],
    ['compania', companiasHuerfanas(e)],
  ];
}

// Fusiona los registros de Bitrix en IDENTIDADES: el mismo humano repetido en
// un lead y en un contacto es UN candidato, no dos (dedup difusa dentro del
// propio Bitrix). Union-find sobre los registros, que se unen por DOS caminos:
//   - misma llave de telefono (dedup difusa: el mismo celular escrito distinto
//     en un lead y en un contacto es una sola persona);
//   - liga estructural del propio Bitrix (lead.CONTACT_ID). Es la MAS confiable
//     y la unica que rescata los 40 leads sin telefono del export real: 37 de
//     ellos apuntan a un contacto que si lo trae.
function crearUnionFind() {
  const padre = new Map();
  function raiz(x) {
    if (!padre.has(x)) padre.set(x, x);
    let r = x;
    while (padre.get(r) !== r) r = padre.get(r);
    let cursor = x;
    while (padre.get(cursor) !== r) {
      const siguiente = padre.get(cursor);
      padre.set(cursor, r);
      cursor = siguiente;
    }
    return r;
  }
  return {
    agregar: x => { raiz(x); },
    unir: (a, b) => { padre.set(raiz(a), raiz(b)); },
    raiz,
  };
}

export function identidadesBitrix(exportBitrix) {
  const registrosPorClave = new Map();
  const uf = crearUnionFind();

  for (const [tipo, registros] of tipoYRegistros(exportBitrix)) {
    for (const registro of registros) {
      const clave = `${tipo}:${registro.ID}`;
      registrosPorClave.set(clave, { tipo, id: registro.ID, registro });
      uf.agregar(clave);
    }
  }

  // Union por telefono compartido.
  const primeraClavePorTelefono = new Map();
  for (const [clave, { registro }] of registrosPorClave) {
    for (const t of llavesTelefono(registro)) {
      if (primeraClavePorTelefono.has(t)) uf.unir(clave, primeraClavePorTelefono.get(t));
      else primeraClavePorTelefono.set(t, clave);
    }
  }

  // Union por liga estructural lead <-> contacto. Una liga a un id inexistente
  // se ignora (el export puede referir a un registro borrado en Bitrix).
  for (const [clave, { tipo, registro }] of registrosPorClave) {
    if (tipo === 'lead' && registro.CONTACT_ID && registro.CONTACT_ID !== '0') {
      const destino = `contacto:${registro.CONTACT_ID}`;
      if (registrosPorClave.has(destino)) uf.unir(clave, destino);
    }
    if (tipo === 'contacto' && registro.LEAD_ID && registro.LEAD_ID !== '0') {
      const destino = `lead:${registro.LEAD_ID}`;
      if (registrosPorClave.has(destino)) uf.unir(clave, destino);
    }
  }

  const porRaiz = new Map();
  for (const [clave, entrada] of registrosPorClave) {
    const r = uf.raiz(clave);
    if (!porRaiz.has(r)) porRaiz.set(r, { telefonos: new Set(), correos: new Set(), origenes: [] });
    const identidad = porRaiz.get(r);
    for (const t of llavesTelefono(entrada.registro)) identidad.telefonos.add(t);
    for (const c of llavesCorreo(entrada.registro)) identidad.correos.add(c);
    identidad.origenes.push(entrada);
  }

  return [...porRaiz.values()];
}

// --- Clasificacion (issue #159) -------------------------------------------

// Ventana de "vivo" por defecto. El export de Bitrix cubre 2025-09 a 2026-07 y
// el grueso de la actividad tiene mas de 180 dias: Bitrix se abandono de hecho.
// 180 dias deja fuera esa cola muerta y conserva el flujo del formulario de
// mayoreo, que siguio entrando hasta 2026-07-30. Es un PARAMETRO, no un dogma:
// el reporte imprime la sensibilidad a 90/180/365 para que el dueno decida.
export const VENTANA_VIVO_DIAS = 180;

// Motivos por los que una identidad NO es candidata (van al historico).
export const SIN_CELULAR = 'sin-celular';
export const DESCARTADO_EN_BITRIX = 'descartado-en-bitrix';
export const SIN_SENAL_DE_VIDA = 'sin-senal-de-vida';

// Senales de vida. Basta UNA dentro de la ventana.
export const DEAL_ABIERTO = 'deal-abierto';
export const ACTIVIDAD_RECIENTE = 'actividad-reciente';
export const LEAD_EN_PROCESO = 'lead-en-proceso';
export const ALTA_RECIENTE = 'alta-reciente';

const MS_POR_DIA = 86400000;

// Bitrix entrega DOS formatos de fecha: ISO 8601 con offset (DATE_CREATE,
// LAST_ACTIVITY_TIME, CREATED) y "DD/MM/YYYY HH:MM:SS" en
// LAST_COMMUNICATION_TIME. new Date() lee el segundo como MM/DD y produce
// fechas en el FUTURO (9 casos reales en el export). Aqui solo se aceptan las
// ISO: una fecha ambigua no se adivina, se ignora.
export function fechaBitrix(valor) {
  if (!valor || typeof valor !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(valor)) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

function diasDesde(valor, hoy) {
  const d = fechaBitrix(valor);
  if (!d) return null;
  return (hoy.getTime() - d.getTime()) / MS_POR_DIA;
}

function dentroDeVentana(valor, hoy, ventanaDias) {
  const dias = diasDesde(valor, hoy);
  return dias !== null && dias <= ventanaDias;
}

// OWNER_TYPE_ID de crm.activity.list: constantes de Bitrix (Lead=1, Deal=2,
// Contact=3, Company=4). Mismo mapeo que usa scripts/export-bitrix.mjs.
const TIPO_POR_OWNER = { 1: 'lead', 2: 'deal', 3: 'contacto', 4: 'compania' };

function indexarActividades(actividades, hoy) {
  const porClave = new Map();
  for (const a of actividades || []) {
    const tipo = TIPO_POR_OWNER[Number(a.OWNER_TYPE_ID)];
    if (!tipo) continue;
    const clave = `${tipo}:${a.OWNER_ID}`;
    const dias = diasDesde(a.CREATED || a.LAST_UPDATED, hoy);
    const previo = porClave.get(clave);
    if (dias === null) continue;
    if (previo === undefined || dias < previo) porClave.set(clave, dias);
  }
  return porClave;
}

function indexarDeals(deals) {
  const porContacto = new Map();
  const porCompania = new Map();
  for (const d of deals || []) {
    if (d.CONTACT_ID && d.CONTACT_ID !== '0') {
      if (!porContacto.has(d.CONTACT_ID)) porContacto.set(d.CONTACT_ID, []);
      porContacto.get(d.CONTACT_ID).push(d);
    }
    if (d.COMPANY_ID && d.COMPANY_ID !== '0') {
      if (!porCompania.has(d.COMPANY_ID)) porCompania.set(d.COMPANY_ID, []);
      porCompania.get(d.COMPANY_ID).push(d);
    }
  }
  return { porContacto, porCompania };
}

function dealsDeIdentidad(identidad, indice) {
  const vistos = new Set();
  const salida = [];
  for (const o of identidad.origenes) {
    const listas = [];
    if (o.tipo === 'contacto') listas.push(indice.porContacto.get(o.id));
    if (o.tipo === 'compania') listas.push(indice.porCompania.get(o.id));
    if (o.tipo === 'lead' && o.registro.CONTACT_ID) listas.push(indice.porContacto.get(o.registro.CONTACT_ID));
    for (const lista of listas) {
      for (const d of lista || []) {
        if (vistos.has(d.ID)) continue;
        vistos.add(d.ID);
        salida.push(d);
      }
    }
  }
  return salida;
}

// SOURCE_ID de Bitrix -> canal del cotizador (catalogo CERRADO de
// public/js/prospectos-logica.js CANALES). Los nombres de la derecha salen de
// crm.status.list (ENTITY_ID=SOURCE) de peltrenacional.bitrix24.mx, leidos el
// 2026-08-16. Un SOURCE_ID que NO aparece aqui deja canal en null a proposito:
// inventar un canal fuera del catalogo ensucia el embudo, y el canal decide la
// cadencia de seguimiento (semaforo por canal, CONTEXT.md). El script de
// importacion se niega a importar un candidato sin canal.
export const MAPA_SOURCE_CANAL = Object.freeze({
  'WZdaac8842-31c5-4d24-b0b4-1e3f81aef185': 'WhatsApp', // "Whatsapp 5217207870782"
  '2|FBINSTAGRAMDIRECT': 'Instagram',                   // "Instagram Direct - Canal Abierto"
  '2|FACEBOOK': 'Facebook/Messenger',                   // "Facebook - Canal Abierto"
  WEBFORM: 'Formulario web',                            // "Formulario Mayoreo"
  EMAIL: 'Correo',                                      // "E-Mail"
  REPEAT_SALE: 'Feria/Expo',                            // "Abastur" -- el nombre del source enganna
  PARTNER: 'Cliente Actual',                            // "Cliente Existente"
  RECOMMENDATION: 'Referido',                           // "Por Recomendacion"
});

// Un SOURCE_ID fuera del mapa (CALL, CALLBACK, STORE, WEB...) devuelve null: el
// reporte lo muestra como decision PENDIENTE del dueno y el importador se niega
// a importarlo.
export function canalDeSource(sourceId) {
  return MAPA_SOURCE_CANAL[sourceId] || null;
}

// Nombre de PERSONA: solo los campos de persona, nunca el TITLE.
function nombrePersona(registro) {
  const partes = [registro.NAME, registro.SECOND_NAME, registro.LAST_NAME]
    .map(v => String(v == null ? '' : v).trim())
    .filter(Boolean);
  return partes.length ? partes.join(' ').replace(/\s+/g, ' ') : '';
}

// Nombre para MOSTRAR: cae al TITLE cuando no hay nombre de persona, para que
// la fila del reporte no salga vacia.
function nombreDe(registro) {
  return nombrePersona(registro) || String(registro.TITLE || '').trim();
}

// Un origen manda sobre otro para los datos de presentacion: el contacto es el
// registro mas completo, el lead trae el SOURCE original, la compania solo el
// nombre de la empresa.
const PRIORIDAD_TIPO = { contacto: 0, lead: 1, compania: 2 };

function ordenarOrigenes(identidad) {
  return [...identidad.origenes].sort((a, b) => PRIORIDAD_TIPO[a.tipo] - PRIORIDAD_TIPO[b.tipo]);
}

// "Company #564" es el titulo PLACEHOLDER que Bitrix pone cuando el formulario
// crea una compania sin nombre: no es el nombre de nadie y no debe aparecer en
// la lista que revisa el dueno.
const TITULO_PLACEHOLDER = /^Company #\d+$/i;

function limpiarTitulo(titulo) {
  const v = String(titulo == null ? '' : titulo).trim();
  return TITULO_PLACEHOLDER.test(v) ? '' : v;
}

function empresaDe(origenes, companiasPorId) {
  const idCompania = origenes.map(o => o.registro.COMPANY_ID).find(v => v && v !== '0');
  const compania = idCompania ? companiasPorId.get(idCompania) : null;
  const porCompania = limpiarTitulo(compania && compania.TITLE);
  if (porCompania) return porCompania;
  const porTitulo = origenes.map(o => limpiarTitulo(o.registro.COMPANY_TITLE)).find(Boolean);
  if (porTitulo) return porTitulo;
  const propia = origenes.find(o => o.tipo === 'compania');
  return propia ? limpiarTitulo(propia.registro.TITLE) : '';
}

// Nombres DISTINTOS entre los registros fusionados. Un mismo humano escrito de
// dos formas ("Omar Ramirez" / "Omar Ramirez" con acento, un apellido de mas) NO
// cuenta como distinto: se compara con normalizarNombre, la misma normalizacion
// de la deduplicacion de clientes (ADR-0001). Si quedan dos nombres de verdad
// distintos, el numero lo comparten dos personas. La fusion se mantiene igual
// -- el cotizador tiene indice UNICO sobre celular10, "1 celular = 1 prospecto"
// (CONTEXT.md), y dos personas con un mismo celular no pueden ser dos
// prospectos -- pero el reporte lo marca para que el dueno lo vea.
function nombresDistintosDe(origenes) {
  const salida = [];
  const tokensVistos = [];
  for (const o of origenes) {
    // SOLO nombres de persona. El TITLE del lead lo genera Bitrix solo
    // ("Completar formulario del CRM ...", igual en 18 leads del export) y no
    // identifica a nadie: tomarlo como nombre marcaria como "numero
    // compartido" a casi todo el formulario de mayoreo.
    const nombre = nombrePersona(o.registro);
    if (!nombre) continue;
    const tokens = new Set(normalizarNombre(nombre));
    if (tokens.size === 0) continue;
    // Un nombre CONTENIDO en otro es la misma persona escrita mas corta
    // ("Cynthia" dentro de "cynthia cordova", "Elizabeth Gallardo" dentro de
    // "Rosa Elizabeth Gallardo"): no son dos personas en una misma linea.
    const yaEsta = tokensVistos.some(previo =>
      [...tokens].every(t => previo.has(t)) || [...previo].every(t => tokens.has(t)));
    if (yaEsta) continue;
    tokensVistos.push(tokens);
    salida.push(nombre);
  }
  return salida;
}

function resumenIdentidad(identidad, companiasPorId, hoy) {
  const origenes = ordenarOrigenes(identidad);
  const conNombre = origenes.find(o => nombreDe(o.registro));
  const nombresDistintos = nombresDistintosDe(origenes);
  const lead = origenes.find(o => o.tipo === 'lead');
  const contacto = origenes.find(o => o.tipo === 'contacto');
  const fuente = lead || contacto || origenes[0];

  // El telefono que se MUESTRA y el que se IMPORTA tienen que ser el MISMO que
  // produjo la llave con la que se cruzo contra nuestros sistemas. Tomar "el
  // primer PHONE" por un lado y "la primera llave del Set" por otro los
  // desalinea cuando un registro trae varios numeros: el caso real "yered cantu"
  // (contacto 632) muestra +19156949662 mientras su llave es 6568511438, y el
  // prospecto se guardaria con un celular que nunca se comparo contra nadie.
  const telefonoPrimario = origenes
    .flatMap(o => (o.registro.PHONE || []).map(p => p.VALUE))
    .find(valor => ultimos10(valor).length === 10) || '';
  const correoCrudo = origenes
    .flatMap(o => (o.registro.EMAIL || []).map(p => p.VALUE))
    .find(Boolean) || '';

  const sourceId = fuente ? fuente.registro.SOURCE_ID : null;
  const ultimaActividad = origenes
    .map(o => diasDesde(o.registro.LAST_ACTIVITY_TIME, hoy))
    .filter(d => d !== null)
    .sort((a, b) => a - b)[0];

  return {
    nombre: conNombre ? nombreDe(conNombre.registro) : '',
    empresa: String(empresaDe(origenes, companiasPorId) || '').trim(),
    telefono: telefonoPrimario,
    telefonoLlave: telefonoPrimario ? ultimos10(telefonoPrimario) : null,
    // Todas las llaves de la identidad, no solo la primaria: el cruce compara
    // contra TODAS (un numero viejo puede ser el que conocemos).
    telefonosLlave: [...identidad.telefonos],
    nombresEnBitrix: nombresDistintos,
    telefonoCompartido: nombresDistintos.length > 1,
    correo: correoCrudo ? normalizarCorreo(correoCrudo) : null,
    sourceId,
    canal: canalDeSource(sourceId),
    statusId: lead ? lead.registro.STATUS_ID : null,
    ultimaActividadDias: ultimaActividad === undefined ? null : Math.round(ultimaActividad),
    origenes: origenes.map(o => o.tipo + ':' + o.id),
  };
}

// Cruce contra NUESTROS sistemas. Precedencia explicita: el telefono es la
// llave primaria (1 celular = 1 prospecto, CONTEXT.md) y solo si no matchea se
// consulta el correo. El cotizador se consulta antes que Operam porque un
// prospecto propio es la presencia mas cercana al embudo.
function buscarPresencia(identidad, cotizador, operam) {
  const sistemas = [['cotizador', cotizador], ['operam', operam]];
  for (const [donde, sistema] of sistemas) {
    for (const t of identidad.telefonos) {
      if (sistema && sistema.telefonos && sistema.telefonos.has(t)) {
        return { llave: 'telefono', donde, valor: t };
      }
    }
  }
  for (const [donde, sistema] of sistemas) {
    for (const c of identidad.correos) {
      if (sistema && sistema.correos && sistema.correos.has(c)) {
        return { llave: 'correo', donde, valor: c };
      }
    }
  }
  return null;
}

// CRITERIO DE VIVO (explicito y conservador -- en la duda va al historico).
// Devuelve las senales encontradas dentro de la ventana; lista vacia = muerto.
function senalesDeVida(identidad, { deals, actividades, hoy, ventanaDias }) {
  const senales = [];

  const abiertos = deals.filter(d => d.CLOSED === 'N' && d.STAGE_SEMANTIC_ID === 'P');
  if (abiertos.some(d => dentroDeVentana(d.LAST_ACTIVITY_TIME, hoy, ventanaDias))) {
    senales.push(DEAL_ABIERTO);
  }

  // La actividad puede estar registrada contra el DEAL ligado y no contra el
  // contacto (llamadas y correos de una negociacion cuelgan del deal): se
  // consultan las dos, si no un contacto trabajado por su deal pareceria muerto.
  const claves = [
    ...identidad.origenes.map(o => o.tipo + ':' + o.id),
    ...deals.map(d => 'deal:' + d.ID),
  ];
  const masReciente = claves
    .map(clave => actividades.get(clave))
    .filter(d => d !== undefined)
    .sort((a, b) => a - b)[0];
  if (masReciente !== undefined && masReciente <= ventanaDias) senales.push(ACTIVIDAD_RECIENTE);

  const enProceso = identidad.origenes.some(o =>
    o.tipo === 'lead'
    && o.registro.STATUS_SEMANTIC_ID === 'P'
    && dentroDeVentana(o.registro.LAST_ACTIVITY_TIME, hoy, ventanaDias));
  if (enProceso) senales.push(LEAD_EN_PROCESO);

  const alta = identidad.origenes.some(o => dentroDeVentana(o.registro.DATE_CREATE, hoy, ventanaDias));
  if (alta) senales.push(ALTA_RECIENTE);

  return senales;
}

// Un lead marcado JUNK ("Prospecto no util") es un juicio HUMANO explicito y se
// respeta: no entra al embudo aunque tenga movimiento reciente. La unica
// excepcion es un deal abierto, que contradice el descarte de frente.
function descartadoEnBitrix(identidad, deals) {
  const junk = identidad.origenes.some(o =>
    o.tipo === 'lead' && (o.registro.STATUS_ID === 'JUNK' || o.registro.STATUS_SEMANTIC_ID === 'F'));
  if (!junk) return false;
  return !deals.some(d => d.CLOSED === 'N' && d.STAGE_SEMANTIC_ID === 'P');
}

// ORDEN UNICO de la lista de candidatos: por actividad mas reciente primero.
// Vive aqui, y no en cada script, porque el numero de fila del reporte que
// aprueba Adrian es el MISMO que consume `--excluir` del importador: dos copias
// del comparador que se separen borrarian a la persona equivocada.
export function ordenarCandidatos(candidatos) {
  return [...(candidatos || [])].sort((a, b) => {
    const da = a.ultimaActividadDias == null ? Infinity : a.ultimaActividadDias;
    const db = b.ultimaActividadDias == null ? Infinity : b.ultimaActividadDias;
    return da - db;
  });
}

export function clasificarBitrix({ exportBitrix, cotizador, operam } = {}, opts = {}) {
  const hoy = opts.hoy instanceof Date ? opts.hoy : new Date();
  const ventanaDias = opts.ventanaDias == null ? VENTANA_VIVO_DIAS : opts.ventanaDias;
  const e = exportBitrix || {};

  const identidades = identidadesBitrix(e);
  const companiasPorId = new Map((e.companias || []).map(c => [c.ID, c]));
  const indiceDeals = indexarDeals(e.deals);
  const actividades = indexarActividades(e.actividades, hoy);

  const yaExiste = [];
  const candidatos = [];
  const resto = [];

  for (const identidad of identidades) {
    const resumen = resumenIdentidad(identidad, companiasPorId, hoy);
    const deals = dealsDeIdentidad(identidad, indiceDeals);

    const presencia = buscarPresencia(identidad, cotizador, operam);
    if (presencia) {
      yaExiste.push({ ...resumen, llave: presencia.llave, donde: presencia.donde, valor: presencia.valor });
      continue;
    }

    // Sin celular no hay importacion posible: el celular es obligatorio en la
    // captura y es la llave de deduplicacion. Se evalua DESPUES del cruce para
    // no perder un "ya existe" detectado por correo.
    if (!resumen.telefonoLlave) {
      resto.push({ ...resumen, motivo: SIN_CELULAR });
      continue;
    }

    if (descartadoEnBitrix(identidad, deals)) {
      resto.push({ ...resumen, motivo: DESCARTADO_EN_BITRIX });
      continue;
    }

    const senales = senalesDeVida(identidad, { deals, actividades, hoy, ventanaDias });
    if (senales.length === 0) {
      resto.push({ ...resumen, motivo: SIN_SENAL_DE_VIDA });
      continue;
    }

    candidatos.push({ ...resumen, senales });
  }

  return {
    yaExiste,
    candidatos,
    resto,
    conteos: {
      identidades: identidades.length,
      yaExiste: yaExiste.length,
      candidatos: candidatos.length,
      resto: resto.length,
    },
    ventanaDias,
  };
}
