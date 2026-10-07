// Logica pura del producto decorado / calca (issue #61, GLOSSARY.md "Producto
// decorado (calca)", ADR-0005). Modulo sin efectos de navegador: lo consumen
// server.js (el checklist), app.js y pipeline-logica.js (la calca en la tarjeta)
// y los tests .cjs via import() dinamico. Una sola implementacion, cero copias.
//
// El gate (puedeLiberar) vive aqui, en el dominio puro, para la futura accion
// del cotizador que convierta la cotizacion en pedido (#538). El sync post-venta
// NO lo consulta (#535): refleja lo que Operam ya registro, y el checklist
// incompleto desde Pedido liberado es un aviso (calcaIncompletaAvanzada).

// Los 6 pasos del proceso de autorizaciones de calca, EN ORDEN (GLOSSARY.md).
// Cada paso: clave estable (persistencia/server) + label legible (UI).
export const PASOS_DECORADO = [
  { clave: 'cotizacion_proveedor', label: 'Cotizacion con proveedor de calca' },
  { clave: 'posicion_cliente', label: 'Posicion de calca enviada al Cliente Operam para autorizacion' },
  { clave: 'arte_final', label: 'Arte final enviado al proveedor' },
  { clave: 'dummy_autorizado', label: 'Dummy del proveedor autorizado' },
  { clave: 'liberacion_produccion', label: 'Liberacion de produccion autorizada' },
  { clave: 'archivos_dropbox', label: 'Archivos de posicion de calca subidos a Dropbox' },
];

const CLAVES = PASOS_DECORADO.map(p => p.clave);

// Estado inicial: los 6 pasos sin completar. Forma estable (array en el orden
// canonico) que persiste en data.calcaChecklist de la cotizacion.
export function checklistInicial() {
  return PASOS_DECORADO.map(p => ({ clave: p.clave, completo: false }));
}

// Normaliza cualquier checklist a la forma canonica (6 pasos en orden), tolerando
// ausencia o un checklist incompleto/desordenado. Puro.
function normalizar(checklist) {
  const prev = Array.isArray(checklist) ? checklist : [];
  return PASOS_DECORADO.map(p => {
    const hit = prev.find(x => x && x.clave === p.clave);
    return { clave: p.clave, completo: !!(hit && hit.completo) };
  });
}

function setPaso(checklist, paso, completo) {
  if (!CLAVES.includes(paso)) return normalizar(checklist);
  return normalizar(checklist).map(p =>
    p.clave === paso ? { clave: p.clave, completo } : p
  );
}

// Marca un paso como completado. Puro: devuelve un checklist nuevo, no muta.
// Marcar un paso inexistente devuelve el checklist sin cambios.
export function marcarPaso(checklist, paso) {
  return setPaso(checklist, paso, true);
}

// Revierte un paso a no completado. Puro: devuelve un checklist nuevo, no muta.
export function revertirPaso(checklist, paso) {
  return setPaso(checklist, paso, false);
}

// Progreso del checklist: completos sobre el total de 6 pasos (p. ej. 3/6).
// Tolera un checklist ausente como 0/6.
export function progresoDecorado(checklist) {
  const ch = normalizar(checklist);
  return { completos: ch.filter(p => p.completo).length, total: PASOS_DECORADO.length };
}

// Lee la marca "decorada" de una cotizacion/oportunidad. Acepta el flag en data
// (forma persistida) o al tope (forma de oportunidad del frontend).
export function esDecorada(cotizacion) {
  if (!cotizacion) return false;
  if (cotizacion.decorado === true) return true;
  return !!(cotizacion.data && cotizacion.data.decorado === true);
}

// Gate de decorados (GLOSSARY.md): una oportunidad NO decorada SIEMPRE puede
// liberarse a produccion (true); una decorada solo si los 6 pasos del checklist
// estan completos. Acepta una cotizacion/oportunidad (lee data.calcaChecklist) o
// un checklist crudo (array de pasos). Lo aplicara "Liberar a produccion" (#538).
export function puedeLiberar(arg) {
  if (Array.isArray(arg)) {
    return normalizar(arg).every(p => p.completo);
  }
  if (!esDecorada(arg)) return true;
  const checklist = arg && arg.data ? arg.data.calcaChecklist : arg && arg.calcaChecklist;
  return normalizar(checklist).every(p => p.completo);
}

// Aviso "Calca incompleta" (#535, GLOSSARY.md "Producto decorado (calca)"): la
// decorada ya llego a Pedido liberado o despues -- el tablero sigue a Operam --
// sin los 6 pasos del checklist. Aviso, no candado. Es la UNICA regla que
// consumen la tarjeta y la lista; acepta la marca y el checklist al tope
// (oportunidad del tablero) o en data (forma persistida).
const ETAPAS_AVISO_CALCA = new Set(['pedido_liberado', 'saldo_pagado', 'producto_entregado']);

export function calcaIncompletaAvanzada(o) {
  if (!o || !esDecorada(o) || !ETAPAS_AVISO_CALCA.has(o.etapa)) return false;
  const { completos, total } = progresoDecorado(o.calcaChecklist || (o.data && o.data.calcaChecklist));
  return completos < total;
}
