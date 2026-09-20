// Resolucion de tier: Auto (tabulador por volumen) vs lista fijada (override
// absoluto, issue #98/#151). Nucleo puro sin IO, prefactor pedido por #151: la
// decision vivia solo dentro de getCurrentTier() en app.js. Misma regla la usa
// la pantalla (calcula el carrito) y el servidor (enforcement al guardar),
// patron de descuento-logica.js (#137) -- nunca dos copias.
//
// Glosario (CONTEXT.md, "Lista fijada (override)"): la lista fijada manda de
// forma ABSOLUTA sobre el volumen, en ambas direcciones. #151 acota el permiso
// a rol admin; #153 lo extiende a vendedores con checkbox; #296 (ADR-0015) lo
// vuelve una MATRIZ (vendedor, lista): el permiso es "puede fijar ESTA lista".
//
// El permiso viaja como `{ esAdmin, listasHabilitadas }` -- rol admin puede
// todas sin celdas, y el resto exactamente las listas de Operam marcadas en su
// renglon. El cruce con el tier del cotizador pasa por `listaId`, el id de la
// sales_type de Operam que el catalogo expone en cada tier: una lista marcada
// que el catalogo todavia no precia no vuelve fijable ningun tier.

export function mensajeListaNoHabilitada(tierId) {
  return `No tienes habilitada la lista ${tierId}; pide el permiso al administrador.`;
}

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

// Puede quien trae este permiso fijar ESTE tier (#296). El rol admin siempre;
// el resto solo si la lista de Operam del tier esta en su renglon de la matriz.
// Un tier sin `listaId` (catalogo viejo, o una lista que el ERP ya no tiene) no
// es fijable por nadie mas que el admin: falla cerrado, nunca implicito.
export function puedeFijarTier(tiers, tierId, permiso) {
  if (permiso?.esAdmin) return true;
  const tier = (tiers || []).find(t => t.id === tierId);
  if (!tier || tier.listaId == null || tier.listaId === '') return false;
  return normalizarListasHabilitadas(permiso?.listasHabilitadas).includes(String(tier.listaId));
}

// Enforcement del servidor (#151/#153, por lista desde #296): un tier ajeno al
// tabulador solo pasa si quien guarda tiene habilitada ESA lista (o es admin).
// Releido en cada guardado -- mismo motivo que topeDescuentoDeUsuario en
// server.js: el JWT no se re-emite si el permiso cambia.
//
// tierPrevioEditado (#154): al editar un registro existente, el tier YA
// guardado ahi tambien pasa aunque quien edita no lo tenga habilitado --
// corregir cantidades o notas no debe tumbar una autorizacion que ya ocurrio.
// Solo aplica al MISMO registro (server.js lo resuelve por cotizacionId);
// Copiar crea un registro nuevo y no lo manda, asi que cae al chequeo normal.
export function validarTierCotizacion(tiers, piezasProducto, tierGuardado, permiso, tierPrevioEditado) {
  const auto = tierPorVolumen(tiers, piezasProducto);
  if (!tierGuardado || tierGuardado === auto?.id) return { ok: true };
  if (tierPrevioEditado && tierGuardado === tierPrevioEditado) return { ok: true };
  if (puedeFijarTier(tiers, tierGuardado, permiso)) return { ok: true };
  return { ok: false, mensaje: mensajeListaNoHabilitada(tierGuardado) };
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
// nuevo) solo la hereda si quien copia tiene habilitada ESA lista (#296) --
// heredarla sin ella seria auto-otorgarsela.
export function tierAlCargarCotizacion(tiers, piezasProducto, tierGuardado, modo, permiso) {
  const auto = tierPorVolumen(tiers, piezasProducto);
  const eraFijada = !!tierGuardado && tierGuardado !== auto?.id;
  if (!eraFijada) return { tierFijado: '', avisoListaPerdida: false };
  if (modo === 'actualizar') return { tierFijado: tierGuardado, avisoListaPerdida: false };
  if (puedeFijarTier(tiers, tierGuardado, permiso)) return { tierFijado: tierGuardado, avisoListaPerdida: false };
  return { tierFijado: '', avisoListaPerdida: true };
}

export const MENSAJE_COPIA_LISTA_FIJADA =
  'La cotizacion original tenia una lista de precios fijada; esta copia arranca en Auto (no tienes habilitada esa lista).';

// Que pasa con la lista fijada y que hay que avisar al CAMBIAR DE CLIENTE
// (#385, decision de Adrian 2026-09-14): el cambio se comporta como Copiar
// sobre el carrito actual -- la lista fijada se conserva si quien cotiza tiene
// habilitada ESA lista (#296: `permiso` es la matriz de listas, no un
// booleano) y si no cae a Auto con aviso (misma semantica que
// tierAlCargarCotizacion en modo 'nueva'). Si se estaba EDITANDO (modo
// actualizacion), se avisa que se salio de la edicion: al generar se creara
// una cotizacion nueva y la del folio se queda como estaba.
//
// avisoPrevio: el aviso que ya estaba vigente en esta sesion de cotizacion.
// "Cambiar de cliente" en la tarjeta vuelve a la pantalla de inicio (primera
// preparacion) y elegir al nuevo cliente prepara otra vez (segunda): en la
// segunda ya no hay edicion ni lista que perder, y sin acumular la primera
// el aviso se borraria justo cuando el vendedor lo tiene que leer.
export function estadoAlCambiarCliente({ tiers, piezasProducto, tierFijado, permiso, modoActualizacion, folioOperam, avisoPrevio }) {
  const lista = tierAlCargarCotizacion(tiers, piezasProducto, tierFijado, 'nueva', permiso);
  const previo = avisoPrevio || {};
  const salidaEdicion = !!modoActualizacion || !!previo.salidaEdicion;
  const listaPerdida = lista.avisoListaPerdida || !!previo.listaPerdida;
  if (!salidaEdicion && !listaPerdida) return { tierFijado: lista.tierFijado, aviso: null };
  return {
    tierFijado: lista.tierFijado,
    aviso: {
      salidaEdicion,
      folioOperam: modoActualizacion ? (folioOperam ?? null) : (previo.folioOperam ?? null),
      listaPerdida,
    },
  };
}

// Opciones del selector (#154, por lista desde #296): Auto (siempre agregado
// aparte por el caller) + las listas habilitadas de quien lo ve + la lista ya
// fijada del registro que se edita, aunque no este habilitada -- esa es una
// autorizacion que ya ocurrio, y una vez cambiada deja de ser opcion. Sin
// ninguna habilitada y sin lista fijada no hay opciones: el selector se oculta.
export function opcionesTierSelect(tiers, permiso, tierFijado) {
  return (tiers || []).filter(t => (tierFijado && t.id === tierFijado) || puedeFijarTier(tiers, t.id, permiso));
}

// Flag tal como se guardaba en el registro de vendedores (#153): basura o
// ausente degradan a false (sin permiso), nunca a permiso implicito. Mismo
// patron que normalizarTope en descuento-logica.js. Desde #296 ya NO decide
// nada: sobrevive como el unico insumo de la migracion de lectura de abajo.
export function normalizarPuedeFijarLista(valor) {
  return valor === true;
}

// Listas habilitadas tal como se guardan en el registro (#296, ADR-0015): una
// coleccion de ids de lista de Operam (la celda referencia la lista por su id
// numerico, estable ante renombres). Todo lo que no sea un arreglo -- y toda
// entrada que no sea un id -- degrada a sin permiso, nunca a permiso implicito
// (mismo patron que normalizarTope y normalizarPuedeFijarLista).
export function normalizarListasHabilitadas(valor) {
  if (!Array.isArray(valor)) return [];
  const ids = valor
    .filter(v => typeof v === 'string' || typeof v === 'number')
    .map(v => String(v).trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

// Las listas habilitadas VIGENTES de un registro de vendedor, con la migracion
// de lectura del permiso binario de #153 (ADR-0015): el flag viejo se queda en
// la tabla solo como insumo de esta funcion. Campo nuevo presente = manda el
// campo (la lista vacia es "ninguna", no "sin configurar"); campo ausente y
// flag encendido = los escalones de volumen que el cotizador ya conocia; sin
// flag, ninguna. `listasVolumen` son los ids de esos escalones, que salen del
// catalogo vigente (tiers) -- no de una tabla copiada aqui.
export function listasHabilitadasDeVendedor(vendedor, listasVolumen) {
  const guardadas = vendedor?.listasHabilitadas;
  if (guardadas === undefined || guardadas === null) {
    return normalizarPuedeFijarLista(vendedor?.puedeFijarLista)
      ? normalizarListasHabilitadas(listasVolumen)
      : [];
  }
  return normalizarListasHabilitadas(guardadas);
}
