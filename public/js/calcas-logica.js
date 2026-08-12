// Logica pura de la calca en el carrito (issue #91, CONTEXT.md "Calca",
// ADR-0010). Modulo sin efectos de navegador: lo consumen app.js (import
// nativo), lib/calcular-envio.js (cross-import server->public, mismo patron que
// decorados-logica.js) y calcas-logica.test.cjs.

// Familia de calcas genericas del selector: CAL + tintas (1-8) + tamano en cm2.
// El sufijo S es la migracion de unidad Actividad -> Servicio (#120): del par
// manda una sola variante y el catalogo ya la resolvio, asi que aqui solo se
// tolera. Las CAL00xx (marca/artistas) NO son de este selector.
const RE_CALCA = /^CAL[1-9]\d{3}S?$/;

export const PIEZAS_MINIMAS_CALCA = 100;

export const TAMANOS_CALCA = [
  { valor: '025', etiqueta: '25 cm²' },
  { valor: '050', etiqueta: '50 cm²' },
  { valor: '100', etiqueta: '100 cm²' },
  { valor: '200', etiqueta: '200 cm²' },
];

export const TINTAS_CALCA = [1, 2, 3, 4, 5, 6, 7, 8];

export function esCodigoCalca(codigo) {
  return RE_CALCA.test(String(codigo || ''));
}

// Codigo -> partes que el selector captura. Devuelve null para lo que no es una
// calca generica, para que un codigo desconocido nunca se lea como calca.
function partesCalca(codigo) {
  if (!esCodigoCalca(codigo)) return null;
  const c = String(codigo);
  return { tintas: parseInt(c.slice(3, 4), 10), tamano: c.slice(4, 7) };
}

// Tamano + tintas -> ficha del catalogo (data/precios.json.calcas). Se busca en
// el catalogo en vez de armar el codigo por concatenacion: un codigo inventado
// que Operam no tenga daria 406 "The item was not found" al subir el quote.
export function buscarCalcaEnCatalogo(calcas, { tamano, tintas } = {}) {
  const t = parseInt(tintas, 10);
  const encontrada = (calcas || []).find(c => {
    const partes = partesCalca(c && c.code);
    return partes && partes.tamano === tamano && partes.tintas === t;
  });
  return encontrada || null;
}

// Precio de la calca en el tier vigente. La calca NO tiene precio de menudeo
// (Menudeo viene null del catalogo), y la ausencia se devuelve como null
// EXPLICITO: getPrice() de app.js cae a `prices['Menudeo'] ?? 0`, asi que un 0
// aqui seria una calca regalada en el documento y en el quote.
export function precioCalca(ficha, tierId) {
  const p = ficha && ficha.prices ? ficha.prices[tierId] : null;
  return typeof p === 'number' && p > 0 ? p : null;
}

// Entrada de carrito para una calca. `esCalca` es la marca que el resto del
// flujo mira para no contar sus piezas como volumen. Sin weight_kg a proposito:
// la calca va aplicada sobre la pieza, no ocupa caja ni pesa aparte.
export function productoCalca(ficha) {
  return { key: ficha.code, name: ficha.name, model: ficha.code, prices: ficha.prices, esCalca: true };
}

// Volumen que fija el tier: SOLO piezas de producto (decision 2026-07-30). La
// calca hereda el tier para su precio pero no lo empuja; el envio tampoco es
// pieza.
export function piezasDeProducto(items) {
  let total = 0;
  for (const i of items || []) {
    if (i.codigo === 'ENVIO' || esCodigoCalca(i.codigo)) continue;
    total += i.cantidad || 0;
  }
  return total;
}

export function hayCalcaEnCarrito(items) {
  return (items || []).some(i => esCodigoCalca(i.codigo));
}

export function puedeAgregarCalca(piezasProducto) {
  return (piezasProducto || 0) >= PIEZAS_MINIMAS_CALCA;
}

// Motivos por los que un carrito con calca no puede generar documento. Se
// comparan por IGUALDAD contra estas constantes, nunca por prefijo (leccion del
// reporte de #118: 'sin-senal'.startsWith('si') conto vivos como cerrados).
export const MOTIVOS_CALCA_INVALIDA = {
  SIN_VOLUMEN: 'sin-volumen',
  SIN_PRECIO: 'sin-precio',
};

// El umbral es una condicion SOSTENIDA, no una validacion de captura (decision
// 2 del grilling): validar solo al agregar deja el agujero de agregar 150 tazas,
// agregar calcas y despues bajar a 60. Nada se revierte solo -- se marca el
// estado y se bloquea la generacion hasta que el vendedor lo resuelva.
//
// El volumen no es la unica causa. El umbral existe para no caer en Menudeo,
// pero una calca puede quedarse sin precio en un tier PAGADO (a CAL1025S le
// faltaba la fila M350 en Operam, ver la investigacion del issue): ahi el
// `?? 0` de getPrice la mandaria a $0 al documento y al quote sin que nadie lo
// frene. Volumen suficiente NO implica precio, asi que las dos causas invalidan.
// Con ambas presentes manda la del volumen: es la que el vendedor resuelve solo.
export function motivoCalcaInvalida({ piezasProducto, hayCalca, calcaSinPrecio } = {}) {
  if (!hayCalca) return null;
  if (!puedeAgregarCalca(piezasProducto)) return MOTIVOS_CALCA_INVALIDA.SIN_VOLUMEN;
  if (calcaSinPrecio) return MOTIVOS_CALCA_INVALIDA.SIN_PRECIO;
  return null;
}

export function carritoInvalidoPorCalca(estado) {
  return motivoCalcaInvalida(estado) !== null;
}

// Compuerta de generacion, espejo de bloqueaGeneracionPorEnvioInvalidado (#89).
export function bloqueaGeneracionPorCalcaSinVolumen(carritoInvalido) {
  return !!carritoInvalido;
}

export function avisoNoPuedeAgregarCalca(piezasProducto) {
  return `Las calcas se venden desde ${PIEZAS_MINIMAS_CALCA} piezas de producto. Llevas ${piezasProducto || 0}.`;
}

export function avisoCalcaInvalida(motivo, piezasProducto) {
  if (motivo === MOTIVOS_CALCA_INVALIDA.SIN_PRECIO) {
    return 'Hay una calca sin precio en la lista vigente de esta cotización. '
      + 'Quítala o corrige su precio en Operam: no se puede generar un documento con una partida sin precio.';
  }
  return `Llevas ${piezasProducto || 0} piezas de producto y el carrito tiene calcas. `
    + `Las calcas se venden desde ${PIEZAS_MINIMAS_CALCA} piezas: sube el producto o quita las calcas para poder generar.`;
}

// La linea describe la relacion sin juzgarla (decision 8): el pedido mixto (solo
// una parte lleva calca) y la doble calca sobre la misma pieza son ambos
// legitimos, asi que no hay aviso cuando los numeros diferen.
export function relacionCalcaProducto(cantidadCalca, piezasProducto) {
  return `${cantidadCalca} de ${piezasProducto} piezas`;
}

// La calca es piso, no techo (ADR-0010): con calca en el carrito la marca de
// decorado es true y no editable -- dejarla editable permitiria esquivar el gate
// de #61 justo donde mas importa. Sin calca la marca conserva su valor y vuelve
// a ser editable: quitar la calca no descarta el checklist, porque sus pasos son
// gestiones reales con el proveedor.
export function estadoMarcaDecorado({ hayCalca, marcaActual } = {}) {
  if (hayCalca) {
    return { valor: true, editable: false, motivo: 'Lo determina la calca del carrito. Entrega a 6 semanas.' };
  }
  if (marcaActual) {
    return { valor: true, editable: true, motivo: 'Marcado a mano (decorado sin línea de calca). Entrega a 6 semanas.' };
  }
  return { valor: false, editable: true, motivo: 'Sin decorado: entrega a 4 semanas.' };
}
