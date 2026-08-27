import { escapeHtml } from './prospectos-logica.js';

// Reporte de la importacion del export del evento (issue #265, CONTEXT.md
// "Importacion del export del evento"). Nucleo puro que consume la respuesta de
// POST /api/admin/prospectos/importar y la pinta en el panel admin: cuantos
// nacieron, cuantos se enriquecieron, quien se quedo cada uno, que se descarto
// con motivo y los gafetes sin celular, que no nacen como prospecto y hay que
// perseguir a mano.

const MOTIVO_YA_CLIENTE = 'ya es cliente';

function linea(texto, estilo = '') {
  return `<div class="cot-card-meta"${estilo ? ` style="${estilo}"` : ''}>${texto}</div>`;
}

function nombreLegible(nombre) {
  return nombre ? escapeHtml(nombre) : '(sin nombre)';
}

export function buildReporteImportacionHtml(reporte) {
  const r = reporte || {};
  const descartados = r.descartados || [];
  // "ya es cliente" es una de las cinco categorias del resumen, no un descarte
  // mas: se cuenta aparte para que no se pierda entre los telefonos ilegibles.
  const yaClientes = descartados.filter(d => d.motivo === MOTIVO_YA_CLIENTE).length;
  const partes = [
    linea(`<strong>${r.importados || 0} prospectos nuevos</strong>`),
    linea(`<strong>${r.enriquecidos || 0} prospectos enriquecidos</strong>`),
    linea(`<strong>${yaClientes} ${yaClientes === 1 ? 'celular que ya es cliente' : 'celulares que ya son clientes'}</strong>`),
  ];
  for (const [vendedor, n] of Object.entries(r.porVendedor || {})) {
    partes.push(linea(`${escapeHtml(vendedor)}: ${n}`));
  }
  if (descartados.length) {
    partes.push(linea(`<strong>${descartados.length} filas descartadas</strong>`, 'margin-top:8px'));
    for (const d of descartados) {
      partes.push(linea(`Fila ${d.fila}: ${nombreLegible(d.nombre)} - ${escapeHtml(d.motivo)}`));
    }
  }
  const sinCelular = r.sinCelular || [];
  if (sinCelular.length) {
    const plural = sinCelular.length === 1 ? 'gafete sin celular' : 'gafetes sin celular';
    partes.push(linea(`<strong>${sinCelular.length} ${plural}</strong> (no nacen como prospecto)`, 'margin-top:8px'));
    for (const g of sinCelular) {
      const detalle = [
        g.empresa ? escapeHtml(g.empresa) : '',
        g.correo ? escapeHtml(g.correo) : '',
        g.scoring ? `calificación ${escapeHtml(g.scoring)}` : '',
      ].filter(Boolean).join(' - ');
      partes.push(linea(`Fila ${g.fila}: ${nombreLegible(g.nombre)}${detalle ? ' - ' + detalle : ''}`));
    }
  }
  // Avisos de forma del archivo (issue #277): columnas esperadas que no
  // aparecieron y actividades que cayeron a "Otro" sin mapeo. Best effort, no
  // son un descarte: el archivo se importa igual.
  const avisos = r.avisos || {};
  const columnasNoEncontradas = avisos.columnasNoEncontradas || [];
  const actividadesSinMapeo = avisos.actividadesSinMapeo || [];
  if (columnasNoEncontradas.length || actividadesSinMapeo.length) {
    partes.push(linea('<strong>Avisos del archivo</strong>', 'margin-top:8px'));
    if (columnasNoEncontradas.length) {
      partes.push(linea(`Columnas no encontradas: ${columnasNoEncontradas.map(escapeHtml).join(', ')}`));
    }
    for (const a of actividadesSinMapeo) {
      partes.push(linea(`Actividad sin mapeo "${escapeHtml(a.actividad)}": ${a.filas} ${a.filas === 1 ? 'fila' : 'filas'}`));
    }
  }
  return partes.join('');
}
