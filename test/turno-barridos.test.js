// #509: los barridos largos contra Operam comparten turno. El 2026-10-01 el sync y
// el barrido diario de post-fixes corrieron juntos y los dos recibieron 429.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enTurno, turnoOcupado } from '../lib/turno-barridos.js';

function compuerta() {
  let abrir;
  const abierta = new Promise(res => { abrir = res; });
  return { abierta, abrir };
}

test('dos barridos distintos no corren a la vez: el segundo espera a que termine el primero', async () => {
  const orden = [];
  const g = compuerta();
  const primero = enTurno('sync-operam', async () => { orden.push('sync inicia'); await g.abierta; orden.push('sync termina'); return 'sync'; });
  const segundo = enTurno('postfix-quotes', async () => { orden.push('postfix inicia'); return 'postfix'; });
  await new Promise(res => setImmediate(res));
  assert.deepEqual(orden, ['sync inicia']);
  g.abrir();
  assert.equal(await primero, 'sync');
  assert.equal(await segundo, 'postfix');
  assert.deepEqual(orden, ['sync inicia', 'sync termina', 'postfix inicia']);
});

test('el mismo barrido dos veces: la segunda se omite sin correr', async () => {
  const g = compuerta();
  let corridas = 0;
  const primera = enTurno('sync-operam', async () => { corridas++; await g.abierta; return 'hecho'; });
  assert.equal(turnoOcupado('sync-operam'), true);
  const segunda = await enTurno('sync-operam', async () => { corridas++; return 'otra'; });
  assert.deepEqual(segunda, { omitido: true });
  g.abrir();
  assert.equal(await primera, 'hecho');
  assert.equal(corridas, 1);
  assert.equal(turnoOcupado('sync-operam'), false);
});

test('el barrido que esta formado esperando tambien cuenta como ocupado', async () => {
  const g = compuerta();
  const primero = enTurno('postfix-quotes', () => g.abierta);
  const formado = enTurno('sync-operam', async () => 'sync');
  assert.deepEqual(await enTurno('sync-operam', async () => 'duplicado'), { omitido: true });
  g.abrir();
  await primero;
  assert.equal(await formado, 'sync');
});

test('un barrido que falla suelta el turno y el siguiente corre', async () => {
  await assert.rejects(enTurno('sync-operam', async () => { throw new Error('Operam caido'); }), /Operam caido/);
  assert.equal(turnoOcupado('sync-operam'), false);
  assert.equal(await enTurno('postfix-quotes', async () => 'corrio'), 'corrio');
});
