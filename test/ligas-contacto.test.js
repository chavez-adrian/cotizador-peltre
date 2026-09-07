import { test } from 'node:test';
import assert from 'node:assert/strict';

// Ligas Contacto -> Cliente Operam (#345, spec #337, ADR-0016). Nucleo PURO: el
// comportamiento de punta a punta se prueba por HTTP en operam-generico.test.js;
// aqui solo las decisiones del modulo.

const {
  FUENTE_COTIZADOR, FUENTE_OPERAM,
  ligasDeContacto, estaLigadoA, ligaPrincipal, conLigaDerivada, parcheDeLiga, decidirLiga,
} = await import('../lib/ligas-contacto.js');

test('ligasDeContacto: sin data no hay ligas', () => {
  assert.deepEqual(ligasDeContacto(undefined), []);
  assert.deepEqual(ligasDeContacto(null), []);
  assert.deepEqual(ligasDeContacto({}), []);
});

test('ligasDeContacto: la liga singular de antes de #345 se lee como lista de una', () => {
  assert.deepEqual(ligasDeContacto({ cliente_id: 555 }), [{ cliente_id: 555, fuente: FUENTE_COTIZADOR }]);
});

test('ligasDeContacto: la lista se lee tal cual, en su orden', () => {
  const data = { clientes_operam: [
    { cliente_id: 555, fuente: FUENTE_COTIZADOR },
    { cliente_id: 777, fuente: FUENTE_COTIZADOR },
  ] };
  assert.deepEqual(ligasDeContacto(data).map(l => l.cliente_id), [555, 777]);
});

// La singular se conserva como PRIMERA liga: los lectores anteriores a #345
// (tabla de prospectos, badge, seguimiento) siguen leyendo data.cliente_id.
test('ligasDeContacto: singular y lista se unen sin repetir, la singular primero', () => {
  const data = {
    cliente_id: 555,
    clientes_operam: [{ cliente_id: 777, fuente: FUENTE_COTIZADOR }, { cliente_id: 555, fuente: FUENTE_COTIZADOR }],
  };
  assert.deepEqual(ligasDeContacto(data).map(l => l.cliente_id), [555, 777]);
});

test('ligasDeContacto: una entrada sin cliente_id no es una liga', () => {
  const data = { clientes_operam: [{ fuente: FUENTE_COTIZADOR }, { cliente_id: 555 }, null] };
  assert.deepEqual(ligasDeContacto(data).map(l => l.cliente_id), [555]);
});

test('estaLigadoA compara por valor, no por tipo (Operam devuelve ids como texto)', () => {
  const ligas = ligasDeContacto({ cliente_id: 555 });
  assert.equal(estaLigadoA(ligas, '555'), true);
  assert.equal(estaLigadoA(ligas, 555), true);
  assert.equal(estaLigadoA(ligas, 777), false);
  assert.equal(estaLigadoA(ligas, null), false);
});

test('ligaPrincipal: la primera liga persistida, o null sin ninguna', () => {
  assert.equal(ligaPrincipal(ligasDeContacto({ cliente_id: 555 })), 555);
  assert.equal(ligaPrincipal([]), null);
});

// La liga derivada de Operam NO se persiste (ADR-0016): se calcula del indice de
// telefonos en lectura y viaja marcada con su fuente.
test('conLigaDerivada: el hallazgo del indice de Operam se suma marcado como derivado', () => {
  const ligas = ligasDeContacto({ cliente_id: 555 });
  assert.deepEqual(conLigaDerivada(ligas, 777), [
    { cliente_id: 555, fuente: FUENTE_COTIZADOR },
    { cliente_id: 777, fuente: FUENTE_OPERAM },
  ]);
});

test('conLigaDerivada: una liga que ya esta persistida no se duplica ni cambia de fuente', () => {
  const ligas = ligasDeContacto({ cliente_id: 555 });
  assert.deepEqual(conLigaDerivada(ligas, '555'), [{ cliente_id: 555, fuente: FUENTE_COTIZADOR }]);
  assert.deepEqual(conLigaDerivada(ligas, null), ligas);
});

test('parcheDeLiga: el primer Cliente Operam llena la lista y la llave singular', () => {
  assert.deepEqual(parcheDeLiga({}, 555), {
    cliente_id: 555,
    clientes_operam: [{ cliente_id: 555, fuente: FUENTE_COTIZADOR }],
  });
});

// El corazon de #345: la liga se AGREGA, nunca se reemplaza.
test('parcheDeLiga: la segunda razon social se agrega y la anterior queda intacta', () => {
  const parche = parcheDeLiga({ cliente_id: 555 }, 777);
  assert.equal(parche.cliente_id, 555, 'la liga anterior sigue siendo la principal');
  assert.deepEqual(parche.clientes_operam, [
    { cliente_id: 555, fuente: FUENTE_COTIZADOR },
    { cliente_id: 777, fuente: FUENTE_COTIZADOR },
  ]);
});

test('parcheDeLiga: ligar dos veces al mismo Cliente Operam no crece la lista', () => {
  const parche = parcheDeLiga({ cliente_id: 555, clientes_operam: [{ cliente_id: 555, fuente: FUENTE_COTIZADOR }] }, '555');
  assert.deepEqual(parche.clientes_operam, [{ cliente_id: 555, fuente: FUENTE_COTIZADOR }]);
});

test('decidirLiga: Contacto sin ligas -> se agrega sin preguntar nada', () => {
  assert.deepEqual(decidirLiga([], 555), { accion: 'agregar', otras: [] });
});

test('decidirLiga: ya ligado a ese mismo Cliente Operam -> no hay nada que hacer', () => {
  const ligas = ligasDeContacto({ cliente_id: 555 });
  assert.equal(decidirLiga(ligas, '555').accion, 'nada');
});

test('decidirLiga: sin Cliente Operam que ligar -> no hay nada que hacer', () => {
  assert.equal(decidirLiga([], null).accion, 'nada');
});

// User story 13 de la spec #337: el celular ligado a otro Cliente Operam deja de
// ser un bloqueo y pasa a ser una pregunta.
test('decidirLiga: otro Cliente Operam sin confirmar -> se pregunta, con las ligas que ya tenia', () => {
  const ligas = ligasDeContacto({ cliente_id: 555 });
  assert.deepEqual(decidirLiga(ligas, 777), { accion: 'confirmar', otras: ligas });
});

test('decidirLiga: con la confirmacion del vendedor -> se agrega', () => {
  const ligas = ligasDeContacto({ cliente_id: 555 });
  assert.deepEqual(decidirLiga(ligas, 777, { confirmado: true }), { accion: 'agregar', otras: ligas });
});
