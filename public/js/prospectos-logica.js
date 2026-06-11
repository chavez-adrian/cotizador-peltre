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

// Reunion diagnostico (issue #45, CONTEXT.md "Captura de prospecto"): actividad
// con fecha sobre el prospecto, NO una etapa. Re-agendar registra otro evento y
// la ultima reunion manda. Mientras esta en el futuro la cadencia se suprime
// (el filtro vive en lib/seguimiento-prospectos.js); pasada la fecha, el
// seguimiento pide registrar el resultado.

export function ultimaReunion(eventos) {
  let r = null;
  for (const e of eventos || []) {
    if (e.tipo === 'reunion' && (!r || new Date(e.fecha) > new Date(r.fecha))) r = e;
  }
  return r;
}

export function reunionFutura(p, ahora) {
  const r = ultimaReunion(p && p.eventos);
  return r && new Date(r.fecha_reunion) > ahora ? r.fecha_reunion : null;
}

// Pendiente de resultado: ultima reunion con fecha pasada y ningun evento
// posterior a esa fecha (cualquier evento posterior limpia la condicion).
export function reunionPendienteResultado(p, ahora) {
  const r = ultimaReunion(p && p.eventos);
  if (!r || new Date(r.fecha_reunion) > ahora) return null;
  const limpia = (p.eventos || []).some(e => new Date(e.fecha) > new Date(r.fecha_reunion));
  return limpia ? null : r.fecha_reunion;
}

// Link wa.me en un tap: solo digitos, el celular del prospecto ya trae codigo de pais.
export function buildWaLink(celular) {
  const digitos = String(celular || '').replace(/\D/g, '');
  return digitos ? `https://wa.me/${digitos}` : null;
}

function fechaCorta(fecha) {
  return new Date(fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fechaHora(fecha) {
  return new Date(fecha).toLocaleString('es-MX', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const ETIQUETAS_EVENTO = {
  captura: e => `Capturado por ${escapeHtml(e.vendedor)}`,
  etapa: e => `${escapeHtml(ETAPA_LABELS[e.de] || e.de)} → ${escapeHtml(ETAPA_LABELS[e.a] || e.a)} · ${escapeHtml(e.vendedor)}`,
  toque: e => `Toque · ${escapeHtml(e.vendedor)}`,
  no_util: e => `Salida a No útil (${escapeHtml(e.motivo)}) · ${escapeHtml(e.vendedor)}`,
  cliente: e => {
    const nombre = e.nombre ? `${escapeHtml(e.nombre)} (#${escapeHtml(e.cliente_id)})` : `#${escapeHtml(e.cliente_id)}`;
    return `Convertido en cliente ${nombre} · ${escapeHtml(e.vendedor)}`;
  },
  cotizacion: e => `Cotización #${escapeHtml(e.cotizacion_id)} · ${escapeHtml(e.vendedor)}`,
  reunion: e => `Reunión agendada para ${escapeHtml(fechaHora(e.fecha_reunion))} · ${escapeHtml(e.vendedor)}`,
};

function etiquetaEvento(e) {
  const etiqueta = ETIQUETAS_EVENTO[e.tipo];
  return etiqueta ? etiqueta(e) : escapeHtml(`${e.tipo} · ${e.vendedor}`);
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

// Etiqueta del prospecto convertido en cliente (#46, CONTEXT.md "Prospecto
// convertido en cliente"): sigue en seguimiento hasta que una cotizacion lo
// pase a Cotizado.
const CLIENTE_BADGE = '<span class="cliente-badge">Ya es cliente — falta cotizar</span>';

// Tarjeta de un prospecto en la lista (mismo formato visual que las cards de
// historial/seguimiento de app.js). Funcion pura sin DOM: testeable en Node.
// Las acciones llaman funciones globales de app.js (mismo patron que las
// cards de seguimiento: onclick + window.fn). colaItem es el item del
// prospecto en GET /api/prospectos/cola, si esta en la cola (issue #44).
export function buildProspectoCardHtml(p, colaItem, ahora = new Date()) {
  const d = p.data || {};
  const empresa = d.empresa ? ` · ${escapeHtml(d.empresa)}` : '';
  const activo = p.etapa !== 'no_util' && p.etapa !== 'cotizado';
  const sig = siguienteEtapa(p.etapa);
  const wa = buildWaLink(p.celular);
  // Reunion futura (issue #45): la cadencia esta suprimida (el prospecto no
  // viene en la cola) pero la card lo dice con su propia etiqueta.
  const reunion = activo ? reunionFutura(p, ahora) : null;
  const acciones = [];
  if (wa) acciones.push(`<a href="${wa}" target="_blank" class="btn btn-primary btn-sm">WhatsApp</a>`);
  if (activo && sig) {
    acciones.push(`<button class="btn btn-secondary btn-sm" onclick="avanzarEtapaProspecto(${p.id}, '${sig}')">→ ${ETAPA_LABELS[sig]}</button>`);
  }
  if (activo) {
    acciones.push(`<button class="btn btn-secondary btn-sm" onclick="registrarToqueProspecto(${p.id})">+ Toque</button>`);
    acciones.push(
      `<input type="datetime-local" id="pr-reunion-${p.id}" class="btn-sm">` +
      `<button class="btn btn-secondary btn-sm" onclick="agendarReunionProspecto(${p.id})">Agendar reunión</button>`
    );
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
          ${d.cliente_id ? `<div style="margin-top:4px">${CLIENTE_BADGE}</div>` : ''}
          ${reunion ? `<div style="margin-top:4px"><span class="reunion-badge">Reunión el ${escapeHtml(fechaHora(reunion))}</span></div>` : ''}
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
    // Reunion vencida (issue #45): el item vuelve pidiendo registrar el
    // resultado -- Calificado o No util con motivo -- en vez del toque normal.
    if (item.reunionVencida) {
      acciones.push(`<button class="btn btn-primary btn-sm" onclick="resultadoReunionProspecto(${item.id}, 'calificado')">→ Calificado</button>`);
      acciones.push(
        `<select id="cola-motivo-${item.id}" class="btn-sm"><option value="">Motivo...</option>` +
        MOTIVOS_NO_UTIL.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('') +
        `</select><button class="btn btn-secondary btn-sm" onclick="resultadoReunionNoUtilProspecto(${item.id})">No útil</button>`
      );
    } else {
      acciones.push(`<button class="btn btn-secondary btn-sm" onclick="registrarToqueProspecto(${item.id})">+ Toque</button>`);
      if (item.sugerirNoUtil) {
        acciones.push(`<button class="btn btn-secondary btn-sm" onclick="sugerirNoUtilProspecto(${item.id})">${item.toques} toques sin respuesta · ¿No útil?</button>`);
      }
    }
    return `
      <div class="cot-card">
        <div class="cot-card-header">
          <div>
            <div class="cot-card-cliente">${escapeHtml(item.nombre)}</div>
            <div class="cot-card-meta">${escapeHtml(ETAPA_LABELS[item.etapa] || item.etapa)} · ${escapeHtml(item.canal)} · ${escapeHtml(item.ciudad)} · ${escapeHtml(item.celular)}</div>
            <div style="margin-top:4px">${buildEsperaBadgeHtml(item)}${item.yaEsCliente ? ` ${CLIENTE_BADGE}` : ''}</div>
            ${item.reunionVencida ? `<div style="margin-top:4px"><span class="reunion-badge">Reunión del ${escapeHtml(fechaHora(item.fechaReunion))} — registrar resultado</span></div>` : ''}
          </div>
        </div>
        <div class="cot-card-actions">${acciones.join(' ')}</div>
      </div>
    `;
  }).join('');
}

// Tablero kanban de prospectos (issue #49, CONTEXT.md "Tablero de
// prospectos"): cinco columnas siempre visibles. El arrastre respeta el
// dominio -- un paso adelante o salida a No util; Cotizado no acepta
// arrastres porque solo una cotizacion real mueve ahi.

const ETAPAS_TABLERO = ['nuevo', 'contactado', 'calificado', 'cotizado', 'no_util'];

export function agruparTablero(prospectos) {
  const cols = {};
  for (const etapa of ETAPAS_TABLERO) cols[etapa] = [];
  for (const p of prospectos || []) {
    if (cols[p.etapa]) cols[p.etapa].push(p);
  }
  for (const etapa of ETAPAS_TABLERO) {
    cols[etapa].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  }
  return cols;
}

export function puedeArrastrar(de, a) {
  if (a === 'no_util') return de !== 'no_util';
  return a === siguienteEtapa(de) && validarTransicion(de, a) === null;
}

// Motivo de la salida a No util: el ultimo evento no_util manda.
function motivoNoUtil(p) {
  let m = null;
  for (const e of (p && p.eventos) || []) {
    if (e.tipo === 'no_util' && (!m || new Date(e.fecha) > new Date(m.fecha))) m = e;
  }
  return m ? m.motivo : null;
}

export function buildTableroHtml(prospectos, colaPorId, ahora = new Date()) {
  const cols = agruparTablero(prospectos);
  return ETAPAS_TABLERO.map(etapa => {
    const tarjetas = cols[etapa].map(p => {
      const motivo = etapa === 'no_util' ? motivoNoUtil(p) : null;
      const draggable = etapa !== 'no_util';
      return `<div class="tablero-card" draggable="${draggable}" data-id="${p.id}" data-etapa="${etapa}">` +
        (motivo ? `<div class="cot-card-meta" style="margin-bottom:4px">Motivo: ${escapeHtml(motivo)}</div>` : '') +
        buildProspectoCardHtml(p, colaPorId && colaPorId.get(p.id), ahora) +
        '</div>';
    }).join('');
    return `
      <div class="tablero-col" data-etapa="${etapa}">
        <div class="tablero-col-header">${escapeHtml(ETAPA_LABELS[etapa])} <span class="tablero-col-count">${cols[etapa].length}</span></div>
        <div class="tablero-col-cards">${tarjetas}</div>
      </div>
    `;
  }).join('');
}

// Selector de motivo al soltar una tarjeta en No util (issue #49): mismo
// patron que el modal de canal de #46. Cancelar regresa la tarjeta sin
// llamar al servidor.
export function buildMotivoNoUtilModalHtml() {
  return `
    <div style="background:#fff;border-radius:8px;padding:20px;max-width:340px;width:90%">
      <div style="font-weight:600;margin-bottom:4px">Salida a No útil: ¿cuál es el motivo?</div>
      <div class="cot-card-meta" style="margin-bottom:8px">El motivo es obligatorio (catálogo cerrado). Cancelar regresa la tarjeta a su columna.</div>
      <select id="motivo-tablero-select" style="width:100%;margin-bottom:8px">
        <option value="">-- Selecciona el motivo --</option>
        ${MOTIVOS_NO_UTIL.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('')}
      </select>
      <div id="motivo-tablero-error" style="display:none;color:#c0392b;font-size:13px;margin-bottom:8px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-secondary btn-sm" id="motivo-tablero-cancelar">Cancelar</button>
        <button class="btn btn-primary btn-sm" id="motivo-tablero-confirmar">Confirmar</button>
      </div>
    </div>
  `;
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

// Modal de canal antes de generar cotizacion (issue #46): solo se pide canal
// cuando el celular es libre (ni prospecto ni cliente Operam); con canal el
// servidor auto-crea el prospecto directo en Cotizado.

export function necesitaCanal(clasificacion) {
  return !!clasificacion && clasificacion.tipo === 'libre';
}

export function validarCanalCotizacion(canal) {
  return CANALES.includes(canal) ? null : 'El canal de origen es obligatorio (catálogo cerrado)';
}

export function buildCanalModalHtml() {
  return `
    <div style="background:#fff;border-radius:8px;padding:20px;max-width:340px;width:90%">
      <div style="font-weight:600;margin-bottom:4px">Celular nuevo: ¿de qué canal llegó?</div>
      <div class="cot-card-meta" style="margin-bottom:8px">Se creará el prospecto en Cotizado con los datos de la cotización. Cancelar genera la cotización sin crear prospecto.</div>
      <select id="canal-cot-select" style="width:100%;margin-bottom:8px">
        <option value="">-- Selecciona el canal --</option>
        ${CANALES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
      </select>
      <div id="canal-cot-error" style="display:none;color:#c0392b;font-size:13px;margin-bottom:8px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-secondary btn-sm" id="canal-cot-cancelar">Cancelar</button>
        <button class="btn btn-primary btn-sm" id="canal-cot-confirmar">Confirmar</button>
      </div>
    </div>
  `;
}

// Reporte de la importacion de Feria/Expo (issue #47): que entro, a quien se
// asigno y que se descarto con motivo. Respuesta de POST /api/admin/prospectos/importar.
export function buildReporteImportacionHtml(reporte) {
  const r = reporte || {};
  const partes = [
    `<div class="cot-card-meta"><strong>${r.importados || 0} prospectos importados</strong></div>`,
  ];
  for (const [vendedor, n] of Object.entries(r.porVendedor || {})) {
    partes.push(`<div class="cot-card-meta">${escapeHtml(vendedor)}: ${n}</div>`);
  }
  const descartados = r.descartados || [];
  if (descartados.length) {
    partes.push(`<div class="cot-card-meta" style="margin-top:8px"><strong>${descartados.length} filas descartadas</strong></div>`);
    for (const d of descartados) {
      partes.push(`<div class="cot-card-meta">Fila ${d.fila}: ${escapeHtml(d.nombre || '(sin nombre)')} - ${escapeHtml(d.motivo)}</div>`);
    }
  }
  return partes.join('');
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
