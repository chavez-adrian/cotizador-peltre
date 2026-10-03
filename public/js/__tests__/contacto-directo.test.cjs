'use strict';
// #519: los accesos de WhatsApp y Correo de la Oportunidad, en la tarjeta del
// tablero y en la fila abierta de la lista.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let L, ICONOS;
before(async () => {
  L = await import('../pipeline-logica.js');
  ICONOS = await import('../iconos.js');
});

const MENSAJE = 'Hola Hotel Azul, te escribe Memo de pp.peltre sobre la cotizaci\u00f3n & sus colores. \u00bfTuviste oportunidad de revisarla?';

function prospecto(extra) {
  return { tipo: 'prospecto', id: 'p1', refId: 1, nombre: 'Laura', vendedor: 'Memo', celular: '+52 55 1234 5678', etapa: 'por_cotizar', total: 0, correo: 'laura@hotel.mx', ...extra };
}
function cotizacion(extra) {
  return {
    tipo: 'cotizacion', id: 'c51', refId: 51, nombre: 'Hotel Azul', vendedor: 'Memo', total: 5000,
    etapa: 'seguimiento', fecha: '2026-06-10T00:00:00Z', contactoCelular: '+525512345678',
    correo: 'compras@hotel.mx', mensajeSeguimiento: MENSAJE, ...extra,
  };
}

function hrefs(html) {
  return [...html.matchAll(/href="([^"]*)"/g)].map(m => m[1]);
}
function hrefWa(html) {
  return hrefs(html).find(h => h.startsWith('https://wa.me/'));
}
function hrefCorreo(html) {
  return hrefs(html).find(h => h.startsWith('mailto:'));
}
function desescapar(s) {
  return s.replace(/&amp;/g, '&');
}

test('#519 WhatsApp de una cotizacion con paso pendiente lleva el mensaje que mando el servidor', () => {
  const href = desescapar(hrefWa(L.buildContactoDirectoHtml(cotizacion())));
  assert.equal(href, `https://wa.me/525512345678?text=${encodeURIComponent(MENSAJE)}`);
  assert.equal(new URL(href).searchParams.get('text'), MENSAJE);
});

test('#519 WhatsApp sin texto: prospecto, cotizacion sin paso pendiente y post-venta', () => {
  assert.equal(hrefWa(L.buildContactoDirectoHtml(prospecto())), 'https://wa.me/525512345678');
  assert.equal(hrefWa(L.buildContactoDirectoHtml(cotizacion({ mensajeSeguimiento: null }))), 'https://wa.me/525512345678');
  // Post-venta: aunque llegara un mensaje, fuera de Seguimiento no viaja.
  assert.equal(hrefWa(L.buildContactoDirectoHtml(cotizacion({ etapa: 'anticipo_pagado' }))), 'https://wa.me/525512345678');
});

test('#519 el numero es el del CONTACTO, no el telefono del documento', () => {
  const html = L.buildContactoDirectoHtml(cotizacion({ telefono: '525598765432', mensajeSeguimiento: null }));
  assert.equal(hrefWa(html), 'https://wa.me/525512345678');
});

test('#519 sin celular, WhatsApp apagado con su aviso; el correo sigue activo', () => {
  const html = L.buildContactoDirectoHtml(cotizacion({ contactoCelular: null }));
  assert.equal(hrefWa(html), undefined);
  assert.match(html, /<button[^>]*disabled[^>]*aria-label="WhatsApp"[^>]*title="Sin telefono registrado"/);
  assert.equal(hrefCorreo(html), 'mailto:compras@hotel.mx');
});

test('#519 sin correo (o con uno sin forma de correo), Correo apagado con su aviso', () => {
  for (const correo of [null, '', 'sin arroba', 'a@']) {
    const html = L.buildContactoDirectoHtml(prospecto({ correo }));
    assert.equal(hrefCorreo(html), undefined, `correo ${JSON.stringify(correo)}`);
    assert.match(html, /<button[^>]*disabled[^>]*aria-label="Correo"[^>]*title="Sin correo registrado"/);
    assert.ok(hrefWa(html), 'WhatsApp sigue activo');
  }
});

test('#519 con los dos datos, los dos activos con aria-label, title, target _blank y rel noopener', () => {
  const html = L.buildContactoDirectoHtml(prospecto());
  const enlaces = [...html.matchAll(/<a [^>]*>/g)].map(m => m[0]);
  assert.equal(enlaces.length, 2);
  for (const [a, nombre] of [[enlaces[0], 'WhatsApp'], [enlaces[1], 'Correo']]) {
    assert.match(a, new RegExp(`aria-label="${nombre}"`));
    assert.match(a, new RegExp(`title="${nombre}"`));
    assert.match(a, /target="_blank"/);
    assert.match(a, /rel="noopener[^"]*"/);
  }
  assert.doesNotMatch(html, /disabled/);
});

test('#519 el correo y el mensaje se escapan en el href', () => {
  const html = L.buildContactoDirectoHtml(prospecto({ correo: 'a"b@x.mx' }));
  assert.doesNotMatch(html, /mailto:a"b/);
});

test('#519 los iconos son SVG inline con aria-hidden', () => {
  for (const svg of [ICONOS.ICONO_WHATSAPP, ICONOS.ICONO_CORREO]) {
    assert.match(svg, /^<svg [^>]*aria-hidden="true"/);
  }
  const html = L.buildContactoDirectoHtml(prospecto());
  assert.ok(html.includes(ICONOS.ICONO_WHATSAPP) && html.includes(ICONOS.ICONO_CORREO));
});

test('#519 paridad: la tarjeta del tablero y la fila abierta de la lista llevan los mismos accesos', () => {
  for (const o of [prospecto(), cotizacion(), cotizacion({ contactoCelular: null, correo: null })]) {
    const tablero = L.buildTableroPipelineHtml([o]);
    const fila = L.buildFilaListaPipelineHtml(o, { abierta: true });
    assert.ok(tablero.includes(L.buildContactoDirectoHtml(o)), `tablero ${o.id}`);
    assert.ok(fila.includes(L.buildContactoDirectoHtml(o)), `fila ${o.id}`);
    assert.deepEqual(hrefs(tablero).filter(h => /^(https:\/\/wa\.me|mailto:)/.test(h)),
      hrefs(fila).filter(h => /^(https:\/\/wa\.me|mailto:)/.test(h)));
  }
});

test('#519 la fila CERRADA de la lista sigue sin accesos', () => {
  const fila = L.buildFilaListaPipelineHtml(prospecto(), { abierta: false });
  assert.equal(hrefWa(fila), undefined);
  assert.equal(hrefCorreo(fila), undefined);
});
