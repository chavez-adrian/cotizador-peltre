// Wrapper de IO de la alerta por correo de captura publica de mayoreo (issue
// #163, celular WhatsApp + vCard adjunta en #165). Envuelve el nucleo puro
// (lib/alerta-mayoreo.js) con nodemailer sobre el
// SMTP de akky (mail.akkyhosting11.mx, cuenta contacto@pppeltre.mx -- ver
// PROGRESS/memoria de la spec #155). FIRE-AND-FORGET: el caller (server.js) nunca
// espera esta promesa, mismo contrato que subirCsfDropbox (lib/dropbox.js) -- un
// SMTP caido jamas altera la respuesta del endpoint publico ni impide la tarjeta.
//
// Env vars (Render, Adrian las configura):
//   SMTP_HOST  (opcional, default 'mail.akkyhosting11.mx' -- el host de akky ya
//               verificado para contacto@pppeltre.mx; se puede pisar si cambia)
//   SMTP_USER, SMTP_PASS  (obligatorias -- SIN estas dos, cero intento de
//               conexion; el host por si solo no autentica nada)
//   SMTP_PORT  (opcional, default 465)
//   SMTP_SECURE (opcional, default true; 'false' para STARTTLS en 587)
//   ALERTA_ADMIN_EMAIL  (opcional -- fallback si ningun admin del registro de
//               vendedores tiene correo capturado en /admin, ver lib/alerta-mayoreo.js)

import { mensajeAlertaMayoreo } from './alerta-mayoreo.js';
import * as vendedoresStore from './vendedores-store.js';

// Exportados para que lib/contactos-observabilidad-io.js (issue #230) reuse
// la MISMA envoltura SMTP sin duplicarla ("se reusa la envoltura SMTP que ya
// manda las alertas de captura de mayoreo, con sus mismos destinatarios, sin
// configurar canal nuevo").
export const REMITENTE = 'contacto@pppeltre.mx';
const SMTP_HOST_DEFAULT = 'mail.akkyhosting11.mx';

export function transportadorConfigurado(nodemailer) {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null; // sin credenciales, cero conexiones
  const host = process.env.SMTP_HOST || SMTP_HOST_DEFAULT;
  const port = Number(process.env.SMTP_PORT) || 465;
  const secure = process.env.SMTP_SECURE !== 'false';
  return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
}

// Envia la alerta para un prospecto ya capturado ({ nombre, celular, ciudad,
// tipoProyecto, cantidadEstimada }). No hace nada (resuelve a null) si faltan las
// env vars de SMTP o si el nucleo no arma mensaje (sin destinatarios validos).
export async function enviarAlertaMayoreo(prospecto, deps = {}) {
  const _listar = deps.listar || vendedoresStore.listar;
  const _nodemailer = deps.nodemailer || (await import('nodemailer')).default;

  const transporte = transportadorConfigurado(_nodemailer);
  if (!transporte) return null;

  const vendedores = await _listar();
  const mensaje = mensajeAlertaMayoreo(prospecto, vendedores, {
    adminEmailFallback: process.env.ALERTA_ADMIN_EMAIL,
  });
  if (!mensaje) return null;

  return transporte.sendMail({
    from: REMITENTE, to: mensaje.to.join(', '),
    subject: mensaje.subject, text: mensaje.text, html: mensaje.html,
    // filename: el nucleo ya lo arma nombrado con el prospecto (#239); este
    // wrapper solo pasa lo que produjo mensajeAlertaMayoreo, sin reimplementar
    // la regla de normalizacion. charset=utf-8 declarado explicito: nombres y
    // empresas con acentos son el caso comun, no la excepcion.
    attachments: [{ filename: mensaje.vcardNombreArchivo, content: mensaje.vcard, contentType: 'text/vcard; charset=utf-8' }],
  });
}
