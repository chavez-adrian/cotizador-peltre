// Verificacion server-side de Cloudflare Turnstile (issue #162, ADR-0012 pto. 2).
//
// El widget se carga en el cliente desde challenges.cloudflare.com/turnstile/v0/api.js
// -- UNICA excepcion de la casa a la regla de vendoreo (Cloudflare PROHIBE
// autohospedar o proxiar ese script: rota sus defensas anti-bot sin aviso). Este
// modulo es la otra mitad de esa misma excepcion: valida el token contra el
// endpoint de siteverify, tambien de Cloudflare. NO vendorees ninguna de las dos
// puntas ni la muevas a un proxy propio.
//
// Sin TURNSTILE_SECRET_KEY configurada (dev local y la suite de tests, que no
// llevan llaves reales) la verificacion se OMITE explicitamente: la captura
// publica sigue funcionando sin Turnstile. El aviso de esa omision se imprime
// UNA VEZ al arrancar el proceso (server.js, bloque isMain), no por request.
//
// Fallo de RED al llamar a siteverify es FAIL-OPEN: se deja pasar la captura.
// Precedente de la casa (lib/dropbox.js, envia.com en server.js): una
// integracion de terceros fire-and-forget no tumba un flujo propio. El ticket
// #162 pide explicitamente que un envio legitimo no muera porque un tercero
// esta caido. Un token que Cloudflare SI evalua y rechaza (siteverify responde
// 200 con success:false) es distinto: esa es una senal real, no una falla de
// red, y SI descarta la captura.
//
// Esto NO contradice ADR-0012 pto. 2 ("si Cloudflare esta caido, el formulario
// no se puede enviar"): ese enunciado describe el modo de falla del CLIENTE --
// si challenges.cloudflare.com/turnstile/v0/api.js no carga, el widget nunca
// se pinta, nunca hay token, y `if (!token) return false` de arriba rechaza la
// captura SIN llamar a la red -- eso sigue siendo fail-closed, intacto. El
// fail-open de aqui abajo es un caso mas angosto y posterior: el navegador SI
// obtuvo un token (Cloudflare arriba, en pie) pero la llamada saliente de
// ESTE servidor a siteverify falla (problema de red especifico de Render <->
// Cloudflare, no del CDN completo). El ADR no distingue este caso; si Adrian
// quiere, vale la pena una linea de addendum alla.
//
// El aviso de este catch es console.error POR REQUEST (a proposito: cada
// caida real de siteverify es una senal operativa que vale la pena ver) --
// distinto del aviso de "sin llaves" de arriba, que es UNA VEZ al arrancar.
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function turnstileConfigurado() {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

export async function verificarTurnstile(token, remoteip) {
  if (!turnstileConfigurado()) return true;
  if (!token) return false;
  try {
    const r = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: process.env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: remoteip || '',
      }),
    });
    const data = await r.json();
    return data.success === true;
  } catch (err) {
    console.error('[turnstile] siteverify fallo, fail-open (deja pasar la captura):', err.message);
    return true;
  }
}
