import { test } from 'node:test';
import assert from 'node:assert/strict';

import { estadoProspecto, filaTabla } from '../lib/tabla-prospectos.js';

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
