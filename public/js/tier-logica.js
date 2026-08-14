// Resolucion de tier: Auto (tabulador por volumen) vs lista fijada (override
// absoluto, issue #98/#151). Nucleo puro sin IO, prefactor pedido por #151: la
// decision vivia solo dentro de getCurrentTier() en app.js. Misma regla la usa
// la pantalla (calcula el carrito) y el servidor (enforcement al guardar),
// patron de descuento-logica.js (#137) -- nunca dos copias.
//
// Glosario (CONTEXT.md, "Lista fijada (override)"): la lista fijada manda de
// forma ABSOLUTA sobre el volumen, en ambas direcciones. #151 acota el permiso
// a rol admin (la extension a vendedores con checkbox es #153).

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

// Enforcement del servidor (#151): un tier ajeno al tabulador solo pasa si
// quien guarda es admin. Releido en cada guardado -- mismo motivo que
// topeDescuentoDeUsuario en server.js: el JWT no se re-emite si el rol cambia.
export function validarTierCotizacion(tiers, piezasProducto, tierGuardado, esAdmin) {
  if (esAdmin) return { ok: true };
  const auto = tierPorVolumen(tiers, piezasProducto);
  if (!tierGuardado || tierGuardado === auto.id) return { ok: true };
  return { ok: false, mensaje: MENSAJE_SIN_PERMISO_TIER };
}
