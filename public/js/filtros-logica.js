// Constructor de la rejilla de filtros por selector (#456, spec #398): un
// bloque etiqueta+selector por filtro, con el mismo aspecto que la Tabla de
// prospectos. Cada vista declara sus filtros junto a sus campos buscables
// (`BUSCABLES_*.filtros`: campo -> { etiqueta, lee, procedencia, valores }) y
// el nucleo que los aplica es `filtrarPorCriterio` (busqueda-logica.js).
//
// Vive en su PROPIO modulo y no en busqueda-logica.js: necesita escapeHtml, que
// vive en prospectos-logica.js, y ese modulo ya importa el nucleo de busqueda
// -- ponerlo alla cerraria un ciclo, la misma razon por la que chipOrigenHtml
// vive en prospectos-logica.js. Las vistas no importan este modulo: declaran
// datos, y quien pinta (app.js) llama al constructor.
//
// Tres procedencias de opciones, declaradas por filtro:
// - 'datos': los valores presentes en el listado cargado (vendedor, Evento).
//   Con una sola opcion (o ninguna) el filtro no decide nada y NO se pinta,
//   como el selector de vendedor de la Tabla de prospectos. La excepcion la
//   declara la vista con `pintarConUnaOpcion` (#457): el campo que no todos
//   los registros traen -- el Evento, solo los prospectos de expo -- si decide
//   con una sola opcion, porque separa a los de la expo del resto.
// - 'catalogo': el catalogo cerrado del glosario (Origen), completo aunque hoy
//   ninguna fila use alguna opcion.
// - 'vista': constantes de la vista (Estado de la cotizacion).
// `valores` acepta textos sueltos o `{ valor, texto }`.

import { escapeHtml } from './prospectos-logica.js';

function comoLista(valor) {
  if (valor == null) return [];
  return Array.isArray(valor) ? valor : [valor];
}

function comoOpcion(v) {
  if (v && typeof v === 'object') return { valor: String(v.valor), texto: String(v.texto ?? v.valor) };
  return { valor: String(v), texto: String(v) };
}

// Las opciones de UN filtro, sin la de "Todos". Las derivadas salen sin
// repetir, sin vacios y en orden alfabetico; un campo multi-valor aporta cada
// uno de sus valores.
export function opcionesDeFiltro(filtro, items) {
  if (filtro?.procedencia !== 'datos') return (filtro?.valores || []).map(comoOpcion);
  const vistos = new Set();
  for (const item of items || []) {
    for (const v of comoLista(filtro.lee ? filtro.lee(item) : null)) {
      const texto = v == null ? '' : String(v).trim();
      if (texto) vistos.add(texto);
    }
  }
  return [...vistos].sort((a, b) => a.localeCompare(b, 'es')).map(comoOpcion);
}

function filtroVisible(filtro, opciones) {
  if (filtro?.procedencia !== 'datos' || filtro.pintarConUnaOpcion) return opciones.length > 0;
  return opciones.length > 1;
}

// La rejilla completa de una vista. `seleccion` es el `filtros` del criterio
// (campo -> valor) y `prefijo` distingue los ids por vista. Cada selector lleva
// `data-filtro` con su campo: la vista escucha `change` en el contenedor y no
// necesita un onclick inline (trampa #112). Sin filtros visibles devuelve ''.
export function buildFiltrosSelectorHtml(items, filtros, seleccion = {}, prefijo = 'filtros') {
  const bloques = Object.entries(filtros || {}).map(([campo, filtro]) => {
    const opciones = opcionesDeFiltro(filtro, items);
    if (!filtroVisible(filtro, opciones)) return '';
    const elegido = seleccion?.[campo] == null ? '' : String(seleccion[campo]);
    const id = `${prefijo}-filtro-${campo}`;
    const html = [{ valor: '', texto: 'Todos' }, ...opciones].map(o =>
      `<option value="${escapeHtml(o.valor)}"${o.valor === elegido ? ' selected' : ''}>${escapeHtml(o.texto)}</option>`
    ).join('');
    return `<div class="filtro-selector"><label for="${escapeHtml(id)}">${escapeHtml(filtro.etiqueta || campo)}</label>` +
      `<select id="${escapeHtml(id)}" data-filtro="${escapeHtml(campo)}">${html}</select></div>`;
  }).filter(Boolean);
  if (!bloques.length) return '';
  return `<div class="filtros-selector">${bloques.join('')}</div>`;
}

// El contador tras filtrar (US 12 de la spec): cuantos registros quedan y, si
// los filtros o la busqueda recortaron, de cuantos. `nombres` trae el sustantivo
// ya listo para innerHTML ({ uno, varios }); concuerda con el total cuando se
// dice "N de M".
export function buildContadorHtml(visibles, total, nombres) {
  const n = Number(visibles) || 0;
  const t = Number(total) || 0;
  if (n < t) return `<strong>${n}</strong> de ${t} ${t === 1 ? nombres.uno : nombres.varios}`;
  return `<strong>${n}</strong> ${n === 1 ? nombres.uno : nombres.varios}`;
}
