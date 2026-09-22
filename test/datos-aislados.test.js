// #411: las suites que cotizan con un celular heredaban el data/prospectos.json
// que encontraran en el disco. El fixture que dejo otra suite -- una corrida que
// murio antes de su after(), o dos corridas a la vez en el mismo arbol -- cambia
// el veredicto del servidor y el rojo parece un bug del codigo: data/prospectos.json
// esta en .gitignore, asi que el estado corrupto no sale en git status.
//
// El par que fija el punto de partida y restaura lo que se encontro vive en
// test/helpers/datos-aislados.js, y aqui se mide contra el disco REAL: guardar y
// restaurar no basta, lo que evita heredar es FIJAR el punto de partida.
// Todo el acceso va por lib/fs-reintento.js (#117), sin un segundo camino al disco.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { leerArchivoSync, escribirArchivoSync, borrarArchivoSync } from '../lib/fs-reintento.js';
import { fotoDatos, fijarDatos } from './helpers/datos-aislados.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const PROSPECTOS_PATH = join(DATA_DIR, 'prospectos.json');
const COTS_PATH = join(DATA_DIR, 'cotizaciones.json');

// El fixture con el que muere test/operam-generico.test.js si su after() no corre:
// el Contacto del celular que comparte con moneda-extranjera (MX4), ya ligado a
// otro Cliente Operam.
const RESIDUO = [{
  id: 1, fecha: '2026-07-01T00:00:00Z', vendedor: 'Tester',
  celular: '+52 5588776655', celular10: '5588776655', nombre: 'Hotel Azul',
  ciudad: 'CDMX', canal: 'WhatsApp', etapa: 'seguimiento', eventos: [],
  data: { cliente_id: 555 },
}];
const TEXTO_RESIDUO = JSON.stringify(RESIDUO, null, 2);

// Red de seguridad propia: esta suite no puede confiar en lo que esta probando.
const ARCHIVOS = [PROSPECTOS_PATH, COTS_PATH];
let alEmpezar;
before(() => {
  alEmpezar = ARCHIVOS.map(path => ({
    path,
    existia: existsSync(path),
    texto: existsSync(path) ? leerArchivoSync(path) : null,
  }));
});
after(() => {
  for (const { path, existia, texto } of alEmpezar) {
    if (existia) escribirArchivoSync(path, texto);
    else if (existsSync(path)) borrarArchivoSync(path);
  }
});

test('#411: el residuo de otra suite no sobrevive al punto de partida', () => {
  escribirArchivoSync(PROSPECTOS_PATH, TEXTO_RESIDUO);
  const restaurar = fotoDatos([PROSPECTOS_PATH]);
  fijarDatos(PROSPECTOS_PATH, []);
  assert.deepEqual(JSON.parse(leerArchivoSync(PROSPECTOS_PATH)), []);
  restaurar();
});

test('#411: al terminar queda EXACTAMENTE el texto que se encontro, no uno reescrito', () => {
  escribirArchivoSync(PROSPECTOS_PATH, TEXTO_RESIDUO);
  const restaurar = fotoDatos([PROSPECTOS_PATH]);
  fijarDatos(PROSPECTOS_PATH, [{ id: 9, nombre: 'Lo que escribio la suite' }]);
  restaurar();
  assert.equal(leerArchivoSync(PROSPECTOS_PATH), TEXTO_RESIDUO);
});

test('#411: el archivo que no existia queda ausente, no en lista vacia', () => {
  if (existsSync(PROSPECTOS_PATH)) borrarArchivoSync(PROSPECTOS_PATH);
  const restaurar = fotoDatos([PROSPECTOS_PATH]);
  fijarDatos(PROSPECTOS_PATH, []);
  assert.ok(existsSync(PROSPECTOS_PATH), 'la suite arranca con su punto de partida aunque el archivo no estuviera');
  restaurar();
  assert.equal(existsSync(PROSPECTOS_PATH), false);
});

test('#411: la foto cubre los varios data/*.json de la suite, cada uno como estaba', () => {
  escribirArchivoSync(PROSPECTOS_PATH, TEXTO_RESIDUO);
  if (existsSync(COTS_PATH)) borrarArchivoSync(COTS_PATH);
  const restaurar = fotoDatos([PROSPECTOS_PATH, COTS_PATH]);
  fijarDatos(PROSPECTOS_PATH, []);
  fijarDatos(COTS_PATH, [{ id: 1 }]);
  restaurar();
  assert.equal(leerArchivoSync(PROSPECTOS_PATH), TEXTO_RESIDUO);
  assert.equal(existsSync(COTS_PATH), false);
});
