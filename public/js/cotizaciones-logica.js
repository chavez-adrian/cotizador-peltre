// Logica pura del tablero de cotizaciones (issue #50, CONTEXT.md "Tablero de
// cotizaciones"): columnas = cadencia de seguimiento + cierre. Las tarjetas
// avanzan solas con el tiempo (umbrales de lib/seguimiento.js: 2/7/21/28 dias
// naturales desde la fecha de envio); solo el cierre se opera arrastrando a
// Ganada o Perdida. Modulo sin efectos de navegador, mismo patron que
// prospectos-logica.js: lo consumen app.js y los tests .cjs via import().

import { escapeHtml } from './prospectos-logica.js';

const MS_DIA = 24 * 60 * 60 * 1000;

export const COLUMNAS_COTIZACIONES = ['reciente', 'dia2', 'dia7', 'por_vencer', 'vencida', 'ganada', 'perdida'];

const COLUMNA_LABELS = {
  reciente: 'Recién enviada',
  dia2: 'Día 2',
  dia7: 'Día 7',
  por_vencer: 'Por vencer',
  vencida: 'Vencida',
  ganada: 'Ganada',
  perdida: 'Perdida',
};

const CERRADAS = new Set(['ganada', 'perdida']);

// Columna de una cotizacion hoy. Los estados cerrados mandan sobre la edad;
// descartada queda fuera del tablero (es accion de tarjeta, no columna).
export function columnaCotizacion(c, hoy = new Date()) {
  if (c.estado === 'descartada') return null;
  if (CERRADAS.has(c.estado)) return c.estado;
  const dias = Math.floor((hoy - new Date(c.fecha)) / MS_DIA);
  if (dias >= 28) return 'vencida';
  if (dias >= 21) return 'por_vencer';
  if (dias >= 7) return 'dia7';
  if (dias >= 2) return 'dia2';
  return 'reciente';
}

export function agruparTableroCotizaciones(cotizaciones, hoy = new Date()) {
  const cols = {};
  for (const col of COLUMNAS_COTIZACIONES) cols[col] = [];
  for (const c of cotizaciones || []) {
    const col = columnaCotizacion(c, hoy);
    if (col) cols[col].push(c);
  }
  for (const col of COLUMNAS_COTIZACIONES) {
    cols[col].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  }
  return cols;
}

// El tiempo no se arrastra: solo se puede soltar en Ganada o Perdida, y solo
// desde una columna de cadencia (una cerrada no se reabre arrastrando).
export function puedeArrastrarCotizacion(de, a) {
  return CERRADAS.has(a) && !CERRADAS.has(de);
}

function fmtMoneda(n) {
  if (n == null) return '0.00';
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fechaCorta(fecha) {
  return new Date(fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Tarjeta del tablero: cliente, total, piezas, vendedor, dias desde envio y
// link wa.me (el telefono llega del servidor ya en formato wa via
// lib/seguimiento.telefonoWa). Solo las columnas de cadencia son arrastrables.
function buildCotizacionCardHtml(c, col, hoy) {
  const dias = Math.floor((hoy - new Date(c.fecha)) / MS_DIA);
  const abierta = !CERRADAS.has(col);
  const acciones = [];
  if (c.telefono) acciones.push(`<a href="https://wa.me/${escapeHtml(c.telefono)}" target="_blank" class="btn btn-primary btn-sm">WhatsApp</a>`);
  // Cierre por boton ademas del arrastre: en tactil no hay drag (feedback de
  // Adrian en la revision movil 2026-06-12).
  if (abierta) {
    acciones.push(`<button class="btn btn-secondary btn-sm" onclick="cerrarCotizacionTablero(${c.id}, 'ganada')">Ganada</button>`);
    acciones.push(`<button class="btn btn-secondary btn-sm" onclick="cerrarCotizacionTablero(${c.id}, 'perdida')">Perdida</button>`);
  }
  return `<div class="tablero-card" draggable="${abierta}" data-id="${c.id}" data-col="${col}">
    <div class="cot-card">
      <div class="cot-card-header">
        <div>
          <div class="cot-card-cliente">${escapeHtml(c.cliente || 'Sin nombre')}</div>
          <div class="cot-card-meta">${fechaCorta(c.fecha)} · hace ${dias} días · ${escapeHtml(c.vendedor)} · ${c.totalPiezas} pzs</div>
        </div>
        <div class="cot-card-total">$${fmtMoneda(c.total)}</div>
      </div>
      ${acciones.length ? `<div class="cot-card-actions">${acciones.join(' ')}</div>` : ''}
    </div>
  </div>`;
}

// Link wa.me para compartir una cotizacion del historial (issue #103): mismo
// formato de mensaje que shareWhatsApp (app.js) para la cotizacion recien
// generada, pero apuntando al HTML regenerado desde el registro guardado en
// vez del PDF de la sesion en curso. origin lo pasa el caller
// (window.location.origin no existe en este modulo sin efectos de navegador).
export function buildWhatsAppLinkHistorial(c, origin = '') {
  const htmlUrl = `${origin}/api/cotizacion/html/${c.id}`;
  const msg = encodeURIComponent(
    `Cotizacion Peltre Nacional\nCliente: ${c.cliente || 'Cliente'}\nTotal: $${fmtMoneda(c.total)}\n\nVer cotizacion:\n${htmlUrl}`
  );
  return `https://wa.me/?text=${msg}`;
}

// Acciones de una fila del historial (issue #103): Ver PDF / Ver HTML regeneran
// el documento desde el registro guardado via los GET correspondientes (sin
// depender de disco); WhatsApp abre wa.me con el link al HTML regenerado. Sin
// data persistida (registro historico, c.hasData false) no hay nada que
// regenerar: las tres quedan deshabilitadas en vez de apuntar a un 404.
export function buildHistorialAccionesHtml(c, origin = '') {
  if (!c.hasData) {
    return ['Ver PDF', 'Ver HTML', 'WhatsApp']
      .map(label => `<button class="btn btn-secondary btn-sm" disabled title="Datos no disponibles">${label}</button>`)
      .join(' ');
  }
  const pdfUrl = `/api/cotizacion/pdf/${c.id}`;
  const htmlUrl = `/api/cotizacion/html/${c.id}`;
  const waUrl = buildWhatsAppLinkHistorial(c, origin);
  return `<a href="${escapeHtml(pdfUrl)}" target="_blank" class="btn btn-secondary btn-sm">Ver PDF</a>` +
    ` <a href="${escapeHtml(htmlUrl)}" target="_blank" class="btn btn-secondary btn-sm">Ver HTML</a>` +
    ` <a href="${escapeHtml(waUrl)}" target="_blank" class="btn btn-primary btn-sm">WhatsApp</a>`;
}

export function buildTableroCotizacionesHtml(cotizaciones, hoy = new Date()) {
  const cols = agruparTableroCotizaciones(cotizaciones, hoy);
  return COLUMNAS_COTIZACIONES.map(col => {
    const tarjetas = cols[col].map(c => buildCotizacionCardHtml(c, col, hoy)).join('');
    const suma = cols[col].reduce((s, c) => s + (c.total || 0), 0);
    return `
      <div class="tablero-col" data-col="${col}">
        <div class="tablero-col-header"><span class="col-pill col-pill-${col}">${escapeHtml(COLUMNA_LABELS[col])} <span class="tablero-col-count">${cols[col].length}</span></span></div>
        <div class="tablero-col-suma">$${fmtMoneda(suma)}</div>
        <div class="tablero-col-cards">${tarjetas || '<div class="tablero-col-vacia">Sin cotizaciones</div>'}</div>
      </div>
    `;
  }).join('');
}
