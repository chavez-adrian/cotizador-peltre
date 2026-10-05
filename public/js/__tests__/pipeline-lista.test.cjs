// #518: la vista Lista del Pipeline trae la misma informacion y las mismas
// acciones que la tarjeta del tablero, en un acordeon por etapa con la fila
// que se expande, y el color de cada etapa se declara UNA vez en style.css.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let L;
before(async () => {
  L = await import('../pipeline-logica.js');
});

const VENDEDORES = [{ name: 'Jaime' }, { name: 'Pilar' }];
const AHORA = new Date(2026, 9, 3, 12, 0, 0);

function prospecto(extra) {
  return {
    tipo: 'prospecto', id: 'p7', refId: 7, nombre: 'Laura', vendedor: 'Memo', celular: '+52 5512345678',
    ciudad: 'Puebla', canal: 'WhatsApp', etapa: 'por_cotizar', total: 0, fecha: '2026-10-02T15:00:00Z', ...extra,
  };
}
function cotizacion(extra) {
  return {
    tipo: 'cotizacion', id: 'c41', refId: 41, hasData: true, nombre: 'Hotel Azul', vendedor: 'Memo', ciudad: 'Puebla',
    total: 5000, etapa: 'seguimiento', folioOperam: '1300', contactoCelular: '+52 5598765432',
    fecha: '2026-09-20T15:00:00Z', ...extra,
  };
}

// Los seis casos del AC de paridad de acciones.
const CASOS = {
  'prospecto No Asignado': prospecto({ etapa: 'no_asignado', vendedor: '' }),
  'prospecto Por Cotizar': prospecto(),
  'cotizacion en Seguimiento sin Contacto': cotizacion({ contactoCelular: null }),
  'cotizacion decorada en Anticipo pagado': cotizacion({
    etapa: 'anticipo_pagado', decorado: true,
    calcaChecklist: [{ clave: 'cotizacion_proveedor', completo: true }],
  }),
  'cotizacion con pedido en Pedido liberado con anticipo': cotizacion({
    etapa: 'pedido_liberado', orderOperam: '7301', huboAnticipo: true,
    comprobantesPago: { primer: { fecha: '2026-09-25T12:00:00Z', archivos: [{ nombre: 'transferencia.pdf' }] } },
    espejoOperam: { cotizacion: '1300', pedido: '7301', pago: 'anticipo' },
  }),
  'cotizacion en Producto entregado con pago sin registrar': cotizacion({
    etapa: 'producto_entregado', orderOperam: '7250', pagoSinRegistrar: true,
    espejoOperam: { cotizacion: '1300', pedido: '7250', remisiones: [{}] },
  }),
};

function onclicks(html) {
  return [...html.matchAll(/on(?:click|change)="([^"]*)"/g)].map(m => m[1]).sort();
}

function ctx(extra) {
  return { vendedores: VENDEDORES, puedeAsignar: true, esAdmin: false, ahora: AHORA, ...extra };
}

function filaAbierta(o, extra) {
  return L.buildFilaListaPipelineHtml(o, ctx({ abierta: true, ...extra }));
}

function filaCerrada(o, extra) {
  return L.buildFilaListaPipelineHtml(o, ctx(extra));
}

test('#518 paridad de acciones: la fila abierta dispara los mismos onclick que la tarjeta del tablero', () => {
  for (const esAdmin of [false, true]) {
    for (const [caso, o] of Object.entries(CASOS)) {
      const tarjeta = L.buildTableroPipelineHtml([o], { vendedores: VENDEDORES, puedeAsignar: true, esAdmin });
      const fila = filaAbierta(o, { esAdmin });
      const esperados = onclicks(tarjeta);
      assert.ok(esperados.length > 0, `${caso}: la tarjeta trae acciones`);
      assert.deepEqual(onclicks(fila), esperados, `${caso} esAdmin=${esAdmin}`);
    }
  }
});

test('#518 paridad de acciones: Cancelada solo con esAdmin, igual que la tarjeta', () => {
  const o = CASOS['cotizacion con pedido en Pedido liberado con anticipo'];
  assert.ok(filaAbierta(o, { esAdmin: true }).includes('cerrarCanceladaTablero(41)'));
  assert.equal(filaAbierta(o, { esAdmin: false }).includes('cerrarCanceladaTablero('), false);
});

test('#518 el selector de Asignar de la lista lleva su propia superficie', () => {
  const o = CASOS['prospecto No Asignado'];
  const fila = filaAbierta(o);
  assert.ok(fila.includes('id="asignar-vendedor-lista-7"'));
  assert.equal(fila.includes('asignar-vendedor-tablero-7'), false);
  assert.ok(L.buildTableroPipelineHtml([o], { vendedores: VENDEDORES, puedeAsignar: true }).includes('id="asignar-vendedor-tablero-7"'));
});

test('#518 la fila cerrada no trae acciones ni detalle', () => {
  for (const [caso, o] of Object.entries(CASOS)) {
    assert.deepEqual(onclicks(filaCerrada(o, { esAdmin: true })), [], caso);
  }
});

test('#518 paridad de informacion: nombre con respaldo, folio, avisos y total en la fila cerrada', () => {
  const sinNombre = cotizacion({ nombre: '', cliente: 'Fonda <Los Arcos>' });
  const cerrada = filaCerrada(sinNombre);
  assert.ok(cerrada.includes('Fonda &lt;Los Arcos&gt;'));
  assert.equal(cerrada.includes('Sin nombre'), false);
  assert.ok(cerrada.includes('Cotizaci\u00f3n 1300'));
  assert.ok(cerrada.includes('$5,000.00'));
  assert.ok(filaCerrada(prospecto({ nombre: '' })).includes('Sin nombre'));

  const pre = filaCerrada(cotizacion({ folioOperam: null }));
  assert.ok(pre.includes('badge-pre'));

  const impago = filaCerrada(CASOS['cotizacion en Producto entregado con pago sin registrar']);
  assert.ok(impago.includes('Pago sin registrar'));
  assert.ok(impago.includes('Falta comprobante'));

  const saldo = filaCerrada(cotizacion({
    etapa: 'saldo_pagado', orderOperam: '7288', huboAnticipo: true,
    comprobantesPago: { primer: { fecha: '2026-09-25T12:00:00Z', archivos: [{ nombre: 'a.pdf' }] } },
  }));
  assert.ok(saldo.includes('Falta comprobante del saldo'));

  const sinContacto = filaCerrada(CASOS['cotizacion en Seguimiento sin Contacto']);
  assert.ok(sinContacto.includes('Sin Contacto'));

  const sinTotal = filaCerrada(prospecto());
  assert.ok(sinTotal.includes('Sin cotizar'));
});

test('#518 la fila cerrada lleva vendedor, ciudad y antiguedad; sin la etapa', () => {
  const html = filaCerrada(cotizacion({ fecha: '2026-09-28T15:00:00Z' }));
  assert.ok(html.includes('Memo \u00b7 Puebla \u00b7 hace 5 d'));
  assert.equal(html.includes('Seguimiento'), false);
});

test('#518 las etiquetas del Cliente Operam, el Origen y la cadena van solo en la fila abierta', () => {
  const o = cotizacion({
    canal: 'WhatsApp',
    clienteOperam: { fiscal: 'con_datos_fiscales', comercial: 'con_pedido' },
    espejoOperam: { cotizacion: '1300', factura: { ref: 'A1950' } },
  });
  const cerrada = filaCerrada(o);
  assert.equal(cerrada.includes('badge-fiscal-'), false);
  assert.equal(cerrada.includes('badge-con-pedido'), false);
  assert.equal(cerrada.includes('origen-badge'), false);
  assert.equal(cerrada.includes('cot-cadena-operam'), false);
  const abierta = filaAbierta(o);
  assert.ok(abierta.includes('badge-fiscal-listo'));
  assert.ok(abierta.includes('badge-con-pedido'));
  assert.ok(abierta.includes('Origen: WhatsApp'));
  assert.ok(abierta.includes('Cot #1300 - Factura A1950'));
});

test('#518 antiguedad: hoy, ayer y hace N d por dia calendario local', () => {
  assert.equal(L.antiguedadOportunidad(new Date(2026, 9, 3, 0, 5).toISOString(), AHORA), 'hoy');
  assert.equal(L.antiguedadOportunidad(new Date(2026, 9, 2, 23, 55).toISOString(), AHORA), 'ayer');
  assert.equal(L.antiguedadOportunidad(new Date(2026, 8, 26, 10, 0).toISOString(), AHORA), 'hace 7 d');
  // Un dia de Operam sin hora (#428) es ese dia, no el anterior.
  assert.equal(L.antiguedadOportunidad('2026-10-02T00:00:00.000Z', AHORA), 'ayer');
  assert.equal(L.antiguedadOportunidad(null, AHORA), '');
});

function secciones(html) {
  return [...html.matchAll(/<section class="pl-sec[^"]*" data-etapa="([^"]+)"/g)].map(m => m[1]);
}

const MEZCLA = [
  prospecto({ id: 'p1', refId: 1, etapa: 'no_asignado', fecha: '2026-09-01T12:00:00Z' }),
  prospecto({ id: 'p2', refId: 2, nombre: 'Reciente', etapa: 'por_cotizar', fecha: '2026-10-02T12:00:00Z' }),
  prospecto({ id: 'p3', refId: 3, nombre: 'Viejo', etapa: 'por_cotizar', fecha: '2026-08-02T12:00:00Z' }),
  cotizacion({ id: 'c4', refId: 4, etapa: 'seguimiento', total: 1234.5 }),
  cotizacion({ id: 'c5', refId: 5, etapa: 'seguimiento', total: 1000 }),
  cotizacion({ id: 'c6', refId: 6, etapa: 'producto_entregado', total: 98500, orderOperam: '1' }),
  cotizacion({ id: 'c7', refId: 7, nombre: 'Perdida', etapa: 'perdida', total: 777 }),
  prospecto({ id: 'p8', refId: 8, nombre: 'Descartado', etapa: 'no_util' }),
];

test('#518 agrupacion: una seccion por etapa en el orden del tablero, sin las salidas', () => {
  const html = L.buildListaPipelineHtml(MEZCLA, ctx({ etapasAbiertas: new Set(L.COLUMNAS_PIPELINE) }));
  assert.deepEqual(secciones(html), L.COLUMNAS_PIPELINE);
  assert.equal(html.includes('Perdida'), false);
  assert.equal(html.includes('Descartado'), false);
});

test('#518 agrupacion: conteo y suma por etapa iguales a los de la columna del tablero', () => {
  const html = L.buildListaPipelineHtml(MEZCLA, ctx({ etapasAbiertas: new Set() }));
  const tablero = L.buildTableroPipelineHtml(MEZCLA);
  for (const etapa of L.COLUMNAS_PIPELINE) {
    const col = tablero.match(new RegExp(`data-etapa="${etapa}"[\\s\\S]*?tablero-col-count">(\\d+)<[\\s\\S]*?tablero-col-suma">([^<]+)<`));
    const sec = html.match(new RegExp(`data-etapa="${etapa}"[\\s\\S]*?pl-sec-n">(\\d+)<[\\s\\S]*?pl-sec-suma">([^<]+)<`));
    assert.ok(col && sec, etapa);
    assert.equal(sec[1], col[1], `conteo ${etapa}`);
    assert.equal(sec[2], col[2], `suma ${etapa}`);
  }
  assert.ok(html.includes('$2,234.50'));
});

test('#518 agrupacion: dentro de la etapa la mas reciente primero', () => {
  const html = L.buildListaPipelineHtml(MEZCLA, ctx({ etapasAbiertas: new Set(['por_cotizar']) }));
  assert.ok(html.indexOf('Reciente') < html.indexOf('Viejo'));
});

test('#518 pliegue: al entrar quedan abiertas No Asignado, Por Cotizar y Seguimiento', () => {
  assert.deepEqual([...L.ETAPAS_ABIERTAS_AL_ENTRAR], ['no_asignado', 'por_cotizar', 'seguimiento']);
  const html = L.buildListaPipelineHtml(MEZCLA, ctx({ etapasAbiertas: new Set(L.ETAPAS_ABIERTAS_AL_ENTRAR) }));
  for (const id of ['p1', 'p2', 'p3', 'c4', 'c5']) assert.ok(html.includes(`data-lista-fila="${id}"`), id);
  assert.equal(html.includes('data-lista-fila="c6"'), false, 'Producto entregado plegada');
  assert.ok(/data-etapa="producto_entregado"[^>]*>\s*<button[^>]*aria-expanded="false"/.test(html));
});

test('#518 pliegue: la etapa vacia se pinta inerte', () => {
  const html = L.buildListaPipelineHtml(MEZCLA, ctx({ etapasAbiertas: new Set(L.COLUMNAS_PIPELINE) }));
  const vacia = html.match(/<section class="pl-sec[^"]*" data-etapa="anticipo_pagado">\s*<button[^>]*>/)[0];
  assert.ok(vacia.includes('disabled'));
  assert.ok(vacia.includes('pl-sec-vacia'));
  const llena = html.match(/<section class="pl-sec[^"]*" data-etapa="seguimiento">\s*<button[^>]*>/)[0];
  assert.equal(llena.includes('disabled'), false);
});

test('#518 pliegue: solo la fila abierta pinta su detalle', () => {
  const html = L.buildListaPipelineHtml(MEZCLA, ctx({ etapasAbiertas: new Set(L.COLUMNAS_PIPELINE), filaAbierta: 'c4' }));
  assert.equal((html.match(/class="pl-detalle/g) || []).length, 1);
  assert.ok(/data-lista-fila="c4"[^>]*aria-expanded="true"/.test(html));
  assert.ok(/data-lista-fila="c5"[^>]*aria-expanded="false"/.test(html));
});

test('#518 Plegar todo / Abrir todo segun haya etapas abiertas', () => {
  const abiertas = L.buildListaPipelineHtml(MEZCLA, ctx({ etapasAbiertas: new Set(['seguimiento']) }));
  assert.ok(/data-lista-accion="todas"[^>]*>Plegar todo</.test(abiertas));
  const plegadas = L.buildListaPipelineHtml(MEZCLA, ctx({ etapasAbiertas: new Set() }));
  assert.ok(/data-lista-accion="todas"[^>]*>Abrir todo</.test(plegadas));
});

function plegable(html, clase) {
  const m = html.match(new RegExp(`<details class="pl-pleg ${clase}"[^>]*?( open)?>[\\s\\S]*?</summary>`));
  return m && { abierto: !!m[1], resumen: m[0] };
}

test('#518 plegables: la decorada muestra la Calca con N de M', () => {
  const html = filaAbierta(CASOS['cotizacion decorada en Anticipo pagado']);
  const calca = plegable(html, 'pl-calca');
  assert.ok(calca);
  assert.ok(calca.resumen.includes('1 de 6'));
  assert.equal(calca.abierto, false);
});

test('#518 plegables: la no decorada ofrece Marcar decorada entre las acciones, sin bloque Calca', () => {
  const html = filaAbierta(cotizacion());
  assert.equal(plegable(html, 'pl-calca'), null);
  assert.ok(html.includes('marcarDecorada(41, true)'));
});

test('#518 plegables: falta el comprobante = abierto con Falta; subido = cerrado con Subido', () => {
  const falta = plegable(filaAbierta(CASOS['cotizacion en Producto entregado con pago sin registrar']), 'pl-comprobante');
  assert.ok(falta.abierto);
  assert.ok(falta.resumen.includes('Falta'));
  const subido = plegable(filaAbierta(CASOS['cotizacion con pedido en Pedido liberado con anticipo']), 'pl-comprobante');
  assert.equal(subido.abierto, false);
  assert.ok(subido.resumen.includes('Subido'));
  const opcional = plegable(filaAbierta(cotizacion()), 'pl-comprobante');
  assert.equal(opcional.abierto, false);
  assert.ok(opcional.resumen.includes('Opcional'));
});

// Marcar un paso de la calca o subir un comprobante repinta la lista: lo que
// el vendedor abrio o cerro a mano se conserva en vez de volver al inicial.
test('#518 plegables: lo que el vendedor abrio o cerro gana al estado inicial', () => {
  const decorada = CASOS['cotizacion decorada en Anticipo pagado'];
  assert.ok(plegable(filaAbierta(decorada, { plegables: { 'c41:calca': true } }), 'pl-calca').abierto);
  const faltante = CASOS['cotizacion en Producto entregado con pago sin registrar'];
  assert.equal(plegable(filaAbierta(faltante, { plegables: { 'c41:comprobante': false } }), 'pl-comprobante').abierto, false);
  assert.ok(plegable(filaAbierta(faltante, { plegables: { 'c99:comprobante': false } }), 'pl-comprobante').abierto, 'la llave es de la tarjeta');
});

test('#518 plegables: un prospecto no muestra Calca ni Comprobante', () => {
  for (const o of [CASOS['prospecto No Asignado'], CASOS['prospecto Por Cotizar']]) {
    const html = filaAbierta(o);
    assert.equal(plegable(html, 'pl-calca'), null);
    assert.equal(plegable(html, 'pl-comprobante'), null);
  }
});

test('#518 las salidas van al final bajo Cerrar oportunidad', () => {
  const html = filaAbierta(CASOS['prospecto Por Cotizar']);
  const salida = html.indexOf('Cerrar oportunidad');
  assert.ok(salida > 0);
  assert.ok(html.indexOf('marcarNoUtilTablero(7)') > salida);
  assert.ok(html.indexOf('moverASeguimientoTablero(7)') < salida);
});

const A3C = {
  no_asignado: ['oklch(0.95 0.02 80)', 'oklch(0.48 0.04 75)'],
  por_cotizar: ['oklch(0.95 0.07 85)', 'oklch(0.50 0.11 75)'],
  seguimiento: ['oklch(0.94 0.09 70)', 'oklch(0.47 0.15 50)'],
  anticipo_pagado: ['oklch(0.94 0.035 262)', 'oklch(0.42 0.15 262)'],
  pedido_liberado: ['oklch(0.94 0.04 230)', 'oklch(0.42 0.11 230)'],
  saldo_pagado: ['oklch(0.94 0.05 180)', 'oklch(0.44 0.10 180)'],
  producto_entregado: ['oklch(0.94 0.06 145)', 'oklch(0.40 0.12 145)'],
};

test('#518 color por etapa: las 7 variables con la paleta A3c y la pastilla del tablero las consume', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'css', 'style.css'), 'utf8');
  assert.deepEqual(Object.keys(A3C), L.COLUMNAS_PIPELINE);
  for (const [etapa, [fondo, texto]] of Object.entries(A3C)) {
    assert.ok(css.includes(`--etapa-${etapa}: ${fondo};`), `--etapa-${etapa}`);
    assert.ok(css.includes(`--etapa-${etapa}-texto: ${texto};`), `--etapa-${etapa}-texto`);
    const regla = new RegExp(`\\.col-pill-${etapa}\\b[^{]*\\{[^}]*background: var\\(--etapa-${etapa}\\);[^}]*color: var\\(--etapa-${etapa}-texto\\);`);
    assert.ok(regla.test(css), `.col-pill-${etapa}`);
  }
});
