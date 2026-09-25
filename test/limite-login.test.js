// #450: nucleo del limite de intentos del PIN, sin HTTP. En produccion la lista
// de vendedores sale de Neon (asincrona), asi que aqui el verificador tarda: una
// rafaga de peticiones simultaneas no debe pasar la revision del bloqueo antes
// de que se anote ningun fallo, y el PIN correcto no debe entrar con el tope ya
// alcanzado aunque este en vuelo junto con los PINes malos.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { intentarLogin, resetLimiteLogin, tamanoLimiteLogin } from '../lib/limite-login.js';

const REGISTRO = [
  { id: 1, name: 'Jefa Test', pin: '9001', role: 'admin' },
  { id: 2, name: 'Vendedor Test', pin: '9002', role: 'vendedor' },
];

const listarLento = () => new Promise(resolve => setTimeout(() => resolve(REGISTRO), 30));

beforeEach(() => { resetLimiteLogin(); });

test('#450 una rafaga simultanea no se salta el tope: 4 401, el resto 429 y el PIN correcto no entra', async () => {
  const malos = Array.from({ length: 60 }, () => intentarLogin({ vendedorId: 2, pin: '0000', ip: '10.9.0.1' }, listarLento));
  const correcto = intentarLogin({ vendedorId: 2, pin: '9002', ip: '10.9.0.2' }, listarLento);
  const respuestas = await Promise.all([...malos, correcto]);

  const porStatus = {};
  for (const r of respuestas) porStatus[r.status] = (porStatus[r.status] || 0) + 1;
  assert.deepEqual(porStatus, { 401: 4, 429: 57 });
  const ultimo = respuestas[respuestas.length - 1];
  assert.equal(ultimo.status, 429, 'con el tope ya alcanzado ni el PIN correcto entra');
  assert.equal(ultimo.vendedor, undefined);
});

test('#450 un vendedorId que no es un id entero positivo no crea llave por vendedor, solo cuenta la IP', async () => {
  const listar = async () => REGISTRO;
  const invalidos = ['x'.repeat(100000), { id: 2 }, 2.5, -3];
  for (const vendedorId of invalidos) {
    const r = await intentarLogin({ vendedorId, pin: '0000', ip: '10.9.1.1' }, listar);
    assert.equal(r.status, 401);
  }
  assert.equal(tamanoLimiteLogin(), 1, 'solo la llave de la IP');

  const quinto = await intentarLogin({ vendedorId: '2', pin: '9002', ip: '10.9.1.1' }, listar);
  assert.equal(quinto.status, 429, 'los fallos con id invalido si cuentan contra la IP');
  assert.equal(quinto.error, 'Demasiados intentos, espera 15 min');
});
