// #105: el padron de contactos de domicilio (contact_list de Operam) se lee completo,
// por paginas, con ritmo PROPIO y secuencial (#438) y se cachea con TTL. Aqui se
// prueba la envoltura con IO con Operam en memoria y un reloj falso: nada sale a la
// red y ninguna espera es real.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const io = await import('../lib/contactos-domicilio-io.js');
const { contactosDelDomicilio, refrescarContactosDomicilio, releerContactosDomicilioTrasEscribir, _esperarRefresco, _setIo, _reiniciar } = io;

function relojFalso() {
  const reloj = { t: 1_000_000, esperas: [] };
  reloj.ahora = () => reloj.t;
  reloj.esperar = async (ms) => { reloj.esperas.push(ms); reloj.t += ms; };
  return reloj;
}

function fila(n, extra = {}) {
  return { id: String(n), type: 'cust_branch', action: 'delivery', entity_id: String(1000 + n), name: 'Persona ' + n, phone: '', email: '', ...extra };
}

// contact_list en memoria: `total` filas, paginas de 100. Anota el skip y la hora
// del reloj de cada lectura, y cuantas lecturas estan en vuelo a la vez.
function contactListMemoria({ total, reloj, filasExtra = [], falla = null, bloquear = false }) {
  const todas = [...Array.from({ length: total - filasExtra.length }, (_, i) => fila(i)), ...filasExtra];
  const lecturas = [];
  let enVuelo = 0;
  let maxEnVuelo = 0;
  let soltar;
  const bloqueo = new Promise(res => { soltar = res; });
  const leerPaginaContactos = async (skip) => {
    lecturas.push({ skip, t: reloj.ahora() });
    enVuelo++;
    maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
    try {
      if (bloquear) await bloqueo;
      await new Promise(r => setImmediate(r));
      if (falla && falla(skip)) throw new Error('Operam 429');
      return { filas: todas.slice(skip, skip + 100), total: todas.length };
    } finally {
      enVuelo--;
    }
  };
  return { leerPaginaContactos, lecturas, todas, soltar, maxEnVuelo: () => maxEnVuelo };
}

const FACTURA_564 = fila(9999, { action: 'invoice', entity_id: '564', name: 'Cuentas Bosques', email: 'cxp.bosques@cliente.mx' });

beforeEach(() => { _reiniciar(); });
after(() => { _reiniciar(); });

test('lee TODAS las paginas de contact_list una tras otra, a su ritmo, y deja los contactos por domicilio', async () => {
  const reloj = relojFalso();
  const op = contactListMemoria({ total: 250, reloj, filasExtra: [FACTURA_564] });
  _setIo({ leerPaginaContactos: op.leerPaginaContactos, intervaloMs: 1100, ahora: reloj.ahora, esperar: reloj.esperar });

  await refrescarContactosDomicilio();

  assert.deepEqual(op.lecturas.map(l => l.skip), [0, 100, 200]);
  assert.equal(op.maxEnVuelo(), 1, 'secuencial: nunca dos paginas a la vez');
  assert.ok(op.lecturas[1].t - op.lecturas[0].t >= 1100, 'una pagina cada 1100 ms como minimo');
  assert.ok(op.lecturas[2].t - op.lecturas[1].t >= 1100);
  assert.deepEqual(contactosDelDomicilio('564'), [
    { tag: 'invoice', nombre: 'Cuentas Bosques', telefono: '', email: 'cxp.bosques@cliente.mx' },
  ]);
});

test('con la cache fria la consulta no espera a Operam: responde null (no se sabe) y lanza UN solo refresco', async () => {
  const reloj = relojFalso();
  const op = contactListMemoria({ total: 150, reloj, filasExtra: [FACTURA_564], bloquear: true });
  _setIo({ leerPaginaContactos: op.leerPaginaContactos, intervaloMs: 0, ahora: reloj.ahora, esperar: reloj.esperar });

  assert.equal(contactosDelDomicilio('564'), null);
  assert.equal(contactosDelDomicilio('564'), null, 'la segunda consulta tampoco espera');
  op.soltar();
  await _esperarRefresco();

  assert.deepEqual(op.lecturas.map(l => l.skip), [0, 100], 'un solo barrido aunque hubo dos consultas');
  assert.equal(contactosDelDomicilio('564')[0].email, 'cxp.bosques@cliente.mx');
});

test('dentro del TTL de 1 h no se relee Operam; vencido, responde lo que tiene y refresca en segundo plano', async () => {
  const reloj = relojFalso();
  const op = contactListMemoria({ total: 50, reloj, filasExtra: [FACTURA_564] });
  _setIo({ leerPaginaContactos: op.leerPaginaContactos, intervaloMs: 0, ahora: reloj.ahora, esperar: reloj.esperar });
  await refrescarContactosDomicilio();
  assert.equal(op.lecturas.length, 1);

  reloj.t += 59 * 60 * 1000;
  assert.equal(contactosDelDomicilio('564').length, 1);
  await _esperarRefresco();
  assert.equal(op.lecturas.length, 1, 'dentro del TTL no hay lectura');

  reloj.t += 2 * 60 * 1000;
  assert.equal(contactosDelDomicilio('564').length, 1, 'vencido responde lo que ya tenia');
  await _esperarRefresco();
  assert.equal(op.lecturas.length, 2, 'y refresca una vez');
});

test('si Operam falla a media lectura se conserva el padron anterior y no se reintenta en cada consulta', async () => {
  const reloj = relojFalso();
  const log = [];
  const warn = console.warn;
  console.warn = (...a) => log.push(a.join(' '));
  try {
    let fallar = false;
    const op = contactListMemoria({ total: 150, reloj, filasExtra: [FACTURA_564], falla: (skip) => fallar && skip === 100 });
    _setIo({ leerPaginaContactos: op.leerPaginaContactos, intervaloMs: 0, ahora: reloj.ahora, esperar: reloj.esperar });
    await refrescarContactosDomicilio();
    assert.equal(op.lecturas.length, 2);

    fallar = true;
    reloj.t += 61 * 60 * 1000;
    contactosDelDomicilio('564');
    await _esperarRefresco();
    assert.equal(op.lecturas.length, 4);
    assert.equal(contactosDelDomicilio('564')[0].email, 'cxp.bosques@cliente.mx', 'el padron anterior sigue');
    assert.ok(log.some(l => l.includes('[contactos-domicilio]') && l.includes('Operam 429')), log.join('\n'));

    await _esperarRefresco();
    contactosDelDomicilio('564');
    await _esperarRefresco();
    assert.equal(op.lecturas.length, 4, 'recien fallado no se vuelve a barrer en cada consulta');

    fallar = false;
    reloj.t += 6 * 60 * 1000;
    contactosDelDomicilio('564');
    await _esperarRefresco();
    assert.equal(op.lecturas.length, 6, 'pasado el respiro se vuelve a intentar');
  } finally {
    console.warn = warn;
  }
});

test('el refresco nunca rechaza, aunque falle la primera pagina con la cache fria', async () => {
  const reloj = relojFalso();
  const warn = console.warn;
  console.warn = () => {};
  try {
    const op = contactListMemoria({ total: 10, reloj, falla: () => true });
    _setIo({ leerPaginaContactos: op.leerPaginaContactos, intervaloMs: 0, ahora: reloj.ahora, esperar: reloj.esperar });
    await refrescarContactosDomicilio();
    assert.equal(contactosDelDomicilio('564'), null, 'sin padron no se sabe: null, no vacio');
  } finally {
    console.warn = warn;
  }
});

test('un branch_code numerico encuentra lo que Operam manda como texto', async () => {
  const reloj = relojFalso();
  const op = contactListMemoria({ total: 1, reloj, filasExtra: [FACTURA_564] });
  _setIo({ leerPaginaContactos: op.leerPaginaContactos, intervaloMs: 0, ahora: reloj.ahora, esperar: reloj.esperar });
  await refrescarContactosDomicilio();
  assert.equal(contactosDelDomicilio(564).length, 1);
  assert.deepEqual(contactosDelDomicilio('77'), [], 'con padron, un domicilio sin contactos es la lista vacia');
  assert.deepEqual(contactosDelDomicilio(null), []);
});

// Operam tiene ~2100 contactos (#397): una lectura que no trae NINGUNO no es evidencia
// de que ningun domicilio tenga contactos (sobre distinto al esperado, respuesta vacia).
// Mismo freno "sin evidencia" que la libreta de Google (#231): no se arma un padron
// vacio que haria afirmar "no tiene contactos de Facturacion".
test('una lectura completa sin ninguna fila cuenta como fallo: el padron sigue sin saberse (null)', async () => {
  const reloj = relojFalso();
  const log = [];
  const warn = console.warn;
  console.warn = (...a) => log.push(a.join(' '));
  try {
    _setIo({ leerPaginaContactos: async () => ({ filas: [], total: null }), intervaloMs: 0, ahora: reloj.ahora, esperar: reloj.esperar });
    await refrescarContactosDomicilio();
    assert.equal(contactosDelDomicilio('564'), null);
    assert.ok(log.some(l => l.includes('[contactos-domicilio]')), log.join('\n'));
  } finally {
    console.warn = warn;
  }
});

// #397 (revision): la decision de Adrian pide refresco puntual tras escribir. Un
// domicilio escrito mientras ya corre un barrido (el warm, un refresco por TTL) no
// entra en ese barrido si su pagina ya se leyo; por eso se agenda UNA relectura mas
// al terminar el barrido en vuelo. Aqui la fila nueva entra al frente de la lista
// cuando el primer barrido ya leyo la pagina 0: ese barrido no puede verla.
const FACTURA_777 = fila(7777, { action: 'invoice', entity_id: '777', name: 'Cuentas Nuevo', email: 'cxp.nuevo@cliente.mx' });

test('pedir releer tras escribir mientras corre un barrido agenda UNA relectura al terminar, a su ritmo y nunca en paralelo', async () => {
  const reloj = relojFalso();
  const op = contactListMemoria({ total: 250, reloj, filasExtra: [FACTURA_564] });
  const pedidos = [];
  const leer = async (skip) => {
    const pagina = await op.leerPaginaContactos(skip);
    if (op.lecturas.length === 1) {
      op.todas.unshift(FACTURA_777);
      pedidos.push(releerContactosDomicilioTrasEscribir(), releerContactosDomicilioTrasEscribir(), releerContactosDomicilioTrasEscribir());
    }
    return pagina;
  };
  _setIo({ leerPaginaContactos: leer, intervaloMs: 1100, ahora: reloj.ahora, esperar: reloj.esperar });

  const primero = refrescarContactosDomicilio();
  await primero;
  assert.deepEqual(contactosDelDomicilio('777'), [], 'el barrido en vuelo no alcanzo a ver el domicilio recien escrito');

  await Promise.all(pedidos);
  assert.deepEqual(op.lecturas.map(l => l.skip), [0, 100, 200, 0, 100, 200], 'tres peticiones, una sola relectura');
  assert.equal(op.maxEnVuelo(), 1, 'nunca dos lecturas a la vez');
  assert.ok(op.lecturas[3].t - op.lecturas[2].t >= 1100, 'la relectura guarda el ritmo desde la ultima pagina del barrido anterior');
  assert.deepEqual(contactosDelDomicilio('777'), [
    { tag: 'invoice', nombre: 'Cuentas Nuevo', telefono: '', email: 'cxp.nuevo@cliente.mx' },
  ]);
});

test('sin barrido en vuelo, releer tras escribir barre una vez', async () => {
  const reloj = relojFalso();
  const op = contactListMemoria({ total: 150, reloj, filasExtra: [FACTURA_564] });
  _setIo({ leerPaginaContactos: op.leerPaginaContactos, intervaloMs: 0, ahora: reloj.ahora, esperar: reloj.esperar });

  await releerContactosDomicilioTrasEscribir();
  await _esperarRefresco();

  assert.deepEqual(op.lecturas.map(l => l.skip), [0, 100]);
  assert.equal(contactosDelDomicilio('564').length, 1);
});

test('si el barrido en vuelo falla, la relectura pedida espera el respiro de 5 min y sale en la primera consulta despues', async () => {
  const reloj = relojFalso();
  const warn = console.warn;
  console.warn = () => {};
  try {
    let fallar = false;
    const op = contactListMemoria({ total: 150, reloj, filasExtra: [FACTURA_564], falla: (skip) => fallar && skip === 100 });
    let pedido = null;
    const leer = async (skip) => {
      const pagina = await op.leerPaginaContactos(skip);
      if (fallar && skip === 0 && !pedido) pedido = releerContactosDomicilioTrasEscribir();
      return pagina;
    };
    _setIo({ leerPaginaContactos: leer, intervaloMs: 0, ahora: reloj.ahora, esperar: reloj.esperar });
    await refrescarContactosDomicilio();
    assert.equal(op.lecturas.length, 2);

    fallar = true;
    reloj.t += 10 * 60 * 1000;
    await releerContactosDomicilioTrasEscribir();
    await pedido;
    await _esperarRefresco();
    assert.equal(op.lecturas.length, 4, 'el barrido fallo y la relectura no salio en rafaga');

    fallar = false;
    reloj.t += 2 * 60 * 1000;
    contactosDelDomicilio('564');
    await _esperarRefresco();
    assert.equal(op.lecturas.length, 4, 'dentro del respiro no se relee');

    reloj.t += 4 * 60 * 1000;
    assert.equal(contactosDelDomicilio('564')[0].email, 'cxp.bosques@cliente.mx', 'mientras, responde el padron anterior');
    await _esperarRefresco();
    assert.equal(op.lecturas.length, 6, 'pasado el respiro, la relectura pendiente sale aunque el padron no haya vencido');

    contactosDelDomicilio('564');
    await _esperarRefresco();
    assert.equal(op.lecturas.length, 6, 'una vez leido, no queda pendiente');
  } finally {
    console.warn = warn;
  }
});

test('sin barrido en vuelo pero dentro del respiro de un fallo, releer tras escribir no barre; sale en la primera consulta pasado el respiro', async () => {
  const reloj = relojFalso();
  const warn = console.warn;
  console.warn = () => {};
  try {
    let fallar = true;
    const op = contactListMemoria({ total: 150, reloj, filasExtra: [FACTURA_564], falla: (skip) => fallar && skip === 100 });
    _setIo({ leerPaginaContactos: op.leerPaginaContactos, intervaloMs: 0, ahora: reloj.ahora, esperar: reloj.esperar });
    await refrescarContactosDomicilio();
    await _esperarRefresco();
    assert.equal(op.lecturas.length, 2, 'el barrido fallo en la segunda pagina y ya no hay nada en vuelo');

    fallar = false;
    reloj.t += 60 * 1000;
    await releerContactosDomicilioTrasEscribir();
    await releerContactosDomicilioTrasEscribir();
    await _esperarRefresco();
    assert.equal(op.lecturas.length, 2, 'dos escrituras dentro del respiro no disparan ningun barrido');

    contactosDelDomicilio('564');
    await _esperarRefresco();
    assert.equal(op.lecturas.length, 2, 'una consulta dentro del respiro tampoco');

    reloj.t += 5 * 60 * 1000;
    contactosDelDomicilio('564');
    await _esperarRefresco();
    assert.equal(op.lecturas.length, 4, 'pasado el respiro la relectura pendiente sale una sola vez');
    assert.equal(contactosDelDomicilio('564')[0].email, 'cxp.bosques@cliente.mx');
  } finally {
    console.warn = warn;
  }
});
