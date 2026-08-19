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
  quitarUnoLiderNacional,
  quitarUnoLiderInternacional,
} from './alta-logica.js';

// Mensajes de intl-tel-input.utils.getValidationError() traducidos (issue
// #161). "Rechazar un lead valido cuesta mas que aceptar uno dudoso"
// (investigacion 2.4): SOLO se llama cuando isValidNumber() ya dijo que no.
// El criterio es la validacion por LARGO (isValidNumber), no la precisa: los
// autores del propio widget desaconsejan isValidNumberPrecise sobre una copia
// vendoreada, porque su metadata cambia cada mes y termina rechazando numeros
// validos (docs/investigacion-validacion-telefono.md).
export const MENSAJE_VALIDACION_CEL = {
  INVALID_COUNTRY_CODE: 'Ese código de país no es válido.',
  TOO_SHORT: 'Ese número está incompleto.',
  TOO_LONG: 'Ese número tiene demasiados dígitos.',
  IS_POSSIBLE_LOCAL_ONLY: 'Falta el código de país.',
  INVALID_LENGTH: 'Ese número no tiene el largo correcto.',
};

const MENSAJE_GENERICO = 'Ese número no se ve válido.';

// Veredicto SECUNDARIO (issue #176): el numero tiene el largo correcto para su
// pais pero no cae en ningun rango asignado segun la metadata precisa. Es una
// pista, no un criterio: la copia vendoreada del utils.js es del 2026-08-16 y
// no tiene script de actualizacion, asi que con los meses empezaria a marcar
// numeros legitimos -- por eso el aviso dice de cuando es la copia y por eso
// jamas bloquea. Solo lo pide el alta interna; el formulario publico de mayoreo
// se queda con el criterio de largo de #161, sin cambios visibles.
const MENSAJE_PRECISO = 'Ese numero tiene el largo correcto pero no coincide con ningun rango asignado en ese pais (metadata local del 2026-08-16, puede estar desactualizada).';

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

// Normalizacion en la CAPTURA (issue #176): el formato legacy +52 1 55 xxxx
// xxxx falla todas las capas de libphonenumber por TOO_LONG. El fix no es
// relajar la validacion sino quitar ese "1" antes de validar -- ningun nacional
// mexicano real empieza con 1. Solo aplica cuando el pais elegido es Mexico.
function normalizarCaptura(estado) {
  if (celCodeDelWidget(estado.iti) !== '+52') return;
  const crudo = estado.input.value || '';
  const limpio = crudo.trim().startsWith('+') ? quitarUnoLiderInternacional(crudo) : quitarUnoLiderNacional(crudo);
  if (limpio !== crudo) estado.input.value = limpio;
}

export function desmontarTelefono(inputId) {
  const estado = montados.get(inputId);
  if (!estado) return;
  try { estado.iti.destroy(); } catch (err) { /* el input pudo irse con un innerHTML */ }
  if (estado.aviso && estado.aviso.parentElement) estado.aviso.remove();
  montados.delete(inputId);
}

// Monta el widget sobre un input ya pintado. Devuelve la instancia (o null si
// el input no existe o el vendor no cargo -- en ese caso el campo se comporta
// como el input pelon de siempre y nada truena).
export function montarTelefono(inputId) {
  const input = document.getElementById(inputId);
  if (!input || typeof window.intlTelInput !== 'function') return null;
  desmontarTelefono(inputId);
  const iti = window.intlTelInput(input, {
    initialCountry: 'mx',
    strictMode: true,
    loadUtils: () => import('/vendor/intl-tel-input/js/utils.js'),
  });
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
  input.addEventListener('blur', () => { estado.tocado = true; revisarTelefono(inputId); });
  input.addEventListener('input', () => { if (estado.tocado) revisarTelefono(inputId); });
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
  return !!pregunta(`${mensaje}\n\nGuardar de todos modos con este numero?`);
}
