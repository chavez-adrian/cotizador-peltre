// Acceso a la web legacy de Operam (FrontAccounting) para datos que la API v3 NO
// expone -- en particular el estado de CANCELACION de un pedido/cotizacion (#76/#77).
// La API (listado y detalle de sales_order) muestra un pedido cancelado IGUAL que uno
// activo; solo la pagina view_sales_order.php (que lee la tabla 0_voided de FA) lo marca
// con el aviso en rojo "Este pedido ha sido cancelado".
//
// Scraping ACOTADO y aislado: lo usa scripts/detectar-cancelados.mjs para generar
// data/cancelados.json. El backfill NO scrapea en runtime (lee ese json), asi la
// fragilidad de la web legacy queda fuera del camino critico del backfill.

const COMPANY = '346';

// Predicado PURO sobre el HTML de view_sales_order.php: true si la pagina muestra el
// aviso de anulacion (la transaccion esta en 0_voided). Tolerante a may/min; cubre
// "Este pedido ha sido cancelado" y variantes ("...cotizacion ha sido cancelada").
export function estaCanceladoHtml(html) {
  return /ha sido cancelad/i.test(String(html || ''));
}

// La pagina de FA devuelve el form de login cuando la sesion expiro/no existe (campos
// user_name_entry_field / password). Sirve para detectar una sesion caduca a mitad de una
// corrida larga y re-loguear, evitando falsos negativos de cancelacion (#76, caso 5632:
// la sesion del detector expiro y los pedidos posteriores salieron "activo" por error).
export function esLoginHtml(html) {
  return /user_name_entry_field|name="password"/i.test(String(html || ''));
}

// Abre una sesion web FA (login con cookie) y devuelve una funcion
// consultar(transNo, transType) -> HTML de la pagina del documento. El Bearer de la API
// v3 NO sirve para la web legacy: se usa el form de FA (company_login_name /
// user_name_entry_field / password) y una cookie de sesion (FA...). Reusa
// OPERAM_URL/USER/PASSWORD del entorno (mismo usuario c.code del API).
export async function abrirSesionWeb(opts = {}) {
  const s = await crearSesionFA(opts);
  return (transNo, transType) => s.pedir(vistaUrl(s.base, transNo, transType));
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

  // Retry ante caidas de red (ECONNRESET) y RE-LOGIN si la sesion expira (FA devuelve el
  // form de login -> estaCanceladoHtml daria un falso negativo). Sin esto, una corrida
  // larga pierde cancelaciones desde que la sesion caduca (#76, caso 5632).
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

// Conveniencia: true si la transaccion (transNo, transType) esta cancelada en Operam,
// usando una sesion ya abierta (consultar). trans_type 30 = pedido, 32 = cotizacion.
export async function transaccionCancelada(consultar, transNo, transType) {
  const html = await consultar(transNo, transType);
  return estaCanceladoHtml(html);
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
    const elegida = opciones.find((o) => /\sselected\b/i.test(o)) ?? opciones[0];
    if (elegida) campos[name] = decodificar(atributo(elegida, 'value') ?? '');
  }

  for (const m of form.matchAll(/<textarea[^>]*name\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/textarea>/gi)) {
    campos[m[1] ?? m[2]] = decodificar(m[3]);
  }

  return { campos, action };
}

// FA solo comprueba la presencia de ProcessOrder; el valor es la etiqueta del boton.
const SUBMIT_CONFIRMAR = 'Confirmar Cambios';

// Body del post-fix: el formulario intacto con delivery_date sustituido, mas EXACTAMENTE
// un submit -- el que confirma. CancelOrder viaja en el mismo formulario, asi que un body
// mal armado no degrada: anula la cotizacion. Por eso el submit se agrega aqui de forma
// explicita y nunca se copia de lo parseado.
export function serializarBodyQuote(campos, { deliveryDate, submitValue = SUBMIT_CONFIRMAR } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(deliveryDate ?? ''))) {
    throw new Error(`Vigencia invalida para el post-fix: se esperaba una fecha YYYY-MM-DD y llego "${deliveryDate}"`);
  }
  if (!campos || !('delivery_date' in campos)) {
    throw new Error('El formulario de Operam no trae delivery_date: la pagina no es la de edicion de cotizacion que se esperaba');
  }
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(campos)) {
    body.set(k, k === 'delivery_date' ? deliveryDate : v);
  }
  body.set('ProcessOrder', submitValue);
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

// El estado de la edicion vive en $_SESSION atado a la cookie de la cuenta de la API, asi
// que dos post-fixes simultaneos se pisarian el carrito. Se serializan en una cola y
// reusan una sola sesion (el login de FA es caro); si caduca, pedir() re-loguea solo.
let colaPostFix = Promise.resolve();
let sesionCompartida = null;

export function _resetSesionWeb() {
  sesionCompartida = null;
  colaPostFix = Promise.resolve();
}

// Corrige el campo nativo "Valido hasta" del quote y VERIFICA releyendo. Devuelve
// { ok, esperado, encontrado, yaCorrecto } -- nunca lanza por una verificacion fallida:
// el llamador decide (en la subida es un step no bloqueante, el quote ya existe y
// comments sigue llevando la vigencia). Si el quote ya tiene la fecha correcta no
// repostea nada: escribir sin necesidad solo agrega riesgo.
export async function corregirVigenciaQuote(quoteNo, vigencia, opts = {}) {
  return enCola(async () => {
    const s = await sesion(opts);
    const urlEdicion = `${s.base}/sales/sales_order_entry.php?ModifyQuotationNumber=${encodeURIComponent(quoteNo)}`;
    const { campos, action } = parsearFormularioQuote(await s.pedir(urlEdicion));
    if (campos.delivery_date === vigencia) {
      return { ok: true, yaCorrecto: true, esperado: vigencia, encontrado: vigencia };
    }
    const body = serializarBodyQuote(campos, { deliveryDate: vigencia });
    await s.pedir(new URL(action, s.base).href, { method: 'POST', body: body.toString() });
    const encontrado = leerValidoHastaVista(await s.pedir(vistaUrl(s.base, quoteNo, 32)));
    return { ok: encontrado === vigencia, yaCorrecto: false, esperado: vigencia, encontrado };
  });
}

function enCola(fn) {
  const siguiente = colaPostFix.then(fn, fn);
  colaPostFix = siguiente.then(() => {}, () => {});
  return siguiente;
}

async function sesion(opts) {
  if (!sesionCompartida) sesionCompartida = await crearSesionFA(opts);
  return sesionCompartida;
}
