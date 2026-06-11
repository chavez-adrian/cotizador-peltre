// Logica pura del modulo de prospectos (issue #41, ADR-0004): catalogos cerrados,
// validacion de captura y payload de POST /api/prospectos. Modulo sin efectos de
// navegador -- lo consumen app.js (ESM en el browser), server.js (validacion del
// lado del servidor) y los tests .cjs via import() dinamico. Mismo patron que
// alta-logica.js: una sola implementacion, cero copias espejo.

import { validarTelefono, combinarTelefonoConCodigo } from './alta-logica.js';

// Canal de origen del prospecto -- catalogo cerrado (CONTEXT.md, Captura de prospecto).
export const CANALES = [
  'WhatsApp',
  'Instagram',
  'Facebook/Messenger',
  'Meta Ads',
  'Formulario web',
  'Correo',
  'Referido',
  'Bazar Sábado',
  'Feria/Expo',
];

// Piezas estimadas -- mismos cortes que las listas de mayoreo.
export const PIEZAS_ESTIMADAS = ['+100', '+350', '+550', '+1,500', '+6,000'];

// Campos opcionales de la captura -- unica fuente; el servidor la importa para
// armar data y el frontend para armar el payload.
export const OPCIONALES = ['empresa', 'segmento_id', 'piezas_estimadas', 'correo', 'temperatura', 'notas'];

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, ch => ESCAPES[ch]);
}

// Valida el body de POST /api/prospectos (celular ya combinado con codigo de pais).
// La reusa el servidor y el frontend tras armar el payload. La validacion del
// celular es la misma del alta de cliente (alta-logica.validarTelefono).
export function validarProspectoBody(body) {
  const b = body || {};
  const errTel = validarTelefono('', b.celular);
  if (errTel) return `Celular: ${errTel}`;
  if (!(b.nombre || '').trim()) return 'El nombre es obligatorio';
  if (!(b.ciudad || '').trim()) return 'La ciudad es obligatoria';
  if (!CANALES.includes(b.canal)) return 'El canal de origen es obligatorio (catálogo cerrado)';
  return null;
}

const ETAPA_LABELS = {
  nuevo: 'Nuevo',
  contactado: 'Contactado',
  calificado: 'Calificado',
  cotizado: 'Cotizado',
  no_util: 'No útil',
};

// Salida a No util -- motivo obligatorio de catalogo cerrado (CONTEXT.md,
// Etapas de prospecto).
export const MOTIVOS_NO_UTIL = ['menudeo', 'fuera de zona', 'sin presupuesto', 'spam', 'sin respuesta'];

// Avance manual de etapa: un paso a la vez. La transicion a cotizado es
// automatica (issue #46), nunca manual.
export function siguienteEtapa(etapa) {
  if (etapa === 'nuevo') return 'contactado';
  if (etapa === 'contactado') return 'calificado';
  return null;
}

// Valida una transicion de etapa solicitada por el vendedor. La reusa el
// servidor (rechazo server-side) y el frontend.
export function validarTransicion(actual, nueva, motivo) {
  if (nueva === 'no_util') {
    if (actual === 'no_util') return 'El prospecto ya salió a No útil';
    if (!MOTIVOS_NO_UTIL.includes(motivo)) return 'El motivo de No útil es obligatorio (catálogo cerrado)';
    return null;
  }
  if (!nueva || nueva !== siguienteEtapa(actual)) {
    return `Transición inválida: ${ETAPA_LABELS[actual] || actual} → ${ETAPA_LABELS[nueva] || nueva}`;
  }
  return null;
}

// Link wa.me en un tap: solo digitos, el celular del prospecto ya trae codigo de pais.
export function buildWaLink(celular) {
  const digitos = String(celular || '').replace(/\D/g, '');
  return digitos ? `https://wa.me/${digitos}` : null;
}

function fechaCorta(fecha) {
  return new Date(fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

function etiquetaEvento(e) {
  if (e.tipo === 'captura') return `Capturado por ${escapeHtml(e.vendedor)}`;
  if (e.tipo === 'etapa') return `${escapeHtml(ETAPA_LABELS[e.de] || e.de)} → ${escapeHtml(ETAPA_LABELS[e.a] || e.a)} · ${escapeHtml(e.vendedor)}`;
  if (e.tipo === 'toque') return `Toque · ${escapeHtml(e.vendedor)}`;
  if (e.tipo === 'no_util') return `Salida a No útil (${escapeHtml(e.motivo)}) · ${escapeHtml(e.vendedor)}`;
  if (e.tipo === 'cliente') {
    const nombre = e.nombre ? `${escapeHtml(e.nombre)} (#${escapeHtml(e.cliente_id)})` : `#${escapeHtml(e.cliente_id)}`;
    return `Convertido en cliente ${nombre} · ${escapeHtml(e.vendedor)}`;
  }
  return escapeHtml(`${e.tipo} · ${e.vendedor}`);
}

// Historial completo del prospecto en orden cronologico: la captura misma
// mas los eventos registrados (cambios de etapa, toques, salida a No util).
export function buildHistorialHtml(p) {
  const eventos = [{ tipo: 'captura', fecha: p.fecha, vendedor: p.vendedor }, ...(p.eventos || [])]
    .slice().sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  return eventos.map(e =>
    `<div class="cot-card-meta">${fechaCorta(e.fecha)} · ${etiquetaEvento(e)}</div>`
  ).join('');
}

// Etiqueta de espera (issue #44): horas habiles sin respuesta con el color
// del semaforo que calculo el motor (lib/seguimiento-prospectos.js).
export function buildEsperaBadgeHtml(item) {
  const h = Math.round((item.horas || 0) * 10) / 10;
  return `<span class="espera-badge espera-${escapeHtml(item.color)}">${h} h hábiles sin respuesta</span>`;
}

// Tarjeta de un prospecto en la lista (mismo formato visual que las cards de
// historial/seguimiento de app.js). Funcion pura sin DOM: testeable en Node.
// Las acciones llaman funciones globales de app.js (mismo patron que las
// cards de seguimiento: onclick + window.fn). colaItem es el item del
// prospecto en GET /api/prospectos/cola, si esta en la cola (issue #44).
export function buildProspectoCardHtml(p, colaItem) {
  const d = p.data || {};
  const empresa = d.empresa ? ` · ${escapeHtml(d.empresa)}` : '';
  const activo = p.etapa !== 'no_util' && p.etapa !== 'cotizado';
  const sig = siguienteEtapa(p.etapa);
  const wa = buildWaLink(p.celular);
  const acciones = [];
  if (wa) acciones.push(`<a href="${wa}" target="_blank" class="btn btn-primary btn-sm">WhatsApp</a>`);
  if (activo && sig) {
    acciones.push(`<button class="btn btn-secondary btn-sm" onclick="avanzarEtapaProspecto(${p.id}, '${sig}')">→ ${ETAPA_LABELS[sig]}</button>`);
  }
  if (activo) {
    acciones.push(`<button class="btn btn-secondary btn-sm" onclick="registrarToqueProspecto(${p.id})">+ Toque</button>`);
    acciones.push(
      `<select id="pr-motivo-${p.id}" class="btn-sm"><option value="">Motivo...</option>` +
      MOTIVOS_NO_UTIL.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('') +
      `</select><button class="btn btn-secondary btn-sm" onclick="marcarNoUtilProspecto(${p.id})">No útil</button>`
    );
  }
  acciones.push(`<button class="btn btn-secondary btn-sm" onclick="toggleHistorialProspecto(${p.id})">Historial</button>`);
  return `
    <div class="cot-card">
      <div class="cot-card-header">
        <div>
          <div class="cot-card-cliente">${escapeHtml(p.nombre)}${empresa}</div>
          <div class="cot-card-meta">${fechaCorta(p.fecha)} · ${escapeHtml(p.vendedor)} · ${escapeHtml(p.ciudad)} · ${escapeHtml(p.canal)} · ${escapeHtml(p.celular)}</div>
          ${activo && colaItem ? `<div style="margin-top:4px">${buildEsperaBadgeHtml(colaItem)}</div>` : ''}
        </div>
        <div class="cot-card-tier">${escapeHtml(ETAPA_LABELS[p.etapa] || p.etapa)}</div>
      </div>
      <div class="cot-card-actions">${acciones.join(' ')}</div>
      <div id="pr-historial-${p.id}" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid #eee">${buildHistorialHtml(p)}</div>
    </div>
  `;
}

// Seccion "Que toca hoy" (issue #44): la cola llega ya ordenada por urgencia
// desde GET /api/prospectos/cola. La sugerencia de No util tras 3 toques abre
// la confirmacion del vendedor (sugerirNoUtilProspecto en app.js) -- nunca se
// aplica sola.
export function buildColaProspectosHtml(cola) {
  if (!cola || !cola.length) return '<div class="cot-card-meta">Nada pendiente por ahora.</div>';
  return cola.map(item => {
    const wa = buildWaLink(item.celular);
    const acciones = [];
    if (wa) acciones.push(`<a href="${wa}" target="_blank" class="btn btn-primary btn-sm">WhatsApp</a>`);
    acciones.push(`<button class="btn btn-secondary btn-sm" onclick="registrarToqueProspecto(${item.id})">+ Toque</button>`);
    if (item.sugerirNoUtil) {
      acciones.push(`<button class="btn btn-secondary btn-sm" onclick="sugerirNoUtilProspecto(${item.id})">${item.toques} toques sin respuesta · ¿No útil?</button>`);
    }
    return `
      <div class="cot-card">
        <div class="cot-card-header">
          <div>
            <div class="cot-card-cliente">${escapeHtml(item.nombre)}</div>
            <div class="cot-card-meta">${escapeHtml(ETAPA_LABELS[item.etapa] || item.etapa)} · ${escapeHtml(item.canal)} · ${escapeHtml(item.ciudad)} · ${escapeHtml(item.celular)}</div>
            <div style="margin-top:4px">${buildEsperaBadgeHtml(item)}</div>
          </div>
        </div>
        <div class="cot-card-actions">${acciones.join(' ')}</div>
      </div>
    `;
  }).join('');
}

// Conteo de motivos de No util acumulados (vista admin).
export function contarMotivosNoUtil(prospectos) {
  const conteo = {};
  for (const p of prospectos || []) {
    for (const e of p.eventos || []) {
      if (e.tipo === 'no_util' && e.motivo) conteo[e.motivo] = (conteo[e.motivo] || 0) + 1;
    }
  }
  return conteo;
}

export function buildMotivosNoUtilHtml(conteo) {
  const entradas = Object.entries(conteo || {}).sort((a, b) => b[1] - a[1]);
  if (!entradas.length) return '<div class="cot-card-meta">Sin salidas a No útil registradas.</div>';
  return entradas.map(([motivo, n]) =>
    `<div class="cot-card-meta">${escapeHtml(motivo)}: ${n}</div>`
  ).join('');
}

// Mapeo de la respuesta 409 de POST /api/prospectos: si el body trae el
// prospecto existente (duplicado propio o admin), devuelve su tarjeta; si no
// (prospecto de otro vendedor, issue #42), no hay nada que mostrar aqui.
export function buildProspectoExistenteHtml(resp) {
  if (!resp || !resp.prospecto) return '';
  return buildProspectoCardHtml(resp.prospecto);
}

// Arma el body de POST /api/prospectos desde los campos del formulario de captura.
// Los opcionales vacios no viajan.
export function buildProspectoPayload(campos) {
  const c = campos || {};
  const payload = {
    celular: combinarTelefonoConCodigo(c.celularCode, c.celular),
    nombre: (c.nombre || '').trim(),
    ciudad: (c.ciudad || '').trim(),
    canal: c.canal || '',
  };
  for (const k of OPCIONALES) {
    const v = typeof c[k] === 'string' ? c[k].trim() : c[k];
    if (v !== undefined && v !== null && v !== '') payload[k] = v;
  }
  return payload;
}
