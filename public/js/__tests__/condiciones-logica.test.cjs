'use strict';
// #324: condiciones comerciales por omision configurables desde /admin y el
// Tiempo de produccion derivado de las piezas de producto (decisiones de Adrian
// 2026-09-25: se llama "Tiempo de produccion" y la cotizacion con calca usa su
// PROPIA tabla de escalones). Nucleo puro compartido por el servidor (validacion
// del PUT), el navegador (notas por omision) y el panel /admin.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let escalonDePiezas, plazoTexto, notaTiempoProduccion, condicionesComerciales, validarCondiciones;
let notasPorOmision, aplicarNotaTiempoProduccion, notaPreciosEnvio, aplicarNotaEnvio;
before(async () => {
  ({ escalonDePiezas, plazoTexto, notaTiempoProduccion, condicionesComerciales, validarCondiciones,
    notasPorOmision, aplicarNotaTiempoProduccion, notaPreciosEnvio, aplicarNotaEnvio } =
    await import('../condiciones-logica.js'));
});

// La tabla del ejemplo del cuerpo del issue.
const TABLA_ISSUE = [
  { desde: 0, cantidad: 3, unidad: 'semanas' },
  { desde: 100, cantidad: 4, unidad: 'semanas' },
  { desde: 1500, cantidad: 5, unidad: 'semanas' },
  { desde: 3000, cantidad: 6, unidad: 'semanas' },
];

test('escalon: exactamente en el umbral aplica ese escalon', () => {
  assert.equal(escalonDePiezas(TABLA_ISSUE, 100).cantidad, 4);
  assert.equal(escalonDePiezas(TABLA_ISSUE, 1500).cantidad, 5);
  assert.equal(escalonDePiezas(TABLA_ISSUE, 3000).cantidad, 6);
});

test('escalon: uno abajo del umbral se queda en el anterior', () => {
  assert.equal(escalonDePiezas(TABLA_ISSUE, 99).cantidad, 3);
  assert.equal(escalonDePiezas(TABLA_ISSUE, 1499).cantidad, 4);
  assert.equal(escalonDePiezas(TABLA_ISSUE, 2999).cantidad, 5);
});

test('escalon: uno arriba del umbral sigue en ese escalon (el mas alto que no rebasa)', () => {
  assert.equal(escalonDePiezas(TABLA_ISSUE, 101).cantidad, 4);
  assert.equal(escalonDePiezas(TABLA_ISSUE, 3001).cantidad, 6);
  assert.equal(escalonDePiezas(TABLA_ISSUE, 40000).cantidad, 6);
});

test('escalon: por debajo del primer umbral usa el primer escalon (no existe "sin tiempo")', () => {
  const desdeCien = [
    { desde: 100, cantidad: 10, unidad: 'dias' },
    { desde: 500, cantidad: 3, unidad: 'semanas' },
  ];
  assert.deepStrictEqual(escalonDePiezas(desdeCien, 40), { desde: 100, cantidad: 10, unidad: 'dias' });
  assert.deepStrictEqual(escalonDePiezas(desdeCien, 0), { desde: 100, cantidad: 10, unidad: 'dias' });
  assert.equal(escalonDePiezas(TABLA_ISSUE, 0).cantidad, 3);
});

test('plazo: singular y plural correctos en semanas y dias', () => {
  assert.equal(plazoTexto({ cantidad: 1, unidad: 'semanas' }), '1 semana');
  assert.equal(plazoTexto({ cantidad: 3, unidad: 'semanas' }), '3 semanas');
  assert.equal(plazoTexto({ cantidad: 1, unidad: 'dias' }), '1 dia');
  assert.equal(plazoTexto({ cantidad: 5, unidad: 'dias' }), '5 dias');
});

// La tabla de calca del comentario de Adrian: los mismos cortes con +2 semanas.
const TABLA_CALCA_ISSUE = [
  { desde: 0, cantidad: 5, unidad: 'semanas' },
  { desde: 100, cantidad: 6, unidad: 'semanas' },
  { desde: 1500, cantidad: 7, unidad: 'semanas' },
  { desde: 3000, cantidad: 8, unidad: 'semanas' },
];
const CONDICIONES_ISSUE = { tiempoProduccion: TABLA_ISSUE, tiempoProduccionCalca: TABLA_CALCA_ISSUE };

test('linea: "Tiempo de produccion" con el plazo del escalon y el resto de la frase de hoy', () => {
  const items = [{ codigo: 'PV08B1N1', cantidad: 1500 }];
  assert.equal(
    notaTiempoProduccion(CONDICIONES_ISSUE, { items, decorado: false }),
    '- Tiempo de produccion: 5 semanas contadas a partir del pago del anticipo.'
  );
});

test('linea: el participio concuerda con el plazo (1 semana contada, 1 dia contado, 5 dias contados)', () => {
  const items = [{ codigo: 'PV08B1N1', cantidad: 10 }];
  const con = (escalon) => ({ tiempoProduccion: [escalon], tiempoProduccionCalca: [escalon] });
  assert.equal(notaTiempoProduccion(con({ desde: 0, cantidad: 1, unidad: 'semanas' }), { items }),
    '- Tiempo de produccion: 1 semana contada a partir del pago del anticipo.');
  assert.equal(notaTiempoProduccion(con({ desde: 0, cantidad: 1, unidad: 'dias' }), { items }),
    '- Tiempo de produccion: 1 dia contado a partir del pago del anticipo.');
  assert.equal(notaTiempoProduccion(con({ desde: 0, cantidad: 5, unidad: 'dias' }), { items }),
    '- Tiempo de produccion: 5 dias contados a partir del pago del anticipo.');
});

test('las piezas de calca NO mueven el escalon: 99 de producto + 500 de calca es el escalon de 99', () => {
  const items = [
    { codigo: 'PV08B1N1', cantidad: 99 },
    { codigo: 'ENVIO', cantidad: 1 },
  ];
  const conCalca = [...items, { codigo: 'CAL1100', cantidad: 500 }];
  const sinCalca = notaTiempoProduccion(CONDICIONES_ISSUE, { items, decorado: false });
  assert.equal(sinCalca, '- Tiempo de produccion: 3 semanas contadas a partir del pago del anticipo.');
  // Con calca aplica la tabla de calca, en el escalon de las 99 piezas de producto
  // (5 semanas), no en el de 599 (6 semanas).
  assert.equal(notaTiempoProduccion(CONDICIONES_ISSUE, { items: conCalca, decorado: false }),
    '- Tiempo de produccion: 5 semanas contadas a partir del pago del anticipo.');
});

test('la marca manual de decorado (sin calca en el carrito) usa la tabla de calca', () => {
  const items = [{ codigo: 'PV08B1N1', cantidad: 100 }];
  assert.equal(notaTiempoProduccion(CONDICIONES_ISSUE, { items, decorado: true }),
    '- Tiempo de produccion: 6 semanas contadas a partir del pago del anticipo.');
  assert.equal(notaTiempoProduccion(CONDICIONES_ISSUE, { items, decorado: false }),
    '- Tiempo de produccion: 4 semanas contadas a partir del pago del anticipo.');
});

// === Configuracion: la llave ausente es la semilla, y la semilla reproduce las
// notas de hoy (index.html antes de #324): 4 semanas sin calca, 6 con calca o
// con la marca de decorado (#90). ===
const SEMILLA_ESPERADA = {
  precios: 'Precios EXW Ixtapaluca, Estado de Mexico.',
  sinEnvio: 'No incluye envio.',
  flete: 'Envio a costo y riesgo del cliente.',
  anticipo: 'Se requiere 50% de anticipo para comenzar la produccion.',
  saldo: 'Pago del saldo previo a la entrega.',
  tiempoProduccion: [{ desde: 0, cantidad: 4, unidad: 'semanas' }],
  tiempoProduccionCalca: [{ desde: 0, cantidad: 6, unidad: 'semanas' }],
};

test('sin configuracion guardada las condiciones son la semilla (el texto de hoy)', () => {
  assert.deepStrictEqual(condicionesComerciales(null), SEMILLA_ESPERADA);
  assert.deepStrictEqual(condicionesComerciales({ tiposActivos: ['PL'] }), SEMILLA_ESPERADA);
});

test('con la semilla una cotizacion de hoy conserva su plazo: 4 semanas, 6 con calca o decorado', () => {
  const c = condicionesComerciales(null);
  const producto = [{ codigo: 'PV08B1N1', cantidad: 5000 }];
  assert.equal(notaTiempoProduccion(c, { items: producto }),
    '- Tiempo de produccion: 4 semanas contadas a partir del pago del anticipo.');
  assert.equal(notaTiempoProduccion(c, { items: [...producto, { codigo: 'CAL1100', cantidad: 100 }] }),
    '- Tiempo de produccion: 6 semanas contadas a partir del pago del anticipo.');
  assert.equal(notaTiempoProduccion(c, { items: producto, decorado: true }),
    '- Tiempo de produccion: 6 semanas contadas a partir del pago del anticipo.');
});

test('una configuracion guardada manda; el campo que le falte cae a la semilla', () => {
  const guardada = { condicionesComerciales: { ...CONDICIONES_ISSUE, anticipo: 'Anticipo del 30%.' } };
  const c = condicionesComerciales(guardada);
  assert.deepStrictEqual(c.tiempoProduccion, TABLA_ISSUE);
  assert.deepStrictEqual(c.tiempoProduccionCalca, TABLA_CALCA_ISSUE);
  assert.equal(c.anticipo, 'Anticipo del 30%.');
  assert.equal(c.saldo, SEMILLA_ESPERADA.saldo);
});

test('validar: acepta la tabla del issue y normaliza numeros capturados como texto', () => {
  const r = validarCondiciones({
    ...SEMILLA_ESPERADA,
    precios: '  Precios EXW Ixtapaluca.  ',
    tiempoProduccion: [
      { desde: '0', cantidad: '3', unidad: 'semanas' },
      { desde: '100', cantidad: 4, unidad: 'semanas' },
      { desde: 1500, cantidad: '10', unidad: 'dias' },
    ],
  });
  assert.equal(r.error, undefined);
  assert.equal(r.condiciones.precios, 'Precios EXW Ixtapaluca.');
  assert.deepStrictEqual(r.condiciones.tiempoProduccion, [
    { desde: 0, cantidad: 3, unidad: 'semanas' },
    { desde: 100, cantidad: 4, unidad: 'semanas' },
    { desde: 1500, cantidad: 10, unidad: 'dias' },
  ]);
});

test('validar: la unidad es de catalogo cerrado (dias o semanas), nunca texto libre', () => {
  const r = validarCondiciones({ ...SEMILLA_ESPERADA, tiempoProduccion: [{ desde: 0, cantidad: 4, unidad: 'meses' }] });
  assert.match(r.error, /dias o semanas/);
});

test('validar: cada tabla lleva al menos un escalon (no existe "sin tiempo de produccion")', () => {
  assert.match(validarCondiciones({ ...SEMILLA_ESPERADA, tiempoProduccion: [] }).error, /al menos un escalon/);
  assert.match(validarCondiciones({ ...SEMILLA_ESPERADA, tiempoProduccionCalca: [] }).error, /con calca/);
});

test('validar: umbral entero >= 0, cantidad entera >= 1, umbrales de menor a mayor sin repetir', () => {
  const con = (tabla) => validarCondiciones({ ...SEMILLA_ESPERADA, tiempoProduccion: tabla }).error;
  assert.match(con([{ desde: -1, cantidad: 4, unidad: 'semanas' }]), /umbral/);
  assert.match(con([{ desde: 1.5, cantidad: 4, unidad: 'semanas' }]), /umbral/);
  assert.match(con([{ desde: 0, cantidad: 0, unidad: 'semanas' }]), /cantidad/);
  assert.match(con([{ desde: 0, cantidad: '', unidad: 'semanas' }]), /cantidad/);
  assert.match(con([
    { desde: 100, cantidad: 4, unidad: 'semanas' },
    { desde: 0, cantidad: 3, unidad: 'semanas' },
  ]), /menor a mayor/);
  assert.match(con([
    { desde: 100, cantidad: 4, unidad: 'semanas' },
    { desde: 100, cantidad: 5, unidad: 'semanas' },
  ]), /menor a mayor/);
});

test('validar: los textos de las condiciones no pueden quedar vacios', () => {
  assert.match(validarCondiciones({ ...SEMILLA_ESPERADA, saldo: '   ' }).error, /saldo/i);
  assert.match(validarCondiciones(null).error, /Formato invalido/);
});

// === Las notas con las que arranca la cotizacion ===
// El texto que index.html traia clavado antes de #324, con "Tiempo de entrega"
// renombrado a "Tiempo de produccion" (decision de Adrian 2026-09-25).
const NOTAS_DE_HOY = [
  '- Precios EXW Ixtapaluca, Estado de Mexico. No incluye envio.',
  '- Envio a costo y riesgo del cliente.',
  '- Tiempo de produccion: 4 semanas contadas a partir del pago del anticipo.',
  '- Se requiere 50% de anticipo para comenzar la produccion.',
  '- Pago del saldo previo a la entrega.',
].join('\n');

test('notas por omision con la semilla: el texto de hoy, con Tiempo de produccion', () => {
  assert.equal(notasPorOmision(condicionesComerciales(null), { items: [], decorado: false, conEnvio: false }), NOTAS_DE_HOY);
});

test('notas por omision salen de la configuracion guardada, no de un literal', () => {
  const c = condicionesComerciales({ condicionesComerciales: {
    ...CONDICIONES_ISSUE,
    precios: 'Precios LAB fabrica.', sinEnvio: 'Flete no incluido.', flete: 'Flete por cuenta del cliente.',
    anticipo: 'Anticipo del 30%.', saldo: 'Saldo contra aviso de embarque.',
  } });
  const items = [{ codigo: 'PV08B1N1', cantidad: 1500 }];
  assert.equal(notasPorOmision(c, { items, decorado: false, conEnvio: false }), [
    '- Precios LAB fabrica. Flete no incluido.',
    '- Flete por cuenta del cliente.',
    '- Tiempo de produccion: 5 semanas contadas a partir del pago del anticipo.',
    '- Anticipo del 30%.',
    '- Saldo contra aviso de embarque.',
  ].join('\n'));
  // Con envio con costo la linea de precios pierde su "sin envio" (#436).
  assert.ok(notasPorOmision(c, { items, conEnvio: true }).startsWith('- Precios LAB fabrica.\n'));
});

test('#436 con texto configurado: la linea de precios sigue al envio con los textos del panel', () => {
  const c = condicionesComerciales({ condicionesComerciales: { precios: 'Precios LAB fabrica.', sinEnvio: 'Flete no incluido.' } });
  assert.equal(notaPreciosEnvio(false, c), '- Precios LAB fabrica. Flete no incluido.');
  assert.equal(notaPreciosEnvio(true, c), '- Precios LAB fabrica.');
  const notas = notasPorOmision(c, { items: [], conEnvio: false });
  const conEnvio = aplicarNotaEnvio(notas, true, c);
  assert.ok(conEnvio.startsWith('- Precios LAB fabrica.\n'));
  assert.equal(aplicarNotaEnvio(conEnvio, false, c), notas);
});

// === La linea sigue a las piezas mientras sea la derivada; editada, se respeta ===
test('la linea derivada se re-deriva cuando las piezas cruzan un umbral', () => {
  const c = condicionesComerciales({ condicionesComerciales: CONDICIONES_ISSUE });
  const notas = notasPorOmision(c, { items: [{ codigo: 'PV08B1N1', cantidad: 40 }], conEnvio: false });
  assert.ok(notas.includes('- Tiempo de produccion: 3 semanas contadas'));
  const r = aplicarNotaTiempoProduccion(notas, c, { items: [{ codigo: 'PV08B1N1', cantidad: 1500 }] });
  assert.equal(r, notas.replace('3 semanas', '5 semanas'));
  // Y con calca en el carrito pasa a la tabla de calca, con las piezas de producto.
  const conCalca = aplicarNotaTiempoProduccion(r, c, { items: [{ codigo: 'PV08B1N1', cantidad: 1500 }, { codigo: 'CAL1100', cantidad: 5000 }] });
  assert.equal(conCalca, notas.replace('3 semanas', '7 semanas'));
});

test('la linea editada a mano por el vendedor no se pisa al cambiar piezas o calca', () => {
  const c = condicionesComerciales({ condicionesComerciales: CONDICIONES_ISSUE });
  const notas = notasPorOmision(c, { items: [], conEnvio: false })
    .replace('- Tiempo de produccion: 3 semanas contadas a partir del pago del anticipo.', '- Tiempo de produccion: 10 dias habiles, urge.');
  assert.equal(aplicarNotaTiempoProduccion(notas, c, { items: [{ codigo: 'PV08B1N1', cantidad: 3000 }], decorado: true }), notas);
});

test('la linea borrada no se vuelve a agregar', () => {
  const c = condicionesComerciales(null);
  const sinLinea = NOTAS_DE_HOY.split('\n').filter(l => !l.includes('Tiempo de produccion')).join('\n');
  assert.equal(aplicarNotaTiempoProduccion(sinLinea, c, { items: [], decorado: true }), sinLinea);
});

test('una cotizacion cargada con la linea vieja ("Tiempo de entrega") conserva su texto', () => {
  const vieja = NOTAS_DE_HOY.replace('Tiempo de produccion', 'Tiempo de entrega');
  assert.equal(aplicarNotaTiempoProduccion(vieja, condicionesComerciales(null), { items: [], decorado: true }), vieja);
});
