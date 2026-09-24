// IO de la tarifa Tresguerras (#437): las dos llamadas al cotizador publico de
// su sitio (Poblaciones y CotizarNew) y la traduccion a {rates, warnings}. Nunca
// lanza: "Cotizar con Tresguerras" es una opcion que el vendedor eligio, y todo
// lo que impide cotizar (sin servicio, carga rechazada, pagina movida, TLS o red
// caidos) sale como aviso con la liga para cotizar a mano.
import https from 'node:https';
import tls from 'node:tls';
import { corriendoBajoNodeTest, fetchSinRedEnPruebas } from './red-en-pruebas.js';
import {
  HOST_TRESGUERRAS, URL_POBLACIONES, URL_COTIZAR, URL_COTIZADOR_WEB, AVISO_CAMBIO,
  cuerpoPoblaciones, origenYDestino, datosFormCotizacion, cuerpoCotizar, tarjetaDesdeCotizacion,
} from './tresguerras-logica.js';

const TIMEOUT_MS = 15000;

const ENCABEZADOS = {
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'X-Requested-With': 'XMLHttpRequest',
  'User-Agent': 'Mozilla/5.0 (compatible; PeltreBot/1.0)',
};

// www.tresguerras.com.mx NO manda el certificado intermedio (medido 2026-09-23:
// `unable to verify the first certificate`; el navegador lo completa solo, Node
// no). Es el intermedio PUBLICO de su emisor, "Sectigo Public Server
// Authentication CA DV R36" (vence 2036-03-21, emitido por la raiz "Sectigo
// Public Server Authentication Root R46", que si viene en las raices de Node),
// descargado de http://crt.sectigo.com/SectigoPublicServerAuthenticationCADVR36.crt.
// Se AGREGA a las raices solo para ese host: la verificacion sigue completa y
// ningun otro dominio cambia (precedente: lib/sat-qr.js, #378). Si Tresguerras
// renueva con otro emisor, el verificador en vivo lo detecta.
const INTERMEDIO_SECTIGO_DV_R36 = `-----BEGIN CERTIFICATE-----
MIIGTDCCBDSgAwIBAgIQOXpmzCdWNi4NqofKbqvjsTANBgkqhkiG9w0BAQwFADBf
MQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQD
Ey1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYw
HhcNMjEwMzIyMDAwMDAwWhcNMzYwMzIxMjM1OTU5WjBgMQswCQYDVQQGEwJHQjEY
MBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTcwNQYDVQQDEy5TZWN0aWdvIFB1Ymxp
YyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gQ0EgRFYgUjM2MIIBojANBgkqhkiG9w0B
AQEFAAOCAY8AMIIBigKCAYEAljZf2HIz7+SPUPQCQObZYcrxLTHYdf1ZtMRe7Yeq
RPSwygz16qJ9cAWtWNTcuICc++p8Dct7zNGxCpqmEtqifO7NvuB5dEVexXn9RFFH
12Hm+NtPRQgXIFjx6MSJcNWuVO3XGE57L1mHlcQYj+g4hny90aFh2SCZCDEVkAja
EMMfYPKuCjHuuF+bzHFb/9gV8P9+ekcHENF2nR1efGWSKwnfG5RawlkaQDpRtZTm
M64TIsv/r7cyFO4nSjs1jLdXYdz5q3a4L0NoabZfbdxVb+CUEHfB0bpulZQtH1Rv
38e/lIdP7OTTIlZh6OYL6NhxP8So0/sht/4J9mqIGxRFc0/pC8suja+wcIUna0HB
pXKfXTKpzgis+zmXDL06ASJf5E4A2/m+Hp6b84sfPAwQ766rI65mh50S0Di9E3Pn
2WcaJc+PILsBmYpgtmgWTR9eV9otfKRUBfzHUHcVgarub/XluEpRlTtZudU5xbFN
xx/DgMrXLUAPaI60fZ6wA+PTAgMBAAGjggGBMIIBfTAfBgNVHSMEGDAWgBRWc1hk
lfmSGrASKgRieaFAFYghSTAdBgNVHQ4EFgQUaMASFhgOr872h6YyV6NGUV3LBycw
DgYDVR0PAQH/BAQDAgGGMBIGA1UdEwEB/wQIMAYBAf8CAQAwHQYDVR0lBBYwFAYI
KwYBBQUHAwEGCCsGAQUFBwMCMBsGA1UdIAQUMBIwBgYEVR0gADAIBgZngQwBAgEw
VAYDVR0fBE0wSzBJoEegRYZDaHR0cDovL2NybC5zZWN0aWdvLmNvbS9TZWN0aWdv
UHVibGljU2VydmVyQXV0aGVudGljYXRpb25Sb290UjQ2LmNybDCBhAYIKwYBBQUH
AQEEeDB2ME8GCCsGAQUFBzAChkNodHRwOi8vY3J0LnNlY3RpZ28uY29tL1NlY3Rp
Z29QdWJsaWNTZXJ2ZXJBdXRoZW50aWNhdGlvblJvb3RSNDYucDdjMCMGCCsGAQUF
BzABhhdodHRwOi8vb2NzcC5zZWN0aWdvLmNvbTANBgkqhkiG9w0BAQwFAAOCAgEA
YtOC9Fy+TqECFw40IospI92kLGgoSZGPOSQXMBqmsGWZUQ7rux7cj1du6d9rD6C8
ze1B2eQjkrGkIL/OF1s7vSmgYVafsRoZd/IHUrkoQvX8FZwUsmPu7amgBfaY3g+d
q1x0jNGKb6I6Bzdl6LgMD9qxp+3i7GQOnd9J8LFSietY6Z4jUBzVoOoz8iAU84OF
h2HhAuiPw1ai0VnY38RTI+8kepGWVfGxfBWzwH9uIjeooIeaosVFvE8cmYUB4TSH
5dUyD0jHct2+8ceKEtIoFU/FfHq/mDaVnvcDCZXtIgitdMFQdMZaVehmObyhRdDD
4NQCs0gaI9AAgFj4L9QtkARzhQLNyRf87Kln+YU0lgCGr9HLg3rGO8q+Y4ppLsOd
unQZ6ZxPNGIfOApbPVf5hCe58EZwiWdHIMn9lPP6+F404y8NNugbQixBber+x536
WrZhFZLjEkhp7fFXf9r32rNPfb74X/U90Bdy4lzp3+X1ukh1BuMxA/EEhDoTOS3l
7ABvc7BYSQubQ2490OcdkIzUh3ZwDrakMVrbaTxUM2p24N6dB+ns2zptWCva6jzW
r8IWKIMxzxLPv5Kt3ePKcUdvkBU/smqujSczTzzSjIoR5QqQA6lN1ZRSnuHIWCvh
JEltkYnTAH41QJ6SAWO66GrrUESwN/cgZzL4JLEqz1Y=
-----END CERTIFICATE-----
`;

export function opcionesTlsPara(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return {}; }
  if (parsed.hostname.toLowerCase() !== HOST_TRESGUERRAS) return {};
  return { ca: [...tls.rootCertificates, INTERMEDIO_SECTIGO_DV_R36] };
}

// node:https y no fetch: fetch no acepta opciones de TLS por peticion, y es lo
// unico que completa la cadena de este host (ver opcionesTlsPara).
export function postHttps(url, cuerpo, deps = {}) {
  const request = deps.request || https.request;
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'POST',
      headers: { ...ENCABEZADOS, 'Content-Length': Buffer.byteLength(cuerpo) },
      ...opcionesTlsPara(url),
    }, (res) => {
      let texto = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { texto += c; });
      res.on('end', () => resolve({ status: res.statusCode, texto }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('Tresguerras no respondio a tiempo')));
    req.end(cuerpo);
  });
}

// La guarda de pruebas (#410): bajo node:test la peticion va por el fetch que la
// prueba mockeo, y sin mock se rechaza con ErrorRedEnPruebas en vez de salir a
// la red. Fuera de pruebas, node:https con el TLS acotado.
function postForm(url, cuerpo) {
  if (corriendoBajoNodeTest()) {
    return fetchSinRedEnPruebas(url, { method: 'POST', headers: ENCABEZADOS, body: cuerpo })
      .then(async (r) => ({ status: r.status, texto: await r.text() }));
  }
  return postHttps(url, cuerpo);
}

class CotizadorCambio extends Error {}

async function pedirJson(url, cuerpo) {
  const { status, texto } = await postForm(url, cuerpo);
  if (status !== 200) throw new Error(`respondio ${status}`);
  try { return JSON.parse(texto); } catch { throw new CotizadorCambio(); }
}

export async function tarifasTresguerras({ cp, cajas = [], valorDeclarado = 0 }) {
  try {
    const od = origenYDestino(await pedirJson(URL_POBLACIONES, cuerpoPoblaciones(cp)), cp);
    if (od.aviso) return { rates: [], warnings: [od.aviso] };
    const datosForm = datosFormCotizacion({ ...od, cpDestino: cp, cajas, valorDeclarado });
    const r = tarjetaDesdeCotizacion(await pedirJson(URL_COTIZAR, cuerpoCotizar(datosForm)), cp);
    return r.aviso ? { rates: [], warnings: [r.aviso] } : { rates: [r.rate], warnings: [] };
  } catch (err) {
    if (err instanceof CotizadorCambio) return { rates: [], warnings: [AVISO_CAMBIO] };
    return { rates: [], warnings: [`Tresguerras no disponible (${err.message}); cotiza a mano en ${URL_COTIZADOR_WEB}`] };
  }
}
