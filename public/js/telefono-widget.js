// Widget internacional de telefono, compartido por el formulario publico de
// mayoreo y el alta interna (issue #176; el widget llego con #161).
//
// Por que existe este modulo: hasta #176 los helpers del widget vivian dentro de
// mayoreo.js, cerrados sobre su unica instancia. El alta interna necesita CINCO
// instancias (paso Cliente, prospectos, cliente de la cotizacion, celular de
// entrega, domicilio del alta completa), asi que los helpers se mudaron aqui y
// mayoreo los importa -- un modulo, varios consumidores, cero copias espejo.
//
// El intl-tel-input es el VENDOREADO (public/vendor/intl-tel-input): sin CDN,
// sin bytes nuevos. Su bandera es un sprite de imagenes, que es lo que resuelve
// el reporte de Adrian del 2026-08-17: los emoji de bandera del select de
// prospectos se veian como dos letras en Windows.
//
// Las funciones de arriba (celCodeDelWidget / numeroDelWidget /
// avisoTelefonoWidget) no tocan el DOM y reciben la instancia: son las que la
// suite cubre. Las de abajo montan y pintan -- eso pide navegador.
import {
  CEL_CODE_POR_ISO2,
  combinarTelefonoConCodigo,
  separarTelefonoCodigo,
  quitarUnoLiderInternacional,
} from './alta-logica.js';

// Mensajes de intl-tel-input.utils.getValidationError() traducidos (issue
// #161). "Rechazar un lead valido cuesta mas que aceptar uno dudoso"
// (investigacion 2.4): SOLO se llama cuando isValidNumber() ya dijo que no.
// El criterio es la validacion por LARGO (isValidNumber), no la precisa: los
// autores del propio widget desaconsejan isValidNumberPrecise sobre una copia
// vendoreada, porque su metadata cambia cada mes y termina rechazando numeros
// validos (docs/investigacion-validacion-telefono.md).
// IS_POSSIBLE_LOCAL_ONLY no significa "falta el codigo de pais" (asi decia hasta
// el reporte de Adrian del 2026-08-19): el codigo de pais lo pone SIEMPRE el
// widget, nunca falta. Significa que el numero solo seria marcable dentro de su
// propia zona -- en Mexico, 8 digitos es un largo local valido en la metadata,
// asi que "532 590 00" cae aqui en vez de TOO_SHORT. Lo que le falta es la lada.
export const MENSAJE_VALIDACION_CEL = {
  INVALID_COUNTRY_CODE: 'Ese código de país no es válido.',
  TOO_SHORT: 'Ese número está incompleto.',
  TOO_LONG: 'Ese número tiene demasiados dígitos.',
  IS_POSSIBLE_LOCAL_ONLY: 'Ese número está incompleto: le falta la lada.',
  INVALID_LENGTH: 'Ese número no tiene el largo correcto.',
};

const MENSAJE_GENERICO = 'Ese número no se ve válido.';

// Veredicto SECUNDARIO (issue #176): el numero tiene el largo correcto para su
// pais pero no cae en ningun rango asignado segun la metadata precisa. Es una
// pista, no un criterio: la copia vendoreada del utils.js es del 2026-08-16 y
// no tiene script de actualizacion, asi que con los meses empezaria a marcar
// numeros legitimos -- por eso jamas bloquea. Solo lo pide el alta interna; el
// formulario publico de mayoreo se queda con el criterio de largo de #161.
// El texto es para un vendedor con el cliente enfrente: dice que revise y que
// puede guardar igual. El detalle tecnico (de cuando es la copia local de la
// metadata) se queda en este comentario -- en la cara del vendedor no se
// entendia (reporte de Adrian, 2026-08-19).
const MENSAJE_PRECISO = 'Ese número tiene el largo correcto pero no parece un número real de ese país. Revísalo; si es correcto, puedes guardarlo.';

// Aviso transitorio del "1" lider TECLEADO (issue #202). normalizarCapturaMx
// ya lo descarta en silencio desde #176/#199 -- correcto, pero mudo: quien
// teclea un legacy "1 55..." no ve nada y puede creer que el formulario o su
// teclado no sirven. Nunca bloquea; solo avisa. Estilo de mensaje igual al de
// MENSAJE_VALIDACION_CEL.
export const MENSAJE_UNO_LIDER = 'En México ningún teléfono empieza con 1. Teclea los 10 dígitos.';

// celCode es el contrato de la casa ('+52' | '+1' | '+1-CA' | '+'): lo consumen
// paisDesdeCodigoTelefono, validarTelefono y combinarTelefonoConCodigo. El
// widget habla iso2, asi que se traduce con CEL_CODE_POR_ISO2 (alta-logica.js,
// la inversa de paisDesdeCodigoTelefono -- una sola tabla, no una copia local);
// cualquier otro pais que el widget permita elegir cae al generico '+'.
export function celCodeDelWidget(iti) {
  const pais = iti && iti.getSelectedCountry();
  return CEL_CODE_POR_ISO2[pais && pais.iso2] || '+';
}

// getNumber() exige utils.js cargado (lanza si no). Es una ventana muy chica
// (el archivo pesa ~260KB y carga apenas se pinta la pagina), pero si alguien
// alcanza a escribir y perder el foco antes de que resuelva, caemos al valor
// crudo del input -- combinarTelefonoConCodigo lo arma igual con celCode.
// El E.164 se normaliza antes de devolverse: el mexicano canonico es 52 + 10
// digitos, sin el "1" de movil heredado (issue #176).
export function numeroDelWidget(iti, crudo) {
  try {
    const e164 = iti && iti.getNumber();
    if (e164) return quitarUnoLiderInternacional(e164);
  } catch (err) { /* utils.js aun no carga */ }
  return crudo;
}

// Capa estricta: devuelve el motivo por el que el numero se ve mal, o null.
// NUNCA decide por si sola: quien la llama avisa y deja guardar (issue #176).
// Vacio no es su responsabilidad -- eso lo marca la reja dura de cada
// formulario (validarTelefono / validarMayoreo).
export async function avisoTelefonoWidget(iti, crudo, { preciso = false } = {}) {
  if (!crudo) return null;
  try {
    await iti.promise;
  } catch (err) {
    return null;
  }
  if (!iti.isValidNumber()) return MENSAJE_VALIDACION_CEL[iti.getValidationError()] || MENSAJE_GENERICO;
  return preciso && iti.isValidNumberPrecise() === false ? MENSAJE_PRECISO : null;
}

// Normalizacion del formato legacy mexicano EN LA CAPTURA (issue #176). El
// widget corre con strictMode, que corta el nacional de Mexico en 10 digitos:
// tecleando el legacy "1 55 3466 7689" el digito 11 se rechazaba y el vendedor
// se quedaba con "1553466768", que ni es su numero ni pasa la reja dura. Por eso
// el "1" se quita EN CUANTO aparece y no al final: asi el largo nunca llega al
// tope y el formato legacy se puede teclear (y pegar) completo.
// Sin ambiguedad: ningun nacional mexicano real empieza con 1 (metadata oficial
// [2-9] + 9 digitos, reforma IFT 2019). Quien llama garantiza que el pais
// elegido es Mexico -- para el resto del mundo esto no aplica y en +1 el "1" ES
// el codigo de pais. El internacional pegado va por el espejo de alta-logica,
// que solo lo toca cuando sobra despues del +52.
export function normalizarCapturaMx(valor) {
  const tel = valor || '';
  if (tel.trim().startsWith('+')) return quitarUnoLiderInternacional(tel);
  return tel.replace(/^(\s*)1[\s.-]*/, '$1');
}

// Distingue el caso que pide el aviso (issue #202) del espejo internacional:
// solo el "1" lider de un nacional mexicano tecleado a mano (nunca el "1" de
// un "+52 1 ..." pegado/normalizado) debe mostrarlo. Puro para poder probarlo
// sin DOM; quien pinta el aviso (cablearCapturaMx, abajo) es quien decide
// CUANDO llamarlo (solo eventos de teclado, nunca en el paste interceptado).
export function unoLiderDescartado(crudo) {
  const tel = crudo || '';
  if (tel.trim().startsWith('+')) return false;
  return normalizarCapturaMx(tel) !== tel;
}

// Config con la que nacen TODAS las instancias del widget (mayoreo publico y
// los campos del alta interna): una sola, para que traducir el buscador o tocar
// strictMode no requiera acordarse del otro consumidor.
// La llave de traduccion del intl-tel-input vendoreado es uiTranslations (no
// i18n): con el nombre equivocado la opcion se ignora en silencio y el buscador
// se queda en ingles. Se traduce lo que el vendedor LEE; los nombres de pais los
// arma el widget con Intl.DisplayNames y no son parte de esta tabla.
export function opcionesWidget() {
  return {
    initialCountry: 'mx',
    strictMode: true,
    loadUtils: () => import('/vendor/intl-tel-input/js/utils.js'),
    uiTranslations: {
      searchPlaceholder: 'Buscar país',
      searchEmptyState: 'Sin resultados',
      clearSearchAriaLabel: 'Borrar la búsqueda',
    },
  };
}

// === Montaje sobre el DOM del alta interna ===

const ISO2_POR_CEL_CODE = Object.fromEntries(
  Object.entries(CEL_CODE_POR_ISO2).map(([iso2, code]) => [code, iso2])
);

// inputId -> { iti, input, aviso, tocado }. El registro por id existe porque el
// resto de app.js sigue hablando de ids de DOM ('cl-telefono'), no de
// instancias, y porque el paso Cliente se repinta por innerHTML: cada repintado
// desmonta el widget viejo y monta uno nuevo sobre el input nuevo.
const montados = new Map();

function pintarAviso(estado, mensaje) {
  if (!estado || !estado.aviso) return;
  estado.aviso.textContent = mensaje || '';
  estado.aviso.style.display = mensaje ? 'block' : 'none';
}

function normalizarCaptura(estado) {
  if (celCodeDelWidget(estado.iti) !== '+52') return false;
  const crudo = estado.input.value || '';
  const limpio = normalizarCapturaMx(crudo);
  if (limpio === crudo) return false;
  estado.input.value = limpio;
  return unoLiderDescartado(crudo);
}

// Nodo del aviso del "1" lider tecleado (issue #202), uno por input, creado al
// vuelo y reutilizado -- WeakMap para no tener que engancharse al ciclo de
// vida de `montados` (mayoreo.js llama cablearCapturaMx directo, sin pasar
// por ahi). Cuando el input se repinta por innerHTML (paso Cliente) el nodo
// viejo se va con el, sin fuga: nadie vuelve a pedirlo. Misma clase
// '.tel-aviso' que el aviso de la capa estricta (montarTelefono) para que se
// vea igual en los 6 campos del alta y en mayoreo -- nunca es el MISMO nodo,
// asi que uno no pisa ni oculta al otro.
const TIMEOUT_AVISO_UNO_LIDER_MS = 4000;
const avisosUnoLider = new WeakMap();

function nodoAvisoUnoLider(input) {
  let entrada = avisosUnoLider.get(input);
  if (!entrada) {
    const nodo = document.createElement('div');
    nodo.className = 'tel-aviso';
    nodo.style.display = 'none';
    (input.parentElement || input).insertAdjacentElement('afterend', nodo);
    entrada = { nodo, timer: null };
    avisosUnoLider.set(input, entrada);
  }
  return entrada;
}

function mostrarAvisoUnoLider(input) {
  const entrada = nodoAvisoUnoLider(input);
  entrada.nodo.textContent = MENSAJE_UNO_LIDER;
  entrada.nodo.style.display = 'block';
  clearTimeout(entrada.timer);
  entrada.timer = setTimeout(() => ocultarAvisoUnoLider(input), TIMEOUT_AVISO_UNO_LIDER_MS);
}

function ocultarAvisoUnoLider(input) {
  const entrada = avisosUnoLider.get(input);
  if (!entrada) return;
  clearTimeout(entrada.timer);
  entrada.nodo.style.display = 'none';
}

// Simetrico con el `if (estado.aviso...) estado.aviso.remove()` de
// desmontarTelefono, abajo: sin esto un timer de mostrarAvisoUnoLider
// pendiente sobrevive a un desmontaje sobre el MISMO nodo input (el unico
// camino real hoy es pc-cel via innerHTML, que se lleva el nodo entero -- pero
// desmontarTelefono no debe depender de ese supuesto para quedar limpio).
function limpiarAvisoUnoLider(input) {
  const entrada = avisosUnoLider.get(input);
  if (!entrada) return;
  clearTimeout(entrada.timer);
  if (entrada.nodo.parentElement) entrada.nodo.remove();
  avisosUnoLider.delete(input);
}

// Pegado del numero completo (issue #176): con strictMode el widget rearma el
// valor pegado desde su propio snapshot y, si sobra largo, RECORTA POR LA COLA
// -- pegar "1 55 3466 7689" dejaba "1 55 3466 768", otro numero. Aqui se
// intercepta antes: se normaliza el texto pegado, se inserta a mano y se
// dispara 'input' para que el widget reformatee y resuelva la bandera. Solo
// interviene cuando la normalizacion cambia algo; en cualquier otro caso pega
// el widget como siempre.
function pegarNormalizado(estado, ev) {
  if (celCodeDelWidget(estado.iti) !== '+52') return;
  const texto = (ev.clipboardData && ev.clipboardData.getData('text')) || '';
  const limpio = normalizarCapturaMx(texto);
  if (!texto || limpio === texto) return;
  ev.preventDefault();
  const input = estado.input;
  const valor = input.value || '';
  const inicio = input.selectionStart == null ? valor.length : input.selectionStart;
  const fin = input.selectionEnd == null ? valor.length : input.selectionEnd;
  input.value = valor.slice(0, inicio) + limpio + valor.slice(fin);
  const cursor = inicio + limpio.length;
  try { input.setSelectionRange(cursor, cursor); } catch (err) { /* input sin seleccion */ }
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

// Cableado de captura MX (paste interceptado + "1" quitado en vivo mientras
// se teclea), separado de montarTelefono para que mayoreo.js -- que arma su
// propia instancia de intl-tel-input sin pasar por el registro por inputId
// -- tambien lo use (issue #199). UNA sola copia: el alta interna lo consume
// via montarTelefono/estado (abajo) y mayoreo lo llama directo con su iti e
// input. pegarNormalizado y normalizarCaptura solo leen `iti` e `input` de su
// argumento, asi que un objeto minimo { iti, input } les basta.
export function cablearCapturaMx(iti, input) {
  const estado = { iti, input };
  input.addEventListener('paste', ev => pegarNormalizado(estado, ev));
  input.addEventListener('input', ev => {
    if (!ev.isTrusted) return;
    if (normalizarCaptura(estado)) mostrarAvisoUnoLider(input);
    else ocultarAvisoUnoLider(input);
  });
}

export function desmontarTelefono(inputId) {
  const estado = montados.get(inputId);
  if (!estado) return;
  try { estado.iti.destroy(); } catch (err) { /* el input pudo irse con un innerHTML */ }
  if (estado.aviso && estado.aviso.parentElement) estado.aviso.remove();
  limpiarAvisoUnoLider(estado.input);
  montados.delete(inputId);
}

// Monta el widget sobre un input ya pintado. Devuelve la instancia (o null si
// el input no existe o el vendor no cargo -- en ese caso el campo se comporta
// como el input pelon de siempre y nada truena).
export function montarTelefono(inputId) {
  const input = document.getElementById(inputId);
  if (!input || typeof window.intlTelInput !== 'function') return null;
  desmontarTelefono(inputId);
  const iti = window.intlTelInput(input, opcionesWidget());
  const aviso = document.createElement('div');
  aviso.className = 'tel-aviso';
  aviso.id = `${inputId}-tel-aviso`;
  aviso.style.display = 'none';
  (input.parentElement || input).insertAdjacentElement('afterend', aviso);
  const estado = { iti, input, aviso, tocado: false };
  montados.set(inputId, estado);
  // Nunca se valida antes del primer blur; una vez mostrado el aviso se
  // re-evalua en cada tecla para que desaparezca en cuanto se corrige (patron
  // del ejemplo oficial de intl-tel-input).
  // isTrusted (dentro de cablearCapturaMx) acota la normalizacion en vivo a
  // lo que TECLEA una persona: los 'input' sinteticos son los que dispara
  // fijarTelefono para repoblar el campo desde un telefono guardado, y ahi el
  // valor no es captura (un numero extranjero sin '+' que empiece con 1
  // perderia ese 1 sin razon). Lo que se repuebla igual se normaliza al
  // primer blur, via revisarTelefono.
  cablearCapturaMx(iti, input);
  input.addEventListener('blur', () => { estado.tocado = true; revisarTelefono(inputId); });
  input.addEventListener('input', () => {
    if (estado.tocado) revisarTelefono(inputId);
  });
  return iti;
}

export function celCodeDeCampo(inputId) {
  const estado = montados.get(inputId);
  return estado ? celCodeDelWidget(estado.iti) : '+52';
}

export function numeroDeCampo(inputId) {
  const estado = montados.get(inputId);
  const input = estado ? estado.input : document.getElementById(inputId);
  const crudo = ((input && input.value) || '').trim();
  return estado ? numeroDelWidget(estado.iti, crudo) : crudo;
}

// El string que se guarda (mismo contrato que el viejo leerTelefono: codigo de
// la casa + numero, con el "1" legacy ya fuera).
export function telefonoDeCampo(inputId) {
  return combinarTelefonoConCodigo(celCodeDeCampo(inputId), numeroDeCampo(inputId));
}

// Repuebla un campo desde un telefono guardado (lo que hacia setTelefonoCampos
// con el select). Con codigo conocido se elige la bandera y queda el nacional;
// con cualquier otro se escribe el internacional completo y se dispara 'input'
// para que el widget resuelva la bandera desde el codigo de marcado.
export function fijarTelefono(inputId, telefono) {
  const estado = montados.get(inputId);
  const input = estado ? estado.input : document.getElementById(inputId);
  if (!input) return;
  const tel = (telefono || '').trim();
  if (!estado) { input.value = tel; return; }
  const { code, numero } = separarTelefonoCodigo(tel);
  const iso2 = ISO2_POR_CEL_CODE[code];
  if (iso2) {
    try { estado.iti.setSelectedCountry(iso2); } catch (err) { /* iso2 fuera del catalogo */ }
    input.value = numero;
  } else {
    input.value = tel;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  estado.tocado = false;
  pintarAviso(estado, null);
  // El aviso del "1" lider (issue #202) no es responsabilidad de pintarAviso
  // (esa es la capa estricta): sin esto, repoblar el campo -- p.ej. al elegir
  // OTRO cliente mientras el aviso de un "1" tecleado sigue en pantalla --
  // lo dejaba pegado hablando de un numero que ya no esta, hasta que expirara
  // su propio timeout.
  ocultarAvisoUnoLider(input);
}

// Revisa el campo y pinta (o apaga) su aviso. Devuelve el mensaje o null.
export async function revisarTelefono(inputId) {
  const estado = montados.get(inputId);
  if (!estado) return null;
  normalizarCaptura(estado);
  const mensaje = await avisoTelefonoWidget(estado.iti, (estado.input.value || '').trim(), { preciso: true });
  pintarAviso(estado, mensaje);
  return mensaje;
}

// Puerta de guardado de la capa estricta: AVISA y deja guardar con confirmacion
// explicita (issue #176 -- quien captura es un vendedor con el cliente
// enfrente; no existe ningun camino donde quede impedido de guardar). Sin
// widget montado devuelve true: la capa estricta nunca puede ser la razon por
// la que no se guarda.
export async function confirmarTelefono(inputId, preguntar) {
  const mensaje = await revisarTelefono(inputId);
  if (!mensaje) return true;
  const pregunta = preguntar || (typeof window !== 'undefined' ? m => window.confirm(m) : () => true);
  return !!pregunta(`${mensaje}\n\n¿Guardar de todos modos con este número?`);
}
