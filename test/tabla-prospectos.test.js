import { test } from 'node:test';
import assert from 'node:assert/strict';

import { estadoProspecto, filaTabla, gafeteDe } from '../lib/tabla-prospectos.js';

// --- #313: quien ya fue contactado ---
// El Toque es la UNICA verdad de "ya lo contacte" (CONTEXT.md "Toque"): de el
// salen el Estado del prospecto, el Ultimo contacto y el conteo. Los fixtures
// llevan la forma real del prospecto del store.

function prospecto313(eventos) {
  return {
    id: 1, fecha: '2026-09-01T10:00:00.000Z', vendedor: 'Memo', celular: '+52 5512345678',
    celular10: '5512345678', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp',
    etapa: 'por_cotizar', eventos, data: {},
  };
}

test('#313: sin toques el prospecto esta sin contactar, sin ultimo contacto y con cero toques', () => {
  const fila = filaTabla(prospecto313([]));
  assert.equal(fila.estado, 'sin_contactar');
  assert.equal(fila.ultimoContacto, null);
  assert.equal(fila.toques, 0);
});

test('#313: con toques el prospecto esta contactado y el ultimo contacto es el mas reciente, no el ultimo del arreglo', () => {
  const fila = filaTabla(prospecto313([
    { tipo: 'toque', fecha: '2026-09-02T09:00:00.000Z', vendedor: 'Memo' },
    { tipo: 'toque', fecha: '2026-08-28T18:30:00.000Z', vendedor: 'Memo' },
  ]));
  assert.equal(fila.estado, 'contactado');
  assert.equal(fila.ultimoContacto, '2026-09-02T09:00:00.000Z');
  assert.equal(fila.toques, 2);
});

test('#313: el estado solo mira los toques, no los demas eventos del prospecto', () => {
  const soloCaptura = estadoProspecto(prospecto313([
    { tipo: 'captura_expo', fecha: '2026-09-01T10:00:00.000Z', vendedor: 'Memo' },
  ]));
  assert.equal(soloCaptura, 'sin_contactar');
});

test('#313: la fila conserva los campos del prospecto que la tabla pinta', () => {
  const fila = filaTabla(prospecto313([]));
  assert.equal(fila.id, 1);
  assert.equal(fila.nombre, 'Laura');
  assert.equal(fila.celular, '+52 5512345678');
  assert.equal(fila.vendedor, 'Memo');
});

// --- #316: gafete ---
// La columna Gafete (CONTEXT.md "Gafete"): dice por cual camino entro el dato,
// no por donde llego el prospecto (eso es Origen). Solo cuentan como captura
// humana los eventos 'captura_expo' y 'captura_publica'; un toque o una
// cotizacion son actividad posterior, no captura.

function prospecto316(data, eventos = []) {
  return {
    id: 1, fecha: '2026-09-01T10:00:00.000Z', vendedor: 'Memo', celular: '+52 5512345678',
    celular10: '5512345678', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp',
    etapa: 'por_cotizar', eventos, data,
  };
}

test('#316: escaneado sin captura humana es solo_gafete', () => {
  const p = prospecto316({ escaneado: '2026-09-01' }, []);
  assert.equal(gafeteDe(p), 'solo_gafete');
});

test('#316: escaneado con captura_expo es gafete_y_stand', () => {
  const p = prospecto316({ escaneado: '2026-09-01' }, [
    { tipo: 'captura_expo', fecha: '2026-09-01T10:00:00.000Z', vendedor: 'Memo' },
  ]);
  assert.equal(gafeteDe(p), 'gafete_y_stand');
});

test('#316: sin escanear es sin_gafete aunque haya captura humana', () => {
  const p = prospecto316({}, [
    { tipo: 'captura_publica', fecha: '2026-09-01T10:00:00.000Z' },
  ]);
  assert.equal(gafeteDe(p), 'sin_gafete');
});

test('#316: un prospecto escaneado con un toque sigue siendo solo_gafete', () => {
  const p = prospecto316({ escaneado: '2026-09-01' }, [
    { tipo: 'toque', fecha: '2026-09-02T09:00:00.000Z', vendedor: 'Memo' },
  ]);
  assert.equal(gafeteDe(p), 'solo_gafete');
});

test('#316: filaTabla agrega gafete', () => {
  const fila = filaTabla(prospecto316({ escaneado: '2026-09-01' }, []));
  assert.equal(fila.gafete, 'solo_gafete');
});

// --- #314: agendado ---
// El escalon Agendado es "Siguiente contacto abierto" (CONTEXT.md "Estado del
// prospecto"): fecha futura, o vencida sin un toque POSTERIOR que la cierre.
// Son las mismas reglas de la cola Hoy, por eso el nucleo reusa
// siguienteContactoFuturo/siguienteContactoVencido en vez de reescribirlas.

const AHORA_314 = new Date('2026-09-10T12:00:00.000Z');

function prospecto314(eventos) {
  return {
    id: 10, fecha: '2026-09-01T10:00:00.000Z', vendedor: 'Memo', celular: '+52 5512345678',
    celular10: '5512345678', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp',
    etapa: 'por_cotizar', eventos, data: {},
  };
}

function siguienteContacto(fechaContacto) {
  return {
    tipo: 'siguiente_contacto', canales: ['WhatsApp'], fecha_contacto: fechaContacto,
    fecha: '2026-09-05T10:00:00.000Z', vendedor: 'Memo',
  };
}

test('#314: un siguiente contacto con fecha futura deja al prospecto agendado', () => {
  const estado = estadoProspecto(prospecto314([
    siguienteContacto('2026-09-15T17:00:00.000Z'),
  ]), [], AHORA_314);
  assert.equal(estado, 'agendado');
});

test('#314: un siguiente contacto vencido que nadie cerro sigue agendado', () => {
  const estado = estadoProspecto(prospecto314([
    siguienteContacto('2026-09-08T17:00:00.000Z'),
  ]), [], AHORA_314);
  assert.equal(estado, 'agendado');
});

test('#314: un toque posterior al compromiso lo cierra y la fila baja a contactado', () => {
  const estado = estadoProspecto(prospecto314([
    siguienteContacto('2026-09-08T17:00:00.000Z'),
    { tipo: 'toque', fecha: '2026-09-09T11:00:00.000Z', vendedor: 'Memo' },
  ]), [], AHORA_314);
  assert.equal(estado, 'contactado');
});

test('#314: un toque ANTERIOR al compromiso vencido no lo cierra y sigue agendado', () => {
  const estado = estadoProspecto(prospecto314([
    { tipo: 'toque', fecha: '2026-09-06T11:00:00.000Z', vendedor: 'Memo' },
    siguienteContacto('2026-09-08T17:00:00.000Z'),
  ]), [], AHORA_314);
  assert.equal(estado, 'agendado');
});
