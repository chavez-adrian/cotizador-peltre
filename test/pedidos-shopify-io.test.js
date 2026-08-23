import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { leerArchivoSync, escribirArchivoSync, borrarArchivoSync } from '../lib/fs-reintento.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PEDIDOS_PATH = join(__dirname, '..', 'data', 'pedidos-shopify.json');

// La suite NO toca red ni credenciales reales: el token se monta aqui con un
// valor de mentira y todo el trafico lo intercepta el mock por URL, el mismo
// patron de las suites de Operam y de #227.
process.env.SHOPIFY_API_TOKEN = 'token-de-prueba';

const { sondearPedidosShopify } = await import('../lib/pedidos-shopify-io.js');
const store = await import('../lib/pedidos-shopify-store.js');

const originalFetch = globalThis.fetch;

function mockFetchByUrl(handlers) {
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    for (const [pat, fn] of Object.entries(handlers)) {
      if (u.includes(pat)) return fn(u, opts);
    }
    throw new Error('Unmocked fetch: ' + u);
  };
}

function jsonResponse(data, status = 200) {
  return { ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) };
}

// Nodos calcados de la respuesta real (medida read-only el 2026-08-22).
function nodo(name, { phone = '+529991632568', createdAt, updatedAt } = {}) {
  return {
    name, createdAt, updatedAt,
    email: 'comprador@ejemplo.mx',
    phone: null,
    customer: { defaultPhoneNumber: null },
    shippingAddress: { name: 'Gerardo Cardenas Guillermo', phone, countryCodeV2: 'MX' },
    billingAddress: { name: 'Gerardo Cardenas Guillermo', phone, countryCodeV2: 'MX' },
  };
}

const S1897 = nodo('S1897', { createdAt: '2026-08-21T23:25:55Z', updatedAt: '2026-08-21T23:25:57Z' });
const S1898 = nodo('S1898', { createdAt: '2026-08-21T23:31:03Z', updatedAt: '2026-08-21T23:31:06Z' });

// Shopify de mentira. `paginas` es la lista de respuestas que va a dar, en
// orden; `peticiones` guarda las variables de cada consulta para poder afirmar
// sobre el filtro y el cursor.
function shopifyFalso(paginas, estado = {}) {
  estado.peticiones = [];
  let i = 0;
  return {
    'myshopify.com/admin/api': (u, opts) => {
      estado.peticiones.push(JSON.parse(opts.body).variables);
      const pagina = paginas[Math.min(i, paginas.length - 1)];
      i += 1;
      if (typeof pagina === 'function') return pagina();
      return jsonResponse({
        data: {
          orders: {
            pageInfo: { hasNextPage: Boolean(pagina.hasNextPage), endCursor: pagina.endCursor || null },
            nodes: pagina.nodos,
          },
        },
      });
    },
  };
}

let respaldo = null;
let existia = false;

before(() => {
  existia = existsSync(PEDIDOS_PATH);
  if (existia) respaldo = leerArchivoSync(PEDIDOS_PATH);
});

after(() => {
  globalThis.fetch = originalFetch;
  if (existia) escribirArchivoSync(PEDIDOS_PATH, respaldo);
  else if (existsSync(PEDIDOS_PATH)) borrarArchivoSync(PEDIDOS_PATH);
  delete process.env.SHOPIFY_API_TOKEN;
});

beforeEach(() => {
  if (existsSync(PEDIDOS_PATH)) borrarArchivoSync(PEDIDOS_PATH);
  process.env.SHOPIFY_API_TOKEN = 'token-de-prueba';
  globalThis.fetch = async (url) => { throw new Error('fetch sin mock en tests: ' + url); };
});

test('el sondeo persiste una fila por pedido y avanza el cursor', async () => {
  const estado = {};
  mockFetchByUrl(shopifyFalso([{ nodos: [S1897, S1898] }], estado));

  const resumen = await sondearPedidosShopify();

  assert.equal(resumen.omitido, null);
  assert.equal(resumen.leidos, 2);
  assert.equal(resumen.filas, 2);
  assert.deepEqual(resumen.errores, []);
  assert.deepEqual((await store.listar()).map(f => [f.pedido, f.telefono]), [
    ['S1897', '+529991632568'],
    ['S1898', '+529991632568'],
  ]);
  assert.equal(await store.leerCursor(), '2026-08-21T23:31:06Z', 'el updated_at mas alto de la pagina');
});

// La primera corrida no tiene cursor y lee todo lo que el token alcanza (60
// dias); las siguientes filtran por lo ya visto. Sin esto, cada hora se
// releerian los sesenta dias completos.
test('la primera corrida lee sin filtro y la siguiente parte del cursor', async () => {
  const estado = {};
  mockFetchByUrl(shopifyFalso([{ nodos: [S1898] }], estado));
  await sondearPedidosShopify();
  await sondearPedidosShopify();

  assert.equal(estado.peticiones[0].filtro, null);
  assert.equal(estado.peticiones[1].filtro, 'updated_at:>=2026-08-21T23:31:06Z');
});

// Reingerir el mismo pedido no puede duplicar nada: el filtro es `>=`, asi que
// el ultimo pedido visto vuelve a llegar en cada corrida.
test('dos corridas seguidas sobre el mismo estado dejan la tabla igual', async () => {
  mockFetchByUrl(shopifyFalso([{ nodos: [S1897, S1898] }]));
  await sondearPedidosShopify();
  const antes = await store.listar();
  await sondearPedidosShopify();
  assert.deepEqual(await store.listar(), antes);
});

test('la paginacion sigue el cursor hasta que Shopify dice que no hay mas', async () => {
  const estado = {};
  mockFetchByUrl(shopifyFalso([
    { nodos: [S1897], hasNextPage: true, endCursor: 'cur-1' },
    { nodos: [S1898], hasNextPage: false, endCursor: 'cur-2' },
  ], estado));

  const resumen = await sondearPedidosShopify();

  assert.equal(resumen.leidos, 2);
  assert.equal(estado.peticiones.length, 2);
  assert.equal(estado.peticiones[0].cursor, null);
  assert.equal(estado.peticiones[1].cursor, 'cur-1');
});

// La pagina que SI se leyo no se pierde: su cursor queda persistido y la
// siguiente corrida arranca de ahi en vez de repetir todo.
test('un fallo en la segunda pagina conserva lo que trajo la primera', async () => {
  mockFetchByUrl(shopifyFalso([
    { nodos: [S1897], hasNextPage: true, endCursor: 'cur-1' },
    () => jsonResponse({ errors: [{ message: 'Throttled' }] }),
  ]));

  const resumen = await sondearPedidosShopify();

  assert.equal(resumen.errores.length, 1);
  assert.match(resumen.errores[0].motivo, /Throttled/);
  assert.deepEqual((await store.listar()).map(f => f.pedido), ['S1897']);
  assert.equal(await store.leerCursor(), '2026-08-21T23:25:57Z');
});

// Un fallo de Shopify NO tumba nada: el sondeo devuelve su resumen con el error
// y la tabla se queda como estaba. El barrido de contactos que corre aparte lee
// esa misma tabla y no se entera.
test('un fallo de Shopify no escribe nada y se reporta como error', async () => {
  mockFetchByUrl({ 'myshopify.com/admin/api': () => jsonResponse({ errors: [{ message: 'boom' }] }, 500) });

  const resumen = await sondearPedidosShopify();

  assert.equal(resumen.leidos, 0);
  assert.equal(resumen.errores.length, 1);
  assert.match(resumen.errores[0].motivo, /Shopify 500/);
  assert.deepEqual(await store.listar(), []);
  assert.equal(await store.leerCursor(), null);
});

test('sin token de Shopify el sondeo se omite, sin lanzar y sin tocar la red', async () => {
  delete process.env.SHOPIFY_API_TOKEN;
  const resumen = await sondearPedidosShopify();
  assert.equal(resumen.omitido, 'sin credenciales');
  assert.deepEqual(resumen.errores, []);
});

// Los descartes son lo que el panel (#257) va a mostrar: por que un pedido no
// produjo ficha. Salen del nucleo puro y el sondeo solo los acumula.
test('los telefonos que no resuelven llegan al resumen como descartes', async () => {
  const sinCodigo = nodo('S1893', {
    phone: '4491112584', createdAt: '2026-08-07T20:21:29Z', updatedAt: '2026-08-19T21:16:04Z',
  });
  mockFetchByUrl(shopifyFalso([{ nodos: [sinCodigo, S1898] }]));

  const resumen = await sondearPedidosShopify();

  assert.equal(resumen.leidos, 2);
  assert.equal(resumen.filas, 1, 'solo el que trae codigo de pais');
  assert.deepEqual(resumen.descartes.map(d => [d.pedido, d.motivo]), [
    ['S1893', 'sin codigo de pais'],
  ]);
  assert.deepEqual((await store.listar()).map(f => f.pedido), ['S1898']);
});
