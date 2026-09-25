// Lineas de transporte que ofrece el cotizador (#447, decision de Adrian
// 2026-09-24). Nucleo puro sin IO: lo comparten el servidor (que carriers consulta
// envia.com, si Lalamove o Tresguerras cotizan, la validacion del PUT del panel)
// y el navegador (las opciones del selector de envio y el panel /admin).
//
// Cada linea: `nombre` (lo que ve el vendedor), `fuente` (`envia` con su `codigo`
// de carrier de envia.com, o una integracion propia), `shipVia` (id del
// transportista en Operam, null mientras no exista alla) y `activa`.
//
// Vive en la configuracion del panel (config-store, #276) bajo `lineasTransporte`.
// Produccion ya tiene su fila de configuracion y data/config.json solo siembra una
// tabla VACIA, asi que la semilla no puede vivir alla: la llave AUSENTE es la
// semilla, y una lista guardada -- aunque sea vacia -- manda (mismo criterio que
// `excepcionesAlmacen`, #416).

export const FUENTES_LINEA = Object.freeze(['envia', 'lalamove', 'tresguerras']);

// ids de ship_via confirmados en Operam por Adrian (comentario de #447,
// 2026-09-24). Default = 1 no es linea. UPS ya no se ofrece.
const SEMILLA = Object.freeze([
  Object.freeze({ nombre: 'FedEx', fuente: 'envia', codigo: 'fedex', shipVia: 2, activa: true }),
  Object.freeze({ nombre: 'DHL', fuente: 'envia', codigo: 'dhl', shipVia: 6, activa: true }),
  Object.freeze({ nombre: 'Estafeta', fuente: 'envia', codigo: 'estafeta', shipVia: 5, activa: true }),
  Object.freeze({ nombre: 'Lalamove', fuente: 'lalamove', codigo: null, shipVia: 3, activa: true }),
  Object.freeze({ nombre: 'Tresguerras', fuente: 'tresguerras', codigo: null, shipVia: 4, activa: true }),
]);

function texto(v) {
  return v == null ? '' : String(v).trim();
}

// Una linea guardada que ya no se entiende (sin nombre, fuente desconocida, envia
// sin codigo) se descarta al leer en vez de romper la cotizacion.
function normalizarLinea(l) {
  if (!l || typeof l !== 'object') return null;
  const nombre = texto(l.nombre);
  const fuente = texto(l.fuente);
  if (!nombre || !FUENTES_LINEA.includes(fuente)) return null;
  const codigo = fuente === 'envia' ? texto(l.codigo) : null;
  if (fuente === 'envia' && !codigo) return null;
  const shipVia = Number.isInteger(l.shipVia) && l.shipVia > 0 ? l.shipVia : null;
  return { nombre, fuente, codigo, shipVia, activa: l.activa === true };
}

export function lineasTransporte(config) {
  const guardadas = config?.lineasTransporte;
  const lista = Array.isArray(guardadas) ? guardadas : SEMILLA;
  return lista.map(normalizarLinea).filter(Boolean);
}

// Los carriers que se consultan en envia.com: SOLO las lineas `envia` activas.
export function carriersEnvia(lineas) {
  return (lineas || [])
    .filter(l => l.fuente === 'envia' && l.activa)
    .map(l => ({ codigo: l.codigo, nombre: l.nombre }));
}

// Una integracion propia (Lalamove, Tresguerras) solo cotiza si su linea esta
// activa en la lista; ausente de la lista guardada cuenta como inactiva.
export function lineaActiva(lineas, fuente) {
  return (lineas || []).some(l => l.fuente === fuente && l.activa);
}

const NOMBRE_INTEGRACION = { lalamove: 'Lalamove', tresguerras: 'Tresguerras' };

// El transportista (`ship_via` de Operam) de la linea que eligio el vendedor (#448).
// `envio` es el envio guardado de la cotizacion ({opcion, carrier, ...}, #102): la
// opcion de integracion propia se cruza por su fuente y la paqueteria de envia.com
// por el codigo de carrier. No exige que la linea siga activa: la cotizacion ya
// eligio su envio, y apagar la linea despues no cambia quien lo lleva.
// Devuelve { shipVia, linea, motivo }; shipVia null = no se manda nada y el quote
// conserva el del domicilio, con el motivo en palabras.
export function transportistaDeEnvio(lineas, envio) {
  const opcion = envio?.opcion;
  let linea;
  if (opcion === 'envia') {
    const carrier = texto(envio.carrier).toLowerCase();
    linea = (lineas || []).find(l => l.fuente === 'envia' && texto(l.codigo).toLowerCase() === carrier);
    if (!linea) {
      return { shipVia: null, linea: null, motivo: `la paqueteria "${texto(envio.carrier)}" no esta en las lineas de transporte de /admin` };
    }
  } else if (opcion === 'lalamove' || opcion === 'tresguerras') {
    linea = (lineas || []).find(l => l.fuente === opcion);
    if (!linea) {
      return { shipVia: null, linea: null, motivo: `${NOMBRE_INTEGRACION[opcion]} no esta en las lineas de transporte de /admin` };
    }
  } else {
    return { shipVia: null, linea: null, motivo: 'la cotizacion no lleva envio de una linea de transporte (sin envio o envio manual)' };
  }
  if (!Number.isInteger(linea.shipVia) || linea.shipVia <= 0) {
    return { shipVia: null, linea: linea.nombre, motivo: `la linea "${linea.nombre}" no tiene transportista de Operam capturado en /admin` };
  }
  return { shipVia: linea.shipVia, linea: linea.nombre, motivo: null };
}

// El aviso con el que responde el endpoint de una integracion desactivada, o null
// si la linea esta activa.
export function avisoLineaInactiva(lineas, fuente) {
  if (lineaActiva(lineas, fuente)) return null;
  const linea = (lineas || []).find(l => l.fuente === fuente);
  const nombre = linea ? linea.nombre : (NOMBRE_INTEGRACION[fuente] || fuente);
  return `${nombre} no esta activa en las lineas de transporte de /admin`;
}

// Tope de int en Postgres, igual que el operam_id del vendedor (#434).
const SHIP_VIA_MAX = 2147483647;
const INVALIDO = Symbol('shipVia invalido');

function shipViaCapturado(valor) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'string') {
    const t = valor.trim();
    if (t === '') return null;
    if (!/^\d+$/.test(t)) return INVALIDO;
    valor = Number(t);
  }
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor <= 0 || valor > SHIP_VIA_MAX) return INVALIDO;
  return valor;
}

// La MISMA regla la usan el panel /admin (avisa antes de guardar) y el PUT de
// /api/admin/lineas-transporte (rechaza con 400 antes de reemplazar la lista).
// Devuelve { lineas } normalizadas o { error } con el motivo.
export function validarLineasTransporte(lista) {
  if (!Array.isArray(lista)) return { error: 'Formato invalido: se esperaba la lista de lineas de transporte' };
  const lineas = [];
  const codigos = new Set();
  const integraciones = new Set();
  for (let i = 0; i < lista.length; i++) {
    const l = lista[i] || {};
    const nombre = texto(l.nombre);
    if (!nombre) return { error: `La linea ${i + 1} no tiene nombre` };
    const fuente = texto(l.fuente);
    if (!FUENTES_LINEA.includes(fuente)) return { error: `La linea "${nombre}" tiene una fuente invalida (${FUENTES_LINEA.join(', ')})` };
    let codigo = null;
    if (fuente === 'envia') {
      codigo = texto(l.codigo);
      if (!codigo) return { error: `La linea "${nombre}" necesita el codigo de envia.com` };
      const llave = codigo.toLowerCase();
      if (codigos.has(llave)) return { error: `El codigo de envia.com "${codigo}" esta en dos lineas` };
      codigos.add(llave);
    } else {
      if (integraciones.has(fuente)) return { error: `Solo puede haber una linea de ${fuente}` };
      integraciones.add(fuente);
    }
    const shipVia = shipViaCapturado(l.shipVia);
    if (shipVia === INVALIDO) return { error: `La linea "${nombre}": el transportista de Operam debe ser un numero entero positivo o quedar vacio` };
    lineas.push({ nombre, fuente, codigo, shipVia, activa: l.activa === true });
  }
  return { lineas };
}

const DETALLE_INTEGRACION = { lalamove: 'envio local', tresguerras: 'carga consolidada' };

function nombreIntegracion(lineas, fuente) {
  const linea = (lineas || []).find(l => l.fuente === fuente);
  return linea ? linea.nombre : NOMBRE_INTEGRACION[fuente];
}

// Opciones del selector de envio del paso Envio. "Sin envio" y "manual" siempre;
// la paqueteria si hay alguna linea `envia` activa (y su texto las nombra); cada
// integracion propia solo con su linea activa. `opcionVigente` es la opcion que
// trae la cotizacion abierta (Editar/Copiar, borrador): se ofrece aunque su linea
// ya no este activa, para restaurar el envio historico tal como se guardo.
export function opcionesSelectorEnvio(lineas, opcionVigente = null) {
  const opciones = [{ value: 'none', texto: 'Sin envio (cliente recoge o arregla envio)' }];
  const envia = carriersEnvia(lineas).map(c => c.nombre);
  if (envia.length) opciones.push({ value: 'envia', texto: `Cotizar paqueteria (${envia.join(', ')} via envia.com)` });
  else if (opcionVigente === 'envia') opciones.push({ value: 'envia', texto: 'Cotizar paqueteria (via envia.com)' });
  for (const fuente of ['lalamove', 'tresguerras']) {
    if (lineaActiva(lineas, fuente) || opcionVigente === fuente) {
      opciones.push({ value: fuente, texto: `Cotizar con ${nombreIntegracion(lineas, fuente)} (${DETALLE_INTEGRACION[fuente]})` });
    }
  }
  opciones.push({ value: 'manual', texto: 'Agregar costo manualmente' });
  return opciones;
}
