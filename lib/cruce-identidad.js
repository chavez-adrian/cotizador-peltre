// Reusa la normalizacion de nombre de la deduplicacion de clientes (ADR-0001):
// minusculas, sin acentos, sin articulos/preposiciones/sufijos corporativos. Es
// un modulo PURO, sin IO, como este.
import { normalizarNombre } from './deduplicacion.js';
// Misma llave de identidad de prospecto que el store y el indice de #42.
import { ultimos10 } from './telefono-llave.js';

// Marcas Unicode INVISIBLES que llegan pegadas a un telefono capturado desde
// WhatsApp/iOS (medicion #118, 2026-08-01): U+202A LEFT-TO-RIGHT EMBEDDING y sus
// parientes (bidi, isolates, zero-width, BOM). No se ven en pantalla, pero viajan
// en el dato: un numero "igual" al de otro registro deja de serlo en una
// comparacion textual, y el numero se guarda sucio para siempre.
const INVISIBLES = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

// Limpieza de telefono para GUARDAR (no solo para comparar, #123): quita las
// marcas invisibles, convierte el espacio duro (U+00A0) en espacio normal,
// colapsa espacios y recorta. Conserva el formato legible (+, parentesis,
// guiones) porque el dato guardado lo lee un humano; la normalizacion a digitos
// es otra funcion (telefonosNormalizados) y NO debe reemplazar a esta.
export function limpiarTelefonoParaGuardar(raw) {
  if (raw == null) return '';
  return String(raw)
    .replace(INVISIBLES, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Un campo de telefono del catalogo trae MAS de un numero mas seguido de lo que
// parece ("5551234567 / 5559876543", "55 1234 5678, 55 8765 4321"). Se separan
// por marcas explicitas, por dos o mas espacios y por el '+' que abre otro
// numero; el caso sin separador visible ("5551234567 5559876543", que al quitar
// los espacios queda como un solo bloque) se parte SOLO cuando el bloque es
// multiplo exacto de 10 digitos -- adivinar el corte en cualquier otro largo
// inventaria numeros que no existen.
const SEPARADORES = /\s*[,;/|]\s*|[\n\r]+|\s+y\s+|\s{2,}|\s(?=\+)/;

// Piso de 8 digitos: por debajo no es un telefono, es una extension ("ext.123",
// ",116") o basura de captura. Mismo recorte de extension que ultimos10.
const MIN_DIGITOS = 8;

function digitosDe(texto) {
  return String(texto).split(/ext/i)[0].replace(/\D/g, '');
}

function partirBloque(digitos) {
  if (digitos.length >= 20 && digitos.length % 10 === 0) {
    const partes = [];
    for (let i = 0; i < digitos.length; i += 10) partes.push(digitos.slice(i, i + 10));
    return partes;
  }
  return [digitos];
}

// NORMALIZACION AMPLIA de telefono (#123), la de CRUZAR catalogos -- distinta de
// ultimos10 (lib/telefono-llave.js), que es la llave de IDENTIDAD del prospecto y
// se conserva intacta. Devuelve un numero por cada telefono encontrado en el
// campo, con dos llaves:
//   llave10: los ultimos 10 digitos (numero nacional). Absorbe +52 / 52 / 521 /
//            01 / 044 / 045 sin listarlos: el prefijo queda fuera de la ventana.
//            Es la MISMA llave que ultimos10 para los formatos de 10+ digitos.
//   llave8:  los ultimos 8 digitos. Sirve cuando la LADA se capturo distinta (o
//            no se capturo): "9 8317 7005" contra "+56 9 8317 7005" no coinciden
//            por llave10 pero si por llave8. Es una senal mas debil a proposito
//            (ver coincidenTelefonos).
export function telefonosNormalizados(raw) {
  const limpio = limpiarTelefonoParaGuardar(raw);
  if (limpio === '') return [];
  const vistos = new Set();
  const salida = [];
  for (const trozo of limpio.split(SEPARADORES)) {
    if (!trozo) continue;
    for (const digitos of partirBloque(digitosDe(trozo))) {
      if (digitos.length < MIN_DIGITOS) continue;
      const llave10 = digitos.length >= 10 ? digitos.slice(-10) : null;
      const llave8 = digitos.slice(-8);
      const clave = llave10 || digitos;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      salida.push({ digitos, llave10, llave8 });
    }
  }
  return salida;
}

// Compara DOS campos de telefono (cada uno puede traer varios numeros) y devuelve
// la senal mas fuerte que los liga, o null:
//   'llave10' -> mismo numero nacional. Es la coincidencia que vale como identidad.
//   'sufijo8' -> mismos ultimos 8 digitos con llave10 distinta: la lada se
//                capturo distinta o falta. Se devuelve APARTE para que el caller
//                decida cuanto pesa (aqui pesa menos que llave10, ver SENALES).
export function coincidenTelefonos(a, b) {
  const as = telefonosNormalizados(a);
  const bs = telefonosNormalizados(b);
  let sufijo = null;
  for (const x of as) {
    for (const y of bs) {
      if (x.llave10 && y.llave10 && x.llave10 === y.llave10) return 'llave10';
      if (x.llave8 && y.llave8 && x.llave8 === y.llave8) sufijo = 'sufijo8';
    }
  }
  return sufijo;
}

// Palabras de GIRO comercial: aparecen en decenas de razones sociales sin
// relacion entre si ("GRUPO ...", "OPERADORA ...", "Mostrador digital" -- el
// contacto generico que la medicion #118 vio repetido en cotizaciones de
// clientes distintos). No son identidad de nadie, asi que se descartan ANTES de
// contar coincidencias: sin esto, dos clientes cualesquiera "coinciden".
const GENERICOS_COMERCIALES = new Set([
  'grupo', 'grupos', 'hotel', 'hoteles', 'hotelera', 'hotelero', 'comercial',
  'comercializadora', 'comercio', 'servicios', 'servicio', 'restaurante',
  'restaurantes', 'restaurantera', 'restaurantero', 'distribuidora',
  'distribuciones', 'alimentos', 'corporativo', 'corporacion', 'empresa',
  'compania', 'mexico', 'mexicana', 'mexicano', 'sociedad', 'industrias',
  'industrial', 'operadora', 'operador', 'tienda', 'tiendas', 'boutique',
  'cocina', 'casa', 'digital', 'digitales', 'mostrador', 'nacional',
  'internacional', 'negocios', 'proyectos', 'soluciones', 'general', 'publico',
  'cliente', 'contacto', 'gastronomico', 'gastronomica', 'gastronomia',
]);

// Un token de 6+ letras compartido basta como identidad (marca de una sola
// palabra o apellido poco comun: "Obasan", "Rabago"). Por debajo hacen falta dos:
// un nombre de pila corto compartido ("Ana") liga a cualquiera.
const MIN_TOKEN_DISTINTIVO = 6;

function tokensPropios(nombre) {
  return normalizarNombre(nombre)
    .filter(t => t.length > 2)
    .filter(t => !GENERICOS_COMERCIALES.has(t));
}

// Identidad por NOMBRE entre dos textos cualesquiera (contacto del quote contra
// razon social / nombre corto / contacto del catalogo). Devuelve booleano: es una
// senal binaria, el matiz lo aporta el telefono en el resultado del cruce.
export function coincidenNombres(a, b) {
  const ta = tokensPropios(a);
  const tb = new Set(tokensPropios(b));
  const comunes = ta.filter(t => tb.has(t));
  if (comunes.length >= 2) return true;
  return comunes.length === 1 && comunes[0].length >= MIN_TOKEN_DISTINTIVO;
}

// ---------------------------------------------------------------------------
// CLASIFICACION DEL CANDIDATO (#118/#119, medicion del 2026-08-01)
// ---------------------------------------------------------------------------

// Categorias EXPLICITAS. Nunca se comparan por prefijo ni por substring: el
// reporte de la medicion contaba cotizaciones vivas como cerradas porque
// 'sin-senal'.startsWith('si') es true. Quien consuma este modulo compara contra
// estas constantes, y CATEGORIAS es la lista cerrada de valores posibles.
export const CERRO = 'cerro';
export const COMPRO_OTRA_COSA = 'compro-otra-cosa';
export const SIN_SENAL = 'sin-senal';
export const CATEGORIAS = Object.freeze([CERRO, COMPRO_OTRA_COSA, SIN_SENAL]);

// Banda de monto (#123). Cuando un quote se convirtio DE VERDAD en pedido, el
// monto coincide casi exacto (0% de diferencia en 10 de 11 casos con verdad
// conocida en la medicion), asi que +-15% (ver difMonto para el denominador) es
// generoso a proposito. El caso que fija el otro extremo: $32,732 cotizados contra un
// pedido de $421 del mismo contacto -- ya es cliente, pero la cotizacion grande
// puede seguir viva.
export const BANDA_MONTO = 0.15;

// Causalidad (misma regla que la heuristica de variante cerrada del backfill,
// #76): primero se cotiza y luego se autoriza, asi que un pedido ANTERIOR al
// quote no lo cierra. La gracia corta absorbe el desfase de captura (el pedido
// se registra el dia que se autorizo por telefono, antes de documentar la
// cotizacion). Hacia adelante NO hay horizonte por default: el lote historico
// abarca 18 meses y un cierre tardio sigue siendo cierre; el caller puede acotar
// con ventanaDias.
export const GRACIA_DIAS = 3;

// Campos que Operam HEREDA del quote al pedido convertido (verificado en la
// medicion). Estan aqui para que quede escrito por que el cruce NO los lee del
// pedido: son copia del quote, asi que compararlos contra el quote confirma
// siempre y produce una tasa de deteccion inflada. La identidad se cruza contra
// el CATALOGO de clientes (razon social, nombre corto, contactos y sucursales),
// que es dato independiente. Con el cruce estricto el recall honesto es 67%.
export const CAMPOS_HEREDADOS_DEL_QUOTE = Object.freeze([
  'deliver_to', 'contact_phone', 'contact_email', 'delivery_address', 'customer_ref',
]);

const MS_POR_DIA = 86400000;

function fechaMs(v) {
  if (v == null || v === '') return null;
  const t = Date.parse(String(v).slice(0, 10));
  return Number.isFinite(t) ? t : null;
}

function numeroONull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mismoId(a, b) {
  if (a == null || a === '' || b == null || b === '') return false;
  return String(a) === String(b);
}

// Identidad que aporta el QUOTE: el contacto de entrega y la referencia del
// cliente (el "proyecto") como nombres, y el telefono de contacto. Son datos que
// captura el vendedor, no el pedido.
function identidadDeQuote(quote) {
  const q = quote || {};
  return {
    nombres: [q.deliver_to, q.cust_ref, q.customer_ref],
    telefonos: [q.contact_phone, q.phone],
  };
}

// Identidad que aporta el CATALOGO de clientes. Los telefonos NO viven en el
// cliente sino repartidos entre contactos y sucursales (issue #42): hay que
// mirar los tres niveles o la liga se pierde.
function identidadDeCliente(cliente) {
  const c = cliente || {};
  const nombres = [c.CustName, c.cust_name, c.cust_ref];
  const telefonos = [c.phone];
  for (const ct of c.contacts || []) {
    nombres.push(ct && ct.name, ct && ct.name2);
    telefonos.push(ct && ct.phone, ct && ct.phone2);
  }
  for (const b of c.branches || []) {
    nombres.push(b && b.br_name);
    telefonos.push(b && b.phone);
  }
  return { nombres, telefonos };
}

// Peso de cada senal para elegir ENTRE clientes candidatos. El telefono exacto
// manda sobre el nombre: un homonimo es mas frecuente que un numero repetido.
// (El CORREO no participa: la definicion de identidad de #123 son nombres y
// telefonos del cliente, sus contactos y sus sucursales. Si mas adelante se
// quiere sumar, es una senal nueva con su propia calibracion, no un ajuste.)
const PESO = { llave10: 3, sufijo8: 2, tokens: 1 };

function senalesDeIdentidad(quote, cliente) {
  const q = identidadDeQuote(quote);
  const c = identidadDeCliente(cliente);
  const senales = [];
  let mejorTelefono = null;
  for (const tq of q.telefonos) {
    for (const tc of c.telefonos) {
      const fuerza = coincidenTelefonos(tq, tc);
      if (!fuerza) continue;
      if (!mejorTelefono || PESO[fuerza] > PESO[mejorTelefono.fuerza]) {
        mejorTelefono = { tipo: 'telefono', fuerza, valor: limpiarTelefonoParaGuardar(tq) };
      }
    }
  }
  if (mejorTelefono) senales.push(mejorTelefono);
  for (const nq of q.nombres) {
    const nc = c.nombres.find(n => coincidenNombres(nq, n));
    if (nc) {
      senales.push({ tipo: 'nombre', fuerza: 'tokens', valor: String(nq).trim() });
      break;
    }
  }
  return senales;
}

function puntaje(senales) {
  return senales.reduce((acc, s) => acc + (PESO[s.fuerza] || 0), 0);
}

// El cliente del catalogo que corresponde a la identidad del quote, o null.
// Gana el de mayor puntaje; a igualdad, el primero del catalogo (orden estable).
export function buscarClientePorIdentidad(quote, clientes) {
  let mejor = null;
  for (const cliente of clientes || []) {
    if (!cliente) continue;
    const senales = senalesDeIdentidad(quote, cliente);
    if (senales.length === 0) continue;
    const p = puntaje(senales);
    if (!mejor || p > mejor.puntaje) mejor = { cliente, senales, puntaje: p };
  }
  return mejor ? { cliente: mejor.cliente, senales: mejor.senales } : null;
}

function clienteResumen(cliente) {
  return {
    customer_id: cliente.customer_id != null ? cliente.customer_id : cliente.debtor_no,
    cust_name: cliente.CustName || cliente.cust_name || '',
  };
}

function pedidoResumen(pedido) {
  return {
    order_no: pedido.order_no != null ? pedido.order_no : null,
    ord_date: pedido.ord_date || null,
    total: numeroONull(pedido.total),
  };
}

// Pedidos del cliente identificado que PUEDEN cerrar este quote: mismo debtor y
// posteriores al quote (con la gracia). Los campos heredados del pedido no se
// leen aqui ni en ningun otro lado (ver CAMPOS_HEREDADOS_DEL_QUOTE).
function pedidosAtribuibles(quote, cliente, pedidos, { graciaDias, ventanaDias }) {
  const idCliente = cliente.customer_id != null ? cliente.customer_id : cliente.debtor_no;
  const fechaQuote = fechaMs((quote || {}).ord_date);
  return (pedidos || []).filter(p => {
    if (!p || !mismoId(p.debtor_no, idCliente)) return false;
    const fechaPedido = fechaMs(p.ord_date);
    if (fechaQuote == null || fechaPedido == null) return true;
    const delta = fechaPedido - fechaQuote;
    if (delta < -graciaDias * MS_POR_DIA) return false;
    if (ventanaDias != null && delta > ventanaDias * MS_POR_DIA) return false;
    return true;
  });
}

// Diferencia relativa al monto MAYOR entre cotizacion y pedido -- es la que
// reporto la medicion (columna dif_monto_pct) y la misma eleccion de denominador
// que la heuristica de variante cerrada del backfill (#76): cuando el pedido
// crece por encima de lo cotizado (se autorizo mas de lo que se pidio), dividir
// entre el monto cotizado sobrestima la diferencia y pierde el cierre. Un pedido
// de $0 (muestra/cortesia) o un quote sin monto no producen diferencia
// comparable: null, y sin diferencia no hay cierre.
function difMonto(totalQuote, totalPedido) {
  if (totalQuote == null || totalQuote <= 0) return null;
  if (totalPedido == null || totalPedido <= 0) return null;
  return Math.abs(totalPedido - totalQuote) / Math.max(totalQuote, totalPedido);
}

function porcentaje(dif) {
  return dif == null ? null : Number((dif * 100).toFixed(1));
}

// Cruce por IDENTIDAD de un quote contra los catalogos YA LEIDOS (#123). Sin IO:
// clientes, pedidos y prospectos entran por parametro; el caller (#124, #119)
// decide como los lee y los cachea.
//
//   { categoria, cliente, senales, pedido, difMontoPct, duplicadoProspecto }
//
//   categoria           una de CATEGORIAS (comparar por igualdad, nunca prefijo)
//   cliente             { customer_id, cust_name } del catalogo, o null
//   senales             evidencia de la identidad: [{ tipo, fuerza, valor }]
//   pedido              { order_no, ord_date, total } que sustenta el veredicto,
//                       o null si el cliente identificado no tiene pedido
//                       atribuible
//   difMontoPct         diferencia de monto en por ciento (una decimal, sobre el
//                       monto mayor: ver difMonto); null si no hay monto
//                       comparable
//   duplicadoProspecto  aviso para la bandeja (#122): el celular del quote ya es
//                       un prospecto (ver posibleDuplicadoProspecto)
//
// CERRO exige identidad Y un pedido dentro de la banda. Identidad sin pedido en
// banda (o sin pedido) es COMPRO_OTRA_COSA: el contacto ya es cliente, pero
// nada indica que ESTA cotizacion se haya cerrado, asi que puede seguir viva.
// Sin identidad no hay nada que atribuir -> SIN_SENAL.
export function cruzarIdentidad({ quote, clientes, pedidos, prospectos } = {}, opts = {}) {
  const { banda = BANDA_MONTO, graciaDias = GRACIA_DIAS, ventanaDias = null } = opts;
  const duplicadoProspecto = posibleDuplicadoProspecto(quote, prospectos);
  const match = buscarClientePorIdentidad(quote, clientes);
  if (!match) {
    return { categoria: SIN_SENAL, cliente: null, senales: [], pedido: null, difMontoPct: null, duplicadoProspecto };
  }

  const totalQuote = numeroONull((quote || {}).total);
  const candidatos = pedidosAtribuibles(quote, match.cliente, pedidos, { graciaDias, ventanaDias })
    .map(p => ({ pedido: p, dif: difMonto(totalQuote, numeroONull(p.total)) }));
  // Mejor evidencia: el pedido de monto mas parecido; sin monto comparable, el
  // primero en el tiempo (el mas cercano a la cotizacion).
  candidatos.sort((a, b) => {
    if (a.dif != null && b.dif != null && a.dif !== b.dif) return a.dif - b.dif;
    if (a.dif != null && b.dif == null) return -1;
    if (a.dif == null && b.dif != null) return 1;
    return (fechaMs(a.pedido.ord_date) || 0) - (fechaMs(b.pedido.ord_date) || 0);
  });
  const mejor = candidatos[0] || null;
  const enBanda = mejor && mejor.dif != null && mejor.dif <= banda;

  return {
    categoria: enBanda ? CERRO : COMPRO_OTRA_COSA,
    cliente: clienteResumen(match.cliente),
    senales: match.senales,
    pedido: mejor ? pedidoResumen(mejor.pedido) : null,
    difMontoPct: mejor ? porcentaje(mejor.dif) : null,
    duplicadoProspecto,
  };
}

// Aviso de POSIBLE DUPLICADO para la bandeja de revision (#122): el celular del
// quote ya pertenece a un prospecto. La identidad de prospecto es "1 celular = 1
// prospecto" por los ultimos 10 digitos (ultimos10), asi que aqui NO aplica el
// rescate por sufijo de 8: para reconocer a un cliente vale la pena arriesgar
// una lada mal capturada, para declarar duplicado a un prospecto no. Devuelve el
// primer prospecto que coincide, o null.
export function posibleDuplicadoProspecto(quote, prospectos) {
  const llaves = new Set(
    identidadDeQuote(quote).telefonos
      .flatMap(t => telefonosNormalizados(t))
      .map(t => t.llave10)
      .filter(Boolean)
  );
  if (llaves.size === 0) return null;
  for (const p of prospectos || []) {
    if (!p) continue;
    const llave = p.celular10 || ultimos10(p.celular);
    if (llave && llaves.has(llave)) return { id: p.id, nombre: p.nombre || '', celular10: llave };
  }
  return null;
}
