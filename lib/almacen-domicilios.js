import { ALMACEN_ESPERADO } from '../public/js/domicilio-entrega-logica.js';

// Barrido de domicilios con almacen mal configurado (#416, derivado de #409).
// Operam deriva el almacen del que se entrega del `default_location` del
// DOMICILIO (branch), asi que un domicilio mal configurado manda la mercancia
// desde otro almacen y el pedido que se derive lo hereda. Los avisos de #409 son
// reactivos -- solo se entera quien pisa el domicilio --; este reporte los lista
// TODOS en el panel /admin.
//
// Aqui vive la REGLA, pura: que domicilios salen en el reporte. El endpoint lee
// Operam (padron, detalle de cada branch, catalogo de ubicaciones) y la
// configuracion del panel, y le pasa lo leido. El esperado es la MISMA constante
// del aviso al elegir domicilio: un solo lugar.

function texto(v) {
  return String(v == null ? '' : v).trim();
}

function nombreDeAlmacen(almacenes, codigo) {
  if (!almacenes || codigo === '') return '';
  const nombre = almacenes instanceof Map ? almacenes.get(codigo) : almacenes[codigo];
  return texto(nombre);
}

// --- La lista "asi va bien" ----------------------------------------------------
// Decision de Adrian (2026-09-23): el esperado sigue siendo la constante 40 y el
// domicilio que legitimamente entrega desde otro almacen se marca "asi va bien"
// desde el panel, para que deje de salir en cada corrida. Una excepcion es
// { clienteId, branchCode, almacen }: se aprueba ESA configuracion, no el
// domicilio para siempre. Solo ids: el repo es publico.
//
// Vive en la configuracion del panel (config-store, #276) bajo `excepcionesAlmacen`.
// Produccion ya tiene su fila de configuracion y data/config.json solo siembra una
// tabla VACIA, asi que la semilla no puede vivir alla: la llave AUSENTE es la
// semilla, y una lista guardada -- aunque sea vacia -- manda.
const EXCEPCIONES_ALMACEN_SEMILLA = Object.freeze([
  // Cliente Operam 8, "Mercado de Antiguedades de La Lagunilla" entrega desde PT2
  // (41). Confirmada por Adrian el 2026-09-23 (comentario de #416).
  Object.freeze({ clienteId: '8', branchCode: '8', almacen: '41' }),
]);

function normalizarExcepcion(e) {
  if (!e || typeof e !== 'object') return null;
  const branchCode = texto(e.branchCode);
  const almacen = texto(e.almacen);
  if (!branchCode || !almacen) return null;
  return { clienteId: texto(e.clienteId), branchCode, almacen };
}

export function excepcionesAlmacen(config) {
  const guardadas = config?.excepcionesAlmacen;
  const lista = Array.isArray(guardadas) ? guardadas : EXCEPCIONES_ALMACEN_SEMILLA;
  return lista.map(normalizarExcepcion).filter(Boolean);
}

// Un domicilio, una excepcion: marcarlo otra vez (con otro almacen) la reemplaza.
// null = no es una excepcion (sin domicilio o sin almacen); el endpoint lo
// traduce a 400.
export function marcarAsiVaBien(excepciones, excepcion) {
  const nueva = normalizarExcepcion(excepcion);
  if (!nueva) return null;
  const lista = (excepciones || []).filter(e => texto(e?.branchCode) !== nueva.branchCode);
  return [...lista, nueva];
}

export function desmarcarAsiVaBien(excepciones, branchCode) {
  const codigo = texto(branchCode);
  return (excepciones || []).filter(e => texto(e?.branchCode) !== codigo);
}

// Lo que no se alcanzo a medir -- la lectura del branch fallo, o Operam no dijo
// de que almacen entrega -- NO es una anomalia (inventar una alarma sobre lo que
// no se midio es como se deja de leer el reporte), pero tampoco desaparece: sale
// en `sinLeer` con el motivo en dos capas, porque un barrido que se lo tragara se
// veria igual que uno que reviso todo.
const MOTIVO_SIN_LEER = 'No se pudo leer de que almacen entrega este domicilio';

export function reporteAlmacenDomicilios({
  clientes = [], branches = {}, errores = {}, almacenes = new Map(),
  excepciones = [], operamUrl = '', esperado = ALMACEN_ESPERADO,
} = {}) {
  const base = texto(operamUrl).replace(/\/+$/, '');
  const ligaCliente = clienteId => `${base}/sales/manage/customers.php?debtor_no=${clienteId}`;
  const esperadoTexto = texto(esperado);
  const aprobado = new Map((excepciones || []).map(e => [texto(e?.branchCode), texto(e?.almacen)]));
  const vistos = new Map();
  const filas = [];
  const sinLeer = [];
  let revisados = 0;

  for (const c of clientes || []) {
    const clienteId = texto(c?.customer_id);
    const url = ligaCliente(clienteId);
    for (const b of c?.branches || []) {
      const branchCode = texto(b?.branch_code);
      revisados++;
      const detalle = branches[branchCode];
      const almacen = texto(detalle?.default_location);
      const fila = {
        clienteId,
        cliente: texto(c.CustName),
        branchCode,
        domicilio: texto(detalle?.br_name) || texto(b.br_name),
      };
      vistos.set(branchCode, fila);
      if (almacen === '') {
        const detalleTecnico = texto(errores[branchCode])
          || (detalle ? 'Operam no devolvio default_location' : 'Operam no entrego el domicilio');
        sinLeer.push({ ...fila, motivo: MOTIVO_SIN_LEER, detalle: detalleTecnico, url });
        continue;
      }
      if (almacen === esperadoTexto) continue;
      // Lo que se aprobo es ESA configuracion (domicilio + almacen): movido a otro
      // almacen, la aprobacion ya no dice nada de hoy y el domicilio vuelve a salir.
      if (aprobado.get(branchCode) === almacen) continue;
      filas.push({ ...fila, almacen, almacenNombre: nombreDeAlmacen(almacenes, almacen), url });
    }
  }

  // Todas las marcadas, tambien las que este barrido no encontro (o si todavia no
  // hay barrido): el panel tiene que poder desmarcar todo lo marcado. Los nombres
  // salen del barrido; sin el, solo los ids.
  const asiVaBien = (excepciones || []).map(e => {
    const branchCode = texto(e?.branchCode);
    const almacen = texto(e?.almacen);
    const visto = vistos.get(branchCode);
    const clienteId = visto ? visto.clienteId : texto(e?.clienteId);
    return {
      clienteId,
      cliente: visto ? visto.cliente : '',
      branchCode,
      domicilio: visto ? visto.domicilio : '',
      almacen,
      almacenNombre: nombreDeAlmacen(almacenes, almacen),
      url: ligaCliente(clienteId),
    };
  });

  return {
    esperado: esperadoTexto,
    esperadoNombre: nombreDeAlmacen(almacenes, esperadoTexto),
    revisados,
    filas,
    asiVaBien,
    sinLeer,
  };
}
