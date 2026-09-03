// Logica pura de la bandeja de revision "Rescatados de Operam" (issue #122):
// filtros, conteos, orden y HTML de las tarjetas. Modulo sin efectos de
// navegador (mismo patron que pipeline-logica.js): lo importa app.js de forma
// nativa y los tests .cjs via import() dinamico.
//
// La bandeja vive FUERA de las 7 columnas del pipeline: aqui esperan los
// candidatos rescatados de Operam hasta que un humano los acepta (entran al
// tablero) o los descarta (se quedan marcados, sin volver a proponerse).

import { escapeHtml } from './prospectos-logica.js';
import { etiquetaFolioOperam } from './pipeline-logica.js';
import { filtrarPorCriterio } from './busqueda-logica.js';

// Estados de la bandeja como filtros, en el orden en que se trabajan. Pendientes
// es el default: es lo que falta decidir.
export const FILTROS_BANDEJA = [
  ['pendiente', 'Pendientes'],
  ['aceptado', 'Aceptados'],
  ['descartado', 'Descartados'],
  ['todos', 'Todos'],
];

// Marcas que la bandeja PINTA (no calcula): "compro otra cosa" viene del cruce
// por identidad (#123) y "posible duplicado" del indice de telefonos (#42).
// "Sin celular" es la unica que se deriva aqui, porque es la ausencia del dato.
export const MARCAS_BANDEJA = {
  'compro-otra': {
    clase: 'badge-compro-otra',
    texto: 'Compró otra cosa',
    title: 'El contacto ya es cliente con un pedido de otro monto - la cotización puede seguir viva',
  },
  dup: {
    clase: 'badge-dup',
    texto: 'Posible duplicado',
    title: 'El celular coincide con un prospecto o cliente existente',
  },
  'sin-cel': {
    clase: 'badge-sin-cel',
    texto: 'Sin celular',
    title: 'El quote no trae celular; se puede aceptar igual',
  },
};

export function marcasDeCandidato(c) {
  const marcas = (c && c.marcas) || {};
  const lista = [];
  if (marcas.comproOtraCosa) lista.push('compro-otra');
  if (marcas.posibleDuplicado) lista.push('dup');
  if (!(c && c.celular)) lista.push('sin-cel');
  return lista;
}

export function conteosBandeja(candidatos) {
  const lista = candidatos || [];
  const cuenta = estado => lista.filter(c => c.estado === estado).length;
  return {
    pendiente: cuenta('pendiente'),
    aceptado: cuenta('aceptado'),
    descartado: cuenta('descartado'),
    todos: lista.length,
  };
}

// Buscador de Rescatados (#289): el mismo control del Historial (texto +
// Desde/Hasta), combinado con AND con el filtro por estado. La fecha que acota
// es la del quote en Operam, recortada a su dia calendario -- el MISMO que pinta
// la tarjeta (fmtFecha, que tampoco pasa por Date).
export const BUSCABLES_CANDIDATO = {
  camposDe: c => [c?.folio, c?.contacto, c?.debtorNombre, c?.vendedor],
  digitosDe: c => c?.celular,
  diaDe: c => String(c?.fecha || '').slice(0, 10),
};

// Filtra por estado y ordena del quote mas reciente al mas viejo: la bandeja se
// trabaja empezando por lo ultimo que paso en Operam.
export function candidatosVisibles(candidatos, filtro, criterio) {
  const delEstado = (candidatos || []).filter(c => filtro === 'todos' || c.estado === filtro);
  return filtrarPorCriterio(delEstado, criterio, BUSCABLES_CANDIDATO)
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
}

export function buildFiltrosBandejaHtml(candidatos, filtro) {
  const conteos = conteosBandeja(candidatos);
  return FILTROS_BANDEJA.map(([clave, texto]) => {
    const etiqueta = clave === 'todos' ? texto : `${texto} (${conteos[clave]})`;
    const clase = filtro === clave ? 'btn-primary' : 'btn-secondary';
    return `<button class="btn btn-sm ${clase}" onclick="bandejaFiltro('${clave}')">${etiqueta}</button>`;
  }).join('');
}

// El folio viaja dentro de un onclick: se escapa primero para el contexto JS
// (comilla y backslash) y luego para el atributo HTML.
function folioJs(folio) {
  return escapeHtml(String(folio == null ? '' : folio).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
}

function fmtMonto(monto) {
  const n = Number(monto);
  return '$' + (Number.isFinite(n) ? n : 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Fecha del quote sin pasar por Date: la parte de fecha del ISO ya es la del
// documento y convertirla a hora local la correria un dia en husos negativos.
function fmtFecha(fecha) {
  const partes = String(fecha || '').slice(0, 10).split('-');
  if (partes.length !== 3) return '';
  const mes = MESES[parseInt(partes[1], 10) - 1];
  if (!mes) return '';
  return `${parseInt(partes[2], 10)}/${mes}/${partes[0]}`;
}

function dato(etiqueta, valor) {
  const contenido = valor
    ? escapeHtml(valor)
    : '<span class="bandeja-dato-vacio">&mdash;</span>';
  return `<div class="bandeja-dato"><b>${etiqueta}</b>${contenido}</div>`;
}

function badgeTipo(tipo) {
  return tipo === 'cotizacion'
    ? '<span class="cot-badge badge-tipo-cotizacion">COTIZACIÓN</span>'
    : '<span class="cot-badge badge-tipo-prospecto">PROSPECTO</span>';
}

function badgesMarcas(c) {
  return marcasDeCandidato(c).map(clave => {
    const m = MARCAS_BANDEJA[clave];
    return `<span class="cot-badge ${m.clase}" title="${escapeHtml(m.title)}">${escapeHtml(m.texto)}</span>`;
  }).join('');
}

// El vendedor propuesto es el creador del quote en Operam, y es EDITABLE. Si ese
// vendedor no esta en el catalogo del cotizador (p. ej. Mostrador), el selector
// abre sin eleccion en vez de mentir mostrando otro nombre.
function selectVendedorHtml(c, vendedores) {
  const catalogo = vendedores || [];
  const propuesto = c.vendedor || '';
  const enCatalogo = catalogo.some(v => v.name === propuesto);
  const placeholder = enCatalogo ? '' : '<option value="" selected>Elegir vendedor</option>';
  const opciones = catalogo.map(v =>
    `<option value="${escapeHtml(v.name)}"${v.name === propuesto ? ' selected' : ''}>${escapeHtml(v.name)}</option>`
  ).join('');
  return `<span class="bandeja-vendedor-wrap">
      <label>Vendedor</label>
      <select onchange="bandejaSetVendedor('${folioJs(c.folio)}', this.value)">${placeholder}${opciones}</select>
    </span>`;
}

// Motivo por el que un candidato tipo cotizacion NO puede entrar al pipeline como
// oportunidad, o '' si si puede (#125). El unico caso es el debtor GENERICO: el
// cajon agrupa a muchos contactos y el fallback por cliente del binding del sync
// cerraria en masa las tarjetas de todos ellos. Su quote se rescata como prospecto
// (#124). La marca la deriva el servidor del debtorId y viaja en el candidato; el
// gate REAL vive alla, aqui solo se pinta.
function motivoNoCotizacion(c) {
  if (!c || !c.debtorGenerico) return '';
  return `${c.debtorNombre || 'Este cliente'} es un cliente genérico: su quote se acepta como prospecto, no como cotización`;
}

function accionesHtml(c, vendedores) {
  if (c.estado === 'aceptado') {
    // El folio se nombra SIEMPRE con la convencion #Operam N (#63); el id interno
    // del registro creado es clave tecnica y no se presenta como numero.
    const creado = c.tipo === 'cotizacion'
      ? `cotización ${escapeHtml(etiquetaFolioOperam({ folioOperam: c.folio }))} creada`
      : 'prospecto creado';
    return `<div class="alert alert-success" style="margin:8px 0 0">Aceptado &mdash; ${creado} con vendedor <b>${escapeHtml(c.vendedor || '')}</b>. <button type="button" class="pc-link" onclick="bandejaVerEnTablero()">Ver en el tablero</button></div>`;
  }
  if (c.estado === 'descartado') {
    return '<div class="cot-card-meta" style="margin-top:8px">Descartado &mdash; no volverá a proponerse.</div>';
  }
  const motivo = c.tipo === 'cotizacion' ? motivoNoCotizacion(c) : '';
  const botonAceptar = c.tipo !== 'cotizacion'
    ? `<button class="btn btn-sm btn-primary" onclick="bandejaAceptar('${folioJs(c.folio)}')">Aceptar como prospecto</button>`
    : (motivo
      ? `<button class="btn btn-sm btn-primary" disabled title="${escapeHtml(motivo)}">Aceptar como cotización</button>`
      : `<button class="btn btn-sm btn-primary" onclick="bandejaAceptarCotizacion('${folioJs(c.folio)}')">Aceptar como cotización</button>`);
  return `<div class="cot-card-actions">
      ${selectVendedorHtml(c, vendedores)}
      ${botonAceptar}
      <button class="btn btn-sm btn-danger" onclick="bandejaDescartar('${folioJs(c.folio)}')">Descartar</button>
    </div>`;
}

export function buildTarjetaBandejaHtml(c, vendedores) {
  const claseExtra = c.estado === 'descartado'
    ? ' bandeja-card-descartada'
    : (c.estado === 'aceptado' ? ' bandeja-card-aceptada' : '');
  // El folio SIEMPRE se nombra con la convencion #Operam N (#63): en la bandeja
  // no hay id interno que mostrar, el candidato es el quote de Operam.
  const folio = escapeHtml(etiquetaFolioOperam({ folioOperam: c.folio }));
  const meta = [folio, fmtFecha(c.fecha), c.debtorNombre ? escapeHtml(c.debtorNombre) : '']
    .filter(Boolean).join(' &middot; ');
  return `
    <div class="cot-card${claseExtra}">
      <div class="cot-card-header">
        <div>
          <div class="cot-card-cliente">${escapeHtml(c.contacto || 'Sin nombre')}${badgeTipo(c.tipo)}</div>
          <div class="bandeja-marcas">${badgesMarcas(c)}</div>
          <div class="cot-cadena-operam">${meta}</div>
        </div>
        <div class="cot-card-total">${fmtMonto(c.monto)}</div>
      </div>
      <div class="bandeja-datos">
        ${dato('Celular', c.celular)}
        ${dato('Proyecto', c.proyecto)}
        ${dato('Email', c.email)}
        ${dato('Entrega', c.domicilio)}
      </div>
      ${accionesHtml(c, vendedores)}
    </div>`;
}

// Boton "Buscar nuevas en Operam" (#126): dispara el descubrimiento recurrente.
// `ocupado` lo controla el caller mientras la corrida esta en vuelo (deshabilita
// el boton y cambia el texto -- el walk pacea contra Operam, puede tardar).
export function buildBotonBuscarNuevasHtml(ocupado) {
  return ocupado
    ? '<button class="btn btn-sm btn-secondary" disabled>Buscando...</button>'
    : '<button class="btn btn-sm btn-secondary" onclick="bandejaBuscarNuevas()">Buscar nuevas en Operam</button>';
}

// Resumen de la corrida (#126) para pintar junto al boton: cuantos candidatos
// nuevos se propusieron y, si hubo saltos, el desglose por motivo (solo los que
// tuvieron algun conteo -- una corrida sin genericos no necesita mostrar "cerro: 0").
export function buildResultadoBuscarNuevasHtml(resultado) {
  if (!resultado) return '';
  const { nuevos, saltados } = resultado;
  const desglose = Object.entries(saltados || {})
    .filter(([, n]) => n > 0)
    .map(([motivo, n]) => `${motivo}: ${n}`)
    .join(', ');
  const texto = nuevos > 0
    ? `${nuevos} candidato${nuevos === 1 ? '' : 's'} nuevo${nuevos === 1 ? '' : 's'}`
    : 'sin candidatos nuevos';
  return `<span class="bandeja-resultado-busqueda">${escapeHtml(texto)}${desglose ? ` (saltados: ${escapeHtml(desglose)})` : ''}</span>`;
}

export function buildBandejaHtml(candidatos, filtro, vendedores, busqueda, criterio) {
  const visibles = candidatosVisibles(candidatos, filtro, criterio);
  const lista = visibles.length
    ? visibles.map(c => buildTarjetaBandejaHtml(c, vendedores)).join('')
    : '<div class="empty-state"><p>No hay candidatos en este filtro.</p></div>';
  const b = busqueda || {};
  return `
    <div class="bandeja-toolbar">
      <span class="bandeja-filtros">${buildFiltrosBandejaHtml(candidatos, filtro)}</span>
      ${buildBotonBuscarNuevasHtml(b.ocupado)}
      ${buildResultadoBuscarNuevasHtml(b.resultado)}
    </div>
    <div>${lista}</div>`;
}
