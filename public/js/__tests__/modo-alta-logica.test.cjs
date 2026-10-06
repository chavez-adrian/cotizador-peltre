'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

// Modo del alta (#539, ADR-0023): el panel del alta y el de la actualizacion fiscal
// son el MISMO nodo (#376), y en que modo esta lo decide este modulo. Cada transicion
// reproduce lo que hacia su camino de app.js antes de #539, con sus asimetrias
// (tabla del ADR): las salidas de estas pruebas son literales de esa tabla.
let MODO_ALTA_INICIAL, alAbrirAlta, alAbrirActualizacion, alPrecargarComercial, alLograrActualizacion,
  alActualizarCandidato, alCrearNuevoCandidato, alCerrarPanel;

const PRECARGA = { salesType: '3', segmentoId: '12', vendedorNombre: 'Adrian' };
const EN_ACTUALIZACION = { clienteId: 15, origen: 'clientes', comercialPrecargado: PRECARGA };

let errorAltaEnModoUpgrade;
before(async () => {
  ({ errorAltaEnModoUpgrade } = await import('../alta-logica.js'));
  ({
    MODO_ALTA_INICIAL,
    alAbrirAlta,
    alAbrirActualizacion,
    alPrecargarComercial,
    alLograrActualizacion,
    alActualizarCandidato,
    alCrearNuevoCandidato,
    alCerrarPanel,
  } = await import('../modo-alta-logica.js'));
});

test('MA0: el estado inicial es alta sin origen ni panel comercial', () => {
  assert.deepStrictEqual(MODO_ALTA_INICIAL, { clienteId: null, origen: null, comercialPrecargado: undefined });
  assert.ok(Object.isFrozen(MODO_ALTA_INICIAL));
});

test('MA1: abrir el alta vuelve a alta y deja la precarga en undefined', () => {
  const m = alAbrirAlta(EN_ACTUALIZACION);
  assert.deepStrictEqual(m, { clienteId: null, origen: null, comercialPrecargado: undefined });
  assert.ok('comercialPrecargado' in m);
});

test('MA2: abrir la actualizacion deja el cliente y el origen, y la precarga en null', () => {
  assert.deepStrictEqual(alAbrirActualizacion(MODO_ALTA_INICIAL, 501, 'resumen'),
    { clienteId: 501, origen: 'resumen', comercialPrecargado: null });
  assert.deepStrictEqual(alAbrirActualizacion(EN_ACTUALIZACION, 22, undefined),
    { clienteId: 22, origen: null, comercialPrecargado: null });
  assert.deepStrictEqual(alAbrirActualizacion(MODO_ALTA_INICIAL, 0, ''),
    { clienteId: 0, origen: null, comercialPrecargado: null });
});

test('MA3: la precarga lograda solo escribe la precarga (aunque el modo ya se haya cerrado: asimetria 4)', () => {
  assert.deepStrictEqual(alPrecargarComercial({ clienteId: 15, origen: 'paso', comercialPrecargado: null }, PRECARGA),
    { clienteId: 15, origen: 'paso', comercialPrecargado: PRECARGA });
  assert.deepStrictEqual(alPrecargarComercial({ clienteId: null, origen: null, comercialPrecargado: undefined }, PRECARGA),
    { clienteId: null, origen: null, comercialPrecargado: PRECARGA });
});

test('MA4: la actualizacion lograda vuelve a alta y deja la precarga en undefined', () => {
  const m = alLograrActualizacion(EN_ACTUALIZACION);
  assert.deepStrictEqual(m, { clienteId: null, origen: null, comercialPrecargado: undefined });
  assert.ok('comercialPrecargado' in m);
});

test('MA5: "Actualizar este" del duplicado deja el cliente, NO toca el origen y la precarga queda undefined', () => {
  const m = alActualizarCandidato(MODO_ALTA_INICIAL, 77);
  assert.deepStrictEqual(m, { clienteId: 77, origen: null, comercialPrecargado: undefined });
  assert.ok('comercialPrecargado' in m);
  assert.deepStrictEqual(alActualizarCandidato(EN_ACTUALIZACION, 77),
    { clienteId: 77, origen: 'clientes', comercialPrecargado: undefined });
});

test('MA6: "Crear nuevo" del duplicado vuelve a alta y NO toca la precarga (asimetria 1)', () => {
  assert.deepStrictEqual(alCrearNuevoCandidato(EN_ACTUALIZACION),
    { clienteId: null, origen: null, comercialPrecargado: PRECARGA });
  assert.deepStrictEqual(alCrearNuevoCandidato({ clienteId: 77, origen: null, comercialPrecargado: undefined }),
    { clienteId: null, origen: null, comercialPrecargado: undefined });
});

test('MA7: cerrar el panel vuelve a alta y NO toca la precarga (asimetria 1)', () => {
  assert.deepStrictEqual(alCerrarPanel(EN_ACTUALIZACION),
    { clienteId: null, origen: null, comercialPrecargado: PRECARGA });
  assert.deepStrictEqual(alCerrarPanel({ clienteId: 15, origen: 'paso', comercialPrecargado: null }),
    { clienteId: null, origen: null, comercialPrecargado: null });
});

// Sustituta de C16b (2) y #489-3: recoger el panel (devolverPanelACasa, que corre
// dentro de ocultarTodasLasVistas) apaga la actualizacion que estuviera abierta. Por
// eso pcAbrirUpgradeFiscal tiene que prender el modo DESPUES de ocultar las vistas.
test('MA8: cerrar el panel tras abrir la actualizacion vuelve a alta', () => {
  const abierta = alAbrirActualizacion(MODO_ALTA_INICIAL, 15, 'paso');
  assert.strictEqual(abierta.clienteId, 15);
  assert.strictEqual(alCerrarPanel(abierta).clienteId, null);
  assert.strictEqual(alCerrarPanel(abierta).origen, null);
});

test('MA9: ninguna transicion muta el estado recibido', () => {
  const recibido = Object.freeze({ clienteId: 15, origen: 'clientes', comercialPrecargado: Object.freeze({}) });
  const copia = { clienteId: 15, origen: 'clientes', comercialPrecargado: recibido.comercialPrecargado };
  const salidas = [
    alAbrirAlta(recibido),
    alAbrirActualizacion(recibido, 22, 'paso'),
    alPrecargarComercial(recibido, PRECARGA),
    alLograrActualizacion(recibido),
    alActualizarCandidato(recibido, 77),
    alCrearNuevoCandidato(recibido),
    alCerrarPanel(recibido),
  ];
  for (const s of salidas) assert.notStrictEqual(s, recibido, 'devuelve un estado nuevo');
  assert.deepStrictEqual({ ...recibido }, copia);
});

// #376 por comportamiento: con el modo en actualizacion, el POST del alta (altaEnviarAlta)
// se bloquea; al cerrar el panel o al descartar el candidato vuelve a ser posible.
test('MA10: #376 -- en actualizacion el alta se bloquea, y al cerrar o crear nuevo se libera', () => {
  const abierta = alAbrirActualizacion(MODO_ALTA_INICIAL, 15, 'clientes');
  const msg = errorAltaEnModoUpgrade(abierta.clienteId);
  assert.ok(msg && msg.includes('Cliente Operam 15'), 'abrir la actualizacion bloquea el POST del alta');
  const porCandidato = alActualizarCandidato(MODO_ALTA_INICIAL, 77);
  assert.ok(errorAltaEnModoUpgrade(porCandidato.clienteId).includes('Cliente Operam 77'),
    'mientras "Actualizar este" decide, el alta no corre');
  assert.strictEqual(errorAltaEnModoUpgrade(alCerrarPanel(abierta).clienteId), null, 'cerrar el panel libera el alta');
  assert.strictEqual(errorAltaEnModoUpgrade(alCrearNuevoCandidato(porCandidato).clienteId), null,
    '"Crear nuevo" libera el alta');
  assert.strictEqual(errorAltaEnModoUpgrade(alAbrirAlta(abierta).clienteId), null, 'abrir el alta libera el alta');
});
