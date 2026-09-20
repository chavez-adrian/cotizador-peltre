'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let tierPorVolumen, resolverTier, avisoListaFijada, validarTierCotizacion, mensajeListaNoHabilitada;
let normalizarPuedeFijarLista, normalizarListasHabilitadas, listasHabilitadasDeVendedor, puedeFijarTier;
let tierAlCargarCotizacion, opcionesTierSelect, MENSAJE_COPIA_LISTA_FIJADA, estadoAlCambiarCliente;
before(async () => {
  ({
    tierPorVolumen, resolverTier, avisoListaFijada, validarTierCotizacion, mensajeListaNoHabilitada,
    normalizarPuedeFijarLista, normalizarListasHabilitadas, listasHabilitadasDeVendedor, puedeFijarTier,
    tierAlCargarCotizacion, opcionesTierSelect, MENSAJE_COPIA_LISTA_FIJADA, estadoAlCambiarCliente,
  } = await import('../tier-logica.js'));
});

// Mismo tabulador de data/precios.json, replicado aqui a proposito (el test es
// independiente del archivo de datos). `listaId` es el id REAL de la sales_type
// de Operam que corresponde a cada escalon (verificado en vivo, la misma tabla
// que lib/catalogo-operam.js): por ahi cruza el tier con la matriz de #296.
const TIERS = [
  { id: 'Menudeo', label: 'Menudeo', min_qty: 1, listaId: '12' },
  { id: 'M100', label: '100+ pzs', min_qty: 100, listaId: '15' },
  { id: 'M350', label: '350+ pzs', min_qty: 350, listaId: '16' },
  { id: 'M550', label: '550+ pzs', min_qty: 550, listaId: '1' },
  { id: 'M1500', label: '1,500+ pzs', min_qty: 1500, listaId: '6' },
  { id: 'M6000', label: '6,000+ pzs', min_qty: 6000, listaId: '3' },
];

// Los ids de lista de los 6 escalones de volumen, el insumo de la migracion.
const LISTAS_VOLUMEN = TIERS.map(t => t.listaId);

// El catalogo con una lista SIN escalon (#298, ADR-0015): Segundas es la lista 9 de
// Operam, va al final y NO trae min_qty -- no es un escalon de volumen, solo se
// alcanza fijandola. Misma forma que emite construirCatalogo.
const SEGUNDAS = { id: 'Segundas', label: 'Segundas', listaId: '9' };
const TIERS_CON_SEGUNDAS = [...TIERS, SEGUNDAS];
const SOLO_SEGUNDAS = { esAdmin: false, listasHabilitadas: ['9'] };

// Permisos de uso frecuente en los tests (forma que consumen el enforcement, el
// selector y la herencia): rol admin, o la coleccion de listas habilitadas.
const ADMIN = { esAdmin: true };
const SIN_LISTAS = { esAdmin: false, listasHabilitadas: [] };
const SOLO_M550 = { esAdmin: false, listasHabilitadas: ['1'] };
const VOLUMEN_COMPLETO = { esAdmin: false, listasHabilitadas: LISTAS_VOLUMEN };

// === tierPorVolumen: el tabulador tal cual, sin override ===

test('carrito vacio cae en el primer tier (Menudeo)', () => {
  assert.strictEqual(tierPorVolumen(TIERS, 0).id, 'Menudeo');
});

test('el volumen exacto de un umbral entra a ese tier', () => {
  assert.strictEqual(tierPorVolumen(TIERS, 550).id, 'M550');
  assert.strictEqual(tierPorVolumen(TIERS, 549).id, 'M350');
});

test('volumen por encima del ultimo umbral cae en el tier mas alto', () => {
  assert.strictEqual(tierPorVolumen(TIERS, 50000).id, 'M6000');
});

// === #298: una lista SIN escalon jamas sale del tabulador ===

// Auto sigue decidiendo SOLO entre los escalones de volumen en pesos (ADR-0015): a
// Segundas se llega fijandola y por ningun otro camino, con cualquier volumen.
test('el tabulador nunca devuelve una lista sin escalon, con cualquier volumen', () => {
  for (const piezas of [0, 1, 99, 100, 500, 6000, 50000]) {
    assert.notStrictEqual(tierPorVolumen(TIERS_CON_SEGUNDAS, piezas).id, 'Segundas');
  }
  assert.strictEqual(tierPorVolumen(TIERS_CON_SEGUNDAS, 0).id, 'Menudeo');
  assert.strictEqual(tierPorVolumen(TIERS_CON_SEGUNDAS, 500).id, 'M350');
  assert.strictEqual(tierPorVolumen(TIERS_CON_SEGUNDAS, 50000).id, 'M6000');
});

// El carrito vacio cae en el PRIMER escalon de volumen, no en el primer tier del
// arreglo: el orden en que el catalogo liste las listas no puede volver a Segundas
// el default de Auto.
test('el carrito vacio cae en el primer escalon de volumen aunque la lista sin escalon venga primero', () => {
  const alReves = [SEGUNDAS, ...TIERS];
  assert.strictEqual(tierPorVolumen(alReves, 0).id, 'Menudeo');
  assert.strictEqual(tierPorVolumen(alReves, 500).id, 'M350');
});

// === resolverTier: Auto vs fijado ===

test('sin tierFijadoId resuelve Auto (el tabulador)', () => {
  const r = resolverTier(TIERS, 1600, null);
  assert.strictEqual(r.fijado, false);
  assert.strictEqual(r.tier.id, 'M1500');
});

test('con tierFijadoId valido, manda el fijado aunque el volumen de para otro (ambas direcciones)', () => {
  const abajo = resolverTier(TIERS, 1600, 'M550'); // fijar hacia abajo del que tocaria
  assert.strictEqual(abajo.fijado, true);
  assert.strictEqual(abajo.tier.id, 'M550');

  const arriba = resolverTier(TIERS, 10, 'M6000'); // fijar hacia arriba del que tocaria
  assert.strictEqual(arriba.fijado, true);
  assert.strictEqual(arriba.tier.id, 'M6000');
});

test('un tierFijadoId que ya no existe en el catalogo degrada a Auto', () => {
  const r = resolverTier(TIERS, 10, 'M9999');
  assert.strictEqual(r.fijado, false);
  assert.strictEqual(r.tier.id, 'Menudeo');
});

test('Menudeo se puede fijar como cualquier otro tier (#98: incluye Menudeo)', () => {
  const r = resolverTier(TIERS, 6000, 'Menudeo');
  assert.strictEqual(r.fijado, true);
  assert.strictEqual(r.tier.id, 'Menudeo');
});

// === avisoListaFijada: bidireccional, nunca bloqueante ===

test('sin lista fijada, sin aviso', () => {
  assert.strictEqual(avisoListaFijada(TIERS, 1600, null), null);
});

test('lista fijada que coincide con el tabulador, sin aviso', () => {
  assert.strictEqual(avisoListaFijada(TIERS, 1600, 'M1500'), null);
});

test('lista fijada por debajo del volumen: aviso con formato "Lista fijada: X - el volumen (N pzs) corresponde a Y"', () => {
  const aviso = avisoListaFijada(TIERS, 1600, 'M550');
  assert.strictEqual(aviso, 'Lista fijada: M550 - el volumen (1,600 pzs) corresponde a M1500');
});

test('lista fijada por encima del volumen: mismo formato en la otra direccion', () => {
  const aviso = avisoListaFijada(TIERS, 10, 'M6000');
  assert.strictEqual(aviso, 'Lista fijada: M6000 - el volumen (10 pzs) corresponde a Menudeo');
});

// === validarTierCotizacion: enforcement del servidor (#151/#153, por lista desde #296) ===

test('admin: cualquier tier pasa, incluso uno ajeno al tabulador', () => {
  assert.strictEqual(validarTierCotizacion(TIERS, 10, 'M6000', ADMIN).ok, true);
});

test('sin listas habilitadas: el tier que coincide con el tabulador pasa', () => {
  assert.strictEqual(validarTierCotizacion(TIERS, 1600, 'M1500', SIN_LISTAS).ok, true);
});

test('sin listas habilitadas: tier ajeno al tabulador se rechaza con el mensaje que nombra la lista', () => {
  const r = validarTierCotizacion(TIERS, 1600, 'M550', SIN_LISTAS);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.mensaje, mensajeListaNoHabilitada('M550'));
  assert.match(r.mensaje, /M550/);
});

test('sin listas habilitadas: tier ausente o vacio no cuenta como override (pasa)', () => {
  assert.strictEqual(validarTierCotizacion(TIERS, 10, '', SIN_LISTAS).ok, true);
  assert.strictEqual(validarTierCotizacion(TIERS, 10, undefined, SIN_LISTAS).ok, true);
});

// El corazon de #296: el permiso es POR LISTA, no todo-o-nada.
test('con M550 habilitada: fijar M550 pasa y fijar M6000 se rechaza', () => {
  assert.strictEqual(validarTierCotizacion(TIERS, 10, 'M550', SOLO_M550).ok, true);
  const otra = validarTierCotizacion(TIERS, 10, 'M6000', SOLO_M550);
  assert.strictEqual(otra.ok, false);
  assert.strictEqual(otra.mensaje, mensajeListaNoHabilitada('M6000'));
});

test('un tier sin lista de Operam en el catalogo no lo habilita ninguna celda', () => {
  const sinListaId = [{ id: 'Menudeo', label: 'Menudeo', min_qty: 1 }, { id: 'Raro', label: 'Raro', min_qty: 100 }];
  const r = validarTierCotizacion(sinListaId, 10, 'Raro', { esAdmin: false, listasHabilitadas: ['1', '12'] });
  assert.strictEqual(r.ok, false);
});

// === normalizarPuedeFijarLista / puedeFijarLista (#153, prior art #137) ===

test('normalizarPuedeFijarLista: solo true exacto es permiso; basura, string y ausente degradan a false', () => {
  assert.strictEqual(normalizarPuedeFijarLista(true), true);
  assert.strictEqual(normalizarPuedeFijarLista(false), false);
  assert.strictEqual(normalizarPuedeFijarLista('true'), false);
  assert.strictEqual(normalizarPuedeFijarLista(1), false);
  assert.strictEqual(normalizarPuedeFijarLista(null), false);
  assert.strictEqual(normalizarPuedeFijarLista(undefined), false);
});

// === normalizarListasHabilitadas / listasHabilitadasDeVendedor (#296, ADR-0015) ===
//
// La celda de la matriz referencia la lista de Operam por su id numerico. El
// registro guarda la coleccion de ids; la normalizacion es un juicio puro y la
// migracion de lectura del flag de #153 vive aqui, no en el store.

test('normalizarListasHabilitadas: deja los ids como cadenas, sin repetidos ni vacios', () => {
  assert.deepStrictEqual(normalizarListasHabilitadas(['1', '6']), ['1', '6']);
  assert.deepStrictEqual(normalizarListasHabilitadas([1, 6]), ['1', '6']);
  assert.deepStrictEqual(normalizarListasHabilitadas(['1', '1', ' 6 ']), ['1', '6']);
  assert.deepStrictEqual(normalizarListasHabilitadas(['', null, undefined, '3']), ['3']);
});

test('normalizarListasHabilitadas: basura degrada a sin permiso, nunca a permiso implicito', () => {
  assert.deepStrictEqual(normalizarListasHabilitadas('todas'), []);
  assert.deepStrictEqual(normalizarListasHabilitadas(true), []);
  assert.deepStrictEqual(normalizarListasHabilitadas(1), []);
  assert.deepStrictEqual(normalizarListasHabilitadas({ 1: true }), []);
  assert.deepStrictEqual(normalizarListasHabilitadas(null), []);
  assert.deepStrictEqual(normalizarListasHabilitadas(undefined), []);
  assert.deepStrictEqual(normalizarListasHabilitadas([{ id: '1' }, true, []]), []);
});

test('listasHabilitadasDeVendedor: el campo nuevo manda, normalizado', () => {
  const v = { role: 'vendedor', listasHabilitadas: ['1', 1, '', '9'] };
  assert.deepStrictEqual(listasHabilitadasDeVendedor(v, LISTAS_VOLUMEN), ['1', '9']);
});

test('listasHabilitadasDeVendedor: la lista vacia explicita es sin permiso, aunque traiga el flag viejo encendido', () => {
  const v = { role: 'vendedor', puedeFijarLista: true, listasHabilitadas: [] };
  assert.deepStrictEqual(listasHabilitadasDeVendedor(v, LISTAS_VOLUMEN), []);
});

test('migracion (#153 -> #296): flag encendido y sin campo nuevo lee como los 6 escalones de volumen', () => {
  const v = { role: 'vendedor', puedeFijarLista: true };
  assert.deepStrictEqual(listasHabilitadasDeVendedor(v, LISTAS_VOLUMEN), ['12', '15', '16', '1', '6', '3']);
});

test('migracion: sin flag y sin campo nuevo, ninguna lista', () => {
  assert.deepStrictEqual(listasHabilitadasDeVendedor({ role: 'vendedor' }, LISTAS_VOLUMEN), []);
  assert.deepStrictEqual(listasHabilitadasDeVendedor({ role: 'vendedor', puedeFijarLista: false }, LISTAS_VOLUMEN), []);
  assert.deepStrictEqual(listasHabilitadasDeVendedor(null, LISTAS_VOLUMEN), []);
});

test('migracion: un flag basura no migra nada (mismo criterio que normalizarPuedeFijarLista)', () => {
  const v = { role: 'vendedor', puedeFijarLista: 'si' };
  assert.deepStrictEqual(listasHabilitadasDeVendedor(v, LISTAS_VOLUMEN), []);
});

test('listasHabilitadasDeVendedor: un campo nuevo basura es sin permiso y NO cae de vuelta al flag viejo', () => {
  const v = { role: 'vendedor', puedeFijarLista: true, listasHabilitadas: 'todas' };
  assert.deepStrictEqual(listasHabilitadasDeVendedor(v, LISTAS_VOLUMEN), []);
});

// === puedeFijarTier: la celda de la matriz cruza con el tier por listaId (#296) ===

test('puedeFijarTier: admin puede cualquier tier, sin celdas', () => {
  assert.strictEqual(puedeFijarTier(TIERS, 'M6000', ADMIN), true);
  assert.strictEqual(puedeFijarTier(TIERS, 'Menudeo', { esAdmin: true, listasHabilitadas: [] }), true);
});

test('puedeFijarTier: el vendedor solo puede los tiers cuya lista de Operam tiene habilitada', () => {
  assert.strictEqual(puedeFijarTier(TIERS, 'M550', SOLO_M550), true);
  assert.strictEqual(puedeFijarTier(TIERS, 'M1500', SOLO_M550), false);
  assert.strictEqual(puedeFijarTier(TIERS, 'M1500', VOLUMEN_COMPLETO), true);
  assert.strictEqual(puedeFijarTier(TIERS, 'M550', SIN_LISTAS), false);
  assert.strictEqual(puedeFijarTier(TIERS, 'M550', null), false);
});

// Una lista habilitada que el catalogo todavia no precia (Amazon = id 19 en
// Operam) NO agrega ningun tier fijable: el selector solo ofrece listas del
// catalogo (nota del ticket #296).
test('puedeFijarTier: una lista habilitada fuera del catalogo no vuelve fijable nada', () => {
  const soloAmazon = { esAdmin: false, listasHabilitadas: ['19'] };
  assert.deepStrictEqual(opcionesTierSelect(TIERS, soloAmazon, ''), []);
  assert.strictEqual(puedeFijarTier(TIERS, 'M550', soloAmazon), false);
});

// === validarTierCotizacion con tierPrevioEditado (#154) ===

test('sin la lista habilitada, editando: el tier identico al ya guardado en ESE registro pasa aunque difiera del tabulador', () => {
  const r = validarTierCotizacion(TIERS, 1600, 'M550', SIN_LISTAS, 'M550');
  assert.strictEqual(r.ok, true);
});

test('sin la lista habilitada, editando: un tier DISTINTO al ya guardado se sigue rechazando', () => {
  const r = validarTierCotizacion(TIERS, 1600, 'M6000', SIN_LISTAS, 'M550');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.mensaje, mensajeListaNoHabilitada('M6000'));
});

test('editando con OTRA lista habilitada: cambiar a la propia pasa, cambiar a una tercera no', () => {
  const conM1500 = { esAdmin: false, listasHabilitadas: ['6'] };
  assert.strictEqual(validarTierCotizacion(TIERS, 1600, 'M1500', conM1500, 'M550').ok, true);
  assert.strictEqual(validarTierCotizacion(TIERS, 1600, 'M6000', conM1500, 'M550').ok, false);
});

test('sin tierPrevioEditado (Copiar, registro nuevo): el mismo tier que antes se rechaza igual', () => {
  const r = validarTierCotizacion(TIERS, 1600, 'M550', SIN_LISTAS, null);
  assert.strictEqual(r.ok, false);
});

// === tierAlCargarCotizacion: que hereda Editar/Copiar del historial (#154) ===

test('cotizacion sin lista fijada (tier = tabulador de su volumen): Editar y Copiar arrancan en Auto', () => {
  const editar = tierAlCargarCotizacion(TIERS, 1600, 'M1500', 'actualizar', SIN_LISTAS);
  assert.deepStrictEqual(editar, { tierFijado: '', avisoListaPerdida: false });
  const copiar = tierAlCargarCotizacion(TIERS, 1600, 'M1500', 'nueva', SIN_LISTAS);
  assert.deepStrictEqual(copiar, { tierFijado: '', avisoListaPerdida: false });
});

test('Editar con lista fijada: se conserva SIEMPRE, este o no habilitada para quien edita', () => {
  const conLista = tierAlCargarCotizacion(TIERS, 1600, 'M550', 'actualizar', SOLO_M550);
  assert.deepStrictEqual(conLista, { tierFijado: 'M550', avisoListaPerdida: false });
  const sinLista = tierAlCargarCotizacion(TIERS, 1600, 'M550', 'actualizar', SIN_LISTAS);
  assert.deepStrictEqual(sinLista, { tierFijado: 'M550', avisoListaPerdida: false });
});

test('Copiar con la lista fijada habilitada: la hereda', () => {
  const r = tierAlCargarCotizacion(TIERS, 1600, 'M550', 'nueva', SOLO_M550);
  assert.deepStrictEqual(r, { tierFijado: 'M550', avisoListaPerdida: false });
});

// #296: hereda solo con ESA lista marcada -- tener otras habilitadas no alcanza.
test('Copiar con OTRA lista habilitada: arranca en Auto con aviso de lista perdida', () => {
  const r = tierAlCargarCotizacion(TIERS, 1600, 'M6000', 'nueva', SOLO_M550);
  assert.deepStrictEqual(r, { tierFijado: '', avisoListaPerdida: true });
});

test('Copiar sin ninguna lista habilitada: arranca en Auto con aviso', () => {
  const r = tierAlCargarCotizacion(TIERS, 1600, 'M550', 'nueva', SIN_LISTAS);
  assert.deepStrictEqual(r, { tierFijado: '', avisoListaPerdida: true });
});

// === opcionesTierSelect: Auto (lo agrega el caller) + habilitadas + la fijada previa ===

test('admin: todas las opciones del tabulador', () => {
  assert.deepStrictEqual(opcionesTierSelect(TIERS, ADMIN, 'M550'), TIERS);
});

test('sin listas habilitadas y sin tierFijado: sin opciones (el selector se oculta)', () => {
  assert.deepStrictEqual(opcionesTierSelect(TIERS, SIN_LISTAS, ''), []);
});

test('sin listas habilitadas y con tierFijado: solo esa opcion, nunca el resto del tabulador', () => {
  const opciones = opcionesTierSelect(TIERS, SIN_LISTAS, 'M550');
  assert.strictEqual(opciones.length, 1);
  assert.strictEqual(opciones[0].id, 'M550');
});

test('con listas habilitadas: exactamente esas, en el orden del catalogo', () => {
  const dos = { esAdmin: false, listasHabilitadas: ['6', '16'] };
  assert.deepStrictEqual(opcionesTierSelect(TIERS, dos, '').map(t => t.id), ['M350', 'M1500']);
});

test('con listas habilitadas MAS la fijada previa ajena: se suma sin repetirse, en el orden del catalogo', () => {
  const dos = { esAdmin: false, listasHabilitadas: ['6', '16'] };
  assert.deepStrictEqual(opcionesTierSelect(TIERS, dos, 'Menudeo').map(t => t.id), ['Menudeo', 'M350', 'M1500']);
  assert.deepStrictEqual(opcionesTierSelect(TIERS, dos, 'M350').map(t => t.id), ['M350', 'M1500']);
});

test('MENSAJE_COPIA_LISTA_FIJADA existe y menciona Auto', () => {
  assert.match(MENSAJE_COPIA_LISTA_FIJADA, /Auto/);
});

// === #298: Segundas se comporta como cualquier lista fijada, sin tabular ===

test('fijar Segundas manda sobre el volumen, como cualquier lista fijada', () => {
  const r = resolverTier(TIERS_CON_SEGUNDAS, 500, 'Segundas');
  assert.strictEqual(r.fijado, true);
  assert.strictEqual(r.tier.id, 'Segundas');
});

// El aviso del ticket, palabra por palabra: fijar Segundas con 500 piezas dice que
// el volumen corresponderia a M350. Es informativo y no bloquea nada.
test('fijar Segundas con 500 piezas avisa que el volumen corresponde a M350', () => {
  const aviso = avisoListaFijada(TIERS_CON_SEGUNDAS, 500, 'Segundas');
  assert.strictEqual(aviso, 'Lista fijada: Segundas - el volumen (500 pzs) corresponde a M350');
});

test('con la celda de Segundas: guardar en Segundas pasa; sin ella se rechaza nombrandola', () => {
  assert.strictEqual(validarTierCotizacion(TIERS_CON_SEGUNDAS, 500, 'Segundas', SOLO_SEGUNDAS).ok, true);
  const sinCelda = validarTierCotizacion(TIERS_CON_SEGUNDAS, 500, 'Segundas', SOLO_M550);
  assert.strictEqual(sinCelda.ok, false);
  assert.strictEqual(sinCelda.mensaje, mensajeListaNoHabilitada('Segundas'));
});

// La celda de Segundas no arrastra ningun escalon de volumen, y los escalones de
// volumen no arrastran a Segundas: el permiso es exactamente por lista.
test('el selector ofrece exactamente las listas habilitadas, con o sin escalon', () => {
  assert.deepStrictEqual(opcionesTierSelect(TIERS_CON_SEGUNDAS, SOLO_SEGUNDAS, '').map(t => t.id), ['Segundas']);
  assert.deepStrictEqual(opcionesTierSelect(TIERS_CON_SEGUNDAS, VOLUMEN_COMPLETO, '').map(t => t.id),
    ['Menudeo', 'M100', 'M350', 'M550', 'M1500', 'M6000']);
  assert.deepStrictEqual(opcionesTierSelect(TIERS_CON_SEGUNDAS, SIN_LISTAS, '').map(t => t.id), []);
  assert.strictEqual(puedeFijarTier(TIERS_CON_SEGUNDAS, 'Segundas', ADMIN), true);
});

// Editar/Copiar aplican a Segundas las mismas reglas por lista (#154/#296): Editar
// conserva la autorizacion que ya ocurrio, Copiar solo hereda con ESA celda.
test('Editar conserva Segundas sin la celda; Copiar solo la hereda con ella', () => {
  assert.deepStrictEqual(tierAlCargarCotizacion(TIERS_CON_SEGUNDAS, 500, 'Segundas', 'actualizar', SIN_LISTAS),
    { tierFijado: 'Segundas', avisoListaPerdida: false });
  assert.deepStrictEqual(tierAlCargarCotizacion(TIERS_CON_SEGUNDAS, 500, 'Segundas', 'nueva', SOLO_SEGUNDAS),
    { tierFijado: 'Segundas', avisoListaPerdida: false });
  assert.deepStrictEqual(tierAlCargarCotizacion(TIERS_CON_SEGUNDAS, 500, 'Segundas', 'nueva', VOLUMEN_COMPLETO),
    { tierFijado: '', avisoListaPerdida: true });
});

// === estadoAlCambiarCliente: cambiar de cliente se comporta como Copiar (#385) ===

// 4 partidas x 16 pzs = 64 pzs: el tabulador da Menudeo, asi que M1500 ERA una
// lista fijada (el caso de la cotizacion 1264 del reporte). El permiso es el de
// la matriz (#296), no un booleano: M1500 es la lista 6 de Operam, asi que la
// celda que decide es esa y no otra.
const SOLO_M1500 = { esAdmin: false, listasHabilitadas: ['6'] };
const CAMBIO_BASE = {
  tiers: TIERS, piezasProducto: 64, tierFijado: 'M1500', permiso: SOLO_M1500,
  modoActualizacion: false, folioOperam: null, avisoPrevio: null,
};

test('AC1: con la lista fijada habilitada en la matriz, el cambio de cliente la conserva sin avisos', () => {
  const r = estadoAlCambiarCliente(CAMBIO_BASE);
  assert.strictEqual(r.tierFijado, 'M1500');
  assert.strictEqual(r.aviso, null);
});

test('AC1: el rol admin la conserva aunque no tenga ninguna celda marcada', () => {
  const r = estadoAlCambiarCliente({ ...CAMBIO_BASE, permiso: ADMIN });
  assert.strictEqual(r.tierFijado, 'M1500');
  assert.strictEqual(r.aviso, null);
});

test('AC2: con OTRA lista habilitada pero no esa: cae a Auto y avisa la lista perdida', () => {
  const r = estadoAlCambiarCliente({ ...CAMBIO_BASE, permiso: SOLO_M550 });
  assert.strictEqual(r.tierFijado, '');
  assert.deepStrictEqual(r.aviso, { salidaEdicion: false, folioOperam: null, listaPerdida: true });
});

test('AC2: sin ninguna lista habilitada: cae a Auto y avisa la lista perdida', () => {
  const r = estadoAlCambiarCliente({ ...CAMBIO_BASE, permiso: SIN_LISTAS });
  assert.strictEqual(r.tierFijado, '');
  assert.deepStrictEqual(r.aviso, { salidaEdicion: false, folioOperam: null, listaPerdida: true });
});

test('AC3: lista que coincide con el tabulador o sin lista fijada: Auto sin avisos, con o sin la celda', () => {
  for (const permiso of [SOLO_M1500, SIN_LISTAS]) {
    const coincide = estadoAlCambiarCliente({ ...CAMBIO_BASE, piezasProducto: 1600, permiso });
    assert.deepStrictEqual(coincide, { tierFijado: '', aviso: null });
    const sinLista = estadoAlCambiarCliente({ ...CAMBIO_BASE, tierFijado: '', permiso });
    assert.deepStrictEqual(sinLista, { tierFijado: '', aviso: null });
  }
});

test('AC4: cambio de cliente en modo Editar: avisa la salida de la edicion con el folio de Operam', () => {
  const r = estadoAlCambiarCliente({ ...CAMBIO_BASE, modoActualizacion: true, folioOperam: '1264' });
  assert.strictEqual(r.tierFijado, 'M1500');
  assert.deepStrictEqual(r.aviso, { salidaEdicion: true, folioOperam: '1264', listaPerdida: false });
});

test('AC4: fuera de modo Editar no hay aviso de salida de edicion aunque haya folio', () => {
  const r = estadoAlCambiarCliente({ ...CAMBIO_BASE, modoActualizacion: false, folioOperam: '1264' });
  assert.strictEqual(r.aviso, null);
});

test('AC6: cotizacion nueva (carrito vacio, sin lista, sin edicion): Auto y sin avisos', () => {
  const r = estadoAlCambiarCliente({ ...CAMBIO_BASE, piezasProducto: 0, tierFijado: '' });
  assert.deepStrictEqual(r, { tierFijado: '', aviso: null });
});

test('la segunda preparacion (elegir al nuevo cliente tras "Cambiar de cliente") conserva los avisos de la primera', () => {
  const primera = estadoAlCambiarCliente({ ...CAMBIO_BASE, permiso: SIN_LISTAS, modoActualizacion: true, folioOperam: '1264' });
  assert.deepStrictEqual(primera.aviso, { salidaEdicion: true, folioOperam: '1264', listaPerdida: true });
  // Tras la primera el estado ya esta en Auto y fuera de edicion.
  const segunda = estadoAlCambiarCliente({
    ...CAMBIO_BASE, permiso: SIN_LISTAS, tierFijado: primera.tierFijado,
    modoActualizacion: false, folioOperam: null, avisoPrevio: primera.aviso,
  });
  assert.strictEqual(segunda.tierFijado, '');
  assert.deepStrictEqual(segunda.aviso, primera.aviso);
});
