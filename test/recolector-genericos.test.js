import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { leerArchivoSync, escribirArchivoSync, borrarArchivoSync } from '../lib/fs-reintento.js';

// Sin DATABASE_URL el store de la bandeja usa el fallback JSON (data/bandeja.json),
// el mismo modo en que corren dev local y esta suite.
import { listar as listarBandeja, proponer, aceptar, descartar } from '../lib/bandeja-store.js';

import {
  candidatoDesdeQuote, resolverVendedorPropuesto, evaluarQuote, MOTIVOS,
  planearRecoleccion, fechaCorteMeses, MESES_VENTANA, depositarCandidatos,
} from '../lib/recolector-genericos.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BANDEJA_PATH = join(__dirname, '..', 'data', 'bandeja.json');

function escribirBandeja(data) {
  escribirArchivoSync(BANDEJA_PATH, JSON.stringify(data, null, 2));
}

let bandejaGuardada;
let bandejaExistia;
before(() => {
  bandejaExistia = existsSync(BANDEJA_PATH);
  bandejaGuardada = bandejaExistia ? leerArchivoSync(BANDEJA_PATH) : null;
});
after(() => {
  if (bandejaExistia) escribirArchivoSync(BANDEJA_PATH, bandejaGuardada);
  else if (existsSync(BANDEJA_PATH)) borrarArchivoSync(BANDEJA_PATH);
});
beforeEach(() => {
  escribirBandeja([]);
});

// Nucleo PURO del recolector de quotes de los debtors genericos (#124). Los datos
// crudos salen de la medicion del 2026-08-01 (medicion-118-genericos.csv), que es
// la fuente independiente: los valores esperados son los que Adrian vio en el
// reporte, no un recalculo de lo que hace el codigo.

const VENDEDORES = [
  { id: 1, name: 'Adrián Chávez', operam_id: 1 },
  { id: 2, name: 'Alejandro Chávez', operam_id: 2 },
  { id: 3, name: 'Oswaldo Chávez', operam_id: 8 },
  { id: 4, name: 'Alejandro Castañón', operam_id: 9 },
  { id: 5, name: 'Jaime Abaroa', operam_id: null },
];

const LRE = '‪';

// Quote 1089 de la medicion (debtor 184 GENERICO TIENDAS DIGITALES). El telefono
// llega con la marca invisible que WhatsApp/iOS pegan al numero.
const QUOTE_1089 = {
  ord_date: '2026-04-06',
  debtor_no: '184',
  total: '9492.50',
  deliver_to: 'Juan Manuel Lemus',
  contact_phone: LRE + '+52 55 5416 3178',
  contact_email: 'jmlemus@lemusarquitectos.com',
  cust_ref: '9021OINK',
  delivery_address: 'Gobernador Luis G. Vieyra 76, San Miguel Chapultepec I Secc, Miguel Hidalgo, CDMX CP: 11850',
  salesman: '7',
  user: { real_name: 'Alejandro Chavez' },
};

test('candidatoDesdeQuote arma el candidato de la bandeja con los campos del quote', () => {
  const candidato = candidatoDesdeQuote({
    folio: 1089,
    quote: QUOTE_1089,
    vendedores: VENDEDORES,
    debtorNombre: 'GENERICO TIENDAS DIGITALES',
  });

  assert.equal(candidato.folio, '1089');
  assert.equal(candidato.tipo, 'prospecto');
  assert.equal(candidato.fecha, '2026-04-06');
  assert.equal(candidato.contacto, 'Juan Manuel Lemus');
  // El celular se guarda LIMPIO (#123): la marca invisible no viaja al store.
  assert.equal(candidato.celular, '+52 55 5416 3178');
  assert.equal(candidato.email, 'jmlemus@lemusarquitectos.com');
  assert.equal(candidato.proyecto, '9021OINK');
  assert.equal(candidato.domicilio, QUOTE_1089.delivery_address);
  assert.equal(candidato.monto, 9492.5);
  assert.equal(candidato.debtorId, 184);
  assert.equal(candidato.debtorNombre, 'GENERICO TIENDAS DIGITALES');
  assert.deepEqual(candidato.marcas, { comproOtraCosa: false, posibleDuplicado: false });
});

// --- vendedor propuesto: el CREADOR del quote manda (#124) ---
// En los debtors genericos el `salesman` es un atributo del cliente-cajon
// compartido (casi siempre 7 = Mostrador, que NO esta en el catalogo), asi que
// atribuirle todos los quotes seria falso. Quien cotizo es el usuario creador.

test('resolverVendedorPropuesto usa al creador del quote aunque el salesman no mapee', () => {
  // Medicion: los 27 quotes de la ventana de 6 meses los crearon Alejandro (24) y
  // Oswaldo (3); el real_name de Operam viene SIN acentos.
  assert.equal(resolverVendedorPropuesto(QUOTE_1089, VENDEDORES), 'Alejandro Chávez');
});

test('resolverVendedorPropuesto cae al salesman cuando el creador no es vendedor', () => {
  const quote = { salesman: '8', user: { real_name: 'Mostrador' } };
  assert.equal(resolverVendedorPropuesto(quote, VENDEDORES), 'Oswaldo Chávez');
});

test('resolverVendedorPropuesto devuelve null cuando no mapea ninguno (Mostrador queda fuera del catalogo)', () => {
  assert.equal(resolverVendedorPropuesto({ salesman: '7', user: { real_name: 'Mostrador' } }, VENDEDORES), null);
  assert.equal(resolverVendedorPropuesto({}, VENDEDORES), null);
});

test('candidatoDesdeQuote propone el vendedor resuelto', () => {
  const candidato = candidatoDesdeQuote({ folio: 1089, quote: QUOTE_1089, vendedores: VENDEDORES });
  assert.equal(candidato.vendedor, 'Alejandro Chávez');
});

// --- evaluarQuote: los filtros que la medicion justifica (#118 -> #124) ---

// Catalogo minimo: los debtors genericos tambien son clientes de Operam (de ahi
// sale el nombre del cajon que se muestra en la bandeja).
const GENERICO_184 = { customer_id: 184, CustName: 'GENERICO TIENDAS DIGITALES', contacts: [], branches: [] };

function evaluar(extra = {}) {
  return evaluarQuote({
    folio: 1089,
    quote: QUOTE_1089,
    clientes: [GENERICO_184],
    pedidos: [],
    prospectos: [],
    vendedores: VENDEDORES,
    cancelados: [],
    bandejaFolios: [],
    ...extra,
  });
}

test('evaluarQuote: un quote de debtor NO generico no es de este lote', () => {
  const r = evaluar({ quote: { ...QUOTE_1089, debtor_no: '394' } });
  assert.equal(r.motivo, MOTIVOS.NO_GENERICO);
  assert.equal(r.candidato, null);
});

test('evaluarQuote: los 5 debtors genericos entran (143, 183, 184, 256, 449)', () => {
  for (const debtor of ['143', '183', '184', '256', '449']) {
    const r = evaluar({ quote: { ...QUOTE_1089, debtor_no: debtor }, clientes: [] });
    assert.equal(r.motivo, null, `debtor ${debtor} deberia entrar`);
  }
});

test('evaluarQuote: un quote ANULADO en Operam se excluye (data/cancelados.json)', () => {
  const r = evaluar({ cancelados: ['1089'] });
  assert.equal(r.motivo, MOTIVOS.CANCELADO);
});

test('evaluarQuote: un folio que ya esta en la bandeja no se re-propone', () => {
  // Idempotencia visible en el dry-run: el store la garantiza al depositar, pero
  // el plan tiene que decir por que ese folio no aparece como candidato.
  const r = evaluar({ bandejaFolios: ['1089'] });
  assert.equal(r.motivo, MOTIVOS.YA_EN_BANDEJA);
});

test('evaluarQuote: un quote de $0 se excluye', () => {
  const r = evaluar({ quote: { ...QUOTE_1089, total: '0.00' } });
  assert.equal(r.motivo, MOTIVOS.TOTAL_CERO);
});

// Caso real de la medicion (folio 757): el contacto Jean Corriveau / proyecto
// "Obasan" contra el cliente OBASAN LIMITED, con un pedido del MISMO monto
// ($952.08) tres dias despues -> esta cotizacion ya cerro.
const QUOTE_757 = {
  ord_date: '2025-01-02', debtor_no: '143', total: '952.08',
  deliver_to: 'Jean Corriveau', contact_phone: '+1 613-656-1374',
  contact_email: 'jean@obasan.com', cust_ref: 'Obasan',
  delivery_address: '155 Colonnade Road S, Unit 1 Ottawa, ON K2E 7K1',
  user: { real_name: 'Alejandro Chavez' },
};
const CLIENTE_OBASAN = { customer_id: 500, CustName: 'OBASAN LIMITED', contacts: [], branches: [] };
const PEDIDO_OBASAN = { order_no: 5236, debtor_no: 500, ord_date: '2025-01-05', total: '952.08' };

test('evaluarQuote: el que ya cerro (identidad + monto en banda) se excluye con su evidencia', () => {
  const r = evaluar({
    folio: 757, quote: QUOTE_757,
    clientes: [GENERICO_184, CLIENTE_OBASAN], pedidos: [PEDIDO_OBASAN],
  });
  assert.equal(r.motivo, MOTIVOS.CERRO);
  assert.equal(r.candidato, null);
  assert.equal(r.cruce.cliente.cust_name, 'OBASAN LIMITED');
  assert.equal(r.cruce.pedido.order_no, 5236);
  assert.equal(r.cruce.difMontoPct, 0);
});

// Caso real de la medicion (folio 1070): Helena Pontevedra ya es cliente (PANZA
// DINING & BAR) pero su pedido de $421 no cierra una cotizacion de $32,732 ->
// puede seguir viva, y es justo la que el humano debe juzgar.
const QUOTE_1070 = {
  ord_date: '2026-02-23', debtor_no: '184', total: '32732.80',
  deliver_to: 'Helena Pontevedra Soto', contact_phone: '+52 984 241 7544',
  contact_email: 'helena@afloratulum.com', cust_ref: 'Aflora Tulum',
  delivery_address: 'CP 77760', user: { real_name: 'Alejandro Chavez' },
};
const CLIENTE_PANZA = {
  customer_id: 600, CustName: 'PANZA DINING & BAR',
  contacts: [{ name: 'Helena', phone: '9842417544' }], branches: [],
};
const PEDIDO_PANZA = { order_no: 7079, debtor_no: 600, ord_date: '2026-03-10', total: '421.00' };

test('evaluarQuote: "compro otra cosa" SI entra, marcado para el humano', () => {
  const r = evaluar({
    folio: 1070, quote: QUOTE_1070,
    clientes: [GENERICO_184, CLIENTE_PANZA], pedidos: [PEDIDO_PANZA],
  });
  assert.equal(r.motivo, null);
  assert.equal(r.candidato.marcas.comproOtraCosa, true);
  assert.equal(r.candidato.marcas.posibleDuplicado, false);
  assert.equal(r.candidato.contacto, 'Helena Pontevedra Soto');
});

test('evaluarQuote: el celular que ya es prospecto entra marcado como posible duplicado', () => {
  const r = evaluar({ prospectos: [{ id: 7, nombre: 'Juan Manuel Lemus', celular: '5554163178' }] });
  assert.equal(r.motivo, null);
  assert.equal(r.candidato.marcas.posibleDuplicado, true);
  assert.equal(r.cruce.duplicadoProspecto.id, 7);
});

test('evaluarQuote: un quote SIN celular entra como candidato normal', () => {
  const r = evaluar({ quote: { ...QUOTE_1089, contact_phone: '' } });
  assert.equal(r.motivo, null);
  assert.equal(r.candidato.celular, '');
  assert.deepEqual(r.candidato.marcas, { comproOtraCosa: false, posibleDuplicado: false });
});

test('evaluarQuote: el nombre del cajon generico viaja en el candidato', () => {
  const r = evaluar();
  assert.equal(r.candidato.debtorNombre, 'GENERICO TIENDAS DIGITALES');
});

// --- ventana de 6 meses (decision 2026-08-03, configurable) ---

test('fechaCorteMeses: la ventana default son 6 meses hacia atras', () => {
  assert.equal(MESES_VENTANA, 6);
  assert.equal(fechaCorteMeses(MESES_VENTANA, '2026-08-03'), '2026-02-03');
  assert.equal(fechaCorteMeses(18, '2026-08-03'), '2025-02-03');
});

// --- planearRecoleccion: el id-walk (los quotes tipo 32 NO son enumerables) ---

function quoteGenerico(campos) {
  return { ...QUOTE_1089, ...campos };
}

// Lector inyectado: cero red en test. Un folio ausente responde null (404 de la API).
function lectorDeQuotes(porFolio) {
  const leidos = [];
  const leer = async (folio) => {
    leidos.push(Number(folio));
    return porFolio[String(folio)] || null;
  };
  return { leer, leidos };
}

function planear(porFolio, extra = {}) {
  const { leer, leidos } = lectorDeQuotes(porFolio);
  return planearRecoleccion({
    obtenerQuote: leer,
    folioMax: 1005,
    fechaCorte: '2026-02-01',
    clientes: [GENERICO_184],
    pedidos: [],
    prospectos: [],
    vendedores: VENDEDORES,
    ...extra,
  }).then(plan => ({ plan, leidos }));
}

test('planearRecoleccion: camina folios hacia abajo y se detiene al salir de la ventana', async () => {
  const { plan, leidos } = await planear({
    1005: quoteGenerico({ ord_date: '2026-05-10', total: '1000' }),
    1004: quoteGenerico({ ord_date: '2026-03-01', total: '2000' }),
    // Fuera de la ventana: corta el walk (los folios son crecientes en el tiempo).
    1003: quoteGenerico({ ord_date: '2026-01-15', total: '3000' }),
    1002: quoteGenerico({ ord_date: '2026-01-02', total: '4000' }),
  });
  assert.deepEqual(plan.candidatos.map(c => c.candidato.folio), ['1005', '1004']);
  // El folio 1002 NUNCA se leyo: el walk se detuvo en el 1003.
  assert.deepEqual(leidos, [1005, 1004, 1003]);
});

test('planearRecoleccion: un quote SIN fecha no corta el walk (no es "anterior a la ventana")', async () => {
  const { plan } = await planear({
    1005: quoteGenerico({ ord_date: '', total: '1000' }),
    1004: quoteGenerico({ ord_date: '2026-05-09', total: '2000' }),
  });
  assert.deepEqual(plan.candidatos.map(c => c.candidato.folio), ['1005', '1004']);
});

test('planearRecoleccion: un folio inexistente (404) se salta y la racha vacia corta el walk', async () => {
  const { plan, leidos } = await planear({
    1005: quoteGenerico({ ord_date: '2026-05-10', total: '1000' }),
    1002: quoteGenerico({ ord_date: '2026-05-01', total: '2000' }),
  }, { maxRachaVacia: 2 });
  assert.deepEqual(plan.candidatos.map(c => c.candidato.folio), ['1005']);
  // 1004 y 1003 son huecos: dos 404 seguidos cortan antes de leer el 1002.
  assert.deepEqual(leidos, [1005, 1004, 1003]);
});

test('planearRecoleccion: los quotes de clientes nombrados no son de este lote (solo se cuentan)', async () => {
  const { plan } = await planear({
    1005: quoteGenerico({ ord_date: '2026-05-10', debtor_no: '394' }),
    1004: quoteGenerico({ ord_date: '2026-05-09', total: '1500' }),
  });
  assert.equal(plan.skips.noGenerico, 1);
  assert.equal(plan.candidatos.length, 1);
  assert.equal(plan.excluidos.length, 0, 'un quote ajeno al lote no se lista como exclusion');
});

test('planearRecoleccion: cada exclusion del lote queda listada con su motivo', async () => {
  const { plan } = await planear({
    1005: quoteGenerico({ ord_date: '2026-05-10', total: '0' }),
    1004: quoteGenerico({ ord_date: '2026-05-09', total: '2500' }),
    1003: quoteGenerico({ ord_date: '2026-05-08', total: '3500' }),
  }, { cancelados: ['1003'] });
  assert.equal(plan.candidatos.length, 1);
  assert.deepEqual(
    plan.excluidos.map(e => [e.folio, e.motivo]),
    [['1005', MOTIVOS.TOTAL_CERO], ['1003', MOTIVOS.CANCELADO]]
  );
  assert.equal(plan.skips.totalCero, 1);
  assert.equal(plan.skips.cancelado, 1);
});

test('planearRecoleccion: sin folioMax no camina nada (el techo lo fija el orquestador)', async () => {
  const { plan, leidos } = await planear({ 1005: quoteGenerico({}) }, { folioMax: null });
  assert.deepEqual(plan.candidatos, []);
  assert.deepEqual(leidos, []);
});

// --- deposito en la bandeja: la idempotencia del --apply (#124) ---
// Contra el store REAL en fallback de disco (sin DATABASE_URL), que es donde vive
// la garantia: el folio es la clave natural y proponer() nunca pisa lo ya resuelto.

async function planDeDosCandidatos() {
  const { plan } = await planear({
    1005: quoteGenerico({ ord_date: '2026-05-10', total: '1000' }),
    1004: quoteGenerico({ ord_date: '2026-05-09', total: '2000' }),
  });
  return plan;
}

test('depositarCandidatos: re-correr el lote no duplica candidatos', async () => {
  const plan = await planDeDosCandidatos();

  const primera = await depositarCandidatos(plan, proponer);
  assert.deepEqual(primera, { agregados: 2, yaEstaban: 0 });

  const segunda = await depositarCandidatos(plan, proponer);
  assert.deepEqual(segunda, { agregados: 0, yaEstaban: 2 });

  const bandeja = await listarBandeja();
  assert.equal(bandeja.length, 2);
  assert.deepEqual(bandeja.map(b => b.folio).sort(), ['1004', '1005']);
});

test('depositarCandidatos: un candidato aceptado o descartado JAMAS se re-propone', async () => {
  const plan = await planDeDosCandidatos();
  await depositarCandidatos(plan, proponer);
  assert.equal(await aceptar('1005', { vendedor: 'Oswaldo Chávez', prospectoId: 42 }), true);
  assert.equal(await descartar('1004'), true);

  const segunda = await depositarCandidatos(plan, proponer);
  assert.deepEqual(segunda, { agregados: 0, yaEstaban: 2 });

  const bandeja = await listarBandeja();
  const porFolio = Object.fromEntries(bandeja.map(b => [b.folio, b]));
  assert.equal(porFolio['1005'].estado, 'aceptado');
  assert.equal(porFolio['1005'].prospectoId, 42);
  assert.equal(porFolio['1004'].estado, 'descartado');
});

// --- limites duros del script (AC de #124) ---
// El script no se puede correr en la suite (necesita Operam), pero sus dos limites
// de seguridad SI se pueden sostener: que contra Operam solo haga lecturas y que su
// unica escritura sea proponer a la bandeja. Un import o una llamada de escritura
// que se cuele revienta aqui, no en produccion.

const FUENTE_SCRIPT = leerArchivoSync(join(__dirname, '..', 'scripts', 'rescatar-genericos.mjs'));

test('el script solo toma lecturas de operam-client (read-only contra Operam)', () => {
  const LECTURAS_PERMITIDAS = new Set(['listarTodosClientes', 'listarPedidos', 'obtenerQuote', '_setMinInterval']);
  const m = FUENTE_SCRIPT.match(/const\s*\{([^}]*)\}\s*=\s*await import\('\.\.\/lib\/operam-client\.js'\)/);
  assert.ok(m, 'el script importa lib/operam-client.js con destructuring explicito');
  for (const nombre of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
    assert.ok(LECTURAS_PERMITIDAS.has(nombre), `import que NO es lectura de Operam: ${nombre}`);
  }
});

test('el script no escribe en el tablero ni en prospectos: su unica escritura es proponer', () => {
  for (const escritura of [
    'cotStore.crear', 'cotStore.setFolioOperam', 'cotStore.cambiarEtapa',
    'prospectosStore.crear', 'prospectosStore.actualizarDatos',
    'bandejaStore.aceptar', 'bandejaStore.descartar',
  ]) {
    assert.ok(!FUENTE_SCRIPT.includes(escritura), `el script no debe llamar ${escritura}`);
  }
  assert.ok(FUENTE_SCRIPT.includes('bandejaStore.proponer'), 'el deposito va por bandejaStore.proponer');
});

test('depositarCandidatos: el candidato depositado conserva los datos del quote', async () => {
  const plan = await planDeDosCandidatos();
  await depositarCandidatos(plan, proponer);
  const entrada = (await listarBandeja()).find(b => b.folio === '1005');
  assert.equal(entrada.tipo, 'prospecto');
  assert.equal(entrada.estado, 'pendiente');
  assert.equal(entrada.contacto, 'Juan Manuel Lemus');
  assert.equal(entrada.celular, '+52 55 5416 3178');
  assert.equal(entrada.proyecto, '9021OINK');
  assert.equal(entrada.monto, 1000);
  assert.equal(entrada.debtorId, 184);
  assert.equal(entrada.vendedor, 'Alejandro Chávez');
});
