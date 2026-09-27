// #453: nucleo puro del destino a envia.com (lib/envia-destino-logica.js). Los
// codigos esperados salen del catalogo de envia.com (GET queries.envia.com/state,
// consultado 2026-09-27): MX de 3 letras (el origen usa MEX), US y CA de 2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destinoEnvia, codigoEstado, separarCalle } from '../lib/envia-destino-logica.js';

test('el estado que teclea el vendedor se reconoce sin acentos, con abreviaturas y alias comunes', () => {
  assert.equal(codigoEstado('MX', 'Estado de M\u00e9xico'), 'MEX');
  assert.equal(codigoEstado('MX', 'Edo. de Mexico'), 'MEX');
  assert.equal(codigoEstado('MX', 'CDMX'), 'CMX');
  assert.equal(codigoEstado('MX', 'Distrito Federal'), 'CMX');
  assert.equal(codigoEstado('MX', 'nuevo leon'), 'NLE');
  assert.equal(codigoEstado('MX', 'Michoac\u00e1n'), 'MIC');
  assert.equal(codigoEstado('CA', 'Ontario'), 'ON');
  assert.equal(codigoEstado('US', 'tx'), 'TX');
});

test('un estado capturado que no se reconoce no viaja crudo: manda el del indice de CP', () => {
  const destino = destinoEnvia({ pais: 'MX', cp: '56577', estado: 'Edomexx' }, { ciudad: 'Ixtapaluca', estado: 'Estado de M\u00e9xico' });
  assert.equal(destino.state, 'MEX');
  assert.equal(destino.city, 'Ixtapaluca');
});

test('el municipio capturado manda sobre la ciudad del indice', () => {
  const destino = destinoEnvia({ pais: 'MX', cp: '56577', municipio: 'Ixtapaluca Centro' }, { ciudad: 'Ixtapaluca', estado: 'Estado de M\u00e9xico' });
  assert.equal(destino.city, 'Ixtapaluca Centro');
});

test('calle y numero en un solo campo: el ultimo token con digito es el numero; sin el, todo es calle', () => {
  assert.deepStrictEqual(separarCalle('Roberto Fierro MZ42 LT13'), { street: 'Roberto Fierro MZ42', number: 'LT13' });
  assert.deepStrictEqual(separarCalle('Insurgentes Sur #1602'), { street: 'Insurgentes Sur', number: '1602' });
  assert.deepStrictEqual(separarCalle('Calle 5 de Mayo'), { street: 'Calle 5 de Mayo', number: '' });
  assert.deepStrictEqual(separarCalle('  '), { street: '', number: '' });
});
