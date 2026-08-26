import { test } from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { importarProspectosFeria, normalizarCelularFeria, fechaDeSerialExcel, matchVendedorExpositor } from '../lib/importar-prospectos.js';

// Fixture con las columnas EXACTAS del export real de Abastur (hoja "Contacts",
// segunda hoja "incl. duplicates" que se ignora). Datos anonimizados: el archivo
// real NUNCA entra al repo (datos personales).

const HEADERS = ['First name', 'Last name', 'Job title', 'Company', 'Email', 'Mobile phone',
  'City', 'State', 'Country', 'Actividad principal de la empresa (es)', 'Puesto (es)',
  'Tamaño de la empresa (es)', 'Decisión de compra (es)', 'Scoring', 'Note',
  'Exhibitor member (first connection)', 'First connection date'];

// 45916.48055555556 = 16/09/2025 11:32:00 en el serial de Excel (epoca 1899-12-30).
const SERIAL = 45916.48055555556;

function fila(o = {}) {
  return [
    o.nombre ?? 'OMAR',
    o.apellido ?? 'OLVERA',
    o.jobTitle ?? '',
    o.empresa ?? 'VIANDA CONSULTORES',
    o.correo ?? 'omar@vianda.mx',
    o.celular ?? '+52 55 1242 1575',
    o.ciudad ?? 'HUIXQUILUCAN',
    o.estado ?? 'MEXICO',
    o.pais ?? 'Mexico',
    o.actividad ?? '',
    o.puesto ?? '',
    o.tamano ?? '',
    o.decision ?? '',
    o.scoring ?? '',
    o.nota ?? '',
    o.expositor ?? '',
    o.fecha ?? SERIAL,
  ];
}

function workbook(filas, hoja = 'Contacts') {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADERS, ...filas]), hoja);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const VENDEDORES = [
  { id: 1, name: 'Adrian Chavez' },
  { id: 2, name: 'Alejandro Chávez' },
  { id: 3, name: 'Oswaldo Chávez' },
  { id: 4, name: 'Alejandro Castañón' },
];

const OPTS = { vendedores: VENDEDORES, vendedorDefault: 'Adrian Chavez' };

test('el archivo sin hoja "Contacts" truena con error claro', () => {
  assert.throws(() => importarProspectosFeria(workbook([fila()], 'Hoja1'), OPTS), /Contacts/);
});

test('la segunda hoja "incl. duplicates" se ignora', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADERS, fila()]), 'Contacts');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADERS, fila(), fila()]), 'incl. duplicates');
  const { listos } = importarProspectosFeria(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), OPTS);
  assert.equal(listos.length, 1);
});

test('una fila del export se convierte en un prospecto de Feria/Expo con el nombre titulado', () => {
  const { listos, sinCelular, descartados } = importarProspectosFeria(workbook([fila()]), OPTS);
  assert.deepEqual(sinCelular, []);
  assert.deepEqual(descartados, []);
  assert.equal(listos.length, 1);
  const p = listos[0];
  assert.equal(p.fila, 2);
  assert.equal(p.nombre, 'Omar Olvera');
  assert.equal(p.celular, '+52 5512421575');
  assert.equal(p.ciudad, 'HUIXQUILUCAN');
  assert.equal(p.canal, 'Feria/Expo');
  assert.equal(p.correo, 'omar@vianda.mx');
  assert.equal(p.vendedor, 'Adrian Chavez');
  assert.equal(p.data.empresa, 'VIANDA CONSULTORES');
  assert.equal(p.data.correo, 'omar@vianda.mx');
  assert.equal(p.data.escaneado, '2025-09-16T11:32:00.000Z');
});

test('el mismo celular con y sin lada internacional normaliza al mismo numero', () => {
  assert.equal(normalizarCelularFeria('+52 55 1242 1575'), '+52 5512421575');
  assert.equal(normalizarCelularFeria('5512421575'), '+52 5512421575');
  assert.equal(normalizarCelularFeria(5512421575), '+52 5512421575');
  assert.equal(normalizarCelularFeria('+1 312 555 1234'), '+13125551234');
  assert.equal(normalizarCelularFeria('+34 612 345 678'), '+34612345678');
  assert.equal(normalizarCelularFeria(''), '');
});

test('fechaDeSerialExcel convierte el serial a ISO y deja pasar el texto', () => {
  assert.equal(fechaDeSerialExcel(45916), '2025-09-16T00:00:00.000Z');
  assert.equal(fechaDeSerialExcel(SERIAL), '2025-09-16T11:32:00.000Z');
  assert.equal(fechaDeSerialExcel('16/09/2025 11:32'), '16/09/2025 11:32');
  assert.equal(fechaDeSerialExcel(''), '');
});

test('los nombres del export llegan en MAYUSCULAS y se guardan titulados, sin tocar los ya escritos', () => {
  const { listos } = importarProspectosFeria(workbook([
    fila({ nombre: 'MARÍA JOSÉ', apellido: 'DE LA TORRE' }),
    fila({ nombre: 'Ana', apellido: 'McKenzie', celular: '5512421576' }),
  ]), OPTS);
  assert.deepEqual(listos.map(p => p.nombre), ['María José De La Torre', 'Ana McKenzie']);
});

test('la actividad principal declarada pre-asigna el tipo de cliente y su segmento', () => {
  const casos = [
    ['Restaurante', 'Restaurantes', 10],
    ['Hotel', 'Hoteles', 10],
    ['Cafetería', 'Cafeterías', 10],
    ['Distribuidor / Proveedor', 'Distribuidores', 14],
    ['Catering / Organizador de eventos', 'Catering | Eventos', 15],
  ];
  casos.forEach(([actividad, tipo, segmento], i) => {
    const { listos } = importarProspectosFeria(workbook([
      fila({ actividad, celular: `55124215${10 + i}` }),
    ]), OPTS);
    assert.equal(listos[0].data.tipo_cliente, tipo, actividad);
    assert.equal(listos[0].data.segmento_id, segmento, actividad);
    assert.equal('tipo_cliente_otro' in listos[0].data, false, actividad);
  });
});

test('una actividad fuera del mapeo cae en Otro conservando el texto; sin actividad no hay tipo de cliente', () => {
  const { listos } = importarProspectosFeria(workbook([
    fila({ actividad: 'Tienda de autoservicio' }),
    fila({ actividad: '', celular: '5512421576' }),
  ]), OPTS);
  assert.equal(listos[0].data.tipo_cliente, 'Otro');
  assert.equal(listos[0].data.tipo_cliente_otro, 'Tienda de autoservicio');
  assert.equal(listos[0].data.segmento_id, 1);
  assert.equal('tipo_cliente' in listos[1].data, false);
  assert.equal('segmento_id' in listos[1].data, false);
});

test('el Scoring de la app es la temperatura (1-5); vacio o fuera de rango no manda', () => {
  const { listos } = importarProspectosFeria(workbook([
    fila({ scoring: 5 }),
    fila({ scoring: '3', celular: '5512421576' }),
    fila({ scoring: 1, celular: '5512421577' }),
    fila({ scoring: '', celular: '5512421578' }),
    fila({ scoring: 0, celular: '5512421579' }),
    fila({ scoring: 9, celular: '5512421580' }),
  ]), OPTS);
  assert.deepEqual(listos.map(p => p.data.temperatura), [5, 3, 1, undefined, undefined, undefined]);
});

test('la Note y la linea de puesto, tamano y decision de compra quedan en las notas', () => {
  const { listos } = importarProspectosFeria(workbook([
    fila({
      nota: 'Quiere catalogo de tazas', puesto: 'Dueño / Socio',
      tamano: 'De 11 a 50 empleados', decision: 'Decido',
    }),
    fila({ nota: 'Solo pidio precios', celular: '5512421576' }),
    fila({ jobTitle: 'Chef Ejecutivo', tamano: 'Más de 250 empleados', celular: '5512421577' }),
    fila({ celular: '5512421578' }),
  ]), OPTS);
  assert.equal(listos[0].data.notas,
    'Quiere catalogo de tazas\nPuesto: Dueño / Socio | Tamaño de empresa: De 11 a 50 empleados | Decisión de compra: Decido');
  assert.equal(listos[1].data.notas, 'Solo pidio precios');
  assert.equal(listos[2].data.notas, 'Puesto: Chef Ejecutivo | Tamaño de empresa: Más de 250 empleados');
  assert.equal('notas' in listos[3].data, false);
});

test('el "Exhibitor member" que coincide con un vendedor es el dueno de la fila; sin match manda el default', () => {
  const { listos } = importarProspectosFeria(workbook([
    fila({ expositor: 'Oswaldo' }),
    fila({ expositor: 'ADRIÁN CHÁVEZ', celular: '5512421576' }),
    fila({ expositor: 'Alejandro', celular: '5512421577' }),
    fila({ expositor: 'Stand 2', celular: '5512421578' }),
    fila({ expositor: '', celular: '5512421579' }),
  ]), { vendedores: VENDEDORES, vendedorDefault: 'Jaime Abaroa' });
  assert.deepEqual(listos.map(p => p.vendedor), [
    'Oswaldo Chávez',
    'Adrian Chavez',
    'Jaime Abaroa', // primer nombre ambiguo (dos Alejandros) -> default
    'Jaime Abaroa',
    'Jaime Abaroa',
  ]);
  assert.equal(matchVendedorExpositor('alejandro castanon', VENDEDORES), 'Alejandro Castañón');
  assert.equal(matchVendedorExpositor('', VENDEDORES), null);
});

test('el evento activo viaja en cada fila importada', () => {
  const { listos, sinCelular } = importarProspectosFeria(workbook([
    fila(),
    fila({ celular: '', correo: 'sin-cel@vianda.mx' }),
  ]), { ...OPTS, evento: 'Abastur 2026' });
  assert.equal(listos[0].data.evento, 'Abastur 2026');
  assert.equal(sinCelular[0].data.evento, 'Abastur 2026');
});

test('la fila sin celular sale aparte con lo necesario para perseguirla a mano', () => {
  const { listos, sinCelular, descartados } = importarProspectosFeria(workbook([
    fila({ nombre: 'LUZ', apellido: 'RAMOS', celular: '', correo: 'luz@hotelb.mx', empresa: 'HOTEL BONITO', scoring: 4 }),
    fila(),
  ]), OPTS);
  assert.equal(listos.length, 1);
  assert.deepEqual(descartados, []);
  assert.equal(sinCelular.length, 1);
  assert.equal(sinCelular[0].fila, 2);
  assert.equal(sinCelular[0].nombre, 'Luz Ramos');
  assert.equal(sinCelular[0].empresa, 'HOTEL BONITO');
  assert.equal(sinCelular[0].correo, 'luz@hotelb.mx');
  assert.equal(sinCelular[0].scoring, 4);
  assert.equal(sinCelular[0].data.temperatura, 4);
});

test('celular ilegible se descarta con motivo; el celular repetido en el archivo entra una sola vez', () => {
  const { listos, descartados } = importarProspectosFeria(workbook([
    fila({ nombre: 'ANA', celular: '12345' }),
    fila({ nombre: 'BETO' }),
    fila({ nombre: 'CARLA', celular: '+52 55 1242 1575' }),
    fila({ nombre: '', apellido: '', celular: '5512421576' }),
  ]), OPTS);
  assert.deepEqual(listos.map(p => p.nombre), ['Beto Olvera']);
  assert.deepEqual(descartados, [
    { fila: 2, nombre: 'Ana Olvera', motivo: 'telefono invalido' },
    { fila: 4, nombre: 'Carla Olvera', motivo: 'duplicado en archivo' },
    { fila: 5, nombre: '', motivo: 'sin nombre' },
  ]);
});

test('las filas vacias del final del archivo se saltan sin reportarse', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADERS, fila(), [], ['', '', '']]), 'Contacts');
  const { listos, sinCelular, descartados } = importarProspectosFeria(
    XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), OPTS);
  assert.equal(listos.length, 1);
  assert.deepEqual(sinCelular, []);
  assert.deepEqual(descartados, []);
});
