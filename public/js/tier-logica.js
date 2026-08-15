// Resolucion de tier: Auto (tabulador por volumen) vs lista fijada (override
// absoluto, issue #98/#151). Nucleo puro sin IO, prefactor pedido por #151: la
// decision vivia solo dentro de getCurrentTier() en app.js. Misma regla la usa
// la pantalla (calcula el carrito) y el servidor (enforcement al guardar),
// patron de descuento-logica.js (#137) -- nunca dos copias.
//
// Glosario (CONTEXT.md, "Lista fijada (override)"): la lista fijada manda de
// forma ABSOLUTA sobre el volumen, en ambas direcciones. #151 acota el permiso
// a rol admin; #153 lo extiende a vendedores con checkbox (prior art:
// topeDescuentoVendedor/normalizarTope en descuento-logica.js, #137).

export const MENSAJE_SIN_PERMISO_TIER = 'No tienes permiso para fijar la lista de precios; pidelo al administrador.';

// El tabulador: el tier mas alto cuyo min_qty cabe en el volumen. tiers[0] por
// omision (carrito vacio) para nunca devolver undefined.
export function tierPorVolumen(tiers, piezasProducto) {
  const lista = tiers || [];
  let actual = lista[0];
  for (const t of lista) {
    if ((piezasProducto || 0) >= t.min_qty) actual = t;
  }
  return actual;
}

// Auto si no hay tierFijadoId, o si el id fijado ya no existe en el catalogo
// vigente (precios.json cambio bajo los pies): degradar a Auto es mas seguro
// que tumbar el calculo del carrito.
export function resolverTier(tiers, piezasProducto, tierFijadoId) {
  const auto = tierPorVolumen(tiers, piezasProducto);
  if (!tierFijadoId) return { tier: auto, fijado: false };
  const fijado = (tiers || []).find(t => t.id === tierFijadoId);
  if (!fijado) return { tier: auto, fijado: false };
  return { tier: fijado, fijado: true };
}

// Aviso bidireccional e informativo (#98): solo con lista fijada, y solo
// cuando difiere de la que daria el tabulador. Nunca bloquea la generacion --
// quien lo consume decide que hacer con el texto.
export function avisoListaFijada(tiers, piezasProducto, tierFijadoId) {
  const { tier, fijado } = resolverTier(tiers, piezasProducto, tierFijadoId);
  if (!fijado) return null;
  const auto = tierPorVolumen(tiers, piezasProducto);
  if (auto.id === tier.id) return null;
  const pzs = (piezasProducto || 0).toLocaleString('es-MX');
  return `Lista fijada: ${tier.id} - el volumen (${pzs} pzs) corresponde a ${auto.id}`;
}

// Enforcement del servidor (#151/#153): un tier ajeno al tabulador solo pasa
// si quien guarda tiene permiso (rol admin, o checkbox por vendedor).
// Releido en cada guardado -- mismo motivo que topeDescuentoDeUsuario en
// server.js: el JWT no se re-emite si el permiso cambia.
//
// tierPrevioEditado (#154): al editar un registro existente, el tier YA
// guardado ahi tambien pasa aunque quien edita no tenga permiso -- corregir
// cantidades o notas no debe tumbar una autorizacion que ya ocurrio. Solo
// aplica al MISMO registro (server.js lo resuelve por cotizacionId); Copiar
// crea un registro nuevo y no lo manda, asi que cae al chequeo normal.
export function validarTierCotizacion(tiers, piezasProducto, tierGuardado, tienePermiso, tierPrevioEditado) {
  if (tienePermiso) return { ok: true };
  const auto = tierPorVolumen(tiers, piezasProducto);
  if (!tierGuardado || tierGuardado === auto.id) return { ok: true };
  if (tierPrevioEditado && tierGuardado === tierPrevioEditado) return { ok: true };
  return { ok: false, mensaje: MENSAJE_SIN_PERMISO_TIER };
}

// Que hereda Editar/Copiar del historial (#154, spec #98) segun el tier
// guardado en el registro y el permiso de quien carga. Nucleo puro compartido
// por cargarCotizacion (app.js) y sus tests: la decision solo depende de si el
// tier guardado ERA una lista fijada (distinto del tabulador para SU volumen)
// y de quien esta cargando -- no de la pantalla.
//
// Editar (mismo registro, mismo folio) conserva la lista fijada SIEMPRE: el
// servidor la deja pasar comparando contra el tier ya guardado del registro
// que se edita (validarTierCotizacion, tierPrevioEditado). Copiar (registro
// nuevo) solo la hereda si quien copia tiene el permiso -- heredarla sin el
// seria auto-otorgarsela.
export function tierAlCargarCotizacion(tiers, piezasProducto, tierGuardado, modo, tienePermiso) {
  const auto = tierPorVolumen(tiers, piezasProducto);
  const eraFijada = !!tierGuardado && tierGuardado !== auto.id;
  if (!eraFijada) return { tierFijado: '', avisoListaPerdida: false };
  if (modo === 'actualizar') return { tierFijado: tierGuardado, avisoListaPerdida: false };
  if (tienePermiso) return { tierFijado: tierGuardado, avisoListaPerdida: false };
  return { tierFijado: '', avisoListaPerdida: true };
}

export const MENSAJE_COPIA_LISTA_FIJADA =
  'La cotizacion original tenia una lista de precios fijada; esta copia arranca en Auto (sin permiso para fijarla).';

// Opciones del selector cuando quien lo ve NO tiene permiso pero esta editando
// una cotizacion cuya lista fijada se conservo (#154): solo Auto (siempre
// agregado aparte por el caller) y el tier ya fijado, nunca el tabulador
// completo -- "dejarla o regresarla a Auto" no es "cambiarla a otra".
export function opcionesTierSelect(tiers, tienePermiso, tierFijado) {
  if (tienePermiso) return tiers || [];
  if (!tierFijado) return [];
  return (tiers || []).filter(t => t.id === tierFijado);
}

// Flag tal como se guarda en el registro de vendedores (#153): basura o
// ausente degradan a false (sin permiso), nunca a permiso implicito. Mismo
// patron que normalizarTope en descuento-logica.js.
export function normalizarPuedeFijarLista(valor) {
  return valor === true;
}

export function puedeFijarLista(vendedor) {
  if (!vendedor) return false;
  if (vendedor.role === 'admin') return true;
  return normalizarPuedeFijarLista(vendedor.puedeFijarLista);
}
