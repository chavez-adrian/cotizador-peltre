import { test } from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { importarProspectosFeria, normalizarCelularFeria, matchVendedorDispositivo } from '../lib/importar-prospectos.js';

// Fixture sintetico: mismas columnas que el export real de la expo (Abastur),
// hoja "Contactos". El archivo real NUNCA entra al repo (datos personales).

const HEADERS = ['Usuario', 'Dispositivo', 'Fecha/Hora', 'Nombre', 'Apellido Paterno',
  'Apellido Materno', 'Empresa', 'Puesto', 'Correo electronico', 'Telefono', 'Rankings',
  'Tipo de lectora', 'Codigo postal', 'Ciudad', 'Estado', 'País', 'Tags', 'Comentarios'];

const SIN_DEFINIR = 'Sin definir por el usuario';

function fila(o = {}) {
  return [
    o.usuario ?? '#1 Licencia 1',
    o.dispositivo ?? 'Caseta 1',
    o.fechaHora ?? '2024-08-28 01:04:58',
    o.nombre ?? 'OMAR',
    o.apellidoP ?? 'OLVERA',
    o.apellidoM ?? 'MUNOZ',
    o.empresa ?? 'VIANDA CONSULTORES',
    o.puesto ?? SIN_DEFINIR,
    o.correo ?? 'omar@x.com',
    o.telefono ?? 525512952080,
    o.rankings ?? 'Cold',
    'App',
    52784,
    o.ciudad ?? 'HUIXQUILUCAN',
    o.estado ?? 'MEXICO',
    'MEXICO',
    '',
    o.comentarios ?? '',
  ];
}

function workbook(filas, hoja = 'Contactos') {
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

test('fila valida completa se normaliza segun el mapeo de la expo', () => {
  const { listos, descartados } = importarProspectosFeria(workbook([
    fila({ puesto: 'Director', comentarios: 'Quiere catalogo' }),
  ]), OPTS);
  assert.equal(descartados.length, 0);
  assert.equal(listos.length, 1);
  const p = listos[0];
  assert.equal(p.fila, 2);
  assert.equal(p.celular, '+52 5512952080');
  assert.equal(p.nombre, 'OMAR OLVERA');
  assert.equal(p.ciudad, 'HUIXQUILUCAN');
  assert.equal(p.canal, 'Feria/Expo');
  assert.equal(p.vendedor, 'Adrian Chavez');
  assert.equal(p.data.escaneado, '2024-08-28 01:04:58');
  assert.equal(p.data.empresa, 'VIANDA CONSULTORES');
  assert.equal(p.data.correo, 'omar@x.com');
  assert.equal(p.data.temperatura, 1);
  assert.equal(p.data.notas, 'Director - Quiere catalogo');
});

test('normalizarCelularFeria cubre los formatos del export', () => {
  assert.equal(normalizarCelularFeria(525512952080), '+52 5512952080');
  assert.equal(normalizarCelularFeria('525512952080'), '+52 5512952080');
  assert.equal(normalizarCelularFeria(5587654321), '+52 5587654321');
  assert.equal(normalizarCelularFeria(13125551234), '+13125551234');
  assert.equal(normalizarCelularFeria(''), '');
  assert.equal(normalizarCelularFeria(undefined), '');
  assert.equal(normalizarCelularFeria(SIN_DEFINIR), '');
});

test('filas sin telefono valido se descartan con motivo y las validas pasan', () => {
  const { listos, descartados } = importarProspectosFeria(workbook([
    fila({ telefono: 12345, nombre: 'ANA' }),
    fila({ telefono: '', nombre: 'BETO' }),
    fila({ telefono: SIN_DEFINIR, nombre: 'CARLA' }),
    fila({ telefono: 5587654321, nombre: 'DIEGO' }),
  ]), OPTS);
  assert.equal(listos.length, 1);
  assert.equal(listos[0].celular, '+52 5587654321');
  assert.deepEqual(descartados, [
    { fila: 2, nombre: 'ANA OLVERA', motivo: 'telefono invalido' },
    { fila: 3, nombre: 'BETO OLVERA', motivo: 'telefono invalido' },
    { fila: 4, nombre: 'CARLA OLVERA', motivo: 'telefono invalido' },
  ]);
});

test('"Sin definir por el usuario" se trata como vacio en cualquier campo', () => {
  const { listos, descartados } = importarProspectosFeria(workbook([
    fila({ apellidoP: SIN_DEFINIR, empresa: SIN_DEFINIR, correo: SIN_DEFINIR, comentarios: SIN_DEFINIR, nombre: 'SHAKTI' }),
    fila({ nombre: SIN_DEFINIR, apellidoP: SIN_DEFINIR, telefono: 525511112222 }),
  ]), OPTS);
  assert.equal(listos.length, 1);
  assert.equal(listos[0].nombre, 'SHAKTI');
  assert.equal('empresa' in listos[0].data, false);
  assert.equal('correo' in listos[0].data, false);
  assert.equal('notas' in listos[0].data, false);
  assert.deepEqual(descartados, [{ fila: 3, nombre: '', motivo: 'sin nombre' }]);
});

test('celulares duplicados dentro del archivo: solo entra la primera fila', () => {
  const { listos, descartados } = importarProspectosFeria(workbook([
    fila({ nombre: 'PRIMERA' }),
    fila({ nombre: 'SEGUNDA', telefono: 5512952080 }),
    fila({ nombre: 'TERCERA', telefono: 525599887766 }),
  ]), OPTS);
  assert.equal(listos.length, 2);
  assert.equal(listos[0].nombre, 'PRIMERA OLVERA');
  assert.deepEqual(descartados, [{ fila: 3, nombre: 'SEGUNDA OLVERA', motivo: 'duplicado en archivo' }]);
});

test('Rankings mapea Cold/Warm/Medium/Hot a temperatura; otro o vacio no manda', () => {
  const { listos } = importarProspectosFeria(workbook([
    fila({ rankings: 'Cold' }),
    fila({ rankings: 'Warm', telefono: 525511111111 }),
    fila({ rankings: 'Medium', telefono: 525522222222 }),
    fila({ rankings: 'Hot', telefono: 525533333333 }),
    fila({ rankings: 'No ranking', telefono: 525544444444 }),
    fila({ rankings: '', telefono: 525555555555 }),
  ]), OPTS);
  assert.deepEqual(listos.map(p => p.data.temperatura), [1, 2, 3, 5, undefined, undefined]);
});

test('Dispositivo asigna al vendedor que escaneo: nombre completo o primer nombre, sin acentos ni mayusculas', () => {
  const { listos } = importarProspectosFeria(workbook([
    fila({ dispositivo: 'Oswaldo' }),
    fila({ dispositivo: 'Adrián', telefono: 525511111111 }),
    fila({ dispositivo: 'oswaldo chavez', telefono: 525522222222 }),
    fila({ dispositivo: 'Alejandro', telefono: 525533333333 }),
    fila({ dispositivo: 'Caseta 3', telefono: 525544444444 }),
  ]), { vendedores: VENDEDORES, vendedorDefault: 'Jaime Abaroa' });
  assert.deepEqual(listos.map(p => p.vendedor), [
    'Oswaldo Chávez',
    'Adrian Chavez',
    'Oswaldo Chávez',
    'Jaime Abaroa', // primer nombre ambiguo (dos Alejandros) -> default
    'Jaime Abaroa',
  ]);
});

test('matchVendedorDispositivo devuelve null sin match o sin dispositivo', () => {
  assert.equal(matchVendedorDispositivo('', VENDEDORES), null);
  assert.equal(matchVendedorDispositivo(undefined, VENDEDORES), null);
  assert.equal(matchVendedorDispositivo('Caseta 1', VENDEDORES), null);
  assert.equal(matchVendedorDispositivo('Alejandro', VENDEDORES), null);
  assert.equal(matchVendedorDispositivo('alejandro castanon', VENDEDORES), 'Alejandro Castañón');
});

test('ciudad cae a Estado y luego a vacio', () => {
  const { listos } = importarProspectosFeria(workbook([
    fila({ ciudad: SIN_DEFINIR, estado: 'JALISCO' }),
    fila({ ciudad: '', estado: '', telefono: 525511111111 }),
  ]), OPTS);
  assert.equal(listos[0].ciudad, 'JALISCO');
  assert.equal(listos[1].ciudad, '');
});

test('sin hoja Contactos truena con error claro; otras hojas se ignoran', () => {
  assert.throws(() => importarProspectosFeria(workbook([fila()], 'Encuestas'), OPTS), /Contactos/);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Pregunta'], ['basura']]), 'Encuestas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADERS, fila()]), 'Contactos');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const { listos, descartados } = importarProspectosFeria(buffer, OPTS);
  assert.equal(listos.length, 1);
  assert.equal(descartados.length, 0);
});

test('filas completamente vacias se saltan sin reportarse', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADERS, fila(), [], ['', '', '']]), 'Contactos');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const { listos, descartados } = importarProspectosFeria(buffer, OPTS);
  assert.equal(listos.length, 1);
  assert.equal(descartados.length, 0);
});
