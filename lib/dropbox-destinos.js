// Destino de Dropbox por flujo (#357, padre #354). Nucleo PURO: traduce el
// entorno a la configuracion de destino de cada flujo; el IO vive en
// lib/dropbox.js.
//
// Por que no una ruta de texto (decision 2 de #354, cerrada por Adrian):
//   1. Si la ruta no existe, Dropbox la CREA y responde 200 -- asi nacio la
//      replica fantasma del arbol de la empresa dentro del sandbox de la app.
//   2. Cada miembro de una carpeta compartida puede renombrar SU montaje, asi
//      que una ruta de texto puede dejar de apuntar a donde se cree sin que
//      nadie haya reorganizado nada.
// Con namespace configurado la peticion viaja con `Dropbox-API-Path-Root` y la
// ruta RELATIVA a ese namespace: si el destino no existe o revocaron el acceso,
// la subida FALLA en vez de inventar carpetas.
//
// La regla que no se puede malinterpretar: el respaldo a la ruta vieja ocurre
// por AUSENCIA de configuracion, JAMAS por fallo. Un catch que ante un error
// del destino configurado reintente contra la ruta de texto reintroduce
// exactamente el bug de #354.
//
// Un flujo esta configurado solo si tiene AMBAS variables con valor. Los
// nombres son contrato con Render.
//
// `sandbox` es la ruta heredada: la misma cadena absoluta que el flujo mandaba
// antes de #357, declarada UNA vez aqui (ningun flujo lleva ya su ruta
// incrustada) para que sin configuracion la peticion salga identica a la de
// entonces. Los \u no son adorno: la ruta viaja a Dropbox byte por byte como
// iba, y el codigo del repo es ASCII estricto.
const FLUJOS = {
  csf: {
    ns: 'DROPBOX_NS_CSF',
    path: 'DROPBOX_PATH_CSF',
    sandbox: () => '/PELTRE NACIONAL/3.0 ADMINISTRACI\u00d3N/CONTABILIDAD/PNA170810CF1/CONSTANCIA SITUACION FISCAL CLIENTES',
  },
  calca: {
    ns: 'DROPBOX_NS_CALCA',
    path: 'DROPBOX_PATH_CALCA',
    sandbox: () => '/1.0 Comercializaci\u00f3n/DISE\u00d1O/CALCAS/OT Decorado',
  },
  bitrix: {
    ns: 'DROPBOX_NS_BITRIX',
    path: 'DROPBOX_PATH_BITRIX',
    // BITRIX_EXPORT_DROPBOX_PATH es del export de #158 y sigue mandando sobre
    // la ruta heredada: sin variables nuevas, el script escribe donde escribia.
    sandbox: (env) => valor(env.BITRIX_EXPORT_DROPBOX_PATH) || '/PELTRE NACIONAL/3.0 ADMINISTRACION/CRM/BACKUP BITRIX24',
  },
};

function valor(v) {
  const s = v == null ? '' : String(v).trim();
  return s || null;
}

// Sin diagonal final y con diagonal inicial: asi `base + '/' + archivo` da una
// ruta valida para Dropbox tanto en el namespace como en el sandbox. Un destino
// que sea la raiz del namespace ('/') queda en cadena vacia.
function normalizarBase(ruta) {
  const s = String(ruta).trim().replace(/\/+$/, '');
  if (!s) return '';
  return s.startsWith('/') ? s : `/${s}`;
}

export function destinoDeFlujo(flujo, env = process.env) {
  const def = FLUJOS[flujo];
  if (!def) throw new Error(`Flujo de Dropbox desconocido: ${flujo}`);
  const namespace = valor(env[def.ns]);
  const base = valor(env[def.path]);
  if (namespace && base) return { flujo, configurado: true, namespace, base: normalizarBase(base) };
  return { flujo, configurado: false, namespace: null, base: normalizarBase(def.sandbox(env)) };
}

export function rutaDeSubida(destino, archivo) {
  const relativo = String(archivo == null ? '' : archivo).trim().replace(/^\/+/, '');
  if (!relativo) throw new Error(`Falta el archivo del destino de Dropbox (flujo ${destino.flujo})`);
  return `${destino.base}/${relativo}`;
}

export function cabecerasDeDestino(destino) {
  if (!destino.configurado) return {};
  return { 'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'namespace_id', namespace_id: destino.namespace }) };
}

// Contra que escribe cada flujo HOY (#399): ESTADO calculado en tiempo de
// lectura, no evento. Como fila por subida seria ruido y ademas se iria del
// LIMIT del panel en cuanto hubiera trafico. La base es para leerse: la raiz
// del namespace sale como '/', no como la cadena vacia que sirve para
// concatenar.
export function estadoDeFlujos(env = process.env) {
  return Object.keys(FLUJOS).map(flujo => {
    const { configurado, namespace, base } = destinoDeFlujo(flujo, env);
    return { flujo, configurado, namespace, base: base || '/' };
  });
}

// Donde cayo una fila del registro (#399): en el Dropbox real (viajo con
// `Dropbox-API-Path-Root` contra un namespace) o en el sandbox de la app. La
// fila que guardo su namespace lo dice sola. La que no se INFIERE por su ruta
// y se marca `inferido` EN LAS DOS DIRECCIONES, porque nadie anoto por donde
// viajo: sin namespace la peticion sale con la ruta heredada del flujo, asi
// que lo que cuelga de ella es sandbox, y lo que no es una ruta RELATIVA a un
// namespace (las filas que viajaron con namespace antes de que el registro
// supiera guardarlo). La ruta heredada se lee del entorno de HOY: si
// BITRIX_EXPORT_DROPBOX_PATH cambia, las filas viejas de bitrix cambian de
// lado, y por eso tampoco esa rama se afirma como medida. El flujo
// que ya no existe no tiene ruta heredada contra la cual comparar: sin
// namespace guardado se queda en sandbox, que es lo que fue todo lo anterior a
// #357.
export function lugarDeSubida(fila, env = process.env) {
  const namespace = valor(fila?.namespace);
  if (namespace) return { tipo: 'namespace', namespace, inferido: false };
  const def = FLUJOS[fila?.flujo];
  if (!def) return { tipo: 'sandbox', namespace: null, inferido: true };
  const heredada = normalizarBase(def.sandbox(env));
  const enSandbox = String(fila.destino || '').startsWith(`${heredada}/`);
  return { tipo: enSandbox ? 'sandbox' : 'namespace', namespace: null, inferido: true };
}

// Advertencia de observabilidad: un flujo sin configurar sigue escribiendo en
// el sandbox de la app. Es el aviso POR SUBIDA, en consola; el estado por flujo
// que ve el admin es `estadoDeFlujos`.
export function avisoSinConfigurar(destino) {
  if (destino.configurado) return null;
  const def = FLUJOS[destino.flujo];
  return `[dropbox] flujo ${destino.flujo} sin namespace configurado (faltan ${def.ns} y/o ${def.path}): sigue escribiendo en el sandbox de la app, bajo ${destino.base}`;
}
