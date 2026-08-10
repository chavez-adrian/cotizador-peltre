import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { RFC_GENERICOS } from './deduplicacion.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Rangos de CP "zona metro" para clasificar el flete (issue #68). Se lee al cargar
// el modulo (como otros data files); ajustable sin tocar codigo. Si falta o esta
// mal formado, queda en [] -> todo CP cae a foraneo (el default seguro).
let RANGOS_ZONA_METRO = [];
try {
  const z = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'zona-metro.json'), 'utf8'));
  RANGOS_ZONA_METRO = z.rangos_local || [];
} catch { RANGOS_ZONA_METRO = []; }

// SKUs de flete de paqueteria en Operam (FedEx Ground). El carrier real (FedEx, DHL,
// UPS, Estafeta) va SOLO en stock_id_text; el stock_id es siempre uno de estos dos.
const FLETE_LOCAL = '251021001';   // FedEx Ground (zona metro)
const FLETE_FORANEO = '251021002'; // FedEx Ground Foraneo

let token = null;

async function getToken() {
  const r = await fetch(`${process.env.OPERAM_URL}/api/v3/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      company: '346',
      user: process.env.OPERAM_USER,
      pass: process.env.OPERAM_PASSWORD,
    }),
  });
  const data = await r.json();
  if (!data.token) throw new Error('Login Operam fallido');
  token = data.token;
}

// Backoff ante 429 (rate limit de Operam). El backfill (#76) y cualquier lectura en
// rafaga pueden disparar 429; sin esto la corrida truena. Reintenta con espera
// exponencial (base * 2^intento). El base es configurable para que los tests no
// esperen segundos reales (_setBackoff429Base).
let backoff429Base = 2000;
export function _setBackoff429Base(ms) { backoff429Base = ms; }
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// Throttle PROACTIVO ante rate-limit (#76). El backoff de arriba es REACTIVO: espera
// DESPUES de chocar con 429, pero el limite de Operam dura mas que la ventana de
// reintentos -> en rafaga (el backfill, ~800-1000 lecturas) el run truena igual. Un
// intervalo minimo entre llamadas evita DISPARAR el limite. Default 0 = la app normal
// no pacea; el script del backfill lo sube (_setMinInterval). Serializa incluso
// llamadas concurrentes reservando slots crecientes (nextSlot).
let minIntervalMs = 0;
let nextSlot = 0;
export function _setMinInterval(ms) { minIntervalMs = ms; nextSlot = 0; }
async function throttle() {
  if (minIntervalMs <= 0) return;
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + minIntervalMs;
  if (slot > now) await sleep(slot - now);
}

async function apiCall(method, endpoint, body, isRetry = false, intento429 = 0, intentoRed = 0) {
  if (!token) await getToken();
  if (!isRetry && intento429 === 0 && intentoRed === 0) await throttle();
  let r;
  try {
    r = await fetch(`${process.env.OPERAM_URL}${endpoint}`, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // Errores de red transitorios (ECONNRESET, socket hang up, ETIMEDOUT): el backfill y
    // el detector de cancelados hacen cientos de lecturas; una caida transitoria de la
    // conexion no debe tumbar toda la corrida. Reintenta con espera creciente y propaga
    // tras agotar los intentos (mismo patron que el backoff 429, pero para fallos de red).
    if (intentoRed < 4) {
      await sleep(1000 * Math.pow(2, intentoRed));
      return apiCall(method, endpoint, body, isRetry, intento429, intentoRed + 1);
    }
    throw err;
  }
  if (r.status === 401 && !isRetry) {
    token = null;
    await getToken();
    return apiCall(method, endpoint, body, true, intento429);
  }
  if (r.status === 429 && intento429 < 5) {
    await sleep(backoff429Base * Math.pow(2, intento429));
    return apiCall(method, endpoint, body, isRetry, intento429 + 1);
  }
  if (!r.ok) throw new Error(`Operam ${r.status}`);
  return r.json();
}

export async function buscarClientes(query, limit = 10) {
  try {
    const data = await apiCall('GET', `/api/v3/sales/customers?search=${encodeURIComponent(query)}&limit=${limit}`);
    return data.data || [];
  } catch (err) {
    // Operam responde 404 cuando la busqueda no tiene resultados (cliente nuevo):
    // no es un error sino una lista vacia. Evita el 503 al verificar duplicados.
    if (/Operam 404/.test(err.message)) return [];
    throw err;
  }
}

// Listado completo paginado. El listado trae inline contacts[] y branches[]
// (verificado contra produccion 2026-06-10) -- ~440 clientes en 5 requests.
export async function listarTodosClientes() {
  const limit = 100;
  let clientes = [];
  let total = Infinity;
  for (let skip = 0; skip < total; skip += limit) {
    const data = await apiCall('GET', `/api/v3/sales/customers?limit=${limit}&skip=${skip}`);
    total = data.total || 0;
    clientes = clientes.concat(data.data || []);
  }
  return clientes;
}

// Lecturas read-only para el sync post-venta (#62). Endpoints v3 confirmados
// contra el Postman de la API y en vivo (peltre-operam.md seccion 12). El mapeo
// de trans_type lo aplica lib/sync-operam.js (hechosDesdeOperam); aqui solo se
// leen las transacciones crudas.

// Transacciones de venta de un cliente (factura 10, nota credito 11, pago 12,
// remision 13, pedido 30...). GET /api/v3/sales/transactions. since_date y
// until_date son obligatorios en la API; el caller los provee (rango amplio).
export async function listarTransacciones({ rfc, customerId, filterType, desde, hasta, skip = 0, limit = 100 } = {}) {
  const qs = new URLSearchParams();
  qs.set('since_date', desde || '');
  qs.set('until_date', hasta || '');
  if (rfc) qs.set('customer_rfc', rfc);
  if (customerId != null) qs.set('customer_id', String(customerId));
  if (filterType != null && filterType !== '') qs.set('filterType', String(filterType));
  qs.set('skip', String(skip));
  qs.set('limit', String(limit));
  let data;
  try {
    data = await apiCall('GET', `/api/v3/sales/transactions?${qs.toString()}`);
  } catch (err) {
    // Operam responde 404 cuando el cliente no tiene transacciones en el rango: no es
    // un error sino una lista vacia (igual que buscarClientes). Sin esto el backfill
    // (#76) y el sync #62 truenan al toparse un cliente sin movimientos.
    if (/Operam 404/.test(err.message)) return [];
    throw err;
  }
  return data.data || [];
}

// Lecturas READ-ONLY del catalogo (#128, padre #120). Los tres volcados que alimentan
// el generador del catalogo: listas de precios, precios por articulo y maestro de
// articulos. Todo pasa por apiCall -> mismo auth con refresh, mismo backoff 429 y
// mismo throttle proactivo (_setMinInterval) que el resto de las lecturas.

// Paginas de 500: verificado en vivo el 2026-08-03 (prices_list ~2,010 filas e items
// ~1,603 salen en 5 y 4 lecturas). Se camina hasta agotar el `total` que reporta la
// API, y se corta tambien al recibir una pagina incompleta o vacia (guarda contra un
// total mal informado, que dejaria el ciclo girando). Si la API NO reporta total, la
// pagina corta es la unica condicion de corte: tomarlo como fin truncaria el volcado
// en la primera pagina llena, y un catalogo a medias es peor que uno que tarda.
const PAGINA_CATALOGO = 500;

async function volcarPaginado(ruta) {
  let filas = [];
  let total = Infinity;
  for (let skip = 0; skip < total; skip += PAGINA_CATALOGO) {
    const sep = ruta.includes('?') ? '&' : '?';
    const data = await apiCall('GET', `${ruta}${sep}limit=${PAGINA_CATALOGO}&skip=${skip}`);
    const pagina = data.data || [];
    filas = filas.concat(pagina);
    const declarado = Number(data.total);
    if (Number.isFinite(declarado) && declarado > 0) total = declarado;
    if (pagina.length < PAGINA_CATALOGO) break;
  }
  return filas;
}

// Listas de precios (sales_types) con su factor. showInactive es OBLIGATORIO para el
// catalogo: "Bazaar" (id 18) esta inactiva y aun asi tiene 461 filas vivas en
// prices_list -- sin ella esos precios quedan sin lista a la que pertenecer.
export async function listarSalesTypes({ showInactive = false } = {}) {
  return volcarPaginado(`/api/v3/sales/sales_types${showInactive ? '?show_inactive=1' : ''}`);
}

// Precios por articulo y lista (prices_list) completo. Cada fila trae stock_id,
// sales_type_id y price; el nucleo (lib/catalogo-operam.js) aplica las reglas.
export async function listarPreciosCompletos() {
  return volcarPaginado('/api/v3/sales/prices_list');
}

// Maestro de articulos (inventory/items) completo: es quien dice que stock_id EXISTE.
// Para el catalogo se pide CON inactivos (verificado 2026-08-10: 1680 vs 1603): un
// articulo inactivo esta en desuso, y sin verlo el reporte confunde "en desuso" con
// "borrado" (huerfanas) y con "nunca cargado" (faltantes) -- 66 de 69 huerfanas y 57
// de 76 faltantes eran inactivos.
export async function listarItemsCompletos({ showInactive = false } = {}) {
  return volcarPaginado(`/api/v3/inventory/items${showInactive ? '?show_inactive=1' : ''}`);
}

// Pedidos (Sales Orders, trans_type 30). GET /api/v3/sales/sales_orders. Cada
// pedido trae order_no (la llave de la cadena), debtor_no y total.
export async function listarPedidos({ debtorNo, desde, hasta, skip = 0, limit = 100 } = {}) {
  const qs = new URLSearchParams();
  if (debtorNo != null) qs.set('debtor_no', String(debtorNo));
  if (desde) qs.set('DateFrom', desde);
  if (hasta) qs.set('DateTo', hasta);
  qs.set('skip', String(skip));
  qs.set('limit', String(limit));
  let data;
  try {
    data = await apiCall('GET', `/api/v3/sales/sales_orders?${qs.toString()}`);
  } catch (err) {
    // 404 = el cliente no tiene pedidos en el rango -> lista vacia, no error.
    if (/Operam 404/.test(err.message)) return [];
    throw err;
  }
  return data.data || [];
}

// Cabecera de un quote por id (issue #76, backfill read-only). GET
// /api/v3/sales/quote/{id}. Devuelve el objeto cabecera (tolera envoltura `data`
// array o no, como el resto de la API v3). Trae ord_date, delivery_date (= el
// "Valido hasta" nativo), cust_ref, total (con IVA 16%), salesman y detalles[]
// (que el backfill NO procesa: solo cabecera). null si no existe.
export async function obtenerQuote(quoteId) {
  let data;
  try {
    data = await apiCall('GET', `/api/v3/sales/quote/${quoteId}`);
  } catch (err) {
    if (/Operam 404/.test(err.message)) return null;
    throw err;
  }
  if (Array.isArray(data?.data)) return data.data[0] || null;
  return data?.data || data || null;
}

// Detalle de un pedido (Sales Order) por order_no (issue #76). GET
// /api/v3/sales/sales_order/{order_no}. A diferencia del listado, trae detalles[] con
// qty_sent vs quantity por renglon -> permite saber si la entrega es TOTAL o PARCIAL
// (caso 6988: remision parcial + pagado no debe cerrarse). null si no existe (404).
export async function obtenerPedido(orderNo) {
  let data;
  try {
    data = await apiCall('GET', `/api/v3/sales/sales_order/${orderNo}`);
  } catch (err) {
    if (/Operam 404/.test(err.message)) return null;
    throw err;
  }
  if (Array.isArray(data?.data)) return data.data[0] || null;
  return data?.data || data || null;
}

// Cliente (debtor) por id (issue #76, backfill read-only). GET
// /api/v3/sales/customers/{id}. Devuelve el objeto cliente con CustName, tax_id
// (RFC), curr_code (moneda) y branches[]. null si no existe (404).
export async function obtenerCliente(customerId) {
  let data;
  try {
    data = await apiCall('GET', `/api/v3/sales/customers/${customerId}`);
  } catch (err) {
    if (/Operam 404/.test(err.message)) return null;
    throw err;
  }
  if (Array.isArray(data?.data)) return data.data[0] || null;
  return data?.data || data || null;
}

// Contactos a nivel cliente, con su tag de Operam (action: general/invoice/delivery,
// ver CONTEXT.md). Issue #99 (prefactor compartido con el slice de correos "invoices"):
// antes esta info NUNCA se exponia -- el paso Envio solo tenia el contacto plano del
// branch (contact_name/phone/email), y el buscador de clientes tomaba telefono/email
// "sueltos" del primer contacto sin decir de quien eran (server.js, /api/operam/clientes).
// Se descartan los contactos sin nombre NI telefono NI email (basura de Operam).
function mapearContactosCliente(cliente) {
  return (cliente?.contacts || [])
    .map(ct => ({
      tag: ct.action || ct.ref || '',
      nombre: ct.name || '',
      telefono: ct.phone || ct.phone2 || '',
      email: ct.email || '',
    }))
    .filter(c => c.nombre || c.telefono || c.email);
}

export async function obtenerDomicilios(customerId) {
  const data = await apiCall('GET', `/api/v3/sales/customers/${customerId}`);
  const cliente = Array.isArray(data.data) ? data.data[0] : data;
  const branches = cliente?.branches || [];
  const contacts = mapearContactosCliente(cliente);

  const results = await Promise.allSettled(
    branches.map(async (b) => {
      try {
        const bd = await apiCall('GET', `/api/v3/sales/branches/${b.branch_code}`);
        const d = bd.data?.[0] || {};
        return {
          descripcion: d.br_name || b.br_name || b.branch_ref || '',
          calle: [d.addr_street, d.addr_exterior].filter(Boolean).join(' Nº '),
          numInt: d.addr_interior || '',
          colonia: d.addr_colony || '',
          cp: d.addr_zip || '',
          municipio: d.addr_city || '',
          estado: d.addr_state || '',
          contacto: d.contact_name || b.contact_name || '',
          email: d.email || b.email || '',
          telefono: d.phone || b.phone || '',
        };
      } catch {
        return {
          descripcion: b.br_name || b.branch_ref || '',
          calle: '', numInt: '', colonia: '',
          cp: '', municipio: '', estado: '',
          contacto: b.contact_name || '', email: b.email || '', telefono: b.phone || '',
        };
      }
    })
  );

  const domicilios = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  return { domicilios, contacts };
}

// Suma 'dias' naturales a una fecha YYYY-MM-DD y devuelve YYYY-MM-DD (UTC, sin
// arrastre de zona horaria).
function sumarDias(fechaISO, dias) {
  const base = fechaISO ? new Date(`${fechaISO}T00:00:00Z`) : new Date();
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().split('T')[0];
}

// Clasifica un CP de entrega como zona metropolitana LOCAL (true) o foraneo
// (false) contra una lista de rangos inclusivos [desde, hasta] de CP de 5 digitos
// (issue #68). Comparacion lexicografica de strings de 5 digitos (equivale a la
// numerica porque todos tienen el mismo largo y solo digitos). CP ausente o no de
// 5 digitos -> foraneo por defecto (la decision segura: no asumir tarifa local).
export function esZonaMetroLocal(cp, rangos) {
  const s = String(cp ?? '').trim();
  if (!/^\d{5}$/.test(s)) return false;
  for (const [desde, hasta] of rangos || []) {
    if (s >= desde && s <= hasta) return true;
  }
  return false;
}

// Vigencia / "valido hasta": la cotizacion trae data.vigencia (= fecha + 30 dias
// calculado en el frontend). Si no viene, se deriva como OrderDate + 30 dias. Vive
// aparte porque el post-fix de la web legacy (#106) debe escribir EXACTAMENTE la misma
// fecha que se puso en comments al subir; derivarla dos veces invitaria a que difieran.
export function vigenciaDeCotizacion(data) {
  return data?.vigencia || sumarDias(fechaDeCotizacion(data), 30);
}

// Fecha de emision (OrderDate del quote). Una sola definicion para que la vigencia
// derivada y la fecha que se sube no puedan salir de dias distintos.
function fechaDeCotizacion(data) {
  return data?.fecha || new Date().toISOString().split('T')[0];
}

// Comments del quote (#107): las notas ya llegan puntuadas (el vendedor las captura
// como vinetas terminadas en punto), asi que unirlas con '. ' producia '..'. Se
// conserva la estructura original: una nota por linea con su vineta, y "Valido hasta"
// (unico carrier real de la vigencia, ver comentario arriba) en su propia linea -- sin
// agregar puntuacion nueva en ningun punto, por lo que nunca puede aparecer '..'.
// RIESGO HITL (#107): no esta comprobado que POST /api/v3/sales/quote conserve los '\n'
// en comments (ver #68/#100: la API ya trato otros campos del quote de forma
// inesperada). Si la verificacion en vivo muestra que los saltos de linea se colapsan o
// se escapan, el plan B es unir todo con un solo espacio respetando la puntuacion que
// cada nota ya trae (nunca agregar '.' si la nota ya termina en '.', '!', '?' o ':').
// Funcion pura para poder decidir el formato final sin tocar subirCotizacionOperam.
export function armarComentariosQuote(notas, vigencia, enviosLalamove = []) {
  const lineasNotas = (Array.isArray(notas) ? notas : [])
    .map((n) => (n || '').trim())
    .filter(Boolean)
    .map((n) => `- ${n}`);
  const lineasEnvio = (enviosLalamove || []).map((e) => `Envio: ${e.descripcion || 'Envio'} $${e.precio}`);
  return [...lineasNotas, `Valido hasta: ${vigencia}`, ...lineasEnvio].join('\n');
}

// Contenido del quote (partidas + comments + cust_ref + fechas) derivado del
// carrito de la cotizacion. Vive fuera de subirCotizacionOperam desde #104
// (ADR-0008) porque hay DOS consumidores: la creacion por API v3 y la
// actualizacion del quote existente por la web legacy (lib/operam-web.js). Un
// solo mapeo garantiza que crear y actualizar produzcan el MISMO documento; dos
// copias divergirian a la primera regla de negocio que cambiara (el SKU de flete,
// el fallback de cust_ref, el formato de comments...). Funcion pura: no toca red.
export function armarContenidoQuote(data) {
  const c = data.cliente || {};

  // El envio (codigo ENVIO) se vuelve una PARTIDA nativa del quote con el SKU de flete
  // de paqueteria que corresponde a la zona del CP de ENTREGA (issue #68): local ->
  // FedEx Ground (251021001), foraneo -> FedEx Ground Foraneo (251021002). El carrier
  // real va SOLO en stock_id_text; el stock_id es siempre uno de esos dos. La clasif.
  // local/foraneo usa esZonaMetroLocal(cpEntrega); si el CP falta o es invalido, esa
  // funcion devuelve false y el envio cae a foraneo (default seguro, documentado ahi).
  // Excepcion: Lalamove se difiere a #72 (se factura por tamano de vehiculo, dato que
  // el cotizador no captura) -> NO se mapea a partida, queda en comments como hoy.
  const esLalamove = (e) => /lalamove/i.test(e.descripcion || '');
  const enviosPaqueteria = (data.items || []).filter(i => i.codigo === 'ENVIO' && !esLalamove(i));
  const enviosLalamove = (data.items || []).filter(i => i.codigo === 'ENVIO' && esLalamove(i));
  const stockFlete = esZonaMetroLocal(c.cpEntrega, RANGOS_ZONA_METRO) ? FLETE_LOCAL : FLETE_FORANEO;

  const itemsNormales = (data.items || [])
    .filter(i => i.codigo !== 'ENVIO')
    .map(i => ({
      stock_id: i.codigo,
      stock_id_text: i.descripcion,
      qty: i.cantidad,
      price: i.precio,
      Disc: i.descuento || 0,
    }));
  const itemsFlete = enviosPaqueteria.map(e => ({
    stock_id: stockFlete,
    stock_id_text: e.descripcion || 'Envio',
    qty: 1,
    price: e.precio,
    Disc: 0,
  }));

  // cust_ref del quote (no confundir con el cust_ref del cliente, #95): cadena de
  // fallback de lo mas especifico a lo mas generico (#108). Casi nunca se llena
  // cliente.referencia (input opcional), asi que sin fallback el quote subia con
  // "Ref. del Cliente" vacio en Operam. trim() antes de decidir (solo-espacios
  // cuenta como vacio) y truncado a 60 al final, sobre la fuente ya elegida.
  const custRef = [c.referencia, c.nombreCorto, c.razonSocial, c.nombreEntrega]
    .map(v => (v || '').trim())
    .find(Boolean) || '';

  const vigencia = vigenciaDeCotizacion(data);
  return {
    items: [...itemsNormales, ...itemsFlete],
    // La vigencia ("Valido hasta") se entrega en comments: la API del quote NO permite
    // setearla. Probado en vivo (HITL #68, quotes 1160-1163): el POST ignora valid_until,
    // delivery_date, valid_days y 7 nombres mas, y deja delivery_date (el campo nativo
    // "Valido hasta") en ord_date-1; tampoco hay PUT de quotes (501). Por eso la UI muestra
    // una fecha incorrecta en quotes creados por API y comments es el unico carrier correcto.
    comments: armarComentariosQuote(data.notas, vigencia, enviosLalamove),
    custRef: custRef.slice(0, 60),
    vigencia,
    orderDate: fechaDeCotizacion(data),
  };
}

// Huella del contenido que quedo en el quote de Operam (issue #114). El cotizador NO
// guardaba ninguna traza de lo que subio -- al regenerar, `data` se sobrescribe y el
// "antes" se pierde -- asi que no habia forma de saber si una regeneracion cambio algo.
// Sin eso solo quedaban dos comportamientos malos: no tocar Operam nunca (el quote se
// queda con lo viejo mientras el documento sale numerado con lo nuevo, el bug de #114)
// o reescribir siempre (N+2 POSTs de scraping cada vez que se pide el HTML del mismo
// carrito que ya salio en PDF).
//
// Se deriva de armarContenidoQuote -- el UNICO mapeo de "que viaja al quote" -- en vez
// de leer data.items a mano: asi la huella hereda gratis las reglas que ya decidian el
// documento (SKU de flete segun la zona del CP de entrega, Lalamove que no es partida,
// cadena de fallback del cust_ref) y no puede divergir de lo que se sube.
//
// Que cuenta como cambio (AC de #114): partidas (SKU, cantidad, precio, descuento),
// importes y cliente. Que NO:
//   - la FECHA de vigencia: se recalcula en CADA generacion (hoy + N dias), asi que
//     generar el PDF hoy y el HTML manana la mueve sola. Incluirla haria que toda
//     regeneracion pareciera un cambio, que es justo lo que AC1 de #114 prohibe. Lo que
//     SI cuenta es el PLAZO en dias (#115): la vigencia viaja al quote (comments y
//     "Valido hasta"), asi que cambiar 30 por 60 tiene que reescribirlo, mientras que
//     regenerar el mismo plazo otro dia no. El plazo se DERIVA de lo que ya viaja
//     (vigencia - fecha), sin cambiar el payload del frontend.
//   - el formato del documento (PDF/HTML, fotos): no viaja al quote.
// Las NOTAS si cuentan (#115, segunda parte): viajan a `comments` -- una linea por nota,
// via armarComentariosQuote -- igual que los envios Lalamove, que no son partida (#72) y
// solo existen ahi. Quedaron fuera en #114 por considerarlas "presentacion", que era
// falso: editarlas dejaba el comments de Operam desactualizado. Y el argumento del ruido
// que justifica excluir la FECHA no aplica a las notas, que solo cambian si el vendedor
// las edita. Por eso la huella incluye el `comments` REAL (mismo mapeo que se sube) con
// una sola normalizacion: la linea "Valido hasta" se sustituye por el plazo en dias.
//   - stock_id_text (la descripcion): la impone el catalogo de Operam, no el cotizador
//     (por eso compararQuoteVista tampoco la compara); reescribir por ella no cambiaria
//     nada en el ERP.
// El cliente entra por customerId (lo unico que el quote liga y que actualizarQuoteOperam
// verifica antes de escribir) y por cust_ref; el branch no, porque la edicion de la web
// legacy no lo reescribe y una reescritura no arreglaria esa divergencia.
// Plazo de vigencia en dias (#115). Se deriva con las MISMAS funciones que construyen
// el comments y el orderDate del quote -- incluidos sus defaults (sin vigencia, fecha +
// 30; sin fecha, hoy) -- para que el plazo corresponda siempre a la linea que de verdad
// se sube. Derivarlo de data.fecha/data.vigencia crudos daria un plazo que no existe en
// el documento. null solo si las fechas no son parseables.
function diasDeVigencia(d) {
  const desde = new Date(fechaDeCotizacion(d)).getTime();
  const hasta = new Date(vigenciaDeCotizacion(d)).getTime();
  if (Number.isNaN(desde) || Number.isNaN(hasta)) return null;
  return Math.round((hasta - desde) / 86400000);
}

// El comments que se subio, con la fecha de "Valido hasta" sustituida por el plazo en
// dias: asi las notas y los envios Lalamove cuentan como cambio, pero regenerar el mismo
// plazo otro dia no. Si el plazo no se puede derivar se deja la linea tal cual (dentro de
// una misma fecha de generacion sigue siendo estable). Si algun dia cambia el formato de
// esa linea en armarComentariosQuote, el test "el mismo plazo en otra fecha NO cuenta"
// falla y lo avisa.
function commentsNormalizado(comments, dias) {
  if (dias == null) return comments;
  return String(comments || '')
    .split('\n')
    .map(l => (l.startsWith('Valido hasta: ') ? `Valido hasta: +${dias}d` : l))
    .join('\n');
}

export function huellaContenidoQuote(data) {
  const { items, custRef, comments } = armarContenidoQuote(data || {});
  const d = data || {};
  return JSON.stringify({
    items: items.map(i => ({ stock_id: i.stock_id, qty: Number(i.qty) || 0, price: Number(i.price) || 0, Disc: Number(i.Disc) || 0 })),
    custRef,
    customerId: d.cliente?.customerId ?? d.cliente?.operamId ?? null,
    comments: commentsNormalizado(comments, diasDeVigencia(d)),
    subtotal: Number(d.subtotal) || 0,
    iva: Number(d.iva) || 0,
    total: Number(d.total) || 0,
  });
}

// Comparacion SIEMPRE local (decision de #114): contenido nuevo contra la huella de lo
// que el cotizador subio la ultima vez. NUNCA se lee el quote de Operam para esto -- el
// cotizador manda, y detectar ediciones hechas fuera del proceso queda fuera de alcance.
// Sin huella previa (cotizaciones subidas antes de #114) se asume que cambio: no se puede
// afirmar que el quote coincida, y entregar un documento numerado que diverge es peor que
// una reescritura de mas con el contenido que el cotizador ya considera bueno.
export function contenidoQuoteCambio(data, huellaPrevia) {
  if (huellaPrevia == null || huellaPrevia === '') return true;
  return huellaContenidoQuote(data) !== huellaPrevia;
}

export async function subirCotizacionOperam(data) {
  const c = data.cliente || {};

  // 1) Identificar el cliente correcto, NUNCA al azar (issue #68):
  //    (a) si la cotizacion ya trae el id del cliente en Operam, usarlo directo;
  //    (b) si no, resolver por RFC EXACTO con buscarClientePorRFC;
  //    (c) si no hay id ni match unico por RFC -> error claro y NO subir.
  //    Se elimino el fallback `|| clientes[0]` que subio la cot 1157 al cliente
  //    equivocado (Utilitario Mexicano). Mejor fallar que asociar mal.
  let customerId = c.customerId ?? c.operamId ?? null;
  let branchId = c.branchId ?? c.branch_id ?? null;
  if (customerId == null) {
    const rfc = (c.rfc || '').trim();
    if (!rfc) {
      throw new Error('No se pudo identificar el cliente en Operam: la cotizacion no tiene RFC. Verifica el RFC del cliente.');
    }
    const encontrado = await buscarClientePorRFC(rfc);
    if (!encontrado.encontrado) {
      throw new Error(`No se pudo identificar el cliente en Operam por el RFC ${rfc}. Verifica el RFC o da de alta el cliente antes de subir.`);
    }
    customerId = encontrado.cliente_id;
    if (branchId == null) branchId = encontrado.branch_code ?? null;
  }

  // Partidas, comments y cust_ref salen del mapeo compartido con la actualizacion
  // del quote por la web legacy (#104): una sola definicion del contenido.
  const { items, comments, custRef, orderDate } = armarContenidoQuote(data);

  const payload = {
    customer_id: parseInt(customerId),
    branch_id: parseInt(branchId || 1),
    payment: 9,
    OrderDate: orderDate,
    deliver_to: c.nombreEntrega || c.razonSocial || '',
    delivery_address: [c.calle, c.colonia, c.cpEntrega, c.municipio, c.estado].filter(Boolean).join(', '),
    items,
    comments,
    cust_ref: custRef,
  };

  const result = await apiCall('POST', '/api/v3/sales/quote', payload);
  if (!result.result) throw new Error(result.messages?.join(', ') || 'Error Operam');
  // El folio del quote viene en added_trans_no (verificado en vivo, quote 1160, #68);
  // quote_id/factura_no NO existen en la respuesta. server.js lo persiste con
  // setFolioOperam (#63), asi que devolver undefined dejaba la cotizacion como
  // pre-cotizacion para siempre.
  return result.added_trans_no ?? result.quote_id ?? result.factura_no;
}

export async function actualizarCliente(id, diff) {
  const body = {};
  for (const [fieldId, { nuevo }] of Object.entries(diff)) {
    body[fieldId] = nuevo;
  }
  const result = await apiCall('PUT', `/api/v3/sales/customers/${id}`, body);
  if (result.result === false) {
    throw new Error((result.messages || []).join(', ') || 'Error al actualizar cliente en Operam');
  }
  return result;
}

export async function actualizarClienteDirecto(id, campos) {
  const result = await apiCall('PUT', `/api/v3/sales/customers/${id}`, campos);
  if (result.result === false) {
    throw new Error((result.messages || []).join(', ') || 'Error al actualizar cliente en Operam');
  }
  return result;
}

const DEFAULTS = {
  cfdi_form_payment: '99',
  cfdi_method_payment: 'PPD',
  timbrado_uso_cfdi: 'S01',
  payment_terms: 9,
  location: '40',
  dimension_id: 1,
  dimension2_id: 5,
  credit_limit: 0,
  discount: 0,
  pymt_discount: 0,
};

// Parametros fiscales estandar de un cliente con RFC generico (issue #121): sin RFC
// real no hay datos fiscales reales, asi que se normalizan SIEMPRE a estos valores,
// sin importar lo que el caller haya mandado -- cubre tanto el alta generica
// automatica (lib/alta-generica.js) como cualquier otro camino (p.ej. el accordion de
// alta completa con captura manual de RFC generico) que llegue a buildClienteBody con
// este tax_id.
const CP_FISCAL_GENERICO = '56577';
const REGIMEN_FISCAL_GENERICO = '616';

const AREA_POR_PAIS = { MX: 1, US: 5, CA: 7 };

function derivarArea(pais) {
  if (!pais || pais === 'MX') return 1;
  return AREA_POR_PAIS[pais] || 6;
}

export function buildClienteBody(cliente) {
  const esGenerico = RFC_GENERICOS.has(String(cliente.tax_id || '').toUpperCase().trim());
  const nombreBase = cliente.CustName || '';
  const CustName = esGenerico ? nombreBase.toUpperCase() : nombreBase;
  const cust_ref = cliente.cust_ref || CustName.toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
  const taxIdPrefix = cliente.invoice_tax_id ? `Tax ID: ${cliente.invoice_tax_id}\n` : '';
  const invoiceEmailLine = cliente.invoice_email ? `Email de facturacion: ${cliente.invoice_email}\n` : '';
  const celularLine = cliente.celular_nota ? `Celular: ${cliente.celular_nota}\n` : '';
  const notes = `${taxIdPrefix}${invoiceEmailLine}${celularLine}Actividades economicas (CSF ${cliente.csf_fecha || ''}):\n` +
    (cliente.actividades || []).map(a => `- ${a}`).join('\n');
  const area = derivarArea(cliente.pais || cliente.area_pais);
  return {
    cust_name: CustName,
    cust_ref,
    tax_id: cliente.tax_id,
    idcif: cliente.idcif || '',
    street: cliente.street || '',
    street_number: cliente.street_number || '',
    suite_number: cliente.suite_number || '',
    district: cliente.district || '',
    postal_code: esGenerico ? CP_FISCAL_GENERICO : (cliente.postal_code || ''),
    city: cliente.city || '',
    state: cliente.state || '',
    country: cliente.country || 'Mexico',
    phone: cliente.phone || null,
    email: cliente.email || null,
    cfdi_regimen_fiscal: esGenerico ? REGIMEN_FISCAL_GENERICO : (cliente.cfdi_regimen_fiscal || '612'),
    timbrado_uso_cfdi: esGenerico ? DEFAULTS.timbrado_uso_cfdi : (cliente.timbrado_uso_cfdi || DEFAULTS.timbrado_uso_cfdi),
    sales_type: cliente.sales_type,
    segmento_id: cliente.segmento_id,
    salesman: cliente.salesman,
    notes,
    cfdi_form_payment: DEFAULTS.cfdi_form_payment,
    cfdi_method_payment: DEFAULTS.cfdi_method_payment,
    payment_terms: DEFAULTS.payment_terms,
    location: DEFAULTS.location,
    area,
    curr_code: cliente.curr_code || 'MXN',
    dimension_id: DEFAULTS.dimension_id,
    dimension2_id: DEFAULTS.dimension2_id,
    credit_limit: DEFAULTS.credit_limit,
    discount: DEFAULTS.discount,
    pymt_discount: DEFAULTS.pymt_discount,
  };
}

// Relectura de verificacion post-PUT (#85): devuelve el cliente crudo de Operam
// (CustName/tax_id/street/...) para comparar con calcularDiffFiscal y detectar el
// quirk del PUT 200 que ignora campos en silencio.
export async function obtenerClientePorId(customerId) {
  const data = await apiCall('GET', `/api/v3/sales/customers/${customerId}`);
  return Array.isArray(data.data) ? data.data[0] : data;
}

export async function obtenerBranchId(customerId) {
  const data = await apiCall('GET', `/api/v3/sales/customers/${customerId}`);
  const cliente = Array.isArray(data.data) ? data.data[0] : data;
  const branchCode = cliente?.branches?.[0]?.branch_code;
  if (!branchCode) throw new Error('No se encontro branch_code para el cliente');
  return branchCode;
}

// Lee un branch por su branch_code para la verificacion post-PUT (#96). Devuelve
// el registro crudo (addr_street, addr_zip...) o null si Operam no lo entrega.
export async function obtenerBranch(branchCode) {
  const data = await apiCall('GET', `/api/v3/sales/branches/${branchCode}`);
  return data.data?.[0] || null;
}

export async function actualizarBranchCliente(customerId, branchId, datos) {
  let resolvedBranchId = branchId;
  if (!resolvedBranchId) {
    resolvedBranchId = await obtenerBranchId(customerId);
  }
  const esMX = !datos.pais || datos.pais === 'MX';
  const area = derivarArea(datos.pais);
  const body = {
    customer_id: customerId,
    br_name: datos.br_name,
    br_ref: datos.br_ref,
    tax_group_id: esMX ? 1 : 2,
    location: 40,
    ship_via: 1,
    area,
    salesman: datos.salesman,
    addr_street: datos.addr_street || '',
    addr_exterior: datos.addr_exterior || '',
    addr_interior: datos.addr_interior || '',
    addr_colony: datos.addr_colony || '',
    addr_city: datos.addr_city || '',
    addr_state: datos.addr_state || '',
    addr_zip: datos.addr_zip || '',
    addr_reference: datos.addr_reference || '',
    phone: datos.phone || '',
    email: datos.email || '',
  };
  const result = await apiCall('PUT', `/api/v3/sales/branches/${resolvedBranchId}`, body);
  if (result.result === false) {
    throw new Error((result.messages || []).join(', ') || 'Error al actualizar branch en Operam');
  }
  return { branch_id: resolvedBranchId, result };
}

// POST /customers SIN la dedup por RFC exacto de crearCliente: con un RFC generico
// (XAXX/XEXX) esa dedup matchearia contra CUALQUIER generico existente y devolveria
// el cliente equivocado. La dedup correcta para genericos es por nombre (ADR-0001)
// y corre en el caller (alta generica de #81).
export async function crearClienteDirecto(cliente) {
  const body = buildClienteBody(cliente);
  const result = await apiCall('POST', '/api/v3/sales/customers', body);
  if (!result.result) throw new Error((result.messages || []).join(', ') || 'Error al crear cliente en Operam');
  return { cliente_id: result.customer_id, nombre: cliente.CustName };
}

export async function crearCliente(cliente) {
  // Con RFC generico (XAXX/XEXX) NO se deduplica por RFC exacto: el lookup
  // devolveria CUALQUIER generico existente (multiples clientes lo comparten) y
  // el alta reportaria duplicado contra el cliente equivocado. La dedup correcta
  // para genericos es por nombre (ADR-0001), que el flujo del alta ya corre via
  // /api/buscar-cliente-duplicado.
  const rfc = String(cliente.tax_id || '').toUpperCase().trim();
  if (!RFC_GENERICOS.has(rfc)) {
    const existente = await buscarClientePorRFC(cliente.tax_id);
    if (existente.encontrado) {
      return { duplicado: true, cliente_id: existente.cliente_id, nombre: existente.CustName, ...existente };
    }
  }
  return { duplicado: false, ...(await crearClienteDirecto(cliente)) };
}

export async function buscarClientePorRFC(rfc) {
  let data;
  try {
    data = await apiCall('GET', `/api/v3/sales/customers?tax_id=${encodeURIComponent(rfc)}`);
  } catch (err) {
    // 404 = RFC inexistente (sin resultados): no es error, es "no encontrado".
    if (/Operam 404/.test(err.message)) return { encontrado: false };
    throw err;
  }
  if (!data.total || data.total === 0) return { encontrado: false };
  const c = data.data[0];
  const branch = c.branches?.[0] || {};
  return {
    encontrado: true,
    cliente_id: c.customer_id,
    branch_code: branch.branch_code,
    CustName: c.CustName,
    tax_id: c.tax_id,
    street: c.street,
    street_number: c.street_number,
    suite_number: c.suite_number,
    district: c.district,
    postal_code: c.postal_code,
    city: c.city,
    state: c.state,
    cfdi_regimen_fiscal: c.cfdi_regimen_fiscal,
    branch: {
      br_name: branch.br_name,
      addr_street: branch.addr_street,
      addr_colony: branch.addr_colony,
      addr_zip: branch.addr_zip,
      addr_city: branch.addr_city,
      addr_state: branch.addr_state,
      phone: branch.phone,
      email: branch.email,
    },
  };
}

export function resetSession() { token = null; }
