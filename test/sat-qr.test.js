import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { esHostDelSat, opcionesTlsPara, htmlATexto, descargarValidadorQR } from '../lib/sat-qr.js';

describe('esHostDelSat (issue #378)', () => {
  it('acepta el host del validador QR', () => {
    assert.equal(esHostDelSat('siat.sat.gob.mx'), true);
  });
  it('acepta el dominio raiz', () => {
    assert.equal(esHostDelSat('sat.gob.mx'), true);
  });
  it('rechaza un host que solo termina parecido', () => {
    assert.equal(esHostDelSat('sat.gob.mx.evil.com'), false);
    assert.equal(esHostDelSat('notsat.gob.mx'), false);
  });
  it('rechaza cualquier otro host', () => {
    assert.equal(esHostDelSat('example.com'), false);
  });
});

// El SAT negocia un Diffie-Hellman corto que OpenSSL 3 rechaza por nivel de
// seguridad (ERR_SSL_DH_KEY_TOO_SMALL). Bajar el SECLEVEL es la unica forma de
// hablar con el, y por eso tiene que quedar acotado a sus hosts.
describe('opcionesTlsPara (issue #378)', () => {
  it('relaja el nivel de seguridad SOLO para hosts del SAT', () => {
    const o = opcionesTlsPara('https://siat.sat.gob.mx/app/qr/faces/pages/mobile/validadorqr.jsf?D1=10');
    assert.equal(o.ciphers, 'DEFAULT:@SECLEVEL=0');
  });
  it('no toca el TLS de ningun otro host', () => {
    assert.deepEqual(opcionesTlsPara('https://example.com/x'), {});
    assert.deepEqual(opcionesTlsPara('https://sat.gob.mx.evil.com/x'), {});
  });
  it('una URL invalida no relaja nada', () => {
    assert.deepEqual(opcionesTlsPara('no-es-una-url'), {});
  });
});

describe('htmlATexto (issue #378)', () => {
  it('quita etiquetas, script y entidades y deja un renglon por campo', () => {
    const html = '<html><head><style>p{color:red}</style></head><body>'
      + '<script>var x = "<b>oculto</b>";</script>'
      + '<div>CP:</div><div>56530</div><p>Sueldos &amp; Salarios</p></body></html>';
    const texto = htmlATexto(html);
    assert.ok(!texto.includes('oculto'));
    assert.ok(!texto.includes('color:red'));
    assert.match(texto, /CP:\s*\n\s*56530/);
    assert.ok(texto.includes('&'));
  });

  // De aqui sale la razon social que se escribe en Operam.
  it('decodifica la ene y las vocales acentuadas de un apellido', () => {
    assert.equal(htmlATexto('<div>MU&Ntilde;OZ P&Eacute;REZ</div>'), 'MUÑOZ PÉREZ');
  });

  it('distingue la ene minuscula de la mayuscula', () => {
    assert.equal(htmlATexto('<div>ni&ntilde;o</div>'), 'niño');
  });

  it('decodifica entidades numericas, decimales y hexadecimales', () => {
    assert.equal(htmlATexto('<div>MU&#209;OZ P&#xC9;REZ</div>'), 'MUÑOZ PÉREZ');
  });

  it('una entidad que no conoce la deja como esta en vez de romper el texto', () => {
    assert.equal(htmlATexto('<div>A&fake;B</div>'), 'A&fake;B');
  });
});

function respuestaFalsa(statusCode, cuerpo) {
  const res = Readable.from([cuerpo]);
  res.statusCode = statusCode;
  return res;
}

function getFalso(registro, statusCode, cuerpo) {
  return (url, opciones, cb) => {
    registro.push({ url, opciones });
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.destroy = () => {};
    setImmediate(() => cb(respuestaFalsa(statusCode, cuerpo)));
    return req;
  };
}

describe('descargarValidadorQR (issue #378)', () => {
  it('devuelve status y html, y pide el TLS relajado del SAT', async () => {
    const registro = [];
    const r = await descargarValidadorQR('https://siat.sat.gob.mx/app/qr/x.jsf?D1=10', {
      get: getFalso(registro, 200, '<html>R.F.C. : PEGJ850214HN2</html>'),
    });
    assert.equal(r.status, 200);
    assert.ok(r.html.includes('PEGJ850214HN2'));
    assert.equal(registro[0].opciones.ciphers, 'DEFAULT:@SECLEVEL=0');
  });

  it('propaga el status cuando el SAT no responde 200', async () => {
    const r = await descargarValidadorQR('https://siat.sat.gob.mx/app/qr/x.jsf', {
      get: getFalso([], 503, ''),
    });
    assert.equal(r.status, 503);
  });
});
