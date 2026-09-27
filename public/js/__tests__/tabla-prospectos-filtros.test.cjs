'use strict';
// #458 (spec #398, hijo 3): los nueve filtros de la Tabla de prospectos --
// Evento, Origen, Vendedor, Tipo de cliente, Area de interes, Gafete, Estado del
// prospecto, Pendientes y la busqueda -- escritos contra el comportamiento
// VIGENTE antes de mover el codigo de la pagina (corrieron en verde contra las
// funciones que vivian inline en prospectos.html) y que siguen en verde sobre el
// nucleo compartido. Las filas tienen la forma que entrega
// GET /api/prospectos/tabla (filaTabla de lib/tabla-prospectos.js).
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
let filtrarTablaProspectos, BUSCABLES_TABLA_PROSPECTO, CANALES, buildFiltrosSelectorHtml;
before(async () => {
  ({ filtrarTablaProspectos, BUSCABLES_TABLA_PROSPECTO, CANALES } = await import('../prospectos-logica.js'));
  ({ buildFiltrosSelectorHtml } = await import('../filtros-logica.js'));
});
const filtrar = (filas, criterio) => filtrarTablaProspectos(filas, criterio);

const FILAS = [
  { id: 1, nombre: 'Mariana L\u00f3pez', ciudad: 'Puebla', celular: '+52 55 1234 5678', vendedor: 'Laura',
    origen: 'Instagram', estado: 'sin_contactar', gafete: 'solo_gafete', queFalta: ['calificacion', 'correo'],
    data: { evento: 'Abastur 2026', tipo_cliente: 'Restaurante', area_interes: 'Alimentos; Cristaler\u00eda - Vajillas',
      empresa: 'Hotel Azul', puesto: 'Gerente de compras' } },
  { id: 2, nombre: 'Beto Ruiz', ciudad: 'M\u00e9rida', celular: '9981234567', vendedor: 'Memo',
    origen: 'WhatsApp', estado: 'contactado', gafete: 'sin_gafete', queFalta: [],
    data: { empresa: 'Panaderia Sol' } },
  { id: 3, nombre: 'Sofia Paz', ciudad: 'Monterrey', celular: '8112223344', vendedor: 'Laura',
    origen: 'Feria/Expo', estado: 'agendado', gafete: 'gafete_y_stand', queFalta: ['correo'],
    data: { evento: 'Abastur 2026', tipo_cliente: 'Hotel', area_interes: 'Cristaler\u00eda - Vajillas',
      empresa: 'Grupo Norte', puesto: 'Chef' } },
  { id: 4, nombre: 'Luis Gomez', ciudad: 'Leon', celular: '4771112233', vendedor: 'Memo',
    origen: 'Feria/Expo', estado: 'cotizado', gafete: 'solo_gafete', queFalta: [],
    data: { evento: 'Expo Hotelera', tipo_cliente: 'Restaurante', area_interes: 'Alimentos', empresa: 'Fonda Luis' } },
  // Sin `data`: el prospecto capturado a mano sin empresa ni expo.
  { id: 5, nombre: 'Ana Rios', ciudad: 'Toluca', celular: '7221234567', vendedor: 'Laura',
    origen: 'Referido', estado: 'cliente', gafete: 'sin_gafete', queFalta: [] },
];

const ids = criterio => filtrar(FILAS, criterio).map(p => p.id);

test('TF1: sin ningun filtro ni texto la tabla muestra todas las filas', () => {
  assert.deepEqual(ids({}), [1, 2, 3, 4, 5]);
  assert.deepEqual(ids({ texto: '', filtros: { evento: '', vendedor: '' } }), [1, 2, 3, 4, 5]);
});

test('TF2: Evento deja solo los prospectos de esa expo', () => {
  assert.deepEqual(ids({ filtros: { evento: 'Abastur 2026' } }), [1, 3]);
  assert.deepEqual(ids({ filtros: { evento: 'Expo Hotelera' } }), [4]);
});

test('TF3: Origen filtra por el origen resuelto de la fila', () => {
  assert.deepEqual(ids({ filtros: { origen: 'Feria/Expo' } }), [3, 4]);
  assert.deepEqual(ids({ filtros: { origen: 'Correo' } }), []);
});

test('TF4: Vendedor deja solo los prospectos de esa persona', () => {
  assert.deepEqual(ids({ filtros: { vendedor: 'Memo' } }), [2, 4]);
});

test('TF5: Tipo de cliente filtra por el tipo capturado en la expo', () => {
  assert.deepEqual(ids({ filtros: { tipo: 'Restaurante' } }), [1, 4]);
  assert.deepEqual(ids({ filtros: { tipo: 'Hotel' } }), [3]);
});

test('TF6: Area de interes casa por valor suelto de la lista separada por punto y coma', () => {
  assert.deepEqual(ids({ filtros: { area: 'Alimentos' } }), [1, 4]);
  assert.deepEqual(ids({ filtros: { area: 'Cristaler\u00eda - Vajillas' } }), [1, 3]);
  assert.deepEqual(ids({ filtros: { area: 'Alim' } }), [], 'un pedazo del valor no casa');
});

test('TF7: Gafete deja solo los de ese escalon', () => {
  assert.deepEqual(ids({ filtros: { gafete: 'solo_gafete' } }), [1, 4]);
  assert.deepEqual(ids({ filtros: { gafete: 'sin_gafete' } }), [2, 5]);
});

test('TF8: Estado del prospecto deja solo los de ese escalon', () => {
  assert.deepEqual(ids({ filtros: { estado: 'agendado' } }), [3]);
  assert.deepEqual(ids({ filtros: { estado: 'cliente' } }), [5]);
});

test('TF9: Pendientes separa a los que tienen algo en Que falta de los que no', () => {
  assert.deepEqual(ids({ filtros: { pendientes: 'con' } }), [1, 3]);
  assert.deepEqual(ids({ filtros: { pendientes: 'sin' } }), [2, 4, 5]);
});

test('TF10: los filtros se combinan con AND entre si y con la busqueda', () => {
  assert.deepEqual(ids({ filtros: { evento: 'Abastur 2026', tipo: 'Hotel' } }), [3]);
  assert.deepEqual(ids({ filtros: { evento: 'Abastur 2026', vendedor: 'Laura', pendientes: 'sin' } }), []);
  assert.deepEqual(ids({ texto: 'fonda', filtros: { vendedor: 'Memo' } }), [4]);
  assert.deepEqual(ids({ texto: 'fonda', filtros: { vendedor: 'Laura' } }), []);
});

test('TF11: un filtro sobre un campo que la fila no trae no casa y no rompe', () => {
  assert.deepEqual(ids({ filtros: { evento: 'Abastur 2026', vendedor: 'Laura' } }), [1, 3]);
  assert.deepEqual(ids({ filtros: { area: 'Alimentos', estado: 'cliente' } }), []);
});

test('TB1: la busqueda encuentra por nombre, empresa y ciudad sin importar mayusculas', () => {
  assert.deepEqual(ids({ texto: 'mariana' }), [1]);
  assert.deepEqual(ids({ texto: 'GRUPO NORTE' }), [3]);
  assert.deepEqual(ids({ texto: 'puebla' }), [1]);
  assert.deepEqual(ids({ texto: '  toluca  ' }), [5]);
});

test('TB2: la busqueda no encuentra por vendedor ni por Origen (van en selector)', () => {
  assert.deepEqual(ids({ texto: 'memo' }), []);
  assert.deepEqual(ids({ texto: 'instagram' }), []);
});

// Cambio de semantica ACEPTADO por Adrian (2026-09-25, #458): la busqueda de la
// tabla adopta la del nucleo compartido -- gana normalizacion de acentos y
// digitos del celular, y pierde el puesto. Antes: 'chef' encontraba a Sofia,
// 'merida' y '998123' no encontraban a nadie.
test('TB3: la busqueda ya no encuentra por puesto', () => {
  assert.deepEqual(ids({ texto: 'chef' }), []);
  assert.deepEqual(ids({ texto: 'gerente de compras' }), []);
});

test('TB4: la busqueda ignora los acentos de los dos lados', () => {
  assert.deepEqual(ids({ texto: 'merida' }), [2]);
  assert.deepEqual(ids({ texto: 'lopez' }), [1]);
  assert.deepEqual(ids({ texto: 'L\u00d3PEZ' }), [1]);
});

test('TB5: la busqueda encuentra por digitos del celular, con o sin espacios', () => {
  assert.deepEqual(ids({ texto: '1234 5678' }), [1]);
  assert.deepEqual(ids({ texto: '998123' }), [2]);
});

// La rejilla de la tabla es la compartida (#456): la pagina ya no arma sus
// selectores a mano.
function selectores(html) {
  return [...html.matchAll(/data-filtro="([^"]+)">([\s\S]*?)<\/select>/g)].map(m => ({
    campo: m[1],
    opciones: [...m[2].matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map(o => [o[1], o[2]]),
  }));
}
const rejilla = filas => selectores(buildFiltrosSelectorHtml(filas, BUSCABLES_TABLA_PROSPECTO.filtros, {}, 'leads'));

test('TR1: la rejilla pinta los ocho selectores en el orden de la tabla', () => {
  assert.deepEqual(rejilla(FILAS).map(s => s.campo),
    ['evento', 'origen', 'vendedor', 'tipo', 'area', 'gafete', 'estado', 'pendientes']);
  const html = buildFiltrosSelectorHtml(FILAS, BUSCABLES_TABLA_PROSPECTO.filtros, {}, 'leads');
  assert.deepEqual([...html.matchAll(/<label [^>]*>([^<]*)<\/label>/g)].map(m => m[1]),
    ['Evento', 'Origen', 'Vendedor', 'Tipo de cliente', '\u00c1rea de inter\u00e9s', 'Gafete', 'Estado', 'Pendientes']);
});

test('TR2: Vendedor se oculta con una sola persona a la vista; Evento, Tipo y Area se pintan con una sola opcion', () => {
  // Sofia sola: una persona, una expo, un tipo y un area.
  const campos = rejilla(FILAS.filter(p => p.id === 3)).map(s => s.campo);
  assert.deepEqual(campos, ['evento', 'origen', 'tipo', 'area', 'gafete', 'estado', 'pendientes']);
});

test('TR3: las opciones de cada selector', () => {
  const porCampo = Object.fromEntries(rejilla(FILAS).map(s => [s.campo, s.opciones]));
  assert.deepEqual(porCampo.evento, [['', 'Todos'], ['Abastur 2026', 'Abastur 2026'], ['Expo Hotelera', 'Expo Hotelera']]);
  assert.deepEqual(porCampo.origen.map(o => o[1]), ['Todos', ...CANALES]);
  assert.deepEqual(porCampo.vendedor, [['', 'Todos'], ['Laura', 'Laura'], ['Memo', 'Memo']]);
  assert.deepEqual(porCampo.tipo, [['', 'Todos'], ['Hotel', 'Hotel'], ['Restaurante', 'Restaurante']]);
  assert.deepEqual(porCampo.area, [['', 'Todos'], ['Alimentos', 'Alimentos'],
    ['Cristaler\u00eda - Vajillas', 'Cristaler\u00eda - Vajillas']]);
  assert.deepEqual(porCampo.gafete, [['', 'Todos'], ['solo_gafete', 'Solo gafete'],
    ['gafete_y_stand', 'Gafete + stand'], ['sin_gafete', 'Sin gafete']]);
  assert.deepEqual(porCampo.estado, [['', 'Todos'], ['sin_contactar', 'Sin contactar'], ['contactado', 'Contactado'],
    ['agendado', 'Agendado'], ['cotizado', 'Cotizado'], ['cliente', 'Cliente Operam']]);
  assert.deepEqual(porCampo.pendientes, [['', 'Todos'], ['con', 'Con pendientes'], ['sin', 'Sin pendientes']]);
});

// La pagina no es importable (efectos de navegador): se afirma sobre su fuente,
// como #428-A3. Lo que importa es que ya no quede una segunda implementacion
// de filtrado ni de rejilla dentro de ella.
test('TP1: prospectos.html filtra con el nucleo y pinta la rejilla compartida, sin codigo propio', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'prospectos.html'), 'utf8').replace(/\r\n/g, '\n');
  const importDe = modulo => { const fin = html.indexOf(`from '/js/${modulo}';`); return fin < 0 ? '' : html.slice(html.lastIndexOf('import {', fin), fin); };
  assert.ok(importDe('prospectos-logica.js').includes('filtrarTablaProspectos'));
  assert.ok(importDe('prospectos-logica.js').includes('BUSCABLES_TABLA_PROSPECTO'));
  assert.ok(importDe('filtros-logica.js').includes('buildFiltrosSelectorHtml'));
  for (const propio of ['function filtrados', 'function poblarFiltros', 'function opciones(', 'function unicos(',
    'function areasDe', '_busqueda', '_areas', '.includes(texto)']) {
    assert.ok(!html.includes(propio), `la pagina ya no define ${propio}`);
  }
  assert.ok(!html.includes('<select id="f-'), 'los selectores ya no son estaticos: los pinta la rejilla');
  assert.ok(html.includes('placeholder="nombre, empresa, ciudad, celular"'), 'la caja dice lo que busca');
});
