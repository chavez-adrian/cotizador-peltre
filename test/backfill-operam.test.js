import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { esCandidatoBackfill, esActivoParaImportar, mapearSalesman, construirEntradaCotizacion, subtotalDesdeTotal, folioYaExiste, planearBackfill } from '../lib/backfill-operam.mjs';

// Mapa de vendedores como el de data/vendedores.json (operam_id -> vendedor).
const VENDEDORES = [
  { id: 1, name: 'Adrián Chávez', operam_id: 1 },
  { id: 2, name: 'Alejandro Chávez', operam_id: 2 },
  { id: 3, name: 'Oswaldo Chávez', operam_id: 8 },
  { id: 4, name: 'Alejandro Castañón', operam_id: 9 },
  { id: 5, name: 'Jaime Abaroa', operam_id: null },
];

// Backfill de cotizaciones reales via pedidos (issue #76). Funciones PURAS;
// el script scripts/backfill-operam.mjs las orquesta con IO inyectada. Sin
// llamadas a Operam real aqui (mocks / datos crudos).

// --- esCandidatoBackfill: filtro de pedidos que representan una cotizacion ---

test('esCandidatoBackfill: pedido con trans_no_from no vacio es candidato', () => {
  assert.equal(esCandidatoBackfill({ order_no: '7269', trans_no_from: '1141', debtor_no: '394' }), true);
});

test('esCandidatoBackfill: venta directa (trans_no_from vacio) NO es candidato', () => {
  assert.equal(esCandidatoBackfill({ order_no: '8000', trans_no_from: '', debtor_no: '500' }), false);
  assert.equal(esCandidatoBackfill({ order_no: '8001', trans_no_from: null, debtor_no: '500' }), false);
  assert.equal(esCandidatoBackfill({ order_no: '8002', debtor_no: '500' }), false);
});

test('esCandidatoBackfill: excluye el pedido de prueba 7270 (sonda de #67)', () => {
  assert.equal(esCandidatoBackfill({ order_no: '7270', trans_no_from: '1163', debtor_no: '394' }), false);
  // tolera order_no numerico ademas de string
  assert.equal(esCandidatoBackfill({ order_no: 7270, trans_no_from: '1163', debtor_no: 394 }), false);
});

test('esCandidatoBackfill: excluye debtors de prueba PUBLICO EN GENERAL (14) y 1', () => {
  assert.equal(esCandidatoBackfill({ order_no: '8100', trans_no_from: '1200', debtor_no: '14' }), false);
  assert.equal(esCandidatoBackfill({ order_no: '8101', trans_no_from: '1201', debtor_no: 14 }), false);
  assert.equal(esCandidatoBackfill({ order_no: '8102', trans_no_from: '1202', debtor_no: '1' }), false);
  assert.equal(esCandidatoBackfill({ order_no: '8103', trans_no_from: '1203', debtor_no: 1 }), false);
});

test('esCandidatoBackfill: pedido nulo o sin order_no no es candidato', () => {
  assert.equal(esCandidatoBackfill(null), false);
  assert.equal(esCandidatoBackfill(undefined), false);
  assert.equal(esCandidatoBackfill({ trans_no_from: '1300' }), false);
});

// --- esActivoParaImportar: solo se importan oportunidades activas ---

test('esActivoParaImportar: producto_entregado NO se importa (oportunidad cerrada)', () => {
  assert.equal(esActivoParaImportar('producto_entregado'), false);
});

test('esActivoParaImportar: etapas activas post-venta SI se importan', () => {
  assert.equal(esActivoParaImportar('anticipo_pagado'), true);
  assert.equal(esActivoParaImportar('pedido_liberado'), true);
  assert.equal(esActivoParaImportar('saldo_pagado'), true);
});

test('esActivoParaImportar: seguimiento (sin etapa post-venta) SI se importa', () => {
  // etapaPostVenta devuelve null cuando ningun hecho post-venta aplica; la
  // cotizacion existe (hay pedido) pero la etapa base es seguimiento -> activa.
  assert.equal(esActivoParaImportar('seguimiento'), true);
  assert.equal(esActivoParaImportar(null), true);
  assert.equal(esActivoParaImportar(undefined), true);
});

// --- mapearSalesman: salesman de Operam (operam_id) -> nombre de vendedor ---

test('mapearSalesman: el salesman es el operam_id; devuelve el nombre del vendedor', () => {
  assert.equal(mapearSalesman(8, VENDEDORES), 'Oswaldo Chávez');
  assert.equal(mapearSalesman('9', VENDEDORES), 'Alejandro Castañón');
  assert.equal(mapearSalesman(1, VENDEDORES), 'Adrián Chávez');
});

test('mapearSalesman: salesman sin match en vendedores -> null (sin inventar)', () => {
  assert.equal(mapearSalesman(99, VENDEDORES), null);
  assert.equal(mapearSalesman(null, VENDEDORES), null);
  assert.equal(mapearSalesman('', VENDEDORES), null);
  assert.equal(mapearSalesman(undefined, VENDEDORES), null);
});

test('mapearSalesman: no matchea contra operam_id null (Jaime Abaroa) por un salesman vacio', () => {
  // El vendedor sin operam_id no debe capturar salesman ausentes/nulos.
  assert.equal(mapearSalesman(null, VENDEDORES), null);
});

// --- subtotalDesdeTotal: el total de Operam incluye IVA 16% (peltre-operam.md 12.6) ---

test('subtotalDesdeTotal: deriva el subtotal de total/1.16 cuando no hay subtotal nativo', () => {
  // 16954 con IVA -> 14615.52 sin IVA
  assert.equal(subtotalDesdeTotal(16954), Number((16954 / 1.16).toFixed(2)));
});

test('subtotalDesdeTotal: tolera string y total ausente', () => {
  assert.equal(subtotalDesdeTotal('1160'), 1000);
  assert.equal(subtotalDesdeTotal(0), 0);
  assert.equal(subtotalDesdeTotal(null), 0);
  assert.equal(subtotalDesdeTotal(undefined), 0);
});

// --- construirEntradaCotizacion: pedido + quote + debtor + etapa -> entrada del store ---

// Caso de referencia tomado de la cadena verificada en vivo (peltre-operam.md 12.2):
// cotizacion 1141 -> pedido order_no 7269 (Juana Hernandez, debtor 394).
const PEDIDO = { order_no: '7269', trans_no_from: '1141', debtor_no: '394', total: '16954' };
const QUOTE = {
  trans_no: '1141',
  ord_date: '2026-05-20',
  delivery_date: '2026-06-19',
  cust_ref: 'Tienda Juana',
  total: '16954',
  salesman: 8,
};
const DEBTOR = { debtor_no: '394', CustName: 'JUANA HERNANDEZ GARCIA', tax_id: 'HEGJ800101AB1', curr_code: 'MXN' };

// --- folioYaExiste: idempotencia del backfill por folioOperam ---

test('folioYaExiste: detecta un folioOperam ya presente en la lista (sin recrear)', () => {
  const cots = [
    { id: 1, folioOperam: '1140', data: {} },
    { id: 2, folioOperam: '1141', data: {} },
  ];
  assert.equal(folioYaExiste(cots, '1141'), true);
  assert.equal(folioYaExiste(cots, 1141), true);   // tolera numero
  assert.equal(folioYaExiste(cots, '9999'), false);
});

test('folioYaExiste: lista vacia o folio nulo -> false', () => {
  assert.equal(folioYaExiste([], '1141'), false);
  assert.equal(folioYaExiste(null, '1141'), false);
  assert.equal(folioYaExiste([{ id: 1, folioOperam: '1141' }], null), false);
  assert.equal(folioYaExiste([{ id: 1, folioOperam: '1141' }], ''), false);
});

test('construirEntradaCotizacion: arma los campos de cabecera que pidio Adrian', () => {
  const entrada = construirEntradaCotizacion({
    pedido: PEDIDO, quote: QUOTE, debtor: DEBTOR, etapa: 'saldo_pagado', vendedores: VENDEDORES,
  });
  // Columnas fijas de la tabla cotizaciones
  assert.equal(entrada.fecha, '2026-05-20');
  assert.equal(entrada.vendedor, 'Oswaldo Chávez');     // salesman 8 -> operam_id 8
  assert.equal(entrada.cliente, 'JUANA HERNANDEZ GARCIA');
  assert.equal(entrada.total, 16954);
  assert.equal(entrada.tier, null);                      // los quotes no traen el tier del cotizador
  // folioOperam = numero de cotizacion = trans_no_from del pedido
  assert.equal(entrada.folioOperam, '1141');
  assert.equal(entrada.etapa, 'saldo_pagado');
  // Campos extra en data (las columnas de la tabla son fijas)
  assert.equal(entrada.data.cliente.rfc, 'HEGJ800101AB1');
  assert.equal(entrada.data.cliente.customer_ref, 'Tienda Juana');
  assert.equal(entrada.data.subtotal, Number((16954 / 1.16).toFixed(2)));
  assert.equal(entrada.data.moneda, 'MXN');
  assert.equal(entrada.data.validoHasta, '2026-06-19'); // delivery_date del quote
  assert.equal(entrada.data.orderOperam, '7269');       // order_no del pedido (binding preciso)
  assert.equal(entrada.data.backfill, true);
});

test('construirEntradaCotizacion: usa subtotal nativo del quote si viene', () => {
  const quoteConSub = { ...QUOTE, subtotal: '14615.52' };
  const entrada = construirEntradaCotizacion({
    pedido: PEDIDO, quote: quoteConSub, debtor: DEBTOR, etapa: 'seguimiento', vendedores: VENDEDORES,
  });
  assert.equal(entrada.data.subtotal, 14615.52);
});

test('construirEntradaCotizacion: customer_ref tolera nombre customer_ref ademas de cust_ref', () => {
  const quoteAlt = { ...QUOTE, cust_ref: undefined, customer_ref: 'Ref Alterna' };
  const entrada = construirEntradaCotizacion({
    pedido: PEDIDO, quote: quoteAlt, debtor: DEBTOR, etapa: 'seguimiento', vendedores: VENDEDORES,
  });
  assert.equal(entrada.data.cliente.customer_ref, 'Ref Alterna');
});

test('construirEntradaCotizacion: salesman sin match deja vendedor null (no inventa)', () => {
  const quoteSinVend = { ...QUOTE, salesman: 77 };
  const entrada = construirEntradaCotizacion({
    pedido: PEDIDO, quote: quoteSinVend, debtor: DEBTOR, etapa: 'seguimiento', vendedores: VENDEDORES,
  });
  assert.equal(entrada.vendedor, null);
});

test('construirEntradaCotizacion: el RFC en data.cliente.rfc va en mayusculas (clave de sync #62)', () => {
  const debtorLower = { ...DEBTOR, tax_id: 'hegj800101ab1' };
  const entrada = construirEntradaCotizacion({
    pedido: PEDIDO, quote: QUOTE, debtor: debtorLower, etapa: 'seguimiento', vendedores: VENDEDORES,
  });
  assert.equal(entrada.data.cliente.rfc, 'HEGJ800101AB1');
});

// --- planearBackfill: orquestacion pura del run con IO inyectada ---
// Enumera pedidos (paginado), filtra candidatos, deriva etapa, lee cabecera del
// quote + debtor y produce un PLAN: { importar: [entradas], skips: {...}, ... }.
// Sin Operam real (todas las lecturas son mocks inyectados).

// Helper: arma deps de planearBackfill con datos en memoria.
function planDeps({ pedidos = [], debtors = {}, quotes = {}, etapas = {}, cotizaciones = [] } = {}) {
  const llamadas = { quotes: [], debtors: [] };
  // Pagina de 100: la primera pagina trae todo, las siguientes vacio.
  const listarPedidosPagina = async ({ skip }) => (skip === 0 ? pedidos : []);
  const obtenerDebtor = async (debtorNo) => { llamadas.debtors.push(String(debtorNo)); return debtors[String(debtorNo)] || null; };
  const obtenerQuote = async (folio) => { llamadas.quotes.push(String(folio)); return quotes[String(folio)] || null; };
  // etapaDe(op) simula hechosDeOperam+etapaPostVenta: devuelve la etapa por order_no.
  const etapaDe = async (op) => etapas[String(op?.data?.orderOperam)] ?? 'seguimiento';
  return {
    llamadas,
    deps: {
      listarPedidosPagina,
      obtenerDebtor,
      obtenerQuote,
      etapaDe,
      listarCotizaciones: async () => cotizaciones,
      vendedores: VENDEDORES,
      desde: '2024-06-01', hasta: '2026-06-30',
    },
  };
}

test('planearBackfill: importa un candidato activo con cabecera completa', async () => {
  const { deps } = planDeps({
    pedidos: [PEDIDO],
    debtors: { '394': DEBTOR },
    quotes: { '1141': QUOTE },
    etapas: { '7269': 'saldo_pagado' },
    cotizaciones: [],
  });
  const plan = await planearBackfill(deps);
  assert.equal(plan.importar.length, 1);
  const e = plan.importar[0];
  assert.equal(e.folioOperam, '1141');
  assert.equal(e.etapa, 'saldo_pagado');
  assert.equal(e.cliente, 'JUANA HERNANDEZ GARCIA');
  assert.equal(e.data.orderOperam, '7269');
  assert.equal(e.total, 16954);
  assert.equal(plan.skips.entregado, 0);
  assert.equal(plan.skips.duplicado, 0);
  assert.equal(plan.skips.noCandidato, 0);
});

test('planearBackfill: SKIP entregado (producto_entregado no se importa)', async () => {
  const { deps } = planDeps({
    pedidos: [PEDIDO],
    debtors: { '394': DEBTOR },
    quotes: { '1141': QUOTE },
    etapas: { '7269': 'producto_entregado' },
  });
  const plan = await planearBackfill(deps);
  assert.equal(plan.importar.length, 0);
  assert.equal(plan.skips.entregado, 1);
});

test('planearBackfill: SKIP duplicado (folioOperam ya existe en el store)', async () => {
  const { deps } = planDeps({
    pedidos: [PEDIDO],
    debtors: { '394': DEBTOR },
    quotes: { '1141': QUOTE },
    etapas: { '7269': 'saldo_pagado' },
    cotizaciones: [{ id: 5, folioOperam: '1141', data: {} }],
  });
  const plan = await planearBackfill(deps);
  assert.equal(plan.importar.length, 0);
  assert.equal(plan.skips.duplicado, 1);
});

test('planearBackfill: SKIP no-candidato (venta directa y pedido de prueba) sin leer quote', async () => {
  const ventaDirecta = { order_no: '8000', trans_no_from: '', debtor_no: '500' };
  const prueba = { order_no: '7270', trans_no_from: '1163', debtor_no: '394' };
  const { deps, llamadas } = planDeps({
    pedidos: [ventaDirecta, prueba, PEDIDO],
    debtors: { '394': DEBTOR },
    quotes: { '1141': QUOTE },
    etapas: { '7269': 'seguimiento' },
  });
  const plan = await planearBackfill(deps);
  assert.equal(plan.importar.length, 1);
  assert.equal(plan.skips.noCandidato, 2);
  // No debe leer el quote de los no-candidatos (read-only barato).
  assert.deepEqual(llamadas.quotes, ['1141']);
});

test('planearBackfill: pagina (varias paginas de pedidos)', async () => {
  // 100 candidatos en la primera pagina + 1 en la segunda: listarPedidosPagina
  // debe llamarse hasta agotar.
  const pagina1 = Array.from({ length: 100 }, (_, i) => ({
    order_no: String(9000 + i), trans_no_from: String(2000 + i), debtor_no: '394',
  }));
  const pagina2 = [{ order_no: '9100', trans_no_from: '2100', debtor_no: '394' }];
  const debtors = { '394': DEBTOR };
  const quotes = {};
  const etapas = {};
  for (const p of [...pagina1, ...pagina2]) {
    quotes[p.trans_no_from] = { ...QUOTE, trans_no: p.trans_no_from };
    etapas[p.order_no] = 'seguimiento';
  }
  const deps = {
    listarPedidosPagina: async ({ skip }) => (skip === 0 ? pagina1 : skip === 100 ? pagina2 : []),
    obtenerDebtor: async () => DEBTOR,
    obtenerQuote: async (folio) => quotes[String(folio)],
    etapaDe: async (op) => etapas[String(op?.data?.orderOperam)],
    listarCotizaciones: async () => [],
    vendedores: VENDEDORES,
    desde: '2024-06-01', hasta: '2026-06-30',
  };
  const plan = await planearBackfill(deps);
  assert.equal(plan.totalPedidos, 101);
  assert.equal(plan.importar.length, 101);
});

test('planearBackfill: dos candidatos con el MISMO folio en la corrida no se duplican entre si', async () => {
  // Idempotencia intra-corrida: aunque dos pedidos compartan trans_no_from (no
  // deberia pasar, pero defensivo), solo se importa uno.
  const p1 = { order_no: '7269', trans_no_from: '1141', debtor_no: '394' };
  const p2 = { order_no: '7269', trans_no_from: '1141', debtor_no: '394' };
  const { deps } = planDeps({
    pedidos: [p1, p2],
    debtors: { '394': DEBTOR },
    quotes: { '1141': QUOTE },
    etapas: { '7269': 'seguimiento' },
  });
  const plan = await planearBackfill(deps);
  assert.equal(plan.importar.length, 1);
  assert.equal(plan.skips.duplicado, 1);
});

// --- Idempotencia end-to-end contra el store JSON real (sin DATABASE_URL) ---
// Crear con `crear` + `setFolioOperam`, releer con `listar` y comprobar que
// folioYaExiste lo reconoce: re-correr el backfill no duplicaria.

const __dirname = dirname(fileURLToPath(import.meta.url));
const COTS_PATH = join(__dirname, '..', 'data', 'cotizaciones.json');
function readCots() {
  if (!existsSync(COTS_PATH)) return [];
  return JSON.parse(readFileSync(COTS_PATH, 'utf8'));
}
function writeCots(data) { writeFileSync(COTS_PATH, JSON.stringify(data, null, 2)); }

let savedCots;
before(() => { savedCots = readCots(); });
after(() => { writeCots(savedCots); });

test('idempotencia: tras crear+setFolioOperam, folioYaExiste lo reconoce en listar()', async () => {
  writeCots([]);
  const store = await import('../lib/cotizaciones-store.js');
  const entrada = construirEntradaCotizacion({
    pedido: PEDIDO, quote: QUOTE, debtor: DEBTOR, etapa: 'saldo_pagado', vendedores: VENDEDORES,
  });
  const id = await store.crear(entrada);
  await store.setFolioOperam(id, entrada.folioOperam);

  const cots = await store.listar();
  // Segunda pasada del backfill ve el folio ya presente -> SKIP (no recrea).
  assert.equal(folioYaExiste(cots, '1141'), true);
  // El folio que aun no existe si pasaria.
  assert.equal(folioYaExiste(cots, '1142'), false);
});

// Aplicacion del PLAN al store, end-to-end (mismo loop que el script con --apply):
// crear -> setFolioOperam -> cambiarEtapa. Re-correr no duplica (idempotencia por
// folioOperam via planearBackfill, que relee el store).
async function aplicarPlan(store, plan) {
  let creadas = 0;
  for (const e of plan.importar) {
    const id = await store.crear(e);
    await store.setFolioOperam(id, e.folioOperam);
    await store.cambiarEtapa(id, e.etapa, { tipo: 'backfill', etapa: e.etapa, fecha: '2026-06-18T00:00:00Z' });
    creadas++;
  }
  return creadas;
}

test('apply end-to-end: crea la cotizacion con folio+etapa y re-correr NO duplica', async () => {
  writeCots([]);
  const store = await import('../lib/cotizaciones-store.js');
  const buildDeps = () => planDeps({
    pedidos: [PEDIDO],
    debtors: { '394': DEBTOR },
    quotes: { '1141': QUOTE },
    etapas: { '7269': 'saldo_pagado' },
  }).deps;
  // Deps reales para idempotencia: listarCotizaciones lee el store real.
  function depsConStore() {
    const d = buildDeps();
    d.listarCotizaciones = () => store.listar();
    return d;
  }

  // Primera corrida: plan importa 1, aplicar crea 1.
  const plan1 = await planearBackfill(depsConStore());
  assert.equal(plan1.importar.length, 1);
  assert.equal(await aplicarPlan(store, plan1), 1);

  const guardadas = await store.listar();
  const c = guardadas.find(x => String(x.folioOperam) === '1141');
  assert.ok(c, 'la cotizacion quedo persistida con su folio');
  assert.equal(c.cliente, 'JUANA HERNANDEZ GARCIA');
  assert.equal(c.etapa, 'saldo_pagado');
  assert.equal(c.data.orderOperam, '7269');
  assert.equal(c.data.backfill, true);

  // Segunda corrida: el folio ya existe -> plan vacio (SKIP duplicado), nada nuevo.
  const plan2 = await planearBackfill(depsConStore());
  assert.equal(plan2.importar.length, 0);
  assert.equal(plan2.skips.duplicado, 1);
  assert.equal(await aplicarPlan(store, plan2), 0);
  assert.equal((await store.listar()).filter(x => String(x.folioOperam) === '1141').length, 1);
});
