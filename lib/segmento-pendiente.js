// Segmento pendiente (#365, ADR-0017): el segmento comercial que el alta pidio y
// la web legacy de Operam no dejo escrito. La subida de cotizacion escribe el
// segmento DIFERIDO (la latencia de la subida manda), asi que su fallo no cabe en
// la respuesta al vendedor: se anota en clientes_log y el administrador lo ve en
// /admin con el motivo, en vez de descubrir semanas despues un cliente "Sin
// segmento" y buscarlo en el log de Render.
//
// Aqui vive la REGLA, pura: que filas del log siguen pendientes. El endpoint solo
// consulta la tabla y traduce (nombre del segmento, liga a Operam).
//
// clientes_log no tiene columna para el segmento intentado y agregarla seria una
// migracion por un dato de diagnostico, asi que viaja en `fuente` con su propio
// prefijo (fuenteSegmento / segmentoDeFuente). El prefijo ademas mantiene estas
// filas FUERA del reporte de higiene (#86), que solo mira fuente 'alta-generica'.

export const RESULTADO_SEGMENTO_PENDIENTE = 'segmento-pendiente';
export const RESULTADO_SEGMENTO_ESCRITO = 'segmento-escrito';

const PREFIJO_FUENTE = 'segmento:';

export function fuenteSegmento(segmentoId) {
  return `${PREFIJO_FUENTE}${segmentoId ?? ''}`;
}

function segmentoDeFuente(fuente) {
  const texto = String(fuente ?? '');
  return texto.startsWith(PREFIJO_FUENTE) ? texto.slice(PREFIJO_FUENTE.length) : '';
}

// El motivo se guarda con las dos capas (Mensaje en dos capas, CONTEXT.md) en la
// unica columna de texto libre del log: mensaje para el administrador, detalle
// tecnico para depurar.
const SEPARADOR = ' | ';

export function motivoSegmentoPendiente(mensaje, detalle) {
  return `${mensaje ?? ''}${SEPARADOR}${detalle ?? ''}`;
}

function capasDelMotivo(errorMsg) {
  const texto = String(errorMsg ?? '');
  const corte = texto.indexOf(SEPARADOR);
  if (corte === -1) return { motivo: texto, detalle: '' };
  return { motivo: texto.slice(0, corte), detalle: texto.slice(corte + SEPARADOR.length) };
}

function instante(row) {
  return new Date(row.created_at).getTime();
}

// Un cliente sale de la lista cuando una auditoria POSTERIOR registra su segmento
// escrito: el pendiente es un hecho fechado, no un estado, y solo un hecho mas
// nuevo lo cancela (un 'escrito' anterior al fallo no dice nada de hoy).
export function filasSegmentoPendiente(rows) {
  const log = rows || [];

  const escritoHasta = new Map();
  for (const r of log) {
    if (r.resultado !== RESULTADO_SEGMENTO_ESCRITO) continue;
    const id = String(r.cliente_id);
    const t = instante(r);
    if (!escritoHasta.has(id) || t > escritoHasta.get(id)) escritoHasta.set(id, t);
  }

  // Un cliente, una fila: varios intentos fallidos del mismo Cliente Operam son
  // el mismo pendiente, y el que sirve para actuar es el ultimo.
  const porCliente = new Map();
  for (const r of log) {
    if (r.resultado !== RESULTADO_SEGMENTO_PENDIENTE) continue;
    const id = String(r.cliente_id);
    const t = instante(r);
    if (escritoHasta.has(id) && escritoHasta.get(id) > t) continue;
    const actual = porCliente.get(id);
    if (!actual || t > instante(actual)) porCliente.set(id, r);
  }

  return [...porCliente.values()]
    .sort((a, b) => instante(b) - instante(a))
    .map(r => ({
      cliente_id: r.cliente_id,
      nombre: r.nombre || '',
      rfc: r.rfc || '',
      segmento: segmentoDeFuente(r.fuente),
      ...capasDelMotivo(r.error_msg),
      created_at: new Date(r.created_at).toISOString(),
    }));
}
