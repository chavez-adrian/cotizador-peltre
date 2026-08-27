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

// Particulas del espanol que van en minuscula salvo como primera palabra del
// campo (issue #235). NO es la misma lista que PREPOSICIONES/ARTICULOS de
// lib/deduplicacion.js: esa lista sirve para TOKENIZAR y comparar candidatos
// (proposito distinto), esta sirve para CAPITALIZAR texto de presentacion.
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y']);

// Siglas que se preservan SIEMPRE, incluso si el campo entero viene en
// mayusculas: formas societarias mexicanas + CDMX + las paqueterias con las
// que ya opera el cotizador. Rescata el caso mas comun de razon social
// mexicana ("... SA DE CV") de la correccion agresiva de abajo.
const SIGLAS_FIJAS = new Set(['SA', 'CV', 'RL', 'SC', 'CDMX', 'FEDEX', 'DHL', 'UPS']);

function capitalizarToken(token) {
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

// "McDonald's": empieza en mayuscula y trae otra adentro. Un token ENTERO en
// mayusculas no cuenta (eso lo resuelve la regla de siglas cortas).
function mayusculaInterior(token) {
  const resto = token.slice(1);
  return token !== token.toUpperCase()
    && token.charAt(0) === token.charAt(0).toUpperCase()
    && resto !== resto.toLowerCase();
}

// Capitaliza nombre/empresa/ciudad de CUALQUIER captura de prospecto (issue
// #235, ampliado en #269): un solo nucleo para que la tarjeta, el correo de
// alerta y la vCard no puedan divergir. Nacio en mayoreo-logica.js para la
// captura publica y se movio aqui en #269, cuando la regla dejo de ser del
// formulario publico y paso a ser del PROSPECTO (CONTEXT.md "Prospecto",
// decision 2026-08-25: "venga de donde venga la captura"); mayoreo-logica la
// reexporta, mismo patron con el que #261 se llevo TIPOS_CLIENTE al reves.
// NO se llama normalizarNombre -- ese simbolo ya existe en lib/deduplicacion.js
// con otro proposito (tokenizar para comparar candidatos); aqui se produce
// texto de PRESENTACION, no una llave de comparacion. Tampoco reutiliza
// nombrePropio/empresaPropia de lib/cruce-bitrix.js (#159): esas resuelven un
// problema parecido pero con otra regla (particulas de nombre extranjero,
// sigla de hasta 3 letras SIN exigir contraste con el resto del campo) --
// copiarla aqui rompe la tabla de #235 (p.ej. "GRUPO GNP" tendria que quedar
// "Grupo Gnp", no "Grupo GNP").
//
// Regla de siglas cortas (<=4 letras, fuera de SIGLAS_FIJAS): se preservan
// SOLO si el campo NO viene entero en mayusculas. El contraste (unas palabras
// en mayusculas, otras no) es la unica senal de que fue a proposito -- el
// largo por si solo no sirve ("JUAN" tambien tiene 4 letras). Sin contraste
// (campo entero en mayusculas) no hay senal y se corrige todo.
//
// Regla de mayuscula INTERIOR (issue #269, "McDonald's"): un token que empieza
// en mayuscula y lleva OTRA mayuscula adentro se preserva tal cual. Es el mismo
// principio de contraste que la regla de arriba -- nadie teclea una mayuscula a
// media palabra por accidente -- aplicado al caso que el tope de 4 letras deja
// fuera. No alcanza a "jUaN": ese empieza en minuscula, que es dedazo y no
// intencion, y se sigue corrigiendo (tabla de #235).
export function capitalizarCampo(valor) {
  const v = String(valor == null ? '' : valor).trim().replace(/\s+/g, ' ');
  if (!v) return '';
  const todoMayus = v === v.toUpperCase() && v !== v.toLowerCase();
  return v.split(' ').map((token, i) => {
    const tokenMayus = token.toUpperCase();
    if (SIGLAS_FIJAS.has(tokenMayus)) return tokenMayus;
    const tokenMinus = token.toLowerCase();
    if (i > 0 && PARTICULAS.has(tokenMinus)) return tokenMinus;
    if (!todoMayus && token === tokenMayus && token.length <= 4 && token !== tokenMinus) return token;
    if (!todoMayus && mayusculaInterior(token)) return token;
    return capitalizarToken(token);
  }).join(' ');
}

// Normaliza los textos de una captura de prospecto (issue #269, CONTEXT.md
// "Prospecto"): UNICO punto de la regla, compartido por la creacion (captura
// manual y de expo) y por la edicion desde la tarjeta. Recibe y devuelve la
// misma forma con la que hablan el store y buildEdicionProspectoDatos
// ({ nombre?, ciudad?, data? }), asi que los dos caminos lo aplican con una
// sola linea. Solo toca las llaves PRESENTES: en la edicion, un campo ausente
// es "no lo cambies", no "vacialo".
//
// Que se normaliza y que no: nombre, empresa y ciudad son la identidad visible
// del prospecto y se guardan con las mayusculas corregidas; el correo, en
// minusculas y sin espacios (un correo es una direccion, no texto de
// presentacion, y "Laura @Gmail.com" no entrega). Las notas NO se tocan: son
// texto del vendedor.
export function normalizarTextosProspecto(datos) {
  const d = datos || {};
  const salida = { ...d };
  if (d.nombre !== undefined) salida.nombre = capitalizarCampo(d.nombre);
  if (d.ciudad !== undefined) salida.ciudad = capitalizarCampo(d.ciudad);
  if (d.data) {
    const data = { ...d.data };
    if (data.empresa !== undefined) data.empresa = capitalizarCampo(data.empresa);
    if (data.correo !== undefined) {
      data.correo = String(data.correo == null ? '' : data.correo).replace(/\s+/g, '').toLowerCase();
    }
    salida.data = data;
  }
  return salida;
}

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
  // Calificacion (issue #263): se completa o se corrige desde la
  // tarjeta. Viaja entera (el formulario trae los valores actuales prellenados),
  // asi que reemplaza a la anterior en vez de fusionarse campo por campo.
  if (b.calificacion !== undefined) data.calificacion = buildCalificacion(b.calificacion);
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
        <div class="campo-dictado">
          <textarea id="ed-notas-${p.id}" placeholder="Notas">${v(d.notas)}</textarea>
          ${buildMicHtml(`ed-notas-${p.id}`)}
        </div>
      </div>
      ${buildCalificacionCamposHtml(`ed2-${p.id}`, d.calificacion)}
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
// El ultimo evento REGISTRADO de un tipo (por `fecha` de registro, no por la
// fecha de la cita ni la del compromiso): la regla "el ultimo manda" que
// comparten la reunion y el siguiente contacto.
function ultimoEventoDe(eventos, tipo) {
  let ultimo = null;
  for (const e of eventos || []) {
    if (e.tipo === tipo && (!ultimo || new Date(e.fecha) > new Date(ultimo.fecha))) ultimo = e;
  }
  return ultimo;
}

export function ultimaReunionDe(eventos) {
  return ultimoEventoDe(eventos, 'reunion');
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

// Siguiente contacto (issue #262 y #270, spec #260, CONTEXT.md "Siguiente
// contacto"): compromiso acordado con el prospecto sobre CUANDO y POR DONDE lo
// vamos a contactar. Vive en p.eventos como { tipo:'siguiente_contacto',
// canales, fecha_contacto, fecha, vendedor }, igual que la reunion, y como ella el
// ULTIMO REGISTRADO manda (por `fecha` de registro, no por la fecha del
// compromiso). No es una reunion de diagnostico: no tiene resultado que
// registrar -- un toque posterior a la fecha lo cierra y la tarjeta vuelve a la
// cadencia normal de su canal de origen.

// Canales del siguiente contacto -- catalogo cerrado, distinto del canal de
// ORIGEN del prospecto (CANALES): por donde se prometio el contacto. El
// compromiso admite VARIOS con una sola fecha (#270), en el orden en que se
// acordaron.
export const CANALES_SIGUIENTE_CONTACTO = ['WhatsApp', 'Llamada', 'Correo'];

// Mientras la fecha es futura la cadencia se suprime (el filtro vive en
// lib/seguimiento-prospectos.js).
export function siguienteContactoFuturo(p, ahora) {
  const s = ultimoEventoDe(p && p.eventos, 'siguiente_contacto');
  if (!s || new Date(s.fecha_contacto) <= ahora) return null;
  return { canales: s.canales, fecha: s.fecha_contacto };
}

// Vencido: llego la fecha y ningun toque posterior al compromiso lo cerro. Desde
// aqui corre la cadencia normal, contada desde la fecha del compromiso.
export function siguienteContactoVencido(p, ahora) {
  const s = ultimoEventoDe(p && p.eventos, 'siguiente_contacto');
  if (!s || new Date(s.fecha_contacto) > ahora) return null;
  const cerrado = (p && p.eventos || []).some(
    e => e.tipo === 'toque' && new Date(e.fecha) > new Date(s.fecha_contacto)
  );
  return cerrado ? null : { canales: s.canales, fecha: s.fecha_contacto };
}

// Compromiso vivo de la tarjeta: el que todavia no llega o el que ya vencio y
// nadie ha cerrado. Un compromiso cerrado por un toque ya no se muestra.
function siguienteContactoVivo(p, ahora) {
  return siguienteContactoFuturo(p, ahora) || siguienteContactoVencido(p, ahora);
}

function fechaDiaCorto(fecha) {
  return new Date(fecha).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Los canales del compromiso como se leen (#270): uno solo se ve como siempre y
// varios se suman con " + ", en el orden en que se acordaron ("WhatsApp +
// Correo"). Lo comparten el chip y la linea de tiempo.
function etiquetaCanales(canales) {
  return (canales || []).join(' + ');
}

// Chip del siguiente contacto: en la tarjeta es el compromiso a secas
// ("WhatsApp + Correo - lun 31 ago"); en la cola Hoy es la instruccion del dia,
// con el nombre del prospecto y, si viene, el evento del que salio ("WhatsApp +
// Correo a Mariana - Abastur 2026 - lun 31 ago").
function chipSiguienteContactoHtml(sc, { nombre, evento } = {}) {
  const quien = nombre ? ` a ${escapeHtml(nombre)}` : '';
  const deEvento = evento ? ` — ${escapeHtml(evento)}` : '';
  return `<span class="siguiente-contacto-badge">${escapeHtml(etiquetaCanales(sc.canales))}${quien}${deEvento} · ${escapeHtml(fechaDiaCorto(sc.fecha))}</span>`;
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
  captura_expo: e => `Capturado en ${escapeHtml(e.evento)} · ${escapeHtml(e.vendedor)}`,
  siguiente_contacto: e => `Siguiente contacto: ${escapeHtml(etiquetaCanales(e.canales))} el ${escapeHtml(fechaCorta(e.fecha_contacto))} · ${escapeHtml(e.vendedor)}`,
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
export function buildProspectoCardHtml(p, colaItem, ahora = new Date(), { compacta = false, catalogoUrl = '' } = {}) {
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
  const wa = buildWaLinkProspecto(p, catalogoUrl);
  // Reunion futura (issue #45): la cadencia esta suprimida (el prospecto no
  // viene en la cola) pero la card lo dice con su propia etiqueta.
  const reunion = activo ? reunionFutura(p, ahora) : null;
  // Siguiente contacto (issue #262): el compromiso vivo se lee de un vistazo en
  // la tarjeta, este o no suprimida la cadencia.
  const siguiente = activo ? siguienteContactoVivo(p, ahora) : null;
  // Calificacion (issue #263): se lee en chips. Mientras no tenga ningun valor,
  // el prospecto que dejo una feria avisa que le falta -- es lo que el vendedor
  // completa al final del dia. Un prospecto que no vino de un evento no tiene
  // calificacion que reclamar.
  const calificacion = calificacionVacia(d.calificacion)
    ? (d.evento && editable ? '<span class="calificacion-badge">Calificación pendiente</span>' : '')
    : buildCalificacionChipsHtml(d.calificacion);
  const pesadas = [];
  if (activo) {
    pesadas.push(`<button class="btn btn-secondary btn-sm" onclick="registrarToqueProspecto(${p.id})">Registrar contacto</button>`);
    pesadas.push(
      `<input type="datetime-local" id="pr-reunion-${p.id}" class="btn-sm">` +
      `<button class="btn btn-secondary btn-sm" onclick="agendarReunionProspecto(${p.id})">Agendar reunión</button>`
    );
    // Siguiente contacto multicanal (#270): los canales son chips de seleccion
    // multiple, igual que en la pantalla de expo. El grupo lleva nombre propio
    // por tarjeta porque el tablero pinta varias a la vez.
    pesadas.push(
      buildGrupoChipsHtml(`sc-canal-${p.id}`, CANALES_SIGUIENTE_CONTACTO, [], true) +
      `<input type="date" id="pr-sc-fecha-${p.id}" class="btn-sm">` +
      `<button class="btn btn-secondary btn-sm" onclick="registrarSiguienteContactoProspecto(${p.id})">Siguiente contacto</button>`
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
          ${d.correo ? `<div class="cot-card-meta">${escapeHtml(d.correo)}</div>` : ''}
          ${activo && colaItem ? `<div style="margin-top:4px">${buildEsperaBadgeHtml(colaItem)}</div>` : ''}
          ${d.cliente_id ? `<div style="margin-top:4px">${CLIENTE_BADGE}</div>` : ''}
          ${d.evento ? `<div style="margin-top:4px"><span class="evento-badge">${escapeHtml(d.evento)}</span></div>` : ''}
          ${reunion ? `<div style="margin-top:4px"><span class="reunion-badge">Reunión el ${escapeHtml(fechaHora(reunion))}</span></div>` : ''}
          ${siguiente ? `<div style="margin-top:4px">${chipSiguienteContactoHtml(siguiente)}</div>` : ''}
          ${calificacion ? `<div style="margin-top:4px">${calificacion}</div>` : ''}
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
            ${item.siguienteContacto ? `<div style="margin-top:4px">${chipSiguienteContactoHtml(item.siguienteContacto, { nombre: item.nombre, evento: item.evento })}</div>` : ''}
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

// --- Captura de expo (issue #261, spec #260; CONTEXT.md "Captura de expo",
// "Evento", "Tipo de cliente") ---
//
// Bloque contiguo al final del modulo a proposito: la captura de expo es una
// variante de la captura de prospecto (misma entidad, mismo pipeline), no un
// modulo nuevo.

// Tipo de cliente -> segmento de Operam. UNICO catalogo y UNICO mapeo del
// sistema (CONTEXT.md "Tipo de cliente": "la captura de prospecto, la captura
// publica y la captura de expo comparten este catalogo"). Vivia en
// mayoreo-logica.js con el nombre retirado "tipo de proyecto"; se movio aqui en
// #261 y mayoreo-logica lo reexporta para no duplicarlo. Varias opciones caen a
// proposito en el mismo segmento (Restaurantes/Hoteles/Cafeterias son 10): por
// eso la opcion elegida se conserva TEXTUAL ademas del segmento.
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

export const TIPOS_CLIENTE = Object.keys(SEGMENTO_POR_TIPO);

export function segmentoDeTipo(tipo) {
  const s = SEGMENTO_POR_TIPO[tipo];
  return s === undefined ? null : s;
}

// Nivel de interes -> temperatura del prospecto (CONTEXT.md
// "Captura de expo"): con el prospecto enfrente el vendedor no decide entre un
// 2 y un 3, elige Bajo/Medio/Alto.
export const NIVELES_INTERES = { Bajo: 1, Medio: 3, Alto: 5 };

// Tipos de cliente que compran para revender: el mensaje les ofrece una
// propuesta de mayoreo en vez de una cotizacion (spec #260).
const TIPOS_MAYORISTAS = ['Distribuidores', 'Menudistas', 'Agencias | Marcas'];

function primerNombre(nombre) {
  return String(nombre == null ? '' : nombre).trim().split(/\s+/)[0] || '';
}

// Mensaje de WhatsApp de la expo (texto aprobado en el spec #260). Funcion PURA:
// la usan la pantalla posterior al guardado y el boton WhatsApp de la tarjeta, y
// SOLO en prospectos con evento (los demas conservan el enlace vacio de siempre).
// La liga del catalogo va sola en su renglon para que WhatsApp la muestre como
// vista previa; el renglon en blanco separa el cierre.
export function mensajeWhatsAppExpo(prospecto, vendedorNombre, catalogoUrl) {
  const p = prospecto || {};
  const empresa = String(p.empresa == null ? '' : p.empresa).trim();
  const oferta = !empresa
    ? 'una cotización a tu medida'
    : TIPOS_MAYORISTAS.includes(p.tipo_cliente)
      ? `una propuesta de mayoreo para ${empresa}`
      : `una cotización para ${empresa}`;
  return [
    `Hola ${primerNombre(p.nombre)}, soy ${String(vendedorNombre == null ? '' : vendedorNombre).trim()} de pp.peltre. ` +
      `Un gusto haberte conocido en ${String(p.evento == null ? '' : p.evento).trim()}. Te comparto nuestro catálogo:`,
    String(catalogoUrl == null ? '' : catalogoUrl).trim(),
    '',
    `Si te sirve, con gusto te preparo ${oferta}. ¿Qué piezas te llamaron la atención?`,
  ].join('\n');
}

// Validacion de la captura de expo: la MISMA de la captura normal (celular,
// nombre, ciudad, canal) mas el tipo de cliente obligatorio (CONTEXT.md
// "Captura de expo": "obligatorios celular, nombre, ciudad y tipo de cliente").
// La comparten el navegador y el servidor.
export function validarProspectoExpoBody(body) {
  const b = body || {};
  const base = validarProspectoBody(b);
  if (base) return base;
  if (!TIPOS_CLIENTE.includes(b.tipo_cliente)) {
    return 'El tipo de cliente es obligatorio (catálogo cerrado)';
  }
  if (b.tipo_cliente === 'Otro' && !String(b.tipo_cliente_otro || '').trim()) {
    return 'Dinos cuál: "Otro" exige especificar el tipo de cliente';
  }
  if (b.interes && !(b.interes in NIVELES_INTERES)) {
    return 'El nivel de interés es Bajo, Medio o Alto';
  }
  return null;
}

// Datos propios de la expo dentro del jsonb `data` del prospecto: el evento, la
// opcion textual del tipo de cliente (se conserva porque varias caen en el mismo
// segmento), su segmento de Operam y la temperatura derivada del nivel de
// interes. Devuelve {} cuando el body no trae nada de expo, para que la captura
// normal no cambie de comportamiento.
export function buildDatosExpo(body) {
  const b = body || {};
  const datos = {};
  const evento = String(b.evento == null ? '' : b.evento).trim();
  if (evento) datos.evento = evento;
  if (TIPOS_CLIENTE.includes(b.tipo_cliente)) {
    datos.tipo_cliente = b.tipo_cliente;
    const otro = String(b.tipo_cliente_otro == null ? '' : b.tipo_cliente_otro).trim();
    if (b.tipo_cliente === 'Otro' && otro) datos.tipo_cliente_otro = otro;
    datos.segmento_id = segmentoDeTipo(b.tipo_cliente);
  }
  if (b.interes in NIVELES_INTERES) datos.temperatura = NIVELES_INTERES[b.interes];
  return datos;
}

// Enlace de WhatsApp de la tarjeta. Con evento lleva el mensaje aprobado ya
// escrito (el lunes, no solo en el stand); sin evento es el enlace vacio de
// siempre -- un prospecto que no viene de una feria no tiene de que "gusto
// haberte conocido".
export function buildWaLinkProspecto(p, catalogoUrl) {
  const base = buildWaLink(p && p.celular);
  if (!base) return null;
  const d = (p && p.data) || {};
  if (!d.evento) return base;
  const texto = mensajeWhatsAppExpo(
    { nombre: p.nombre, empresa: d.empresa, tipo_cliente: d.tipo_cliente, evento: d.evento },
    p.vendedor, catalogoUrl
  );
  return `${base}?text=${encodeURIComponent(texto)}`;
}

// Codigo postal y ciudad en la PANTALLA de expo (issue #268). La ciudad se
// deriva del CP con el mismo mecanismo de la captura publica, asi que lo que el
// formulario exige es el CP -- salvo la salida propia del stand, "No sabe su
// CP", que destapa el campo Ciudad y deja de pedirlo. Es una regla del
// FORMULARIO, no del prospecto: el servidor sigue pidiendo solo la ciudad
// (validarProspectoExpoBody), venga resuelta del indice o tecleada a mano, y
// por eso vive en una funcion aparte que solo llama el navegador.
export function validarCpCiudadExpo({ cp, ciudad, sinCp } = {}) {
  if (!sinCp && !String(cp == null ? '' : cp).trim()) {
    return 'El código postal es obligatorio (o marca "No sabe su CP")';
  }
  if (!String(ciudad == null ? '' : ciudad).trim()) {
    return 'Falta la ciudad: confirma el código postal o escríbela';
  }
  return null;
}

// Chips de catalogo cerrado como botones con estado. Sin `onclick` inline: el
// grupo (`data-chip`) y el valor (`data-valor`) los lee un listener delegado en
// app.js, asi que ningun simbolo nuevo tiene que vivir en window (trampa #112).
export function buildChipsHtml(grupo, opciones, seleccion) {
  return (opciones || []).map(op =>
    `<button type="button" class="chip${op === seleccion ? ' chip-activo' : ''}" ` +
    `data-chip="${escapeHtml(grupo)}" data-valor="${escapeHtml(op)}">${escapeHtml(op)}</button>`
  ).join('');
}

// --- La calificacion de la captura de expo (issue #263, spec #260; CONTEXT.md
// "Captura de expo") ---
//
// El bloque opcional de la pantalla de captura: se puede guardar vacio y
// completar despues desde la tarjeta. Vive en el jsonb `data` del
// prospecto bajo `calificacion`; las piezas estimadas NO entran aqui (van al
// campo de siempre, `piezas_estimadas`) y las notas tampoco (`notas`).

// Anios operando y sucursales: catalogos cerrados de chips, cuatro rangos que
// se contestan sin pensar (#271). El valor guardado es la propia etiqueta (son
// rangos, no conceptos con sinonimos).
export const ANIOS_OPERANDO = ['Apertura', '1-5 años', '6-10 años', '+10 años'];
export const SUCURSALES = ['1 unidad', '2-5 unidades', '6-10 unidades', '+10 unidades'];

// Que es importante al escoger la loza: multi-seleccion que se guarda EN EL
// ORDEN en que se marca (lo primero que dijo el prospecto vale mas). La clave es
// estable y es lo que se persiste; la etiqueta humana solo se usa para pintar.
// "Durabilidad" es aguantar el uso diario; "No se rompe" es irrompible donde el
// vidrio y la ceramica son riesgo (alberca, jardin).
export const VALORA = [
  { clave: 'durabilidad', etiqueta: 'Durabilidad' },
  { clave: 'precio', etiqueta: 'Precio' },
  { clave: 'estetica', etiqueta: 'Estética' },
  { clave: 'no_se_rompe', etiqueta: 'No se rompe' },
  { clave: 'resurtido', etiqueta: 'Resurtido' },
  { clave: 'variedad', etiqueta: 'Variedad' },
  { clave: 'logo', etiqueta: 'Logo' },
  { clave: 'lavavajillas', etiqueta: 'Lavavajillas' },
  { clave: 'fuego_horno', etiqueta: 'Resiste fuego/horno' },
  { clave: 'mexicano', etiqueta: 'Mexicano' },
];

export function etiquetaValora(clave) {
  const op = VALORA.find(v => v.clave === clave);
  return op ? op.etiqueta : String(clave == null ? '' : clave);
}

// Campos de texto libre de la calificacion (los que llevan boton de microfono
// en la UI; `notas` no vive aqui, es el campo de siempre del prospecto).
const CALIFICACION_TEXTOS = ['concepto', 'tipo_clientes', 'proveedor_peltre', 'otro_valora'];

// Valida la calificacion. Todo es opcional -- lo que se revisa es que
// lo elegido pertenezca a su catalogo. La comparten el navegador y el servidor
// (creacion y edicion del prospecto).
export function validarCalificacion(cal) {
  if (cal == null) return null;
  if (typeof cal !== 'object' || Array.isArray(cal)) return 'La calificación viaja como objeto';
  if (cal.anios && !ANIOS_OPERANDO.includes(cal.anios)) {
    return 'Los años operando son de catálogo cerrado';
  }
  if (cal.sucursales && !SUCURSALES.includes(cal.sucursales)) {
    return 'Las sucursales son de catálogo cerrado';
  }
  if (cal.usa_peltre !== undefined && cal.usa_peltre !== null && typeof cal.usa_peltre !== 'boolean') {
    return '¿Ya usa o vende peltre? se responde sí o no';
  }
  if (cal.valora !== undefined && cal.valora !== null) {
    const claves = VALORA.map(v => v.clave);
    if (!Array.isArray(cal.valora) || cal.valora.some(v => !claves.includes(v))) {
      return 'Lo que es importante al escoger la loza es de catálogo cerrado';
    }
  }
  return null;
}

// Normaliza la calificacion para guardarla: recorta los textos, suelta lo que
// viene vacio y CONSERVA EL ORDEN de valora (es el dato: que dijo primero el
// prospecto). Devuelve {} cuando no se capturo nada.
export function buildCalificacion(cal) {
  const c = cal && typeof cal === 'object' && !Array.isArray(cal) ? cal : {};
  const limpia = {};
  for (const k of CALIFICACION_TEXTOS) {
    const v = String(c[k] == null ? '' : c[k]).trim();
    if (v) limpia[k] = v;
  }
  if (c.anios) limpia.anios = c.anios;
  if (c.sucursales) limpia.sucursales = c.sucursales;
  if (typeof c.usa_peltre === 'boolean') limpia.usa_peltre = c.usa_peltre;
  if (Array.isArray(c.valora) && c.valora.length) limpia.valora = [...c.valora];
  return limpia;
}

// "Calificacion pendiente" (CONTEXT.md "Captura de expo": la calificacion se
// puede dejar para despues): no existe o no tiene ningun valor.
export function calificacionVacia(cal) {
  return Object.keys(buildCalificacion(cal)).length === 0;
}

// El siguiente contacto (#262) tambien se captura DENTRO de la pantalla, en el
// mismo body de la creacion o de la edicion del prospecto. La regla es una sola y vive
// aqui: la comparten POST /api/prospectos/:id/siguiente-contacto, la captura y
// la edicion. Opcional: sin compromiso en el body no hay nada que validar. El
// body lleva `canales` (arreglo, minimo uno); el `canal` singular ya no existe.
export function validarSiguienteContacto(sc, ahora = new Date()) {
  const s = sc || {};
  const canales = s.canales;
  if (!Array.isArray(canales) || !canales.length
    || !canales.every(c => CANALES_SIGUIENTE_CONTACTO.includes(c))) {
    return 'Los canales del siguiente contacto son obligatorios (catálogo cerrado)';
  }
  const f = s.fecha ? new Date(s.fecha) : null;
  if (!f || isNaN(f)) return 'La fecha del siguiente contacto es obligatoria';
  if (f <= ahora) return 'La fecha del siguiente contacto debe ser futura';
  return null;
}

// Evento que se appendea al prospecto. `fecha` es cuando se registro y
// `fecha_contacto` el compromiso: la regla "el ultimo registrado manda"
// (ultimoEventoDe) se apoya en esa distincion.
export function buildEventoSiguienteContacto(sc, vendedor, ahora = new Date()) {
  return {
    tipo: 'siguiente_contacto', canales: [...sc.canales],
    fecha_contacto: new Date(sc.fecha).toISOString(),
    fecha: ahora.toISOString(), vendedor,
  };
}

// La calificacion como se lee en la tarjeta: chips cortos en el mismo orden en
// que se capturaron, mas los textos libres abajo. La etiqueta humana de `valora`
// se resuelve AQUI -- lo guardado son claves estables.
export function buildCalificacionChipsHtml(cal) {
  const c = buildCalificacion(cal);
  const chips = [];
  if (c.anios) chips.push(c.anios);
  if (c.sucursales) chips.push(c.sucursales);
  if (c.usa_peltre !== undefined) {
    chips.push(c.usa_peltre
      ? `Ya usa peltre${c.proveedor_peltre ? `: ${c.proveedor_peltre}` : ''}`
      : 'No usa peltre');
  }
  for (const clave of c.valora || []) chips.push(etiquetaValora(clave));
  if (c.otro_valora) chips.push(c.otro_valora);
  const textos = [c.concepto, c.tipo_clientes].filter(Boolean);
  const partes = [];
  if (chips.length) {
    partes.push(chips.map(t => `<span class="calificacion-badge">${escapeHtml(t)}</span>`).join(' '));
  }
  if (textos.length) {
    partes.push(`<div class="cot-card-meta">${textos.map(escapeHtml).join(' · ')}</div>`);
  }
  return partes.join('');
}

// Chips de la calificacion: a diferencia de los del bloque Contacto
// (buildChipsHtml, #261), su estado vive EN EL DOM -- la clase chip-activo y,
// en los grupos de multi seleccion, el orden en `data-orden`. Asi el mismo grupo sirve en la pantalla
// de expo y en la edicion inline de la tarjeta, que se re-pinta con la lista y
// no tiene donde guardar una copia en JS. Sin `onclick` inline: un listener
// delegado en app.js los enciende y los apaga (trampa #112).
export function buildGrupoChipsHtml(grupo, opciones, seleccion, multi = false) {
  const elegidas = multi
    ? (Array.isArray(seleccion) ? seleccion : [])
    : (seleccion ? [seleccion] : []);
  const chips = (opciones || []).map(op => {
    const valor = typeof op === 'string' ? op : op.clave;
    const etiqueta = typeof op === 'string' ? op : op.etiqueta;
    const orden = elegidas.indexOf(valor) + 1;
    const estado = orden > 0 ? ` data-orden="${orden}" class="chip chip-activo"` : ' class="chip"';
    return `<button type="button" data-valor="${escapeHtml(valor)}"${estado}>${escapeHtml(etiqueta)}</button>`;
  }).join('');
  return `<div class="chips-grupo" data-grupo="${escapeHtml(grupo)}"${multi ? ' data-multi="1"' : ''}>${chips}</div>`;
}

// "Ya usa o vende peltre" se guarda como booleano; el chip dice Si o No.
export const USA_PELTRE_OPCIONES = [
  { clave: 'si', etiqueta: 'Sí' },
  { clave: 'no', etiqueta: 'No' },
];

// Boton de microfono: dicta al campo `destino` (reconocimiento de voz del
// navegador en es-MX, wiring en app.js). Sin soporte del navegador la app lo
// esconde por CSS, para no ofrecer un boton que no hace nada.
export function buildMicHtml(destino) {
  return `<button type="button" class="btn-mic" data-mic="${escapeHtml(destino)}" title="Dictar">&#127908;</button>`;
}

// Campos de la calificacion, UNA sola vez: los pinta la pantalla de la captura
// de expo (prefijo "ex") y la edicion inline de la tarjeta (prefijo "ed2-<id>",
// que ahi completa lo que el stand o el importador no trajeron). Todo opcional:
// se puede guardar vacio. El ORDEN es el acordado en #267 -- los chips primero,
// que se contestan de un toque, y los textos libres al final. Las piezas
// estimadas y las notas NO viven aqui: son campos de siempre del prospecto y
// cada pantalla ya los trae.
export function buildCalificacionCamposHtml(prefijo, cal) {
  const c = cal || {};
  const id = campo => `${prefijo}-${campo}`;
  const usa = typeof c.usa_peltre === 'boolean' ? (c.usa_peltre ? 'si' : 'no') : '';
  const dictado = (campo, etiqueta, placeholder) => `
      <div class="form-group">
        <label>${etiqueta}</label>
        <div class="campo-dictado">
          <textarea id="${escapeHtml(id(campo))}" rows="2" placeholder="${escapeHtml(placeholder)}">${escapeHtml(c[campo] || '')}</textarea>
          ${buildMicHtml(id(campo))}
        </div>
      </div>`;
  return `
    <div class="calificacion-campos" id="${escapeHtml(prefijo)}-calificacion">
      <div class="form-group">
        <label>Años operando</label>
        ${buildGrupoChipsHtml('anios', ANIOS_OPERANDO, c.anios)}
      </div>
      <div class="form-group">
        <label>Sucursales</label>
        ${buildGrupoChipsHtml('sucursales', SUCURSALES, c.sucursales)}
      </div>
      <div class="form-group">
        <label>¿Ya usa o vende peltre?</label>
        ${buildGrupoChipsHtml('usa_peltre', USA_PELTRE_OPCIONES, usa)}
        <div class="campo-dictado" style="margin-top:6px">
          <input type="text" id="${escapeHtml(id('proveedor_peltre'))}" value="${escapeHtml(c.proveedor_peltre || '')}" placeholder="¿De qué proveedor?">
          ${buildMicHtml(id('proveedor_peltre'))}
        </div>
      </div>
      <div class="form-group">
        <label>¿Qué es importante al escoger la loza?</label>
        ${buildGrupoChipsHtml('valora', VALORA, c.valora, true)}
        <input type="text" id="${escapeHtml(id('otro_valora'))}" value="${escapeHtml(c.otro_valora || '')}" placeholder="Otro, ¿cuál?">
      </div>
      ${dictado('concepto', 'Concepto del negocio', '¿Qué vende, cómo es el lugar?')}
      ${dictado('tipo_clientes', '¿A qué clientes atiende?', '¿Quién le compra?')}
    </div>
  `;
}
