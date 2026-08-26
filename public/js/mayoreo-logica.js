// Logica pura de la captura publica de mayoreo (issue #157, ADR-0012). Modulo sin
// efectos de navegador -- lo consumen mayoreo.js (ESM en el browser), server.js
// (validacion y armado del lado del servidor) y los tests .cjs via import()
// dinamico. Mismo patron que alta-logica.js / prospectos-logica.js: una sola
// implementacion, cero copias espejo.

import { validarTelefono, combinarTelefonoConCodigo, paisDesdeCodigoTelefono } from './alta-logica.js';
import { PIEZAS_ESTIMADAS, TIPOS_CLIENTE, segmentoDeTipo } from './prospectos-logica.js';

// Tipo de cliente -> segmento de Operam. El catalogo y su mapeo son UNICOS y
// viven en el nucleo de prospectos (prospectos-logica.js) desde #261: los tres
// caminos de captura (manual, publica y de expo) comparten esa sola fuente
// (CONTEXT.md "Tipo de cliente"). Aqui solo se reexponen con el nombre que ya
// usan el formulario publico y sus tests.
export const TIPOS_PROYECTO = TIPOS_CLIENTE;
export { segmentoDeTipo };

// Cantidad estimada: los cortes del sistema (PIEZAS_ESTIMADAS) MENOS +6,000. Se
// DERIVAN, no se copian: si manana cambian los cortes, cambian en un solo lugar
// y lo que guarda el formulario sigue siendo un valor que el resto del sistema
// entiende. La omision de +6,000 es deliberada (CONTEXT.md "Captura publica"):
// ese nivel exige negociacion humana y no debe entrar por autoservicio.
export const SIN_AUTOSERVICIO = '+6,000';
export const CANTIDADES = PIEZAS_ESTIMADAS.filter(p => p !== SIN_AUTOSERVICIO);

// "Para cuando lo necesitas": catalogo cerrado de rangos, nunca texto libre ni
// fecha exacta (CONTEXT.md "Captura publica").
export const CUANDO_OPCIONES = [
  'En las próximas 4 semanas',
  'En los próximos 3 meses',
  'En los próximos 6 meses',
  'Aún no tengo fecha',
];

// Codigos de pais -- catalogo cerrado. Son los codigos de alta-logica tal
// cual, para que el widget no tenga que traducir nada. Se valida como
// cualquier otro catalogo: este endpoint es publico y sin el, cualquiera
// guardaria un celular con el prefijo que se le ocurra.
//
// '+' (issue #161): el celular ahora se captura con intl-tel-input, un widget
// internacional que no restringe el pais a MX/US/CA. Cuando el prospecto elige
// otro pais, mayoreo.js manda celCode='+' (el generico de alta-logica para
// "Otro") junto con el E.164 completo que entrega el widget. Ampliar el
// catalogo es seguro porque la proteccion real dejo de ser "solo estos
// prefijos": el servidor revalida con libphonenumber-js (lib/telefono-posible.js)
// antes de aceptar la captura, que es mas fuerte que un catalogo de prefijos.
export const CODIGOS_PAIS = ['+52', '+1', '+1-CA', '+'];

// Tope de los textos libres. Superficie publica sin auth: sin esto una sola
// captura puede guardar el megabyte que aguanta express.json. Los limites son
// holgados para un humano y estrechos para un abuso.
export const LIMITES_TEXTO = {
  otro: 200, empresa: 200, cp: 10, ciudad: 120,
  nombre: 80, apellido: 80, cargo: 120, correo: 254, web: 200,
};

// Dominios de correo frecuentes en Mexico para el typo-check con sugerencia.
export const DOMINIOS_CORREO = [
  'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com',
  'yahoo.com.mx', 'icloud.com', 'prodigy.net.mx', 'live.com.mx',
];

// El formulario pide nombre y apellido por separado (dos campos obligatorios
// inducen datos mas completos) pero el prospecto guarda UN solo nombre.
export function unirNombre(nombre, apellido) {
  return [nombre, apellido].map(v => String(v == null ? '' : v).trim())
    .filter(Boolean).join(' ');
}

function distanciaEdicion(a, b) {
  if (Math.abs(a.length - b.length) > 2) return Infinity;
  const m = [];
  for (let i = 0; i <= a.length; i++) m[i] = [i];
  for (let j = 0; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      m[i][j] = Math.min(
        m[i - 1][j] + 1,
        m[i][j - 1] + 1,
        m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return m[a.length][b.length];
}

// Typo-check del dominio del correo: sugiere el dominio de la lista a distancia
// de edicion <= 2. Devuelve null si el dominio ya es valido, si no se parece a
// ninguno (dominio corporativo propio) o si el correo no trae dominio. Es una
// SUGERENCIA: nunca bloquea el envio.
export function sugerirDominioCorreo(correo) {
  const v = String(correo == null ? '' : correo).trim();
  const at = v.indexOf('@');
  if (at < 1) return null;
  const dominio = v.slice(at + 1).toLowerCase();
  if (!dominio || DOMINIOS_CORREO.includes(dominio)) return null;
  for (const d of DOMINIOS_CORREO) {
    if (distanciaEdicion(dominio, d) <= 2) return d;
  }
  return null;
}

// Celular del formulario publico -> telefono con codigo de pais del sistema.
// El select de pais lleva DIRECTO el codigo de alta-logica ('+52' / '+1' /
// '+1-CA'), asi que no hay traduccion entre el widget y la validacion de la casa.
export function celularDeMayoreo(form) {
  const f = form || {};
  return combinarTelefonoConCodigo(f.celCode || '+52', f.cel || '');
}

// Pais para resolver el CP (issue #160): se hereda del select de codigo de pais
// del celular, MISMA regla que paisDesdeCodigoTelefono (alta-logica.js) usa para
// el domicilio de entrega -- sin copia, y +1-CA sigue siendo Canada aunque
// comparta el +1 de marcado con Estados Unidos.
export function paisDelFormulario(form) {
  const f = form || {};
  return paisDesdeCodigoTelefono(f.celCode || '+52');
}

function vacio(v) {
  return !String(v == null ? '' : v).trim();
}

// Valida la captura publica. Devuelve TODOS los errores como
// [{ campo, mensaje }] en el orden del formulario: el navegador marca cada campo
// y hace scroll al primero; el servidor solo mira si el arreglo trae algo (no
// confia en el cliente). Los mensajes son los del formulario, en espanol.
export function validarMayoreo(form) {
  const f = form || {};
  const errores = [];
  const mal = (campo, mensaje) => errores.push({ campo, mensaje });

  if (!TIPOS_PROYECTO.includes(f.tipo)) mal('tipo', 'Selecciona una opción.');
  else if (f.tipo === 'Otro' && vacio(f.otro)) mal('otro', 'Cuéntanos qué tienes en mente.');
  if (!CANTIDADES.includes(f.cant)) mal('cant', 'Selecciona una cantidad.');
  if (vacio(f.cp)) mal('cp', 'Escribe tu código postal.');
  // En esta rebanada la ciudad es texto manual obligatorio; #160 la resuelve
  // desde el CP y deja este campo como respaldo.
  if (vacio(f.ciudad)) mal('ciudad', 'Escribe tu ciudad.');
  if (!vacio(f.cuando) && !CUANDO_OPCIONES.includes(f.cuando)) mal('cuando', 'Selecciona una opción.');
  if (vacio(f.nombre)) mal('nombre', 'Escribe tu nombre.');
  if (vacio(f.apellido)) mal('apellido', 'Escribe tu apellido.');
  const celCode = f.celCode || '+52';
  if (!CODIGOS_PAIS.includes(celCode) || validarTelefono(celCode, f.cel || '')) {
    mal('cel', 'Escribe tu celular a 10 dígitos.');
  }
  if (!vacio(f.correo) && !/.+@.+\..+/.test(String(f.correo).trim())) {
    mal('correo', 'Ese correo no se ve válido.');
  }

  // Guardia de abuso, no de UX: se anexa al final porque a un humano no le
  // dispara nunca (los topes son holgados) y no debe reordenar los errores
  // reales del formulario. Solo marca campos que no fallaron ya por otra razon.
  for (const [campo, max] of Object.entries(LIMITES_TEXTO)) {
    const largo = String(f[campo] == null ? '' : f[campo]).trim().length;
    if (largo > max && !errores.some(e => e.campo === campo)) {
      mal(campo, 'Ese texto es demasiado largo.');
    }
  }
  return errores;
}

// Canal de origen de la captura publica -- del catalogo cerrado de CANALES
// (prospectos-logica.js). El endpoint publico lo fija; nunca lo elige el que envia.
export const CANAL_MAYOREO = 'Formulario web';

// QR del stand (issue #264, CONTEXT.md "Evento"): el visitante llega a
// /mayoreo?evento=<nombre> y ese parametro viaja tal cual en el body. Si
// coincide con el evento activo la captura nace con este canal (del mismo
// catalogo cerrado de CANALES); si no coincide, o no hay evento activo, se
// ignora y la captura es la de siempre. Quien captura nunca elige el canal.
export const CANAL_FERIA_EXPO = 'Feria/Expo';

// Lee el parametro `evento` de la URL del formulario publico. Recibe el query
// string crudo (`location.search`) en vez de leer `location` directo para que
// el nucleo siga sin efectos de navegador y sea testeable sin DOM.
export function eventoDeQuery(queryString) {
  return new URLSearchParams(queryString || '').get('evento') || '';
}

function limpio(v) {
  return String(v == null ? '' : v).trim();
}

// Particulas del espanol que van en minuscula salvo como primera palabra del
// campo (issue #235). NO es la misma lista que PREPOSICIONES/ARTICULOS de
// lib/deduplicacion.js: esa lista sirve para TOKENIZAR y comparar candidatos
// (proposito distinto), esta sirve para CAPITALIZAR texto de presentacion.
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y']);

// Siglas que se preservan SIEMPRE, incluso si el campo entero viene en
// mayusculas: formas societarias mexicanas + CDMX + las paqueterias con las
// que ya opera el cotizador. Rescata el caso mas comun de razon social
// mexicana ("... SA DE CV") de la correccion agresiva de abajo.
const SIGLAS_FIJAS = new Set(['SA', 'CV', 'RL', 'SC', 'CDMX', 'FEDEX', 'DHL', 'UPS']);

function capitalizarToken(token) {
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

// Capitaliza nombre/apellido/empresa de la captura publica (issue #235): un
// solo nucleo para que la tarjeta, el correo de alerta y la vCard no puedan
// divergir. NO se llama normalizarNombre -- ese simbolo ya existe en
// lib/deduplicacion.js con otro proposito (tokenizar para comparar
// candidatos); aqui se produce texto de PRESENTACION, no una llave de
// comparacion. Tampoco reutiliza nombrePropio/empresaPropia de
// lib/cruce-bitrix.js (#159): esas resuelven un problema parecido pero con
// otra regla (particulas de nombre extranjero, sigla de hasta 3 letras SIN
// exigir contraste con el resto del campo) -- copiarla aqui rompe la tabla de
// #235 (p.ej. "GRUPO GNP" tendria que quedar "Grupo Gnp", no "Grupo GNP").
//
// Regla de siglas cortas (<=4 letras, fuera de SIGLAS_FIJAS): se preservan
// SOLO si el campo NO viene entero en mayusculas. El contraste (unas palabras
// en mayusculas, otras no) es la unica senal de que fue a proposito -- el
// largo por si solo no sirve ("JUAN" tambien tiene 4 letras). Sin contraste
// (campo entero en mayusculas) no hay senal y se corrige todo.
export function capitalizarCampo(valor) {
  const v = limpio(valor).replace(/\s+/g, ' ');
  if (!v) return '';
  const todoMayus = v === v.toUpperCase() && v !== v.toLowerCase();
  return v.split(' ').map((token, i) => {
    const tokenMayus = token.toUpperCase();
    if (SIGLAS_FIJAS.has(tokenMayus)) return tokenMayus;
    const tokenMinus = token.toLowerCase();
    if (i > 0 && PARTICULAS.has(tokenMinus)) return tokenMinus;
    if (!todoMayus && token === tokenMayus && token.length <= 4 && token !== tokenMinus) return token;
    return capitalizarToken(token);
  }).join(' ');
}

// Formulario publico -> captura de prospecto de #57 ({ celular, nombre, ciudad,
// canal, data }). La consumen el endpoint publico (server.js) y sus tests. El
// vendedor y la etapa NO se deciden aqui: son del endpoint (no_asignado, sin dueno).
//
// `fechaISO` entra como parametro (no se lee el reloj) para que el modulo siga
// puro: la fecha del consentimiento de promociones es un dato de auditoria y el
// que llama es quien sabe en que instante ocurrio la captura.
//
// Por que `data` lleva llaves fuera del catalogo OPCIONALES de prospectos-logica
// (cp, cuando, web, promos): ese catalogo es el de la captura MANUAL y su
// formulario de edicion, no una lista blanca de todo lo que `data` puede tener.
// El resto del sistema ya escribe ahi llaves propias sin pasar por el (data.cliente_id
// en ligarCliente, data.folioOperam en moverASeguimientoConFolio). La captura
// publica pide mas campos por diseno del ticket #157 y los guarda estructurados
// en vez de aplastarlos en notas.
// `eventoActivo` es el mismo objeto que devuelve eventoActivoConfigurado() en
// server.js ({ nombre, fin } o null) -- el llamador resuelve la configuracion,
// este nucleo solo compara nombres. Sin evento activo, o con un evento en el
// form que no coincide, el comportamiento es identico al de antes de #264.
export function buildCapturaMayoreo(form, fechaISO, eventoActivo) {
  const f = form || {};
  const data = {};
  const opcional = (k, v) => { if (limpio(v)) data[k] = limpio(v); };

  const segmento = segmentoDeTipo(f.tipo);
  if (segmento !== null) data.segmento_id = segmento;
  if (CANTIDADES.includes(f.cant)) data.piezas_estimadas = f.cant;
  opcional('correo', f.correo);
  // Mayusculas corregidas UNA vez aqui (issue #235): la tarjeta, el correo de
  // alerta y la vCard leen nombre/empresa de esta captura, nunca del form
  // crudo, asi que heredan la correccion sin tocar esos otros puntos.
  opcional('empresa', capitalizarCampo(f.empresa));
  opcional('cp', f.cp);
  opcional('cuando', f.cuando);
  opcional('web', f.web);

  // Notas: la opcion textual del tipo (varias comparten segmento), lo que
  // escribio en "Otro" y su cargo -- el cargo no esta en el catalogo OPCIONALES
  // de prospectos, y en notas queda a la vista del vendedor en la tarjeta.
  const notas = [`Tipo de proyecto: ${limpio(f.tipo)}`];
  if (f.tipo === 'Otro' && limpio(f.otro)) notas.push(`Especificó: ${limpio(f.otro)}`);
  if (limpio(f.cargo)) notas.push(`Cargo: ${limpio(f.cargo)}`);
  data.notas = notas.join('\n');

  // Consentimiento por finalidad (LFPDPPP): las promociones son finalidad
  // secundaria, desmarcada por defecto. La prueba del consentimiento vale tanto
  // como el consentimiento, por eso el "si" viaja fechado; el "no" queda
  // registrado sin fecha (no hay consentimiento que fechar).
  data.promos = f.promos ? { acepta: true, fecha: fechaISO } : { acepta: false };

  // QR del stand (issue #264): el evento no lo elige quien envia -- solo cuenta
  // si coincide LITERAL con el nombre del evento activo. Sin coincidencia (o
  // sin evento activo) la captura es la de siempre, sin rastro de evento.
  const eventoForm = limpio(f.evento);
  const conEvento = !!(eventoForm && eventoActivo && eventoForm === eventoActivo.nombre);
  if (conEvento) data.evento = eventoForm;

  return {
    celular: celularDeMayoreo(f),
    nombre: unirNombre(capitalizarCampo(f.nombre), capitalizarCampo(f.apellido)),
    ciudad: limpio(f.ciudad),
    canal: conEvento ? CANAL_FERIA_EXPO : CANAL_MAYOREO,
    data,
  };
}
