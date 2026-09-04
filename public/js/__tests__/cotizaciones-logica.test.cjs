'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let COLUMNAS_COTIZACIONES, columnaCotizacion, agruparTableroCotizaciones,
  puedeArrastrarCotizacion, buildTableroCotizacionesHtml,
  buildHistorialAccionesHtml, buildWhatsAppLinkHistorial,
  puedeActualizarCotizacion, buildAccionesCargaHtml,
  buildAvisoModoActualizacion, textoBotonGenerar, filtrarCotizaciones;
before(async () => {
  ({ COLUMNAS_COTIZACIONES, columnaCotizacion, agruparTableroCotizaciones,
    puedeArrastrarCotizacion, buildTableroCotizacionesHtml,
    buildHistorialAccionesHtml, buildWhatsAppLinkHistorial,
    puedeActualizarCotizacion, buildAccionesCargaHtml,
    buildAvisoModoActualizacion, textoBotonGenerar,
    filtrarCotizaciones } = await import('../cotizaciones-logica.js'));
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

// El PRE por fallo de Operam (motivoPre 'operam') NO bloquea: el documento es
// legitimo y sale sin numero, que es justo lo que ADR-0009 decidio.
test('Q18c: buildHistorialAccionesHtml no bloquea el PRE por fallo de Operam', () => {
  const html = buildHistorialAccionesHtml(cot(3, { id: 42, hasData: true, motivoPre: 'operam' }));
  assert.ok(html.includes('href="/api/cotizacion/pdf/42"'));
  assert.ok(html.includes('href="/api/cotizacion/html/42"'));
});

// #307: el texto del Resumen de la cotizacion lo arma UN solo lugar
// (resumen-cotizacion-logica.js) y el historial es una envoltura sobre el, para
// que compartir desde aqui y desde la cotizacion recien generada diga lo mismo.
test('Q19: buildWhatsAppLinkHistorial delega en el nucleo del Resumen de la cotizacion', async () => {
  const { mensajeCotizacion } = await import('../resumen-cotizacion-logica.js');
  const c = cot(3, { id: 42, cliente: 'Hotel Azul', total: 12345.5 });
  assert.equal(
    buildWhatsAppLinkHistorial(c, 'https://cotizador.example'),
    mensajeCotizacion(c, 'https://cotizador.example').waUrl
  );
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

test('Q42: filtrarCotizaciones matchea por vendedor (util para admin, que ve todas)', () => {
  const lista = [
    cot(1, { id: 1, cliente: 'Hotel Azul', vendedor: 'Laura' }),
    cot(2, { id: 2, cliente: 'Panaderia Lopez', vendedor: 'Marco' }),
  ];
  assert.deepEqual(filtrarCotizaciones(lista, { texto: 'laura' }).map(c => c.id), [1]);
  assert.deepEqual(filtrarCotizaciones(lista, { texto: 'MARCO' }).map(c => c.id), [2]);
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

// Bug real encontrado verificando en navegador (Mexico_City, UTC-6): una
// cotizacion guardada como '2026-08-13' (fecha sin hora, ISO la interpreta
// como medianoche UTC) se pinta en la tarjeta como "12 ago" porque
// fechaCorta/toLocaleDateString usan hora local. Comparar contra el dia UTC
// (como los scripts de backend) la dejaba visible al filtrar "Desde 13 ago",
// contradiciendo lo que la tarjeta decia. filtrarCotizaciones solo corre en
// el navegador (nunca en server.js), asi que compara contra el dia LOCAL,
// igual que lo que ve el vendedor en pantalla.
test('Q49: filtrarCotizaciones compara el rango contra el dia LOCAL de c.fecha, no el dia UTC (borde de zona horaria)', () => {
  const lista = [
    // medianoche UTC del 13: en Mexico_City (UTC-6) cae en la tarde del 12
    cot(0, { id: 1, fecha: '2026-08-13' }),
  ];
  assert.deepEqual(filtrarCotizaciones(lista, { desde: '2026-08-13' }), []);
  assert.deepEqual(filtrarCotizaciones(lista, { hasta: '2026-08-12' }).map(c => c.id), [1]);
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
