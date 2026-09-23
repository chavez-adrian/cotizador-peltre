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

let usoCfdiPorDefecto, estadoAltaAlAbrirPanel;
before(async () => {
  ({ usoCfdiPorDefecto, estadoAltaAlAbrirPanel } = await import('../alta-logica.js'));
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
