'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let VERSION_BORRADOR, serializarBorrador, deserializarBorrador;
let RESTAURACION, decidirRestauracion;
let reResolverCarrito, MOTIVOS_LINEA_INVALIDA;
let llaveBorrador, EVENTOS_BORRADOR, borradorMuerePorEvento;
let bloqueaGeneracionPorPartidaSinCatalogo, avisoPartidaSinCatalogo;
let resolverProductoDelCatalogo;
let antiguedadLegible, textoClienteBorrador, buildPromptRestauracionBorradorHtml;

before(async () => {
  ({
    VERSION_BORRADOR, serializarBorrador, deserializarBorrador,
    RESTAURACION, decidirRestauracion,
    reResolverCarrito, MOTIVOS_LINEA_INVALIDA,
    llaveBorrador, EVENTOS_BORRADOR, borradorMuerePorEvento,
    bloqueaGeneracionPorPartidaSinCatalogo, avisoPartidaSinCatalogo,
    resolverProductoDelCatalogo,
    antiguedadLegible, textoClienteBorrador, buildPromptRestauracionBorradorHtml,
  } = await import('../borrador-logica.js'));
});

// Catalogo con la forma real de state.precios (/api/precios): products con los
// precios por lista, skus completos que apuntan a un priceKey, y las calcas en
// su propio catalogo (#91/#131).
const CATALOGO = {
  products: [
    { key: 'CO16', name: 'CO16 Cacerola 16 cm', weight_kg: 0.4, prices: { Menudeo: 150, M100: 110, M350: 99 } },
    { key: 'TA20', name: 'TA20 Taza 20 oz', weight_kg: 0.3, prices: { Menudeo: 90, M100: 70, M350: 62 } },
  ],
  skus: [
    { sku: 'CO16BLR', nombre: 'Cacerola 16 cm blanco riso', priceKey: 'CO16', tipo: 'CO', tamano: '16' },
  ],
  calcas: [
    { code: 'CAL2050S', name: 'Calca vitrificable mediana (50 cm2) 2 tintas', prices: { Menudeo: null, M100: 35.5, M350: 26.1 } },
  ],
};

const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;
const AHORA = 1755400000000;

function borradorConEdad(ms) {
  return serializarBorrador({ carrito: [ENTRADA_CO16], ahora: AHORA - ms });
}

// Partida de calca con la forma real que deja agregarCalca(): producto marcado
// con esCalca y precios donde Menudeo SIEMPRE es null (#91).
const ENTRADA_CALCA = {
  codigo: 'CAL2050S',
  cantidad: 100,
  product: {
    key: 'CAL2050S',
    name: 'Calca vitrificable mediana (50 cm2) 2 tintas',
    model: 'CAL2050S',
    prices: { Menudeo: null, M100: 35.5, M350: 26.1 },
    esCalca: true,
  },
};

// Entrada del carrito con la forma REAL de state.cart en app.js: el `product`
// trae los precios del catalogo vigente al momento de capturar.
const ENTRADA_CO16 = {
  codigo: 'CO16BLR',
  cantidad: 24,
  product: {
    key: 'CO16BLR',
    name: 'CO16 Cacerola 16 cm blanco',
    model: 'CO16',
    weight_kg: 0.4,
    prices: { Menudeo: 120, M100: 96, M350: 88 },
  },
};

// === Serializacion: la intencion del vendedor viaja; los precios NO ===
test('#179-1: el borrador serializado no lleva precios ni el producto del catalogo', () => {
  const borrador = serializarBorrador({ carrito: [ENTRADA_CO16], ahora: 1755400000000 });

  assert.equal(borrador.v, VERSION_BORRADOR);
  assert.equal(borrador.actualizado, 1755400000000);
  assert.deepEqual(borrador.carrito, [{ codigo: 'CO16BLR', cantidad: 24 }]);
});

test('#179-2: lo negociado por linea -- descuento y descripcion editada -- viaja en el borrador', () => {
  const borrador = serializarBorrador({
    carrito: [{ ...ENTRADA_CO16, descuento: 12, descripcion: 'Cacerola 16 cm esmaltada a mano, blanco' }],
    ahora: 1755400000000,
  });

  assert.deepEqual(borrador.carrito, [{
    codigo: 'CO16BLR',
    cantidad: 24,
    descuento: 12,
    descripcion: 'Cacerola 16 cm esmaltada a mano, blanco',
  }]);
});

test('#179-3: la marca de decorado viaja SOLO en true (#91): sin marca no aparece la llave', () => {
  const conMarca = serializarBorrador({ carrito: [ENTRADA_CALCA], decorado: true, ahora: 1 });
  const sinMarca = serializarBorrador({ carrito: [ENTRADA_CO16], decorado: false, ahora: 1 });

  assert.equal(conMarca.decorado, true);
  assert.equal('decorado' in sinMarca, false);
});

// === Sesion completa (#180, spec #178): cliente, envio, lista fijada,
// vigencia y vendedor confirmado viajan tal cual, sin validar ni re-resolver ===
test('#180-1: el cliente elegido viaja tal cual en el borrador', () => {
  const cliente = { pcCliente: { tipo: 'operam', id: 42 }, campos: { razonSocial: 'Peltre SA' } };
  const borrador = serializarBorrador({ carrito: [], cliente, ahora: 1 });

  assert.deepEqual(borrador.cliente, cliente);
  assert.equal('contactoNuevo' in borrador, false);
});

test('#180-2: un contacto nuevo a medio capturar viaja tal cual cuando no hay cliente elegido', () => {
  const contactoNuevo = { nombre: 'Juan', celCode: '+52', cel: '5512345678', ciudad: 'CDMX', canal: '', segmentoId: '' };
  const borrador = serializarBorrador({ carrito: [], contactoNuevo, ahora: 1 });

  assert.deepEqual(borrador.contactoNuevo, contactoNuevo);
  assert.equal('cliente' in borrador, false);
});

test('#180-3: cliente y contacto nuevo son mutuamente excluyentes -- el cliente elegido gana', () => {
  const cliente = { pcCliente: { tipo: 'operam' } };
  const contactoNuevo = { nombre: 'Juan' };
  const borrador = serializarBorrador({ carrito: [], cliente, contactoNuevo, ahora: 1 });

  assert.deepEqual(borrador.cliente, cliente);
  assert.equal('contactoNuevo' in borrador, false);
});

test('#180-4: sin cliente ni contacto nuevo, ninguna de las dos llaves aparece', () => {
  const borrador = serializarBorrador({ carrito: [], ahora: 1 });

  assert.equal('cliente' in borrador, false);
  assert.equal('contactoNuevo' in borrador, false);
});

test('#180-5: el envio estructurado (#102) viaja tal cual, sin re-cotizar', () => {
  const envio = { opcion: 'envia', carrier: 'fedex', servicio: 'nacional', precio: 150, descripcion: 'FedEx Nacional', descuento: 0 };
  const borrador = serializarBorrador({ carrito: [], envio, ahora: 1 });

  assert.deepEqual(borrador.envio, envio);
});

test('#180-6: sin envio elegido, la llave no aparece', () => {
  const borrador = serializarBorrador({ carrito: [], ahora: 1 });
  assert.equal('envio' in borrador, false);
});

test('#180-7: la lista fijada se guarda solo si no es Auto (#151)', () => {
  assert.equal(serializarBorrador({ carrito: [], tierFijado: 'M100', ahora: 1 }).tierFijado, 'M100');
  assert.equal('tierFijado' in serializarBorrador({ carrito: [], tierFijado: '', ahora: 1 }), false);
  assert.equal('tierFijado' in serializarBorrador({ carrito: [], ahora: 1 }), false);
});

test('#180-8: la vigencia capturada se guarda solo si es un numero de dias util', () => {
  assert.equal(serializarBorrador({ carrito: [], vigenciaDias: 15, ahora: 1 }).vigenciaDias, 15);
  assert.equal('vigenciaDias' in serializarBorrador({ carrito: [], vigenciaDias: 0, ahora: 1 }), false);
  assert.equal('vigenciaDias' in serializarBorrador({ carrito: [], vigenciaDias: -5, ahora: 1 }), false);
  assert.equal('vigenciaDias' in serializarBorrador({ carrito: [], vigenciaDias: NaN, ahora: 1 }), false);
  assert.equal('vigenciaDias' in serializarBorrador({ carrito: [], ahora: 1 }), false);
});

test('#180-9: vendedorConfirmado viaja SOLO en true (mismo patron que decorado, #91)', () => {
  assert.equal(serializarBorrador({ carrito: [], vendedorConfirmado: true, ahora: 1 }).vendedorConfirmado, true);
  assert.equal('vendedorConfirmado' in serializarBorrador({ carrito: [], vendedorConfirmado: false, ahora: 1 }), false);
  assert.equal('vendedorConfirmado' in serializarBorrador({ carrito: [], ahora: 1 }), false);
});

test('#180-10: la sesion completa hace ida y vuelta por localStorage sin perder ninguna llave nueva', () => {
  const cliente = { pcCliente: { tipo: 'prospecto', prospectoId: 7 }, campos: { razonSocial: 'Juan Perez', telefono: '+525512345678' } };
  const envio = { opcion: 'manual', carrier: null, servicio: null, precio: 200, descripcion: 'Envio local', descuento: 10 };
  const guardado = JSON.stringify(serializarBorrador({
    carrito: [ENTRADA_CO16],
    cliente,
    envio,
    tierFijado: 'M350',
    vigenciaDias: 45,
    vendedorConfirmado: true,
    ahora: 1755400000000,
  }));

  const leido = deserializarBorrador(guardado);

  assert.deepEqual(leido.cliente, cliente);
  assert.deepEqual(leido.envio, envio);
  assert.equal(leido.tierFijado, 'M350');
  assert.equal(leido.vigenciaDias, 45);
  assert.equal(leido.vendedorConfirmado, true);
});

// === Modo Editar (#104/#184, spec #178): el binding al registro y al folio
// originales viaja en el borrador, para que generar desde la sesion restaurada
// reescriba el MISMO quote conservando folio en vez de crear uno nuevo ===
test('#184-1: en modo Editar, el registro y el folio viajan con el borrador', () => {
  const borrador = serializarBorrador({
    carrito: [], modoActualizacion: true, cotizacionId: 42, folioOperam: 1216, ahora: 1,
  });

  assert.equal(borrador.modoActualizacion, true);
  assert.equal(borrador.cotizacionId, '42');
  assert.equal(borrador.folioOperam, 1216);
});

test('#184-2: fuera de modo Editar, ninguna de las tres llaves del binding aparece', () => {
  const borrador = serializarBorrador({ carrito: [], ahora: 1 });

  assert.equal('modoActualizacion' in borrador, false);
  assert.equal('cotizacionId' in borrador, false);
  assert.equal('folioOperam' in borrador, false);
});

test('#184-3: modoActualizacion sin cotizacionId no es un binding -- no se guarda', () => {
  const borrador = serializarBorrador({ carrito: [], modoActualizacion: true, folioOperam: 1216, ahora: 1 });

  assert.equal('modoActualizacion' in borrador, false);
  assert.equal('cotizacionId' in borrador, false);
  assert.equal('folioOperam' in borrador, false);
});

// El gate puedeActualizarCotizacion exige folioOperam para siquiera ofrecer
// modo Editar (cotizaciones-logica.js: "el folio SIEMPRE existe en este
// modo"): un binding sin folio conocido rompe esa invariante -- el aviso al
// restaurar caeria a "PRE" para una cotizacion que ya esta registrada. El
// binding viaja completo -- registro y folio juntos -- o no viaja.
test('#184-4: sin folio conocido, el binding NO viaja (romperia la invariante de que el folio siempre existe en modo Editar)', () => {
  const borrador = serializarBorrador({ carrito: [], modoActualizacion: true, cotizacionId: 7, ahora: 1 });

  assert.equal('modoActualizacion' in borrador, false);
  assert.equal('cotizacionId' in borrador, false);
  assert.equal('folioOperam' in borrador, false);
});

test('#184-5: el binding de modo Editar hace ida y vuelta por localStorage', () => {
  const guardado = JSON.stringify(serializarBorrador({
    carrito: [ENTRADA_CO16], modoActualizacion: true, cotizacionId: 15, folioOperam: 900, ahora: 1755400000000,
  }));

  const leido = deserializarBorrador(guardado);

  assert.equal(leido.modoActualizacion, true);
  assert.equal(leido.cotizacionId, '15');
  assert.equal(leido.folioOperam, 900);
});

// === Deserializacion: lo que no se entiende no se restaura ===
test('#179-4: lo guardado se vuelve a leer tal cual (ida y vuelta por el texto de localStorage)', () => {
  const guardado = JSON.stringify(serializarBorrador({
    carrito: [{ ...ENTRADA_CO16, descuento: 12 }, ENTRADA_CALCA],
    decorado: true,
    ahora: 1755400000000,
  }));

  const leido = deserializarBorrador(guardado);

  assert.equal(leido.actualizado, 1755400000000);
  assert.equal(leido.decorado, true);
  assert.deepEqual(leido.carrito, [
    { codigo: 'CO16BLR', cantidad: 24, descuento: 12 },
    { codigo: 'CAL2050S', cantidad: 100 },
  ]);
});

test('#179-5: una version desconocida se descarta en silencio, nunca se migra a ciegas', () => {
  const deOtraVersion = JSON.stringify({
    v: VERSION_BORRADOR + 1,
    actualizado: 1755400000000,
    carrito: [{ codigo: 'CO16BLR', cantidad: 24 }],
  });

  assert.equal(deserializarBorrador(deOtraVersion), null);
});

test('#179-6: basura, ausencia y borrador sin fecha de actividad no se restauran', () => {
  assert.equal(deserializarBorrador('{no es json'), null);
  assert.equal(deserializarBorrador(null), null);
  assert.equal(deserializarBorrador(''), null);
  assert.equal(deserializarBorrador(JSON.stringify({ v: VERSION_BORRADOR, carrito: [] })), null);
  assert.equal(deserializarBorrador(JSON.stringify({ v: VERSION_BORRADOR, actualizado: 1, carrito: 'CO16BLR' })), null);
});

test('#179-7: una linea sin codigo o sin cantidad util se cae; el resto del carrito sobrevive', () => {
  const conBasura = JSON.stringify({
    v: VERSION_BORRADOR,
    actualizado: 1755400000000,
    carrito: [
      { codigo: 'CO16BLR', cantidad: 24 },
      { codigo: '', cantidad: 5 },
      { codigo: 'CA20BLR', cantidad: 0 },
      { cantidad: 3 },
    ],
  });

  assert.deepEqual(deserializarBorrador(conBasura).carrito, [{ codigo: 'CO16BLR', cantidad: 24 }]);
});

// === Decision de restauracion: el reloj entra como argumento ===
test('#179-8: volver a los pocos minutos restaura en silencio (el caso frecuente: cambiar de app)', () => {
  assert.equal(decidirRestauracion(borradorConEdad(2 * MINUTO), AHORA), RESTAURACION.SILENCIOSA);
  assert.equal(decidirRestauracion(borradorConEdad(29 * MINUTO), AHORA), RESTAURACION.SILENCIOSA);
});

test('#179-9: pasada la media hora la restauracion deja de ser silenciosa y pasa a preguntar', () => {
  assert.equal(decidirRestauracion(borradorConEdad(31 * MINUTO), AHORA), RESTAURACION.PROMPT);
  assert.equal(decidirRestauracion(borradorConEdad(5 * HORA), AHORA), RESTAURACION.PROMPT);
  assert.equal(decidirRestauracion(borradorConEdad(29 * DIA), AHORA), RESTAURACION.PROMPT);
});

test('#179-10: un borrador mas viejo que la vigencia de cualquier cotizacion esta expirado', () => {
  assert.equal(decidirRestauracion(borradorConEdad(31 * DIA), AHORA), RESTAURACION.EXPIRADO);
});

test('#179-11: un reloj del dispositivo atrasado no expira el borrador de nadie', () => {
  assert.equal(decidirRestauracion(borradorConEdad(-2 * HORA), AHORA), RESTAURACION.SILENCIOSA);
});

test('#179-12: sin borrador no hay decision que tomar', () => {
  assert.equal(decidirRestauracion(null, AHORA), null);
  assert.equal(decidirRestauracion(deserializarBorrador('{no es json'), AHORA), null);
});

// === Re-resolucion contra el catalogo vigente ===
test('#179-13: la linea de SKU se rearma con el catalogo de hoy, con la cantidad y el descuento del vendedor', () => {
  // El borrador se escribio cuando CO16 costaba 120 de menudeo; el catalogo de
  // hoy dice 150. El precio que gana es el de hoy.
  const borrador = serializarBorrador({
    carrito: [{ ...ENTRADA_CO16, descuento: 12, descripcion: 'Cacerola blanca, filete rojo' }],
    ahora: AHORA,
  });

  const { lineas } = reResolverCarrito(borrador, CATALOGO);

  assert.equal(lineas.length, 1);
  assert.equal(lineas[0].codigo, 'CO16BLR');
  assert.equal(lineas[0].cantidad, 24);
  assert.equal(lineas[0].descuento, 12);
  assert.equal(lineas[0].descripcion, 'Cacerola blanca, filete rojo');
  assert.equal(lineas[0].motivo, null);
  assert.deepEqual(lineas[0].product.prices, { Menudeo: 150, M100: 110, M350: 99 });
  assert.equal(lineas[0].product.name, 'Cacerola 16 cm blanco riso');
  assert.equal(lineas[0].product.model, 'CO16');
  assert.equal(lineas[0].product.weight_kg, 0.4);
});

test('#179-14: una linea capturada por price key se resuelve contra el producto del catalogo', () => {
  const borrador = serializarBorrador({ carrito: [{ codigo: 'TA20', cantidad: 6 }], ahora: AHORA });

  const { lineas } = reResolverCarrito(borrador, CATALOGO);

  assert.equal(lineas[0].product.key, 'TA20');
  assert.deepEqual(lineas[0].product.prices, { Menudeo: 90, M100: 70, M350: 62 });
});

test('#179-15: la calca vuelve marcada como calca y con sus precios de hoy (Menudeo null, #91)', () => {
  const borrador = serializarBorrador({ carrito: [ENTRADA_CALCA], ahora: AHORA });

  const { lineas } = reResolverCarrito(borrador, CATALOGO);

  assert.equal(lineas[0].codigo, 'CAL2050S');
  assert.equal(lineas[0].cantidad, 100);
  assert.equal(lineas[0].product.esCalca, true);
  assert.equal(lineas[0].product.prices.Menudeo, null);
  assert.equal(lineas[0].product.prices.M100, 35.5);
});

test('#179-16: un SKU que ya no esta en el catalogo vuelve como linea invalida, sin precios inventados', () => {
  const borrador = serializarBorrador({
    carrito: [{ codigo: 'CO16BLR', cantidad: 24 }, { codigo: 'XX99MUERTO', cantidad: 5, descuento: 10 }],
    ahora: AHORA,
  });

  const { lineas, codigosSinCatalogo } = reResolverCarrito(borrador, CATALOGO);

  assert.deepEqual(codigosSinCatalogo, ['XX99MUERTO']);
  assert.equal(lineas.length, 2, 'la partida invalida se conserva para que el vendedor la vea y la corrija');
  const muerta = lineas[1];
  assert.equal(muerta.motivo, MOTIVOS_LINEA_INVALIDA.SIN_CATALOGO);
  assert.equal(muerta.cantidad, 5);
  assert.equal(muerta.descuento, 10);
  assert.deepEqual(muerta.product.prices, {});
  assert.equal(muerta.product.sinCatalogo, true);
});

test('#179-17: una calca que desaparecio del catalogo tampoco se restaura con datos fantasma', () => {
  const borrador = serializarBorrador({ carrito: [{ codigo: 'CAL8200S', cantidad: 100 }], ahora: AHORA });

  const { lineas, codigosSinCatalogo } = reResolverCarrito(borrador, CATALOGO);

  assert.deepEqual(codigosSinCatalogo, ['CAL8200S']);
  assert.equal(lineas[0].motivo, MOTIVOS_LINEA_INVALIDA.SIN_CATALOGO);
  assert.equal(lineas[0].product.esCalca, undefined);
});

test('#179-18: sin borrador y sin catalogo cargado no se restaura nada', () => {
  assert.deepEqual(reResolverCarrito(null, CATALOGO), { lineas: [], codigosSinCatalogo: [] });
  const borrador = serializarBorrador({ carrito: [ENTRADA_CO16], ahora: AHORA });
  assert.deepEqual(reResolverCarrito(borrador, null), { lineas: [], codigosSinCatalogo: [] });
});

// El mismo resolvedor lo consume Cargar del historial (app.js), no solo la
// restauracion del borrador: por eso su contrato se prueba de frente.
test('#179-18b: el resolvedor de catalogo atiende SKU completo, price key, calca y codigo muerto', () => {
  assert.equal(resolverProductoDelCatalogo('CO16BLR', CATALOGO).name, 'Cacerola 16 cm blanco riso');
  assert.equal(resolverProductoDelCatalogo('TA20', CATALOGO).key, 'TA20');
  assert.equal(resolverProductoDelCatalogo('CAL2050S', CATALOGO).esCalca, true);
  assert.equal(resolverProductoDelCatalogo('XX99MUERTO', CATALOGO), null);
  assert.equal(resolverProductoDelCatalogo('CO16BLR', null), null);
});

// === Llave por vendedor: dos vendedores en el mismo telefono no se pisan ===
test('#179-19: cada vendedor tiene su propia llave y ninguna es la de otro', () => {
  assert.notEqual(llaveBorrador(3), llaveBorrador(7));
  assert.equal(llaveBorrador(3), llaveBorrador('3'));
});

test('#179-20: sin vendedor logueado no hay llave que tocar', () => {
  assert.equal(llaveBorrador(null), null);
  assert.equal(llaveBorrador(undefined), null);
  assert.equal(llaveBorrador(''), null);
});

// === Ciclo de vida: que evento mata el borrador ===
test('#179-21: generar con exito y empezar de cero matan el borrador', () => {
  assert.equal(borradorMuerePorEvento(EVENTOS_BORRADOR.GENERACION_EXITOSA), true);
  assert.equal(borradorMuerePorEvento(EVENTOS_BORRADOR.NUEVA_COTIZACION), true);
  assert.equal(borradorMuerePorEvento(EVENTOS_BORRADOR.DESCARTADO), true);
  assert.equal(borradorMuerePorEvento(EVENTOS_BORRADOR.EXPIRADO), true);
});

test('#179-22: salir de la sesion NO mata el borrador (decision explicita del spec #178)', () => {
  assert.equal(borradorMuerePorEvento(EVENTOS_BORRADOR.LOGOUT), false);
  assert.equal(borradorMuerePorEvento(EVENTOS_BORRADOR.SESION_EXPIRADA), false);
  assert.equal(borradorMuerePorEvento('lo-que-sea-que-venga-despues'), false);
});

// === Partida fantasma: nunca se cotiza un SKU muerto ===
test('#179-23: una partida sin catalogo frena la generacion y el aviso dice cual es', () => {
  assert.equal(bloqueaGeneracionPorPartidaSinCatalogo(['XX99MUERTO']), true);
  assert.equal(bloqueaGeneracionPorPartidaSinCatalogo([]), false);
  assert.match(avisoPartidaSinCatalogo(['XX99MUERTO', 'CAL8200S']), /XX99MUERTO/);
  assert.match(avisoPartidaSinCatalogo(['XX99MUERTO', 'CAL8200S']), /CAL8200S/);
});

// === Prompt Continuar / Descartar (#181): antiguedad legible ===
test('#181-1: bajo un minuto se lee "hace un momento", no "0 minutos"', () => {
  assert.equal(antiguedadLegible(0), 'hace un momento');
  assert.equal(antiguedadLegible(30 * 1000), 'hace un momento');
});

test('#181-2: minutos, singular y plural', () => {
  assert.equal(antiguedadLegible(1 * MINUTO), 'hace 1 minuto');
  assert.equal(antiguedadLegible(31 * MINUTO), 'hace 31 minutos');
  assert.equal(antiguedadLegible(59 * MINUTO), 'hace 59 minutos');
});

test('#181-3: horas, singular y plural', () => {
  assert.equal(antiguedadLegible(1 * HORA), 'hace 1 hora');
  assert.equal(antiguedadLegible(5 * HORA), 'hace 5 horas');
  assert.equal(antiguedadLegible(23 * HORA + 59 * MINUTO), 'hace 23 horas');
});

test('#181-4: dias, singular y plural', () => {
  assert.equal(antiguedadLegible(1 * DIA), 'hace 1 dia');
  assert.equal(antiguedadLegible(29 * DIA), 'hace 29 dias');
});

test('#181-5: una edad negativa (reloj atrasado) no revienta ni sale en negativo', () => {
  assert.equal(antiguedadLegible(-5 * MINUTO), 'hace un momento');
});

// === Prompt Continuar / Descartar (#181): de que cliente es ===
test('#181-6: con cliente elegido, el nombre del cliente gana', () => {
  const borrador = { cliente: { pcCliente: { tipo: 'operam', name: 'Peltre SA' }, campos: {} } };
  assert.equal(textoClienteBorrador(borrador), 'Peltre SA');
});

test('#181-7: sin name en pcCliente, cae a razonSocial y luego a nombreCorto de los campos', () => {
  const conRazon = { cliente: { pcCliente: {}, campos: { razonSocial: 'Juan Perez SA', nombreCorto: 'Juan' } } };
  assert.equal(textoClienteBorrador(conRazon), 'Juan Perez SA');

  const soloCorto = { cliente: { pcCliente: {}, campos: { nombreCorto: 'Juan' } } };
  assert.equal(textoClienteBorrador(soloCorto), 'Juan');
});

test('#181-8: con contacto nuevo a medio capturar, el nombre se marca como contacto nuevo', () => {
  const borrador = { contactoNuevo: { nombre: 'Ana Lopez' } };
  assert.equal(textoClienteBorrador(borrador), 'Ana Lopez (contacto nuevo)');
});

test('#181-9: sin cliente ni contacto nuevo (o sin nombre util), un texto neutro', () => {
  assert.equal(textoClienteBorrador({}), 'sin cliente');
  assert.equal(textoClienteBorrador(null), 'sin cliente');
  assert.equal(textoClienteBorrador({ cliente: { pcCliente: {}, campos: {} } }), 'sin cliente');
  assert.equal(textoClienteBorrador({ contactoNuevo: { nombre: '' } }), 'sin cliente');
});

// === Prompt Continuar / Descartar (#181): HTML ===
test('#181-10: el HTML del prompt trae el nombre, la antiguedad y los ids de los botones -- sin onclick', () => {
  const borrador = { actualizado: AHORA - 45 * MINUTO, cliente: { pcCliente: { name: 'Peltre SA' }, campos: {} } };
  const html = buildPromptRestauracionBorradorHtml(borrador, AHORA);

  assert.match(html, /Peltre SA/);
  assert.match(html, /hace 45 minutos/);
  assert.match(html, /id="borrador-continuar"/);
  assert.match(html, /id="borrador-descartar"/);
  assert.doesNotMatch(html, /onclick/);
});

test('#181-11: el nombre del cliente se escapa contra XSS', () => {
  const borrador = { actualizado: AHORA - 1 * HORA, contactoNuevo: { nombre: '<script>alert(1)</script>' } };
  const html = buildPromptRestauracionBorradorHtml(borrador, AHORA);

  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

// === #221: varios disenos de calca sobreviven el borrador (spec #218) ===
// El borrador guarda el codigo del CATALOGO (la llave del carrito no se
// serializa, #220), asi que sin el numero de diseno dos partidas del mismo
// codigo volvian fusionadas en una sola.

// Dos disenos del mismo tipo, como los deja agregarCalca: mismo codigo, mismo
// precio, distinto numero.
const ENTRADA_CALCA_2 = {
  codigo: 'CAL2050S',
  cantidad: 120,
  diseno: 2,
  descripcion: 'Calca vitrificable mediana (50 cm2) 2 tintas - Dise\u00f1o 2: logo frontal',
  product: {
    key: 'CAL2050S-2',
    name: 'Calca vitrificable mediana (50 cm2) 2 tintas - Dise\u00f1o 2',
    model: 'CAL2050S',
    prices: { Menudeo: null, M100: 35.5, M350: 26.1 },
    esCalca: true,
    diseno: 2,
  },
};

test('#221-5: el numero de diseno sobrevive serializar -> deserializar', () => {
  const borrador = serializarBorrador({
    carrito: [{ ...ENTRADA_CALCA, diseno: 1 }, ENTRADA_CALCA_2],
    ahora: AHORA,
  });
  const leido = deserializarBorrador(JSON.stringify(borrador));
  assert.deepEqual(leido.carrito.map(l => l.diseno), [1, 2]);
  assert.deepEqual(leido.carrito.map(l => l.codigo), ['CAL2050S', 'CAL2050S']);
});

test('#221-6: dos disenos del mismo codigo restauran dos lineas separadas, no una fusionada', () => {
  const borrador = serializarBorrador({
    carrito: [{ ...ENTRADA_CALCA, diseno: 1 }, ENTRADA_CALCA_2],
    ahora: AHORA,
  });

  const { lineas } = reResolverCarrito(borrador, CATALOGO);

  assert.equal(lineas.length, 2);
  assert.deepEqual(lineas.map(l => l.cantidad), [100, 120]);
  assert.deepEqual(lineas.map(l => l.diseno), [1, 2]);
  // El nombre lo rearma el catalogo de hoy con el numero guardado: es lo que
  // hereda la descripcion por omision, el documento y el quote.
  assert.match(lineas[0].product.name, /Dise\u00f1o 1$/);
  assert.match(lineas[1].product.name, /Dise\u00f1o 2$/);
  assert.notEqual(lineas[0].product.key, lineas[1].product.key, 'con la misma llave se pisarian en el carrito');
  // La descripcion que el vendedor le escribio al segundo diseno no se pierde.
  assert.equal(lineas[1].descripcion, ENTRADA_CALCA_2.descripcion);
});

test('#221-7: una calca guardada sin diseno (antes de #220) restaura como Diseno 1', () => {
  const borrador = serializarBorrador({ carrito: [ENTRADA_CALCA], ahora: AHORA });

  const { lineas } = reResolverCarrito(borrador, CATALOGO);

  assert.equal(lineas.length, 1);
  assert.equal(lineas[0].diseno, 1);
  assert.match(lineas[0].product.name, /Dise\u00f1o 1$/);
  assert.equal(lineas[0].product.esCalca, true);
});

test('#221-8: un borrador guardado antes de #221 (sin diseno) sigue siendo valido', () => {
  const viejo = { v: VERSION_BORRADOR, actualizado: AHORA, carrito: [{ codigo: 'CAL2050S', cantidad: 100 }] };
  const leido = deserializarBorrador(JSON.stringify(viejo));
  assert.notEqual(leido, null, 'agregar un campo opcional no invalida los borradores en el telefono');
  assert.equal(leido.carrito.length, 1);
});

// === #282: el precio manual de calca sobrevive al borrador (spec #278) ===
// Es captura del vendedor, no catalogo -- la unica excepcion a "los precios no
// reviven con el borrador" (CONTEXT.md "Borrador de cotizacion").
const ENTRADA_CALCA_MANUAL = {
  codigo: 'CAL2050S',
  cantidad: 100,
  descuento: 5,
  precioManual: 137.5,
  product: {
    key: 'CAL2050S',
    name: 'Calca vitrificable mediana (50 cm2) 2 tintas',
    model: 'CAL2050S',
    prices: { Menudeo: null, M100: 35.5, M350: 26.1 },
    esCalca: true,
  },
};

test('#282-1: una calca con precio manual hace ida y vuelta -- serializar, deserializar y re-resolver -- con su precio y su descuento', () => {
  const borrador = serializarBorrador({ carrito: [ENTRADA_CALCA_MANUAL], ahora: AHORA });
  const leido = deserializarBorrador(JSON.stringify(borrador));
  const { lineas } = reResolverCarrito(leido, CATALOGO);

  assert.equal(lineas.length, 1);
  assert.equal(lineas[0].precioManual, 137.5);
  assert.equal(lineas[0].descuento, 5);
  assert.equal(lineas[0].motivo, null);
});

test('#282-2: una calca SIN manual se sigue re-resolviendo contra el catalogo vigente, sin la llave precioManual', () => {
  const borrador = serializarBorrador({ carrito: [ENTRADA_CALCA], ahora: AHORA });

  const { lineas } = reResolverCarrito(borrador, CATALOGO);

  assert.equal('precioManual' in lineas[0], false);
  assert.equal(lineas[0].product.prices.M100, 35.5);
});

test('#282-3: un precio manual invalido -- cero, negativo o texto no numerico -- se descarta al serializar (misma defensa que descuento)', () => {
  const sinManualCero = serializarBorrador({ carrito: [{ ...ENTRADA_CALCA_MANUAL, precioManual: 0 }], ahora: AHORA });
  const sinManualNegativo = serializarBorrador({ carrito: [{ ...ENTRADA_CALCA_MANUAL, precioManual: -5 }], ahora: AHORA });
  const sinManualTexto = serializarBorrador({ carrito: [{ ...ENTRADA_CALCA_MANUAL, precioManual: 'gratis' }], ahora: AHORA });

  assert.equal('precioManual' in sinManualCero.carrito[0], false);
  assert.equal('precioManual' in sinManualNegativo.carrito[0], false);
  assert.equal('precioManual' in sinManualTexto.carrito[0], false);
});

test('#282-4: una calca desaparecida del catalogo con manual sigue marcando SIN_CATALOGO (una linea invalida no se cotiza, con o sin captura)', () => {
  const borrador = serializarBorrador({
    carrito: [{ codigo: 'CAL8200S', cantidad: 100, precioManual: 137.5 }],
    ahora: AHORA,
  });

  const { lineas, codigosSinCatalogo } = reResolverCarrito(borrador, CATALOGO);

  assert.deepEqual(codigosSinCatalogo, ['CAL8200S']);
  assert.equal(lineas[0].motivo, MOTIVOS_LINEA_INVALIDA.SIN_CATALOGO);
  assert.equal(lineas[0].precioManual, 137.5);
});
