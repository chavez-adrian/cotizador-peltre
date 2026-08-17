import { test } from 'node:test';
import assert from 'node:assert/strict';

import { enviarAlertaMayoreo } from '../lib/alerta-mayoreo-io.js';

// Wrapper IO de la alerta de mayoreo (issue #163): nodemailer inyectado, mismo
// patron de deps que lib/sync-operam-io.js. Sin credenciales SMTP, cero intentos
// de conexion -- nodemailer.createTransport NUNCA se llama.

const VENDEDORES = [
  { id: 1, name: 'Vendedor Con Permiso', role: 'vendedor', puedeAsignar: true, email: 'conpermiso@pppeltre.mx' },
];
const PROSPECTO = { nombre: 'Juan Perez', celular: '+525512345678', ciudad: 'Ixtapaluca', tipoProyecto: 'Restaurantes', cantidadEstimada: '+350' };

function limpiarEnvSmtp() {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_SECURE;
  delete process.env.ALERTA_ADMIN_EMAIL;
}

test('enviarAlertaMayoreo: sin SMTP_USER/SMTP_PASS, no crea transporte ni intenta conectarse', async () => {
  limpiarEnvSmtp();
  let creado = false;
  const nodemailerFalso = { createTransport: () => { creado = true; return { sendMail: async () => {} }; } };

  const resultado = await enviarAlertaMayoreo(PROSPECTO, {
    listar: async () => VENDEDORES,
    nodemailer: nodemailerFalso,
  });

  assert.equal(resultado, null);
  assert.equal(creado, false, 'nodemailer.createTransport no debe llamarse sin credenciales');
});

test('enviarAlertaMayoreo: con credenciales, manda el mensaje del nucleo por sendMail', async () => {
  limpiarEnvSmtp();
  process.env.SMTP_HOST = 'mail.akkyhosting11.mx';
  process.env.SMTP_USER = 'contacto@pppeltre.mx';
  process.env.SMTP_PASS = 'secreto';

  let argsCreateTransport = null;
  let argsSendMail = null;
  const nodemailerFalso = {
    createTransport: (opts) => {
      argsCreateTransport = opts;
      return { sendMail: async (m) => { argsSendMail = m; return { messageId: 'x' }; } };
    },
  };

  const resultado = await enviarAlertaMayoreo(PROSPECTO, {
    listar: async () => VENDEDORES,
    nodemailer: nodemailerFalso,
  });

  assert.deepEqual(resultado, { messageId: 'x' });
  assert.equal(argsCreateTransport.host, 'mail.akkyhosting11.mx');
  assert.equal(argsCreateTransport.auth.user, 'contacto@pppeltre.mx');
  assert.equal(argsSendMail.from, 'contacto@pppeltre.mx');
  assert.equal(argsSendMail.to, 'conpermiso@pppeltre.mx');
  assert.equal(argsSendMail.subject, 'Nuevo prospecto de mayoreo');
  assert.match(argsSendMail.text, /Juan Perez/);

  limpiarEnvSmtp();
});

test('enviarAlertaMayoreo: manda html (#165, celular como link de WhatsApp) y la vCard como adjunto .vcf', async () => {
  limpiarEnvSmtp();
  process.env.SMTP_USER = 'contacto@pppeltre.mx';
  process.env.SMTP_PASS = 'secreto';

  let argsSendMail = null;
  const nodemailerFalso = {
    createTransport: () => ({ sendMail: async (m) => { argsSendMail = m; return { messageId: 'x' }; } }),
  };

  await enviarAlertaMayoreo(PROSPECTO, { listar: async () => VENDEDORES, nodemailer: nodemailerFalso });

  assert.match(argsSendMail.html, /Juan Perez/);
  assert.match(argsSendMail.html, /https:\/\/wa\.me\/525512345678/);
  assert.equal(argsSendMail.attachments.length, 1);
  assert.equal(argsSendMail.attachments[0].filename, 'prospecto.vcf');
  assert.equal(argsSendMail.attachments[0].contentType, 'text/vcard');
  assert.match(argsSendMail.attachments[0].content, /BEGIN:VCARD[\s\S]*FN:Juan Perez[\s\S]*END:VCARD/);

  limpiarEnvSmtp();
});

test('enviarAlertaMayoreo: un fallo de sendMail se propaga (el caller es quien debe atraparlo, fire-and-forget)', async () => {
  limpiarEnvSmtp();
  process.env.SMTP_USER = 'contacto@pppeltre.mx';
  process.env.SMTP_PASS = 'secreto';

  const nodemailerFalso = {
    createTransport: () => ({ sendMail: async () => { throw new Error('SMTP caido'); } }),
  };

  await assert.rejects(
    () => enviarAlertaMayoreo(PROSPECTO, { listar: async () => VENDEDORES, nodemailer: nodemailerFalso }),
    /SMTP caido/
  );

  limpiarEnvSmtp();
});

test('enviarAlertaMayoreo: sin destinatarios validos, no llama sendMail', async () => {
  limpiarEnvSmtp();
  process.env.SMTP_USER = 'contacto@pppeltre.mx';
  process.env.SMTP_PASS = 'secreto';

  let llamado = false;
  const nodemailerFalso = {
    createTransport: () => ({ sendMail: async () => { llamado = true; } }),
  };

  const resultado = await enviarAlertaMayoreo(PROSPECTO, {
    listar: async () => [{ id: 1, name: 'Sin permiso', role: 'vendedor' }],
    nodemailer: nodemailerFalso,
  });

  assert.equal(resultado, null);
  assert.equal(llamado, false);

  limpiarEnvSmtp();
});
