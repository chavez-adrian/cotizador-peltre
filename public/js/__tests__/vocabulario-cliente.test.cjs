'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Barrido de vocabulario (#347, spec #337, ADR-0016): "cliente" nunca va a
// secas en un texto visible. Recorre el CODIGO FUENTE de los nucleos puros de
// UI (los que public/js/__tests__/*.test.cjs ya ejercitan como render) y
// revisa cada literal de texto que un usuario pueda leer. No es un test de
// comportamiento (esos ya existen por pantalla, ej. clientes-vista.test.cjs
// T1/T2 para "Sin datos fiscales"): es la red que impide que un texto NUEVO
// vuelva a colar "cliente" a secas sin que nadie lo note.
//
// Que cuenta como "texto de UI": literales de cadena (comillas simples,
// dobles o template) con un espacio adentro -- los identificadores de codigo
// (clases CSS, ids de DOM, rutas /api/, nombres de campo como tipo_cliente)
// nunca llevan espacio. Los comentarios de linea completa (// ...) se
// excluyen: documentan al desarrollador, no le hablan al vendedor.
//
// Compuestos permitidos (ADR-0016 + CONTEXT.md "Cliente Operam"): "Cliente
// Operam" y "Cliente en linea/línea" (con o sin "en Operam" -- variante ya en
// uso, ej. el panel de paso Cliente). "Tipo de cliente" (segmento comercial
// del prospecto, #41/ADR-0004) es un termino de negocio distinto al Cliente
// Operam de ADR-0016 y no se toca aqui.

const RAIZ = path.join(__dirname, '..');

const ARCHIVOS = [
  'alta-logica.js',
  'bandeja-logica.js',
  'borrador-logica.js',
  'cotizaciones-logica.js',
  'decorados-logica.js',
  'estado-cliente-logica.js',
  'importar-expo-logica.js',
  'mayoreo-logica.js',
  'pipeline-logica.js',
  'prospectos-logica.js',
  'resumen-cotizacion-logica.js',
  'stepper-logica.js',
];

// Sin acentos y en minusculas: el texto real trae acentos, la regla no.
function normalizar(s) {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

// Tokenizador de mano, no un regex plano: un template literal puede llevar
// atributos con comillas dobles adentro ('<div class="foo">') y un regex de
// comillas independiente del contexto empareja esa comilla con la SIGUIENTE
// que encuentre, cientos de lineas despues -- se probo primero asi y fallaba
// en grande (un solo "literal" de 1000+ caracteres que cruzaba funciones
// enteras). Aqui la pila de modos sabe en que nivel esta cada comilla.
//
// Los REGEX del propio codigo son la segunda trampa: `.replace(/"/g, ...)`
// tiene una comilla suelta adentro de `/.../ ` que un tokenizador que solo mira
// comillas confunde con el inicio de un string. Se detecta con la heuristica
// usual (un `/` es regex si el ultimo caracter significativo antes es uno de
// apertura/operador, nunca un identificador o un `)`/`]`) y se salta entero,
// respetando clases `[...]` y escapes.
const INICIA_REGEX = new Set('([{,;:=!&|?+-*%^~<>\n'.split(''));

function extraerLiterales(codigo) {
  const literales = [];
  let i = 0;
  const n = codigo.length;
  const pila = [{ tipo: 'codigo', desdeInterp: false, profundidad: 0 }];
  let buf = '';
  let ultimoSig; // ultimo caracter no-blanco visto en modo 'codigo'
  while (i < n) {
    const top = pila[pila.length - 1];
    const ch = codigo[i];
    if (top.tipo === 'codigo') {
      if (ch === "'") { pila.push({ tipo: 'squote' }); buf = ''; ultimoSig = ch; i++; continue; }
      if (ch === '"') { pila.push({ tipo: 'dquote' }); buf = ''; ultimoSig = ch; i++; continue; }
      if (ch === '`') { pila.push({ tipo: 'template' }); buf = ''; ultimoSig = ch; i++; continue; }
      if (ch === '/' && codigo[i + 1] !== '/' && codigo[i + 1] !== '*' &&
          (ultimoSig === undefined || INICIA_REGEX.has(ultimoSig))) {
        // Regex literal: saltar hasta el `/` de cierre (fuera de una clase
        // `[...]` y sin escapar) mas sus banderas.
        let j = i + 1;
        let enClase = false;
        while (j < n) {
          const c = codigo[j];
          if (c === '\\') { j += 2; continue; }
          if (c === '[') { enClase = true; j++; continue; }
          if (c === ']') { enClase = false; j++; continue; }
          if (c === '/' && !enClase) { j++; break; }
          if (c === '\n') break; // regex mal formado: no cruzar de linea
          j++;
        }
        while (j < n && /[a-z]/i.test(codigo[j])) j++; // banderas
        i = j; ultimoSig = '/'; continue;
      }
      if (top.desdeInterp) {
        if (ch === '{') { top.profundidad++; i++; ultimoSig = ch; continue; }
        if (ch === '}') {
          if (top.profundidad === 0) { pila.pop(); i++; continue; }
          top.profundidad--; i++; ultimoSig = ch; continue;
        }
      }
      if (!/\s/.test(ch)) ultimoSig = ch;
      i++; continue;
    }
    if (top.tipo === 'squote' || top.tipo === 'dquote') {
      const q = top.tipo === 'squote' ? "'" : '"';
      if (ch === '\\') { buf += ch + (codigo[i + 1] ?? ''); i += 2; continue; }
      if (ch === q) { literales.push(buf); pila.pop(); i++; continue; }
      buf += ch; i++; continue;
    }
    // top.tipo === 'template'
    if (ch === '\\') { buf += ch + (codigo[i + 1] ?? ''); i += 2; continue; }
    if (ch === '`') { literales.push(buf); pila.pop(); i++; continue; }
    if (ch === '$' && codigo[i + 1] === '{') {
      literales.push(buf); buf = '';
      pila.push({ tipo: 'codigo', desdeInterp: true, profundidad: 0 });
      i += 2; continue;
    }
    buf += ch; i++;
  }
  return literales;
}

// Compuestos permitidos: "cliente(s) operam", "cliente(s) en linea/línea",
// "cliente(s) en operam". Y el termino de negocio "tipo de cliente" / "tipo
// cliente" / "que clientes atiende" (segmento, no la entidad de ADR-0016).
function esUsoPermitido(norm, idx, largo) {
  const antes = norm.slice(Math.max(0, idx - 20), idx);
  const desde = norm.slice(idx, idx + largo + 25);
  if (/^clientes?\s+(operam|en\s+linea|en\s+operam)/.test(desde)) return true;
  if (/tipo\s+(de\s+)?$/.test(antes)) return true;
  if (/que\s+$/.test(antes) && /^clientes?\s+atiende/.test(desde)) return true;
  return false;
}

// Un identificador (clase CSS, id de DOM, ruta /api/, nombre de campo) nunca
// tiene espacio alrededor de "cliente", pero SI puede tener guion, guion bajo
// o slash -- que el \b de un regex normal NO trata como union. "cot-card-
// cliente" o "tipo_cliente" no son prosa aunque "cliente" ahi cumpla \b.
function esLimiteDePrograma(ch) {
  if (ch === undefined) return true;
  return !/[a-z0-9_\-/]/i.test(ch);
}

// Un literal cuenta como "texto de UI" si trae un espacio: los identificadores
// de codigo (clases, ids, campos, rutas) nunca lo llevan.
function violacionesEnLiteral(texto) {
  if (!texto.includes(' ')) return [];
  const norm = normalizar(texto);
  const re = /clientes?/g;
  const violaciones = [];
  let m;
  while ((m = re.exec(norm))) {
    const antes = norm[m.index - 1];
    const despues = norm[m.index + m[0].length];
    if (!esLimiteDePrograma(antes) || !esLimiteDePrograma(despues)) continue;
    if (!esUsoPermitido(norm, m.index, m[0].length)) violaciones.push(texto);
  }
  return violaciones;
}

// Extrae los literales de cadena del CODIGO (sin comentarios de linea
// completa) de un archivo fuente: comillas simples, dobles y template.
function literalesDeArchivo(ruta) {
  const fuente = fs.readFileSync(ruta, 'utf8');
  const lineas = fuente.split(/\r?\n/).filter(l => !l.trim().startsWith('//'));
  const codigo = lineas.join('\n');
  return extraerLiterales(codigo);
}

for (const archivo of ARCHIVOS) {
  test(`vocabulario #347: ${archivo} no dice "cliente" a secas en ningun texto de UI`, () => {
    const ruta = path.join(RAIZ, archivo);
    const literales = literalesDeArchivo(ruta);
    const violaciones = literales.flatMap(violacionesEnLiteral);
    assert.deepEqual(violaciones, [], `"cliente" a secas en ${archivo}:\n${violaciones.join('\n')}`);
  });
}
