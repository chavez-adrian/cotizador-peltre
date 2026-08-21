import { test } from 'node:test';
import assert from 'node:assert/strict';

import { registrarBarrido } from '../lib/contactos-observabilidad-io.js';

// Envoltura IO de la observabilidad de barridos (issue #230): TODO inyectado
// (leer/guardar/listarVendedores/nodemailer/ahora), sin tocar Neon ni SMTP
// reales, mismo patron que test/alerta-mayoreo-io.test.js. Nunca debe lanzar:
// un fallo de Neon o de SMTP no puede tumbar el barrido que lo llama.

function storeFalso(inicial = {}) {
  const datos = { ...inicial };
  return {
    datos,
    leer: async (nombre) => datos[nombre] || null,
    guardar: async (nombre, estado) => { datos[nombre] = estado; return true; },
  };
}

const VENDEDOR = { id: 1, name: 'Admin', role: 'admin', puedeAsignar: true, email: 'admin@pppeltre.mx' };

function limpiarEnvSmtp() {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_SECURE;
  delete process.env.ALERTA_ADMIN_EMAIL;
}

test('registrarBarrido: una pasada exitosa se persiste, sin correo', async () => {
  limpiarEnvSmtp();
  const store = storeFalso();
  let sendMailLlamado = false;
  const nodemailerFalso = { createTransport: () => { sendMailLlamado = true; return { sendMail: async () => {} }; } };

  await registrarBarrido('prospectos', { omitido: null, creados: 1, actualizados: 0, inactivados: 0, errores: [] }, {
    ...store, listarVendedores: async () => [VENDEDOR], nodemailer: nodemailerFalso, ahora: new Date('2026-08-21T12:00:00Z'),
  });

  assert.equal(store.datos.prospectos.ultimaCorridaExitosa, '2026-08-21T12:00:00.000Z');
  assert.equal(sendMailLlamado, false, 'sin SMTP configurado, ni siquiera se crea transporte');
});

test('registrarBarrido: un barrido omitido por falta de credenciales no escribe estado', async () => {
  const store = storeFalso();
  await registrarBarrido('prospectos', { omitido: 'sin credenciales', creados: 0, actualizados: 0, inactivados: 0, errores: [] }, store);
  assert.equal(store.datos.prospectos, undefined);
});

test('registrarBarrido: si ya habia estado y el barrido se omite, NO se reescribe (ni siquiera sin cambios) en cada tick', async () => {
  const previo = {
    ultimaCorrida: '2026-08-19T00:00:00.000Z', ultimaCorridaExitosa: '2026-08-19T00:00:00.000Z',
    creados: 1, actualizados: 0, inactivados: 0, errores: [], ultimoAviso: null,
  };
  const store = storeFalso({ prospectos: previo });
  let guardadoLlamado = 0;
  const guardarQueCuenta = async (nombre, estado) => { guardadoLlamado += 1; store.datos[nombre] = estado; };

  await registrarBarrido('prospectos', { omitido: 'sin credenciales', creados: 0, actualizados: 0, inactivados: 0, errores: [] }, {
    leer: store.leer, guardar: guardarQueCuenta,
  });

  assert.equal(guardadoLlamado, 0, 'un barrido omitido no debe reescribir el estado ya guardado');
  assert.equal(store.datos.prospectos, previo, 'el estado previo queda intacto');
});

test('registrarBarrido: superado el umbral sin corrida exitosa, manda el correo por la envoltura SMTP existente', async () => {
  limpiarEnvSmtp();
  process.env.SMTP_USER = 'contacto@pppeltre.mx';
  process.env.SMTP_PASS = 'secreto';

  const previo = {
    ultimaCorrida: '2026-08-19T00:00:00.000Z', ultimaCorridaExitosa: '2026-08-19T00:00:00.000Z',
    creados: 0, actualizados: 0, inactivados: 0, errores: [], ultimoAviso: null,
  };
  const store = storeFalso({ prospectos: previo });
  let argsSendMail = null;
  const nodemailerFalso = {
    createTransport: () => ({ sendMail: async (m) => { argsSendMail = m; return { messageId: 'x' }; } }),
  };

  await registrarBarrido('prospectos', { omitido: null, creados: 0, actualizados: 0, inactivados: 0, errores: [{ celular10: '1', motivo: 'Google People 401: expirado' }] }, {
    ...store, listarVendedores: async () => [VENDEDOR], nodemailer: nodemailerFalso, ahora: new Date('2026-08-21T12:00:00Z'),
  });

  assert.ok(argsSendMail, 'debio mandar el correo de aviso');
  assert.equal(argsSendMail.to, 'admin@pppeltre.mx');
  assert.match(argsSendMail.subject, /prospectos/);
  assert.equal(store.datos.prospectos.ultimoAviso, '2026-08-21T12:00:00.000Z', 'se persiste la fecha del aviso');

  limpiarEnvSmtp();
});

test('registrarBarrido: el mismo dia no repite el correo aunque siga sin corrida exitosa', async () => {
  limpiarEnvSmtp();
  process.env.SMTP_USER = 'contacto@pppeltre.mx';
  process.env.SMTP_PASS = 'secreto';

  const previo = {
    ultimaCorrida: '2026-08-19T00:00:00.000Z', ultimaCorridaExitosa: '2026-08-19T00:00:00.000Z',
    creados: 0, actualizados: 0, inactivados: 0, errores: [],
    ultimoAviso: '2026-08-21T10:00:00.000Z',
  };
  const store = storeFalso({ prospectos: previo });
  let llamado = 0;
  const nodemailerFalso = { createTransport: () => ({ sendMail: async () => { llamado += 1; } }) };

  await registrarBarrido('prospectos', { omitido: null, creados: 0, actualizados: 0, inactivados: 0, errores: [{ celular10: '1', motivo: 'Google People 401: x' }] }, {
    ...store, listarVendedores: async () => [VENDEDOR], nodemailer: nodemailerFalso, ahora: new Date('2026-08-21T12:00:00Z'),
  });

  assert.equal(llamado, 0);

  limpiarEnvSmtp();
});

test('registrarBarrido: una corrida limpia despues de una racha de fallos deja de avisar', async () => {
  limpiarEnvSmtp();
  process.env.SMTP_USER = 'contacto@pppeltre.mx';
  process.env.SMTP_PASS = 'secreto';

  const previo = {
    ultimaCorrida: '2026-08-19T00:00:00.000Z', ultimaCorridaExitosa: null,
    creados: 0, actualizados: 0, inactivados: 0, errores: [{ celular10: '1', motivo: 'x', categoria: 'autorizacion' }],
    ultimoAviso: '2026-08-20T00:00:00.000Z',
  };
  const store = storeFalso({ prospectos: previo });
  let llamado = 0;
  const nodemailerFalso = { createTransport: () => ({ sendMail: async () => { llamado += 1; } }) };

  await registrarBarrido('prospectos', { omitido: null, creados: 1, actualizados: 0, inactivados: 0, errores: [] }, {
    ...store, listarVendedores: async () => [VENDEDOR], nodemailer: nodemailerFalso, ahora: new Date('2026-08-21T12:00:00Z'),
  });

  assert.equal(llamado, 0, 'la corrida de hoy fue limpia: no hay motivo para avisar');
  assert.equal(store.datos.prospectos.ultimaCorridaExitosa, '2026-08-21T12:00:00.000Z');

  limpiarEnvSmtp();
});

test('registrarBarrido: un fallo al leer/guardar el estado no lanza (nunca debe tumbar el barrido)', async () => {
  const storeRoto = {
    leer: async () => { throw new Error('Neon caido'); },
    guardar: async () => { throw new Error('Neon caido'); },
  };
  await assert.doesNotReject(
    registrarBarrido('prospectos', { omitido: null, creados: 1, actualizados: 0, inactivados: 0, errores: [] }, storeRoto)
  );
});

test('registrarBarrido: un fallo al mandar el correo no lanza ni impide que el estado quede guardado', async () => {
  limpiarEnvSmtp();
  process.env.SMTP_USER = 'contacto@pppeltre.mx';
  process.env.SMTP_PASS = 'secreto';

  const previo = {
    ultimaCorrida: '2026-08-19T00:00:00.000Z', ultimaCorridaExitosa: '2026-08-19T00:00:00.000Z',
    creados: 0, actualizados: 0, inactivados: 0, errores: [], ultimoAviso: null,
  };
  const store = storeFalso({ prospectos: previo });
  const nodemailerFalso = { createTransport: () => ({ sendMail: async () => { throw new Error('SMTP caido'); } }) };

  await assert.doesNotReject(registrarBarrido('prospectos', { omitido: null, creados: 0, actualizados: 0, inactivados: 0, errores: [{ celular10: '1', motivo: 'x' }] }, {
    ...store, listarVendedores: async () => [VENDEDOR], nodemailer: nodemailerFalso, ahora: new Date('2026-08-21T12:00:00Z'),
  }));

  assert.ok(store.datos.prospectos, 'el estado de la corrida se guarda aunque el correo falle');

  limpiarEnvSmtp();
});
