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

// Filtra por estado y ordena del quote mas reciente al mas viejo: la bandeja se
// trabaja empezando por lo ultimo que paso en Operam.
export function candidatosVisibles(candidatos, filtro) {
  return (candidatos || [])
    .filter(c => filtro === 'todos' || c.estado === filtro)
    .slice()
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

function accionesHtml(c, vendedores) {
  if (c.estado === 'aceptado') {
    return `<div class="alert alert-success" style="margin:8px 0 0">Aceptado &mdash; prospecto creado con vendedor <b>${escapeHtml(c.vendedor || '')}</b>. <button type="button" class="pc-link" onclick="bandejaVerEnTablero()">Ver en el tablero</button></div>`;
  }
  if (c.estado === 'descartado') {
    return '<div class="cot-card-meta" style="margin-top:8px">Descartado &mdash; no volverá a proponerse.</div>';
  }
  // Aceptar como cotizacion llega con #125; hasta entonces el boton se muestra
  // deshabilitado (y el servidor lo rechaza igual: la UI no es el gate).
  const botonAceptar = c.tipo === 'cotizacion'
    ? '<button class="btn btn-sm btn-primary" disabled title="Llega con #125">Aceptar como cotización</button>'
    : `<button class="btn btn-sm btn-primary" onclick="bandejaAceptar('${folioJs(c.folio)}')">Aceptar como prospecto</button>`;
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

export function buildBandejaHtml(candidatos, filtro, vendedores) {
  const visibles = candidatosVisibles(candidatos, filtro);
  const lista = visibles.length
    ? visibles.map(c => buildTarjetaBandejaHtml(c, vendedores)).join('')
    : '<div class="empty-state"><p>No hay candidatos en este filtro.</p></div>';
  return `
    <div class="bandeja-toolbar">
      <span class="bandeja-filtros">${buildFiltrosBandejaHtml(candidatos, filtro)}</span>
      <button class="btn btn-sm btn-secondary" disabled title="Llega con #126">Buscar nuevas en Operam</button>
    </div>
    <div>${lista}</div>`;
}
