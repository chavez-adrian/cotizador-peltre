// Validador QR del SAT (issue #378).
//
// El QR impreso en la CSF apunta a validadorqr.jsf, que devuelve los datos del
// contribuyente en HTML. Es el respaldo del cotizador cuando el PDF no tiene
// capa de texto (los glifos vienen como trazos) o cuando el texto no produce
// RFC. Aqui vive TODO lo propio de hablar con ese servidor: quien puede ser el
// host, como se negocia el TLS y como se aplana el HTML a texto para parsearCSF.

import https from 'node:https';

const TIMEOUT_MS = 15000;

export function esHostDelSat(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === 'sat.gob.mx' || h.endsWith('.sat.gob.mx');
}

// El SAT negocia un Diffie-Hellman corto que OpenSSL 3 rechaza al nivel de
// seguridad por default: `fetch` de Node muere con ERR_SSL_DH_KEY_TOO_SMALL
// (medido 2026-09-12 en Node 24 contra siat.sat.gob.mx). Bajar el SECLEVEL es
// la unica forma de leer el validador, y por eso va acotado a sus hosts: una
// URL de cualquier otro dominio sale de aqui SIN opciones de TLS.
export function opcionesTlsPara(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return {}; }
  if (!esHostDelSat(parsed.hostname)) return {};
  return { ciphers: 'DEFAULT:@SECLEVEL=0' };
}

// Las vocales acentuadas y la ene llegan como entidad en buena parte del HTML
// mexicano. Decodificarlas importa porque de aqui sale la razon social que se
// escribe en Operam: "MU&ntilde;OZ" o "MUNOZ" no son el apellido de nadie.
const ENTIDADES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Uuml: 'Ü',
  ntilde: 'ñ', Ntilde: 'Ñ',
};

function decodificarEntidades(texto) {
  return texto
    .replace(/&#x([0-9a-f]+);/gi, (m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (m, dec) => String.fromCodePoint(Number(dec)))
    // Sin la /i a proposito: las entidades HTML distinguen mayusculas y es lo
    // unico que separa a "&ntilde;" (ñ) de "&Ntilde;" (Ñ).
    .replace(/&([a-zA-Z]+);/g, (m, nombre) => (nombre in ENTIDADES ? ENTIDADES[nombre] : m));
}

// El HTML del validador es una tabla de etiquetas y valores; parsearCSF trabaja
// sobre texto con un renglon por campo.
export function htmlATexto(html) {
  return decodificarEntidades(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(tr|div|p|li|td|th)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
}

// node:https y no fetch: fetch no acepta opciones de TLS por peticion, que es
// justo lo que el SAT exige (ver opcionesTlsPara).
export function descargarValidadorQR(url, deps = {}) {
  const get = deps.get || https.get;
  return new Promise((resolve, reject) => {
    const req = get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PeltreBot/1.0)' },
      ...opcionesTlsPara(url),
    }, (res) => {
      let html = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { html += c; });
      res.on('end', () => resolve({ status: res.statusCode, html }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('El SAT no respondio a tiempo')));
  });
}
