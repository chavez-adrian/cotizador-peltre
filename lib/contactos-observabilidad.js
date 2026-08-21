// Nucleo PURO de la observabilidad de los barridos de sincronizacion de
// contactos a Google (issue #230, padre #224). Un barrido silencioso que deja
// de funcionar no avisa: el caso concreto a detectar es la autorizacion de
// Google revocada, que no produce ningun sintoma visible en el cotizador.
// SIN IO: no conoce Neon ni SMTP. La envoltura (lib/contactos-observabilidad-io.js)
// persiste el estado y manda el correo. Mismo reparto que
// lib/contactos-logica.js frente a lib/contactos-io.js.
//
// Un "barrido" se identifica por su nombre (hoy solo 'prospectos'; #228
// agregara 'clientes'): el estado se guarda por nombre para que un barrido
// nuevo entre sin tocar este modulo.

import { destinatariosAlertaMayoreo } from './alerta-mayoreo.js';

// Umbral sin corrida exitosa antes de avisar (issue #230: "p. ej. 24h").
export const UMBRAL_AVISO_MS = 24 * 3600 * 1000;

// El aviso se repite a diario mientras la condicion persista, nunca mas
// seguido: sin este piso, cada barrido roto (cada 15 min) mandaria un correo.
const UN_DIA_MS = 24 * 3600 * 1000;

// Clasifica el motivo de un error (err.message capturado por contactos-io.js)
// en autorizacion / red / datos, para que el panel distinga un permiso
// revocado (el caso que #230 pide detectar) de un problema de datos. La
// deteccion es por texto porque contactos-io.js solo persiste err.message, no
// el objeto Error completo -- y el mensaje ya trae el codigo y el motivo de
// Google (lib/google-contactos.js: "Google People 401: ...", "Google token
// refresh 400: ...invalid_grant...").
export function clasificarError(motivo) {
  const m = String(motivo || '');
  if (/token refresh/i.test(m)) return 'autorizacion';
  if (/invalid_grant|invalid_client|unauthorized/i.test(m)) return 'autorizacion';
  if (/\b401\b|\b403\b/.test(m)) return 'autorizacion';
  if (/ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|network/i.test(m)) return 'red';
  if (/Google (People|token refresh) \d{3}/.test(m)) return 'datos';
  return 'otro';
}

function aIso(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Estado inicial de un barrido que nunca corrio (con credenciales) todavia.
export function estadoVacio() {
  return {
    ultimaCorrida: null,
    ultimaCorridaExitosa: null,
    creados: 0, actualizados: 0, inactivados: 0,
    errores: [],
    ultimoAviso: null,
  };
}

// Deriva el siguiente estado persistido a partir del resumen que devuelve un
// barrido ({ omitido, creados, actualizados, inactivados, errores: [{motivo}] }).
//
// Un barrido OMITIDO (sin credenciales, o "barrido en curso" por el lock) no
// es una corrida real: no hay nada nuevo que persistir, por eso devuelve
// SIEMPRE null (nunca el estado previo) -- asi el caller sabe que no debe
// escribir nada, ni siquiera reescribir sin cambios lo que ya habia cada vez
// que el barrido se omite. El caso "sin credenciales" es a proposito -- issue
// #230: "NO avisar cuando el sync esta deliberadamente apagado por falta de
// credenciales, pero SI cuando hay credenciales y falla". Con las tres
// GOOGLE_* configuradas el barrido nunca se omite por esa razon, asi que "sin
// estado" (nunca se registro una corrida) es exactamente "nunca estuvo
// configurado": debeAvisar no tiene nada que avisar.
export function siguienteEstado(estadoPrevio, resumen, ahora = new Date()) {
  const r = resumen || {};
  if (r.omitido) return null;

  const errores = (r.errores || []).map(e => ({
    celular10: e.celular10,
    motivo: e.motivo,
    categoria: clasificarError(e.motivo),
  }));
  const exitosa = errores.length === 0;
  const ahoraIso = aIso(ahora) || new Date().toISOString();

  return {
    ultimaCorrida: ahoraIso,
    ultimaCorridaExitosa: exitosa ? ahoraIso : (estadoPrevio?.ultimaCorridaExitosa ?? null),
    creados: r.creados || 0,
    actualizados: r.actualizados || 0,
    inactivados: r.inactivados || 0,
    errores,
    ultimoAviso: estadoPrevio?.ultimoAviso ?? null,
  };
}

// Decide si toca mandar el aviso HOY: paso el umbral sin corrida exitosa, y
// no se mando ya un aviso en las ultimas 24h (para que se repita a diario y
// no en cada tick del barrido, issue #230).
export function debeAvisar(estado, ahora = new Date()) {
  if (!estado) return false; // nunca corrio con credenciales: nada que avisar
  const ahoraMs = (ahora instanceof Date ? ahora : new Date(ahora)).getTime();
  const desdeExitosa = estado.ultimaCorridaExitosa
    ? ahoraMs - new Date(estado.ultimaCorridaExitosa).getTime()
    : Infinity;
  if (desdeExitosa < UMBRAL_AVISO_MS) return false;
  if (estado.ultimoAviso) {
    const desdeAviso = ahoraMs - new Date(estado.ultimoAviso).getTime();
    if (desdeAviso < UN_DIA_MS) return false;
  }
  return true;
}

const ETIQUETAS_BARRIDO = { prospectos: 'prospectos', clientes: 'clientes de Operam' };

function etiquetaBarrido(nombreBarrido) {
  return ETIQUETAS_BARRIDO[nombreBarrido] || nombreBarrido;
}

// Mensaje del correo de aviso. Mismos destinatarios que la alerta de mayoreo
// (issue #230: "sin variables de entorno nuevas para el canal"); sin
// destinatarios validos no arma mensaje, mismo contrato que
// mensajeAlertaMayoreo (lib/alerta-mayoreo.js).
export function mensajeAviso(nombreBarrido, estado, vendedores, opts) {
  const to = destinatariosAlertaMayoreo(vendedores, opts);
  if (to.length === 0) return null;

  const etiqueta = etiquetaBarrido(nombreBarrido);
  const subject = `Sincronizacion de contactos (${etiqueta}) sin corridas exitosas`;

  const lineas = [
    `El barrido de contactos de Google (${etiqueta}) lleva sin completar una corrida exitosa.`,
    `Ultima corrida exitosa: ${estado.ultimaCorridaExitosa || 'nunca'}`,
    `Ultima corrida (con o sin exito): ${estado.ultimaCorrida || 'nunca'}`,
  ];
  if (estado.errores && estado.errores.length) {
    lineas.push('', 'Errores de la ultima pasada:');
    for (const e of estado.errores.slice(0, 20)) {
      lineas.push(`- [${e.categoria}] ${e.motivo}`);
    }
  }
  lineas.push('', 'Revisa el panel de administracion (Sincronizacion de contactos) para el detalle.');

  return { to, subject, text: lineas.join('\n') };
}
