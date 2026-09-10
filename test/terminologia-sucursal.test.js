import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

// Terminologia del glosario (#363, decision 2026-09-09): la palabra de pantalla es
// "domicilio de entrega" (CONTEXT.md "Domicilio de entrega"); "sucursal" ya no
// llega al vendedor. `branch` y `sucursal` SI pueden seguir en comentarios, en
// nombres de variables/funciones/constantes tecnicas y en el detalle tecnico de
// un aviso (reporte de pasos) -- nunca en el mensaje que lee el vendedor. Este
// guard recorre la superficie que el vendedor SI lee (frontend, server.js, los
// generadores de documento) y descarta comentarios antes de comparar, para no
// tener que listar cada comentario tecnico como excepcion.

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALCANCE = ['public', 'server.js', 'lib'];
const EXCLUIR = new Set(['__tests__', 'vendor', 'node_modules', 'fonts', 'img']);
const EXTENSIONES = new Set(['.html', '.js']);

function archivosDe(ruta) {
  const st = statSync(ruta);
  if (st.isFile()) return EXTENSIONES.has(ruta.slice(ruta.lastIndexOf('.'))) ? [ruta] : [];
  return readdirSync(ruta)
    .filter(n => !EXCLUIR.has(n))
    .flatMap(n => archivosDe(join(ruta, n)));
}

// Quita comentarios antes de buscar: el estilo del repo siempre deja un espacio
// antes de un "//" inline, y los comentarios HTML son <!-- -->. Sin esto, cada
// comentario tecnico ("Cel de la sucursal (#339)...") exigiria su propia
// excepcion sin aportar nada -- el vendedor nunca lee un comentario.
function sinComentarios(archivo, contenido) {
  if (archivo.endsWith('.html')) return contenido.replace(/<!--[\s\S]*?-->/g, '');
  return contenido.split('\n').map(linea => {
    if (linea.trimStart().startsWith('//')) return '';
    return linea.replace(/\s\/\/.*$/, '');
  }).join('\n');
}

// Excepciones explicitas (con su razon) a lo que puede seguir diciendo
// "sucursal" fuera de un comentario:
const EXCEPCIONES = [
  // "sucursales" (plural) es la calificacion de expo (CONTEXT.md "Captura de
  // expo"): cuantos locales tiene el NEGOCIO del prospecto, un dato de
  // calificacion comercial que no tiene nada que ver con el domicilio de
  // entrega de un Cliente Operam. Vive en prospectos-logica.js, prospectos.html
  // y el lector del formulario en app.js.
  { patron: /\bsucursales\b/gi, razon: 'calificacion de expo: locales del NEGOCIO del prospecto, no domicilio de entrega' },
  // Nombres tecnicos (constantes, funciones, variables, parametros): nunca se
  // sirven como prosa, son identificadores de codigo (#211/#339).
  { patron: /\bFUENTE_SUCURSAL_CREADA\b/g, razon: 'constante tecnica: fuente de auditoria del alta con branch nuevo' },
  { patron: /'sucursal-creada'/g, razon: 'valor de FUENTE_SUCURSAL_CREADA' },
  { patron: /\bsucursalEquivalente\b/g, razon: 'nombre de funcion tecnica ("buscar antes de crear", #211)' },
  { patron: /\bsucursalDe\b/g, razon: 'nombre de parametro/campo tecnico del body del POST (#211)' },
  { patron: /\bcrearSucursal\b/g, razon: 'variable tecnica interna' },
  { patron: /\bsucursalEscrita\b/g, razon: 'variable tecnica interna' },
  { patron: /\bdatosSucursal\b/g, razon: 'variable tecnica interna' },
  { patron: /\bmarcarSucursalOperam\b/g, razon: 'nombre de handler tecnico (window.*), invocado desde onclick' },
  // Nombres de pasos tecnicos y detalle tecnico del reporte de pasos: el
  // "mensaje" que el vendedor lee (el error 503, el boton de la pregunta de
  // duplicado) ya no dice sucursal; lo que sigue aqui es el detalle plegado
  // (Mensaje en dos capas, CONTEXT.md) que nadie renderiza como prosa.
  { patron: /'POST branch \(sucursal\)'/g, razon: 'nombre de paso tecnico del reporte de pasos (#211)' },
  { patron: /'verificar sucursal'/g, razon: 'nombre de paso tecnico del reporte de pasos (#211)' },
  { patron: /candidato elegido como matriz de la sucursal/g, razon: 'detalle tecnico del paso "dedup", no se pinta al vendedor' },
  { patron: /omitido: la sucursal ya existia en Operam de un intento anterior/g, razon: 'detalle tecnico del paso omitido, no se pinta al vendedor' },
  { patron: /omitido: la sucursal ya se creo en un intento anterior/g, razon: 'detalle tecnico del paso omitido, no se pinta al vendedor' },
];

function limpiar(archivo, contenido) {
  let texto = sinComentarios(archivo, contenido);
  for (const { patron } of EXCEPCIONES) texto = texto.replace(patron, '');
  return texto;
}

function lineasConSucursal(archivo) {
  const original = readFileSync(archivo, 'utf8').split('\n');
  const limpio = limpiar(archivo, readFileSync(archivo, 'utf8')).split('\n');
  return limpio
    .map((texto, i) => ({ n: i + 1, texto, original: original[i] }))
    .filter(({ texto }) => /sucursal/i.test(texto));
}

test('#363: "sucursal" no llega al vendedor -- la palabra de pantalla es "domicilio de entrega"', () => {
  const propio = fileURLToPath(import.meta.url);
  const hallazgos = ALCANCE
    .flatMap(a => archivosDe(join(RAIZ, a)))
    .filter(f => f !== propio)
    .flatMap(f => lineasConSucursal(f).map(({ n, original }) => `${relative(RAIZ, f)}:${n}: ${original.trim()}`));
  assert.deepEqual(hallazgos, []);
});
