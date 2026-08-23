// Lector de pedidos de la tienda en linea por la GraphQL Admin API de Shopify
// (spec #254, ticket #255). Calcado del patron de lib/google-contactos.js y
// lib/dropbox.js: fetch nativo contra el endpoint, CERO dependencias nuevas.
//
// Este modulo NO decide nada: pide una pagina y la devuelve tal como llego. Que
// telefono sirve y cual no lo decide el nucleo puro
// (lib/pedidos-shopify-logica.js); cuando volver a pedir, la envoltura
// (lib/pedidos-shopify-io.js).
//
// Env var: SHOPIFY_API_TOKEN, la MISMA que ya usa scripts/fetch-shopify-images.js.
// El token es de una app custom creada desde el admin -- tipo que Shopify dejo
// de crear en enero de 2026 y que NO se puede recrear (ADR-0014, "Riesgo de
// acceso"): no se rota sin respaldo. Solo alcanza a ver los ultimos 60 dias de
// pedidos; la historia anterior entra por la carga historica, no por aqui.

const TIENDA = 'pp-peltre.myshopify.com';
// REST es legacy desde 2024-10 y ya no recibe campos nuevos: toda lectura nueva
// va por GraphQL.
const VERSION_API = '2025-07';
const ENDPOINT = `https://${TIENDA}/admin/api/${VERSION_API}/graphql.json`;

// 100 y no 250: el costo de la consulta se calcula por objetos CONECTADOS, y con
// tres objetos anidados (customer, shippingAddress, billingAddress) una pagina
// de 250 rebasa el tope de 1,000 puntos por consulta. Medido el 2026-08-22: una
// pagina de 100 costo 7 puntos reales de 2,000 disponibles.
export const PEDIDOS_POR_PAGINA = 100;

// `customer.phone` esta DEPRECADO desde 2026-07 y no se pide: el telefono del
// perfil vive en `defaultPhoneNumber`. `countryCodeV2` es el campo del pais de
// la direccion (`country` devuelve el nombre en texto libre) y viaja desde ya
// aunque el escalon 1 no lo consulte: es lo que #256 necesita para completar el
// codigo de los numeros que llegan sin el.
const QUERY = `
query PedidosDesde($cursor: String, $filtro: String) {
  orders(first: ${PEDIDOS_POR_PAGINA}, after: $cursor, sortKey: UPDATED_AT, query: $filtro) {
    pageInfo { hasNextPage endCursor }
    nodes {
      name
      createdAt
      updatedAt
      email
      phone
      customer { defaultPhoneNumber { phoneNumber } }
      shippingAddress { name phone countryCodeV2 }
      billingAddress { name phone countryCodeV2 }
    }
  }
}`;

export function credencialesConfiguradas() {
  return Boolean(process.env.SHOPIFY_API_TOKEN);
}

// Una pagina de pedidos ordenados por `updated_at` ascendente. `desde` filtra
// por esa misma marca (asi entran tambien los pedidos VIEJOS a los que alguien
// le corrigio la direccion, que es la razon de ordenar por updated_at y no por
// fecha de creacion); sin `desde` se lee todo lo que el token alcanza.
export async function leerPaginaDePedidos({ desde = null, cursor = null } = {}) {
  if (!credencialesConfiguradas()) throw new Error('Falta la var SHOPIFY_API_TOKEN');
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': process.env.SHOPIFY_API_TOKEN.trim(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: QUERY,
      variables: { cursor, filtro: desde ? `updated_at:>=${desde}` : null },
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Shopify ${r.status}: ${JSON.stringify(data).slice(0, 300)}`);
  // GraphQL responde 200 con `errors` cuando la consulta falla (permiso
  // faltante, campo inexistente, throttling): sin esta comprobacion, un token
  // sin acceso a los datos del comprador se leeria como "cero pedidos" y la
  // fuente se vaciaria en silencio.
  if (data.errors) throw new Error(`Shopify GraphQL: ${JSON.stringify(data.errors).slice(0, 300)}`);
  const orders = data.data?.orders || {};
  return {
    nodos: orders.nodes || [],
    hasNextPage: Boolean(orders.pageInfo?.hasNextPage),
    cursor: orders.pageInfo?.endCursor || null,
  };
}
