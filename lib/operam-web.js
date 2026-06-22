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
export async function abrirSesionWeb({ base = process.env.OPERAM_URL, user = process.env.OPERAM_USER, pass = process.env.OPERAM_PASSWORD } = {}) {
  const jar = new Map();
  const setJar = (r) => {
    for (const c of r.headers.getSetCookie?.() || []) {
      const [nv] = c.split(';');
      const i = nv.indexOf('=');
      if (i > 0) jar.set(nv.slice(0, i).trim(), nv.slice(i + 1).trim());
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const pageUrl = (tn, tt) => `${base}/sales/view/view_sales_order.php?trans_no=${tn}&trans_type=${tt}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Login FA: GET inicial para sembrar la cookie de sesion, luego POST del login a la
  // misma pagina (FA responde 303 a la misma URL ya autenticado). Reutilizable para
  // re-loguear si la sesion expira a mitad de una corrida larga.
  async function login() {
    const seed = pageUrl(1, 30);
    let r = await fetch(seed, { redirect: 'manual' }); setJar(r); await r.text();
    const form = new URLSearchParams({
      company_login_name: COMPANY,
      user_name_entry_field: user,
      password: pass,
      rememberusername: 'true',
      ui_mode: '1',
    });
    r = await fetch(seed, {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie() },
      body: form.toString(),
    });
    setJar(r); await r.text();
  }
  await login();
  return async function consultar(transNo, transType) {
    // Retry ante caidas de red (ECONNRESET) y RE-LOGIN si la sesion expira (FA devuelve el
    // form de login -> estaCanceladoHtml daria un falso negativo). Sin esto, una corrida
    // larga pierde cancelaciones desde que la sesion caduca (#76, caso 5632).
    let reloginUsado = false;
    for (let intentoRed = 0; ;) {
      let html;
      try {
        const res = await fetch(pageUrl(transNo, transType), { headers: { Cookie: cookie() }, redirect: 'manual' });
        html = await res.text();
      } catch (err) {
        if (intentoRed < 4) { intentoRed++; await sleep(1000 * Math.pow(2, intentoRed - 1)); continue; }
        throw err;
      }
      if (esLoginHtml(html) && !reloginUsado) { reloginUsado = true; await login(); continue; }
      return html;
    }
  };
}

// Conveniencia: true si la transaccion (transNo, transType) esta cancelada en Operam,
// usando una sesion ya abierta (consultar). trans_type 30 = pedido, 32 = cotizacion.
export async function transaccionCancelada(consultar, transNo, transType) {
  const html = await consultar(transNo, transType);
  return estaCanceladoHtml(html);
}
