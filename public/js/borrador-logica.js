// Nucleo puro del borrador de cotizacion (issue #179, spec #178; CONTEXT.md
// "Borrador de cotizacion"). Sin efectos de navegador: aqui vive QUE se guarda,
// COMO se lee y QUE se restaura; el localStorage, el DOM y el enganche del
// autosave son pegamento en app.js.
import { esCodigoCalca, productoCalca } from './calcas-logica.js';
import { escapeHtml } from './prospectos-logica.js';

// El formato viaja versionado dentro del payload, no en la llave: una version
// desconocida se descarta en silencio (nunca se migra a ciegas) y la llave del
// vendedor sigue siendo una sola.
export const VERSION_BORRADOR = 1;

// Umbrales de la restauracion (CONTEXT.md "Borrador de cotizacion"): media hora
// es la ventana en la que volver es obviamente la misma sesion de trabajo; 30
// dias es mas que la vigencia de cualquier cotizacion, asi que despues no queda
// nada que valga la pena resucitar.
export const MINUTOS_RESTAURACION_SILENCIOSA = 30;
export const DIAS_VIDA_BORRADOR = 30;

export const RESTAURACION = {
  SILENCIOSA: 'silenciosa',
  PROMPT: 'prompt',
  EXPIRADO: 'expirado',
};

// Una linea del borrador guarda la INTENCION del vendedor -- codigo, cantidad,
// descuento y descripcion editada -- y nada mas. El precio y el resto de la
// ficha se re-resuelven contra el catalogo vigente al restaurar.
function normalizarLinea(linea) {
  const codigo = linea && linea.codigo ? String(linea.codigo) : '';
  const cantidad = Number(linea && linea.cantidad);
  if (!codigo || !Number.isFinite(cantidad) || cantidad <= 0) return null;
  const salida = { codigo, cantidad };
  const descuento = Number(linea.descuento);
  if (Number.isFinite(descuento) && descuento > 0) salida.descuento = descuento;
  const descripcion = typeof linea.descripcion === 'string' ? linea.descripcion.trim() : '';
  if (descripcion) salida.descripcion = descripcion;
  return salida;
}

export function serializarBorrador({
  carrito, decorado, ahora,
  cliente, contactoNuevo, envio, tierFijado, vigenciaDias, vendedorConfirmado,
  modoActualizacion, cotizacionId, folioOperam,
} = {}) {
  const lineas = (carrito || []).map(normalizarLinea).filter(Boolean);
  const borrador = { v: VERSION_BORRADOR, actualizado: Number(ahora) || 0, carrito: lineas };
  // La marca de decorado viaja SOLO en true, igual que hacia Operam (#91): un
  // false guardado seria una marca apagada explicita, y apagarla es un acto del
  // vendedor, no un derivado de que el borrador no la traiga.
  if (decorado === true) borrador.decorado = true;
  // Cliente elegido o contacto nuevo a medio capturar (#180, spec #178): son
  // mutuamente excluyentes en el paso Cliente -- el que llega se guarda TAL
  // CUAL, sin validar ni re-resolver. A diferencia del carrito, aqui no hay
  // catalogo contra el que checar: el cliente restaurado es el mismo cliente,
  // con o sin cambios en Operam entre medio.
  if (cliente && typeof cliente === 'object') borrador.cliente = cliente;
  else if (contactoNuevo && typeof contactoNuevo === 'object') borrador.contactoNuevo = contactoNuevo;
  // Envio estructurado (#102): el mismo shape que persiste la cotizacion al
  // generar. Se restaura tal cual, sin volver a cotizar contra las paqueterias.
  if (envio && typeof envio === 'object') borrador.envio = envio;
  // Lista fijada (#151): '' (Auto) no se guarda porque es identico a la
  // ausencia de la llave -- ambos restauran a Auto.
  if (tierFijado) borrador.tierFijado = tierFijado;
  const vig = Number(vigenciaDias);
  if (Number.isFinite(vig) && vig > 0) borrador.vigenciaDias = vig;
  // vendedorConfirmado viaja SOLO en true, mismo patron que decorado: false es
  // el default implicito de la ausencia de la llave.
  if (vendedorConfirmado === true) borrador.vendedorConfirmado = true;
  // Modo Editar (#104/#184, spec #178): el binding COMPLETO al registro y al
  // folio originales -- sin el, generar desde la sesion restaurada crearia una
  // cotizacion nueva por accidente en vez de reescribir la que el vendedor
  // esta editando. Viaja SOLO cuando el binding esta completo: registro Y
  // folio, los tres juntos o nada -- igual que en vivo, donde el gate
  // puedeActualizarCotizacion exige folioOperam para siquiera ofrecer modo
  // Editar (cotizaciones-logica.js, buildAvisoModoActualizacion: "el folio
  // SIEMPRE existe en este modo"). Guardar modoActualizacion sin folio
  // resucitaria esa invariante rota: el aviso al restaurar caeria a "PRE" para
  // una cotizacion que por definicion ya esta registrada. El gate de Editar NO
  // se re-valida aqui: eso queda para el 409 existente al generar, decision
  // explicita del spec.
  if (modoActualizacion === true && cotizacionId && folioOperam != null && folioOperam !== '') {
    borrador.modoActualizacion = true;
    borrador.cotizacionId = String(cotizacionId);
    borrador.folioOperam = folioOperam;
  }
  return borrador;
}

// Texto de localStorage (u objeto ya parseado) -> borrador utilizable, o null.
// null es "no hay nada que restaurar" para TODOS los motivos -- version ajena,
// JSON roto, forma imposible --: el borrador es una comodidad, nunca un error
// que interrumpa al vendedor. Las llaves que no conoce se conservan tal cual,
// para que los slices siguientes (cliente, envio, vigencia) las agreguen sin
// tocar esta puerta.
export function deserializarBorrador(crudo) {
  let obj = crudo;
  if (typeof crudo === 'string') {
    try { obj = JSON.parse(crudo); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object') return null;
  if (obj.v !== VERSION_BORRADOR) return null;
  if (!Array.isArray(obj.carrito)) return null;
  const actualizado = Number(obj.actualizado);
  if (!Number.isFinite(actualizado) || actualizado <= 0) return null;
  return { ...obj, actualizado, carrito: obj.carrito.map(normalizarLinea).filter(Boolean) };
}

// Que hacer con un borrador dado el reloj de ahora. null = no hay borrador.
// Una edad NEGATIVA (el reloj del telefono atrasado, o el borrador escrito con
// el reloj adelantado) cuenta como recien tocado: el error de reloj nunca puede
// costarle el trabajo al vendedor.
export function decidirRestauracion(borrador, ahora) {
  if (!borrador || !Number.isFinite(Number(borrador.actualizado))) return null;
  const edad = Number(ahora) - Number(borrador.actualizado);
  if (edad > DIAS_VIDA_BORRADOR * 24 * 60 * 60 * 1000) return RESTAURACION.EXPIRADO;
  if (edad > MINUTOS_RESTAURACION_SILENCIOSA * 60 * 1000) return RESTAURACION.PROMPT;
  return RESTAURACION.SILENCIOSA;
}

export const MOTIVOS_LINEA_INVALIDA = {
  SIN_CATALOGO: 'sin-catalogo',
};

// Partida cuyo codigo ya no existe en el catalogo vigente. Vuelve al carrito
// SIN precios -- `prices` vacio, no un cero -- para que nada la cotice por
// accidente: es una linea que el vendedor tiene que corregir, no un articulo.
export function productoSinCatalogo(codigo) {
  return { key: codigo, name: codigo, model: codigo, prices: {}, sinCatalogo: true };
}

// Codigo persistido -> producto del catalogo de HOY, con la misma forma que
// arma app.js al agregar al carrito (SKU completo, price key o calca). Devuelve
// null cuando el codigo ya no existe. Es el UNICO camino de "codigo guardado ->
// producto vigente": lo comparten la restauracion del borrador (#179) y Cargar
// del historial (#83/#104), que antes resolvia la calca por su cuenta.
export function resolverProductoDelCatalogo(codigo, catalogo) {
  if (!codigo || !catalogo) return null;
  if (esCodigoCalca(codigo)) {
    const ficha = (catalogo.calcas || []).find(c => c && c.code === codigo);
    return ficha ? productoCalca(ficha) : null;
  }
  const productos = catalogo.products || [];
  const sku = (catalogo.skus || []).find(s => s && s.sku === codigo);
  if (sku) {
    const base = productos.find(p => p.key === sku.priceKey);
    if (!base) return null;
    return {
      key: codigo,
      name: sku.nombre,
      model: sku.tipo + sku.tamano,
      weight_kg: base.weight_kg,
      prices: base.prices,
    };
  }
  return productos.find(p => p.key === codigo) || null;
}

// El carrito del borrador contra el catalogo vigente. Los precios NUNCA salen
// del borrador: la intencion (que, cuanto, con que descuento y con que texto)
// es del vendedor y el precio es del catalogo de hoy (CONTEXT.md "Borrador de
// cotizacion"). El orden de captura se conserva, invalidas incluidas, para que
// el carrito restaurado se lea igual al que se dejo.
export function reResolverCarrito(borrador, catalogo) {
  const lineas = [];
  const codigosSinCatalogo = [];
  if (!borrador || !catalogo) return { lineas, codigosSinCatalogo };
  for (const linea of borrador.carrito || []) {
    const product = resolverProductoDelCatalogo(linea.codigo, catalogo);
    if (!product) codigosSinCatalogo.push(linea.codigo);
    lineas.push({
      codigo: linea.codigo,
      cantidad: linea.cantidad,
      descuento: linea.descuento || 0,
      descripcion: linea.descripcion || '',
      product: product || productoSinCatalogo(linea.codigo),
      motivo: product ? null : MOTIVOS_LINEA_INVALIDA.SIN_CATALOGO,
    });
  }
  return { lineas, codigosSinCatalogo };
}

// Llave del borrador en el dispositivo. Lleva el vendedor porque el telefono se
// presta: nadie ve ni pisa el borrador de otro. La version NO va aqui (vive
// dentro del payload) para que un formato viejo se pueda leer y descartar en
// vez de quedarse ocupando su propia llave para siempre.
export function llaveBorrador(vendedorId) {
  const id = vendedorId === 0 || vendedorId ? String(vendedorId) : '';
  return id ? `borrador:cotizacion:${id}` : null;
}

// Que evento del ciclo de vida mata el borrador (spec #178). Salir de la sesion
// NO lo mata -- es el cambio deliberado respecto a la conducta previa de limpiar
// el carrito al salir --, y lo desconocido tampoco: el default seguro es
// conservar el trabajo del vendedor.
export const EVENTOS_BORRADOR = {
  GENERACION_EXITOSA: 'generacion-exitosa',
  NUEVA_COTIZACION: 'nueva-cotizacion',
  DESCARTADO: 'descartado',
  EXPIRADO: 'expirado',
  LOGOUT: 'logout',
  SESION_EXPIRADA: 'sesion-expirada',
};

const EVENTOS_QUE_MATAN = new Set([
  EVENTOS_BORRADOR.GENERACION_EXITOSA,
  EVENTOS_BORRADOR.NUEVA_COTIZACION,
  EVENTOS_BORRADOR.DESCARTADO,
  EVENTOS_BORRADOR.EXPIRADO,
]);

export function borradorMuerePorEvento(evento) {
  return EVENTOS_QUE_MATAN.has(evento);
}

// Compuerta de generacion, espejo de bloqueaGeneracionPorCalcaSinPrecio (#91):
// una partida cuyo codigo ya no existe no tiene precio, y sin freno el `?? 0`
// de getPrice la mandaria al documento y al quote en $0 -- justo el dato
// fantasma que la restauracion promete no producir.
export function bloqueaGeneracionPorPartidaSinCatalogo(codigos) {
  return (codigos || []).length > 0;
}

export function avisoPartidaSinCatalogo(codigos) {
  return `Estas partidas ya no existen en el catalogo: ${(codigos || []).join(', ')}. `
    + 'Quitalas o vuelve a capturarlas: no se puede generar un documento con una partida sin precio.';
}

// === Prompt Continuar / Descartar (#181, CONTEXT.md "Borrador de cotizacion") ===
// >30 minutos desde el ultimo autosave: en vez de restaurar en silencio, el
// vendedor decide. Estas funciones arman lo que el prompt necesita mostrar;
// el overlay y los botones son pegamento en app.js.

// Antiguedad legible del ultimo autosave: minutos bajo la hora, horas bajo el
// dia, dias despues -- singular vs plural porque "hace 1 minutos" se lee mal.
// Una edad negativa o basura no puede pasar aqui en la practica (decidirRestauracion
// ya filtro SILENCIOSA/EXPIRADO), pero se acota a 0 por si acaso: el prompt
// nunca muestra una antiguedad absurda.
export function antiguedadLegible(ms) {
  const minutos = Math.floor(Math.max(0, Number(ms) || 0) / 60000);
  if (minutos < 1) return 'hace un momento';
  if (minutos < 60) return `hace ${minutos} minuto${minutos === 1 ? '' : 's'}`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} hora${horas === 1 ? '' : 's'}`;
  const dias = Math.floor(horas / 24);
  return `hace ${dias} dia${dias === 1 ? '' : 's'}`;
}

// De quien es el borrador: el cliente elegido gana sobre el contacto a medio
// capturar, igual que en la captura en vivo (son mutuamente excluyentes). Sin
// ninguno de los dos -- o el cliente elegido sin nombre util --, un texto
// neutro: el prompt nunca se queda con un hueco en blanco.
export function textoClienteBorrador(borrador) {
  if (borrador?.cliente) {
    const pc = borrador.cliente.pcCliente || {};
    const campos = borrador.cliente.campos || {};
    const nombre = pc.name || campos.razonSocial || campos.nombreCorto || '';
    if (nombre) return nombre;
  }
  const nombreContacto = borrador?.contactoNuevo?.nombre || '';
  if (nombreContacto) return `${nombreContacto} (contacto nuevo)`;
  return 'sin cliente';
}

// HTML del prompt. Los botones llevan id, no onclick: el pegamento en app.js
// los engancha con addEventListener (mismo patron que
// buildConfirmarVendedorModalHtml/buildCanalModalHtml), asi que no hay simbolo
// invocado desde onclick inline y la trampa #112 no aplica aqui.
export function buildPromptRestauracionBorradorHtml(borrador, ahora) {
  const cliente = escapeHtml(textoClienteBorrador(borrador));
  const antiguedad = antiguedadLegible(Number(ahora) - Number(borrador?.actualizado));
  return `
    <div style="background:#fff;border-radius:8px;padding:20px;max-width:340px;width:90%">
      <div style="font-weight:600;margin-bottom:4px">Tienes un borrador sin terminar</div>
      <div class="cot-card-meta" style="margin-bottom:8px">De: ${cliente} &middot; guardado ${antiguedad}.</div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button type="button" class="btn btn-secondary btn-sm" id="borrador-descartar">Descartar</button>
        <button type="button" class="btn btn-primary btn-sm" id="borrador-continuar">Continuar</button>
      </div>
    </div>
  `;
}
