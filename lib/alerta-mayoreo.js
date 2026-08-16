// Nucleo puro de la alerta por correo de captura publica de mayoreo (issue #163,
// ADR-0012; CONTEXT.md "Captura publica": "Cada captura publica avisa por correo a
// quienes tienen el permiso de asignacion"). Arma destinatarios y el mensaje SIN
// IO -- el envio real vive en lib/alerta-mayoreo-io.js (nodemailer), mismo patron
// de nucleo+wrapper que lib/sync-operam.js / lib/sync-operam-io.js.
//
// Destinatarios (issue #156): vendedores con permiso de asignacion (puedeAsignar,
// que ya incluye a los admin) deduplicados por correo (case-insensitive). El
// registro de vendedores (lib/vendedores-store.js) NO tenia campo de correo antes
// de este issue -- se agrego `email` (columna nueva, mismo patron ALTER TABLE IF
// NOT EXISTS que puede_fijar_lista/puede_asignar de #153/#156) porque no existe
// ninguna convencion de correo corporativo documentada (nombre@dominio) para
// derivarlo sin inventarlo; Adrian lo llena en /admin. Un vendedor sin correo
// registrado simplemente no recibe alerta. Si NINGUN admin tiene correo
// registrado, se agrega `adminEmailFallback` (env var ALERTA_ADMIN_EMAIL,
// resuelta por el wrapper IO) para que la alerta no se quede sin destinatario
// mientras el registro se llena.

import { puedeAsignar } from '../public/js/pipeline-logica.js';

function correoValido(v) {
  const s = String(v == null ? '' : v).trim();
  return s.includes('@') ? s : null;
}

export function destinatariosAlertaMayoreo(vendedores, { adminEmailFallback } = {}) {
  const lista = Array.isArray(vendedores) ? vendedores : [];
  const set = new Map(); // llave: correo en minusculas -> correo original
  let adminConCorreo = false;
  for (const v of lista) {
    if (!v || !puedeAsignar(v)) continue;
    const correo = correoValido(v.email);
    if (!correo) continue;
    if (v.role === 'admin') adminConCorreo = true;
    const llave = correo.toLowerCase();
    if (!set.has(llave)) set.set(llave, correo);
  }
  if (!adminConCorreo) {
    const fallback = correoValido(adminEmailFallback);
    if (fallback && !set.has(fallback.toLowerCase())) set.set(fallback.toLowerCase(), fallback);
  }
  return Array.from(set.values());
}

const ASUNTO = 'Nuevo prospecto de mayoreo';

function dato(v) {
  const s = String(v == null ? '' : v).trim();
  return s || 'Sin dato';
}

// Mensaje de alerta para un prospecto de la captura publica de mayoreo (issue
// #163, ticket "What to build"): nombre, celular, ciudad, tipo de proyecto y
// cantidad estimada. Sin destinatarios validos no arma mensaje (devuelve null) --
// el wrapper IO nunca debe intentar mandar un correo vacio de "to".
export function mensajeAlertaMayoreo(prospecto, vendedores, opts) {
  const to = destinatariosAlertaMayoreo(vendedores, opts);
  if (to.length === 0) return null;
  const p = prospecto || {};
  const text = [
    `Nombre: ${dato(p.nombre)}`,
    `Celular: ${dato(p.celular)}`,
    `Ciudad: ${dato(p.ciudad)}`,
    `Tipo de proyecto: ${dato(p.tipoProyecto)}`,
    `Cantidad estimada: ${dato(p.cantidadEstimada)}`,
  ].join('\n');
  return { to, subject: ASUNTO, text };
}
