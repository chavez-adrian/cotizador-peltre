import { test } from 'node:test';
import assert from 'node:assert/strict';

import { estadoProspecto, filaTabla, gafeteDe, queFalta, queSigue, LLAVES_QUE_FALTA, cotizacionesDelProspecto, cotizacionesVivas } from '../lib/tabla-prospectos.js';

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

// --- #318: que sigue (prospectos) ---
// Una sola accion en palabras derivada del Estado del prospecto (CONTEXT.md
// "Que sigue / Que falta"). El umbral de la sugerencia de No util sale de
// SUGERIR_NO_UTIL_TOQUES (lib/seguimiento-prospectos.js), no de un literal: es
// la MISMA cadencia que ya corre en la cola Hoy.

const AHORA_318 = new Date('2026-09-10T12:00:00.000Z');

function prospecto318(eventos) {
  return {
    id: 50, fecha: '2026-09-01T10:00:00.000Z', vendedor: 'Memo', celular: '+52 5512345678',
    celular10: '5512345678', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp',
    etapa: 'por_cotizar', eventos, data: {},
  };
}

test('#318: sin contactar lo que sigue es escribirle', () => {
  assert.deepEqual(queSigue(prospecto318([]), [], AHORA_318), { tipo: 'escribirle', accion: 'Escribirle' });
});

function toque(fecha) {
  return { tipo: 'toque', fecha, vendedor: 'Memo' };
}

test('#318: contactado con un toque pide insistir y dice cuantos toques van', () => {
  const q = queSigue(prospecto318([toque('2026-09-02T09:00:00.000Z')]), [], AHORA_318);
  assert.deepEqual(q, { tipo: 'insistir', accion: 'Insistir (toque 1 de 3)', toques: 1 });
});

test('#318: contactado con dos toques sigue pidiendo insistir', () => {
  const q = queSigue(prospecto318([
    toque('2026-09-02T09:00:00.000Z'),
    toque('2026-09-04T09:00:00.000Z'),
  ]), [], AHORA_318);
  assert.deepEqual(q, { tipo: 'insistir', accion: 'Insistir (toque 2 de 3)', toques: 2 });
});

test('#318: al tercer toque el sistema SUGIERE la salida a No util, nunca la aplica', () => {
  const q = queSigue(prospecto318([
    toque('2026-09-02T09:00:00.000Z'),
    toque('2026-09-04T09:00:00.000Z'),
    toque('2026-09-08T09:00:00.000Z'),
  ]), [], AHORA_318);
  assert.deepEqual(q, {
    tipo: 'sugerir_no_util', accion: 'Sugerir No útil (3 toques sin respuesta)', toques: 3,
  });
});

// La accion del escalon Agendado se afirma como cadena COMPLETA con un reloj y
// un compromiso fijos: es el texto que el vendedor lee en la fila. El formato
// de la fecha es el mismo dia corto del chip de la tarjeta (es-MX, 'mar 15 de
// sep' tal como lo entrega Node).
function siguienteContacto318(fechaContacto, canales) {
  return {
    tipo: 'siguiente_contacto', canales, fecha_contacto: fechaContacto,
    fecha: '2026-09-05T10:00:00.000Z', vendedor: 'Memo',
  };
}

test('#318: agendado con un canal dice el canal y la fecha del compromiso', () => {
  const q = queSigue(prospecto318([
    siguienteContacto318('2026-09-15T17:00:00.000Z', ['WhatsApp']),
  ]), [], AHORA_318);
  assert.deepEqual(q, {
    tipo: 'agendado', accion: 'WhatsApp el mar 15 de sep', canales: ['WhatsApp'],
    fecha: '2026-09-15T17:00:00.000Z', vencido: false,
  });
});

test('#318: agendado con dos canales los suma en el orden en que se acordaron', () => {
  const q = queSigue(prospecto318([
    siguienteContacto318('2026-09-15T17:00:00.000Z', ['WhatsApp', 'Correo']),
  ]), [], AHORA_318);
  assert.equal(q.accion, 'WhatsApp + Correo el mar 15 de sep');
  assert.deepEqual(q.canales, ['WhatsApp', 'Correo']);
});

test('#318: un compromiso vencido y sin cerrar lo dice al final de la accion', () => {
  const q = queSigue(prospecto318([
    siguienteContacto318('2026-09-08T17:00:00.000Z', ['Llamada']),
  ]), [], AHORA_318);
  assert.deepEqual(q, {
    tipo: 'agendado', accion: 'Llamada el mar 8 de sep (vencido)', canales: ['Llamada'],
    fecha: '2026-09-08T17:00:00.000Z', vencido: true,
  });
});

test('#318: filaTabla agrega queSigue', () => {
  const fila = filaTabla(prospecto318([]), [], AHORA_318);
  assert.deepEqual(fila.queSigue, { tipo: 'escribirle', accion: 'Escribirle' });
});

// --- #319: cotizaciones del prospecto ---
// El prospecto y sus cotizaciones se ligan por DOS caminos, porque ninguno
// solo alcanza: el evento 'cotizacion' que el prospecto guarda al cotizar, y
// el celular del cliente de la cotizacion (la llave de identidad del glosario,
// 1 celular = 1 prospecto), que rescata las cotizaciones nacidas sin pasar por
// la tarjeta del prospecto.

function prospecto319(eventos = [], over = {}) {
  return {
    id: 60, fecha: '2026-08-15T10:00:00.000Z', vendedor: 'Memo', celular: '+52 5512345678',
    celular10: '5512345678', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp',
    etapa: 'seguimiento', eventos, data: {}, ...over,
  };
}

function eventoCotizacion(cotizacionId, fecha = '2026-08-18T10:00:00.000Z') {
  return { tipo: 'cotizacion', cotizacion_id: cotizacionId, fecha, vendedor: 'Memo' };
}

function cot319(over = {}) {
  const { cliente: sobreCliente, ...resto } = over;
  return {
    id: 600, fecha: '2026-08-20T10:00:00.000Z', vendedor: 'Memo', cliente: 'LA LUPITA',
    total: 15000, totalPiezas: 200, tier: 'M100', estado: 'abierta', etapa: 'seguimiento',
    folioOperam: 1141, registroDesconocido: false, seguimientos: [],
    data: {
      cliente: {
        razonSocial: 'LA LUPITA', nombreCorto: 'La Lupita', rfc: 'XAXX010101000',
        telefono: '5599887766', celEntrega: '', customerId: 900, ...sobreCliente,
      },
    },
    ...resto,
  };
}

test('#319: el evento de cotizacion liga la cotizacion aunque el cliente traiga otro telefono', () => {
  const p = prospecto319([eventoCotizacion(600)]);
  const ligadas = cotizacionesDelProspecto(p, [cot319(), cot319({ id: 601 })]);
  assert.deepEqual(ligadas.map(c => c.id), [600]);
});

test('#319: el celular del cliente liga la cotizacion aunque el prospecto no tenga el evento', () => {
  const p = prospecto319([]);
  const porTelefono = cot319({ id: 610, cliente: { telefono: '+52 55 1234 5678' } });
  const ligadas = cotizacionesDelProspecto(p, [porTelefono, cot319({ id: 611 })]);
  assert.deepEqual(ligadas.map(c => c.id), [610]);
});

test('#319: el celular de entrega tambien liga', () => {
  const p = prospecto319([]);
  const porEntrega = cot319({ id: 620, cliente: { celEntrega: '5512345678' } });
  assert.deepEqual(cotizacionesDelProspecto(p, [porEntrega]).map(c => c.id), [620]);
});

test('#319: una cotizacion ligada por los dos caminos aparece una sola vez', () => {
  const p = prospecto319([eventoCotizacion(630)]);
  const ambas = cot319({ id: 630, cliente: { telefono: '5512345678' } });
  assert.equal(cotizacionesDelProspecto(p, [ambas]).length, 1);
});

test('#319: sin celular10 la liga usa los ultimos 10 digitos del celular', () => {
  const p = prospecto319([], { celular10: undefined });
  const porTelefono = cot319({ id: 640, cliente: { telefono: '5512345678' } });
  assert.deepEqual(cotizacionesDelProspecto(p, [porTelefono]).map(c => c.id), [640]);
});

// El orden es el de CONTEXT.md "Que sigue / Que falta": con varias cotizaciones
// vivas la MAS AVANZADA en el embudo manda. Los fixtures entran al reves del
// resultado esperado para que el orden de entrada no pueda dar el test por
// bueno.

test('#319: la cotizacion mas avanzada en el embudo va primero', () => {
  const p = prospecto319([eventoCotizacion(650), eventoCotizacion(651)]);
  const ligadas = cotizacionesDelProspecto(p, [
    cot319({ id: 650, etapa: 'por_cotizar' }),
    cot319({ id: 651, etapa: 'seguimiento' }),
  ]);
  assert.deepEqual(ligadas.map(c => c.id), [651, 650]);
});

test('#319: un anticipo pagado va antes que un seguimiento', () => {
  const p = prospecto319([eventoCotizacion(652), eventoCotizacion(653)]);
  const ligadas = cotizacionesDelProspecto(p, [
    cot319({ id: 652, etapa: 'seguimiento' }),
    cot319({ id: 653, etapa: 'anticipo_pagado' }),
  ]);
  assert.deepEqual(ligadas.map(c => c.id), [653, 652]);
});

test('#319: a igual etapa manda la mas reciente', () => {
  const p = prospecto319([eventoCotizacion(654), eventoCotizacion(655)]);
  const ligadas = cotizacionesDelProspecto(p, [
    cot319({ id: 654, etapa: 'seguimiento', fecha: '2026-08-10T10:00:00.000Z' }),
    cot319({ id: 655, etapa: 'seguimiento', fecha: '2026-08-25T10:00:00.000Z' }),
  ]);
  assert.deepEqual(ligadas.map(c => c.id), [655, 654]);
});

test('#319: las salidas del embudo van al final aunque sean las mas recientes', () => {
  const p = prospecto319([eventoCotizacion(656), eventoCotizacion(657)]);
  const ligadas = cotizacionesDelProspecto(p, [
    cot319({ id: 656, etapa: 'no_util', fecha: '2026-08-30T10:00:00.000Z' }),
    cot319({ id: 657, etapa: 'por_cotizar', fecha: '2026-08-01T10:00:00.000Z' }),
  ]);
  assert.deepEqual(ligadas.map(c => c.id), [657, 656]);
});

test('#319: cotizacionesVivas deja fuera las salidas del embudo', () => {
  const vivas = cotizacionesVivas([
    cot319({ id: 660, etapa: 'seguimiento' }),
    cot319({ id: 661, etapa: 'no_util' }),
    cot319({ id: 662, etapa: 'perdida' }),
  ]);
  assert.deepEqual(vivas.map(c => c.id), [660]);
});

// Que sigue para Cotizado: la accion se afirma como cadena COMPLETA -- es el
// texto que el vendedor lee en la fila -- y el numero que nombra la cotizacion
// es SIEMPRE el folio, nunca el id interno (ADR-0009, CONTEXT.md "Numero de la
// cotizacion"). El reloj es fijo para poder afirmar el dia de cadencia.
const AHORA_319 = new Date('2026-09-10T12:00:00.000Z');

function cotizadoQueSigue(cots) {
  return queSigue(prospecto319([]), cots, AHORA_319);
}

test('#319: cotizado el mismo dia todavia no tiene paso de cadencia', () => {
  const q = cotizadoQueSigue([cot319({ fecha: '2026-09-09T12:00:00.000Z' })]);
  assert.equal(q.accion, 'Seguimiento a la #Operam 1141, enviada hoy');
  assert.equal(q.paso, null);
  assert.equal(q.dias, 1);
});

test('#319: al dia 2 la fila pide el seguimiento del dia 2 con el folio de la cotizacion', () => {
  const q = cotizadoQueSigue([cot319({ fecha: '2026-09-08T12:00:00.000Z' })]);
  assert.deepEqual(q, {
    tipo: 'seguimiento', accion: 'Seguimiento a la #Operam 1141, día 2',
    cotizacionId: 600, folio: '#Operam 1141', paso: 'dia2', dias: 2, masCotizaciones: 0,
  });
});

test('#319: al dia 7 la fila pide el seguimiento del dia 7', () => {
  const q = cotizadoQueSigue([cot319({ fecha: '2026-09-03T12:00:00.000Z' })]);
  assert.equal(q.accion, 'Seguimiento a la #Operam 1141, día 7');
});

test('#319: al dia 21 la fila pide el seguimiento del dia 21', () => {
  const q = cotizadoQueSigue([cot319({ fecha: '2026-08-20T12:00:00.000Z' })]);
  assert.equal(q.accion, 'Seguimiento a la #Operam 1141, día 21');
});

test('#319: pasado el dia 28 la fila dice que la cotizacion esta vencida', () => {
  const q = cotizadoQueSigue([cot319({ fecha: '2026-08-13T12:00:00.000Z' })]);
  assert.equal(q.accion, 'Seguimiento a la #Operam 1141, vencida');
});

test('#319: una pre-cotizacion se nombra PRE, nunca con su id interno', () => {
  const q = cotizadoQueSigue([cot319({ fecha: '2026-09-08T12:00:00.000Z', folioOperam: null })]);
  assert.equal(q.accion, 'Seguimiento a la PRE, día 2');
  assert.equal(q.folio, 'PRE');
});

test('#319: con varias vivas manda la primera y la fila avisa cuantas mas hay', () => {
  const q = cotizadoQueSigue([
    cot319({ id: 670, fecha: '2026-09-08T12:00:00.000Z', folioOperam: 1141 }),
    cot319({ id: 671, fecha: '2026-09-08T12:00:00.000Z', folioOperam: 1140 }),
  ]);
  assert.equal(q.accion, 'Seguimiento a la #Operam 1141, día 2 y 1 más');
  assert.equal(q.masCotizaciones, 1);
  assert.equal(q.cotizacionId, 670);
});

test('#319: cotizado sin ninguna cotizacion viva pide cotizarle de nuevo', () => {
  const q = queSigue(prospecto319([eventoCotizacion(680)]), [], AHORA_319);
  assert.deepEqual(q, { tipo: 'cotizado', accion: 'Cotizarle de nuevo', masCotizaciones: 0 });
});

test('#319: con todas las cotizaciones fuera del embudo tambien pide cotizarle de nuevo', () => {
  const q = cotizadoQueSigue([cot319({ id: 681, etapa: 'perdida' })]);
  assert.equal(q.accion, 'Cotizarle de nuevo');
});

test('#319: la fila lleva las cotizaciones con su folio, su etapa y su fecha', () => {
  const fila = filaTabla(prospecto319([]), [cot319({ fecha: '2026-09-08T12:00:00.000Z' })], AHORA_319);
  assert.deepEqual(fila.cotizaciones, [{
    id: 600, folio: '#Operam 1141', folioOperam: 1141, etapa: 'seguimiento',
    fecha: '2026-09-08T12:00:00.000Z',
  }]);
});

test('#319: una cotizacion fuera del embudo no cuenta como viva pero si viaja en la fila', () => {
  const fila = filaTabla(prospecto319([]), [
    cot319({ id: 690, fecha: '2026-09-08T12:00:00.000Z' }),
    cot319({ id: 691, fecha: '2026-09-08T12:00:00.000Z', etapa: 'no_util', folioOperam: 1142 }),
  ], AHORA_319);
  assert.deepEqual(fila.cotizaciones.map(c => c.id), [690, 691]);
  assert.equal(fila.queSigue.masCotizaciones, 0);
});

// --- #320: que sigue (clientes) ---
// El escalon Ya es cliente (CONTEXT.md "Que sigue / Que falta"): se responde con
// lo que el cotizador YA guarda -- el sync post-venta ya escribio la etapa y el
// estado de pago --, nunca consultando Operam en vivo. Reloj fijo para poder
// afirmar el dia de cadencia.
const AHORA_320 = new Date('2026-09-10T12:00:00.000Z');

function cliente320(eventos = [], over = {}) {
  return {
    id: 70, fecha: '2026-08-15T10:00:00.000Z', vendedor: 'Memo', celular: '+52 5512345678',
    celular10: '5512345678', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp',
    etapa: 'seguimiento', eventos, data: { cliente_id: 900 }, ...over,
  };
}

test('#320: un cliente sin ninguna cotizacion es una fuga: lo que sigue es cotizarle', () => {
  const q = queSigue(cliente320(), [], AHORA_320);
  assert.deepEqual(q, { tipo: 'cotizarle', accion: 'Cotizarle', masCotizaciones: 0 });
});

// La cotizacion del cliente es la MISMA forma del store que ya usa #319; lo
// unico que agrega este escalon es el espejo del sync post-venta, que es donde
// vive el estado de pago que el cotizador ya guarda.
function cot320({ pago, ...over } = {}) {
  const base = cot319({ id: 700, ...over });
  return pago ? { ...base, data: { ...base.data, espejoOperam: { pago } } } : base;
}

test('#320: el cliente con anticipo pagado lee la etapa que el sync ya conoce, con el folio', () => {
  const q = queSigue(cliente320(), [cot320({ etapa: 'anticipo_pagado' })], AHORA_320);
  assert.deepEqual(q, {
    tipo: 'etapa', etapa: 'anticipo_pagado', accion: 'Anticipo pagado (#Operam 1141)',
    cotizacionId: 700, folio: '#Operam 1141', masCotizaciones: 0, pago: null,
  });
});

test('#320: el cliente con pedido liberado lo dice con el nombre de la etapa del pipeline', () => {
  const q = queSigue(cliente320(), [cot320({ etapa: 'pedido_liberado' })], AHORA_320);
  assert.equal(q.accion, 'Pedido liberado (#Operam 1141)');
});

test('#320: el cliente con saldo pagado lo dice con el nombre de la etapa del pipeline', () => {
  const q = queSigue(cliente320(), [cot320({ etapa: 'saldo_pagado' })], AHORA_320);
  assert.equal(q.accion, 'Saldo pagado (#Operam 1141)');
});

test('#320: el cliente con producto entregado lo dice con el nombre de la etapa del pipeline', () => {
  const q = queSigue(cliente320(), [cot320({ etapa: 'producto_entregado' })], AHORA_320);
  assert.equal(q.accion, 'Producto entregado (#Operam 1141)');
});

test('#320: el estado de pago viaja tal como lo dejo el sync post-venta', () => {
  const q = queSigue(cliente320(), [cot320({ etapa: 'anticipo_pagado', pago: 'anticipo' })], AHORA_320);
  assert.equal(q.pago, 'anticipo');
});

test('#320: el cliente con una cotizacion todavia en seguimiento lee lo mismo que un cotizado', () => {
  const q = queSigue(cliente320(), [cot320({ etapa: 'seguimiento', fecha: '2026-09-03T12:00:00.000Z' })], AHORA_320);
  assert.deepEqual(q, {
    tipo: 'seguimiento', accion: 'Seguimiento a la #Operam 1141, día 7',
    cotizacionId: 700, folio: '#Operam 1141', paso: 'dia7', dias: 7, masCotizaciones: 0,
  });
});

// Una historica de registro desconocido (anterior a #63) no tiene badge de
// folio: sin respaldo el texto salia "Seguimiento a la , dia 2".
function cot320Historica(over = {}) {
  return cot320({ folioOperam: null, registroDesconocido: true, ...over });
}

test('#320: una cotizacion historica sin folio se nombra con la palabra cotizacion, no en blanco', () => {
  const q = queSigue(cliente320(), [cot320Historica({ fecha: '2026-09-08T12:00:00.000Z' })], AHORA_320);
  assert.equal(q.accion, 'Seguimiento a la cotización, día 2');
  assert.equal(q.folio, '');
});

test('#320: la etapa post-venta de una historica tambien se nombra con esa palabra', () => {
  const q = queSigue(cliente320(), [cot320Historica({ etapa: 'anticipo_pagado' })], AHORA_320);
  assert.equal(q.accion, 'Anticipo pagado (cotización)');
  assert.equal(q.folio, '');
});

test('#320: un cotizado con historica se nombra igual (misma regla, un solo lugar)', () => {
  const q = queSigue(prospecto319([]), [cot320Historica({ fecha: '2026-09-08T12:00:00.000Z' })], AHORA_320);
  assert.equal(q.accion, 'Seguimiento a la cotización, día 2');
});

// Con varias vivas la fila avisa "y N mas". El orden no se escribe a mano: se
// pide a cotizacionesDelProspecto, que es quien lo decide en la ruta.
test('#320: entre dos vivas manda la mas avanzada y la fila avisa que hay una mas', () => {
  const p = cliente320([eventoCotizacion(701), eventoCotizacion(702)]);
  const ligadas = cotizacionesDelProspecto(p, [
    cot320({ id: 702, etapa: 'seguimiento', folioOperam: 1141, fecha: '2026-09-08T12:00:00.000Z' }),
    cot320({ id: 701, etapa: 'anticipo_pagado', folioOperam: 1150 }),
  ]);
  const q = queSigue(p, ligadas, AHORA_320);
  assert.equal(q.tipo, 'etapa');
  assert.equal(q.accion, 'Anticipo pagado (#Operam 1150) y 1 más');
  assert.equal(q.cotizacionId, 701);
  assert.equal(q.masCotizaciones, 1);
});

test('#320: a igual etapa manda la mas reciente', () => {
  const p = cliente320([eventoCotizacion(703), eventoCotizacion(704)]);
  const ligadas = cotizacionesDelProspecto(p, [
    cot320({ id: 703, etapa: 'pedido_liberado', folioOperam: 1160, fecha: '2026-09-01T10:00:00.000Z' }),
    cot320({ id: 704, etapa: 'pedido_liberado', folioOperam: 1161, fecha: '2026-09-05T10:00:00.000Z' }),
  ]);
  const q = queSigue(p, ligadas, AHORA_320);
  assert.equal(q.accion, 'Pedido liberado (#Operam 1161) y 1 más');
  assert.equal(q.cotizacionId, 704);
});

test('#320: una No util no es viva y no se cuenta en el aviso de cuantas mas hay', () => {
  const p = cliente320([eventoCotizacion(705), eventoCotizacion(706)]);
  const ligadas = cotizacionesDelProspecto(p, [
    cot320({ id: 705, etapa: 'no_util', folioOperam: 1170 }),
    cot320({ id: 706, etapa: 'saldo_pagado', folioOperam: 1171 }),
  ]);
  const q = queSigue(p, ligadas, AHORA_320);
  assert.equal(q.accion, 'Saldo pagado (#Operam 1171)');
  assert.equal(q.masCotizaciones, 0);
});

// --- #322: que falta (clientes) ---
// Los huecos del CLIENTE salen de lo que el cotizador YA GUARDA de la subida a
// Operam (#81/#83) -- la cotizacion de referencia -- y nunca de una consulta a
// Operam (CONTEXT.md "Que sigue / Que falta"). Sin ninguna cotizacion ligada no
// hay evidencia y no se inventan huecos.

function prospecto322(data = {}) {
  return {
    id: 90, fecha: '2026-09-01T10:00:00.000Z', vendedor: 'Memo', celular: '+52 5512345678',
    celular10: '5512345678', nombre: 'Laura', ciudad: 'Puebla', canal: 'WhatsApp',
    etapa: 'seguimiento', eventos: [],
    data: { correo: 'laura@ejemplo.com', cliente_id: 507, ...data },
  };
}

function cot322(cliente = {}, over = {}) {
  return {
    id: 900, fecha: '2026-08-20T10:00:00.000Z', vendedor: 'Memo', cliente: 'LA LUPITA',
    etapa: 'seguimiento', folioOperam: 1141,
    data: {
      cliente: {
        razonSocial: 'LA LUPITA', nombreCorto: 'La Lupita', rfc: 'CPE921211N76',
        telefono: '5512345678', celEntrega: '', calle: 'Hamburgo 100', colonia: 'Juarez',
        cpEntrega: '06600', municipio: 'Cuauhtemoc', customerId: 507, ...cliente,
      },
    },
    ...over,
  };
}

test('#322: el cliente cuya cotizacion salio con RFC generico reclama datos fiscales', () => {
  const huecos = queFalta(prospecto322(), [cot322({ rfc: 'XAXX010101000' })]);
  assert.deepEqual(huecos, ['datos_fiscales']);
});

test('#322: el cliente extranjero con el generico XEXX tambien reclama datos fiscales', () => {
  const huecos = queFalta(prospecto322(), [cot322({ rfc: 'xexx010101000' })]);
  assert.deepEqual(huecos, ['datos_fiscales']);
});

test('#322: el cliente cuya cotizacion salio con RFC real no reclama datos fiscales', () => {
  const huecos = queFalta(prospecto322(), [cot322()]);
  assert.deepEqual(huecos, []);
});

test('#322: el cliente cuya cotizacion salio sin calle reclama domicilio de entrega', () => {
  const huecos = queFalta(prospecto322(), [cot322({ calle: '' })]);
  assert.deepEqual(huecos, ['domicilio']);
});

test('#322: el cliente cuya cotizacion salio sin CP reclama domicilio de entrega', () => {
  const huecos = queFalta(prospecto322(), [cot322({ cpEntrega: '  ' })]);
  assert.deepEqual(huecos, ['domicilio']);
});

test('#322: el cliente con calle y CP en su cotizacion no reclama domicilio de entrega', () => {
  const huecos = queFalta(prospecto322(), [cot322()]);
  assert.equal(huecos.includes('domicilio'), false);
});

test('#322: el cliente sin ninguna cotizacion ligada no reclama nada: sin evidencia no se inventan huecos', () => {
  const huecos = queFalta(prospecto322(), []);
  assert.deepEqual(huecos, []);
});

test('#322: el prospecto que todavia no es cliente no reclama datos fiscales ni domicilio, aunque su cotizacion sea generica', () => {
  const huecos = queFalta(
    prospecto322({ cliente_id: undefined }),
    [cot322({ rfc: 'XAXX010101000', calle: '' })]
  );
  assert.deepEqual(huecos, []);
});

test('#322: con dos cotizaciones del mismo cliente manda la mas reciente, no la vieja generica', () => {
  const vieja = cot322({ rfc: 'XAXX010101000', calle: '' }, { id: 901, fecha: '2026-07-01T10:00:00.000Z' });
  const nueva = cot322({}, { id: 902, fecha: '2026-08-20T10:00:00.000Z' });
  assert.deepEqual(queFalta(prospecto322(), [vieja, nueva]), []);
  assert.deepEqual(queFalta(prospecto322(), [nueva, vieja]), []);
});

test('#322: la referencia es la cotizacion subida A ESE cliente, aunque otra ligada mas reciente sea de otro', () => {
  const deOtroCliente = cot322(
    { customerId: 611, rfc: 'XAXX010101000', calle: '' },
    { id: 903, fecha: '2026-08-30T10:00:00.000Z' }
  );
  const delCliente = cot322({}, { id: 904, fecha: '2026-08-01T10:00:00.000Z' });
  assert.deepEqual(queFalta(prospecto322(), [deOtroCliente, delCliente]), []);
});

test('#322: el customerId guardado como texto es el mismo cliente que el cliente_id numerico', () => {
  const referencia = cot322({ customerId: '507', rfc: 'XAXX010101000' }, { id: 905 });
  const otra = cot322({ customerId: 611, calle: '' }, { id: 906, fecha: '2026-08-30T10:00:00.000Z' });
  assert.deepEqual(queFalta(prospecto322(), [otra, referencia]), ['datos_fiscales']);
});

test('#322: con las cuatro llaves presentes el orden de salida es el de LLAVES_QUE_FALTA', () => {
  const huecos = queFalta(
    prospecto322({ evento: 'Abastur 2026', correo: '' }),
    [cot322({ rfc: 'XAXX010101000', calle: '' })]
  );
  assert.deepEqual(huecos, ['calificacion', 'correo', 'datos_fiscales', 'domicilio']);
  assert.deepEqual(huecos, LLAVES_QUE_FALTA);
});
