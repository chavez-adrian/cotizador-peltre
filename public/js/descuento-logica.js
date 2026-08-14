// Descuento comercial por partida (#137). Nucleo puro sin IO: la MISMA regla la
// usan la pantalla (frena la captura del vendedor) y el servidor (rechaza la
// cotizacion que rebase el tope del vendedor autenticado). Nunca dos copias --
// el tope no puede depender de la pantalla.
//
// Glosario (CONTEXT.md, "Descuento (comercial)"): el % se aplica sobre el precio
// de lista del tier vigente y NO mueve el tier. Descontar es permiso, no derecho:
// 0% mientras el admin no asigne tope; el rol admin no tiene tope.

export const TOPE_ADMIN = 100;

export const MENSAJE_SIN_TOPE = 'No tienes permiso para aplicar descuentos; pidelo al administrador.';

const MENSAJE_RANGO = 'El descuento debe ser un porcentaje entre 0 y 100.';

export function mensajeTopeExcedido(tope) {
  return `Tu tope de descuento es ${tope}%.`;
}

// Numero de 0 a 100, o null si el valor no lo es. '' cuenta como 0 (campo vacio).
function porcentaje(valor) {
  if (valor === '' || valor === null || valor === undefined) return 0;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

// Tope tal como se guarda en el registro de vendedores: basura, negativo o
// ausente degradan a 0 (sin permiso), nunca a permiso ilimitado.
export function normalizarTope(valor) {
  if (valor === '' || valor === null || valor === undefined) return 0;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, TOPE_ADMIN);
}

export function topeDescuentoVendedor(vendedor) {
  if (!vendedor) return 0;
  if (vendedor.role === 'admin') return TOPE_ADMIN;
  return normalizarTope(vendedor.topeDescuento);
}

export function puedeDescontar(tope) {
  return normalizarTope(tope) > 0;
}

// Captura de una linea: devuelve el valor ya numerico o el motivo del rechazo.
export function validarDescuentoLinea(valor, tope) {
  const pct = porcentaje(valor);
  if (pct === null) return { ok: false, mensaje: MENSAJE_RANGO };
  const limite = normalizarTope(tope);
  if (pct > limite) {
    return { ok: false, mensaje: limite === 0 ? MENSAJE_SIN_TOPE : mensajeTopeExcedido(limite) };
  }
  return { ok: true, valor: pct };
}

// Todo lo que lleva descuento en una cotizacion: las partidas MAS el envio
// estructurado, que persiste su propio % aparte de la partida ENVIO y se
// restaura al Cargar del historial. Sin el, ese segundo domicilio del mismo
// dato entraria al registro sin pasar por el tope.
export function partidasConDescuento(cotizacion) {
  const c = cotizacion || {};
  const partidas = [...(c.items || [])];
  if (c.envio && c.envio.descuento) partidas.push({ codigo: 'ENVIO', descuento: c.envio.descuento });
  return partidas;
}

// % que muestra el campo "aplicar a todo" (#138, ADR-0011). El descuento global
// no es una entidad propia: se prorratea escribiendo el MISMO % en cada partida,
// asi que el campo no guarda nada -- lee lo que ya tienen las partidas. Si todas
// coinciden dice ese %, y en cuanto el vendedor afina una linea aparte se queda
// en blanco en vez de seguir afirmando un global que ya no existe.
export function descuentoGlobalVigente(partidas) {
  const lista = partidas || [];
  if (!lista.length) return null;
  // Un % fuera de rango (null) no cuenta como 0: deja el campo en blanco en vez
  // de inventar un global comun sobre una partida que ni siquiera es valida.
  const primero = porcentaje(lista[0]?.descuento);
  if (primero === null) return null;
  return lista.every(p => porcentaje(p?.descuento) === primero) ? primero : null;
}

// La cotizacion completa (incluida la partida ENVIO): la primera partida fuera
// del tope la tumba, nombrandola para que el vendedor sepa cual corregir.
export function validarDescuentosCotizacion(items, tope) {
  for (const item of items || []) {
    const r = validarDescuentoLinea(item?.descuento, tope);
    if (!r.ok) return { ok: false, mensaje: `Partida ${item?.codigo || 'sin codigo'}: ${r.mensaje}` };
  }
  return { ok: true };
}
