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
  'Cliente Actual',
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

// Edicion/complemento del prospecto desde su tarjeta (issue #66, CONTEXT.md
// "Captura de prospecto"): el vendedor enriquece nombre, ciudad y los opcionales
// (empresa, tipo de cliente, piezas, correo, temperatura, notas) conforme avanza
// la conversacion. El celular (llave de identidad) y el canal (origen) no se
// reeditan aqui. Si nombre o ciudad vienen en la edicion no pueden quedar vacios
// (siguen siendo obligatorios, como en la captura). Reusa el servidor y el frontend.
export function validarEdicionProspecto(body) {
  const b = body || {};
  if (b.nombre !== undefined && !String(b.nombre).trim()) return 'El nombre no puede quedar vacío';
  if (b.ciudad !== undefined && !String(b.ciudad).trim()) return 'La ciudad no puede quedar vacía';
  return null;
}

// Separa la edicion en columnas propias (nombre, ciudad) y el merge de data
// (opcionales). Los campos ausentes no viajan; los presentes se recortan. Lo
// consume el servidor para llamar al store y el frontend para armar el body.
export function buildEdicionProspectoDatos(body) {
  const b = body || {};
  const datos = {};
  if (b.nombre !== undefined) datos.nombre = String(b.nombre).trim();
  if (b.ciudad !== undefined) datos.ciudad = String(b.ciudad).trim();
  const data = {};
  for (const k of OPCIONALES) {
    if (b[k] === undefined) continue;
    const v = typeof b[k] === 'string' ? b[k].trim() : b[k];
    data[k] = v;
  }
  if (Object.keys(data).length) datos.data = data;
  return datos;
}

// Formulario inline de edicion del prospecto (issue #66): prellena los datos
// actuales y guarda contra el id del prospecto. Los campos son los de la captura
// (CONTEXT.md "Captura de prospecto") menos celular (llave de identidad) y canal
// (origen). guardarEdicionProspecto(id) (en app.js) lee estos inputs y llama a
// PATCH /api/prospectos/:id.
export function buildEdicionProspectoFormHtml(p) {
  const d = (p && p.data) || {};
  const v = x => escapeHtml(x == null ? '' : x);
  const opt = (sel, val, label) => `<option value="${escapeHtml(val)}"${String(sel) === String(val) ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  const piezasOpts = ['', ...PIEZAS_ESTIMADAS].map(x => opt(d.piezas_estimadas || '', x, x || 'Piezas estimadas...')).join('');
  return `
    <div class="prospecto-edicion" style="margin-top:8px;padding-top:8px;border-top:1px solid #eee">
      <div style="display:grid;gap:6px">
        <input type="text" id="ed-nombre-${p.id}" value="${v(p.nombre)}" placeholder="Nombre">
        <input type="text" id="ed-ciudad-${p.id}" value="${v(p.ciudad)}" placeholder="Ciudad">
        <input type="text" id="ed-empresa-${p.id}" value="${v(d.empresa)}" placeholder="Empresa">
        <input type="text" id="ed-segmento_id-${p.id}" value="${v(d.segmento_id)}" placeholder="Tipo de cliente">
        <select id="ed-piezas_estimadas-${p.id}">${piezasOpts}</select>
        <input type="email" id="ed-correo-${p.id}" value="${v(d.correo)}" placeholder="Correo">
        <input type="number" id="ed-temperatura-${p.id}" min="1" max="5" value="${v(d.temperatura)}" placeholder="Temperatura (1-5)">
        <textarea id="ed-notas-${p.id}" placeholder="Notas">${v(d.notas)}</textarea>
      </div>
      <div class="cot-card-actions" style="margin-top:6px">
        <button class="btn btn-primary btn-sm" onclick="guardarEdicionProspecto(${p.id})">Guardar</button>
        <button class="btn btn-secondary btn-sm" onclick="abrirEdicionProspecto(${p.id})">Cancelar</button>
      </div>
    </div>
  `;
}

// Labels de las etapas del pipeline unificado (issue #53, ADR-0005). La unica
// fuente del vocabulario es lib/pipeline.js; aqui se reexpone para el frontend
// (este modulo es browser-safe y no importa de lib/).
const ETAPA_LABELS = {
  no_asignado: 'No Asignado',
  por_cotizar: 'Por Cotizar',
  seguimiento: 'Seguimiento',
  anticipo_pagado: 'Anticipo pagado',
  pedido_liberado: 'Pedido liberado',
  saldo_pagado: 'Saldo pagado',
  producto_entregado: 'Producto entregado',
  no_util: 'No útil',
  perdida: 'Perdida',
};

// Salida a No util -- motivo obligatorio de catalogo cerrado (CONTEXT.md,
// Etapas del pipeline).
export const MOTIVOS_NO_UTIL = ['menudeo', 'fuera de zona', 'sin presupuesto', 'spam', 'sin respuesta'];

// Las 7 etapas activas del embudo: las salidas (no_util, perdida) viven en
// filtro/historial, no son etapas activas. Las dos salidas se descartan
// derivandolas del catalogo de labels.
const ETAPAS_ACTIVAS = new Set(
  Object.keys(ETAPA_LABELS).filter(e => e !== 'no_util' && e !== 'perdida')
);

// En el pipeline unificado no hay avance manual de etapa antes de cotizar:
// Por Cotizar -> Seguimiento es automatico (lo dispara generar una cotizacion)
// o manual con folio de Operam (otro issue). Se conserva la firma para los
// consumidores; hoy no ofrece ningun paso adelante.
export function siguienteEtapa() {
  return null;
}

// Valida una transicion de etapa solicitada por el vendedor. Transiciones
// manuales vivas: la salida a No util (con motivo de catalogo) y el avance
// manual Por Cotizar -> Seguimiento cuando el vendedor cotizo POR FUERA (directo
// en Operam) -- exige capturar el folio de Operam (issue #56, CONTEXT.md "Etapas
// del pipeline": "manual solo capturando el numero de cotizacion de Operam; sin
// folio no avanza"). Sin folio no procede; desde cualquier otra etapa la
// transicion a Seguimiento sigue siendo invalida (Por Cotizar -> Seguimiento es
// la unica arista manual forward). El resto del avance entre etapas lo dirigen
// la cotizacion en el sistema y Operam.
export function validarTransicion(actual, nueva, motivo, folio) {
  if (nueva === 'no_util') {
    if (actual === 'no_util') return 'El prospecto ya salió a No útil';
    if (!MOTIVOS_NO_UTIL.includes(motivo)) return 'El motivo de No útil es obligatorio (catálogo cerrado)';
    return null;
  }
  if (nueva === 'seguimiento' && actual === 'por_cotizar') {
    if (!String(folio == null ? '' : folio).trim()) return 'El folio de Operam es obligatorio para mover a Seguimiento a mano';
    return null;
  }
  // Salida a Perdida (issue #59, Modelo A): se cierra una oportunidad desde
  // cualquier etapa ACTIVA, sin motivo (la confirmacion es del frontend). Una que
  // ya salio del embudo (No util / Perdida) no se vuelve a cerrar.
  if (nueva === 'perdida') {
    if (!ETAPAS_ACTIVAS.has(actual)) return 'El prospecto ya salió del pipeline';
    return null;
  }
  return `Transición inválida: ${ETAPA_LABELS[actual] || actual} → ${ETAPA_LABELS[nueva] || nueva}`;
}

// Reunion diagnostico (issue #45, CONTEXT.md "Captura de prospecto"): actividad
// con fecha sobre el prospecto, NO una etapa. Re-agendar registra otro evento y
// la ultima reunion manda. Mientras esta en el futuro la cadencia se suprime
// (el filtro vive en lib/seguimiento-prospectos.js); pasada la fecha, el
// seguimiento pide registrar el resultado.

// Nucleo de los predicados de reunion (issue #65): operan sobre el ARRAY de
// eventos para que prospecto y cotizacion compartan la misma logica. El prospecto
// pasa su `p.eventos`; la cotizacion pasa su array de seguimientos (donde las
// reuniones viven como entradas `{ tipo:'reunion', fecha_reunion, fecha }`). La
// ultima reunion REGISTRADA manda (por `fecha` de registro, no por la fecha de la
// cita): re-agendar registra otro evento y ese ultimo gana, aunque su cita sea
// mas temprana (CONTEXT.md "Reunion de diagnostico"). Cualquier evento con fecha
// posterior a esa reunion limpia el pendiente de resultado.
export function ultimaReunionDe(eventos) {
  let r = null;
  for (const e of eventos || []) {
    if (e.tipo === 'reunion' && (!r || new Date(e.fecha) > new Date(r.fecha))) r = e;
  }
  return r;
}

export function reunionFuturaDe(eventos, ahora) {
  const r = ultimaReunionDe(eventos);
  return r && new Date(r.fecha_reunion) > ahora ? r.fecha_reunion : null;
}

export function reunionPendienteResultadoDe(eventos, ahora) {
  const r = ultimaReunionDe(eventos);
  if (!r || new Date(r.fecha_reunion) > ahora) return null;
  const limpia = (eventos || []).some(e => new Date(e.fecha) > new Date(r.fecha_reunion));
  return limpia ? null : r.fecha_reunion;
}

// Wrappers que conservan la firma de #45 (reciben el prospecto y leen p.eventos)
// y delegan en el nucleo del array.
export function ultimaReunion(eventos) {
  return ultimaReunionDe(eventos);
}

export function reunionFutura(p, ahora) {
  return reunionFuturaDe(p && p.eventos, ahora);
}

// Pendiente de resultado: ultima reunion con fecha pasada y ningun evento
// posterior a esa fecha (cualquier evento posterior limpia la condicion).
export function reunionPendienteResultado(p, ahora) {
  return reunionPendienteResultadoDe(p && p.eventos, ahora);
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
export function buildProspectoCardHtml(p, colaItem, ahora = new Date(), { compacta = false } = {}) {
  const d = p.data || {};
  const empresa = d.empresa ? ` · ${escapeHtml(d.empresa)}` : '';
  // En el pipeline unificado el prospecto se trabaja en Por Cotizar (cadencia,
  // reunion, salida a No util); al pasar a Seguimiento la oportunidad la lleva
  // la cotizacion (otro tipo de tarjeta). El avance entre etapas ya no es manual.
  const activo = p.etapa === 'por_cotizar';
  // Editar/complementar el prospecto (issue #66) se permite en cualquier etapa
  // activa (las 7 del embudo), no en una salida (No util/Perdida viven en
  // historial). Distinto de `activo`, que habilita el trabajo de prospeccion
  // (toques, reunion) solo en Por Cotizar.
  const editable = !['no_util', 'perdida'].includes(p.etapa);
  const wa = buildWaLink(p.celular);
  // Reunion futura (issue #45): la cadencia esta suprimida (el prospecto no
  // viene en la cola) pero la card lo dice con su propia etiqueta.
  const reunion = activo ? reunionFutura(p, ahora) : null;
  const pesadas = [];
  if (activo) {
    pesadas.push(`<button class="btn btn-secondary btn-sm" onclick="registrarToqueProspecto(${p.id})">Registrar contacto</button>`);
    pesadas.push(
      `<input type="datetime-local" id="pr-reunion-${p.id}" class="btn-sm">` +
      `<button class="btn btn-secondary btn-sm" onclick="agendarReunionProspecto(${p.id})">Agendar reunión</button>`
    );
    pesadas.push(
      `<select id="pr-motivo-${p.id}" class="btn-sm"><option value="">Motivo...</option>` +
      MOTIVOS_NO_UTIL.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('') +
      `</select><button class="btn btn-secondary btn-sm" onclick="marcarNoUtilProspecto(${p.id})">No útil</button>`
    );
  }
  // Editar/complementar (issue #66): disponible en cualquier etapa activa, no
  // solo en Por Cotizar. Abre el formulario inline que ya viene en la card.
  if (editable) pesadas.push(`<button class="btn btn-secondary btn-sm" onclick="abrirEdicionProspecto(${p.id})">Editar</button>`);
  pesadas.push(`<button class="btn btn-secondary btn-sm" onclick="toggleHistorialProspecto(${p.id})">Historial</button>`);
  const waBtn = wa ? `<a href="${wa}" target="_blank" class="btn btn-primary btn-sm">WhatsApp</a>` : '';
  // Cotizar es el destino natural del prospecto (feedback de Adrian
  // 2026-06-12): visible en toda card activa, prellena el cotizador.
  const cotizarBtn = activo ? `<button class="btn btn-primary btn-sm" onclick="cotizarProspecto(${p.id})">Cotizar</button>` : '';
  // En el tablero la card es compacta (estilo Bitrix): info + chips + WhatsApp
  // + Cotizar (en tactil no hay drag: la accion mas comun no se esconde); el
  // resto vive tras "Mas".
  const acciones = compacta
    ? `<div class="cot-card-actions">${waBtn} ${cotizarBtn} <button class="btn btn-secondary btn-sm" onclick="toggleAccionesProspecto(${p.id})">Más</button></div>` +
      `<div id="pr-acciones-${p.id}" style="display:none"><div class="cot-card-actions">${pesadas.join(' ')}</div></div>`
    : `<div class="cot-card-actions">${waBtn} ${cotizarBtn} ${pesadas.join(' ')}</div>`;
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
        ${compacta ? '' : `<div class="cot-card-tier">${escapeHtml(ETAPA_LABELS[p.etapa] || p.etapa)}</div>`}
      </div>
      ${acciones}
      <div id="pr-historial-${p.id}" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid #eee">${buildHistorialHtml(p)}</div>
      ${editable ? `<div id="pr-edicion-${p.id}" style="display:none">${buildEdicionProspectoFormHtml(p)}</div>` : ''}
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
    // resultado. En el pipeline unificado el avance pertinente es cotizar
    // (Por Cotizar -> Seguimiento); el unico cierre desde aqui es No util con
    // motivo (ya no avanza a Calificado, etapa eliminada por ADR-0005).
    if (item.reunionVencida) {
      acciones.push(
        `<select id="cola-motivo-${item.id}" class="btn-sm"><option value="">Motivo...</option>` +
        MOTIVOS_NO_UTIL.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('') +
        `</select><button class="btn btn-secondary btn-sm" onclick="resultadoReunionNoUtilProspecto(${item.id})">No útil</button>`
      );
    } else {
      acciones.push(`<button class="btn btn-secondary btn-sm" onclick="registrarToqueProspecto(${item.id})">Registrar contacto</button>`);
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

// Conteo de pendientes para el badge del destino Hoy (issue #58, CONTEXT.md
// "Cola Hoy"): el badge en nav-hoy refleja cuantos prospectos en Por Cotizar
// piden atencion hoy. La cola ya llega filtrada (horas habiles, reunion futura
// suprimida) desde GET /api/prospectos/cola, asi que el conteo es su tamano.
export function contarPendientesProspectos(cola) {
  return (cola || []).length;
}

// El tablero kanban de prospectos del modelo previo (cinco columnas
// nuevo/contactado/calificado/cotizado/no_util) se retiro: el pipeline
// unificado de 7 etapas lo reemplaza con un solo tablero (public/js/
// pipeline-logica.js, issue #53, ADR-0005). La logica de tarjeta y cola
// (buildProspectoCardHtml, buildColaProspectosHtml) se conserva.

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
