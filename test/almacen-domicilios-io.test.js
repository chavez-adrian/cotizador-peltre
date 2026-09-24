// #438: el barrido de domicilios (#416) corre en SEGUNDO PLANO y con ritmo propio.
// En produccion no terminaba: 531 lecturas sin pausa dentro de UNA peticion HTTP
// disparaban el 429 de Operam para todo el cotizador. Aqui se prueba la envoltura
// con IO con Operam en memoria (deps) y un reloj falso: nada sale a la red y
// ninguna espera es real.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const barridoIo = await import('../lib/almacen-domicilios-io.js');
const { barrerAlmacenesDomicilios, avanceBarridoAlmacenes, ultimoBarridoAlmacenes, _esperarBarrido, _reiniciar } = barridoIo;

function clientesCon(nBranches) {
  return [{
    customer_id: '15', CustName: 'CLIENTE DE PRUEBA',
    branches: Array.from({ length: nBranches }, (_, i) => ({ branch_code: String(100 + i), br_name: 'Sucursal ' + i })),
  }];
}

// Reloj falso: esperar(ms) solo avanza el reloj; se anota cada espera pedida.
function relojFalso() {
  const reloj = { t: 1_000_000, esperas: [] };
  reloj.ahora = () => reloj.t;
  reloj.esperar = async (ms) => { reloj.esperas.push(ms); reloj.t += ms; };
  return reloj;
}

// Operam en memoria: el padron, el detalle de cada branch (todos en PT, 40) y el
// catalogo de ubicaciones. Anota a que hora del reloj se pidio cada branch.
function operamMemoria({ clientes, reloj, bloquear = null, fallaPadron = null } = {}) {
  const lecturas = { padron: 0, branches: [], almacenes: 0 };
  let soltar;
  const bloqueo = new Promise(res => { soltar = res; });
  const deps = {
    listarTodosClientes: async () => {
      lecturas.padron++;
      if (fallaPadron) throw new Error(fallaPadron);
      return clientes;
    },
    obtenerBranch: async (codigo) => {
      lecturas.branches.push({ codigo, t: reloj ? reloj.ahora() : null });
      if (bloquear === codigo) await bloqueo;
      return { branch_code: codigo, default_location: '40' };
    },
    nombresDeAlmacenes: async () => { lecturas.almacenes++; return new Map([['40', 'Almacen PT']]); },
  };
  if (reloj) Object.assign(deps, { ahora: reloj.ahora, esperar: reloj.esperar });
  return { deps, lecturas, soltar };
}

beforeEach(() => { _reiniciar(); });
after(() => { _reiniciar(); });

test('el barrido corre en segundo plano: el avance dice en curso con revisados y total, y al terminar deja el barrido', async () => {
  const reloj = relojFalso();
  const operam = operamMemoria({ clientes: clientesCon(3), reloj, bloquear: '101' });

  barrerAlmacenesDomicilios(operam.deps);
  assert.equal(avanceBarridoAlmacenes().estado, 'en curso', 'el arranque no espera a Operam');

  while (operam.lecturas.branches.length < 2) await new Promise(r => setImmediate(r));
  const enCurso = avanceBarridoAlmacenes();
  assert.equal(enCurso.estado, 'en curso');
  assert.equal(enCurso.total, 3);
  assert.equal(enCurso.revisados, 1);
  assert.equal(ultimoBarridoAlmacenes(), null, 'sin barrido terminado todavia');

  operam.soltar();
  await _esperarBarrido();

  const fin = avanceBarridoAlmacenes();
  assert.equal(fin.estado, 'terminado');
  assert.equal(fin.revisados, 3);
  assert.equal(fin.total, 3);
  assert.deepEqual(Object.keys(ultimoBarridoAlmacenes().branches).sort(), ['100', '101', '102']);
});

test('sin barrido desde el arranque no hay avance', () => {
  assert.equal(avanceBarridoAlmacenes(), null);
});

// El ritmo de la casa para barridos contra Operam: los scripts de lote leen con
// 1100 ms entre lecturas (sync-catalogo, rescatar-genericos, clientes-sin-lista).
test('ritmo propio: entre una lectura de Operam y la siguiente pasan al menos 1100 ms del reloj', async () => {
  const reloj = relojFalso();
  const operam = operamMemoria({ clientes: clientesCon(4), reloj });

  await barrerAlmacenesDomicilios(operam.deps);

  const tiempos = operam.lecturas.branches.map(l => l.t);
  assert.equal(tiempos.length, 4);
  for (let i = 1; i < tiempos.length; i++) {
    assert.ok(tiempos[i] - tiempos[i - 1] >= 1100, `lectura ${i}: ${tiempos[i] - tiempos[i - 1]} ms despues de la anterior`);
  }
  assert.ok(reloj.esperas.length >= 4, 'tambien pausa entre el padron y el primer domicilio');
});

test('una lectura que ya tardo mas que el intervalo no suma otra espera', async () => {
  const reloj = relojFalso();
  const operam = operamMemoria({ clientes: clientesCon(3), reloj });
  const lectorLento = operam.deps.obtenerBranch;
  operam.deps.obtenerBranch = async (codigo) => {
    const r = await lectorLento(codigo);
    reloj.t += 5000;
    return r;
  };

  await barrerAlmacenesDomicilios(operam.deps);

  const tiempos = operam.lecturas.branches.map(l => l.t);
  assert.deepEqual(tiempos.slice(1).map((t, i) => t - tiempos[i]), [5000, 5000]);
});

test('un segundo clic mientras corre no lanza otro barrido: el padron se lee una sola vez', async () => {
  const reloj = relojFalso();
  const operam = operamMemoria({ clientes: clientesCon(2), reloj, bloquear: '100' });

  const primero = barrerAlmacenesDomicilios(operam.deps);
  const segundo = barrerAlmacenesDomicilios(operam.deps);
  assert.equal(segundo, primero);

  operam.soltar();
  await _esperarBarrido();
  assert.equal(operam.lecturas.padron, 1);
  assert.equal(avanceBarridoAlmacenes().estado, 'terminado');
});

test('sin padron el barrido falla en el avance, sin rechazo suelto, y conserva el barrido anterior', async () => {
  const reloj = relojFalso();
  await barrerAlmacenesDomicilios(operamMemoria({ clientes: clientesCon(1), reloj }).deps);
  const anterior = ultimoBarridoAlmacenes();

  const operam = operamMemoria({ clientes: [], reloj, fallaPadron: 'Operam login 429' });
  await barrerAlmacenesDomicilios(operam.deps);

  const avance = avanceBarridoAlmacenes();
  assert.equal(avance.estado, 'fallo');
  assert.match(avance.error, /No se pudo leer el padron de Operam: Operam login 429/);
  assert.equal(ultimoBarridoAlmacenes(), anterior, 'el reporte anterior sigue sirviendo');
  assert.equal(operam.lecturas.branches.length, 0);
});

// En produccion no habia forma de saber si el barrido avanzaba (comentario de #416).
test('el avance y el final quedan en los logs, sin una linea por lectura', async (t) => {
  const log = t.mock.method(console, 'log', () => {});
  const reloj = relojFalso();

  await barrerAlmacenesDomicilios(operamMemoria({ clientes: clientesCon(120), reloj }).deps);

  const lineas = log.mock.calls.map(c => c.arguments.join(' ')).filter(l => l.includes('[almacen-domicilios]'));
  assert.ok(lineas.some(l => /iniciado/.test(l) && /120 domicilios/.test(l)), lineas.join('\n'));
  assert.ok(lineas.some(l => l.includes('50/120')), lineas.join('\n'));
  assert.ok(lineas.some(l => l.includes('100/120')), lineas.join('\n'));
  assert.ok(lineas.some(l => /terminado/.test(l) && /120 domicilios revisados/.test(l) && /0 sin leer/.test(l)), lineas.join('\n'));
  assert.ok(lineas.length <= 6, `${lineas.length} lineas de log`);
});

test('el fallo del barrido queda en los logs', async (t) => {
  const error = t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'log', () => {});

  await barrerAlmacenesDomicilios(operamMemoria({ clientes: [], reloj: relojFalso(), fallaPadron: 'Operam 429' }).deps);

  const lineas = error.mock.calls.map(c => c.arguments.join(' '));
  assert.ok(lineas.some(l => l.includes('[almacen-domicilios]') && /fallo/.test(l) && /Operam 429/.test(l)), lineas.join('\n'));
});

// El ritmo es SOLO del barrido: el throttle global de operam-client (_setMinInterval)
// frenaria a todo el cotizador mientras barre. Aqui el barrido va por el
// operam-client real (fetch en memoria) y se queda en su pausa; mientras, el resto
// de la app lee Operam dos veces seguidas sin esperar.
test('mientras el barrido espera su turno, el resto de la app lee Operam sin throttle', async (t) => {
  t.mock.method(console, 'log', () => {});
  const operamClient = await import('../lib/operam-client.js');
  process.env.OPERAM_URL = process.env.OPERAM_URL || 'https://operam.invalid';
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; operamClient.resetSession(); });
  operamClient.resetSession();
  const json = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/api/v3/login')) return json({ token: 'tok', result: true });
    if (u.includes('/api/v3/sales/customers?')) return json({ total: 1, data: clientesCon(3) });
    if (u.includes('/api/v3/sales/branches/')) return json({ data: [{ branch_code: u.split('/branches/')[1], default_location: '40' }] });
    if (u.includes('/api/v3/inventory/locations')) return json({ data: [] });
    throw new Error('Unmocked fetch: ' + u);
  };

  let soltarPausa;
  let enPausa;
  const pausa = new Promise(res => { enPausa = res; });
  const barrido = barrerAlmacenesDomicilios({
    esperar: () => { enPausa(); return new Promise(res => { soltarPausa = res; }); },
  });
  await pausa;
  assert.equal(avanceBarridoAlmacenes().estado, 'en curso');

  const antes = Date.now();
  await operamClient.obtenerBranch('900');
  await operamClient.obtenerBranch('901');
  assert.ok(Date.now() - antes < 500, `la app espero ${Date.now() - antes} ms`);

  // Suelta cada pausa del barrido hasta que termine.
  const soltarTodo = setInterval(() => soltarPausa?.(), 1);
  await barrido;
  clearInterval(soltarTodo);
  assert.equal(avanceBarridoAlmacenes().estado, 'terminado');
});
