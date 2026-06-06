import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarNombre } from '../lib/deduplicacion.js';

// N1: quita acentos
test('N1: normalizarNombre quita acentos', () => {
  const tokens = normalizarNombre('Distribuciones Rápidas Ópticas');
  assert.ok(tokens.includes('distribuciones'), `esperaba "distribuciones" en [${tokens}]`);
  assert.ok(tokens.includes('rapidas'), `esperaba "rapidas" en [${tokens}]`);
  assert.ok(tokens.includes('opticas'), `esperaba "opticas" en [${tokens}]`);
});

// N2: convierte a minusculas
test('N2: normalizarNombre convierte a minusculas', () => {
  const tokens = normalizarNombre('PELTRE NACIONAL');
  assert.ok(tokens.includes('peltre'), `esperaba "peltre" en [${tokens}]`);
  assert.ok(tokens.includes('nacional'), `esperaba "nacional" en [${tokens}]`);
});

// N3: elimina articulos (el, la, los, las, un, una)
test('N3: normalizarNombre elimina articulos el/la/los/las/un/una', () => {
  const tokens = normalizarNombre('El Gran Mercado de La Ciudad');
  assert.ok(!tokens.includes('el'), `no esperaba "el" en [${tokens}]`);
  assert.ok(!tokens.includes('la'), `no esperaba "la" en [${tokens}]`);
  assert.ok(tokens.includes('gran'), `esperaba "gran" en [${tokens}]`);
  assert.ok(tokens.includes('mercado'), `esperaba "mercado" en [${tokens}]`);
  assert.ok(tokens.includes('ciudad'), `esperaba "ciudad" en [${tokens}]`);
});

test('N3b: normalizarNombre elimina articulos un/una/los/las', () => {
  const tokens = normalizarNombre('Los Tres Amigos Una Empresa');
  assert.ok(!tokens.includes('los'), `no esperaba "los" en [${tokens}]`);
  assert.ok(!tokens.includes('una'), `no esperaba "una" en [${tokens}]`);
  assert.ok(tokens.includes('tres'), `esperaba "tres" en [${tokens}]`);
  assert.ok(tokens.includes('amigos'), `esperaba "amigos" en [${tokens}]`);
  assert.ok(tokens.includes('empresa'), `esperaba "empresa" en [${tokens}]`);
});

// N4: elimina preposiciones (de, del, en, y, e)
test('N4: normalizarNombre elimina preposiciones de/del/en/y/e', () => {
  const tokens = normalizarNombre('Comercio y Distribución en México del Norte');
  assert.ok(!tokens.includes('y'), `no esperaba "y" en [${tokens}]`);
  assert.ok(!tokens.includes('en'), `no esperaba "en" en [${tokens}]`);
  assert.ok(!tokens.includes('del'), `no esperaba "del" en [${tokens}]`);
  assert.ok(tokens.includes('comercio'), `esperaba "comercio" en [${tokens}]`);
  assert.ok(tokens.includes('distribucion'), `esperaba "distribucion" en [${tokens}]`);
  assert.ok(tokens.includes('mexico'), `esperaba "mexico" en [${tokens}]`);
  assert.ok(tokens.includes('norte'), `esperaba "norte" en [${tokens}]`);
});

// N5: elimina sufijos corporativos
test('N5a: normalizarNombre elimina sufijo "sa de cv"', () => {
  const tokens = normalizarNombre('Peltre Nacional SA de CV');
  assert.ok(!tokens.includes('sa'), `no esperaba "sa" en [${tokens}]`);
  assert.ok(!tokens.includes('de'), `no esperaba "de" en [${tokens}]`);
  assert.ok(!tokens.includes('cv'), `no esperaba "cv" en [${tokens}]`);
  assert.ok(tokens.includes('peltre'), `esperaba "peltre" en [${tokens}]`);
  assert.ok(tokens.includes('nacional'), `esperaba "nacional" en [${tokens}]`);
});

test('N5b: normalizarNombre elimina sufijos srl/sapi/sc/ac/llc/inc/corp/ltd', () => {
  const tokensSrl = normalizarNombre('Distribuidora Omega SRL');
  assert.ok(!tokensSrl.includes('srl'), `no esperaba "srl" en [${tokensSrl}]`);
  assert.ok(tokensSrl.includes('distribuidora'), `esperaba "distribuidora" en [${tokensSrl}]`);
  assert.ok(tokensSrl.includes('omega'), `esperaba "omega" en [${tokensSrl}]`);

  const tokensLlc = normalizarNombre('Global Trade LLC');
  assert.ok(!tokensLlc.includes('llc'), `no esperaba "llc" en [${tokensLlc}]`);
  assert.ok(tokensLlc.includes('global'), `esperaba "global" en [${tokensLlc}]`);
  assert.ok(tokensLlc.includes('trade'), `esperaba "trade" en [${tokensLlc}]`);

  const tokensInc = normalizarNombre('Tech Supplies Inc');
  assert.ok(!tokensInc.includes('inc'), `no esperaba "inc" en [${tokensInc}]`);

  const tokensCorp = normalizarNombre('Megastore Corp');
  assert.ok(!tokensCorp.includes('corp'), `no esperaba "corp" en [${tokensCorp}]`);

  const tokensLtd = normalizarNombre('Omega Systems Ltd');
  assert.ok(!tokensLtd.includes('ltd'), `no esperaba "ltd" en [${tokensLtd}]`);
});

test('N5c: normalizarNombre elimina sufijo "sapi de cv"', () => {
  const tokens = normalizarNombre('Grupo Industrial SAPI de CV');
  assert.ok(!tokens.includes('sapi'), `no esperaba "sapi" en [${tokens}]`);
  assert.ok(!tokens.includes('de'), `no esperaba "de" en [${tokens}]`);
  assert.ok(!tokens.includes('cv'), `no esperaba "cv" en [${tokens}]`);
  assert.ok(tokens.includes('grupo'), `esperaba "grupo" en [${tokens}]`);
  assert.ok(tokens.includes('industrial'), `esperaba "industrial" en [${tokens}]`);
});

// N6: devuelve array de tokens no vacios
test('N6: normalizarNombre devuelve array de strings no vacios', () => {
  const tokens = normalizarNombre('Peltre Nacional SA de CV');
  assert.ok(Array.isArray(tokens), 'debe retornar un array');
  assert.ok(tokens.length > 0, 'el array no debe estar vacio');
  assert.ok(tokens.every(t => typeof t === 'string' && t.length > 0), 'todos los tokens deben ser strings no vacios');
});

// N7: falso positivo — nombre completamente diferente no produce tokens iguales
test('N7: normalizarNombre nombres distintos producen tokens distintos (falso positivo)', () => {
  const tokensA = normalizarNombre('Panaderia Gomez');
  const tokensB = normalizarNombre('Ferreteria Lopez');
  const solapamiento = tokensA.filter(t => tokensB.includes(t));
  assert.strictEqual(solapamiento.length, 0, `no esperaba solapamiento entre ${tokensA} y ${tokensB}`);
});

// N8: nombre con mezcla de acentos + articulos + sufijos corporativos
test('N8: normalizarNombre maneja mezcla de acentos/articulos/sufijos en un nombre real', () => {
  // "Distribuciones El Aguila SA de CV" -> tokens: ["distribuciones", "aguila"]
  const tokens = normalizarNombre('Distribuciones El Aguila SA de CV');
  assert.ok(!tokens.includes('el'), `no esperaba "el" en [${tokens}]`);
  assert.ok(!tokens.includes('sa'), `no esperaba "sa" en [${tokens}]`);
  assert.ok(!tokens.includes('de'), `no esperaba "de" en [${tokens}]`);
  assert.ok(!tokens.includes('cv'), `no esperaba "cv" en [${tokens}]`);
  assert.ok(tokens.includes('distribuciones'), `esperaba "distribuciones" en [${tokens}]`);
  assert.ok(tokens.includes('aguila'), `esperaba "aguila" en [${tokens}]`);
});
