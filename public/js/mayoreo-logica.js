// Logica pura de la captura publica de mayoreo (issue #157, ADR-0012). Modulo sin
// efectos de navegador -- lo consumen mayoreo.js (ESM en el browser), server.js
// (validacion y armado del lado del servidor) y los tests .cjs via import()
// dinamico. Mismo patron que alta-logica.js / prospectos-logica.js: una sola
// implementacion, cero copias espejo.

import { validarTelefono, combinarTelefonoConCodigo } from './alta-logica.js';

// Tipo de proyecto -> segmento de Operam (tabla de campos del ticket). Varias
// opciones caen a proposito en el mismo segmento (Restaurantes/Hoteles/Cafeterias
// son 10): por eso la opcion textual se conserva ademas en las notas.
const SEGMENTO_POR_TIPO = {
  'Distribuidores': 14,
  'Menudistas': 8,
  'Restaurantes': 10,
  'Hoteles': 10,
  'Cafeterías': 10,
  'Catering | Eventos': 15,
  'Agencias | Marcas': 12,
  'Otro': 1,
};

export const TIPOS_PROYECTO = Object.keys(SEGMENTO_POR_TIPO);

export function segmentoDeTipo(tipo) {
  const s = SEGMENTO_POR_TIPO[tipo];
  return s === undefined ? null : s;
}

// Cantidad estimada: los mismos cortes de las listas de mayoreo MENOS +6,000.
// La omision es deliberada (CONTEXT.md "Captura publica"): ese nivel exige
// negociacion humana y no debe entrar por autoservicio.
export const CANTIDADES = ['+100', '+350', '+550', '+1,500'];

// "Para cuando lo necesitas": catalogo cerrado de rangos, nunca texto libre ni
// fecha exacta (CONTEXT.md "Captura publica").
export const CUANDO_OPCIONES = [
  'En las próximas 4 semanas',
  'En los próximos 3 meses',
  'En los próximos 6 meses',
  'Aún no tengo fecha',
];

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

function distancia(a, b) {
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
    if (distancia(dominio, d) <= 2) return d;
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
  if (validarTelefono(f.celCode || '+52', f.cel || '')) mal('cel', 'Escribe tu celular a 10 dígitos.');
  if (!vacio(f.correo) && !/.+@.+\..+/.test(String(f.correo).trim())) {
    mal('correo', 'Ese correo no se ve válido.');
  }
  return errores;
}

// Canal de origen de la captura publica -- del catalogo cerrado de CANALES
// (prospectos-logica.js). El endpoint publico lo fija; nunca lo elige el que envia.
export const CANAL_MAYOREO = 'Formulario web';

function limpio(v) {
  return String(v == null ? '' : v).trim();
}

// Formulario publico -> captura de prospecto de #57 ({ celular, nombre, ciudad,
// canal, data }). La consumen el endpoint publico (server.js) y sus tests. El
// vendedor y la etapa NO se deciden aqui: son del endpoint (no_asignado, sin dueno).
//
// `fechaISO` entra como parametro (no se lee el reloj) para que el modulo siga
// puro: la fecha del consentimiento de promociones es un dato de auditoria y el
// que llama es quien sabe en que instante ocurrio la captura.
export function buildCapturaMayoreo(form, fechaISO) {
  const f = form || {};
  const data = {};
  const opcional = (k, v) => { if (limpio(v)) data[k] = limpio(v); };

  const segmento = segmentoDeTipo(f.tipo);
  if (segmento !== null) data.segmento_id = segmento;
  if (CANTIDADES.includes(f.cant)) data.piezas_estimadas = f.cant;
  opcional('correo', f.correo);
  opcional('empresa', f.empresa);
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

  return {
    celular: celularDeMayoreo(f),
    nombre: unirNombre(f.nombre, f.apellido),
    ciudad: limpio(f.ciudad),
    canal: CANAL_MAYOREO,
    data,
  };
}
