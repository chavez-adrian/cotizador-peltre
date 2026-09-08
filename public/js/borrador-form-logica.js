// Nucleo puro del borrador de formulario (issue #183, spec #178; CONTEXT.md
// "Borrador de formulario"). Sin efectos de navegador: aqui vive la llave por
// formulario y vendedor, la serializacion versionada de los campos, la
// expiracion y el ciclo de vida. El localStorage, el DOM y el enganche de los
// listeners son pegamento en app.js.
//
// Es hermano de borrador-logica.js, no parte de el: el borrador de cotizacion
// restaura UNA sesion de trabajo completa con re-resolucion de precios, y este
// solo prellena campos de texto de cualquier formulario. Comparten la unica
// regla que si es comun -- cuanto vive un borrador -- y por eso la expiracion se
// importa en vez de re-declararse.
import { DIAS_VIDA_BORRADOR } from './borrador-logica.js';

// El formato viaja versionado dentro del payload, igual que el borrador de
// cotizacion: una version desconocida se descarta en silencio, nunca se migra a
// ciegas.
export const VERSION_BORRADOR_FORM = 1;

// Un borrador de formulario guarda SOLO texto: lo que el vendedor tecleo o
// eligio. Cualquier otra cosa que llegue entre los valores -- el File de un
// input de archivo, un objeto, un numero -- se cae aqui, y con eso el input de
// archivo queda ignorado limpiamente sin que ninguna superficie tenga que
// acordarse de excluirlo (el navegador no deja re-poblar un input de archivo).
function normalizarValores(valores) {
  const salida = {};
  if (!valores || typeof valores !== 'object') return salida;
  for (const [campo, valor] of Object.entries(valores)) {
    if (!campo || typeof valor !== 'string' || !valor.trim()) continue;
    salida[campo] = valor;
  }
  return salida;
}

// Valores leidos del formulario -> borrador guardable, o null cuando no hay
// nada que guardar. null significa "borra la llave": un formulario en blanco no
// deja un borrador hueco que despues haya que distinguir de uno real.
export function serializarBorradorFormulario({ formId, valores, ahora } = {}) {
  const form = formId === 0 || formId ? String(formId) : '';
  if (!form) return null;
  const limpios = normalizarValores(valores);
  if (Object.keys(limpios).length === 0) return null;
  return {
    v: VERSION_BORRADOR_FORM,
    formId: form,
    actualizado: Number(ahora) || 0,
    valores: limpios,
  };
}

// Texto de localStorage (u objeto ya parseado) -> borrador utilizable, o null.
// null es "no hay nada que prellenar" para TODOS los motivos -- version ajena,
// JSON roto, forma imposible, otro formulario --: el borrador es una comodidad,
// nunca un error que interrumpa al vendedor. Se exige que el formulario del
// payload coincida con el que pregunta, para que una llave reciclada por otra
// superficie no acabe prellenando campos que no son suyos.
export function deserializarBorradorFormulario(crudo, formId) {
  let obj = crudo;
  if (typeof crudo === 'string') {
    try { obj = JSON.parse(crudo); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object') return null;
  if (obj.v !== VERSION_BORRADOR_FORM) return null;
  const form = formId === 0 || formId ? String(formId) : '';
  if (form && obj.formId !== form) return null;
  const actualizado = Number(obj.actualizado);
  if (!Number.isFinite(actualizado) || actualizado <= 0) return null;
  const valores = normalizarValores(obj.valores);
  if (Object.keys(valores).length === 0) return null;
  return { v: obj.v, formId: obj.formId, actualizado, valores };
}

// Que hacer con un borrador de formulario dado el reloj de ahora. Solo dos
// salidas, a diferencia del borrador de cotizacion: NO hay prompt de 30 minutos
// porque prellenar un formulario no arriesga nada equivalente a generar una
// cotizacion vieja -- el vendedor ve los campos, la marca de restaurado y puede
// limpiarlos. La expiracion si es la misma para todo borrador (30 dias) y por
// eso se importa del nucleo de cotizacion en vez de re-declararse. Una edad
// NEGATIVA (reloj del telefono desfasado) cuenta como recien tocado: el error de
// reloj nunca puede costarle el trabajo al vendedor.
export const RESTAURACION_FORM = {
  PREFILL: 'prefill',
  EXPIRADO: 'expirado',
};

export function decidirRestauracionFormulario(borrador, ahora) {
  if (!borrador || !Number.isFinite(Number(borrador.actualizado))) return null;
  const edad = Number(ahora) - Number(borrador.actualizado);
  if (edad > DIAS_VIDA_BORRADOR * 24 * 60 * 60 * 1000) return RESTAURACION_FORM.EXPIRADO;
  return RESTAURACION_FORM.PREFILL;
}

// Del borrador solo se aplica lo que el formulario de HOY sigue teniendo: un
// campo que ya no existe (el formulario cambio entre despliegues) se queda en el
// borrador sin hacer dano, y ninguna superficie necesita una lista a mano de sus
// campos para defenderse de eso.
export function valoresAplicables(borrador, idsPresentes) {
  const salida = {};
  if (!borrador || !borrador.valores) return salida;
  const presentes = Array.isArray(idsPresentes) || idsPresentes instanceof Set
    ? new Set(idsPresentes)
    : null;
  if (!presentes) return salida;
  for (const [campo, valor] of Object.entries(borrador.valores)) {
    if (presentes.has(campo)) salida[campo] = valor;
  }
  return salida;
}

// Que valores del borrador se APLICAN al restaurar (issue #352). El borrador
// guarda el DOM, no el estado de JS: el PDF de la constancia (altaCsfState.pdfBase64),
// el RFC dueno de ese PDF y las actividades economicas de #171 NO sobreviven. Reponer
// los campos que la constancia llena, sin lo que la constancia trae consigo, deja un
// panel que se ve identico a tener la CSF cargada y da de alta sin respaldo en Dropbox
// y sin la nota de actividades -- en silencio. La salida no es guardar el archivo (son
// megabytes en localStorage) sino no fingir que esta: esos campos no se aplican y se
// pide cargar la constancia de nuevo.
//
// La politica la declara cada superficie en su definicion (SUPERFICIES_BORRADOR en
// app.js); aqui se decide que se aplica y que se avisa. No declararla es la politica
// de siempre -- se repone todo lo capturado --, que es lo que corresponde a una
// superficie sin constancia de por medio (prospecto, edicion de prospecto).
export const RESTAURACION_SUPERFICIE = {
  // Alta completa: lo comercial y el domicilio de entrega se reponen -- son lo caro de
  // recapturar y no dependen de la CSF --, los campos de la constancia no.
  SIN_CONSTANCIA: 'sin-constancia',
  // Upgrade fiscal: su superficie es UNICAMENTE la seccion de datos fiscales, asi que
  // restaurarla a medias es justo el bug. No se prellena nada.
  SIN_PRELLENADO: 'sin-prellenado',
};

// Aviso que el vendedor tiene que ver para saber por que el panel esta vacio. Es
// distinto de la marca "Borrador restaurado" (dicen cosas distintas y aparecen juntos)
// y el texto lo pone el pegamento: aqui solo se decide cual toca.
export const AVISO_CONSTANCIA = {
  ALTA: 'recargar-constancia-alta',
  UPGRADE: 'recargar-constancia-upgrade',
};

// El grupo "campos que llena la constancia" se declara UNA vez y por concepto: son
// los de la pestana CSF de la Seccion 1 (altaCsfPonerDatos los escribe), que se
// distinguen de los de captura a mano por el prefijo de su id.
const PREFIJO_CONSTANCIA = 'csf-';
const PREFIJO_CAPTURA_MANUAL = 'manual-';

export function esCampoDeConstancia(id) {
  return String(id == null ? '' : id).startsWith(PREFIJO_CONSTANCIA);
}

export function esCampoDeCapturaManual(id) {
  return String(id == null ? '' : id).startsWith(PREFIJO_CAPTURA_MANUAL);
}

// Borrador + campos del formulario de hoy -> que se escribe, que se omitio y que
// aviso toca. `omitidos` es informacion para quien quiera explicarlo; el aviso es
// lo que decide si se pinta algo.
export function planRestauracionFormulario({ borrador, idsPresentes, superficie } = {}) {
  const aplicables = valoresAplicables(borrador, idsPresentes);
  const campos = Object.keys(aplicables);
  if (campos.length === 0) return { valores: {}, omitidos: [], aviso: null };

  if (superficie === RESTAURACION_SUPERFICIE.SIN_PRELLENADO) {
    return { valores: {}, omitidos: campos, aviso: AVISO_CONSTANCIA.UPGRADE };
  }
  if (superficie === RESTAURACION_SUPERFICIE.SIN_CONSTANCIA) {
    const omitidos = [];
    const valores = {};
    for (const campo of campos) {
      if (esCampoDeConstancia(campo)) omitidos.push(campo);
      else valores[campo] = aplicables[campo];
    }
    // Un borrador mixto (se cargo una CSF y luego se capturo a mano) se rige por el
    // camino manual: lo tecleado se repone y no se pide constancia, porque ahi el dato
    // que vale es el del formulario y no depende de ningun archivo. Lo que NO cambia es
    // que los campos de la constancia se queden vacios: reponerlos dejaria la pestana
    // CSF completa, sin archivo detras, a un clic de dar de alta sin respaldo.
    const hayCapturaManual = campos.some(esCampoDeCapturaManual);
    const aviso = !hayCapturaManual && omitidos.length ? AVISO_CONSTANCIA.ALTA : null;
    return { valores, omitidos, aviso };
  }
  return { valores: aplicables, omitidos: [], aviso: null };
}

// Campos que el borrador nunca toca. El input de archivo porque el navegador no
// deja re-poblarlo (limitacion real, no decision); el de password porque una
// credencial no es captura que valga la pena conservar en el dispositivo; los
// de marca (checkbox/radio) porque este mecanismo persiste el VALOR del campo y
// en ellos el dato es `checked`, no `value` -- guardarlos aqui los restauraria
// mal, asi que se ignoran a proposito. Una superficie que de verdad necesite una
// marca tiene que ensanchar el contrato, no confiar en que ya funciona.
export const TIPOS_NO_RESTAURABLES = new Set(['file', 'password', 'checkbox', 'radio']);

export function campoRestaurable(tipo) {
  return !TIPOS_NO_RESTAURABLES.has(String(tipo == null ? '' : tipo).toLowerCase());
}

// Que evento del ciclo de vida mata el borrador de formulario (spec #178).
// Salir de la sesion NO lo mata -- igual que el borrador de cotizacion, el
// logout conserva el trabajo -- y lo desconocido tampoco (un envio que fallo, o
// plegar el formulario): el default seguro es no tirar lo capturado.
export const EVENTOS_BORRADOR_FORM = {
  ENVIO_EXITOSO: 'envio-exitoso',
  CANCELADO: 'cancelado',
  LIMPIADO: 'limpiado',
  EXPIRADO: 'expirado',
  LOGOUT: 'logout',
};

const EVENTOS_QUE_MATAN = new Set([
  EVENTOS_BORRADOR_FORM.ENVIO_EXITOSO,
  EVENTOS_BORRADOR_FORM.CANCELADO,
  EVENTOS_BORRADOR_FORM.LIMPIADO,
  EVENTOS_BORRADOR_FORM.EXPIRADO,
]);

export function borradorFormularioMuerePorEvento(evento) {
  return EVENTOS_QUE_MATAN.has(evento);
}

// Llave del borrador en el dispositivo. Lleva el formulario Y el vendedor: el
// telefono se presta (nadie ve el borrador de otro) y cada formulario tiene el
// suyo. Mismo esquema de namespace que el borrador de cotizacion
// ("borrador:cotizacion:<id>"), con la version fuera de la llave: vive dentro
// del payload para poder leer un formato viejo y descartarlo, en vez de dejarlo
// ocupando su propia llave para siempre.
export function llaveBorradorFormulario(formId, vendedorId) {
  const form = formId === 0 || formId ? String(formId) : '';
  const id = vendedorId === 0 || vendedorId ? String(vendedorId) : '';
  return form && id ? `borrador:form:${form}:${id}` : null;
}
