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
// #318: el umbral de la sugerencia de No util es el de la cadencia que ya
// corre en la cola Hoy -- se importa, nunca se copia como literal.
import { SUGERIR_NO_UTIL_TOQUES } from './seguimiento-prospectos.js';
// #319: la cadencia de la cotizacion y el vocabulario del pipeline se importan,
// nunca se reexpresan: el dia que la fila dice es EL de la cola Hoy y el folio
// que muestra es el unico numero publico de la cotizacion (ADR-0009).
import { pasoCadencia } from './seguimiento.js';
import { ultimos10 } from './telefono-llave.js';
import { COLUMNAS_PIPELINE, COLUMNA_LABELS, esSalida, etiquetaFolioOperam } from '../public/js/pipeline-logica.js';

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
    // #319: las cotizaciones YA LIGADAS y ORDENADAS que entrega la ruta. Cada
    // una viaja con su folio -- el unico numero publico de la cotizacion
    // (ADR-0009) -- ademas del id, que es la clave tecnica de las URL y jamas
    // se presenta como numero.
    cotizaciones: (cotizaciones || []).map(c => ({
      id: c.id,
      folio: etiquetaFolioOperam(c),
      folioOperam: c.folioOperam ?? null,
      etapa: c.etapa,
      fecha: c.fecha,
    })),
    // #317: el Origen del glosario (CONTEXT.md "Origen"), resuelto por el mismo
    // nucleo que el pipeline, el Historial y Hoy. Sin indice no hay herencia
    // que hacer -- la fila ES la del prospecto y su canal propio manda -- pero
    // el campo se llama y se normaliza igual en todas las vistas.
    origen: origenDe(p).origen,
    queSigue: queSigue(p, cotizaciones, ahora),
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

// --- #318: que sigue (prospectos) ---

// El dia de la cadencia dicho en palabras. Sin paso todavia (menos de 2 dias)
// la cotizacion acaba de salir: no hay nada vencido que reclamar.
const TEXTO_PASO = { dia2: 'día 2', dia7: 'día 7', dia21: 'día 21', vencida: 'vencida' };

// La UNICA accion en palabras de la fila, derivada del Estado del prospecto
// (CONTEXT.md "Que sigue / Que falta"). Los cinco escalones del glosario
// tienen rama propia; el return final es la red de seguridad de un estado nuevo.
export function queSigue(p, cotizaciones = [], ahora = new Date()) {
  const estado = estadoProspecto(p, cotizaciones, ahora);
  if (estado === 'sin_contactar') return { tipo: 'escribirle', accion: 'Escribirle' };
  if (estado === 'contactado') {
    const toques = toquesDe(p).length;
    if (toques >= SUGERIR_NO_UTIL_TOQUES) {
      return {
        tipo: 'sugerir_no_util',
        accion: `Sugerir No útil (${SUGERIR_NO_UTIL_TOQUES} toques sin respuesta)`,
        toques,
      };
    }
    return { tipo: 'insistir', accion: `Insistir (toque ${toques} de ${SUGERIR_NO_UTIL_TOQUES})`, toques };
  }
  if (estado === 'agendado') {
    // El compromiso es el MISMO que ve la cola Hoy; futuro manda sobre vencido.
    const futuro = siguienteContactoFuturo(p, ahora);
    const sc = futuro || siguienteContactoVencido(p, ahora);
    const vencido = !futuro;
    const canales = sc.canales || [];
    const cola = vencido ? ' (vencido)' : '';
    return {
      tipo: 'agendado',
      accion: `${canales.join(' + ')} el ${fechaDiaCorto(sc.fecha)}${cola}`,
      canales,
      fecha: sc.fecha,
      vencido,
    };
  }
  if (estado === 'cotizado') {
    // "Cuando el cliente tiene varias cotizaciones vivas, la mas avanzada en el
    // embudo manda y la fila avisa que hay mas" (CONTEXT.md "Que sigue / Que
    // falta"): la primera del arreglo YA es la mas avanzada, porque
    // cotizacionesDelProspecto lo ordena asi.
    const vivas = cotizacionesVivas(cotizaciones);
    // Cotizado por el evento pero sin ninguna cotizacion viva a la vista: no hay
    // a que darle seguimiento, lo que sigue es una cotizacion nueva.
    if (!vivas.length) return { tipo: 'cotizado', accion: 'Cotizarle de nuevo', masCotizaciones: 0 };
    return queSigueSeguimiento(vivas, ahora);
  }
  if (estado === 'cliente') {
    const vivas = cotizacionesVivas(cotizaciones);
    // Un alta que nunca cotiza es una fuga (CONTEXT.md "Que sigue / Que falta").
    if (!vivas.length) return { tipo: 'cotizarle', accion: 'Cotizarle', masCotizaciones: 0 };
    // La mas avanzada manda: la primera del arreglo ya lo es.
    const c = vivas[0];
    if (ETAPAS_POST_VENTA.has(c.etapa)) {
      const folio = etiquetaFolioOperam(c);
      const masCotizaciones = vivas.length - 1;
      return {
        tipo: 'etapa',
        etapa: c.etapa,
        accion: `${COLUMNA_LABELS[c.etapa]} (${folio || FOLIO_SIN_NUMERO})${sufijoMas(masCotizaciones)}`,
        cotizacionId: c.id,
        folio,
        masCotizaciones,
        // El estado de pago es el que YA dejo el sync post-venta (#67): la
        // tabla nunca consulta Operam en vivo (CONTEXT.md "Que sigue / Que falta").
        pago: c.data?.espejoOperam?.pago ?? null,
      };
    }
    // Todavia sin senal de post-venta: lo que sigue es el seguimiento de
    // siempre, el MISMO que lee un cotizado.
    return queSigueSeguimiento(vivas, ahora);
  }
  return { tipo: estado, accion: '' };
}

// El seguimiento a la cotizacion mas avanzada, con su dia de cadencia. Lo
// comparten los escalones Cotizado (#319) y Ya es cliente (#320): un cliente
// cuya cotizacion todavia no llega a post-venta lee EXACTAMENTE lo mismo que un
// cotizado, asi que es una sola funcion y no dos textos que puedan derivar.
function queSigueSeguimiento(vivas, ahora) {
  const c = vivas[0];
  const { paso, dias } = pasoCadencia(c, ahora);
  const folio = etiquetaFolioOperam(c);
  const masCotizaciones = vivas.length - 1;
  return {
    tipo: 'seguimiento',
    accion: `Seguimiento a la ${folio || FOLIO_SIN_NUMERO}, ${TEXTO_PASO[paso] || 'enviada hoy'}${sufijoMas(masCotizaciones)}`,
    cotizacionId: c.id,
    folio,
    paso,
    dias,
    masCotizaciones,
  };
}

// El aviso de que hay mas cotizaciones vivas detras de la que manda.
function sufijoMas(masCotizaciones) {
  return masCotizaciones > 0 ? ` y ${masCotizaciones} más` : '';
}
// El mismo dia corto del chip del siguiente contacto de la tarjeta: la fila y
// la tarjeta nombran igual la fecha del compromiso.
function fechaDiaCorto(fecha) {
  return new Date(fecha).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
}

// --- #319: cotizaciones del prospecto ---

// La llave de identidad del prospecto (CONTEXT.md "1 celular = 1 prospecto"):
// `celular10` es lo que deja el store, pero un prospecto importado puede no
// traerlo y entonces se calcula del celular con la MISMA normalizacion.
function llaveDe(p) {
  return (p && p.celular10) || ultimos10(p && p.celular);
}

// Dos caminos de liga, ninguno suficiente solo: el evento 'cotizacion' que
// guarda la tarjeta del prospecto, y el celular del cliente de la cotizacion
// (telefono o celular de entrega), que rescata las cotizaciones nacidas sin
// pasar por la tarjeta. Sin duplicados: una misma cotizacion puede cumplir las
// dos.
export function cotizacionesDelProspecto(p, cotizaciones = []) {
  const porEvento = new Set(
    ((p && p.eventos) || []).filter(e => e.tipo === 'cotizacion').map(e => e.cotizacion_id)
  );
  const llave = llaveDe(p);
  const ligadas = (cotizaciones || []).filter(c => {
    if (porEvento.has(c.id)) return true;
    if (!llave) return false;
    const cli = (c.data && c.data.cliente) || {};
    return ultimos10(cli.telefono) === llave || ultimos10(cli.celEntrega) === llave;
  });
  return ligadas.sort((a, b) =>
    avanceDe(b.etapa) - avanceDe(a.etapa) || new Date(b.fecha || 0) - new Date(a.fecha || 0));
}

// "La mas avanzada en el embudo manda" (CONTEXT.md "Que sigue / Que falta"): el
// avance ES la posicion en COLUMNAS_PIPELINE. Una salida (No util, Perdida) ya
// no avanza, asi que se va al final -- igual que una etapa desconocida, que
// tampoco sabe decir por donde va.
function avanceDe(etapa) {
  return esSalida(etapa) ? -1 : COLUMNAS_PIPELINE.indexOf(etapa);
}

// --- #320: que sigue (clientes) ---

// Las etapas post-venta que dirige el sync (CONTEXT.md "Sincronizacion
// post-venta con Operam") se DERIVAN del orden del pipeline, igual que en
// lib/sync-operam.js: nombrarlas como lista suelta las dejaria derivar del dia
// que el embudo cambie.
const ETAPAS_POST_VENTA = new Set(COLUMNAS_PIPELINE.slice(COLUMNAS_PIPELINE.indexOf('anticipo_pagado')));

// Como se nombra una cotizacion cuando el folio no da numero: la historica de
// registro desconocido (anterior a #63) no tiene badge, y sin esto la fila
// decia "Seguimiento a la , dia 2". El objeto conserva el folio tal cual lo da
// el helper: el respaldo es solo del TEXTO.
const FOLIO_SIN_NUMERO = 'cotización';

// Vivas = las que siguen en el embudo. Las salidas (No util y Perdida) las
// define `esSalida` del pipeline, no una lista local.
export function cotizacionesVivas(cotizaciones = []) {
  return (cotizaciones || []).filter(c => !esSalida(c.etapa));
}
