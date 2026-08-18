// Acceso a la web legacy de Operam (FrontAccounting) para lo que la API v3 NO permite:
// fijar la vigencia ("Valido hasta") de una cotizacion. El POST de quote ignora
// valid_until y no hay PUT (501), asi que el campo nativo queda en ord_date-1 y Operam
// marca como vencidas cotizaciones vivas. Se corrige reposteando el formulario de
// edicion. Ver ADR-0007 (#106).
//
// Tambien vive aqui la deteccion de CANCELACION (#76): la API v3 muestra un pedido
// anulado IGUAL que uno activo; solo view_sales_order.php (que lee 0_voided de FA) lo
// marca. Es scraping ACOTADO -- lo usa scripts/detectar-cancelados.mjs para generar
// data/cancelados.json; el backfill NO scrapea en runtime (lee ese json), asi la
// fragilidad de la web legacy queda fuera de su camino critico.

import { armarContenidoQuote } from './operam-client.js';
// El limite de la descripcion es el maxlength REAL del textarea item_description de
// Operam: se importa del mismo nucleo puro que frena la captura en la pantalla (#139)
// para que el numero no viva dos veces.
import { MAX_DESCRIPCION } from '../public/js/descripcion-logica.js';

const COMPANY = '346';

// La pagina de FA devuelve el form de login cuando la sesion expiro/no existe (campos
// user_name_entry_field / password). Permite re-loguear en vez de tomar el formulario de
// login por una respuesta valida (#76, caso 5632: una sesion caduca hacia que las paginas
// siguientes se leyeran mal en silencio).
export function esLoginHtml(html) {
  return /user_name_entry_field|name="password"/i.test(String(html || ''));
}

const vistaUrl = (base, transNo, transType) =>
  `${base}/sales/view/view_sales_order.php?trans_no=${transNo}&trans_type=${transType}`;

// Sesion web de FA: login por form + cookie, con re-login automatico y reintento ante
// caidas de red. Expone pedir(url, opts) para GET y POST. El Bearer de la API v3 NO sirve
// aqui: son dos mecanismos de auth distintos sobre el mismo ERP.
export async function crearSesionFA({
  base = process.env.OPERAM_URL,
  user = process.env.OPERAM_USER,
  pass = process.env.OPERAM_PASSWORD,
  timeoutMs = 20000,
} = {}) {
  const jar = new Map();
  const setJar = (r) => {
    for (const c of r.headers.getSetCookie?.() || []) {
      const [nv] = c.split(';');
      const i = nv.indexOf('=');
      if (i > 0) jar.set(nv.slice(0, i).trim(), nv.slice(i + 1).trim());
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // El post-fix corre dentro del request de subida del vendedor: sin timeout, una web
  // legacy colgada dejaria la peticion esperando indefinidamente.
  const traer = (url, init) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    return fetch(url, { ...init, redirect: 'manual', signal: ctrl.signal }).finally(() => clearTimeout(t));
  };

  // Login FA: GET inicial para sembrar la cookie de sesion, luego POST del login a la
  // misma pagina (FA responde 303 a la misma URL ya autenticado). Reutilizable para
  // re-loguear si la sesion expira a mitad de una corrida larga.
  async function login() {
    const seed = vistaUrl(base, 1, 30);
    let r = await traer(seed); setJar(r); await r.text();
    const form = new URLSearchParams({
      company_login_name: COMPANY,
      user_name_entry_field: user,
      password: pass,
      rememberusername: 'true',
      ui_mode: '1',
    });
    r = await traer(seed, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie() },
      body: form.toString(),
    });
    setJar(r); await r.text();
  }
  await login();

  // Retry ante caidas de red (ECONNRESET) y RE-LOGIN si la sesion expira: FA devuelve el
  // form de login con status 200, asi que sin detectarlo se parsearia ese formulario como
  // si fuera la pagina pedida y la lectura fallaria en silencio (#76, caso 5632).
  // Un POST NO se reintenta por red: no se sabe si llego al servidor, y repetir una
  // escritura sobre un documento comercial a ciegas es peor que fallar.
  async function pedir(url, { method = 'GET', body = null } = {}) {
    const esEscritura = method !== 'GET';
    let reloginUsado = false;
    for (let intentoRed = 0; ;) {
      let html;
      try {
        const res = await traer(url, {
          method,
          headers: {
            Cookie: cookie(),
            ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          },
          ...(body ? { body } : {}),
        });
        html = await res.text();
      } catch (err) {
        if (!esEscritura && intentoRed < 4) { intentoRed++; await sleep(1000 * Math.pow(2, intentoRed - 1)); continue; }
        throw err;
      }
      if (esLoginHtml(html)) {
        // La sesion caduco. En una lectura se re-loguea y se repite; en una escritura no:
        // el cart_id del formulario murio con la sesion, asi que repetir el POST no
        // aplicaria los cambios sobre el documento que se creia editar.
        if (esEscritura) throw new Error('La sesion de la web legacy de Operam caduco durante la escritura; no se reintenta a ciegas');
        if (reloginUsado) return html;
        reloginUsado = true;
        await login();
        continue;
      }
      return html;
    }
  }

  return { base, pedir };
}

// --- Post-fix de la vigencia "Valido hasta" (#106, ADR-0007) -----------------
// La API v3 ignora valid_until y deja el campo nativo en ord_date-1, asi que Operam
// marca como vencidas cotizaciones vivas. Se corrige reposteando el formulario de
// edicion de la web legacy con delivery_date cambiado y TODO lo demas identico: el
// post-fix no decide el contenido del documento, solo lo devuelve con un campo distinto.

const ENTIDADES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', uuml: 'ü', ntilde: 'ñ',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Uuml: 'Ü', Ntilde: 'Ñ',
};

// Decodifica entidades HTML. Sin esto, un Comments con "&" se repostearia como "&amp;"
// y cada post-fix corromperia un poco mas el texto que ve el cliente.
function decodificar(s) {
  return String(s ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (n in ENTIDADES ? ENTIDADES[n] : m));
}

const atributo = (tag, nombre) => {
  const m = tag.match(new RegExp(`${nombre}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return m ? (m[1] ?? m[2]) : null;
};

// Campos que un navegador REALMENTE enviaria del formulario de edicion: inputs de datos,
// la opcion elegida de cada select y los textareas. Deliberadamente NO recoge botones ni
// inputs de tipo submit -- en este formulario conviven CancelOrder (anula la cotizacion),
// Delete0/Delete1 (borran partidas) y update ("Recalculate"); un navegador solo manda el
// submit que se presiono. Tampoco recoge lo que vive fuera del <form> (el buscador del
// chrome). Lanza si la pagina no trae formulario: postearlo a medias es peor que no hacer
// nada (sesion expirada, quote inexistente o cambio de UI de Operam).
export function parsearFormularioQuote(html) {
  // Los comentarios HTML se descartan primero: nunca aportan campos, y un "<form" citado
  // dentro de uno haria que el recorte empezara antes del formulario real y arrastrara
  // campos del chrome (el buscador) al body.
  const texto = String(html ?? '').replace(/<!--[\s\S]*?-->/g, '');
  const ini = texto.search(/<form[^>]*>/i);
  const fin = texto.toLowerCase().indexOf('</form>', ini);
  if (ini === -1 || fin === -1) {
    throw new Error('La pagina de edicion de Operam no trae formulario (sesion expirada, cotizacion inexistente o cambio de la web legacy)');
  }
  const form = texto.slice(ini, fin);
  // El destino del POST se toma del propio formulario, no se hardcodea: si Operam mueve
  // la pagina, el post-fix la sigue en vez de escribir en una URL que ya no existe.
  const action = atributo(form.match(/<form[^>]*>/i)[0], 'action') || '/sales/sales_order_entry.php';
  return { campos: extraerCampos(form), action };
}

// Campos que un navegador enviaria de un trozo de formulario ya recortado. Compartido
// por el formulario de cotizacion y el de ficha de cliente (#172): los dos viven en la
// misma web legacy y sus reglas de serializacion son las del navegador, no las de la
// pagina.
function extraerCampos(form) {
  const campos = {};

  for (const m of form.matchAll(/<input[^>]*>/gi)) {
    const tag = m[0];
    const name = atributo(tag, 'name');
    if (!name) continue;
    const tipo = (atributo(tag, 'type') || 'text').toLowerCase();
    if (['submit', 'button', 'image', 'reset'].includes(tipo)) continue;
    if (['checkbox', 'radio'].includes(tipo) && !/\schecked\b/i.test(tag)) continue;
    campos[name] = decodificar(atributo(tag, 'value') ?? '');
  }

  for (const m of form.matchAll(/<select[^>]*name\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/select>/gi)) {
    const name = m[1] ?? m[2];
    const cuerpo = m[3];
    const opciones = [...cuerpo.matchAll(/<option[^>]*>/gi)].map((o) => o[0]);
    const seleccionada = opciones.find((o) => /\sselected\b/i.test(o));
    // Un select MULTIPLE sin nada seleccionado no manda nada (asi lo hace el navegador);
    // caer a la primera opcion inventaria un valor. Es el caso de dimensiones_id[] en la
    // ficha de cliente, cuyas opciones las carga Operam por AJAX (#172). Los formularios
    // de cotizacion no traen ningun select multiple, asi que esta regla no cambia nada
    // en el camino de #104/#106/#139.
    const elegida = seleccionada ?? (/<select[^>]*\smultiple\b/i.test(m[0]) ? undefined : opciones[0]);
    if (elegida) campos[name] = decodificar(atributo(elegida, 'value') ?? '');
  }

  for (const m of form.matchAll(/<textarea[^>]*name\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/textarea>/gi)) {
    campos[m[1] ?? m[2]] = decodificar(m[3]);
  }

  return campos;
}

// FA solo comprueba la presencia de ProcessOrder; el valor es la etiqueta del boton.
// Constante y NO parametrizable a proposito: un parametro para elegir el submit seria
// justo la perilla que permitiria mandar CancelOrder y anular la cotizacion.
const SUBMIT_CONFIRMAR = 'Confirmar Cambios';
const SUBMIT_AGREGAR = 'Agregar';

// Nombres que NUNCA pueden salir de los campos parseados hacia un body: son los
// submits del formulario y cada uno dispara una accion distinta (CancelOrder ANULA
// la cotizacion). parsearFormularioQuote ya los excluye; este filtro es la segunda
// linea de defensa por si el HTML de Operam cambiara y colara uno como input normal.
// El submit que se quiere ejecutar lo pone SIEMPRE el serializador, explicito.
// UpdateItem/CancelItemChanges (#139) son los de la fila en modo edicion: confirman o
// descartan la linea que se esta editando, y entran aqui por el mismo motivo.
const ES_SUBMIT = (k) => /^(ProcessOrder|CancelOrder|AddItem|UpdateItem|CancelItemChanges|update|addshippingcost|Delete\d+|Edit\d+)$/.test(k);

function bodyDesdeCampos(campos, sustituciones = {}, esSubmit = ES_SUBMIT) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...(campos || {}), ...sustituciones })) {
    if (esSubmit(k)) continue;
    body.set(k, v);
  }
  return body;
}

// Body del post-fix / del ProcessOrder final: el formulario intacto con delivery_date
// sustituido, mas EXACTAMENTE un submit -- el que confirma. CancelOrder viaja en el
// mismo formulario, asi que un body mal armado no degrada: anula la cotizacion. Por eso
// el submit se agrega aqui de forma explicita y nunca se copia de lo parseado.
// comments/custRef son opcionales (#104): al ACTUALIZAR una cotizacion el header nuevo
// viaja en el mismo POST que las partidas nuevas, asi que el post-fix separado de la
// vigencia (#106) no hace falta en ese camino. Sin ellos el comportamiento del post-fix
// de #106 queda identico: solo cambia delivery_date.
export function serializarBodyQuote(campos, { deliveryDate, comments, custRef } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(deliveryDate ?? ''))) {
    throw new Error(`Vigencia invalida para el post-fix: se esperaba una fecha YYYY-MM-DD y llego "${deliveryDate}"`);
  }
  if (!campos || !('delivery_date' in campos)) {
    throw new Error('El formulario de Operam no trae delivery_date: la pagina no es la de edicion de cotizacion que se esperaba');
  }
  const sustituciones = { delivery_date: deliveryDate };
  if (comments !== undefined) {
    if (!('Comments' in campos)) {
      throw new Error('El formulario de Operam no trae Comments: la pagina no es la de edicion de cotizacion que se esperaba');
    }
    sustituciones.Comments = comments;
  }
  if (custRef !== undefined) {
    if (!('cust_ref' in campos)) {
      throw new Error('El formulario de Operam no trae cust_ref: la pagina no es la de edicion de cotizacion que se esperaba');
    }
    sustituciones.cust_ref = custRef;
  }
  const body = bodyDesdeCampos(campos, sustituciones);
  body.set('ProcessOrder', SUBMIT_CONFIRMAR);
  return body;
}

// --- Reescritura de las partidas del quote (#104, ADR-0008) ------------------
// Delete{n} y AddItem mutan el carrito en $_SESSION (atado al cart_id del form): la
// base NO se toca hasta ProcessOrder. Verificado en vivo el 2026-07-28 contra el quote
// de prueba 1199 (borrar todas las lineas + agregar una con precio distinto y ABANDONAR
// dejo el documento intacto). De ahi la estrategia: cualquier fallo antes de
// ProcessOrder se resuelve abandonando la sesion, sin escribir nada.

// Partidas YA capturadas en el formulario de edicion. Se identifican por su boton
// Delete{n} -- la fila de captura de linea nueva (stock_id/qty/price/Disc + AddItem)
// no tiene uno, asi que no se cuenta como partida. El SKU sale del enlace a
// stock_status.php de la misma fila (el de sales_prices_list.php usa item_code, otro
// parametro, y no se confunde con este).
export function parsearLineasQuote(html) {
  const texto = String(html ?? '').replace(/<!--[\s\S]*?-->/g, '');
  const indices = [...texto.matchAll(/name\s*=\s*(?:"Delete(\d+)"|'Delete(\d+)')/gi)]
    .map((m) => Number(m[1] ?? m[2]));
  const skus = [...texto.matchAll(/stock_status\.php\?stock_id=([^&'"\s]+)/gi)]
    .map((m) => decodificar(m[1]));
  return indices.map((indice, i) => ({ indice, stockId: skus[i] ?? null }));
}

// Borra la PRIMERA partida. Siempre Delete0: FA renumera las lineas tras cada borrado,
// asi que iterar el indice 0 tantas veces como partidas haya evita depender de la
// numeracion (ADR-0008, paso 3). El valor es el del boton real del formulario.
export function serializarBodyBorrarLinea(campos) {
  const body = bodyDesdeCampos(campos);
  body.set('Delete0', '1');
  return body;
}

// Agrega UNA partida al carrito en sesion. Los campos de la fila de captura
// (stock_id/qty/price/Disc) se sustituyen por los de la partida; el resto del
// formulario viaja igual, como lo mandaria un navegador. Valida antes de mandar: una
// partida invalida la rechazaria FA renderizando la pagina con un error, y el conteo
// de lineas dejaria de cuadrar a mitad de la reescritura. Fallar aqui es gratis (aun
// no hubo ProcessOrder: el documento sigue intacto).
export function serializarBodyAgregarLinea(campos, { stock_id, qty, price, Disc = 0 } = {}) {
  const sku = String(stock_id ?? '').trim();
  if (!sku) throw new Error('Partida sin SKU: no se puede agregar al quote de Operam');
  if (!Number.isFinite(Number(qty)) || Number(qty) <= 0) {
    throw new Error(`Cantidad invalida para el SKU ${sku}: se esperaba un numero mayor que cero y llego "${qty}"`);
  }
  if (!Number.isFinite(Number(price)) || Number(price) < 0) {
    throw new Error(`Precio invalido para el SKU ${sku}: se esperaba un numero no negativo y llego "${price}"`);
  }
  if (!Number.isFinite(Number(Disc)) || Number(Disc) < 0 || Number(Disc) > 100) {
    throw new Error(`Descuento invalido para el SKU ${sku}: se esperaba un porcentaje 0-100 y llego "${Disc}"`);
  }
  const body = bodyDesdeCampos(campos, {
    stock_id: sku,
    qty: String(Number(qty)),
    price: String(Number(price)),
    Disc: String(Number(Disc)),
  });
  body.set('AddItem', SUBMIT_AGREGAR);
  return body;
}

// --- Ronda de descripcion por partida (#139) ---------------------------------
// Al re-agregar una linea por la web legacy, FA le pone la descripcion del CATALOGO
// de articulos y descarta la que traia (verificado en vivo con el quote 1216,
// 2026-08-13). Para que la descripcion que escribio el vendedor sobreviva a la
// actualizacion hay que entrar a la linea (Edit{n}) y confirmarla con
// item_description + UpdateItem. Es un formulario DISTINTO del normal: la fila en
// edicion trae el textarea, un hidden LineNo con su indice y su stock_id, y sus
// botones pasan a ser UpdateItem/CancelItemChanges.

// Entra a editar la partida {indice}. Como Delete{n}, el submit lo pone este
// serializador: nunca se copia de lo parseado.
export function serializarBodyEditarLinea(campos, indice) {
  if (!Number.isInteger(indice) || indice < 0) {
    throw new Error(`Indice de linea invalido para editar la descripcion: se esperaba un entero >= 0 y llego "${indice}"`);
  }
  const body = bodyDesdeCampos(campos);
  body.set(`Edit${indice}`, '1');
  return body;
}

// Confirma la descripcion de la linea que esta en edicion. Solo cambia el texto: la
// cantidad, el precio, el descuento y el SKU de la fila viajan tal como los devolvio
// el formulario. Si la pagina no trae item_description no es la fila en edicion que
// se esperaba y se aborta ANTES de postear (sin ProcessOrder el documento sigue
// intacto, ADR-0008).
export function serializarBodyDescripcionLinea(campos, { descripcion } = {}) {
  if (!campos || !('item_description' in campos)) {
    throw new Error('El formulario de Operam no trae item_description: la partida no quedo en modo edicion');
  }
  const texto = String(descripcion ?? '');
  if (texto.length > MAX_DESCRIPCION) {
    throw new Error(`La descripcion de la partida no cabe en Operam: ${texto.length} caracteres, el maximo es ${MAX_DESCRIPCION}`);
  }
  const body = bodyDesdeCampos(campos, { item_description: texto });
  body.set('UpdateItem', '1');
  return body;
}

// Lee el campo nativo "Valido hasta" de la vista read-only (view_sales_order.php) para
// verificar el post-fix. Se usa la vista y no la de edicion: releer el formulario abriria
// otra sesion de captura en FA. null = el campo no esta (pagina inesperada); el llamador
// lo trata como "no verificado", nunca como exito.
export function leerValidoHastaVista(html) {
  const m = String(html ?? '').match(/V[aá]lido hasta\s*<\/td>\s*<td[^>]*>\s*(\d{4}-\d{2}-\d{2})/i);
  return m ? m[1] : null;
}

// --- Verificacion post-escritura de la actualizacion (#104, ADR-0008 paso 6) --
// Se relee la vista read-only y se compara contra lo que se quiso escribir. Operam
// responde 200 aunque ignore campos (mismo quirk del PUT de clientes), asi que sin
// esta relectura una escritura silenciosamente parcial pasaria por exito.

const sinEtiquetas = (s) => decodificar(String(s ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// "5,388.00" -> 5388. NaN cuando la celda no es un numero (no se inventa un 0: un
// 0 falso haria que la comparacion afirmara una discrepancia que no se comprobo).
function aNumero(txt) {
  const limpio = String(txt ?? '').replace(/[^\d.,-]/g, '').replace(/,/g, '');
  if (!limpio || !/\d/.test(limpio)) return NaN;
  return Number(limpio);
}

// Partidas de la tabla "Conceptos" de la vista: Codigo | Descripcion | Cantidad |
// Unidad | Precio | Descuento | Total | Cantidad de Pedido. Se reconocen por el
// enlace a stock_status.php de la primera celda (las filas de subtotal/IVA/total no
// lo tienen). La descripcion se lee desde #139 -- es como se verifica la ronda de
// edicion por linea -- pero compararQuoteVista solo la contrasta en las partidas
// cuya descripcion el cotizador se propuso escribir: en las demas FA impone la del
// catalogo de articulos (verificado en vivo 2026-07-28) y compararla daria
// discrepancia siempre.
export function leerLineasVista(html) {
  const texto = String(html ?? '').replace(/<!--[\s\S]*?-->/g, '');
  const lineas = [];
  for (const m of texto.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const fila = m[1];
    if (!/stock_status\.php\?stock_id=/i.test(fila)) continue;
    const celdas = [...fila.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => sinEtiquetas(c[1]));
    if (celdas.length < 6) continue;
    lineas.push({
      stockId: celdas[0],
      descripcion: celdas[1],
      cantidad: aNumero(celdas[2]),
      precio: aNumero(celdas[4]),
      descuento: aNumero(celdas[5]),
    });
  }
  return lineas;
}

// Comentarios de la vista. Los saltos de linea de Comments (#107: una nota por linea
// + "Valido hasta") se renderizan como <br /> aqui; sin reconvertirlos la comparacion
// daria discrepancia siempre y el aviso al vendedor seria puro ruido.
export function leerComentariosVista(html) {
  const m = String(html ?? '').match(/Comentarios\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
  if (!m) return null;
  // El <br /> se come el salto de linea REAL que lo sigue en el HTML: si no, cada
  // linea de comentarios quedaria separada por dos '\n' y la comparacion fallaria.
  return m[1]
    .replace(/<br\s*\/?>[ \t]*\r?\n?/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .split('\n')
    .map((l) => decodificar(l).replace(/\s+/g, ' ').trim())
    .join('\n')
    .trim();
}

// Tolerancia de dinero: la vista redondea a 2 decimales, asi que comparar en exacto
// marcaria discrepancias inexistentes por el ultimo centavo.
const IGUAL_MONTO = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

// La celda de la vista ya viene con los espacios colapsados (sinEtiquetas); la
// descripcion esperada se normaliza igual para que un salto de linea del textarea no
// se lea como una discrepancia.
const TEXTO_NORMALIZADO = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// Compara el quote esperado contra la vista releida. Devuelve SIEMPRE un resultado
// estructurado, nunca lanza: el llamador decide como avisarle al vendedor (patron de
// corregirVigenciaQuote, #106). verificado=false significa "no se pudo comprobar"
// (pagina inesperada), que es distinto de "quedo mal" -- y en ningun caso es ok.
export function compararQuoteVista({ items = [], comments, vigencia } = {}, html) {
  const encontradas = leerLineasVista(html);
  const comentariosVista = leerComentariosVista(html);
  const vigenciaVista = leerValidoHastaVista(html);
  const verificado = encontradas.length > 0 || comentariosVista !== null;
  const discrepancias = [];

  if (encontradas.length !== items.length) {
    discrepancias.push({ campo: 'partidas', esperado: items.length, encontrado: encontradas.length });
  }
  for (let i = 0; i < Math.min(items.length, encontradas.length); i++) {
    const esp = items[i];
    const enc = encontradas[i];
    if (String(esp.stock_id) !== String(enc.stockId)) {
      discrepancias.push({ campo: 'sku', linea: i, esperado: esp.stock_id, encontrado: enc.stockId });
      continue; // con el SKU cruzado, comparar cantidad/precio de esa linea no informa
    }
    if (!IGUAL_MONTO(esp.qty, enc.cantidad)) {
      discrepancias.push({ campo: 'cantidad', linea: i, sku: esp.stock_id, esperado: esp.qty, encontrado: enc.cantidad });
    }
    if (!IGUAL_MONTO(esp.price, enc.precio)) {
      discrepancias.push({ campo: 'precio', linea: i, sku: esp.stock_id, esperado: esp.price, encontrado: enc.precio });
    }
    if (!IGUAL_MONTO(esp.Disc || 0, enc.descuento)) {
      discrepancias.push({ campo: 'descuento', linea: i, sku: esp.stock_id, esperado: esp.Disc || 0, encontrado: enc.descuento });
    }
    // Solo las partidas cuya descripcion escribio el vendedor (#139): en las demas la
    // pone el catalogo de Operam al re-agregar la linea y compararla marcaria una
    // discrepancia en toda actualizacion correcta. El texto se normaliza igual que la
    // celda leida (la vista colapsa los saltos de linea del textarea en espacios).
    if (esp.editarDescripcion && TEXTO_NORMALIZADO(esp.stock_id_text) !== TEXTO_NORMALIZADO(enc.descripcion)) {
      discrepancias.push({ campo: 'descripcion', linea: i, sku: esp.stock_id, esperado: esp.stock_id_text, encontrado: enc.descripcion });
    }
  }
  if (comments !== undefined && comentariosVista !== comments) {
    discrepancias.push({ campo: 'comentarios', esperado: comments, encontrado: comentariosVista });
  }
  if (vigencia !== undefined && vigenciaVista !== vigencia) {
    discrepancias.push({ campo: 'vigencia', esperado: vigencia, encontrado: vigenciaVista });
  }
  return { ok: verificado && discrepancias.length === 0, verificado, discrepancias };
}

// El estado de la edicion vive en $_SESSION atado a la cookie de la cuenta de la API, asi
// que dos post-fixes simultaneos se pisarian el carrito. Se serializan en una cola y
// reusan una sola sesion (el login de FA es caro); si caduca, pedir() re-loguea solo.
// OJO: la cola es de PROCESO. Vale porque Render corre una sola instancia (plan Starter);
// con varias instancias dos post-fixes podrian solaparse igual.
let colaPostFix = Promise.resolve();
let sesionCompartida = null;

export function _resetSesionWeb() {
  sesionCompartida = null;
  colaPostFix = Promise.resolve();
}

// Espera a que la cola quede vacia. Solo para tests: desde #186 hay un post-fix
// FIRE-AND-FORGET (el del segmento en el alta generica) y sin esto no habria forma de
// afirmar si escribio o no -- la respuesta HTTP se va antes de que termine.
export function _esperarPostFixes() {
  return colaPostFix;
}

// Corrige el campo nativo "Valido hasta" del quote y VERIFICA releyendo. Devuelve
// { ok, verificado, esperado, encontrado, yaCorrecto } -- nunca lanza por una
// verificacion fallida: el llamador decide (en la subida es un step no bloqueante, el
// quote ya existe y comments sigue llevando la vigencia). Si el quote ya tiene la fecha
// correcta no repostea nada: escribir sin necesidad solo agrega riesgo.
export async function corregirVigenciaQuote(quoteNo, vigencia) {
  return enCola(async () => {
    const s = await sesion();
    const urlEdicion = `${s.base}/sales/sales_order_entry.php?ModifyQuotationNumber=${encodeURIComponent(quoteNo)}`;
    const { campos, action } = parsearFormularioQuote(await s.pedir(urlEdicion));
    if (campos.delivery_date === vigencia) {
      return { ok: true, yaCorrecto: true, verificado: true, esperado: vigencia, encontrado: vigencia };
    }
    const body = serializarBodyQuote(campos, { deliveryDate: vigencia });
    await s.pedir(new URL(action, s.base).href, { method: 'POST', body: body.toString() });
    const encontrado = leerValidoHastaVista(await s.pedir(vistaUrl(s.base, quoteNo, 32)));
    // encontrado === null NO es una discrepancia: es que la vista no traia el campo y no
    // se pudo comprobar nada. Se distingue de "quedo con otra fecha" (verificado: true,
    // ok: false) para no afirmar en el reporte algo que no se sabe.
    return {
      ok: encontrado === vigencia,
      yaCorrecto: false,
      verificado: encontrado !== null,
      esperado: vigencia,
      encontrado,
    };
  });
}

// --- Actualizar el quote conservando el folio (#104, ADR-0008) ---------------
// La API v3 no tiene PUT de quotes (501), asi que actualizar una cotizacion ya
// registrada solo es posible reescribiendo su carrito por la web legacy. Reescritura
// COMPLETA (no diff): borrar todas las lineas, agregar las nuevas y confirmar una
// sola vez con el header actualizado. El contenido sale del MISMO mapeo que usa la
// creacion por API (armarContenidoQuote), para que crear y actualizar produzcan
// documentos identicos.
//
// Contrato: NUNCA lanza. Devuelve { ok, escrito, verificado, discrepancias, ... }.
// `escrito` distingue los dos mundos: false = no se llego a mandar ProcessOrder y el
// quote en Operam quedo INTACTO (fallo reversible por abandono, verificado en vivo);
// true = se confirmo el cambio y la verificacion dice si quedo como se esperaba.
// El limite de borrados evita un bucle infinito si FA dejara de borrar lineas.
const MAX_BORRADOS = 60;

export async function actualizarQuoteOperam(quoteNo, data) {
  const { items, comments, custRef, vigencia } = armarContenidoQuote(data || {});
  // Un quote sin partidas no es una actualizacion valida: dejaria el documento vacio
  // en el ERP. Se rechaza ANTES de abrir la sesion de edicion.
  if (!items.length) {
    return { ok: false, escrito: false, verificado: false, discrepancias: [], error: 'La cotizacion no tiene partidas: no se actualiza el quote de Operam para no dejarlo vacio' };
  }
  return enCola(async () => {
    let escrito = false;
    try {
      const s = await sesion();
      const urlEdicion = `${s.base}/sales/sales_order_entry.php?ModifyQuotationNumber=${encodeURIComponent(quoteNo)}`;
      let html = await s.pedir(urlEdicion);
      let { campos, action } = parsearFormularioQuote(html);
      const destino = new URL(action, s.base).href;

      // Este camino reescribe PARTIDAS y header, nunca el cliente del quote: cambiar
      // de cliente en Operam implica domicilio, lista de precios y credito, y no es lo
      // que "actualizar una cotizacion" promete. Si la cotizacion del cotizador apunta
      // a otro cliente, actualizar dejaria un quote a nombre de A con el contenido de
      // B -- exactamente la divergencia silenciosa que #104 vino a cerrar. Se aborta
      // antes de tocar nada; lo correcto ahi es crear una cotizacion nueva.
      const customerEsperado = data?.cliente?.customerId ?? data?.cliente?.operamId ?? null;
      if (customerEsperado != null && String(campos.customer_id) !== String(customerEsperado)) {
        throw new Error(`El quote ${quoteNo} esta a nombre del cliente ${campos.customer_id} y la cotizacion apunta al ${customerEsperado}: no se actualiza; crea una cotizacion nueva`);
      }

      // 1) Borrar TODAS las partidas. Delete0 iterado, re-parseando en cada paso: FA
      // renumera tras cada borrado. Si el conteo no baja, algo cambio en la web legacy
      // y se aborta ANTES de escribir (el documento sigue intacto).
      let restantes = parsearLineasQuote(html).length;
      for (let i = 0; restantes > 0; i++) {
        if (i >= MAX_BORRADOS) throw new Error(`No se pudieron borrar las partidas del quote ${quoteNo} en ${MAX_BORRADOS} intentos`);
        html = await s.pedir(destino, { method: 'POST', body: serializarBodyBorrarLinea(campos).toString() });
        ({ campos } = parsearFormularioQuote(html));
        const ahora = parsearLineasQuote(html).length;
        if (ahora >= restantes) {
          throw new Error(`La web legacy de Operam no borro la partida del quote ${quoteNo} (quedaban ${restantes}, siguen ${ahora}); se aborta sin escribir`);
        }
        restantes = ahora;
      }

      // 2) Agregar las partidas nuevas, una por POST, verificando que el carrito crece.
      // FA rechaza una linea invalida re-renderizando la pagina con un error, sin
      // agregarla: sin esta comprobacion se confirmaria un quote incompleto.
      for (const [i, item] of items.entries()) {
        html = await s.pedir(destino, { method: 'POST', body: serializarBodyAgregarLinea(campos, item).toString() });
        ({ campos } = parsearFormularioQuote(html));
        const ahora = parsearLineasQuote(html);
        if (ahora.length !== i + 1) {
          throw new Error(`La web legacy de Operam no agrego la partida ${item.stock_id} al quote ${quoteNo} (se esperaban ${i + 1} lineas, hay ${ahora.length}); se aborta sin escribir`);
        }
      }

      // 3) Ronda de descripcion (#139), SOLO en las partidas cuya descripcion escribio
      // el vendedor: al re-agregarlas, FA les puso la del catalogo de articulos. Se
      // entra a la linea con Edit{n} y se confirma con item_description + UpdateItem;
      // el ProcessOrder final es uno solo y viene despues. Una cotizacion sin
      // descripciones editadas no gasta un solo POST aqui.
      for (const [i, item] of items.entries()) {
        if (!item.editarDescripcion) continue;
        html = await s.pedir(destino, { method: 'POST', body: serializarBodyEditarLinea(campos, i).toString() });
        ({ campos } = parsearFormularioQuote(html));
        // El formulario tiene que haber quedado en la linea que se pidio editar: sin
        // esta comprobacion, un Edit{n} que FA ignorara escribiria la descripcion de
        // una partida sobre otra (o sobre la fila de captura de linea nueva).
        if (String(campos.LineNo ?? '') !== String(i) || String(campos.stock_id ?? '') !== String(item.stock_id)) {
          throw new Error(`La web legacy de Operam no abrio la partida ${i} (${item.stock_id}) del quote ${quoteNo} para editar su descripcion; se aborta sin escribir`);
        }
        html = await s.pedir(destino, {
          method: 'POST',
          body: serializarBodyDescripcionLinea(campos, { descripcion: item.stock_id_text }).toString(),
        });
        ({ campos } = parsearFormularioQuote(html));
      }

      // 4) UN solo ProcessOrder con el header actualizado. La vigencia viaja aqui, asi
      // que en este camino el post-fix separado de #106 no hace falta. Ademas es
      // OBLIGATORIA: un ProcessOrder sobre un quote creado por API con el
      // delivery_date que dejo la API (ord_date-1) falla EN SILENCIO -- 200 y nada
      // persistido (verificado con el quote 1216).
      const body = serializarBodyQuote(campos, { deliveryDate: vigencia, comments, custRef });
      escrito = true;
      await s.pedir(destino, { method: 'POST', body: body.toString() });

      // 5) Verificacion obligatoria releyendo la vista read-only: la respuesta del
      // ProcessOrder no trae marcador de exito (verificado con el quote 1216), asi
      // que releer es la UNICA forma de saber si quedo escrito.
      const vista = await s.pedir(vistaUrl(s.base, quoteNo, 32));
      const r = compararQuoteVista({ items, comments, vigencia }, vista);
      return { ...r, escrito: true, esperado: { items, comments, vigencia } };
    } catch (err) {
      return { ok: false, escrito, verificado: false, discrepancias: [], error: err.message };
    }
  });
}

// --- Post-fix del SEGMENTO del cliente (#172) --------------------------------
// La API v3 NO puede escribir segmento_id por ningun camino (POST, PUT dedicado, PUT
// bundleado, 8 nombres alternos; sondeo en vivo documentado en peltre-operam.md 12.5c);
// el formulario de ficha de cliente de la web legacy SI lo persiste. Mismo patron que el
// post-fix de vigencia (#106): se repostea el formulario COMPLETO con un solo campo
// cambiado -- este camino no decide los datos del cliente, solo le devuelve su segmento.

// El submit real de la ficha es un <button name='process'>, no un <input>: extraerCampos
// no lo ve y hay que agregarlo explicito. Constante y NO parametrizable, igual que
// ProcessOrder: un parametro para elegir el submit seria la perilla que permitiria
// mandar `delete` y ELIMINAR el cliente.
const SUBMIT_ACTUALIZAR_CLIENTE = 'Actualizar Cliente';

// Submits de la ficha de cliente. `delete` ELIMINA el cliente; `save_metadata` y
// `submit_idcif` disparan otras acciones y los `tabs_*` cambian de pestana (y con ella
// los campos que FA espera). Todos son <button>, asi que extraerCampos ya no los recoge:
// esto es la segunda linea de defensa por si Operam cambiara el HTML y colara uno como
// input normal, exactamente el mismo razonamiento que ES_SUBMIT para CancelOrder.
const ES_SUBMIT_CLIENTE = (k) => /^(process|delete|save_metadata|submit_idcif|tabs_[a-z_]+|_[a-z_]+_update)$/i.test(k);

// La ficha de cliente trae un <form> de metadatos ANIDADO (HTML invalido) dentro del
// principal: cortar en el PRIMER </form> deja fuera los campos que viven despues -- entre
// ellos `_token`, el CSRF de FA -- y el POST saldria incompleto. Se toma del primer
// <form> al ULTIMO </form> ignorando las etiquetas intermedias; asi lo aplana el DOM de
// un navegador real y asi se verifico el ciclo completo en vivo (#172, cliente 492).
export function parsearFormularioCliente(html) {
  const texto = String(html ?? '').replace(/<!--[\s\S]*?-->/g, '');
  // El recorte empieza en el form de la FICHA (el que postea a customers.php), no en el
  // primero que aparezca: en la pagina real el buscador del chrome es un input suelto,
  // pero si Operam lo envolviera en su propio form, empezar ahi arrastraria sus campos
  // al body. Sin ese form, se cae al primero (el ancla del sondeo en vivo).
  const conAction = texto.search(/<form[^>]*action\s*=\s*(?:"[^"]*customers\.php[^"]*"|'[^']*customers\.php[^']*')[^>]*>/i);
  const ini = conAction === -1 ? texto.search(/<form[^>]*>/i) : conAction;
  // El cierre se busca CONTANDO anidamiento en vez de tomar el ultimo </form> del
  // documento: asi el form de metadatos anidado no corta el recorte (su </form> baja la
  // profundidad a 1, no a 0) y un form posterior no relacionado -- un modal o el pie de
  // pagina del ERP -- tampoco se cuela, porque la profundidad ya volvio a 0 antes de que
  // ese form abriera.
  const fin = ini === -1 ? -1 : cierreDelFormulario(texto, ini);
  if (ini === -1 || fin === -1) {
    throw new Error('La ficha de cliente de Operam no trae formulario (sesion expirada, cliente inexistente o cambio de la web legacy)');
  }
  const form = texto.slice(ini, fin);
  const action = atributo(form.match(/<form[^>]*>/i)[0], 'action') || '/sales/manage/customers.php';
  return { campos: extraerCampos(form), action };
}

// Indice del </form> que cierra el formulario abierto en `ini`, contando los <form>
// anidados (HTML invalido que FA genera de todas formas). -1 si nunca cierra.
function cierreDelFormulario(texto, ini) {
  let profundidad = 0;
  for (const m of texto.slice(ini).matchAll(/<form[^>]*>|<\/form\s*>/gi)) {
    profundidad += m[0][1] === '/' ? -1 : 1;
    if (profundidad === 0) return ini + m.index;
  }
  return -1;
}

// Body de la ficha: el formulario intacto con segmento_id sustituido, mas EXACTAMENTE un
// submit -- el que actualiza. Si el formulario no trae segmento_id no es la ficha que se
// esperaba y se aborta ANTES de postear: repostearla igual escribiria el resto de los
// campos de una pagina desconocida sobre el cliente.
export function serializarBodyCliente(campos, { segmentoId } = {}) {
  const seg = String(segmentoId ?? '').trim();
  if (!seg) {
    throw new Error(`Segmento invalido para el post-fix web: se esperaba el id del segmento y llego "${segmentoId}"`);
  }
  if (!campos || !('segmento_id' in campos)) {
    throw new Error('El formulario de Operam no trae segmento_id: la pagina no es la ficha de cliente que se esperaba');
  }
  const body = bodyDesdeCampos(campos, { segmento_id: seg }, (k) => ES_SUBMIT(k) || ES_SUBMIT_CLIENTE(k));
  body.set('process', SUBMIT_ACTUALIZAR_CLIENTE);
  return body;
}

// FA rechaza un guardado invalido (p.ej. postal_code vacio) respondiendo 200 con la
// pagina re-renderizada y SIN aplicar ningun campo; la unica senal es el msgbox con
// clase err_msg. Sin leerlo, el post-fix reportaria un exito falso (#172, trampa 2).
// null = no hubo error (un msgbox vacio no cuenta: la pagina normal lo trae siempre).
export function leerErrorWeb(html) {
  const m = String(html ?? '').match(/<(\w+)[^>]*class\s*=\s*(?:"[^"]*\berr_msg\b[^"]*"|'[^']*\berr_msg\b[^']*')[^>]*>([\s\S]*?)<\/\1>/i);
  if (!m) return null;
  return sinEtiquetas(m[2]) || 'La web legacy de Operam rechazo el cambio sin decir el motivo';
}

// Escribe el segmento del cliente por la web legacy y devuelve { ok, yaCorrecto, error }.
// Contrato: NUNCA lanza -- el llamador (el upgrade fiscal) ya aplico el PUT de la API y
// un fallo de este post-fix no debe tumbar el upgrade; solo deja el segmento sin aplicar,
// que es lo que ya reporta la verificacion post-PUT. No verifica releyendo: quien lo
// llama relee el cliente por la API v3 inmediatamente despues, y esa es la comprobacion
// real (200 de FA no garantiza nada, mismo quirk que el resto de la web legacy).
export async function actualizarSegmentoClienteWeb(clienteId, segmentoId) {
  return enCola(async () => {
    try {
      const s = await sesion();
      const url = `${s.base}/sales/manage/customers.php?debtor_no=${encodeURIComponent(clienteId)}`;
      const { campos, action } = parsearFormularioCliente(await s.pedir(url));
      // La ficha que devolvio FA tiene que ser la del cliente que se pidio: escribir el
      // segmento sobre otro cliente seria peor que no escribirlo.
      if (campos.customer_id != null && String(campos.customer_id) !== String(clienteId)) {
        throw new Error(`La web legacy de Operam devolvio la ficha del cliente ${campos.customer_id} y no la del ${clienteId}; no se escribe el segmento`);
      }
      // Escribir sin necesidad solo agrega riesgo (mismo criterio que corregirVigenciaQuote).
      if (String(campos.segmento_id) === String(segmentoId)) {
        return { ok: true, yaCorrecto: true };
      }
      const body = serializarBodyCliente(campos, { segmentoId });
      const html = await s.pedir(new URL(action, s.base).href, { method: 'POST', body: body.toString() });
      const error = leerErrorWeb(html);
      if (error) return { ok: false, yaCorrecto: false, error };
      return { ok: true, yaCorrecto: false };
    } catch (err) {
      return { ok: false, yaCorrecto: false, error: err.message };
    }
  });
}

function enCola(fn) {
  const siguiente = colaPostFix.then(fn, fn);
  colaPostFix = siguiente.then(() => {}, () => {});
  return siguiente;
}

async function sesion() {
  if (!sesionCompartida) sesionCompartida = await crearSesionFA();
  return sesionCompartida;
}

// --- Deteccion de cancelacion (#76) -----------------------------------------
// La API v3 muestra un pedido/cotizacion anulado IGUAL que uno activo (sin campo de
// estado y sin transacciones); solo view_sales_order.php, que lee la tabla 0_voided de
// FA, pinta el aviso en rojo. De ahi que el estado se scrapee.

// Predicado PURO sobre el HTML de view_sales_order.php: true si la pagina muestra el
// aviso de anulacion. Tolerante a may/min; cubre "Este pedido ha sido cancelado" y
// variantes ("...cotizacion ha sido cancelada").
export function estaCanceladoHtml(html) {
  return /ha sido cancelad/i.test(String(html || ''));
}

// Abre una sesion web de FA y devuelve consultar(transNo, transType) -> HTML de la
// pagina del documento. Reusa crearSesionFA (login por form + cookie, re-login y
// reintento de lectura ya resueltos ahi); esta funcion solo arma la URL de la vista.
// Sesion PROPIA, no la compartida del post-fix: el detector es un script de corrida
// larga y no debe competir por el carrito de edicion de $_SESSION.
export async function abrirSesionWeb(opciones = {}) {
  const { base, pedir } = await crearSesionFA(opciones);
  return (transNo, transType) => pedir(vistaUrl(base, transNo, transType));
}

// Conveniencia: true si la transaccion (transNo, transType) esta cancelada en Operam,
// usando una sesion ya abierta (consultar). trans_type 30 = pedido, 32 = cotizacion.
export async function transaccionCancelada(consultar, transNo, transType) {
  const html = await consultar(transNo, transType);
  return estaCanceladoHtml(html);
}
