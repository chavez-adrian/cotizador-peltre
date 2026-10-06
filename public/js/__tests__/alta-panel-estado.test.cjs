'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

// === Estado del panel de alta (issues #192 y #193) ===
// Dos nucleos puros que app.js no puede testear por si mismo (efectos de
// navegador en scope de modulo):
//   - usoCfdiPorDefecto: el panel es UNO solo para el alta y para el upgrade
//     fiscal, pero cada modo trae su propio default historico (#193).
//   - estadoAltaAlAbrirPanel: al reabrir el panel hay que distinguir un alta ya
//     COMPLETADA (rastro que corrompe al cliente anterior si sobrevive) de un
//     alta a medias que el borrador de #185 restaura a proposito.

let usoCfdiPorDefecto, estadoAltaAlAbrirPanel, constanciaAlAbrirAlta, constanciaViva, buildAltaDarDeAltaPayload;
let lecturaVigente, sinConstancia, visibilidadPanelCsf, estadoTrasErrorLectura;
let planRestauracionFormulario, RESTAURACION_SUPERFICIE, serializarBorradorFormulario, deserializarBorradorFormulario;
before(async () => {
  ({
    usoCfdiPorDefecto, estadoAltaAlAbrirPanel, constanciaAlAbrirAlta, constanciaViva, buildAltaDarDeAltaPayload,
    lecturaVigente, sinConstancia, visibilidadPanelCsf, estadoTrasErrorLectura,
  } = await import('../alta-logica.js'));
  ({
    planRestauracionFormulario, RESTAURACION_SUPERFICIE, serializarBorradorFormulario, deserializarBorradorFormulario,
  } = await import('../borrador-form-logica.js'));
});

// --- usoCfdiPorDefecto (#193) -------------------------------------------------

test('U1: sin modo upgrade (alta completa) el default es G03', () => {
  assert.strictEqual(usoCfdiPorDefecto(null), 'G03');
});

test('U2: en modo upgrade el default es S01, el mismo que fuerza DIFF_FISCAL_CAMPOS', () => {
  assert.strictEqual(usoCfdiPorDefecto(492), 'S01');
});

test('U3: el modo se decide por "hay customer_id", no por su verdad -- el id 0 sigue siendo upgrade', () => {
  assert.strictEqual(usoCfdiPorDefecto(0), 'S01');
});

// --- estadoAltaAlAbrirPanel (#192) -------------------------------------------

const ESTADO_ALTA_COMPLETADA = {
  catalogos: { segmentos: [{ id: 1, nombre: 'Sin segmento' }] },
  seccionAbierta: 4,
  altaCompletada: true,
  customer_id: 501,
  branch_id: 77,
  clienteExistente: { id: 501, branchIdx: 0 },
  datos: { rfc: 'SMS200716NZ4', razonSocial: 'Sago Medical Service SA de CV' },
  domicilio: { br_name: 'Almacen Central' },
  modo: 'manual',
};

test('R1: tras un alta completada el panel se reabre sin el cliente destino del alta anterior', () => {
  const { estado, reiniciado } = estadoAltaAlAbrirPanel(ESTADO_ALTA_COMPLETADA);
  assert.strictEqual(reiniciado, true);
  // Las tres llaves que decidian SOBRE QUE cliente aplica el alta: si sobreviven,
  // el alta del cliente nuevo se escribe encima del anterior.
  assert.strictEqual(estado.customer_id, null);
  assert.strictEqual(estado.branch_id, null);
  assert.strictEqual(estado.clienteExistente, null);
  assert.strictEqual(estado.datos, null);
  assert.strictEqual(estado.domicilio, null);
  assert.strictEqual(estado.altaCompletada, false);
});

test('R2: un alta a medias NO se reinicia -- es lo que el borrador de #185 restaura a proposito', () => {
  const enCurso = { datos: { rfc: 'SMS200716NZ4' }, clienteExistente: { id: 480 }, seccionAbierta: 2 };
  const { estado, reiniciado } = estadoAltaAlAbrirPanel(enCurso);
  assert.strictEqual(reiniciado, false);
  assert.deepStrictEqual(estado.datos, { rfc: 'SMS200716NZ4' });
  assert.deepStrictEqual(estado.clienteExistente, { id: 480 });
});

test('R3: un alta que fallo despues de crear el cliente conserva su customer_id para Reintentar', () => {
  const fallida = { altaCompletada: false, customer_id: 501, branch_id: 77 };
  const { estado, reiniciado } = estadoAltaAlAbrirPanel(fallida);
  assert.strictEqual(reiniciado, false);
  assert.strictEqual(estado.customer_id, 501, 'reintentar debe aplicar sobre el MISMO cliente, no crear otro');
});

test('R4: el reinicio conserva los catalogos ya cargados (no pertenecen a ningun cliente)', () => {
  const { estado } = estadoAltaAlAbrirPanel(ESTADO_ALTA_COMPLETADA);
  assert.deepStrictEqual(estado.catalogos, ESTADO_ALTA_COMPLETADA.catalogos);
});

test('R5: el reinicio no muta el estado recibido', () => {
  const original = { ...ESTADO_ALTA_COMPLETADA };
  estadoAltaAlAbrirPanel(original);
  assert.strictEqual(original.customer_id, 501);
  assert.strictEqual(original.altaCompletada, true);
});

test('R6: sin estado previo devuelve un estado utilizable en vez de reventar', () => {
  const { reiniciado } = estadoAltaAlAbrirPanel(undefined);
  assert.strictEqual(reiniciado, false);
});

// --- Progreso del alta al abrir el upgrade fiscal (#432) ---------------------
// El lateral "Progreso del alta" vive en el MISMO nodo que el upgrade fiscal
// (#376/#412) y el upgrade nunca marca palomas: las que se ven al abrirlo son de
// un alta anterior de la misma pestana. Las palomas son solo DOM y app.js no se
// importa en Node, asi que se cuida el fuente -- mismo recurso que C16b
// (alta-dedup-fiscal.test.cjs) y AD6/AD7 (clientes-vista.test.cjs). Verlas vacias
// en pantalla es HITL.
function fuenteApp() {
  const fs = require('node:fs');
  const path = require('node:path');
  return fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
}

function cuerpoDeFuncion(src, firma) {
  const inicio = src.indexOf(firma);
  assert.ok(inicio > 0, `${firma} debe existir en app.js`);
  const fin = src.indexOf('\n}\n', inicio);
  assert.ok(fin > inicio, `${firma} debe cerrar`);
  return src.slice(inicio, fin);
}

test('#432-2: abrir el upgrade fiscal limpia las palomas que dejo un alta anterior', () => {
  const src = fuenteApp();
  const marcadas = [...src.matchAll(/getElementById\('chkdot-(\d+)'\)/g)].map(m => Number(m[1]));
  assert.ok(marcadas.length >= 3, 'el alta marca sus palomas por id: si deja de hacerlo, este test ya no cuida nada');
  const limpiar = cuerpoDeFuncion(src, 'function altaLimpiarProgreso(');
  assert.ok(limpiar.includes("classList.remove('done')"), 'limpiar es quitar la marca de hecho');
  const lista = limpiar.match(/\[([\d,\s]+)\]\.forEach/);
  assert.ok(lista, 'la limpieza recorre la lista de palomas');
  const limpiadas = lista[1].split(',').map(Number);
  for (const n of marcadas) assert.ok(limpiadas.includes(n), `la paloma ${n} que marca el alta tambien se limpia`);
  const upgrade = cuerpoDeFuncion(src, 'async function pcAbrirUpgradeFiscal(');
  const limpia = upgrade.indexOf('altaLimpiarProgreso()');
  assert.ok(limpia > 0, 'el upgrade no marca palomas: al abrirlo el progreso empieza limpio');
  assert.ok(limpia < upgrade.indexOf('await '), 'se limpia antes de ceder el hilo: el panel ya esta a la vista');
});

test('#432-3: el reinicio tras un alta completada y el upgrade comparten UNA limpieza del progreso', () => {
  const src = fuenteApp();
  assert.ok(cuerpoDeFuncion(src, 'function altaReiniciarPanel(').includes('altaLimpiarProgreso()'),
    'el reinicio de #192 limpia por el mismo camino, no por una copia');
  assert.strictEqual((src.match(/classList\.remove\('done'\)/g) || []).length, 1,
    'las palomas se limpian en un solo lugar');
});

// --- La constancia en memoria al abrir el alta (#491) ------------------------
// altaCsfState es UNO para el alta y el upgrade fiscal (el panel es el mismo nodo,
// #376). Tras un upgrade con constancia, "+ > Nuevo Cliente Operam" en la misma
// pestana abria la Seccion 1 con el RFC, los regimenes y el PDF del upgrade, y el
// POST del alta toma `altaState.datos || altaCsfState.datos` y ese `pdfBase64`.
const CONSTANCIA_DEL_UPGRADE = {
  status: 'success',
  rfc: 'OGA140604560',
  fileName: 'csf-operadora.pdf',
  datos: { rfc: 'OGA140604560', razonSocial: 'OPERADORA GASTRONOMICA', regimenFiscal: '605' },
  pdfBase64: 'JVBERi0xLjQK',
  regimenesDetectados: { rfc: 'OGA140604560', codigos: ['605', '611'] },
  confirmado: true,
  modoUpgrade: null,
  constanciaDeUpgrade: 15,
};

test('#491-1: abrir el alta despues de un upgrade con constancia arranca en idle y sin sus datos fiscales', () => {
  const { estado, descartada } = constanciaAlAbrirAlta(CONSTANCIA_DEL_UPGRADE);
  assert.strictEqual(descartada, true);
  assert.strictEqual(estado.status, 'idle', 'idle es lo que vuelve a mostrar la zona para soltar el PDF');
  assert.strictEqual(estado.datos, null);
  assert.strictEqual(estado.rfc, null);
  assert.strictEqual(estado.fileName, null);
  assert.strictEqual(estado.pdfBase64, null);
  assert.strictEqual(estado.regimenesDetectados, null, 'el aviso de varios regimenes sale de aqui');
  assert.strictEqual(estado.confirmado, false);
  assert.strictEqual(estado.constanciaDeUpgrade, null);
  assert.strictEqual(constanciaViva(estado), false);
});

// "Actualizar este" del alta confirma la Seccion 1 en altaState.datos y con ESOS datos
// corre el upgrade: al lograrse, la copia confirmada del alta es la constancia del
// upgrade, y el POST del alta toma `altaState.datos || altaCsfState.datos`.
test('#491-2: el POST del alta que se abre despues no lleva la constancia del upgrade', () => {
  const datosConfirmadosDelUpgrade = { ...CONSTANCIA_DEL_UPGRADE.datos };
  const { estado, datosAlta } = constanciaAlAbrirAlta(CONSTANCIA_DEL_UPGRADE, datosConfirmadosDelUpgrade);
  assert.strictEqual(datosAlta, null, 'la copia confirmada del alta se va con la constancia');
  const payload = buildAltaDarDeAltaPayload(datosAlta || estado.datos || {}, {}, {}, null, null, {
    pdfBase64: estado.pdfBase64,
    pdfRfc: estado.rfc,
  });
  assert.strictEqual(payload.pdf_base64, undefined);
  assert.strictEqual(payload.tax_id, '');
  assert.strictEqual(payload.CustName, '');
  assert.strictEqual(payload.cfdi_regimen_fiscal, '');
});

test('#491-2b: la Seccion 1 que el ALTA confirmo sigue viva al reabrir el panel', () => {
  const delAlta = { ...CONSTANCIA_DEL_UPGRADE, constanciaDeUpgrade: null };
  const confirmados = { ...CONSTANCIA_DEL_UPGRADE.datos };
  const { datosAlta } = constanciaAlAbrirAlta(delAlta, confirmados);
  assert.strictEqual(datosAlta, confirmados);
});

test('#491-3: la constancia que el ALTA cargo sigue viva al reabrir el panel en la misma pestana', () => {
  const delAlta = { ...CONSTANCIA_DEL_UPGRADE, constanciaDeUpgrade: null };
  const { estado, descartada } = constanciaAlAbrirAlta(delAlta);
  assert.strictEqual(descartada, false);
  assert.deepStrictEqual(estado, delAlta);
  assert.strictEqual(constanciaViva(estado), true);
});

test('#491-4: sin PDF, o con uno que fallo, no hay constancia viva', () => {
  assert.strictEqual(constanciaViva({ status: 'idle', datos: null }), false);
  assert.strictEqual(constanciaViva({ status: 'error', datos: { rfc: 'OGA140604560' } }), false,
    'un PDF que fallo no deja una constancia detras');
  assert.strictEqual(constanciaViva(undefined), false);
});

// La restauracion del borrador espera los catalogos (esperarListo) ANTES de preguntar
// por la constancia, y en esa ventana el vendedor ya puede haber soltado el PDF: con
// el spinner en pantalla, vaciar la constancia pisaria la lectura con 'idle' y el
// aviso diria "quedaron vacios" mientras el PDF se esta leyendo.
test('#491-9: una constancia que se esta leyendo no se vacia ni recibe el aviso de que quedo vacia', () => {
  const leyendose = { status: 'loading', datos: null, pdfBase64: 'JVBERi0xLjQK' };
  const borrador = deserializarBorradorFormulario(JSON.stringify(serializarBorradorFormulario({
    formId: 'alta-completa',
    valores: { 'csf-rfc': 'OGA140604560', 'csf-razon-social': 'OPERADORA GASTRONOMICA', 'alta-lista-precios': '3' },
    ahora: Date.now(),
  })), 'alta-completa');
  const plan = planRestauracionFormulario({
    borrador,
    idsPresentes: ['csf-rfc', 'csf-razon-social', 'alta-lista-precios'],
    superficie: RESTAURACION_SUPERFICIE.SIN_CONSTANCIA,
    constanciaViva: constanciaViva(leyendose),
  });
  assert.strictEqual(plan.vaciarConstancia, false, 'la lectura en curso no se pisa con idle');
  assert.strictEqual(plan.aviso, null, 'el aviso no dice vacio mientras el PDF se lee');
  assert.deepStrictEqual(plan.valores, { 'alta-lista-precios': '3' });
});

test('#491-5: descartar la constancia no muta el estado recibido', () => {
  const original = { ...CONSTANCIA_DEL_UPGRADE };
  constanciaAlAbrirAlta(original);
  assert.strictEqual(original.pdfBase64, 'JVBERi0xLjQK');
  assert.strictEqual(original.constanciaDeUpgrade, 15);
});

// El pegamento de #491 vive en app.js, que no se importa en Node: el ORDEN se cuida en
// el fuente, como #432-2. Que abrir el alta descarte la constancia del upgrade y la
// Seccion 1 lo prueba el modulo (modo-alta-logica.test.cjs MC1-MC3, #540), y que el
// upgrade la marque como suya, MC4 y MC5. Ver la Seccion 1 limpia en pantalla es HITL.
test('#491-6: abrir el alta decide la constancia al abrir y antes de restaurar el borrador', () => {
  const abrir = cuerpoDeFuncion(fuenteApp(), 'function abrirAcordeonAlta(');
  const plegar = abrir.indexOf("cerrarFormularioBorrador('alta-completa', null)");
  assert.ok(plegar > 0, 'la rama de plegar debe existir: si no, este test ya no cuida nada');
  const decide = abrir.indexOf('aperturaDelAlta(modoAlta, altaState.datos)');
  assert.ok(decide > plegar, 'se decide al ABRIR, no al plegar el panel (plegar no es cancelar, #185)');
  assert.ok(decide < abrir.indexOf('aplicarModoAlta(alAbrirAlta)'), 'el descarte se lee del estado ANTERIOR a la transicion');
  assert.ok(abrir.indexOf('altaState.datos = apertura.datosAlta') > decide);
  const pinta = abrir.indexOf('if (apertura.descartada) altaPintarConstanciaVacia()');
  assert.ok(pinta > 0 && pinta < abrir.indexOf("abrirFormularioBorrador('alta-completa')"),
    'antes de restaurar: el plan del borrador lee la constancia ya decidida');
});

test('#491-8: el alta completa le dice al plan si la constancia sigue viva y vacia la Seccion 1 cuando no', () => {
  const src = fuenteApp();
  const restaurar = cuerpoDeFuncion(src, 'async function restaurarBorradorFormulario(');
  assert.ok(restaurar.includes('constanciaViva: def.constanciaViva?.() === true'));
  assert.ok(restaurar.includes('if (plan.vaciarConstancia) def.vaciarConstancia?.()'));
  const inicio = src.indexOf("  'alta-completa': {");
  const def = src.slice(inicio, src.indexOf('\n  },', inicio));
  assert.ok(def.includes('constanciaViva: () => constanciaViva(modoAlta)'));
  assert.ok(def.includes('vaciarConstancia: () => altaVaciarConstancia()'));
});

// Una lectura del PDF tarda segundos (y mas si entra el respaldo por QR del SAT). Si en
// esa ventana el vendedor sale del upgrade y abre el alta -- o al reves --, o suelta
// otro PDF, el resultado de la lectura vieja ya no es de nadie: escribirlo dejaria la
// constancia de un flujo como la del otro.
test('#491-10: una lectura solo escribe si sigue siendo la vigente', () => {
  const leyendo = { status: 'loading', lectura: 7 };
  assert.strictEqual(lecturaVigente(leyendo, 7), true);
  assert.strictEqual(lecturaVigente(sinConstancia(leyendo), 7), false,
    'vaciar la constancia (abrir el alta tras un upgrade) deja huerfana la lectura en curso');
  assert.strictEqual(lecturaVigente({ ...leyendo, lectura: 8 }, 7), false, 'un PDF nuevo reemplaza al que se leia');
  assert.strictEqual(lecturaVigente(undefined, 7), false);
});

// Que una lectura vieja no escriba la constancia, y que abrir el upgrade deje huerfana la
// que habia empezado el alta, lo prueba el modulo (MC4 y MC8, #540). Aqui queda el
// cableado: la lectura se marca antes de ceder el hilo, y la pantalla y el borrador se
// saltan con el mismo predicado.
test('#491-11: el procesado del PDF descarta su resultado si la lectura dejo de ser vigente', () => {
  const procesar = cuerpoDeFuncion(fuenteApp(), 'async function altaCsfProcesarArchivo(');
  const marca = procesar.indexOf('aplicarModoAlta(alEmpezarLectura)');
  assert.ok(marca > 0 && marca < procesar.indexOf('await '), 'la lectura se marca antes de ceder el hilo');
  const despuesDeLeer = procesar.slice(procesar.indexOf('await altaCsfLeerPDF('));
  const vigente = despuesDeLeer.indexOf('if (!lecturaVigente(modoAlta, lectura)) return;');
  assert.ok(vigente > 0 && vigente < despuesDeLeer.indexOf('aplicarModoAlta(alLeerConstancia'),
    'el resultado se revisa antes de escribir la constancia');
  assert.ok(vigente < despuesDeLeer.indexOf('altaCsfPonerDatos('), 'ni la Seccion 1 ni el borrador reciben una lectura vieja');
  const atrapa = procesar.slice(procesar.indexOf('} catch (err) {'));
  const vigenteError = atrapa.indexOf('if (!lecturaVigente(modoAlta, lectura)) return;');
  assert.ok(vigenteError > 0 && vigenteError < atrapa.indexOf('altaCsfPintarStatus({ mensaje })'),
    'el error de una lectura vieja no pinta encima de la vigente');
});

// La marca de la constancia al lograrse la prueba el modulo (MC5, #540); aqui queda que
// app.js aplica esa transicion con el id y consume altaState.datos solo al lograrse.
test('#491-12: el upgrade logrado consume la Seccion 1 que el alta habia confirmado', () => {
  const ejecutar = cuerpoDeFuncion(fuenteApp(), 'async function pcEjecutarUpgradeFiscal(');
  const lograda = ejecutar.indexOf("vista.tipo !== 'lograda'");
  assert.ok(lograda > 0);
  assert.ok(ejecutar.indexOf('aplicarModoAlta(alLograrActualizacion, customerId)') > lograda,
    'la transicion recibe el id del cliente actualizado, solo al lograrse');
  assert.ok(ejecutar.indexOf('altaState.datos = null') > lograda,
    'solo al lograrse: si el upgrade falla, "Actualizar este" se reintenta con esos datos');
});

// --- La constancia que falla al leerse (#516) ---------------------------------
// Un PDF danado o un fallo de red al parsear terminaban en 'error' con la zona para
// soltar el PDF oculta y sin reintento: la unica salida era cerrar el panel. El panel
// es el mismo nodo para el alta y el upgrade fiscal (#376), asi que vale en los dos.

test('#516-1: tras un error se ven el banner del error Y la zona para soltar otro PDF', () => {
  assert.deepStrictEqual(visibilidadPanelCsf('error'),
    { dropzone: true, spinner: false, bannerOk: false, bannerErr: true, detalles: false });
});

test('#516-2: idle, loading y success se ven igual que antes de #516', () => {
  assert.deepStrictEqual(visibilidadPanelCsf('idle'),
    { dropzone: true, spinner: false, bannerOk: false, bannerErr: false, detalles: false });
  assert.deepStrictEqual(visibilidadPanelCsf('loading'),
    { dropzone: false, spinner: true, bannerOk: false, bannerErr: false, detalles: false });
  assert.deepStrictEqual(visibilidadPanelCsf('success'),
    { dropzone: false, spinner: false, bannerOk: true, bannerErr: false, detalles: true },
    'tras una lectura buena la zona del PDF se oculta: no hay "Cambiar PDF" (fuera de #516)');
});

// Tras un error la ranura de la constancia queda vacia: nada de un PDF anterior sigue
// en memoria con la pantalla diciendo "error" (la misma clase de bug que #491).
test('#516-3: un error de lectura descarta la constancia entera y guarda el mensaje', () => {
  const estado = estadoTrasErrorLectura(CONSTANCIA_DEL_UPGRADE, 'Error al leer el PDF: Invalid PDF structure');
  assert.strictEqual(estado.status, 'error');
  assert.strictEqual(estado.mensaje, 'Error al leer el PDF: Invalid PDF structure');
  assert.strictEqual(estado.datos, null);
  assert.strictEqual(estado.rfc, null);
  assert.strictEqual(estado.fileName, null);
  assert.strictEqual(estado.pdfBase64, null, 'el POST no puede llevar el PDF de la constancia anterior');
  assert.strictEqual(estado.regimenesDetectados, null);
  assert.strictEqual(estado.confirmado, false);
});

// El panel es el mismo nodo para el alta y el upgrade fiscal (#376): el error vacia la
// constancia, no el flujo. Si perdiera `constanciaDeUpgrade`, la CSF buena que el
// vendedor suelte despues en el upgrade pasaria por la del alta y la heredaria el
// "Nuevo cliente" que se abra en la misma pestana (#491).
test('#516-4: en el upgrade fiscal el error conserva el modo, su origen, la precarga comercial y la marca del upgrade', () => {
  const comercial = { salesType: '3', segmento: '12' };
  const enUpgrade = {
    ...CONSTANCIA_DEL_UPGRADE,
    modoUpgrade: 15,
    upgradeOrigen: 'clientes',
    comercialPrecargado: comercial,
    constanciaDeUpgrade: 15,
  };
  const estado = estadoTrasErrorLectura(enUpgrade, 'Error al leer el PDF: Failed to fetch');
  assert.strictEqual(estado.modoUpgrade, 15);
  assert.strictEqual(estado.upgradeOrigen, 'clientes');
  assert.strictEqual(estado.comercialPrecargado, comercial);
  assert.strictEqual(estado.constanciaDeUpgrade, 15);
});

test('#516-5: tras un error no hay constancia viva y el estado recibido no se toca', () => {
  const original = { ...CONSTANCIA_DEL_UPGRADE };
  const estado = estadoTrasErrorLectura(original, 'Error al leer el PDF: Invalid PDF structure');
  assert.strictEqual(constanciaViva(estado), false,
    'el aviso del borrador de que los datos fiscales quedaron vacios sigue siendo cierto');
  assert.strictEqual(original.status, 'success');
  assert.strictEqual(original.pdfBase64, 'JVBERi0xLjQK');
});
