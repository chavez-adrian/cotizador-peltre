// Post-fix del encabezado del quote (#521): los datos del ENCABEZADO -- lo que aplica
// al documento completo, frente a las partidas -- que la API v3 no escribe y viajan
// por la web legacy de Operam en el MISMO ProcessOrder, con relectura. Cada dato se
// declara UNA vez aqui; decidir, escribir, releer y reportar al vendedor recorren
// esta tabla en vez de copiarse por campo (antes, un dato nuevo eran ~22 ediciones
// en 6 archivos y olvidar una no daba error: daba un hueco).
//
// Nucleo PURO, sin IO: el formulario, el POST y las relecturas viven en
// `operam-web.js`, y los pasos que ve el vendedor los arma `server.js` con
// `pasoEncabezadoQuote`.
//
// Tres tipos de fila:
// - `select`: el valor tiene que ser una de las opciones que el formulario OFRECE
//   (uno ajeno hace que FA rechace el ProcessOrder ENTERO, con la vigencia adentro).
//   Las tres comparten UNA implementacion: `decidirCampoSelect` y `pasoEncabezadoQuote`.
// - `fecha`: la vigencia. CONSERVA su codigo en `operam-web.js` (es obligatoria en
//   todo ProcessOrder, se relee por la vista web con `leerValidoHastaVista`, es el
//   veredicto del post-fix, y al actualizar se verifica dentro de `compararQuoteVista`
//   junto con las partidas). Se declara aqui para que la excepcion quede a la vista.
// - `texto` (#556): el telefono y el correo del Contacto de entrega. Texto libre, sin
//   opciones que respetar, y un valor VACIO tambien se escribe. Se decide con
//   `decidirCampoTexto` y se reporta con el mismo `pasoEncabezadoQuote`.
//
// `momentos` dice en que caminos aplica cada fila: `crear` (el post-fix que sigue al
// POST de la API, `corregirVigenciaQuote`), `actualizar` (`actualizarQuoteOperam`,
// #104), `releer` (se relee despues de escribir y viaja en el resultado con la llave
// `campo`), `reportar` (sale como paso al vendedor con el nombre `paso`), `reintentar`
// (la cola de #380: lo que se encola y se vuelve a escribir), `barrido` (el barrido
// diario de #380 lo relee por la API con `llaveApi` contra la huella) y `veredicto` (al
// actualizar, una relectura que no casa tumba el `ok` y entra a `discrepancias`).
//
// #522: la huella del quote (`huellaContenidoQuote`, #114) y el reintento
// (`postfix-reintento.js` y su IO) tambien recorren esta tabla. `huella` dice con que
// llave y en que POSICION entra cada fila a la huella y como se calcula su valor
// (undefined = la llave no se escribe); el orden es el de la huella guardada y no se
// puede mover: la comparacion es por texto y cambiarlo haria que toda cotizacion ya
// subida se leyera como cambiada. Las cuatro son campos TARDIOS de la huella (se
// agregaron cuando ya habia huellas guardadas). `reintento` trae los textos del
// descarte del worker y la etiqueta del correo de aviso.
//
// El DOMICILIO DE ENTREGA es la fila incompleta a proposito: hoy se escribe SOLO al
// actualizar y no se relee, no se reporta, no se reintenta ni entra al barrido (si a la
// huella, #415). Queda declarado asi para cerrarlo en un ticket posterior, no aqui
// (#521 y #522 son refactors sin cambio de comportamiento).

// El valor de lista y transportista en la huella: no viven en `data`, quien escribe el
// encabezado los resuelve y los pasa; sin pasarlos (undefined) la llave no se escribe
// y el null explicito es "no hay valor que mandar".
const opcionEnHuella = (v) => (v === undefined ? undefined : v === null ? null : String(v));

const formularioSinCampo = (llave) =>
  `el formulario de Operam no trae ${llave}: la pagina no es la de edicion de cotizacion que se esperaba`;

export const FILAS_ENCABEZADO_QUOTE = [
  {
    campo: 'vigencia', tipo: 'fecha',
    // La relectura del post-fix va por la vista web (`leerValidoHastaVista`); la API
    // solo la lee el barrido. Obligatoria en todo ProcessOrder: el barrido encola la
    // que el quote ya tiene cuando la huella no la trae.
    llaveFormulario: 'delivery_date', llaveApi: 'delivery_date', obligatoria: true,
    esperadoDe: 'vigenciaDeCotizacion(data) en server.js: la decide el servidor al guardar (#505)',
    paso: 'post-fix vigencia',
    momentos: { crear: true, actualizar: true, releer: true, reportar: true, reintentar: true, barrido: true, veredicto: true },
    huella: { llave: 'vigencia', posicion: 4, valor: ({ contenido }) => contenido.vigencia },
    reintento: { etiquetaAviso: 'Valido hasta', nombre: 'la vigencia', vacio: '(sin dato)' },
  },
  // #403: el POST de la API v3 ignora la lista por cualquier nombre y el quote nacia
  // con la del CLIENTE. FA no re-precia las partidas al recibirla (medido sobre la
  // 1287). Una lista escrita que no quedo entra al veredicto al actualizar.
  {
    campo: 'lista', tipo: 'select',
    llaveFormulario: 'sales_type', llaveApi: 'order_type', llaveDecision: 'salesType',
    esperadoDe: 'listaDelQuote(entry) en server.js: el listaId del tier cotizado (#403)',
    esperado: ({ lista }) => lista,
    paso: 'lista del quote',
    momentos: { crear: true, actualizar: true, releer: true, reportar: true, reintentar: true, barrido: true, veredicto: true },
    huella: { llave: 'listaId', posicion: 1, valor: ({ opciones }) => opcionEnHuella(opciones.listaId) },
    reintento: { etiquetaAviso: 'Lista de precios', nombre: 'la lista', vacio: '(ninguna)' },
    textos: {
      sinEsperado: 'la cotizacion no tiene una lista de precios resoluble en el catalogo',
      noOfrecido: (v, ofrecidas) => `la lista ${v} no esta entre las opciones del formulario de Operam (${ofrecidas})`,
      yaCorrecto: (v) => `el quote ya esta en la lista ${v}`,
      relectura: 'la lista del encabezado',
      nombreCorto: 'la lista',
      nadaQueEscribir: 'no habia lista que escribir',
      omitido: () => 'La cotizacion quedo en Operam con la lista de precios que ya tenia el cliente',
      okYaCorrecto: () => 'La cotizacion ya estaba en Operam con la lista de precios cotizada',
      okEscrito: () => 'La lista de precios de la cotizacion quedo corregida en Operam',
      etiquetaDetalle: 'lista',
      revisa: () => 'Revisa la lista de precios de la cotizacion en Operam: pudo quedar con la del cliente',
      seEsperaba: 'la lista',
    },
  },
  // #409: al ACTUALIZAR, el header se reposteaba con el `branch_id` que traia el
  // formulario, asi que cambiar de domicilio movia la direccion de texto
  // (`delivery_address`, #328) y NUNCA el domicilio SELECCIONADO: el documento decia
  // Pestalozzi y Operam seguia en Bosques de Europa (la 1288, 2026-09-21). El valor del
  // <option> ES el branch_code, y es lo que hereda el pedido que se derive (#252). Al
  // CREAR no hace falta: el POST de la API v3 si acepta el branch.
  {
    campo: 'domicilio', tipo: 'select',
    llaveFormulario: 'branch_id', llaveApi: null, llaveDecision: 'branchId',
    esperadoDe: 'data.cliente.branchId: el branch_code que el vendedor eligio (#409)',
    esperado: ({ data }) => data?.cliente?.branchId ?? null,
    paso: null,
    momentos: { crear: false, actualizar: true, releer: false, reportar: false, reintentar: false, barrido: false, veredicto: false },
    // En la huella desde #415; llega como numero o como cadena segun el camino (la liga
    // que persiste el servidor, el selector del paso Envio, el branch_code de Operam) y
    // es el mismo domicilio. null = sin domicilio ligado.
    huella: {
      llave: 'branchId', posicion: 2,
      valor: ({ data }) => {
        const branch = data.cliente?.branchId ?? data.cliente?.branch_id ?? null;
        return branch == null || branch === '' ? null : String(branch);
      },
    },
    textos: {
      sinEsperado: 'la cotizacion no tiene un domicilio de entrega elegido',
      noOfrecido: (v, ofrecidas) => `el domicilio ${v} no esta entre los del cliente en el formulario de Operam (${ofrecidas})`,
      yaCorrecto: (v) => `el quote ya esta en el domicilio ${v}`,
    },
  },
  // #448: el POST de la API v3 no manda transportista y el quote hereda el
  // `default_ship_via` del domicilio (1 = "Default" en todos los branches que crea el
  // cotizador). Lo esperado es el `shipVia` de la linea de transporte elegida; null =
  // no se manda nada. No entra al veredicto al actualizar: uno que no pego sale como
  // paso propio y no tumba lo que si quedo.
  {
    campo: 'transportista', tipo: 'select',
    llaveFormulario: 'ship_via', llaveApi: 'ship_via', llaveDecision: 'shipVia',
    esperadoDe: 'transportistaDelQuote(entry).shipVia en server.js: el de la linea de transporte elegida (#448)',
    esperado: ({ transportista }) => transportista,
    paso: 'transportista del quote',
    momentos: { crear: true, actualizar: true, releer: true, reportar: true, reintentar: true, barrido: true, veredicto: false },
    huella: { llave: 'shipVia', posicion: 3, valor: ({ opciones }) => opcionEnHuella(opciones.shipVia) },
    reintento: { etiquetaAviso: 'Transportista', nombre: 'el transportista', vacio: '(ninguno)' },
    textos: {
      sinEsperado: 'la cotizacion no tiene un transportista de Operam que mandar',
      noOfrecido: (v, ofrecidas) => `el transportista ${v} no esta entre las opciones del formulario de Operam (${ofrecidas})`,
      yaCorrecto: (v) => `el quote ya tiene el transportista ${v}`,
      relectura: 'el transportista del encabezado',
      nombreCorto: 'el transportista',
      nadaQueEscribir: 'no habia transportista que escribir',
      omitido: () => 'La cotizacion quedo en Operam con el transportista que ya tenia (el del domicilio)',
      okYaCorrecto: (r, t) => `La cotizacion ya tenia en Operam el transportista de ${t?.linea ?? 'la linea de envio'}`,
      okEscrito: (r, t) => `El transportista de la cotizacion quedo en Operam: ${t?.linea ?? r.esperado}`,
      etiquetaDetalle: 'ship_via',
      revisa: (r, t) => `Revisa el transportista de la cotizacion en Operam: pudo quedar con el del domicilio en vez de ${t?.linea ?? r.esperado}`,
      seEsperaba: 'el transportista',
    },
  },
  // #556 (ADR-0024): el telefono y el correo del Contacto de entrega. El POST de la API
  // v3 ignora contact_phone / contact_email y los deriva del contacto del domicilio, y
  // el formulario web PRELLENA el campo vacio con el General del CLIENTE: sin
  // sustituirlos, el ProcessOrder de la vigencia grababa ese numero (la 1330). Se
  // escriben SIEMPRE, tambien vacios. Sin `huella`: su lugar en la huella es el
  // `contactPhone` / `contactEmail` del objeto base desde #329, no un campo tardio, y
  // `llaveHuellaBase` lo nombra para que el reintento lea de ahi lo que se escribio.
  {
    campo: 'telefonoEntrega', tipo: 'texto',
    llaveFormulario: 'phone', llaveApi: 'contact_phone', llaveDecision: 'contactPhone', llaveHuellaBase: 'contactPhone',
    esperadoDe: 'armarContenidoQuote(data).contactPhone en operam-client.js: el celular del Contacto de entrega',
    esperado: ({ telefonoEntrega }) => telefonoEntrega,
    paso: 'telefono del Contacto de entrega',
    momentos: { crear: true, actualizar: true, releer: true, reportar: true, reintentar: true, barrido: false, veredicto: false },
    reintento: { etiquetaAviso: 'Telefono del Contacto de entrega', nombre: 'el telefono del Contacto de entrega', vacio: '(vacio)' },
    textos: {
      sinEsperado: 'no se paso el telefono del Contacto de entrega',
      relectura: 'el telefono del encabezado',
      nombreCorto: 'el telefono del Contacto de entrega',
      nadaQueEscribir: 'no habia telefono que escribir',
      vacio: '(vacio)',
      omitido: () => 'La cotizacion quedo en Operam con el telefono de contacto que ya tenia',
      okYaCorrecto: () => 'La cotizacion ya tenia en Operam el telefono del Contacto de entrega',
      okEscrito: () => 'El telefono del Contacto de entrega quedo en la cotizacion en Operam',
      etiquetaDetalle: 'contact_phone',
      revisa: () => 'Revisa el telefono de contacto de la cotizacion en Operam: pudo quedar con el de otra persona',
      seEsperaba: 'el telefono',
    },
  },
  {
    campo: 'correoEntrega', tipo: 'texto',
    llaveFormulario: 'email', llaveApi: 'contact_email', llaveDecision: 'contactEmail', llaveHuellaBase: 'contactEmail',
    esperadoDe: 'armarContenidoQuote(data).contactEmail en operam-client.js: el correo del Contacto de entrega',
    esperado: ({ correoEntrega }) => correoEntrega,
    paso: 'correo del Contacto de entrega',
    momentos: { crear: true, actualizar: true, releer: true, reportar: true, reintentar: true, barrido: false, veredicto: false },
    reintento: { etiquetaAviso: 'Correo del Contacto de entrega', nombre: 'el correo del Contacto de entrega', vacio: '(vacio)' },
    textos: {
      sinEsperado: 'no se paso el correo del Contacto de entrega',
      relectura: 'el correo del encabezado',
      nombreCorto: 'el correo del Contacto de entrega',
      nadaQueEscribir: 'no habia correo que escribir',
      vacio: '(vacio)',
      omitido: () => 'La cotizacion quedo en Operam con el correo de contacto que ya tenia',
      okYaCorrecto: () => 'La cotizacion ya tenia en Operam el correo del Contacto de entrega',
      okEscrito: () => 'El correo del Contacto de entrega quedo en la cotizacion en Operam',
      etiquetaDetalle: 'contact_email',
      revisa: () => 'Revisa el correo de contacto de la cotizacion en Operam: pudo quedar con el de otra persona',
      seEsperaba: 'el correo',
    },
  },
];

export function filaEncabezado(campo) {
  return FILAS_ENCABEZADO_QUOTE.find((f) => f.campo === campo);
}

// Las filas que aplican en un momento (`reintentar`, `barrido`...), de cualquier tipo,
// en el orden de la tabla.
export function filasEn(momento) {
  return FILAS_ENCABEZADO_QUOTE.filter((f) => f.momentos[momento]);
}

// Las filas en el orden en que entran a la huella del quote (`huella.posicion`).
export const FILAS_HUELLA = FILAS_ENCABEZADO_QUOTE
  .filter((f) => f.huella)
  .sort((a, b) => a.huella.posicion - b.huella.posicion);

// Las filas `select` que aplican en un momento (`crear`, `actualizar`, `releer`...),
// en el orden de la tabla.
export function filasSelect(momento) {
  return FILAS_ENCABEZADO_QUOTE.filter((f) => f.tipo === 'select' && (!momento || f.momentos[momento]));
}

// Las filas que se deciden CAMPO POR CAMPO -- `select` y `texto`, todo menos la
// vigencia, que conserva su codigo -- y que aplican en un momento, en el orden de la
// tabla. Son las que decide, escribe, relee y reintenta el post-fix.
export function filasCampo(momento) {
  return FILAS_ENCABEZADO_QUOTE.filter((f) => f.tipo !== 'fecha' && (!momento || f.momentos[momento]));
}

// Decide si el ProcessOrder lleva el campo de una fila `select`. Devuelve VALORES,
// nunca escribe. Abstenerse NO es un fallo -- el quote ya existe y lo unico que queda
// mal es el encabezado --, asi que cada abstencion sale con su `motivo` tecnico para
// que el llamador lo reporte como paso en vez de tumbar la subida. Cinco desenlaces:
// sin valor esperado, formulario sin el campo, opcion no ofrecida, ya correcto y
// escribir (`{ escribir: true, [llaveDecision]: valor }`, la misma llave que recibe
// `serializarBodyQuote`).
export function decidirCampoSelect(fila, { esperado, actual, opciones = [] } = {}) {
  const valor = String(esperado ?? '').trim();
  if (!valor) return { escribir: false, motivo: fila.textos.sinEsperado };
  if (actual === undefined || actual === null) {
    return { escribir: false, motivo: formularioSinCampo(fila.llaveFormulario) };
  }
  if (!opciones.some((o) => String(o.id) === valor)) {
    const ofrecidas = opciones.map((o) => o.id).join(', ') || '(ninguna)';
    return { escribir: false, motivo: fila.textos.noOfrecido(valor, ofrecidas) };
  }
  if (String(actual) === valor) return { escribir: false, yaCorrecto: true, motivo: fila.textos.yaCorrecto(valor) };
  return { escribir: true, [fila.llaveDecision]: valor };
}

// Decide si el ProcessOrder lleva el campo de una fila `texto` (#556). Distinto del
// select en dos cosas, a proposito: (1) el vacio es un valor que SE escribe -- dejar
// el campo como venia es lo que grababa el telefono de otra persona --; y (2) nunca
// sale `yaCorrecto` comparando con el formulario: FA prellena el input vacio con el
// contacto General del cliente, asi que lo que el formulario muestra no es lo que el
// quote tiene guardado. Se escribe siempre y la verdad la da la relectura por la API.
// Solo se abstiene sin valor que mandar (null/undefined: quien llama no lo paso) o
// con un formulario que no trae el campo.
export function decidirCampoTexto(fila, { esperado, actual } = {}) {
  if (esperado === undefined || esperado === null) return { escribir: false, motivo: fila.textos.sinEsperado };
  if (actual === undefined || actual === null) {
    return { escribir: false, motivo: formularioSinCampo(fila.llaveFormulario) };
  }
  return { escribir: true, [fila.llaveDecision]: String(esperado).trim() };
}

// La decision de cualquier fila que se decide campo por campo, por su tipo.
export function decidirCampo(fila, entrada) {
  return fila.tipo === 'texto' ? decidirCampoTexto(fila, entrada) : decidirCampoSelect(fila, entrada);
}

// El paso de una fila `select` que se reporta, en dos capas como los demas. `r` es lo
// que devolvio la web legacy para ese campo y `contexto` lo que el llamador sabe de
// el (para el transportista, el mapeo de la linea: `transportistaDelQuote`). Tres
// desenlaces a proposito: no aplicaba (no habia valor que mandar; el motivo util es el
// del contexto si lo trae), quedo (escrito y verificado, o ya correcto) y "no quedo",
// que es lo unico que el vendedor tiene que ir a revisar. El detalle dice si se
// escribio y no pego o si ni se intento, con el motivo real -- nunca "Operam lo
// ignoro" sobre un campo que no viajo (#379).
export function pasoEncabezadoQuote(fila, folio, r, contexto) {
  if (!r) return null;
  const textos = fila.textos;
  // Un valor vacio se nombra (#556: el telefono vacio es un valor que se escribio).
  const mostrar = (v) => (v == null || v === '' ? (textos.vacio ?? '(sin dato)') : v);
  if (!r.aplica) {
    return {
      name: fila.paso, status: 'omitido',
      mensaje: textos.omitido(r, contexto),
      detalle: 'quote ' + folio + ': ' + (contexto?.motivo ?? r.motivo ?? textos.nadaQueEscribir),
    };
  }
  if (r.ok) {
    return {
      name: fila.paso, status: 'ok',
      mensaje: r.yaCorrecto ? textos.okYaCorrecto(r, contexto) : textos.okEscrito(r, contexto),
      detalle: 'quote ' + folio + ' ' + textos.etiquetaDetalle + ' ' + (r.esperado === '' ? mostrar(r.esperado) : r.esperado),
    };
  }
  return {
    name: fila.paso, status: 'warn',
    mensaje: textos.revisa(r, contexto),
    detalle: 'quote ' + folio + ': se esperaba ' + textos.seEsperaba + ' ' + mostrar(r.esperado) + (r.escrita
      // Escrita y sin confirmar: el motivo dice si la relectura fallo (y por que) o si
      // Operam contesto con otro valor. Sin el, "se leyo (sin dato)" tapaba la causa.
      ? ' y se leyo ' + mostrar(r.encontrado) + (r.motivo ? ' -- ' + r.motivo : '')
      : ' y no se envio -- ' + (r.motivo ?? 'sin motivo')),
    verificado: r.verificado, esperado: r.esperado, encontrado: r.encontrado,
  };
}
