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
  const wa = c.telefono
    ? `<div class="cot-card-actions"><a href="https://wa.me/${escapeHtml(c.telefono)}" target="_blank" class="btn btn-primary btn-sm">WhatsApp</a></div>`
    : '';
  return `<div class="tablero-card" draggable="${!CERRADAS.has(col)}" data-id="${c.id}" data-col="${col}">
    <div class="cot-card">
      <div class="cot-card-header">
        <div>
          <div class="cot-card-cliente">${escapeHtml(c.cliente || 'Sin nombre')}</div>
          <div class="cot-card-meta">${fechaCorta(c.fecha)} · hace ${dias} días · ${escapeHtml(c.vendedor)} · ${c.totalPiezas} pzs</div>
        </div>
        <div class="cot-card-total">$${fmtMoneda(c.total)}</div>
      </div>
      ${wa}
    </div>
  </div>`;
}

export function buildTableroCotizacionesHtml(cotizaciones, hoy = new Date()) {
  const cols = agruparTableroCotizaciones(cotizaciones, hoy);
  return COLUMNAS_COTIZACIONES.map(col => {
    const tarjetas = cols[col].map(c => buildCotizacionCardHtml(c, col, hoy)).join('');
    return `
      <div class="tablero-col" data-col="${col}">
        <div class="tablero-col-header">${escapeHtml(COLUMNA_LABELS[col])} <span class="tablero-col-count">${cols[col].length}</span></div>
        <div class="tablero-col-cards">${tarjetas}</div>
      </div>
    `;
  }).join('');
}
