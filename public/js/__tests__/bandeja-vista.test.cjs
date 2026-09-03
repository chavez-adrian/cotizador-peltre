'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

// Logica pura de la bandeja de revision "Rescatados de Operam" (issue #122):
// filtros, orden y HTML de las tarjetas a partir de los candidatos. Modulo sin
// efectos de navegador (mismo patron que pipeline-logica / alta-logica); app.js
// lo importa nativo y aqui se consume via import() dinamico. Sin DOM en Node.

let candidatosVisibles, conteosBandeja, marcasDeCandidato,
  buildFiltrosBandejaHtml, buildTarjetaBandejaHtml, buildBandejaHtml,
  buildBotonBuscarNuevasHtml, buildResultadoBuscarNuevasHtml;

before(async () => {
  ({
    candidatosVisibles, conteosBandeja, marcasDeCandidato,
    buildFiltrosBandejaHtml, buildTarjetaBandejaHtml, buildBandejaHtml,
    buildBotonBuscarNuevasHtml, buildResultadoBuscarNuevasHtml,
  } = await import('../bandeja-logica.js'));
});

const VENDEDORES = [
  { id: 2, name: 'Alejandro Chávez' },
  { id: 3, name: 'Oswaldo Chávez' },
];

const PENDIENTE = {
  folio: '934', tipo: 'prospecto', estado: 'pendiente',
  fecha: '2026-07-21T00:00:00.000Z',
  contacto: 'Mariana Gutiérrez Solís', celular: '+52 55 2314 8890',
  email: 'mariana.gs@hotmail.com', proyecto: 'Hotel Boutique Valle',
  domicilio: 'Av. de los Insurgentes 1420, CDMX',
  monto: 48250, debtorId: 184, debtorNombre: 'GENERICO TIENDAS DIGITALES',
  debtorGenerico: true,
  vendedor: 'Alejandro Chávez',
  marcas: { comproOtraCosa: false, posibleDuplicado: false },
  prospectoId: null, cotizacionId: null,
};

// Candidato tipo cotizacion de un cliente REAL (issue #125): es el unico que puede
// entrar al pipeline como oportunidad. El del cajon generico (PENDIENTE) no.
const COTIZACION = {
  ...PENDIENTE, tipo: 'cotizacion',
  debtorId: 512, debtorNombre: 'HOTELES DEL VALLE SA DE CV', debtorGenerico: false,
};

// === Filtros y orden ===

test('F1: el filtro por estado deja pasar solo ese estado; "todos" deja pasar todo', () => {
  const candidatos = [
    { ...PENDIENTE, folio: '1', estado: 'pendiente' },
    { ...PENDIENTE, folio: '2', estado: 'aceptado' },
    { ...PENDIENTE, folio: '3', estado: 'descartado' },
  ];
  assert.deepEqual(candidatosVisibles(candidatos, 'pendiente').map(c => c.folio), ['1']);
  assert.deepEqual(candidatosVisibles(candidatos, 'aceptado').map(c => c.folio), ['2']);
  assert.deepEqual(candidatosVisibles(candidatos, 'descartado').map(c => c.folio), ['3']);
  assert.equal(candidatosVisibles(candidatos, 'todos').length, 3);
});

test('F2: los visibles salen del quote mas reciente al mas viejo', () => {
  const candidatos = [
    { ...PENDIENTE, folio: '902', fecha: '2026-06-28T00:00:00.000Z' },
    { ...PENDIENTE, folio: '934', fecha: '2026-07-21T00:00:00.000Z' },
    { ...PENDIENTE, folio: '921', fecha: '2026-07-14T00:00:00.000Z' },
  ];
  assert.deepEqual(candidatosVisibles(candidatos, 'pendiente').map(c => c.folio), ['934', '921', '902']);
});

test('F3: el conteo por estado no depende del filtro activo', () => {
  const candidatos = [
    { ...PENDIENTE, folio: '1', estado: 'pendiente' },
    { ...PENDIENTE, folio: '2', estado: 'pendiente' },
    { ...PENDIENTE, folio: '3', estado: 'aceptado' },
    { ...PENDIENTE, folio: '4', estado: 'descartado' },
  ];
  assert.deepEqual(conteosBandeja(candidatos), { pendiente: 2, aceptado: 1, descartado: 1, todos: 4 });
});

test('F4: los botones de filtro llevan su conteo y solo el activo va en primario', () => {
  const html = buildFiltrosBandejaHtml([{ ...PENDIENTE }], 'pendiente');
  assert.match(html, /Pendientes \(1\)/);
  assert.match(html, /Aceptados \(0\)/);
  assert.match(html, /Descartados \(0\)/);
  assert.match(html, /bandejaFiltro\('aceptado'\)/);
  // el activo es el unico primario
  assert.equal((html.match(/btn-primary/g) || []).length, 1);
  const activo = html.slice(html.indexOf('btn-primary'));
  assert.match(activo, /^btn-primary[^<]*Pendientes/);
});

// === Marcas ===

test('M1: las marcas del candidato se derivan de sus banderas', () => {
  assert.deepEqual(marcasDeCandidato({ ...PENDIENTE, marcas: { comproOtraCosa: true, posibleDuplicado: false } }), ['compro-otra']);
  assert.deepEqual(marcasDeCandidato({ ...PENDIENTE, marcas: { comproOtraCosa: false, posibleDuplicado: true } }), ['dup']);
  assert.deepEqual(marcasDeCandidato(PENDIENTE), []);
});

test('M2: un candidato sin celular se marca "sin celular" aunque no traiga banderas', () => {
  assert.deepEqual(marcasDeCandidato({ ...PENDIENTE, celular: '' }), ['sin-cel']);
});

// === Tarjeta ===

test('T1: la tarjeta pendiente muestra folio de Operam, datos del quote y las acciones', () => {
  const html = buildTarjetaBandejaHtml(PENDIENTE, VENDEDORES);
  assert.match(html, /#Operam 934/);
  assert.ok(!html.includes('PRE'), 'un candidato de la bandeja nunca es PRE');
  assert.match(html, /Mariana Gutiérrez Solís/);
  assert.match(html, /\+52 55 2314 8890/);
  assert.match(html, /mariana\.gs@hotmail\.com/);
  assert.match(html, /Hotel Boutique Valle/);
  assert.match(html, /Av\. de los Insurgentes 1420, CDMX/);
  assert.match(html, /GENERICO TIENDAS DIGITALES/);
  assert.match(html, /\$48,250\.00/);
  assert.match(html, /21\/jul\/2026/);
  assert.match(html, /bandejaAceptar\('934'\)/);
  assert.match(html, /bandejaDescartar\('934'\)/);
  assert.match(html, /badge-tipo-prospecto/);
});

test('T2: el vendedor propuesto viene seleccionado y el select ofrece el catalogo', () => {
  const html = buildTarjetaBandejaHtml(PENDIENTE, VENDEDORES);
  assert.match(html, /bandejaSetVendedor\('934', this\.value\)/);
  assert.match(html, /<option value="Alejandro Chávez" selected>Alejandro Chávez<\/option>/);
  assert.match(html, /<option value="Oswaldo Chávez">Oswaldo Chávez<\/option>/);
});

test('T3: un candidato tipo cotizacion de cliente real ofrece aceptarlo como cotizacion', () => {
  const html = buildTarjetaBandejaHtml(COTIZACION, VENDEDORES);
  assert.match(html, /badge-tipo-cotizacion/);
  assert.match(html, /bandejaAceptarCotizacion\('934'\)/);
  assert.ok(!html.includes('bandejaAceptar('), 'el camino prospecto no aplica a una cotizacion');
  // descartar si sigue disponible
  assert.match(html, /bandejaDescartar\('934'\)/);
});

// El debtor generico agrupa a muchos contactos: su quote se rescata como prospecto
// (#124), nunca como cotizacion (el sync cerraria en masa las tarjetas del cajon).
test('T3b: un candidato tipo cotizacion de debtor generico no se puede aceptar, y dice por que', () => {
  const html = buildTarjetaBandejaHtml({ ...PENDIENTE, tipo: 'cotizacion' }, VENDEDORES);
  assert.ok(!html.includes('bandejaAceptarCotizacion('), 'el boton no debe disparar nada');
  assert.match(html, /disabled/);
  assert.match(html, /genérico/i);
  assert.match(html, /bandejaDescartar\('934'\)/);
});

test('T4: un candidato aceptado muestra el resultado y ya no ofrece acciones', () => {
  const html = buildTarjetaBandejaHtml({ ...PENDIENTE, estado: 'aceptado', vendedor: 'Oswaldo Chávez', prospectoId: 41 }, VENDEDORES);
  assert.match(html, /bandeja-card-aceptada/);
  assert.match(html, /Oswaldo Chávez/);
  assert.match(html, /Aceptado &mdash; prospecto creado/);
  assert.ok(!html.includes('bandejaAceptar('), 'sin boton de aceptar');
  assert.ok(!html.includes('bandejaDescartar('), 'sin boton de descartar');
  assert.ok(!html.includes('bandejaSetVendedor('), 'sin selector de vendedor');
});

test('T4b: una cotizacion aceptada nombra la oportunidad creada con su folio de Operam', () => {
  const html = buildTarjetaBandejaHtml({ ...COTIZACION, estado: 'aceptado', vendedor: 'Oswaldo Chávez', cotizacionId: 308 }, VENDEDORES);
  assert.match(html, /bandeja-card-aceptada/);
  // el folio SIEMPRE con la convencion #Operam N (#63), nunca el id interno
  assert.match(html, /Aceptado &mdash; cotización #Operam 934 creada/);
  assert.ok(!html.includes('308'), 'el id interno del registro no se presenta como numero');
  assert.match(html, /Oswaldo Chávez/);
  assert.ok(!html.includes('bandejaAceptarCotizacion('), 'sin boton de aceptar');
});

test('T5: un candidato descartado se ve apagado, sin acciones y sin promesa de volver', () => {
  const html = buildTarjetaBandejaHtml({ ...PENDIENTE, estado: 'descartado' }, VENDEDORES);
  assert.match(html, /bandeja-card-descartada/);
  assert.ok(!html.includes('bandejaAceptar('), 'sin boton de aceptar');
  assert.ok(!html.includes('bandejaDescartar('), 'sin boton de descartar');
});

test('T6: los datos del candidato se escapan (vienen de Operam, no del cotizador)', () => {
  const html = buildTarjetaBandejaHtml({ ...PENDIENTE, contacto: '<img src=x onerror=alert(1)>' }, VENDEDORES);
  assert.ok(!html.includes('<img src=x'), 'el HTML del contacto no se inyecta');
  assert.match(html, /&lt;img src=x/);
});

test('T7: los huecos del quote se ven como hueco, no como texto vacio', () => {
  const html = buildTarjetaBandejaHtml({ ...PENDIENTE, celular: '', email: '', proyecto: '', domicilio: '' }, VENDEDORES);
  assert.equal((html.match(/&mdash;/g) || []).length, 4);
});

test('T8: si el vendedor propuesto no esta en el catalogo, el selector abre sin eleccion', () => {
  // Mostrador (operam_id 7) no esta en el catalogo del cotizador: el select no
  // puede mostrar a otro vendedor como si fuera el propuesto.
  const html = buildTarjetaBandejaHtml({ ...PENDIENTE, vendedor: 'Mostrador' }, VENDEDORES);
  assert.match(html, /<option value="" selected>Elegir vendedor<\/option>/);
  assert.ok(!html.includes('Chávez" selected'), 'ningun vendedor del catalogo queda preseleccionado');
});

// === Vista completa ===

test('V1: la vista arma la barra de filtros y una tarjeta por candidato visible', () => {
  const candidatos = [
    { ...PENDIENTE, folio: '934' },
    { ...PENDIENTE, folio: '921', fecha: '2026-07-14T00:00:00.000Z' },
    { ...PENDIENTE, folio: '881', estado: 'descartado' },
  ];
  const html = buildBandejaHtml(candidatos, 'pendiente', VENDEDORES);
  assert.match(html, /bandeja-toolbar/);
  assert.match(html, /Pendientes \(2\)/);
  assert.equal((html.match(/bandeja-datos/g) || []).length, 2);
  assert.match(html, /#Operam 934/);
  assert.match(html, /#Operam 921/);
  assert.ok(!html.includes('#Operam 881'), 'el descartado no entra en el filtro Pendientes');
});

test('V2: sin candidatos visibles la vista lo dice, sin tarjetas vacias', () => {
  const html = buildBandejaHtml([{ ...PENDIENTE, estado: 'aceptado' }], 'pendiente', VENDEDORES);
  assert.match(html, /empty-state/);
  assert.ok(!html.includes('bandeja-datos'), 'no se pinta ninguna tarjeta');
  // los filtros siguen visibles para poder cambiar de estado
  assert.match(html, /Aceptados \(1\)/);
});

// === Boton "Buscar nuevas en Operam" (issue #126) ===

test('B1: el boton habilitado dispara bandejaBuscarNuevas', () => {
  const html = buildBotonBuscarNuevasHtml(false);
  assert.match(html, /onclick="bandejaBuscarNuevas\(\)"/);
  assert.ok(!html.includes('disabled'), 'ya no llega deshabilitado con el aviso de #126');
});

test('B2: el boton ocupado se deshabilita y cambia el texto', () => {
  const html = buildBotonBuscarNuevasHtml(true);
  assert.match(html, /disabled/);
  assert.match(html, /Buscando/);
  assert.ok(!html.includes('onclick='), 'ocupado no dispara una segunda corrida');
});

test('B3: sin resultado previo no se pinta nada', () => {
  assert.equal(buildResultadoBuscarNuevasHtml(null), '');
  assert.equal(buildResultadoBuscarNuevasHtml(undefined), '');
});

test('B4: el resultado con candidatos nuevos y saltos muestra ambos', () => {
  const html = buildResultadoBuscarNuevasHtml({
    nuevos: 3, saltados: { yaExiste: 0, yaEnBandeja: 2, cancelado: 0, cerro: 1 },
  });
  assert.match(html, /3 candidatos nuevos/);
  assert.match(html, /yaEnBandeja: 2/);
  assert.match(html, /cerro: 1/);
  assert.ok(!html.includes('yaExiste'), 'los motivos en cero no se listan');
});

test('B5: sin candidatos nuevos lo dice claro, incluso sin saltos', () => {
  const html = buildResultadoBuscarNuevasHtml({ nuevos: 0, saltados: {} });
  assert.match(html, /sin candidatos nuevos/);
});

test('B6: la vista completa recibe el estado de la busqueda y lo pinta junto al boton', () => {
  const htmlOcupado = buildBandejaHtml([], 'pendiente', VENDEDORES, { ocupado: true });
  assert.match(htmlOcupado, /Buscando/);

  const htmlConResultado = buildBandejaHtml([], 'pendiente', VENDEDORES, {
    resultado: { nuevos: 1, saltados: {} },
  });
  assert.match(htmlConResultado, /1 candidato nuevo\b/);

  // sin busqueda (compatibilidad con el caller que aun no la pasa): el boton
  // sale habilitado y sin resultado, no truena.
  const htmlSinBusqueda = buildBandejaHtml([], 'pendiente', VENDEDORES);
  assert.match(htmlSinBusqueda, /onclick="bandejaBuscarNuevas\(\)"/);
});

// --- Buscador de Rescatados (#289): el mismo control del Historial, combinado
// con AND con el filtro por estado. La fecha que acota es la del quote. ---

const OTRO_PENDIENTE = {
  ...PENDIENTE, folio: '940', fecha: '2026-08-02T00:00:00.000Z',
  contacto: 'Beto Ruiz', celular: '+52 998 123 4567',
  debtorNombre: 'PANADERIA SOL', vendedor: 'Oswaldo Chávez',
};

test('#289: candidatosVisibles combina el filtro por estado con el criterio de busqueda', () => {
  const candidatos = [PENDIENTE, OTRO_PENDIENTE, { ...PENDIENTE, folio: '901', estado: 'descartado' }];
  const folios = criterio => candidatosVisibles(candidatos, 'pendiente', criterio).map(c => c.folio);
  assert.deepEqual(folios({}), ['940', '934']);
  assert.deepEqual(folios({ texto: 'mariana' }), ['934']);
  assert.deepEqual(folios({ texto: 'panaderia' }), ['940']);
  assert.deepEqual(folios({ texto: 'oswaldo' }), ['940']);
  assert.deepEqual(folios({ texto: '934' }), ['934']);
  assert.deepEqual(folios({ texto: '99812' }), ['940']);
  // El estado sigue mandando: el descartado no vuelve por matchear el texto.
  assert.deepEqual(candidatosVisibles(candidatos, 'pendiente', { texto: '901' }), []);
  assert.deepEqual(candidatosVisibles(candidatos, 'todos', { texto: '901' }).map(c => c.folio), ['901']);
});

// La fecha del quote es la del documento en Operam: la tarjeta la pinta sin
// pasar por Date (fmtFecha) porque convertirla a hora local la correria un dia
// en husos negativos. El filtro tiene que acotar por ESE mismo dia.
test('#289: el rango acota por el dia del quote, el mismo que pinta la tarjeta', () => {
  const candidatos = [PENDIENTE, OTRO_PENDIENTE];
  const folios = criterio => candidatosVisibles(candidatos, 'pendiente', criterio).map(c => c.folio);
  assert.deepEqual(folios({ desde: '2026-07-21' }), ['940', '934']);
  assert.deepEqual(folios({ desde: '2026-07-22' }), ['940']);
  assert.deepEqual(folios({ hasta: '2026-07-21' }), ['934']);
  assert.deepEqual(folios({ texto: 'mariana', desde: '2026-08-01' }), []);
});

test('#289: buildBandejaHtml pinta solo los candidatos que pasan el criterio', () => {
  const html = buildBandejaHtml([PENDIENTE, OTRO_PENDIENTE], 'pendiente', VENDEDORES, {}, { texto: 'beto' });
  assert.match(html, /Beto Ruiz/);
  assert.equal(html.includes('Mariana Gutiérrez Solís'), false);
  // Los conteos de los filtros por estado siguen contando TODO: son el estado
  // de la bandeja, no el resultado de la busqueda.
  assert.match(html, /Pendientes \(2\)/);
});
