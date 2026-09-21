// #399 (hijo de #354): el panel de subidas decia "Subido" sin distinguir el
// Dropbox real del sandbox de la app. Aqui se prueba el nucleo PURO que responde
// las dos preguntas del panel -- contra que escribe cada flujo HOY (estado, no
// evento) y donde cayo cada fila --, sin red y sin tocar process.env.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estadoDeFlujos, lugarDeSubida } from '../lib/dropbox-destinos.js';

const CSF_SANDBOX = '/PELTRE NACIONAL/3.0 ADMINISTRACI\u00d3N/CONTABILIDAD/PNA170810CF1/CONSTANCIA SITUACION FISCAL CLIENTES';

test('estadoDeFlujos devuelve los tres flujos, configurados o no, con su base', () => {
  const flujos = estadoDeFlujos({ DROPBOX_NS_CSF: '123', DROPBOX_PATH_CSF: '/CSF/' });
  assert.deepEqual(flujos.map(f => f.flujo), ['csf', 'calca', 'bitrix']);
  assert.deepEqual(flujos[0], { flujo: 'csf', configurado: true, namespace: '123', base: '/CSF' });
  assert.equal(flujos[1].configurado, false);
  assert.equal(flujos[1].namespace, null);
  assert.equal(flujos[1].base, '/1.0 Comercializaci\u00f3n/DISE\u00d1O/CALCAS/OT Decorado');
  assert.equal(flujos[2].configurado, false);
});

test('un flujo configurado contra la raiz del namespace tiene base "/" y no cadena vacia', () => {
  const [csf] = estadoDeFlujos({ DROPBOX_NS_CSF: '123', DROPBOX_PATH_CSF: '/' });
  assert.equal(csf.configurado, true);
  assert.equal(csf.base, '/');
});

test('una fila con namespace registrado cayo en el Dropbox real, contra ese namespace', () => {
  const lugar = lugarDeSubida({ flujo: 'csf', destino: '/AAA010101AA1 - Uno.pdf', namespace: '5835633' });
  assert.deepEqual(lugar, { tipo: 'namespace', namespace: '5835633', inferido: false });
});

// Sin namespace guardado el lugar sale SIEMPRE de la ruta, en las dos
// direcciones: la fila no puede afirmar con certeza lo que nadie anoto.
test('una fila historica bajo la ruta heredada del flujo cayo en el sandbox', () => {
  const lugar = lugarDeSubida({ flujo: 'csf', destino: `${CSF_SANDBOX}/CARA830713D53 - Uno.pdf` }, {});
  assert.deepEqual(lugar, { tipo: 'sandbox', namespace: null, inferido: true });
});

// Las filas del 2026-09-21 entre la carga de las variables en Render y el
// deploy de #399: viajaron con namespace pero el registro aun no lo guardaba.
// Su ruta es RELATIVA al namespace, asi que no cuelga de la ruta heredada.
test('una fila sin namespace registrado y fuera de la ruta heredada se infiere como namespace', () => {
  const lugar = lugarDeSubida({ flujo: 'csf', destino: '/CARA830713D53 - Uno.pdf', namespace: null }, {});
  assert.deepEqual(lugar, { tipo: 'namespace', namespace: null, inferido: true });
});

test('la ruta heredada de bitrix respeta BITRIX_EXPORT_DROPBOX_PATH al clasificar', () => {
  const env = { BITRIX_EXPORT_DROPBOX_PATH: '/OTRO DESTINO/BITRIX/' };
  assert.equal(lugarDeSubida({ flujo: 'bitrix', destino: '/OTRO DESTINO/BITRIX/2026-08-16/leads.json' }, env).tipo, 'sandbox');
});

test('un prefijo que solo se parece a la ruta heredada no cuenta como sandbox', () => {
  const lugar = lugarDeSubida({ flujo: 'csf', destino: `${CSF_SANDBOX} 2/x.pdf` }, {});
  assert.equal(lugar.tipo, 'namespace');
});

test('una fila de un flujo que ya no existe no revienta: sin namespace es sandbox', () => {
  assert.deepEqual(lugarDeSubida({ flujo: 'desconocido', destino: '/x/y.pdf' }, {}), { tipo: 'sandbox', namespace: null, inferido: true });
});
