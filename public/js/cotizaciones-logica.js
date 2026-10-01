// Logica pura del tablero de cotizaciones (issue #50, CONTEXT.md "Tablero de
// cotizaciones"): columnas = cadencia de seguimiento + cierre. Las tarjetas
// avanzan solas con el tiempo (umbrales de lib/seguimiento.js: 2/7/21/28 dias
// naturales desde la fecha de envio); solo el cierre se opera arrastrando a
// Ganada o Perdida. Modulo sin efectos de navegador, mismo patron que
// prospectos-logica.js: lo consumen app.js y los tests .cjs via import().

import { escapeHtml, chipOrigenHtml, CANALES } from './prospectos-logica.js';
import { etiquetaFolioOperam, badgeFolioOperamHtml, documentoBloqueado, LEYENDA_DEDUP_PENDIENTE, motivoPerdidaHtml, motivoCanceladaHtml } from './pipeline-logica.js';
import { nombreConCorto, clienteDesdeCotizacionReciente } from './alta-logica.js';
import { filtrarPorCriterio, fechaLocal } from './busqueda-logica.js';
import { mensajeCotizacion, motivoSinResumen } from './resumen-cotizacion-logica.js';
import { MENSAJE_COPIA_LISTA_FIJADA } from './tier-logica.js';
import { tienePedido, MENSAJE_PERDIDA_CON_PEDIDO } from './perdida-logica.js';
import { puedeActualizarCotizacion, buildBotonEditarHtml } from './editar-cotizacion-logica.js';

// El gate de Editar vive en un modulo HOJA desde #502 (lo importa tambien
// pipeline-logica.js, que este modulo importa: aqui cerraria un ciclo); se
// reexporta para que server.js y lib/postfix-reintento.js no cambien.
export { puedeActualizarCotizacion };

const MS_DIA = 24 * 60 * 60 * 1000;

export const COLUMNAS_COTIZACIONES = ['reciente', 'dia2', 'dia7', 'por_vencer', 'vencida', 'ganada', 'perdida', 'cancelada'];

const COLUMNA_LABELS = {
  reciente: 'Recién enviada',
  dia2: 'Día 2',
  dia7: 'Día 7',
  por_vencer: 'Por vencer',
  vencida: 'Vencida',
  ganada: 'Ganada',
  perdida: 'Perdida',
  cancelada: 'Cancelada',
};

// #484: Cancelada es una columna cerrada mas, pero no se llega arrastrando: la
// decide el admin, con motivo, desde la tarjeta del Pipeline.
const CERRADAS = new Set(['ganada', 'perdida', 'cancelada']);
const DESTINOS_ARRASTRE = new Set(['ganada', 'perdida']);

// Columna de una cotizacion hoy. Los estados cerrados mandan sobre la edad;
// descartada queda fuera del tablero (es accion de tarjeta, no columna).
export function columnaCotizacion(c, hoy = new Date()) {
  if (c.estado === 'descartada') return null;
  if (CERRADAS.has(c.estado)) return c.estado;
  const dias = Math.floor((hoy - fechaLocal(c.fecha)) / MS_DIA);
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
    cols[col].sort((a, b) => fechaLocal(b.fecha) - fechaLocal(a.fecha));
  }
  return cols;
}

// El tiempo no se arrastra: solo se puede soltar en Ganada o Perdida, y solo
// desde una columna de cadencia (una cerrada no se reabre arrastrando).
// #482: la cotizacion arrastrada, si se conoce, no se suelta en Perdida con
// pedido (tienePedido): esa venta ya se cerro.
export function puedeArrastrarCotizacion(de, a, cot) {
  if (a === 'perdida' && tienePedido(cot)) return false;
  return DESTINOS_ARRASTRE.has(a) && !CERRADAS.has(de);
}

// El aviso del arrastre que rebota. Una cerrada (Ganada, Perdida o Cancelada,
// #484) no se reabre: eso manda sobre el aviso de Perdida con pedido, que pide
// Cancelada al admin.
export function avisoArrastreCotizacion(de, a, cot) {
  if (CERRADAS.has(de)) return 'Una cotizaci\u00f3n cerrada no se reabre arrastrando';
  if (a === 'perdida' && tienePedido(cot)) return MENSAJE_PERDIDA_CON_PEDIDO;
  return 'El tiempo no se arrastra: las tarjetas avanzan solas con los d\u00edas';
}

// La linea del Motivo de Perdida en la tarjeta del Historial (#483), en el
// tablero y en la lista: solo en una cotizacion Perdida que lo trae. La Perdida
// anterior al catalogo no pinta nada, como antes.
export function lineaMotivoPerdidaHtml(c) {
  if (!c || c.estado !== 'perdida' || !c.motivoPerdida) return '';
  return `<div class="cot-card-meta">${COLUMNA_LABELS.perdida}${motivoPerdidaHtml(c)}</div>`;
}

// #484: la linea de la Cancelada, con su etiqueta propia y su motivo libre.
export function lineaMotivoCanceladaHtml(c) {
  if (!c || c.estado !== 'cancelada' || !c.motivoCancelada) return '';
  return `<div class="cot-card-meta">${COLUMNA_LABELS.cancelada}${motivoCanceladaHtml(c)}</div>`;
}

function fmtMoneda(n) {
  if (n == null) return '0.00';
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fechaCorta(fecha) {
  return fechaLocal(fecha).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Tarjeta del tablero: cliente, total, piezas, vendedor, dias desde envio y
// link wa.me (el telefono llega del servidor ya en formato wa via
// lib/seguimiento.telefonoWa). Solo las columnas de cadencia son arrastrables.
// El badge de folio (#111, ADR-0009) identifica la tarjeta con el MISMO numero
// que Operam -- nunca con el id interno -- reusando la unica fuente del badge
// (badgeFolioOperamHtml), la misma que la vista lista y la cola Hoy.
function buildCotizacionCardHtml(c, col, hoy) {
  const dias = Math.floor((hoy - fechaLocal(c.fecha)) / MS_DIA);
  const abierta = !CERRADAS.has(col);
  const acciones = [];
  if (c.telefono) acciones.push(`<a href="https://wa.me/${escapeHtml(c.telefono)}" target="_blank" class="btn btn-primary btn-sm">WhatsApp</a>`);
  // Cierre por boton ademas del arrastre: en tactil no hay drag (feedback de
  // Adrian en la revision movil 2026-06-12).
  if (abierta) {
    acciones.push(`<button class="btn btn-secondary btn-sm" onclick="cerrarCotizacionTablero(${c.id}, 'ganada')">Ganada</button>`);
    if (!tienePedido(c)) acciones.push(`<button class="btn btn-secondary btn-sm" onclick="cerrarCotizacionTablero(${c.id}, 'perdida')">Perdida</button>`);
  }
  return `<div class="tablero-card" draggable="${abierta}" data-id="${c.id}" data-col="${col}">
    <div class="cot-card">
      <div class="cot-card-header">
        <div>
          <div class="cot-card-cliente">${escapeHtml(nombreConCorto(c.cliente || 'Sin nombre', c.nombreCorto))}${badgeFolioOperamHtml(c)}</div>
          <div class="cot-card-meta">${fechaCorta(c.fecha)} · hace ${dias} días · ${escapeHtml(c.vendedor)} · ${c.totalPiezas} pzs</div>
          ${lineaMotivoPerdidaHtml(c)}
          ${lineaMotivoCanceladaHtml(c)}
          <div style="margin-top:4px">${chipOrigenHtml(c)}</div>
        </div>
        <div class="cot-card-total">$${fmtMoneda(c.total)}</div>
      </div>
      ${acciones.length ? `<div class="cot-card-actions">${acciones.join(' ')}</div>` : ''}
    </div>
  </div>`;
}

// Link wa.me para compartir una cotizacion del historial (issue #103). El texto
// lo arma el nucleo del Resumen de la cotizacion (#307), el mismo que usa la
// cotizacion recien generada en app.js: aqui solo se pasa el registro guardado.
// origin lo pasa el caller (window.location.origin no existe en este modulo sin
// efectos de navegador), igual que el indice modelo -> familia con el que el
// nucleo agrupa (#312): viaja en el catalogo (state.precios.familias).
export function buildWhatsAppLinkHistorial(c, origin = '', indiceFamilias = {}) {
  return mensajeCotizacion(c, origin, indiceFamilias)?.waUrl;
}

// Acciones de una fila del historial (issue #103): Ver PDF / Ver HTML regeneran
// el documento desde el registro guardado via los GET correspondientes (sin
// depender de disco); WhatsApp abre wa.me con el link al HTML regenerado. Sin
// data persistida (registro historico, c.hasData false) no hay nada que
// regenerar: las tres quedan deshabilitadas en vez de apuntar a un 404.
function botonDeshabilitado(label, motivo) {
  return `<button class="btn btn-secondary btn-sm" disabled title="${escapeHtml(motivo)}">${label}</button>`;
}

export function buildHistorialAccionesHtml(c, origin = '', indiceFamilias = {}) {
  const deshabilitadas = motivo => ['Ver PDF', 'Ver HTML', 'WhatsApp']
    .map(label => botonDeshabilitado(label, motivo))
    .join(' ');
  if (!c.hasData) return deshabilitadas('Datos no disponibles');
  // Candado por duplicado sin resolver (#204): las TRES abren el mismo documento
  // (WhatsApp comparte el link al HTML), asi que las tres se apagan -- dejar
  // WhatsApp vivo mandaria al cliente un link que solo muestra el aviso. Se
  // rehabilitan solas en cuanto el vendedor resuelve y la subida limpia el motivo.
  if (documentoBloqueado(c)) return deshabilitadas(LEYENDA_DEDUP_PENDIENTE);
  const pdfUrl = `/api/cotizacion/pdf/${c.id}`;
  const htmlUrl = `/api/cotizacion/html/${c.id}`;
  // #311: el documento existe (PRE por fallo de Operam incluida) pero sin folio
  // no hay numero que citar por WhatsApp -- Ver PDF y Ver HTML siguen abiertos,
  // solo WhatsApp se apaga (motivoSinResumen, resumen-cotizacion-logica.js).
  const motivoSinFolio = motivoSinResumen(c);
  const whatsappHtml = motivoSinFolio
    ? botonDeshabilitado('WhatsApp', motivoSinFolio)
    : `<a href="${escapeHtml(buildWhatsAppLinkHistorial(c, origin, indiceFamilias))}" target="_blank" class="btn btn-primary btn-sm">WhatsApp</a>`;
  return `<a href="${escapeHtml(pdfUrl)}" target="_blank" class="btn btn-secondary btn-sm">Ver PDF</a>` +
    ` <a href="${escapeHtml(htmlUrl)}" target="_blank" class="btn btn-secondary btn-sm">Ver HTML</a>` +
    ` ${whatsappHtml}`;
}

// Cliente de la sesion al CARGAR una cotizacion del historial, en los dos modos
// -- Editar y Copiar (#394). cargarCotizacion llenaba los campos cl-* con la
// cotizacion y dejaba el cliente de la sesion como estaba, asi que el customerId
// que viajaba en el cuerpo (customerIdFiscal del cliente elegido) era el del
// anterior: la 1280 se guardo con el nombre y el domicilio de Sofia Rodriguez y
// la identidad de Gerardo Cardenas, que era quien quedaba en la pestana.
//
// La identidad sale de la cotizacion cargada por el MISMO normalizador que usa
// Recientes (clienteDesdeCotizacionReciente): un solo lugar decide como se lee
// una cotizacion guardada como cliente de la tarjeta. `clienteEnSesion` entra
// para dejar escrito que se DESCARTA: no se hereda nada de el, ni el Cliente
// Operam ni el domicilio. Una cotizacion que nunca se subio se carga sin liga,
// que es lo correcto: todavia no hay Cliente Operam a su nombre.
export function clienteAlCargarCotizacion(cotCliente, clienteEnSesion) {
  return clienteDesdeCotizacionReciente(cotCliente);
}

// La liga de una cotizacion con su Cliente Operam es FIJA (#394, ADR-0006;
// CONTEXT.md "Oportunidad": en Operam la cotizacion nunca se reasigna). Al
// guardar sobre un registro que YA tiene liga, la persistida manda: el cuerpo
// puede traer un id ajeno -- el del cliente de la sesion anterior del navegador,
// que es como la cotizacion 1280 termino apuntando al Cliente Operam 529 con el
// quote a nombre del 527 -- y ese valor no puede pisar el registro. Hasta #394
// el previo solo se copiaba cuando llegaba `null`, asi que el ajeno ganaba.
//
// El domicilio viaja con la liga y no aparte: un branchId que llego junto a un
// customerId ajeno es del OTRO Cliente Operam y se descarta con el. Sin liga
// previa no hay nada que proteger -- ahi el cuerpo la estrena, que es como la
// subida (#81) la anota por primera vez.
//
// `customerIdIgnorado` es el id que llego y no se acepto: el caller lo registra.
// Silenciar el descarte es lo que dejo el cruce invisible durante seis dias.
export function ligaClienteAlGuardar(clienteNuevo, clientePrevio) {
  const nuevo = clienteNuevo || {};
  const prev = clientePrevio || {};
  const idPrevio = prev.customerId ?? null;
  const idNuevo = nuevo.customerId ?? null;
  const ajeno = idPrevio != null && idNuevo != null && String(idNuevo) !== String(idPrevio);
  const branchNuevo = ajeno ? null : (nuevo.branchId ?? null);
  return {
    customerId: idPrevio != null ? idPrevio : idNuevo,
    branchId: branchNuevo != null ? branchNuevo : (prev.branchId ?? null),
    customerIdIgnorado: ajeno ? idNuevo : null,
  };
}

// El Representante de Ventas de una cotizacion es quien la CREO, y editarla no
// lo cambia (#405, decision 2026-09-20; CONTEXT.md "Vendedor"). Hay DOS campos y
// divergian: la columna `vendedor` del registro -- la del Historial, el pipeline
// y los permisos -- no se toca al actualizar, mientras que `data.vendedor` -- lo
// que imprime el documento -- se pisaba en cada guardado con quien guardaba, asi
// que un admin que corregia la cotizacion de un vendedor cambiaba el nombre que
// el cliente lee como su representante (la 1284 paso de Alejandro a Adrian).
//
// El original sale de la columna, que es la duena del registro; solo si el
// registro no la trae (historicos del backfill, donde el salesman de Operam no
// mapeo a nadie) se cae a lo que el documento ya decia, y solo sin ninguna de
// las dos manda quien guarda. Sin registro previo -- cotizacion nueva, incluido
// Copiar, que nace sin id -- el vendedor es quien la crea, como siempre.
export function vendedorAlGuardar(registroPrevio, quienGuarda) {
  const prev = registroPrevio || {};
  const original = [prev.vendedor, prev.data?.vendedor]
    .map(v => (typeof v === 'string' ? v.trim() : ''))
    .find(v => v !== '');
  return original || quienGuarda;
}

// Las dos acciones de carga del historial (#104): "Actualizar cotización" (mismo
// registro, mismo folio de Operam) y "Crear nueva a partir de ésta" (lo que "Cargar"
// hacia hasta hoy, ahora con nombre honesto). Actualizar es el default cuando se
// puede; si no, queda deshabilitado CON el motivo en el title -- deshabilitar sin
// explicar convierte una regla de negocio en un boton roto. Sin data no hay ninguna
// de las dos: no hay carrito que restaurar.
export function buildAccionesCargaHtml(cot) {
  const c = cot || {};
  const gate = puedeActualizarCotizacion(c);
  const actualizar = buildBotonEditarHtml(c);
  if (!c.hasData) {
    return `${actualizar} <button class="btn btn-secondary btn-sm" disabled title="Datos no disponibles">Copiar cotización</button>`;
  }
  const nueva = `<button class="btn ${gate.puede ? 'btn-secondary' : 'btn-primary'} btn-sm" onclick="cargarCotizacion(${c.id}, 'nueva')">Copiar cotización</button>`;
  return `${actualizar} ${nueva}`;
}

// Aviso de modo actualizacion (#109, ADR-0008): identifica el documento por el
// folio REAL de Operam con la convencion existente del badge (etiquetaFolioOperam
// de pipeline-logica.js, issue #63) -- nunca por el id interno del registro. Ese
// era el bug reportado por Adrian en la verificacion de #104: "se actualizara la
// cotizacion #16 y su quote en Operam (mismo folio)" se lee como si 16 y el folio
// real fueran el mismo numero. Describe la accion en terminos del boton que el
// vendedor va a oprimir (Actualizar cotizacion, #504), no de un "generar"
// generico. El folio SIEMPRE existe en este modo (gate
// puedeActualizarCotizacion exige folioOperam), asi que no hay caso "sin
// folio" que resolver aqui.
export function buildAvisoModoActualizacion(folioOperam) {
  const badge = etiquetaFolioOperam({ folioOperam });
  return `<span class="operam-status"><span>Con &laquo;Actualizar cotizaci&oacute;n&raquo;, la <strong>${escapeHtml(badge)}</strong> se actualizar&aacute; en Operam.</span></span>`;
}

// Avisos al cambiar de cliente (#385): el `aviso` que devuelve
// estadoAlCambiarCliente (tier-logica.js) pintado en el mismo canal que el
// aviso de modo actualizacion. Cadena vacia sin aviso: el slot se oculta solo
// (.operam-status-slot:empty). La salida de la edicion nombra el folio con la
// etiqueta Cotizacion N (ADR-0009: nunca el id interno); la lista perdida es
// el MISMO mensaje que Copiar sin permiso, porque es la misma regla.
export function buildAvisoCambioClienteHtml(aviso) {
  if (!aviso) return '';
  const partes = [];
  if (aviso.salidaEdicion) {
    const badge = escapeHtml(etiquetaFolioOperam({ folioOperam: aviso.folioOperam }));
    // Envuelto en un solo <span>: .operam-status es inline-flex y el texto tras el
    // <strong> se partia en otro renglon.
    partes.push(`<span>Saliste de la edici&oacute;n de la <strong>${badge}</strong>: al generar se crear&aacute; una cotizaci&oacute;n nueva y la ${badge} se queda en Operam como estaba.</span>`);
  }
  if (aviso.listaPerdida) partes.push(MENSAJE_COPIA_LISTA_FIJADA);
  return partes.map(m => `<span class="operam-status">${m}</span>`).join(' ');
}

// Etiquetas de los botones del paso Cotizacion en su estado de ACCION (#504,
// antes #109): el del HTML guarda y sube -- "Crear cotizacion" sin folio,
// "Actualizar cotizacion" con el --, y el del PDF solo descarga. Crear vs
// Actualizar sale de si la cotizacion tiene folio, no del modo actualizacion:
// una cotizacion creada en la sesion con folio ya se actualiza, y una PRE se
// vuelve a crear.
export function textoBotonGenerar(tipo, tieneFolio) {
  if (tipo === 'html') return tieneFolio ? 'Actualizar cotizaci\u00f3n' : 'Crear cotizaci\u00f3n';
  return 'Descargar PDF';
}

const MOTIVO_PDF_SIN_CONFIRMAR = 'Primero crea o actualiza la cotizaci\u00f3n';

// Forma canonica para comparar dos cuerpos del POST: llaves ordenadas en todos
// los niveles y las que valen undefined fuera, que es exactamente lo que el
// JSON del POST hace con ellas. El orden de los arreglos SI cuenta (partidas).
function canonico(v) {
  if (Array.isArray(v)) return v.map(canonico);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined) o[k] = canonico(v[k]);
    return o;
  }
  return v;
}

// "La cotizacion cambio" (#504): el MISMO cuerpo que se manda en
// POST /api/cotizacion contra el ultimo que se guardo, nunca una lista a mano
// de campos del formulario -- un campo nuevo del cuerpo entra solo.
export function cuerposIguales(a, b) {
  if (a == null || b == null) return false;
  return JSON.stringify(canonico(a)) === JSON.stringify(canonico(b));
}

// Que desenlace de Operam deja la cotizacion CONFIRMADA (ADR-0009, nota del
// 2026-10-01). Al crear, folio y pre-cotizacion (falla o vencimiento) cuentan:
// el documento se entrega numerado o como PRE explicita. La excepcion son los
// candidatos de duplicado sin resolver (#204), que ademas ponen el candado.
export function subidaConfirma(vista) {
  return !!vista && !!vista.estado && vista.estado !== 'candidatos';
}

// Al actualizar solo `actualizada` confirma: bloqueada, desactualizado y
// revisar dejarian un documento numerado distinto de lo que Operam tiene con
// ese numero. Los pasos secundarios en aviso (#403, #448, #106) no cuentan.
export function actualizacionConfirma(vista) {
  return vista?.estado === 'actualizada';
}

// Estado de los dos botones del paso Cotizacion (#504). Visores (Ver HTML /
// Descargar PDF, sin volver a guardar) solo con la cotizacion confirmada Y el
// cuerpo en pantalla igual al guardado; si no, el del HTML es la accion y el
// PDF espera deshabilitado. El candado de #204 manda sobre todo.
export function estadoBotonesDocumento({ tieneFolio, confirmada, cuerpoActual, cuerpoGuardado, candado }) {
  const accion = textoBotonGenerar('html', tieneFolio);
  const pdf = textoBotonGenerar('pdf', tieneFolio);
  if (candado) {
    return {
      visores: false,
      html: { texto: accion, habilitado: false, titulo: LEYENDA_DEDUP_PENDIENTE },
      pdf: { texto: pdf, habilitado: false, titulo: LEYENDA_DEDUP_PENDIENTE },
    };
  }
  if (confirmada && cuerposIguales(cuerpoActual, cuerpoGuardado)) {
    return {
      visores: true,
      html: { texto: 'Ver HTML', habilitado: true, titulo: '' },
      pdf: { texto: pdf, habilitado: true, titulo: '' },
    };
  }
  return {
    visores: false,
    html: { texto: accion, habilitado: true, titulo: '' },
    pdf: { texto: pdf, habilitado: false, titulo: MOTIVO_PDF_SIN_CONFIRMAR },
  };
}

// Progreso del boton mientras se espera a Operam (#504): la etapa real y los
// segundos transcurridos, para que una espera larga no parezca colgada.
export function textoProgresoDocumento(etapa, ms) {
  return `${etapa} ${Math.max(0, Math.floor(ms / 1000))} s`;
}

// Buscador del Historial (#146, ampliado #147, rango de fechas #148). Nucleo
// puro: recibe el arreglo YA cargado en memoria (el listado completo viaja en
// el GET existente, sin ida al servidor) y devuelve el subconjunto que
// matchea. Se aplica antes de pintar, asi que Lista y Tablero comparten el
// filtro gratis y cambiar de modo lo conserva.
//
// Matchea por razon social, nombre corto y contacto de entrega (texto,
// case/acentos), por el folio REAL de Operam (ADR-0009 -- nunca el id
// interno, que es clave tecnica de URLs), y por el celular reducido a digitos
// como subcadena de los digitos del telefono -- consistente con la llave
// ultimos10 (lib/telefono-llave.js): sin importar como se capturo el
// telefono, "5512" lo encuentra. Texto y rango de fechas se combinan con AND.
//
// El VENDEDOR no es buscable: #147 lo habia sumado para que el admin hallara
// las cotizaciones de una persona del equipo, y en produccion eso ahogaba la
// busqueda que la caja anuncia (un vendedor firma decenas de cotizaciones, un
// cliente una o dos, y en el OR gana el vendedor). Filtrar por persona es un
// selector aparte, no texto libre. Misma regla en las cinco vistas.
//
// Desde #289 el filtro en si vive en busqueda-logica.js, compartido con las
// otras cuatro vistas; aqui solo queda la declaracion de QUE es buscable en
// una cotizacion y de que fecha se acota (la de la cotizacion).
//
// Filtros por selector (#456, spec #398): lo que el texto no busca se ACOTA
// con un selector -- Vendedor (derivado de los datos: solo las personas que
// hay en el listado), Origen (catalogo cerrado del glosario; el Historial lo
// recibe HEREDADO en `origen`, #287) y Estado de la cotizacion (constantes de
// esta vista). Tipo de cliente no entra: es dato del Contacto y no viaja en el
// listado (Out of Scope de la spec).
export const ESTADOS_COTIZACION = [
  { valor: 'abierta', texto: 'Abierta' },
  { valor: 'ganada', texto: 'Ganada' },
  { valor: 'perdida', texto: 'Perdida' },
  { valor: 'cancelada', texto: 'Cancelada' },
];

export const BUSCABLES_COTIZACION = {
  camposDe: c => [c?.cliente, c?.folioOperam, c?.nombreCorto, c?.contactoEntrega],
  digitosDe: c => c?.telefono,
  fechaDe: c => c?.fecha,
  filtros: {
    vendedor: { etiqueta: 'Vendedor', lee: c => c?.vendedor, procedencia: 'datos' },
    origen: { etiqueta: 'Origen', lee: c => c?.origen, procedencia: 'catalogo', valores: CANALES },
    estado: { etiqueta: 'Estado', lee: c => c?.estado, procedencia: 'vista', valores: ESTADOS_COTIZACION },
  },
};

export function filtrarCotizaciones(cotizaciones, criterio) {
  return filtrarPorCriterio(cotizaciones, criterio, BUSCABLES_COTIZACION);
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
