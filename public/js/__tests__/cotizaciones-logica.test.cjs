'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let COLUMNAS_COTIZACIONES, columnaCotizacion, agruparTableroCotizaciones,
  puedeArrastrarCotizacion, buildTableroCotizacionesHtml,
  buildHistorialAccionesHtml, buildWhatsAppLinkHistorial,
  puedeActualizarCotizacion, buildAccionesCargaHtml,
  buildAvisoModoActualizacion, textoBotonGenerar;
before(async () => {
  ({ COLUMNAS_COTIZACIONES, columnaCotizacion, agruparTableroCotizaciones,
    puedeArrastrarCotizacion, buildTableroCotizacionesHtml,
    buildHistorialAccionesHtml, buildWhatsAppLinkHistorial,
    puedeActualizarCotizacion, buildAccionesCargaHtml,
    buildAvisoModoActualizacion, textoBotonGenerar } = await import('../cotizaciones-logica.js'));
});

const HOY = new Date('2026-06-11T12:00:00.000Z');

function cot(diasAtras, extra = {}) {
  return {
    id: 1,
    fecha: new Date(HOY - diasAtras * 24 * 60 * 60 * 1000).toISOString(),
    cliente: 'Hotel Azul',
    vendedor: 'Laura',
    total: 12345.5,
    totalPiezas: 350,
    estado: 'abierta',
    ...extra,
  };
}

test('Q1: columnaCotizacion clasifica abiertas por edad en dias naturales con los bordes 2/7/21/28', () => {
  assert.equal(columnaCotizacion(cot(0), HOY), 'reciente');
  assert.equal(columnaCotizacion(cot(1), HOY), 'reciente');
  assert.equal(columnaCotizacion(cot(2), HOY), 'dia2');
  assert.equal(columnaCotizacion(cot(6), HOY), 'dia2');
  assert.equal(columnaCotizacion(cot(7), HOY), 'dia7');
  assert.equal(columnaCotizacion(cot(20), HOY), 'dia7');
  assert.equal(columnaCotizacion(cot(21), HOY), 'por_vencer');
  assert.equal(columnaCotizacion(cot(27), HOY), 'por_vencer');
  assert.equal(columnaCotizacion(cot(28), HOY), 'vencida');
  assert.equal(columnaCotizacion(cot(90), HOY), 'vencida');
});

test('Q2: una cotizacion cambia de columna sola cuando su edad cruza un umbral', () => {
  const c = cot(0);
  const unDia = 24 * 60 * 60 * 1000;
  assert.equal(columnaCotizacion(c, new Date(HOY.getTime() + 1 * unDia)), 'reciente');
  assert.equal(columnaCotizacion(c, new Date(HOY.getTime() + 2 * unDia)), 'dia2');
  assert.equal(columnaCotizacion(c, new Date(HOY.getTime() + 7 * unDia)), 'dia7');
  assert.equal(columnaCotizacion(c, new Date(HOY.getTime() + 21 * unDia)), 'por_vencer');
  assert.equal(columnaCotizacion(c, new Date(HOY.getTime() + 28 * unDia)), 'vencida');
});

test('Q3: los estados cerrados mandan sobre la edad y descartada sale del tablero', () => {
  assert.equal(columnaCotizacion(cot(90, { estado: 'ganada' }), HOY), 'ganada');
  assert.equal(columnaCotizacion(cot(0, { estado: 'perdida' }), HOY), 'perdida');
  assert.equal(columnaCotizacion(cot(5, { estado: 'descartada' }), HOY), null);
  assert.equal(columnaCotizacion(cot(3, { estado: undefined }), HOY), 'dia2');
});

test('Q4: agruparTableroCotizaciones devuelve las 7 columnas en orden y reparte', () => {
  const cols = agruparTableroCotizaciones([
    cot(0, { id: 1 }),
    cot(3, { id: 2 }),
    cot(10, { id: 3 }),
    cot(22, { id: 4 }),
    cot(30, { id: 5 }),
    cot(40, { id: 6, estado: 'ganada' }),
    cot(40, { id: 7, estado: 'perdida' }),
    cot(40, { id: 8, estado: 'descartada' }),
  ], HOY);
  assert.deepEqual(Object.keys(cols), COLUMNAS_COTIZACIONES);
  assert.deepEqual(COLUMNAS_COTIZACIONES,
    ['reciente', 'dia2', 'dia7', 'por_vencer', 'vencida', 'ganada', 'perdida']);
  assert.deepEqual(cols.reciente.map(c => c.id), [1]);
  assert.deepEqual(cols.dia2.map(c => c.id), [2]);
  assert.deepEqual(cols.dia7.map(c => c.id), [3]);
  assert.deepEqual(cols.por_vencer.map(c => c.id), [4]);
  assert.deepEqual(cols.vencida.map(c => c.id), [5]);
  assert.deepEqual(cols.ganada.map(c => c.id), [6]);
  assert.deepEqual(cols.perdida.map(c => c.id), [7]);
});

test('Q5: agruparTableroCotizaciones ordena cada columna del mas reciente al mas antiguo y tolera vacio', () => {
  const cols = agruparTableroCotizaciones([
    cot(6, { id: 1 }),
    cot(2, { id: 2 }),
    cot(4, { id: 3 }),
  ], HOY);
  assert.deepEqual(cols.dia2.map(c => c.id), [2, 3, 1]);
  const vacio = agruparTableroCotizaciones([], HOY);
  assert.deepEqual(Object.keys(vacio), COLUMNAS_COTIZACIONES);
  assert.deepEqual(vacio.reciente, []);
  assert.deepEqual(agruparTableroCotizaciones(null, HOY).ganada, []);
});

test('Q6: puedeArrastrarCotizacion solo permite cerrar desde una columna de cadencia', () => {
  for (const de of ['reciente', 'dia2', 'dia7', 'por_vencer', 'vencida']) {
    assert.equal(puedeArrastrarCotizacion(de, 'ganada'), true);
    assert.equal(puedeArrastrarCotizacion(de, 'perdida'), true);
  }
});

test('Q7: puedeArrastrarCotizacion rechaza todo lo demas: el tiempo no se arrastra', () => {
  for (const a of ['reciente', 'dia2', 'dia7', 'por_vencer', 'vencida']) {
    assert.equal(puedeArrastrarCotizacion('reciente', a), false);
    assert.equal(puedeArrastrarCotizacion('vencida', a), false);
    assert.equal(puedeArrastrarCotizacion('ganada', a), false);
  }
  assert.equal(puedeArrastrarCotizacion('ganada', 'perdida'), false);
  assert.equal(puedeArrastrarCotizacion('perdida', 'ganada'), false);
  assert.equal(puedeArrastrarCotizacion('ganada', 'ganada'), false);
  assert.equal(puedeArrastrarCotizacion('perdida', 'perdida'), false);
});

test('Q8: buildTableroCotizacionesHtml pinta las 7 columnas con label, contador y data-col', () => {
  const html = buildTableroCotizacionesHtml([cot(0, { id: 1 }), cot(3, { id: 2 }), cot(4, { id: 3 })], HOY);
  for (const col of COLUMNAS_COTIZACIONES) {
    assert.ok(html.includes(`data-col="${col}"`), `falta data-col ${col}`);
  }
  assert.ok(html.includes('Recién enviada'));
  assert.ok(html.includes('Día 2'));
  assert.ok(html.includes('Día 7'));
  assert.ok(html.includes('Por vencer'));
  assert.ok(html.includes('Vencida'));
  assert.ok(html.includes('Ganada'));
  assert.ok(html.includes('Perdida'));
  assert.ok(html.includes('<span class="tablero-col-count">1</span>'));
  assert.ok(html.includes('<span class="tablero-col-count">2</span>'));
  assert.ok(html.includes('<span class="tablero-col-count">0</span>'));
});

test('Q9: las tarjetas llevan data-id, data-col y draggable salvo en columnas cerradas', () => {
  const html = buildTableroCotizacionesHtml([
    cot(3, { id: 11 }),
    cot(40, { id: 12, estado: 'ganada' }),
    cot(40, { id: 13, estado: 'perdida' }),
  ], HOY);
  assert.ok(html.includes('draggable="true" data-id="11" data-col="dia2"'));
  assert.ok(html.includes('draggable="false" data-id="12" data-col="ganada"'));
  assert.ok(html.includes('draggable="false" data-id="13" data-col="perdida"'));
});

test('Q10: la tarjeta muestra cliente, total formateado, piezas, vendedor y dias desde envio', () => {
  const html = buildTableroCotizacionesHtml([cot(3, { id: 1 })], HOY);
  assert.ok(html.includes('Hotel Azul'));
  assert.ok(html.includes('$12,345.50'));
  assert.ok(html.includes('350 pzs'));
  assert.ok(html.includes('Laura'));
  assert.ok(html.includes('hace 3 días'));
  const hoyMismo = buildTableroCotizacionesHtml([cot(0, { id: 2 })], HOY);
  assert.ok(hoyMismo.includes('hace 0 días'));
});

test('Q11: la tarjeta trae link wa.me cuando hay telefono y lo omite cuando no', () => {
  const con = buildTableroCotizacionesHtml([cot(3, { telefono: '525512345678' })], HOY);
  assert.ok(con.includes('https://wa.me/525512345678'));
  const sin = buildTableroCotizacionesHtml([cot(3)], HOY);
  assert.ok(!sin.includes('wa.me'));
});

test('Q12: buildTableroCotizacionesHtml escapa datos de usuario', () => {
  const html = buildTableroCotizacionesHtml([
    cot(3, { cliente: '<img src=x onerror=alert(1)>', vendedor: '<b>v</b>' }),
  ], HOY);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&lt;b&gt;v&lt;/b&gt;'));
});

test('Q13: cada columna del tablero muestra la suma de dinero de sus tarjetas', () => {
  const html = buildTableroCotizacionesHtml([
    cot(3, { id: 1, total: 1000 }),
    cot(4, { id: 2, total: 2500.5 }),
    cot(40, { id: 3, total: 99 }),
  ], HOY);
  assert.match(html, /tablero-col-suma">\$3,500\.50</);
  assert.match(html, /tablero-col-suma">\$99\.00</);
  assert.match(html, /tablero-col-suma">\$0\.00</);
});

test('Q16: las tarjetas de cadencia traen botones Ganada/Perdida y las cerradas no', () => {
  const abierta = buildTableroCotizacionesHtml([cot(3, { id: 7 })], HOY);
  assert.match(abierta, /cerrarCotizacionTablero\(7, 'ganada'\)/);
  assert.match(abierta, /cerrarCotizacionTablero\(7, 'perdida'\)/);
  const cerrada = buildTableroCotizacionesHtml([cot(3, { id: 8, estado: 'ganada' })], HOY);
  assert.equal(cerrada.includes('cerrarCotizacionTablero(8'), false);
});

test('Q15: una columna vacia del tablero pinta su estado vacio', () => {
  const html = buildTableroCotizacionesHtml([], HOY);
  assert.match(html, /tablero-col-vacia/);
});

test('Q14: el header de columna es un pill con clase por columna', () => {
  const html = buildTableroCotizacionesHtml([cot(3)], HOY);
  assert.match(html, /col-pill col-pill-dia2/);
  assert.match(html, /col-pill col-pill-ganada/);
});

// === #103: acciones del historial (Ver PDF / Ver HTML / WhatsApp) regeneran
// desde el registro guardado; nada de disco ni de estado del formulario.

test('Q17: buildHistorialAccionesHtml apunta Ver PDF y Ver HTML a los GET que regeneran desde data', () => {
  const html = buildHistorialAccionesHtml(cot(3, { id: 42, hasData: true }));
  assert.ok(html.includes('href="/api/cotizacion/pdf/42"'));
  assert.ok(html.includes('href="/api/cotizacion/html/42"'));
  assert.ok(html.includes('>Ver PDF<'));
  assert.ok(html.includes('>Ver HTML<'));
});

test('Q18: buildHistorialAccionesHtml deshabilita las 3 acciones cuando el registro no tiene data', () => {
  const html = buildHistorialAccionesHtml(cot(3, { id: 42, hasData: false }));
  assert.ok(!html.includes('/api/cotizacion/pdf/42'));
  assert.ok(!html.includes('/api/cotizacion/html/42'));
  assert.ok(!html.includes('wa.me'));
  assert.match(html, /disabled title="Datos no disponibles">Ver PDF/);
  assert.match(html, /disabled title="Datos no disponibles">Ver HTML/);
  assert.match(html, /disabled title="Datos no disponibles">WhatsApp/);
});

test('Q19: buildWhatsAppLinkHistorial arma un wa.me con el HTML regenerado (con origin) y el cliente/total en el mensaje', () => {
  const url = buildWhatsAppLinkHistorial(cot(3, { id: 42, cliente: 'Hotel Azul', total: 12345.5 }), 'https://cotizador.example');
  assert.match(url, /^https:\/\/wa\.me\/\?text=/);
  const msg = decodeURIComponent(url.split('text=')[1]);
  assert.ok(msg.includes('Hotel Azul'));
  assert.ok(msg.includes('12,345.50'));
  assert.ok(msg.includes('https://cotizador.example/api/cotizacion/html/42'));
});

test('Q20: buildHistorialAccionesHtml usa el link wa.me de buildWhatsAppLinkHistorial y escapa datos de usuario', () => {
  const html = buildHistorialAccionesHtml(cot(3, { id: 7, cliente: '<img src=x onerror=alert(1)>', hasData: true }), 'https://cotizador.example');
  assert.ok(html.includes('wa.me'));
  assert.ok(!html.includes('<img src=x'));
});

// === Actualizar vs crear-nueva desde el historial (#104, ADR-0008) ===
// "Cargar" hacia dos cosas a la vez: restaurar el carrito y, calladamente, empezar
// una cotizacion NUEVA (#83 F1 reseteaba lastCotizacionId). Ahora son dos acciones
// explicitas. El gate de "Actualizar" es el del ADR: folio ya subido y SIN pedido
// asociado -- consistente con Operam, que deshabilita la edicion de un quote ya
// convertido en pedido.

test('Q21: puedeActualizarCotizacion exige folio subido y ningun pedido asociado', () => {
  assert.equal(puedeActualizarCotizacion({ hasData: true, folioOperam: '1200', orderOperam: null }).puede, true);
});

test('Q22: puedeActualizarCotizacion bloquea con pedido asociado (el quote ya se convirtio)', () => {
  const r = puedeActualizarCotizacion({ hasData: true, folioOperam: '1200', orderOperam: '7077' });
  assert.equal(r.puede, false);
  assert.match(r.motivo, /pedido/i);
});

test('Q23: puedeActualizarCotizacion bloquea una PRE (sin folio no hay quote que editar)', () => {
  const r = puedeActualizarCotizacion({ hasData: true, folioOperam: null, orderOperam: null });
  assert.equal(r.puede, false);
  assert.match(r.motivo, /Operam/i);
});

test('Q24: puedeActualizarCotizacion bloquea una historica sin data (no hay nada que reescribir)', () => {
  assert.equal(puedeActualizarCotizacion({ hasData: false, folioOperam: '900' }).puede, false);
  assert.equal(puedeActualizarCotizacion(undefined).puede, false);
});

test('Q25: buildAccionesCargaHtml ofrece Actualizar (default) y Crear nueva cuando se puede actualizar', () => {
  const html = buildAccionesCargaHtml(cot(3, { id: 7, hasData: true, folioOperam: '1200' }));
  assert.ok(html.includes('Actualizar cotización'));
  assert.ok(html.includes('Crear nueva a partir de ésta'));
  assert.ok(html.includes("cargarCotizacion(7, 'actualizar')"));
  assert.ok(html.includes("cargarCotizacion(7, 'nueva')"));
  // el default es Actualizar: es el unico primario
  assert.equal((html.match(/btn-primary/g) || []).length, 1);
  assert.ok(/Actualizar cotización[\s\S]*?<\/button>/.test(html));
  assert.ok(!html.includes('disabled'));
});

test('Q26: buildAccionesCargaHtml deshabilita Actualizar con pedido asociado y explica por que', () => {
  const html = buildAccionesCargaHtml(cot(3, { id: 7, hasData: true, folioOperam: '1200', orderOperam: '7077' }));
  assert.ok(html.includes('disabled'));
  assert.match(html, /title="[^"]*pedido[^"]*"/i);
  // Crear nueva sigue disponible y pasa a ser el default
  assert.ok(html.includes("cargarCotizacion(7, 'nueva')"));
  assert.ok(!html.includes("cargarCotizacion(7, 'actualizar')"));
});

test('Q27: buildAccionesCargaHtml sin data deshabilita las dos acciones', () => {
  const html = buildAccionesCargaHtml(cot(3, { id: 7, hasData: false }));
  assert.equal((html.match(/disabled/g) || []).length, 2);
  assert.ok(!html.includes('cargarCotizacion('));
});

// === #109: el aviso de modo actualizacion identifica el documento por el
// folio REAL de Operam (badge "#Operam N" de pipeline-logica.js, issue #63),
// nunca por el id interno del registro -- ese era el bug reportado por Adrian
// en la verificacion de #104 ("#16" leido junto a "mismo folio" como si 16 y
// 1200 fueran el mismo numero). En modo actualizacion el folio SIEMPRE existe
// (gate puedeActualizarCotizacion), asi que no hay caso "sin folio" que cubrir.

test('Q28: buildAvisoModoActualizacion nombra el folio real de Operam con la convencion #Operam N', () => {
  const html = buildAvisoModoActualizacion('1200');
  assert.ok(html.includes('#Operam 1200'));
  assert.ok(!html.includes('#16'));
});

test('Q29: buildAvisoModoActualizacion describe la accion en terminos de los botones (actualizar PDF/HTML)', () => {
  const html = buildAvisoModoActualizacion('1200');
  assert.match(html, /actualizar el pdf o el html/i);
  assert.match(html, /se actualizar.* en operam/i);
});

// === #109: los botones comunican que actualizan (no "generar" generico) en
// modo actualizacion, y conservan el texto historico fuera de ese modo.

test('Q30: textoBotonGenerar devuelve las etiquetas normales fuera de modo actualizacion', () => {
  assert.equal(textoBotonGenerar('pdf', false), 'Generar PDF');
  assert.equal(textoBotonGenerar('html', false), 'Ver HTML');
});

test('Q31: textoBotonGenerar devuelve etiquetas de actualizar en modo actualizacion', () => {
  assert.equal(textoBotonGenerar('pdf', true), 'Actualizar PDF');
  assert.equal(textoBotonGenerar('html', true), 'Actualizar HTML');
});
