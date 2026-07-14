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

import { escapeHtml, buildColaProspectosHtml, MOTIVOS_NO_UTIL } from './prospectos-logica.js';
import { PASOS_DECORADO, esDecorada, progresoDecorado } from './decorados-logica.js';
import { chipsCompletitud, customerIdFiscal, mostrarBotonCsf, esRfcGenerico } from './alta-logica.js';

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

// Interpreta la respuesta de POST /api/cotizacion/operam/:id (auto-subida, #83)
// en un estado de UI, por status + campos estructurados -- NUNCA parseando el
// string de error (misma disciplina que accionProspecto409 de alta-logica, #82).
// El endpoint de #81 (ADR-0006) es la unica fuente:
//   200 { ok, folio }             -> 'folio'      (subio; deja de ser PRE)
//   409 { error, candidatos: [] } -> 'candidatos' (dedup por nombre: elegir uno)
//   422 { error }                 -> 'sin_datos'  (cotizacion legacy sin datos
//                                                   minimos: queda PRE, reintento inutil)
//   503 / red / cualquier otro    -> 'pre'        (Operam fallo: PRE + Reintentar
//                                                   idempotente)
// Un 409 de conflicto (customerId que contradice lo ligado, sin lista de
// candidatos) cae a 'pre' con su mensaje: no hay lista que ofrecer.
export function interpretarSubidaOperam(resultado) {
  const r = resultado || {};
  // yaSubida (#83 F1c): la cotizacion ya tenia folio y el endpoint NO re-subio
  // (los quotes de Operam no se editan por API): folio + nota de que una
  // regeneracion local no viaja a la cotizacion ya registrada.
  // customerId/clienteGenerico (#93): la subida con alta generica (#81) devuelve
  // el customer_id creado/reutilizado; con clienteGenerico se ofrece la CSF junto
  // al folio (mismo criterio que el chip Fiscal de la tarjeta).
  if (r.ok) return { estado: 'folio', folio: r.folio ?? null, yaSubida: !!r.yaSubida, customerId: r.customerId ?? null, clienteGenerico: !!r.clienteGenerico };
  const candidatos = Array.isArray(r.candidatos) ? r.candidatos : [];
  if (r.status === 409 && candidatos.length) {
    return { estado: 'candidatos', candidatos, mensaje: r.error || 'Hay clientes con nombre similar en Operam' };
  }
  if (r.status === 422) {
    return { estado: 'sin_datos', mensaje: r.error || 'Faltan datos minimos para dar de alta el cliente' };
  }
  return { estado: 'pre', mensaje: r.error || 'No se pudo subir a Operam' };
}

// Lista inline (no modal, #83) de candidatos de la dedup por nombre (ADR-0001):
// el vendedor elige el cliente correcto o deja la cotizacion como PRE sin bloquear
// el documento. Cada boton dispara elegirCandidatoOperam(id, customerId, this) en
// app.js (re-llama el endpoint con { customerId }); "Dejar como PRE" solo cierra
// la lista. Los botones pasan `this` -- NUNCA un id de contenedor: la misma
// cotizacion puede estar pintada en dos paneles a la vez (Historial y
// cotizaciones previas del cliente) y un id duplicado haria que getElementById
// pintara siempre en el primero, posiblemente oculto (F2 de la revision). app.js
// resuelve el slot relativo al elemento clickeado.
export function buildCandidatosOperamHtml(id, candidatos, mensaje) {
  const items = (candidatos || []).map(c => {
    const nombre = escapeHtml(c.CustName || c.cust_name || 'Sin nombre');
    const ref = c.cust_ref ? ` · ${escapeHtml(c.cust_ref)}` : '';
    return `<li class="operam-candidato">
      <span>${nombre}${ref}</span>
      <button class="btn btn-sm btn-primary" onclick="elegirCandidatoOperam(${id}, ${c.id}, this)">Elegir</button>
    </li>`;
  }).join('');
  return `<div class="operam-status operam-status-candidatos">
    <div class="operam-candidatos-msg">${escapeHtml(mensaje || 'Elige el cliente correcto en Operam:')}</div>
    <ul class="operam-candidatos-lista">${items}</ul>
    <button class="btn btn-sm btn-secondary" onclick="dejarPreOperam(${id}, this)">Dejar como PRE</button>
  </div>`;
}

// Estado de la auto-subida (#83) para pintar en el resumen (al generar) o en la
// tarjeta del historial (al reintentar). Unica fuente del bloque de estado, sobre
// la vista pura de interpretarSubidaOperam. 'folio' = subio (verde), con nota si
// yaSubida (F1c: la regeneracion local no viaja a Operam); 'candidatos' = lista
// de dedup; 'sin_datos' = PRE sin reintento (falta de datos, no de Operam);
// 'pre' = fallo transitorio de Operam con Reintentar idempotente. Los botones
// pasan `this` (ver buildCandidatosOperamHtml).
export function buildOperamStatusHtml(id, vista) {
  const v = vista || {};
  if (v.estado === 'folio') {
    const folio = v.folio != null && v.folio !== '' ? ` — <strong>#Operam ${escapeHtml(String(v.folio))}</strong>` : '';
    const nota = v.yaSubida
      ? ` <span class="operam-status-nota">Los cambios locales no actualizan la cotizacion ya subida a Operam.</span>`
      : '';
    // #93: cliente generico recien creado/reutilizado -- se ofrece la CSF junto al
    // folio, mismo flujo de upgrade del chip Fiscal (#85), sin duplicar logica.
    const csf = v.clienteGenerico && v.customerId != null
      ? ` <button type="button" class="btn btn-sm btn-secondary" onclick="pcAbrirUpgradeFiscal(${v.customerId})">&iquest;Ya tienes su CSF? Subela</button>`
      : '';
    return `<span class="operam-status operam-status-ok">Subida a Operam${folio}</span>${nota}${csf}`;
  }
  if (v.estado === 'candidatos') {
    return buildCandidatosOperamHtml(id, v.candidatos, v.mensaje);
  }
  if (v.estado === 'sin_datos') {
    return `<span class="operam-status operam-status-pre"><span class="cot-badge badge-pre">PRE</span> ${escapeHtml(v.mensaje || '')}</span>`;
  }
  return `<span class="operam-status operam-status-pre"><span class="cot-badge badge-pre">PRE</span> ${escapeHtml(v.mensaje || 'No se pudo subir a Operam')}</span>` +
    ` <button class="btn btn-sm btn-primary" onclick="reintentarSubidaOperam(${id}, this)">Reintentar</button>`;
}

// Boton "Reintentar subida" de la tarjeta de cotizacion (Historial): reintenta la
// auto-subida idempotente (#81) cuando la cotizacion quedo PRE. Con ADR-0006 PRE
// pasa de ser un modo elegido ("Completar") a un fallo transitorio a reintentar;
// solo aparece mientras la cotizacion es PRE (sin folio, no historica). Dispara
// completarPreCotizacion(id, this) en app.js, que resuelve el slot de SU tarjeta.
export function botonCompletarHtml(cot) {
  if (!puedeCompletarPreCotizacion(cot)) return '';
  return `<button class="btn btn-primary btn-sm" onclick="completarPreCotizacion(${cot.id}, this)">Reintentar subida</button>`;
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

// === Vista Clientes (issue #94): mantenimiento de clientes desde el cotizador ===
// Reusa el buscador mixto y los chips del paso Cliente (alta-logica.js); estas
// funciones puras solo componen el HTML de la vista (filas, tarjeta, banner). Los
// onclick disparan las funciones cv* de app.js (wiring de DOM, no testeable en Node).

function inicialesCliente(nombre) {
  const p = String(nombre || '').split(/\s+/).filter(Boolean);
  return ((p[0] || ' ')[0] + ((p[1] || ' ')[0] || '')).toUpperCase().trim() || '?';
}

// El tag de una fila de resultado: rojo "RFC generico" para clientes de Operam que
// siguen sin CSF (NOVEDAD #94, saltan a la vista para completarlos), azul "Operam"
// con RFC real, gris "Prospecto".
export function tagResultadoClienteHtml(r) {
  const row = r || {};
  if (row.tipo === 'operam') {
    return esRfcGenerico(row.rfc)
      ? '<span class="pc-tag generico">RFC generico</span>'
      : '<span class="pc-tag operam">Operam</span>';
  }
  return '<span class="pc-tag prospecto">Prospecto</span>';
}

export function filaResultadoClienteHtml(r, i) {
  const row = r || {};
  return '<button type="button" class="pc-res-row" onclick="cvElegirResultado(' + i + ')">' +
    '<span class="pc-res-ini ' + escapeHtml(row.tipo || '') + '">' + escapeHtml(inicialesCliente(row.nombre)) + '</span>' +
    '<span class="pc-res-main"><span class="pc-res-nombre">' + escapeHtml(row.nombre || '') + '</span>' +
    '<span class="pc-res-sub">' + escapeHtml(row.sub || '') + '</span></span>' +
    tagResultadoClienteHtml(row) + '</button>';
}

// Fila punteada que abre el alta COMPLETA (acordeon 1-4, POST /api/crear-cliente),
// no un prospecto minimo como en el paso Cliente (#94, pieza 3).
export function filaCrearClienteHtml(query) {
  const q = String(query || '').trim();
  return '<button type="button" class="pc-res-row pc-crear" onclick="cvCaminoAlta(' + JSON.stringify(q).replace(/"/g, '&quot;') + ')">' +
    '<span class="pc-res-ini">+</span>' +
    '<span class="pc-res-main"><span class="pc-res-nombre">Dar de alta cliente completo &laquo;' + escapeHtml(q) + '&raquo;</span>' +
    '<span class="pc-res-sub">Con datos fiscales, comerciales y domicilio &mdash; sin cotizacion</span></span></button>';
}

// Banner de contexto del upgrade fiscal (#94): hace visible CONTRA QUIEN se
// actualiza. Se muestra siempre que altaCsfState.modoUpgrade este activo (tambien
// cuando el upgrade se abre desde el paso Cliente).
export function bannerUpgradeHtml(ctx) {
  const c = ctx || {};
  const nombre = c.nombre || 'este cliente';
  const id = c.id != null ? String(c.id) : '';
  const rfc = c.rfc || '';
  return '<div class="banner-upgrade"><span>&#8635;</span>' +
    '<div><b>Actualizando: ' + escapeHtml(nombre) + (id ? ' (ID ' + escapeHtml(id) + ')' : '') + '</b>' +
    '<small>RFC generico ' + escapeHtml(rfc) + ' se sustituira con el RFC real de la CSF. No se crea un cliente nuevo.</small></div></div>';
}

// Chips de completitud de la tarjeta en la vista Clientes. A diferencia del paso
// Cliente, Contacto y Entrega son informativos (no hay paso Envio a donde ir); solo
// el chip Fiscal pendiente es accionable (abre el upgrade) cuando hay cliente en Operam.
export function chipsClienteViewHtml(chips, custId) {
  const c = chips || {};
  const contacto = c.contacto
    ? '<span class="pc-chip ok">&#10003; Contacto</span>'
    : '<span class="pc-chip pend">Contacto</span>';
  const entrega = c.entrega === 'completo'
    ? '<span class="pc-chip ok">&#10003; Entrega</span>'
    : c.entrega === 'cp'
      ? '<span class="pc-chip parcial">Entrega &middot; CP</span>'
      : '<span class="pc-chip pend">Entrega &middot; pendiente</span>';
  const fiscal = c.fiscal
    ? '<span class="pc-chip ok">&#10003; Fiscal</span>'
    : (custId != null
        ? '<button type="button" class="pc-chip-btn" onclick="cvAbrirUpgrade()"><span class="pc-chip pend">Fiscal &middot; subir CSF</span></button>'
        : '<span class="pc-chip pend">Fiscal &middot; al subir a Operam</span>');
  return contacto + entrega + fiscal;
}

export function cardClienteHtml(cliente) {
  const c = cliente || {};
  const chips = chipsCompletitud(c);
  const custId = customerIdFiscal(c);
  const esOperam = c.tipo === 'operam';
  const nombre = c.name || c.ref || 'Sin nombre';
  const subPartes = esOperam
    ? [c.rfc, 'Cliente en Operam' + (c.id != null ? ' (ID ' + c.id + ')' : '')]
    : [c.telefono, c.ciudad || c.municipio, 'Prospecto'];
  const sub = subPartes.filter(Boolean).map(escapeHtml).join(' &middot; ');
  const botonCsf = mostrarBotonCsf(c)
    ? '<button type="button" class="btn btn-primary btn-block" style="margin-top:16px" onclick="cvAbrirUpgrade()">Completar datos fiscales (CSF)</button>'
    : '';
  return '<div class="pc-cli-card">' +
    '<div class="pc-cli-nombre">' + escapeHtml(nombre) + '</div>' +
    '<div class="pc-cli-sub">' + sub + '</div>' +
    '<div class="pc-chips">' + chipsClienteViewHtml(chips, custId) + '</div>' +
    botonCsf +
    '<button type="button" class="btn btn-secondary btn-block" style="margin-top:8px" onclick="cvCotizar()">Cotizar a este cliente &rsaquo;</button>' +
    '</div>';
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

// Texto compacto de la cadena de folios de Operam (issue #67, AC4) a partir del
// espejo persistido (data.espejoOperam de #67 AC3). Muestra SOLO los eslabones
// presentes, en orden de la cadena post-venta: cotizacion -> pedido -> factura ->
// remision -> estado de pago. El pago es un ESTADO derivado de la factura
// ('anticipo'/'pagado'), no un folio (los pagos/notas no son atribuibles a un pedido
// por la API, decision #67). Estilo del badge (denso, una linea):
//   "Cot #1141 - Pedido #7269 - Factura A1907 - Remision - Pagado". Sin espejo o sin
// eslabones devuelve cadena vacia (la tarjeta no pinta el elemento).
export function cadenaOperamTexto(espejo) {
  if (!espejo || typeof espejo !== 'object') return '';
  const partes = [];
  if (espejo.cotizacion) partes.push(`Cot #${espejo.cotizacion}`);
  if (espejo.pedido) partes.push(`Pedido #${espejo.pedido}`);
  if (espejo.factura && (espejo.factura.ref || espejo.factura.numero)) {
    partes.push(`Factura ${espejo.factura.ref || espejo.factura.numero}`);
  }
  if (Array.isArray(espejo.remisiones) && espejo.remisiones.length > 0) partes.push('Remision');
  if (espejo.pago === 'pagado') partes.push('Pagado');
  else if (espejo.pago === 'anticipo') partes.push('Anticipo');
  return partes.join(' - ');
}

// Elemento HTML de la cadena de folios para la tarjeta (issue #67, AC4). Vacio si
// no hay cadena (no ensucia la tarjeta de una oportunidad sin sync). Escapa el
// texto (los folios/refs vienen de Operam).
export function cadenaOperamHtml(espejo) {
  const texto = cadenaOperamTexto(espejo);
  if (!texto) return '';
  return `<div class="cot-cadena-operam">${escapeHtml(texto)}</div>`;
}

// Badge "Pago sin registrar" (issue #77): la tarjeta ya ENTREGADA (etapa
// producto_entregado) cuyo pago aun no aparece registrado en Operam. En el pipeline
// manda el cumplimiento (entrega), no la cobranza: la tarjeta llega a entregado con
// la remision y este sello marca la cobranza pendiente hasta que el pago se registre
// (el sync apaga el flag pagoSinRegistrar al liquidarse). Se ata a la etapa entregada
// para no contradecir una tarjeta topada por el gate de calca (#61): sin entrega no
// hay sello de entrega. Vacio en cualquier otro caso.
export function badgePagoSinRegistrarHtml(o) {
  if (!o || o.etapa !== 'producto_entregado' || !o.pagoSinRegistrar) return '';
  return '<span class="cot-badge badge-impago">Pago sin registrar</span>';
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
  // refId es el id numerico real del prospecto; o.id puede venir prefijado ("p7").
  // El control debe disparar la accion con el id numerico (un identificador sin
  // comillas como "p7" seria una variable undefined en el navegador).
  const id = o.refId ?? o.id;
  const opciones = vendedores
    .map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)}</option>`)
    .join('');
  return `<div class="cot-card-actions tablero-asignar">
    <select id="asignar-vendedor-${id}" class="btn-sm"><option value="">Asignar a...</option>${opciones}</select>
    <button class="btn btn-primary btn-sm" onclick="asignarVendedorTablero(${id})">Asignar</button>
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

// Controles de salida del embudo en la tarjeta del tablero (issue #59, Modelo A,
// CONTEXT.md "Etapas del pipeline"). Solo sobre oportunidades en etapa ACTIVA (las
// que ya salieron no se vuelven a cerrar). Para un PROSPECTO sin cotizar: salida a
// No util con motivo obligatorio del catalogo (select) -- cancelar el select no
// llama al servidor (AC4) -- mas Perdida con confirmacion. Para una COTIZACION:
// solo Perdida (una cotizacion real sale del embudo solo por Perdida, no por No
// util; los motivos de No util son de descalificacion de prospecto). Usa el id
// numerico (refId), nunca el prefijado ("p7"/"c10"), leccion del bug de #57.
export function buildSalidaControlHtml(o) {
  if (!o || esSalida(o.etapa)) return '';
  const id = o.refId ?? o.id;
  const perdida = `<button class="btn btn-secondary btn-sm" onclick="cerrarPerdidaTablero(${id})">Perdida</button>`;
  if (o.tipo === 'cotizacion') {
    return `<div class="cot-card-actions tablero-salida">${perdida}</div>`;
  }
  const motivos = MOTIVOS_NO_UTIL
    .map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
    .join('');
  return `<div class="cot-card-actions tablero-salida">
    <select id="salida-motivo-${id}" class="btn-sm"><option value="">Motivo No útil...</option>${motivos}</select>
    <button class="btn btn-secondary btn-sm" onclick="marcarNoUtilTablero(${id})">No útil</button>
    ${perdida}
  </div>`;
}

// Control de producto decorado / calca en la tarjeta de cotizacion (issue #61,
// CONTEXT.md "Producto decorado (calca)"). Solo aplica a COTIZACIONES (un
// prospecto sin cotizar no lleva calca). Una cotizacion no decorada ofrece
// marcarla; una decorada muestra el checklist de 6 pasos con su progreso (p. ej.
// 3/6), cada paso togglable. El paso 6 (archivos_dropbox) ofrece un input de
// archivo que sube la posicion de calca a Dropbox. Usa el id numerico (refId),
// nunca el prefijado ("c10"), leccion del bug de #57.
export function buildDecoradoControlHtml(o) {
  if (!o || o.tipo !== 'cotizacion') return '';
  const id = o.refId ?? o.id;
  if (!esDecorada(o)) {
    return `<div class="cot-card-actions decorado-control">
      <button class="btn btn-secondary btn-sm" onclick="marcarDecorada(${id}, true)">Marcar decorada (calca)</button>
    </div>`;
  }
  const checklist = o.calcaChecklist || (o.data && o.data.calcaChecklist);
  const { completos, total } = progresoDecorado(checklist);
  const completoDe = clave => {
    const ch = Array.isArray(checklist) ? checklist : [];
    const hit = ch.find(p => p && p.clave === clave);
    return !!(hit && hit.completo);
  };
  const pasos = PASOS_DECORADO.map(p => {
    const hecho = completoDe(p.clave);
    const toggle = `<button class="btn btn-sm ${hecho ? 'btn-secondary' : 'btn-primary'}" onclick="toggleCalcaPaso(${id}, '${p.clave}', ${hecho ? 'false' : 'true'})">${hecho ? 'Revertir' : 'Marcar'}</button>`;
    const archivos = p.clave === 'archivos_dropbox'
      ? `<input type="file" id="calca-archivos-${id}" class="btn-sm" multiple>
         <button class="btn btn-sm btn-primary" onclick="subirCalcaArchivos(${id})">Subir a Dropbox</button>`
      : '';
    return `<li class="calca-paso ${hecho ? 'calca-paso-hecho' : ''}">
      <span class="calca-paso-label">${hecho ? 'OK ' : ''}${escapeHtml(p.label)}</span>
      ${toggle}${archivos}
    </li>`;
  }).join('');
  return `<div class="cot-card-actions decorado-control">
    <div class="decorado-progreso">Calca ${completos}/${total}
      <button class="btn btn-secondary btn-sm" onclick="marcarDecorada(${id}, false)">Quitar decorada</button>
    </div>
    <ol class="calca-checklist">${pasos}</ol>
  </div>`;
}

function buildOportunidadCardHtml(o, vendedores, esAdmin) {
  const total = o.total ? `<div class="cot-card-total">$${fmtMoneda(o.total)}</div>` : '';
  const meta = [o.vendedor, o.ciudad, o.canal].filter(Boolean).map(escapeHtml).join(' · ');
  const badge = badgeFolioOperam(o);
  const cadena = cadenaOperamHtml(o.espejoOperam);
  const asignar = buildAsignarControlHtml(o, vendedores, esAdmin);
  const mover = buildMoverSeguimientoControlHtml(o);
  const salida = buildSalidaControlHtml(o);
  const decorado = buildDecoradoControlHtml(o);
  return `<div class="tablero-card" data-id="${o.id}" data-etapa="${escapeHtml(o.etapa)}">
    <div class="cot-card">
      <div class="cot-card-header">
        <div>
          <div class="cot-card-cliente">${escapeHtml(nombreOportunidad(o))}${badge}${badgePagoSinRegistrarHtml(o)}</div>
          ${meta ? `<div class="cot-card-meta">${meta}</div>` : ''}
        </div>
        ${total}
      </div>
      ${cadena}
      ${asignar}
      ${mover}
      ${decorado}
      ${salida}
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
//
// Reunion de diagnostico (issue #65, simetrica a la del prospecto): toda card de
// cotizacion ofrece agendar una reunion (input datetime + boton). Cuando la
// reunion vencio (item.reunionVencida), la card pide registrar el resultado:
// avance (Hecho, registra un evento que reanuda la cadencia) o Perdida (Modelo A
// #59: una cotizacion sale del embudo solo por Perdida, nunca por No util). Usa el
// id numerico de la cotizacion (leccion del bug de #57; aqui el id no viene
// prefijado, pero se documenta el criterio).
export function buildColaCotizacionItemHtml(item) {
  const fecha = new Date(item.fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  const btnWa = item.waLink
    ? `<a href="${item.waLink}" target="_blank" class="btn btn-primary btn-sm">WhatsApp</a>`
    : `<button class="btn btn-secondary btn-sm" disabled title="Sin telefono registrado">WhatsApp</button>`;
  const badge = badgeFolioOperamHtml(item);
  const pasoLabel = item.paso ? (PASO_LABELS[item.paso] || item.paso) : 'Reunión pendiente';
  const agendar =
    `<input type="datetime-local" id="cot-reunion-${item.id}" class="btn-sm">` +
    `<button class="btn btn-secondary btn-sm" onclick="agendarReunionCotizacion(${item.id})">Agendar reunión</button>`;
  // Reunion vencida: la card pide el resultado (avance/Perdida); el flujo de
  // seguimiento normal (marcar Hecho) cede el paso al cierre de la reunion. Si la
  // cotizacion reaparece solo por la reunion (sin paso de cadencia pendiente), no
  // se pinta "Hecho" (no hay paso que marcar).
  let acciones;
  if (item.reunionVencida) {
    acciones = `${btnWa} ${agendar}
      <button class="btn btn-secondary btn-sm" onclick="resultadoReunionCotizacion(${item.id}, 'avance')">✓ Hecho</button>
      <button class="btn btn-secondary btn-sm" onclick="resultadoReunionCotizacion(${item.id}, 'perdida')">Perdida</button>`;
  } else {
    const btnHecho = item.paso
      ? `<button class="btn btn-secondary btn-sm" onclick="marcarSeguimiento(${item.id}, '${item.paso}')">✓ Hecho</button>`
      : '';
    acciones = `${btnWa} ${agendar} ${btnHecho}
      <button class="btn btn-secondary btn-sm" onclick="cambiarEstadoCotizacion(${item.id}, 'ganada')">Ganada</button>
      <button class="btn btn-secondary btn-sm" onclick="cambiarEstadoCotizacion(${item.id}, 'perdida')">Perdida</button>`;
  }
  const reunionBadge = item.reunionVencida
    ? `<div style="margin-top:4px"><span class="reunion-badge">Reunión del ${escapeHtml(new Date(item.fechaReunion).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))} — registrar resultado</span></div>`
    : '';
  return `
    <div class="cot-card">
      <div class="cot-card-header">
        <div>
          <div class="cot-card-cliente">${escapeHtml(item.cliente || 'Sin nombre')}${badge}</div>
          <div class="cot-card-meta">${escapeHtml(pasoLabel)} · cotizada el ${escapeHtml(fecha)} (hace ${item.dias} dias) · ${item.totalPiezas} pzs</div>
          ${reunionBadge}
        </div>
        <div>
          <div class="cot-card-total">$${fmtMoneda(item.total)}</div>
        </div>
      </div>
      <div class="cot-card-actions">
        ${acciones}
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

// Filtro/historial de cerradas (issue #59, AC3, CONTEXT.md "Etapas del pipeline":
// las salidas viven en filtro/historial, fuera del tablero activo). Lista las
// oportunidades en salida (No util / Perdida) mostrando su nombre, el tipo de
// cierre y, para No util, el motivo del catalogo (o.motivoNoUtil, derivado del
// ultimo evento no_util por prospectoAOportunidad). Reusa el mismo criterio de
// "que es salida" que el tablero (esSalida).
const SALIDA_LABELS = { no_util: 'No útil', perdida: 'Perdida' };

export function buildCerradasHtml(oportunidades) {
  const cerradas = (oportunidades || []).filter(o => esSalida(o.etapa))
    .slice().sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));
  if (!cerradas.length) return '<div class="cot-card-meta">Sin oportunidades cerradas.</div>';
  return cerradas.map(o => {
    const cierre = SALIDA_LABELS[o.etapa] || o.etapa;
    const motivo = o.etapa === 'no_util' && o.motivoNoUtil ? ` · ${escapeHtml(o.motivoNoUtil)}` : '';
    const meta = [o.vendedor, o.ciudad, o.canal].filter(Boolean).map(escapeHtml).join(' · ');
    return `<div class="cot-card"><div class="cot-card-header"><div>
      <div class="cot-card-cliente">${escapeHtml(nombreOportunidad(o))}</div>
      <div class="cot-card-meta">${escapeHtml(cierre)}${motivo}${meta ? ' · ' + meta : ''}</div>
    </div></div></div>`;
  }).join('');
}
