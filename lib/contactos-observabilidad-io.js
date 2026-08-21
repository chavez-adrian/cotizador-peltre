// Envoltura de IO de la observabilidad de los barridos de sincronizacion de
// contactos a Google (issue #230, padre #224). Aplica el nucleo puro
// (lib/contactos-observabilidad.js) contra el estado persistido
// (lib/contactos-observabilidad-store.js) y, si toca, manda el correo de
// aviso por la MISMA envoltura SMTP de la alerta de mayoreo
// (lib/alerta-mayoreo-io.js), a los mismos destinatarios.
//
// Un solo punto de enganche: registrarBarrido(nombreBarrido, resumen) se
// llama UNA vez por cada pasada de un barrido, con el resumen que ya devuelve
// ({ omitido, creados, actualizados, inactivados, errores }, ver
// lib/contactos-io.js). Nunca lanza: un fallo aqui (Neon caido, SMTP caido)
// jamas debe alterar el resultado de la sincronizacion ni ninguna respuesta
// del cotizador, mismo contrato que enviarAlertaMayoreo.

import { siguienteEstado, debeAvisar, mensajeAviso } from './contactos-observabilidad.js';
import * as observabilidadStore from './contactos-observabilidad-store.js';
import { transportadorConfigurado, REMITENTE } from './alerta-mayoreo-io.js';
import * as vendedoresStore from './vendedores-store.js';

async function enviarAviso(nombreBarrido, estado, deps) {
  const _listar = deps.listarVendedores || vendedoresStore.listar;
  const _nodemailer = deps.nodemailer || (await import('nodemailer')).default;

  const transporte = transportadorConfigurado(_nodemailer);
  if (!transporte) return null;

  const vendedores = await _listar();
  const mensaje = mensajeAviso(nombreBarrido, estado, vendedores, {
    adminEmailFallback: process.env.ALERTA_ADMIN_EMAIL,
  });
  if (!mensaje) return null;

  return transporte.sendMail({
    from: REMITENTE, to: mensaje.to.join(', '),
    subject: mensaje.subject, text: mensaje.text,
  });
}

// Registra el resultado de una pasada de un barrido y, si el umbral sin
// corrida exitosa se supero, manda (o repite) el correo de aviso. deps es
// solo para pruebas (leer/guardar/listarVendedores/nodemailer/ahora), mismo
// patron de inyeccion que enviarAlertaMayoreo.
export async function registrarBarrido(nombreBarrido, resumen, deps = {}) {
  const ahora = deps.ahora instanceof Date ? deps.ahora : new Date();
  const _leer = deps.leer || observabilidadStore.leer;
  const _guardar = deps.guardar || observabilidadStore.guardar;

  try {
    const previo = await _leer(nombreBarrido);
    const nuevo = siguienteEstado(previo, resumen, ahora);
    if (!nuevo) return; // omitido (sin credenciales / barrido en curso): no es una corrida real
    await _guardar(nombreBarrido, nuevo);

    if (debeAvisar(nuevo, ahora)) {
      try {
        await enviarAviso(nombreBarrido, nuevo, deps);
      } catch (err) {
        console.error('[contactos-observabilidad] correo de aviso fallo:', err.message);
      }
      await _guardar(nombreBarrido, { ...nuevo, ultimoAviso: ahora.toISOString() });
    }
  } catch (err) {
    console.error('[contactos-observabilidad] registro de corrida fallo:', err.message);
  }
}
