'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { buildCsfDropzoneState, buildCsfDatosExtraidos } = require('./helpers.cjs');

let altaCsfResultadoParseo, csfTieneCapaDeTexto, csfDebeIntentarQR, RESULTADO_QR;
before(async () => {
  ({ altaCsfResultadoParseo, csfTieneCapaDeTexto, csfDebeIntentarQR, RESULTADO_QR } = await import('../alta-logica.js'));
});

// ─── buildCsfDropzoneState ────────────────────────────────────────────────────

test('C1: buildCsfDropzoneState estado inicial es idle', () => {
  const state = buildCsfDropzoneState({ status: 'idle' }, { type: 'INIT' });
  assert.strictEqual(state.status, 'idle');
});

test('C2: buildCsfDropzoneState accion LOADING retorna status loading con texto spinner', () => {
  const state = buildCsfDropzoneState({ status: 'idle' }, { type: 'LOADING' });
  assert.strictEqual(state.status, 'loading');
  assert.ok(state.spinnerText, 'debe tener spinnerText');
  assert.ok(state.spinnerText.includes('RFC'), 'spinner menciona RFC');
});

test('C3: buildCsfDropzoneState accion SUCCESS retorna status success con rfc y fileName', () => {
  const state = buildCsfDropzoneState(
    { status: 'loading' },
    { type: 'SUCCESS', rfc: 'BMF821130AR3', fileName: 'csf.pdf' }
  );
  assert.strictEqual(state.status, 'success');
  assert.strictEqual(state.rfc, 'BMF821130AR3');
  assert.strictEqual(state.fileName, 'csf.pdf');
});

test('C4: buildCsfDropzoneState accion ERROR retorna status error con mensaje', () => {
  const state = buildCsfDropzoneState(
    { status: 'loading' },
    { type: 'ERROR', mensaje: 'No se pudo leer el PDF' }
  );
  assert.strictEqual(state.status, 'error');
  assert.strictEqual(state.mensaje, 'No se pudo leer el PDF');
});

test('C5: buildCsfDropzoneState accion RESET retorna status idle limpio', () => {
  const state = buildCsfDropzoneState(
    { status: 'success', rfc: 'BMF821130AR3', fileName: 'csf.pdf' },
    { type: 'RESET' }
  );
  assert.strictEqual(state.status, 'idle');
  assert.strictEqual(state.rfc, null);
  assert.strictEqual(state.fileName, null);
});

// ─── buildCsfDatosExtraidos ───────────────────────────────────────────────────

const DATOS_COMPLETOS = {
  rfc: 'BMF821130AR3',
  razonSocial: 'BANCO DE MEXICO FIDEICOMISO',
  nombreCorto: 'BANCO DE MEXICO',
  idcif: '12345678901',
  cp: '06000',
  municipio: 'CUAUHTEMOC',
  estado: 'CIUDAD DE MEXICO',
  regimenFiscal: '601',
};

test('C6: buildCsfDatosExtraidos con datos completos retorna payload con todos los campos', () => {
  const payload = buildCsfDatosExtraidos(DATOS_COMPLETOS);
  assert.strictEqual(payload.rfc, 'BMF821130AR3');
  assert.strictEqual(payload.razonSocial, 'BANCO DE MEXICO FIDEICOMISO');
  assert.strictEqual(payload.nombreCorto, 'BANCO DE MEXICO');
  assert.strictEqual(payload.idcif, '12345678901');
  assert.strictEqual(payload.cp, '06000');
  assert.strictEqual(payload.municipio, 'CUAUHTEMOC');
  assert.strictEqual(payload.estado, 'CIUDAD DE MEXICO');
  assert.strictEqual(payload.regimenFiscal, '601');
});

test('C7: buildCsfDatosExtraidos campo usoCfdi tiene valor por defecto S01 si no se pasa', () => {
  const payload = buildCsfDatosExtraidos(DATOS_COMPLETOS);
  assert.strictEqual(payload.usoCfdi, 'S01');
});

test('C8: buildCsfDatosExtraidos acepta usoCfdi personalizado', () => {
  const payload = buildCsfDatosExtraidos({ ...DATOS_COMPLETOS, usoCfdi: 'G01' });
  assert.strictEqual(payload.usoCfdi, 'G01');
});

test('C9: buildCsfDatosExtraidos retorna error si falta rfc', () => {
  const { rfc: _r, ...sinRfc } = DATOS_COMPLETOS;
  const payload = buildCsfDatosExtraidos(sinRfc);
  assert.ok(payload.error, 'debe tener campo error');
  assert.ok(payload.error.includes('rfc'), 'error menciona rfc');
});

test('C10: buildCsfDatosExtraidos retorna error si falta razonSocial', () => {
  const { razonSocial: _r, ...sinNombre } = DATOS_COMPLETOS;
  const payload = buildCsfDatosExtraidos(sinNombre);
  assert.ok(payload.error, 'debe tener campo error');
  assert.ok(payload.error.includes('razonSocial'), 'error menciona razonSocial');
});

test('C11: buildCsfDatosExtraidos retorna error si falta nombreCorto', () => {
  const { nombreCorto: _n, ...sinNombreCorto } = DATOS_COMPLETOS;
  const payload = buildCsfDatosExtraidos(sinNombreCorto);
  assert.ok(payload.error, 'debe tener campo error');
  assert.ok(payload.error.includes('nombreCorto'), 'error menciona nombreCorto');
});

test('C12: buildCsfDatosExtraidos campos opcionales ausentes no generan error', () => {
  const soloRequeridos = { rfc: 'BMF821130AR3', razonSocial: 'BANCO DE MEXICO', nombreCorto: 'BANCO' };
  const payload = buildCsfDatosExtraidos(soloRequeridos);
  assert.ok(!payload.error, 'no debe tener error con campos requeridos presentes');
  assert.strictEqual(payload.idcif, '');
  assert.strictEqual(payload.cp, '');
  assert.strictEqual(payload.municipio, '');
  assert.strictEqual(payload.estado, '');
  assert.strictEqual(payload.regimenFiscal, '');
});

// ─── validarCsfCampos ─────────────────────────────────────────────────────────
const { validarCsfCampos } = require('./helpers.cjs');

test('C13: validarCsfCampos con todos los campos requeridos retorna null', () => {
  const getVal = id => ({ 'csf-rfc': 'BMF821130AR3', 'csf-razon-social': 'BANCO DE MEXICO', 'csf-nombre-corto': 'BANCO' })[id] || '';
  const err = validarCsfCampos(getVal);
  assert.strictEqual(err, null);
});

test('C14: validarCsfCampos sin RFC retorna mensaje de error con "RFC"', () => {
  const getVal = id => ({ 'csf-razon-social': 'BANCO DE MEXICO', 'csf-nombre-corto': 'BANCO' })[id] || '';
  const err = validarCsfCampos(getVal);
  assert.ok(err, 'debe retornar error');
  assert.ok(err.includes('RFC'), 'menciona RFC');
});

test('C15: validarCsfCampos sin razon social retorna mensaje de error', () => {
  const getVal = id => ({ 'csf-rfc': 'BMF821130AR3', 'csf-nombre-corto': 'BANCO' })[id] || '';
  const err = validarCsfCampos(getVal);
  assert.ok(err, 'debe retornar error');
  assert.ok(err.toLowerCase().includes('razon'), 'menciona razon social');
});

test('C16: validarCsfCampos sin nombre corto retorna mensaje de error', () => {
  const getVal = id => ({ 'csf-rfc': 'BMF821130AR3', 'csf-razon-social': 'BANCO DE MEXICO' })[id] || '';
  const err = validarCsfCampos(getVal);
  assert.ok(err, 'debe retornar error');
  assert.ok(err.toLowerCase().includes('nombre corto') || err.toLowerCase().includes('nombre'), 'menciona nombre corto');
});

// ─── buildCsfConfirmarPayload ─────────────────────────────────────────────────
const { buildCsfConfirmarPayload } = require('./helpers.cjs');

test('C17: buildCsfConfirmarPayload extrae todos los campos del formulario', () => {
  const vals = {
    'csf-rfc': 'BMF821130AR3',
    'csf-razon-social': 'BANCO DE MEXICO',
    'csf-nombre-corto': 'BANCO',
    'csf-idcif': '12345678901',
    'csf-regimen-fiscal': '601',
    'alta-uso-cfdi': 'G01',
    'csf-calle': 'NAYARIT',
    'csf-num-ext': '56',
    'csf-num-int': 'B',
    'csf-colonia': 'ROMA SUR',
    'csf-cp': '06000',
    'csf-municipio': 'CUAUHTEMOC',
    'csf-estado': 'CIUDAD DE MEXICO',
  };
  const getVal = id => vals[id] || '';
  const payload = buildCsfConfirmarPayload(getVal);
  assert.strictEqual(payload.rfc, 'BMF821130AR3');
  assert.strictEqual(payload.razonSocial, 'BANCO DE MEXICO');
  assert.strictEqual(payload.nombreCorto, 'BANCO');
  assert.strictEqual(payload.idcif, '12345678901');
  assert.strictEqual(payload.regimenFiscal, '601');
  assert.strictEqual(payload.usoCfdi, 'G01');
  assert.strictEqual(payload.calle, 'NAYARIT');
  assert.strictEqual(payload.numExt, '56');
  assert.strictEqual(payload.numInt, 'B');
  assert.strictEqual(payload.colonia, 'ROMA SUR');
  assert.strictEqual(payload.cp, '06000');
  assert.strictEqual(payload.municipio, 'CUAUHTEMOC');
  assert.strictEqual(payload.estado, 'CIUDAD DE MEXICO');
});

test('C18: buildCsfConfirmarPayload con campos vacios retorna strings vacios', () => {
  const getVal = () => '';
  const payload = buildCsfConfirmarPayload(getVal);
  assert.strictEqual(payload.rfc, '');
  assert.strictEqual(payload.razonSocial, '');
  assert.strictEqual(payload.nombreCorto, '');
});

// ─── altaCheckpointState ──────────────────────────────────────────────────────
const { altaCheckpointState, altaDesbloqueaSeccion } = require('./helpers.cjs');

test('C19: altaCheckpointState marca checkpoint 1 como done al confirmar seccion 1', () => {
  const estado = { checkpoints: { 1: false, 2: false, 3: false } };
  const siguiente = altaCheckpointState(estado, 1, true);
  assert.strictEqual(siguiente.checkpoints[1], true);
  assert.strictEqual(siguiente.checkpoints[2], false);
});

test('C20: altaCheckpointState no modifica checkpoints no indicados', () => {
  const estado = { checkpoints: { 1: true, 2: false, 3: false } };
  const siguiente = altaCheckpointState(estado, 2, true);
  assert.strictEqual(siguiente.checkpoints[1], true);
  assert.strictEqual(siguiente.checkpoints[2], true);
  assert.strictEqual(siguiente.checkpoints[3], false);
});

test('C21: altaDesbloqueaSeccion retorna secciones desbloqueadas al completar la anterior', () => {
  const lockedInicial = [3, 4];
  // Completar seccion 1 no cambia los locked (2 ya estaba disponible)
  const locked1 = altaDesbloqueaSeccion(lockedInicial, 1);
  assert.deepStrictEqual(locked1, [3, 4]);
  // Completar seccion 2 desbloquea seccion 3
  const locked2 = altaDesbloqueaSeccion(lockedInicial, 2);
  assert.deepStrictEqual(locked2, [4]);
  // Completar seccion 3 desbloquea seccion 4
  const locked3 = altaDesbloqueaSeccion([4], 3);
  assert.deepStrictEqual(locked3, []);
});

test('C22: validarCsfCampos con RFC vacio retorna error aunque otros campos esten llenos', () => {
  const { validarCsfCampos } = require('./helpers.cjs');
  const getVal = id => ({ 'csf-razon-social': 'EMPRESA SA', 'csf-nombre-corto': 'EMPRESA' })[id] || '';
  const err = validarCsfCampos(getVal);
  assert.ok(err, 'debe haber error');
  assert.ok(err.toUpperCase().includes('RFC'), 'error menciona RFC');
});

// ─── buildCsfDatosDesdeRespuesta: maneja respuesta de POST /api/parsear-csf (issue #34) ──
// altaCsfProcesarArchivo ya no parsea localmente -- consume el endpoint centralizado de #33
// y usa esta funcion pura para interpretar { ok, datos } o { ok:false, error }.
const { buildCsfDatosDesdeRespuesta } = require('./helpers.cjs');

test('C30: buildCsfDatosDesdeRespuesta con ok:true retorna los datos completos incl domicilio', () => {
  const json = {
    ok: true,
    datos: {
      rfc: 'SMS200716NZ4', razonSocial: 'SAGO MEDICAL SERVICE SA DE CV', nombreCorto: 'SAGO MEDICAL SERVICE',
      idcif: '20090146505', regimenFiscal: '601',
      calle: 'NAYARIT', numExt: '56', numInt: '', colonia: 'ROMA SUR',
      cp: '06760', municipio: 'CUAUHTEMOC', estado: 'CIUDAD DE MEXICO', pais: 'MX',
    },
  };
  const r = buildCsfDatosDesdeRespuesta(json);
  assert.strictEqual(r.error, undefined);
  assert.strictEqual(r.datos.rfc, 'SMS200716NZ4');
  assert.strictEqual(r.datos.calle, 'NAYARIT');
  assert.strictEqual(r.datos.numExt, '56');
  assert.strictEqual(r.datos.numInt, '');
  assert.strictEqual(r.datos.colonia, 'ROMA SUR');
});

test('C31: buildCsfDatosDesdeRespuesta con ok:false retorna error sin datos', () => {
  const json = { ok: false, error: 'No se detecto un RFC en el texto' };
  const r = buildCsfDatosDesdeRespuesta(json);
  assert.strictEqual(r.datos, undefined);
  assert.strictEqual(r.error, 'No se detecto un RFC en el texto');
});

test('C32: buildCsfDatosDesdeRespuesta con respuesta vacia/malformada retorna error generico', () => {
  const r = buildCsfDatosDesdeRespuesta({});
  assert.strictEqual(r.datos, undefined);
  assert.ok(r.error, 'debe traer un mensaje de error');
});

// ─── altaCsfResultadoParseo: decide que mostrar/poblar tras llamar al endpoint (issue #34) ──
// El parser viejo (altaCsfParsearTexto) NUNCA fallaba -- siempre devolvia un objeto (con
// rfc:'' si no detectaba nada), dejando csf-detalles visible para captura manual. El endpoint
// centralizado SI puede responder ok:false (422, "no se detecto RFC"). Sin esta capa, ese caso
// se traduciria en pantalla de error sin salida (csf-detalles oculto, banner de error sin
// boton para continuar) -- regresion de UX vs el flujo viejo. Esta funcion pura decide:
// si hay datos (con o sin RFC) -> mostrar success + poblar formulario para revision manual;
// si la llamada al endpoint fallo de plano (red/parseo malformado) -> mostrar error.

test('C33: con datos completos -> resultado success, puebla formulario con los datos', () => {
  const r = altaCsfResultadoParseo({ datos: { rfc: 'SMS200716NZ4', razonSocial: 'SAGO SA' } }, 'archivo.pdf');
  assert.strictEqual(r.status, 'success');
  assert.strictEqual(r.datos.rfc, 'SMS200716NZ4');
  assert.ok(r.bannerText.includes('SMS200716NZ4'), `bannerText: ${r.bannerText}`);
});

test('C34: sin RFC detectado (422 del endpoint) -> sigue siendo success con datos vacios editables (NO error sin salida)', () => {
  const r = altaCsfResultadoParseo({ error: 'No se detecto un RFC en el texto' }, 'archivo.pdf');
  assert.strictEqual(r.status, 'success');
  assert.strictEqual(r.datos.rfc, '');
  assert.ok(r.bannerText.includes('no detectado'), `bannerText: ${r.bannerText}`);
});

test('C35: datos vacios producen un objeto datos con todas las claves esperadas (formulario no truena)', () => {
  const r = altaCsfResultadoParseo({ error: 'algo' }, 'x.pdf');
  for (const k of ['rfc','razonSocial','nombreCorto','idcif','regimenFiscal','calle','numExt','numInt','colonia','cp','municipio','estado']) {
    assert.strictEqual(r.datos[k], '', `${k} deberia ser string vacio`);
  }
});

// ─── Cuando intentar el QR del SAT (issue #378) ───────────────────────────────
//
// El QR es la fuente oficial y la mas robusta, pero consultarlo pega al servidor
// del SAT: se intenta SOLO cuando la lectura del PDF no dio RFC, ya sea porque
// no tiene capa de texto (los glifos vienen como trazos) o porque el texto que
// tiene no produjo RFC.

test('C36: un PDF con capa de texto de verdad se declara legible', () => {
  assert.strictEqual(csfTieneCapaDeTexto(180, 'CONSTANCIA DE SITUACION FISCAL R.F.C. : PEGJ850214HN2 ' + 'x'.repeat(60)), true);
});

test('C37: sin items de texto no hay capa de texto (la CSF viene como trazos)', () => {
  assert.strictEqual(csfTieneCapaDeTexto(0, ''), false);
});

test('C38: unos pocos caracteres sueltos no son una capa de texto', () => {
  assert.strictEqual(csfTieneCapaDeTexto(12, 'Pagina 1 de 2'), false);
});

test('C39: sin capa de texto -> se intenta el QR', () => {
  assert.strictEqual(csfDebeIntentarQR({ hayCapaDeTexto: false, rfcDetectado: false }), true);
});

test('C40: con capa de texto pero SIN RFC -> se intenta el QR (el caso del ticket)', () => {
  assert.strictEqual(csfDebeIntentarQR({ hayCapaDeTexto: true, rfcDetectado: false }), true);
});

test('C41: el texto del PDF dio RFC -> el QR no se consulta (no se pega al SAT)', () => {
  assert.strictEqual(csfDebeIntentarQR({ hayCapaDeTexto: true, rfcDetectado: true }), false);
});

// ─── El banner dice por que vias se intento (issue #378) ──────────────────────

test('C42: datos leidos del QR -> el banner lo dice', () => {
  const r = altaCsfResultadoParseo({ datos: { rfc: 'PEGJ850214HN2' } }, 'csf.pdf', RESULTADO_QR.OK);
  assert.strictEqual(r.status, 'success');
  assert.ok(r.bannerText.includes('PEGJ850214HN2'), `bannerText: ${r.bannerText}`);
  assert.ok(/QR/i.test(r.bannerText), `bannerText: ${r.bannerText}`);
});

test('C43: el PDF no trae codigo QR -> el banner lo dice', () => {
  const r = altaCsfResultadoParseo(null, 'csf.pdf', RESULTADO_QR.SIN_CODIGO);
  assert.strictEqual(r.status, 'success');
  assert.ok(/QR/i.test(r.bannerText), `bannerText: ${r.bannerText}`);
  assert.ok(r.bannerText.includes('manualmente'), `bannerText: ${r.bannerText}`);
});

test('C44: el lector de QR no cargo -> el banner lo dice en vez de callarlo', () => {
  const r = altaCsfResultadoParseo(null, 'csf.pdf', RESULTADO_QR.SIN_LECTOR);
  assert.ok(/lector/i.test(r.bannerText), `bannerText: ${r.bannerText}`);
});

test('C45: el SAT contesto y tampoco dio RFC -> el banner dice que se intentaron las dos vias', () => {
  const r = altaCsfResultadoParseo(null, 'csf.pdf', RESULTADO_QR.SIN_RFC);
  assert.ok(/texto/i.test(r.bannerText) && /QR/i.test(r.bannerText), `bannerText: ${r.bannerText}`);
});

// El PDF sin capa de texto llega aqui con respuesta null: el banner NO puede
// decir "se intento por el texto del PDF" cuando por ahi no se intento nada.
test('C47: el SAT no respondio -> el banner culpa al SAT y no inventa un intento por texto', () => {
  const r = altaCsfResultadoParseo(null, 'csf.pdf', RESULTADO_QR.SIN_RESPUESTA);
  assert.ok(/SAT/.test(r.bannerText), `bannerText: ${r.bannerText}`);
  assert.ok(!/texto del PDF/i.test(r.bannerText), `bannerText: ${r.bannerText}`);
});

test('C48: el PDF sin codigo QR tampoco afirma nada del texto del PDF', () => {
  const r = altaCsfResultadoParseo(null, 'csf.pdf', RESULTADO_QR.SIN_CODIGO);
  assert.ok(!/texto/i.test(r.bannerText), `bannerText: ${r.bannerText}`);
});

test('C46: sin intento de QR el banner es el de siempre', () => {
  const r = altaCsfResultadoParseo({ error: 'No se detecto un RFC en el texto' }, 'archivo.pdf');
  assert.ok(r.bannerText.includes('RFC no detectado, captura los datos manualmente'), `bannerText: ${r.bannerText}`);
});
