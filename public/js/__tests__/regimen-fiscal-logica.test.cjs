'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

// === Catalogo c_RegimenFiscal del SAT (issue #191) ===
// Nucleo puro compartido: lo consumen lib/parsear-csf.js (mapear la descripcion de
// la Constancia a su codigo) y app.js (pintar el selector del alta). Los valores
// esperados salen del catalogo publicado por el SAT (Anexo 20 v4.0), no de la
// implementacion: si el codigo y el catalogo discrepan, el test debe fallar.

let CATALOGO_REGIMENES, labelRegimen, esRegimenValido, tipoPersonaRfc,
  regimenesParaRfc, opcionesRegimenHtml;
before(async () => {
  ({
    CATALOGO_REGIMENES, labelRegimen, esRegimenValido, tipoPersonaRfc,
    regimenesParaRfc, opcionesRegimenHtml,
  } = await import('../regimen-fiscal-logica.js'));
});

const codigos = () => CATALOGO_REGIMENES.map(r => r.codigo);

// --- Completitud del catalogo -------------------------------------------------

test('C1: estan los 22 regimenes vigentes del SAT, ni uno mas', () => {
  assert.deepStrictEqual(codigos(), [
    '601', '603', '605', '606', '607', '608', '610', '611', '612', '614', '615',
    '616', '620', '621', '622', '623', '624', '625', '626', '628', '629', '630',
  ]);
});

test('C2: 628/629/630 entran con su descripcion oficial (el repo no los tenia)', () => {
  assert.strictEqual(labelRegimen('628'), 'Hidrocarburos');
  assert.strictEqual(labelRegimen('629'), 'De los Regimenes Fiscales Preferentes y de las Empresas Multinacionales');
  assert.strictEqual(labelRegimen('630'), 'Enajenacion de acciones en bolsa de valores');
});

test('C3: 609 (Consolidacion) NO esta: su vigencia termino', () => {
  assert.ok(!codigos().includes('609'));
});

test('C4: labelRegimen de un codigo desconocido es cadena vacia, no undefined', () => {
  assert.strictEqual(labelRegimen('999'), '');
  assert.strictEqual(labelRegimen(''), '');
});

// --- esRegimenValido ----------------------------------------------------------

test('V1: un codigo del catalogo es valido', () => {
  assert.strictEqual(esRegimenValido('601'), true);
});

test('V2: "6O1" con letra O no es valido (el error de dedo que viajaba literal a Operam)', () => {
  assert.strictEqual(esRegimenValido('6O1'), false);
});

test('V3: pegar el codigo con su descripcion no es valido', () => {
  assert.strictEqual(esRegimenValido('601 General de Ley Personas Morales'), false);
});

test('V4: vacio no es valido', () => {
  assert.strictEqual(esRegimenValido(''), false);
  assert.strictEqual(esRegimenValido(null), false);
});

// --- tipoPersonaRfc -----------------------------------------------------------

test('P1: RFC de 12 caracteres es persona moral', () => {
  assert.strictEqual(tipoPersonaRfc('SMS200716NZ4'), 'moral');
});

test('P2: RFC de 13 caracteres es persona fisica', () => {
  assert.strictEqual(tipoPersonaRfc('UEGA850312KL5'), 'fisica');
});

test('P3: minusculas y espacios no cambian el tipo', () => {
  assert.strictEqual(tipoPersonaRfc('  sms200716nz4 '), 'moral');
});

test('P4: sin RFC o con un RFC sin forma valida no se decide el tipo', () => {
  assert.strictEqual(tipoPersonaRfc(''), null);
  assert.strictEqual(tipoPersonaRfc('ABC'), null);
  assert.strictEqual(tipoPersonaRfc('SMS2007'), null);
});

// --- regimenesParaRfc ---------------------------------------------------------

test('F1: con RFC de persona moral se ofrecen los regimenes de moral (601 si, 612 no)', () => {
  const lista = regimenesParaRfc('SMS200716NZ4').map(r => r.codigo);
  assert.ok(lista.includes('601'));
  assert.ok(lista.includes('628'), 'Hidrocarburos es de persona moral');
  assert.ok(!lista.includes('612'), '612 es exclusivo de persona fisica');
  assert.ok(!lista.includes('605'));
});

test('F2: con RFC de persona fisica se ofrecen los de fisica (612 si, 601 no)', () => {
  const lista = regimenesParaRfc('UEGA850312KL5').map(r => r.codigo);
  assert.ok(lista.includes('612'));
  assert.ok(lista.includes('630'), 'Enajenacion de acciones en bolsa es de persona fisica');
  assert.ok(!lista.includes('601'), '601 es exclusivo de persona moral');
  assert.ok(!lista.includes('628'));
});

test('F3: los que el SAT marca para ambas personas salen en las dos listas', () => {
  for (const codigo of ['610', '626']) {
    assert.ok(regimenesParaRfc('SMS200716NZ4').some(r => r.codigo === codigo), `${codigo} en moral`);
    assert.ok(regimenesParaRfc('UEGA850312KL5').some(r => r.codigo === codigo), `${codigo} en fisica`);
  }
});

test('F4: sin RFC (o con uno a medio teclear) se ofrece el catalogo completo', () => {
  assert.strictEqual(regimenesParaRfc('').length, CATALOGO_REGIMENES.length);
  assert.strictEqual(regimenesParaRfc('SMS20').length, CATALOGO_REGIMENES.length);
});

test('F5: un regimen ya capturado no desaparece aunque el filtro lo excluya', () => {
  // Caso real: la CSF trae 612 y el RFC capturado tiene forma de moral. Filtrar sin
  // esta salvaguarda borraria en silencio un dato que el parser SI extrajo.
  const lista = regimenesParaRfc('SMS200716NZ4', '612').map(r => r.codigo);
  assert.ok(lista.includes('612'));
  assert.ok(lista.includes('601'), 'la lista del tipo sigue completa');
});

test('F6: un "seleccionado" que no existe en el catalogo no se inventa', () => {
  assert.ok(!regimenesParaRfc('SMS200716NZ4', '6O1').some(r => r.codigo === '6O1'));
});

// --- opcionesRegimenHtml ------------------------------------------------------

test('O1: la primera opcion es la vacia (el campo es opcional en la pestana CSF)', () => {
  const html = opcionesRegimenHtml('', '');
  assert.match(html, /^<option value="">/);
});

test('O2: cada opcion muestra codigo y descripcion, para no exigir memorizar claves', () => {
  const html = opcionesRegimenHtml('SMS200716NZ4', '');
  assert.match(html, /<option value="601"[^>]*>601 - General de Ley Personas Morales<\/option>/);
});

// Ninguna opcion lleva el atributo `selected`: el borrador de formulario (#185)
// usa option[selected] para distinguir captura de default, asi que marcar lo
// capturado lo haria pasar por default y no se guardaria. El valor lo pone por JS
// quien repuebla el <select>.
test('O3: ninguna opcion sale marcada como selected, ni siquiera la ya capturada', () => {
  const html = opcionesRegimenHtml('SMS200716NZ4', '626');
  assert.doesNotMatch(html, /selected/);
});

test('O4: el valor ya capturado sigue estando entre las opciones aunque el filtro lo excluya', () => {
  const html = opcionesRegimenHtml('SMS200716NZ4', '612');
  assert.match(html, /<option value="612">/);
});
