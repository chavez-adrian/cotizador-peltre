// Nucleo puro de la Tabla de prospectos (spec #306, CONTEXT.md "Tabla de
// prospectos" y "Estado del prospecto"): prospecto -> la fila que la pantalla
// pinta. Sin IO: la ruta lee los stores y llama aqui, y los tickets que siguen
// extienden estas mismas firmas sin cambiarlas.
//
// El Toque es la unica verdad de "ya lo contacte" (CONTEXT.md "Toque"): de el
// salen el Estado, el Ultimo contacto y el conteo de la cadencia. No hay
// ninguna otra marca de contactado.

// El escalon Agendado reusa las reglas de siguiente contacto de la cola Hoy
// (#314): son las MISMAS funciones, no una copia, para que la tabla y Hoy no
// puedan discrepar sobre que compromiso sigue abierto.
import { siguienteContactoFuturo, siguienteContactoVencido, calificacionVacia } from '../public/js/prospectos-logica.js';
import { origenDe } from '../public/js/origen-logica.js';

function toquesDe(p) {
  return ((p && p.eventos) || []).filter(e => e.tipo === 'toque');
}

// #316: la columna Gafete. Solo un evento de CAPTURA HUMANA cuenta -- un toque
// o una cotizacion son actividad posterior, no captura (CONTEXT.md "Gafete"):
// contar cualquier evento habria convertido "Solo gafete" en "Gafete + stand"
// en cuanto el boton Contacte de #313 le agrega un toque.
export const RANGO_GAFETE = ['solo_gafete', 'gafete_y_stand', 'sin_gafete'];

function capturaHumanaDe(p) {
  return ((p && p.eventos) || []).some(e => e.tipo === 'captura_expo' || e.tipo === 'captura_publica');
}

export function gafeteDe(p) {
  const escaneado = !!(p && p.data && p.data.escaneado);
  if (!escaneado) return 'sin_gafete';
  return capturaHumanaDe(p) ? 'gafete_y_stand' : 'solo_gafete';
}

// #315: el cliente ligado es `data.cliente_id` -- lo que deja
// `prospectosStore.ligarCliente` -- y no el evento 'cliente': el evento es la
// bitacora del alta y el campo es la liga vigente.
function clienteIdDe(p) {
  const id = p && p.data && p.data.cliente_id;
  return id == null ? null : id;
}

// #315: el escalon Cotizado tiene DOS fuentes porque el glosario dice "tiene al
// menos una cotizacion", no "tiene el evento": el evento que el prospecto ya
// guarda y el arreglo de cotizaciones YA LIGADAS que la ruta resolvera en #319.
// Cualquiera de las dos basta.
function tieneCotizacion(p, cotizaciones) {
  if (((p && p.eventos) || []).some(e => e.tipo === 'cotizacion')) return true;
  return (cotizaciones || []).length > 0;
}

// La escalera del glosario tiene cinco escalones con precedencia de arriba
// hacia abajo (CONTEXT.md "Estado del prospecto"), y este orden de returns ES
// esa precedencia: cliente > cotizado > agendado > contactado > sin_contactar.
export function estadoProspecto(p, cotizaciones = [], ahora = new Date()) {
  if (clienteIdDe(p) != null) return 'cliente';
  if (tieneCotizacion(p, cotizaciones)) return 'cotizado';
  if (siguienteContactoFuturo(p, ahora) || siguienteContactoVencido(p, ahora)) return 'agendado';
  return toquesDe(p).length > 0 ? 'contactado' : 'sin_contactar';
}

// El ultimo contacto es el toque MAS RECIENTE por fecha, no el ultimo del
// arreglo: los eventos se agregan en el orden en que se registran y una
// importacion puede dejarlos desordenados.
function ultimoContactoDe(toques) {
  let ultimo = null;
  for (const t of toques) {
    if (!ultimo || new Date(t.fecha) > new Date(ultimo)) ultimo = t.fecha;
  }
  return ultimo;
}

export function filaTabla(p, cotizaciones = [], ahora = new Date()) {
  const toques = toquesDe(p);
  return {
    ...p,
    estado: estadoProspecto(p, cotizaciones, ahora),
    ultimoContacto: ultimoContactoDe(toques),
    toques: toques.length,
    gafete: gafeteDe(p),
    clienteId: clienteIdDe(p),
    queFalta: queFalta(p, cotizaciones),
    // #317: el Origen del glosario (CONTEXT.md "Origen"), resuelto por el mismo
    // nucleo que el pipeline, el Historial y Hoy. Sin indice no hay herencia
    // que hacer -- la fila ES la del prospecto y su canal propio manda -- pero
    // el campo se llama y se normaliza igual en todas las vistas.
    origen: origenDe(p).origen,
  };
}

// --- #321: que falta (prospectos) ---

// Orden de salida fijo (CONTEXT.md "Que sigue / Que falta"). 'datos_fiscales'
// y 'domicilio' los calcula #322: aqui nunca se emiten.
export const LLAVES_QUE_FALTA = ['calificacion', 'correo', 'datos_fiscales', 'domicilio'];

export function queFalta(p, cotizaciones = []) {
  const d = (p && p.data) || {};
  const llaves = [];
  if (String(d.evento || '').trim() && calificacionVacia(d.calificacion)) llaves.push('calificacion');
  if (!String(d.correo || '').trim()) llaves.push('correo');
  return llaves;
}
