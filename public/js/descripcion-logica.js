// Descripcion de partida (#139). Nucleo puro sin IO: la MISMA regla la usan la
// pantalla (frena la captura del vendedor), el builder de items del documento y el
// servidor (rechaza la cotizacion cuyo texto no cabe en Operam).
//
// Glosario (CONTEXT.md, "Descripcion de partida"): el texto que describe la partida
// en el documento del cliente y en el quote del ERP. Precargado con el del catalogo;
// el vendedor puede reescribirlo para hablarle al cliente en sus terminos.

// El limite es el maxlength REAL del textarea item_description del formulario de
// edicion de linea de Operam (fixture quote-1216-form-edit0.html), no una preferencia
// de estilo: un texto mas largo no cabe en el ERP.
export const MAX_DESCRIPCION = 1000;

export const MENSAJE_LARGA = `La descripcion no puede pasar de ${MAX_DESCRIPCION} caracteres (es el limite de Operam).`;

const texto = (v) => String(v ?? '');

// Captura de una linea. Devuelve el texto que queda y si cuenta como EDITADA, que es
// lo unico que decide si el robot de la web legacy corre la ronda de edicion por
// partida al actualizar el quote: dejar la del catalogo intacta no debe costar dos
// POSTs de mas por linea. Vaciar el campo deshace la edicion (regresa a la del
// catalogo) en vez de dejar la partida sin describir.
export function validarDescripcionLinea(valor, catalogo) {
  const capturado = texto(valor);
  if (capturado.length > MAX_DESCRIPCION) return { ok: false, mensaje: MENSAJE_LARGA };
  // Se guarda el texto ya recortado: los espacios de sobra de la captura viajarian
  // tal cual al documento del cliente y al quote de Operam.
  const limpio = capturado.trim();
  const base = texto(catalogo);
  if (!limpio || limpio === base.trim()) return { ok: true, descripcion: base, editada: false };
  return { ok: true, descripcion: limpio, editada: true };
}

// La cotizacion completa, del lado del servidor: la primera partida que no cabe la
// tumba, nombrandola para que el vendedor sepa cual recortar.
export function validarDescripcionesCotizacion(items) {
  for (const item of items || []) {
    if (texto(item?.descripcion).length > MAX_DESCRIPCION) {
      return { ok: false, mensaje: `Partida ${item?.codigo || 'sin codigo'}: ${MENSAJE_LARGA}` };
    }
  }
  return { ok: true };
}
