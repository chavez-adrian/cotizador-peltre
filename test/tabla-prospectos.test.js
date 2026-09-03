import { test } from 'node:test';
import assert from 'node:assert/strict';

import { estadoProspecto, filaTabla, gafeteDe, queFalta, LLAVES_QUE_FALTA } from '../lib/tabla-prospectos.js';

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

// --- #321: que falta (prospectos) ---
// 'calificacion' solo aplica a un prospecto DE EVENTO (misma regla del aviso
// "Calificacion pendiente" de la tarjeta, CONTEXT.md "Que sigue / Que falta").
// 'datos_fiscales' y 'domicilio' los agrega #322 y aqui NUNCA se emiten.

function prospecto321(data) {
  return {
    id: 80, fecha: '2026-09-01T10:00:00.000Z', vendedor: 'Memo', celular: '+52 5512345678',
    celular10: '5512345678', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp',
    etapa: 'por_cotizar', eventos: [], data,
  };
}

test('#321: LLAVES_QUE_FALTA tiene las cuatro llaves en orden fijo', () => {
  assert.deepEqual(LLAVES_QUE_FALTA, ['calificacion', 'correo', 'datos_fiscales', 'domicilio']);
});

test('#321: prospecto de evento sin calificacion incluye calificacion, en el orden fijo con correo', () => {
  const huecos = queFalta(prospecto321({ evento: 'Abastur 2026', correo: '' }));
  assert.deepEqual(huecos, ['calificacion', 'correo']);
});

test('#321: prospecto de evento con calificacion parcial no incluye calificacion', () => {
  const huecos = queFalta(prospecto321({
    evento: 'Abastur 2026', correo: 'laura@ejemplo.com', calificacion: { anios: '1-5 años' },
  }));
  assert.equal(huecos.includes('calificacion'), false);
});

test('#321: prospecto sin evento y sin calificacion no reclama calificacion', () => {
  const huecos = queFalta(prospecto321({ correo: 'laura@ejemplo.com' }));
  assert.equal(huecos.includes('calificacion'), false);
});

test('#321: sin correo incluye correo', () => {
  const huecos = queFalta(prospecto321({ evento: 'Abastur 2026', calificacion: { anios: '1-5 años' } }));
  assert.deepEqual(huecos, ['correo']);
});

test('#321: con correo y calificacion no falta nada', () => {
  const huecos = queFalta(prospecto321({
    evento: 'Abastur 2026', correo: 'laura@ejemplo.com', calificacion: { anios: '1-5 años' },
  }));
  assert.deepEqual(huecos, []);
});

test('#321: filaTabla agrega queFalta', () => {
  const fila = filaTabla(prospecto321({ evento: 'Abastur 2026', correo: '' }));
  assert.deepEqual(fila.queFalta, ['calificacion', 'correo']);
});

// --- #317: cualquier prospecto, Origen y /prospectos ---
// El Origen del glosario (CONTEXT.md "Origen") es el `canal` del prospecto. La
// fila lo trae resuelto por origenDe para que la pantalla filtre por el mismo
// campo que pintan el pipeline, el Historial y Hoy.

function prospecto317(canal) {
  return {
    id: 1, fecha: '2026-09-01T10:00:00.000Z', vendedor: 'Memo', celular: '+52 5512345678',
    celular10: '5512345678', nombre: 'Laura', ciudad: 'Puebla', canal,
    etapa: 'por_cotizar', eventos: [], data: {},
  };
}

test('#317: la fila trae el Origen del prospecto', () => {
  assert.equal(filaTabla(prospecto317('Instagram')).origen, 'Instagram');
});

test('#317: sin origen capturado la fila trae origen vacio', () => {
  assert.equal(filaTabla(prospecto317('')).origen, '');
});

// --- #315: cotizado y cliente ---
// Los dos escalones de arriba de CONTEXT.md "Estado del prospecto", con la
// precedencia completa: cliente > cotizado > agendado > contactado >
// sin_contactar. Cotizado tiene DOS fuentes (el evento de cotizacion del
// prospecto y el arreglo de cotizaciones ligadas que resolvera #319) porque el
// glosario dice "tiene al menos una cotizacion", no "tiene el evento".

const AHORA_315 = new Date('2026-09-10T12:00:00.000Z');

function prospecto315(eventos, data = {}) {
  return {
    id: 20, fecha: '2026-09-01T10:00:00.000Z', vendedor: 'Memo', celular: '+52 5512345678',
    celular10: '5512345678', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp',
    etapa: 'por_cotizar', eventos, data,
  };
}

test('#315: una cotizacion gana al siguiente contacto abierto y el prospecto queda cotizado', () => {
  const estado = estadoProspecto(prospecto315([
    { tipo: 'siguiente_contacto', canales: ['WhatsApp'], fecha_contacto: '2026-09-15T17:00:00.000Z', fecha: '2026-09-05T10:00:00.000Z', vendedor: 'Memo' },
    { tipo: 'cotizacion', cotizacion_id: 600, fecha: '2026-09-06T10:00:00.000Z', vendedor: 'Memo' },
  ]), [], AHORA_315);
  assert.equal(estado, 'cotizado');
});

test('#315: una cotizacion ligada sin evento tambien deja al prospecto cotizado', () => {
  const estado = estadoProspecto(prospecto315([
    { tipo: 'toque', fecha: '2026-09-02T09:00:00.000Z', vendedor: 'Memo' },
  ]), [{ id: 600 }], AHORA_315);
  assert.equal(estado, 'cotizado');
});

test('#315: el cliente ligado gana a la cotizacion y el prospecto queda en cliente', () => {
  const estado = estadoProspecto(prospecto315([
    { tipo: 'cotizacion', cotizacion_id: 600, fecha: '2026-09-06T10:00:00.000Z', vendedor: 'Memo' },
    { tipo: 'cliente', cliente_id: 4321, nombre: 'Laura', fecha: '2026-09-07T10:00:00.000Z' },
  ], { cliente_id: 4321 }), [], AHORA_315);
  assert.equal(estado, 'cliente');
});

test('#315: filaTabla trae el clienteId ligado', () => {
  const fila = filaTabla(prospecto315([], { cliente_id: 4321 }), [], AHORA_315);
  assert.equal(fila.clienteId, 4321);
  assert.equal(fila.estado, 'cliente');
});

test('#315: filaTabla trae clienteId null cuando el prospecto no es cliente', () => {
  const fila = filaTabla(prospecto315([]), [], AHORA_315);
  assert.equal(fila.clienteId, null);
  assert.equal(fila.estado, 'sin_contactar');
});
