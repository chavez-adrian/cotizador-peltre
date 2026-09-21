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
//
// #300 suma la SEGUNDA superficie de la misma matriz -- la lista que se le
// ASIGNA a un cliente en el alta o en la edicion --, que vive al final de este
// modulo: mismo permiso, mismo `{ esAdmin, listasHabilitadas }`, y por eso una
// sola fuente para las dos (ADR-0015).

export function mensajeListaNoHabilitada(tierId) {
  return `No tienes habilitada la lista ${tierId}; pide el permiso al administrador.`;
}

// Que tiers participan en el tabulador (#298, ADR-0015): SOLO los escalones de
// volumen, que son los que traen `min_qty`. El catalogo tambien lleva las listas
// sin escalon (Segundas y, desde #299, las de canal y exportacion) para poder
// fijarlas, pero Auto no las puede alcanzar. La pertenencia se decide aqui y no
// en la comparacion contra `min_qty`: sin llave da false por accidente, pero un
// `min_qty: null` daria TRUE (null >= 0) y volveria tabulable lo que no lo es.
// Lo comparte server.js, que separa por aqui las listas de la migracion de #296.
export function esEscalonDeVolumen(tier) {
  return Number.isFinite(tier?.min_qty);
}

// El tabulador: el escalon mas alto cuyo min_qty cabe en el volumen. El primer
// escalon por omision (carrito vacio) para nunca devolver undefined.
export function tierPorVolumen(tiers, piezasProducto) {
  const lista = (tiers || []).filter(esEscalonDeVolumen);
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

// === La lista de precios del CLIENTE (#300, spec #294, ADR-0015) ===
//
// La segunda superficie donde un vendedor elige lista: el alta y la edicion del
// Cliente Operam. Es la misma matriz -- prohibirle cotizar en Segundas y dejarlo
// inscribir clientes en Segundas seria incoherente, y la lista del cliente es MAS
// permanente que la de una cotizacion (queda escrita en el ERP y gobierna lo que
// Operam facture despues).
//
// Lo que cambia respecto de fijar un tier es el universo: aqui las listas son las
// ACTIVAS de Operam (`listas_precios` de GET /api/catalogos, `{ id, nombre }`), no
// los tiers del catalogo de precios. A un cliente se le puede asignar una lista que
// el cotizador todavia no sabe preciar: quien precia en ese campo es el ERP.

// Puede quien trae este permiso ASIGNARLE esta lista a un cliente. El rol admin
// siempre; el resto solo con la celda marcada. Sin lista no hay permiso que dar.
export function puedeAsignarLista(listaId, permiso) {
  if (permiso?.esAdmin) return true;
  const id = String(listaId ?? '').trim();
  if (!id) return false;
  return normalizarListasHabilitadas(permiso?.listasHabilitadas).includes(id);
}

// Opciones del selector de lista del alta/edicion: las habilitadas de quien captura
// MAS la que el cliente ya tiene, aunque no este habilitada -- conservarla siempre
// es valido (mismo principio que la lista fijada previa al editar una cotizacion,
// #154). Sin ninguna habilitada y sin lista actual no hay nada que ofrecer.
export function opcionesListaCliente(listas, permiso, listaActual) {
  const actual = String(listaActual ?? '').trim();
  return (listas || []).filter(l => (actual && String(l.id) === actual) || puedeAsignarLista(l.id, permiso));
}

// El mensaje del rechazo: nombra la lista que se pidio -- el vendedor no tiene por
// que traducir un id de Operam -- y dice las dos salidas reales.
export function mensajeListaClienteNoHabilitada(lista) {
  return `No tienes habilitada la lista de precios ${lista} para asignarsela a un cliente;` +
    ' elige una de tus listas o pide el permiso al administrador.';
}

// Enforcement del guardado, en las dos operaciones del cliente (alta y edicion).
// Tres cosas pasan, y solo una se detiene:
//   - la peticion que no trae lista no toca la del cliente (vacio no es dato, #285);
//   - conservar la que el Cliente Operam YA tiene siempre es valido, aunque quien
//     guarda no la tenga habilitada (la comparacion es contra lo que dice OPERAM,
//     no contra lo que diga el cuerpo de la peticion: eso lo decide el servidor);
//   - cambiarla a una lista no habilitada es lo unico que se rechaza.
// `nombre` es opcional: sin el, el mensaje cita el id.
export function validarListaCliente({ solicitada, actual, permiso, nombre } = {}) {
  const pedida = String(solicitada ?? '').trim();
  if (!pedida) return { ok: true };
  if (String(actual ?? '').trim() === pedida) return { ok: true };
  if (puedeAsignarLista(pedida, permiso)) return { ok: true };
  return { ok: false, mensaje: mensajeListaClienteNoHabilitada(nombre || pedida) };
}

// La lista de precios con la que se COTIZO, como id de sales_type de Operam
// (#403). Es lo que el ENCABEZADO del quote tiene que decir: hasta ahora el quote
// subia con la lista del CLIENTE (Operam la toma de su ficha y la API v3 no acepta
// ninguna llave para cambiarla), asi que un cliente de Menudeo cotizado en Segundas
// quedaba en el ERP con precios de Segundas bajo un encabezado que decia Menudeo --
// y el pedido que se deriva hereda ESE encabezado.
//
// Sale del mismo `listaId` por el que ya cruza el permiso (#296) y que el catalogo
// generado desde el ERP expone en cada tier (#298): una sola fuente, nunca una tabla
// en codigo. null cuando el tier no existe en el catalogo vigente o no trae lista --
// falla cerrado como puedeFijarTier: quien escribe el encabezado se abstiene y lo
// reporta, en vez de inventar una lista.
export function listaIdDeTier(tiers, tierId) {
  const tier = (tiers || []).find(t => t.id === tierId);
  const id = tier?.listaId;
  return id == null || id === '' ? null : String(id);
}
