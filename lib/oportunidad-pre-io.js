// Escritura de la Oportunidad pre-cotizacion (#343, spec #337, ADR-0016).
//
// Mientras la separacion no ha corrido para un Contacto, su Oportunidad ES su
// fila de `prospectos` y se escribe ahi, exactamente como antes de este ticket;
// una vez separada, se escribe en `oportunidades`. La fila fusionada que produce
// lib/oportunidad-pre.js ya sabe cual de las dos es (`propia`), asi que las
// rutas no tienen que preguntarlo: le entregan la Oportunidad y este modulo la
// escribe donde vive.
//
// Es un puente de transicion declarado: cuando toda Oportunidad tenga registro
// propio, el brazo de `prospectos` deja de usarse.

import * as prospectosStore from './prospectos-store.js';
import * as oportunidadesStore from './oportunidades-store.js';
import { planearSeparacion, filaNuevaOportunidad } from './oportunidad-pre.js';

function store(op) {
  return op.propia ? oportunidadesStore : prospectosStore;
}

export async function registrarEvento(op, evento) {
  return store(op).registrarEvento(op.id, evento);
}

export async function cambiarEtapa(op, etapa, evento) {
  return store(op).cambiarEtapa(op.id, etapa, evento);
}

export async function moverASeguimientoConFolio(op, folio, evento) {
  return store(op).moverASeguimientoConFolio(op.id, folio, evento);
}

// Asignar dueno a una tarjeta sin dueno mueve DOS cosas: la Oportunidad (que es
// lo que se trabaja) y, si el Contacto todavia no tiene dueno, tambien el
// Contacto -- si no, la persona seguiria siendo invisible para el vendedor al
// que se le acaba de asignar su unica Oportunidad (la visibilidad del Contacto
// alimenta la herencia de Origen y la clasificacion del celular).
export async function asignarVendedor(op, contacto, vendedor, etapa, evento) {
  const ok = await store(op).asignarVendedor(op.id, vendedor, etapa, evento);
  if (ok && op.propia && contacto && !contacto.vendedor) {
    await prospectosStore.asignarVendedor(contacto.id, vendedor, contacto.etapa, evento);
  }
  return ok;
}

// La "Nueva oportunidad" del Contacto (AC1). Antes de crearla se separa la que
// el Contacto ya tuviera (AC3: "la Oportunidad anterior del mismo Contacto sigue
// donde estaba"): con un registro propio en la tabla, la fila del Contacto deja
// de sintetizar la suya, asi que la de siempre tiene que existir ya como
// registro o desapareceria del tablero. Es la MISMA regla de la migracion
// aplicada a un solo Contacto, asi que un Contacto cuya Oportunidad ya es una
// cotizacion no gana ningun registro por este camino.
export async function abrirNuevaOportunidad(contacto, cotizaciones, vendedor, ahora = new Date()) {
  await separarContacto(contacto, cotizaciones);
  const fila = filaNuevaOportunidad(contacto, vendedor, ahora);
  const id = await oportunidadesStore.crear(fila);
  return { id, ...fila };
}

// Idempotente: si el Contacto ya tiene registro propio no crea ninguno.
export async function separarContacto(contacto, cotizaciones) {
  const propias = (await oportunidadesStore.listar()).filter(o => o.contactoId === contacto.id);
  const [plan] = planearSeparacion([contacto], cotizaciones, propias);
  if (!plan.crear) return null;
  return oportunidadesStore.crear(plan.fila);
}
