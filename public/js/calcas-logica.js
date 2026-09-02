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

// Precio manual de calca (#279, spec #278; CONTEXT.md "Precio manual de calca"):
// lo que el proveedor cotizo por ESE diseno, capturado a mano. Solo cuenta como
// captura un numero mayor que cero: vacio, cero, negativo o basura significan
// "sin captura", que es como se vacia el campo para regresar a la lista.
export function normalizarPrecioManual(valor) {
  // Solo numero o texto del input: un booleano o un objeto en el payload no es
  // captura, y Number(true) daria un precio de $1 salido de la nada.
  if (typeof valor !== 'number' && typeof valor !== 'string') return null;
  const n = Number(valor);
  return valor !== '' && Number.isFinite(n) && n > 0 ? n : null;
}

// Precio unitario de una partida de calca: el manual capturado manda sobre la
// lista, y sin captura queda la resolucion de siempre (precioCalca sobre el
// tier ya pasado por tierIdParaCalca). La ausencia sigue siendo null EXPLICITO
// y nunca 0 (#91): el manual agrega una fuente de precio, no un fallback a cero.
export function precioEfectivoCalca(ficha, tierId, precioManual) {
  const manual = normalizarPrecioManual(precioManual);
  return manual !== null ? manual : precioCalca(ficha, tierId);
}

// Se comparan por IGUALDAD contra estas constantes, nunca por prefijo (misma
// leccion de #118 que ya aplican MOTIVOS_CALCA_INVALIDA y MOTIVOS_TOPE_DISENOS).
// El motivo lo traduce a codigo HTTP quien valida: dato mal formado (400) vs
// falta de permiso (403); el nucleo puro no conoce HTTP.
export const MOTIVOS_PRECIO_MANUAL = {
  NO_CALCA: 'no-calca',
  INVALIDO: 'invalido',
  SIN_PERMISO: 'sin-permiso',
};

export const MENSAJE_SIN_PERMISO_PRECIO_CALCA = 'No tienes permiso para capturar el precio de una calca; pidelo al administrador.';
export const MENSAJE_PRECIO_MANUAL_NO_CALCA = 'El precio manual solo existe en las partidas de calca.';
export const MENSAJE_PRECIO_MANUAL_INVALIDO = 'El precio manual de la calca debe ser un numero mayor que cero.';

// Enforcement del servidor (#279), espejo de validarTierCotizacion: el permiso
// de capturar precio de proveedor lo hace valer el servidor, no la pantalla --
// esconder el input no frena un POST armado a mano. "Es calca" se decide por el
// CODIGO (esCodigoCalca) y no por una bandera del payload, que el cliente
// podria inventar. El orden importa: primero la forma del dato (partida
// equivocada, valor imposible) y luego el permiso, porque un payload mal
// formado no se vuelve valido por tener permiso.
export function validarPreciosManualesCalca(items, tienePermiso) {
  for (const i of items || []) {
    const crudo = i ? i.precioManual : undefined;
    if (crudo === null || crudo === undefined || crudo === '') continue;
    if (!esCodigoCalca(i.codigo)) {
      return { ok: false, motivo: MOTIVOS_PRECIO_MANUAL.NO_CALCA, mensaje: MENSAJE_PRECIO_MANUAL_NO_CALCA };
    }
    if (normalizarPrecioManual(crudo) === null) {
      return { ok: false, motivo: MOTIVOS_PRECIO_MANUAL.INVALIDO, mensaje: MENSAJE_PRECIO_MANUAL_INVALIDO };
    }
    if (!tienePermiso) {
      return { ok: false, motivo: MOTIVOS_PRECIO_MANUAL.SIN_PERMISO, mensaje: MENSAJE_SIN_PERMISO_PRECIO_CALCA };
    }
  }
  return { ok: true };
}

// Permiso de capturar el precio de una calca (#280, spec #278), espejo exacto
// de normalizarPuedeFijarLista/puedeFijarLista (tier-logica.js): basura,
// string o ausente degradan a false (sin permiso), nunca a permiso implicito.
// Vive aqui y no en tier-logica.js porque es el nucleo de calca, no de tier.
export function normalizarPuedePrecioCalca(valor) {
  return valor === true;
}

export function puedePrecioCalca(vendedor) {
  if (!vendedor) return false;
  if (vendedor.role === 'admin') return true;
  return normalizarPuedePrecioCalca(vendedor.puedePrecioCalca);
}

// Coherencia de lo que se persiste (#279): con precio manual valido, el precio
// de la linea ES el manual. El servidor no confia en que el cliente los haya
// mandado iguales -- el documento, el quote y la huella leen `precio`, asi que
// una divergencia ahi cotizaria el precio de lista con el manual guardado al
// lado. Se corre DESPUES de validar; una partida sin captura sale intacta y no
// gana la llave (igual que `descripcion`).
export function aplicarPrecioManualEnPartidas(items) {
  return (items || []).map(i => {
    if (!i || !esCodigoCalca(i.codigo)) return i;
    const manual = normalizarPrecioManual(i.precioManual);
    return manual === null ? i : { ...i, precio: manual, precioManual: manual };
  });
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

// Llave del carrito para un item PERSISTIDO (#221): la usan los dos caminos que
// rehidratan el carrito -- reabrir una cotizacion guardada y restaurar el
// borrador --, donde lo que hay es el codigo del catalogo y el numero de diseno,
// no el producto. Indexar por el codigo a secas fusionaba dos disenos en uno.
// Un item de calca sin `diseno` (guardado antes de #220) es el Diseno 1, y lo
// que no es calca conserva su codigo como llave, igual que siempre.
export function llaveCarrito(codigo, diseno) {
  return esCodigoCalca(codigo) ? llaveDiseno(codigo, Number(diseno) || 1) : codigo;
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

// Compuerta de AGREGAR (#281, rebanada 2): sin permiso, una calca sin fila en
// el tier vigente nunca llega al carrito -- identico a siempre, porque sin
// permiso no hay forma de capturarle un precio despues. Con permiso, agregarla
// es la UNICA forma de que exista una linea donde capturar el precio manual
// (CAL1025S sin M350 es el caso real): bloquear el agregar dejaria el ticket
// sin salida. Una calca que si tiene precio nunca se impide, con o sin permiso.
export function impideAgregarCalcaSinPrecio({ sinPrecio, tienePermiso } = {}) {
  return !!sinPrecio && !tienePermiso;
}

// Con permiso de precio manual (#279/#281), la salida sugerida incluye
// capturarlo en la linea; sin permiso el texto es el de siempre (#152), sin
// mencionar una salida que esa persona no puede usar.
export function avisoCalcaInvalida(tienePermiso) {
  const salida = tienePermiso
    ? 'Quítala, captura el precio manualmente en la línea o corrige el precio en Operam'
    : 'Quítala o corrige su precio en Operam';
  return `Hay una calca sin precio en la lista vigente de esta cotización. ${salida}: `
    + 'no se puede generar un documento con una partida sin precio.';
}

// La linea describe la relacion sin juzgarla (decision 8): el pedido mixto (solo
// una parte lleva calca) y la doble calca sobre la misma pieza son ambos
// legitimos, asi que no hay aviso cuando los numeros diferen.
export function relacionCalcaProducto(cantidadCalca, piezasProducto) {
  return `${cantidadCalca} de ${piezasProducto} piezas`;
}

// Tope de captura (#222, spec #218): a lo mas 2 disenos de calca por linea de
// producto. Es un freno contra errores de captura (clics repetidos, confusion),
// no una regla del producto -- nunca borra ni invalida disenos ya agregados,
// solo frena el momento de agregar uno nuevo. Constante en un solo punto de
// cambio: subirla a 3 no toca nada mas.
export const MAX_DISENOS_POR_LINEA_PRODUCTO = 2;

// Linea de producto = entrada del carrito que no es ENVIO ni calca (mismo
// criterio de exclusion que piezasDeProducto, pero contando LINEAS, no piezas):
// un paquete de N piezas cuenta 1. Con 0 lineas el tope es 0, lo que hace
// cumplir que no existe la cotizacion de solo calcas.
export function lineasDeProducto(items) {
  let total = 0;
  for (const i of items || []) {
    if (i.codigo === 'ENVIO' || esCodigoCalca(i.codigo)) continue;
    total += 1;
  }
  return total;
}

export function topeDisenos(lineasProducto) {
  return (Number(lineasProducto) || 0) * MAX_DISENOS_POR_LINEA_PRODUCTO;
}

// Se compara por IGUALDAD contra estas constantes, nunca por prefijo (leccion
// del reporte de #118, la misma que ya aplica MOTIVOS_CALCA_INVALIDA).
export const MOTIVOS_TOPE_DISENOS = {
  SIN_PRODUCTO: 'sin-producto',
  TOPE_ALCANZADO: 'tope-alcanzado',
};

export function puedeAgregarDiseno({ lineasProducto, disenosActuales } = {}) {
  const tope = topeDisenos(lineasProducto);
  if (tope === 0) return { ok: false, motivo: MOTIVOS_TOPE_DISENOS.SIN_PRODUCTO };
  if ((Number(disenosActuales) || 0) >= tope) return { ok: false, motivo: MOTIVOS_TOPE_DISENOS.TOPE_ALCANZADO };
  return { ok: true, motivo: null };
}

// Texto del motivo con los conteos, para que el vendedor sepa que hacer
// (agregar producto o quitar un diseno) sin adivinar.
export function avisoTopeDisenos(lineasProducto) {
  const lp = Number(lineasProducto) || 0;
  if (lp === 0) return 'Agrega un producto al carrito antes de agregar una calca.';
  const tope = topeDisenos(lp);
  const etiquetaLinea = lp === 1 ? 'linea' : 'lineas';
  return `Maximo ${MAX_DISENOS_POR_LINEA_PRODUCTO} disenos de calca por linea de producto: ${lp} ${etiquetaLinea} -> ${tope} disenos`;
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
