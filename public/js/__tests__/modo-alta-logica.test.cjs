'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

// Modo del alta (#539, ADR-0023): el panel del alta y el de la actualizacion fiscal
// son el MISMO nodo (#376), y en que modo esta lo decide este modulo. Cada transicion
// reproducia lo que hacia su camino de app.js antes de #539/#540, con sus asimetrias
// (tablas del ADR); #542 unifico las que la tabla de veredictos mando unificar y
// declaro las demas. Las salidas de estas pruebas son literales de esas tablas.
let MODO_ALTA_INICIAL, alAbrirAlta, alAbrirActualizacion, alPrecargarComercial, alLograrActualizacion,
  alActualizarCandidato, alCrearNuevoCandidato, alCerrarPanel;
let aperturaDelAlta, alReiniciarAlta, alEmpezarLectura, alLeerConstancia, alFallarLectura,
  alConfirmarConstancia, alVaciarConstancia, actualizacionVigente;

const PRECARGA = { salesType: '3', segmentoId: '12', vendedorNombre: 'Adrian' };
const EN_ACTUALIZACION = { clienteId: 15, origen: 'clientes', comercialPrecargado: PRECARGA };

// Desde #541 las transiciones devuelven { estado, acciones }. Las pruebas MA y MC
// afirman el ESTADO: aqui se cambia su acceso, una vez (`.estado`), y ningun literal.
// Las de la pantalla (MP) usan el modulo tal cual (`M`).
let M, ACCIONES_MODO;
const soloEstado = transicion => (...args) => transicion(...args).estado;

let errorAltaEnModoUpgrade;
before(async () => {
  ({ errorAltaEnModoUpgrade } = await import('../alta-logica.js'));
  M = await import('../modo-alta-logica.js');
  ({ MODO_ALTA_INICIAL, aperturaDelAlta, ACCIONES_MODO, actualizacionVigente } = M);
  ({
    alAbrirAlta,
    alAbrirActualizacion,
    alPrecargarComercial,
    alLograrActualizacion,
    alActualizarCandidato,
    alCrearNuevoCandidato,
    alCerrarPanel,
    alReiniciarAlta,
    alEmpezarLectura,
    alLeerConstancia,
    alFallarLectura,
    alConfirmarConstancia,
    alVaciarConstancia,
  } = Object.fromEntries(Object.entries(M).filter(([k]) => /^al[A-Z]/.test(k)).map(([k, f]) => [k, soloEstado(f)])));
});

test('MA0: el estado inicial es alta sin origen ni panel comercial, y sin constancia', () => {
  assert.deepStrictEqual(MODO_ALTA_INICIAL, {
    clienteId: null, origen: null, comercialPrecargado: undefined,
    status: 'idle', rfc: null, datos: null, pdfBase64: null,
    regimenesDetectados: null, constanciaDeUpgrade: null, lectura: null, lecturas: 0,
  });
  assert.strictEqual(Object.keys(MODO_ALTA_INICIAL).length, 11);
  assert.ok(Object.isFrozen(MODO_ALTA_INICIAL));
});

test('MA1: abrir el alta vuelve a alta y deja la precarga en undefined', () => {
  const m = alAbrirAlta(EN_ACTUALIZACION);
  assert.deepStrictEqual(m, { clienteId: null, origen: null, comercialPrecargado: undefined });
  assert.ok('comercialPrecargado' in m);
});

// Fila 8 de #542: abrir la actualizacion parte de la constancia vacia (tambien el rfc).
test('MA2: abrir la actualizacion deja el cliente y el origen, la precarga en null y la constancia vacia', () => {
  assert.deepStrictEqual(alAbrirActualizacion(MODO_ALTA_INICIAL, 501, 'resumen'), {
    clienteId: 501, origen: 'resumen', comercialPrecargado: null,
    status: 'idle', rfc: null, datos: null, pdfBase64: null,
    regimenesDetectados: null, constanciaDeUpgrade: 501, lectura: null, lecturas: 0,
  });
  assert.deepStrictEqual(alAbrirActualizacion(EN_ACTUALIZACION, 22, undefined), {
    clienteId: 22, origen: null, comercialPrecargado: null,
    status: 'idle', rfc: null, datos: null, pdfBase64: null, regimenesDetectados: null, constanciaDeUpgrade: 22, lectura: null,
  });
  assert.deepStrictEqual(alAbrirActualizacion(MODO_ALTA_INICIAL, 0, ''), {
    clienteId: 0, origen: null, comercialPrecargado: null,
    status: 'idle', rfc: null, datos: null, pdfBase64: null,
    regimenesDetectados: null, constanciaDeUpgrade: 0, lectura: null, lecturas: 0,
  });
});

// Fila 3 de #542: la precarga solo escribe si la actualizacion sigue siendo la de ese cliente.
test('MA3: la precarga lograda escribe la precarga solo si la actualizacion sigue siendo la de ese cliente', () => {
  assert.deepStrictEqual(alPrecargarComercial({ clienteId: 15, origen: 'paso', comercialPrecargado: null }, 15, PRECARGA),
    { clienteId: 15, origen: 'paso', comercialPrecargado: PRECARGA });
  const cerrado = { clienteId: null, origen: null, comercialPrecargado: undefined };
  assert.strictEqual(alPrecargarComercial(cerrado, 15, PRECARGA), cerrado, 'con el panel ya cerrado no escribe');
});

test('MA4: la actualizacion lograda vuelve a alta y deja la precarga en undefined', () => {
  const m = alLograrActualizacion(EN_ACTUALIZACION, 15);
  assert.deepStrictEqual(m, { clienteId: null, origen: null, comercialPrecargado: undefined, constanciaDeUpgrade: 15 });
  assert.ok('comercialPrecargado' in m);
});

// Fila 10 de #542: "Actualizar este" pone el origen en null.
test('MA5: "Actualizar este" del duplicado deja el cliente, el origen en null y la precarga en undefined', () => {
  const m = alActualizarCandidato(MODO_ALTA_INICIAL, 77);
  assert.deepStrictEqual(m, {
    clienteId: 77, origen: null, comercialPrecargado: undefined,
    status: 'idle', rfc: null, datos: null, pdfBase64: null,
    regimenesDetectados: null, constanciaDeUpgrade: null, lectura: null, lecturas: 0,
  });
  assert.ok('comercialPrecargado' in m);
  assert.deepStrictEqual(alActualizarCandidato(EN_ACTUALIZACION, 77),
    { clienteId: 77, origen: null, comercialPrecargado: undefined });
});

// Fila 10 de #542: "Crear nuevo" suelta la precarga.
test('MA6: "Crear nuevo" del duplicado vuelve a alta y deja la precarga en undefined', () => {
  const m = alCrearNuevoCandidato(EN_ACTUALIZACION);
  assert.deepStrictEqual(m, { clienteId: null, origen: null, comercialPrecargado: undefined });
  assert.ok('comercialPrecargado' in m);
  assert.deepStrictEqual(alCrearNuevoCandidato({ clienteId: 77, origen: null, comercialPrecargado: undefined }),
    { clienteId: null, origen: null, comercialPrecargado: undefined });
});

// Fila 10 de #542: cerrar suelta la precarga.
test('MA7: cerrar el panel vuelve a alta y deja la precarga en undefined', () => {
  const m = alCerrarPanel(EN_ACTUALIZACION);
  assert.deepStrictEqual(m, { clienteId: null, origen: null, comercialPrecargado: undefined });
  assert.ok('comercialPrecargado' in m);
  assert.deepStrictEqual(alCerrarPanel({ clienteId: 15, origen: 'paso', comercialPrecargado: null }),
    { clienteId: null, origen: null, comercialPrecargado: undefined });
});

// Sustituta de C16b (2) y #489-3: recoger el panel (alCerrarPanel, que tambien aplica
// ocultarTodasLasVistas) apaga la actualizacion que estuviera abierta. Por
// eso pcAbrirUpgradeFiscal tiene que prender el modo DESPUES de ocultar las vistas.
test('MA8: cerrar el panel tras abrir la actualizacion vuelve a alta', () => {
  const abierta = alAbrirActualizacion(MODO_ALTA_INICIAL, 15, 'paso');
  assert.strictEqual(abierta.clienteId, 15);
  assert.strictEqual(alCerrarPanel(abierta).clienteId, null);
  assert.strictEqual(alCerrarPanel(abierta).origen, null);
});

test('MA9: ninguna transicion muta el estado recibido', () => {
  const recibido = Object.freeze({
    clienteId: 15, origen: 'clientes', comercialPrecargado: Object.freeze({}), constanciaDeUpgrade: 15, lectura: 3, lecturas: 3,
  });
  const copia = {
    clienteId: 15, origen: 'clientes', comercialPrecargado: recibido.comercialPrecargado,
    constanciaDeUpgrade: 15, lectura: 3, lecturas: 3,
  };
  const salidas = [
    alAbrirAlta(recibido),
    alAbrirActualizacion(recibido, 22, 'paso'),
    alPrecargarComercial(recibido, 15, PRECARGA),
    alLograrActualizacion(recibido, 15),
    alActualizarCandidato(recibido, 77),
    alCrearNuevoCandidato(recibido),
    alCerrarPanel(recibido),
    alReiniciarAlta(recibido),
    alEmpezarLectura(recibido),
    alLeerConstancia(recibido, 3, { status: 'success', datos: { rfc: 'OGA140604560' }, pdfBase64: 'JVBERi0xLjQK' }),
    alFallarLectura(recibido, 3),
    alConfirmarConstancia(recibido, { rfc: 'OGA140604560' }),
    alVaciarConstancia(recibido),
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

// --- La constancia en memoria (#540) ------------------------------------------
// Las salidas son literales de la tabla de asimetrias de la constancia (ADR-0023).

const CONSTANCIA_LEIDA = {
  status: 'success',
  rfc: 'OGA140604560',
  datos: { rfc: 'OGA140604560', razonSocial: 'OPERADORA GASTRONOMICA', regimenFiscal: '605' },
  pdfBase64: 'JVBERi0xLjQK',
  regimenesDetectados: { rfc: 'OGA140604560', codigos: ['605', '611'] },
  constanciaDeUpgrade: null,
  lectura: 4,
  lecturas: 4,
};
const DATOS_ALTA = { rfc: 'OGA140604560', razonSocial: 'OPERADORA GASTRONOMICA' };

// Sustituta de #491-6 (comportamiento): la constancia de una actualizacion no la hereda
// el alta que se abre despues en la misma pestana, ni la Seccion 1 confirmada.
test('MC1: abrir el alta tras una actualizacion con constancia la descarta junto con la Seccion 1', () => {
  const trasActualizar = alLograrActualizacion({ ...CONSTANCIA_LEIDA, clienteId: 15, origen: 'paso', comercialPrecargado: null }, 15);
  assert.deepStrictEqual(aperturaDelAlta(trasActualizar, DATOS_ALTA), { descartada: true, datosAlta: null });
  assert.deepStrictEqual(alAbrirAlta(trasActualizar), {
    clienteId: null, origen: null, comercialPrecargado: undefined,
    status: 'idle', rfc: null, datos: null, pdfBase64: null,
    regimenesDetectados: null, constanciaDeUpgrade: null, lectura: null, lecturas: 4,
  });
});

test('MC2: abrir el alta con la constancia del propio alta la conserva, igual que la Seccion 1', () => {
  const delAlta = { clienteId: null, origen: null, comercialPrecargado: undefined, ...CONSTANCIA_LEIDA };
  assert.deepStrictEqual(aperturaDelAlta(delAlta, DATOS_ALTA), { descartada: false, datosAlta: DATOS_ALTA });
  assert.deepStrictEqual(alAbrirAlta(delAlta), {
    clienteId: null, origen: null, comercialPrecargado: undefined,
    status: 'success', rfc: 'OGA140604560',
    datos: { rfc: 'OGA140604560', razonSocial: 'OPERADORA GASTRONOMICA', regimenFiscal: '605' },
    pdfBase64: 'JVBERi0xLjQK', regimenesDetectados: { rfc: 'OGA140604560', codigos: ['605', '611'] },
    constanciaDeUpgrade: null, lectura: 4, lecturas: 4,
  });
});

// Las dos calculan el descarte por separado: tienen que coincidir siempre.
test('MC3: aperturaDelAlta descarta exactamente cuando alAbrirAlta quita la marca prendida', () => {
  for (const marca of [null, undefined, 0, 15]) {
    const m = { ...CONSTANCIA_LEIDA, constanciaDeUpgrade: marca };
    const { descartada } = aperturaDelAlta(m, DATOS_ALTA);
    assert.strictEqual(descartada, marca != null, `marca ${marca}`);
    assert.strictEqual(descartada, marca != null && alAbrirAlta(m).constanciaDeUpgrade === null, `marca ${marca}`);
    assert.strictEqual(alAbrirAlta(m).pdfBase64 === null, descartada, `marca ${marca}`);
  }
});

// Sustituta de #491-7 y de #491-11 (abrir la actualizacion deja huerfana la lectura). La
// lectura en null la deja la APERTURA; lograr no la toca (asimetria 2, declarada en #542).
test('MC4: abrir la actualizacion y lograrla deja la constancia marcada y la lectura anulada', () => {
  const leyendo = alEmpezarLectura({ clienteId: null, origen: null, comercialPrecargado: undefined, ...CONSTANCIA_LEIDA });
  const abierta = alAbrirActualizacion(leyendo, 15, 'clientes');
  assert.deepStrictEqual(abierta, {
    clienteId: 15, origen: 'clientes', comercialPrecargado: null,
    status: 'idle', rfc: null, datos: null, pdfBase64: null,
    regimenesDetectados: null, constanciaDeUpgrade: 15, lectura: null, lecturas: 5,
  });
  const lograda = alLograrActualizacion(abierta, 15);
  assert.strictEqual(lograda.constanciaDeUpgrade, 15);
  assert.strictEqual(lograda.lectura, null);
});

// Sustituta de #491-7 y #491-12 (la marca al lograrse, tambien por "Actualizar este").
test('MC5: lograr la actualizacion marca la constancia y NO anula la lectura en curso (asimetria 2)', () => {
  const porCandidato = alEmpezarLectura(alActualizarCandidato({ ...CONSTANCIA_LEIDA }, 77));
  assert.strictEqual(porCandidato.constanciaDeUpgrade, null, '"Actualizar este" no la marca (asimetria 3)');
  assert.deepStrictEqual(alLograrActualizacion(porCandidato, 77), {
    clienteId: null, origen: null, comercialPrecargado: undefined,
    status: 'loading', rfc: 'OGA140604560',
    datos: { rfc: 'OGA140604560', razonSocial: 'OPERADORA GASTRONOMICA', regimenFiscal: '605' },
    pdfBase64: 'JVBERi0xLjQK', regimenesDetectados: { rfc: 'OGA140604560', codigos: ['605', '611'] },
    constanciaDeUpgrade: 77, lectura: 5, lecturas: 5,
  });
});

test('MC6: empezar una lectura le da el siguiente numero, aunque la constancia se haya vaciado', () => {
  const primera = alEmpezarLectura(MODO_ALTA_INICIAL);
  assert.deepStrictEqual(primera, {
    clienteId: null, origen: null, comercialPrecargado: undefined,
    status: 'loading', rfc: null, datos: null, pdfBase64: null,
    regimenesDetectados: null, constanciaDeUpgrade: null, lectura: 1, lecturas: 1,
  });
  const trasVaciar = alEmpezarLectura(alVaciarConstancia(primera));
  assert.strictEqual(trasVaciar.lectura, 2, 'un numero repetido haria vigente a la lectura huerfana');
  assert.strictEqual(alEmpezarLectura(alAbrirActualizacion(trasVaciar, 15, 'paso')).lectura, 3);
  assert.strictEqual(alEmpezarLectura(alReiniciarAlta(trasVaciar)).lectura, 3);
  const conDatos = alEmpezarLectura({ ...CONSTANCIA_LEIDA });
  assert.strictEqual(conDatos.pdfBase64, 'JVBERi0xLjQK', 'lo anterior sigue hasta que termine (asimetria 7)');
});

test('MC7: una lectura lograda y vigente escribe la constancia; el rfc solo con RFC', () => {
  const leyendo = alEmpezarLectura({ ...MODO_ALTA_INICIAL });
  const datos = { rfc: 'oga140604560 ', regimenesFiscales: ['605', '611'] };
  assert.deepStrictEqual(alLeerConstancia(leyendo, 1, { status: 'success', datos, pdfBase64: 'JVBERi0xLjQK' }), {
    clienteId: null, origen: null, comercialPrecargado: undefined,
    status: 'success', rfc: 'oga140604560 ',
    datos: { rfc: 'oga140604560 ', regimenesFiscales: ['605', '611'] }, pdfBase64: 'JVBERi0xLjQK',
    regimenesDetectados: { rfc: 'OGA140604560', codigos: ['605', '611'] },
    constanciaDeUpgrade: null, lectura: 1, lecturas: 1,
  });
  const anterior = alEmpezarLectura({ ...CONSTANCIA_LEIDA });
  const sinRfc = alLeerConstancia(anterior, 5, { status: 'success', datos: { rfc: '' }, pdfBase64: null });
  assert.strictEqual(sinRfc.rfc, 'OGA140604560', 'sin RFC se queda el anterior (asimetria 6)');
  assert.deepStrictEqual(sinRfc.regimenesDetectados, { rfc: '', codigos: [] });
  assert.strictEqual(sinRfc.status, 'success');
});

// Sustituta de #491-11 (la lectura vieja no escribe): el no-op devuelve el MISMO estado.
test('MC8: una lectura que termina cuando ya hay otra vigente no escribe nada', () => {
  const vieja = alEmpezarLectura(MODO_ALTA_INICIAL);
  const nueva = alEmpezarLectura(vieja);
  const datos = { rfc: 'OGA140604560' };
  assert.strictEqual(alLeerConstancia(nueva, vieja.lectura, { status: 'success', datos, pdfBase64: 'x' }), nueva);
  assert.strictEqual(alFallarLectura(nueva, vieja.lectura), nueva);
  const huerfana = alAbrirActualizacion(vieja, 15, 'paso');
  assert.strictEqual(alLeerConstancia(huerfana, vieja.lectura, { status: 'success', datos, pdfBase64: 'x' }), huerfana,
    'abrir la actualizacion deja huerfana la lectura que empezo el alta');
  const vaciada = alVaciarConstancia(vieja);
  assert.strictEqual(alFallarLectura(vaciada, vieja.lectura), vaciada);
});

test('MC9: una lectura que falla deja el error sin constancia y conserva modo, origen, precarga y marca', () => {
  const leyendo = alEmpezarLectura({
    ...CONSTANCIA_LEIDA, clienteId: 15, origen: 'clientes', comercialPrecargado: PRECARGA, constanciaDeUpgrade: 15,
  });
  assert.deepStrictEqual(alFallarLectura(leyendo, 5), {
    clienteId: 15, origen: 'clientes', comercialPrecargado: { salesType: '3', segmentoId: '12', vendedorNombre: 'Adrian' },
    status: 'error', rfc: null, datos: null, pdfBase64: null,
    regimenesDetectados: null, constanciaDeUpgrade: 15, lectura: null, lecturas: 5,
  });
});

test('MC10: confirmar escribe los datos y pasa el RFC al PDF solo si hay PDF (#350)', () => {
  const datos = { rfc: 'OGA140604561', razonSocial: 'OPERADORA' };
  const conPdf = alConfirmarConstancia({ ...CONSTANCIA_LEIDA }, datos);
  assert.deepStrictEqual(conPdf, {
    status: 'success', rfc: 'OGA140604561',
    datos: { rfc: 'OGA140604561', razonSocial: 'OPERADORA' }, pdfBase64: 'JVBERi0xLjQK',
    regimenesDetectados: { rfc: 'OGA140604560', codigos: ['605', '611'] },
    constanciaDeUpgrade: null, lectura: 4, lecturas: 4,
  });
  assert.deepStrictEqual(alConfirmarConstancia({ rfc: 'VIEJO', pdfBase64: null }, datos),
    { rfc: 'VIEJO', pdfBase64: null, datos: { rfc: 'OGA140604561', razonSocial: 'OPERADORA' } });
});

test('MC11: vaciar a mano quita la constancia y la marca del upgrade (asimetria 9), no el modo', () => {
  const m = { ...CONSTANCIA_LEIDA, clienteId: 15, origen: 'paso', comercialPrecargado: PRECARGA, constanciaDeUpgrade: 15 };
  assert.deepStrictEqual(alVaciarConstancia(m), {
    clienteId: 15, origen: 'paso', comercialPrecargado: { salesType: '3', segmentoId: '12', vendedorNombre: 'Adrian' },
    status: 'idle', rfc: null, datos: null, pdfBase64: null,
    regimenesDetectados: null, constanciaDeUpgrade: null, lectura: null, lecturas: 4,
  });
});

// Fila 9 de #542: el reinicio es la constancia vacia, marca incluida.
test('MC12: el reinicio tras un alta completada vacia la constancia y quita la marca del upgrade', () => {
  assert.deepStrictEqual(alReiniciarAlta({ ...CONSTANCIA_LEIDA, constanciaDeUpgrade: 15 }), {
    status: 'idle', rfc: null, datos: null, pdfBase64: null,
    regimenesDetectados: null, constanciaDeUpgrade: null, lectura: null, lecturas: 4,
  });
});

test('MC13: "Actualizar este", "Crear nuevo", cerrar y la precarga no tocan la constancia (asimetria 3)', () => {
  const m = { clienteId: null, origen: null, comercialPrecargado: undefined, ...CONSTANCIA_LEIDA };
  const constanciaDe = ({ clienteId, origen, comercialPrecargado, ...resto }) => resto;
  const enA = { ...m, clienteId: 15 };
  for (const s of [alActualizarCandidato(m, 77), alCrearNuevoCandidato(m), alCerrarPanel(m), alPrecargarComercial(enA, 15, PRECARGA)]) {
    assert.deepStrictEqual(constanciaDe(s), CONSTANCIA_LEIDA);
  }
});

// Fila 1 de #542: confirmado, fileName y mensaje eran estado muerto (se escribian y nadie
// los leia: el texto del banner se arma al pintar). Ninguna transicion los vuelve a escribir.
test('MC14: ninguna transicion escribe confirmado, fileName ni mensaje', () => {
  const leyendo = alEmpezarLectura({ ...CONSTANCIA_LEIDA, clienteId: 15, origen: 'paso', comercialPrecargado: null });
  const salidas = [
    MODO_ALTA_INICIAL,
    alAbrirAlta(leyendo), alAbrirActualizacion(leyendo, 22, 'paso'), alPrecargarComercial(leyendo, 15, PRECARGA),
    alLograrActualizacion(leyendo, 15), alActualizarCandidato(leyendo, 77), alCrearNuevoCandidato(leyendo),
    alCerrarPanel(leyendo), alReiniciarAlta(leyendo), alEmpezarLectura(leyendo),
    alLeerConstancia(leyendo, 5, { status: 'success', datos: { rfc: 'OGA140604560' }, pdfBase64: 'x', fileName: 'a.pdf' }),
    alFallarLectura(leyendo, 5, 'Error al leer el PDF: x'),
    alConfirmarConstancia(leyendo, { rfc: 'OGA140604560' }), alVaciarConstancia(leyendo),
  ];
  for (const s of salidas) {
    for (const muerto of ['confirmado', 'fileName', 'mensaje']) assert.ok(!(muerto in s), `${muerto} en ${JSON.stringify(s)}`);
  }
});

// --- La guarda por clienteId de las escrituras tardias (fila 3 de #542) -------
// La precarga comercial y el PUT logrado vuelven de un `await`: en medio el vendedor pudo
// cerrar el panel o abrir la actualizacion de OTRO cliente (la fuga de #355 por otra puerta).

test('MV1: con el modo en el cliente B, la precarga y la lograda del cliente A no escriben ni piden pantalla', () => {
  const enB = M.alAbrirActualizacion(MODO_ALTA_INICIAL, 22, 'clientes', { nombre: 'B', rfc: 'X' }).estado;
  for (const s of [M.alPrecargarComercial(enB, 15, PRECARGA), M.alLograrActualizacion(enB, 15, null)]) {
    assert.strictEqual(s.estado, enB);
    assert.deepStrictEqual(s.acciones, []);
  }
  const leyendoEnB = M.alEmpezarLectura(enB).estado;
  assert.strictEqual(M.alLograrActualizacion(leyendoEnB, 15, leyendoEnB.lectura).estado, leyendoEnB,
    'la constancia de B es de B: la lograda de A no la marca aunque la lectura coincida');
});

test('MV2: con el modo en el cliente A, la precarga y la lograda de A hacen lo de siempre', () => {
  const enA = M.alAbrirActualizacion(MODO_ALTA_INICIAL, 15, 'paso').estado;
  assert.strictEqual(alPrecargarComercial(enA, 15, PRECARGA).comercialPrecargado, PRECARGA);
  const lograda = alLograrActualizacion(enA, 15, null);
  assert.strictEqual(lograda.clienteId, null);
  assert.strictEqual(lograda.constanciaDeUpgrade, 15);
});

// Con el panel cerrado la lograda no escribe el modo (clienteId, origen, precarga). La
// marca SI sigue a la constancia (decision del punto de revision de #542): si la que esta
// en memoria es la que viajo -- misma lectura, el patron de lecturaVigente -- y nadie la
// marco, es de A. Sin eso, la que "Actualizar este" escribio en A la mandaria el
// siguiente alta por POST como cliente nuevo (#491).
test('MV3: con el panel cerrado la lograda de A no escribe el modo, y marca la constancia solo si es la que viajo', () => {
  const abierta = alAbrirActualizacion(MODO_ALTA_INICIAL, 15, 'clientes');
  const cerrada = alCerrarPanel(abierta);
  assert.strictEqual(alLograrActualizacion(cerrada, 15, null), cerrada, 'ya era de A: nada que escribir');

  const delAlta = { ...MODO_ALTA_INICIAL, ...CONSTANCIA_LEIDA };
  const porCandidato = alCerrarPanel(alActualizarCandidato(delAlta, 77));
  assert.deepStrictEqual(M.alLograrActualizacion(porCandidato, 77, 4), {
    estado: { ...porCandidato, constanciaDeUpgrade: 77 },
    acciones: [],
  });
  const otraLectura = alEmpezarLectura(porCandidato);
  assert.strictEqual(alLograrActualizacion(otraLectura, 77, 4), otraLectura, 'otra constancia: no es la que viajo');
  const vaciada = alVaciarConstancia(porCandidato);
  assert.strictEqual(alLograrActualizacion(vaciada, 77, 4), vaciada);
  const manual = alCerrarPanel(alActualizarCandidato(MODO_ALTA_INICIAL, 77));
  assert.strictEqual(alLograrActualizacion(manual, 77, null), manual, 'la captura manual no tiene lectura: no se marca tarde');
});

test('MV4: actualizacionVigente pide la misma actualizacion; el 0 es id', () => {
  assert.strictEqual(actualizacionVigente({ clienteId: 15 }, 15), true);
  assert.strictEqual(actualizacionVigente({ clienteId: 0 }, 0), true);
  assert.strictEqual(actualizacionVigente({ clienteId: 22 }, 15), false);
  assert.strictEqual(actualizacionVigente({ clienteId: null }, null), false);
  assert.strictEqual(actualizacionVigente(null, 15), false);
});

// --- La pantalla se deriva del modo (#541) -----------------------------------
// Cada lista es literal de la tabla transicion -> acciones del ADR-0023: lo que hacia a
// mano su funcion de app.js, en el mismo orden y con sus asimetrias.

const BANNER_FUERA = { tipo: 'banner', cliente: null };
const BOTON_ON = { tipo: 'botonDarDeAlta', habilitado: true };
const BOTON_OFF = { tipo: 'botonDarDeAlta', habilitado: false };
const PALOMAS = { tipo: 'limpiarProgreso' };
const CANDADO = { tipo: 'candarSecciones' };

test('MP1: abrir el alta solo prende el boton y oculta el banner; ni candado ni palomas (asimetria 1)', () => {
  assert.deepStrictEqual(M.alAbrirAlta(EN_ACTUALIZACION).acciones, [BOTON_ON, BANNER_FUERA]);
  assert.deepStrictEqual(M.alAbrirAlta(MODO_ALTA_INICIAL).acciones, [BOTON_ON, BANNER_FUERA]);
});

// El reinicio parte de clienteId null, como en su unico llamador (despues de abrir el alta).
test('MP2: el reinicio tras un alta completada prende el boton, limpia las palomas y canda', () => {
  assert.deepStrictEqual(M.alReiniciarAlta({ ...CONSTANCIA_LEIDA, clienteId: null }).acciones, [BOTON_ON, PALOMAS, CANDADO]);
});

test('MP3: el boton sale del estado ya cambiado, nunca es literal', () => {
  assert.deepStrictEqual(M.alReiniciarAlta({ ...MODO_ALTA_INICIAL, clienteId: 15 }).acciones[0], BOTON_OFF);
  assert.deepStrictEqual(M.alReiniciarAlta({ ...MODO_ALTA_INICIAL, clienteId: 0 }).acciones[0], BOTON_OFF, 'el 0 sigue siendo id');
  assert.deepStrictEqual(M.alAbrirActualizacion(MODO_ALTA_INICIAL, 0, 'paso').acciones[3], BOTON_OFF);
});

// Sustituta de #432-2 (abrir la actualizacion limpia las palomas) y de #432-3 (el
// reinicio y la actualizacion comparten UNA limpieza: la misma accion).
test('MP4: abrir la actualizacion pone el banner, canda, limpia las palomas y apaga el boton', () => {
  assert.deepStrictEqual(M.alAbrirActualizacion(MODO_ALTA_INICIAL, 15, 'clientes', { nombre: 'Adrian', rfc: 'XAXX010101000' }).acciones, [
    { tipo: 'banner', cliente: { id: 15, nombre: 'Adrian', rfc: 'XAXX010101000' } },
    CANDADO,
    PALOMAS,
    BOTON_OFF,
  ]);
  const delReinicio = M.alReiniciarAlta(MODO_ALTA_INICIAL).acciones.find(a => a.tipo === 'limpiarProgreso');
  assert.deepStrictEqual(M.alAbrirActualizacion(MODO_ALTA_INICIAL, 15, 'paso').acciones[2], delReinicio);
  assert.deepStrictEqual(delReinicio, PALOMAS);
});

// El boton del Resumen abre la actualizacion sin datos del cliente (pipeline-logica fija
// pcAbrirUpgradeFiscal(501, null, 'resumen')).
test('MP5: el banner tolera abrir la actualizacion sin nombre ni RFC', () => {
  assert.deepStrictEqual(M.alAbrirActualizacion(MODO_ALTA_INICIAL, 501, 'resumen', null).acciones[0],
    { tipo: 'banner', cliente: { id: 501, nombre: undefined, rfc: undefined } });
});

// Sustituta de #489-3 (comportamiento): cerrar recoge el panel, los borradores, el boton y el banner.
test('MP6: cerrar recoge el panel y cierra el borrador del upgrade solo si habia actualizacion', () => {
  assert.deepStrictEqual(M.alCerrarPanel(EN_ACTUALIZACION).acciones, [
    { tipo: 'recogerPanel' },
    { tipo: 'cerrarBorrador', formId: 'alta-completa' },
    { tipo: 'cerrarBorrador', formId: 'upgrade-fiscal-15' },
    BOTON_ON,
    BANNER_FUERA,
  ]);
  assert.deepStrictEqual(M.alCerrarPanel(MODO_ALTA_INICIAL).acciones, [
    { tipo: 'recogerPanel' },
    { tipo: 'cerrarBorrador', formId: 'alta-completa' },
    BOTON_ON,
    BANNER_FUERA,
  ]);
  assert.deepStrictEqual(M.alCerrarPanel({ ...MODO_ALTA_INICIAL, clienteId: 0 }).acciones[2],
    { tipo: 'cerrarBorrador', formId: 'upgrade-fiscal-0' }, 'el 0 sigue siendo id');
});

test('MP7: "Actualizar este" solo apaga el boton y "Crear nuevo" solo lo prende (asimetrias 3 y 5)', () => {
  assert.deepStrictEqual(M.alActualizarCandidato(MODO_ALTA_INICIAL, 77).acciones, [BOTON_OFF]);
  assert.deepStrictEqual(M.alCrearNuevoCandidato({ ...MODO_ALTA_INICIAL, clienteId: 77 }).acciones, [BOTON_ON]);
});

test('MP8: la precarga y la constancia no devuelven acciones', () => {
  const abierta = M.alAbrirActualizacion(MODO_ALTA_INICIAL, 15, 'paso').estado;
  const leyendo = M.alEmpezarLectura(MODO_ALTA_INICIAL).estado;
  const salidas = [
    M.alPrecargarComercial(abierta, 15, PRECARGA),
    M.alEmpezarLectura(MODO_ALTA_INICIAL),
    M.alLeerConstancia(leyendo, 1, { status: 'success', datos: { rfc: 'OGA140604560' }, pdfBase64: 'x' }),
    M.alLeerConstancia(leyendo, 9, { status: 'success', datos: { rfc: 'OGA140604560' }, pdfBase64: 'x' }),
    M.alFallarLectura(leyendo, 1),
    M.alFallarLectura(leyendo, 9),
    M.alConfirmarConstancia(leyendo, { rfc: 'OGA140604560' }),
    M.alVaciarConstancia(leyendo),
  ];
  for (const s of salidas) assert.deepStrictEqual(s.acciones, []);
});

// Fila 6 de #542: la lograda reenciende "Dar de alta" y oculta el banner. No recoge el
// panel (declarado: el reporte de #407 se inserta junto a el).
test('MP10: la actualizacion lograda prende el boton y oculta el banner', () => {
  const abierta = M.alAbrirActualizacion(MODO_ALTA_INICIAL, 15, 'paso').estado;
  assert.deepStrictEqual(M.alLograrActualizacion(abierta, 15).acciones, [BOTON_ON, BANNER_FUERA]);
});

// Un tipo mal escrito no lo veria ninguna prueba (app.js no se importa) y en el
// navegador haria lanzar al ejecutor: todo tipo que se emite esta en la lista.
test('MP9: toda accion que emite una transicion es de un tipo que el ejecutor conoce', () => {
  assert.ok(Object.isFrozen(ACCIONES_MODO));
  const abierta = M.alAbrirActualizacion(MODO_ALTA_INICIAL, 15, 'paso', { nombre: 'A', rfc: 'B' }).estado;
  const salidas = [
    M.alAbrirAlta(abierta), M.alReiniciarAlta(MODO_ALTA_INICIAL), M.alAbrirActualizacion(MODO_ALTA_INICIAL, 15, 'paso'),
    M.alCerrarPanel(abierta), M.alActualizarCandidato(MODO_ALTA_INICIAL, 7), M.alCrearNuevoCandidato(abierta),
    M.alLograrActualizacion(abierta, 15),
  ];
  const emitidos = new Set(salidas.flatMap(s => s.acciones.map(a => a.tipo)));
  for (const tipo of emitidos) assert.ok(ACCIONES_MODO.includes(tipo), `${tipo} no esta en ACCIONES_MODO`);
  assert.deepStrictEqual([...emitidos].sort(), [...ACCIONES_MODO].sort(), 'cada tipo de la lista lo emite alguna transicion');
});
