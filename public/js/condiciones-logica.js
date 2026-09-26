// Condiciones comerciales por omision de una cotizacion (#324, decisiones de
// Adrian 2026-09-25). Nucleo puro sin IO: lo comparten el servidor (validacion
// del PUT del panel), el navegador (las notas con las que arranca la cotizacion)
// y el panel /admin.
//
// El plazo de la fabrica se llama "Tiempo de produccion" en el documento, para no
// chocar con el Tiempo de entrega de la paqueteria (CONTEXT.md). Se deriva de las
// PIEZAS DE PRODUCTO (las de calca no cuentan, como en la lista de precios) por
// escalones "desde N piezas", y la cotizacion decorada usa su PROPIA tabla.

import { piezasDeProducto, hayCalcaEnCarrito } from './calcas-logica.js';

// El escalon mas alto cuyo umbral no rebasa las piezas; por debajo del primer
// umbral, el primer escalon: no existe la cotizacion "sin tiempo de produccion".
export function escalonDePiezas(escalones, piezas) {
  const lista = [...(escalones || [])].sort((a, b) => a.desde - b.desde);
  let actual = lista[0] || null;
  for (const e of lista) {
    if ((piezas || 0) >= e.desde) actual = e;
  }
  return actual;
}

const FORMAS_UNIDAD = {
  semanas: ['semana', 'semanas'],
  dias: ['dia', 'dias'],
};

export function plazoTexto({ cantidad, unidad }) {
  const [singular, plural] = FORMAS_UNIDAD[unidad];
  return `${cantidad} ${cantidad === 1 ? singular : plural}`;
}

// El participio concuerda con la unidad: "1 semana contada", "5 dias contados".
const PARTICIPIO = {
  semanas: ['contada', 'contadas'],
  dias: ['contado', 'contados'],
};

// La linea de las notas. `items` es el carrito ({codigo, cantidad}): el escalon
// sale de sus piezas de PRODUCTO y la calca en el carrito elige la tabla de calca
// sola; `decorado` es la marca del vendedor (decorado sin partida de calca,
// ADR-0010), que tambien la elige.
export function notaTiempoProduccion(condiciones, { items, decorado } = {}) {
  const conCalca = !!decorado || hayCalcaEnCarrito(items);
  const tabla = conCalca ? condiciones.tiempoProduccionCalca : condiciones.tiempoProduccion;
  const escalon = escalonDePiezas(tabla, piezasDeProducto(items));
  const [singular, plural] = PARTICIPIO[escalon.unidad];
  const contadas = escalon.cantidad === 1 ? singular : plural;
  return `- Tiempo de produccion: ${plazoTexto(escalon)} ${contadas} a partir del pago del anticipo.`;
}

// Vive en la configuracion del panel (config-store, #276) bajo
// `condicionesComerciales`. Como `lineasTransporte` (#447) y `excepcionesAlmacen`
// (#416), la llave AUSENTE es la semilla: produccion ya tiene su fila de
// configuracion y data/config.json solo siembra una tabla vacia. La semilla es el
// texto que el formulario traia clavado antes de #324 y un plazo que reproduce el
// de hoy (4 semanas; 6 con calca o con la marca de decorado de #90).
export const UNIDADES_PLAZO = Object.freeze(['dias', 'semanas']);

const TEXTOS = Object.freeze([
  ['precios', 'precios'],
  ['sinEnvio', 'sin envio'],
  ['flete', 'flete'],
  ['anticipo', 'anticipo'],
  ['saldo', 'saldo'],
]);

const TABLAS = Object.freeze([
  ['tiempoProduccion', 'tiempo de produccion'],
  ['tiempoProduccionCalca', 'tiempo de produccion con calca'],
]);

const SEMILLA = Object.freeze({
  precios: 'Precios EXW Ixtapaluca, Estado de Mexico.',
  sinEnvio: 'No incluye envio.',
  flete: 'Envio a costo y riesgo del cliente.',
  anticipo: 'Se requiere 50% de anticipo para comenzar la produccion.',
  saldo: 'Pago del saldo previo a la entrega.',
  tiempoProduccion: Object.freeze([Object.freeze({ desde: 0, cantidad: 4, unidad: 'semanas' })]),
  tiempoProduccionCalca: Object.freeze([Object.freeze({ desde: 0, cantidad: 6, unidad: 'semanas' })]),
});

function texto(v) {
  return v == null ? '' : String(v).trim();
}

const INVALIDO = Symbol('entero invalido');

function entero(valor, minimo) {
  const t = typeof valor === 'string' ? valor.trim() : valor;
  if (t === '' || t == null) return INVALIDO;
  const n = typeof t === 'string' ? (/^\d+$/.test(t) ? Number(t) : NaN) : t;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < minimo) return INVALIDO;
  return n;
}

// Una tabla y su error: al menos un escalon, umbral entero >= 0, cantidad entera
// >= 1, unidad del catalogo y umbrales de menor a mayor sin repetir (el orden del
// panel es el de la tabla; "reordenar" es como se corrige).
function validarTabla(lista, nombre) {
  if (!Array.isArray(lista) || lista.length === 0) {
    return { error: `La tabla de ${nombre} necesita al menos un escalon` };
  }
  const escalones = [];
  for (let i = 0; i < lista.length; i++) {
    const e = lista[i] || {};
    const desde = entero(e.desde, 0);
    if (desde === INVALIDO) return { error: `Tabla de ${nombre}, escalon ${i + 1}: el umbral de piezas debe ser un entero de 0 en adelante` };
    const cantidad = entero(e.cantidad, 1);
    if (cantidad === INVALIDO) return { error: `Tabla de ${nombre}, escalon ${i + 1}: la cantidad debe ser un entero de 1 en adelante` };
    const unidad = texto(e.unidad);
    if (!UNIDADES_PLAZO.includes(unidad)) return { error: `Tabla de ${nombre}, escalon ${i + 1}: la unidad debe ser dias o semanas` };
    if (escalones.length && desde <= escalones[escalones.length - 1].desde) {
      return { error: `Tabla de ${nombre}: los umbrales deben ir de menor a mayor, sin repetir` };
    }
    escalones.push({ desde, cantidad, unidad });
  }
  return { escalones };
}

// La MISMA regla la usan el panel /admin (avisa antes de guardar) y el PUT de
// /api/admin/condiciones (rechaza con 400 antes de guardar).
export function validarCondiciones(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Formato invalido: se esperaban las condiciones comerciales' };
  }
  const condiciones = {};
  for (const [campo, nombre] of TEXTOS) {
    const t = texto(body[campo]);
    if (!t) return { error: `El texto de ${nombre} no puede quedar vacio` };
    condiciones[campo] = t;
  }
  for (const [campo, nombre] of TABLAS) {
    const { escalones, error } = validarTabla(body[campo], nombre);
    if (error) return { error };
    condiciones[campo] = escalones;
  }
  return { condiciones };
}

// Lo que rige hoy. Un campo guardado que ya no se entiende (o que falta) cae a la
// semilla en vez de dejar la cotizacion sin condicion o sin tiempo de produccion.
export function condicionesComerciales(config) {
  const guardadas = config?.condicionesComerciales;
  const base = guardadas && typeof guardadas === 'object' ? guardadas : {};
  const c = {};
  for (const [campo] of TEXTOS) c[campo] = texto(base[campo]) || SEMILLA[campo];
  for (const [campo, nombre] of TABLAS) {
    const { escalones } = validarTabla(base[campo], nombre);
    c[campo] = escalones || SEMILLA[campo].map(e => ({ ...e }));
  }
  return c;
}

// Nota de precios y envio (issue #436, decision de Adrian 2026-09-23), con los
// textos del panel desde #324: con envio con costo la cotizacion lleva su partida
// de flete, asi que el "sin envio" se contradice; el texto de precios se queda y
// la linea del flete no se toca nunca.
export function notaPreciosEnvio(conEnvio, condiciones = SEMILLA) {
  const base = `- ${condiciones.precios}`;
  return conEnvio ? base : `${base} ${condiciones.sinEnvio}`;
}

// Solo se reemplaza la linea si coincide con una de las dos versiones
// auto-generadas; editada o borrada a mano se respeta (contrato de #90).
export function aplicarNotaEnvio(notasText, conEnvio, condiciones = SEMILLA) {
  const auto = [notaPreciosEnvio(false, condiciones), notaPreciosEnvio(true, condiciones)];
  return reemplazarLineaAuto(notasText, auto, notaPreciosEnvio(conEnvio, condiciones));
}

// Todas las lineas que las dos tablas pueden producir: es lo que distingue la
// linea derivada de una edicion del vendedor. La linea vieja ("Tiempo de
// entrega", antes de #324) no esta aqui a proposito: la cotizacion cargada que la
// trae conserva el texto con el que se genero.
function lineasAutoTiempo(condiciones) {
  const lineas = [];
  for (const tabla of [condiciones.tiempoProduccion, condiciones.tiempoProduccionCalca]) {
    for (const e of tabla || []) {
      lineas.push(notaTiempoProduccion({ tiempoProduccion: [e], tiempoProduccionCalca: [e] }, { items: [] }));
    }
  }
  return lineas;
}

function reemplazarLineaAuto(notasText, auto, nueva) {
  const lineas = (notasText || '').split('\n');
  const idx = lineas.findIndex(l => auto.includes(l.trim()));
  if (idx === -1) return notasText;
  lineas[idx] = nueva;
  return lineas.join('\n');
}

// Re-deriva SOLO la linea del Tiempo de produccion (piezas, calca o marca de
// decorado cambiaron) sin tocar el resto de las notas.
export function aplicarNotaTiempoProduccion(notasText, condiciones, { items, decorado } = {}) {
  return reemplazarLineaAuto(notasText, lineasAutoTiempo(condiciones), notaTiempoProduccion(condiciones, { items, decorado }));
}

// Las notas con las que arranca una cotizacion: las condiciones del panel, en el
// orden en que el formulario siempre las presento.
export function notasPorOmision(condiciones, { items, decorado, conEnvio } = {}) {
  return [
    notaPreciosEnvio(!!conEnvio, condiciones),
    `- ${condiciones.flete}`,
    notaTiempoProduccion(condiciones, { items, decorado }),
    `- ${condiciones.anticipo}`,
    `- ${condiciones.saldo}`,
  ].join('\n');
}
