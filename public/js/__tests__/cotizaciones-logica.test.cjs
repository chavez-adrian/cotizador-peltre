'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let COLUMNAS_COTIZACIONES, columnaCotizacion, agruparTableroCotizaciones,
  puedeArrastrarCotizacion, buildTableroCotizacionesHtml,
  buildHistorialAccionesHtml, buildWhatsAppLinkHistorial,
  puedeActualizarCotizacion, buildAccionesCargaHtml,
  buildAvisoModoActualizacion, textoBotonGenerar, filtrarCotizaciones,
  buildAvisoCambioClienteHtml;
let MENSAJE_COPIA_LISTA_FIJADA;
let clienteAlCargarCotizacion, ligaClienteAlGuardar, customerIdFiscal, cotizacionesPreviasDelCliente;
let vendedorAlGuardar;
before(async () => {
  ({ COLUMNAS_COTIZACIONES, columnaCotizacion, agruparTableroCotizaciones,
    puedeArrastrarCotizacion, buildTableroCotizacionesHtml,
    buildHistorialAccionesHtml, buildWhatsAppLinkHistorial,
    puedeActualizarCotizacion, buildAccionesCargaHtml,
    buildAvisoModoActualizacion, textoBotonGenerar,
    filtrarCotizaciones, buildAvisoCambioClienteHtml,
    clienteAlCargarCotizacion, ligaClienteAlGuardar,
    vendedorAlGuardar } = await import('../cotizaciones-logica.js'));
  ({ MENSAJE_COPIA_LISTA_FIJADA } = await import('../tier-logica.js'));
  ({ customerIdFiscal, cotizacionesPreviasDelCliente } = await import('../alta-logica.js'));
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

// #111 (ADR-0009): el historial identifica cada cotizacion con el MISMO numero
// que Operam. La vista lista ya lo hacia con el badge de #63; el tablero -- la
// otra mitad de la misma vista -- no identificaba la tarjeta con nada, asi que
// una cotizacion vista ahi no se podia cruzar con el ERP. Se usa siempre
// etiquetaFolioOperam ("Cotizacion N" / "PRE"), nunca el id interno.
test('Q11b: la tarjeta del tablero identifica la cotizacion por su folio de Operam, y las PRE siguen distinguibles', () => {
  const conFolio = buildTableroCotizacionesHtml([cot(3, { id: 1, folioOperam: '1200' })], HOY);
  assert.ok(conFolio.includes('Cotización 1200'));
  assert.ok(!conFolio.includes('#1'), 'no identifica por el id interno');

  const pre = buildTableroCotizacionesHtml([cot(3, { id: 2 })], HOY);
  assert.ok(pre.includes('>PRE<'));

  // Historica anterior a #63: se asume registrada, sin badge (ni PRE ni Cotizacion).
  const historica = buildTableroCotizacionesHtml([cot(3, { id: 3, registroDesconocido: true })], HOY);
  assert.ok(!historica.includes('>PRE<'));
  assert.ok(!historica.includes('Cotización'));
});

test('Q11: la tarjeta trae link wa.me cuando hay telefono y lo omite cuando no', () => {
  const con = buildTableroCotizacionesHtml([cot(3, { telefono: '525512345678' })], HOY);
  assert.ok(con.includes('https://wa.me/525512345678'));
  const sin = buildTableroCotizacionesHtml([cot(3)], HOY);
  assert.ok(!sin.includes('wa.me'));
});

// #196: la tarjeta muestra el nombre corto (c.nombreCorto, expuesto desde #147)
// entre parentesis con el formato unico (nombreConCorto), en vez de nunca
// pintarlo (hasta ahora solo se usaba para matching del buscador).
test('Q10b (#196): la tarjeta muestra el nombre corto entre parentesis cuando existe', () => {
  const html = buildTableroCotizacionesHtml([cot(3, { id: 1, cliente: 'Hotel Azul Centro SA de CV', nombreCorto: 'Hotel Azul' })], HOY);
  assert.ok(html.includes('Hotel Azul Centro SA de CV (Hotel Azul)'), 'debe llevar el nombre corto entre parentesis');
});

test('Q10c (#196): sin nombreCorto no agrega parentesis vacio', () => {
  const html = buildTableroCotizacionesHtml([cot(3, { id: 1 })], HOY);
  assert.ok(!html.includes('Hotel Azul ('), 'sin nombreCorto no debe haber parentesis');
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

// #204 (ajuste): candado del documento mientras hay un duplicado sin resolver.
// Las tres acciones abren el MISMO documento (WhatsApp comparte el link al HTML),
// asi que las tres se apagan: dejar WhatsApp vivo mandaria al cliente un link que
// solo muestra el aviso. El candado real vive en los GET del server (van sin
// auth); esto es la parte que el vendedor ve.
test('Q18b: buildHistorialAccionesHtml deshabilita las 3 acciones con un duplicado pendiente', () => {
  const html = buildHistorialAccionesHtml(cot(3, { id: 42, hasData: true, motivoPre: 'dedup' }));
  assert.ok(!html.includes('/api/cotizacion/pdf/42'));
  assert.ok(!html.includes('/api/cotizacion/html/42'));
  assert.ok(!html.includes('wa.me'));
  assert.match(html, /disabled title="[^"]*duplicado[^"]*">Ver PDF/);
  assert.match(html, /disabled title="[^"]*duplicado[^"]*">Ver HTML/);
  assert.match(html, /disabled title="[^"]*duplicado[^"]*">WhatsApp/);
});

// El PRE por fallo de Operam (motivoPre 'operam') NO bloquea Ver PDF / Ver HTML:
// el documento es legitimo y sale sin numero, que es justo lo que ADR-0009
// decidio. Pero sin folio (#311) WhatsApp si se apaga: sin numero no hay nada
// que citar en el chat.
test('Q18c: buildHistorialAccionesHtml no bloquea Ver PDF/Ver HTML en el PRE por fallo de Operam, pero apaga WhatsApp sin folio', () => {
  const html = buildHistorialAccionesHtml(cot(3, { id: 42, hasData: true, motivoPre: 'operam', folioOperam: null }));
  assert.ok(html.includes('href="/api/cotizacion/pdf/42"'));
  assert.ok(html.includes('href="/api/cotizacion/html/42"'));
  assert.ok(!html.includes('wa.me'));
  assert.match(html, /disabled title="Sin número de cotización[^"]*">WhatsApp/);
});

// Con folio de Operam (#311) las tres acciones quedan activas, incluido WhatsApp.
test('Q18d: buildHistorialAccionesHtml habilita las tres acciones, incluido WhatsApp, en cuanto hay folio', () => {
  const html = buildHistorialAccionesHtml(cot(3, { id: 42, hasData: true, folioOperam: '1200' }), 'https://cotizador.example');
  assert.ok(html.includes('href="/api/cotizacion/pdf/42"'));
  assert.ok(html.includes('href="/api/cotizacion/html/42"'));
  assert.ok(html.includes('wa.me'));
  assert.ok(!html.includes('disabled'));
});

// #307/#312: el texto del Resumen de la cotizacion lo arma UN solo lugar
// (resumen-cotizacion-logica.js) y el historial es una envoltura sobre el, para
// que compartir desde aqui y desde la cotizacion recien generada diga lo mismo.
// Estas pruebas afirman que DELEGA -- el texto en si lo afirma la suite del
// nucleo, con las dos cotizaciones reales.
const FAMILIAS = { VA05: 'taza', PL27: 'plato' };

function cotConItems(extra = {}) {
  return cot(3, {
    id: 42, folioOperam: 928, cliente: 'Hotel Azul', total: 12345.5, vigencia: '2026-10-03',
    items: [
      { codigo: 'VA05B1001112', descripcion: 'Taza 5', cantidad: 144, precio: 27.59, descuento: 0 },
      { codigo: 'PL27B1A32112', descripcion: 'Plato 27', cantidad: 4, precio: 331.9, descuento: 0 },
    ],
    ...extra,
  });
}

test('Q19: buildWhatsAppLinkHistorial delega en el nucleo del Resumen de la cotizacion, indice incluido', async () => {
  const { mensajeCotizacion } = await import('../resumen-cotizacion-logica.js');
  const c = cotConItems();
  assert.equal(
    buildWhatsAppLinkHistorial(c, 'https://cotizador.example', FAMILIAS),
    mensajeCotizacion(c, 'https://cotizador.example', FAMILIAS).waUrl
  );
});

test('Q19b: buildHistorialAccionesHtml pasa el indice de familias al nucleo', async () => {
  const { mensajeCotizacion } = await import('../resumen-cotizacion-logica.js');
  const c = cotConItems({ hasData: true });
  const esperado = mensajeCotizacion(c, 'https://cotizador.example', FAMILIAS).waUrl;
  const html = buildHistorialAccionesHtml(c, 'https://cotizador.example', FAMILIAS);
  assert.ok(html.includes(`href="${esperado.replace(/&/g, '&amp;')}"`));
});

test('Q20: buildHistorialAccionesHtml usa el link wa.me de buildWhatsAppLinkHistorial y escapa datos de usuario', () => {
  const html = buildHistorialAccionesHtml(cot(3, { id: 7, cliente: '<img src=x onerror=alert(1)>', hasData: true, folioOperam: '1200' }), 'https://cotizador.example');
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

test('Q25: buildAccionesCargaHtml ofrece Editar (default) y Copiar cotización cuando se puede actualizar', () => {
  const html = buildAccionesCargaHtml(cot(3, { id: 7, hasData: true, folioOperam: '1200' }));
  assert.ok(html.includes('Editar'));
  assert.ok(html.includes('Copiar cotización'));
  assert.ok(html.includes("cargarCotizacion(7, 'actualizar')"));
  assert.ok(html.includes("cargarCotizacion(7, 'nueva')"));
  // el default es Editar: es el unico primario
  assert.equal((html.match(/btn-primary/g) || []).length, 1);
  assert.ok(/Editar[\s\S]*?<\/button>/.test(html));
  assert.ok(!html.includes('disabled'));
});

test('Q26: buildAccionesCargaHtml deshabilita Editar con pedido asociado y explica por que', () => {
  const html = buildAccionesCargaHtml(cot(3, { id: 7, hasData: true, folioOperam: '1200', orderOperam: '7077' }));
  assert.ok(html.includes('disabled'));
  assert.match(html, /title="[^"]*pedido[^"]*"/i);
  // Copiar cotización sigue disponible y pasa a ser el default
  assert.ok(html.includes("cargarCotizacion(7, 'nueva')"));
  assert.ok(!html.includes("cargarCotizacion(7, 'actualizar')"));
});

test('Q27: buildAccionesCargaHtml sin data deshabilita las dos acciones', () => {
  const html = buildAccionesCargaHtml(cot(3, { id: 7, hasData: false }));
  assert.equal((html.match(/disabled/g) || []).length, 2);
  assert.ok(!html.includes('cargarCotizacion('));
});

// === #109: el aviso de modo actualizacion identifica el documento por el
// folio REAL de Operam (badge "Cotizacion N" de pipeline-logica.js, issue #63),
// nunca por el id interno del registro -- ese era el bug reportado por Adrian
// en la verificacion de #104 ("#16" leido junto a "mismo folio" como si 16 y
// 1200 fueran el mismo numero). En modo actualizacion el folio SIEMPRE existe
// (gate puedeActualizarCotizacion), asi que no hay caso "sin folio" que cubrir.

test('Q28: buildAvisoModoActualizacion nombra el folio real de Operam con la etiqueta Cotizacion N', () => {
  const html = buildAvisoModoActualizacion('1200');
  assert.ok(html.includes('Cotización 1200'));
  assert.ok(!html.includes('#16'));
});

test('Q29: buildAvisoModoActualizacion describe la accion en terminos de los botones (actualizar PDF/HTML)', () => {
  const html = buildAvisoModoActualizacion('1200');
  assert.match(html, /actualizar el pdf o el html/i);
  assert.match(html, /se actualizar.* en operam/i);
});

// === #385: avisos al cambiar de cliente (salida de la edicion, lista perdida)

test('buildAvisoCambioClienteHtml sin aviso devuelve cadena vacia (el slot se oculta solo)', () => {
  assert.equal(buildAvisoCambioClienteHtml(null), '');
});

test('buildAvisoCambioClienteHtml: la salida de la edicion nombra el folio como Cotizacion N y dice que se creara una nueva', () => {
  const html = buildAvisoCambioClienteHtml({ salidaEdicion: true, folioOperam: '1264', listaPerdida: false });
  assert.ok(html.includes('<span class="operam-status">'));
  assert.match(html, /Cotizaci\S+n 1264/);
  assert.ok(!html.includes('#'));
  assert.match(html, /cotizaci.{1,8}n nueva/i);
  assert.match(html, /como estaba/i);
  assert.ok(!html.includes(MENSAJE_COPIA_LISTA_FIJADA));
});

test('buildAvisoCambioClienteHtml: la lista perdida usa el mismo mensaje que Copiar sin permiso', () => {
  const html = buildAvisoCambioClienteHtml({ salidaEdicion: false, folioOperam: null, listaPerdida: true });
  assert.ok(html.includes(MENSAJE_COPIA_LISTA_FIJADA));
  assert.ok(!html.includes('1264'));
  assert.ok(!/edici/i.test(html));
});

// .operam-status es inline-flex con wrap: cada nodo hijo es un flex item, asi que
// el texto que sigue al <strong> se iba entero al renglon de abajo (HITL #385).
// El mensaje con negritas viaja envuelto en UN solo hijo para que fluya como texto.
test('los avisos con folio en negritas son un solo hijo de .operam-status (no se parten en renglones)', () => {
  const unHijo = /^<span class="operam-status"><span>[^]*<strong>[^]*<\/strong>[^]*<\/span><\/span>$/;
  assert.match(buildAvisoCambioClienteHtml({ salidaEdicion: true, folioOperam: '1264', listaPerdida: false }), unHijo);
  assert.match(buildAvisoModoActualizacion('1200'), unHijo);
});

test('buildAvisoCambioClienteHtml: las dos cosas a la vez salen como dos avisos', () => {
  const html = buildAvisoCambioClienteHtml({ salidaEdicion: true, folioOperam: '1264', listaPerdida: true });
  assert.equal((html.match(/<span class="operam-status">/g) || []).length, 2);
  assert.match(html, /Cotizaci\S+n 1264/);
  assert.ok(html.includes(MENSAJE_COPIA_LISTA_FIJADA));
});

// === #109: los botones comunican que actualizan (no "generar" generico) en
// modo actualizacion, y conservan el texto historico fuera de ese modo.

test('Q30: textoBotonGenerar devuelve las etiquetas normales fuera de modo actualizacion', () => {
  assert.equal(textoBotonGenerar('pdf', false), 'Generar PDF');
  assert.equal(textoBotonGenerar('html', false), 'Generar HTML');
});

test('Q31: textoBotonGenerar devuelve etiquetas de actualizar en modo actualizacion', () => {
  assert.equal(textoBotonGenerar('pdf', true), 'Actualizar y ver PDF');
  assert.equal(textoBotonGenerar('html', true), 'Actualizar y ver HTML');
});

// === #146: buscador del Historial. Nucleo puro que recibe el arreglo ya
// cargado en memoria y devuelve el subconjunto; la cascara de UI solo hace
// wiring, y por eso Lista y Tablero comparten el filtro gratis.

test('Q32: filtrarCotizaciones sin criterio devuelve todas', () => {
  const lista = [cot(1, { id: 1 }), cot(2, { id: 2 })];
  assert.deepEqual(filtrarCotizaciones(lista, { texto: '' }).map(c => c.id), [1, 2]);
  assert.deepEqual(filtrarCotizaciones(lista, { texto: '   ' }).map(c => c.id), [1, 2]);
  assert.deepEqual(filtrarCotizaciones(lista, {}).map(c => c.id), [1, 2]);
  assert.deepEqual(filtrarCotizaciones(lista).map(c => c.id), [1, 2]);
});

test('Q33: filtrarCotizaciones matchea por razon social como subcadena', () => {
  const lista = [
    cot(1, { id: 1, cliente: 'Hotel Azul' }),
    cot(2, { id: 2, cliente: 'Restaurante El Roble' }),
  ];
  assert.deepEqual(filtrarCotizaciones(lista, { texto: 'hotel' }).map(c => c.id), [1]);
  assert.deepEqual(filtrarCotizaciones(lista, { texto: 'roble' }).map(c => c.id), [2]);
  assert.deepEqual(filtrarCotizaciones(lista, { texto: 'el' }).map(c => c.id), [1, 2]);
});

test('Q34: filtrarCotizaciones ignora mayusculas y acentos en los dos sentidos', () => {
  const lista = [
    cot(1, { id: 1, cliente: 'Comercial Hernández' }),
    cot(2, { id: 2, cliente: 'Panaderia Lopez' }),
  ];
  assert.deepEqual(filtrarCotizaciones(lista, { texto: 'hernandez' }).map(c => c.id), [1]);
  assert.deepEqual(filtrarCotizaciones(lista, { texto: 'HERNANDEZ' }).map(c => c.id), [1]);
  assert.deepEqual(filtrarCotizaciones(lista, { texto: 'López' }).map(c => c.id), [2]);
});

test('Q35: filtrarCotizaciones matchea por el folio REAL de Operam (ADR-0009), nunca por el id interno', () => {
  const lista = [
    cot(1, { id: 16, cliente: 'Hotel Azul', folioOperam: '1216' }),
    cot(2, { id: 1216, cliente: 'Panaderia Lopez', folioOperam: '1300' }),
  ];
  assert.deepEqual(filtrarCotizaciones(lista, { texto: '1216' }).map(c => c.id), [16]);
  assert.deepEqual(filtrarCotizaciones(lista, { texto: '16' }).map(c => c.id), [16]);
  // folio numerico (no string) matchea igual
  const numerico = [cot(1, { id: 1, cliente: 'Hotel Azul', folioOperam: 1216 })];
  assert.equal(filtrarCotizaciones(numerico, { texto: '1216' }).length, 1);
});

test('Q36: filtrarCotizaciones devuelve vacio cuando nada matchea', () => {
  const lista = [cot(1, { id: 1, cliente: 'Hotel Azul', folioOperam: '1216' })];
  assert.deepEqual(filtrarCotizaciones(lista, { texto: 'zzz' }), []);
});

test('Q37: filtrarCotizaciones tolera lista vacia y registros sin cliente ni folio', () => {
  assert.deepEqual(filtrarCotizaciones([], { texto: 'hotel' }), []);
  assert.deepEqual(filtrarCotizaciones(null, { texto: 'hotel' }), []);
  assert.deepEqual(filtrarCotizaciones(undefined, {}), []);
  const sinCampos = [cot(1, { id: 1, cliente: null, folioOperam: null })];
  assert.deepEqual(filtrarCotizaciones(sinCampos, { texto: 'hotel' }), []);
  assert.equal(filtrarCotizaciones(sinCampos, { texto: '' }).length, 1);
});

test('Q38: filtrarCotizaciones no muta el arreglo original', () => {
  const lista = [cot(1, { id: 1, cliente: 'Hotel Azul' }), cot(2, { id: 2, cliente: 'Panaderia Lopez' })];
  const filtradas = filtrarCotizaciones(lista, { texto: 'hotel' });
  assert.equal(lista.length, 2);
  assert.notEqual(filtradas, lista);
});

// === #147: matching ampliado -- nombre corto, contacto de entrega, celular
// por digitos (cualquier formato) y vendedor.

test('Q39: filtrarCotizaciones matchea por nombre corto (cust_ref), case/acentos como el ticket base', () => {
  const lista = [
    cot(1, { id: 1, cliente: 'Hotel Azul Centro SA de CV', nombreCorto: 'Hotel Azul' }),
    cot(2, { id: 2, cliente: 'Panaderia Lopez SA de CV', nombreCorto: 'Panadería López' }),
  ];
  assert.deepEqual(filtrarCotizaciones(lista, { texto: 'hotel azul' }).map(c => c.id), [1]);
  assert.deepEqual(filtrarCotizaciones(lista, { texto: 'PANADERIA LOPEZ' }).map(c => c.id), [2]);
});

test('Q40: filtrarCotizaciones matchea por el nombre del contacto de entrega', () => {
  const lista = [
    cot(1, { id: 1, cliente: 'Hotel Azul', contactoEntrega: 'Mariana Gutiérrez Solís' }),
    cot(2, { id: 2, cliente: 'Panaderia Lopez', contactoEntrega: 'Olga Pinales' }),
  ];
  assert.deepEqual(filtrarCotizaciones(lista, { texto: 'mariana' }).map(c => c.id), [1]);
  assert.deepEqual(filtrarCotizaciones(lista, { texto: 'gutierrez' }).map(c => c.id), [1]);
  assert.deepEqual(filtrarCotizaciones(lista, { texto: 'olga' }).map(c => c.id), [2]);
});

test('Q41: filtrarCotizaciones matchea el celular como fragmento de digitos sin importar el formato capturado', () => {
  const lista = [
    cot(1, { id: 1, cliente: 'Hotel Azul', telefono: '525512345678' }),
    cot(2, { id: 2, cliente: 'Panaderia Lopez', telefono: '5219981234567' }),
  ];
  assert.deepEqual(filtrarCotizaciones(lista, { texto: '5512' }).map(c => c.id), [1]);
  assert.deepEqual(filtrarCotizaciones(lista, { texto: '998123' }).map(c => c.id), [2]);
  // formato con separadores/parentesis en la busqueda tambien se reduce a digitos
  assert.deepEqual(filtrarCotizaciones(lista, { texto: '(55) 1234-5678' }).map(c => c.id), [1]);
  assert.deepEqual(filtrarCotizaciones(lista, { texto: '9999' }), []);
});

// El vendedor SALIO de la caja de texto. #147 lo habia sumado al matching para
// que el admin encontrara las cotizaciones de una persona del equipo; medido en
// produccion 2026-09-19 eso rompe la busqueda que la caja SI anuncia: el
// vendedor aparece en decenas de cotizaciones y el cliente en una o dos, asi
// que en el OR el vendedor siempre gana y ahoga al cliente. Filtrar por persona
// es un FILTRO (un selector aparte, como en /prospectos), no una busqueda de
// texto libre. Aplica igual en las cinco vistas que comparten el control.
test('Q42: filtrarCotizaciones NO matchea por vendedor (la caja busca al cliente, no a quien vende)', () => {
  const lista = [
    cot(1, { id: 1, cliente: 'Hotel Azul', vendedor: 'Laura' }),
    cot(2, { id: 2, cliente: 'Panaderia Lopez', vendedor: 'Marco' }),
  ];
  assert.deepEqual(filtrarCotizaciones(lista, { texto: 'laura' }), []);
  assert.deepEqual(filtrarCotizaciones(lista, { texto: 'MARCO' }), []);
  // y lo que la caja si promete sigue igual
  assert.deepEqual(filtrarCotizaciones(lista, { texto: 'hotel' }).map(c => c.id), [1]);
});

// Regresion del caso REAL que abrio el ticket (medido en produccion con la
// cuenta de admin): 101 cotizaciones, 50 con vendedor "Adrian Chavez", y el
// cliente desechable de pruebas se llama IGUAL que ese vendedor. Teclear "Adr"
// para buscar al cliente devolvia las 50 de la cartera propia -- media pantalla
// de clientes ajenos a lo tecleado, indistinguible de un buscador descompuesto.
test('Q42b: buscar el nombre del propio vendedor devuelve a su cliente homonimo, no su cartera', () => {
  const lista = [
    cot(1, { id: 1, cliente: 'Adrian Chavez Rosete', vendedor: 'Adrián Chávez' }),
    cot(2, { id: 2, cliente: 'Carlos Couturier Gaya', vendedor: 'Adrián Chávez' }),
    cot(3, { id: 3, cliente: 'GALGUVE', vendedor: 'Adrián Chávez' }),
    cot(4, { id: 4, cliente: 'Don Asado', vendedor: 'Adrián Chávez' }),
  ];
  assert.deepEqual(filtrarCotizaciones(lista, { texto: 'Adr' }).map(c => c.id), [1]);
  // el apellido que comparten tres vendedores tampoco barre el historial
  assert.deepEqual(filtrarCotizaciones(lista, { texto: 'chavez' }).map(c => c.id), [1]);
});

// === #148: rango de fechas Desde/Hasta -- se combina con AND con el texto.
// cot(diasAtras) resta dias enteros de HOY (2026-06-11T12:00:00Z, mediodia
// UTC), asi que el dia UTC de c.fecha coincide con el dia calendario esperado
// sin ambiguedad de borde.

test('Q44: filtrarCotizaciones con solo "desde" filtra de esa fecha en adelante (rango abierto)', () => {
  const lista = [
    cot(0, { id: 1 }),  // 2026-06-11
    cot(10, { id: 2 }), // 2026-06-01
    cot(20, { id: 3 }), // 2026-05-22
  ];
  assert.deepEqual(filtrarCotizaciones(lista, { desde: '2026-06-01' }).map(c => c.id), [1, 2]);
});

test('Q45: filtrarCotizaciones con solo "hasta" filtra hasta esa fecha (rango abierto)', () => {
  const lista = [
    cot(0, { id: 1 }),  // 2026-06-11
    cot(10, { id: 2 }), // 2026-06-01
    cot(20, { id: 3 }), // 2026-05-22
  ];
  assert.deepEqual(filtrarCotizaciones(lista, { hasta: '2026-06-01' }).map(c => c.id), [2, 3]);
});

test('Q46: filtrarCotizaciones con "desde" y "hasta" acota el rango cerrado, incluyendo los bordes', () => {
  const lista = [
    cot(0, { id: 1 }),  // 2026-06-11
    cot(5, { id: 2 }),  // 2026-06-06
    cot(10, { id: 3 }), // 2026-06-01
    cot(20, { id: 4 }), // 2026-05-22
  ];
  assert.deepEqual(
    filtrarCotizaciones(lista, { desde: '2026-06-01', hasta: '2026-06-08' }).map(c => c.id),
    [2, 3]
  );
  // los bordes exactos matchean (inclusive)
  assert.deepEqual(
    filtrarCotizaciones(lista, { desde: '2026-06-01', hasta: '2026-06-11' }).map(c => c.id),
    [1, 2, 3]
  );
});

test('Q47: filtrarCotizaciones combina texto y rango de fechas con AND', () => {
  const lista = [
    cot(0, { id: 1, cliente: 'Hotel Azul' }),  // 2026-06-11, fuera del rango
    cot(10, { id: 2, cliente: 'Hotel Azul' }), // 2026-06-01, dentro y matchea texto
    cot(10, { id: 3, cliente: 'Panaderia Lopez' }), // 2026-06-01, dentro pero no matchea texto
  ];
  assert.deepEqual(
    filtrarCotizaciones(lista, { texto: 'hotel', desde: '2026-06-01', hasta: '2026-06-08' }).map(c => c.id),
    [2]
  );
});

test('Q48: filtrarCotizaciones sin fechas no acota (equivalente al buscador base)', () => {
  const lista = [cot(0, { id: 1 }), cot(90, { id: 2 })];
  assert.deepEqual(filtrarCotizaciones(lista, { texto: '', desde: '', hasta: '' }).map(c => c.id), [1, 2]);
  assert.deepEqual(filtrarCotizaciones(lista, {}).map(c => c.id), [1, 2]);
});

// Bug real encontrado verificando en navegador (Mexico_City, UTC-6): la tarjeta
// pinta la fecha en hora local, y comparar el rango contra el dia UTC (como los
// scripts de backend) contradecia lo que la tarjeta decia. filtrarCotizaciones
// solo corre en el navegador (nunca en server.js), asi que compara contra el
// dia LOCAL, igual que lo que ve el vendedor en pantalla. Desde #428 una fecha
// SIN hora ('2026-08-13', la ord_date del backfill) ya no se lee como
// medianoche UTC: se pinta "13 ago" y el filtro la trata como el 13.
test('Q49: filtrarCotizaciones compara el rango contra el dia LOCAL de c.fecha, no el dia UTC (borde de zona horaria)', () => {
  enMexico(() => {
    const lista = [
      // las 20:00 del 12 en Mexico_City: el dia UTC ya es el 13
      cot(0, { id: 1, fecha: '2026-08-13T02:00:00.000Z' }),
      // dia sin hora: es el 13 en cualquier huso
      cot(0, { id: 2, fecha: '2026-08-13' }),
    ];
    assert.deepEqual(filtrarCotizaciones(lista, { desde: '2026-08-13' }).map(c => c.id), [2]);
    assert.deepEqual(filtrarCotizaciones(lista, { hasta: '2026-08-12' }).map(c => c.id), [1]);
  });
});

test('Q50: filtrarCotizaciones con fecha ausente no matchea ningun rango pero si pasa sin fechas', () => {
  const lista = [cot(0, { id: 1, fecha: null })];
  assert.deepEqual(filtrarCotizaciones(lista, { desde: '2026-01-01' }), []);
  assert.deepEqual(filtrarCotizaciones(lista, {}).map(c => c.id), [1]);
});

test('Q43: registros sin data persistida (hasData false) no matchean por los campos ausentes ni rompen el filtro', () => {
  const lista = [
    cot(1, { id: 1, cliente: 'Historica', hasData: false, nombreCorto: null, contactoEntrega: null, telefono: null }),
    cot(2, { id: 2, cliente: 'Hotel Azul', nombreCorto: 'Hotel Azul', hasData: true }),
  ];
  assert.deepEqual(filtrarCotizaciones(lista, { texto: 'hotel' }).map(c => c.id), [2]);
  assert.deepEqual(filtrarCotizaciones(lista, { texto: '5512' }), []);
  // el registro sin data si matchea por lo que si tiene (razon social)
  assert.deepEqual(filtrarCotizaciones(lista, { texto: 'historica' }).map(c => c.id), [1]);
});

// === Issue #287: chip Origen en la tarjeta del Historial ===
// La cotizacion no guarda el origen: GET /api/cotizaciones lo anota heredandolo
// del prospecto del mismo celular.

test('OR10: la tarjeta del tablero del Historial pinta el Origen heredado y el que falta', () => {
  const conOrigen = buildTableroCotizacionesHtml([cot(3, { id: 1, origen: 'Bazar Sabado' })], HOY);
  assert.match(conOrigen, /origen-badge">Origen: Bazar Sabado/);
  const sinOrigen = buildTableroCotizacionesHtml([cot(3, { id: 2 })], HOY);
  assert.match(sinOrigen, /origen-badge-vacio">Origen sin identificar/);
});

// === Issue #394: Editar y Copiar reponen la identidad de la cotizacion cargada ===
// Caso real (produccion, 2026-09-18): Alejandro venia de dar de alta a Gerardo
// Cardenas (Cliente Operam 529) y abrio Editar sobre la cotizacion 1280, de
// Sofia Rodriguez (527). Los campos cl-* se llenaron con Sofia, pero el cliente
// de la sesion seguia siendo Gerardo: el customerId que viajaba en el cuerpo
// era el 529 y el registro quedo cruzado.

const COT_SOFIA = {
  razonSocial: 'SOFIA RODRIGUEZ MARTINEZ', nombreCorto: 'Sofia Rodriguez', rfc: 'ROMS900101AA1',
  telefono: '+52 5551234567', emailEntrega: 'sofia@correo.mx', cpEntrega: '56530', pais: 'MX',
  customerId: 527, branchId: 576,
};
const SESION_GERARDO = { tipo: 'operam', id: 529, name: 'GERARDO CARDENAS', ref: 'Gerardo Cardenas', rfc: 'XAXX010101000' };

test('#394-C1: Editar repone la identidad de la cotizacion cargada, no la de la sesion', () => {
  const cliente = clienteAlCargarCotizacion(COT_SOFIA, SESION_GERARDO);
  assert.strictEqual(customerIdFiscal(cliente), 527);
  assert.strictEqual(cliente.name, 'SOFIA RODRIGUEZ MARTINEZ');
  assert.strictEqual(cliente.rfc, 'ROMS900101AA1');
});

// Copiar es la misma carga con otro modo (cargarCotizacion(id, 'nueva')): el
// registro nace sin liga previa, asi que aqui no hay red del servidor y la
// identidad que ponga el navegador es la que sube el quote nuevo.
test('#394-C2: Copiar tambien parte de la cotizacion cargada, sin heredar la sesion', () => {
  const sinDatosFiscales = { ...COT_SOFIA, rfc: '', customerId: 527 };
  assert.strictEqual(customerIdFiscal(clienteAlCargarCotizacion(sinDatosFiscales, SESION_GERARDO)), 527);
});

test('#394-C3: una cotizacion sin Cliente Operam no hereda el de la sesion', () => {
  const nuncaSubida = { ...COT_SOFIA, customerId: null, branchId: null };
  assert.strictEqual(customerIdFiscal(clienteAlCargarCotizacion(nuncaSubida, SESION_GERARDO)), null);
});

// === #394: la liga persistida manda al guardar sobre un registro existente ===

test('#394-C4: un customerId ajeno no pisa la liga del registro y se reporta', () => {
  const liga = ligaClienteAlGuardar({ customerId: 529 }, { customerId: 527, branchId: 576 });
  assert.deepStrictEqual(liga, { customerId: 527, branchId: 576, customerIdIgnorado: 529 });
});

test('#394-C5: el mismo Cliente Operam en otro tipo de dato no es una liga ajena', () => {
  const liga = ligaClienteAlGuardar({ customerId: '527' }, { customerId: 527, branchId: 576 });
  assert.deepStrictEqual(liga, { customerId: 527, branchId: 576, customerIdIgnorado: null });
});

test('#394-C6: el domicilio que llega con un customerId ajeno se descarta con el', () => {
  const liga = ligaClienteAlGuardar({ customerId: 529, branchId: 599 }, { customerId: 527, branchId: 576 });
  assert.strictEqual(liga.branchId, 576);
});

test('#394-C7: sin liga previa el cuerpo la estrena (es como la subida la anota)', () => {
  const liga = ligaClienteAlGuardar({ customerId: 529, branchId: 599 }, {});
  assert.deepStrictEqual(liga, { customerId: 529, branchId: 599, customerIdIgnorado: null });
});

// #409: la contraparte de C6. La liga es fija en cuanto al CLIENTE, no en cuanto
// al domicilio: el mismo Cliente Operam si puede mover su domicilio de entrega al
// editar, y es lo que hace que la eleccion del selector del paso Envio sobreviva
// al guardado. La regla ya estaba escrita asi; lo que faltaba era que el
// navegador mandara el branchId (leerClienteFormulario). Sin este caso, C5 --
// mismo cliente SIN branchId nuevo -- es la unica evidencia y deja leer la regla
// como "el domicilio persistido siempre manda", que es justo lo que no dice.
test('#409-C8: el mismo Cliente Operam SI puede cambiar su domicilio al editar', () => {
  const liga = ligaClienteAlGuardar({ customerId: 527, branchId: 15 }, { customerId: 527, branchId: 564 });
  assert.deepStrictEqual(liga, { customerId: 527, branchId: 15, customerIdIgnorado: null });
});

// === #405: el Representante de Ventas del registro tampoco lo pisa quien edita ===
// La columna es la duena del registro (Historial, pipeline, permisos) y manda.

test('#405-C1: editar un registro existente conserva al vendedor de la columna', () => {
  assert.strictEqual(vendedorAlGuardar({ vendedor: 'Alejandro Chavez' }, 'Adrian Chavez'), 'Alejandro Chavez');
});

test('#405-C2: sin registro previo el vendedor es quien guarda (nueva y Copiar)', () => {
  assert.strictEqual(vendedorAlGuardar(null, 'Adrian Chavez'), 'Adrian Chavez');
});

// Historicos del backfill (#76): el salesman de Operam pudo no mapear a nadie y
// la columna quedo vacia. Ahi el unico rastro del original es lo que el
// documento ya decia; si tampoco lo hay, manda quien guarda (un documento sin
// Representante de Ventas seria peor).
test('#405-C3: con la columna vacia manda el vendedor que ya imprimia el documento', () => {
  assert.strictEqual(vendedorAlGuardar({ vendedor: null, data: { vendedor: 'Oswaldo Chavez' } }, 'Adrian Chavez'),
    'Oswaldo Chavez');
});

test('#405-C4: un registro sin ningun vendedor lo estrena quien guarda', () => {
  assert.strictEqual(vendedorAlGuardar({ vendedor: '  ', data: {} }, 'Adrian Chavez'), 'Adrian Chavez');
});

// === Issue #404: "Cotizaciones previas" tambien es satelite del cliente ===
// HITL de #394 (produccion, 2026-09-20): con JORGE OREA (Cliente Operam 514)
// elegido en el paso Cliente se cargo desde el Historial la cotizacion 1284, de
// ADRIAN CHAVEZ ROSETE (15). La tarjeta paso a Adrian (#394) pero debajo siguio
// "Cotizaciones previas (1): 1 sep - M100 - $20,483.24 - Cotizacion 1254", que
// es de Jorge: la lista es otro satelite del cliente elegido -- como los
// domicilios y los contactos de Operam -- y cargarCotizacion no la volvia a
// pedir, asi que la pantalla afirmaba que la 1254 era previa de Adrian y sus
// botones Editar y Copiar cotizacion abrian la de otro cliente.

const PREVIA_JORGE = {
  id: 611, folioOperam: 1254, fecha: '2026-09-01T18:00:00.000Z', cliente: 'JORGE OREA',
  customerId: 514, rfc: 'OEAJ800101AB1', tier: 'M100', total: 20483.24, hasData: true,
};
const PREVIA_ADRIAN = {
  id: 641, folioOperam: 1284, fecha: '2026-09-20T18:00:00.000Z', cliente: 'ADRIAN CHAVEZ ROSETE',
  customerId: 15, rfc: 'CARA850101XY9', tier: 'M100', total: 5120.5, hasData: true,
};
const COT_ADRIAN = {
  razonSocial: 'ADRIAN CHAVEZ ROSETE', nombreCorto: 'Adrian Chavez', rfc: 'CARA850101XY9',
  telefono: '+52 55 1122 3344', cpEntrega: '56530', pais: 'MX', customerId: 15, branchId: 61,
};
const SESION_JORGE = { tipo: 'operam', id: 514, name: 'JORGE OREA', ref: 'Jorge Orea', rfc: 'OEAJ800101AB1' };

// El cliente que la carga repone (clienteAlCargarCotizacion, #394) es el mismo
// que ya sabe filtrar el panel (cotizacionesPreviasDelCliente, #389): la lista
// de la cotizacion cargada sale de esos dos, sin una regla nueva. Este es el
// contrato del que depende el cableado: si la identidad repuesta dejara de
// llevar el Cliente Operam, el panel volveria a mentir.
test('#404-C1: con Jorge en sesion, cargar la 1284 deja las previas de Adrian y ninguna de Jorge', () => {
  const cliente = clienteAlCargarCotizacion(COT_ADRIAN, SESION_JORGE);
  assert.deepStrictEqual(
    cotizacionesPreviasDelCliente([PREVIA_JORGE, PREVIA_ADRIAN], cliente),
    [PREVIA_ADRIAN],
  );
});

test('#404-C2: una cotizacion que nunca se subio no hereda las previas del cliente de la sesion', () => {
  const nuncaSubida = { ...COT_ADRIAN, customerId: null, branchId: null, rfc: 'XAXX010101000' };
  const cliente = clienteAlCargarCotizacion(nuncaSubida, SESION_JORGE);
  assert.deepStrictEqual(cotizacionesPreviasDelCliente([PREVIA_JORGE, PREVIA_ADRIAN], cliente), []);
});

// El cableado: app.js no es importable en Node (efectos de navegador en scope de
// modulo) y sin DOM no se puede afirmar el repintado, asi que lo que se cuida
// aqui es el fuente -- mismo recurso que #402-1 (calcas-logica.test.cjs) y C16b
// (alta-dedup-fiscal.test.cjs). Que el panel quede vacio en pantalla es HITL.
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

test('#404-C3: cargar del historial vuelve a pedir las previas del cliente repuesto', () => {
  const cuerpo = cuerpoDeFuncion(fuenteApp(), 'async function cargarCotizacion(');
  const repone = cuerpo.indexOf('pcState.cliente = clienteAlCargarCotizacion(');
  assert.ok(repone > 0, 'si la identidad deja de reponerse aqui, este test ya no cuida nada: revisarlo');
  const refresca = cuerpo.indexOf('pcCargarPreviasDelCliente(pcState.cliente)');
  assert.ok(refresca > repone,
    'las previas se piden DESPUES de reponer la identidad, y para el cliente de la cotizacion cargada');
});

test('#404-C4: el paso Cliente y la carga del historial comparten UN camino a las previas', () => {
  const src = fuenteApp();
  assert.ok(cuerpoDeFuncion(src, 'async function seleccionarClienteOperam(').includes('pcCargarPreviasDelCliente('),
    'elegir el cliente a mano pasa por el mismo camino, no por una copia');
  assert.strictEqual((src.match(/cotizacionesPreviasDelCliente\(/g) || []).length, 1,
    'quien decide cuales son SUYAS se llama desde un solo lugar');
  assert.strictEqual((src.match(/renderHistorialCliente\(/g) || []).length, 2,
    'el panel lo pinta su declaracion y un solo llamador');
});

test('#404-C5: el camino apaga el panel del cliente anterior antes de pedir las nuevas', () => {
  const cuerpo = cuerpoDeFuncion(fuenteApp(), 'async function pcCargarPreviasDelCliente(');
  const apaga = cuerpo.indexOf("getElementById('historial-cliente-panel')");
  assert.ok(apaga > 0, 'el camino es dueno del panel');
  assert.ok(cuerpo.includes("display = 'none'") && cuerpo.includes("innerHTML = ''"),
    'un cliente sin previas tiene que dejar el panel vacio, no la lista del anterior');
  assert.ok(apaga < cuerpo.indexOf('cotizacionesPreviasDelCliente('),
    'se apaga antes de pedir el listado: el fetch tarda y mientras tanto no puede quedar lo ajeno');
});

// #432-4: Editar y Copiar del Historial devuelven al cotizador a mano -- esconden el
// Historial y muestran #app-view -- sin pasar por el trio de navegacion de los demas
// "volver a Cotizar", asi que la barra inferior se quedaba marcando "Mas" (desde
// donde se abrio el Historial) con la vista ya en Cotizar. Verlo es HITL.
test('#432-4: cargar del historial marca Cotizar en la barra de navegacion al mostrar el cotizador', () => {
  const cuerpo = cuerpoDeFuncion(fuenteApp(), 'async function cargarCotizacion(');
  const muestra = cuerpo.indexOf("document.getElementById('app-view').style.display = 'block'");
  assert.ok(muestra > 0, 'si cargar deja de mostrar el cotizador aqui, este test ya no cuida nada: revisarlo');
  const marca = cuerpo.indexOf("marcarNavActivo('nav-cotizar')");
  assert.ok(marca > 0, 'la barra tiene que decir la vista a la que se llego: Cotizar, no Mas');
});

// #428: las cotizaciones del backfill (#76) y de los rescates guardan `fecha` =
// `ord_date` de Operam, un dia SIN hora. Casos vistos en produccion el
// 2026-09-22 en el Historial y en "Cotizaciones previas": la 1128 (8 may) se
// pintaba "7 may". La zona se fija dentro de la prueba y se restaura al salir.
function enMexico(fn) {
  const previa = process.env.TZ;
  process.env.TZ = 'America/Mexico_City';
  try {
    return fn();
  } finally {
    if (previa === undefined) delete process.env.TZ;
    else process.env.TZ = previa;
  }
}

const COT_1128 = { id: 28, folioOperam: '1128', fecha: '2026-05-08', cliente: 'Hotel Azul', vendedor: 'Laura', total: 1000, totalPiezas: 10, estado: 'abierta' };

test('#428-H1: el filtro del Historial trata la fecha sin hora como el dia que dice', () => {
  enMexico(() => {
    assert.deepEqual(filtrarCotizaciones([COT_1128], { desde: '2026-05-08' }).map(c => c.folioOperam), ['1128']);
    assert.deepEqual(filtrarCotizaciones([COT_1128], { hasta: '2026-05-07' }), []);
  });
});

test('#428-H2: el tablero del Historial pinta la fecha sin hora en su dia (1128, 1155, 1166)', () => {
  enMexico(() => {
    const hoy = new Date(2026, 6, 1, 12, 0);
    const html = buildTableroCotizacionesHtml([
      COT_1128,
      { ...COT_1128, id: 32, folioOperam: '1155', fecha: '2026-06-15' },
      { ...COT_1128, id: 35, folioOperam: '1166', fecha: '2026-06-29' },
    ], hoy);
    assert.ok(html.includes('8 may 2026'), 'la 1128 dice 8 may');
    assert.ok(html.includes('15 jun 2026'), 'la 1155 dice 15 jun');
    assert.ok(html.includes('29 jun 2026'), 'la 1166 dice 29 jun');
    assert.ok(!html.includes('7 may 2026') && !html.includes('14 jun 2026') && !html.includes('28 jun 2026'),
      'ninguna sale un dia antes');
  });
});

test('#428-H3: "hace N dias" y la columna cuentan desde el dia que dice la tarjeta', () => {
  enMexico(() => {
    // El 10 de mayo a las 20:00 la 1128 (8 may) lleva 2 dias, no 3.
    const html = buildTableroCotizacionesHtml([COT_1128], new Date(2026, 4, 10, 20, 0));
    assert.ok(html.includes('8 may 2026 \u00b7 hace 2 d\u00edas'), 'la tarjeta dice 8 may y hace 2 dias');
    // El 14 de mayo a las 20:00 van 6 dias naturales: todavia no es Dia 7.
    assert.equal(columnaCotizacion(COT_1128, new Date(2026, 4, 14, 20, 0)), 'dia2');
    assert.equal(columnaCotizacion(COT_1128, new Date(2026, 4, 15, 0, 0)), 'dia7');
  });
});

test('#428-H4: una columna ordena por el dia que dice cada tarjeta, no por la medianoche UTC', () => {
  enMexico(() => {
    const sinHora = { ...COT_1128, id: 1 };
    // Las 21:00 del 7 de mayo en Mexico: la tarjeta dice "7 may", va DESPUES de la del 8.
    const conHora = { ...COT_1128, id: 2, fecha: '2026-05-08T03:00:00.000Z' };
    const cols = agruparTableroCotizaciones([conHora, sinHora], new Date(2026, 4, 9, 12, 0));
    assert.deepEqual(cols.reciente.map(c => c.id), [1, 2]);
  });
});

test('#428-H5: una fecha ISO con hora se sigue pintando en su dia local', () => {
  enMexico(() => {
    const html = buildTableroCotizacionesHtml([{ ...COT_1128, fecha: '2026-05-08T02:00:00.000Z' }], new Date(2026, 4, 10, 12, 0));
    assert.ok(html.includes('7 may 2026'), 'las 20:00 del 7 de mayo en Mexico');
  });
});

// #428, el cableado: "Cotizaciones previas" (renderHistorialCliente) y la lista
// del Historial (renderHistorial) pintan en app.js, que no es importable; se
// cuida el fuente con el mismo recurso que #404-C3. Que la fecha que pintan es
// la correcta lo prueban F1-F4 (busqueda-logica.test.cjs) sobre fechaLocal.
test('#428-A1: previas y lista del Historial leen c.fecha con fechaLocal', () => {
  const src = fuenteApp();
  assert.match(src, /import \{[^}]*\bfechaLocal\b[^}]*\} from '\.\/busqueda-logica\.js';/,
    'app.js toma fechaLocal del nucleo, no de una copia');
  for (const firma of ['function renderHistorialCliente(', 'function renderHistorial(']) {
    const cuerpo = cuerpoDeFuncion(src, firma);
    assert.ok(cuerpo.includes('fechaLocal(c.fecha).toLocaleDateString('), `${firma} pinta con fechaLocal`);
  }
});

test('#428-A2: ninguna lista de app.js lee su fecha con new Date', () => {
  assert.deepEqual(fuenteApp().match(/new Date\(\w+\.fecha\b/g) || [], [],
    'una fecha sin hora leida con new Date se pinta, se ordena o se filtra un dia antes');
});

// #428: la ficha de la Tabla de prospectos (/prospectos) lista las cotizaciones
// del prospecto con su fecha; es otro pintor de c.fecha y tampoco es importable.
test('#428-A3: la ficha de la Tabla de prospectos pinta la fecha de sus cotizaciones con fechaLocal', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'prospectos.html'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(html, /import \{[^}]*\bfechaLocal\b[^}]*\} from '\/js\/busqueda-logica\.js';/);
  assert.match(html, /function fechaCorta\(iso\) \{\n  if \(!iso\) return '';\n  return fechaLocal\(iso\)\.toLocaleDateString\(/);
  assert.ok(html.includes('${fechaCorta(c.fecha)}'), 'las cotizaciones de la ficha pasan por fechaCorta');
});

// #428, decision de Adrian (2026-09-25): en produccion la fecha del backfill
// llega como TIMESTAMPTZ serializado ('2026-05-08T00:00:00.000Z'), no como
// '2026-05-08'. Los mismos casos de produccion, con la forma que manda el servidor.
const COT_1128_NEON = { ...COT_1128, fecha: '2026-05-08T00:00:00.000Z' };

test('#428-H6: el Historial pinta y filtra el ISO a medianoche UTC en su dia (1128, 1155, 1166)', () => {
  enMexico(() => {
    const html = buildTableroCotizacionesHtml([
      COT_1128_NEON,
      { ...COT_1128, id: 32, folioOperam: '1155', fecha: '2026-06-15T00:00:00.000Z' },
      { ...COT_1128, id: 35, folioOperam: '1166', fecha: '2026-06-29T00:00:00.000Z' },
    ], new Date(2026, 6, 1, 12, 0));
    assert.ok(html.includes('8 may 2026') && html.includes('15 jun 2026') && html.includes('29 jun 2026'));
    assert.ok(!html.includes('7 may 2026') && !html.includes('14 jun 2026') && !html.includes('28 jun 2026'),
      'ninguna sale un dia antes');
    assert.deepEqual(filtrarCotizaciones([COT_1128_NEON], { desde: '2026-05-08' }).map(c => c.folioOperam), ['1128']);
    assert.deepEqual(filtrarCotizaciones([COT_1128_NEON], { hasta: '2026-05-07' }), []);
    assert.ok(buildTableroCotizacionesHtml([COT_1128_NEON], new Date(2026, 4, 10, 20, 0))
      .includes('8 may 2026 \u00b7 hace 2 d\u00edas'), 'hace N dias cuenta desde el 8');
  });
});
