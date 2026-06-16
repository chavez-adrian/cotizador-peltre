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

import { escapeHtml } from './prospectos-logica.js';

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

function buildOportunidadCardHtml(o) {
  const total = o.total ? `<div class="cot-card-total">$${fmtMoneda(o.total)}</div>` : '';
  const meta = [o.vendedor, o.ciudad, o.canal].filter(Boolean).map(escapeHtml).join(' · ');
  return `<div class="tablero-card" data-id="${o.id}" data-etapa="${escapeHtml(o.etapa)}">
    <div class="cot-card">
      <div class="cot-card-header">
        <div>
          <div class="cot-card-cliente">${escapeHtml(nombreOportunidad(o))}</div>
          ${meta ? `<div class="cot-card-meta">${meta}</div>` : ''}
        </div>
        ${total}
      </div>
    </div>
  </div>`;
}

export function buildTableroPipelineHtml(oportunidades) {
  const cols = agruparPipeline(oportunidades);
  return COLUMNAS_PIPELINE.map(etapa => {
    const tarjetas = cols[etapa].map(buildOportunidadCardHtml).join('');
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
