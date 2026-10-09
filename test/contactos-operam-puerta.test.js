// El modulo Contactos en Operam es la UNICA puerta para leer las personas de Operam
// (#560, ADR-0024): ningun codigo fuera de el lee `contacts[]` ni la persona de
// contacto aplanada en `branches[]` (`contact_name`, `phone`, `fax` = Cel, `email`)
// para sacar personas o telefonos. Se lee el TEXTO del codigo, sin comentarios, como
// la regla mecanica de test/modulos-dominio.test.js; la prueba no importa nada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// El modulo: su nucleo puro y su envoltura con IO.
const MODULO = new Set(['lib/contactos-operam.js', 'lib/contactos-operam-logica.js']);

// Lecturas de Operam crudo que dan una persona o un telefono.
const LECTURAS = [
  /\.contacts\b/,
  /\bcontact_name\b/,
  /\.fax\b(?!\s*=[^=])/,
  /\[CAMPO_CEL\](?!\s*:)/,
  /\b(?:b|br|branch)\??\.(?:phone2?|email|fax)\b/,
];

// Lo que casa el patron sin ser Operam crudo, con su razon.
const PERMITIDAS = [
  // `contacts` de la RESPUESTA de GET /api/operam/clientes/:id/domicilios: las
  // entradas que el servidor ya armo con el modulo.
  { archivo: 'public/js/app.js', texto: 'cuerpo.contacts' },
  // Dos entradas del selector "Contacto de entrega" (`a` y `b`), no domicilios.
  { archivo: 'public/js/alta-logica.js', texto: 'normalizarBusqueda(b.email)' },
  // El cuerpo que el alta ESCRIBE en el domicilio (`datos` lo arma el cotizador).
  { archivo: 'lib/operam-client.js', texto: '[CAMPO_CEL]: datos.fax' },
];

function sinComentarios(codigo) {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map(l => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

function lecturasDe(relativo, codigo) {
  const halladas = [];
  sinComentarios(codigo).split('\n').forEach((linea, i) => {
    for (const patron of LECTURAS) {
      const m = linea.match(patron);
      if (!m) continue;
      if (PERMITIDAS.some(p => p.archivo === relativo && linea.includes(p.texto))) continue;
      halladas.push(`${relativo}:${i + 1}: ${linea.trim()}`);
      break;
    }
  });
  return halladas;
}

function archivosDelCodigo() {
  const js = dir => readdirSync(join(RAIZ, dir)).filter(f => /\.(m?js)$/.test(f)).map(f => `${dir}/${f}`);
  return ['server.js', ...js('lib'), ...js('public/js')];
}

test('fuera del modulo Contactos en Operam nadie lee contacts[] ni la persona aplanada del domicilio', () => {
  const halladas = archivosDelCodigo()
    .filter(f => !MODULO.has(f))
    .flatMap(f => lecturasDe(f, readFileSync(join(RAIZ, f), 'utf8')));
  assert.deepEqual(halladas, []);
});

// La prueba de arriba solo vale si el detector ve una lectura de verdad y no se
// confunde con un comentario.
test('el detector encuentra las lecturas sueltas y no los comentarios', () => {
  const codigo = [
    '// contacts[] y contact_name en un comentario no cuentan',
    'for (const ct of c.contacts || []) tels.push(ct.phone);',
    'const quien = b.contact_name;',
    'const cel = branch?.fax;',
    'correos.push(b.email);',
    'const cel = ct[CAMPO_CEL];',
    'const url = "https://x"; const otro = d.email;',
    'datos.fax = c.telefono; const cuerpo = { [CAMPO_CEL]: cel };',
  ].join('\r\n');
  assert.deepEqual(lecturasDe('lib/x.js', codigo).map(l => l.split(':')[1]), ['2', '3', '4', '5', '6']);
});
