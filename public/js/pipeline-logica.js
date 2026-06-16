// Logica pura del tablero unico del pipeline (issue #53, ADR-0005, CONTEXT.md
// "Tablero del pipeline"): un solo kanban de 7 columnas que reemplaza los dos
// tableros separados del modelo previo (prospectos y cotizaciones). La unidad
// que vive en cada tarjeta es la oportunidad: antes de cotizar es el prospecto
// (etapa por_cotizar / no_asignado), al cotizar lleva la cotizacion
// (seguimiento y post-venta). Modulo sin efectos de navegador, mismo patron que
// cotizaciones-logica.js: lo consumen app.js y los tests .cjs via import().
//
// Browser-safe: no importa de lib/. El vocabulario canonico vive en
// lib/pipeline.js (lo usan stores/server/migracion); aqui se reexpresa para el
// frontend, alineado a ese glosario.

import { escapeHtml, buildColaProspectosHtml } from './prospectos-logica.js';

// Las 7 etapas del embudo son las columnas del tablero. Las salidas (No util,
// Perdida) NO son columnas: viven en filtro/historial.
export const COLUMNAS_PIPELINE = [
  'no_asignado', 'por_cotizar', 'seguimiento', 'anticipo_pagado',
  'pedido_liberado', 'saldo_pagado', 'producto_entregado',
];

export const COLUMNA_LABELS = {
  no_asignado: 'No Asignado',
  por_cotizar: 'Por Cotizar',
  seguimiento: 'Seguimiento',
  anticipo_pagado: 'Anticipo pagado',
  pedido_liberado: 'Pedido liberado',
  saldo_pagado: 'Saldo pagado',
  producto_entregado: 'Producto entregado',
};

const SALIDAS = new Set(['no_util', 'perdida']);

export function esSalida(etapa) {
  return SALIDAS.has(etapa);
}

// Estado PRE / folio Operam (issue #63, CONTEXT.md "Pre-cotizacion"): la
// ausencia del folio define el estado "PRE"; con folio la cotizacion muestra
// "#Operam N". Reexpresion browser-safe de lib/pipeline.etiquetaFolioOperam
// (este modulo no importa de lib/, mismo criterio que el resto del vocabulario).
export function etiquetaFolioOperam(o) {
  const folio = o && o.folioOperam;
  if (folio != null && folio !== '') return `#Operam ${folio}`;
  // Historica de registro desconocido (anterior a #63): se asume registrada, sin
  // badge (ni PRE ni #Operam). Las nuevas sin folio si son PRE.
  return o && o.registroDesconocido ? '' : 'PRE';
}

// Formalizar una pre-cotizacion desde su tarjeta (issue #66, AC1): el disparador
// "Completar" solo aplica mientras la cotizacion sigue siendo PRE. Reusa la regla
// de dominio del badge: con folio ya esta registrada (#Operam N) y una historica
// de registro desconocido se asume registrada -- ninguna ofrece "Completar".
export function puedeCompletarPreCotizacion(cot) {
  return !!cot && etiquetaFolioOperam(cot) === 'PRE';
}

// Decide el siguiente paso de la formalizacion a partir del resultado del
// registro directo (POST /api/cotizacion/operam/:id). Si registro -> 'listo'
// (folio, deja de ser PRE). Si Operam no halla al cliente -> 'alta' (el vendedor
// lo da de alta primero y reintenta). Cualquier otro fallo -> 'error' (se reporta
// sin mandar al alta). El marcador del caso "falta alta" es el mensaje exacto que
// lanza subirCotizacionOperam ("Cliente no encontrado en Operam").
export function siguientePasoFormalizacion(resultado) {
  if (resultado && resultado.ok) return 'listo';
  const error = (resultado && resultado.error) || '';
  return /Cliente no encontrado en Operam/i.test(error) ? 'alta' : 'error';
}

// Boton "Completar" de la tarjeta de cotizacion (Historial / cola Hoy): formaliza
// la pre-cotizacion (alta + registro, o registro directo si ya es cliente). Solo
// aparece mientras la cotizacion es PRE; una registrada o historica no lo muestra.
export function botonCompletarHtml(cot) {
  if (!puedeCompletarPreCotizacion(cot)) return '';
  return `<button class="btn btn-primary btn-sm" onclick="completarPreCotizacion(${cot.id})">Completar</button>`;
}

// Boton + global (issue #54, PRD #52 historias 4-5): visible en todos los
// destinos del bottom-nav, ofrece dos acciones -- "Nueva cotizacion" (la vista
// de cotizar existente) y "Nuevo prospecto" (la captura minima existente).
// Cada accion dispara la funcion homonima de app.js.
export const ACCIONES_NUEVO = [
  { label: 'Nueva cotizacion', accion: 'nuevaCotizacion' },
  { label: 'Nuevo prospecto', accion: 'nuevoProspecto' },
];

export function buildMenuNuevoHtml() {
  return ACCIONES_NUEVO
    .map(a => `<button class="btn btn-sm btn-secondary" onclick="${a.accion}()">${escapeHtml(a.label)}</button>`)
    .join('');
}

// Las oportunidades que viven en el pipeline (las 7 columnas): excluye las
// salidas No util y Perdida, que viven en filtro/historial. Es la misma regla
// que aplica el tablero (agruparPipeline ignora las salidas); la vista lista la
// usa para no mostrar lo que el tablero oculta. Una sola fuente de "que es
// activo".
export function oportunidadesActivas(oportunidades) {
  return (oportunidades || []).filter(o => !esSalida(o.etapa));
}

// Reparte las oportunidades en las 7 columnas por su etapa. Las salidas quedan
// fuera del tablero. Cada columna se ordena de la mas reciente a la mas antigua
// cuando la oportunidad trae fecha.
export function agruparPipeline(oportunidades) {
  const cols = {};
  for (const c of COLUMNAS_PIPELINE) cols[c] = [];
  for (const o of oportunidades || []) {
    if (cols[o.etapa]) cols[o.etapa].push(o);
  }
  for (const c of COLUMNAS_PIPELINE) {
    cols[c].sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));
  }
  return cols;
}

function fmtMoneda(n) {
  if (n == null) return '0.00';
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// La identidad de la tarjeta es la oportunidad: el nombre del prospecto antes de
// cotizar, el cliente de la cotizacion despues. En este slice la tarjeta solo
// existe y se ve en su columna; las acciones (transiciones, drag) llegan en
// issues posteriores.
function nombreOportunidad(o) {
  return o.nombre || o.cliente || 'Sin nombre';
}

// Badge HTML del estado de folio de una cotizacion: '' si es historica de
// registro desconocido (sin etiqueta), si no el chip "PRE" (ambar) o "#Operam N"
// (azul). Unica fuente del badge: la reusan el tablero, la cola Hoy y la vista
// lista, para que las tres pinten lo mismo (incluido el caso sin badge).
export function badgeFolioOperamHtml(cot) {
  const etiqueta = etiquetaFolioOperam(cot);
  if (!etiqueta) return '';
  const clase = etiqueta === 'PRE' ? 'badge-pre' : 'badge-operam';
  return `<span class="cot-badge ${clase}">${escapeHtml(etiqueta)}</span>`;
}

// Badge de folio de un PROSPECTO movido a mano a Seguimiento (issue #56, AC3,
// CONTEXT.md "Etapas del pipeline"): el vendedor cotizo POR FUERA, asi que no hay
// cotizacion en el sistema y el folio vive en el prospecto (data.folioOperam,
// mapeado a o.folioOperam por prospectoAOportunidad). Muestra "#Operam N" SOLO si
// hay folio; jamas "PRE" (PRE es un concepto de cotizacion, no de prospecto). Sin
// folio no pinta nada. Reusa etiquetaFolioOperam unicamente cuando hay folio.
export function badgeFolioOperamProspectoHtml(o) {
  const folio = o && o.folioOperam;
  if (folio == null || folio === '') return '';
  return `<span class="cot-badge badge-operam">${escapeHtml(etiquetaFolioOperam({ folioOperam: folio }))}</span>`;
}

// El badge de la tarjeta del tablero depende del tipo de oportunidad: una
// cotizacion lleva el chip PRE / #Operam (issue #63); un prospecto solo lleva
// #Operam N si fue movido a mano con folio (issue #56), nunca PRE.
function badgeFolioOperam(o) {
  return o.tipo === 'cotizacion' ? badgeFolioOperamHtml(o) : badgeFolioOperamProspectoHtml(o);
}

// Asignar vendedor desde la tarjeta (issue #57, CONTEXT.md "Etapas del pipeline"
// + "Visibilidad"): la PRIMERA accion de tarjeta del tablero, que hasta ahora era
// solo-lectura (#53). Solo aplica a una oportunidad en No Asignado (la unica que
// no tiene dueno). La regla de dominio simetrica vive en lib/pipeline
// (transicionPorAsignacion); aqui solo se decide si la tarjeta admite el control.
export function esAsignable(o) {
  return !!o && o.etapa === 'no_asignado';
}

// Control de asignacion sobre la tarjeta No Asignado: un selector con los
// vendedores del catalogo (GET /api/catalogos) + un boton que dispara
// asignarVendedorTablero(id) en app.js (PATCH /api/prospectos/:id/asignar). Solo
// lo ve el admin (quien asigna, CONTEXT.md "Visibilidad"); el no-admin no ve No
// Asignado y la tarjeta sigue siendo solo-lectura. Sin vendedores en el catalogo
// no se pinta. Funcion pura: el cableado DOM vive en app.js.
export function buildAsignarControlHtml(o, vendedores, esAdmin) {
  if (!esAdmin || !esAsignable(o) || !(vendedores && vendedores.length)) return '';
  const opciones = vendedores
    .map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)}</option>`)
    .join('');
  return `<div class="cot-card-actions tablero-asignar">
    <select id="asignar-vendedor-${o.id}" class="btn-sm"><option value="">Asignar a...</option>${opciones}</select>
    <button class="btn btn-primary btn-sm" onclick="asignarVendedorTablero(${o.id})">Asignar</button>
  </div>`;
}

// Mover a Seguimiento a mano (issue #56, AC1): boton sobre la tarjeta de un
// PROSPECTO en Por Cotizar que abre la captura del folio de Operam (el vendedor
// cotizo POR FUERA). El trigger es un boton, no arrastre (fuera de alcance); al
// confirmar, app.js (moverASeguimientoTablero) llama PATCH /api/prospectos/:id/etapa
// con { etapa:'seguimiento', folio }. Lo ve quien opera la tarjeta (dueno o admin,
// la ruta ya valida con prospectoOperable): NO es admin-only. Una cotizacion ya
// avanza sola al cotizar en el sistema (#55), por eso no lleva este boton.
export function buildMoverSeguimientoControlHtml(o) {
  if (!o || o.tipo !== 'prospecto' || o.etapa !== 'por_cotizar') return '';
  // refId es el id numerico del prospecto (la ruta espera el id real); o.id puede
  // venir prefijado ("p7") cuando la oportunidad se arma desde un prospecto.
  const id = o.refId ?? o.id;
  return `<div class="cot-card-actions tablero-mover">
    <button class="btn btn-primary btn-sm" onclick="moverASeguimientoTablero(${id})">A Seguimiento (folio Operam)</button>
  </div>`;
}

function buildOportunidadCardHtml(o, vendedores, esAdmin) {
  const total = o.total ? `<div class="cot-card-total">$${fmtMoneda(o.total)}</div>` : '';
  const meta = [o.vendedor, o.ciudad, o.canal].filter(Boolean).map(escapeHtml).join(' · ');
  const badge = badgeFolioOperam(o);
  const asignar = buildAsignarControlHtml(o, vendedores, esAdmin);
  const mover = buildMoverSeguimientoControlHtml(o);
  return `<div class="tablero-card" data-id="${o.id}" data-etapa="${escapeHtml(o.etapa)}">
    <div class="cot-card">
      <div class="cot-card-header">
        <div>
          <div class="cot-card-cliente">${escapeHtml(nombreOportunidad(o))}${badge}</div>
          ${meta ? `<div class="cot-card-meta">${meta}</div>` : ''}
        </div>
        ${total}
      </div>
      ${asignar}
      ${mover}
    </div>
  </div>`;
}

export function buildTableroPipelineHtml(oportunidades, { vendedores, esAdmin } = {}) {
  const cols = agruparPipeline(oportunidades);
  return COLUMNAS_PIPELINE.map(etapa => {
    const tarjetas = cols[etapa].map(o => buildOportunidadCardHtml(o, vendedores, esAdmin)).join('');
    const suma = cols[etapa].reduce((s, o) => s + (o.total || 0), 0);
    return `
      <div class="tablero-col" data-etapa="${etapa}">
        <div class="tablero-col-header"><span class="col-pill col-pill-${etapa}">${escapeHtml(COLUMNA_LABELS[etapa])} <span class="tablero-col-count">${cols[etapa].length}</span></span></div>
        <div class="tablero-col-suma">$${fmtMoneda(suma)}</div>
        <div class="tablero-col-cards">${tarjetas || '<div class="tablero-col-vacia">Sin oportunidades</div>'}</div>
      </div>
    `;
  }).join('');
}

// Cola Hoy fusionada (issue #64, CONTEXT.md "Cola Hoy"): la cola del dia mezcla
// prospectos por contactar (horas habiles) y cotizaciones por seguir (dias
// naturales). El backend (lib/cola-hoy.js -> GET /api/hoy) ya la fusiona y
// ordena por urgencia relativa al umbral de cada tipo, etiquetando cada item con
// `tipo`. Aqui solo se pinta, delegando por tipo y PRESERVANDO ese orden (no se
// reagrupa por tipo). El item de prospecto reusa buildColaProspectosHtml (con su
// WhatsApp, registrar contacto, reunion vencida y sugerencia No util a 3 toques);
// el de cotizacion lleva su mensaje de seguimiento por WhatsApp.

// Etiquetas legibles del paso de seguimiento de una cotizacion (cadencia de dias
// naturales 2/7/21/28, lib/seguimiento.js). Antes vivian inline en showSeguimiento.
const PASO_LABELS = {
  dia2: 'Primer seguimiento',
  dia7: 'Segundo seguimiento',
  dia21: 'Por vencer',
  vencida: 'Vencida',
};

// Tarjeta de una cotizacion en la cola Hoy: WhatsApp con el mensaje de
// seguimiento (item.waLink, sin telefono -> deshabilitado), marcar el paso hecho
// y cerrar el estado (Ganada/Perdida). Extraido de showSeguimiento (app.js) para
// reusarlo en la cola fusionada sin duplicar el markup.
export function buildColaCotizacionItemHtml(item) {
  const fecha = new Date(item.fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  const btnWa = item.waLink
    ? `<a href="${item.waLink}" target="_blank" class="btn btn-primary btn-sm">WhatsApp</a>`
    : `<button class="btn btn-secondary btn-sm" disabled title="Sin telefono registrado">WhatsApp</button>`;
  const badge = badgeFolioOperamHtml(item);
  return `
    <div class="cot-card">
      <div class="cot-card-header">
        <div>
          <div class="cot-card-cliente">${escapeHtml(item.cliente || 'Sin nombre')}${badge}</div>
          <div class="cot-card-meta">${escapeHtml(PASO_LABELS[item.paso] || item.paso)} · cotizada el ${escapeHtml(fecha)} (hace ${item.dias} dias) · ${item.totalPiezas} pzs</div>
        </div>
        <div>
          <div class="cot-card-total">$${fmtMoneda(item.total)}</div>
        </div>
      </div>
      <div class="cot-card-actions">
        ${btnWa}
        <button class="btn btn-secondary btn-sm" onclick="marcarSeguimiento(${item.id}, '${item.paso}')">✓ Hecho</button>
        <button class="btn btn-secondary btn-sm" onclick="cambiarEstadoCotizacion(${item.id}, 'ganada')">Ganada</button>
        <button class="btn btn-secondary btn-sm" onclick="cambiarEstadoCotizacion(${item.id}, 'perdida')">Perdida</button>
      </div>
    </div>
  `;
}

export function buildColaHoyHtml(cola) {
  if (!cola || !cola.length) return '<div class="cot-card-meta">Nada pendiente por ahora.</div>';
  return cola.map(item => item.tipo === 'cotizacion'
    ? buildColaCotizacionItemHtml(item)
    // buildColaProspectosHtml itera una lista; un solo prospecto = lista de uno.
    : buildColaProspectosHtml([item])
  ).join('');
}
