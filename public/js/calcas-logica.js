// Logica pura de la calca en el carrito (issue #91, CONTEXT.md "Calca",
// ADR-0010). Modulo sin efectos de navegador: lo consumen app.js (import
// nativo), lib/calcular-envio.js (cross-import server->public, mismo patron que
// decorados-logica.js) y calcas-logica.test.cjs.

// Familia de calcas genericas del selector: CAL + tintas (1-8) + tamano en cm2.
// El sufijo S es la migracion de unidad Actividad -> Servicio (#120): del par
// manda una sola variante y el catalogo ya la resolvio, asi que aqui solo se
// tolera. Las CAL00xx (marca/artistas) NO son de este selector.
const CODIGO_CALCA = 'CAL[1-9]\\d{3}S?';
const RE_CALCA = new RegExp(`^${CODIGO_CALCA}$`);

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

// El texto del rotulo, en un solo lugar: viaja en el `name` de la entrada del
// carrito y de ahi lo heredan la descripcion por omision, la linea del carrito,
// el documento y el quote (#220).
function etiquetaDiseno(numero) {
  return `Diseño ${numero}`;
}

// La identidad de una partida de calca es el DISENO, no el codigo (#218/#220):
// dos diseños del mismo tamaño y tintas son dos partidas con el mismo precio.
// La llave del carrito los separa; el codigo del catalogo sigue siendo el que
// se serializa, para que nada de lo que pregunta esCodigoCalca(codigo) cambie.
// Solo alfanumericos y un guion: la llave viaja por atributos HTML y por
// onclick inline (trampa #112).
export function llaveDiseno(codigo, numero) {
  return `${codigo}-${numero}`;
}

// Sobre el MISMO cuerpo que RE_CALCA: la familia de codigos se define una vez.
const RE_LLAVE_DISENO = new RegExp(`^(${CODIGO_CALCA})-\\d+$`);

// Inversa de llaveDiseno. Lo que no es llave de diseño se devuelve tal cual:
// asi el mismo camino sirve para las lineas de producto y para una calca de una
// cotizacion anterior a #220, guardada con el codigo como llave.
export function codigoDeLlave(llave) {
  const m = RE_LLAVE_DISENO.exec(String(llave || ''));
  return m ? m[1] : llave;
}

// Maximo historico + 1, nunca el conteo de lineas vivas: borrar el Diseño 1 de
// dos no libera el numero, porque una descripcion ya editada que dice "Diseño 2"
// quedaria mintiendo. Un item sin `diseno` (cotizacion anterior) es el Diseño 1.
// El carrito vivo no basta para el historico -- borrar el diseño MAS ALTO lo
// dejaria fuera --, asi que quien numera lleva aparte lo ya asignado y lo pasa
// en `maximoAsignado`.
export function siguienteNumeroDiseno(items, maximoAsignado = 0) {
  let max = Number(maximoAsignado) || 0;
  for (const i of items || []) {
    if (!esCodigoCalca(i.codigo)) continue;
    const n = Number(i.diseno) || 1;
    if (n > max) max = n;
  }
  return max + 1;
}

// Entrada de carrito para una calca. `esCalca` es la marca que el resto del
// flujo mira para no contar sus piezas como volumen. Sin weight_kg a proposito:
// la calca va aplicada sobre la pieza, no ocupa caja ni pesa aparte. El numero
// de diseño va en la llave (identidad de la linea) y en el nombre (lo que ve el
// cliente); el codigo del catalogo se queda en `model`.
export function productoCalca(ficha, numeroDiseno = 1) {
  const n = Number(numeroDiseno) || 1;
  return {
    key: llaveDiseno(ficha.code, n),
    name: `${ficha.name} - ${etiquetaDiseno(n)}`,
    model: ficha.code,
    prices: ficha.prices,
    esCalca: true,
    diseno: n,
  };
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

// Piso de 100 piezas POR PARTIDA (issue #98/#152; supersede el umbral de #91
// atado al volumen de producto -- ver CONTEXT.md "Calca"). Es una correccion
// de captura, no un invariante sostenido del carrito: una linea con 100 o mas
// se cotiza tal cual; abajo de 100 se sube sola a 100, porque es el minimo
// real que el proveedor imprime por diseno. Dos disenos de 60 piezas facturan
// 100 + 100, no 120: el piso es por diseno, nunca por el total de calcas.
// 0 sigue siendo 0 (sin partida) -- el piso no crea una linea de la nada.
export function cantidadFacturableCalca(cantidadCapturada) {
  const c = cantidadCapturada || 0;
  return c > 0 ? Math.max(c, PIEZAS_MINIMAS_CALCA) : 0;
}

export function avisoClampCalca() {
  return `El proveedor imprime minimo ${PIEZAS_MINIMAS_CALCA} calcas por diseno; se cotizan ${PIEZAS_MINIMAS_CALCA}.`;
}

// La calca no tiene Menudeo (#91): cuando la lista vigente de la cotizacion
// cae en Menudeo, la calca se cobra con M100, la primera lista donde existe
// (#98/#152). Con cualquier lista pagada, la calca hereda esa misma lista.
export function tierIdParaCalca(tierId) {
  return tierId === 'Menudeo' ? 'M100' : tierId;
}

// Unico motivo que queda para invalidar el carrito con calca: el piso de 100
// (#152) ya no depende del volumen de producto, asi que ese motivo
// desaparecio. Lo que sobrevive es que una calca puede quedarse sin precio en
// un tier PAGADO (a CAL1025S le faltaba la fila M350 en Operam, ver la
// investigacion de #91): ahi el `?? 0` de getPrice la mandaria a $0 al
// documento y al quote sin que nadie lo frene. Se compara por IGUALDAD contra
// esta constante, nunca por prefijo (leccion del reporte de #118).
export const MOTIVOS_CALCA_INVALIDA = {
  SIN_PRECIO: 'sin-precio',
};

export function motivoCalcaInvalida({ hayCalca, calcaSinPrecio } = {}) {
  if (!hayCalca) return null;
  return calcaSinPrecio ? MOTIVOS_CALCA_INVALIDA.SIN_PRECIO : null;
}

// Compuerta de generacion, espejo de bloqueaGeneracionPorEnvioInvalidado (#89).
export function bloqueaGeneracionPorCalcaSinPrecio(carritoInvalido) {
  return !!carritoInvalido;
}

export function avisoCalcaInvalida() {
  return 'Hay una calca sin precio en la lista vigente de esta cotización. '
    + 'Quítala o corrige su precio en Operam: no se puede generar un documento con una partida sin precio.';
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
